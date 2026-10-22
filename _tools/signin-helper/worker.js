// HerePup sign-in helper (a Cloudflare Worker).
//
// Two jobs, both for insurers that don't let a web page do them itself:
//  1. /token: after a member signs in at their insurer, the web app sends the one-time sign-in code here. The helper
//     adds HerePup's client secret (a public website can't keep one), trades the code for an access token at the
//     insurer, and hands the insurer's answer straight back to the member's browser.
//  2. /fhir: some insurers (Aetna production) don't let a web page read the member's claims directly (CORS). The web
//     app then sends the insurer address it wants and the member's own access token here; the helper makes that one
//     read-only request and streams the insurer's reply straight back. It never adds HerePup's secret to these
//     requests, so it can't read anything the member's own token couldn't.
//  3. /guide: a benefit guide the reader couldn't read, sent only when the person presses "Send this guide" and
//     confirms it's their employer's general guide (no personal details). Kept in Workers KV for at most 180 days so
//     HerePup can teach the reader that layout; /guides (with ADMIN_TOKEN) lists, downloads and deletes them.
// Apart from those guides it stores nothing and logs nothing: no code, token or claim is written anywhere.
//
// Guard rails: it answers only pages on herepup.health, only for the callback https://herepup.health/app/callback/,
// and only ever calls the insurer token and claims addresses listed below (GET only for claims, no redirects
// followed). It is not a general-purpose proxy. Keep Workers Logs / Logpush off for this Worker.
//
// Settings (Cloudflare: Workers & Pages > herepup-signin > Settings > Variables and Secrets):
//   AETNA_SANDBOX_CLIENT_ID     Text     client ID of the Aetna sandbox app (not secret; the web app reads it from /health)
//   AETNA_SANDBOX_SECRET        Secret   that app's client secret
//   AETNA_PRODUCTION_CLIENT_ID  Text     Aetna production app
//   AETNA_PRODUCTION_SECRET     Secret   its client secret
//   MEDICARE_SANDBOX_CLIENT_ID  Text     CMS Blue Button 2.0 sandbox app (Original Medicare)
//   MEDICARE_SANDBOX_SECRET     Secret   its client secret
//   MEDICARE_PRODUCTION_...     later, once CMS approves production access
//   ALLOWED_ORIGINS             Text     optional, comma-separated; default https://herepup.health
//   GUIDES                      KV namespace binding (Settings > Bindings) for guides people choose to send
//   ADMIN_TOKEN                 Secret   a long random password for /guides (listing, downloading, deleting)

const TOKEN_URLS = {
  "aetna:sandbox": "https://vteapif1.aetna.com/fhirdemo/v1/fhirserver_auth/oauth2/token",
  "aetna:production": "https://apif1.aetna.com/fhir/v1/fhirserver_auth/oauth2/token",
  "medicare:sandbox": "https://sandbox.bluebutton.cms.gov/v2/o/token/",
  "medicare:production": "https://api.bluebutton.cms.gov/v2/o/token/",
};
// The claims (FHIR) servers the helper may read from on a member's behalf. Override one with <KEY>_FHIR_URL.
const FHIR_BASES = {
  "aetna:sandbox": "https://vteapif1.aetna.com/fhirdemo/v2/patientaccess",
  "aetna:production": "https://apif1.aetna.com/fhir/v2/patientaccess",
  "medicare:sandbox": "https://sandbox.bluebutton.cms.gov/v2/fhir",
  "medicare:production": "https://api.bluebutton.cms.gov/v2/fhir",
};
const GUIDE_MAX = 20 * 1024 * 1024, GUIDE_DAYS = 180;
const RESULTS = new Set(["no table", "checks", "read wrong"]);
const html = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// The private list of guides people sent: download or delete each. Needs ?token=ADMIN_TOKEN.
async function guidesAdmin(request, env, path) {
  const url = new URL(request.url), token = url.searchParams.get("token") || "";
  if (!env.GUIDES || !env.ADMIN_TOKEN || !sameSecret(token, env.ADMIN_TOKEN)) return new Response("Not found", { status: 404 });
  const page = (body) => new Response(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Guides sent to HerePup</title>
    <style>body{font:15px system-ui,sans-serif;margin:24px;color:#33475B}table{border-collapse:collapse}td,th{padding:6px 10px;border-bottom:1px solid #D5DDE0;text-align:left}</style>${body}`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
  const q = `?token=${encodeURIComponent(token)}`;
  const key = decodeURIComponent(path.slice("/guides/".length));
  if (path.startsWith("/guides/") && key.startsWith("g:")) {
    if (request.method === "POST") { await env.GUIDES.delete(key); return Response.redirect(`${url.origin}/guides${q}`, 303); }
    const { value, metadata } = await env.GUIDES.getWithMetadata(key, { type: "arrayBuffer" });
    if (!value) return new Response("Gone", { status: 404 });
    const name = String((metadata || {}).name || "guide.pdf").replace(/[^\w.\- ]+/g, "_");
    return new Response(value, { headers: { "Content-Type": (metadata || {}).type || "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  }
  const rows = [];
  let cursor;
  do { const l = await env.GUIDES.list({ prefix: "g:", cursor }); rows.push(...l.keys); cursor = l.list_complete ? null : l.cursor; } while (cursor);
  rows.sort((a, b) => (b.name > a.name ? 1 : -1));
  return page(`<h1>Guides sent to HerePup (${rows.length})</h1><p>Each is deleted automatically ${GUIDE_DAYS} days after it was sent. Delete it sooner once the reader handles its layout.</p>
    <table><tr><th>Sent</th><th>File</th><th>What happened</th><th>Size</th><th></th></tr>${rows.map((k) => { const m = k.metadata || {}, u = `/guides/${encodeURIComponent(k.name)}${q}`;
      return `<tr><td>${html(m.at || "")}</td><td><a href="${html(u)}">${html(m.name || "guide")}</a></td><td>${html(m.result || "")}</td><td>${Math.round((m.size || 0) / 1024)} KB</td>
      <td><form method="post" action="${html(u)}"><button>Delete</button></form></td></tr>`; }).join("")}</table>`);
}

const GRANTS = new Set(["authorization_code", "refresh_token"]);
const MAX = 4096; // longest code, verifier or refresh token accepted
const MAX_TOKEN = 8192; // longest access token relayed
const TOKEN_CHARS = /^[A-Za-z0-9\-._~+/]+=*$/;

// The insurer address, only if it sits under that insurer's claims server (same https origin, same base path).
function fhirTarget(env, key, raw) {
  const p = key.replace(":", "_").toUpperCase();
  let base, u;
  try { base = new URL(env[p + "_FHIR_URL"] || FHIR_BASES[key]); u = new URL(String(raw || "")); } catch (e) { return null; }
  const root = base.pathname.replace(/\/+$/, "");
  if (u.protocol !== "https:" || u.origin !== base.origin || u.username || u.password) return null;
  if (u.pathname !== root && !u.pathname.startsWith(root + "/")) return null;
  if (/(^|\/)\.\.?(\/|$)/.test(u.pathname) || /%2e|%2f|%5c/i.test(u.pathname)) return null;
  u.hash = "";
  return u.toString();
}

function settingsFor(env, key) {
  const p = key.replace(":", "_").toUpperCase(); // aetna:sandbox -> AETNA_SANDBOX
  const id = env[p + "_CLIENT_ID"], secret = env[p + "_SECRET"];
  return id && secret ? { id, secret, tokenUrl: env[p + "_TOKEN_URL"] || TOKEN_URLS[key] } : null;
}

export default {
  async fetch(request, env) {
    const origins = (env.ALLOWED_ORIGINS || "https://herepup.health").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const allowed = origins.includes(origin);
    const cors = allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors,
      "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
    const path = new URL(request.url).pathname;

    if (request.method === "OPTIONS") {
      if (!allowed) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" } });
    }

    // Which insurers are set up, with their public client IDs (never the secrets).
    if (path === "/health" && request.method === "GET") {
      const ready = {};
      for (const key of Object.keys(TOKEN_URLS)) { const s = settingsFor(env, key); if (s) ready[key] = { client_id: s.id }; }
      return reply(200, { ok: true, ready, relay: Object.keys(FHIR_BASES), guides: !!env.GUIDES });
    }

    // A guide the person chose to send (see the header). PDF or text only, 20 MB at most, kept 180 days at most.
    if (path === "/guide" && request.method === "POST") {
      if (!allowed) return reply(403, { error: "origin_not_allowed", error_description: "This helper only answers HerePup's own pages." });
      if (!env.GUIDES) return reply(503, { error: "not_configured", error_description: "Sending guides isn't switched on yet." });
      if (Number(request.headers.get("Content-Length") || 0) > GUIDE_MAX + 65536) return reply(413, { error: "too_large", error_description: "That guide is larger than 20 MB." });
      let form;
      try { form = await request.formData(); } catch (e) { return reply(400, { error: "invalid_request", error_description: "Send the guide as a form upload." }); }
      const f = form.get("guide");
      if (!f || typeof f === "string" || !f.size) return reply(400, { error: "invalid_request", error_description: "No guide was attached." });
      if (f.size > GUIDE_MAX) return reply(413, { error: "too_large", error_description: "That guide is larger than 20 MB." });
      const buf = await f.arrayBuffer(), head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
      const isPdf = head === "%PDF-", isText = /\.txt$/i.test(f.name || "") && f.size < 2 * 1024 * 1024;
      if (!isPdf && !isText) return reply(415, { error: "unsupported", error_description: "Only PDF (or plain text) guides can be sent." });
      const result = RESULTS.has(form.get("result")) ? form.get("result") : "other";
      const at = new Date().toISOString();
      const key = `g:${at.slice(0, 19)}:${crypto.randomUUID().slice(0, 8)}`;
      await env.GUIDES.put(key, buf, { expirationTtl: GUIDE_DAYS * 86400,
        metadata: { name: String(f.name || "guide").slice(0, 120), result, size: f.size, type: isPdf ? "application/pdf" : "text/plain", at: at.slice(0, 16).replace("T", " ") } });
      return reply(200, { ok: true });
    }
    if (path === "/guides" || path.startsWith("/guides/")) return guidesAdmin(request, env, path);

    // Read one claims page on the member's behalf, with the member's own token (never HerePup's secret).
    if (path === "/fhir" && request.method === "POST") {
      if (!allowed) return reply(403, { error: "origin_not_allowed", error_description: "This helper only answers HerePup's own pages." });
      let b;
      try { b = await request.json(); } catch (e) { return reply(400, { error: "invalid_request", error_description: "Send JSON." }); }
      const key = `${b.carrier}:${b.env}`;
      if (!FHIR_BASES[key]) return reply(400, { error: "invalid_request", error_description: "Unknown insurer or environment." });
      if (typeof b.token !== "string" || !b.token || b.token.length > MAX_TOKEN || !TOKEN_CHARS.test(b.token))
        return reply(400, { error: "invalid_request", error_description: "Missing or invalid access token." });
      const target = fhirTarget(env, key, b.url);
      if (!target) return reply(400, { error: "invalid_request", error_description: "That address isn't on this insurer's claims server." });
      let r;
      try {
        r = await fetch(target, { method: "GET", redirect: "manual",
          headers: { Authorization: "Bearer " + b.token, Accept: "application/fhir+json, application/json" } });
      } catch (e) { return reply(502, { error: "insurer_unreachable", error_description: "The insurer's claims server didn't answer." }); }
      if (r.status >= 300 && r.status < 400) return reply(502, { error: "redirect_refused", error_description: `The insurer's claims server tried to redirect (${r.status}).` });
      return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": r.headers.get("Content-Type") || "application/fhir+json",
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
    }

    if (path !== "/token" || request.method !== "POST") return reply(404, { error: "not_found" });
    if (!allowed) return reply(403, { error: "origin_not_allowed", error_description: "This helper only answers HerePup's own pages." });

    let b;
    try { b = await request.json(); } catch (e) { return reply(400, { error: "invalid_request", error_description: "Send JSON." }); }
    const key = `${b.carrier}:${b.env}`;
    if (!TOKEN_URLS[key]) return reply(400, { error: "invalid_request", error_description: "Unknown insurer or environment." });
    const s = settingsFor(env, key);
    if (!s) return reply(503, { error: "not_configured", error_description: `The sign-in helper isn't set up for ${b.carrier} ${b.env} yet.` });
    if (!GRANTS.has(b.grant_type)) return reply(400, { error: "unsupported_grant_type" });

    const form = new URLSearchParams({ grant_type: b.grant_type });
    const need = b.grant_type === "authorization_code" ? ["code", "redirect_uri", "code_verifier"] : ["refresh_token"];
    for (const k of need) {
      if (typeof b[k] !== "string" || !b[k] || b[k].length > MAX) return reply(400, { error: "invalid_request", error_description: `Missing or invalid ${k}.` });
      form.set(k, b[k]);
    }
    if (b.grant_type === "authorization_code" && b.redirect_uri !== origin + "/app/callback/")
      return reply(400, { error: "invalid_request", error_description: "Unexpected callback address." });

    let r;
    try {
      r = await fetch(s.tokenUrl, { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json", Authorization: "Basic " + btoa(`${s.id}:${s.secret}`) } });
    } catch (e) { return reply(502, { error: "insurer_unreachable", error_description: "The insurer's sign-in server didn't answer." }); }
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { j = { error: "bad_response", error_description: `The insurer's sign-in server answered ${r.status}.` }; }
    return reply(r.status, j);
  },
};

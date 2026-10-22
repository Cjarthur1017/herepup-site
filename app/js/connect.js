// Direct insurer connections from the browser (in testing: turn on with /app/?connect=test, off with ?connect=off).
// SMART on FHIR authorization code with PKCE. The insurer returns the sign-in to /app/callback/ on this same site,
// which leaves the code for this tab, and the claims then come straight from the insurer to this browser.
// Two steps can need HerePup's sign-in helper (a small Cloudflare Worker, source in _tools/signin-helper/), which
// keeps and logs nothing: insurers like Aetna require a client secret to trade the sign-in code for an access token,
// and block browsers from that step (CORS), so the helper holds the secret and does that one exchange. And some
// insurers (Aetna production) also block browsers from reading the claims, so when a direct read is blocked the
// helper makes the same read-only request with the member's own token and passes the reply straight back.
// check() tests what this browser can reach before anyone signs in.
"use strict";

// HerePup's sign-in helper. Empty = the browser does the token step itself (works only where the insurer allows it).
const HELPER_URL = "https://herepup-signin.sweet-bread-ec98.workers.dev";

export const CARRIERS = {
  aetna: {
    name: "Aetna",
    scope: "launch/patient patient/*.read",
    basic: true, // Aetna wants the client ID and secret as HTTP Basic on the token request
    covers: "Aetna's Patient Access API covers Medicare, Medicaid and some fully insured commercial plans. A self-funded employer plan can sign in fine and still return no claims.",
    // Production only. Aetna's sandbox (vteapif1.aetna.com/fhirdemo, test member VTETestUser01) was removed from the
    // app once production was approved; add it back here to test against synthetic data again.
    envs: {
      production: {
        label: "Production (your real Aetna claims)",
        authorize: "https://apif1.aetna.com/fhir/v1/fhirserver_auth/oauth2/authorize",
        token: "https://apif1.aetna.com/fhir/v1/fhirserver_auth/oauth2/token",
        fhir: "https://apif1.aetna.com/fhir/v2/patientaccess",
        aud: "https://apif1.aetna.com/fhir",
        extra: {},
      },
    },
  },
  medicare: {
    name: "Medicare",
    // claims and coverage only: HerePup's Blue Button app doesn't ask for demographics (name, address, birth date...)
    scope: "patient/ExplanationOfBenefit.read patient/Coverage.read",
    basic: true,
    askMember: true,  // no name comes back, so the member says whose Medicare it is before connecting
    noPatient: true,  // Patient isn't readable without demographics
    // A sign-in that names no beneficiary is almost always the Blue Button developer account still signed in in this browser.
    noPatientHint: "Medicare didn't say which beneficiary signed in. If you're signed in to Medicare's developer site (sandbox.bluebutton.cms.gov) in this browser, sign out of it, or use a private window, then connect again and sign in with a test beneficiary.",
    slash: true,      // Blue Button's resource paths end in "/"
    covers: "Covers people with Original Medicare (Parts A, B and D), including Part D drug claims. Medicare Advantage plans connect through their own insurer.",
    envs: {
      sandbox: {
        label: "Sandbox (Medicare test beneficiary, no real data)",
        authorize: "https://sandbox.bluebutton.cms.gov/v2/o/authorize/",
        token: "https://sandbox.bluebutton.cms.gov/v2/o/token/",
        fhir: "https://sandbox.bluebutton.cms.gov/v2/fhir",
        aud: "",
        extra: {},
        hint: "Medicare's sandbox test sign-ins: BBUser00001 / PW00001! (any of BBUser00000 to BBUser00029, with the matching PW number and !)",
      },
    },
  },
};

const SKEY = "herepup.connect", PKEY = "herepup.connect.pending", MODE = "herepup.connect-test"; // this browser
const TKEY = "herepup.connect.tokens", RKEY = "herepup.connect.return";                       // this tab only
const read = (store, k, d) => { try { const v = store.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const write = (store, k, v) => { try { if (v == null) store.removeItem(k); else store.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };

// Testing switch: ?connect=test turns the panel on in this browser, ?connect=off turns it off.
export function testMode() {
  try {
    const p = new URLSearchParams(location.search).get("connect");
    if (p === "test") localStorage.setItem(MODE, "1");
    if (p === "off") localStorage.removeItem(MODE);
    if (p) history.replaceState(null, "", location.pathname + location.hash);
    return localStorage.getItem(MODE) === "1";
  } catch (e) { return false; }
}

// The member's go-ahead before connecting (CARIN Code: clear, affirmative permission). Bump the date when the
// privacy policy's connection terms change, so people confirm again.
export const CONSENT_VERSION = "2026-10-22";

export const callbackUrl = () => location.origin + "/app/callback/";
export function settings(cid) { return read(localStorage, SKEY, {})[cid] || {}; }
export function saveSettings(cid, patch) {
  const all = read(localStorage, SKEY, {});
  all[cid] = { ...(all[cid] || {}), ...patch };
  write(localStorage, SKEY, all);
  return all[cid];
}
export function endpoints(cid, cfg = settings(cid)) {
  const c = CARRIERS[cid], env = cfg.env in c.envs ? cfg.env : Object.keys(c.envs)[0];
  const ep = { ...c.envs[env], env };
  for (const k of ["authorize", "token", "fhir", "aud"]) if (cfg[k]) ep[k] = cfg[k]; // overrides (testing against a stand-in)
  if (!ep.aud) ep.aud = ep.fhir;
  return ep;
}
export function connection(cid) {
  const t = read(sessionStorage, TKEY, {})[cid];
  return t && t.expires_at > Date.now() + 30000 ? t : null;
}
export function disconnect(cid) { const all = read(sessionStorage, TKEY, {}); delete all[cid]; write(sessionStorage, TKEY, all); }
export function forget() {
  for (const k of [SKEY, PKEY, MODE]) write(localStorage, k, null);
  for (const k of [TKEY, RKEY]) write(sessionStorage, k, null);
}
export const helperUrl = (cfg = {}) => String(cfg.helper || HELPER_URL).replace(/\/+$/, "");
const helperInfos = {};
// The helper's /health: which insurers it's set up for, with their public client IDs.
export function helperInfo(url) {
  if (!helperInfos[url]) helperInfos[url] = fetch(url + "/health", { credentials: "omit", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .catch((e) => { delete helperInfos[url]; throw e; });
  return helperInfos[url];
}
async function clientIdFor(cid, cfg, ep) {
  if (cfg.client_id) return cfg.client_id;
  const helper = helperUrl(cfg);
  if (!helper) return "";
  try { return (((await helperInfo(helper)).ready || {})[`${cid}:${ep.env}`] || {}).client_id || ""; } catch (e) { return ""; }
}
export const pendingCarrier = () => (read(localStorage, PKEY, null) || {}).cid || "";

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

// Send the browser to the insurer's sign-in page.
export async function start(cid) {
  const c = CARRIERS[cid], cfg = settings(cid), ep = endpoints(cid, cfg);
  if (cfg.consent !== CONSENT_VERSION) throw new Error(`Tick the box to confirm you want HerePup to read your claims and coverage from ${c.name} first.`);
  if (c.askMember && !cfg.member_id) throw new Error(`Choose whose ${c.name} account you're connecting first.`);
  const clientId = await clientIdFor(cid, cfg, ep);
  if (!clientId) throw new Error(helperUrl(cfg) ? `HerePup's sign-in helper isn't set up for ${c.name} ${ep.env} yet, or couldn't be reached. Try again in a minute.`
    : `Enter the client ID from the ${c.name} developer portal first (under App settings).`);
  if (!window.crypto || !crypto.subtle) throw new Error("This browser can't do a secure sign-in here. Open HerePup at https://herepup.health/app/.");
  const verifier = random(48), state = "hpw." + random(24);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  write(localStorage, PKEY, { state, verifier, cid, env: ep.env, redirect: callbackUrl(), client_id: clientId, t: Date.now() });
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: callbackUrl(), scope: c.scope, state,
    aud: ep.aud, code_challenge: challenge, code_challenge_method: "S256", ...(ep.extra || {}) });
  location.assign(ep.authorize + (ep.authorize.includes("?") ? "&" : "?") + q.toString().replace(/\+/g, "%20"));
}

// What /app/callback/ left for this tab: { code, state, error }.
export function takeReturn() { const r = read(sessionStorage, RKEY, null); write(sessionStorage, RKEY, null); return r; }

async function send(url, opts, what) {
  try { return await fetch(url, { ...opts, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }); }
  catch (e) {
    const err = new Error(`This browser couldn't reach ${what}. Either it doesn't allow direct browser connections yet (CORS), `
      + "or a browser extension or network blocked it. The desktop version can still connect.");
    err.blocked = true; throw err;
  }
}

// Claims reads: straight from the insurer when this browser is allowed to; otherwise through the helper's relay.
const relayed = {}; // cid:env -> true once a direct read was blocked on this page
async function helperRelays(cid, env, cfg) {
  const helper = helperUrl(cfg);
  if (!helper) return false;
  try { return ((await helperInfo(helper)).relay || []).includes(`${cid}:${env}`); } catch (e) { return false; }
}
async function fhirGet(cid, ep, cfg, url, token, what) {
  const key = `${cid}:${ep.env}`, c = CARRIERS[cid];
  if (!relayed[key]) {
    try {
      return await fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/fhir+json, application/json" },
        credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    } catch (e) {
      if (!(await helperRelays(cid, ep.env, cfg))) {
        const err = new Error(`${c.name}'s claims server doesn't accept connections from web pages, and HerePup's sign-in helper `
          + `can't pass them through yet. Download your claims from ${c.name} and drop the files in instead.`);
        err.blocked = true; throw err;
      }
      relayed[key] = true;
    }
  }
  return send(helperUrl(cfg) + "/fhir", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ carrier: cid, env: ep.env, url, token }) }, "HerePup's sign-in helper");
}

async function tokenRequest(cid, c, cfg, ep, form) {
  const helper = helperUrl(cfg);
  if (helper) { // the helper adds the secret and talks to the insurer; its reply is the insurer's own
    const r = await send(helper + "/token", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrier: cid, env: ep.env, ...form }) }, "HerePup's sign-in helper");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${c.name} refused the sign-in (${r.status}${j.error ? ", " + (j.error_description || j.error) : ""}).`
      + (r.status === 401 ? " The client ID or secret in the sign-in helper may not match this app." : ""));
    return j;
  }
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const body = new URLSearchParams(form);
  if (c.basic && cfg.client_secret) headers.Authorization = "Basic " + btoa(`${cfg.client_id}:${cfg.client_secret}`);
  else { body.set("client_id", cfg.client_id); if (cfg.client_secret) body.set("client_secret", cfg.client_secret); }
  const what = `${c.name}'s sign-in server`;
  let r = await send(ep.token, { method: "POST", headers, body }, what);
  if ((r.status === 400 || r.status === 401) && headers.Authorization) { // some servers want the credentials in the body instead
    delete headers.Authorization; body.set("client_id", cfg.client_id); body.set("client_secret", cfg.client_secret);
    r = await send(ep.token, { method: "POST", headers, body }, what);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${c.name} refused the sign-in code (${r.status}${j.error ? ", " + (j.error_description || j.error) : ""}). `
    + `Check the client ID${cfg.client_secret ? " and secret" : ""}, and that ${callbackUrl()} is registered as a callback URL.`);
  return j;
}

// Trade the code for an access token (kept in this tab only; it lasts about an hour).
export async function finish(ret) {
  const pend = read(localStorage, PKEY, null);
  write(localStorage, PKEY, null);
  if (!pend || pend.state !== ret.state || Date.now() - pend.t > 15 * 60000) throw new Error("That sign-in expired or didn't start in this browser. Press Connect again.");
  const cid = pend.cid, c = CARRIERS[cid];
  if (ret.error) throw new Error(`The ${c.name} sign-in didn't finish: ${ret.error}`);
  if (!ret.code) throw new Error(`${c.name} didn't send back a sign-in code. Press Connect again.`);
  const cfg = settings(cid), ep = endpoints(cid, { ...cfg, env: pend.env });
  const tok = await tokenRequest(cid, c, cfg, ep, { grant_type: "authorization_code", code: ret.code, redirect_uri: pend.redirect, code_verifier: pend.verifier });
  if (!tok.access_token) throw new Error(`${c.name} didn't return an access token.`);
  const rec = { access_token: tok.access_token, patient: tok.patient || "", env: pend.env, signed_at: Date.now(), expires_at: Date.now() + 1000 * Number(tok.expires_in || 3600) };
  const all = read(sessionStorage, TKEY, {}); all[cid] = rec; write(sessionStorage, TKEY, all);
  return { cid, ...rec };
}

// Which kind of record an address asks for (Patient, Coverage, ExplanationOfBenefit...), for messages.
function resourceName(url) {
  try { return new URL(url).pathname.split("/").filter(Boolean).find((p) => /^[A-Z][A-Za-z]+$/.test(p)) || "claims"; } catch (e) { return "claims"; }
}
// The insurer's own words for a refusal: a FHIR OperationOutcome, an OAuth error, an API-gateway fault, or short text.
async function refusalReason(r) {
  const www = r.headers.get("WWW-Authenticate") || "";
  let t = ""; try { t = (await r.text()).trim(); } catch (e) { /* no body */ }
  let why = "";
  try {
    const j = JSON.parse(t);
    why = (j.issue || []).map((i) => i.diagnostics || (i.details || {}).text || i.code).filter(Boolean).join("; ")
      || j.error_description || (typeof j.error === "string" ? j.error : "") || ((j.fault || {}).faultstring) || j.message || j.moreInformation || j.httpMessage || "";
  } catch (e) { if (t && !/^</.test(t)) why = t; }
  if (!why && www) why = www;
  return String(why).replace(/\s+/g, " ").slice(0, 200);
}

// Patient, Coverage and every page of ExplanationOfBenefit, plus referenced providers that weren't included.
export async function pull(cid, onProgress = () => {}) {
  const c = CARRIERS[cid], tok = connection(cid);
  if (!tok) throw new Error(`Connect to ${c.name} first. A sign-in lasts about an hour.`);
  const cfg = settings(cid), ep = endpoints(cid, { ...cfg, env: tok.env }), base = ep.fhir.replace(/\/+$/, "");
  const what = `${c.name}'s claims server`, notes = [];
  let count = 0;
  async function getAll(url, maxPages = 40) {
    const out = [];
    while (url && maxPages-- > 0) {
      const r = await fhirGet(cid, ep, cfg, url, tok.access_token, what);
      if (!r.ok) {
        const part = resourceName(url), why = await refusalReason(r);
        if (r.status === 401) {
          disconnect(cid);
          const mins = tok.signed_at ? Math.round((Date.now() - tok.signed_at) / 60000) : null;
          throw new Error(`${c.name} refused the request for ${part} (401${why ? `: ${why}` : ""}). `
            + `${mins != null ? `You signed in ${mins} minute${mins === 1 ? "" : "s"} ago. ` : ""}Press Connect, sign in again, and the claims are pulled right away.`);
        }
        const e = new Error(`${c.name} returned ${r.status} for ${part}${why ? `: ${why}` : "."}`); e.status = r.status; throw e;
      }
      const b = await r.json();
      if (b.resourceType === "Bundle") {
        const got = (b.entry || []).map((x) => x.resource).filter(Boolean);
        out.push(...got); count += got.length;
        url = ((b.link || []).find((l) => l.relation === "next") || {}).url || null;
      } else { out.push(b); count++; url = null; }
      onProgress(`Fetching from ${c.name}: ${count} record${count === 1 ? "" : "s"} so far...`);
    }
    return out;
  }
  const path = (p, q = "") => `${base}/${p}${c.slash ? "/" : ""}${q ? "?" + q : ""}`;
  const tolerant = async (url, max, label) => { try { return await getAll(url, max); } catch (e) { if (e.blocked || !e.status) throw e; notes.push(`${label}: ${e.message}`); return []; } };
  const pid = tok.patient, got = [];
  if (!pid && c.noPatientHint) { disconnect(cid); throw new Error(c.noPatientHint); }
  if (pid) {
    if (!c.noPatient) got.push(...await tolerant(path(`Patient/${encodeURIComponent(pid)}`), 1, "Member"));
    got.push(...await tolerant(path("Coverage", `beneficiary=${encodeURIComponent("Patient/" + pid)}`), 40, "Coverage"));
  }
  const eobs = await getAll(path("ExplanationOfBenefit", pid ? `patient=${encodeURIComponent(pid)}` : ""));
  got.push(...eobs);
  const have = new Set(got.map((r) => `${r.resourceType}/${r.id}`)), refs = new Set();
  for (const e of eobs) for (const ref of [e.provider, ...(e.careTeam || []).map((ct) => ct.provider)]) {
    const rr = (ref || {}).reference || "";
    if (/^(Practitioner|Organization)\//.test(rr) && !have.has(rr)) refs.add(rr);
  }
  for (const rr of [...refs].slice(0, 60)) got.push(...await tolerant(path(rr), 1, "Provider"));
  return { resources: got, eobs: eobs.filter((r) => r.resourceType === "ExplanationOfBenefit").length, env: tok.env, notes };
}

// What can this browser reach? Harmless requests shaped like the real ones (a made-up client, code and token), so
// the browser runs the same permission checks (CORS) it will need later. fhir: the claims server. token: the
// insurer's sign-in server, or with the helper, whether the helper answers and is set up for this insurer.
// relay: whether the helper can pass claims through when the claims server blocks this browser.
export async function check(cid) {
  const cfg = settings(cid), ep = endpoints(cid, cfg), helper = helperUrl(cfg);
  const base = { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" };
  const ok = (p) => p.then(() => true, () => false);
  const fhir = ok(fetch(ep.fhir.replace(/\/+$/, "") + "/metadata", { ...base, headers: { Accept: "application/fhir+json", Authorization: "Bearer check" } }));
  const token = helper
    ? helperInfo(helper).then((h) => (((h.ready || {})[`${cid}:${ep.env}`]) ? true : "not-set-up"), () => false)
    : ok(fetch(ep.token, { ...base, method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa("herepup-check:check") },
      body: "grant_type=authorization_code&code=check&redirect_uri=" + encodeURIComponent(callbackUrl()) }));
  const relay = helper ? helperRelays(cid, ep.env, cfg) : Promise.resolve(false);
  return { token: await token, fhir: await fhir, relay: await relay, helper: !!helper };
}

// On-device replacement for the desktop app's local server. Same request/response shapes, no network.
// State lives in this browser's localStorage (key herepup.v1) and can be erased with "Delete all my data".
import * as E from "./engine.js";
import * as R from "./readers.js";
import * as I from "./insights.js";
import * as T from "./timeline.js";
import * as Y from "./years.js";
import * as X from "./expected.js";

const KEY = "herepup.v1";
const TIERS = ["ee", "ee_sp", "ee_ch", "family"];
const empty = () => ({ household: { members: [] }, employers: [], claims: [], current_plan: null, observed: null, settings: {}, bill_checks: [] });
let mem = null, storageOk = true;
const uid = () => Math.random().toString(16).slice(2, 8);
const clone = (x) => JSON.parse(JSON.stringify(x));

function load() {
  if (mem) return mem;
  try { const s = localStorage.getItem(KEY); mem = s ? JSON.parse(s) : empty(); } catch (e) { storageOk = false; mem = empty(); }
  return mem;
}
function save(s) {
  mem = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { storageOk = false; }
}
export const storageWorks = () => { load(); return storageOk; };

const num = (v) => { const x = Number(v); return v == null || v === "" || Number.isNaN(x) ? 0 : x; };
function cleanPlan(p) {
  for (const k of ["deductible_ind", "deductible_fam", "oop_ind", "oop_fam", "coinsurance", "rx_deductible_ind", "rx_deductible_fam"]) p[k] = num(p[k]);
  if (p.coinsurance > 1) p.coinsurance = p.coinsurance / 100;
  const cp = {}; for (const [k, v] of Object.entries(p.copays || {})) if (v != null && v !== "") cp[k] = num(v); p.copays = cp;
  const rx = Array.isArray(p.rx_copays) ? p.rx_copays : [];
  p.rx_copays = rx.length && rx.every((v) => v != null && v !== "") ? rx.map(num) : [];
  // Drug tiers: a copay or a coinsurance share (0-1, entered as %) per tier, with optional min/max per fill.
  const opt = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const src = Array.isArray(p.rx_tiers) && p.rx_tiers.length ? p.rx_tiers : p.rx_copays.map((c) => ({ copay: c }));
  const tiers = src.map((t) => {
    t = t || {};
    let coins = opt(t.coins); if (coins != null && coins > 1) coins /= 100;
    return { copay: coins != null ? null : opt(t.copay), coins, min: opt(t.min), max: opt(t.max) };
  });
  while (tiers.length && tiers[tiers.length - 1].copay == null && tiers[tiers.length - 1].coins == null) tiers.pop();
  p.rx_tiers = tiers;
  p.rx_oop_ind = num(p.rx_oop_ind); p.rx_oop_fam = num(p.rx_oop_fam);
  p.flags = (p.flags || []).map(String);
  for (const k of ["premium_annual", "hsa_employer"]) { const d = p[k] && typeof p[k] === "object" ? p[k] : {}; p[k] = Object.fromEntries(TIERS.map((t) => [t, num(d[t])])); }
  // Headcount pricing: { "1": premium for employee + 1, "2": ..., "3": employee + 3 or more }. Empty when not used.
  const bc = p.premium_by_count && typeof p.premium_by_count === "object" ? p.premium_by_count : null;
  if (bc && Object.keys(bc).some((k) => /^[1-9]$/.test(k))) p.premium_by_count = Object.fromEntries(Object.keys(bc).filter((k) => /^[1-9]$/.test(k)).sort().map((k) => [k, num(bc[k])]));
  else delete p.premium_by_count;
  p.embedded = !!p.embedded;
  if (p.oop_embedded == null || p.oop_embedded === "") delete p.oop_embedded; else p.oop_embedded = !!p.oop_embedded;
}

function matchMember(name, members) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return "";
  for (const m of members) { const mn = m.name.trim().toLowerCase(); if (mn && (n === mn || n.includes(mn) || mn.includes(n))) return m.id; }
  return "";
}
function newPeople(rows) {
  const seen = [];
  for (const r of rows) { const n = (r.member || "").trim(); if (n && !r.member_id && !seen.some((x) => x.toLowerCase() === n.toLowerCase())) seen.push(n); }
  return seen;
}
const same = (a, b) => Math.abs(num(a) - num(b)) < 0.5;
function suggestPlan(obs, employers) {
  const hits = [];
  for (const e of employers) (e.plans || []).forEach((p, i) => {
    if (same(p.deductible_ind, obs.ded_ind) && same(p.deductible_fam, obs.ded_fam) && same(p.oop_ind, obs.oop_ind) && same(p.oop_fam, obs.oop_fam)) hits.push(`${e.id}:${i}`);
  });
  return hits.length === 1 ? hits[0] : "";
}

// Stop reading a scanned guide once every plan detail has been found (deductibles, premiums by level, Rx copays).
const guideComplete = (pages) => {
  const d = R.detectPlans(pages);
  return d.plans.length > 0 && d.notes.some((n) => n.startsWith("Premiums in the guide")) && d.plans.every((p) => p.rx_copays.length || (p.rx_tiers || []).length);
};
async function readDoc(file, onProgress, stopWhen = null) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return { pdf: true, ...(await R.pdfPages(file, onProgress, stopWhen)) };
  return { pdf: false, pages: [await file.text()], scanned_pages: 0, ocr_pages: 0, unreadable_pages: 0 };
}

export function kindFor(file, step) {
  const n = (file.name || "").toLowerCase();
  if (n.endsWith(".csv") || n.endsWith(".xlsx")) return "claims_csv";
  if (n.endsWith(".json")) return "fhir";
  if (n.endsWith(".xls")) return "xls";
  if (n.endsWith(".pdf") || n.endsWith(".txt")) return step === 1 ? "plan" : "eob";
  return "unknown";
}

export async function upload(file, kind, order = null, onProgress = () => {}) {
  const s = load();
  if (kind === "xls") throw new Error(`${file.name} is an older Excel format. Open it and save as .xlsx or .csv, then drop it again.`);
  if (kind === "unknown") throw new Error(`${file.name} isn't a file type HerePup reads. Use PDF, CSV, Excel (.xlsx) or FHIR JSON.`);
  if (kind === "plan") {
    const doc = await readDoc(file, onProgress, guideComplete);
    const det = R.detectPlans(doc.pages, file.name, doc.layout);
    if (doc.skipped_pages) det.notes.push(`This guide is scanned. HerePup stopped reading after it found every plan detail; the last ${doc.skipped_pages} page(s) were not needed.`);
    let message = "";
    if (!det.plans.length && R.parseCignaEob(doc.pages).rows.length) message = `${file.name} looks like an explanation of benefits, not a benefit guide. Add it on the Claims step.`;
    else if (doc.unreadable_pages && !det.plans.length) message = `${doc.unreadable_pages} scanned page(s) could not be read${doc.ocr_error ? ` (${doc.ocr_error})` : ""}. Type the plan numbers by hand instead.`;
    det.checks = R.checkPlans(det.plans, doc.pages);
    // pages: the guide's text, kept in memory for the checks' quotes and the "plans look like they're on page 8" view.
    return { kind, detected: det, pages: doc.pages, hints: R.planHints(doc.pages.join("\n")), message, scanned_pages: doc.scanned_pages, ocr_pages: doc.ocr_pages, unreadable_pages: doc.unreadable_pages };
  }
  let res;
  if (kind === "eob") {
    if (!(file.name || "").toLowerCase().endsWith(".pdf")) throw new Error(`${file.name}: explanations of benefits must be PDFs.`);
    const doc = await readDoc(file, onProgress);
    res = R.parseCignaEob(doc.pages);
    if (!res.rows.length) { const lab = R.parseLabeledEob(doc.pages); if (lab.rows.length) res = { ...lab, labeled_cards: true }; }
    if (!res.rows.length) {
      if (R.detectPlans(doc.pages, file.name).plans.length) throw new Error(`${file.name} looks like a benefit guide, not a claim. Add it on the Plan documents step.`);
      res = R.parseEobText(doc.pages.join("\n"), order);
      res.generic_reader = true;
      res.unreadable_pages = doc.unreadable_pages;
    }
    if (res.observed) { s.observed = res.observed; save(s); res.suggest_current_plan = suggestPlan(res.observed, s.employers); }
  } else if (kind === "claims_csv") {
    const recs = (file.name || "").toLowerCase().endsWith(".xlsx") ? await R.xlsxRecords(await file.arrayBuffer()) : R.csvRecords(await file.text());
    res = R.parseRecords(recs);
  } else if (kind === "fhir") {
    res = R.parseFhirText(await file.text());
  } else throw new Error("Unknown file type.");
  R.classifyRows(res.rows);
  for (const r of res.rows) { r.member_id = matchMember(r.member, s.household.members); r.source = r.source || file.name || ""; } // where each claim came from
  res.kind = kind;
  res.new_people = newPeople(res.rows);
  return res;
}

export function mergeReviews(list) {
  const out = { kind: list.length === 1 ? list[0].kind : "mixed", rows: [], notes: [], errors: [], unparsed_dated_lines: [], unreadable_pages: 0 };
  const ids = new Set();
  for (const r of list) {
    for (const row of r.rows || []) if (!ids.has(row.id)) { ids.add(row.id); out.rows.push(row); }
    for (const n of r.notes || []) if (!out.notes.includes(n)) out.notes.push(n);
    out.errors.push(...(r.errors || []));
    out.unparsed_dated_lines.push(...(r.unparsed_dated_lines || []));
    out.unreadable_pages += r.unreadable_pages || 0;
    if (r.observed) out.observed = r.observed;
    if (r.suggest_current_plan) out.suggest_current_plan = r.suggest_current_plan;
    if (r.generic_reader) out.generic_reader = true;
    if (r.coverage) out.coverage = (out.coverage || []).concat(r.coverage);
    out.skipped = (out.skipped || 0) + (r.kind === "fhir" ? r.skipped || 0 : 0);
  }
  out.new_people = newPeople(out.rows);
  return out;
}

function calibrateAll(s, employers, usable) {
  const cp = s.current_plan || {};
  const def = cp.employer ? `${cp.employer}:${cp.plan_index || 0}` : "";
  const groups = {};
  for (const c of usable) (groups[c.processed_under || def] ||= []).push(c);
  const members = s.household.members.map((m) => m.id);
  let merged = null;
  for (const [key, cl] of Object.entries(groups)) {
    if (!key.includes(":")) continue;
    const [eid, pi] = key.split(":");
    const plan = (employers.find((e) => e.id === eid) || { plans: [] }).plans[+pi];
    if (!plan) continue;
    for (const yearClaims of Y.byCalendarYear(cl)) { // each calendar year is its own plan year
      const r = E.calibrate(plan, yearClaims, members);
      if (!merged) { merged = r; continue; }
      merged.rows.push(...r.rows);
      merged.claims_checked += r.claims_checked; merged.flagged += r.flagged;
      for (const k of ["modeled_total", "actual_total", "total_gap"]) merged[k] = Math.round((merged[k] + r[k]) * 100) / 100;
    }
  }
  if (merged && merged.claims_checked) merged.mean_abs_error = Math.round(merged.rows.reduce((a, x) => a + Math.abs(x.diff), 0) / merged.claims_checked * 100) / 100;
  return merged;
}

// Every plan needs its HSA money confirmed (or confirmed as none) before an answer.
function hsaCheck(employers) {
  const miss = employers.flatMap((e) => e.plans.filter((pl) => !pl.hsa_checked).map((pl) => `${e.name}: ${pl.name}`));
  if (miss.length) { const err = new Error(`Confirm the employer HSA money for ${miss.join(", ")} first.`); err.code = "hsa"; throw err; }
}
// "Plans to consider": every plan, only HSA plans, or only plans without an HSA. Plan objects are kept as-is.
// The birth under each scenario: the best option and how the top options compare, plus what the birth adds to the
// option shown (premiums for adding the baby, and your share of the bills).
function expectedSummary(s, birth, res, basis, use, mult, countHsa) {
  const e = s.settings.expected, runs = X.SCENARIOS.map((sc, i) => {
    if (i === birth.info.scenario) return res;
    const b = X.addBirth(s.household, basis.sets, basis.window, e, i);
    return E.analyze(b.household, use, b.sets.length > 1 ? b.sets : b.sets[0], mult, countHsa);
  });
  const totals = runs.map((r) => new Map(r.ranked.map((x) => [x.label, x.total])));
  const labels = [];
  for (const r of runs) if (r.best && !labels.includes(r.best.label)) labels.push(r.best.label);
  for (const x of res.ranked) if (labels.length < 4 && !labels.includes(x.label)) labels.push(x.label);
  const rows = labels.slice(0, 4).map((label) => ({ label, totals: totals.map((m) => (m.has(label) ? m.get(label) : null)) }));
  // without the birth: the same option, same household as today
  const real = basis.sets.length > 1 ? basis.sets : basis.sets[0];
  const without = E.analyze(s.household, use, real, mult, countHsa);
  const before = without.ranked.find((x) => x.label === res.best.label) || null;
  const adds = before ? { total: Math.round((res.best.total - before.total) * 100) / 100, premium: Math.round((res.best.premium - before.premium) * 100) / 100,
    care: Math.round((res.best.member_cost - before.member_cost) * 100) / 100, hsa: Math.round((res.best.hsa_offset - before.hsa_offset) * 100) / 100 } : null;
  return { ready: true, ...birth.info, scenarios: X.SCENARIOS.map((sc, i) => ({ key: sc.key, label: sc.label, best: runs[i].best ? runs[i].best.label : "", total: runs[i].best ? runs[i].best.total : null })),
    rows, adds, without_best: without.best ? { label: without.best.label, total: without.best.total } : null, source: X.SOURCE };
}

const planTypes = (s) => ((s.settings || {}).plan_types === "hsa" || (s.settings || {}).plan_types === "non_hsa" ? s.settings.plan_types : "all");
function pickPlans(employers, pref) {
  if (pref === "all") return employers;
  const keep = (pl) => (pref === "hsa" ? !!pl.hsa_eligible : !pl.hsa_eligible);
  return employers.map((e) => ({ ...e, plans: e.plans.filter(keep) })).filter((e) => e.plans.length);
}

// ------------------------------------------------------------------ the "API"
export async function handle(method, path, body, file) {
  const s = load();
  const url = new URL(path, "http://local");
  const p = url.pathname;
  if (method === "GET" && p === "/api/state") return clone(s);
  if (method === "PUT" && p === "/api/household") {
    for (const m of body.members) { m.id ||= uid(); if (m.role !== "adult" && m.role !== "child") m.role = "adult"; }
    s.household = { members: body.members }; save(s); return clone(s.household);
  }
  if (method === "PUT" && p === "/api/employers") {
    for (const e of body.employers) { e.id ||= uid(); for (const pl of e.plans || []) cleanPlan(pl); }
    s.employers = body.employers;
    if ("current_plan" in body) s.current_plan = body.current_plan;
    save(s); return { employers: clone(s.employers), current_plan: s.current_plan };
  }
  if (method === "PUT" && p === "/api/settings") { s.settings = body || {}; save(s); return s.settings; }
  if (method === "PUT" && p === "/api/checks") { s.bill_checks = Array.isArray(body) ? body.slice(0, 200) : []; save(s); return s.bill_checks; }
  if (method === "POST" && p === "/api/upload") return upload(file, url.searchParams.get("kind"), url.searchParams.get("order") ? url.searchParams.get("order").split(",").map((x) => x.trim()) : null, body && body.onProgress);
  if (method === "POST" && p === "/api/claims/commit") {
    const clean = [];
    for (const r of body.rows) {
      if (!r.date || !r.member_id || r.skip) continue;
      clean.push({ id: r.id || uid(), date: r.date, member: r.member_id, provider: r.provider || "", category: r.category || "medical",
        billed: r.billed, allowed: r.allowed, plan_paid: r.plan_paid, member_resp: r.member_resp, rx_tier: r.rx_tier ?? null,
        copay: r.copay ?? null, deductible: r.deductible ?? null, coinsurance: r.coinsurance ?? null, service: r.service || "",
        type_source: r.type_source || "", place: r.place || "", source: r.source || "", processed_under: r.processed_under || "",
        proc: r.proc || "", rx_drug: r.rx_drug || "", pharmacy: r.pharmacy || "", rx_qty: r.rx_qty ?? null, payee: r.payee || "",
        network: r.network || "", provider_state: r.provider_state || "",
        added: r.added || new Date().toISOString().slice(0, 10) });
    }
    if (body.replace) s.claims = clean;
    else { const have = new Set(s.claims.map((c) => c.id)); s.claims.push(...clean.filter((c) => !have.has(c.id))); }
    save(s); return { saved: clean.length, total: s.claims.length };
  }
  if (method === "POST" && p === "/api/review/preview") {
    const claims = body.rows.filter((r) => r.date && r.member_id && !r.skip && r.allowed).map((r) => ({ id: r.id, date: r.date, member: r.member_id,
      provider: r.provider || "", category: r.category || "medical", allowed: r.allowed, rx_tier: r.rx_tier }));
    const ids = s.household.members.map((m) => m.id);
    const plans = [];
    for (const e of s.employers) (e.plans || []).forEach((pl, i) => {
      const sim = E.simulate(pl, claims, ids, 1);
      plans.push({ key: `${e.id}:${i}`, label: `${e.name}: ${pl.name || "plan"}`, total: Math.round(sim.member_cost * 100) / 100,
        lines: Object.fromEntries(sim.lines.map((l) => [l.id, { cost: l.member_cost, basis: l.basis }])) });
    });
    return { plans };
  }
  if (method === "POST" && p === "/api/analyze") {
    const mult = Number(body.multiplier ?? 1), countHsa = body.count_hsa !== false;
    const warnings = [];
    const employers = s.employers.filter((e) => (e.plans || []).length);
    if (!s.household.members.length) throw new Error("Add your household members first.");
    if (!employers.length) throw new Error("Add at least one employer plan first.");
    const usable = s.claims.filter((c) => c.allowed);
    if (s.claims.length - usable.length) warnings.push(`${s.claims.length - usable.length} claim(s) have no allowed amount and were left out.`);
    const exp = X.settingsOf((s.settings || {}).expected, s.household.members);
    if (!usable.length && !exp.ready) throw new Error(exp.on ? "Add the due month to plan around the birth, or add claims with allowed amounts." : "Add claims with allowed amounts first.");
    const basis = Y.select(usable, (s.settings || {}).basis); // which year of the history to plan around
    // Expecting a baby: the birth's usual bills (national averages) join your claims, and the baby joins the household
    const birth = exp.ready ? X.addBirth(s.household, basis.sets, basis.window, s.settings.expected) : null;
    const hh = birth ? birth.household : s.household, sets = birth ? birth.sets : basis.sets;
    const use_claims = sets.length > 1 ? sets : sets[0];
    const ids = new Set(s.household.members.map((m) => m.id));
    for (const e of employers) if (!ids.has(e.subscriber)) throw new Error(`Pick the household member who works at ${e.name}.`);
    hsaCheck(employers);
    const pref = planTypes(s), picked = pickPlans(employers, pref);
    if (pref !== "all" && !picked.length) warnings.push(`None of your plan options ${pref === "hsa" ? "come with an HSA" : "are without an HSA"}, so every plan is shown. Change "Plans to consider" if that's not right.`);
    const use = picked.length ? picked : employers;
    const res = E.analyze(hh, use, use_claims, mult, countHsa);
    res.plan_types = picked.length ? pref : "all";
    if (res.plan_types !== "all") { const all = E.analyze(hh, employers, use_claims, mult, countHsa).best; res.all_best = all ? { label: all.label, total: all.total } : null; }
    const unknown = use.flatMap((e) => e.plans.filter((pl) => pl.hsa_unknown).map((pl) => `${e.name}: ${pl.name}`));
    if (unknown.length) {
      const scenarios = [0, 1500, 3000].map((dep) => {
        const emps2 = clone(use);
        for (const e of emps2) for (const pl of e.plans) if (pl.hsa_unknown) pl.hsa_employer = { ee: dep / 3, ee_sp: dep / 3, ee_ch: dep / 3, family: dep };
        const r2 = E.analyze(hh, emps2, use_claims, mult, countHsa);
        return { family_deposit: dep, best: r2.best.label, total: r2.best.total };
      });
      res.hsa_sensitivity = { plans: unknown, scenarios };
    }
    res.warnings = warnings;
    res.break_even = E.breakEven(hh, use, use_claims, countHsa);
    const cal = calibrateAll(s, employers, usable);
    if (cal) res.calibration = cal;
    res.claims_used = basis.sets.reduce((a, x) => a + x.length, 0);
    res.has_claims = usable.length > 0;
    if (exp.on) res.expected = birth ? expectedSummary(s, birth, res, basis, use, mult, countHsa) : { ready: false };
    res.basis = { key: basis.key, label: basis.label, short: basis.short, options: basis.options, years: basis.years, note: basis.note || "" };
    const obs = s.observed;
    if (obs && obs.ded_fam_met) {
      const cutoff = obs.as_of || "9999";
      const seen = s.claims.filter((c) => c.date <= cutoff && c.category !== "rx").reduce((a, c) => a + num(c.member_resp), 0);
      if (obs.ded_fam_met - seen > 200) warnings.push(`Your carrier reported $${Math.round(obs.ded_fam_met).toLocaleString()} met toward the family deductible by ${cutoff}, but the medical claims you saved account for about $${Math.round(seen).toLocaleString()} of your cost share up to then. Add the rest of your medical claims; until then the answer understates your real medical use.`);
      res.observed = obs;
    }
    return res;
  }
  if (method === "POST" && p === "/api/timeline") {
    const employers = s.employers.filter((e) => (e.plans || []).length), usable = s.claims.filter((c) => c.allowed);
    const exp = X.settingsOf((s.settings || {}).expected, s.household.members);
    if (!s.household.members.length || !employers.length || (!usable.length && !exp.ready)) return { window: T.planWindow(usable), options: [], defaults: [] };
    const picked = pickPlans(employers, planTypes(s)), cp = s.current_plan || {};
    const current = cp.employer ? ((s.employers.find((e) => e.id === cp.employer) || { plans: [] }).plans[cp.plan_index || 0] || null) : null;
    const basis = Y.select(usable, (s.settings || {}).basis);
    const birth = exp.ready ? X.addBirth(s.household, basis.sets, basis.window, s.settings.expected) : null;
    const sets = birth ? birth.sets : basis.sets;
    const out = T.buildOptions(birth ? birth.household : s.household, picked.length ? picked : employers, sets.length > 1 ? sets : sets[0],
      { mult: Number(body.multiplier ?? 1), countHsa: body.count_hsa !== false, current, window: birth ? birth.window : basis.window });
    out.basis = { key: basis.key, short: usable.length ? basis.short : "", note: basis.note || "" };
    if (birth) out.expected = birth.info;
    return out;
  }
  if (method === "POST" && p === "/api/spending") {
    const all = s.claims.filter((c) => c.allowed);
    const basis = Y.select(all, (s.settings || {}).spend_basis, { forSpending: true }); // which claims to review
    const claims = basis.sets.flat(), n = basis.sets.length;
    const members = s.household.members;
    const cp = s.current_plan || {};
    const emp = cp.employer ? s.employers.find((e) => e.id === cp.employer) : null;
    const plan = emp ? (emp.plans || [])[cp.plan_index || 0] : null;
    const out = { summary: I.summarize(claims, members), comparisons: I.compareProviders(claims, members, plan), er: I.erVsUrgent(claims, members, plan),
      plan_label: plan ? `${emp.name}: ${plan.name}` : "" };
    if (n > 1) I.perYear(out, n); // an average year: every dollar amount divided by the number of years
    out.basis = { key: basis.key, label: basis.label, short: basis.short, options: basis.options, years: n, from: basis.from, to: basis.to };
    return out;
  }
  if (method === "DELETE" && p === "/api/data") { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } mem = empty(); return { deleted: true }; }
  throw new Error("Not available in the web version.");
}

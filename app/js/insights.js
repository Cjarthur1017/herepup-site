// Spending history and "same care, different provider" comparisons. Pure functions; runs on the device.
import { simulate } from "./engine.js";

const r2 = (x) => Math.round(x * 100) / 100;
const num = (v) => { const x = Number(v); return v == null || v === "" || Number.isNaN(x) ? 0 : x; };
export const CARE_LABEL = { medical: "Other medical", office: "Office visits", specialist: "Specialist visits", urgent: "Urgent care", er: "Emergency room",
  procedure: "Office procedures", preventive: "Preventive care", rx: "Prescriptions" };

// Drug identity for comparing fills: name + strength, without quantity, days supply or pharmacy.
export function drugKey(c) {
  let d = String(c.rx_drug || c.service || c.provider || "").toUpperCase();
  d = d.replace(/\(.*?\)/g, " ").replace(/QUANTITY:.*$/i, " ").replace(/DAYS SUPPLY:.*$/i, " ");
  return d.replace(/\s+/g, " ").trim();
}
export function pharmacyOf(c) {
  if (c.pharmacy) return c.pharmacy;
  const m = String(c.provider || "").match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : (c.provider || "Pharmacy");
}
function providerOf(c) { return c.category === "rx" ? pharmacyOf(c) : (String(c.payee || c.provider || "").trim() || "Unknown provider"); }

// Like-for-like key. Procedure code when the claim has one; otherwise care type plus service wording.
export function specialtyOf(c) {
  const m = String(c.type_source || "").match(/\(([^)]+)\)\s*$/) || String(c.type_source || "").match(/specialty:\s*([^,]+)/i);
  return m ? m[1].replace(/^taxonomy\s+/i, "").trim() : "";
}
export function likeKey(c) {
  if (c.category === "rx") return { key: "rx|" + drugKey(c), label: drugKey(c) || "Prescription", basis: "by the same drug and strength" };
  if (c.category === "urgent" || c.category === "er") return { key: c.category, label: CARE_LABEL[c.category], basis: "visit to visit" };
  if (c.category === "office" || c.category === "specialist") {
    const sp = c.category === "specialist" ? specialtyOf(c) : "";
    if (c.proc) return { key: `${c.category}|${sp}|${c.proc}`, label: `${CARE_LABEL[c.category]}${sp ? " (" + sp + ")" : ""}`, basis: `by the same visit code (${c.proc})` };
    return { key: `${c.category}|${sp}`, label: `${CARE_LABEL[c.category]}${sp ? " (" + sp + ")" : ""}`, basis: "by the same type of visit" };
  }
  if (c.proc) return { key: `proc|${c.proc}`, label: c.service || `Procedure ${c.proc}`, basis: `by the same procedure code (${c.proc})` };
  const s = String(c.service || "").toLowerCase().replace(/\s+/g, " ").trim();
  return s ? { key: `${c.category}|${s}`, label: `${CARE_LABEL[c.category] || "Care"}: ${c.service}`, basis: "by the same service description" } : null;
}

// One "visit" per person, provider, date and like-key (an ER trip billed as several lines counts once).
function visits(claims) {
  const out = new Map();
  for (const c of claims) {
    if (!num(c.allowed) || c.category === "preventive") continue;
    const lk = likeKey(c); if (!lk) continue;
    const prov = providerOf(c);
    const id = c.category === "rx" ? `rx|${c.id}` : `${lk.key}|${c.member}|${prov}|${c.date}`;
    let v = out.get(id);
    if (!v) { v = { id, lk, provider: prov, member: c.member, date: c.date, allowed: 0, paid: 0, qty: num(c.rx_qty) || null, claims: [] }; out.set(id, v); }
    v.allowed += num(c.allowed); v.paid += num(c.member_resp); v.claims.push(c);
  }
  return [...out.values()];
}

export function summarize(claims, members) {
  const name = (id) => (members.find((m) => m.id === id) || {}).name || id;
  const byType = {}, byPerson = {}, byProvider = {};
  let allowed = 0, paid = 0, planPaid = 0;
  for (const c of claims) {
    const a = num(c.allowed), p = num(c.member_resp), pp = c.plan_paid != null && c.plan_paid !== "" ? num(c.plan_paid) : Math.max(0, a - p);
    allowed += a; paid += p; planPaid += pp;
    const t = (byType[c.category] ||= { type: c.category, label: CARE_LABEL[c.category] || c.category, count: 0, allowed: 0, paid: 0 });
    t.count++; t.allowed += a; t.paid += p;
    const pr = (byPerson[c.member] ||= { member: name(c.member), count: 0, allowed: 0, paid: 0 });
    pr.count++; pr.allowed += a; pr.paid += p;
    const pv = providerOf(c);
    const v = (byProvider[pv] ||= { provider: pv, count: 0, allowed: 0, paid: 0, types: new Set() });
    v.count++; v.allowed += a; v.paid += p; v.types.add(CARE_LABEL[c.category] || c.category);
  }
  const fix = (o) => Object.values(o).map((x) => ({ ...x, allowed: r2(x.allowed), paid: r2(x.paid), ...(x.types ? { types: [...x.types].join(", ") } : {}) })).sort((a, b) => b.allowed - a.allowed);
  const dates = claims.map((c) => c.date).filter(Boolean).sort();
  return { claims: claims.length, allowed: r2(allowed), paid: r2(paid), plan_paid: r2(planPaid), from: dates[0] || "", to: dates[dates.length - 1] || "",
    by_type: fix(byType), by_person: fix(byPerson), by_provider: fix(byProvider).slice(0, 10) };
}

// For each like-for-like group seen at 2+ providers: what would the same care have cost at the lowest-cost one?
// plan (optional): re-run the year under it to estimate what you personally would have saved.
export function compareProviders(claims, members, plan = null) {
  const vs = visits(claims);
  const groups = new Map();
  for (const v of vs) { const g = groups.get(v.lk.key) || { lk: v.lk, visits: [] }; g.visits.push(v); groups.set(v.lk.key, g); }
  const ids = members.map((m) => m.id);
  const baseline = plan ? simulate(plan, claims, ids, 1).member_cost : null;
  const results = [];
  for (const g of groups.values()) {
    const isRx = g.lk.key.startsWith("rx|");
    const unit = (v) => (isRx && v.qty ? v.allowed / v.qty : v.allowed);
    const provs = new Map();
    for (const v of g.visits) { const p = provs.get(v.provider) || { provider: v.provider, visits: 0, allowed: 0, paid: 0, units: [] }; p.visits++; p.allowed += v.allowed; p.paid += v.paid; p.units.push(unit(v)); provs.set(v.provider, p); }
    if (provs.size < 2) continue;
    if (isRx && g.visits.some((v) => !v.qty) && new Set(g.visits.map((v) => v.qty)).size > 1) continue; // can't compare fills of unknown size
    const list = [...provs.values()].map((p) => ({ provider: p.provider, visits: p.visits, avg: r2(p.units.reduce((a, b) => a + b, 0) / p.units.length), allowed: r2(p.allowed), paid: r2(p.paid) }))
      .sort((a, b) => a.avg - b.avg);
    const best = list[0];
    // what the visits at pricier providers would have cost at the lowest-cost one
    let careSaving = 0;
    const scaled = new Map();
    for (const v of g.visits) {
      if (v.provider === best.provider) continue;
      const target = isRx && v.qty ? best.avg * v.qty : best.avg;
      if (v.allowed <= target) continue;
      careSaving += v.allowed - target;
      const f = target / v.allowed;
      for (const c of v.claims) scaled.set(c.id, f);
    }
    let youSave = null;
    if (plan && scaled.size) {
      const alt = claims.map((c) => (scaled.has(c.id) ? { ...c, allowed: num(c.allowed) * scaled.get(c.id) } : c));
      youSave = r2(baseline - simulate(plan, alt, ids, 1).member_cost);
    }
    if (careSaving < 1) continue;
    results.push({ key: g.lk.key, label: g.lk.label, basis: g.lk.basis, rx: isRx, per: isRx && g.visits.every((v) => v.qty) ? "per unit" : "per visit",
      providers: list, cheapest: best.provider, care_saving: r2(careSaving), you_save: youSave,
      spread: r2(list[list.length - 1].avg - best.avg), visits: g.visits.length });
  }
  results.sort((a, b) => (b.you_save ?? b.care_saving) - (a.you_save ?? a.care_saving) || b.care_saving - a.care_saving);
  return results;
}

// ER visits that might have been handled at urgent care: compare against the household's own urgent care visits.
export function erVsUrgent(claims, members, plan = null) {
  const vs = visits(claims);
  const er = vs.filter((v) => v.lk.key.startsWith("er")), uc = vs.filter((v) => v.lk.key.startsWith("urgent"));
  if (!er.length || !uc.length) return null;
  const ucAvg = uc.reduce((a, v) => a + v.allowed, 0) / uc.length;
  const erAvg = er.reduce((a, v) => a + v.allowed, 0) / er.length;
  if (erAvg <= ucAvg) return null;
  let youSave = null;
  if (plan) {
    const ids = members.map((m) => m.id), f = new Map();
    for (const v of er) for (const c of v.claims) f.set(c.id, ucAvg / v.allowed);
    const alt = claims.map((c) => (f.has(c.id) ? { ...c, allowed: num(c.allowed) * f.get(c.id), category: "urgent" } : c));
    youSave = r2(simulate(plan, claims, ids, 1).member_cost - simulate(plan, alt, ids, 1).member_cost);
  }
  return { er_visits: er.length, er_avg: r2(erAvg), urgent_visits: uc.length, urgent_avg: r2(ucAvg), per_visit_gap: r2(erAvg - ucAvg), you_save_all: youSave };
}

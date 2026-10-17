// Month by month: when premiums, your share of care and employer HSA money land through the year.
// Pure functions (no DOM); runs on the device. The drawing lives in timeline-view.js.
import { simulate, enumerateConfigs, effectiveCost, analyze, labelConfig } from "./engine.js";

export const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const num = (v) => { const x = Number(v); return v == null || v === "" || Number.isNaN(x) ? 0 : x; };
const r2 = (x) => Math.round(x * 100) / 100;

// The 12 months to show. One calendar year of claims -> January to December of that year.
// Claims that cross a year end but fit in 12 months -> the 12 months starting with the first claim.
// More than 12 months -> shown by calendar month (the year total treats them as one plan year too).
export function planWindow(claims) {
  const ds = claims.map((c) => c.date).filter((d) => /^\d{4}-\d{2}/.test(d || "")).sort();
  if (!ds.length) return { y: new Date().getFullYear(), m: 0, folded: false };
  const [fy, fm] = ds[0].split("-").map(Number), [ly, lm] = ds[ds.length - 1].split("-").map(Number);
  if (fy === ly) return { y: fy, m: 0, folded: false };
  if ((ly - fy) * 12 + (lm - fm) + 1 <= 12) return { y: fy, m: fm - 1, folded: false };
  return { y: ly, m: 0, folded: true };
}
export function monthsOf(w) {
  return Array.from({ length: 12 }, (_, i) => {
    const t = w.m + i, y = w.y + Math.floor(t / 12), m = t % 12;
    const long = LONG[m] + (w.m ? " " + y : "");
    return { y, m, short: LONG[m].slice(0, 3), long, name: LONG[m] };
  });
}
export function monthIndex(w, date) {
  const [y, m] = String(date).split("-").map(Number);
  const i = w.folded ? m - 1 : (y - w.y) * 12 + (m - 1) - w.m;
  return Math.min(11, Math.max(0, i));
}

// Paychecks in each of the 12 months: 12 or 24 a year are even; every two weeks (26) and weekly (52)
// count actual paydays, starting on the first Friday of the first month.
export function checksPerMonth(w, perYear) {
  if (perYear !== 26 && perYear !== 52) return Array(12).fill(perYear / 12);
  const c = Array(12).fill(0), step = perYear === 26 ? 14 : 7;
  let d = new Date(w.y, w.m, 1);
  while (d.getDay() !== 5) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  for (let k = 0; k < perYear; k++) {
    const i = (d.getFullYear() - w.y) * 12 + d.getMonth() - w.m;
    c[Math.min(11, Math.max(0, i))]++;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step);
  }
  return c;
}

const shortName = (p) => String(p || "Plan").replace(/\s+plan$/i, "").trim() || "Plan";

// Every "everyone on one employer's plan" option, plus the best split when the answer is a split.
export function buildOptions(household, employers, claims, { mult = 1, countHsa = true, current = null } = {}) {
  const members = household.members, name = (id) => (members.find((m) => m.id === id) || {}).name || id;
  const byId = new Map(claims.map((c) => [c.id, c]));
  const configs = enumerateConfigs(household, employers);
  const best = analyze(household, employers, claims, mult, countHsa).best;
  const same = (cfg, r) => r && labelConfig(cfg) === r.label && JSON.stringify(cfg.assignment) === JSON.stringify(r.assignment);
  const bases = employers.flatMap((e) => e.plans.map((p) => shortName(p.name)));
  const dupes = new Set(bases.filter((b, i) => bases.indexOf(b) !== i));

  function build(cfg, key, short) {
    let premium = 0, hsa = 0;
    const lines = [], parts = [];
    for (const p of cfg.parts) {
      const sim = simulate(p.plan, claims, p.covered, mult);
      const eff = effectiveCost(p.plan, p.tier, sim.member_cost, countHsa);
      premium += eff.premium; hsa += eff.hsa_offset;
      parts.push({ employer: p.employer_name, plan: p.plan.name || "plan", who: p.covered.map(name), tier: p.tier,
        ded_ind: num(p.plan.deductible_ind), ded_fam: p.plan.deductible_fam == null ? num(p.plan.deductible_ind) : num(p.plan.deductible_fam),
        premium: r2(eff.premium), hsa: r2(eff.hsa_offset) });
      for (const l of sim.lines) {
        const c = byId.get(l.id) || {};
        lines.push({ date: l.date, who: name(l.member), service: c.service || c.rx_drug || c.provider || "Care", provider: c.provider || "",
          allowed: l.allowed, cost: l.member_cost, basis: l.basis });
      }
    }
    lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const single = cfg.parts.length === 1;
    const cur = single && current && cfg.parts[0].employer === current.employer && cfg.parts[0].plan_index === Number(current.plan_index || 0);
    return { key, short, label: labelConfig(cfg), split: !single, pick: same(cfg, best), current: !!cur,
      premium: r2(premium), hsa: r2(hsa), parts, lines };
  }

  const options = [];
  if (best && best.kind === "split") {
    const cfg = configs.find((c) => same(c, best));
    if (cfg) options.push(build(cfg, "split", "Best split"));
  }
  for (const e of employers) e.plans.forEach((p, pi) => {
    const cfg = configs.find((c) => c.parts.length === 1 && c.parts[0].employer === e.id && c.parts[0].plan_index === pi);
    if (!cfg) return;
    const base = shortName(p.name);
    options.push(build(cfg, `${e.id}:${pi}`, dupes.has(base) ? `${base} (${e.name.replace(/[,.]?\s+(Inc|Co|LLC|Corp|Ltd|Company)\.?$/i, "")})` : base));
  });

  // Start with HerePup's pick and the plan you're on now, then add the steadiest contrast:
  // the lowest-deductible option not already shown. Up to three.
  const defaults = [];
  const add = (o) => { if (o && !defaults.includes(o.key) && defaults.length < 3) defaults.push(o.key); };
  add(options.find((o) => o.pick)); add(options.find((o) => o.current));
  const singles = options.filter((o) => !o.split).sort((a, b) => a.parts[0].ded_fam - b.parts[0].ded_fam || b.premium - a.premium);
  add(singles.find((o) => !defaults.includes(o.key)));
  const net = (o) => o.premium + o.lines.reduce((a, l) => a + l.cost, 0) - o.hsa;
  for (const o of [...options].sort((a, b) => net(a) - net(b))) add(o);
  return { window: planWindow(claims), options, defaults };
}

// Month-by-month amounts for one option. pay = paychecks a year; hsaTiming = "spread" (each paycheck) or "start" (all in month 1).
export function series(o, w, pay = 24, hsaTiming = "spread") {
  const checks = checksPerMonth(w, pay);
  const premium = checks.map((k) => (o.premium / pay) * k);
  const hsa = hsaTiming === "start" ? checks.map((_, i) => (i === 0 ? o.hsa : 0)) : checks.map((k) => (o.hsa / pay) * k);
  const care = Array(12).fill(0), why = Array.from({ length: 12 }, () => []);
  for (const l of o.lines) { const i = monthIndex(w, l.date); care[i] += l.cost; if (l.allowed > 0) why[i].push(l); }
  const month = care.map((c, i) => ({ premium: premium[i], care: c, hsa: hsa[i], net: premium[i] + c - hsa[i] }));
  let p = 0, c = 0, h = 0;
  const cum = month.map((x) => { p += x.premium; c += x.care; h += x.hsa; return { premium: p, care: c, hsa: h, net: p + c - h }; });
  return { month, cum, why };
}

// Money to set aside: if you budgeted the option's average monthly cost, the furthest behind you'd fall
// before later months catch up. Assumes nothing saved at the start of the year.
export function setAside(s) {
  const avg = s.cum[11].net / 12;
  let amount = 0, at = -1;
  s.cum.forEach((x, i) => { const behind = x.net - avg * (i + 1); if (behind > amount + 0.005) { amount = behind; at = i; } });
  // the months that did it: the biggest care months up to that point
  const big = at < 0 ? [] : s.month.slice(0, at + 1).map((x, i) => ({ i, care: x.care })).filter((x) => x.care > avg * 0.5 && x.care >= amount * 0.2)
    .sort((a, b) => b.care - a.care).slice(0, 2).sort((a, b) => a.i - b.i).map((x) => x.i);
  return { amount, rounded: amount < 25 ? 0 : Math.ceil(amount / 50) * 50, at, avg, months: big };
}

// Headline facts for the year view, with the default settings (24 paychecks, HSA spread over paychecks).
export function quickFacts(o, w) {
  const s = series(o, w), ms = monthsOf(w);
  const nets = s.month.map((x) => x.net), pk = nets.indexOf(Math.max(...nets));
  const sa = setAside(s);
  return { peak: nets[pk], peakMonth: ms[pk].long, setAside: sa.rounded, setAsideBy: sa.at >= 0 ? ms[sa.at].long : "" };
}

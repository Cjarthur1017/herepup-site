// Which year of your claims history to plan around (Your answer) or to review (Your spending).
// Pure functions, no DOM. A "year" is a calendar year by date of service; "most recent 12 months" is the 12 calendar
// months ending with the month of your latest claim. An average runs each full year as its own plan year
// (deductibles reset every January) and averages the results, so one big year doesn't get spread thin.
"use strict";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (v) => { const x = Number(v); return v == null || v === "" || Number.isNaN(x) ? 0 : x; };
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
const dated = (c) => /^\d{4}-\d{2}/.test(String(c.date || ""));
const ym = (y, m) => `${MON[m - 1]} ${y}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// The years in a claims history. A first or last year whose claims start after March or end before October is
// marked partial: it probably doesn't cover the whole year, so it's left out of highest, lowest and average.
export function history(claims) {
  const ds = claims.filter(dated).map((c) => String(c.date).slice(0, 10)).sort();
  if (!ds.length) return { years: [], first: "", last: "", months: 0 };
  const first = ds[0], last = ds[ds.length - 1];
  const fy = +first.slice(0, 4), fm = +first.slice(5, 7), ly = +last.slice(0, 4), lm = +last.slice(5, 7);
  const years = [];
  for (let y = fy; y <= ly; y++) {
    const cl = claims.filter((c) => dated(c) && +String(c.date).slice(0, 4) === y);
    const from = y === fy ? fm : 1, to = y === ly ? lm : 12;
    years.push({ year: y, claims: cl, count: cl.length, allowed: cl.reduce((a, c) => a + num(c.allowed), 0), from, to,
      partial: (y === fy && fm >= 4) || (y === ly && lm <= 9) });
  }
  return { years, first, last, months: (ly - fy) * 12 + (lm - fm) + 1 };
}

// The 12 calendar months ending with the latest claim's month.
function recent(h) {
  let y = +h.last.slice(0, 4), m = +h.last.slice(5, 7) - 11;
  if (m < 1) { m += 12; y -= 1; }
  return { y, m, start: `${y}-${String(m).padStart(2, "0")}-01`, label: `${ym(y, m)} to ${ym(+h.last.slice(0, 4), +h.last.slice(5, 7))}` };
}

// The choices for this history. forSpending adds "all years". Empty when there's 12 months or less: nothing to pick.
export function options(claims, { forSpending = false } = {}) {
  const h = history(claims);
  if (h.months <= 12) return [];
  const full = h.years.filter((y) => !y.partial && y.count);
  const r = recent(h);
  const list = [{ key: "recent", label: `Most recent 12 months (${r.label})` }];
  if (full.length >= 2) {
    const hi = full.reduce((a, b) => (b.allowed > a.allowed ? b : a)), lo = full.reduce((a, b) => (b.allowed < a.allowed ? b : a));
    list.push({ key: "high", label: `Your highest year: ${hi.year} (${usd(hi.allowed)} of care)` });
    list.push({ key: "low", label: `Your lowest year: ${lo.year} (${usd(lo.allowed)} of care)` });
    list.push({ key: "avg", label: `An average of your ${full.length} full years (${full[0].year} to ${full[full.length - 1].year})` });
  }
  if (forSpending) list.push({ key: "all", label: `All your claims (${ym(+h.first.slice(0, 4), +h.first.slice(5, 7))} to ${ym(+h.last.slice(0, 4), +h.last.slice(5, 7))})` });
  for (const y of [...h.years].reverse()) if (y.count)
    list.push({ key: "y" + y.year, label: `${y.year}${y.partial ? ` (${MON[y.from - 1]} to ${MON[y.to - 1]} only)` : ""}: ${usd(y.allowed)} of care, ${plural(y.count, "claim")}` });
  return list;
}

// The claims for a choice. sets: one list of claims per plan year (several only for an average).
// window: the 12 months the month-by-month view should show. Unknown or unavailable choices fall back to recent.
export function select(claims, key, { forSpending = false } = {}) {
  const h = history(claims), opts = options(claims, { forSpending });
  if (!opts.length) {
    return { key: "all", sets: [claims], short: "your claims history", label: "", options: [], years: 1, window: null, from: h.first, to: h.last };
  }
  const k = opts.some((o) => o.key === key) ? key : "recent";
  const full = h.years.filter((y) => !y.partial && y.count);
  const one = (y, short) => ({ sets: [y.claims], short, window: { y: y.year, m: 0, folded: false }, years: 1,
    from: `${y.year}-${String(y.from).padStart(2, "0")}`, to: `${y.year}-${String(y.to).padStart(2, "0")}` });
  let out;
  if (k === "recent") {
    const r = recent(h);
    out = { sets: [claims.filter((c) => dated(c) && String(c.date).slice(0, 10) >= r.start)], short: "your most recent 12 months",
      window: { y: r.y, m: r.m - 1, folded: false }, years: 1, from: r.start.slice(0, 7), to: h.last.slice(0, 7) };
  } else if (k === "high" || k === "low") {
    const y = full.reduce((a, b) => (k === "high" ? (b.allowed > a.allowed ? b : a) : (b.allowed < a.allowed ? b : a)));
    out = one(y, `your ${k === "high" ? "highest" : "lowest"} year (${y.year})`);
  } else if (k === "avg") {
    out = { sets: full.map((y) => y.claims), short: `an average of your ${full.length} full years`, years: full.length,
      window: { y: full[full.length - 1].year, m: 0, folded: true }, from: `${full[0].year}-01`, to: `${full[full.length - 1].year}-12`,
      note: `Averaged over ${full.length} full years (${full[0].year} to ${full[full.length - 1].year}). Each year is run as its own plan year, so deductibles reset every January, and the results are averaged.` };
  } else if (k === "all") {
    out = { sets: [claims.filter(dated)], short: "all your claims", window: null, years: 1, from: h.first.slice(0, 7), to: h.last.slice(0, 7) };
  } else {
    const y = h.years.find((x) => "y" + x.year === k);
    out = one(y, String(y.year));
  }
  return { key: k, label: opts.find((o) => o.key === k).label, options: opts, ...out };
}

// Split claims by calendar year (for re-running real history: each year is its own plan year).
export function byCalendarYear(claims) {
  const g = new Map();
  for (const c of claims) { const y = dated(c) ? String(c.date).slice(0, 4) : ""; if (!g.has(y)) g.set(y, []); g.get(y).push(c); }
  return [...g.values()];
}

// Expected care: what a coming birth is likely to cost, as the dated bills it usually produces, so each plan's
// deductible, copays and out-of-pocket maximum apply to it the way they would to real claims.
// Pure functions, no DOM. Runs on the device; nothing about a pregnancy is ever sent anywhere.
//
// Amounts are national averages for people on employer plans: Peterson-KFF Health System Tracker, "Health costs
// associated with pregnancy, childbirth, and infant care" (Sept 2025; MarketScan claims, 2021 to 2023):
//   vaginal birth $15,712 in all; C-section $28,998; newborn's first 3 months $5,820;
//   a toddler's care by 18 to 24 months: $14,268 without a NICU stay, $77,992 with one.
// We split each total into the bills an episode usually has (prenatal visits, ultrasounds, labs, the hospital,
// the delivering doctor, anesthesia, the baby's stay, well-baby visits). The split is our estimate; the totals match.
import { planWindow, monthIndex } from "./timeline.js";

export const SOURCE = {
  label: "Peterson-KFF Health System Tracker (Sept 2025)",
  url: "https://www.healthsystemtracker.org/brief/health-costs-associated-with-pregnancy-childbirth-and-postpartum-care",
};
export const SCENARIOS = [
  { key: "typical", label: "Typical birth", short: "a typical birth" },
  { key: "csection", label: "C-section", short: "a C-section" },
  { key: "nicu", label: "NICU stay", short: "a birth with a NICU stay" },
];
export const BABY_ID = "expected-baby";
export const PRICE = { min: 60, max: 160 }; // "Prices where you'll deliver", % of the national average

// at: months from the due month (0 = the month of the birth). who: mother or baby. Categories as on claims.
const PRENATAL = [
  ...[-7, -6, -5, -4, -3, -2, -2, -1, -1, -1].map((at) => ({ at, who: "mother", category: "preventive", allowed: 150, label: "Prenatal visit" })),
  { at: -7, who: "mother", category: "medical", allowed: 350, label: "First-trimester ultrasound" },
  { at: -4, who: "mother", category: "medical", allowed: 450, label: "Anatomy ultrasound" },
  { at: -1, who: "mother", category: "medical", allowed: 250, label: "Late ultrasound" },
  { at: -7, who: "mother", category: "medical", allowed: 500, label: "Prenatal lab tests" },
  { at: -3, who: "mother", category: "medical", allowed: 150, label: "Glucose screening" },
  { at: -1, who: "mother", category: "medical", allowed: 250, label: "Late-pregnancy lab tests" },
];
const VAGINAL = [
  { at: 0, who: "mother", category: "medical", allowed: 8300, label: "Hospital stay for the birth" },
  { at: 0, who: "mother", category: "medical", allowed: 2600, label: "Delivering doctor or midwife" },
  { at: 0, who: "mother", category: "medical", allowed: 1100, label: "Anesthesia for the birth" },
  { at: 1, who: "mother", category: "preventive", allowed: 250, label: "Postpartum visit" },
];
const CSECTION = [
  { at: 0, who: "mother", category: "medical", allowed: 18800, label: "Hospital stay for the C-section" },
  { at: 0, who: "mother", category: "medical", allowed: 4300, label: "Surgeon for the C-section" },
  { at: 0, who: "mother", category: "medical", allowed: 1700, label: "Anesthesia for the C-section" },
  { at: 1, who: "mother", category: "preventive", allowed: 250, label: "Postpartum visit" },
  { at: 1, who: "mother", category: "office", allowed: 500, label: "Incision check" },
];
const NEWBORN_STAY = { at: 0, who: "baby", category: "medical", allowed: 3600, label: "Hospital stay after birth" };
const NICU = [
  { at: 0, who: "baby", category: "medical", allowed: 66000, label: "NICU stay" },
  ...[1, 2, 4].map((at) => ({ at, who: "baby", category: "specialist", allowed: 350, label: "NICU follow-up visit" })),
];
const BABY = [
  { at: 0, who: "baby", category: "medical", allowed: 400, label: "Pediatrician in the hospital" },
  { at: 0, who: "baby", category: "preventive", allowed: 300, label: "Newborn screening and hearing test" },
  { at: 0, who: "baby", category: "preventive", allowed: 200, label: "First well-baby visit" },
  { at: 1, who: "baby", category: "preventive", allowed: 250, label: "1-month well-baby visit" },
  { at: 2, who: "baby", category: "preventive", allowed: 250, label: "2-month well-baby visit" },
  { at: 2, who: "baby", category: "preventive", allowed: 570, label: "2-month vaccines" },
  { at: 2, who: "baby", category: "office", allowed: 250, label: "Sick visit" },
  ...[4, 6, 9, 12].map((at) => ({ at, who: "baby", category: "preventive", allowed: 450, label: `${at}-month well-baby visit and vaccines` })),
  ...[3, 5, 7, 8, 10].map((at) => ({ at, who: "baby", category: "office", allowed: 200, label: "Sick visit" })),
  { at: 11, who: "baby", category: "urgent", allowed: 300, label: "Urgent care visit" },
  { at: 6, who: "baby", category: "specialist", allowed: 350, label: "Specialist visit" },
];

// The bills for one scenario (0 typical, 1 C-section, 2 NICU), at a price level (1 = the national average).
export function birthBills(scenario = 0, price = 1) {
  const sc = Math.min(2, Math.max(0, Math.round(Number(scenario) || 0)));
  const p = Math.min(PRICE.max, Math.max(PRICE.min, Math.round((Number(price) || 1) * 100))) / 100;
  const list = [...PRENATAL, ...(sc === 1 ? CSECTION : VAGINAL), ...(sc === 2 ? NICU : [NEWBORN_STAY]), ...BABY];
  return list.map((b) => ({ ...b, allowed: Math.round(b.allowed * p) }));
}

// The plan year to plan for: next year from September on (open enrollment season), otherwise this one.
export function defaultYear(now = new Date()) { return now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear(); }

// Settings as saved, filled in and checked. ready: enough to add the birth (a due month and who's pregnant).
export function settingsOf(raw, members, now = new Date()) {
  const e = raw || {};
  const adults = (members || []).filter((m) => m.role === "adult");
  const mother = adults.some((m) => m.id === e.mother) ? e.mother : (adults[0] || {}).id || "";
  const due = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(e.due || "")) ? e.due : "";
  const year = Number(e.year) || defaultYear(now);
  const scenario = Math.min(2, Math.max(0, Math.round(Number(e.scenario) || 0)));
  const price = Math.min(PRICE.max, Math.max(PRICE.min, Math.round((Number(e.price) || 1) * 100))) / 100;
  return { on: !!e.on, due, mother, year, scenario, price, baby: String(e.baby || "").trim() || "Baby", ready: !!(e.on && due && mother) };
}

const pad = (n) => String(n).padStart(2, "0");
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (ym) => (/^\d{4}-\d{2}$/.test(ym || "") ? `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : "");

// Add the birth to the claims HerePup plans around.
// sets: one claims list per plan year (several for an average); window: the 12 months those claims cover (or null).
// Your claims keep their order and amounts, laid out as the plan year (the first month of the window becomes January),
// so the expected bills land in their real months next to them. The baby joins the household from the birth month.
// Returns null when the settings aren't ready.
export function addBirth(household, sets, window, raw, scenario = null, now = new Date()) {
  const e = settingsOf(raw, household.members, now);
  if (!e.ready) return null;
  const sc = scenario == null ? e.scenario : scenario;
  const [dy, dm] = e.due.split("-").map(Number);
  const born = (dy - e.year) * 12 + dm; // plan month of the birth; below 1 = before this plan year, above 12 = after
  const bills = birthBills(sc, e.price).map((b) => ({ ...b, k: born + b.at }));
  const inYear = bills.filter((b) => b.k >= 1 && b.k <= 12 && (b.who === "mother" || b.k >= born));
  const babyIn = born <= 12;
  const members = babyIn ? [...household.members.filter((m) => m.id !== BABY_ID), { id: BABY_ID, name: e.baby, role: "child", from_month: Math.max(1, born) }]
    : household.members;
  const expected = inYear.map((b, i) => ({
    id: `expected-${sc}-${i}`, date: `${e.year}-${pad(b.k)}-15`, member: b.who === "mother" ? e.mother : BABY_ID,
    category: b.category, allowed: b.allowed, service: b.label, provider: "", fixed: true, expected: true,
  }));
  let shifted = false; // your 12 months don't start in January, so their months move (the first becomes January)
  const out = sets.map((set) => {
    const w = window || planWindow(set);
    if (set.length && w.m && !w.folded) shifted = true;
    const moved = set.map((c) => {
      if (!/^\d{4}-\d{2}/.test(String(c.date || ""))) return c;
      const i = monthIndex(w, c.date);
      return { ...c, orig_date: c.date, date: `${e.year}-${pad(i + 1)}${String(c.date).slice(7)}` };
    });
    return [...moved, ...expected];
  });
  const sum = (who) => inYear.filter((b) => b.who === who).reduce((a, b) => a + b.allowed, 0);
  return {
    household: { ...household, members }, sets: out, window: { y: e.year, m: 0, folded: false },
    info: {
      scenario: sc, label: SCENARIOS[sc].label, short: SCENARIOS[sc].short, due: e.due, due_name: monthName(e.due), year: e.year,
      price: e.price, born, baby_from: babyIn ? Math.max(1, born) : null, baby_name: e.baby, baby_id: BABY_ID, mother: e.mother,
      mother_total: sum("mother"), baby_total: sum("baby"), in_year: inYear.length,
      before: bills.filter((b) => b.k < 1).length, after: bills.filter((b) => b.k > 12).length, shifted,
    },
  };
}

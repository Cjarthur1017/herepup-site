// HerePup plan replay engine (browser port of app/engine.py). Keep behavior identical to the Python version.
export const TIERS = ["ee", "ee_sp", "ee_ch", "family"];

export function tierFor(roles) {
  const adult = roles.includes("adult"), child = roles.includes("child");
  if (adult && child) return "family";
  if (adult) return "ee_sp";
  if (child) return "ee_ch";
  return "ee";
}

const num = (v, d = 0) => { const x = Number(v); return v == null || v === "" || Number.isNaN(x) ? d : x; };
const r2 = (x) => Math.round(x * 100) / 100;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function simulate(plan, claims, members, multiplier = 1) {
  const covered = new Set(members);
  const dedInd = num(plan.deductible_ind), dedFam = plan.deductible_fam == null ? dedInd : num(plan.deductible_fam);
  const oopInd = num(plan.oop_ind), oopFam = plan.oop_fam == null ? oopInd : num(plan.oop_fam);
  const coins = plan.coinsurance == null ? 0.2 : num(plan.coinsurance);
  const embedded = !!plan.embedded;
  // The out-of-pocket maximum can work differently from the deductible (an aggregate deductible with each person's
  // own out-of-pocket cap is common). Unset: same as the deductible.
  const oopEmbedded = plan.oop_embedded == null ? embedded : !!plan.oop_embedded;
  const rxInDed = plan.rx_in_deductible == null ? true : !!plan.rx_in_deductible;
  const copays = plan.copays || {};
  const copayAfterDed = !!plan.copay_after_ded;
  const rxCopays = (plan.rx_copays || []).map(Number);
  // rx_tiers (when present) replaces rx_copays: per tier a flat copay or a coinsurance share with optional min/max per fill.
  const rxTiers = Array.isArray(plan.rx_tiers) ? plan.rx_tiers.map((t) => t || {}) : [];
  const rxOopInd = num(plan.rx_oop_ind), rxOopFam = num(plan.rx_oop_fam) || 2 * rxOopInd;
  const rxDedInd = num(plan.rx_deductible_ind);
  const rxDedFam = num(plan.rx_deductible_fam) || 2 * rxDedInd;

  const dedUsed = {}, oopUsed = {}, rxDedUsed = {}, rxOopUsed = {};
  for (const m of covered) { dedUsed[m] = 0; oopUsed[m] = 0; rxDedUsed[m] = 0; rxOopUsed[m] = 0; }
  let famDed = 0, famOop = 0, famRxDed = 0, famRxOop = 0, totalMember = 0, totalPlan = 0;
  const lines = [];
  const visitCat = new Map();
  for (const c of claims) {
    if ((c.category === "office" || c.category === "specialist") && covered.has(c.member)) visitCat.set(`${c.member}|${c.provider || ""}|${c.date}`, c.category);
  }
  const remMainDed = (m) => embedded ? Math.min(Math.max(dedInd - dedUsed[m], 0), Math.max(dedFam - famDed, 0)) : Math.max(dedFam - famDed, 0);

  const sorted = claims.filter((c) => covered.has(c.member)).slice().sort((a, b) => cmp(a.date, b.date) || cmp(String(a.id ?? ""), String(b.id ?? "")));
  for (const c of sorted) {
    const amt = num(c.allowed) * multiplier;
    let cat = c.category || "medical";
    const m = c.member;
    if (amt <= 0) continue;
    let dedPart = 0, basis = "deductible", bundled = false, memberCost;
    if (cat === "procedure") {
      const vc = visitCat.get(`${m}|${c.provider || ""}|${c.date}`);
      if (vc && copays[vc] != null && !copayAfterDed) bundled = true;
      cat = "medical";
    }
    if (cat === "preventive") { memberCost = 0; basis = "preventive"; }
    else if (bundled) { memberCost = 0; basis = "covered by visit copay"; }
    else {
      let flat = null, tier = 1, coinTier = null;
      if (cat === "rx" && rxTiers.length) {
        tier = Math.min(Math.max(parseInt(c.rx_tier || 1, 10) || 1, 1), rxTiers.length);
        const t = rxTiers[tier - 1];
        if (t.coins != null && t.coins !== "") coinTier = t; else if (t.copay != null && t.copay !== "") flat = num(t.copay);
      } else if (cat === "rx" && rxCopays.length) {
        tier = Math.min(Math.max(parseInt(c.rx_tier || 1, 10) || 1, 1), rxCopays.length);
        flat = rxCopays[tier - 1];
      } else if (cat !== "rx" && copays[cat] != null) flat = num(copays[cat]);
      if (coinTier) {
        let d = 0;
        if (rxInDed) { dedPart = Math.min(amt, remMainDed(m)); d = dedPart; }
        else if (rxDedInd && tier > 1) {
          const rem = Math.min(Math.max(rxDedInd - rxDedUsed[m], 0), Math.max(rxDedFam - famRxDed, 0));
          d = Math.min(amt, rem); rxDedUsed[m] += d; famRxDed += d;
        }
        const rest = amt - d;
        let share = rest * num(coinTier.coins);
        if (rest > 0 && coinTier.min != null && coinTier.min !== "") share = Math.max(share, num(coinTier.min));
        if (coinTier.max != null && coinTier.max !== "") share = Math.min(share, num(coinTier.max));
        memberCost = d + Math.min(share, rest);
        basis = d >= amt - 0.005 ? (rxInDed ? "deductible" : "pharmacy deductible") : d > 0 ? "deductible + coinsurance" : "coinsurance";
      } else if (flat != null && cat === "rx" && !rxInDed) {
        let d = 0;
        if (rxDedInd && tier > 1) {
          const rem = Math.min(Math.max(rxDedInd - rxDedUsed[m], 0), Math.max(rxDedFam - famRxDed, 0));
          d = Math.min(amt, rem); rxDedUsed[m] += d; famRxDed += d;
        }
        memberCost = d + Math.min(flat, amt - d);
        basis = d > 0 ? "pharmacy deductible" : (amt > flat ? "copay" : "under copay");
      } else if (flat != null && !copayAfterDed && !(cat === "rx" && rxInDed)) {
        memberCost = Math.min(flat, amt);
        basis = amt > flat ? "copay" : "under copay";
      } else {
        const subject = !(cat === "rx" && !rxInDed);
        dedPart = subject ? Math.min(amt, remMainDed(m)) : 0;
        const rest = amt - dedPart;
        memberCost = flat != null ? dedPart + Math.min(flat, rest) : dedPart + rest * coins;
        basis = dedPart >= amt - 0.005 ? "deductible" : (flat != null && dedPart > 0 ? "deductible + copay" : flat != null ? "copay"
          : rest > 0 && coins > 0 && dedPart === 0 ? "coinsurance" : dedPart > 0 && coins > 0 && rest > 0 ? "deductible + coinsurance" : "covered after deductible");
      }
      if (cat === "rx" && rxOopInd > 0) {
        // Separate pharmacy out-of-pocket maximum: drug costs count toward it instead of the medical one.
        const remRx = Math.min(Math.max(rxOopInd - rxOopUsed[m], 0), Math.max(rxOopFam - famRxOop, 0));
        if (memberCost > remRx) { memberCost = remRx; dedPart = Math.min(dedPart, memberCost); }
        dedUsed[m] += dedPart; famDed += dedPart; rxOopUsed[m] += memberCost; famRxOop += memberCost;
      } else {
        const remOop = oopEmbedded ? Math.min(Math.max(oopInd - oopUsed[m], 0), Math.max(oopFam - famOop, 0)) : Math.max(oopFam - famOop, 0);
        if (memberCost > remOop) { memberCost = remOop; dedPart = Math.min(dedPart, memberCost); }
        dedUsed[m] += dedPart; famDed += dedPart; oopUsed[m] += memberCost; famOop += memberCost;
      }
    }
    totalMember += memberCost; totalPlan += amt - memberCost;
    lines.push({ id: c.id, date: c.date, member: m, allowed: r2(amt), member_cost: r2(memberCost), basis });
  }
  return { member_cost: totalMember, plan_cost: totalPlan, lines, family_deductible_met: dedFam ? famDed >= dedFam - 0.005 : true, family_oop_used: famOop };
}

// Premium for a coverage level, or, for plans priced by headcount ("Employee + 1 / + 2 / + 3 or more"), for the number
// of people covered besides the employee (deps); the highest listed count covers that many or more.
export function premiumFor(plan, tier, deps) {
  const bc = plan.premium_by_count;
  if (bc && deps != null && deps > 0) {
    const ks = Object.keys(bc).map(Number).filter((k) => k > 0 && num(bc[k]) > 0).sort((a, b) => a - b);
    if (ks.length) return num(bc[ks.filter((k) => k <= deps).pop() ?? ks[0]]);
  }
  return num((plan.premium_annual || {})[tier]);
}

export function effectiveCost(plan, tier, memberCost, countHsa, deps = null) {
  const premium = premiumFor(plan, tier, deps);
  const raw = plan.hsa_employer;
  let hsa = typeof raw === "object" && raw ? num(raw[tier]) : num(raw);
  if (!plan.hsa_eligible) hsa = 0;
  const offset = countHsa ? hsa : 0;
  return { premium, member_cost: memberCost, hsa_offset: offset, total: premium + memberCost - offset };
}

function* product(arrays) {
  if (!arrays.length) { yield []; return; }
  const [first, ...rest] = arrays;
  for (const x of first) for (const tail of product(rest)) yield [x, ...tail];
}

export function enumerateConfigs(household, employers) {
  const members = household.members, ids = members.map((m) => m.id);
  const role = Object.fromEntries(members.map((m) => [m.id, m.role]));
  const empIds = employers.map((e) => e.id);
  const configs = [];
  for (const assign of product(ids.map(() => empIds))) {
    const a = Object.fromEntries(ids.map((id, i) => [id, assign[i]]));
    let ok = true;
    for (const e of employers) {
      const on = ids.filter((i) => a[i] === e.id);
      if (on.length && a[e.subscriber] !== e.id) { ok = false; break; }
    }
    if (!ok) continue;
    const used = employers.filter((e) => ids.some((i) => a[i] === e.id));
    for (const choice of product(used.map((e) => e.plans.map((_, i) => i)))) {
      const parts = used.map((e, k) => {
        const covered = ids.filter((i) => a[i] === e.id);
        const others = covered.filter((i) => i !== e.subscriber).map((i) => role[i]);
        return { employer: e.id, employer_name: e.name, plan_index: choice[k], plan: e.plans[choice[k]], covered, tier: tierFor(others), deps: others.length };
      });
      configs.push({ assignment: a, parts });
    }
  }
  return configs;
}

export function labelConfig(cfg) {
  const p = cfg.parts;
  if (p.length === 1) return `Everyone on ${p[0].employer_name}: ${p[0].plan.name || "plan"}`;
  return "Split: " + p.map((x) => `${x.employer_name} ${x.plan.name || "plan"} (${x.covered.length})`).join("; ");
}

// claims: one list (one plan year), or a list of lists to average: each is run as its own plan year (deductibles
// reset) and your share of care is averaged across them. (Averaging is browser-only; one list behaves as in engine.py.)
export const yearSets = (claims) => (claims.length && Array.isArray(claims[0]) ? claims : [claims]);
export function memberCostOf(plan, claims, members, multiplier = 1) {
  const sets = yearSets(claims);
  return sets.reduce((a, set) => a + simulate(plan, set, members, multiplier).member_cost, 0) / sets.length;
}

export function analyze(household, employers, claims, multiplier = 1, countHsa = true) {
  const results = [];
  for (const cfg of enumerateConfigs(household, employers)) {
    let total = 0, premium = 0, hsa = 0, mcost = 0;
    const detail = [];
    for (const p of cfg.parts) {
      const eff = effectiveCost(p.plan, p.tier, memberCostOf(p.plan, claims, p.covered, multiplier), countHsa, p.deps);
      total += eff.total; premium += eff.premium; hsa += eff.hsa_offset; mcost += eff.member_cost;
      detail.push({ employer: p.employer_name, plan: p.plan.name || "plan", tier: p.tier, deps: p.deps, by_count: !!p.plan.premium_by_count, covered: p.covered,
        premium: r2(eff.premium), member_cost: r2(eff.member_cost), hsa_offset: r2(eff.hsa_offset), total: r2(eff.total) });
    }
    results.push({ label: labelConfig(cfg), kind: cfg.parts.length === 1 ? "all" : "split", total: r2(total), premium: r2(premium),
      member_cost: r2(mcost), hsa_offset: r2(hsa), detail, assignment: cfg.assignment });
  }
  results.sort((a, b) => a.total - b.total);
  return { best: results[0] || null, best_split: results.find((r) => r.kind === "split") || null, ranked: results.slice(0, 12),
    second_gap: results.length > 1 ? r2(results[1].total - results[0].total) : null, count: results.length };
}

export function breakEven(household, employers, claims, countHsa = true, lo = 0, hi = 3, steps = 31) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const mult = lo + (hi - lo) * i / (steps - 1);
    const r = analyze(household, employers, claims, mult, countHsa);
    out.push({ multiplier: r2(mult), winner: r.best.label, total: r.best.total });
  }
  const flips = [];
  for (let i = 1; i < out.length; i++) if (out[i - 1].winner !== out[i].winner)
    flips.push({ between: [out[i - 1].multiplier, out[i].multiplier], from: out[i - 1].winner, to: out[i].winner });
  return { sweep: out, flips };
}

export function calibrate(plan, claims, members) {
  const set = new Set(members);
  const have = claims.filter((c) => c.member_resp != null && c.member_resp !== "" && set.has(c.member));
  const sim = simulate(plan, have, members, 1);
  const byId = new Map(sim.lines.map((l) => [l.id, l]));
  const rows = [];
  let absErr = 0, actualTotal = 0;
  for (const c of have) {
    const l = byId.get(c.id);
    if (!l) continue;
    const actual = Number(c.member_resp), diff = l.member_cost - actual;
    absErr += Math.abs(diff); actualTotal += actual;
    rows.push({ id: c.id, date: c.date, member: c.member, provider: c.provider || "", modeled: l.member_cost, actual: r2(actual), diff: r2(diff),
      flag: Math.abs(diff) > Math.max(5, 0.1 * actual) });
  }
  const n = rows.length;
  return { claims_checked: n, mean_abs_error: n ? r2(absErr / n) : null, modeled_total: r2(sim.member_cost), actual_total: r2(actualTotal),
    total_gap: r2(sim.member_cost - actualTotal), flagged: rows.filter((r) => r.flag).length, rows };
}

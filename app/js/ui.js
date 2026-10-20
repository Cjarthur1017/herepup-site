"use strict";
import { handle, upload, kindFor, mergeReviews, storageWorks } from "./local.js";
import { INSURERS } from "./insurers.js";
import { CARE_LABEL } from "./insights.js";
import { quickFacts } from "./timeline.js";
import { mountTimeline } from "./timeline-view.js";
import * as CX from "./connect.js";
import { history as claimHistory } from "./years.js";
const CX_TEST = CX.testMode(); // direct insurer connections, in testing: /app/?connect=test
const cxCheck = {};
const STEPS = ["Household", "Plan documents", "Claims", "Your answer", "Your spending"];
const TIERS = [["ee", "Employee only"], ["ee_sp", "Employee + spouse"], ["ee_ch", "Employee + children"], ["family", "Family"]];
const TIER_WORDS = { ee: "employee only", ee_sp: "employee + spouse", ee_ch: "employee + children", family: "family" };
const S = { step: 0, members: [], employers: [], currentPlan: "", saved: { claims: 0 }, review: null, hints: {}, detected: [], preview: null, settings: {}, drag: "", insurer: "", spending: null, busy: "", analysis: null, timeline: null, answerTab: "year", hsaGate: false, mult: 1, hsa: true, msg: "", err: "" };
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (n) => (n == null ? "" : (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US"));
const uid = () => Math.random().toString(36).slice(2, 8);
// Anonymous step counts (see /privacy/#usage): only the step's name is sent, once per page load. Never any data.
const STEP_EVENTS = new Set(["Plan added", "Claims added", "Answer shown", "Month by month opened", "Feedback clicked"]);
const tracked = new Set();
function track(name) {
  if (!STEP_EVENTS.has(name) || tracked.has(name)) return;
  tracked.add(name);
  try { if (typeof window.plausible === "function") window.plausible(name); } catch (e) { /* counting must never break the app */ }
}
const FEEDBACK = `<p class="feedback">Was this useful? <button type="button" class="linkbtn" data-act="feedback-open" data-track="Feedback clicked">Tell us how it went</button>. It takes a minute, and it goes straight to Chris at HerePup.</p>`;
function openFeedback() {
  const d = document.getElementById("feedback-dialog"); if (!d) return;
  const f = d.querySelector("form");
  if (window.HerePupContact) window.HerePupContact.reset(f);
  f.querySelector("[name=sent_from]").value = `Web app, ${STEPS[S.step]} step`;
  if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  const first = f.querySelector("input[type=radio]"); if (first) first.focus();
}
document.addEventListener("click", (ev) => {
  const c = ev.target.closest && ev.target.closest("[data-close-dialog]");
  if (c) { const d = c.closest("dialog"); if (d && d.close) d.close(); else if (d) d.removeAttribute("open"); }
});

async function api(path, opts = {}) {
  // Everything is handled on this device (see local.js). No network requests.
  const method = opts.method || "GET";
  let body = null, file = null;
  if (opts.body instanceof FormData) file = opts.body.get("file");
  else if (opts.body) body = JSON.parse(opts.body);
  return handle(method, path, body, file);
}
const post = (p, body, method = "POST") => api(p, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function newPlan() {
  const z = () => ({ ee: 0, ee_sp: 0, ee_ch: 0, family: 0 });
  return { name: "New plan", premium_annual: z(), hsa_employer: z(), hsa_eligible: false, hsa_answered: true, hsa_unknown: false, hsa_checked: false, deductible_ind: 0, deductible_fam: 0, oop_ind: 0, oop_fam: 0, coinsurance: 0.2, embedded: false, rx_in_deductible: true, copays: {}, copay_after_ded: false, rx_copays: [], rx_deductible_ind: 0, rx_deductible_fam: 0, flags: [] };
}
function setPath(obj, path, val) {
  const k = path.split(".");
  let o = obj;
  for (let i = 0; i < k.length - 1; i++) { if (o[k[i]] == null) o[k[i]] = /^\d+$/.test(k[i + 1]) ? [] : {}; o = o[k[i]]; }
  o[k[k.length - 1]] = val;
}
function bind(path, root) {
  return `data-bind="${esc(path)}" data-root="${root}"`;
}

async function load() {
  const st = await api("/api/state");
  S.members = st.household.members;
  S.employers = st.employers;
  S.saved.claims = st.claims.length;
  S.span = spanNote(st.claims);
  S.settings = st.settings || S.settings;
  const cp = st.current_plan;
  S.currentPlan = cp ? `${cp.employer}:${cp.plan_index}` : "";
  if (S.members.length && S.employers.length && S.saved.claims) S.step = 3;
  else if (S.members.length && S.employers.length) S.step = 2;
  else if (S.members.length) S.step = 1;
  if (S.step === 3 && !hsaDone()) { S.step = 1; S.hsaGate = true; S.msg = "Before your answer: confirm the employer HSA money for each plan."; }
  if (!storageWorks()) S.msg = "This browser is not letting HerePup save your work (private window or blocked storage). It will work, but nothing is kept after you close the tab.";
  const ret = CX.takeReturn(); // back from an insurer sign-in (see connect.js)
  if (ret) { S.step = 2; S.hsaGate = false; S.msg = ""; S.insurer = CX.pendingCarrier() || S.insurer; }
  render();
  if (ret) await cxReturn(ret);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (d) => (d ? `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : "");
function spanNote(claims) {
  const h = claimHistory(claims);
  return h.months > 12 ? ` They cover ${monthYear(h.first)} to ${monthYear(h.last)}; on Your answer you choose which year to plan around.` : "";
}
// "Which year to plan around" (Your answer) and "Which claims to review" (Your spending).
function basisPicker(b, act, label) {
  if (!b || !b.options || !b.options.length) return "";
  return `<label class="basis-pick">${label}<select data-act="${act}">${b.options.map((o) => `<option value="${esc(o.key)}" ${o.key === b.key ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`;
}

function render() {
  $("#progress").innerHTML = STEPS.map((n, i) => `<button class="${i < S.step ? "done" : i === S.step ? "now" : ""}" data-go="${i}"><div class="bar"></div>${i + 1}. ${n}</button>`).join("");
  const main = $("#main");
  const msg = (S.err ? `<div class="err" role="alert">${esc(S.err)}</div>` : "") + (S.msg ? `<div class="warn" role="status">${esc(S.msg)}</div>` : "");
  main.innerHTML = [stepHousehold, stepPlans, stepClaims, stepAnswer, stepSpending][S.step]() .replace("<!--MSG-->", msg);
  if (S.step === 3 && !S.analysis) runAnalysis();
  if (S.step === 3 && S.analysis && S.answerTab === "month" && S.timeline) mountTimeline($("#timeline"), S.timeline, { mult: S.mult, countHsa: S.hsa });
  if (S.step === 4 && !S.spending) runSpending();
}

function stepHousehold() {
  const rows = S.members.map((m, i) => `<tr><td><input aria-label="Name" ${bind(`${i}.name`, "members")} value="${esc(m.name)}"></td>
    <td><select aria-label="Role" ${bind(`${i}.role`, "members")}><option value="adult" ${m.role === "adult" ? "selected" : ""}>Adult</option><option value="child" ${m.role === "child" ? "selected" : ""}>Child</option></select></td>
    <td><button class="btn small" data-act="rm-member" data-i="${i}">Remove</button></td></tr>`).join("");
  return `<h1>Who is on your health coverage?</h1><p class="lead">Add everyone whose care should count. Use first names if you prefer.</p><!--MSG-->
  <div class="card"><table><thead><tr><th>Name</th><th>Role</th><th></th></tr></thead><tbody>${rows}</tbody></table>
  <div class="row" style="margin-top:12px"><button class="btn" data-act="add-member">Add a person</button></div></div>
  <button class="btn primary" data-act="save-household">Continue</button>`;
}

function planCard(e, ei, p, pi) {
  const hints = S.hints[`${ei}:${pi}`];
  const tierRows = TIERS.map(([k, label]) => `<tr class="tier"><td>${label}</td>
    <td><input type="number" min="0" aria-label="${label} premium" ${bind(`${ei}.plans.${pi}.premium_annual.${k}`, "employers")} value="${p.premium_annual[k] ?? 0}"></td>
    <td><input type="number" min="0" aria-label="${label} employer HSA" ${bind(`${ei}.plans.${pi}.hsa_employer.${k}`, "employers")} value="${p.hsa_employer[k] ?? 0}"></td></tr>`).join("");
  const chips = hints ? Object.entries(hints).map(([k, arr]) => arr.slice(0, 3).map((h) => `<span class="chip">${esc(k)} ${esc(h.value)} <small class="muted">"${esc(h.snippet.slice(0, 70))}"</small>
      <button class="btn small" data-act="hint" data-e="${ei}" data-p="${pi}" data-k="${k}" data-v="${esc(h.value)}" data-w="fam">${k === "deductible" || k === "oop" ? "use as family" : "use"}</button>
      ${k === "deductible" || k === "oop" ? `<button class="btn small" data-act="hint" data-e="${ei}" data-p="${pi}" data-k="${k}" data-v="${esc(h.value)}" data-w="ind">use as individual</button>` : ""}</span>`).join("")).join("") : "";
  return `<div class="card"><div class="row"><label style="flex:1">Plan name<input ${bind(`${ei}.plans.${pi}.name`, "employers")} value="${esc(p.name)}"></label>
    <button class="btn small danger" data-act="rm-plan" data-e="${ei}" data-p="${pi}">Remove plan</button></div>
    ${hints ? `<p class="muted">Possible values found in your document. Check each against the document before using it.</p><div class="chips">${chips || "<span class=muted>Nothing recognizable was found. Enter values by hand.</span>"}</div>` : ""}
    <div class="row" style="margin:12px 0">
      <label>Individual deductible<input type="number" min="0" ${bind(`${ei}.plans.${pi}.deductible_ind`, "employers")} value="${p.deductible_ind}"></label>
      <label>Family deductible<input type="number" min="0" ${bind(`${ei}.plans.${pi}.deductible_fam`, "employers")} value="${p.deductible_fam}"></label>
      <label>Individual out-of-pocket max<input type="number" min="0" ${bind(`${ei}.plans.${pi}.oop_ind`, "employers")} value="${p.oop_ind}"></label>
      <label>Family out-of-pocket max<input type="number" min="0" ${bind(`${ei}.plans.${pi}.oop_fam`, "employers")} value="${p.oop_fam}"></label>
      <label>Coinsurance (your share, %)<input type="number" min="0" max="100" data-pct="1" ${bind(`${ei}.plans.${pi}.coinsurance`, "employers")} value="${Math.round((p.coinsurance ?? 0.2) * 100)}"></label></div>
    <div class="row"><label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" ${bind(`${ei}.plans.${pi}.embedded`, "employers")} ${p.embedded ? "checked" : ""}>Each person has their own deductible inside the family one (embedded)</label>
    <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" ${bind(`${ei}.plans.${pi}.hsa_eligible`, "employers")} ${p.hsa_eligible ? "checked" : ""}>HSA-eligible plan (count employer HSA money)</label>
    <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" ${bind(`${ei}.plans.${pi}.rx_in_deductible`, "employers")} ${p.rx_in_deductible ? "checked" : ""}>Prescriptions count toward the deductible</label></div>
    ${(p.flags || []).length ? `<div class="warn"><b>Check these:</b><ul>${p.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
    <div class="row" style="margin:12px 0">
      ${[["office", "Office visit copay"], ["specialist", "Specialist copay"], ["urgent", "Urgent care copay"], ["er", "ER copay"]].map(([k, l]) => `<label>${l}<input type="number" min="0" placeholder="none" ${bind(`${ei}.plans.${pi}.copays.${k}`, "employers")} value="${p.copays && p.copays[k] != null ? p.copays[k] : ""}"></label>`).join("")}
      ${[0, 1, 2].map((t) => `<label>Rx tier ${t + 1} copay<input type="number" min="0" placeholder="none" ${bind(`${ei}.plans.${pi}.rx_copays.${t}`, "employers")} value="${p.rx_copays && p.rx_copays[t] != null ? p.rx_copays[t] : ""}"></label>`).join("")}
      <label>Separate pharmacy deductible (person)<input type="number" min="0" ${bind(`${ei}.plans.${pi}.rx_deductible_ind`, "employers")} value="${p.rx_deductible_ind || 0}"></label>
      <label>Pharmacy deductible (family)<input type="number" min="0" ${bind(`${ei}.plans.${pi}.rx_deductible_fam`, "employers")} value="${p.rx_deductible_fam || 0}"></label></div>
    <div class="row"><label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" ${bind(`${ei}.plans.${pi}.copay_after_ded`, "employers")} ${p.copay_after_ded ? "checked" : ""}>Copays apply only after the deductible is met</label></div>
    <p class="muted hsa-status">${p.hsa_checked ? (p.hsa_eligible ? `<span class="chip">HSA confirmed: ${hsaSummary(p)}</span>` : `<span class="chip">Confirmed: no HSA</span>`) : "You'll confirm this plan's HSA money on the next screen."}</p>
    <div class="scroll"><table style="margin-top:8px"><thead><tr><th>Coverage level</th><th>Your annual premium ($)</th><th>Employer HSA ($/yr)</th></tr></thead><tbody>${tierRows}</tbody></table></div></div>`;
}

const hsaDone = () => S.employers.every((e) => e.plans.every((p) => p.hsa_checked));
const hsaSummary = (p) => {
  const h = p.hsa_employer || {};
  if (!h.ee && !h.ee_sp && !h.ee_ch && !h.family) return "no employer money";
  return `${usd(h.ee)} employee only, ${usd(h.family)} family`;
};
const isBlankPlan = (p) => p.name === "New plan" && !p.deductible_ind && !p.oop_ind && !Object.values(p.premium_annual || {}).some(Number);
// A guide dropped on one employer's card: its plan options go straight to that employer.
function addGuideTo(ei, r, file) {
  const e = S.employers[ei]; if (!e) return;
  const d = r.detected || { plans: [] };
  if (d.plans.length) {
    const z = () => ({ ee: 0, ee_sp: 0, ee_ch: 0, family: 0 });
    e.plans = e.plans.filter((p) => !isBlankPlan(p)).concat(d.plans.map((p) => ({ ...newPlan(), ...p, hsa_checked: false, hsa_employer: { ...z(), ...(p.hsa_employer || {}) } })));
    if (!e.name.trim() && d.employer) e.name = d.employer;
    S.msg = `Added ${d.plans.length} plan option(s) from ${file} to ${e.name || "this employer"}`.replace(/\.?$/, ". ") + "Check the numbers below.";
  } else {
    if (!e.plans.length) e.plans.push(newPlan());
    if (r.hints) S.hints[`${ei}:0`] = r.hints;
    S.msg = `${r.message || `No plan table was found in ${file}.`} Possible values are listed under the first plan; enter the rest by hand.`;
  }
}

function hsaGate() {
  const pref = S.settings.plan_types || "all";
  const cards = S.employers.flatMap((e, ei) => e.plans.map((p, pi) => {
    const id = `${ei}-${pi}`, h = p.hsa_employer || {};
    const has = p.hsa_checked ? (p.hsa_eligible ? "yes" : "no") : (p.hsa_eligible ? "yes" : "");
    const none = p.hsa_checked && p.hsa_eligible && !h.ee && !h.family;
    const val = (k) => (p.hsa_checked || h[k] ? (h[k] ?? "") : "");
    const amt = (k, label, req) => `<label>${label}${req ? "" : ' <span class="muted">(blank = family)</span>'}<input type="number" min="0" step="1" inputmode="numeric" data-gate-amt="${k}" value="${esc(val(k))}" ${none ? "disabled" : ""}></label>`;
    return `<div class="card gate" data-gate="${id}"><h2>${esc(e.name)}: ${esc(p.name)}</h2>
      ${!p.hsa_checked && p.hsa_eligible ? `<p class="muted">From the guide, this looks like a high-deductible plan that comes with an HSA. Check it below.</p>` : ""}
      <fieldset class="gate-q"><legend>Does this plan come with a health savings account (HSA)?</legend>
        <label class="radio"><input type="radio" name="gate-has-${id}" value="yes" data-gate-has ${has === "yes" ? "checked" : ""}>Yes, it's an HSA plan</label>
        <label class="radio"><input type="radio" name="gate-has-${id}" value="no" data-gate-has ${has === "no" ? "checked" : ""}>No HSA</label></fieldset>
      <div class="gate-amounts" ${has === "yes" ? "" : "hidden"}>
        <p><b>How much does ${esc(e.name)} put into the HSA each year?</b> Your benefit guide or HR can tell you. Enter yearly amounts.</p>
        <div class="row">${amt("ee", "Employee only", true)}${amt("ee_sp", "Employee + spouse", false)}${amt("ee_ch", "Employee + children", false)}${amt("family", "Family", true)}
          <button type="button" class="btn small" data-act="hsa-gate-copy">Use the family amount for spouse and children</button></div>
        <label class="radio" style="margin-top:8px"><input type="checkbox" data-gate-none ${none ? "checked" : ""}>${esc(e.name)} doesn't put any money into the HSA</label>
      </div></div>`;
  })).join("");
  const opt = (v, label, help) => `<label class="radio pref"><input type="radio" name="plan-types" value="${v}" ${pref === v ? "checked" : ""}><span><b>${label}</b><br><span class="muted">${help}</span></span></label>`;
  return `<h1>One more check: HSA money</h1>
  <p class="lead">Money your employer puts into a health savings account (HSA) can decide which plan costs least, so confirm it for every plan before we work out your answer.</p><!--MSG-->
  ${cards}
  <div class="card"><h2>Which plans should HerePup consider?</h2>
    <p class="muted">Some people need a certain kind of plan. For example, you may want to keep putting money into an HSA, or you may not be able to: being on Medicare or having a general health care FSA can rule out HSA contributions.</p>
    ${opt("all", "Every plan (recommended)", "Price every option and show the cheapest overall.")}
    ${opt("hsa", "Only plans with an HSA", "Leave out plans that don't come with an HSA.")}
    ${opt("non_hsa", "Only plans without an HSA", "Leave out HSA plans.")}
    <p class="muted">You can change this later on your answer.</p></div>
  <div id="gate-err" class="err" role="alert" hidden></div>
  <div class="row"><button class="btn" data-act="hsa-gate-back">Back to plan details</button><button class="btn primary" data-act="hsa-gate-save">Confirm and continue</button></div>`;
}

function stepPlans() {
  if (S.hsaGate) return hsaGate();
  const memberOpts = (sel) => S.members.map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${esc(m.name)}</option>`).join("");
  const emps = S.employers.map((e, ei) => `<section class="card" style="background:#F8FBFB"><div class="row"><label>Employer name<input ${bind(`${ei}.name`, "employers")} value="${esc(e.name)}"></label>
    <label>Who works there?<select ${bind(`${ei}.subscriber`, "employers")}><option value="">Choose...</option>${memberOpts(e.subscriber)}</select></label>
    <button class="btn small danger" data-act="rm-employer" data-e="${ei}">Remove employer</button></div>
    ${dropZone(`plan:${ei}`, `Drop ${e.name || "this employer"}'s benefit guide here and we'll fetch the details`, "PDF, typed or scanned. HerePup adds every plan option it finds to this employer.", true)}
    ${e.plans.map((p, pi) => planCard(e, ei, p, pi)).join("")}
    <button class="btn" data-act="add-plan" data-e="${ei}">Add a plan option for ${esc(e.name || "this employer")}</button></section>`).join("");
  const cur = S.employers.flatMap((e, ei) => e.plans.map((p, pi) => `<option value="${e.id}:${pi}" ${S.currentPlan === `${e.id}:${pi}` ? "selected" : ""}>${esc(e.name)}: ${esc(p.name)}</option>`)).join("");
  const found = S.detected.map((d, di) => `<div class="card" style="border-color:#1F7A7A"><h2>${d.plans.length ? `Found ${d.plans.length} plan option(s) in ${esc(d.file)}` : `No plan table found in ${esc(d.file)}`}</h2>
    ${d.message ? `<div class="warn">${esc(d.message)}</div>` : ""}
    ${(d.notes || []).map((n) => `<p class="muted">${esc(n)}</p>`).join("")}
    ${d.plans.length ? `<div class="scroll"><table><thead><tr><th>Plan</th><th>Deductible (person / family)</th><th>Out-of-pocket max</th><th>Visit copays</th><th>Rx tiers 1-3</th><th>Premium per year (you / you+spouse / you+kids / family)</th></tr></thead><tbody>
      ${d.plans.map((p) => `<tr><td>${esc(p.name)}</td><td>${usd(p.deductible_ind)} / ${usd(p.deductible_fam)}</td><td>${usd(p.oop_ind)} / ${usd(p.oop_fam)}</td>
      <td>${p.copays && p.copays.office != null ? `${usd(p.copays.office)} / ${usd(p.copays.specialist)}${p.copay_after_ded ? " after deductible" : ""}` : "none found"}</td>
      <td>${(p.rx_copays || []).map(usd).join(" / ") || "none found"}</td>
      <td>${usd(p.premium_annual.ee)} / ${usd(p.premium_annual.ee_sp)} / ${usd(p.premium_annual.ee_ch)} / ${usd(p.premium_annual.family)}</td></tr>`).join("")}</tbody></table></div>
    <div class="row" style="margin-top:12px"><label>Employer name<input id="det-emp-${di}" data-det="${di}" data-det-field="employer" value="${esc(d.employer || "")}"></label>
    <label>Who works there?<select id="det-sub-${di}" data-det="${di}" data-det-field="sub"><option value="">Choose...</option>${memberOpts(d.sub || "")}</select></label>
    <button class="btn primary" data-act="add-detected" data-i="${di}">Add this employer with these plans</button><button class="btn" data-act="clear-detected" data-i="${di}">Dismiss</button></div>
    <p class="muted">You can edit every number after adding it. Flags under each plan list what to double-check.</p>` : `<div class="row"><button class="btn" data-act="clear-detected" data-i="${di}">Dismiss</button></div>`}</div>`).join("");
  const uploadCard = dropZone("plan", "Drop your benefit guides here and we'll fetch the details", "PDF guides from each employer, typed or scanned. Drop several at once. HerePup finds every plan option in each one.") + found;
  return `<h1>What plans can your household choose from?</h1><p class="lead">Drop in each employer's benefit guide. We read out the plan options, you confirm them.</p><!--MSG-->${uploadCard}${emps}
  <div class="row"><button class="btn" data-act="add-employer">Add an employer by hand</button></div>
  <div class="card"><label>Which plan were your uploaded claims actually processed under? (used to check how well we match your carrier)<select data-act="current-plan"><option value="">Not sure / skip</option>${cur}</select></label></div>
  <div class="row"><button class="btn" data-go="0">Back</button><button class="btn primary" data-act="save-plans">Continue</button></div>`;
}

async function runPreview() {
  if (!S.review) return;
  try { S.preview = await post("/api/review/preview", { rows: S.review.rows }); } catch (e) { S.preview = null; S.err = e.message; }
}
const CAT_LABEL = { medical: "Medical", office: "Office visit", specialist: "Specialist", urgent: "Urgent care", er: "ER", procedure: "Office procedure", preventive: "Preventive", rx: "Rx" };

function reviewTable() {
  const r = S.review;
  if (!r) return "";
  const mem = (sel) => `<option value="">?</option>` + S.members.map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${esc(m.name)}</option>`).join("");
  const cat = (c) => Object.keys(CAT_LABEL).map((x) => `<option value="${x}" ${x === c ? "selected" : ""}>${CAT_LABEL[x]}</option>`).join("");
  const num = (i, f, v) => `<input type="number" step="0.01" aria-label="${f}" ${bind(`${i}.${f}`, "review")} value="${v ?? ""}">`;
  const pv = S.preview && S.preview.plans;
  const pcell = (x, pl) => { const l = pl.lines[x.id]; return l ? `<td style="text-align:right">${usd(l.cost)}<div class="muted" style="font-size:13px">${esc(l.basis)}</div></td>` : "<td></td>"; };
  const rows = r.rows.map((x, i) => `<tr class="${x.needs_review || !x.member_id || (x.check && !x.confirmed) ? "flag" : ""}"><td><input type="checkbox" aria-label="Skip this row" ${bind(`${i}.skip`, "review")} ${x.skip ? "checked" : ""}></td>
    <td><input type="date" aria-label="Date" ${bind(`${i}.date`, "review")} value="${esc(x.date)}"></td>
    <td><select aria-label="Person" ${bind(`${i}.member_id`, "review")}>${mem(x.member_id)}</select></td>
    <td><input aria-label="Provider" ${bind(`${i}.provider`, "review")} value="${esc(x.provider)}">${x.type_source ? `<div class="muted" style="font-size:13px">${esc(x.type_source)}</div>` : ""}${x.check ? `<label style="flex-direction:row;align-items:center;gap:6px;font-size:13px"><input type="checkbox" aria-label="Confirm type" ${bind(`${i}.confirmed`, "review")} ${x.confirmed ? "checked" : ""}>Confirm this type</label>` : ""}</td>
    <td><select aria-label="Type" ${bind(`${i}.category`, "review")}>${cat(x.category)}</select></td>
    <td>${x.category === "rx" ? `<input type="number" min="1" max="3" style="width:56px" aria-label="Rx tier" ${bind(`${i}.rx_tier`, "review")} value="${x.rx_tier ?? 1}">` : ""}</td><td>${num(i, "billed", x.billed)}</td><td>${num(i, "allowed", x.allowed)}</td><td>${num(i, "plan_paid", x.plan_paid)}</td><td>${num(i, "member_resp", x.member_resp)}</td></tr>`).join("");
  const landing = pv ? `<h2 style="margin-top:20px">How each claim lands under each plan</h2><p class="muted">If the whole household were on that plan. Deductibles and out-of-pocket limits carry forward through the year. Change a type above and press Re-run the numbers.</p>
    <div class="scroll"><table class="landing"><thead><tr><th>Date</th><th>Person</th><th>Care type</th>${pv.map((pl) => `<th style="text-align:right">${esc(pl.label)}</th>`).join("")}</tr></thead><tbody>
    ${r.rows.filter((x) => !x.skip && x.member_id && x.allowed).sort((a, b) => (a.date > b.date ? 1 : -1)).map((x) => `<tr><td>${esc(x.date)}</td><td>${esc((S.members.find((m) => m.id === x.member_id) || {}).name || "")}</td><td>${esc(CAT_LABEL[x.category] || x.category)}</td>${pv.map((pl) => pcell(x, pl)).join("")}</tr>`).join("")}
    <tr style="font-weight:900"><td colspan="3">Total for these claims</td>${pv.map((pl) => `<td style="text-align:right">${usd(pl.total)}</td>`).join("")}</tr></tbody></table></div>` : "";
  const pheads = pv ? pv.map((pl) => `<th style="text-align:right">${esc(pl.label)}<div class="muted" style="font-size:12px;font-weight:400">if everyone were on it</div></th>`).join("") : "";
  const ptotals = pv ? `<tr style="font-weight:900"><td colspan="9">Your cost for these claims under each plan (accumulators carried through the year)</td>${pv.map((pl) => `<td style="text-align:right">${usd(pl.total)}</td>`).join("")}</tr>` : "";
  return `<div class="card review"><h2>Review what we read (${r.rows.length} rows)</h2>
    ${(r.notes || []).map((n) => `<p class="muted">${esc(n)}</p>`).join("")}
    ${r.unreadable_pages ? `<div class="warn">${r.unreadable_pages} page(s) are scanned images and were not read.</div>` : ""}
    ${r.new_people && r.new_people.length ? `<div class="warn"><b>These people are not in your household yet:</b> ${r.new_people.map((n, k) => `<span style="margin-right:12px">${esc(n)} <select id="np-${k}" aria-label="Role for ${esc(n)}"><option value="adult">Adult</option><option value="child">Child</option></select></span>`).join("")}
      <button class="btn small" data-act="add-people">Add them to my household</button></div>` : ""}
    ${(r.coverage || []).length || r.skipped ? `<p class="muted">${(r.coverage || []).map((c) => `Coverage: ${esc(c.plan || "plan")} (${esc(c.payor)}), from ${esc(c.start)}${c.end ? " to " + esc(c.end) : ""}.`).join(" ")}${r.skipped ? ` ${r.skipped} cancelled claim(s) left out.` : ""}</p>` : ""}
    ${(r.errors || []).map((e) => `<div class="warn">${esc(e)}</div>`).join("")}
    ${r.observed ? `<p class="muted">Your EOB reports ${usd(r.observed.ded_fam_met)} met toward the ${usd(r.observed.ded_fam)} family deductible${r.observed.as_of ? " as of " + esc(r.observed.as_of) : ""}.${r.suggest_current_plan ? " That matches a plan you added, so it was selected as the plan your claims were processed under." : ""}</p>` : ""}
    <p class="muted">Highlighted rows need a look. Rows without a person are not saved. Tick "skip" to leave one out.${r.unparsed_dated_lines?.length ? ` ${r.unparsed_dated_lines.length} dated line(s) could not be read as claims.` : ""}</p>
    ${r.kind === "eob" && r.generic_reader ? `<div class="row"><label>Column order in your EOB's amounts<input id="order" style="min-width:380px" value="${esc(S.order || "billed,allowed,plan_paid,member_resp")}"></label><button class="btn small" data-act="reparse">Re-read with this order</button></div><p class="muted">Use the names billed, discount, allowed, plan_paid, member_resp, and any other word for columns to ignore, in the order they appear on the EOB.</p>` : ""}
    <div class="scroll"><table class="edit"><thead><tr><th>Skip</th><th>Date</th><th>Person</th><th>Provider</th><th>Type</th><th>Rx tier</th><th>Billed</th><th>Allowed</th><th>Plan paid</th><th>You owe</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${landing}<div class="row" style="margin-top:12px"><button class="btn" data-act="rerun">Re-run the numbers</button>${r.rows.some((x) => x.check && !x.confirmed) ? `<button class="btn" data-act="confirm-all">Confirm all flagged types</button>` : ""}<button class="btn primary" data-act="commit">Save these claims</button><button class="btn" data-act="discard">Discard</button></div></div>`;
}

function stepClaims() {
  return `<h1>Add your claims</h1><p class="lead">Drop in your explanations of benefits (EOBs) and claim summaries. The last 12 months is the best starting point; add earlier years to plan around your highest, lowest or average year. We read them on this device, and you check every row.</p><!--MSG-->
  <div class="grid2">${dropZone("claims", "Drop your claims here and we'll fetch the details", "EOB PDFs, claim or pharmacy summaries (CSV or Excel), or a FHIR export from your insurer. Drop several at once; they're combined into one review.")}
  ${insurerCard()}</div>
  ${reviewTable()}
  <div class="row"><button class="btn" data-go="1">Back</button><button class="btn primary" data-act="to-answer">See my answer</button></div>`;
}

const BELL = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
function insurerCard() {
  const ins = INSURERS.find((x) => x.id === S.insurer);
  const opts = `<option value="">Choose your insurer...</option>` + INSURERS.map((x) => `<option value="${x.id}" ${x.id === S.insurer ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  const body = !ins ? `<p class="muted">Pick your insurer to see where to download your claims and whether a direct connection is possible.</p>`
    : `<ol class="muted steps-list"><li>Sign in to ${ins.member ? `<a href="${esc(ins.member)}" target="_blank" rel="noopener">your ${esc(ins.name)} member site</a>` : "your insurer's member website"} or app.</li>
        <li>Open <b>Claims</b>. Look for <b>Download</b> or <b>Export</b> to get a spreadsheet of all claims, or open each claim's explanation of benefits (EOB) as a PDF.</li>
        <li>Drop the files here.</li></ol>
      ${ins.id !== "other" ? `<p class="muted"><b>Direct connection (in testing):</b> ${esc(ins.name)} publishes a Patient Access API. ${esc(ins.covers)} HerePup status: ${esc(ins.herepup)}. <a href="/insurers/">About insurer connections</a></p>` : ""}
      <p><button type="button" class="req-btn" data-request-insurer="${esc(ins.id === "other" ? "" : ins.name.replace(/\s*\(.*?\)/, ""))}" data-from="Web app, Claims step">${BELL}${ins.id === "other" ? "Request your insurer" : `Request a direct connection to ${esc(ins.name)}`}</button></p>`;
  const cx = CX_TEST && ins && CX.CARRIERS[ins.id] ? connectPanel(ins.id) : "";
  const steps = cx ? body.replace(/<p class="muted"><b>Direct connection \(in testing\):[\s\S]*$/, "") : body; // the panel replaces the status and request button
  return `<div class="card"><h2>Get your claims from your insurer</h2><label>Your insurer<select data-act="insurer">${opts}</select></label>${cx}${cx ? `<h3 class="cx-or">Or download your claims</h3>` : ""}${steps}
    <p class="muted">${S.saved.claims} claim(s) already saved in this browser.${esc(S.span || "")}</p></div>`;
}

// Direct connection (testing): sign in at the insurer; claims come straight into this browser.
function cxCheckLine(cid, env) {
  const r = cxCheck[`${cid}:${env}`], name = esc(CX.CARRIERS[cid].name);
  if (r == null) return `<p class="cx-check muted" id="cx-check">Checking whether ${name} accepts connections from this browser...</p>`;
  if (r.token === true && r.fhir) return `<p class="cx-check ok" id="cx-check"><span aria-hidden="true">&#10003;</span> ${r.helper
    ? `HerePup's sign-in helper is ready, and ${name}'s claims server accepts connections from this browser.`
    : `${name}'s sign-in and claims servers both accept connections from this browser.`}</p>`;
  const signin = r.helper ? `HerePup's sign-in helper: ${r.token === "not-set-up" ? `<b>not set up for ${name} ${esc(env)} yet</b>` : r.token ? "ready" : "<b>unreachable</b>"}`
    : `${name}'s sign-in server: ${r.token ? "reachable" : "<b>blocked</b>"}`;
  return `<p class="cx-check warn" id="cx-check"><b>Not everything is reachable from this browser.</b> ${signin}. ${name}'s claims server: ${r.fhir ? "reachable" : "<b>blocked</b>"}.
    ${r.fhir ? "" : `${name} may not allow browser connections (CORS), or an extension blocked it. `}You can still try; HerePup will say exactly where it stops.</p>`;
}
function connectPanel(cid) {
  const c = CX.CARRIERS[cid], cfg = CX.settings(cid), ep = CX.endpoints(cid, cfg), tok = CX.connection(cid), key = `${cid}:${ep.env}`;
  const helper = CX.helperUrl(cfg);
  if (helper && cfg.client_secret) CX.saveSettings(cid, { client_secret: undefined }); // the helper holds the secret now
  if (!(key in cxCheck)) {
    cxCheck[key] = null;
    CX.check(cid).then((res) => { cxCheck[key] = res; const el = document.getElementById("cx-check"); if (el && CX.endpoints(cid).env === ep.env) el.outerHTML = cxCheckLine(cid, ep.env); });
  }
  const envs = Object.entries(c.envs).map(([k, v]) => `<option value="${k}" ${ep.env === k ? "selected" : ""}>${esc(v.label)}</option>`).join("");
  const mins = tok ? Math.max(1, Math.round((tok.expires_at - Date.now()) / 60000)) : 0;
  const consent = `<label class="cx-consent"><input type="checkbox" data-cx-consent data-cid="${cid}" ${cfg.consent === CX.CONSENT_VERSION ? "checked" : ""}>
    <span>I want HerePup to read my claims and coverage from ${esc(c.name)} into this browser, as described in the <a href="/privacy/#connect" target="_blank" rel="noopener">Privacy Policy</a>. HerePup uses them only to estimate my plan costs on this device, and never sells or shares them. I can disconnect or delete them at any time.</span></label>`;
  const actions = tok
    ? `<p class="cx-on">Connected to ${esc(c.name)} ${esc(tok.env)}${tok.patient ? ` (member record ${esc(tok.patient)})` : ""} for about ${mins} more minute${mins === 1 ? "" : "s"}.</p>
       ${consent}<div class="row"><button class="btn primary" data-act="cx-pull" data-cid="${cid}">Pull claims again</button><button class="btn" data-act="cx-connect" data-cid="${cid}">Connect another family member</button><button class="btn small" data-act="cx-disconnect" data-cid="${cid}">Disconnect</button></div>`
    : `${consent}<div class="row"><button class="btn primary" data-act="cx-connect" data-cid="${cid}">Connect to ${esc(c.name)}</button></div>`;
  return `<div class="cx" id="cx-panel"><h3>Connect to ${esc(c.name)} <span class="pill">Testing</span></h3>
    <p class="muted">Sign in at ${esc(c.name)} and your claims come straight into this browser. ${helper
      ? "Only the one-time sign-in step goes through HerePup's sign-in helper, which keeps nothing." : "Nothing passes through HerePup."}</p>
    <label>Which data<select data-cx="env" data-cid="${cid}">${envs}</select></label>
    ${c.askMember ? `<label style="margin-top:8px">Whose ${esc(c.name)} is this?<select data-cx="member_id" data-cid="${cid}"><option value="">Choose a person...</option>${S.members.map((m) => `<option value="${esc(m.id)}" ${cfg.member_id === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>` : ""}
    ${helper ? `<details><summary><b>App settings</b></summary>
      <label>Client ID (leave blank to use the sign-in helper's)<input data-cx="client_id" data-cid="${cid}" value="${esc(cfg.client_id || "")}" autocomplete="off" spellcheck="false"></label>
      <label>Callback URL registered in the portal<input readonly value="${esc(CX.callbackUrl())}" data-select-all></label>
      <p class="muted">The client secret is kept in HerePup's sign-in helper, not in this browser.</p></details>`
    : `<details ${cfg.client_id ? "" : "open"}><summary><b>App settings from the ${esc(c.name)} developer portal</b></summary>
      <div class="row"><label>Client ID<input data-cx="client_id" data-cid="${cid}" value="${esc(cfg.client_id || "")}" autocomplete="off" spellcheck="false"></label>
        <label>Client secret<input type="password" data-cx="client_secret" data-cid="${cid}" placeholder="${cfg.client_secret ? "Saved. Leave blank to keep it" : "If the portal issued one"}" autocomplete="off"></label></div>
      <label>Callback URL to register in the portal<input readonly value="${esc(CX.callbackUrl())}" data-select-all></label>
      <p class="muted">Kept only in this browser. "Delete all my data" erases them.</p></details>`}
    ${cxCheckLine(cid, ep.env)}
    ${ep.hint ? `<p class="muted">${esc(ep.hint)}</p>` : ""}
    ${actions}
    ${S.cxRaw && S.cxRaw.cid === cid ? `<p class="muted"><button type="button" class="linkbtn" data-act="cx-raw">Download exactly what ${esc(c.name)} sent</button> (a FHIR file, for troubleshooting how HerePup reads it).</p>` : ""}
    <p class="muted">${esc(c.covers)}</p></div>`;
}
async function cxPull(cid) {
  const c = CX.CARRIERS[cid];
  setBusy("claims", `Fetching your claims from ${c.name}...`);
  try {
    const got = await CX.pull(cid, (t) => setBusy("claims", t));
    if (!got.eobs) {
      fetchEnd("claims", false, `${c.name} returned no claims for this member.`);
      S.busy = ""; S.msg = `${c.name} signed you in but returned no claims. ${c.covers}${got.notes.length ? " " + got.notes.join(" ") : ""}`;
      render(); return;
    }
    const bundle = { resourceType: "Bundle", type: "collection", entry: got.resources.map((r) => ({ resource: r })) };
    const file = new File([JSON.stringify(bundle)], `${c.name} ${got.env} claims.json`, { type: "application/json" });
    S.cxRaw = { cid, name: `HerePup - ${c.name} ${got.env} - what ${c.name} sent.json`, file }; // kept in memory only, for the download link
    await handleFiles([file], "claims", null, `${c.name} (${got.env})`);
    if (c.askMember && S.review) { // no name comes back from this insurer: the claims belong to the person chosen before connecting
      const mid = CX.settings(cid).member_id;
      let n = 0;
      for (const r of S.review.rows) if (!r.member_id && r.source === file.name && mid) { r.member_id = mid; n++; }
      if (n) { S.preview = null; await runPreview(); render(); }
    }
    if (got.notes.length) { S.msg = got.notes.join(" "); render(); }
  } catch (e) { S.busy = ""; const f = fetchOf("claims"); if (f && f.phase === "fetching") fetchEnd("claims", false, "See the note at the top of the page."); throw e; }
}
async function cxReturn(ret) {
  try {
    setBusy("claims", "Finishing the sign-in...");
    const done = await CX.finish(ret);
    S.insurer = done.cid;
    await cxPull(done.cid);
  } catch (e) { S.busy = ""; const f = fetchOf("claims"); if (f && f.phase === "fetching") fetchEnd("claims", false, "See the note at the top of the page."); S.err = e.message; render(); }
}

// The drop zone's fetching dog: idle (tail wagging), fetching (walks off with the plan while a progress bar and
// paw prints show it working), done (runs back with a checkmark). Phase timing survives re-renders via --since.
const FETCH = { WALK: 1600, HOLD: 6500 };
const PAW = '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="15.6" rx="5" ry="4.3"/><ellipse cx="5.6" cy="9.6" rx="2.1" ry="2.7"/><ellipse cx="9.8" cy="5.6" rx="2.1" ry="2.7"/><ellipse cx="14.2" cy="5.6" rx="2.1" ry="2.7"/><ellipse cx="18.4" cy="9.6" rx="2.1" ry="2.7"/></svg>';
const PAWS = Array.from({ length: 10 }, (_, i) => `<i style="--i:${i};--y:${i % 2 ? 10 : 0}">${PAW}</i>`).join("");
function fetchOf(kind) { return S.fetch && S.fetch.zone === kind ? S.fetch : null; }
function dropZone(kind, title, help, compact = false) {
  const f = fetchOf(kind), phase = f ? f.phase : "idle";
  const since = f ? Math.max(0, (Date.now() - (phase === "fetching" ? f.t0 : f.t1)) / 1000) : 0;
  const pct = f && f.frac != null ? Math.round(f.frac * 100) : null;
  return `<div class="card drop ${compact ? "compact" : ""} ${S.drag === kind ? "over" : ""} ${phase === "fetching" ? "busy" : ""}" data-drop="${kind}" data-phase="${phase}" style="--since:-${since.toFixed(2)}s">
    <label class="drop-inner"><input type="file" multiple accept="${kind.startsWith("plan") ? ".pdf,.txt" : ".pdf,.csv,.xlsx,.json"}" data-act="drop-pick" data-kind="${kind}" class="sr-only">
      <span class="fetch" aria-hidden="true"><span class="paws">${PAWS}</span>
        <span class="dog"><span class="gait"><img class="tail" src="/app/img/dog-tail.webp" alt="" width="300" height="237"><img class="body" src="/app/img/dog-body.webp" alt="" width="300" height="237"></span><span class="badge"></span></span></span>
      <span class="say say-idle"><b>${esc(title)}</b><span class="muted">${esc(help)}</span><span class="btn small as-btn">Or choose files</span></span>
      <span class="say say-over"><b>Let go, and we'll fetch it!</b></span>
      <span class="say say-fetching"><b>Sniffing through the details...</b>
        <span class="bar ${pct == null ? "ind" : ""}"><i style="width:${pct ?? 0}%"></i></span>
        <span class="muted fetch-status" role="status" aria-live="polite">${esc(f && f.phase === "fetching" ? S.busy : "")}</span></span>
      <span class="say say-done"><b><span class="tick" aria-hidden="true"></span>Retrieved successfully!</b><span class="muted fetch-summary" role="status">${esc(f ? f.summary || "" : "")}</span></span>
      <span class="say say-error"><b>We couldn't fetch the details</b><span class="muted fetch-summary" role="status">${esc(f ? f.summary || "" : "")}</span></span></label>
    <p class="muted local-line">Read on this device. Nothing is uploaded.</p></div>`;
}
// Repaint one drop zone in place (no full render, so nothing the person is typing loses focus).
function paintFetch(kind) {
  const el = document.querySelector(`[data-drop="${kind}"]`); if (!el) return;
  const f = fetchOf(kind), phase = f ? f.phase : "idle";
  el.dataset.phase = phase; el.style.setProperty("--since", "0s"); el.classList.toggle("busy", phase === "fetching");
  el.querySelectorAll(".fetch-summary").forEach((s) => { s.textContent = f ? f.summary || "" : ""; });
}
function fetchStart(kind) {
  clearTimeout(S.fetchTimer);
  const prev = S.fetch; S.fetch = { zone: kind, phase: "fetching", t0: Date.now(), frac: null, summary: "" };
  if (prev && prev.zone !== kind) paintFetch(prev.zone);
  paintFetch(kind); fetchProgress(kind, null, "");
}
function fetchProgress(kind, frac, text) {
  const f = fetchOf(kind); if (!f) return;
  if (frac != null) f.frac = Math.max(f.frac || 0, Math.min(1, frac));
  const el = document.querySelector(`[data-drop="${kind}"]`); if (!el) return;
  const bar = el.querySelector(".bar"), st = el.querySelector(".fetch-status");
  if (bar) { bar.classList.toggle("ind", f.frac == null); bar.querySelector("i").style.width = `${Math.round((f.frac || 0) * 100)}%`; }
  if (st && text != null) st.textContent = text;
}
function fetchEnd(kind, ok, summary) {
  const f = fetchOf(kind); if (!f) return;
  clearTimeout(S.fetchTimer);
  // let the dog finish walking off before it comes back, even when reading was instant
  S.fetchTimer = setTimeout(() => {
    if (S.fetch !== f) return;
    f.phase = ok ? "done" : "error"; f.t1 = Date.now(); f.summary = summary; f.frac = 1; paintFetch(kind);
    S.fetchTimer = setTimeout(() => { if (S.fetch === f) { S.fetch = null; paintFetch(kind); } }, FETCH.HOLD);
  }, Math.max(0, FETCH.WALK - (Date.now() - f.t0)));
}

function stepAnswer() {
  const a = S.analysis;
  if (!a) return `<h1>Your answer</h1><!--MSG--><p class="lead">Running your claims through every option...</p>`;
  const b = a.best;
  const second = a.second_gap != null ? `About ${usd(a.second_gap)} less than the next best option.` : "";
  const others = a.ranked.slice(0, 6).map((r, i) => `<tr class="${i === 0 ? "ok" : ""}"><td>${esc(r.label)}</td><td>${usd(r.premium)}</td><td>${usd(r.member_cost)}</td><td>${r.hsa_offset ? "-" + usd(r.hsa_offset) : "$0"}</td><td><b>${usd(r.total)}</b></td></tr>`).join("");
  const nameOf = (id) => (S.members.find((m) => m.id === id) || {}).name || id;
  const who = b.detail.map((d) => `<li><b>${esc(d.employer)}: ${esc(d.plan)}</b> covers ${d.covered.map((c) => esc(nameOf(c))).join(", ")} (${esc(TIER_WORDS[d.tier] || d.tier)})</li>`).join("");
  const bs = a.basis || { short: "your claims history", options: [] }, short = esc(bs.short);
  const flips = a.break_even.flips.length ? a.break_even.flips.map((f) => `<li>Between ${Math.round(f.between[0] * 100)}% and ${Math.round(f.between[1] * 100)}% of the care in ${short}, the best choice changes from <b>${esc(f.from)}</b> to <b>${esc(f.to)}</b>.</li>`).join("") : `<li>The same option wins at every level of care we tested, from none to three times the care in ${short}.</li>`;
  const picker = basisPicker(bs, "basis", "Which year of your history should HerePup plan around?") + (bs.options.length && bs.note ? `<p class="muted small">${esc(bs.note)}</p>` : "");
  const cal = a.calibration ? calBlock(a.calibration) : `<p class="muted">Pick the plan your claims were processed under on the plan step to see how closely we match your carrier.</p>`;
  const tab = (id, label) => `<button role="tab" id="tab-${id}" aria-selected="${S.answerTab === id}" aria-controls="answer-panel" tabindex="${S.answerTab === id ? 0 : -1}" data-act="answer-tab" data-tab="${id}">${label}</button>`;
  const head = `<h1>${esc(b.label)}</h1>${bs.options.length ? `<p class="basis-line">Planning around <b>${short}</b>.${S.answerTab === "month" ? "" : " Change it under What if."}</p>` : ""}<!--MSG-->${(a.warnings || []).map((w) => `<div class="warn">${esc(w)}</div>`).join("")}
  <div class="tl-tabs" role="tablist" aria-label="Ways to see your answer">${tab("year", "Year total")}${tab("month", 'Month by month <span class="tl-new">New</span>')}</div>`;
  const nav = `${FEEDBACK}<div class="row"><button class="btn" data-go="2">Back to claims</button><button class="btn primary" data-go="4">Review your spending</button><button class="btn danger" data-act="wipe">Delete all my data</button></div>`;
  if (S.answerTab === "month") {
    return `${head}<div id="answer-panel" role="tabpanel" aria-labelledby="tab-month">
    <p class="lead">Premiums come out of every paycheck, whether you see a doctor or not. Your share of care lands in the months you get care. Here's how a year of care like yours is likely to play out under each option.</p>
    ${picker ? `<div class="card basis-card">${picker}</div>` : ""}
    <div id="timeline" class="tl">${S.timeline ? "" : "<p class='muted'>Month by month isn't available for these claims yet.</p>"}</div></div>${nav}`;
  }
  const PREF = { hsa: "Only plans with an HSA", non_hsa: "Only plans without an HSA" };
  const prefNote = a.plan_types && a.plan_types !== "all" ? `<p class="pref-note"><b>${PREF[a.plan_types]}</b> were considered.${a.all_best && a.all_best.label !== b.label
    ? ` Counting every plan, the cheapest would be <b>${esc(a.all_best.label)}</b> at ${usd(a.all_best.total)}, ${usd(b.total - a.all_best.total)} less.` : " The cheapest plan overall is the same."} Change this under "Plans to consider".</p>` : "";
  const pick = S.timeline && S.timeline.options.find((o) => o.pick);
  const q = pick ? quickFacts(pick, S.timeline.window) : null;
  const month = q ? `<p class="muted">Month by month, its biggest month is ${esc(q.peakMonth)} at ${usd(q.peak)}${q.setAside ? `, so set aside about ${usd(q.setAside)} by ${esc(q.setAsideBy)}` : ""}. <button class="linkbtn" data-act="answer-tab" data-tab="month">See month by month</button></p>` : "";
  return `${head}<div id="answer-panel" role="tabpanel" aria-labelledby="tab-year">
  <div class="grid2"><div class="card"><div class="muted">Estimated yearly cost${S.mult !== 1 ? `, at ${Math.round(S.mult * 100)}% of the care in ${short}` : `, if your care looks like ${short}`}</div><div class="bignum">${usd(b.total)}</div>
    <p>${usd(b.premium)} premiums + ${usd(b.member_cost)} your share of care${b.hsa_offset ? ` - ${usd(b.hsa_offset)} employer HSA money` : ""}. ${second}</p><ul>${who}</ul>${month}${prefNote}</div>
  <div class="card"><h2>What if...</h2>${picker}<label>How much care do you expect next year, compared with ${short}? <b id="mult-label">${Math.round(S.mult * 100)}%</b>
    <input type="range" min="0" max="300" step="5" value="${Math.round(S.mult * 100)}" id="mult"></label>
    <label style="flex-direction:row;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" id="hsa" ${S.hsa ? "checked" : ""}>Count employer HSA money as an offset</label>
    <label style="margin-top:12px">Plans to consider<select data-act="plan-types">${[["all", "Every plan"], ["hsa", "Only plans with an HSA"], ["non_hsa", "Only plans without an HSA"]].map(([v, l]) => `<option value="${v}" ${(S.settings.plan_types || "all") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <h2 style="margin-top:16px">What would change the answer</h2><ul>${flips}</ul></div></div>
  ${a.hsa_sensitivity ? `<div class="card"><h2>Employer HSA deposit is unknown for ${a.hsa_sensitivity.plans.map(esc).join(", ")}</h2><p class="muted">The numbers above assume $0. Here is the best option at each possible family deposit (smaller levels scaled to a third):</p>
    <table><thead><tr><th>Family deposit</th><th>Best option</th><th>Total</th></tr></thead><tbody>${a.hsa_sensitivity.scenarios.map((x) => `<tr><td>${usd(x.family_deposit)}</td><td>${esc(x.best)}</td><td><b>${usd(x.total)}</b></td></tr>`).join("")}</tbody></table></div>` : ""}
  <div class="card"><h2>All the options we tested (top ${Math.min(6, a.ranked.length)} of ${a.count})</h2><div class="scroll"><table><thead><tr><th>Option</th><th>Premiums</th><th>Your care costs</th><th>HSA offset</th><th>Total</th></tr></thead><tbody>${others}</tbody></table></div></div>
  <div class="card"><h2>How closely do we match your carrier?</h2>${cal}</div></div>
  ${nav}`;
}

function bar(v, max) { return `<span class="bar-h" style="width:${max ? Math.max(2, Math.round((v / max) * 100)) : 0}%"></span>`; }

function stepSpending() {
  const sp = S.spending;
  if (!sp) return `<h1>Your spending</h1><!--MSG--><p class="lead">Adding up your claims...</p>`;
  const s = sp.summary;
  const nameOf = (id) => (S.members.find((m) => m.id === id) || {}).name || id;
  if (!s.claims) return `<h1>Your spending</h1><!--MSG--><p class="lead">Save some claims first, then come back here.</p><div class="row"><button class="btn" data-go="2">Add claims</button></div>`;
  const n = s.per_year || 1, yr = n > 1 ? " a year" : "", py = n > 1 ? " per year" : "";
  const cnt = (x) => (n > 1 ? String(Math.round((x / n) * 10) / 10) : String(x));
  const b = sp.basis || {};
  const picker = basisPicker(b, "spend-basis", "Which claims to review");
  const maxT = Math.max(...s.by_type.map((t) => t.allowed), 1);
  const types = s.by_type.map((t) => `<tr><td>${esc(t.label)}</td><td class="n">${cnt(t.count)}</td><td class="barcell">${bar(t.allowed, maxT)}<span>${usd(t.allowed)}</span></td><td class="n">${usd(t.paid)}</td></tr>`).join("");
  const people = s.by_person.map((p) => `<tr><td>${esc(p.member)}</td><td class="n">${cnt(p.count)}</td><td class="n">${usd(p.allowed)}</td><td class="n">${usd(p.paid)}</td></tr>`).join("");
  const provs = s.by_provider.map((p) => `<tr><td>${esc(p.provider)}<div class="muted small">${esc(p.types)}</div></td><td class="n">${cnt(p.count)}</td><td class="n">${usd(p.allowed)}</td><td class="n">${usd(p.paid)}</td></tr>`).join("");
  const money2 = (n) => (n == null ? "" : "$" + Number(n).toFixed(2));
  const cmp = sp.comparisons.map((c) => {
    const max = Math.max(...c.providers.map((p) => p.avg), 1);
    const fmt = c.per === "per unit" ? money2 : usd;
    return `<div class="card cmp"><div class="row" style="justify-content:space-between;align-items:baseline"><h3>${esc(c.label)}</h3>
      <span class="save">${c.you_save != null ? `You could have saved about ${usd(c.you_save)}${yr}` : `About ${usd(c.care_saving)} less in total care${yr}`}</span></div>
      <p class="muted small">Compared ${esc(c.basis)}, average allowed ${esc(c.per)}. ${c.visits} ${c.rx ? "fill" : "visit"}${c.visits === 1 ? "" : "s"} in your claims.</p>
      <table class="cmp-t"><tbody>${c.providers.map((p, i) => `<tr class="${i === 0 ? "best" : ""}"><td>${esc(p.provider)}${i === 0 ? ' <span class="chip">Lowest cost you used</span>' : ""}</td>
        <td class="n">${p.visits}x</td><td class="barcell">${bar(p.avg, max)}<span>${fmt(p.avg)}</span></td></tr>`).join("")}</tbody></table>
      <p class="small">Using ${esc(c.cheapest)} for the same care would have lowered total care by about <b>${usd(c.care_saving)}</b>${yr}${c.you_save != null ? ` and your own costs by about <b>${usd(c.you_save)}</b>${yr} under ${esc(sp.plan_label)}` : ""}.${c.you_save === 0 ? " Your plan's flat copays meant the price difference didn't reach you this time." : ""}</p></div>`;
  }).join("");
  const er = sp.er ? `<div class="card cmp"><h3>Emergency room or urgent care?</h3>
    <p>Your ${sp.er.er_visits} ER visit${sp.er.er_visits === 1 ? "" : "s"} averaged <b>${usd(sp.er.er_avg)}</b> in total care. Your ${sp.er.urgent_visits} urgent care visit${sp.er.urgent_visits === 1 ? "" : "s"} averaged <b>${usd(sp.er.urgent_avg)}</b>.
    ${sp.er.you_save_all != null ? `If ${sp.er.er_visits === 1 ? "that visit" : "those visits"} could have been handled at urgent care, you would have paid about <b>${usd(sp.er.you_save_all)}</b> less${yr} under ${esc(sp.plan_label)}.` : ""}</p>
    <p class="muted small">Only you and your doctor know whether the ER was needed. In an emergency, always go to the ER.</p></div>` : "";
  const lead = n > 1 ? `An average year of your household's care, from your ${n} full years between ${esc(monthYear(b.from + "-01"))} and ${esc(monthYear(b.to + "-01"))}, and where the same kind of care costs less, so you can choose lower-cost care next time.`
    : `What your household's care cost from ${esc(monthYear(s.from))} to ${esc(monthYear(s.to))}, and where the same kind of care costs less, so you can choose lower-cost care next time.`;
  return `<h1>Your spending</h1><!--MSG-->${picker ? `<div class="card basis-card">${picker}</div>` : ""}<p class="lead">${lead}</p>
  <div class="tiles"><div class="tile"><div class="muted">Total care (allowed)${py}</div><b>${usd(s.allowed)}</b></div><div class="tile"><div class="muted">Your plan paid${py}</div><b>${usd(s.plan_paid)}</b></div>
    <div class="tile"><div class="muted">You paid${py}</div><b>${usd(s.paid)}</b></div><div class="tile"><div class="muted">Claims${py}</div><b>${cnt(s.claims)}</b></div></div>
  <h2 style="margin-top:28px">Could the same care have cost less?</h2>
  ${cmp || er ? "" : `<div class="card"><p>We didn't find the same kind of care at two different providers in your claims, so there's nothing to compare yet. Comparisons appear when, for example, two urgent care centers, two labs or two pharmacies show up for the same service. Adding a full year of claims helps.</p></div>`}
  ${cmp}${er}
  ${cmp || er ? `<p class="muted small">Visits of the same type can differ in what was done, so treat these as a guide. Comparisons only use providers you've already been to; in-network status isn't checked.${sp.plan_label ? "" : " Pick the plan your claims were processed under on step 2 to see what you personally would have saved."}</p>` : ""}
  <div class="grid2"><div class="card"><h2>By type of care${yr}</h2><div class="scroll"><table class="sp"><thead><tr><th>Care</th><th class="n">Claims</th><th>Total care</th><th class="n">You paid</th></tr></thead><tbody>${types}</tbody></table></div></div>
  <div class="card"><h2>By person${yr}</h2><div class="scroll"><table class="sp"><thead><tr><th>Person</th><th class="n">Claims</th><th class="n">Total care</th><th class="n">You paid</th></tr></thead><tbody>${people}</tbody></table></div></div></div>
  <div class="card"><h2>Where your care happened${yr}</h2><div class="scroll"><table class="sp"><thead><tr><th>Provider</th><th class="n">Claims</th><th class="n">Total care</th><th class="n">You paid</th></tr></thead><tbody>${provs}</tbody></table></div></div>
  ${FEEDBACK}<div class="row"><button class="btn" data-go="3">Back to your answer</button><button class="btn" data-go="2">Add more claims</button></div>`;
}

async function runSpending() {
  try { S.spending = await post("/api/spending", {}); } catch (e) { S.err = e.message; S.spending = { summary: { claims: 0 }, comparisons: [], er: null }; }
  render();
}

function calBlock(c) {
  if (!c.claims_checked) return `<p class="muted">None of your saved claims include what you actually owed, so there is nothing to compare yet.</p>`;
  const rows = c.rows.filter((r) => r.flag).slice(0, 12).map((r) => `<tr class="flag"><td>${esc(r.date)}</td><td>${esc(r.provider)}</td><td>${usd(r.modeled)}</td><td>${usd(r.actual)}</td><td>${usd(r.diff)}</td></tr>`).join("");
  return `<p>We checked ${c.claims_checked} claims. Our model says you would owe <b>${usd(c.modeled_total)}</b>; your carrier says <b>${usd(c.actual_total)}</b> (gap ${usd(c.total_gap)}). Average miss per claim: ${usd(c.mean_abs_error)}. ${c.flagged} claim(s) differ by more than $5 or 10%.</p>
  ${rows ? `<div class="scroll"><table><thead><tr><th>Date</th><th>Provider</th><th>Modeled</th><th>Actual</th><th>Difference</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">Differences usually mean a plan setting above does not match your plan (deductible, coinsurance, copays, or a service type that is covered differently). Fix the plan and the check updates.</p>` : "<p class='ok'>Every checked claim matches within tolerance.</p>"}`;
}

async function runAnalysis() {
  try {
    S.err = "";
    S.analysis = await post("/api/analyze", { multiplier: S.mult, count_hsa: S.hsa });
    try { S.timeline = await post("/api/timeline", { multiplier: S.mult, count_hsa: S.hsa }); } catch (e) { S.timeline = null; }
    track("Answer shown");
  } catch (e) {
    S.err = e.message;
    S.analysis = null;
    S.step = Math.min(S.step, 2);
    if (e.code === "hsa") { S.step = 1; S.hsaGate = true; }
  }
  render();
}

async function saveEmployers() {
  const [e, p] = S.currentPlan ? S.currentPlan.split(":") : [null, 0];
  await post("/api/employers", { employers: S.employers, current_plan: e ? { employer: e, plan_index: Number(p) } : null }, "PUT");
}

document.addEventListener("click", (ev) => {
  const k = ev.target.closest && ev.target.closest("[data-track]");
  if (k) track(k.dataset.track);
  if (ev.target.closest && ev.target.closest("[data-act=usage-ok]")) {
    try { localStorage.setItem("herepup.usage-note", "seen"); } catch (e) { /* ignore */ }
    const n = document.getElementById("usage-note"); if (n) n.hidden = true;
  }
});
function usageNote() {
  let seen = false;
  try { seen = localStorage.getItem("herepup.usage-note") === "seen"; } catch (e) { /* ignore */ }
  const n = document.getElementById("usage-note"); if (n && !seen) n.hidden = false;
}
document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("[data-go],[data-act]");
  if (!t) return;
  S.err = ""; S.msg = "";
  try {
    if (t.dataset.go !== undefined) { S.step = Number(t.dataset.go); S.analysis = null; S.spending = null; return render(); }
    const act = t.dataset.act;
    if (act === "add-member") { S.members.push({ id: uid(), name: "", role: "adult" }); render(); }
    else if (act === "rm-member") { S.members.splice(Number(t.dataset.i), 1); render(); }
    else if (act === "save-household") {
      const m = S.members.filter((x) => x.name.trim());
      if (!m.length) throw new Error("Add at least one person.");
      S.members = (await post("/api/household", { members: m }, "PUT")).members; S.step = 1; render();
    }
    else if (act === "add-employer") { S.employers.push({ id: uid(), name: "", subscriber: "", plans: [newPlan()] }); render(); }
    else if (act === "rm-employer") { S.employers.splice(Number(t.dataset.e), 1); render(); }
    else if (act === "add-plan") { S.employers[+t.dataset.e].plans.push(newPlan()); render(); }
    else if (act === "add-detected") {
      const di = +t.dataset.i, d = S.detected[di], sub = $("#det-sub-" + di).value, name = $("#det-emp-" + di).value.trim();
      if (!name) throw new Error("Give the employer a name."); if (!sub) throw new Error("Choose who works there.");
      const z = () => ({ ee: 0, ee_sp: 0, ee_ch: 0, family: 0 });
      S.employers.push({ id: uid(), name, subscriber: sub, plans: d.plans.map((p) => ({ ...newPlan(), ...p, hsa_employer: { ...z(), ...(p.hsa_employer || {}) } })) });
      S.detected.splice(di, 1); S.msg = `Added ${name} with ${d.plans.length} plan option(s). Review the numbers, then continue.`; render();
    }
    else if (act === "clear-detected") { S.detected.splice(+t.dataset.i, 1); render(); }
    else if (act === "add-people") {
      const add = S.review.new_people.map((n, k) => ({ id: uid(), name: n.split(" ")[0].charAt(0).toUpperCase() + n.split(" ")[0].slice(1).toLowerCase(), role: $("#np-" + k).value }));
      const have = new Set(S.members.map((m) => m.name.toLowerCase()));
      const fresh = add.filter((m) => !have.has(m.name.toLowerCase()));
      S.members = S.members.concat(fresh);
      await post("/api/household", { members: S.members }, "PUT");
      const st = await api("/api/state"); S.members = st.household.members;
      S.review.rows.forEach((r) => { if (!r.member_id) { const n = (r.member || "").toLowerCase(); const m = S.members.find((x) => n.includes(x.name.toLowerCase())); if (m) r.member_id = m.id; } });
      S.review.new_people = S.review.rows.filter((r) => !r.member_id).map((r) => r.member).filter((v, i, a) => v && a.indexOf(v) === i);
      S.msg = "Added to your household. Check the roles on step 1 if needed."; render();
    }
    else if (act === "hsa-confirm") { const p = S.employers[+t.dataset.e].plans[+t.dataset.p]; p.hsa_answered = true; p.hsa_unknown = false; render(); }
    else if (act === "hsa-none") { const p = S.employers[+t.dataset.e].plans[+t.dataset.p]; p.hsa_employer = { ee: 0, ee_sp: 0, ee_ch: 0, family: 0 }; p.hsa_answered = true; p.hsa_unknown = false; render(); }
    else if (act === "hsa-unknown") { const p = S.employers[+t.dataset.e].plans[+t.dataset.p]; p.hsa_unknown = true; p.hsa_answered = true; render(); }
    else if (act === "hsa-reopen") { const p = S.employers[+t.dataset.e].plans[+t.dataset.p]; p.hsa_answered = false; p.hsa_unknown = false; render(); }
    else if (act === "hsa-copy") { const p = S.employers[+t.dataset.e].plans[+t.dataset.p]; p.hsa_employer.ee_sp = p.hsa_employer.family; p.hsa_employer.ee_ch = p.hsa_employer.family; render(); }
    else if (act === "answer-tab") {
      S.answerTab = t.dataset.tab === "month" ? "month" : "year"; render();
      if (S.answerTab === "month") track("Month by month opened");
      const tb = document.getElementById("tab-" + S.answerTab); if (tb) tb.focus();
    }
    else if (act === "feedback-open") openFeedback();
    else if (act === "hsa-gate-back") { S.hsaGate = false; render(); }
    else if (act === "hsa-gate-copy") {
      const box = t.closest("[data-gate]"), fam = box.querySelector('[data-gate-amt="family"]').value;
      for (const k of ["ee_sp", "ee_ch"]) box.querySelector(`[data-gate-amt="${k}"]`).value = fam;
    }
    else if (act === "hsa-gate-save") {
      const plans = [], errs = [];
      S.employers.forEach((e, ei) => e.plans.forEach((p, pi) => {
        const box = document.querySelector(`[data-gate="${ei}-${pi}"]`), label = `${e.name}: ${p.name}`;
        const has = box && box.querySelector("input[data-gate-has]:checked");
        if (!has) { errs.push(`Say whether ${label} comes with an HSA.`); return; }
        if (has.value === "no") { plans.push([p, false, null]); return; }
        if (box.querySelector("[data-gate-none]").checked) { plans.push([p, true, { ee: 0, ee_sp: 0, ee_ch: 0, family: 0 }]); return; }
        const v = (k) => box.querySelector(`[data-gate-amt="${k}"]`).value.trim();
        const bad = ["ee", "family"].filter((k) => v(k) === "" || !(Number(v(k)) >= 0));
        if (bad.length) { errs.push(`Enter what ${e.name} puts in the HSA for ${label} (employee only and family), or tick that it doesn't put any money in.`); return; }
        const fam = Number(v("family")), amt = (k) => (v(k) === "" ? fam : Number(v(k)));
        plans.push([p, true, { ee: Number(v("ee")), ee_sp: amt("ee_sp"), ee_ch: amt("ee_ch"), family: fam }]);
      }));
      if (errs.length) { const el = document.getElementById("gate-err"); el.textContent = errs.join(" "); el.hidden = false; el.scrollIntoView({ block: "center" }); return; }
      for (const [p, has, amounts] of plans) {
        p.hsa_eligible = has; p.hsa_employer = amounts || { ee: 0, ee_sp: 0, ee_ch: 0, family: 0 };
        p.hsa_checked = true; p.hsa_answered = true; p.hsa_unknown = false;
      }
      const pref = (document.querySelector("input[name=plan-types]:checked") || {}).value || "all";
      S.settings = { ...S.settings, plan_types: pref }; await post("/api/settings", S.settings, "PUT");
      await saveEmployers(); track("Plan added"); S.hsaGate = false; S.step = 2; S.analysis = null; S.timeline = null; render(); window.scrollTo(0, 0);
    }
    else if (act === "rerun") { await runPreview(); render(); }
    else if (act === "confirm-all") { S.review.rows.forEach((r) => { if (r.check) r.confirmed = true; }); render(); }
    else if (act === "rm-plan") { S.employers[+t.dataset.e].plans.splice(+t.dataset.p, 1); render(); }
    else if (act === "hint") {
      const p = S.employers[+t.dataset.e].plans[+t.dataset.p], v = Number(t.dataset.v), k = t.dataset.k, w = t.dataset.w;
      if (k === "deductible") p[w === "ind" ? "deductible_ind" : "deductible_fam"] = v;
      else if (k === "oop") p[w === "ind" ? "oop_ind" : "oop_fam"] = v;
      else if (k === "coinsurance") p.coinsurance = v / 100;
      else if (k === "hsa") { p.hsa_eligible = true; p.hsa_employer.family = v; }
      else if (k === "premium") p.premium_annual.family = v;
      render();
    }
    else if (act === "save-plans") {
      if (!S.employers.length) throw new Error("Add at least one employer.");
      for (const e of S.employers) { if (!e.name.trim()) throw new Error("Give each employer a name."); if (!e.subscriber) throw new Error(`Choose who works at ${e.name}.`); }
      if (!S.employers.some((e) => e.plans.length)) throw new Error("Add at least one plan option.");
      await saveEmployers(); S.hsaGate = true; render(); window.scrollTo(0, 0);
    }
    else if (act === "reparse") {
      S.order = $("#order").value; const f = S.lastFile; if (f) await uploadClaims(f.file, f.kind, S.order);
    }
    else if (act === "commit") {
      if (S.review.rows.some((x) => x.check && !x.confirmed && !x.skip)) throw new Error("Confirm or change the highlighted care types first (tick \"Confirm this type\").");
      const r = await post("/api/claims/commit", { rows: S.review.rows });
      S.saved.claims = r.total; S.review = null; S.spending = null; S.msg = `Saved ${r.saved} claim(s).`; if (r.saved) track("Claims added");
      try { S.span = spanNote((await api("/api/state")).claims); } catch (e) { /* the note is optional */ }
      render();
    }
    else if (act === "discard") { S.review = null; render(); }
    else if (act === "to-answer") {
      if (!S.saved.claims) throw new Error("Save some claims first.");
      if (!hsaDone()) { S.step = 1; S.hsaGate = true; S.msg = "Before your answer: confirm the employer HSA money for each plan."; render(); window.scrollTo(0, 0); return; }
      await saveEmployers(); S.step = 3; S.analysis = null; render();
    }
    else if (act === "wipe") {
      if (confirm("Delete your household, plans and claims from this browser?")) { await api("/api/data", { method: "DELETE" }); CX.forget(); location.reload(); }
    }
    else if (act === "cx-connect") { await CX.start(t.dataset.cid); }
    else if (act === "cx-pull") { await cxPull(t.dataset.cid); }
    else if (act === "cx-disconnect") { CX.disconnect(t.dataset.cid); S.cxRaw = null; render(); }
    else if (act === "cx-raw" && S.cxRaw) {
      const a = document.createElement("a"), url = URL.createObjectURL(S.cxRaw.file);
      a.href = url; a.download = S.cxRaw.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  } catch (e) { S.err = e.message; render(); }
});

async function uploadClaims(file, kind, order) {
  S.lastFile = { file, kind };
  await handleFiles([file], "claims", order ? order.split(",").map((x) => x.trim()) : null);
}

function setBusy(kind, text, frac = null) {
  S.busy = text; S.busyKind = kind;
  if (!text) return;
  if (!fetchOf(kind)) fetchStart(kind);
  fetchProgress(kind, frac, text);
}

async function handleFiles(files, zone, order = null, title = "") {
  try { return await readFiles(files, zone, order, title); }
  catch (e) { const f = fetchOf(zone); if (f && f.phase === "fetching") fetchEnd(zone, false, "See the note at the top of the page, then try again."); throw e; }
}
async function readFiles(files, zone, order, title = "") {
  files = [...files];
  if (!files.length) return;
  S.err = ""; S.msg = "";
  const step = zone.startsWith("plan") ? 1 : 2;
  const results = [], errors = [];
  let found = 0;
  for (const [i, f] of files.entries()) {
    const label = files.length > 1 ? `Reading ${f.name} (${i + 1} of ${files.length})...` : `Reading ${f.name}...`;
    if (i === 0 && !(fetchOf(zone) && fetchOf(zone).phase === "fetching")) fetchStart(zone);
    setBusy(zone, label, files.length > 1 ? i / files.length : null);
    try {
      const kind = kindFor(f, step);
      const r = await upload(f, kind, order, (p) => {
        // a real progress bar only when there are enough steps to make it move; otherwise it shimmers
        const m = /page (\d+) of (\d+)/i.exec(p), steps = m ? +m[2] * files.length : files.length;
        setBusy(zone, `${f.name}: ${p}`, m && steps >= 3 ? (i + (+m[1] - 0.5) / +m[2]) / files.length : files.length > 1 ? i / files.length : null);
      });
      if (kind === "plan") found += ((r.detected || {}).plans || []).length;
      if (kind === "plan" && zone.startsWith("plan:")) addGuideTo(+zone.split(":")[1], r, f.name);
      else if (kind === "plan") {
        S.detected.push({ ...r.detected, message: r.message, file: f.name });
      } else results.push(r);
    } catch (e) { errors.push(e.message || String(e)); }
  }
  S.busy = ""; S.busyKind = "";
  if (results.length) {
    const merged = mergeReviews(S.review && zone === "claims" && !order ? [S.review, ...results] : results);
    if (merged.suggest_current_plan && !S.currentPlan) S.currentPlan = merged.suggest_current_plan;
    if (files.length === 1) S.lastFile = { file: files[0], kind: kindFor(files[0], step) };
    S.review = merged; S.preview = null; await runPreview();
  }
  if (errors.length) S.err = errors.join(" ");
  const what = title || (files.length === 1 ? files[0].name : `${files.length} files`);
  const ok = errors.length < files.length;
  const summary = !ok ? "See the note at the top of the page, then try again."
    : step === 1 ? (found ? `Found ${found} plan option${found === 1 ? "" : "s"} in ${what}.` : `Read ${what}, but no plan table was found. See the notes below.`)
    : `Read ${S.review ? S.review.rows.length : 0} claim row${S.review && S.review.rows.length === 1 ? "" : "s"} from ${what}. Check them below.`;
  fetchEnd(zone, ok, summary);
  render();
}

document.addEventListener("change", async (ev) => {
  const t = ev.target;
  try {
    if (t.dataset.act === "insurer") { S.insurer = t.value; render(); return; }
    if (t.dataset.cxConsent !== undefined) { CX.saveSettings(t.dataset.cid, { consent: t.checked ? CX.CONSENT_VERSION : "" }); return; }
    if (t.dataset.cx) {
      const v = t.value.trim(), k = t.dataset.cx;
      if (k === "client_secret") { if (v) { CX.saveSettings(t.dataset.cid, { client_secret: v }); t.value = ""; t.placeholder = "Saved. Leave blank to keep it"; } return; }
      CX.saveSettings(t.dataset.cid, { [k]: v });
      if (k === "env") render();
      return;
    }
    if (t.dataset.gateHas !== undefined) { const box = t.closest("[data-gate]"); box.querySelector(".gate-amounts").hidden = t.value !== "yes"; return; }
    if (t.dataset.gateNone !== undefined) { t.closest("[data-gate]").querySelectorAll("[data-gate-amt]").forEach((i) => { i.disabled = t.checked; }); return; }
    if (t.dataset.act === "basis" || t.dataset.act === "spend-basis") {
      S.settings = { ...S.settings, [t.dataset.act === "basis" ? "basis" : "spend_basis"]: t.value }; await post("/api/settings", S.settings, "PUT");
      if (t.dataset.act === "basis") { S.analysis = null; S.timeline = null; } else S.spending = null;
      render(); return;
    }
    if (t.dataset.act === "plan-types") {
      S.settings = { ...S.settings, plan_types: t.value }; await post("/api/settings", S.settings, "PUT");
      S.analysis = null; S.timeline = null; render(); return;
    }
    if (t.dataset.det !== undefined) { const d = S.detected[+t.dataset.det]; if (d) d[t.dataset.detField] = t.value; return; }
    if (t.dataset.act === "drop-pick" && t.files.length) { const fl = [...t.files]; t.value = ""; await handleFiles(fl, t.dataset.kind); return; }
    if (t.dataset.act === "guide-file" && t.files[0]) {
      S.err = ""; S.detected = null; S.busy = "Reading " + t.files[0].name + ". Scanned guides can take a minute or two..."; render();
      const fd = new FormData(); fd.append("file", t.files[0]);
      try {
        const r = await api("/api/upload?kind=plan", { method: "POST", body: fd });
        S.detected = { ...r.detected, message: r.message, file: t.files[0].name };
      } finally { S.busy = ""; }
      render(); return;
    }
    if (t.dataset.act === "plan-file" && t.files[0]) {
      const fd = new FormData(); fd.append("file", t.files[0]);
      const r = await api("/api/upload?kind=plan", { method: "POST", body: fd });
      S.hints[`${t.dataset.e}:${t.dataset.p}`] = r.hints; render(); return;
    }
    if (t.dataset.act === "claims-file" && t.files[0]) { S.err = ""; await uploadClaims(t.files[0], t.dataset.kind); return; }
    if (t.dataset.act === "current-plan") { S.currentPlan = t.value; return; }
    if (t.dataset.bind) {
      const root = t.dataset.root === "members" ? S.members : t.dataset.root === "employers" ? S.employers : S.review.rows;
      let v = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? null : Number(t.value)) : t.value;
      if (t.dataset.pct) v = (v || 0) / 100;
      setPath(root, t.dataset.bind, v);
      if (t.dataset.bind.endsWith(".subscriber") || t.dataset.bind.endsWith(".name")) { /* no re-render to keep focus */ }
    }
    if (t.id === "mult") { S.mult = Number(t.value) / 100; S.analysis = null; render(); }
    if (t.id === "hsa") { S.hsa = t.checked; S.analysis = null; render(); }
  } catch (e) { S.err = e.message; render(); }
});
document.addEventListener("keydown", (ev) => {
  const t = ev.target;
  if (t.getAttribute && t.getAttribute("role") === "tab" && (ev.key === "ArrowRight" || ev.key === "ArrowLeft")) {
    ev.preventDefault(); S.answerTab = S.answerTab === "year" ? "month" : "year"; render();
    const tb = document.getElementById("tab-" + S.answerTab); if (tb) tb.focus();
  }
});
document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "mult") $("#mult-label").textContent = t.value + "%";
});

// ---- drag and drop
let dragDepth = 0;
const zoneOf = (ev) => ev.target.closest && ev.target.closest("[data-drop]");
const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes("Files");
window.addEventListener("dragover", (ev) => { if (hasFiles(ev)) ev.preventDefault(); });
window.addEventListener("drop", (ev) => { if (hasFiles(ev) && !zoneOf(ev)) ev.preventDefault(); });
document.addEventListener("dragenter", (ev) => {
  if (!hasFiles(ev)) return;
  const z = zoneOf(ev); dragDepth++;
  const kind = z ? z.dataset.drop : "";
  if (kind !== S.drag) { S.drag = kind; document.querySelectorAll("[data-drop]").forEach((el) => el.classList.toggle("over", el.dataset.drop === kind)); }
});
document.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { S.drag = ""; document.querySelectorAll("[data-drop]").forEach((el) => el.classList.remove("over")); } });
document.addEventListener("drop", async (ev) => {
  const z = zoneOf(ev);
  dragDepth = 0; S.drag = ""; document.querySelectorAll("[data-drop]").forEach((el) => el.classList.remove("over"));
  if (!z || !hasFiles(ev)) return;
  ev.preventDefault();
  try { await handleFiles(ev.dataTransfer.files, z.dataset.drop); } catch (e) { S.busy = ""; S.err = e.message; render(); }
});

document.addEventListener("focusin", (ev) => { if (ev.target.matches && ev.target.matches("[data-select-all]")) ev.target.select(); });
usageNote();
load().catch((e) => { S.err = e.message; render(); });

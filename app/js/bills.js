// "Check a bill": four small checks that run entirely on this device.
//  - estimate vs. bill: the federal good faith estimate dispute right for self-pay patients ($400 over, 120 days)
//  - surprise bill: No Surprises Act protections (emergency care, out-of-network clinicians at in-network facilities, air ambulance)
//  - Maryland outpatient facility fee: Health-General 19-349.2(g), no fee without the required notice
//  - cash or insurance: what paying a cash price costs versus running the care through the plan
// These are plain-language explanations of public rules, not legal advice; every result says what to check and who decides.

const r2 = (x) => Math.round(x * 100) / 100;
const num = (v) => { const x = Number(String(v ?? "").replace(/[$,\s]/g, "")); return v == null || v === "" || Number.isNaN(x) ? null : x; };
export const usd = (x) => (x == null ? "" : (x < 0 ? "-" : "") + "$" + Math.abs(Math.round(x)).toLocaleString("en-US"));
const DAY = 86400000;
export const addDays = (iso, d) => new Date(Date.parse(iso + "T12:00:00Z") + d * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY);

export const LINKS = {
  nsa: "https://www.cms.gov/nosurprises/consumers",
  ppdr: "https://www.cms.gov/medical-bill-rights/help/dispute-a-bill",
  hscrc: "https://hscrc.maryland.gov/Pages/consumers.aspx",
};
export const HELP_DESK = "1-800-985-3059";

// ------------------------------------------------------------------ estimate vs. bill
// Self-pay (no insurance, or chose not to bill it): a provider's bill at least $400 over its own good faith estimate can go
// to federal patient-provider dispute resolution within 120 days of the first bill with the higher charges ($25 fee).
export function estimateCheck(d, today = new Date().toISOString().slice(0, 10)) {
  const est = num(d.estimate), billed = num(d.billed);
  if (est == null || billed == null) return { error: "Enter both the estimate and the bill from this provider." };
  const diff = r2(billed - est), out = { estimate: est, billed, diff, selfPay: d.selfPay !== "no" };
  if (!out.selfPay) {
    out.status = "insured";
    out.headline = diff > 0 ? `The bill is ${usd(diff)} more than the estimate.` : "The bill isn't higher than the estimate.";
    out.points = [
      "The federal estimate dispute process covers people who paid themselves (self-pay). The insured version of the rule hasn't taken effect yet.",
      "You can still ask the provider to explain every charge that wasn't on the estimate and to honor the estimate.",
      "Check what your insurer says you owe on its explanation of benefits. If the provider is billing you more than that, use the surprise-bill check.",
    ];
    return out;
  }
  if (diff >= 400) {
    out.status = "dispute";
    out.headline = `You can likely dispute this bill: it is ${usd(diff)} more than the estimate (the threshold is $400).`;
    if (d.firstBill) {
      out.deadline = addDays(d.firstBill, 120);
      out.daysLeft = daysBetween(today, out.deadline);
      out.points = [out.daysLeft >= 0 ? `Start the dispute by ${out.deadline} (${out.daysLeft} day${out.daysLeft === 1 ? "" : "s"} left). That's 120 days from the first bill with the higher charges.`
        : `The 120-day window ended on ${out.deadline}. Ask the provider directly; the federal dispute may no longer be available.`];
    } else out.points = ["You have 120 days from the first bill with the higher charges to start the dispute. Add that date to see your deadline."];
    out.points.push(
      "The dispute costs $25. While it's open, the provider can't send the bill to collections or threaten to.",
      "If the provider can't show the extra cost was for medically needed care that couldn't have been foreseen, the reviewer generally holds the payment to the estimate. A charge that wasn't on the estimate at all can come out at $0.",
      "It applies to each provider's own estimate. If several providers (surgeon, anesthesia, facility) each gave an estimate, check each one separately.",
    );
  } else if (diff > 0) {
    out.status = "under";
    out.headline = `The bill is ${usd(diff)} over the estimate, under the $400 needed for a federal dispute.`;
    out.points = ["You can still ask the provider to explain the difference and to honor the estimate. Many will adjust when asked in writing.", "If other providers billed you for the same care, check each one: the $400 is per provider."];
  } else {
    out.status = "ok";
    out.headline = "The bill isn't higher than the estimate.";
    out.points = ["Nothing to dispute here. Keep the estimate and the bill together in case later charges arrive."];
  }
  return out;
}

// ------------------------------------------------------------------ surprise bills
const NO_WAIVE = "Emergency care, and anesthesia, pathology, radiology, lab, neonatology, assistant surgeon, hospitalist and intensivist services at an in-network hospital or surgery center, are protected even if you signed a waiver.";
export function surpriseCheck(d) {
  const owed = num(d.owed), billed = num(d.billed);
  const kind = d.kind || "emergency";
  if (kind === "other") return { status: "not-covered", headline: "This may not be covered by the surprise-billing law.",
    points: ["The law covers emergency care, out-of-network clinicians at in-network hospitals and surgery centers, and air ambulances. Ground ambulances aren't covered by the federal law, though some states protect them.", "You can still compare the bill with what your insurer says you owe and ask the provider to explain any difference."] };
  if (owed == null || billed == null) return { error: "Enter what your insurer says you owe and what the provider is billing you." };
  const waivable = kind === "facility-other";
  if (waivable && d.waived === "yes") return { status: "waived", headline: "You may have given up this protection.",
    points: ["For some non-emergency care at an in-network facility, a provider can ask you to sign a notice giving up surprise-billing protection, at least 72 hours ahead (or at least 3 hours ahead when the appointment is made less than 72 hours before).", NO_WAIVE, "If the form wasn't given in time, or you weren't given a real choice of an in-network provider, the waiver may not count. The No Surprises Help Desk can tell you."] };
  const extra = r2(billed - owed);
  if (extra <= 1) return { status: "ok", headline: "The bill matches what your insurer says you owe.", points: ["That's what the law allows: your in-network share. Nothing to dispute."] };
  return { status: "surprise", extra, headline: `This looks like a surprise bill: the provider is billing you ${usd(extra)} more than your in-network share.`,
    points: [
      "For care the law protects, you only owe your in-network share (the amount on your insurer's explanation of benefits). The provider and your insurer settle the rest between themselves.",
      "Before paying the extra, call the provider's billing office with your explanation of benefits and ask them to correct the bill. A letter is ready below.",
      `If they won't, contact the No Surprises Help Desk at ${HELP_DESK} or file a complaint online. Keep paying the part you actually owe.`,
      kind === "emergency" ? "Emergency care is protected even if you signed something at the hospital." : kind === "air" ? "Air ambulance flights are protected even when the ambulance company isn't in your network." : NO_WAIVE,
    ] };
}

// ------------------------------------------------------------------ Maryland outpatient facility fees, Health-General 19-349.2
export function mdFeeCheck(d) {
  if (d.er === "yes") return { status: "excluded", headline: "Emergency room charges aren't covered by this Maryland rule.", points: ["The facility fee notice rule covers hospital outpatient clinic visits, not emergency department care or doctors' own fees. The surprise-bill check covers emergency care."] };
  const fee = num(d.fee), noticed = num(d.noticed);
  const missing = d.told === "no" || d.signed === "no";
  if (missing) return { status: "no-notice", fee, headline: `Under Maryland law, the hospital may not charge, bill or collect this facility fee${fee ? ` (${usd(fee)})` : ""}.`,
    points: [
      "Maryland Health-General §19-349.2(g): a hospital can't charge an outpatient facility fee unless you were told about it when you booked (spoken and written notice) and acknowledged it in writing before care.",
      "Write to the hospital's billing office first and ask them to remove the fee. A letter is ready below.",
      "If they don't, file a complaint with Maryland's Health Services Cost Review Commission. It will consider whether giving notice wasn't possible for reasons beyond the hospital's control.",
      "If you have insurance, the fee may have counted toward your deductible or coinsurance. Removing it lowers what you owe.",
    ] };
  if (d.told === "unsure" || d.signed === "unsure") return { status: "unsure", headline: "Check your booking emails and the papers you signed at check-in.",
    points: ["The hospital must send written notice when you book (by email, or by mail if you declined email) and get your written acknowledgment before care. Ask the billing office for a copy of your signed acknowledgment.", "If they can't produce it, the fee can't be charged under §19-349.2(g)."] };
  const out = { status: "noticed", headline: "You were notified, so the fee can be charged.", points: ["The law doesn't cap how far the fee can exceed the notice's estimate; the notice warns it can be higher if you need services nobody could predict."] };
  if (fee != null && noticed != null && fee > noticed) out.points.unshift(`The fee is ${usd(fee - noticed)} more than the notice's estimate. You can ask the hospital what unexpected services caused the difference.`);
  return out;
}

// ------------------------------------------------------------------ cash or insurance
// Insurance: deductible first, then coinsurance (or a flat copay). Cash: the cash price, usually not counted toward the
// deductible. If the deductible will be met this year anyway, deductible dollars paid now are dollars not paid later.
export function cashOrInsurance(d) {
  const cash = num(d.cash), price = num(d.price), left = Math.max(num(d.dedLeft) ?? 0, 0), coins = Math.min(Math.max((num(d.coins) ?? 20) / 100, 0), 1), copay = num(d.copay);
  if (cash == null || price == null) return { error: "Enter the cash price and the price with insurance (the in-network or allowed amount)." };
  let ins, toDed;
  if (copay != null && d.copayAfterDed !== "yes") { ins = Math.min(copay, price); toDed = 0; }
  else { toDed = Math.min(price, left); ins = toDed + (copay != null ? Math.min(copay, price - toDed) : (price - toDed) * coins); }
  ins = r2(ins);
  const later = d.meetDed === "yes" ? r2(toDed * (1 - coins)) : 0; // value of the deductible credit if it would be met anyway
  const effective = r2(ins - later);
  const cheaper = cash < effective - 0.5 ? "cash" : effective < cash - 0.5 ? "insurance" : "same";
  const points = [
    `With insurance: about ${usd(ins)} now${toDed ? `, of which ${usd(toDed)} counts toward your deductible` : ""}.${later ? ` Since you expect to meet your deductible anyway, that credit saves about ${usd(later)} later, so the real cost is about ${usd(effective)}.` : ""}`,
    `Paying cash: ${usd(cash)}. It usually doesn't count toward your deductible or out-of-pocket maximum.`,
    "Paying cash makes you self-pay: tell the provider when you book, ask for a written good faith estimate, and you get the $400 dispute right if the bill comes in higher.",
    "HSA or FSA money can pay either way, as long as it's for medical care.",
  ];
  const headline = cheaper === "cash" ? `Paying cash looks cheaper by about ${usd(effective - cash)}.` : cheaper === "insurance" ? `Using insurance looks cheaper by about ${usd(cash - effective)}.` : "They come out about the same.";
  return { cheaper, ins, cash, effective, toDed, headline, points };
}

// ------------------------------------------------------------------ what we noticed in saved claims
const AIR = /^A043[0-6]$/i;
export function noticed(claims) {
  const surprise = [], md = [];
  for (const c of claims || []) {
    const svc = `${c.service || ""} ${c.type_source || ""}`;
    const er = c.category === "er" || /emergency/i.test(svc);
    const air = AIR.test(c.proc || "") || /air ambulance|rotary wing|fixed wing/i.test(svc);
    if (er || air || c.network === "out") {
      const why = air ? "Air ambulance" : er ? "Emergency care" : "Out-of-network care";
      surprise.push({ id: c.id, date: c.date, provider: c.provider, why, owed: c.member_resp ?? null, kind: air ? "air" : er ? "emergency" : "facility-other" });
    }
    if (c.provider_state === "MD" && c.place === "facility" && !er && c.category !== "rx" && !/inpatient|hospital stay/i.test(svc))
      md.push({ id: c.id, date: c.date, provider: c.provider, owed: c.member_resp ?? null });
  }
  const byDate = (a, b) => (a.date < b.date ? 1 : -1);
  return { surprise: surprise.sort(byDate).slice(0, 8), md: md.sort(byDate).slice(0, 8) };
}

// ------------------------------------------------------------------ letters (plain text the person edits and sends)
const sig = "\n\nSincerely,\n[Your name]\n[Your phone or email]\n";
export function letter(kind, d, res) {
  const acct = `Patient: [Patient name]\nAccount or claim number: [number from the bill]\nDate of service: ${d.date || "[date]"}\n`;
  if (kind === "estimate") return `To the billing office of ${d.provider || "[provider]"}:\n\n${acct}\nBefore my care you gave me a good faith estimate of ${usd(res.estimate)}. Your bill is ${usd(res.billed)}, ${usd(res.diff)} more than the estimate.\n\nPlease send me an itemized bill and explain each charge that was not on the estimate, and adjust the bill to the estimate.${res.status === "dispute" ? " As a self-pay patient, I am entitled to start the federal patient-provider dispute resolution process because the bill is at least $400 more than your estimate. While a dispute is open, the bill may not be sent to collections." : ""}${sig}`;
  if (kind === "surprise") return `To the billing office of ${d.provider || "[provider]"}:\n\n${acct}\nMy insurer's explanation of benefits shows that I owe ${usd(num(d.owed))} for this care. Your bill asks me to pay ${usd(num(d.billed))}.\n\nThis care is protected by the federal No Surprises Act, which limits what I owe to my in-network cost-sharing. Please correct the bill to ${usd(num(d.owed))}. I will pay that amount once the corrected bill arrives. If the bill is not corrected, I will file a complaint with the No Surprises Help Desk.${sig}`;
  if (kind === "md") return `To the billing office of ${d.provider || "[hospital]"}:\n\n${acct}\nYour bill includes an outpatient facility fee${num(d.fee) != null ? ` of ${usd(num(d.fee))}` : ""}. I did not receive the facility fee notice that Maryland law requires when the appointment is scheduled, and I did not sign an acknowledgment before my care.\n\nUnder Maryland Health-General §19-349.2(g), a hospital may not charge, bill, or attempt to collect an outpatient facility fee unless the patient was given that notice. Please remove the facility fee and send me a corrected bill, or send me a copy of the notice and my signed acknowledgment. If it is not removed, I will file a complaint with the Health Services Cost Review Commission.${sig}`;
  return "";
}

// ------------------------------------------------------------------ amounts in an estimate or bill (any layout)
// Lines that carry a total-ish label and a dollar amount, best guesses first.
const TOTAL_WORDS = /\b(total (?:estimated|expected)?\s*(?:cost|charges?|amount)?|estimated total|grand total|amount due|balance due|total due|patient (?:responsibility|balance)|you owe|please pay|new charges|total charges)\b/i;
export function amountsIn(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const l = line.trim(); if (!l) continue;
    const m = [...l.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g)];
    if (!m.length) continue;
    const label = (l.match(TOTAL_WORDS) || [])[0];
    if (!label) continue;
    const value = Number(m[m.length - 1][1].replace(/,/g, ""));
    if (value > 0 && !out.some((o) => o.value === value)) out.push({ label: label.replace(/\s+/g, " "), value, line: l.slice(0, 120) });
  }
  return out.sort((a, b) => (/total/i.test(b.label) - /total/i.test(a.label)) || b.value - a.value).slice(0, 6);
}

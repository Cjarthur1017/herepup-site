// Document readers for the browser version (port of app/parsing.py, app/readers.py, app/fhir_map.py, app/classify.py).
// Everything runs on the user's device. Nothing here makes a network request except loading HerePup's own files.

export const CATEGORIES = ["medical", "office", "specialist", "urgent", "er", "preventive", "rx", "procedure"];
const r2 = (x) => Math.round(x * 100) / 100;
export const newId = () => Math.random().toString(16).slice(2, 10);

export function money(s) {
  if (s == null) return null;
  s = String(s).trim();
  if (!s) return null;
  const neg = s.startsWith("(") || s.startsWith("-");
  const t = s.replace(/[^\d.]/g, "");
  if (!t) return null;
  const v = Number(t);
  if (Number.isNaN(v)) return null;
  return neg ? -v : v;
}

export function normDate(s) {
  s = String(s ?? "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/) || s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  let y, mo, d;
  if (m) { mo = +m[1]; d = +m[2]; y = m[3].length === 2 ? (+m[3] < 69 ? 2000 + +m[3] : 1900 + +m[3]) : +m[3]; }
  else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function classifyText(text) {
  const t = (text || "").toLowerCase();
  if (["pharmacy", "rx", "prescription", "cvs", "walgreens", "express scripts"].some((k) => t.includes(k))) return "rx";
  if (["preventive", "wellness", "annual physical", "immunization", "screening"].some((k) => t.includes(k))) return "preventive";
  return "medical";
}

// ------------------------------------------------------------------ spreadsheets (CSV and Excel)
const ALIASES = {
  date: ["date", "service date", "date of service", "dos", "service_date", "fill date", "date filled"],
  member: ["member", "patient", "patient name", "name", "person", "for", "filled for"],
  provider: ["provider", "provider name", "facility", "rendering provider", "drug name", "drug"],
  pharmacy: ["pharmacy name", "pharmacy"],
  rx_number: ["rx number", "rx #", "rx"],
  category: ["category", "type", "service type", "claim type"],
  billed: ["billed", "amount billed", "charge", "charges", "billed amount"],
  allowed: ["allowed", "allowed amount", "plan allowed", "negotiated amount", "eligible amount"],
  plan_paid: ["plan paid", "my cigna plan paid", "my plan paid", "your plan paid", "plan paid amount", "amount plan paid", "insurance paid amount", "paid", "insurance paid", "plan_paid", "amount paid by plan", "benefit"],
  member_resp: ["you owe", "patient responsibility", "member responsibility", "member_resp", "your cost", "you pay", "member owes"],
};

// Headers worded differently from the exact names above (Aetna: "Provider billed", "Your share/ Your Cost",
// "Provider or facility name", "Prescription name", "Rx cost"). Used only for fields the exact names didn't find,
// and each column is used once. Money first, so "Provider billed" is read as billed, not as the provider.
const PATTERNS = [
  ["allowed", /\b(allowed|negotiated|eligible|discounted|network price)\b/],
  ["billed", /\b(billed|charges?|charged)\b/],
  ["member_resp", /\b(your (share|cost|responsibility|part|portion)|you owe|you pay|paid by (you|member|patient)|(patient|member) (responsibility|owes|share|cost|pays))\b/],
  ["plan_paid", /\b(plan paid|paid by (the )?plan|(insurance|insurer|plan) (paid|pays|payment)|benefit paid|amount paid)\b/],
  ["rx_cost", /\b(rx|drug|prescription|medication) (cost|price|total|amount)\b/],
  ["rx_name", /\b(prescription|drug|medication)( name)?\b/],
  ["provider", /\b(provider|facility|doctor|physician|clinic|practice)\b/],
  ["member", /\b(member|patient|family member|person)\b/],
  ["date", /\bdate of service\b|\b(service|visit|fill|filled) date\b/],
  ["category", /\b(claim type|service type|type|category)\b/],
];
const headKey = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// "Janie (Child)" -> "Janie": the relationship some insurers add to the member's name.
const RELATION = /\s*\((self|subscriber|employee|member|spouse|husband|wife|partner|domestic partner|child|son|daughter|dependent|dependant|other)\)\s*$/i;
export const cleanMember = (s) => String(s || "").trim().replace(RELATION, "").trim();
// "child" or "adult" from that label, so a new person can be added with the right role.
export function relationOf(s) {
  const m = String(s || "").trim().match(RELATION);
  if (!m || /^other$/i.test(m[1])) return "";
  return /child|son|daughter|dependen/i.test(m[1]) ? "child" : "adult";
}

export function csvRecords(text) {
  text = text.replace(/^﻿/, "");
  const out = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => String(c).trim() !== ""));
}

export const inferRxTier = (cost) => { const c = cost || 0; return c <= 40 ? 1 : c <= 120 ? 2 : 3; };

export function parseRecords(records) {
  const head = (records[0] || []).map((h) => String(h ?? "").trim());
  const cols = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = head.findIndex((h) => h && names.includes(h.toLowerCase()));
    if (i >= 0) cols[field] = i;
  }
  const used = new Set(Object.values(cols)), keys = head.map(headKey);
  for (const [field, re] of PATTERNS) {
    if (field in cols) continue;
    const i = keys.findIndex((k, j) => k && !used.has(j) && re.test(k));
    if (i >= 0) { cols[field] = i; used.add(i); }
  }
  const get = (r, f) => (cols[f] == null ? "" : r[cols[f]] ?? "");
  const isRx = "rx_number" in cols || "pharmacy" in cols;
  let rxRows = 0;
  const rows = []; let skipped = 0, derived = 0;
  for (const r of records.slice(1)) {
    const d = normDate(get(r, "date"));
    if (!d) { skipped++; continue; }
    let prov = String(get(r, "provider") || "").trim();
    let cat = String(get(r, "category") || "").trim().toLowerCase();
    let rxDrug = null, pharmacy = null, rxQty = null;
    const rxName = String(get(r, "rx_name") || "").trim(), rxCost = money(get(r, "rx_cost"));
    if (!isRx && (rxName || /pharm|prescription|\brx\b|\bdrug/.test(cat))) { // a prescription row in a mixed file
      cat = "rx"; rxDrug = rxName || prov || null;
      if (rxName) prov = prov ? `${rxName} (${prov})` : rxName;
      rxRows++;
    }
    if (isRx) {
      cat = "rx";
      const q = prov.match(/Quantity:\s*([\d.]+)/i); rxQty = q ? Number(q[1]) : null;
      prov = prov.replace(/\s+Quantity:.*$/, "");
      rxDrug = prov;
      const ph = String(get(r, "pharmacy") || "").trim();
      pharmacy = ph || null;
      prov = ph ? `${prov} (${ph})` : prov;
    }
    let billed = money(get(r, "billed")), allowed = money(get(r, "allowed"));
    const paid = money(get(r, "plan_paid")), owe = money(get(r, "member_resp"));
    if (billed == null && rxCost != null) billed = rxCost;
    if (allowed == null && paid != null && owe != null) { allowed = r2(paid + owe); derived++; }
    else if (allowed == null && rxCost != null && cat === "rx") allowed = rxCost;
    const rxn = String(get(r, "rx_number") || "").trim();
    const rel = relationOf(get(r, "member"));
    const row = { id: isRx && rxn ? "rx-" + rxn : newId(), date: d, member: cleanMember(get(r, "member")), ...(rel ? { relation: rel } : {}), provider: prov,
      category: CATEGORIES.includes(cat) ? cat : classifyText(prov + " " + cat), billed, allowed, plan_paid: paid, member_resp: owe, needs_review: allowed == null };
    if (row.category === "rx") Object.assign(row, { rx_tier: inferRxTier(allowed), rx_drug: rxDrug, pharmacy, rx_qty: rxQty });
    rows.push(row);
  }
  const notes = [];
  if (derived) notes.push(`This file has no allowed amount. Allowed was set to plan paid plus what you owe for ${derived} row(s).`);
  if (rxRows) notes.push(`${rxRows} prescription row(s): the Rx tier (1 generic, 2 preferred brand, 3 non-preferred) is a guess from the price. Change it in the table if you know it.`);
  if (isRx) notes.push("Pharmacy file: the Rx tier (1 generic, 2 preferred brand, 3 non-preferred) is a guess from the price. Change it in the table if you know it.");
  return { rows, skipped, mapped_columns: cols, notes };
}

// Minimal .xlsx reader: unzip with the browser's built-in DecompressionStream, read the first sheet.
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), files = {};
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This Excel file could not be opened.");
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    files[name] = { method, csize, off };
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: Object.keys(files),
    async text(name) {
      const f = files[name]; if (!f) return null;
      const lnl = dv.getUint16(f.off + 26, true), lxl = dv.getUint16(f.off + 28, true);
      const data = u8.subarray(f.off + 30 + lnl + lxl, f.off + 30 + lnl + lxl + f.csize);
      if (f.method === 0) return new TextDecoder().decode(data);
      const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(ds).text();
    },
  };
}

export async function xlsxRecords(buf) {
  const z = await unzip(buf);
  const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
  const ssTxt = await z.text("xl/sharedStrings.xml");
  const shared = ssTxt ? [...xml(ssTxt).getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join("")) : [];
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = await z.text("xl/workbook.xml"), rels = await z.text("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = xml(wb).getElementsByTagName("sheet")[0];
    const rid = first && (first.getAttribute("r:id") || first.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"));
    const rel = [...xml(rels).getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid);
    if (rel) { const t = rel.getAttribute("Target"); sheetPath = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""); }
  }
  const sh = await z.text(sheetPath);
  if (!sh) throw new Error("No worksheet found in this Excel file.");
  const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const out = [];
  for (const row of xml(sh).getElementsByTagName("row")) {
    const cells = [];
    for (const c of row.getElementsByTagName("c")) {
      const t = c.getAttribute("t"), ref = c.getAttribute("r") || "";
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let val = t === "s" ? shared[+v] ?? "" : t === "inlineStr" ? [...c.getElementsByTagName("t")].map((x) => x.textContent).join("") : v;
      cells[ref ? colIdx(ref) : cells.length] = val;
    }
    out.push(Array.from(cells, (x) => x ?? ""));
  }
  // dates stored as Excel serial numbers in a date column -> MM/DD/YYYY
  const head = (out[0] || []).map((h) => String(h).toLowerCase());
  head.forEach((h, i) => {
    if (!h.includes("date")) return;
    for (const r of out.slice(1)) {
      const n = Number(r[i]);
      if (r[i] !== "" && !Number.isNaN(n) && n > 20000 && n < 80000) {
        const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
        r[i] = `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
      }
    }
  });
  return out.filter((r) => r.some((c) => String(c).trim() !== ""));
}

// ------------------------------------------------------------------ PDF text (pdf.js) with OCR for scanned pages
let pdfjs = null;
async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = await import("../vendor/pdfjs/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;
  }
  return pdfjs;
}

function linesFromContent(items) {
  const its = items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: Math.abs(i.transform[3]) || i.height || 8, w: i.width }));
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const ln = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.h, it.h) * 0.45));
    if (ln) ln.items.push(it); else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    let s = "", end = null;
    for (const it of l.items) {
      if (s && (end == null || it.x - end > 0.8)) s += " ";
      s += it.s; end = it.x + it.w;
    }
    return s.replace(/\s+/g, " ").trim();
  }).join("\n");
}

let ocrWorker = null, ocrSeq = 0;
const ocrWaiters = new Map();
function ocr(pngBytes) {
  if (!ocrWorker) {
    ocrWorker = new Worker(new URL("./ocr-worker.js", import.meta.url));
    ocrWorker.onmessage = (e) => { const w = ocrWaiters.get(e.data.id); if (!w) return; ocrWaiters.delete(e.data.id); e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.text); };
    ocrWorker.onerror = (e) => { for (const w of ocrWaiters.values()) w.reject(new Error("The reading engine for scanned pages could not start.")); ocrWaiters.clear(); };
  }
  const id = ++ocrSeq;
  return new Promise((resolve, reject) => { ocrWaiters.set(id, { resolve, reject }); ocrWorker.postMessage({ id, png: pngBytes }, [pngBytes.buffer]); });
}

export async function pdfPages(file, onProgress = () => {}, stopWhen = null) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [], blank = [], layout = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const items = (await pg.getTextContent()).items;
    const t = linesFromContent(items);
    pages.push(t);
    layout.push(items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width })));
    if (t.replace(/\s/g, "").length < 40) blank.push(i);
  }
  let done = 0, err = "", stoppedEarly = 0;
  for (const [k, i] of blank.entries()) {
    if (stopWhen && done && stopWhen(pages)) { stoppedEarly = blank.length - k; break; }
    onProgress(`Reading scanned page ${k + 1} of ${blank.length}...`);
    try {
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: 200 / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      const text = await ocr(new Uint8Array(await blob.arrayBuffer()));
      if (text.trim()) { pages[i - 1] = text; layout[i - 1] = null; done++; }
    } catch (e) { err = e.message; break; }
  }
  await doc.destroy();
  return { pages, layout, scanned_pages: blank.length, ocr_pages: done, unreadable_pages: blank.length - done - stoppedEarly, skipped_pages: stoppedEarly, ocr_error: err };
}

// ------------------------------------------------------------------ Cigna EOB
const ROW = /^(\d{2}\/\d{2}\/\d{2,4})\s+(.+?)\s+((?:-?\$?[\d,]*\.?\d+\s+){8,}-?\$?[\d,]*\.\d{2})(?:\s+[A-Z]{3}.*)?$/;
const ACC = /you have met a total of \$([\d,]+\.\d{2}) toward your \$([\d,]+\.\d{2}) (individual|family) (in|out)(?:-of)?-network (deductible|out-of-pocket maximum)/i;
const SPECIALTY = [["dermatolog", "Dermatology"], ["cardiolog", "Cardiology"], ["orthop", "Orthopedics"], ["ophthalm", "Ophthalmology"], ["otolaryng", "ENT"],
  ["ear, nose", "ENT"], ["gastro", "Gastroenterology"], ["neurolog", "Neurology"], ["oncolog", "Oncology"], ["urolog", "Urology"], ["podiatr", "Podiatry"],
  ["allerg", "Allergy"], ["pulmon", "Pulmonology"], ["endocrin", "Endocrinology"], ["rheumat", "Rheumatology"], ["nephrolog", "Nephrology"],
  ["psychiat", "Psychiatry"], ["obstet", "OB/GYN"], ["gynecol", "OB/GYN"], ["ob/gyn", "OB/GYN"], ["orthodon", "Orthodontics"], ["surgical", "Surgery"],
  ["sports medicine", "Sports medicine"], ["physical therapy", "Physical therapy"], ["chiropract", "Chiropractic"], ["pain management", "Pain management"]];
export function specialtyFromName(s) { const t = (s || "").toLowerCase(); const hit = SPECIALTY.find(([k]) => t.includes(k)); return hit ? hit[1] : null; }

export function eobCategory(service) {
  const s = (service || "").toLowerCase();
  if (["preventive", "wellness", "immuniz", "screening", "annual exam"].some((k) => s.includes(k))) return "preventive";
  if (s.includes("emergency")) return "er";
  if (s.includes("urgent")) return "urgent";
  if (s.includes("specialist")) return "specialist";
  if (s.includes("office")) return "office";
  if (s.includes("pharm") || s.includes("drug")) return "rx";
  return "medical";
}

export function parseCignaEob(pages) {
  const rows = [], observed = {}, unparsed = [];
  let patient = "", claim = "", provider = "", payee = "", n = 0, seen = false;
  for (const page of pages) {
    if (/cigna/i.test(page)) seen = true;
    for (const raw of page.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let m = line.match(/claim received for ([A-Z][A-Za-z'\-]+(?: [A-Z][A-Za-z'\-.]+)*)/i);
      if (m) patient = m[1].trim();
      m = line.match(/paid\s*\$[\d,]+\.\d{2}\s+to\s+(.+?)\.?$/i);
      if (m) payee = m[1].trim();
      m = line.match(/^claim\s*#\s*(\d{6,})/i);
      if (m && m[1] !== claim) { claim = m[1]; n = 0; }
      m = line.match(/^(.+?),?\s+Patient\s*#/);
      if (m) { provider = m[1].trim().replace(/,$/, ""); continue; }
      m = line.match(ROW);
      if (m) {
        const vals = m[3].trim().split(/\s+/).map(money);
        if (vals.length !== 10) { unparsed.push(line); continue; }
        const [billed, , notcov, allowed, copay, ded, liab, , coins, owe] = vals;
        n++;
        rows.push({ id: `eob-${claim || "x"}-${n}`, date: normDate(m[1]), member: patient, provider: provider || "", payee,
          service: m[2].trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), category: eobCategory(m[2]),
          billed, allowed, plan_paid: liab, member_resp: owe, copay, deductible: ded, coinsurance: coins, not_covered: notcov, claim,
          needs_review: Math.abs(allowed - copay - ded - coins - liab) > 0.02 && Math.abs(allowed - owe - liab) > 0.02 });
        continue;
      }
      m = line.match(ACC);
      if (m && m[4].toLowerCase() === "in") {
        const kind = m[5].toLowerCase() === "deductible" ? "ded" : "oop", who = m[3].toLowerCase() === "individual" ? "ind" : "fam";
        observed[`${kind}_${who}_met`] = money(m[1]); observed[`${kind}_${who}`] = money(m[2]);
      } else if (/^\d{2}\/\d{2}\/\d{2,4}\b/.test(line) && (line.match(/-?\$?[\d,]*\.\d{2}/g) || []).length >= 3) unparsed.push(line);
    }
  }
  const all = pages.join("\n");
  const place = /place of service:\s*non-?\s?facility/i.test(all) ? "office" : /place of service:\s*facility/i.test(all) ? "facility" : "";
  rows.forEach((r) => { r.place = place; });
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const hasObs = Object.keys(observed).length > 0;
  if (hasObs) observed.as_of = dates.length ? dates[dates.length - 1] : null;
  return { rows, observed: hasObs ? observed : null, unparsed_dated_lines: unparsed.slice(0, 20), looks_like_cigna: seen };
}

// ------------------------------------------------------------------ claims printed as labeled cards
// Claim-viewer pages saved as PDF (for example MyFlexpa's Explanation of Benefits page) show each claim as a card of
// "Label" / value pairs with a Totals block ("Eligible Amount $183.98 USD", "Member liability $0.00 USD"...).
const CARD_START = /^(professional|institutional|pharmacy|oral|vision|medical|dental)\b[^$]*?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})$/i;
const TOTALS = [["billed", /^(submitted|billed|total charges?)( amount)?$/i], ["allowed", /^(eligible|allowed)( amount)?$/i],
  ["benefit", /^(benefit|plan paid)( amount)?$/i], ["paid_by_payer", /^paid by payer$/i], ["paid_to_provider", /^paid to provider$/i],
  ["member_resp", /^(member liability|patient responsibility|you owe)$/i], ["owed_by_patient", /^owed by patient$/i],
  ["coinsurance", /^co-?insurance$/i], ["copay", /^co-?pay(ment)?$/i], ["deductible", /^deductible$/i], ["not_covered", /^non-?covered|not covered$/i],
  ["discount", /^discount$/i], ["drug_cost", /^drug cost$/i]];
export function parseLabeledEob(pages) {
  const lines = pages.join("\n").split("\n").map((l) => l.trim()).filter((l) => l
    && !/^\d{1,2}\/\d{1,2}\/\d{2,4},? \d{1,2}:\d{2}\s*[AP]M\b/i.test(l) && !/^https?:\/\/\S+(\s+\d+\/\d+)?$/i.test(l));
  const cards = []; let cur = null;
  for (const l of lines) {
    if (CARD_START.test(l) && !/\$/.test(l)) { cur = { head: l, lines: [] }; cards.push(cur); continue; }
    if (cur) cur.lines.push(l);
  }
  const rows = [];
  cards.forEach((c, ci) => {
    const L = c.lines, after = (re, k = 1) => { const i = L.findIndex((x) => re.test(x)); return i >= 0 ? L[i + k] || "" : ""; };
    const tot = {};
    for (const l of L) {
      const m = l.match(/^(.+?)\s+(-?)\$\s?([\d,]+\.\d{2})(?:\s*USD)?$/i);
      if (!m) continue;
      const hit = TOTALS.find(([, re]) => re.test(m[1].trim()));
      if (hit && tot[hit[0]] == null) tot[hit[0]] = (m[2] ? -1 : 1) * Number(m[3].replace(/,/g, ""));
    }
    if (tot.allowed == null && tot.billed == null) return;
    // Provider: the care team's named provider or organization, else the left half of the "Provider Insurer" line.
    let provider = "";
    const ct = L.findIndex((x) => /^care team$/i.test(x));
    if (ct >= 0) for (let k = ct + 1; k < Math.min(ct + 6, L.length); k++) { if (/^(provider|organization|practitioner)$/i.test(L[k])) continue; provider = L[k]; break; }
    if (!provider || /^(npi|role|not provided)/i.test(provider)) provider = after(/^(provider|organization)\s+insurer$/i).replace(/\s+(cigna|aetna|anthem|united|humana|blue|kaiser|elevance|wellcare|ambetter)\b.*$/i, "");
    const dates = (after(/^billable start/i).match(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/g) || []);
    const date = normDate(dates[0] || (c.head.match(CARD_START) || [])[2] || "");
    const member = after(/^patient$/i);
    const descs = L.map((x, i) => (/^description$/i.test(x) ? L[i + 1] : null)).filter((x) => x && !/^see details$/i.test(x));
    const codes = L.map((x, i) => (/^code$/i.test(x) && /^[A-Z0-9]{4,6}$/.test(L[i + 1] || "") ? L[i + 1] : null)).filter(Boolean);
    const service = [...new Set(descs)].slice(0, 2).map((d) => d.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase())).join(", ");
    const type = c.head.split(/\s/)[0].toLowerCase();
    // Viewers often list every adjudication category, most of them $0; take the first one that carries the amount.
    const firstOf = (...ks) => { const v = ks.map((k) => tot[k]).filter((x) => x != null); return v.find((x) => x !== 0) ?? (v.length ? 0 : null); };
    const paid = firstOf("benefit", "paid_by_payer", "paid_to_provider");
    const owe = firstOf("member_resp", "owed_by_patient");
    let allowed = tot.allowed ?? null;
    if (allowed == null && paid != null && owe != null) allowed = r2(paid + owe);
    const id = (L[L.findIndex((x) => /^unique claim id$/i.test(x)) + 2] || "").replace(/\W/g, "") || `card${ci + 1}`;
    rows.push({ id: `card-${id}`, date, member, provider, payee: "", service: service || (type[0].toUpperCase() + type.slice(1)),
      category: type === "pharmacy" ? "rx" : eobCategory(service), billed: tot.billed ?? null, allowed, plan_paid: paid, member_resp: owe,
      copay: tot.copay ?? null, deductible: tot.deductible ?? null, coinsurance: tot.coinsurance ?? null, not_covered: tot.not_covered ?? null,
      place: "", claim: id, ...(codes[0] ? { proc: codes[0] } : {}),
      needs_review: allowed == null || (paid != null && owe != null && Math.abs(allowed - paid - owe) > Math.max(1, allowed * 0.02)) });
  });
  const shown = (pages.join("\n").match(/showing\s+\d+\s+to\s+(\d+)\s+of\s+(\d+)/i) || []);
  const notes = shown[2] && +shown[2] > +shown[1] ? [`This printout shows ${shown[1]} of ${shown[2]} claims. To bring in all of them, download the JSON file from the same page (Download JSON) and drop that here instead.`] : [];
  return { rows, notes, cards: cards.length };
}

// generic EOB fallback: a dated line with 3+ amounts, with a column order the member can change
const DEFAULT_ORDERS = { 4: ["billed", "allowed", "plan_paid", "member_resp"], 5: ["billed", "discount", "allowed", "plan_paid", "member_resp"],
  6: ["billed", "discount", "allowed", "plan_paid", "deductible_coins", "member_resp"] };
export function parseEobText(text, order) {
  const MONEY = /-?\$?\(?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?|-?\$?\(?\d+\.\d{2}\)?/g;
  const rows = [], unparsed = []; let member = "";
  for (let line of text.split("\n")) {
    line = line.trim(); if (!line) continue;
    const pm = line.match(/^(?:patient|member|name|claim for)\s*[:\-]\s*(.+)$/i);
    if (pm) { member = pm[1].trim(); continue; }
    const dm = line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
    const amts = line.match(MONEY) || [];
    if (dm && amts.length >= 3) {
      const first = line.indexOf(amts[0]);
      const desc = line.slice(dm[0].length, first).replace(/^[\s\-|]+|[\s\-|]+$/g, "");
      const vals = amts.map(money);
      const ord = order || DEFAULT_ORDERS[vals.length] || DEFAULT_ORDERS[Math.min(vals.length, 6)];
      const row = { id: newId(), date: normDate(dm[0]), member, provider: desc, category: classifyText(desc), billed: null, allowed: null, plan_paid: null, member_resp: null, raw_amounts: vals, needs_review: true };
      (ord || []).forEach((name, i) => { if (["billed", "allowed", "plan_paid", "member_resp"].includes(name) && i < vals.length) row[name] = vals[i]; });
      rows.push(row);
    } else if (dm) unparsed.push(line);
  }
  return { rows, unparsed_dated_lines: unparsed.slice(0, 20), column_order_used: order || "auto" };
}

// ------------------------------------------------------------------ benefit guides: every plan option
const TIER_PATTERNS = [
  ["ee_ch", /^(parent\s*\+\s*child(?:ren)?|you\s*\+\s*(?:your\s*)?child(?:\(?ren\)?)?|employee\s*\+\s*child(?:ren)?|employee and child(?:ren)?)\b/i],
  ["ee_sp", /^(couple|you\s*\+\s*(?:your\s*)?spouse|employee\s*\+\s*(?:spouse|partner)|employee and spouse)\b/i],
  ["family", /^(family|you\s*\+\s*(?:your\s*)?family|employee\s*\+\s*family|employee and family)\b/i],
  ["ee", /^(single|yourself only|employee only|employee|you only|individual)\b/i],
];
// Coverage-level label at the start of a row ("Employee + Spouse/DP + Child $1,050 ..."). Finer than HerePup's four levels;
// fourTiers() folds them back. Labels longer than a short phrase are prose, not table rows.
function tierOf(line) {
  const head = line.split("$")[0].toLowerCase().replace(/child\s?\(ren\)/g, "children").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().replace(/ (coverage|tier|only coverage)$/, "");
  if (!head || head.length > 48 || !/^(you|employee|parent|single|individual|yourself|couple|family)\b/.test(head)) return null;
  const spouse = /\b(spouse|partner|sp|dp)\b|\bsp\/dp\b/.test(head), child = /\bchild/.test(head);
  if (/^family\b|^(you|employee)(?: ?\+ ?| and )(?:your )?family\b/.test(head)) return "family";
  if (spouse && child) return "ee_sp_ch";
  if (spouse || /^couple\b/.test(head)) return "ee_sp";
  if (child || /^parent\b/.test(head)) return /children|child ?\(ren\)/.test(head) ? "ee_children" : "ee_child";
  if (/^(single|individual|yourself only|employee only|you only|employee|you|ee only)$/.test(head)) return "ee";
  return null;
}
function fourTiers(rows) {
  const out = {};
  if (rows.ee) out.ee = rows.ee;
  if (rows.ee_sp) out.ee_sp = rows.ee_sp;
  if (rows.ee_children || rows.ee_child) out.ee_ch = rows.ee_children || rows.ee_child;
  if (rows.family || rows.ee_sp_ch) out.family = rows.family || rows.ee_sp_ch;
  return out;
}
const NET = /\b(In|Out[- ]of)[- ]Network\b/gi;
const COPAY_ROWS = [["office", /^office visit/i],["specialist", /^(?:outpatient )?specialist visit/i], ["urgent", /^urgent care/i], ["er", /^emergency room/i]];
const moneyList = (s) => [...s.matchAll(/\$\s?(\d[\d,]*(?:\.\d\d)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));

function findNames(lines, upto, n) {
  for (let k = upto; k >= 0; k--) {
    const names = [...lines[k].matchAll(/(?:[A-Z][\w\-]*\s+)+?Plan\b/g)].map((m) => m[0].replace(/^Medical\s+/, "").trim());
    if (names.length >= n) return names.slice(0, n);
  }
  for (let k = upto; k >= 0; k--) {
    const names = [];
    for (const m of lines[k].matchAll(/\b(EPO|PPO|HMO|POS|HDHP(?: with HSA)?|HSA)\b/g)) if (!names.includes(m[1])) names.push(m[1]);
    if (names.length >= n) return names.slice(0, n);
  }
  return Array.from({ length: n }, (_, i) => `Plan ${i + 1}`);
}

function periods(text) {
  const m = text.match(/(\d{2})\s+pay\s*periods/i);
  if (m) return [+m[1], `${m[1]} pay periods`];
  for (const [re, k, label] of [[/bi-?\s?weekly/i, 26, "bi-weekly"], [/semi-?monthly/i, 24, "semi-monthly"], [/\bweekly\b/i, 52, "weekly"], [/per month|monthly/i, 12, "monthly"]])
    if (re.test(text)) return [k, label];
  return [null, ""];
}

export function employerGuess(pages, filename = "") {
  for (const page of pages.slice(0, 4)) for (const line of page.split("\n")) {
    const m = line.trim().match(/^(.{2,60}?)\s+(?:20\d\d\s+)?Benefits?\s+Guide/i);
    if (m && m[1].split(/\s+/).length <= 6) return m[1].trim();
  }
  const stem = filename.replace(/\.[^.]+$/, "").replace(/\b3rd[_\- ]?party|(?:^|[_\- ])(?:19|20)\d\d(?=$|[_\- ])/gi, " ");
  return stem ? stem.split(/[_\- ]?benefit/i)[0].replace(/^[\s_-]+|[\s_-]+$/g, "").replace(/_/g, " ") : "";
}

// Services rows of a comparison table read by position, so wrapped cells ("$20 copay (primary)" over "$30 copay
// (specialist)") stay with their plan's column. Returns per plan: copays, whether they apply after the deductible,
// the in-network coinsurance from a "You pay 20% after deductible" cell, or a "then 15%" rate after a copay.
function servicesByColumn(items, names) {
  if (!items || !items.length) return null;
  const hdr = names.map((nm) => items.find((it) => it.s.trim() === nm) || items.find((it) => it.s.includes(nm)));
  if (hdr.some((h) => !h)) return null;
  const ctr = hdr.map((h) => h.x + h.w / 2);
  if (ctr.some((c, i) => i && c <= ctr[i - 1])) return null;
  const labelMax = ctr[0] - (ctr.length > 1 ? (ctr[1] - ctr[0]) / 2 : 60);
  const below = items.filter((it) => it.y < Math.min(...hdr.map((h) => h.y)) - 2);
  const labels = [];
  for (const it of below.filter((i) => i.x + i.w / 2 < labelMax).sort((a, b) => b.y - a.y)) {
    const prev = labels[labels.length - 1];
    if (prev && prev.y - it.y < 9) prev.s += " " + it.s; else labels.push({ y: it.y, s: it.s });
  }
  const out = names.map(() => ({ copays: {}, after: false, coins: null, then: null }));
  let seen = false;
  labels.forEach((lb, li) => {
    const key = (COPAY_ROWS.find(([, re]) => re.test(lb.s.trim())) || [])[0];
    if (!key) return;
    const top = li ? (labels[li - 1].y + lb.y) / 2 : lb.y + 12;
    const bot = li < labels.length - 1 ? (lb.y + labels[li + 1].y) / 2 : lb.y - (top - lb.y);
    const cells = [];
    for (const it of below.filter((i) => i.y < top && i.y >= bot && i.x + i.w / 2 >= labelMax).sort((a, b) => b.y - a.y || a.x - b.x)) {
      const c = it.x + it.w / 2;
      const cell = cells.find((k) => Math.abs(k.c - c) < 25);
      if (cell) cell.s += " " + it.s; else cells.push({ c, s: it.s });
    }
    names.forEach((_, k) => {
      const mine = cells.filter((cl) => ctr.reduce((b, x, j) => (Math.abs(x - cl.c) < Math.abs(ctr[b] - cl.c) ? j : b), 0) === k).sort((a, b) => a.c - b.c);
      if (!mine.length) return;
      const s = mine[0].s.replace(/\s+/g, " "), o = out[k];
      seen = true;
      for (const m of s.matchAll(/\$\s?(\d[\d,]*)(?:\.\d\d)?\s*co-?pay(?:ment)?\s*(?:\(([^)]*)\))?/gi)) {
        const k2 = /specialist/i.test(m[2] || "") ? "specialist" : key;
        if (o.copays[k2] == null) o.copays[k2] = Number(m[1].replace(/,/g, ""));
        if (/after\s+(?:the\s+)?deductible/i.test(s)) o.after = true;
      }
      const then = s.match(/then\s+(\d{1,2})\s?%/i);
      if (then && o.then == null) o.then = +then[1] / 100;
      const pc = s.match(/(\d{1,2})\s?%\s+(?:coinsurance\s+)?after/i);
      if (pc && !/co-?pay/i.test(s) && o.coins == null && (key === "office" || key === "specialist")) o.coins = +pc[1] / 100;
    });
  });
  return seen ? out : null;
}

// ------------------------------------------------------------------ prescription tables in any layout
// Reads drug tiers wherever a guide puts them: a section per plan ("Prescription Drug Coverage for the X Plan"),
// a table whose columns are plan names (repeated for retail and mail order), or rows inside the comparison table.
// Cells can be copays ("$8 copay"), coinsurance ("30%", with "($30 min/$100 max)"), "No charge" or "Not covered".
const RX_TIERS = [[0, /^(?:preferred\s+)?generic(?:s| drugs?)?\b|^tier\s*1\b/i], [3, /^specialty\b|^tier\s*[45]\b/i],
  [2, /^non[- ]?preferred\b|^non[- ]?formulary\b|^tier\s*3\b/i], [1, /^(?:preferred\s+)?brand\b|^preferred\b|^formulary brand\b|^tier\s*2\b/i]];
const rxTierOf = (l) => { const hit = RX_TIERS.find(([, re]) => re.test(l)); return hit ? hit[0] : null; };
const shortName = (nm) => nm.replace(/\b(plans?|health savings|option)\b/gi, " ").replace(/\s+/g, " ").trim() || nm;
const undouble = (l) => l.replace(/\b([A-Za-z][\w-]{1,30}?)\1\b/g, "$1");
function planMentions(l, plans) {
  const hits = [];
  plans.forEach((p, i) => {
    for (const nm of [p.name, shortName(p.name)]) {
      const re = new RegExp(`(?<![A-Za-z])${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "g");
      const found = [...l.matchAll(re)].map((m) => [m.index, i, m[0].length]);
      if (found.length) { hits.push(...found); break; }
    }
  });
  return hits.sort((a, b) => a[0] - b[0]).filter((h, k, arr) => !k || h[0] >= arr[k - 1][0] + arr[k - 1][2]);
}
function rxCells(text) {
  const mm = [...text.matchAll(/\$\s?(\d[\d,]*)\s*min(?:imum)?\s*(?:\/|,|and)?\s*\$\s?(\d[\d,]*)\s*max(?:imum)?/gi)].map((m) => [+m[1].replace(/,/g, ""), +m[2].replace(/,/g, "")]);
  let rest = text.replace(/\$\s?\d[\d,]*\s*min(?:imum)?\s*(?:\/|,|and)?\s*\$\s?\d[\d,]*\s*max(?:imum)?/gi, " ");
  // A cap on its own: "($100 max)", "up to $250", "maximum $150".
  const capOnly = [];
  rest = rest.replace(/\$\s?(\d[\d,]*)\s*max(?:imum)?\b|(?:up to|max(?:imum)?(?: of)?)\s*\$\s?(\d[\d,]*)/gi, (_, a, b) => { capOnly.push(+(a || b).replace(/,/g, "")); return " "; });
  const planPays = /plan pays/i.test(rest);
  const cells = [], ms = [...rest.matchAll(/\$\s?(\d[\d,]*(?:\.\d\d)?)|(\d{1,3})\s?%|\b(no charge|not covered|n\/a)\b/gi)];
  ms.forEach((m, j) => {
    // "after deductible" written in the cell itself applies to that plan only.
    const tail = rest.slice(m.index + m[0].length, j + 1 < ms.length ? ms[j + 1].index : undefined);
    const after = /after\s+(?:the\s+)?(?:annual\s+)?deductible|deductible\s+(?:applies|first)/i.test(tail);
    if (m[1] != null) cells.push({ copay: Number(m[1].replace(/,/g, "")), after });
    else if (m[2] != null) { const v = +m[2] / 100; cells.push({ coins: planPays ? r2(1 - v) : v, after }); }
    else cells.push(/no charge/i.test(m[3]) ? { copay: 0, after } : null);
  });
  let k = 0;
  for (const c of cells) if (c && c.coins != null && mm[k]) { [c.min, c.max] = mm[k]; k++; }
  k = 0;
  for (const c of cells) if (c && c.coins != null && c.max == null && capOnly[k] != null) { c.max = capOnly[k]; k++; }
  return cells;
}
function readRx(pages, plans) {
  const n = plans.length, res = plans.map(() => ({ tiers: [], after: false, oopInd: 0, oopFam: 0 }));
  const FILLER = /\b(retail|home delivery|mail(?: order| service)?|pharmacy|supply|day|up to|\d+|in-network|out-of-network|copays?|coinsurance|you pay|and|plans?|health savings|the|for)\b|[()\-–,:/&]/gi;
  for (const page of pages) {
    const ls = page.split("\n").map((x) => undouble(x.trim())).filter(Boolean);
    let ctx = null, oop = false;
    for (let li = 0; li < ls.length; li++) {
      const l = ls[li], tier = rxTierOf(l), ment = tier == null ? planMentions(l, plans) : [];
      if (ment.length) {
        const rest = ment.reduceRight((s, [at, , len]) => s.slice(0, at) + " " + s.slice(at + len), l).replace(FILLER, " ").trim();
        if (/prescription|pharmac|\brx\b|drug/i.test(l) && !rest.match(/[$%]/)) { ctx = { plans: [...new Set(ment.map((h) => h[1]))], cols: null, after: false }; oop = false; continue; }
        if (!rest) { ctx = ctx || { plans: [...new Set(ment.map((h) => h[1]))], after: false }; ctx.cols = ment.map((h) => h[1]); continue; }
      }
      if (ctx && tier == null && !rxCells(l).length && /after\s+(?:the\s+)?(?:annual\s+)?deductible|deductible\s+(?:is\s+)?met|count toward (?:both )?the (?:medical )?(?:plan )?(?:annual )?deductible/i.test(l)) ctx.after = true;
      if (/(prescription|pharmacy|rx|drug)[^$]*out[- ]of[- ]pocket/i.test(l) && !moneyList(l).length) { oop = true; continue; }
      if (oop) {
        const t = tierOf(l), v = moneyList(l);
        const fam = /^all other (?:tiers|levels|coverage)/i.test(l) || t === "family";
        if ((t || fam) && v.length) {
          const who = ctx && ctx.plans.length === 1 ? ctx.plans : v.length === n ? plans.map((_, i) => i) : [];
          who.forEach((pi, j) => { const x = who.length === 1 ? v[0] : v[j]; if (t === "ee") res[pi].oopInd = res[pi].oopInd || x; else if (fam) res[pi].oopFam = res[pi].oopFam || x; });
          continue;
        }
        if (!/^\d+$/.test(l)) oop = false;
      }
      if (tier == null) continue;
      let text = l.replace(RX_TIERS.find(([t]) => t === tier)[1], "");
      for (let k = li + 1; k < Math.min(li + 4, ls.length); k++) {
        const nx = ls[k];
        if (rxTierOf(nx) != null || planMentions(nx, plans).length || /^annual\b|out[- ]of[- ]pocket/i.test(nx)) break;
        const hasCells = rxCells(nx.replace(/\$\s?\d[\d,]*\s*min[^$]*\$\s?\d[\d,]*\s*max/gi, "")).length;
        if (hasCells && rxCells(text).length) break;
        text += " " + nx;
      }
      const cells = rxCells(text);
      if (!cells.length) continue;
      let pairs = [];
      if (ctx && ctx.cols) { const g = new Set(ctx.cols).size; pairs = ctx.cols.slice(0, g).map((pi, j) => [pi, cells[j]]); }
      else if (ctx && ctx.plans.length === 1) pairs = [[ctx.plans[0], cells[0]]];
      else if (ctx && cells.length === ctx.plans.length) pairs = ctx.plans.map((pi, j) => [pi, cells[j]]);
      else if (cells.length === n || n === 1) pairs = plans.map((_, i) => [i, cells[i]]);
      for (const [pi, c] of pairs) {
        if (c === undefined || res[pi].tiers[tier] !== undefined) continue;
        res[pi].tiers[tier] = c;
        if ((ctx && ctx.after) || (c && c.after)) res[pi].after = true;
      }
    }
  }
  return res;
}

export function detectPlans(pages, filename = "", layout = null) {
  const notes = [];
  let best = null;
  pages.forEach((text, pi) => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    let dedI = [], dedF = [], oopI = [], oopF = [], first = null;
    // Second layout: a heading row ("Annual Deductible") followed by one row per coverage level, sometimes with
    // separate in- and out-of-network columns per plan ("In-Network In-Network Out-of-Network ...").
    let section = null, cols = null;
    const table = { ded: {}, oop: {} };
    lines.forEach((l, li) => {
      const low = l.toLowerCase();
      const net = l.match(NET);
      if (net && net.length >= 2 && !l.replace(NET, "").trim()) { cols = net.map((t) => (/^in/i.test(t) ? "in" : "out")); return; }
      const isDed = low.includes("deductible") && !low.includes("pharmacy") && !low.includes("rx") && !low.startsWith("tier") && !low.startsWith("prescription");
      const isOop = (low.includes("out-of-pocket") || low.includes("out of pocket")) && !low.startsWith("tier") && !low.startsWith("prescription");
      if ((isDed || isOop) && !moneyList(l).length && l.length <= 60) {
        section = /prescription|drug|pharmacy|\brx\b/i.test(l) ? null : isDed ? "ded" : "oop";
        if (section && first == null) first = li;
        return;
      }
      if (section && !isDed && !isOop) {
        const t = tierOf(l);
        let vals = t ? moneyList(l) : [];
        if (vals.length && cols && cols.length === vals.length && cols.includes("out")) vals = vals.filter((_, i) => cols[i] === "in");
        if (vals.length && !table[section][t]) table[section][t] = vals;
        return;
      }
      if (!isDed && !isOop) return;
      const pairs = [...l.matchAll(/\$\s?([\d,]+)\s*individual\s*\/\s*\$\s?([\d,]+)\s*family/gi)];
      let a, b;
      if (pairs.length) { a = pairs.map((p) => Number(p[1].replace(/,/g, ""))); b = pairs.map((p) => Number(p[2].replace(/,/g, ""))); }
      else if (low.includes("individual") && moneyList(l).length) a = moneyList(l);
      else if (low.includes("family") && moneyList(l).length) b = moneyList(l);
      else return;
      if (isDed) { if (a) dedI = a; if (b) dedF = b; } else { if (a) oopI = a; if (b) oopF = b; }
      if (first == null) first = li;
    });
    const fam = (t) => t.family || t.ee_sp_ch || [];
    if (!dedI.length && table.ded.ee) { dedI = table.ded.ee; dedF = fam(table.ded); }
    if (!oopI.length && table.oop.ee) { oopI = table.oop.ee; oopF = fam(table.oop); }
    const n = Math.max(dedI.length, dedF.length, oopI.length, oopF.length);
    if (n && dedI.length && oopI.length && (!best || n > best.n)) best = { n, pi, lines, first, dedI, dedF, oopI, oopF, cols: cols && cols.includes("out") ? cols : null };
  });
  if (!best) return { plans: [], employer: employerGuess(pages, filename), notes: ["No plan comparison table (deductible and out-of-pocket by plan) was found in this document."] };
  const { n, pi, lines, first, dedI, dedF, oopI, oopF } = best;
  const names = findNames(lines, first, n);
  const text = lines.join("\n");
  const zero = () => ({ ee: 0, ee_sp: 0, ee_ch: 0, family: 0 });
  const plans = names.map((name, i) => {
    const di = dedI[i] ?? 0, df = dedF[i] ?? 2 * di, oi = oopI[i] ?? 0, of = oopF[i] ?? 2 * oi;
    const hsa = /HDHP|HSA|health savings/i.test(name);
    return { name, deductible_ind: di, deductible_fam: df, oop_ind: oi, oop_fam: of,
      coinsurance: /coinsurance\s+100\s?%|100\s?%\s+after\s+deductible/i.test(text) ? 0 : 0.2,
      embedded: true, hsa_eligible: hsa, hsa_answered: !hsa, rx_in_deductible: hsa, copay_after_ded: false, copays: {}, rx_copays: [],
      rx_deductible_ind: 0, rx_deductible_fam: 0, premium_annual: zero(), hsa_employer: zero(),
      flags: ["Individual deductible assumed to sit inside the family one (embedded). Confirm in your plan document."] };
  });
  if (best.cols) notes.push("The plan table has separate in- and out-of-network columns; HerePup used the in-network amounts.");
  // Coinsurance from a "You pay 20% after deductible" row; with in/out columns, percentages line up with the rightmost columns
  // (a plan without that row, like a copay plan, leaves its cell blank or worded).
  let pos = null;
  if (layout) for (const k of [pi, pi + 1]) { pos = servicesByColumn(layout[k], names); if (pos) break; }
  if (pos) pos.forEach((r, i) => {
    if (r.coins != null) plans[i].coinsurance = r.coins;
    else if (r.then != null) { plans[i].coinsurance = r.then; plans[i].flags.push(`Coinsurance of ${Math.round(r.then * 100)}% was taken from a "copay, then ${Math.round(r.then * 100)}%" row; the guide doesn't state this plan's general coinsurance. Check it.`); }
    else plans[i].flags.push("Coinsurance for this plan wasn't found in the comparison table; 20% is assumed. Check it.");
  });
  const C = best.cols ? best.cols.length : n;
  if (!pos) for (const l of [...lines, ...(pages[pi + 1] || "").split("\n").map((x) => x.trim())]) {
    const pc = [...l.matchAll(/(\d{1,2})\s?%\s+(?:coinsurance\s+)?after\b/gi)].map((m) => +m[1] / 100);
    if (pc.length < 2 || pc.length > C || (!best.cols && pc.length !== n)) continue;
    const hit = [];
    pc.forEach((v, j) => {
      const c = C - pc.length + j;
      if (best.cols && best.cols[c] !== "in") return;
      const k = best.cols ? best.cols.slice(0, c).filter((x) => x === "in").length : c;
      if (plans[k]) { plans[k].coinsurance = v; hit.push(k); }
    });
    plans.forEach((p, i) => { if (!hit.includes(i)) p.flags.push("Coinsurance for this plan wasn't found in the comparison table; 20% is assumed. Check it."); });
    break;
  }
  const allLines = pages.flatMap((p) => p.split("\n").map((l) => l.trim()).filter(Boolean));
  const after = Array(n).fill(0), got = Array(n).fill(0);
  for (const [key, re] of COPAY_ROWS) {
    for (const l of allLines) {
      if (!re.test(l)) continue;
      const tail = l.includes("$") ? l.slice(l.indexOf("$")) : "";
      const cells = [...tail.matchAll(/\$\s?(\d[\d,]*)(?:\.\d\d)?(?:\s+co-?pay(?:ment)?)?(\s+after\s+deductible(?:\s+is\s+met)?)?/gi)];
      if (cells.length === n) {
        cells.forEach((c, i) => { plans[i].copays[key] = Number(c[1].replace(/,/g, "")); got[i]++; if (c[2]) after[i]++; });
        break;
      }
    }
  }
  if (pos) pos.forEach((r, i) => {
    for (const [k, v] of Object.entries(r.copays)) if (plans[i].copays[k] == null) { plans[i].copays[k] = v; got[i]++; if (r.after) after[i]++; }
  });
  plans.forEach((p, i) => {
    p.copay_after_ded = !!(got[i] && after[i] * 2 >= got[i]);
    if (!got[i]) p.flags.push("No flat copays found for visits. The plan is modeled as deductible then coinsurance.");
  });
  let rxFound = false;
  for (const l of allLines) {
    if (!/^rx retail/i.test(l)) continue;
    const trips = [...l.matchAll(/\$\s?(\d+)\s*\/\s*\$\s?(\d+)\s*\/\s*\$\s?(\d+)/g)];
    if (trips.length === n) { trips.forEach((t, i) => { plans[i].rx_copays = [+t[1], +t[2], +t[3]]; }); rxFound = true; break; }
  }
  if (!rxFound) {
    const tiers = {}; let cur = null;
    for (const l of allLines) {
      const m = l.match(/^tier\s*(\d)\b/i);
      if (m) { cur = +m[1]; tiers[cur] = l; }
      else if (cur && !/^(prescription drugs|limitations|for all prescription)/i.test(l)) tiers[cur] += " " + l;
      else cur = null;
    }
    const cop = {};
    for (const t of [1, 2, 3]) {
      const blk = tiers[t] || "";
      const amts = [...blk.matchAll(/\$\s?(\d+)\s*copay/gi)].map((m) => +m[1]);
      if (amts.length === n) cop[t] = [amts, (blk.match(/deductible/gi) || []).length];
    }
    if (Object.keys(cop).length === 3) {
      plans.forEach((p, i) => {
        p.rx_copays = [1, 2, 3].map((t) => cop[t][0][i]);
        const dn = cop[1][1];
        if (dn && i >= n - dn) { p.rx_in_deductible = true; p.copay_after_ded = true; }
      });
      rxFound = true;
    }
  }
  if (rxFound) {
    allLines.forEach((l0, li) => {
      if (!/pharmacy deductible/i.test(l0)) return;
      const l = li && allLines[li - 1].toLowerCase().includes("person") ? allLines[li - 1] + " " + l0 : l0;
      const cells = [...l.matchAll(/\$\s?([\d,]+)\s*(?:person|individual)\s*\/\s*\$\s?([\d,]+)\s*family|(N\/A)/gi)];
      if (cells.length === n) cells.forEach((c, i) => { if (c[1]) { plans[i].rx_deductible_ind = Number(c[1].replace(/,/g, "")); plans[i].rx_deductible_fam = Number(c[2].replace(/,/g, "")); plans[i].rx_in_deductible = false; } });
    });
    plans.forEach((p) => p.flags.push("Specialty drug tiers (4 and 5) are not modeled; tier 1-3 copays are. Rx tier per fill is a guess until you set it."));
  } else {
    const rx = readRx(pages, plans);
    plans.forEach((p, i) => {
      const r = rx[i], tiers = Array.from({ length: r.tiers.length }, (_, t) => r.tiers[t] || {});
      if (!tiers.some((t) => t.copay != null || t.coins != null)) {
        p.flags.push("Prescription costs were not found. Prescriptions are modeled with the medical deductible and coinsurance.");
        return;
      }
      p.rx_tiers = tiers.map((t) => ({ copay: t.copay ?? null, coins: t.coins ?? null, min: t.min ?? null, max: t.max ?? null }));
      if (r.oopInd) { p.rx_oop_ind = r.oopInd; p.rx_oop_fam = r.oopFam || 2 * r.oopInd; }
      if (r.after) p.rx_in_deductible = true;
      else if (r.oopInd || tiers.every((t) => t.coins == null)) p.rx_in_deductible = false;
      const miss = ["generic", "preferred brand", "non-preferred brand"].filter((_, t) => !tiers[t] || (tiers[t].copay == null && tiers[t].coins == null));
      p.flags.push(`Drug costs were read from the guide${r.oopInd ? `, with a separate prescription out-of-pocket maximum of ${r.oopInd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} per person` : ""}. ${miss.length ? `The ${miss.join(" and ")} tier wasn't found, so it uses the medical deductible and coinsurance. ` : ""}Which tier each fill falls in is a guess until you set it.`);
    });
  }
  let premFound = false, premiumChoice = null;
  for (const page of pages) {
    const pl = page.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!/medical/i.test(page)) continue;
    // Some guides price each plan twice (standard vs tobacco-free) and repeat the table for each pay band.
    const hdr = pl.find((l) => (l.match(/tobacco[- ]?free|non[- ]?tobacco|non[- ]?smoker/gi) || []).length >= 2);
    const twinCols = hdr ? [...hdr.matchAll(/tobacco[- ]?free|non[- ]?tobacco|non[- ]?smoker|tobacco[- ]?user|smoker|standard/gi)].map((m) => /free|non/i.test(m[0])) : null;
    const twin = twinCols && twinCols.length === 2 * n ? twinCols : null;
    const blocks = []; let cur = {};
    for (const l of pl) {
      const t = tierOf(l);
      if (!t) continue;
      const vals = [...l.matchAll(/\$?\s?(\d[\d,]*\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, "")));
      if (vals.length < n || (twin && vals.length !== 2 * n)) continue;
      if (cur[t]) { blocks.push(cur); cur = {}; }
      cur[t] = vals;
    }
    if (Object.keys(cur).length) blocks.push(cur);
    const pick = (raw, free) => fourTiers(Object.fromEntries(Object.entries(raw).map(([t, v]) => [t, (twin ? v.filter((_, i) => twin[i] === free) : v).slice(0, n)])));
    const first = blocks[0] ? pick(blocks[0], true) : {};
    if (Object.keys(first).length >= 3) {
      let [factor, label] = periods(page);
      if (factor == null) {
        const elsewhere = pages.join("\n").match(/(\d{2})\s+pay\s*periods/i);
        if (elsewhere) { factor = +elsewhere[1]; label = `${elsewhere[1]} pay periods, stated elsewhere in the guide`; }
        else { factor = 26; label = "assumed 26 pay periods (not stated)"; notes.push("The guide did not say how often premiums are deducted; 26 per year was assumed. Check the annual premiums."); }
      }
      const annual = (rows, i) => { const o = { ee: 0, ee_sp: 0, ee_ch: 0, family: 0 }; for (const [t, v] of Object.entries(rows)) o[t] = r2(v[i] * factor); return o; };
      // Every pay band x tobacco status, so the plan step can ask instead of guessing.
      const bandLabels = pl.filter((l) => /^\$[\d,]+\s*(?:-|–|to)\s*\$[\d,]+$|^\$[\d,]+\s*\+$|^(?:under|less than|up to|over|more than)\s+\$[\d,]+$/i.test(l));
      const bands = bandLabels.length > 1 && bandLabels.length === blocks.length ? bandLabels : null;
      const used = bands ? blocks : blocks.slice(0, 1);
      plans.forEach((p, i) => {
        p.premium_table = [];
        used.forEach((b, bi) => {
          for (const free of twin ? [true, false] : [true]) {
            const rows = pick(b, free);
            if (Object.keys(rows).length >= 3) p.premium_table.push({ band: bands ? bi : null, tobacco: twin ? !free : null, premium_annual: annual(rows, i) });
          }
        });
        p.premium_annual = { ...p.premium_table[0].premium_annual };
      });
      premFound = true;
      notes.push(`Premiums in the guide are per paycheck (${label}); converted to annual.`);
      if (bands || twin) {
        // A plain sentence from the guide explaining how the band is set (skipped when the text is table residue).
        const helpLine = (re) => { const all = pages.join("\n").split("\n").map((l) => l.trim()); const k = all.findIndex((l) => re.test(l) && !/\$/.test(l) && l.length >= 40 && /^[A-Z]/.test(l)); if (k < 0) return ""; let t = all[k]; if (!/[.!]$/.test(t) && all[k + 1] && !/\$/.test(all[k + 1])) t += " " + all[k + 1]; return t.slice(0, 260); };
        premiumChoice = { bands, tobacco: !!twin, band: 0, tobacco_user: false, answered: false,
          band_help: bands ? helpLine(/(computation period|eligible earnings|annual base|base (?:pay|salary)|salary as of|based on (?:your )?(?:annual )?(?:base )?(?:pay|salary|earnings))/i) : "",
          tobacco_help: "" };
        notes.push(`Premiums depend on ${[bands && "pay band", twin && "tobacco use"].filter(Boolean).join(" and ")}. HerePup will ask on the plan screen; until then it uses the ${bands ? `first band (${bands[0]})` : ""}${bands && twin ? " and " : ""}${twin ? "tobacco-free rates" : ""}.`);
      }
      if (blocks.length > 1 && !bands) notes.push(`The premium table repeats ${blocks.length} times (perhaps by pay level or location), but HerePup couldn't tell what each version is for. It used the first one; check that those premiums are yours.`);
      if (!twin && /tobacco|smoker|nicotine/i.test(pages.join(" ")) && /surcharge/i.test(pages.join(" "))) notes.push("The guide mentions a tobacco surcharge. If anyone covered uses tobacco, add the surcharge to the premiums.");
      const raw0 = blocks[0];
      if (raw0.ee_child && raw0.ee_children) notes.push("The guide prices one child and two or more children separately; HerePup used the children rate for employee + children.");
      if (raw0.ee_sp_ch && raw0.family) notes.push("The guide has a separate employee + spouse + one child rate; HerePup's family rate uses the full family level.");
      break;
    }
  }
  if (!premFound) notes.push("No premium table by coverage level was found. Enter premiums by hand.");
  // Employer HSA deposits: a table headed by the HSA plans' names with one row per coverage level.
  const hsaIdx = plans.map((p, i) => (p.hsa_eligible ? i : -1)).filter((i) => i >= 0);
  let hsaFound = false;
  if (hsaIdx.length) for (const page of pages) {
    if (!/\b(hsa|health savings)\b/i.test(page) || !/contribut/i.test(page)) continue;
    let order = null; const raw = {};
    for (const l of page.split("\n").map((x) => x.trim()).filter(Boolean)) {
      const named = plans.map((p, i) => [l.indexOf(p.name), i]).filter(([x]) => x >= 0).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
      if (named.length && named.every((i) => plans[i].hsa_eligible)) { if (Object.keys(raw).length) break; order = named; continue; }
      if (!order) continue;
      const t = tierOf(l), v = t ? moneyList(l) : [];
      if (t && v.length === order.length && !raw[t]) raw[t] = v;
    }
    const rows = fourTiers(raw);
    if (order && Object.keys(rows).length >= 3) {
      order.forEach((k, j) => { for (const [tier, vals] of Object.entries(rows)) plans[k].hsa_employer[tier] = vals[j]; });
      hsaFound = true;
      notes.push("Employer HSA deposits were read from the guide. Confirm them on each plan.");
      break;
    }
  }
  plans.forEach((p) => { if (p.hsa_eligible && !hsaFound) p.flags.push("Employer HSA contribution amount is not stated in the guide. Enter it if you know it; it can change the answer."); });
  return { plans, employer: employerGuess(pages, filename), notes, table_page: pi + 1, premium_choice: premiumChoice };
}

// ------------------------------------------------------------------ FHIR ExplanationOfBenefit (CARIN Blue Button)
const PRIMARY_TAX = ["207Q", "207R", "208D", "2080", "363L", "363A", "261QP2300X", "207V"], ER_TAX = ["207P", "261QE0002X"], URGENT_TAX = ["261QU0200X"];
const PREVENTIVE_CPT = /^(9938[1-7]|9939[1-7]|9940[1-4]|9941[1-2]|G0438|G0439|G0402|99460|99461|99463)$/, ER_CPT = /^9928[1-5]$/;
const OFFICE_CPT = /^992(0[2-5]|1[1-5])$/, CONSULT_CPT = /^992(4[1-5])$/, URGENT_CPT = /^S9083|S9088$/;
const codes = (cc) => (cc && cc.coding ? cc.coding.filter((c) => c.code).map((c) => String(c.code)) : []);
const display = (cc) => (!cc ? "" : cc.text || ((cc.coding || []).find((c) => c.display) || {}).display || "");
function adjSum(adjs) { const o = {}; for (const a of adjs || []) { const v = (a.amount || {}).value; if (v == null) continue; for (const c of codes(a.category)) o[c.toLowerCase()] = (o[c.toLowerCase()] || 0) + Number(v); } return o; }
function memberResp(a) {
  if ("memberliability" in a) return a.memberliability;
  if ("paidbypatient" in a && !["copay", "deductible", "coinsurance"].some((k) => k in a)) return a.paidbypatient;
  const parts = ["copay", "deductible", "coinsurance", "noncovered"].map((k) => a[k]);
  if (parts.some((p) => p != null)) return r2(parts.reduce((s, p) => s + (p || 0), 0));
  if (a.eligible != null && a.benefit != null) return r2(a.eligible - a.benefit);
  return null;
}
function nameOf(res) {
  if (!res) return "";
  if (res.resourceType === "Organization" || typeof res.name === "string") return res.name || "";
  const n = (res.name || [])[0]; if (!n) return "";
  return n.text || [...(n.given || []), n.family || ""].join(" ").trim();
}
export function classifyItem(type, pos, rev, cpt, tax) {
  if (type === "pharmacy") return ["rx", "Pharmacy claim"];
  if (cpt.some((c) => PREVENTIVE_CPT.test(c))) return ["preventive", "Preventive visit procedure code"];
  if (pos.includes("23") || rev.some((r) => r.startsWith("045") && r !== "0456") || cpt.some((c) => ER_CPT.test(c))) return ["er", "Emergency room (place of service, revenue or procedure code)"];
  if (pos.includes("20") || rev.includes("0456") || rev.some((r) => r === "0516" || r === "0526") || cpt.some((c) => URGENT_CPT.test(c)) || tax.some((t) => URGENT_TAX.some((u) => t.startsWith(u))))
    return ["urgent", "Urgent care (place of service or facility code)"];
  const visit = cpt.some((c) => OFFICE_CPT.test(c) || CONSULT_CPT.test(c));
  const officeLike = pos.includes("11") || pos.includes("02") || pos.includes("10") || visit;
  if (officeLike && visit) {
    if (cpt.some((c) => CONSULT_CPT.test(c))) return ["specialist", "Consultation procedure code"];
    if (tax.length) {
      if (tax.some((t) => PRIMARY_TAX.some((p) => t.startsWith(p)))) return ["office", `Office visit with primary care provider (taxonomy ${tax[0]})`];
      if (tax.some((t) => ER_TAX.some((p) => t.startsWith(p)))) return ["office", "Office visit"];
      return ["specialist", `Office visit with specialist (taxonomy ${tax[0]})`];
    }
    return ["office", "Office visit procedure code (specialty unknown)"];
  }
  if (officeLike) return ["procedure", "Done in the provider's office (place of service 11)"];
  return null;
}
// "Unknown" and the like are placeholders some insurers send instead of a name.
const known = (v) => { const t = String(v || "").trim(); return /^(unknown|n\/?a|none|null|-)$/i.test(t) ? "" : t; };
const sumCats = (list) => { const o = {}; for (const a of list || []) { const v = (a.amount || {}).value; if (v == null) continue; for (const c of codes(a.category)) o[c.toLowerCase()] = (o[c.toLowerCase()] || 0) + Number(v); } return o; };
const COMPLETE = ["eligible", "benefit", "paidtoprovider", "memberliability"];
const uniq = (a) => [...new Set(a)];
// Claim type: the HL7 claim-type code wherever it appears among the codings, or Medicare Blue Button's own claim types.
const HL7_TYPES = ["institutional", "oral", "pharmacy", "professional", "vision"];
const BB_TYPES = { carrier: "professional", dme: "professional", pde: "pharmacy", inpatient: "institutional", outpatient: "institutional",
  snf: "institutional", hha: "institutional", hospice: "institutional" };
function claimType(eob) {
  const cs = codes(eob.type).map((x) => x.toLowerCase());
  return cs.find((x) => HL7_TYPES.includes(x)) || cs.map((x) => BB_TYPES[x]).find(Boolean) || cs[0] || "";
}
export function mapFhir(resources) {
  const lookup = {}; for (const r of resources) if (r.id) lookup[`${r.resourceType}/${r.id}`] = r;
  const resolve = (ref, contained) => (!ref ? null : contained[ref.reference] || lookup[ref.reference] || null);
  const rows = [], coverage = []; let skipped = 0, observed = null;
  for (const r of resources) if (r.resourceType === "Coverage") {
    let plan = "";
    for (const c of r.class || []) if (codes(c.type).some((x) => x === "plan" || x === "group")) plan = plan || c.name || c.value || "";
    const pay = (r.payor || [{}])[0] || {};
    coverage.push({ plan, payor: nameOf(resolve(pay, {})) || pay.display || "", status: r.status || "", start: (r.period || {}).start || "", end: (r.period || {}).end || "" });
  }
  for (const eob of resources) {
    if (eob.resourceType !== "ExplanationOfBenefit") continue;
    if (eob.status === "cancelled" || eob.status === "entered-in-error" || eob.outcome === "error") { skipped++; continue; }
    const contained = {}; for (const c of eob.contained || []) if (c.id) contained["#" + c.id] = c;
    const type = claimType(eob);
    const member = nameOf(resolve(eob.patient, contained)) || (eob.patient || {}).display || "";
    // Exports that carry only the claims (no Patient or Practitioner records) leave names as bare references.
    const memberRef = member ? "" : ((eob.patient || {}).reference || "");
    const nameRef = (ref) => known(nameOf(resolve(ref, contained))) || known((ref || {}).display);
    let provider = nameRef(eob.provider);
    for (const ct of eob.careTeam || []) if (!provider) provider = nameRef(ct.provider);
    if (!provider) provider = nameRef(eob.facility) || nameRef((eob.payee || {}).party); // hospital claims often name only the facility
    const placeAddr = (eob.item || []).map((it) => it.locationAddress).find((a) => a && (a.city || a.state)) || null;
    const providerRef = provider ? "" : ((eob.provider || {}).reference || ((eob.careTeam || [])[0] || {}).provider?.reference || "");
    if (!provider && placeAddr) provider = `Provider in ${[placeAddr.city, placeAddr.state].filter(Boolean).join(", ")}`;
    const sub = (codes(eob.subType)[0] || "").toLowerCase() || (codes(eob.type).some((x) => /^inpatient$/i.test(x)) ? "inpatient" : "");
    const tax = (eob.careTeam || []).flatMap((ct) => codes(ct.qualification));
    const claimDate = ((eob.billablePeriod || {}).start || eob.created || "").slice(0, 10);
    const items = eob.item || [];
    const brand = (eob.supportingInfo || []).filter((s) => codes(s.category).map((c) => c.toLowerCase()).includes("brandgenericindicator")).map((s) => (codes(s.code)[0] || "").toLowerCase());
    // In- or out-of-network, when the insurer says (CARIN: supportingInfo "benefitpaymentstatus", or adjudication categories).
    const netCodes = [...(eob.supportingInfo || []).filter((s) => codes(s.category).some((c) => /benefitpaymentstatus/i.test(c))).flatMap((s) => codes(s.code)),
      ...(eob.adjudication || []).filter((a) => codes(a.category).some((c) => /benefitpaymentstatus/i.test(c))).flatMap((a) => codes(a.reason)),
      ...(eob.adjudication || []).flatMap((a) => codes(a.category)), ...items.flatMap((it) => (it.adjudication || []).flatMap((a) => codes(a.category)))].map((c) => c.toLowerCase());
    const network = netCodes.some((c) => /^(outofnetwork|out-of-network|oon)$/.test(c)) ? "out" : netCodes.some((c) => /^(innetwork|in-network|inn)$/.test(c)) ? "in" : "";
    // The provider's state (from the billing provider or facility address), for state-specific bill rules.
    const stateOf = (ref) => { const r = resolve(ref, contained); const a = r && (r.address || [])[0]; return a && a.state ? String(a.state).toUpperCase().slice(0, 2) : ""; };
    const providerState = stateOf(eob.provider) || stateOf(eob.facility) || stateOf((eob.payee || {}).party) || (placeAddr && placeAddr.state ? String(placeAddr.state).toUpperCase().slice(0, 2) : "");
    // One row per line item when every line carries its own adjudicated amounts; otherwise one row for the claim from
    // its totals (some insurers put only partial amounts on the lines of facility claims).
    const lineAdj = items.map((it) => sumCats(it.adjudication)), totals = sumCats(eob.total);
    const useItems = items.length > 0 && (lineAdj.every((a) => COMPLETE.some((k) => k in a)) || (!Object.keys(totals).length && items.some((it) => (it.adjudication || []).length)));
    const nonZero = (a) => Object.values(a).some((v) => Math.abs(Number(v) || 0) > 0.004);
    const lines = useItems ? items.map((it, k) => ({ it, a: lineAdj[k] })) : [{ it: null, a: totals }];
    const kept = useItems && lines.some((x) => nonZero(x.a)) ? lines.filter((x) => nonZero(x.a)) : lines; // $0 lines are bundled or informational
    kept.forEach(({ it, a }, k) => {
      const all = it ? [it] : items;
      const date = ((it && (it.servicedDate || (it.servicedPeriod || {}).start)) || claimDate).slice(0, 10);
      const pos = uniq(all.flatMap((x) => codes(x.locationCodeableConcept))), rev = uniq(all.flatMap((x) => codes(x.revenue))), cpt = uniq(all.flatMap((x) => codes(x.productOrService)));
      const inpatient = type === "institutional" && (sub === "inpatient" || pos.includes("21")) && !(pos.length && pos.every((x) => x === "20" || x === "23"));
      const first = display(all[0] && all[0].productOrService);
      const desc = (!it && inpatient ? "Hospital stay (inpatient)" : first + (all.length > 1 && first ? ` and ${all.length - 1} more` : ""))
        || (type ? type[0].toUpperCase() + type.slice(1) : "");
      let allowed = a.eligible ?? null, odd = false; const paid = a.benefit ?? a.paidtoprovider ?? null, owe = memberResp(a);
      // An "allowed" amount below what the plan paid isn't an allowed amount; rebuild it and flag the row.
      if (allowed != null && paid != null && allowed + 0.01 < paid) { allowed = owe != null ? r2(paid + owe) : null; odd = true; }
      if (allowed == null && paid != null && owe != null) allowed = r2(paid + owe);
      if (allowed != null && paid != null && owe != null && Math.abs(allowed - paid - owe) > Math.max(1, allowed * 0.02)) odd = true;
      const words = (first || desc || "").toLowerCase();
      const fromWords = !cpt.length && !pos.length && !rev.length
        ? (/routine|preventive|wellness|annual (exam|physical)|screening/.test(words) ? ["preventive", "Insurer's description (routine or preventive care)"]
          : /office visit/.test(words) ? ["office", "Insurer's description (office visit)"]
          : /emergency/.test(words) ? ["er", "Insurer's description (emergency)"]
          : /urgent/.test(words) ? ["urgent", "Insurer's description (urgent care)"] : null) : null;
      const typed = inpatient ? ["medical", "Hospital inpatient stay (claim type or place of service 21)"]
        : classifyItem(type, pos, rev, cpt, tax)
          || (type === "institutional" && (pos.includes("19") || pos.includes("22")) ? ["medical", "Hospital outpatient services (place of service)"] : null)
          || fromWords;
      const row = { id: `fhir-${eob.id || newId()}-${k + 1}`, date, member, provider, service: desc, category: typed ? typed[0] : "medical",
        billed: a.submitted ?? null, allowed, plan_paid: paid, member_resp: owe, copay: a.copay ?? null, deductible: a.deductible ?? null, coinsurance: a.coinsurance ?? null,
        needs_review: allowed == null || odd, place: pos.includes("11") ? "office" : (pos[0] && ["19", "21", "22", "23"].includes(pos[0]) ? "facility" : ""), claim: eob.id || "" };
      if (network) row.network = network;
      if (memberRef) row.member_ref = memberRef;
      if (providerRef) row.provider_ref = providerRef;
      if (providerState) row.provider_state = providerState;
      if (typed) Object.assign(row, { type_source: typed[1], type_confidence: "high", type_locked: true });
      if (fromWords && typed === fromWords) Object.assign(row, { type_confidence: "medium", check: true }); // a guess from words: ask the member to confirm
      if (cpt[0] && row.category !== "rx") row.proc = cpt[0];
      if (row.category === "rx") Object.assign(row, { rx_tier: brand.join("").includes("generic") || !brand.length ? 1 : 2, type_source: "Pharmacy claim" + (brand.length ? ` (${brand[0]})` : ""),
        rx_drug: desc, pharmacy: provider, rx_qty: all[0] && all[0].quantity && all[0].quantity.value != null ? Number(all[0].quantity.value) : null });
      rows.push(row);
    });
    for (const bb of eob.benefitBalance || []) for (const fin of bb.financial || []) {
      const t = codes(fin.type).join("").toLowerCase(), am = (fin.allowedMoney || {}).value, used = (fin.usedMoney || {}).value;
      if (am == null || used == null) continue;
      const key = t.includes("deductible") ? "ded" : t.includes("out") || t.includes("pocket") ? "oop" : null;
      if (!key) continue;
      observed = observed || {};
      const unit = codes(bb.unit).join("").toLowerCase().includes("family") ? "fam" : "ind";
      observed[`${key}_${unit}`] = Number(am); observed[`${key}_${unit}_met`] = Math.max(Number(used), observed[`${key}_${unit}_met`] || 0);
    }
  }
  if (observed) observed.as_of = rows.map((r) => r.date).filter(Boolean).sort().pop() || null;
  // Providers known only by a reference: keep different providers apart even when they share a city.
  const byRef = new Map(), labelRefs = new Map();
  for (const r of rows) if (r.provider_ref && !byRef.has(r.provider_ref)) byRef.set(r.provider_ref, r.provider || "");
  let k = 0;
  for (const [ref, label] of byRef) {
    let l = label || `Provider ${++k} (name not in file)`;
    const n = (labelRefs.get(l) || 0) + 1; labelRefs.set(l, n);
    if (n > 1) l += ` (${n})`;
    byRef.set(ref, l);
  }
  for (const r of rows) if (r.provider_ref) r.provider = byRef.get(r.provider_ref);
  const unnamed = [...new Set(rows.map((r) => r.member_ref).filter(Boolean))];
  const notes = [];
  if (unnamed.length) notes.push(`This file has the claims but not the names of the people or providers on them. Choose who ${unnamed.length === 1 ? "they belong" : "each person's claims belong"} to below; providers are labeled by where the care was billed.`);
  return { rows, skipped, coverage, observed, notes, unnamed_members: unnamed };
}
export function parseFhirText(text) {
  const t = text.replace(/^\uFEFF/, "").trim();
  let data;
  try { data = JSON.parse(t); }
  catch (e) { data = t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)); } // NDJSON (one resource per line)
  // Any shape: a Bundle, an array, bundles of bundles, or an app's own wrapper ({ data: [...] }, { eob: {...} }...).
  const resources = [], seen = new Set();
  const walk = (x, depth = 0) => {
    if (!x || typeof x !== "object" || depth > 8) return;
    if (Array.isArray(x)) { x.forEach((y) => walk(y, depth + 1)); return; }
    if (x.resourceType === "Bundle") { (x.entry || []).forEach((e) => walk(e.resource || e, depth + 1)); return; }
    if (x.resourceType) { const k = `${x.resourceType}/${x.id || resources.length}`; if (!seen.has(k)) { seen.add(k); resources.push(x); } return; }
    Object.values(x).forEach((v) => walk(v, depth + 1));
  };
  walk(data);
  return mapFhir(resources);
}
// ------------------------------------------------------------------ care type (no network lookups in the browser version)
export function classifyRows(rows) {
  for (const r of rows) {
    r.check = r.check || false;
    if (r.type_locked) continue;
    const cat = r.category, prov = r.provider || "", name = (prov + " " + (r.payee || "")).toLowerCase(), service = (r.service || "").toLowerCase();
    if (cat === "rx" || cat === "preventive" || !prov) continue;
    if (name.includes("urgent") || name.includes("immediate care") || service.includes("urgent")) { Object.assign(r, { category: "urgent", type_source: "Urgent care in the name", type_confidence: "medium" }); continue; }
    if (name.includes("emergency") || service.includes("emergency")) { Object.assign(r, { category: "er", type_source: "Emergency in the name or EOB", type_confidence: "medium" }); continue; }
    const spec = specialtyFromName(name);
    if (spec && (cat === "office" || cat === "specialist" || (cat === "medical" && (service.includes("visit") || service.includes("office"))))) {
      Object.assign(r, { category: "specialist", type_source: `Practice name suggests a specialist (${spec})`, type_confidence: "medium", check: true });
    }
  }
  const visitKeys = new Set(rows.filter((r) => r.category === "office" || r.category === "specialist").map((r) => `${r.member}|${r.provider}|${r.date}`));
  for (const r of rows) {
    const service = (r.service || "").toLowerCase();
    if (r.category === "medical" && ["surgery", "procedure", "injection", "biopsy"].some((k) => service.includes(k)) && visitKeys.has(`${r.member}|${r.provider}|${r.date}`) && r.place === "office") {
      Object.assign(r, { category: "procedure", check: true, type_confidence: "high",
        type_source: "Office procedure: same provider and day as a visit; EOB says non-facility. It is covered by the visit copay only on plans with a flat copay for that visit, otherwise the deductible applies." });
    }
  }
  for (const r of rows) if (r.category === "er" || r.category === "urgent") r.check = true;
}

export function planHints(text) {
  const P = { deductible: /deductible[^$\n]{0,80}\$\s?([\d,]+)/gi, oop: /out[- ]of[- ]pocket (?:max(?:imum)?|limit)[^$\n]{0,80}\$\s?([\d,]+)/gi,
    coinsurance: /(?:coinsurance|you pay)[^%\n]{0,60}?(\d{1,2})\s?%/gi, hsa: /(?:HSA|health savings)[^$\n]{0,80}\$\s?([\d,]+)/gi,
    premium: /(?:premium|coverage cost|per paycheck|per month|monthly)[^$\n]{0,60}\$\s?([\d,]+(?:\.\d{2})?)/gi };
  const out = {};
  for (const [k, re] of Object.entries(P)) {
    out[k] = [];
    for (const m of text.matchAll(re)) { out[k].push({ value: m[1].replace(/,/g, ""), snippet: text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 40).replace(/\n/g, " ").trim() }); if (out[k].length >= 6) break; }
  }
  return out;
}

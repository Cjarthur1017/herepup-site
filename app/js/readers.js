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
  const get = (r, f) => (cols[f] == null ? "" : r[cols[f]] ?? "");
  const isRx = "rx_number" in cols || "pharmacy" in cols;
  const rows = []; let skipped = 0, derived = 0;
  for (const r of records.slice(1)) {
    const d = normDate(get(r, "date"));
    if (!d) { skipped++; continue; }
    let prov = String(get(r, "provider") || "").trim();
    let cat = String(get(r, "category") || "").trim().toLowerCase();
    let rxDrug = null, pharmacy = null, rxQty = null;
    if (isRx) {
      cat = "rx";
      const q = prov.match(/Quantity:\s*([\d.]+)/i); rxQty = q ? Number(q[1]) : null;
      prov = prov.replace(/\s+Quantity:.*$/, "");
      rxDrug = prov;
      const ph = String(get(r, "pharmacy") || "").trim();
      pharmacy = ph || null;
      prov = ph ? `${prov} (${ph})` : prov;
    }
    const billed = money(get(r, "billed")); let allowed = money(get(r, "allowed"));
    const paid = money(get(r, "plan_paid")), owe = money(get(r, "member_resp"));
    if (allowed == null && paid != null && owe != null) { allowed = r2(paid + owe); derived++; }
    const rxn = String(get(r, "rx_number") || "").trim();
    const row = { id: isRx && rxn ? "rx-" + rxn : newId(), date: d, member: String(get(r, "member") || "").trim(), provider: prov,
      category: CATEGORIES.includes(cat) ? cat : classifyText(prov + " " + cat), billed, allowed, plan_paid: paid, member_resp: owe, needs_review: allowed == null };
    if (row.category === "rx") Object.assign(row, { rx_tier: inferRxTier(allowed), rx_drug: rxDrug, pharmacy, rx_qty: rxQty });
    rows.push(row);
  }
  const notes = [];
  if (derived) notes.push(`This file has no allowed amount. Allowed was set to plan paid plus what you owe for ${derived} row(s).`);
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
  const pages = [], blank = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const t = linesFromContent((await pg.getTextContent()).items);
    pages.push(t);
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
      if (text.trim()) { pages[i - 1] = text; done++; }
    } catch (e) { err = e.message; break; }
  }
  await doc.destroy();
  return { pages, scanned_pages: blank.length, ocr_pages: done, unreadable_pages: blank.length - done - stoppedEarly, skipped_pages: stoppedEarly, ocr_error: err };
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
const COPAY_ROWS = [["office", /^office visit/i], ["specialist", /^(?:outpatient )?specialist visit/i], ["urgent", /^urgent care/i], ["er", /^emergency room/i]];
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
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem ? stem.split(/[_\- ]?benefit/i)[0].replace(/^[\s_-]+|[\s_-]+$/g, "") : "";
}

export function detectPlans(pages, filename = "") {
  const notes = [];
  let best = null;
  pages.forEach((text, pi) => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    let dedI = [], dedF = [], oopI = [], oopF = [], first = null;
    lines.forEach((l, li) => {
      const low = l.toLowerCase();
      const isDed = low.includes("deductible") && !low.includes("pharmacy") && !low.includes("rx") && !low.startsWith("tier") && !low.startsWith("prescription");
      const isOop = (low.includes("out-of-pocket") || low.includes("out of pocket")) && !low.startsWith("tier") && !low.startsWith("prescription");
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
    const n = Math.max(dedI.length, dedF.length, oopI.length, oopF.length);
    if (n && dedI.length && oopI.length && (!best || n > best.n)) best = { n, pi, lines, first, dedI, dedF, oopI, oopF };
  });
  if (!best) return { plans: [], employer: employerGuess(pages, filename), notes: ["No plan comparison table (deductible and out-of-pocket by plan) was found in this document."] };
  const { n, pi, lines, first, dedI, dedF, oopI, oopF } = best;
  const names = findNames(lines, first, n);
  const text = lines.join("\n");
  const zero = () => ({ ee: 0, ee_sp: 0, ee_ch: 0, family: 0 });
  const plans = names.map((name, i) => {
    const di = dedI[i] ?? 0, df = dedF[i] ?? 2 * di, oi = oopI[i] ?? 0, of = oopF[i] ?? 2 * oi;
    const hsa = /HDHP|HSA/i.test(name);
    return { name, deductible_ind: di, deductible_fam: df, oop_ind: oi, oop_fam: of,
      coinsurance: /coinsurance\s+100\s?%|100\s?%\s+after\s+deductible/i.test(text) ? 0 : 0.2,
      embedded: true, hsa_eligible: hsa, hsa_answered: !hsa, rx_in_deductible: hsa, copay_after_ded: false, copays: {}, rx_copays: [],
      rx_deductible_ind: 0, rx_deductible_fam: 0, premium_annual: zero(), hsa_employer: zero(),
      flags: ["Individual deductible assumed to sit inside the family one (embedded). Confirm in your plan document."] };
  });
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
  } else plans.forEach((p) => p.flags.push("Prescription copays were not found. Prescriptions are modeled with the medical deductible and coinsurance."));
  let premFound = false;
  for (const page of pages) {
    const pl = page.split("\n").map((l) => l.trim()).filter(Boolean);
    const rows = {};
    for (const l of pl) {
      for (const [tier, re] of TIER_PATTERNS) {
        if (re.test(l)) {
          const vals = [...l.matchAll(/\$?\s?(\d[\d,]*\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, "")));
          if (vals.length >= n && !rows[tier]) rows[tier] = vals.slice(0, n);
          break;
        }
      }
    }
    if (Object.keys(rows).length >= 3 && /medical/i.test(page)) {
      let [factor, label] = periods(page);
      if (factor == null) { factor = 26; label = "assumed 26 pay periods (not stated)"; notes.push("The guide did not say how often premiums are deducted; 26 per year was assumed. Check the annual premiums."); }
      for (const [tier, vals] of Object.entries(rows)) plans.forEach((p, i) => { p.premium_annual[tier] = r2(vals[i] * factor); });
      premFound = true;
      notes.push(`Premiums in the guide are per paycheck (${label}); converted to annual.`);
      break;
    }
  }
  if (!premFound) notes.push("No premium table by coverage level was found. Enter premiums by hand.");
  plans.forEach((p) => { if (p.hsa_eligible) p.flags.push("Employer HSA contribution amount is not stated in the guide. Enter it if you know it; it can change the answer."); });
  return { plans, employer: employerGuess(pages, filename), notes, table_page: pi + 1 };
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
    const type = (codes(eob.type)[0] || "").toLowerCase();
    const member = nameOf(resolve(eob.patient, contained)) || (eob.patient || {}).display || "";
    let provider = nameOf(resolve(eob.provider, contained)) || (eob.provider || {}).display || "";
    for (const ct of eob.careTeam || []) if (!provider) provider = nameOf(resolve(ct.provider, contained)) || (ct.provider || {}).display || "";
    const tax = (eob.careTeam || []).flatMap((ct) => codes(ct.qualification));
    const claimDate = ((eob.billablePeriod || {}).start || eob.created || "").slice(0, 10);
    const items = eob.item || [];
    const useItems = items.some((it) => (it.adjudication || []).length);
    const brand = (eob.supportingInfo || []).filter((s) => codes(s.category).map((c) => c.toLowerCase()).includes("brandgenericindicator")).map((s) => (codes(s.code)[0] || "").toLowerCase());
    (useItems ? items : [null]).forEach((it, k) => {
      const a = it ? adjSum(it.adjudication) : (() => { const o = {}; for (const t of eob.total || []) { const v = (t.amount || {}).value; if (v == null) continue; for (const c of codes(t.category)) o[c.toLowerCase()] = (o[c.toLowerCase()] || 0) + Number(v); } return o; })();
      const date = ((it && (it.servicedDate || (it.servicedPeriod || {}).start)) || claimDate).slice(0, 10);
      const pos = codes(it && it.locationCodeableConcept), rev = codes(it && it.revenue), cpt = codes(it && it.productOrService);
      const desc = display(it && it.productOrService) || (type ? type[0].toUpperCase() + type.slice(1) : "");
      let allowed = a.eligible ?? null; const paid = a.benefit ?? a.paidtoprovider ?? null, owe = memberResp(a);
      if (allowed == null && paid != null && owe != null) allowed = r2(paid + owe);
      const typed = classifyItem(type, pos, rev, cpt, tax);
      const row = { id: `fhir-${eob.id || newId()}-${k + 1}`, date, member, provider, service: desc, category: typed ? typed[0] : "medical",
        billed: a.submitted ?? null, allowed, plan_paid: paid, member_resp: owe, copay: a.copay ?? null, deductible: a.deductible ?? null, coinsurance: a.coinsurance ?? null,
        needs_review: allowed == null, place: pos.includes("11") ? "office" : (pos[0] && ["21", "22", "23"].includes(pos[0]) ? "facility" : ""), claim: eob.id || "" };
      if (typed) Object.assign(row, { type_source: typed[1], type_confidence: "high", type_locked: true });
      if (cpt[0] && row.category !== "rx") row.proc = cpt[0];
      if (row.category === "rx") Object.assign(row, { rx_tier: brand.join("").includes("generic") || !brand.length ? 1 : 2, type_source: "Pharmacy claim" + (brand.length ? ` (${brand[0]})` : ""),
        rx_drug: desc, pharmacy: provider, rx_qty: it && it.quantity && it.quantity.value != null ? Number(it.quantity.value) : null });
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
  return { rows, skipped, coverage, observed };
}
export function parseFhirText(text) {
  const data = JSON.parse(text.replace(/^﻿/, ""));
  const resources = Array.isArray(data) ? data : data.resourceType === "Bundle" ? (data.entry || []).map((e) => e.resource || {}) : [data];
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

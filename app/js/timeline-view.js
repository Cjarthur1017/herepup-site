// Draws the "Month by month" tab. Data comes from timeline.js; every label goes in with textContent.
import { monthsOf, series, setAside } from "./timeline.js";

const COLOR = { premium: "var(--s-premium)", care: "var(--s-care)", hsa: "var(--s-hsa)" };
const V = { on: null, keys: "", view: "month", pay: 24, hsa: "spread" };
const NS = "http://www.w3.org/2000/svg";
let ctx = null, hoverMonth = -1, resizeTimer = 0;

const fmt = (v) => (v < -0.5 ? "−$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
const compact = (v) => {
  const a = Math.abs(v), s = v < 0 ? "−$" : "$";
  return a >= 1000 ? s + (a / 1000).toFixed(1).replace(/\.0$/, "") + "K" : s + Math.round(a);
};
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const the = (o) => (o.split ? "the best split" : "the " + o.short);
function niceStep(range, target) {
  const raw = Math.max(range, 1) / target, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "text") e.textContent = v; else if (k === "cls") e.className = v; else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
const svg = (n, a = {}, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (p) p.append(e); return e; };

export function mountTimeline(host, data, opts) {
  ctx = { host, data, opts, months: monthsOf(data.window) };
  const keys = data.options.map((o) => o.key).join("|");
  if (!V.on || V.keys !== keys) { V.on = new Set(data.defaults); V.keys = keys; }
  host.replaceChildren();
  if (!data.options.length) { host.append(h("p", { cls: "lead", text: "Add a plan option first." })); return; }
  const anyHsa = data.options.some((o) => o.hsa > 0);
  if (!anyHsa) V.hsa = "spread";

  // one row of settings above everything they change
  const chips = h("div", { cls: "tl-opts" });
  for (const o of data.options) {
    const i = h("input", { type: "checkbox", value: o.key });
    i.checked = V.on.has(o.key);
    i.addEventListener("change", () => {
      if (!i.checked && V.on.size === 1) { i.checked = true; return; }
      i.checked ? V.on.add(o.key) : V.on.delete(o.key); draw();
    });
    chips.append(h("label", { cls: "tl-opt", title: o.label }, i, h("span", { cls: "tick", "aria-hidden": "true" }), h("span", { text: o.short })));
  }
  const seg = h("div", { cls: "tl-seg" });
  for (const [v, t] of [["month", "Each month"], ["cum", "Running total"]]) {
    const r = h("input", { type: "radio", name: "tl-view", value: v }); r.checked = V.view === v;
    r.addEventListener("change", () => { V.view = v; draw(); });
    seg.append(h("label", {}, r, document.createTextNode(t)));
  }
  const pay = h("select", { id: "tl-pay" });
  for (const [v, t] of [[24, "Twice a month"], [26, "Every two weeks"], [52, "Every week"], [12, "Once a month"]]) { const op = h("option", { value: v, text: t }); op.selected = V.pay === v; pay.append(op); }
  pay.addEventListener("change", () => { V.pay = Number(pay.value); draw(); });
  const hsa = h("select", { id: "tl-hsa" });
  for (const [v, t] of [["spread", "Each paycheck"], ["start", "All at the start"]]) { const op = h("option", { value: v, text: t }); op.selected = V.hsa === v; hsa.append(op); }
  hsa.addEventListener("change", () => { V.hsa = hsa.value; draw(); });
  const form = h("form", { cls: "tl-controls", "aria-label": "Month by month settings" });
  form.addEventListener("submit", (e) => e.preventDefault());
  host.append(form);
  form.append(
    h("fieldset", { cls: "tl-ctl" }, h("legend", { text: "Compare" }), chips),
    h("fieldset", { cls: "tl-ctl" }, h("legend", { text: "Show" }), seg),
    h("label", { cls: "tl-ctl" }, h("span", { cls: "lbl", text: "Paychecks" }), pay),
    anyHsa ? h("label", { cls: "tl-ctl" }, h("span", { cls: "lbl", text: "Employer HSA deposit" }), hsa) : "");

  host.append(h("div", { cls: "tl-tiles", id: "tl-tiles", "aria-live": "polite" }));
  const card = h("section", { cls: "card", "aria-labelledby": "tl-h" },
    h("h2", { id: "tl-h" }), h("p", { cls: "muted tl-when", text: "Shown by date of service, the day you got the care. The bill for it usually arrives a few weeks later, once your insurer has processed the claim, so the money may leave your account a month or so after the month shown." }),
    h("div", { cls: "tl-legend", id: "tl-legend" }), h("div", { id: "tl-panels" }));
  host.append(card);
  host.append(h("details", { cls: "card" }, h("summary", { text: "Show these numbers as a table" }), h("div", { cls: "scroll", id: "tl-table" })));
  const ms = ctx.months, span = `${ms[0].long} to ${ms[11].long}`;
  host.append(h("ul", { cls: "tl-notes" },
    h("li", { text: `Covers ${span}${data.window.folded ? ". Your claims span more than 12 months, so they're grouped by calendar month" : ""}${opts.mult !== 1 ? `, at ${Math.round(opts.mult * 100)}% of your past use (from the What if slider)` : ""}.` }),
    h("li", { text: "Premiums are the paycheck deductions for the coverage tier each option needs. Paid every two weeks or every week, some months have an extra paycheck." }),
    anyHsa ? h("li", { text: opts.countHsa ? "Employer HSA money is shown below the line because it comes in rather than goes out. Check with your employer how and when they deposit it." : "Employer HSA money is left out because \"Count employer HSA money\" is off on the Year total tab." }) : null,
    h("li", { text: "Set aside is the most you'd fall behind if you budgeted the option's average monthly cost, before later, quieter months catch up. It assumes nothing is saved at the start of the year; an HSA balance you already have counts toward it." })));

  if (!document.getElementById("tl-tip")) document.body.append(h("div", { id: "tl-tip", role: "status" }));
  draw();
}

function draw() {
  const { data, host } = ctx;
  if (!host.isConnected) return;
  const shown = data.options.filter((o) => V.on.has(o.key));
  const S = Object.fromEntries(data.options.map((o) => [o.key, series(o, data.window, V.pay, V.hsa)]));
  host.querySelector("#tl-h").textContent = V.view === "cum" ? "Running total through the year" : "Premiums and care costs by month";
  tiles(shown, S); legend(); panels(shown, S); table(shown, S);
}

function tile(k, v, p) {
  return h("div", { cls: "tl-tile" }, h("div", { cls: "k", text: k }), h("span", { cls: "v", text: v }), h("p", { text: p }));
}
function tiles(shown, S) {
  const el = ctx.host.querySelector("#tl-tiles"), M = ctx.months;
  el.replaceChildren();
  const tot = (o) => S[o.key].cum[11].net;
  const byNet = [...shown].sort((a, b) => tot(a) - tot(b)), low = byNet[0], next = byNet[1];
  el.append(tile("Lowest for the year", `${low.short} · ${fmt(tot(low))}`,
    next ? `${fmt(tot(next) - tot(low))} less than ${the(next)} over the year${low.hsa ? ", after employer HSA money" : ""}.` : "Premiums plus your share of care for the year."));

  let peak = null;
  for (const o of shown) S[o.key].month.forEach((x, i) => { if (!peak || x.net > peak.v) peak = { o, i, v: x.net }; });
  const top = S[peak.o.key].why[peak.i].filter((l) => l.cost > 0).sort((a, b) => b.cost - a.cost)[0];
  el.append(tile("Biggest single month", M[peak.i].long,
    `${fmt(peak.v)} on ${the(peak.o)}` + (top ? `, mostly ${top.who}'s ${top.service} (${fmt(top.cost)}${top.basis === "deductible" ? ", all toward the deductible" : ""}).` : ", nearly all of it premium.")));

  const sa = setAside(S[low.key]);
  if (sa.rounded) {
    const which = sa.months.length ? `, mostly from the ${sa.months.map((i) => M[i].name).join(" and ")} bills` : "";
    el.append(tile("Money to set aside", `${fmt(sa.rounded)} by ${M[sa.at].name}`,
      `Budget ${the(low)}'s average of ${fmt(sa.avg)} a month and you'd still be about ${fmt(sa.amount)} short by the end of ${M[sa.at].name}${which}. Keep that much in your HSA or savings.`));
  } else {
    el.append(tile("Money to set aside", "Little or none", `${cap(the(low))}'s monthly cost stays close to its average of ${fmt(sa.avg)}, so a steady budget covers it.`));
  }

  if (shown.length > 1) {
    let last = null;
    for (const o of shown) {
      if (o === low) continue;
      for (let i = 10; i >= 0; i--) if (S[low.key].cum[i].net > S[o.key].cum[i].net + 0.5) { if (!last || i > last.i) last = { o, i, gap: S[low.key].cum[i].net - S[o.key].cum[i].net }; break; }
    }
    el.append(last
      ? tile("When the savings show up", M[last.i + 1].long, `${cap(the(low))} costs least for the year, but by the end of ${M[last.i].name} it had cost ${fmt(last.gap)} more than ${the(last.o)}. It stays ahead from ${M[last.i + 1].name} on.`)
      : tile("When the savings show up", M[0].long, `${cap(the(low))} costs less than every other option shown from the first month, with these settings.`));
  }
}

function legend() {
  const el = ctx.host.querySelector("#tl-legend"); el.replaceChildren();
  const items = [["sw", COLOR.premium, "Premiums (from each paycheck)"], ["sw", COLOR.care, "Your share of care"]];
  if (ctx.data.options.some((o) => o.hsa > 0)) items.push(["sw", COLOR.hsa, "Employer HSA deposit (money in)"]);
  if (V.view === "cum") items.push(["lk", "", "Net so far, after HSA money"]);
  for (const [cls, c, t] of items) { const k = h("i", { cls }); if (c) k.style.background = c; el.append(h("span", {}, k, document.createTextNode(t))); }
}

// a bar with its data end rounded (top going up, bottom going down) and square at the baseline
function bar(x, y0, y1, w, round, fill, p) {
  const top = Math.min(y0, y1), ht = Math.abs(y1 - y0);
  if (ht < 0.01) return;
  const r = round ? Math.min(4, ht, w / 2) : 0, up = y1 < y0;
  const d = !r ? `M${x},${top}h${w}v${ht}h${-w}z`
    : up ? `M${x},${top + ht}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + ht}z`
      : `M${x},${top}H${x + w}V${top + ht - r}Q${x + w},${top + ht} ${x + w - r},${top + ht}H${x + r}Q${x},${top + ht} ${x},${top + ht - r}z`;
  svg("path", { d, fill }, p);
}

function panels(shown, S) {
  const host = ctx.host.querySelector("#tl-panels"), M = ctx.months;
  host.replaceChildren();
  const key = V.view === "cum" ? "cum" : "month";
  let hi = 0, lo = 0;
  for (const o of shown) for (const x of S[o.key][key]) { hi = Math.max(hi, x.premium + x.care); lo = Math.min(lo, -x.hsa); }
  const step = niceStep(hi - lo, 4), yMax = Math.ceil(hi / step) * step, yMin = lo < 0 ? lo * 1.12 : 0;
  const W = Math.max(280, host.clientWidth || 900), narrow = W < 560;
  const padL = narrow ? 40 : 52, padR = 8, padT = 22, plotH = narrow ? 150 : 170, axisH = 24, H = padT + plotH + axisH;
  const y = (v) => padT + ((yMax - v) / (yMax - yMin || 1)) * plotH;
  const bw = (W - padL - padR) / 12, barW = Math.min(24, bw * 0.58);

  for (const o of shown) {
    const s = S[o.key], dat = s[key], nets = s.month.map((x) => x.net), pk = nets.indexOf(Math.max(...nets)), sa = setAside(s);
    const title = h("h3", { text: o.short });
    if (o.pick) title.append(h("span", { cls: "tl-badge", text: "HerePup's pick" }));
    if (o.current) title.append(h("span", { cls: "tl-badge now", text: "Your plan now" }));
    const p0 = o.parts[0];
    const sub = o.split ? o.parts.map((p) => `${p.who.join(", ")} on ${p.employer} ${p.plan}`).join(" · ")
      : `Everyone on ${p0.employer} · deductible ${fmt(p0.ded_ind)} per person, ${fmt(p0.ded_fam)} family`;
    const stats = h("div", { cls: "tl-stats" });
    for (const [k, v] of [[o.hsa ? "Year, after HSA" : "Year total", fmt(s.cum[11].net)], ["Typical month", fmt(median(nets))],
      [`Highest month (${M[pk].short})`, fmt(nets[pk])], [sa.rounded ? `Set aside by ${M[sa.at].short}` : "Set aside", sa.rounded ? fmt(sa.rounded) : "$0"]]) {
      stats.append(h("div", {}, h("b", { text: v }), document.createTextNode(k)));
    }
    const panel = h("div", { cls: "tl-panel" }, h("div", { cls: "tl-ph" }, h("div", {}, title, h("div", { cls: "sub", text: sub })), stats));

    const box = h("div", { cls: "tl-chart" });
    const g0 = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "group", "aria-label": `${o.short}: ${V.view === "cum" ? "running total" : "cost each month"}` });
    for (let v = Math.ceil(yMin / step) * step; v <= yMax + 0.01; v += step) {
      svg("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: Math.abs(v) < 0.01 ? "var(--axis)" : "var(--grid)", "stroke-width": 1, "shape-rendering": "crispEdges" }, g0);
      svg("text", { x: padL - 8, y: y(v) + 4, "text-anchor": "end", "font-size": 12, fill: "var(--muted)" }, g0).textContent = compact(v);
    }
    const labelAt = V.view === "cum" ? 11 : pk;
    dat.forEach((x, i) => {
      const g = svg("g", { class: "band", tabindex: 0, "data-m": i }, g0);
      const cx = padL + bw * i + bw / 2, x0 = cx - barW / 2, base = y(0);
      svg("rect", { class: "hl", x: padL + bw * i + 1, y: padT - 14, width: bw - 2, height: plotH + 14 + axisH - 2, rx: 6, fill: hoverMonth === i ? "rgba(15,42,68,.05)" : "transparent" }, g);
      const pTop = y(x.premium), careOn = x.care > 0.005, careH = careOn ? Math.max(2, y(x.premium) - y(x.premium + x.care)) : 0;
      bar(x0, base, pTop, barW, !careOn, COLOR.premium, g);
      if (careOn) bar(x0, pTop - 2, pTop - 2 - careH, barW, true, COLOR.care, g);
      if (x.hsa > 0.005) bar(x0, base + 2, Math.max(base + 4, y(-x.hsa)), barW, true, COLOR.hsa, g);
      if (V.view === "cum") svg("line", { x1: x0 - 4, x2: x0 + barW + 4, y1: y(x.net), y2: y(x.net), stroke: "var(--navy)", "stroke-width": 2, "stroke-linecap": "round" }, g);
      svg("text", { x: cx, y: padT + plotH + 18, "text-anchor": "middle", "font-size": 12, fill: "var(--muted)" }, g).textContent = narrow ? M[i].short[0] : M[i].short;
      if (i === labelAt) {
        const top = Math.min(pTop - (careOn ? careH + 2 : 0), V.view === "cum" ? y(x.net) : Infinity);
        svg("text", { x: cx, y: top - 6, "text-anchor": i === 11 ? "end" : "middle", dx: i === 11 ? barW / 2 + 4 : 0, "font-size": 13, "font-weight": 700, fill: "var(--navy)" }, g).textContent = fmt(x.net);
      }
      g.setAttribute("aria-label", `${M[i].long}, ${o.short}: premiums ${fmt(x.premium)}, your share of care ${fmt(x.care)}${x.hsa ? `, HSA deposit ${fmt(-x.hsa)}` : ""}, net ${fmt(x.net)}${V.view === "cum" ? " so far" : ""}`);
      const show = (ev) => { setHover(i); tip(o, i, S, g, ev); };
      g.addEventListener("pointerenter", show);
      g.addEventListener("pointermove", (ev) => place(g, ev.clientY));
      g.addEventListener("pointerleave", hide); g.addEventListener("focus", show); g.addEventListener("blur", hide);
    });
    box.append(g0); panel.append(box); host.append(panel);
  }
}
function setHover(i) {
  hoverMonth = i;
  if (!ctx || !ctx.host.isConnected) return;
  ctx.host.querySelectorAll(".band").forEach((g) => g.querySelector(".hl").setAttribute("fill", +g.dataset.m === i ? "rgba(15,42,68,.05)" : "transparent"));
}

// tooltip: values lead, labels follow; placed beside the month, never over its bar
function row(color, value, label, strong) {
  const k = h("i", { cls: "key" }); k.style.borderColor = color || "transparent";
  const s = h("span", { text: label }); if (strong) s.style.color = "var(--navy)";
  return h("div", { cls: "r" }, k, h("b", { text: value }), s);
}
function tip(o, i, S, g, ev) {
  const t = document.getElementById("tl-tip"), M = ctx.months, cum = V.view === "cum", x = S[o.key][cum ? "cum" : "month"][i];
  t.replaceChildren(h("div", { cls: "t", text: cum ? `${o.short}, ${M[0].long} to ${M[i].long}` : `${o.short}, ${M[i].long}` }),
    row(COLOR.premium, fmt(x.premium), "premiums"), row(COLOR.care, fmt(x.care), "your share of care"));
  if (x.hsa > 0.005) t.append(row(COLOR.hsa, fmt(-x.hsa), "employer HSA deposit"));
  const tot = row("var(--navy)", fmt(x.net), cum ? "net so far" : `net for ${M[i].name}`, true); tot.classList.add("tot"); t.append(tot);
  const why = h("div", { cls: "why" });
  if (!cum) {
    const ls = S[o.key].why[i];
    if (ls.length) { why.append(h("div", { text: "Care this month (by date of service):" })); for (const l of ls) why.append(h("div", { text: `${l.who}: ${l.service} → ${fmt(l.cost)} (${l.basis})` })); }
    else why.textContent = "No care this month, just the premium.";
  } else {
    const others = ctx.data.options.filter((p) => V.on.has(p.key) && p !== o);
    if (others.length) { why.append(h("div", { text: `Others by the end of ${M[i].name}:` })); for (const p of others) why.append(h("div", { text: `${p.short}: ${fmt(S[p.key].cum[i].net)}` })); }
  }
  if (why.childNodes.length) t.append(why);
  t.classList.add("on");
  place(g, ev && ev.clientY ? ev.clientY : g.getBoundingClientRect().top + 60);
}
function place(g, cy) {
  const t = document.getElementById("tl-tip"), b = g.querySelector(".hl").getBoundingClientRect();
  const w = t.offsetWidth, ht = t.offsetHeight;
  let left = b.right + 10, top = cy - ht / 2;
  if (left + w > innerWidth - 8) left = b.left - w - 10;
  if (left < 8) { left = Math.max(8, Math.min(innerWidth - w - 8, b.left)); top = b.bottom + 6 > innerHeight - ht - 8 ? b.top - ht - 6 : b.bottom + 6; }
  t.style.left = left + "px"; t.style.top = Math.max(8, Math.min(top, innerHeight - ht - 8)) + "px";
}
function hide() { const t = document.getElementById("tl-tip"); if (t) t.classList.remove("on"); if (hoverMonth !== -1) setHover(-1); }

function table(shown, S) {
  const M = ctx.months;
  const r1 = h("tr", {}, h("th", { rowspan: 2, text: "Month" })), r2 = h("tr");
  for (const o of shown) { r1.append(h("th", { colspan: 2, text: o.short })); r2.append(h("th", { text: "That month" }), h("th", { text: "So far" })); }
  const tb = h("tbody");
  M.forEach((m, i) => { const tr = h("tr", {}, h("td", { text: m.long })); for (const o of shown) tr.append(h("td", { text: fmt(S[o.key].month[i].net) }), h("td", { text: fmt(S[o.key].cum[i].net) })); tb.append(tr); });
  const sa = h("tr", { cls: "sa" }, h("td", { text: "Money to set aside" }));
  for (const o of shown) sa.append(h("td", { colspan: 2, text: fmt(setAside(S[o.key]).rounded) }));
  tb.append(sa);
  ctx.host.querySelector("#tl-table").replaceChildren(h("table", { cls: "tl-t" }, h("thead", {}, r1, r2), tb));
}

addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (ctx && ctx.host.isConnected) draw(); }, 120); });
addEventListener("scroll", hide, { passive: true });

/* Charts, drawn as SVG by hand: donuts, the money-flow picture, split bars and the 30-year curve.
   Amounts passed in are already in the household's chosen period. */
import { PERSON_COLOURS } from "../model/schema.js";
import { money, m0, pct } from "../model/format.js";
import { n } from "../model/util.js";
import { $, esc, trunc } from "./dom.js";

/* Same colour = same account everywhere. Personal accounts take shades of their owner's colour. */
const FAM = {
  joint: ["#2C846B", "#55A88A", "#86C5AC", "#1D654F", "#B2DCCA"],
  invest: ["#7A5AB0", "#9A7DC9", "#5C4287", "#C0AEE0"],
  other: ["#8A6D55", "#A88B72", "#6B5240", "#C9B19C"],
};
export function accountColours(state) {
  const used = {}, out = {}, people = Object.fromEntries(state.people.map(p => [p.id, p]));
  state.accounts.forEach(a => {
    const owner = people[a.owner];
    const key = a.type === "Joint" ? "joint" : a.type === "Investment" ? "invest" : owner ? "p:" + owner.colour : "other";
    const fam = key.startsWith("p:") ? PERSON_COLOURS[owner.colour].fam : FAM[key];
    used[key] = used[key] || 0;
    out[a.id] = fam[used[key]++ % fam.length];
  });
  return out;
}
/** A person's colour for use in SVG/inline styles (follows light/dark mode via CSS variables). */
export const personVar = p => `var(--c-${p.colour})`;

export function donutSVG(slices, total, label, perLabel) {
  const R = 88, r = 58, cx = 100, cy = 100, sum = slices.reduce((s, x) => s + x.v, 0);
  let a0 = -Math.PI / 2, paths = "";
  if (sum <= 0) paths = `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" style="stroke:var(--unalloc)" stroke-width="${R - r}"/>`;
  else slices.forEach(s => {
    if (s.v <= 0) return;
    const frac = s.v / sum, a1 = a0 + frac * Math.PI * 2, fill = s.un ? `style="fill:var(--unalloc);stroke:var(--surface)"` : `fill="${s.col}" style="stroke:var(--surface)"`;
    if (frac > 0.9999) { paths += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${s.un ? "var(--unalloc)" : s.col}" stroke-width="${R - r}"><title>${esc(s.name)}: ${money(s.v)}</title></circle>`; a0 = a1; return; }
    const lg = a1 - a0 > Math.PI ? 1 : 0, p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
    paths += `<path d="M${p(R, a0)} A${R} ${R} 0 ${lg} 1 ${p(R, a1)} L${p(r, a1)} A${r} ${r} 0 ${lg} 0 ${p(r, a0)}Z" ${fill} stroke-width="2"><title>${esc(s.name)}: ${money(s.v)} (${pct(frac)})</title></path>`;
    a0 = a1;
  });
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${esc(label)} allocation">${paths}
    <text x="100" y="98" text-anchor="middle" style="fill:var(--ink);font:650 21px var(--display);letter-spacing:-.5px">${m0(total)}</text>
    <text x="100" y="118" text-anchor="middle" style="fill:var(--faint);font:12px var(--body)">${esc(perLabel)}</text></svg>`;
}

/** One donut per person, plus a combined one when there's more than one person. */
export function drawDonuts(C, col, state, w) {
  const el = $("#donuts"); if (!el) return;
  const v = C.v;
  const mk = (pick, incomeV) => {
    const s = C.rows.map(r => ({ name: r.name || "Unnamed", v: v(pick(r)), col: col[r.id] }));
    const al = s.reduce((a, x) => a + Math.max(x.v, 0), 0);
    if (incomeV - al > 0.5) s.push({ name: "Not allocated", v: incomeV - al, un: true });
    return s;
  };
  let html = C.people.map(p => `<div class="donut">${donutSVG(mk(r => r.by[p.id], v(p.annual)), v(p.annual), p.name || "Person", w.per)}<div class="cap ${p.colour ? `person pc-${p.colour}` : ""}">${esc(p.name || "Unnamed")}</div></div>`).join("");
  if (C.multi) html += `<div class="donut">${donutSVG(mk(r => r.t, v(C.incTotal)), v(C.incTotal), "Combined", w.per)}<div class="cap">Combined</div></div>`;
  el.innerHTML = html;
  const un = v(C.incTotal - C.tot.t);
  $("#legend").innerHTML = C.rows.filter(r => r.t > 0).map(r => `<span><i style="background:${col[r.id]}"></i>${esc(r.name || "Unnamed")} <b>${money(v(r.t))}</b></span>`).join("") + (un > 0.5 ? `<span><i class="hatch"></i>Not allocated <b>${money(un)}</b></span>` : "");
}

export function drawSplit(el, parts, total, marks = []) {
  if (!el) return;
  el.innerHTML = parts.filter(p => p.v > 0).map(p => `<span style="width:${total > 0 ? (p.v / total * 100) : 0}%;background:${p.col}" title="${esc(p.name)}: ${money(p.v)}"></span>`).join("")
    + marks.map(m => `<i class="half" style="left:${m * 100}%"></i>`).join("");
}

/* Money flow (Sankey): pays → accounts → joint spending categories */
export function drawFlow(C, col, spendLabel) {
  const el = $("#flow"); if (!el) return;
  const v = C.v;
  const W = 1000, NW = 12, pad = 18, gM = 10, gR = 7, xL = 150, xM = 460, xR = 768;
  const L = C.people.map(p => ({ key: p.id, name: p.name || "Unnamed", v: v(p.annual), c: personVar(p) })).filter(x => x.v > 0);
  const mid = C.rows.filter(r => v(r.t) > 0.004).map(r => ({ key: r.id, name: r.name || "Unnamed", v: v(r.t), by: Object.fromEntries(Object.entries(r.by).map(([k, x]) => [k, v(x)])), c: col[r.id] }));
  const unBy = Object.fromEntries(C.people.map(p => [p.id, Math.max(v(p.annual - C.tot.amt[p.id]), 0)]));
  const unT = Object.values(unBy).reduce((a, x) => a + x, 0);
  if (unT > 0.5) mid.push({ key: "un", name: "Not allocated", v: unT, by: unBy, c: "var(--unalloc)", un: true });
  const totL = L.reduce((a, x) => a + x.v, 0), totM = mid.reduce((a, x) => a + x.v, 0);
  if (totL <= 0 || totM <= 0) { el.innerHTML = '<p class="empty">Add your pay and allocations above to see the money flow.</p>'; return; }
  const sp = C.rows.find(r => r.role === "spending"), js = sp && mid.find(m => m.key === sp.id);
  let right = [];
  if (js) {
    right = C.sp.filter(s => v(n(s.annual)) > 0.004).map(s => ({ key: s.id, name: s.name, v: v(s.annual), c: col[sp.id] }));
    if (v(C.spBuffer) > 0.5) right.push({ key: "buf", name: "Buffer", v: v(C.spBuffer), c: "var(--unalloc)", un: true });
  }
  const totR = right.reduce((a, x) => a + x.v, 0), over = js && totR > js.v + 0.01, sR = over ? js.v / totR : 1;
  const H = Math.max(380, Math.max(mid.length, right.length, L.length) * 40 + 2 * pad);
  let k = Math.min((H - 2 * pad - gM * (L.length - 1)) / totL, (H - 2 * pad - gM * (mid.length - 1)) / totM);
  if (right.length) k = Math.min(k, (H - 2 * pad - gR * (right.length - 1)) / (totR * sR));
  const stack = (arr, gap, start) => { let y = start; arr.forEach(x => { x.h = Math.max(x.v * k * (x.s || 1), 1.5); x.y = y; y += x.h + gap; }); return y - gap - start; };
  const hL = L.reduce((a, x) => a + Math.max(x.v * k, 1.5), 0) + gM * (L.length - 1); stack(L, gM, (H - hL) / 2);
  const hM = mid.reduce((a, x) => a + Math.max(x.v * k, 1.5), 0) + gM * (mid.length - 1); stack(mid, gM, (H - hM) / 2);
  if (right.length) {
    right.forEach(x => x.s = sR);
    const raw = right.reduce((a, x) => a + Math.max(x.v * k * sR, 1.5), 0);
    const gR2 = right.length > 1 ? Math.min(22, Math.max(gR, (H - 2 * pad - raw) * 0.75 / (right.length - 1))) : 0;
    const hR = raw + gR2 * (right.length - 1);
    let st = js.y + js.h / 2 - hR / 2; st = Math.max(pad, Math.min(H - pad - hR, st)); stack(right, gR2, st);
  }
  const band = (x0, y0, x1, y1, h) => { const xm = (x0 + x1) / 2; return `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}L${x1},${y1 + h}C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h}Z`; };
  let links = "", nodes = "", labels = "";
  const off = {}; L.forEach(x => off[x.key] = x.y);
  mid.forEach(m => {
    let my = m.y;
    L.forEach(src => {
      const val = m.by[src.key] || 0; if (val <= 0.004) return; const h = val * k;
      links += `<path class="flow-link" d="${band(xL + NW, off[src.key], xM, my, h)}" style="fill:${src.c};opacity:.28"><title>${esc(src.name)} → ${esc(m.name)}: ${money(val)}</title></path>`;
      off[src.key] += h; my += h;
    });
  });
  if (js) { let jy = js.y; right.forEach(r => { const h = r.v * k * sR; links += `<path class="flow-link" d="${band(xM + NW, jy, xR, r.y, h)}" style="fill:${r.un ? "var(--faint)" : col[sp.id]};opacity:${r.un ? .22 : .3}"><title>${esc(spendLabel)} → ${esc(r.name)}: ${money(r.v)}</title></path>`; jy += h; }); }
  const node = (x, o) => `<rect x="${x}" y="${o.y}" width="${NW}" height="${o.h}" rx="3" style="fill:${o.c}"><title>${esc(o.name)}: ${money(o.v)}</title></rect>`;
  const place = arr => {
    const ys = arr.map(o => ({ o, two: o.h >= 22, y: o.y + o.h / 2 })); ys.forEach(q => q.lh = q.two ? 30 : 15);
    for (let i = 1; i < ys.length; i++) { const min = ys[i - 1].y + (ys[i - 1].lh + ys[i].lh) / 2 + 2; if (ys[i].y < min) ys[i].y = min; }
    for (let i = ys.length - 1; i >= 0; i--) { const max = i === ys.length - 1 ? H - ys[i].lh / 2 : ys[i + 1].y - (ys[i + 1].lh + ys[i].lh) / 2 - 2; if (ys[i].y > max) ys[i].y = max; }
    ys.forEach(q => { q.o.ly = q.y; q.o.two = q.two; });
  };
  place(L); place(mid); place(right);
  const lab = (x, o, anchor, amt) => {
    const cy = o.ly !== undefined ? o.ly : o.y + o.h / 2, nm = esc(trunc(o.name, 30));
    const lead = o.ly !== undefined && Math.abs(o.ly - (o.y + o.h / 2)) > 2 ? `<path d="M${anchor === "start" ? x - 7 : x + 7},${o.y + o.h / 2} L${anchor === "start" ? x - 2 : x + 2},${cy}" style="stroke:var(--faint);fill:none" stroke-width="1"/>` : "";
    const style = "paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round";
    return lead + ((o.two !== undefined ? o.two : o.h >= 22)
      ? `<text x="${x}" y="${cy - 3}" text-anchor="${anchor}" style="fill:var(--ink);font:600 12px var(--body);${style}">${nm}</text><text x="${x}" y="${cy + 12}" text-anchor="${anchor}" style="fill:var(--muted);font:11px var(--body);${style}">${amt}</text>`
      : `<text x="${x}" y="${cy + 4}" text-anchor="${anchor}" style="fill:var(--ink);font:600 11.5px var(--body);${style}">${nm} <tspan style="fill:var(--muted);font-weight:400">${amt}</tspan></text>`);
  };
  L.forEach(o => { nodes += node(xL, o); labels += lab(xL - 10, o, "end", m0(o.v)); });
  mid.forEach(o => { nodes += node(xM, o); labels += lab(xM + NW + 8, o, "start", money(o.v)); });
  right.forEach(o => { nodes += node(xR, o); labels += lab(xR + NW + 8, { ...o, name: trunc(o.name, 25) }, "start", money(o.v)); });
  const hd = (x, t) => `<text x="${x + NW / 2}" y="12" text-anchor="middle" style="fill:var(--faint);font:600 10.5px var(--body);letter-spacing:.06em">${t}</text>`;
  const heads = hd(xL, "PAY") + hd(xM, "ACCOUNTS") + (right.length ? hd(xR, esc(spendLabel.toUpperCase())) : "");
  const warn = over ? `<text x="${xR}" y="${H - 4}" style="fill:var(--bad);font:600 11px var(--body)">Committed is ${money(totR - js.v)} more than the pool</text>` : "";
  el.innerHTML = `<svg viewBox="0 -6 ${W} ${H + 12}" role="img" aria-label="Money flow from pay to accounts to ${esc(spendLabel.toLowerCase())}">${heads}${links}${nodes}${labels}${warn}</svg>`;
}

function niceMax(v) { if (v <= 0) return 1000; const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }
const short = v => v >= 1e6 ? "$" + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : v >= 1e3 ? "$" + Math.round(v / 1e3) + "k" : "$" + Math.round(v);

export function drawCurve(C) {
  const el = $("#curve"); if (!el) return;
  const Y = C.inv.years, W = 820, H = 320, pl = 58, pr = 16, pt = 12, pb = 34;
  const max = niceMax(Math.max(...Y.map(d => Math.max(d.bal, d.contrib))));
  const x = y => pl + (y / 30) * (W - pl - pr), yv = v => pt + (1 - v / max) * (H - pt - pb);
  const line = k => Y.map((d, i) => (i ? "L" : "M") + x(d.y).toFixed(1) + " " + yv(d[k]).toFixed(1)).join("");
  let grid = "";
  for (let i = 0; i <= 4; i++) { const v = max * i / 4; grid += `<line x1="${pl}" x2="${W - pr}" y1="${yv(v)}" y2="${yv(v)}"/><text x="${pl - 10}" y="${yv(v) + 4}" text-anchor="end">${short(v)}</text>`; }
  for (const y of [0, 5, 10, 15, 20, 25, 30]) grid += `<text x="${x(y)}" y="${H - 10}" text-anchor="middle">${y === 0 ? "Now" : "Yr " + y}</text>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="30-year investment projection">
    <defs><linearGradient id="ig" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--invest);stop-opacity:.25"/><stop offset="1" style="stop-color:var(--invest);stop-opacity:0"/></linearGradient></defs>
    <g class="axis">${grid}</g>
    <path d="${line("bal")} L${x(30)} ${yv(0)} L${x(0)} ${yv(0)}Z" fill="url(#ig)"/>
    <path d="${line("contrib")}" fill="none" style="stroke:var(--faint)" stroke-width="2" stroke-dasharray="5 5"/>
    <path d="${line("bal")}" fill="none" style="stroke:var(--invest)" stroke-width="2.5" stroke-linejoin="round"/>
    <g id="hov" style="opacity:0"><line id="hl" y1="${pt}" y2="${H - pb}" style="stroke:var(--line-strong)"/><circle id="hb" r="5" style="fill:var(--invest);stroke:var(--surface)" stroke-width="2"/><circle id="hc" r="4" style="fill:var(--faint);stroke:var(--surface)" stroke-width="2"/></g>
    <rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" fill="transparent" id="hit"/></svg><div class="tip" id="tip"></div>`;
  const svg = $("svg", el), tip = $("#tip"), hov = $("#hov");
  $("#hit").addEventListener("pointermove", ev => {
    const b = svg.getBoundingClientRect(), sx = (ev.clientX - b.left) * (W / b.width);
    const yr = Math.max(0, Math.min(30, Math.round((sx - pl) / (W - pl - pr) * 30))), d = Y[yr];
    ["x1", "x2"].forEach(a => $("#hl").setAttribute(a, x(yr)));
    $("#hb").setAttribute("cx", x(yr)); $("#hb").setAttribute("cy", yv(d.bal)); $("#hc").setAttribute("cx", x(yr)); $("#hc").setAttribute("cy", yv(d.contrib));
    hov.style.opacity = 1;
    tip.innerHTML = `<b>${yr === 0 ? "Now" : "Year " + yr}</b><br>Balance ${m0(d.bal)}<br>Contributed ${m0(d.contrib)}<br>Growth ${m0(d.growth)}`;
    tip.style.left = (x(yr) / W * b.width + 18) + "px"; tip.style.top = (yv(d.bal) / H * b.height + 10) + "px"; tip.classList.add("on");
  });
  $("#hit").addEventListener("pointerleave", () => { hov.style.opacity = 0; tip.classList.remove("on"); });
}

/* ---------- Progress tab charts ---------- */
const PAD = { l: 62, r: 16, t: 14, b: 30 };
/** Draw at the width actually available, so the text stays readable on phones (not shrunk). */
const size = el => { const W = Math.max(300, Math.round(el.clientWidth || 820)); return { W, H: W < 560 ? 230 : 280 }; };
/** A round step (1, 2, 2.5 or 5 × 10ⁿ) so gridlines land on friendly numbers like $10k, $20k. */
function niceStep(raw) { const e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }
/** zero: always include $0 (for bars). Without it, the chart zooms in on the values so changes show. */
function scale(values, { zero = true } = {}) {
  let lo = Math.min(...values), hi = Math.max(...values);
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi - lo < 1) { lo -= 500; hi += 500; }
  if (!zero) { const pad = (hi - lo) * 0.15; lo -= pad; hi += pad; if (Math.min(...values) >= 0) lo = Math.max(0, lo); }
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  return { lo, hi, step };
}
const money0 = v => { const a = Math.abs(v); return (v < 0 ? "−" : "") + (a >= 1e6 ? "$" + +(a / 1e6).toFixed(2) + "M" : a >= 1e3 ? "$" + +(a / 1e3).toFixed(1) + "k" : "$" + Math.round(a)); };
const axis = (W, H, sc, y) => {
  let g = "";
  for (let v = sc.lo; v <= sc.hi + sc.step / 2; v += sc.step) g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${PAD.l - 8}" y="${y(v) + 4}" text-anchor="end">${money0(v)}</text>`;
  return g;
};

/** A line chart over time. points: [{label, now}], series: [{name, values, color}]. The step to "Now" is dashed. */
export function drawLineChart(el, points, series, aria) {
  if (!el) return;
  const { W, H } = size(el), n = points.length;
  const all = series.flatMap(s => s.values).filter(v => v !== null);
  const sc = scale(all, { zero: false });
  const x = i => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : i * (W - PAD.l - PAD.r) / (n - 1));
  const y = v => PAD.t + (1 - (v - sc.lo) / (sc.hi - sc.lo)) * (H - PAD.t - PAD.b);
  let lines = "", dots = "";
  series.forEach(s => {
    const pts = s.values.map((v, i) => v === null ? null : [x(i), y(v)]);
    const solid = pts.filter((p, i) => p && !points[i].now), last = pts[n - 1], prev = [...pts.slice(0, n - 1)].reverse().find(Boolean);
    if (solid.length > 1) lines += `<path d="${solid.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("")}" fill="none" style="stroke:${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
    if (points[n - 1].now && last && prev) lines += `<path d="M${prev[0]} ${prev[1]}L${last[0]} ${last[1]}" fill="none" style="stroke:${s.color}" stroke-width="2.5" stroke-dasharray="5 5"/>`;
    pts.forEach((p, i) => { if (p) dots += `<circle cx="${p[0]}" cy="${p[1]}" r="${points[i].now ? 5 : 4}" style="fill:${points[i].now ? "var(--surface)" : s.color};stroke:${s.color}" stroke-width="2"><title>${esc(points[i].label)} · ${esc(s.name)}: ${m0(s.values[i])}</title></circle>`; });
  });
  const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 90))));
  const labels = points.map((p, i) => i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle"${p.now ? ' style="font-weight:700"' : ""}>${esc(p.label)}</text>` : "").join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}"><g class="axis">${axis(W, H, sc, y)}${labels}</g>${sc.lo < 0 ? `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--line-strong)"/>` : ""}${lines}${dots}</svg>`;
}

/** Stacked bars per point: what you own above the line, what you owe below it. */
export function drawMixChart(el, points, parts) {
  if (!el) return;
  const { W, H } = size(el), n = points.length;
  const ups = points.map(p => parts.filter(q => !q.below).reduce((s, q) => s + Math.max(0, p[q.key]), 0));
  const downs = points.map(p => parts.filter(q => q.below).reduce((s, q) => s + Math.max(0, p[q.key]), 0));
  const sc = scale([...ups, ...downs.map(d => -d)]);
  const slot = (W - PAD.l - PAD.r) / n, bw = Math.min(46, slot * 0.6);
  const x = i => PAD.l + slot * i + (slot - bw) / 2;
  const y = v => PAD.t + (1 - (v - sc.lo) / (sc.hi - sc.lo)) * (H - PAD.t - PAD.b);
  let bars = "";
  points.forEach((p, i) => {
    let top = 0, bottom = 0;
    parts.forEach(q => {
      const v = Math.max(0, p[q.key]); if (!v) return;
      const [a, b] = q.below ? [-bottom, -(bottom += v)] : [top, (top += v)];
      const y1 = y(Math.max(a, b)), y2 = y(Math.min(a, b));
      bars += `<rect x="${x(i)}" y="${y1}" width="${bw}" height="${Math.max(1, y2 - y1)}" rx="3" style="fill:${q.color}${p.now ? ";opacity:.75" : ""}"><title>${esc(p.label)} · ${esc(q.name)}: ${m0(v)}</title></rect>`;
    });
  });
  const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 90))));
  const labels = points.map((p, i) => i % step === 0 || i === n - 1 ? `<text x="${x(i) + bw / 2}" y="${H - 8}" text-anchor="middle"${p.now ? ' style="font-weight:700"' : ""}>${esc(p.label)}</text>` : "").join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="What you own and owe over time"><g class="axis">${axis(W, H, sc, y)}${labels}</g><line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--line-strong)"/>${bars}</svg>`;
}

/** A tiny line of a goal's saved amount over time, with its target as a faint line. */
export function sparkline(values, target, color) {
  const W = 160, H = 40, vs = values.filter(v => v !== null);
  if (vs.length < 2) return "";
  const hi = Math.max(...vs, target || 0, 1);
  const x = i => 2 + i * (W - 4) / (values.length - 1), y = v => H - 3 - (v / hi) * (H - 6);
  const d = values.map((v, i) => v === null ? "" : `${i && values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">${target ? `<line x1="2" x2="${W - 2}" y1="${y(target)}" y2="${y(target)}" style="stroke:var(--line-strong)" stroke-dasharray="3 3"/>` : ""}<path d="${d}" fill="none" style="stroke:${color}" stroke-width="2"/></svg>`;
}

/* Phase 9C.1: a small doughnut (about 56–80px) for parts of a whole. Plain SVG, no library. Its text
   equivalent ("Jarden 56%, Madi 44%") is the accessible name, so nothing depends on colour or hover. */
import { esc } from "./dom.js";
import { donutParts } from "../model/chart.js";

/** parts: [{ label, v, col (any CSS colour, e.g. a var()) }]. Returns "" when a doughnut would mislead. */
export function miniDonut(parts, label, { size = 64, cls = "" } = {}) {
  const D = donutParts(parts); if (!D) return "";
  // r 15 + half the 5-wide stroke = 17.5, inside the 18-unit half-width: the ring is never clipped (Phase 9C.2)
  const gap = D.length > 1 ? 1.2 : 0; let at = 0;
  const segs = D.map(p => {
    const len = Math.max(0.01, p.frac * 100 - gap);
    const s = `<circle cx="18" cy="18" r="15" fill="none" style="stroke:${p.col}" stroke-width="5" stroke-dasharray="${len.toFixed(3)} ${(100 - len).toFixed(3)}" stroke-dashoffset="${(-at).toFixed(3)}" pathLength="100"/>`;
    at += p.frac * 100; return s;
  }).join("");
  const text = `${label}: ${D.map(p => `${p.label} ${p.pct}%`).join(", ")}`;
  return `<svg class="mini-donut ${cls}" width="${size}" height="${size}" viewBox="0 0 36 36" role="img" aria-label="${esc(text)}"><title>${esc(text)}</title><g transform="rotate(-90 18 18)">${segs}</g></svg>`;
}

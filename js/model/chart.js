/* Phase 9C.1: the maths behind the small doughnut charts. A doughnut only shows parts of one whole, so
   this refuses (null) when it would mislead: nothing to show, a negative part, or a value that isn't a
   number. Percent labels are whole numbers that always add up to 100 (largest remainder, ties in order). */
export function donutParts(parts) {
  if (!Array.isArray(parts) || parts.some(p => typeof p.v !== "number" || !isFinite(p.v) || p.v < -0.005)) return null;
  const shown = parts.filter(p => p.v > 0.005), total = shown.reduce((s, p) => s + p.v, 0);
  if (!shown.length || !(total > 0)) return null;
  const raw = shown.map(p => p.v / total * 100), pct = raw.map(Math.floor);
  let left = 100 - pct.reduce((s, x) => s + x, 0);
  raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i).forEach(({ i }) => { if (left > 0) { pct[i]++; left--; } });
  return shown.map((p, i) => ({ ...p, frac: p.v / total, pct: pct[i] }));
}

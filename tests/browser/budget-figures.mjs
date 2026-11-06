/* Shared by the Budget regression test: every calculated figure the Budget tab shows, for a budget,
   in each period (week, fortnight, month). Uses the tab's own fill() on the live page, so it compares
   exactly what the screen is given, not a re-calculation. */
import { open, settle } from "./helpers.js";
export async function budgetFigures(budget, opts = {}) {
  const { page, ctx } = await open(budget, opts);
  await settle(page);
  const out = {};
  for (const period of ["week", "fortnight", "month"]) {
    out[period] = await page.evaluate(async p => {
      const { app } = await import("./js/ui/ctx.js");
      const { compute } = await import("./js/model/calc.js");
      const b = await import("./js/ui/views/budget.js");
      const S = JSON.parse(JSON.stringify(app.state)); S.viewAs = p;
      const C = compute(S, app.today), D = {};
      const keep = app.state; app.state = S; try { b.fill(D, C); } finally { app.state = keep; }
      // plain text only; drop drawing hints (bar widths, colours) and the per-row "fill" buttons
      return Object.fromEntries(Object.entries(D).map(([k, v]) => [k, typeof v === "object" ? (v && "t" in v ? v.t : undefined) : v]).filter(([, v]) => v !== undefined));
    }, period);
  }
  await ctx.close();
  return out;
}

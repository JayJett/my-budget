/* Shared by the Spending regression test: every calculated figure the Spending tab shows, for a budget,
   in each period. Uses the tab's own fill() on the live page with a fixed "today" (so sinking-fund
   statuses don't drift with the calendar). */
import { open, settle } from "./helpers.js";
export async function spendingFigures(budget, today = [2026, 2, 1]) {
  const { page, ctx } = await open(budget);
  await settle(page);
  const out = {};
  for (const period of ["week", "fortnight", "month"]) {
    out[period] = await page.evaluate(async ([p, t]) => {
      const { app } = await import("./js/ui/ctx.js");
      const { compute } = await import("./js/model/calc.js");
      const m = await import("./js/ui/views/spending.js");
      const S = JSON.parse(JSON.stringify(app.state)); S.viewAs = p;
      const C = compute(S, new Date(t[0], t[1], t[2])), D = {};
      const keep = app.state; app.state = S; try { m.fill(D, C); } finally { app.state = keep; }
      return Object.fromEntries(Object.entries(D).map(([k, v]) => [k, typeof v === "object" ? (v && "t" in v ? `${v.t}|${v.c || ""}` : undefined) : v]).filter(([, v]) => v !== undefined));
    }, [period, today]);
  }
  await ctx.close();
  return out;
}

/* Test budgets for the different spending situations (all from the shared RICH fixture). */
export function spendingCases(RICH, toStored, migrate) {
  const base = () => migrate(RICH);
  const solo = (pay, share, spend) => { const s = base(); s.people = s.people.filter(p => p.id === "j"); s.accounts = s.accounts.filter(a => a.owner !== "m"); s.accounts.forEach(a => { delete a.split.m; a.split.j = 0; }); delete s.goals.personal.m;
    s.people[0].pay = pay; s.people[0].freq = "fortnightly"; s.accounts.find(a => a.id === "js").split.j = share; s.spend = spend; return toStored(s); };
  const it = (id, name, type, amount, period, extra = {}) => ({ id, name, type, amount, period, notes: "", due: null, aside: null, pos: Number(id.replace(/\D/g, "")) || 1, ...extra });
  return {
    rich: toStored(base()),
    over: solo(1000, 0.6, [it("e1", "Rent", "Fixed", 500, "Fortnight"), it("e2", "Groceries", "Flexible", 250, "Fortnight"), it("e3", "Car registration", "Sinking", 190, "Year", { due: 10, aside: 50 })]),
    exact: solo(1000, 0.6, [it("e1", "Rent", "Fixed", 600, "Fortnight")]),
    nopool: solo(1000, 0, [it("e1", "Rent", "Fixed", 500, "Fortnight"), it("e2", "Insurance", "Sinking", 1300, "Year")]),
    empty: solo(1000, 0.6, []),
  };
}

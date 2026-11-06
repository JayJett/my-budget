/* Shared by the Net worth and Goals regression tests: every calculated figure those tabs show, for a
   budget, in each period. Uses each tab's own fill() on the live page with a fixed "today" (so goal
   finish dates and the review reminder don't drift with the calendar). */
import { open, settle } from "./helpers.js";
export async function tabFigures(tab, budget, today = [2026, 2, 1]) {
  const { page, ctx } = await open(budget);
  await settle(page);
  const out = {};
  for (const period of ["week", "fortnight", "month"]) {
    out[period] = await page.evaluate(async ([tab, p, t]) => {
      const { app } = await import("./js/ui/ctx.js");
      const { compute } = await import("./js/model/calc.js");
      const m = await import(`./js/ui/views/${tab}.js`);
      const S = JSON.parse(JSON.stringify(app.state)); S.viewAs = p;
      const C = compute(S, new Date(t[0], t[1], t[2])), D = {};
      const keep = app.state; app.state = S; try { m.fill(D, C); } finally { app.state = keep; }
      return Object.fromEntries(Object.entries(D).map(([k, v]) => [k, typeof v === "object" ? (v && "t" in v ? `${v.t}|${v.c || ""}` : v && "w" in v ? `w:${v.w}` : undefined) : v]).filter(([, v]) => v !== undefined));
    }, [tab, period, today]);
  }
  await ctx.close();
  return out;
}

/* Test budgets for the different Net worth and Goals situations (all from the shared RICH fixture). */
export function nwGoalsCases(RICH, toStored, migrate) {
  const base = () => migrate(RICH);
  const solo = () => { const s = base(); s.people = s.people.filter(p => p.id === "j"); s.accounts = s.accounts.filter(a => a.owner !== "m"); s.accounts.forEach(a => { delete a.split.m; });
    delete s.goals.personal.m; s.goals.joint.forEach(g => { delete g.split.m; }); return s; };
  const acct = (id, name, type, balance, pos) => ({ id, name, type, balance, pos });
  // One person; savings split over two accounts; a duplicate name, an unnamed account, a zero-balance
  // savings account, and a goal tagged to an account that isn't savings.
  const mixed = solo();
  mixed.nw.accounts = [acct("a1", "Everyday", "Operating", 2450.5, 1), acct("a2", "Emergency", "Savings", 8000, 2), acct("a3", "Holiday pot", "Savings", 2500, 3),
    acct("a4", "Holiday pot", "Savings", 100, 4), acct("a5", "", "Investment", 300, 5), acct("a6", "Empty jar", "Savings", 0, 6), acct("a7", "KiwiSaver", "Super", 22500, 7), acct("a8", "Student loan", "Debt", 6200.25, 8)];
  mixed.goals.ef.account = "Emergency"; mixed.goals.ef.saved = 6000;
  mixed.goals.joint = [{ id: "g1", name: "Trip", target: 4000, saved: 1000, account: "Everyday", split: { j: 0.6 }, deadline: "", pos: 1 },
    { id: "g2", name: "Phone", target: 1500, saved: 1500, account: "Emergency", split: { j: 0.4 }, deadline: "2026-12-01", pos: 2 }];
  mixed.goals.personal.j = [{ id: "g3", name: "Bike", target: 1500, saved: 250, account: "Empty jar", pct: 1, deadline: "2026-04-01", pos: 1 }];
  // Every savings dollar earmarked exactly
  const exact = base(); exact.nw.accounts.find(a => a.id === "n2").balance = 13200;
  // Nothing on Net worth at all, and no goals filled in
  const empty = solo(); empty.nw.accounts = []; empty.nw.reviewed = ""; empty.goals.joint = []; empty.goals.personal.j = []; empty.goals.ef = { ...empty.goals.ef, target: null, saved: null, account: "" };
  return { rich: toStored(base()), mixed: toStored(mixed), exact: toStored(exact), empty: toStored(empty) };
}

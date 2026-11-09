/* Phase 9B: budget intelligence on screen. Marking expenses essential or flexible, marking allocations
   adjustable, the expense check on Budget (Phase 9B.1: one finding, details on request), Essentials on Expenses, the facts on Home, and that looking never
   changes anything. Uses the fake Supabase (no real accounts or data). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored, blankBudget } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, fake, goTab, settle } from "./helpers.js";

setup();
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
const phone = (w = 390, h = 844) => ({ device: { viewport: { width: w, height: h }, hasTouch: true, isMobile: true } });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p9b-${name}.png`) });
const budgetOf = page => fake(page, () => window.__fake.budget);
const tab = (page, t) => page.evaluate(t => document.querySelector(`#tabs [data-tab="${t}"]`).click(), t);
/** A solo budget: $2,000 a fortnight, half to the bills allocation, and the given expenses. */
function solo(spend, shares = { spending: 0.5, emergency: 0.1, goals: 0.15, invest: 0.1 }) {
  const S = blankBudget({ name: "Jarden", mode: "solo" }), p = S.people[0]; p.pay = 2000; p.payday = "2026-11-05";
  S.accounts.forEach(a => { if (shares[a.role] != null) a.split[p.id] = shares[a.role]; });
  S.spend = spend.map((x, i) => ({ id: "e" + i, name: x[0], type: x[1], amount: x[2], period: x[3] || "Fortnight", notes: "", due: null, aside: null, pos: i + 1, ...(x[4] ? { need: x[4] } : {}) }));
  return toStored(S);
}

test("Expenses: mark an expense essential; the Essentials card and Home follow; nothing else changes", { skip }, async () => {
  const { page, errors, ctx } = await open(solo([["Rent", "Fixed", 700], ["Takeaways", "Flexible", 100]]), { ...phone(), storage: ALL_DONE, hash: "expenses", waitFor: "#spEss" });
  assert.match(await page.textContent("#spEss"), /Not marked\s*\$800\/fn/);
  assert.match(await page.textContent("#spEss"), /2 expenses aren’t marked yet/);
  const before = await budgetOf(page);
  await page.click('#spEss [data-home-click]'); // "Mark them": opens the first unmarked expense
  await page.waitForSelector('#sheet [data-f="need"]');
  await page.check('#sheet input[data-f="need"][value="essential"]', { force: true }); await settle(page);
  await page.click('#sheet .sheet-head [data-sheet="close"]');
  await page.click('[data-edit-sp="e1"]'); await page.waitForSelector('#sheet [data-f="need"]');
  await page.check('#sheet input[data-f="need"][value="flexible"]', { force: true }); await settle(page);
  await page.click('#sheet .sheet-head [data-sheet="close"]'); await page.waitForSelector("#sheet", { state: "hidden" });
  const after = await budgetOf(page);
  assert.equal(after.spend.e0.need, "essential"); assert.equal(after.spend.e1.need, "flexible");
  const strip = s => Object.fromEntries(Object.entries(s).map(([k, v]) => { const { need, ...r } = v; return [k, r]; }));
  assert.deepEqual(strip(after.spend), strip(before.spend), "only the mark changed");
  assert.deepEqual(after.accounts, before.accounts);
  await page.waitForFunction(() => /Essential\s*\$700\/fn/.test(document.querySelector("#spEss").textContent));
  assert.match(await page.textContent("#spEss"), /35% of pay/);
  assert.doesNotMatch(await page.textContent("#spEss"), /aren’t marked/);
  assert.match(await page.textContent("#app .sp-head"), /not yet assigned to an expense/, "budget minus planned isn't called spare");
  await shot(page, "expenses");
  await tab(page, "home"); await page.waitForSelector(".ho-lines");
  assert.match(await page.textContent(".ho-lines"), /Essentials\s*\$700\/fn · 35% of pay/);
  assert.match(await page.textContent(".ho-lines"), /Expenses\s*Fit their budget/);
  assert.match(await page.textContent(".ho-lines"), /Room to adjust\s*Up to \$600\/fn/, "300 with no plan + 200 not assigned + 100 flexible");
  assert.deepEqual(errors, []); await ctx.close();
});

const expand = async page => { await page.click("#planCheck [data-pc-toggle]"); await page.waitForSelector("#pcBody:not([hidden])"); };

test("Budget: one finding about expenses; where pay goes and room to adjust behind 'View breakdown'; 'adjustable' only when you say so", { skip }, async () => {
  const { page, errors, ctx } = await open(solo([["Rent", "Fixed", 900, "Fortnight", "essential"]]), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  const pc = () => page.textContent("#planCheck");
  // Phase 9B.1: income card first, the expense check right under it, no visible "Plan check" title
  const order = await page.$$eval(".budget > .b-col > *, .budget > *:not(.b-col)", els => els.filter(e => e.offsetParent).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(e => e.className.split(" ").find(c => c.startsWith("b-")) || e.id));
  assert.deepEqual(order.slice(0, 3), ["b-income", "b-check", "b-status"]);
  assert.doesNotMatch(await pc(), /Plan check/);
  assert.equal(await page.getAttribute("#planCheck", "aria-label"), "Expense check");
  assert.match(await page.textContent("#planCheck .pc-main"), /Your expenses are covered\s*\$100\/fn not yet assigned to an expense/);
  assert.equal(await page.isVisible("#pcBody"), false, "details start closed");
  assert.equal(await page.getAttribute("[data-pc-toggle]", "aria-expanded"), "false");
  assert.doesNotMatch(await pc(), /Every dollar of pay has a plan|not money in your account|right for you/, "no repeated or explanatory lines");
  await shot(page, "check-covered");
  await expand(page);
  assert.equal(await page.getAttribute("[data-pc-toggle]", "aria-expanded"), "true");
  assert.match(await pc(), /Pay with no plan yet\s*\$300\/fn/);
  assert.match(await pc(), /Room to adjust\s*up to \$400\/fn/, "300 unplanned + 100 of bills not assigned");
  assert.doesNotMatch(await pc(), /Marked adjustable/, "nothing is assumed adjustable, not even investing");
  assert.match(await page.textContent('[data-k="acc.js.cov"]'), /Covers your entered expenses/);
  const keys = await page.$$eval("#planCheck .ib-key li span", e => e.map(x => x.textContent));
  assert.deepEqual(keys, ["Essential expenses", "Bills budget not yet assigned", "Saving & investing", "No plan yet"]);
  await page.$eval("#planCheck", e => e.scrollIntoView()); await shot(page, "check-open");
  // mark Investments adjustable; the breakdown stays open across the redraw
  await page.click('[data-edit-acc="ji"]'); await page.waitForSelector('#sheet [data-f="adjustable"]');
  await page.check('#sheet input[data-f="adjustable"][value="yes"]', { force: true }); await settle(page);
  assert.equal((await budgetOf(page)).accounts.ji.adjustable, "yes");
  await page.click('#sheet .sheet-head [data-sheet="close"]'); await page.waitForSelector("#sheet", { state: "hidden" });
  assert.match(await pc(), /Marked adjustable: Investments\s*\$200\/fn/);
  assert.match(await pc(), /up to \$600\/fn/);
  assert.equal(await page.isVisible("#pcBody"), true);
  await page.click("#planCheck [data-pc-toggle]"); assert.equal(await page.isVisible("#pcBody"), false, "collapses again");
  // the bills allocation can't be marked adjustable (its money is already planned for expenses)
  await page.click('[data-edit-acc="js"]'); await page.waitForSelector("#sheet .bsheet");
  assert.equal(await page.locator('#sheet [data-f="adjustable"]').count(), 0);
  assert.deepEqual(errors, []); await ctx.close();
});

test("a shortfall is a problem everywhere, the same amount; it leads the Budget card even when every dollar has a plan", { skip }, async () => {
  const { page, errors, ctx } = await open(solo([["Rent", "Fixed", 1120, "Fortnight", "essential"]], { spending: 0.5, emergency: 0.1, goals: 0.25, invest: 0.15 }), { ...phone(), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  assert.match(await page.textContent(".ho-next"), /Planned expenses are over their budget/);
  assert.match(await page.textContent(".ho-next"), /By \$120\/fn/);
  assert.match(await page.textContent(".ho-lines"), /Over budget by \$120\/fn/);
  await tab(page, "budget"); await page.waitForSelector("#planCheck");
  assert.match(await page.textContent("#planCheck .pc-main"), /Expenses are over budget\s*\$120\/fn short/);
  assert.equal(await page.getAttribute("#planCheck .pc-main", "data-insight"), "short");
  assert.doesNotMatch(await page.textContent("#planCheck"), /Every dollar of pay has a plan/, "100% allocated isn't repeated here");
  assert.match(await page.textContent('[data-k="acc.js.cov"]'), /Short of expenses by \$120\/fn/);
  assert.equal(await page.locator("#planCheck .ib-bar").count(), 0, "no combined bar when the parts can't add up");
  await expand(page);
  assert.match(await page.textContent("#planCheck"), /Less expenses over budget\s*−\$120\/fn/);
  await page.$eval("#planCheck", e => e.scrollIntoView()); await shot(page, "check-short");
  await page.click("#planCheck .pc-act");
  await page.waitForFunction(() => location.hash === "#expenses");
  assert.deepEqual(errors, []); await ctx.close();
});

test("no expenses yet: no made-up coverage or essentials; one clear next step", { skip }, async () => {
  const { page, errors, ctx } = await open(solo([], { spending: 0.5, emergency: 0.1, goals: 0.25, invest: 0.15 }), { ...phone(), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  assert.equal(await page.locator(".ho-lines").count(), 0, "nothing to say yet");
  assert.match(await page.textContent(".ho-next"), /Add your regular expenses/);
  await tab(page, "spending"); await page.waitForSelector("#app .sp-empty");
  assert.equal(await page.locator("#spEss").count(), 0);
  await tab(page, "budget"); await page.waitForSelector("#planCheck");
  const pc = await page.textContent("#planCheck");
  assert.doesNotMatch(pc, /expenses are covered/i, "no 'covered' without expenses");
  assert.match(await page.textContent("#planCheck .pc-main"), /Add expenses to check they’re covered/);
  assert.equal(await page.locator("#planCheck [data-pc-toggle]").count(), 0, "Phase 9C.2: nothing to break down yet, so no breakdown");
  await page.click("#planCheck .pc-act"); await page.waitForSelector("#sheet .xp");
  assert.deepEqual(errors, []); await ctx.close();
});

test("an unmarked-expense finding (in the breakdown) opens that very expense", { skip }, async () => {
  const { page, errors, ctx } = await open(solo([["Rent", "Fixed", 700, "Fortnight", "essential"], ["Gym", "Fixed", 30]]), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  await expand(page);
  await page.click('#planCheck [data-insight="unmarked"]');
  await page.waitForSelector('#sheet [data-l="sp"][data-i="e1"]');
  assert.equal(await page.inputValue('#sheet [data-l="sp"][data-i="e1"][data-f="name"]'), "Gym");
  assert.deepEqual(errors, []); await ctx.close();
});

test("Home: the greeting stands alone; ordinary cards are flat, the household menu still floats", { skip }, async () => {
  const { page, errors, ctx } = await open(solo([["Rent", "Fixed", 700, "Fortnight", "essential"]]), { ...phone(), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  assert.equal(await page.locator(".ho-greet p").count(), 0);
  assert.doesNotMatch(await page.textContent("#app"), /shown per fortnight|payday plan started/);
  for (const t of ["home", "budget", "spending", "goals", "wealth"]) {
    await tab(page, t); await page.waitForTimeout(150);
    const shadows = await page.$$eval("#app .card, #app .ho-fig, #app .gl-card, #app .stat, #app .panel", els => els.filter(e => getComputedStyle(e).boxShadow !== "none").map(e => e.className));
    assert.deepEqual(shadows, [], `${t}: flat cards`);
  }
  await page.click("#hhBtn"); await page.waitForSelector("#hhPop:not([hidden])");
  assert.notEqual(await page.$eval("#hhPop", e => getComputedStyle(e).boxShadow), "none", "the dropdown keeps its lift");
  assert.deepEqual(errors, []); await ctx.close();
});

test("looking changes nothing: visiting every screen saves nothing", { skip }, async () => {
  const { page, errors, ctx } = await open(toStored(migrate(RICH_V3)), { ...phone(), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
  const seq = await fake(page, () => window.__fake.seq);
  for (const t of ["budget", "spending", "goals", "wealth", "home"]) { await tab(page, t); await page.waitForTimeout(200); }
  assert.equal(await fake(page, () => window.__fake.seq), seq);
  assert.deepEqual(errors, []); await ctx.close();
});

test("switching households: every summary is the new household's", { skip }, async () => {
  const init = { households: [
    { id: "hh-1", name: "Ours", role: "owner", budget: solo([["Rent", "Fixed", 1120, "Fortnight", "essential"]]) },
    { id: "hh-2", name: "Mum’s", role: "editor", budget: solo([["Rates", "Fixed", 300, "Fortnight", "essential"]]) },
  ] };
  const { page, errors, ctx } = await open(null, { ...phone(), storage: ALL_DONE, init, hash: "", waitFor: "#app .home" });
  assert.match(await page.textContent(".ho-lines"), /Over budget by \$120/);
  await page.click("#hhBtn"); await page.click('#hhPop [data-switch="hh-2"]');
  await page.waitForFunction(() => /Mum/.test(document.querySelector("#brandNames").textContent) && document.querySelector(".ho-lines"));
  assert.doesNotMatch(await page.textContent("#app"), /Over budget by \$120/);
  assert.match(await page.textContent(".ho-lines"), /Essentials\s*\$300\/fn · 15% of pay/);
  assert.match(await page.textContent(".ho-lines"), /Fit their budget/);
  assert.deepEqual(errors, []); await ctx.close();
});

test("shared household with mixed pay: essentials as a share of everyone's pay; personal money isn't counted for shared bills", { skip }, async () => {
  const m = migrate(RICH_V3); m.spend.forEach(s => { s.need = "essential"; });
  const { page, errors, ctx } = await open(toStored(m), { ...phone(), storage: ALL_DONE, hash: "budget", waitFor: "#planCheck" });
  const r = await page.evaluate(async () => {
    const { app } = await import("./js/ui/ctx.js"); const I = await import("./js/model/intelligence.js");
    const cv = I.coverage(app.state, app.C), cm = I.commitments(app.state, app.C);
    return { budget: cv.budget, pool: app.C.pool.spending, share: I.essentialShare(app.C, cm), inc: app.C.incTotal, ess: cm.essential, committed: app.C.committed };
  });
  assert.equal(r.budget, r.pool, "only the shared bills allocation");
  assert.ok(Math.abs(r.share - r.ess / r.inc) < 1e-12); assert.ok(Math.abs(r.ess - r.committed) < 1e-9);
  await expand(page); await page.$eval("#planCheck", e => e.scrollIntoView());
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []); await ctx.close();
});

test("320–430px: Home, Plan check and Essentials fit, with big numbers too", { skip }, async () => {
  const S = JSON.parse(JSON.stringify(solo([["Mortgage", "Fixed", 98765, "Month", "essential"], ["Fun", "Flexible", 5000, "Week", "flexible"]], { spending: 0.9, emergency: 0.05, goals: 0.05, invest: 0 })));
  Object.values(S.people)[0].pay = 987654;
  for (const w of [320, 375, 390, 430]) {
    const { page, errors, ctx } = await open(S, { ...phone(w, 760), storage: ALL_DONE, hash: "", waitFor: "#app .home" });
    for (const t of ["home", "budget", "spending"]) {
      await tab(page, t); await page.waitForTimeout(150);
      if (t === "budget") { await expand(page); await page.$eval("#planCheck", e => e.scrollIntoView()); if (w === 320) await shot(page, "check-320"); }
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1), false, `${w} ${t}`);
    }
    assert.deepEqual(errors, [], `${w}`); await ctx.close();
  }
});

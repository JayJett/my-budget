/* Phase 10A: the Budget tab, calmer and more compact. Presentation only: every figure is still checked
   against the old screen by budget-ui.test.js ("every Budget figure is exactly what the old screen showed"). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored, blankBudget } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake, budgetManage, editAccount, closeSheet } from "./helpers.js";

setup();
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
const phone = (w = 390, h = 844) => ({ device: { viewport: { width: w, height: h }, hasTouch: true, isMobile: true } });
const NOV9 = new Date(2026, 10, 9, 12);
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p10a-${name}.png`) });
const rich = (f = s => s) => toStored(f(migrate(RICH_V3)));
const solo = (f = s => s) => { const S = blankBudget({ name: "Sam", mode: "solo" }), p = S.people[0]; p.pay = 2000; p.payday = "2026-11-12"; return toStored(f(S, p.id)); };
const opts = (w, h) => ({ ...phone(w, h), storage: ALL_DONE, clock: NOV9 });

test("the first screen: income, status and the start of the allocations, without scrolling (375 and 390)", { skip }, async () => {
  for (const [w, h] of [[375, 812], [390, 844]]) {
    const { page, errors, ctx } = await open(rich(), opts(w, h));
    await settle(page);
    const r = await page.evaluate(() => {
      const top = s => document.querySelector(s).getBoundingClientRect(), bar = top("#tabs").top;
      return { income: top(".b-income").bottom <= bar, status: top("#allocStatus").bottom <= bar, alloc: top(".alloc-row").bottom <= bar,
        order: [".b-income", "#allocStatus", ".b-allocs", "#fairSec", ".b-insights"].map(s => Math.round(top(s).top)) };
    });
    assert.ok(r.income && r.status && r.alloc, `${w}: ${JSON.stringify(r)}`);
    assert.deepEqual([...r.order].sort((a, b) => a - b), r.order, "income, status, allocations, fair split, breakdowns");
    if (w === 390) await shot(page, "first-screen-390");
    assert.deepEqual(errors, []); await ctx.close();
  }
});

test("income: one total, a bar of who brings in what, a tap per person; pay details and Add a person on request", { skip }, async () => {
  const { page, errors, ctx } = await open(rich(), opts());
  await settle(page);
  assert.equal(await page.textContent('.b-income [data-k="inc.c"]'), "$4,300");
  assert.equal(await page.getAttribute("#incBar", "aria-label"), "Share of household pay: Jarden 56%, Madi 44%");
  assert.deepEqual(await page.$$eval(".bi-p", e => e.map(x => x.innerText.replace(/\s+/g, " ").trim())), ["Jarden $2,400 56%", "Madi $1,900 44%"]);
  assert.equal(await page.isVisible("[data-person-new]"), false, "Add a person waits under Pay details");
  await page.click("[data-inc-more]");
  assert.equal(await page.getAttribute("[data-inc-more]", "aria-expanded"), "true");
  assert.match(await page.textContent("#incMore"), /Jarden\s*\$2,400 fortnightly/);
  assert.equal(await page.isVisible("[data-person-new]"), true);
  // stays open when the page redraws (changing the period)
  await page.click('[data-viewas="month"]'); await settle(page);
  assert.equal(await page.isVisible("#incMore"), true);
  assert.equal(await page.textContent('.b-income [data-k="inc.c"]'), "$9,317");
  // tapping a person still opens their pay
  await page.click('[data-edit-person="m"]'); await page.waitForSelector('#sheet [data-l="pp"][data-i="m"][data-f="pay"]');
  assert.deepEqual(errors, []); await ctx.close();
});

test("status: one headline; people only listed while someone isn't done; expenses checked separately; next payday", { skip }, async () => {
  // all allocated, but the expenses are bigger than their budget: both are said, neither implies the other
  const a = await open(rich(s => { s.spend.push({ id: "big", name: "Mortgage", type: "Fixed", amount: 5000, period: "Fortnight", notes: "", due: null, aside: null, pos: 99 }); return s; }), opts());
  await settle(a.page);
  assert.equal(await a.page.textContent('[data-k="st.summary"]'), "All $4,300 allocated");
  assert.equal(await a.page.isVisible("#allocStatus .st-list"), false, "no row of full bars");
  assert.match(await a.page.textContent("#planCheck .pc-main"), /Expenses are over budget/);
  assert.match(await a.page.textContent("#allocStatus .bs-pay"), /Payday plan\s*Next Thu 12 Nov · in 3 days · Madi/);
  await a.page.click("#allocStatus [data-pb-open]"); await a.page.waitForSelector("#sheet .pb");
  assert.deepEqual(a.errors, []); await a.ctx.close();
  // over-allocated: said in money, with who
  const b = await open(rich(s => { s.accounts.find(x => x.id === "js").split.m = 0.55; return s; }), opts());
  await settle(b.page);
  assert.equal(await b.page.textContent('[data-k="st.summary"]'), "Over-allocated by $190");
  assert.match(await b.page.textContent('[data-k="st.sub"]'), /^Madi: more is planned/);
  assert.equal(await b.page.isVisible('[data-st="m"]'), true); assert.equal(await b.page.isVisible('[data-st="j"]'), false);
  assert.deepEqual(b.errors, []); await b.ctx.close();
  // one person, something left: Fill tops it up
  const c = await open(solo((S, pid) => { S.accounts.find(x => x.role === "spending").split[pid] = 0.6; return S; }), opts());
  await settle(c.page);
  assert.equal(await c.page.textContent('[data-k="st.summary"]'), "$800 left to allocate");
  await c.page.click("[data-fill]"); await c.page.click('#pop [data-acc="ef"]'); await settle(c.page);
  assert.equal(await c.page.textContent('[data-k="st.summary"]'), "All $2,000 allocated");
  assert.equal(await c.page.isVisible("#allocStatus .st-list"), false);
  assert.deepEqual(c.errors, []); await c.ctx.close();
});

test("allocations: short names beside the owner's name, saved names untouched; one period for every amount", { skip }, async () => {
  const { page, errors, ctx } = await open(rich(), opts());
  await settle(page);
  const row = id => page.evaluate(id => { const r = document.querySelector(`[data-edit-acc="${id}"]`); return { name: r.querySelector(".a-name").textContent, meta: r.querySelector(".a-meta").textContent.replace(/\s+/g, " ").trim(), label: r.getAttribute("aria-label"), amt: r.querySelector(".a-amt").textContent }; }, id);
  assert.deepEqual(await row("jpg"), { name: "Personal Goals", meta: "Jarden · Personal", label: "Jarden — Personal Goals, Jarden’s: edit", amt: "$240" });
  assert.deepEqual(await row("xms"), { name: "Spending", meta: "Madi · Personal", label: "Madi Spending, Madi’s: edit", amt: "$475" });
  assert.deepEqual(await row("js"), { name: "Joint Spending", meta: "Jarden $960Madi $855", label: "Joint Spending, shared: edit", amt: "$1,815" });
  assert.match(await page.textContent(".b-allocs .b-per"), /Amounts per fortnight/);
  // the edit sheet, and what's saved, still have the full name
  await editAccount(page, "jpg");
  assert.equal(await page.inputValue('#sheet [data-l="acc"][data-i="jpg"][data-f="name"]'), "Jarden — Personal Goals");
  await closeSheet(page);
  assert.equal((await fake(page, () => window.__fake.budget)).accounts.jpg.name, "Jarden — Personal Goals");
  assert.equal(await page.isVisible('[data-k="acc.js.cov"]'), false, "the status card already says the expenses are covered");
  await page.click(".b-allocs [data-acc-new]"); await page.waitForSelector('#sheet .bsheet [data-f="name"]:focus');
  assert.deepEqual(errors, []); await ctx.close();
});

test("Manage: Rebalance and Reorder in one small menu; Done ends reordering", { skip }, async () => {
  const { page, errors, ctx } = await open(rich(), opts());
  await settle(page);
  assert.equal(await page.locator(".b-allocs [data-reorder], .b-allocs [data-rb-open]").count(), 0, "not in the heading any more");
  await page.click("[data-b-manage]");
  assert.deepEqual(await page.$$eval("#pop [data-mg]", e => e.map(x => x.dataset.mg)), ["rebalance", "reorder"]);
  await shot(page, "manage");
  await page.click('#pop [data-mg="rebalance"]'); await page.waitForSelector("#sheet .rb");
  await page.click('#sheet [data-rb="close"]'); await page.waitForSelector("#sheet", { state: "hidden" });
  await budgetManage(page, "reorder");
  assert.equal(await page.locator("[data-b-manage], .b-allocs [data-acc-new]").count(), 0, "just Done while reordering");
  await page.click('[data-move="down"][data-i="js"]'); await settle(page);
  assert.deepEqual(Object.values((await fake(page, () => window.__fake.budget)).accounts).sort((a, b) => a.pos - b.pos).slice(0, 2).map(a => a.id), ["ef", "js"]);
  await page.click(".b-allocs [data-reorder]");
  assert.equal(await page.locator(".alloc-list.reordering").count(), 0);
  assert.deepEqual(errors, []); await ctx.close();
});

test("fair split: the verdict and two short lines; bars and sums on request", { skip }, async () => {
  const { page, errors, ctx } = await open(rich(), opts());
  await settle(page);
  assert.equal(await page.textContent("#fairSec .fair-verdict"), "You’re splitting in proportion to income");
  assert.deepEqual(await page.$$eval("#fairSec .fs-rows li", e => e.map(x => x.innerText.replace(/\s+/g, " ").trim())), ["Jarden 56% of shared money · 56% of income", "Madi 44% of shared money · 44% of income"]);
  assert.equal(await page.isVisible("#fbInc"), false, "the bars wait behind See the details");
  await page.click("#fairSec .fs-more summary");
  assert.equal(await page.isVisible("#fbSh"), true);
  assert.match(await page.textContent('#fairSec [data-k="fair.detail"]'), /An equal split would be \$1,397\.50 each/);
  // one person: no fair split at all
  const s = await open(solo(), opts());
  assert.equal(await s.page.isVisible("#fairSec"), false);
  assert.equal(await s.page.locator("#incBar").count(), 0, "no who-brings-in-what bar for one person");
  assert.equal(await s.page.textContent('[data-k="pp.' + (await s.page.getAttribute("[data-edit-person]", "data-edit-person")) + '.freq"]'), "Paid fortnightly");
  assert.deepEqual([...errors, ...s.errors], []); await ctx.close(); await s.ctx.close();
});

test("breakdowns: compact rows that open to the same charts; nothing cut off or sideways at 320", { skip }, async () => {
  const long = rich(s => { s.people[1].name = "Madeleine-Alexandrina Featherstonehaugh"; s.accounts[0].name = "Our very long joint everyday spending and bills account"; s.people[0].pay = 123456.78; return s; });
  const n = await open(rich(), opts());
  const h = await n.page.$$eval(".b-insights summary", e => e.map(x => Math.round(x.getBoundingClientRect().height)));
  assert.ok(h.every(x => x >= 56 && x <= 64), `row heights at 390: ${h}`);
  await n.ctx.close();
  // narrow phone, very long names and big amounts: descriptions may wrap, but are never cut off
  const { page, errors, ctx } = await open(long, opts(320, 640));
  await settle(page);
  const cut = await page.$$eval(".b-insights summary small", e => e.filter(x => x.scrollWidth > x.clientWidth + 1).length);
  assert.equal(cut, 0, "no '…' in the descriptions");
  for (const d of ["where", "flow", "charts"]) await page.click(`[data-ins="${d}"] summary`);
  await page.waitForSelector("#donuts svg");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.click("#fairSec .fs-more summary");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "long names stay inside");
  await page.screenshot({ path: join(SHOTS, "p10a-320-long.png"), fullPage: true });
  assert.deepEqual(errors, []); await ctx.close();
});

test("dark appearance: the redesigned cards read the theme's colours", { skip }, async () => {
  const { page, errors, ctx } = await open(rich(), { ...opts(), initScript: () => { try { localStorage.setItem("mb-theme", "dark"); } catch (_) {} } });
  await page.emulateMedia({ colorScheme: "dark" }); await settle(page);
  const c = await page.evaluate(() => { const bg = e => getComputedStyle(document.querySelector(e)).backgroundColor; return { status: bg("#allocStatus"), list: bg(".alloc-list") }; });
  assert.notEqual(c.status, "rgb(255, 255, 255)"); assert.notEqual(c.list, "rgb(255, 255, 255)");
  await shot(page, "dark");
  assert.deepEqual(errors, []); await ctx.close();
});

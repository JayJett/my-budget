/* UI phase 1: the redesigned Budget tab, its editing sheets, the header, and personal accent colours.
   The first test is the safety net: every figure the Budget tab shows must be exactly what it was
   before the redesign (tests/browser/budget-baseline.json was recorded from the old screen). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { RICH_V3, LIVE_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake, goTab, setField, editPerson, editAccount, closeSheet } from "./helpers.js";
import { budgetFigures } from "./budget-figures.mjs";

setup();
const require = createRequire(import.meta.url);
let devices = {}; try { ({ devices } = require("playwright")); } catch (_) {}
const RICH = toStored(migrate(RICH_V3));
const SINGLE = (() => { const s = migrate(RICH_V3); s.people = s.people.filter(p => p.id === "j"); s.accounts = s.accounts.filter(a => a.owner !== "m"); s.accounts.forEach(a => delete a.split.m); delete s.goals.personal.m; return toStored(s); })();
const BASE = JSON.parse(readFileSync(new URL("./budget-baseline.json", import.meta.url), "utf8"));
const saved = page => fake(page, () => window.__fake.budget);
const ops = page => fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops").flatMap(c => c.args.p_ops));

test("every Budget figure is exactly what the old screen showed (two people, the live budget, one person; week, fortnight, month)", { skip }, async () => {
  for (const [name, budget] of [["rich", RICH_V3], ["live", LIVE_V3], ["single", SINGLE]]) {
    const now = await budgetFigures(budget);
    for (const period of ["week", "fortnight", "month"]) {
      const before = BASE[name][period];
      // "27 paydays in 2026 (this year)" depends on today's date, not on the redesign
      for (const k of Object.keys(before).filter(k => !k.startsWith("p27."))) assert.equal(now[period][k], before[k], `${name} ${period} ${k}`);
    }
  }
});

test("allocation sheet: changing a share saves just that change, and status and other tabs follow", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH);
  await settle(page);
  await fake(page, () => { window.__fake.rpcCalls = []; });
  await editAccount(page, "js");
  await setField(page, '#sheet [data-f="split.m"]', "40");
  await settle(page);
  assert.deepEqual(await ops(page), [{ op: "set", path: ["accounts", "js", "split", "m"], value: 0.4 }]);
  assert.equal(await page.textContent('#sheet [data-k="acc.js.v.m"]'), "$760", "40% of $1,900");
  assert.equal(await page.textContent('#sheet [data-k="tot.p.m"]'), "95%", "Madi's total, live in the sheet");
  await closeSheet(page);
  assert.match(await page.textContent('[data-k="st.m.t"]'), /^5% left · \$95$/);
  assert.equal(await page.textContent('[data-k="st.summary"]'), "Some left to allocate");
  assert.equal(await page.isVisible('[data-fill="m"]'), true, "Fill is offered");
  assert.equal(await page.textContent('[data-k="acc.js.t"]'), "$1,720");
  // the Spending tab's pool comes from the same allocation
  await goTab(page, "spending");
  assert.match(await page.textContent("#app"), /\$1,720/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("allocation sheet: type and owner, add, delete, reorder", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH);
  await settle(page);
  // Type: Personal shows "Whose account"; the sheet redraws in place
  await editAccount(page, "ji");
  await page.click('#sheet label:has(input[value="Personal"])');
  await page.waitForSelector('#sheet [data-f="owner"]');
  await page.selectOption('#sheet [data-f="owner"]', "m");
  await settle(page);
  let b = await saved(page);
  assert.equal(b.accounts.ji.type, "Personal"); assert.equal(b.accounts.ji.owner, "m");
  assert.equal(await page.locator("#sheet [data-del]").count(), 0, "built-in accounts can't be deleted");
  await closeSheet(page);
  assert.match(await page.textContent('[data-edit-acc="ji"] .a-meta'), /Personal · Madi/);
  // Add: a new allocation opens with the name box ready
  await page.click("[data-acc-new]");
  await page.waitForSelector('#sheet .bsheet [data-f="name"]:focus');
  await page.keyboard.type("Car fund");
  const id = await page.getAttribute('#sheet [data-f="name"]', "data-i");
  await setField(page, '#sheet [data-f="split.j"]', "5");
  await closeSheet(page);
  await settle(page);
  b = await saved(page);
  assert.equal(b.accounts[id].name, "Car fund"); assert.equal(b.accounts[id].split.j, 0.05); assert.equal(b.accounts[id].type, "Personal");
  assert.equal(await page.textContent(`[data-edit-acc="${id}"] .a-name`), "Car fund");
  // Reorder: up/down buttons, then Done
  await page.click("[data-reorder]");
  await page.click(`[data-move="up"][data-i="${id}"]`);
  await settle(page);
  const order = Object.values(await saved(page)).length && Object.values((await saved(page)).accounts).sort((x, y) => x.pos - y.pos).map(a => a.id);
  assert.equal(order.indexOf(id), order.length - 2, "moved up one place");
  await page.click("[data-reorder]");
  assert.equal(await page.locator("[data-move]").count(), 0);
  // Delete, with a confirmation (it has a share of pay)
  await editAccount(page, id);
  await page.click("#sheet [data-del]");
  await page.click("#dlgYes");
  await page.waitForSelector("#sheet", { state: "hidden" });
  await settle(page);
  assert.equal((await saved(page)).accounts[id], undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("person sheet: pay, how often, payday and colour all save; someone else's change updates the open sheet", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH);
  await settle(page);
  await editPerson(page, "m");
  await setField(page, '#sheet [data-f="pay"]', "2000");
  await page.selectOption('#sheet [data-f="freq"]', "weekly");
  await page.fill('#sheet [data-f="payday"]', "2026-02-05");
  await page.click('#sheet [data-colour="rose"]');
  await settle(page);
  const m = (await saved(page)).people.m;
  assert.deepEqual([m.pay, m.freq, m.payday, m.colour], [2000, "weekly", "2026-02-05", "rose"]);
  assert.equal(await page.textContent('[data-k="inc.m.v"]'), "$4,000", "$2,000 a week is $4,000 a fortnight");
  await fake(page, () => window.__fake.remote([{ op: "set", path: ["people", "m", "name"], value: "Madison" }]));
  await page.waitForFunction(() => document.querySelector('#sheet [data-f="name"]').value === "Madison");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("one person: no partner fields, no fair split, plain wording", { skip }, async () => {
  const { page, errors, ctx } = await open(SINGLE);
  await settle(page);
  assert.equal(await page.textContent(".b-income .eyebrow"), "Income");
  assert.equal(await page.locator("[data-edit-person]").count(), 1);
  assert.equal(await page.isVisible("#fairSec"), false);
  assert.equal(await page.locator(".st-name, .a-parts, #ribbon").count(), 0, "no per-person labels when there's one person");
  assert.equal(await page.textContent('[data-k="st.summary"]'), "✓ All allocated");
  assert.equal(await page.locator("#brandNames small").count(), 0);
  await editAccount(page, "js");
  assert.equal(await page.locator('#sheet [data-f^="split."]').count(), 1);
  assert.equal(await page.locator('#sheet [data-f="owner"]').count(), 0);
  assert.match(await page.textContent("#sheet .bs-label"), /Share of your pay/);
  await page.screenshot({ path: join(SHOTS, "budget-single.png") });
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const width of [320, 375, 390, 430, 768, 1280]) {
  test(`${width}px wide: nothing sideways, sheets fit, long names don't break it`, { skip }, async () => {
    const long = JSON.parse(JSON.stringify(RICH)); long.people.m.name = "Madeleine-Alexandrina Featherstonehaugh"; long.accounts.js.name = "Our very long joint everyday spending and bills account";
    const { page, errors, ctx } = await open(long, { width });
    await settle(page);
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(await sideways(), false);
    for (const d of ["where", "flow", "charts"]) await page.click(`[data-ins="${d}"] summary`);
    assert.equal(await sideways(), false, "the money flow scrolls inside its own box");
    await editAccount(page, "js");
    const box = await page.locator("#sheet").boundingBox();
    assert.ok(box.x >= -1 && box.x + box.width <= width + 1, "sheet fits");
    assert.equal(await page.evaluate(() => { const s = document.querySelector("#sheet"); return s.scrollWidth > s.clientWidth + 1; }), false);
    await closeSheet(page);
    if (width === 390) await page.screenshot({ path: join(SHOTS, "budget-390-long-names.png"), fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("iPhone: tab bar at the bottom, nothing hidden under it, everything big enough to tap", { skip: skip || !devices["iPhone 13"] }, async () => {
  const { page, errors, ctx } = await open(RICH, { device: devices["iPhone 13"] });
  await settle(page);
  const vh = page.viewportSize().height, bar = await page.locator("#tabs").boundingBox();
  assert.ok(Math.abs(bar.y + bar.height - vh) < 2);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const last = await page.locator(".b-note").boundingBox();
  assert.ok(last.y + last.height <= bar.y + 1, "the last item can scroll clear of the tab bar");
  const small = await page.$$eval("#app button, #app summary, .top button:not([hidden])", els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 40 || r.width < 40); }).map(e => e.textContent.trim().slice(0, 20)));
  assert.deepEqual(small, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("accent colour: per person, instant, saved to your login once, kept after reload, gone after sign-out", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH);
  await settle(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.accent || "mint"), "mint");
  await page.click("#menuBtn"); await page.click('[data-act="appearance"]');
  await page.waitForSelector(".acc-picker");
  await page.click('[data-accent-pick="ocean"]');
  await page.click('[data-accent-pick="lavender"]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), "lavender", "changes straight away");
  assert.equal(await page.getAttribute('[data-accent-pick="lavender"]', "aria-checked"), "true");
  await page.waitForFunction(() => window.__fake.authCalls.some(c => c.name === "updateUser" && c.data && c.data.accent));
  const saves = await fake(page, () => window.__fake.authCalls.filter(c => c.name === "updateUser"));
  assert.deepEqual(saves.map(c => c.data), [{ accent: "lavender" }], "trying two colours sends one save");
  assert.equal((await ops(page)).length, 0, "nothing about the budget was saved");
  await page.click('[data-sheet="close"]');
  await page.screenshot({ path: join(SHOTS, "accent-lavender.png") });
  // the accent is on the button colour, but a person's chart colour isn't
  const colours = await page.evaluate(() => ({ accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), madi: getComputedStyle(document.querySelector(".member-row.pc-gold .av")).backgroundColor }));
  assert.notEqual(colours.accent, ""); assert.match(colours.madi, /rgb/);
  await page.reload(); await settle(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), "lavender", "kept after reload");
  assert.ok(await page.evaluate(() => localStorage.getItem("mb-accent-u-me")), "filed under this person's id");
  await page.click("#menuBtn"); await page.click('[data-act="signout"]');
  await page.waitForSelector("#fSignin");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), undefined, "the sign-in screen is back to the default");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("accent colour: your login's colour wins over this device's copy, and another person's copy is never used", { skip }, async () => {
  const storage = { "mb-accent-u-me": JSON.stringify({ accent: "amber", pending: false }), "mb-accent-u-other": JSON.stringify({ accent: "coral", pending: false }) };
  const { page, errors, ctx } = await open(null, { init: { budget: RICH, accent: "rose" }, storage });
  await settle(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), "rose");
  await ctx.close();
  const o2 = await open(null, { init: { budget: RICH }, storage: { "mb-accent-u-other": JSON.stringify({ accent: "coral" }) } });
  await settle(o2.page);
  assert.equal(await o2.page.evaluate(() => document.documentElement.dataset.accent || "mint"), "mint", "someone else's colour on this device isn't mine");
  assert.deepEqual([...errors, ...o2.errors], []);
  await o2.ctx.close();
});

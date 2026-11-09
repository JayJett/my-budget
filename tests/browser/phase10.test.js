/* Phase 10: the Payday Playbook on screen. Uses the fake Supabase (no real accounts or data). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { toStored, blankBudget, addPerson } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, fake } from "./helpers.js";

setup();
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
// the tests' dates are worked out from Monday 9 November 2026, so "now" is fixed there (midday, local time)
const phone = (w = 390, h = 844) => ({ device: { viewport: { width: w, height: h }, hasTouch: true, isMobile: true }, clock: new Date(2026, 10, 9, 12) });
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p10-${name}.png`) });
const budgetOf = page => fake(page, () => window.__fake.budget);
const pb = page => page.textContent("#sheet .pb");
const tab = (page, t) => page.evaluate(t => document.querySelector(`#tabs [data-tab="${t}"]`).click(), t);
/** Solo: $2,000 a fortnight, paid Wed 11 Nov 2026 (two days after the fake's today, 9 Nov). */
function solo({ dests = false, over = false } = {}) {
  const S = blankBudget({ name: "Jarden", mode: "solo" }), p = S.people[0]; p.id = "j"; S.accounts.forEach(a => { a.owner = a.owner ? "j" : a.owner; });
  Object.assign(p, { pay: 2000, freq: "fortnightly", payday: "2026-10-28" });
  const sh = { spending: over ? 0.6 : 0.5, emergency: 0.2, goals: 0.2, invest: 0.1 };
  S.accounts.forEach(a => { a.split = sh[a.role] != null ? { j: sh[a.role] } : {}; });
  S.nw.accounts = [{ id: "ev", name: "Everyday", type: "Operating", balance: 1500, pos: 1 }, { id: "sv", name: "Savings", type: "Savings", balance: 4000, pos: 2 }, { id: "dl", name: "Car loan", type: "Debt", balance: 3000, pos: 3 }];
  if (dests) {
    p.src = { nw: "ev" };
    S.accounts.find(a => a.role === "spending").dest = { nw: "ev" };
    S.accounts.find(a => a.role === "emergency").dest = { nw: "sv" };
    S.accounts.find(a => a.role === "goals").dest = { nw: "sv" };
  }
  return toStored(S);
}
const members = (meAs, others = []) => [{ user_id: "u-me", display_name: "Jarden", email: "j@example.com", role: "owner", joined_at: "2026-01-01", person_id: meAs }, ...others];
const one = (budget, me = null, extra = {}) => ({ households: [{ id: "hh-1", name: "Ours", role: "owner", budget, members: members(me), ...extra }] });

test("solo, nothing set up yet: the plan is still useful; 'this is me' unlocks the checklist", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { ...phone(), storage: ALL_DONE, init: one(solo()), hash: "", waitFor: "#app .home" });
  assert.match(await page.textContent(".ho-pay .ho-pb"), /Set up your payday plan/);
  await page.click(".ho-pay [data-pb-open]"); await page.waitForSelector("#sheet .pb");
  const t = await pb(page);
  assert.match(t, /In 2 days\s*Wednesday 11 Nov\s*\$2,000\s*Fortnightly pay/);
  assert.match(t, /Set aside\s*Spending[\s\S]*\$1,000[\s\S]*Emergency Fund[\s\S]*\$400[\s\S]*Goals[\s\S]*\$400[\s\S]*Investments[\s\S]*\$200/);
  assert.doesNotMatch(t, /Transfer to/, "no made-up transfers");
  assert.equal(await page.locator("#sheet .pb-check").count(), 0, "no ticking until you say who you are");
  assert.equal(await page.locator("#sheet .pb-setup").count(), 1, "Choose where your money goes");
  await shot(page, "new");
  await page.click('#sheet [data-pb-link]');
  await page.waitForSelector("#sheet .pb-check").catch(() => {});
  assert.equal(await page.locator("#sheet .pb-check").count(), 0, "set-aside items have nowhere to go: nothing to tick");
  assert.equal(await fake(page, () => window.__fake.hh("hh-1").members[0].person_id), "j");
  assert.deepEqual(errors, []); await ctx.close();
});

test("destinations: keep, grouped transfer with its parts, set aside; ticks are personal, kept, and change nothing else", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { ...phone(), storage: ALL_DONE, init: one(solo({ dests: true }), "j"), hash: "", waitFor: "#app .home" });
  const before = await budgetOf(page), saves = () => fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops").length), s0 = await saves();
  assert.match(await page.textContent(".ho-pay .ho-pb"), /See your payday plan/);
  await page.click(".ho-pay [data-pb-open]"); await page.waitForSelector("#sheet .pb-check");
  const t = await pb(page);
  assert.match(t, /\$2,000\s*Fortnightly pay · into Everyday/);
  assert.match(t, /Keep in\s*Everyday[\s\S]*\$1,000/);
  assert.match(t, /Transfer to\s*Savings\s*Emergency Fund \+ Goals[\s\S]*\$800/);
  assert.match(t, /Set aside\s*Investments\s*Not linked to an account yet[\s\S]*\$200/);
  assert.equal(await page.locator("#sheet .pb-check").count(), 2, "keep and transfer can be ticked; set aside can't");
  assert.match(await pb(page), /0 of 2 marked done/);
  await page.click('#sheet [data-pb-tick="move:nw:sv"]');
  await page.waitForFunction(() => /1 of 2 marked done/.test(document.querySelector("#sheet .pb").textContent));
  assert.equal(await page.getAttribute('#sheet [data-pb-tick="move:nw:sv"]', "aria-checked"), "true");
  await shot(page, "ticked");
  // the tick shows at once; wait for it to be saved before looking at what was saved
  await page.waitForFunction(() => Object.keys(window.__fake.checks).length && !document.querySelector("#sheet [data-pb-tick][aria-busy]"));
  const chk = await fake(page, () => window.__fake.checks);
  const k = Object.keys(chk)[0];
  assert.match(k, /^hh-1\|u-me\|j\|2026-11-11$/); assert.deepEqual(chk[k].done, { "move:nw:sv": true });
  assert.equal(chk[k].plan.groups.length, 3, "the instructions were kept with the first tick");
  // close and reopen: still ticked; untick works
  await page.click('#sheet [data-sheet="close"]');
  await page.click(".ho-pay [data-pb-open]"); await page.waitForSelector('#sheet [data-pb-tick="move:nw:sv"][aria-checked="true"]');
  await page.click('#sheet [data-pb-tick="move:nw:sv"]');
  await page.waitForFunction(() => /0 of 2 marked done/.test(document.querySelector("#sheet .pb").textContent));
  await page.click('#sheet [data-pb-tick="keep:nw:ev"]'); await page.waitForFunction(() => /1 of 2/.test(document.querySelector("#sheet .pb").textContent)); await page.waitForFunction(() => !document.querySelector("#sheet [data-pb-tick][aria-busy]"));
  // the next payday is a list of its own
  await page.click('#sheet [data-pb-k="1"]'); await page.waitForFunction(() => /Wednesday 25 Nov/.test(document.querySelector("#sheet .pb").textContent));
  await page.waitForFunction(() => /0 of 2 marked done/.test(document.querySelector("#sheet .pb").textContent));
  // nothing financial moved
  assert.equal(await saves(), s0, "ticking never saves the budget");
  assert.deepEqual(await budgetOf(page), before, "balances, goals, plan: all untouched");
  assert.deepEqual(errors, []); await ctx.close();
});

test("the budget changes after ticking: the kept list stays until you choose the new plan", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { ...phone(), storage: ALL_DONE, init: one(solo({ dests: true }), "j"), hash: "budget", waitFor: "#app .b-income" });
  await page.click("#app [data-pb-open]"); await page.waitForSelector("#sheet .pb-check");
  await page.click('#sheet [data-pb-tick="keep:nw:ev"]'); await page.waitForFunction(() => /1 of 2/.test(document.querySelector("#sheet .pb").textContent)); await page.waitForFunction(() => !document.querySelector("#sheet [data-pb-tick][aria-busy]"));
  // someone moves 5% from Spending to Investments
  await page.evaluate(async () => { const { app, changed } = await import("./js/ui/ctx.js"); const a = app.state.accounts; a.find(x => x.role === "spending").split.j = 0.45; a.find(x => x.role === "invest").split.j = 0.15; changed({ full: true }); });
  await page.waitForSelector("#sheet .pb-changed");
  assert.match(await pb(page), /Keep in\s*Everyday[\s\S]*\$1,000/, "the started list isn't rewritten");
  await page.click("#sheet [data-pb-replan]");
  await page.waitForFunction(() => !document.querySelector("#sheet .pb-changed"));
  assert.match(await pb(page), /Keep in\s*Everyday[\s\S]*\$900/);
  assert.equal(await page.getAttribute('#sheet [data-pb-tick="keep:nw:ev"]', "aria-checked"), "true", "a tick for an instruction still there stays");
  assert.deepEqual(errors, []); await ctx.close();
});

test("a failed tick says so and doesn't pretend; over 100%: no instructions, a way to fix it", { skip }, async () => {
  const a = await open(null, { ...phone(), storage: ALL_DONE, init: one(solo({ dests: true }), "j"), hash: "", waitFor: "#app .home" });
  await a.page.click(".ho-pay [data-pb-open]"); await a.page.waitForSelector("#sheet .pb-check");
  await fake(a.page, () => { window.__fake.failNext = 1; });
  await a.page.click('#sheet [data-pb-tick="keep:nw:ev"]');
  await a.page.waitForSelector("#toast.on"); assert.match(await a.page.textContent("#toast"), /Couldn’t save that tick/);
  await a.page.waitForFunction(() => document.querySelector('#sheet [data-pb-tick="keep:nw:ev"]').getAttribute("aria-checked") === "false");
  await a.ctx.close();
  const { page, errors, ctx } = await open(null, { ...phone(), storage: ALL_DONE, init: one(solo({ over: true }), "j"), hash: "", waitFor: "#app .home" });
  await page.click(".ho-pay [data-pb-open]"); await page.waitForSelector("#sheet .pb-warn");
  assert.match(await pb(page), /This plan is 10% over the pay/);
  assert.equal(await page.locator("#sheet .pb-row").count(), 0);
  assert.deepEqual(errors, []); await ctx.close();
});

test("couples: each their own payday and pay; only you tick yours; nobody can be someone else", { skip }, async () => {
  const S = blankBudget({ name: "Jarden", mode: "shared" }); addPerson(S, { name: "Madi" });
  const [j, m] = S.people; j.id = "j"; m.id = "m";
  Object.assign(j, { pay: 2900, freq: "fortnightly", payday: "2026-11-18" }); Object.assign(m, { pay: 600, freq: "weekly", payday: "2026-11-05" });
  S.accounts = S.accounts.filter(a => a.role !== "personalGoals");
  const set = (role, a, b) => { S.accounts.find(x => x.role === role).split = { j: a, m: b }; };
  set("spending", 0.5, 0.5); set("emergency", 0.2, 0.2); set("goals", 0.2, 0.2); set("invest", 0.1, 0.1);
  S.accounts.find(a => a.role === "invest").dest = { label: "Joint shares" }; S.accounts.find(a => a.role === "invest").destBy = { m: { label: "Madi's shares" } };
  S.goals.personal = { j: [], m: [] };
  const init = { households: [{ id: "hh-1", name: "Ours", role: "owner", budget: toStored(S), members: members("j", [{ user_id: "u-madi", display_name: "Madi", email: "m@example.com", role: "editor", joined_at: "2026-01-02", person_id: "m" }]) }] };
  const { page, errors, ctx } = await open(null, { ...phone(), storage: ALL_DONE, init, hash: "", waitFor: "#app .home" });
  await page.click(".ho-pay [data-pb-open]"); await page.waitForSelector("#sheet .pb");
  assert.match(await page.textContent("#sheet .sheet-head h3"), /Jarden’s payday/, "opens on your own");
  assert.match(await pb(page), /Wednesday 18 Nov\s*\$2,900\s*Fortnightly pay/);
  assert.match(await pb(page), /Transfer to\s*Joint shares[\s\S]*\$290/);
  await page.click('#sheet [data-pb-person="m"]');
  await page.waitForFunction(() => /Madi’s payday/.test(document.querySelector("#sheet .sheet-head h3").textContent));
  const t = await pb(page);
  assert.match(t, /Thursday 12 Nov\s*\$600\s*Weekly pay/, "Madi's own weekly payday and pay");
  assert.match(t, /Transfer to\s*Madi's shares[\s\S]*\$60/, "her own place for her part");
  assert.equal(await page.locator("#sheet .pb-check").count(), 0, "you can't tick Madi's list");
  assert.equal(await page.locator("#sheet [data-pb-link]").count(), 0, "and can't say you're Madi");
  assert.match(t, /Madi can tick these off on their own phone/);
  await shot(page, "couple");
  // the database refuses it too
  const r = await page.evaluate(async () => { const { app } = await import("./js/ui/ctx.js"); return (await app.sb.rpc("payday_check_mark", { p_household: "hh-1", p_person: "m", p_payday: "2026-11-12", p_plan: {}, p_key: "x", p_on: true })).error.message; });
  assert.match(r, /for someone else/);
  assert.deepEqual(errors, []); await ctx.close();
});

test("destinations are chosen in the allocation and pay sheets (accounts, never debts; or a name); before the database part, the plan still shows", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { ...phone(), storage: ALL_DONE, init: one(solo(), null), hash: "budget", waitFor: "#app .b-income" });
  await page.click('[data-edit-acc="ef"]'); await page.waitForSelector('#sheet select[data-pd="acc"]');
  const opts = await page.$$eval('#sheet select[data-pd="acc"] option', e => e.map(x => x.textContent));
  assert.deepEqual(opts, ["Not chosen yet", "Everyday · Everyday", "Savings · Savings", "Somewhere else (type a name)"]);
  await page.selectOption('#sheet select[data-pd="acc"]', "nw:sv");
  await page.waitForFunction(() => window.__fake.budget.accounts.ef.dest && window.__fake.budget.accounts.ef.dest.nw === "sv", null, { timeout: 5000 });
  await page.click('#sheet [data-sheet="close"]');
  await page.click('[data-edit-acc="ji"]'); await page.waitForSelector('#sheet select[data-pd="acc"]');
  await page.selectOption('#sheet select[data-pd="acc"]', "label");
  await page.waitForSelector('#sheet input[data-pd-label="acc"]');
  await page.fill('#sheet input[data-pd-label="acc"]', "Sharesies");
  await page.waitForFunction(() => (window.__fake.budget.accounts.ji.dest || {}).label === "Sharesies", null, { timeout: 5000 });
  assert.equal(Object.keys((await budgetOf(page)).nw.accounts).length, 3, "a typed name isn’t an account");
  await page.click('#sheet [data-sheet="close"]');
  await page.click('[data-edit-person="j"]'); await page.waitForSelector('#sheet select[data-pd="src"]');
  await page.selectOption('#sheet select[data-pd="src"]', "nw:ev");
  await page.waitForFunction(() => (window.__fake.budget.people.j.src || {}).nw === "ev", null, { timeout: 5000 });
  await page.click('#sheet [data-sheet="close"]');
  await page.click("#app [data-pb-open]"); await page.waitForSelector("#sheet .pb");
  const t = await pb(page);
  assert.match(t, /Transfer to\s*Savings[\s\S]*\$400/); assert.match(t, /Transfer to\s*Sharesies[\s\S]*\$200/); assert.match(t, /into Everyday/);
  assert.deepEqual(errors, []); await ctx.close();
  // the database part isn't set up yet: no ticking, no "this is me"; the plan is the same
  const o = await open(null, { ...phone(), storage: ALL_DONE, init: { ...one(solo({ dests: true }), "j"), noPersonLinks: true }, hash: "", waitFor: "#app .home" });
  await o.page.click(".ho-pay [data-pb-open]"); await o.page.waitForSelector("#sheet .pb");
  assert.equal(await o.page.locator("#sheet .pb-check, #sheet [data-pb-link]").count(), 0);
  assert.match(await o.page.textContent("#sheet .pb"), /Keep in\s*Everyday/);
  await o.ctx.close();
});

test("payday reminder: offered only once you've said who you are; a reminder link opens the plan", { skip }, async () => {
  const a = await open(null, { ...phone(), storage: ALL_DONE, init: one(solo(), null), hash: "", waitFor: "#app .home" });
  await a.page.evaluate(async () => (await import("./js/ui/reminders.js")).openReminderSettings());
  await a.page.waitForSelector("#sheet .rem-switches");
  assert.equal(await a.page.locator('#sheet [data-pref="payday"]').count(), 0);
  await a.ctx.close();
  const { page, errors, ctx } = await open(null, { ...phone(), storage: ALL_DONE, init: one(solo(), "j"), hash: "", waitFor: "#app .home" });
  await page.evaluate(async () => (await import("./js/ui/reminders.js")).openReminderSettings());
  await page.waitForSelector('#sheet [data-pref="payday"]');
  assert.equal(await page.isChecked('#sheet [data-pref="payday"]'), false, "off until you turn it on");
  await page.click('#sheet [data-pref="payday"]', { force: true });
  await page.waitForFunction(() => /Reminder settings saved/.test(document.querySelector("#toast").textContent));
  await page.evaluate(() => { document.querySelector("#sheet").close(); location.hash = "payday"; });
  await page.waitForSelector("#sheet .pb");
  assert.equal(await page.evaluate(() => location.hash), "#home");
  assert.deepEqual(errors, []); await ctx.close();
});

test("320–430px: the playbook fits; nothing sideways", { skip }, async () => {
  for (const w of [320, 375, 390, 430]) {
    const { page, errors, ctx } = await open(null, { ...phone(w, 740), storage: ALL_DONE, init: one(solo({ dests: true }), "j"), hash: "", waitFor: "#app .home" });
    await page.click(".ho-pay [data-pb-open]"); await page.waitForSelector("#sheet .pb-check");
    const r = await page.evaluate(() => { const d = document.querySelector("#sheet"); return { side: d.scrollWidth > d.clientWidth + 1, amts: [...d.querySelectorAll(".pb-amt")].every(e => e.getBoundingClientRect().right <= d.getBoundingClientRect().right) }; });
    assert.deepEqual(r, { side: false, amts: true }, `${w}`);
    if (w === 320) await shot(page, "320");
    assert.deepEqual(errors, [], `${w}`); await ctx.close();
  }
});

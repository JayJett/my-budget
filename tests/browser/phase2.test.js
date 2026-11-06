/* Phase 2 in a real browser: the setup guide, the tour, roles, switching households,
   account and household settings, and the "Welcome back" sign-in. Uses the fake Supabase. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { setup, skip, SHOTS, open, settle, fake, setField } from "./helpers.js";

setup();

const other = (id, name, role) => ({ user_id: id, display_name: name, email: name.toLowerCase() + "@example.com", role, joined_at: "2026-02-01" });
const me = role => ({ user_id: "u-me", display_name: "Jarden", email: "jarden@example.com", role, joined_at: "2026-01-01" });
const next = page => page.click('[data-obact="next"]');

test("setup guide: answers become a ready-made budget, then the tour", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob" });
  await page.screenshot({ path: join(SHOTS, "setup-1-purpose.png"), fullPage: true });
  assert.equal(await page.isDisabled('[data-obact="next"]'), true, "must pick a purpose first");
  await page.click('[data-purpose="household"]');
  await next(page);
  // Who's in it: "you" is pre-filled, a second row is ready
  assert.equal(await page.inputValue('[data-ob="people.0.name"]'), "Jarden");
  await page.fill('[data-ob="people.1.name"]', "Madi");
  await next(page);
  await page.fill('[data-ob="people.0.pay"]', "2000");
  await page.fill('[data-ob="people.1.pay"]', "4000");
  await page.selectOption('[data-ob="people.1.freq"]', "monthly");
  assert.match(await page.textContent('[data-obk="paytotal"]'), /\$3,846 per fortnight/); // $100,000 a year ÷ 26
  await page.screenshot({ path: join(SHOTS, "setup-3-pay.png"), fullPage: true });
  await next(page);
  await page.fill('[data-ob="have.savings"]', "5000");
  await page.fill('[data-ob="have.emergency"]', "2000");
  await page.fill('[data-ob="have.kiwisaver"]', "20000");
  await page.click('[data-obact="adddebt"]');
  await page.fill('[data-ob="have.debts.0.name"]', "Car loan");
  await page.fill('[data-ob="have.debts.0.balance"]', "8000");
  await next(page);
  // Suggested split: adds to 100%, can be tweaked
  assert.equal(await page.textContent('[data-obk="total"]'), "100%");
  await page.screenshot({ path: join(SHOTS, "setup-5-split.png"), fullPage: true });
  await page.fill('[data-ob="split.0"]', "45");
  assert.equal(await page.textContent('[data-obk="total"]'), "95%");
  assert.equal(await page.isDisabled('[data-obact="next"]'), true, "can't continue unless it adds to 100%");
  await page.fill('[data-ob="split.0"]', "50");
  await next(page);
  await page.waitForSelector("text=You’re all set, Jarden!");
  await settle(page);
  const b = await fake(page, () => window.__fake.budget);
  assert.equal(b.version, 4);
  const people = Object.values(b.people);
  assert.deepEqual(people.map(p => [p.name, p.pay, p.freq]), [["Jarden", 2000, "fortnightly"], ["Madi", 4000, "monthly"]]);
  for (const p of people) {
    const total = Object.values(b.accounts).reduce((s, a) => s + (a.split[p.id] || 0), 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${p.name}'s split adds to 100%`);
  }
  const nw = Object.values(b.nw.accounts).map(a => [a.name, a.type, a.balance]);
  assert.deepEqual(nw, [["Savings", "Savings", 5000], ["Emergency Fund", "Savings", 2000], ["KiwiSaver", "Super", 20000], ["Car loan", "Debt", 8000]]);
  assert.equal(b.goals.ef.target, 12500);
  // Tour
  await page.click('[data-obact="tour"]');
  await page.waitForSelector(".tour:not([hidden])");
  assert.equal(await page.textContent(".tour-card h3"), "Pick your period");
  await page.screenshot({ path: join(SHOTS, "tour-1.png") });
  for (let i = 0; i < 5; i++) await page.click('[data-tour="next"]');
  assert.equal(await page.textContent(".tour-card h3"), "Settings live here");
  await page.click('[data-tour="next"]'); // Done
  assert.equal(await page.isVisible(".tour"), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("mb-tour-done-u-me")), "1");
  assert.ok(await page.isVisible("#tabs"), "the normal app is back");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("setup guide: saving for something creates the goal", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob" });
  await page.click('[data-purpose="saving"]'); await next(page);
  await next(page);
  await page.fill('[data-ob="people.0.pay"]', "1500"); await next(page);
  await page.fill('[data-ob="goal.name"]', "Trip to Japan");
  await page.fill('[data-ob="goal.target"]', "9000");
  await next(page); await next(page);
  await page.waitForSelector("text=You’re all set");
  await settle(page);
  const b = await fake(page, () => window.__fake.budget);
  const g = Object.values(b.goals.joint);
  assert.equal(g.length, 1); assert.equal(g[0].name, "Trip to Japan"); assert.equal(g[0].target, 9000);
  await page.click('[data-obact="finish"]');
  await page.click('[data-tab="goals"]');
  await page.waitForSelector('[data-tab="goals"][aria-selected="true"]');
  assert.ok(await page.locator('input[value="Trip to Japan"]').count());
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("viewers can look but not change anything", { skip }, async () => {
  const init = { households: [{ id: "hh-1", name: "Mum’s budget", role: "viewer", budget: RICH_V3, members: [other("u-mum", "Mum", "owner"), me("viewer")] }] };
  const { page, errors, ctx } = await open(null, { init });
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "View only");
  assert.ok(await page.isVisible("text=You’re viewing Mum’s budget"));
  assert.equal(await page.isDisabled('[data-l="pp"][data-i="j"][data-f="pay"]'), true);
  assert.equal(await page.isVisible('[data-addperson]'), true);
  assert.equal(await page.isDisabled('[data-addperson]'), true);
  await page.screenshot({ path: join(SHOTS, "viewer.png") });
  const calls = await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops"));
  assert.equal(calls.length, 0, "a viewer never tries to save, not even the version upgrade");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("switch between households from the menu", { skip }, async () => {
  const init = { households: [
    { id: "hh-1", name: "Our place", role: "owner", budget: RICH_V3 },
    { id: "hh-2", name: "Mum’s budget", role: "editor", budget: { ...RICH_V3, note: "Mum’s numbers", income: { j: 900, m: null } }, members: [other("u-mum", "Mum", "owner"), me("editor")] },
  ] };
  const { page, errors, ctx } = await open(null, { init });
  await settle(page);
  await page.click("#menuBtn");
  assert.ok(await page.isVisible("text=Households"));
  await page.screenshot({ path: join(SHOTS, "menu-switcher.png") });
  await page.click('[data-switch="hh-2"]');
  await page.waitForFunction(() => document.querySelector('[data-f="note"]')?.value === "Mum’s numbers");
  assert.match(await page.textContent("#brandNames small"), /Mum’s budget/);
  // Remembered on this device
  assert.equal(await page.evaluate(() => localStorage.getItem("mb-household-u-me")), "hh-2");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("household settings: rename, roles, remove, invite with a role", { skip }, async () => {
  const init = { households: [{ id: "hh-1", name: "Our place", role: "owner", budget: RICH_V3,
    members: [me("owner"), other("u-madi", "Madi", "editor"), other("u-sam", "Sam", "viewer")] }] };
  const { page, errors, ctx } = await open(null, { init });
  await settle(page);
  await page.click("#menuBtn"); await page.click('[data-act="household"]');
  await page.waitForSelector("#sheet[open] .hh-list");
  await page.screenshot({ path: join(SHOTS, "household-settings.png"), fullPage: true });
  await page.fill('#setHHName input[name="name"]', "The Jett house");
  await page.click('#setHHName button');
  await page.waitForSelector("#mHH.ok");
  assert.equal(await fake(page, () => window.__fake.hh("hh-1").name), "The Jett house");
  assert.match(await page.textContent("#brandNames small"), /The Jett house/);
  await page.selectOption('[data-role-for="u-madi"]', "owner");
  await page.waitForSelector("text=Role updated");
  assert.equal(await fake(page, () => window.__fake.hh("hh-1").members.find(m => m.user_id === "u-madi").role), "owner");
  await page.click('[data-remove="u-sam"]'); await page.click("#dlgYes");
  await page.waitForFunction(() => !document.querySelector('[data-remove="u-sam"]'));
  assert.equal(await fake(page, () => window.__fake.hh("hh-1").members.length), 2);
  await page.fill('#setInvite input[name="email"]', "nana@example.com");
  await page.selectOption('#setInvite select[name="role"]', "viewer");
  await page.click("#setInvite button");
  await page.waitForSelector("text=nana@example.com");
  const inv = await fake(page, () => window.__fake.rpcCalls.find(c => c.name === "invite_member"));
  assert.deepEqual(inv.args, { p_household: "hh-1", p_email: "nana@example.com", p_role: "viewer" });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("editors don't see owner-only controls", { skip }, async () => {
  const init = { households: [{ id: "hh-1", name: "Our place", role: "editor", budget: RICH_V3, members: [other("u-madi", "Madi", "owner"), me("editor")] }] };
  const { page, errors, ctx } = await open(null, { init });
  await settle(page);
  await page.click("#menuBtn"); await page.click('[data-act="household"]');
  await page.waitForSelector("#sheet[open] .hh-list");
  assert.equal(await page.locator("#setHHName").count(), 0, "no rename");
  assert.equal(await page.locator("[data-role-for]").count(), 0, "no role changes");
  assert.equal(await page.locator("#setInvite").count(), 1, "editors can still invite");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("leaving a household moves you to your other one; creating one starts the setup guide", { skip }, async () => {
  const init = { households: [
    { id: "hh-1", name: "Our place", role: "owner", budget: RICH_V3, members: [me("owner"), other("u-madi", "Madi", "editor")] },
    { id: "hh-2", name: "Mum’s budget", role: "editor", budget: RICH_V3, members: [other("u-mum", "Mum", "owner"), me("editor")] },
  ] };
  const { page, errors, ctx } = await open(null, { init });
  await settle(page);
  await page.click("#menuBtn"); await page.click('[data-act="household"]');
  await page.waitForSelector("#sheet[open]");
  assert.match(await page.textContent("#sheet"), /Madi will become the owner/);
  await page.click('[data-sheet="leave"]'); await page.click("#dlgYes");
  await page.waitForFunction(() => /Mum’s budget/.test(document.querySelector("#brandNames small").textContent));
  assert.equal(await fake(page, () => window.__fake.hh("hh-1").members[0].role), "owner", "Madi now owns it");
  await page.click("#menuBtn"); await page.click('[data-act="household"]');
  await page.fill('#setNewHH input[name="name"]', "Holiday house");
  await page.click("#setNewHH button");
  await page.waitForSelector(".ob");
  assert.match(await page.textContent("#brandNames small"), /Holiday house/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("account settings: name, password, download my data, delete account", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  await page.click("#menuBtn"); await page.click('[data-act="account"]');
  await page.waitForSelector("#sheet[open] #setName");
  await page.screenshot({ path: join(SHOTS, "account-settings.png"), fullPage: true });
  await page.fill('#setName input', "Jay");
  await page.click("#setName button");
  await page.waitForSelector("#mName.ok");
  assert.ok(await fake(page, () => window.__fake.authCalls.some(c => c.name === "updateUser" && c.data && c.data.name === "Jay")));
  assert.ok(await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "sync_my_profile").length >= 2), "names synced to households");
  await page.fill('#setPass input', "a-new-password");
  await page.click("#setPass button");
  await page.waitForSelector("#mPass.ok");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-sheet="download"]')]);
  const data = JSON.parse(await (await import("node:fs/promises")).readFile(await dl.path(), "utf8"));
  assert.equal(data.account.email, "jarden@example.com");
  assert.equal(data.households.length, 1);
  assert.equal(data.households[0].budget.state.note, "Test budget");
  // Delete: needs the word DELETE
  await page.waitForFunction(() => /stays with|will be deleted/.test(document.querySelector("#delPlan").textContent));
  assert.match(await page.textContent("#delPlan"), /Test household.*will be deleted/);
  await page.fill('#setDelete input', "delete");
  await page.click("#setDelete button");
  await page.waitForSelector("#mDel.err");
  assert.equal(await fake(page, () => window.__fake.deleted), false);
  await page.fill('#setDelete input', "DELETE");
  await page.click("#setDelete button");
  await page.waitForSelector("#auth:not([hidden]) #fSignin");
  assert.equal(await fake(page, () => window.__fake.deleted), true);
  assert.equal(await page.evaluate(() => localStorage.getItem("mb-welcome")), null, "the device forgets you");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("'Welcome back, Jarden' on a device you've used before", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: { signedOut: true }, waitFor: "#fSignin",
    storage: { "mb-welcome": JSON.stringify({ name: "Jarden", email: "jarden@example.com" }) } });
  assert.equal(await page.textContent("#auth h2"), "Welcome back, Jarden");
  assert.ok(await page.isVisible("text=jarden@example.com"));
  assert.equal(await page.evaluate(() => document.activeElement.name), "password", "straight to the password box");
  await page.screenshot({ path: join(SHOTS, "welcome-back.png") });
  await page.click('[data-auth="notme"]');
  assert.equal(await page.textContent("#auth h2"), "Welcome");
  assert.ok(await page.isVisible('#fSignin input[name="email"]'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("signing in remembers you for next time", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: { signedOut: true, budget: RICH_V3 }, waitFor: "#fSignin" });
  await page.fill('#fSignin input[name="email"]', "jarden@example.com");
  await page.fill('#fSignin input[name="password"]', "secret123");
  await page.click("#fSignin button");
  await page.waitForSelector("#app .viewas");
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("mb-welcome"))), { name: "Jarden", email: "jarden@example.com" });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("setup guide on a phone", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { width: 390, waitFor: ".ob" });
  await page.screenshot({ path: join(SHOTS, "setup-phone.png"), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, "no sideways scrolling");
  assert.deepEqual(errors, []);
  await ctx.close();
});

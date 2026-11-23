import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, skip, open, closeSheet } from "./helpers.js";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";

setup();

const member = (id, name, role) => ({
  user_id: id, display_name: name, email: id + "@example.test", role, joined_at: "2026-01-01",
});
const household = (id, name, role = "owner") => ({
  id, name, budget: toStored(migrate(RICH_V3)),
  members: [member("u-me", "Current user", role), member("u-other", name + " member", "editor")],
  invites: [{ id: "invite-" + id, email: id + "@example.test", role: "viewer" }],
});
const fixture = () => ({ households: [household("alpha", "Alpha"), household("beta", "Beta")] });
const sheet = "#sheet .ind-settings";
const openSettings = async page => {
  await page.click("#hhBtn");
  await page.click('[data-hp="settings"]');
};
const ready = page => page.waitForSelector(sheet + " .hh-list");
async function switchTo(page, id, name) {
  await page.click("#hhBtn");
  await page.click(`[data-switch="${id}"]`);
  await page.waitForFunction(n => document.querySelector("#hhBtn")?.textContent.includes(n), name);
  await page.waitForSelector("#app .viewas");
}
async function hold(page, key, call, before = false) {
  await page.evaluate(([key, call, before]) => {
    window.__fake.holdResponse(key, q => Object.entries(call).every(([k, v]) => q[k] === v), before);
  }, [key, call, before]);
}
const started = (page, key) => page.waitForFunction(key => window.__fake.responseGates.get(key)?.started, key);
async function release(page, key) {
  // Resume the controlled reply, then wait for its microtasks before checking the UI.
  await page.evaluate(async key => {
    window.__fake.releaseResponse(key);
    await new Promise(requestAnimationFrame);
  }, key);
}
const roster = page => page.locator(sheet + " .hh-list").first().innerText();
const requests = page => page.evaluate(() => window.__fake.requests.filter(q => q.bearer));

test("a late roster read cannot replace another household after repeated switches", { skip }, async () => {
  const { page, ctx, errors } = await open(null, { init: fixture(), width: 320 });
  try {
    await hold(page, "roster", { table: "household_members", cols: "user_id, display_name, email, role, joined_at" });
    await openSettings(page);
    await started(page, "roster");
    await closeSheet(page);
    await switchTo(page, "beta", "Beta");
    await switchTo(page, "alpha", "Alpha");
    await switchTo(page, "beta", "Beta");
    await openSettings(page);
    await ready(page);
    await release(page, "roster");
    assert.match(await roster(page), /Beta member/);
    assert.doesNotMatch(await roster(page), /Alpha member/);
    const queries = (await requests(page)).filter(q => q.table === "household_members" && q.cols.includes("display_name, email"));
    assert.deepEqual(queries.map(q => q.eq.household_id), ["alpha", "beta"]);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("closing and reopening Settings also retires a late reply in the same household", { skip }, async () => {
  const { page, ctx, errors } = await open(null, { init: fixture(), width: 375 });
  try {
    await hold(page, "roster", { table: "household_members", cols: "user_id, display_name, email, role, joined_at" });
    await openSettings(page);
    await started(page, "roster");
    await closeSheet(page);
    await page.evaluate(() => { window.__fake.hh("alpha").members[1].display_name = "Updated member"; });
    await openSettings(page);
    await ready(page);
    await release(page, "roster");
    assert.match(await roster(page), /Updated member/);
    assert.doesNotMatch(await roster(page), /Alpha member/);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

const submit = (page, form) => page.click(`#${form} button[type="submit"]`);
const actionCases = [
  { name: "rename", call: { table: "households", cols: "name" }, target: q => q.eq.id,
    action: async p => { await p.fill('#setHHName input', "Alpha renamed"); await submit(p, "setHHName"); },
    check: h => h.name === "Alpha renamed", notice: /Renamed/ },
  { name: "invite", call: { rpc: "invite_member" }, target: q => q.args.p_household,
    action: async p => { await p.fill('#setInvite input', "new@example.test"); await submit(p, "setInvite"); },
    check: h => h.invites.some(i => i.email === "new@example.test"), notice: /Invite saved/ },
  { name: "cancel invitation", call: { table: "household_invites", del: true }, target: q => q.eq.household_id,
    action: p => p.click('[data-uninvite="invite-alpha"]'), check: h => !h.invites.length },
  { name: "change role", call: { rpc: "set_member_role" }, target: q => q.args.p_household,
    action: p => p.selectOption('[data-role-for="u-other"]', "viewer"), check: h => h.members[1].role === "viewer", notice: /Role updated/ },
  { name: "remove member", call: { rpc: "remove_member" }, target: q => q.args.p_household,
    action: async p => { await p.click('[data-remove="u-other"]'); await p.click("#dlgYes"); },
    check: h => h.members.length === 1, notice: /member removed/ },
  { name: "leave", call: { rpc: "leave_household" }, target: q => q.args.p_household,
    action: async p => { await p.click('[data-sheet="leave"]'); await p.click("#dlgYes"); },
    check: h => !h || h.members.every(m => m.user_id !== "u-me"), notice: /left the household/ },
];
for (const c of actionCases) {
  test(`a late ${c.name} response stays with its original household`, { skip }, async () => {
    const { page, ctx, errors } = await open(null, { init: fixture(), width: 390 });
    try {
      await openSettings(page);
      await ready(page);
      await hold(page, "write", c.call);
      await c.action(page);
      await started(page, "write");
      await closeSheet(page);
      await switchTo(page, "beta", "Beta");
      await openSettings(page);
      await ready(page);
      await release(page, "write");
      const matching = (await requests(page)).filter(q => Object.entries(c.call).every(([k,v]) => q[k] === v));
      assert.deepEqual(matching.map(c.target), ["alpha"]);
      assert.equal(c.check(await page.evaluate(() => window.__fake.hh("alpha"))), true);
      assert.equal(c.check(await page.evaluate(() => window.__fake.hh("beta"))), false);
      assert.match(await roster(page), /Beta member/);
      assert.equal(await page.locator("#setHHName input").inputValue(), "Beta");
      if (c.notice) assert.doesNotMatch(await page.locator("body").innerText(), c.notice);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}

test("a confirmation cannot dispatch after its Settings sheet is replaced", { skip }, async () => {
  const { page, ctx } = await open(null, { init: fixture(), width: 430 });
  try {
    await openSettings(page);
    await ready(page);
    await page.click('[data-remove="u-other"]');
    await page.waitForSelector("#dlg[open]");
    await page.evaluate(async () => {
      const { openAppearance } = await import("/js/ui/settings.js");
      openAppearance();
    });
    await page.click("#dlgYes");
    assert.match(await page.locator("#sheet h3").innerText(), /Appearance/);
    assert.equal((await requests(page)).some(q => q.rpc === "remove_member"), false);
  } finally { await ctx.close(); }
});

for (const nextUser of [null, "u-other", "u-me"]) {
  test(`session change to ${nextUser || "signed out"} retires an in-progress Settings request`, { skip }, async () => {
    const { page, ctx, errors } = await open(null, { init: fixture(), width: 390 });
    try {
      await openSettings(page);
      await ready(page);
      await hold(page, "session", { auth: "getSession" });
      await page.fill("#setHHName input", "Do not rename");
      await submit(page, "setHHName");
      await started(page, "session");
      await page.evaluate(id => window.__fake.authAs(id, "new-session"), nextUser);
      if (nextUser) {
        await page.waitForSelector("#app .viewas");
        await openSettings(page);
        await ready(page);
      } else await page.waitForSelector("#fSignin");
      await release(page, "session");
      assert.equal((await requests(page)).some(q => q.table === "households" && q.update), false);
      assert.equal(await page.evaluate(() => window.__fake.hh("alpha").name), "Alpha");
      if (nextUser) {
        assert.match(await roster(page), /Alpha member/);
        assert.equal(await page.locator("#setHHName").count(), nextUser === "u-me" ? 1 : 0);
      } else assert.equal(await page.locator("#sheet").isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}

test("server-side demotion and revoked membership keep current failures visible", { skip }, async () => {
  const { page, ctx } = await open(null, { init: fixture(), width: 390 });
  try {
    await openSettings(page);
    await ready(page);
    await hold(page, "roles", { rpc: "set_member_role" }, true);
    await page.selectOption('[data-role-for="u-other"]', "viewer");
    await started(page, "roles");
    await page.evaluate(() => { window.__fake.hh("alpha").members[0].role = "viewer"; });
    await release(page, "roles");
    await page.waitForFunction(() => document.querySelector("#mPeople").textContent.includes("owner"));
    assert.equal(await page.locator('[data-role-for="u-other"]').inputValue(), "editor");
    await closeSheet(page);
    await openSettings(page);
    await page.waitForSelector('#sheet', { state: "hidden" });
    await page.waitForFunction(() => document.querySelector("#saveText").textContent === "View only");
    await openSettings(page);
    await ready(page);
    assert.equal(await page.locator("#setInvite, #setHHName, [data-role-for], [data-remove]").count(), 0);
    await closeSheet(page);
    await page.evaluate(() => { window.__fake.hh("alpha").members.shift(); });
    await openSettings(page);
    await page.waitForFunction(() => document.querySelector("#sheet").textContent.includes("no longer have access"));
    assert.equal(await page.locator("#setInvite, #setHHName, [data-role-for]").count(), 0);
    assert.deepEqual((await requests(page)).filter(q => q.rpc === "set_member_role").map(q => q.args.p_household), ["alpha"]);
  } finally { await ctx.close(); }
});

test("closing the originating profile prevents a delayed account export from downloading", { skip }, async () => {
  const { page, ctx } = await open(null, { init: fixture(), width: 375 });
  try {
    await page.click("#menuBtn");
    await page.click('[data-act="profile"]');
    await page.click("#profileData summary");
    await page.waitForFunction(() => !document.querySelector("#delPlan").textContent.includes("Working out"));
    await hold(page, "export", { table: "budgets", cols: "state, updated_at" });
    let downloads = 0; page.on("download", () => { downloads++; });
    await page.click('[data-sheet="download"]');
    await started(page, "export");
    await closeSheet(page);
    await switchTo(page, "beta", "Beta");
    await openSettings(page);
    await ready(page);
    await release(page, "export");
    assert.equal(downloads, 0);
    assert.match(await roster(page), /Beta member/);
    const reads = (await requests(page)).filter(q => q.table === "budgets" && q.cols === "state, updated_at");
    assert.deepEqual(reads.map(q => q.eq.household_id), ["alpha"]);
  } finally { await ctx.close(); }
});

test("current Settings actions still rename, invite, cancel, change role, remove and leave", { skip }, async () => {
  const { page, ctx, errors } = await open(null, { init: fixture(), width: 430 });
  try {
    await openSettings(page);
    await ready(page);
    for (const c of actionCases.slice(0, 5)) {
      await c.action(page);
      if (c.name === "rename") await page.waitForFunction(() => document.querySelector("#mHH").textContent === "Renamed.");
      if (c.name === "invite") await page.waitForFunction(() => document.querySelector("#sheet").textContent.includes("new@example.test"));
      if (c.name === "cancel invitation") await page.locator('[data-uninvite="invite-alpha"]').waitFor({ state: "detached" });
      if (c.name === "change role") await page.waitForFunction(() => !document.querySelector('[data-role-for="u-other"]').disabled);
      if (c.name === "remove member") await page.locator('[data-remove="u-other"]').waitFor({ state: "detached" });
      await ready(page);
      const alpha = await page.evaluate(() => window.__fake.hh("alpha"));
      if (c.name === "cancel invitation") assert.equal(alpha.invites.some(i => i.id === "invite-alpha"), false);
      else assert.equal(c.check(alpha), true, c.name);
    }
    assert.equal(await page.locator('[data-uninvite="invite-alpha"]').count(), 0);
    assert.match(await page.locator("#hhBtn").innerText(), /Alpha renamed/);
    await actionCases[5].action(page);
    await page.waitForFunction(() => document.querySelector("#hhBtn")?.textContent.includes("Beta"));
    assert.equal(actionCases[5].check(await page.evaluate(() => window.__fake.hh("alpha"))), true);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});


test("a delayed household-list refresh cannot replace the selected household after creation", { skip }, async () => {
  const { page, ctx, errors } = await open(null, { init: fixture(), width: 430 });
  try {
    await openSettings(page);
    await ready(page);
    await hold(page, "households", { table: "household_members", cols: "household_id, role, households(name, appearance)" });
    await page.fill("#setNewHH input", "Created budget");
    await submit(page, "setNewHH");
    await started(page, "households");
    await closeSheet(page);
    await switchTo(page, "beta", "Beta");
    await openSettings(page);
    await ready(page);
    await release(page, "households");
    assert.match(await roster(page), /Beta member/);
    assert.equal(await page.locator("#setHHName input").inputValue(), "Beta");
    const creates = (await requests(page)).filter(q => q.rpc === "create_household");
    assert.deepEqual(creates.map(q => q.args), [{ p_name: "Created budget" }]);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("queued appearance choices retire when their sheet closes", { skip }, async () => {
  const { page, ctx, errors } = await open(null, { init: fixture(), width: 390 });
  try {
    await openSettings(page);
    await ready(page);
    await hold(page, "appearance", { rpc: "set_household_appearance" });
    await page.click('[data-hh-oc="blue"]');
    await started(page, "appearance");
    await page.click('[data-hh-icon="heart"]');
    await closeSheet(page);
    await switchTo(page, "beta", "Beta");
    await openSettings(page);
    await ready(page);
    await release(page, "appearance");
    const changes = (await requests(page)).filter(q => q.rpc === "set_household_appearance");
    assert.deepEqual(changes.map(q => q.args), [{ p_appearance: { colour: "blue" }, p_household: "alpha" }]);
    assert.match(await roster(page), /Beta member/);
    assert.equal(await page.locator('[data-hh-icon="heart"]').getAttribute("aria-checked"), "false");
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("the originating profile can download the current account's data", { skip }, async () => {
  const { page, ctx, errors } = await open(null, { init: fixture(), width: 375 });
  try {
    await page.click("#menuBtn");
    await page.click('[data-act="profile"]');
    await page.click("#profileData summary");
    const event = page.waitForEvent("download");
    await page.click('[data-sheet="download"]');
    const file = await event;
    assert.match(file.suggestedFilename(), /^my-budget-data-/);
    const stream = await file.createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(data.account.id, "u-me");
    assert.deepEqual(data.households.map(h => h.id), ["alpha", "beta"]);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

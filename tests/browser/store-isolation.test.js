import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, skip, open, settle } from "./helpers.js";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";

setup();

const note = '[data-f="note"]';
const household = (id, name, role) => ({ id, name, role, budget: toStored({ ...migrate(RICH_V3), note: name + " baseline" }) });
const fixture = viewer => ({ households: [
  household("alpha", "Alpha", "editor"), household("beta", "Beta", viewer ? "viewer" : "editor"),
] });
async function switchTo(page, id, name) {
  if (await page.locator(note).isVisible()) await page.locator(note).blur();
  await page.click("#hhBtn");
  await page.click(`#hhPop [data-switch="${id}"]`);
  await page.waitForFunction(label => document.querySelector("#hhBtn")?.textContent.includes(label), name);
}
async function editNote(page, value) {
  if (!(await page.locator(note).isVisible())) await page.click(".b-note-old summary");
  await page.fill(note, value);
}
async function startSave(page, value) {
  await page.evaluate(() => window.__fake.holdNextSave());
  await editNote(page, value);
  await page.waitForFunction(() => window.__fake.rpcCalls.some(call => call.name === "apply_budget_ops"));
}
const writes = page => page.evaluate(() => window.__fake.rpcCalls.filter(call => call.name === "apply_budget_ops").map(call => call.args));

test("two editable households keep separate writes, screens and pending edits during a switch", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: fixture(false) });
  try {
    await settle(page);
    await startSave(page, "Alpha first edit");
    await editNote(page, "Alpha later edit");
    await page.locator(note).blur();
    await page.click('[data-viewas="month"]');
    assert.equal(await page.getAttribute('[data-viewas="month"]', "aria-pressed"), "true");
    await switchTo(page, "beta", "Beta");
    await settle(page);
    assert.equal(await page.locator(note).inputValue(), "Beta baseline");
    assert.equal(await page.locator("#undoBtn").isVisible(), false);
    await editNote(page, "Beta edit");
    await settle(page);
    await page.evaluate(() => window.__fake.finishSave());
    await page.waitForFunction(() => window.__fake.hh("alpha").budget.note === "Alpha first edit");
    assert.equal(await page.locator(note).inputValue(), "Beta edit");
    assert.equal(await page.textContent("#saveText"), "Saved");
    await switchTo(page, "alpha", "Alpha");
    await page.waitForFunction(() => window.__fake.hh("alpha").budget.note === "Alpha later edit");
    await settle(page);
    assert.equal(await page.locator(note).inputValue(), "Alpha later edit");
    assert.equal(await page.getAttribute('[data-viewas="month"]', "aria-pressed"), "true");
    const saved = await writes(page);
    assert.deepEqual(saved.map(x => x.p_household), ["alpha", "beta", "alpha"]);
    assert.deepEqual(saved[0].p_ops, [{ op: "set", path: ["note"], value: "Alpha first edit" }]);
    assert.deepEqual(saved[1].p_ops, [{ op: "set", path: ["note"], value: "Beta edit" }]);
    assert.equal(await page.evaluate(() => window.__fake.hh("beta").budget.viewAs), "fortnight");
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("a late rejected save leaves the other household view only and keeps the original draft", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: fixture(true) });
  try {
    await settle(page);
    await startSave(page, "Alpha retained edit");
    await switchTo(page, "beta", "Beta");
    await page.waitForFunction(() => document.querySelector("#saveText").textContent === "View only");
    // The mock checks the role when the already-issued save reaches its write step.
    await page.evaluate(() => {
      window.__fake.hh("alpha").members[0].role = "viewer";
      window.__fake.finishSave();
    });
    await switchTo(page, "alpha", "Alpha");
    await page.waitForFunction(() => document.querySelector("#saveText").textContent === "View only");
    assert.equal(await page.locator(note).inputValue(), "Alpha baseline");
    assert.deepEqual((await writes(page)).map(x => x.p_household), ["alpha"]);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("mb-draft-v2-u-me:alpha:"))), true);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("signing out detaches the pending budget and keeps later edits for the same sign-in", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: fixture(false) });
  try {
    await settle(page);
    await startSave(page, "Alpha first edit");
    await editNote(page, "Alpha after first request");
    await page.locator(note).blur();
    page.once("dialog", dialog => dialog.accept());
    await page.click("#menuBtn");
    await page.click('[data-act="signout"]');
    await page.waitForSelector("#fSignin");
    await page.evaluate(() => window.__fake.finishSave());
    await page.waitForFunction(() => window.__fake.hh("alpha").budget.note === "Alpha first edit");
    assert.equal(await page.locator("#app").innerText(), "");
    assert.deepEqual((await writes(page)).map(x => x.p_household), ["alpha"]);
    await page.fill('#fSignin [name="password"]', "test-password");
    await page.click('#fSignin button[type="submit"]');
    await page.waitForFunction(() => window.__fake.hh("alpha").budget.note === "Alpha after first request");
    await settle(page);
    assert.deepEqual((await writes(page)).map(x => x.p_household), ["alpha", "alpha"]);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

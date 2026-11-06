/* Browser tests: load the real app in Chromium, with a fake Supabase (fake-supabase.js),
   and click through it. Run with: npm run test:browser
   Screenshots go to tests/browser/screenshots/ (not committed) so a person can eyeball them. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { LIVE_V3, RICH_V3 } from "../fixtures.js";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch (_) { /* skipped below */ }
const skip = !chromium && "Playwright isn't installed";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHOTS = join(ROOT, "tests/browser/screenshots");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
let server, base, browser;

before(async () => {
  if (skip) return;
  server = http.createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, p === "/" || p === "\\" ? "index.html" : p);
    try { const body = await readFile(file); res.writeHead(200, { "content-type": TYPES[extname(file)] || "text/plain" }); res.end(body); }
    catch { res.writeHead(404); res.end("not found"); }
  }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
  await mkdir(SHOTS, { recursive: true });
});
after(async () => { if (browser) await browser.close(); if (server) server.close(); });

/** Open the app with a given saved budget. Returns the page and a list of errors seen. */
async function open(budget, { width = 1280, seq = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  const fakeJs = await readFile(join(ROOT, "tests/browser/fake-supabase.js"), "utf8");
  await page.route("https://cdn.jsdelivr.net/**", r => r.fulfill({ contentType: "text/javascript", body: fakeJs }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: "text/css", body: "" }));
  await page.addInitScript(([b, s]) => { window.__FAKE_INIT = { budget: b, seq: s }; }, [budget, seq]);
  await page.goto(base);
  try { await page.waitForSelector("#app .viewas", { timeout: 10000 }); }
  catch (e) {
    await page.screenshot({ path: join(SHOTS, "failed-to-load.png") });
    throw new Error(`The app didn't load. Page errors: ${errors.join(" | ") || "none"}. Screen: ${(await page.textContent("body")).replace(/\s+/g, " ").slice(0, 200)}`);
  }
  return { page, errors, ctx };
}
const settle = page => page.waitForFunction(() => document.querySelector("#saveText")?.textContent === "Saved", null, { timeout: 5000 });
const fake = (page, expr) => page.evaluate(expr);
/** Click a tab and wait until it's showing. */
async function goTab(page, tab) {
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForSelector(`[data-tab="${tab}"][aria-selected="true"]`);
}
/** Type into a box the way a person does: click in, select what's there, type over it. */
async function setField(page, sel, v) {
  await page.click(sel);
  await page.$eval(sel, el => el.select());
  if (v === "") await page.keyboard.press("Backspace"); else await page.keyboard.type(v);
}

test("your live budget upgrades itself, with a backup, and shows both people", { skip }, async () => {
  const { page, errors, ctx } = await open(LIVE_V3);
  await settle(page);
  const calls = await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops"));
  assert.equal(calls.length, 1, "one save: the upgrade");
  assert.equal(calls[0].args.p_ops[0].op, "replace");
  const backups = await fake(page, () => window.__fake.backups);
  assert.deepEqual(backups[0], LIVE_V3, "the old budget was backed up before replacing");
  const saved = await fake(page, () => window.__fake.budget);
  assert.equal(saved.version, 4);
  assert.equal(saved.people.j.pay, 1000);
  assert.equal(saved.accounts.ji.split.j, 0.5);
  assert.equal(await page.textContent("#brandNames span:nth-child(1)"), "Jarden");
  assert.match(await page.textContent("#brandNames"), /Madi/);
  assert.equal(await page.locator('[data-l="pp"][data-f="name"]').count(), 2);
  // Joint Investments gets 50% of Jarden's $1,000 = $500 a fortnight
  assert.equal((await page.textContent('[data-k="acc.ji.v.j"]')).trim(), "$500");
  await page.screenshot({ path: join(SHOTS, "budget-live.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("an edit saves as one small change, not the whole budget", { skip }, async () => {
  const { page, errors, ctx } = await open(LIVE_V3);
  await settle(page);
  await fake(page, () => { window.__fake.rpcCalls = []; });
  await setField(page, '[data-l="pp"][data-i="m"][data-f="pay"]', "650");
  await settle(page);
  const calls = await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops"));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.p_ops, [{ op: "set", path: ["people", "m", "pay"], value: 650 }]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("someone else's change arrives while you're typing: both are kept", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  await setField(page, '[data-l="pp"][data-i="j"][data-f="pay"]', "2500");         // my edit, not yet saved
  await fake(page, () => window.__fake.remote([{ op: "set", path: ["note"], value: "From Madi" }])); // their save
  await settle(page);
  const saved = await fake(page, () => window.__fake.budget);
  assert.equal(saved.note, "From Madi");
  assert.equal(saved.people.j.pay, 2500);
  assert.equal(await page.inputValue('[data-f="note"]'), "From Madi");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a remote update shows up on screen", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  const before = await fake(page, () => window.__fake.seq);
  await fake(page, () => window.__fake.remote([{ op: "set", path: ["people", "m", "name"], value: "Madison" }]));
  await page.waitForFunction(() => document.querySelector("#brandNames").textContent.includes("Madison"));
  assert.equal(await fake(page, () => window.__fake.seq), before + 1, "the app didn't save anything back");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("'show amounts per' switches every figure between week, fortnight and month", { skip }, async () => {
  const { page, errors, ctx } = await open(LIVE_V3);
  await settle(page);
  const inv = () => page.textContent('[data-k="acc.ji.v.j"]');
  assert.equal((await inv()).trim(), "$500");
  await page.click('[data-viewas="week"]');
  assert.equal((await inv()).trim(), "$250");
  await page.click('[data-viewas="month"]');
  assert.equal((await inv()).trim(), "$1,083.33");               // $13,000 a year ÷ 12
  assert.match(await page.textContent("#brandNames small"), /per month/);
  await settle(page);
  assert.equal((await fake(page, () => window.__fake.budget)).viewAs, "month", "the choice is saved for the household");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("people: add, set pay frequency, recolour, remove", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  await page.click("[data-addperson]");
  await page.keyboard.type("Sam");
  const sam = await page.getAttribute('[data-l="pp"][data-f="name"] >> nth=2', "data-i");
  await setField(page, `[data-l="pp"][data-i="${sam}"][data-f="pay"]`, "1000");
  await page.selectOption(`[data-l="pp"][data-i="${sam}"][data-f="freq"]`, "weekly");
  await page.click(`[data-colour="slate"][data-i="${sam}"]`);
  await settle(page);
  let saved = await fake(page, () => window.__fake.budget);
  assert.equal(saved.people[sam].name, "Sam");
  assert.equal(saved.people[sam].freq, "weekly");
  assert.equal(saved.people[sam].colour, "slate");
  assert.ok(Object.values(saved.accounts).some(a => a.owner === sam && a.role === "personalGoals"), "Sam got a personal goals account");
  // one column pair per person in the allocation table
  assert.equal(await page.locator(`[data-f="split.${sam}"]`).count(), Object.keys(saved.accounts).length);
  assert.match(await page.textContent(`[data-k="inc.${sam}.sub"]`), /\$2,000 a fortnight/);
  await page.screenshot({ path: join(SHOTS, "budget-three-people.png"), fullPage: true });
  page.once("dialog", d => d.accept());
  await page.click(`[data-rmperson="${sam}"]`);
  await page.click("#dlgYes");
  await settle(page);
  saved = await fake(page, () => window.__fake.budget);
  assert.equal(saved.people[sam], undefined);
  assert.ok(!Object.values(saved.accounts).some(a => a.owner === sam));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the fair-split check only shows with two or more earners", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  assert.equal(await page.isVisible("#fairSec"), true);
  await setField(page, '[data-l="pp"][data-i="m"][data-f="pay"]', "");
  assert.equal(await page.isVisible("#fairSec"), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a brand-new household starts with one person and no fair-split check", { skip }, async () => {
  const { page, errors, ctx } = await open({});
  assert.equal(await page.locator('[data-l="pp"][data-f="name"]').count(), 1);
  assert.equal(await page.inputValue('[data-l="pp"][data-f="name"]'), "Jarden", "named after the signed-in person");
  assert.equal(await page.isVisible("#fairSec"), false);
  assert.ok(await page.isVisible(".welcome"));
  assert.equal(await page.locator(".tab", { hasText: "Spending" }).count(), 1);
  const calls = await fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "apply_budget_ops"));
  assert.equal(calls.length, 0, "nothing is saved until you change something");
  await setField(page, '[data-l="pp"][data-f="pay"]', "3000");
  await settle(page);
  assert.equal(Object.values((await fake(page, () => window.__fake.budget)).people)[0].pay, 3000);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("every tab draws without errors, and goals/spending follow the view period", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  for (const tab of ["networth", "spending", "goals", "invest", "budget"]) {
    await goTab(page, tab);
    await page.screenshot({ path: join(SHOTS, `tab-${tab}.png`), fullPage: true });
  }
  await goTab(page, "spending");
  assert.match(await page.textContent("thead"), /Per fortnight/);
  await page.click('[data-viewas="month"]');
  assert.match(await page.textContent("thead"), /Per month/);
  await goTab(page, "goals");
  assert.ok(await page.locator("text=Jarden’s personal goals").count());
  assert.ok(await page.locator("text=Madi’s personal goals").count());
  await page.screenshot({ path: join(SHOTS, "tab-goals-month.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("adding, reordering and deleting rows all save", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  await page.click('[data-tab="spending"]');
  await page.click('[data-add="sp"]');
  await page.keyboard.type("Netflix");
  await settle(page);
  let saved = await fake(page, () => window.__fake.budget);
  const nf = Object.values(saved.spend).find(s => s.name === "Netflix");
  assert.ok(nf, "new row saved");
  // move it to the top with the keyboard
  for (let k = 0; k < 6; k++) { await page.focus(`.grip[data-i="${nf.id}"]`); await page.keyboard.press("ArrowUp"); }
  await settle(page);
  saved = await fake(page, () => window.__fake.budget);
  const order = Object.values(saved.spend).sort((a, b) => a.pos - b.pos).map(s => s.name);
  assert.equal(order[0], "Netflix");
  await page.click(`[data-del="sp"][data-i="s3"]`);
  await page.click("#dlgYes");
  await settle(page);
  saved = await fake(page, () => window.__fake.budget);
  assert.equal(saved.spend.s3, undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("if saving fails, it says so and tries again", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3);
  await settle(page);
  await fake(page, () => { window.__fake.failNext = 2; });
  await page.fill('[data-f="note"]', "Offline edit");
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "Couldn’t save", null, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector("#saveText").textContent === "Saved", null, { timeout: 20000 });
  assert.equal((await fake(page, () => window.__fake.budget)).note, "Offline edit");
  assert.deepEqual(errors.filter(e => !/Failed to fetch/.test(e)), []);
  await ctx.close();
});

test("phone width still loads (full mobile layout comes in Phase 3)", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH_V3, { width: 390 });
  await settle(page);
  await page.screenshot({ path: join(SHOTS, "phone-budget.png"), fullPage: false });
  assert.deepEqual(errors, []);
  await ctx.close();
});

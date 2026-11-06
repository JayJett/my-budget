/* Shared helpers for the browser tests: a tiny web server for the app, Chromium, and the fake Supabase. */
import { before, after } from "node:test";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch (_) { /* skipped below */ }
export const skip = !chromium && "Playwright isn't installed";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const SHOTS = join(ROOT, "tests/browser/screenshots");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
let server, base, browser;
let swExtra = "";
/** Pretend a new version was published: the service worker file changes. */
export const publishNewVersion = () => { swExtra += `\n// new version ${Date.now()}`; };

/** Call once per test file: starts the web server and browser before the tests, stops them after. */
export function setup(launchOptions = {}) {
before(async () => {
  if (skip) return;
  server = http.createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    // The app's own copy of Supabase is swapped for the fake, so nothing reaches the real database.
    const file = /supabase-js-[\d.]+[\/\\]supabase\.js$/.test(p) ? join(ROOT, "tests/browser/fake-supabase.js")
      : join(ROOT, p === "/" || p === "\\" ? "index.html" : p);
    try {
      let body = await readFile(file);
      if (p.endsWith("sw.js") && swExtra) body = Buffer.concat([body, Buffer.from(swExtra)]);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || (file.endsWith(".webmanifest") ? "application/manifest+json" : "text/plain"), "cache-control": "no-store" });
      res.end(body);
    }
    catch { res.writeHead(404); res.end("not found"); }
  }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch(launchOptions);
  await mkdir(SHOTS, { recursive: true });
});
after(async () => { if (browser) await browser.close(); if (server) server.close(); });
}

/** Open the app with a given saved budget (or a full fake setup via opts.init).
    Returns the page and a list of errors seen. waitFor: what to wait for before returning. */
export async function open(budget, { width = 1280, seq = 0, init = null, waitFor = "#app .viewas", storage = null, device = null } = {}) {
  // Reduced motion: sheets appear in place, so tests can measure them straight away (and the setting is exercised).
  const ctx = await browser.newContext({ ...(device ? { ...device } : { viewport: { width, height: 900 } }), reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: "text/css", body: "" }));
  await page.addInitScript(([i, st]) => { window.__FAKE_INIT = i; if (st) for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); }, [init || { budget, seq }, storage]);
  await page.goto(base);
  try { await page.waitForSelector(waitFor, { timeout: 10000 }); }
  catch (e) {
    await page.screenshot({ path: join(SHOTS, "failed-to-load.png") });
    throw new Error(`The app didn't load. Page errors: ${errors.join(" | ") || "none"}. Screen: ${(await page.textContent("body")).replace(/\s+/g, " ").slice(0, 200)}`);
  }
  return { page, errors, ctx };
}
export const settle = page => page.waitForFunction(() => document.querySelector("#saveText")?.textContent === "Saved", null, { timeout: 5000 });
export const fake = (page, expr) => page.evaluate(expr);
/** Click a tab and wait until it's showing. */
export async function goTab(page, tab) {
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForSelector(`[data-tab="${tab}"][aria-selected="true"]`);
}
/** Type into a box the way a person does: click in, select what's there, type over it. */
export async function setField(page, sel, v) {
  await page.click(sel);
  await page.$eval(sel, el => el.select());
  if (v === "") await page.keyboard.press("Backspace"); else await page.keyboard.type(v);
}


/* Budget tab (UI phase 1): pay and allocations are edited in a sheet. */
export async function editPerson(page, id) {
  await page.click(`[data-edit-person="${id}"]`);
  await page.waitForSelector(`#sheet .bsheet [data-l="pp"][data-i="${id}"][data-f="name"]`);
}
export async function editAccount(page, id) {
  await page.click(`[data-edit-acc="${id}"]`);
  await page.waitForSelector(`#sheet .bsheet [data-l="acc"][data-i="${id}"][data-f="name"]`);
}
export async function closeSheet(page) {
  await page.click('#sheet [data-sheet="close"]');
  await page.waitForSelector("#sheet", { state: "hidden" });
}

/* Spending tab (UI phase 2): expenses are edited in a sheet. */
export async function editExpense(page, id) {
  await page.click(`[data-edit-sp="${id}"]`);
  await page.waitForSelector(`#sheet .bsheet [data-l="sp"][data-i="${id}"][data-f="name"]`);
}
/** Open an expense, type a new value into one of its boxes, and close the sheet again. */
export async function setExpense(page, id, field, value) {
  await editExpense(page, id);
  await setField(page, `#sheet [data-l="sp"][data-i="${id}"][data-f="${field}"]`, value);
  await closeSheet(page);
}

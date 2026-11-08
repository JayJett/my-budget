/* Part 4C step 2 in a real browser: turning notifications on/off for this device, "Send a test",
   the iPhone explanation, signing out, and the service worker showing a notification and opening the
   right place when it's tapped. Apple's and Google's push services can't be reached from the tests,
   so the browser's "subscribe" is replaced by a stand-in; the service worker part is real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createRequire } from "node:module";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, settle, fake } from "./helpers.js";

// The fuller "new headless" Chromium: the default test mode always reports notifications as blocked.
setup({ channel: "chromium" });
const require = createRequire(import.meta.url);
let devices = {}; try { ({ devices } = require("playwright")); } catch (_) {}
const V4 = toStored(migrate(RICH_V3));
const PREFS = { user_id: "u-me", household_id: "hh-1", review: false, review_day: 1, sink_due: false, due_weeks: 6, sink_behind: true, goal_done: true, goal_risk: false, allocation: false };
const init = (extra = {}) => ({ households: [{ id: "hh-1", name: "Test household", role: "owner", budget: V4, remPrefs: PREFS }], ...extra });

/** A stand-in for the browser's push service connection (the real one needs Google's servers). */
const fakePushManager = () => {
  let sub = null;
  const make = opts => ({
    endpoint: "https://fcm.googleapis.com/fcm/send/test-device-" + Math.random().toString(36).slice(2, 8),
    options: { applicationServerKey: opts.applicationServerKey.buffer || opts.applicationServerKey },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" } }; },
    async unsubscribe() { sub = null; window.__pushUnsubscribed = (window.__pushUnsubscribed || 0) + 1; return true; },
  });
  PushManager.prototype.subscribe = async function (opts) { sub = make(opts); return sub; };
  PushManager.prototype.getSubscription = async function () { return sub; };
};

async function openSettings(page) {
  await page.click("#bellBtn");
  await page.click('#drawer [data-rem="settings"]');
  await page.waitForSelector("#sheet .push-set");
}
async function openWithPush({ init: extra, ...opts } = {}) {
  const o = await open(null, { init: init(extra), ...opts });
  await o.ctx.grantPermissions(["notifications"], { origin: new URL(o.page.url()).origin });
  await o.page.evaluate(fakePushManager);
  await settle(o.page);
  await o.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 });
  return o;
}

test("turn notifications on for this device, send a test, then turn them off", { skip }, async () => {
  const { page, errors, ctx } = await openWithPush();
  await openSettings(page);
  await page.waitForSelector('#sheet [data-push="on"]');
  assert.match(await page.textContent("#sheet .push-set"), /Only the reminders you’ve switched on above are sent/);
  await page.click('#sheet [data-push="on"]');
  await page.waitForSelector("#sheet .push-on .chip.ok");
  const saved = await fake(page, () => window.__fake.rpcCalls.find(c => c.name === "save_push_subscription").args);
  assert.match(saved.p_endpoint, /^https:\/\/fcm\.googleapis\.com\//);
  assert.equal(saved.p_auth, "BTBZMqHH6r4Tts7J_aSIgg");
  assert.ok(saved.p_label.length > 3, "a friendly device name");
  assert.equal(await fake(page, () => window.__fake.fnCalls[0].body.publicKey), true, "the public key comes from the function");
  await page.screenshot({ path: join(SHOTS, "push-on.png") });
  await page.click('#sheet [data-push="test"]');
  await page.waitForSelector("#sheet >> text=Test sent to your device");
  await page.click('#sheet [data-push="off"]');
  await page.waitForSelector('#sheet [data-push="on"]');
  assert.equal(await fake(page, () => window.__fake.devices.length), 0);
  assert.equal(await page.evaluate(() => window.__pushUnsubscribed), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("before the key is added in Supabase, it says so kindly", { skip }, async () => {
  const { page, errors, ctx } = await openWithPush({ init: { pushKey: null } });
  await openSettings(page);
  await page.click('#sheet [data-push="on"]');
  await page.waitForSelector("#sheet .push-set .msg.err");
  assert.match(await page.textContent("#sheet .push-set .msg"), /Phone notifications aren’t set up yet/);
  assert.equal(await fake(page, () => window.__fake.devices.length), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("other devices are listed and can be removed from here", { skip }, async () => {
  const others = [{ id: 1, endpoint: "https://web.push.apple.com/madis-iphone", label: "iPhone · app", created_at: "2026-11-01T00:00:00Z" }];
  const { page, errors, ctx } = await openWithPush({ init: { devices: others } });
  await openSettings(page);
  await page.waitForSelector("#sheet .push-devices");
  assert.match(await page.textContent("#sheet .push-devices"), /iPhone · app/);
  await page.click('#sheet [data-push="remove"][data-id="1"]');
  await page.waitForSelector("#sheet .push-devices", { state: "detached" });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("iPhone in Safari (not added to the Home Screen): explains how to install first", { skip: skip || !devices["iPhone 13"] }, async () => {
  const { page, errors, ctx } = await open(null, { init: init(), device: devices["iPhone 13"] });
  await settle(page);
  await openSettings(page);
  await page.waitForSelector("#sheet >> text=Add to Home Screen");
  assert.match(await page.textContent("#sheet .push-set"), /only work in the installed app \(iOS 16\.4 or later\)/);
  assert.equal(await page.locator('#sheet [data-push="on"]').count(), 0);
  await page.locator("#sheet .push-set").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, "phone-push-iphone.png") });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("signing out turns notifications off on this device", { skip }, async () => {
  const { page, errors, ctx } = await openWithPush();
  await openSettings(page);
  await page.click('#sheet [data-push="on"]');
  await page.waitForSelector("#sheet .push-on .chip.ok");
  await page.click('[data-sheet="close"]');
  await page.click("#menuBtn"); await page.click('[data-act="signout"]');
  await page.waitForSelector("#fSignin");
  assert.equal(await fake(page, () => window.__fake.devices.length), 0);
  assert.equal(await page.evaluate(() => window.__pushUnsubscribed), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the service worker shows a pushed reminder, and tapping it opens the right tab", { skip }, async () => {
  const { page, errors, ctx } = await openWithPush();
  const cdp = await ctx.newCDPSession(page);
  const regId = new Promise(res => cdp.on("ServiceWorker.workerRegistrationUpdated", e => { const r = e.registrations.find(x => !x.isDeleted); if (r) res(r.registrationId); }));
  await cdp.send("ServiceWorker.enable");
  const origin = new URL(page.url()).origin;
  const data = JSON.stringify({ title: "Car rego is behind by $50", body: "Put aside $10 a fortnight.", url: "./#joint-spending", tag: "mb-reminders" });
  await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId: await regId, data });
  let shown = null;
  for (let i = 0; i < 50 && !shown; i++) {
    shown = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready; const n = await reg.getNotifications();
      return n.length ? { title: n[0].title, body: n[0].body, url: n[0].data.url } : null;
    });
    if (!shown) await page.waitForTimeout(200);
  }
  assert.deepEqual(shown, { title: "Car rego is behind by $50", body: "Put aside $10 a fortnight.", url: "./#joint-spending" });
  // Tapping it with the app open switches to the right tab (sw.js posts "open" to the page)
  await page.evaluate(() => navigator.serviceWorker.controller && new Promise(r => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "open", hash: "#joint-spending" } })); setTimeout(r, 50);
  }));
  await page.waitForSelector('[data-tab="spending"][aria-selected="true"]');
  // Several reminders open the inbox
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "open", hash: "#reminders" } })));
  await page.waitForSelector("#drawer .rem");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a link to #reminders (from a notification) opens the inbox when the app starts", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: init() });
  await settle(page);
  await page.evaluate(() => { location.hash = "reminders"; });
  await page.waitForSelector("#drawer .rem");
  assert.notEqual(await page.evaluate(() => location.hash), "#reminders", "the address goes back to the tab");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the key-making page: opens even with the app installed, and makes a working key", { skip }, async () => {
  const { page, errors, ctx } = await openWithPush();
  await page.goto(new URL("tools/make-push-keys.html", page.url()).href);
  await page.waitForSelector("text=Make the notification key");
  await page.click("#make");
  await page.waitForSelector("#out:not([hidden])");
  const jwk = JSON.parse(await page.inputValue("#secret"));
  assert.deepEqual(Object.keys(jwk).sort(), ["crv", "d", "kty", "x", "y"]);
  assert.equal(jwk.crv, "P-256");
  assert.match(await page.textContent("#out"), /VAPID_PRIVATE_KEY/);
  await page.screenshot({ path: join(SHOTS, "make-push-keys.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await ctx.close();
});

/* Phase 7A: signing up, verifying with an email code, and creating (or joining) a household, reliably.
   Uses the fake Supabase (no real accounts or households are created). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, skip, SHOTS, open, fake } from "./helpers.js";

setup();
const creates = page => fake(page, () => window.__fake.rpcCalls.filter(c => c.name === "create_household").length);
const households = page => fake(page, () => window.__fake.households.length);
const auth = (page, name) => page.evaluate(n => window.__fake.authCalls.filter(c => c.name === n), name);
// Phase 7B: setup step 1 asks who's budgeting first (nothing is chosen for you)
const newUser = async (extra = {}) => { const o = await open(null, { init: { households: [], ...extra }, waitFor: "#fHousehold", width: 390 }); await o.page.check('#fHousehold input[value="solo"]'); return o; };
const signedOut = (extra = {}, waitFor = "#fSignin") => open(null, { init: { signedOut: true, households: [], ...extra }, waitFor, width: 390 });
const msg = page => page.textContent("#authMsg");

/* ---------- creating the first household ---------- */
test("the reported bug: a brand-new account creates its household once and goes straight into setup, no refresh", { skip }, async () => {
  const { page, errors, ctx } = await newUser();
  await page.fill('#fHousehold [name="name"]', "Sam’s budget");
  await page.click('#fHousehold button[type="submit"]');
  await page.waitForSelector(".ob", { timeout: 8000 });
  assert.equal(await creates(page), 1);
  assert.equal(await page.isVisible("#auth"), false);
  assert.deepEqual(errors, []); await ctx.close();
});

test("rapid repeated taps make one household", { skip }, async () => {
  const { page, errors, ctx } = await newUser({ createDelay: 600 });
  const btn = page.locator('#fHousehold button[type="submit"]');
  await btn.click(); await btn.click({ force: true }).catch(() => {}); await page.locator("#fHousehold").evaluate(f => { f.requestSubmit(); f.requestSubmit(); });
  await page.waitForSelector(".ob", { timeout: 8000 });
  assert.equal(await creates(page), 1); assert.equal(await households(page), 1);
  assert.deepEqual(errors, []); await ctx.close();
});

test("slow connection: the button says what's happening, then it carries on", { skip }, async () => {
  const { page, errors, ctx } = await newUser({ createDelay: 1500 });
  await page.click('#fHousehold button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#fHousehold button[type="submit"]').textContent === "Creating your household…");
  assert.equal(await page.isDisabled('#fHousehold button[type="submit"]'), true);
  await page.waitForSelector(".ob", { timeout: 8000 });
  assert.deepEqual(errors, []); await ctx.close();
});

test("no connection: a clear message, nothing made; trying again works", { skip }, async () => {
  const { page, ctx } = await newUser({ createMode: "fail" });
  await page.click('#fHousehold button[type="submit"]');
  await page.waitForFunction(() => /couldn’t reach the server/.test(document.querySelector("#authMsg").textContent), null, { timeout: 10000 });
  assert.equal(await page.isDisabled('#fHousehold button[type="submit"]'), false, "never an endless spinner");
  assert.equal(await households(page), 0);
  await fake(page, () => { window.__fake.createMode = null; });
  await page.click('#fHousehold button[type="submit"]');
  await page.waitForSelector(".ob", { timeout: 8000 });
  assert.equal(await households(page), 1);
  await ctx.close();
});

test("created but the reply was lost: it checks, finds the household and opens it (no second household)", { skip }, async () => {
  const { page, ctx } = await newUser({ createMode: "lost" });
  await page.click('#fHousehold button[type="submit"]');
  await page.waitForSelector(".ob", { timeout: 10000 });
  assert.equal(await creates(page), 1); assert.equal(await households(page), 1);
  await ctx.close();
});

test("tapping again after an earlier attempt worked opens that household instead of making another", { skip }, async () => {
  const { page, errors, ctx } = await newUser();
  await fake(page, () => { window.__fake.households.push({ id: "hh-9", name: "Made earlier", budget: {}, seq: 0, backups: [], invites: [], snapshots: [], changes: [], reminders: [], remPrefs: null, members: [{ user_id: "u-me", display_name: "Jarden", email: "jarden@example.com", role: "owner", joined_at: "2026-01-01" }] }); });
  await page.click('#fHousehold button[type="submit"]');
  await page.waitForSelector(".ob", { timeout: 8000 });
  assert.equal(await creates(page), 0, "nothing new was made");
  assert.deepEqual(errors, []); await ctx.close();
});

test("an expired sign-in while creating goes back to sign-in with a clear message", { skip }, async () => {
  const { page, ctx } = await newUser({ createMode: "expired" });
  await page.click('#fHousehold button[type="submit"]');
  await page.waitForSelector("#fSignin");
  assert.match(await msg(page), /session has expired/);
  await ctx.close();
});

test("someone already in a household goes straight to it; an invited person joins instead of being asked to create one", { skip }, async () => {
  let o = await open(null, { init: {}, waitFor: ".ob, #app .viewas" });
  assert.equal(await o.page.locator("#fHousehold").count(), 0);
  await o.ctx.close();
  o = await open(null, { init: { households: [], invite: { id: "hh-inv", name: "Mum’s budget", role: "editor" } }, waitFor: ".ob, #app .viewas" });
  await o.page.waitForFunction(() => /Mum’s budget/.test(document.querySelector("#brandNames")?.textContent || ""));
  assert.equal(await o.page.locator("#fHousehold").count(), 0);
  assert.equal(await creates(o.page), 0);
  assert.equal(await fake(o.page, () => window.__fake.households[0].members[0].role), "editor", "joined with the role they were invited with");
  await o.ctx.close();
});

test("if loading households fails, it says so with Try again (not a sign-in error), and Try again works", { skip }, async () => {
  const { page, errors, ctx } = await open(null, { init: { failMembers: 1 }, waitFor: '[data-auth="recheck"]' });
  assert.match(await msg(page), /couldn’t connect/);
  await page.click('[data-auth="recheck"]');
  await page.waitForSelector(".ob, #app .viewas");
  await ctx.close();
});

/* ---------- email codes ---------- */
test("sign up → code screen showing the address → wrong code explained → right code signs in → create household", { skip }, async () => {
  const { page, errors, ctx } = await signedOut();
  await page.click('[data-auth="signup"]');
  await page.fill('#fSignup [name="name"]', "Sam"); await page.fill('#fSignup [name="email"]', "sam@example.com"); await page.fill('#fSignup [name="password"]', "longenough1");
  await page.click('#fSignup button[type="submit"]');
  await page.waitForSelector("#fVerify");
  assert.match(await page.textContent(".auth-card"), /sam@example\.com/);
  assert.equal((await auth(page, "signUp"))[0].redirect.endsWith("/"), true, "the confirmation link comes back to the app");
  assert.equal(await page.getAttribute("#fVerify .otp", "autocomplete"), "one-time-code");
  assert.equal(await page.getAttribute("#fVerify .otp", "inputmode"), "numeric");
  await page.screenshot({ path: join(SHOTS, "auth-verify-390.png") });
  await page.fill("#fVerify .otp", "111111"); await page.click('#fVerify button[type="submit"]');
  await page.waitForFunction(() => /didn’t work/.test(document.querySelector("#authMsg").textContent));
  assert.match(await msg(page), /already opened the link.*sign in instead/);
  await page.fill("#fVerify .otp", "123456"); await page.click('#fVerify button[type="submit"]');
  await page.waitForSelector("#fHousehold");
  assert.deepEqual((await auth(page, "verifyOtp")).map(c => c.type), ["signup", "signup"]);
  assert.equal(await page.evaluate(() => localStorage.getItem("mb-verify")), null, "the waiting step is cleared once signed in");
  assert.deepEqual(errors, []); await ctx.close();
});

test("pasting or auto-filling the whole code verifies straight away; letters and spaces are ignored", { skip }, async () => {
  const { page, ctx } = await signedOut({}, "#fVerify").catch(() => null) || {};
  if (page) await ctx.close();
  const o = await open(null, { init: { signedOut: true, households: [] }, storage: { "mb-verify": JSON.stringify({ email: "sam@example.com", kind: "signup", at: Date.now() }) }, waitFor: "#fVerify" });
  await o.page.$eval("#fVerify .otp", el => { el.value = " 12 34-56 "; el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" })); });
  await o.page.waitForSelector("#fHousehold");
  await o.ctx.close();
});

test("refreshing while waiting keeps the code screen; 'send a new code' follows Supabase's own wait, even after a refresh", { skip }, async () => {
  const { page, errors, ctx } = await signedOut({ resendWait: 42 });
  await page.click('[data-auth="signup"]');
  await page.fill('#fSignup [name="name"]', "Sam"); await page.fill('#fSignup [name="email"]', "sam@example.com"); await page.fill('#fSignup [name="password"]', "longenough1");
  await page.click('#fSignup button[type="submit"]'); await page.waitForSelector("#fVerify");
  await page.click('[data-auth="resend"]');
  await page.waitForFunction(() => /Send a new code \(4\ds\)/.test(document.querySelector('[data-auth="resend"]').textContent));
  assert.equal(await page.isDisabled('[data-auth="resend"]'), true);
  assert.deepEqual((await auth(page, "resend")).map(c => c.type), ["signup"]);
  await page.reload(); await page.waitForSelector("#fVerify");
  assert.match(await page.textContent(".auth-card"), /sam@example\.com/);
  assert.match(await page.textContent('[data-auth="resend"]'), /\(\d+s\)/, "the wait carries on after a refresh");
  assert.equal((await auth(page, "resend")).length, 0, "refreshing never sends another email by itself");
  await page.click('[data-auth="signup"][data-forget]');
  await page.waitForSelector("#fSignup");
  assert.equal(await page.evaluate(() => localStorage.getItem("mb-verify")), null, "'use a different email' starts again");
  await ctx.close();
});

test("sign in with a code: the same message whether or not the email has an account; never creates an account", { skip }, async () => {
  const { page, errors, ctx } = await signedOut();
  await page.click('[data-auth="codein"]');
  await page.fill('#fCodeIn [name="email"]', "nobody@example.com"); await page.click('#fCodeIn button[type="submit"]');
  await page.waitForSelector("#fVerify");
  const unknown = await msg(page);
  await page.click('[data-auth="codein"][data-forget]');
  await page.fill('#fCodeIn [name="email"]', "jarden@example.com"); await page.click('#fCodeIn button[type="submit"]');
  await page.waitForSelector("#fVerify");
  assert.equal(await msg(page), unknown.replace("nobody@example.com", "jarden@example.com"), "no hint about which emails have accounts");
  assert.deepEqual((await auth(page, "signInWithOtp")).map(c => c.shouldCreateUser), [false, false]);
  await page.fill("#fVerify .otp", "123456"); await page.click('#fVerify button[type="submit"]');
  await page.waitForSelector("#fHousehold");
  assert.deepEqual((await auth(page, "verifyOtp")).map(c => c.type), ["email"]);
  await ctx.close();
});

test("coming back from an expired link or a cancelled Google/Apple sign-in explains it and tidies the address", { skip }, async () => {
  const { page, ctx } = await signedOut();
  await page.goto(page.url().split("#")[0] + "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await page.reload(); await page.waitForSelector("#fSignin");
  assert.match(await msg(page), /expired or was already used/);
  assert.equal(new URL(page.url()).hash, "", "nothing left in the address bar");
  await ctx.close();
});

/* ---------- Google and Apple: only when switched on ---------- */
test("Google/Apple buttons only appear when the project has them switched on; they start the provider's sign-in", { skip }, async () => {
  let o = await signedOut();
  await o.page.waitForTimeout(300);
  assert.equal(await o.page.locator("[data-oauth]").count(), 0, "not switched on: no buttons that would fail");
  await o.ctx.close();
  o = await signedOut({ providers: { google: true, apple: true } });
  await o.page.waitForSelector('[data-oauth="google"]');
  assert.deepEqual(await o.page.$$eval("[data-oauth]", els => els.map(e => e.textContent.trim())), ["Continue with Apple", "Continue with Google"]);
  await o.page.screenshot({ path: join(SHOTS, "auth-signin-providers-390.png") });
  await o.page.click('[data-oauth="google"]');
  const calls = await auth(o.page, "oauth");
  assert.equal(calls[0].provider, "google"); assert.ok(calls[0].redirectTo.endsWith("/"));
  await o.ctx.close();
});

for (const width of [320, 375, 390, 430]) {
  test(`${width}px: sign-in, sign-up, code and household screens fit, with big enough taps and no zoom`, { skip }, async () => {
    const o = await open(null, { init: { signedOut: true, households: [], providers: { google: true, apple: true } }, storage: { "mb-verify": JSON.stringify({ email: "a.very.long.email.address@example.com", kind: "signup", at: Date.now() }) }, waitFor: "#fVerify", width });
    for (const mode of ["verify", "signin", "signup", "codein"]) {
      if (mode !== "verify") await o.page.evaluate(m => document.querySelector(`[data-auth="${m}"]`) ? document.querySelector(`[data-auth="${m}"]`).click() : null, mode);
      await o.page.waitForTimeout(150);
      assert.equal(await o.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, mode);
      assert.deepEqual(await o.page.$$eval("#auth input:not([type=hidden]):not([hidden])", els => els.filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.name)), [], `${mode}: no iPhone zoom`);
      assert.deepEqual(await o.page.$$eval("#auth button", els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height < 40; }).map(e => e.textContent.trim())), [], `${mode}: tappable`);
    }
    await o.ctx.close();
  });
}

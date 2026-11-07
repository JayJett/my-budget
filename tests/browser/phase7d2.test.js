/* Phase 7D.2: the drawer menu, the bell and notifications, My profile with a profile picture, the
   first-goal flow and the hero cards. Uses the fake Supabase (no real accounts, files or data). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { setup, skip, SHOTS, open, fake, goTab, settle } from "./helpers.js";

setup();
const RICH = toStored(migrate(RICH_V3));
const ALL_DONE = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(t => [t, "done"])) }) };
const phone = (w = 390, h = 760) => ({ device: { viewport: { width: w, height: h }, hasTouch: true, isMobile: true } });
const locked = page => page.evaluate(() => document.documentElement.classList.contains("scroll-locked"));
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `p7d2-${name}.png`) });
/** A finger swipe on an element, from (x0,y) to (x1,y), in steps. */
const swipe = (page, sel, dx, steps = 8) => page.evaluate(([sel, dx, steps]) => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect(), x0 = r.left + r.width * 0.7, y = r.top + 200;
  const t = x => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  el.dispatchEvent(new TouchEvent("touchstart", { touches: [t(x0)], bubbles: true, cancelable: true }));
  // about 16ms between moves, like a real finger (an instant swipe would count as a flick)
  return (async () => {
    for (let k = 1; k <= steps; k++) { await new Promise(r => setTimeout(r, 16)); el.dispatchEvent(new TouchEvent("touchmove", { touches: [t(x0 + dx * k / steps)], bubbles: true, cancelable: true })); }
    el.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [t(x0 + dx)], bubbles: true, cancelable: true }));
  })();
}, [sel, dx, steps]);

/* ---------------- the drawer ---------------- */
test("the avatar opens a drawer from the left; page still, dimmed and in place; swipe left, the dimmed page or Escape close it", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...phone(), storage: ALL_DONE });
  await page.evaluate(() => scrollTo(0, 500)); await page.waitForTimeout(50);
  const y0 = await page.evaluate(() => scrollY);
  await page.tap("#menuBtn");
  await page.waitForSelector("#drawer.dr-left:not([hidden])");
  const box = await page.locator("#drawer").boundingBox();
  assert.ok(box.x === 0 && box.width >= 390 * 0.8 && box.width <= 390 * 0.9, `drawer width ${box.width}`);
  assert.equal(await page.getAttribute("#drawer", "role"), "dialog");
  assert.equal(await page.getAttribute("#menuBtn", "aria-expanded"), "true");
  assert.equal(await locked(page), true); assert.equal(await page.evaluate(() => document.querySelector("#app").inert), true);
  assert.equal(await page.isVisible(".dr-back.on"), true, "the page behind is dimmed");
  // short labels with icons; no long descriptions on the main list
  assert.equal(await page.locator("#drawer .dr-row .mi").count(), await page.locator("#drawer .dr-row").count());
  assert.equal(await page.locator("#drawer .dr-row small").count(), 0);
  await shot(page, "drawer");
  // a small swipe left settles back; a real one closes
  await swipe(page, "#drawer", -40); await page.waitForTimeout(300);
  assert.equal(await page.isVisible("#drawer"), true, "a little swipe: still open");
  await swipe(page, "#drawer", -220);
  await page.waitForSelector("#drawer", { state: "hidden" });
  assert.equal(await page.evaluate(() => scrollY), y0, "exactly where you were");
  assert.equal(await locked(page), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "menuBtn", "focus back on the avatar");
  // up-and-down movement inside the drawer doesn't close it
  await page.tap("#menuBtn"); await page.waitForSelector("#drawer:not([hidden])");
  await page.evaluate(() => { const el = document.querySelector("#drawer"); const t = (x, y) => new Touch({ identifier: 2, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent("touchstart", { touches: [t(200, 400)], bubbles: true }));
    for (let k = 1; k < 8; k++) el.dispatchEvent(new TouchEvent("touchmove", { touches: [t(195, 400 - k * 30)], bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true })); });
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible("#drawer"), true, "scrolling isn't a swipe to close");
  // tap the dimmed page
  await page.mouse.click(380, 300);
  await page.waitForSelector("#drawer", { state: "hidden" });
  // Escape
  await page.click("#menuBtn"); await page.waitForSelector("#drawer:not([hidden])");
  await page.keyboard.press("Escape"); await page.waitForSelector("#drawer", { state: "hidden" });
  assert.equal(await page.evaluate(() => scrollY), y0);
  assert.deepEqual(errors, []); await ctx.close();
});

test("every menu destination still works: profile, household, reminders, history, appearance, account, tours, data & backups, sign out", { skip }, async () => {
  const two = [{ id: "hh-1", name: "Ours", role: "owner", budget: RICH }, { id: "hh-2", name: "A very long household name that keeps on going", role: "editor", budget: RICH }];
  const { page, errors, ctx } = await open(null, { init: { households: two, myName: "Bartholomew-Maximilian" }, ...phone(320, 640), storage: ALL_DONE });
  const go = async (act, sel) => { await page.click("#menuBtn"); await page.waitForSelector("#drawer:not([hidden])"); await page.click(`#drawer [data-act="${act}"]`); await page.waitForSelector(sel); };
  await page.click("#menuBtn"); await page.waitForSelector("#drawer:not([hidden])");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll with a long name");
  assert.equal(await page.locator('#drawer [data-switch]').count(), 2, "both households to switch between");
  await shot(page, "drawer-320-long");
  await page.keyboard.press("Escape"); await page.waitForSelector("#drawer", { state: "hidden" });
  for (const [act, sel] of [["profile", "#sheet .prof"], ["household", "#sheet[open]"], ["reminders", "#sheet .rem-switches"], ["history", "#sheet .hist-intro, #sheet .hist-empty"], ["appearance", "#sheet .acc-picker"], ["account", "#setPass"]]) {
    await go(act, sel);
    await page.click('#sheet [data-sheet="close"]'); await page.waitForSelector("#sheet", { state: "hidden" });
  }
  // sub-lists: guided tours and data & backups, with a way back
  await page.click("#menuBtn"); await page.waitForSelector("#drawer:not([hidden])");
  await page.click('#drawer [data-act="tours"]');
  assert.equal(await page.locator("#drawer [data-tour-replay]").count(), 6);
  await page.click('#drawer [data-act="menu-back"]');
  await page.click('#drawer [data-act="data"]');
  for (const a of ["csv", "backup", "import"]) assert.equal(await page.locator(`#drawer [data-act="${a}"]`).count(), 1, a);
  const dl = page.waitForEvent("download"); await page.click('#drawer [data-act="csv"]'); await dl;
  assert.equal(await page.isVisible("#drawer"), false, "choosing something closes the drawer");
  await page.click("#menuBtn"); await page.click('#drawer [data-switch="hh-2"]');
  await page.waitForFunction(() => /A very long household/.test(document.querySelector(".brand-t")?.textContent || ""));
  assert.deepEqual(errors, []); await ctx.close();
});

test("the drawer follows your colour and light/dark", { skip }, async () => {
  for (const scheme of ["light", "dark"]) {
    const { page, ctx } = await open(RICH, { device: { viewport: { width: 390, height: 760 }, colorScheme: scheme }, init: { budget: RICH, meta: { accent: "coral" } }, storage: ALL_DONE });
    await page.click("#menuBtn"); await page.waitForSelector("#drawer:not([hidden])");
    const c = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector("#drawer")).backgroundColor, link: getComputedStyle(document.querySelector(".dr-me-t small")).color, acc: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() }));
    assert.notEqual(c.link, "rgb(47, 107, 79)", "not the default green: your colour");
    if (scheme === "dark") { assert.match(c.bg, /rgb\((2\d|1\d)/, "dark background"); await shot(page, "drawer-dark-coral"); }
    await ctx.close();
  }
});

/* ---------------- bell and notifications ---------------- */
const REM = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, user_id: "u-me", household_id: "hh-1", kind: "review", title: `Reminder ${i + 1}`, body: "Check your balances", tab: "networth", created_at: new Date().toISOString(), read_at: null }));
test("the bell: a plain icon with a 44px tap area; a dot only when something's unread; notifications slide in from the right", { skip }, async () => {
  for (const n of [0, 2]) {
    const { page, errors, ctx } = await open(null, { init: { households: [{ id: "hh-1", name: "Ours", role: "owner", budget: RICH, reminders: REM(n) }] }, ...phone(), storage: ALL_DONE });
    await settle(page);
    const s = await page.evaluate(() => { const b = document.querySelector("#bellBtn"), cs = getComputedStyle(b), r = b.getBoundingClientRect(); return { border: cs.borderTopWidth, bg: cs.backgroundColor, w: r.width, h: r.height }; });
    assert.equal(s.border, "0px", "no box"); assert.match(s.bg, /rgba\(0, 0, 0, 0\)|transparent/); assert.ok(s.w >= 44 && s.h >= 44);
    assert.equal(await page.isVisible("#bellCount"), n > 0, n ? "a dot for unread" : "no dot when nothing's unread");
    await page.click("#bellBtn");
    await page.waitForSelector("#drawer.dr-right:not([hidden])");
    const box = await page.locator("#drawer").boundingBox();
    assert.ok(box.x + box.width >= 389, "from the right");
    if (!n) { assert.match(await page.textContent("#drawer"), /You’re all caught up/); await shot(page, "notifications-empty"); }
    else {
      assert.equal(await page.locator("#drawer .rem-item:not(.read)").count(), 2, "real, unread reminders");
      await shot(page, "notifications");
      await page.click('#drawer [data-rem="readall"]');
      await page.waitForSelector("#bellCount", { state: "hidden" });
      assert.equal(await page.getAttribute("#bellBtn", "aria-label"), "Notifications");
      // swipe right closes it
      await swipe(page, "#drawer", 220);
      await page.waitForSelector("#drawer", { state: "hidden" });
    }
    assert.deepEqual(errors, []); await ctx.close();
  }
});

/* ---------------- my profile and the profile picture ---------------- */
async function pngBuffer(page, w = 600, h = 400) {
  const data = await page.evaluate(([w, h]) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#e07a5f"; x.fillRect(0, 0, w, h); x.fillStyle = "#3d405b"; x.fillRect(w / 3, 0, w / 3, h); return c.toDataURL("image/png"); }, [w, h]);
  return Buffer.from(data.split(",")[1], "base64");
}
test("My profile: add a photo (crop, save), it shows everywhere, survives a reopen, can be replaced and removed", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...phone(), storage: ALL_DONE });
  assert.equal(await page.textContent("#meSlot .av"), "J", "your initial to start with");
  await page.click("#menuBtn"); await page.click('#drawer [data-act="profile"]');
  await page.waitForSelector("#sheet .prof");
  assert.match(await page.textContent("#sheet .prof-email"), /jarden@example\.com/);
  await page.setInputFiles("[data-prof-file]", { name: "me.png", mimeType: "image/png", buffer: await pngBuffer(page) });
  await page.waitForSelector("#cropBox:not([hidden])");
  await page.fill("[data-crop-zoom]", "1.6");
  const c = await page.locator(".prof-canvas").boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await page.mouse.down(); await page.mouse.move(c.x + c.width / 2 + 30, c.y + c.height / 2); await page.mouse.up();
  await shot(page, "profile-crop");
  await page.click('[data-prof="save"]');
  await page.waitForSelector("#sheet .prof .av-img img");
  const calls = await fake(page, () => window.__fake.storageCalls);
  const up = calls.find(x => x.op === "upload");
  assert.match(up.path, /^u-me\/\d+\.jpg$/, "in your own folder"); assert.equal(up.type, "image/jpeg"); assert.ok(up.size < 512 * 1024, `small file (${up.size})`);
  const meta = await fake(page, () => window.__fake.authCalls.filter(c => c.name === "updateUser" && c.data && "avatar" in c.data).map(c => c.data.avatar));
  assert.equal(meta.at(-1), up.path, "your login points at the new file");
  assert.equal(await page.locator("#meSlot img").count(), 1, "the header shows it");
  await page.click('#sheet [data-sheet="close"]');
  await page.click("#menuBtn"); assert.equal(await page.locator("#drawer .dr-me img").count(), 1, "the menu shows it"); await shot(page, "drawer-photo");
  await page.keyboard.press("Escape");
  const files = await fake(page, () => window.__fake.files), path = up.path;
  assert.deepEqual(errors, []); await ctx.close();
  // reopen on another device (no saved copy): it's fetched through a signed link
  const again = await open(RICH, { ...phone(), storage: ALL_DONE, init: { budget: RICH, meta: { avatar: path }, files } });
  await again.page.waitForSelector("#meSlot img");
  assert.ok((await fake(again.page, () => window.__fake.storageCalls)).some(x => x.op === "sign" && x.path === path));
  // replace, then remove
  await again.page.click("#menuBtn"); await again.page.click('#drawer [data-act="profile"]'); await again.page.waitForSelector("#sheet .prof");
  await again.page.setInputFiles("[data-prof-file]", { name: "new.png", mimeType: "image/png", buffer: await pngBuffer(again.page, 300, 900) });
  await again.page.waitForSelector("#cropBox:not([hidden])"); await again.page.click('[data-prof="save"]');
  await again.page.waitForFunction(p => !(p in window.__fake.files) && Object.keys(window.__fake.files).length === 1, path);
  await again.page.click('[data-prof="remove"]'); await again.page.click("#dlgYes");
  await again.page.waitForFunction(() => Object.keys(window.__fake.files).length === 0);
  await again.page.waitForSelector("#meSlot .av:not(.av-img)");
  assert.equal(await again.page.textContent("#meSlot .av"), "J", "your initial is back");
  assert.deepEqual(again.errors, []); await again.ctx.close();
});

test("bad pictures are refused kindly, and a failed upload leaves your picture as it was", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...phone(), storage: ALL_DONE });
  await page.click("#menuBtn"); await page.click('#drawer [data-act="profile"]'); await page.waitForSelector("#sheet .prof");
  await page.setInputFiles("[data-prof-file]", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  assert.match(await page.textContent("#mProf"), /isn’t a picture/);
  await page.setInputFiles("[data-prof-file]", { name: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(6 * 1024 * 1024, 1) });
  assert.match(await page.textContent("#mProf"), /over 5 MB/);
  await page.setInputFiles("[data-prof-file]", { name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not really a jpeg") });
  await page.waitForFunction(() => /couldn’t open that photo/.test(document.querySelector("#mProf").textContent));
  await fake(page, () => { window.__fake.failUpload = 1; });
  await page.setInputFiles("[data-prof-file]", { name: "me.png", mimeType: "image/png", buffer: await pngBuffer(page) });
  await page.waitForSelector("#cropBox:not([hidden])"); await page.click('[data-prof="save"]');
  await page.waitForFunction(() => /previous picture hasn’t changed/.test(document.querySelector("#mProf").textContent));
  assert.equal(await fake(page, () => window.__fake.authCalls.filter(c => c.name === "updateUser" && c.data && "avatar" in c.data).length), 0, "your login wasn't pointed at a missing file");
  assert.equal(await page.locator("#meSlot img").count(), 0);
  assert.equal(await page.isEnabled('[data-prof="save"]'), true, "you can try again");
  assert.deepEqual(errors.filter(e => !/Upload failed/.test(e)), []); await ctx.close();
});

test("before the photo storage is switched on: a clear message, nothing breaks", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...phone(), storage: ALL_DONE, init: { budget: RICH, storageOn: false } });
  await page.click("#menuBtn"); await page.click('#drawer [data-act="profile"]'); await page.waitForSelector("#sheet .prof");
  await page.setInputFiles("[data-prof-file]", { name: "me.png", mimeType: "image/png", buffer: await pngBuffer(page) });
  await page.waitForSelector("#cropBox:not([hidden])"); await page.click('[data-prof="save"]');
  await page.waitForFunction(() => /aren’t switched on yet/.test(document.querySelector("#mProf").textContent));
  assert.equal(await page.textContent("#meSlot .av"), "J");
  assert.deepEqual(errors, []); await ctx.close();
});

/* ---------------- goals ---------------- */
test("on your own with no goals yet: one card, one 'Add a goal'; it asks where the money comes from; nothing moves between pots", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob", ...phone(), storage: ALL_DONE });
  await page.fill('[data-ob="people.0.pay"]', "2000");
  await page.click('[data-obact="next"]'); await page.click('[data-obact="next"]'); await page.waitForSelector(".ob-done"); await page.click('[data-obact="finish"]');
  await page.waitForSelector("#app .b-income");
  await goTab(page, "goals");
  assert.equal(await page.locator("#app [data-goal-new]").count(), 1, "one way to add the first goal");
  assert.match(await page.textContent(".gl-first h3"), /Start saving for something/);
  assert.deepEqual(await page.$$eval(".gl-group > .ex-gh h3", e => e.map(x => x.textContent)), ["Emergency fund", "Goals"], "no empty 'Jarden’s goals' section yet");
  const before = await fake(page, () => JSON.stringify(window.__fake.budget.accounts));
  await page.click(".gl-first-btn");
  await page.waitForSelector("#pop:not([hidden])");
  assert.match(await page.textContent("#pop .pop-h"), /Where should the money come from\?/);
  assert.deepEqual(await page.$$eval("#pop [data-pick-goal] span", e => e.map(x => x.textContent)), ["Goals", "Personal goals"]);
  assert.match(await page.textContent('#pop [data-pick-goal="gj"] small'), /^\$\d[\d,]*\/fn going to it$/);
  await shot(page, "goal-where-from");
  await page.click('#pop [data-pick-goal^="gp:"]');
  await page.waitForSelector('#sheet [data-f="name"]');
  await page.keyboard.type("New bike");
  await page.click('#sheet [data-sheet="close"]'); await settle(page);
  const b = await fake(page, () => window.__fake.budget);
  assert.equal(Object.keys(b.goals.joint).length, 0); assert.equal(Object.values(Object.values(b.goals.personal)[0]).length, 1, "it joined the personal pot");
  assert.equal(JSON.stringify(b.accounts), before, "no allocations changed");
  assert.deepEqual(await page.$$eval(".gl-group > .ex-gh h3", e => e.map(x => x.textContent)), ["Emergency fund", "Goals", "Personal goals"]);
  assert.deepEqual(errors, []); await ctx.close();
});

test("shared households keep joint and each person's goals apart, by name", { skip }, async () => {
  const { page, errors, ctx } = await open(RICH, { ...phone(), storage: ALL_DONE });
  await goTab(page, "goals");
  assert.deepEqual(await page.$$eval(".gl-group > .ex-gh h3", e => e.map(x => x.textContent)), ["Emergency fund", "Joint goals", "Jarden’s goals", "Madi’s goals"]);
  assert.equal(await page.locator(".gl-first").count(), 0, "goals exist: the usual layout");
  assert.deepEqual(errors, []); await ctx.close();
});

/* ---------------- hero cards ---------------- */
test("hero cards: the switch sits on its own above; the label sits right on its number; changing the period never changes pay", { skip }, async () => {
  for (const w of [320, 390, 430]) {
    const { page, errors, ctx } = await open(RICH, { ...phone(w), storage: ALL_DONE });
    for (const [tab, card, num] of [["budget", ".b-income", ".hero-amt"], ["spending", ".sp-sum", ".sp-head"], ["goals", ".gl-sum", ".sp-head"], ["invest", ".iv-hero", ".sp-head"]]) {
      if (tab !== "budget") await goTab(page, tab);
      const g = await page.evaluate(([card, num]) => {
        const c = document.querySelector(card), seg = c.querySelector(".b-row .seg").getBoundingClientRect(), lab = c.querySelector(".b-row .eyebrow").getBoundingClientRect(), n = c.querySelector(num).getBoundingClientRect();
        return { segAbove: seg.bottom <= lab.top, gap: n.top - lab.bottom, segInside: seg.left >= c.getBoundingClientRect().left && seg.right <= c.getBoundingClientRect().right };
      }, [card, num]);
      assert.ok(g.segAbove && g.segInside, `${tab} @${w}: switch above the label, inside the card`);
      assert.ok(g.gap >= -1 && g.gap < 14, `${tab} @${w}: label sits on its number (gap ${g.gap})`);
    }
    if (w === 390) { await goTab(page, "budget"); await shot(page, "hero-budget"); await goTab(page, "goals"); await shot(page, "hero-goals"); }
    await goTab(page, "budget");
    await page.click('.b-income [data-viewas="month"]'); await settle(page);
    const b = await fake(page, () => window.__fake.budget);
    assert.equal(b.viewAs, "month"); assert.deepEqual(Object.values(b.people).map(p => p.freq), ["fortnightly", "fortnightly"], "pay frequencies untouched");
    assert.deepEqual(errors, []); await ctx.close();
  }
});

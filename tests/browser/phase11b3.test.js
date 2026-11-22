import { test } from "node:test";
import assert from "node:assert/strict";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { open, setup, skip, skipAccounts } from "./helpers.js";

setup();

const date = new Date(2026, 10, 23, 12);
const allSeen = Object.fromEntries(["budget", "networth", "spending", "goals", "invest", "progress"].map(tab => [tab, "done"]));
const storage = { "mb-tours-u-me": JSON.stringify({ tabs: allSeen }) };
const household = toStored(migrate(RICH_V3));
const members = [{ user_id: "u-me", display_name: "Maia", email: "maia@example.com", role: "owner" }];

function fixture(budget, snapshots = [], role = "owner") {
  return {
    noAutoSnapshot: true,
    meta: { accent: "custom", accentHex: "#40bfa5", motion: "reduce" },
    households: [{ id: "hh-1", name: "Harbour household", role, budget, members: members.map(m => ({ ...m, role })), snapshots }],
  };
}
function snapshot(id, month, balance) {
  const nw = structuredClone(household.nw);
  nw.accounts.n2.balance = balance;
  return { id, month, kind: "monthly", taken_at: month + "T12:00:00+13:00", taken_by: null,
    data: { version: 4, people: household.people, nw, goals: household.goals } };
}
const snapshots = [snapshot(1, "2026-09-01", 10000), snapshot(2, "2026-10-01", 11000)];
const device = (width, colorScheme) => ({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600, colorScheme });
const signedIn = (hash, waitFor, width, budget = household, role = "owner") => open(null, {
  hash, waitFor, storage, clock: date, init: fixture(budget, snapshots, role), device: device(width, width < 390 ? "dark" : "light"),
});
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

test("Wealth keyboard navigation retains focus and identifies the selected panel", { skip }, async () => {
  const { page, errors, ctx } = await signedIn("wealth/accounts", ".nw-hero", 390);
  const accounts = page.getByRole("tab", { name: "Accounts" });
  const investments = page.getByRole("tab", { name: "Investments" });
  await accounts.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await investments.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Enter");
  await page.locator("#ivChart").waitFor();
  assert.equal(await investments.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator("#wealthPanel").getAttribute("aria-labelledby"), "wealth-tab-invest");
  assert.equal(await page.isVisible("#ivDetails .iv-src"), false);
  await page.getByRole("button", { name: "Edit assumptions" }).click();
  await page.locator("#sheet[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("#sheet").waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "Edit assumptions" }).evaluate(el => el === document.activeElement), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("recorded net worth is separate from current balances, and viewers cannot save or manage household members", { skip }, async () => {
  const { page, errors, ctx } = await signedIn("wealth/history", "#pgNet svg", 390, household, "viewer");
  assert.match(await page.locator(".pg-summary").innerText(), /Change in recorded net worth[\s\S]*\+\$1,000/);
  assert.match(await page.locator("#pgRead").innerText(), /Today · current balances/);
  assert.equal(await page.locator("[data-snap=save]").count(), 0);
  await page.locator("#menuBtn").click();
  await page.locator('#drawer [data-act="household"]').click();
  await page.locator("#sheet .hh-list").waitFor();
  assert.equal(await page.locator("#setHHName, #setInvite, [data-role-for], [data-remove]").count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("all Wealth views and the account editor fit at six widths with enlarged text and large values", { skip }, async () => {
  const budget = structuredClone(household);
  budget.nw.accounts.n1.name = "Everyday account with a long name for the household operating balance";
  budget.nw.accounts.n1.balance = 12345678.91;
  const routes = [
    ["wealth/accounts", ".nw-hero", '[data-edit-nw="n1"]'],
    ["wealth/investments", "#ivChart svg", "[data-iv-edit]"],
    ["wealth/history", "#pgNet svg", null],
  ];
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    for (const [route, waitFor, editor] of routes) {
      const { page, errors, ctx } = await signedIn(route, waitFor, width, budget);
      await page.evaluate(() => { document.documentElement.style.fontSize = "150%"; });
      assert.equal(await fits(page), true, width + " " + route);
      assert.equal(await page.locator("html").getAttribute("data-accent"), "custom");
      const tabHeights = await page.locator(".wl-t").evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
      assert.ok(tabHeights.every(height => height >= 44), width + " Wealth tab targets");
      if (editor) {
        await page.locator(editor).click();
        await page.locator("#sheet[open]").waitFor();
        const overflow = await page.locator("#sheet").evaluate(sheet => {
          if (sheet.scrollWidth <= sheet.clientWidth + 1) return null;
          const right = sheet.getBoundingClientRect().right;
          const offenders = [...sheet.querySelectorAll("*")].filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width && rect.height && rect.right > right + 1;
          }).map(el => [el.tagName, el.className, Math.round(el.getBoundingClientRect().right)]);
          return { width: sheet.clientWidth, content: sheet.scrollWidth, offenders };
        });
        assert.equal(overflow, null, width + " " + route + " sheet " + JSON.stringify(overflow));
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  }
});

test("onboarding labels the required payday and offers the same optional setup and tour", { skip }, async () => {
  const { page, errors, ctx } = await open({}, { waitFor: ".ob", storage, clock: date, device: device(390, "light") });
  await page.fill('[data-ob="people.0.pay"]', "2480");
  await page.locator('[data-obact="next"]').click();
  assert.equal(await page.locator("#obPd0").getAttribute("aria-invalid"), "true");
  await page.fill("#obPd0", "2026-11-12");
  await page.locator('[data-obact="next"]').click();
  await page.locator(".ob-card.st-3").waitFor();
  await page.locator('[data-obact="next"]').click();
  await page.locator(".ob-card.st-4").waitFor();
  assert.ok(await page.locator('[data-obact="acc-exp"]').isVisible());
  await skipAccounts(page);
  const tour = page.getByRole("button", { name: "Show me around" });
  await tour.waitFor();
  assert.equal(await tour.evaluate(el => el.classList.contains("primary")), true);
  assert.ok(await page.getByRole("button", { name: "Open Moni Money" }).isVisible());
  assert.equal(await fits(page), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

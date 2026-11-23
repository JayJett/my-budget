import { test } from "node:test";
import assert from "node:assert/strict";
import { RICH_V3 } from "../fixtures.js";
import { migrate } from "../../js/model/migrate.js";
import { toStored } from "../../js/model/schema.js";
import { ACCENTS } from "../../js/ui/accent-list.js";
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
  await page.waitForFunction(() => document.activeElement?.matches("[data-iv-edit]"));
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
  assert.match(await page.locator(".st-2 .lead").textContent(), /leave income blank for now/);
  assert.match(await page.locator("#obPd0help").textContent(), /required if you enter a pay amount/);
  await page.locator('[data-obact="next"]').click();
  await page.locator(".ob-card.st-3").waitFor();
  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.locator(".ob-card.st-2").waitFor();
  await page.fill('[data-ob="people.0.pay"]', "2480");
  await page.locator('[data-obact="next"]').click();
  assert.equal(await page.locator("#obPd0").getAttribute("aria-invalid"), "true");
  await page.fill("#obPd0", "2026-11-24");
  await page.locator('[data-obact="next"]').click();
  assert.match(await page.locator("#obPd0e").textContent(), /today or earlier/);
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

test("accent names, selection and focus stay usable on phones at up to 200% text", { skip }, async () => {
  for (const width of [320, 375, 390, 430]) {
    const { page, errors, ctx } = await signedIn("home", ".home", width);
    await page.locator("#menuBtn").click();
    await page.getByRole("button", { name: "Appearance" }).click();
    const picker = page.getByRole("radiogroup", { name: "Accent colour" });
    const colour = name => picker.getByRole("radio", { name, exact: true });
    const names = ACCENTS.map(a => a.label).concat("Yours");
    for (const [mode, accent, scale] of [["light", "Indigo", 100], ["dark", "Lavender", 150], ["light", "Yours", 200]]) {
      await page.evaluate(size => { document.documentElement.style.fontSize = size + "%"; }, scale);
      await page.locator(`[data-look="theme"][data-v="${mode}"]`).click();
      await colour(accent).click();
      assert.equal(await page.locator("html").getAttribute("data-theme"), mode);
      assert.equal(await colour(accent).getAttribute("aria-checked"), "true");
      assert.equal(await picker.locator('[aria-checked="true"]').count(), 1);
      assert.notEqual(await colour("Yours").locator(".acc-pill").evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
      for (const name of names) {
        const geometry = await colour(name).evaluate(tile => {
          const label = tile.querySelector(".acc-name"), text = new Range();
          text.selectNode(label.lastChild);
          const box = tile.getBoundingClientRect(), rects = [...text.getClientRects()];
          return { lines: rects.length, fits: rects.every(r => r.left >= box.left && r.right <= box.right), target: box.height >= 44 && box.width >= 44 };
        });
        assert.deepEqual(geometry, { lines: 1, fits: true, target: true }, `${name}, ${width}px, ${scale}%`);
      }
      assert.equal(await page.locator("#sheet").evaluate(sheet => sheet.scrollWidth <= sheet.clientWidth + 1), true);
    }
    assert.ok(await page.getByLabel("Choose your own accent colour").isVisible());
    await colour("Indigo").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await colour("Mint").getAttribute("aria-checked"), "true");
    assert.equal(await colour("Mint").evaluate(el => el.matches(":focus-visible")), true);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test("at narrow widths with enlarged text, navigation labels remain whole and the chart keeps keyboard focus", { skip }, async () => {
  const budget = structuredClone(household);
  budget.nw.accounts.n3.balance = 12_345_678_912.34;
  const { page, errors, ctx } = await signedIn("wealth/investments", "#ivChart svg", 320, budget);
  await page.evaluate(() => { document.documentElement.style.fontSize = "150%"; });
  assert.deepEqual(await page.locator("#tabs .tl, .wl-t span:first-child").evaluateAll(labels => labels.flatMap(label => {
    const range = new Range(); range.selectNodeContents(label);
    const tile = label.closest("button").getBoundingClientRect();
    const rects = [...range.getClientRects()];
    return rects.length === 1 && rects[0].left >= tile.left && rects[0].right <= tile.right ? [] : [label.textContent];
  })), []);
  assert.equal(await fits(page), true);
  const tenYears = page.getByRole("button", { name: "10 years", exact: true });
  await tenYears.focus();
  await page.keyboard.press("Enter");
  assert.equal(await tenYears.getAttribute("aria-pressed"), "true");
  assert.equal(await tenYears.evaluate(button => button === document.activeElement), true);
  assert.match(await page.locator("#ivChart .axis").textContent(), /\$\d+B/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

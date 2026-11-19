import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setup, skip, open, SHOTS } from "./helpers.js";
import { blankBudget, addPerson, toStored } from "../../js/model/schema.js";
import { contrast, accentTokens } from "../../js/ui/palette.js";

setup();
const clock = new Date(2026, 10, 19, 12);
const storage = { "mb-tours-u-me": JSON.stringify({ tabs: Object.fromEntries(["budget","networth","spending","goals","invest","progress"].map(t => [t,"done"])) }) };

function fixture({ shared = false, missingPay = false, missingDate = false, shortfall = false, under = false } = {}) {
  const s = blankBudget({ name:"Maia", mode:shared ? "shared" : "solo" });
  const p = s.people[0], other = shared ? addPerson(s, { name:"Eli" }) : null;
  Object.assign(p, { name:"Maia", pay:missingPay ? 0 : 2480, freq:"fortnightly", payday:missingDate ? "" : "2026-11-12", src:{nw:"every"} });
  if (other) Object.assign(other, { name:"Eli", pay:1920, freq:"monthly", payday:"2026-10-30" });
  const allocations = {
    spending:["Household bills", .42, "bills"], emergency:["Emergency fund", .1, "savings"],
    goals:["Shared goals", .08, "savings"], invest:["Investments", .1, "index"],
  };
  for (const a of s.accounts) {
    if (!allocations[a.role]) continue;
    const [name, share, nw] = allocations[a.role];
    Object.assign(a, { name, split:{[p.id]:share, ...(other ? {[other.id]:share} : {})}, dest:{nw} });
  }
  s.accounts.push({ id:"everyday", name:"Everyday spending", type:"Spending", split:{[p.id]:.24, ...(other ? {[other.id]:.30} : {})}, dest:{nw:"every"} });
  s.accounts.push({ id:"personal", name:"Personal spending", type:"Personal", owner:p.id, split:{[p.id]:under ? .02 : .06} });
  s.nw.accounts = [
    {id:"every",name:"Everyday",type:"Operating",balance:1850},
    {id:"bills",name:"Bills account",type:"Operating",balance:460},
    {id:"savings",name:"Shared savings",type:"Savings",balance:8460},
    {id:"index",name:"Index fund",type:"Investment",balance:17300}
  ];
  s.spend = [{id:"rent",name:"Rent",type:"Fixed",amount:shortfall ? 1500 : 950,period:"Fortnight"}];
  const members = [{ user_id:"u-me", display_name:"Maia", email:"maia@example.com", role:"owner", joined_at:"2026-01-01", person_id:p.id }];
  const budget = toStored(s);
  return { myName:"Maia", meta:{accent:"indigo"}, households:[{id:"hh-1",name:"Harbour household",role:"owner",budget,members}] };
}
const openHome = (init, width = 390, theme = "light", extra = {}) => open(null, {
  init, storage, clock, hash:"home", waitFor:"#homeRoot",
  device:{viewport:{width,height:844},colorScheme:theme,isMobile:width < 600,hasTouch:width < 600}, ...extra
});

test("Home distinguishes zero income, a missing date, shortfalls and unallocated pay", { skip }, async () => {
  for (const [opts, yes, no] of [
    [{missingPay:true}, /No regular pay yet/, /Next payday|\$0\.00/],
    [{missingDate:true}, /No payday set[\s\S]*\$2,480\.00/, /In \d+ days/],
    [{shortfall:true}, /Expenses are over budget[\s\S]*\$458\.40 per fortnight short[\s\S]*Pay fully allocated/, /Expenses are covered/],
    [{under:true}, /Pay still to allocate[\s\S]*\$99\.20 per fortnight/, /Pay fully allocated/]
  ]) {
    const {page,errors,ctx} = await openHome(fixture(opts));
    const text = await page.locator("#homeRoot").innerText();
    assert.match(text, yes); assert.doesNotMatch(text, no);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test("the later payday opens its own amount and private checklist from Home", { skip }, async () => {
  const {page,errors,ctx} = await openHome(fixture({shared:true}));
  assert.match(await page.locator(".ho-pay").innerText(), /\$2,480\.00/);
  const later = page.locator(".ho-group button[data-pb-open]");
  assert.match(await later.innerText(), /Eli[\s\S]*30 Nov/);
  assert.doesNotMatch(await later.innerText(), /\$1,920/);
  await later.click();
  const dialog = page.getByRole("dialog", { name:"Payday Playbook" });
  assert.match(await dialog.locator(".pb-pay").innerText(), /\$1,920\.00[\s\S]*Monthly pay/);
  assert.equal(await dialog.getByRole("checkbox").count(), 0);
  assert.match(await dialog.locator(".pb-progress").innerText(), /private/);
  await page.keyboard.press("Escape");
  assert.equal(await later.evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(errors, []); await ctx.close();
});

test("Playbook disclosures and keyboard focus survive a checklist save", { skip }, async () => {
  const {page,errors,ctx} = await openHome(fixture({shared:true}));
  await page.locator(".ho-pb").click();
  const grouped = page.locator(".pb-parts");
  await grouped.locator("summary").click();
  assert.match(await grouped.innerText(), /Emergency fund[\s\S]*\$248[\s\S]*Shared goals[\s\S]*\$198\.40/);
  const check = page.locator('[data-pb-tick="move:nw:bills"]');
  await check.focus(); await page.keyboard.press("Space");
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-pb-tick="move:nw:bills"]');
    return el?.getAttribute("aria-checked") === "true" && !el.hasAttribute("aria-busy");
  });
  assert.equal(await grouped.evaluate(el=>el.open),true);
  assert.equal(await check.evaluate(el=>el===document.activeElement),true);
  assert.match(await page.locator(".pb-live").innerText(), /1 of 4 marked done/);
  await page.screenshot({ path:join(SHOTS, "11b1-indigo-grouped-checklist.png") });
  assert.deepEqual(errors, []); await ctx.close();
});

test("the Indigo shell and Playbook fit six widths in both themes with an alternate accent and large type", { skip }, async () => {
  const hex = "#A73D70";
  const init = fixture({shared:true});
  init.meta = {accent:"custom",accentHex:hex};
  for (const width of [320,375,390,430,768,1280]) {
    for (const mode of ["light", "dark"]) {
      const {page,errors,ctx} = await openHome(init, width, mode);
      const get = await page.evaluate(() => {
        const r = getComputedStyle(document.documentElement);
        return { accent:r.getPropertyValue("--accent").trim(), canvas:r.getPropertyValue("--ind-canvas").trim(), ink:r.getPropertyValue("--ind-ink").trim(), on:r.getPropertyValue("--on-accent").trim() };
      });
      assert.equal(get.accent, accentTokens(hex)[mode].accent, width+" "+mode);
      assert.ok(contrast(get.accent,get.canvas)>=4.5 && contrast(get.on,get.accent)>=4.5 && contrast(get.ink,get.canvas)>=4.5);
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      const nav = await page.locator("#tabs").boundingBox();
      assert.ok(nav.y+nav.height >= 843, width+" bottom navigation");
      for (const rect of await page.$$eval("#tabs .tab", els => els.map(el=>[el.getBoundingClientRect().width,el.getBoundingClientRect().height]))) {
        assert.ok(rect.every(x=>x>=44), width+" nav targets");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth>innerWidth),false,width+" Home");
      await page.locator(".ho-pb").click();
      await page.getByRole("dialog", {name:"Payday Playbook"}).waitFor();
      assert.equal(await page.locator("#sheet").evaluate(el=>el.scrollWidth>el.clientWidth+1),false,width+" Playbook");
      if (width===390) {
        await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
        await page.screenshot({ path:join(SHOTS, "11b1-custom-"+mode+".png") });
      }
      assert.deepEqual(errors, []); await ctx.close();
    }
  }
});

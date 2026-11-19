import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "../../js/model/migrate.js";
import { toStored, blankBudget } from "../../js/model/schema.js";
import { RICH_V3 } from "../fixtures.js";
import { open, setup, skip, SHOTS } from "./helpers.js";
setup();
const review=process.env.MONI_REVIEW_DIR || join(SHOTS,"11b2");
const money=2480;
const clock=new Date(2026,10,19,12);
const storage={"mb-tours-u-me":JSON.stringify({tabs:Object.fromEntries(["budget","networth","spending","goals","invest","progress"].map(k=>[k,"done"]))})};
function samples(kind){
  const solo=kind==="solo"||kind==="empty";
  const s=solo?blankBudget({name:"Maia",mode:"solo"}):migrate(RICH_V3);
  const p=s.people[0];
  Object.assign(p,{name:"Maia",pay:money,payday:"2026-11-12"});
  if(!solo)Object.assign(s.people[1],{name:"Eli",pay:1920,freq:"monthly",payday:"2026-10-30"});
  if(kind==="solo"){
    const alt=migrate(RICH_V3);
    s.goals.joint=structuredClone(alt.goals.joint);
    s.goals.ef.saved=7200;s.goals.ef.target=12000;
    s.spend=structuredClone(alt.spend);
    s.accounts.forEach(a=>{a.split={[p.id]:a.role==="spending"?.6:.1};});
  }
  if(!solo)s.spend[0].amount=kind==="shortfall"?3000:800;
  if(kind==="large"){
    p.pay=987654.32;
    s.accounts[0].name="Our very long allocation name for everyday household spending and recurring bills";
    s.spend[0].name="A very long recurring expense name for a household insurance policy";
    s.goals.joint[0].name="A very long goal name for the whole household and its planned contributions";
  }
  if(kind==="over"||kind==="under")s.accounts.forEach((a,i)=>{if(!i)a.split[p.id]=kind==="over"?1.5:0;});
  return toStored(s);
}
const cases=[["budget","solo"],["budget","shared"],["budget","over"],["budget","under"],["budget","shortfall"],["expenses","shared"],["expenses","shortfall"],["goals","shared"],["goals","solo"],["goals","empty"]];
const openSample=(hash,kind,dark,width=390)=>open(samples(kind),{clock,hash,storage,waitFor:hash==="budget"?".b-income":hash==="expenses"?".sp-page":".gl-page", device:{viewport:{width,height:844},hasTouch:width<600,isMobile:width<600,colorScheme:dark?"dark":"light"},init:{budget:samples(kind),meta:{accent:"indigo"}}});
async function shot(page,name){
  if(review)await page.screenshot({path:join(review,name+".png"),animations:"disabled"});
}
test("visual review fixtures", {skip},async()=>{
 await mkdir(review,{recursive:true});
 for(const [tab,kind] of cases)for(const dark of [false,true]){
   const {page,ctx,errors}=await openSample(tab,kind,dark);
   const tone=dark?"dark":"light";
   await shot(page,tab+"-"+kind+"-"+tone);
   if(kind==="shared"){
     const selector={budget:"[data-edit-acc]",expenses:"[data-edit-sp]",goals:"[data-edit-goal]"}[tab];
     if(tab==="expenses"){
       const more=page.locator(".sp-detail summary").first();
       if(await more.count()) await more.click();
       await page.locator("#poolsplit").scrollIntoViewIfNeeded();
       await shot(page,"expenses-breakdown-"+tone);
     }
     await page.locator("#app").locator(selector).first().click();
     await page.locator("#sheet .bsheet").waitFor();
     await shot(page,tab+"-sheet-"+tone);
   }
   assert.deepEqual(errors,[]);
   await ctx.close();
 }
});

test("Budget keeps coverage and allocation distinct, with direct access to Rebalance", {skip}, async()=>{
  const {page,ctx,errors}=await openSample("budget","shortfall",false);
  assert.match(await page.locator("#allocStatus").innerText(),/Expenses are over budget/);
  assert.ok(await page.locator(".ind-page-head [data-rb-open]").isVisible());
  const order=await page.evaluate(()=>[".b-income","#allocStatus",".b-allocs",".bs-pay"].map(s=>document.querySelector(s).getBoundingClientRect().top));
  assert.deepEqual(order,[...order].sort((a,b)=>a-b));
  await page.locator(".ind-page-head [data-rb-open]").click();
  await page.locator("#sheet .rb").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".ind-page-head [data-rb-open]").evaluate(e=>e===document.activeElement),true);
  assert.deepEqual(errors,[]);await ctx.close();
});
test("Indigo finance pages fit the mobile and desktop widths, including large text", {skip},async()=>{
 for(const width of [320,375,390,430,768,1280]){
   const {page,ctx,errors}=await openSample("budget","large",width%2===0,width);
   await page.evaluate(()=>{document.documentElement.style.fontSize="150%";});
   for(const [route,selector] of [["budget",".alloc-row"],["spending",".ex-row"],["goals",".gl-card"]]){
     if(route!=="budget"){
       const tab=page.locator('#tabs [data-tab="'+route+'"]');
       const point=await tab.evaluate(el=>{
         const {left,top,width,height}=el.getBoundingClientRect();
         const x=left+width/2, y=top+height/2;
         const target=document.elementFromPoint(x,y);
         return {x,y,reachable:el.contains(target),target:target?.outerHTML.slice(0,150)};
       });
       assert.ok(point.reachable,width+" "+route+" tab hit area "+JSON.stringify(point));
       // Fixed navigation is already visible. Scrolling a fixed element into view
       // can move the mobile visual viewport just after a native dialog closes.
       if(width<600)await page.touchscreen.tap(point.x,point.y);
       else await tab.click();
       await page.locator('#tabs [data-tab="'+route+'"][aria-selected="true"]').waitFor();
     }
     const row=page.locator(selector).first(); await row.waitFor();
     const surface=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
     assert.equal(surface,true,width+" "+route);
     const box=await row.boundingBox(); assert.ok(box.height>=44,width+" "+route+" target");
     await row.click();await page.locator("#sheet .bsheet").waitFor();
     if(await page.locator("#sheet .ind-sheet-details").count()){
       const summary=page.locator("#sheet .ind-sheet-details > summary");
       await summary.focus();await page.keyboard.press("Enter");
       assert.equal(await summary.evaluate(e=>e.parentElement.open),true);
     }
     const overflow = await page.locator("#sheet").evaluate(sheet => {
       if (sheet.scrollWidth <= sheet.clientWidth + 1) return null;
       const bounds = sheet.getBoundingClientRect();
       const right = Math.round(bounds.left + sheet.clientLeft + sheet.clientWidth);
       const elements = [...sheet.querySelectorAll("*")].flatMap(el => {
         const rect = el.getBoundingClientRect();
         if (!rect.width || !rect.height || rect.right <= right + 1 && el.scrollWidth <= el.clientWidth + 1) return [];
         const style = getComputedStyle(el);
         return [{tag:el.tagName, class:el.getAttribute("class"), width:Math.round(rect.width), right:Math.round(rect.right), inner:el.clientWidth, content:el.scrollWidth, position:style.position, overflow:style.overflowX, text:el.textContent.trim().slice(0,90)}];
       });
       return {viewport:innerWidth, width:sheet.clientWidth, content:sheet.scrollWidth, right, elements:elements.slice(0,20)};
     });
     assert.equal(overflow, null, width+" "+route+" sheet "+JSON.stringify(overflow));
     await page.keyboard.press("Escape");
     await page.locator("#sheet").waitFor({state:"hidden"});
     await page.waitForFunction(()=>!document.documentElement.classList.contains("scroll-locked"));
   }
   assert.deepEqual(errors,[]);await ctx.close();
 }
});

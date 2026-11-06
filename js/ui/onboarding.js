/* The setup guide shown when a household's budget is empty: six short screens that end in a
   ready-made budget. The thinking lives in js/model/onboarding.js; this file is just the screens. */
import { app, changed } from "./ctx.js";
import { $, esc, toast } from "./dom.js";
import { fmtNum } from "./inputs.js";
import { PURPOSES, suggestSplit, buildBudget, splitTotal, householdIncome } from "../model/onboarding.js";
import { blankBudget, MAX_PEOPLE } from "../model/schema.js";
import { WORDS, freqToView, perYear } from "../model/periods.js";
import { m0 } from "../model/format.js";
import { n, blank } from "../model/util.js";

const STEPS = ["What it’s for", "Who’s in it", "Pay", "What you have", "Your split", "All set"];
let ans, step, split;

const num = v => { const c = String(v ?? "").replace(/[,$\s]/g, ""); return c === "" || isNaN(Number(c)) ? null : Number(c); };
const money = (key, v, label, ph = "0") => `<label class="ob-field"><span>${esc(label)}</span><span class="unit wide ob-money"><i>$</i><input type="text" inputmode="decimal" autocomplete="off" data-ob="${esc(key)}" data-obt="num" value="${blank(v) ? "" : fmtNum(v)}" placeholder="${ph}"></span></label>`;

export function startSetup() {
  const me = app.members.find(m => m.user_id === app.meId);
  ans = { purpose: null, people: [{ name: (me && me.display_name) || "", pay: null, freq: "fortnightly", payday: "" }], have: { debts: [] }, goal: { name: "", target: null, deadline: "" } };
  step = 0; split = null;
  app.setup = { render: draw };
  document.body.classList.add("setting-up");
}
export function endSetup() { app.setup = null; document.body.classList.remove("setting-up"); }

function skip() {
  endSetup();
  if (!app.hasData) { const me = app.members.find(m => m.user_id === app.meId); app.state = blankBudget({ name: (me && me.display_name) || "" }); }
  app.render();
}

function draw() {
  const el = $("#app");
  const dots = STEPS.map((s, i) => `<li class="${i < step ? "done" : i === step ? "on" : ""}" aria-current="${i === step ? "step" : "false"}"><span>${i + 1}</span>${esc(s)}</li>`).join("");
  el.innerHTML = `<div class="ob">
    <ol class="ob-steps" aria-label="Setup steps">${dots}</ol>
    <div class="ob-card" role="group" aria-labelledby="obTitle">${body()}</div>
    ${step < 5 ? `<p class="ob-skip"><button class="linkish" type="button" data-obact="skip">Skip setup and start with a blank budget</button></p>` : ""}
  </div>`;
  // Put the cursor in the first box so people can just start typing.
  const first = step >= 1 && step <= 3 ? el.querySelector(".ob-card input") : null;
  if (first) first.focus();
}

const nav = (nextLabel = "Next", disabled = false) => `<div class="ob-nav">${step > 0 ? `<button class="btn" type="button" data-obact="back">Back</button>` : "<span></span>"}<button class="btn primary" type="button" data-obact="next"${disabled ? " disabled" : ""}>${nextLabel}</button></div>`;

function body() {
  const P = ans.people;
  if (step === 0) return `<h2 id="obTitle">Hi! What’s this budget for?</h2><p class="lead">Pick the closest one. It just shapes the suggestions you’ll see; you can change anything later.</p>
    <div class="ob-choices">${Object.entries(PURPOSES).map(([k, p]) => `<button type="button" class="ob-choice" data-purpose="${k}" aria-pressed="${ans.purpose === k}"><b>${esc(p.label)}</b><small>${esc(p.blurb)}</small></button>`).join("")}</div>
    ${nav("Next", !ans.purpose)}`;

  if (step === 1) {
    const solo = ans.purpose === "solo";
    return `<h2 id="obTitle">${solo ? "What should we call you?" : "Who’s in this budget?"}</h2><p class="lead">${solo ? "Just your first name is fine." : "Everyone whose pay goes into the plan (up to four). Kids who don’t earn don’t need to be added."}</p>
    <div class="ob-people">${P.map((p, i) => `<div class="ob-row"><label class="ob-field grow"><span>${i === 0 ? "You" : "Person " + (i + 1)}</span><input type="text" autocomplete="${i === 0 ? "given-name" : "off"}" data-ob="people.${i}.name" value="${esc(p.name)}" placeholder="First name"></label>${i > 0 ? `<button class="person-x" type="button" data-obact="rmperson" data-i="${i}" aria-label="Remove ${esc(p.name || "this person")}">×</button>` : ""}</div>`).join("")}</div>
    ${!solo && P.length < MAX_PEOPLE ? `<button class="add" type="button" data-obact="addperson">+ Add someone</button>` : ""}
    ${nav("Next", P.every(p => blank((p.name || "").trim())))}`;
  }

  if (step === 2) return `<h2 id="obTitle">How much does everyone take home?</h2><p class="lead">After tax, and however often it arrives. A recent payday is optional; it lets us spot years with an extra pay.</p>
    <div class="ob-pay">${P.map((p, i) => `<fieldset class="ob-person"><legend>${esc(p.name || "Person " + (i + 1))}</legend>
      <div class="ob-row">${money(`people.${i}.pay`, p.pay, "Take-home pay")}
      <label class="ob-field"><span>Paid</span><select class="freq" data-ob="people.${i}.freq">${[["weekly", "every week"], ["fortnightly", "every fortnight"], ["monthly", "every month"]].map(([v, l]) => `<option value="${v}"${p.freq === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="ob-field"><span>A recent payday <em>(optional)</em></span><input type="date" data-ob="people.${i}.payday" value="${esc(p.payday)}"></label></div></fieldset>`).join("")}</div>
    <p class="ob-hint" data-obk="paytotal">${payTotal()}</p>
    ${nav()}`;

  if (step === 3) {
    const h = ans.have;
    return `<h2 id="obTitle">What do you already have?</h2><p class="lead">Rough numbers are fine, and you can leave anything blank. This fills in your Net worth tab.</p>
    <div class="ob-grid">${money("have.savings", h.savings, "Savings")}${money("have.emergency", h.emergency, "Emergency fund")}${money("have.kiwisaver", h.kiwisaver, "KiwiSaver")}${money("have.investments", h.investments, "Other investments")}</div>
    <h3 class="ob-h3">Anything you owe? <small>Credit cards, loans, mortgage…</small></h3>
    <div class="ob-debts">${(h.debts || []).map((d, i) => `<div class="ob-row"><label class="ob-field grow"><span>What it is</span><input type="text" data-ob="have.debts.${i}.name" value="${esc(d.name)}" placeholder="e.g. Car loan"></label>${money(`have.debts.${i}.balance`, d.balance, "Still owing")}<button class="person-x" type="button" data-obact="rmdebt" data-i="${i}" aria-label="Remove">×</button></div>`).join("")}</div>
    <button class="add" type="button" data-obact="adddebt">+ Add a debt</button>
    ${ans.purpose === "saving" ? `<h3 class="ob-h3">What are you saving for?</h3><div class="ob-grid"><label class="ob-field"><span>Goal</span><input type="text" data-ob="goal.name" value="${esc(ans.goal.name)}" placeholder="e.g. House deposit"></label>${money("goal.target", ans.goal.target, "How much you need")}<label class="ob-field"><span>By when <em>(optional)</em></span><input type="date" data-ob="goal.deadline" value="${esc(ans.goal.deadline)}"></label></div>` : ""}
    ${nav("See my suggested split")}`;
  }

  if (step === 4) {
    split = split || suggestSplit(ans);
    const t = splitTotal(split.buckets);
    return `<h2 id="obTitle">Here’s a suggested starting split</h2><p class="lead">Each payday, ${P.length > 1 ? "everyone puts" : "you put"} these percentages of ${P.length > 1 ? "their own" : "your"} pay into each bucket. Change any number; it’s a starting point, not a rule.</p>
    <ul class="ob-why">${split.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
    <div class="ob-split">${split.buckets.map((b, i) => `<div class="ob-bucket"><div><b>${esc(b.name)}</b>${b.perPerson && P.length > 1 ? ` <small class="dim">(one each)</small>` : ""}<small>${esc(b.help)}</small></div>
      <span class="unit"><input type="number" inputmode="decimal" step="any" min="0" max="100" data-ob="split.${i}" value="${b.pct}" aria-label="${esc(b.name)} percent"><i>%</i></span>
      <span class="ob-amt" data-obk="amt.${i}">${bucketAmount(b)}</span></div>`).join("")}
      <div class="ob-bucket total"><b>Total</b><span class="chip ${Math.round(t * 100) === 10000 ? "ok" : "bad"}" data-obk="total">${fmtNum(t)}%</span><span></span></div></div>
    ${nav("Use this split", Math.round(t * 100) !== 10000)}`;
  }

  return `<h2 id="obTitle">You’re all set${P[0] && P[0].name ? ", " + esc(P[0].name) : ""}!</h2>
    <p class="lead">Your budget is ready, and it’s saved. Everything you entered can be changed on the Budget, Net worth and Goals tabs.</p>
    <ul class="ob-why"><li>Your people, pay and suggested split are on the <b>Budget</b> tab.</li><li>What you already have is on <b>Net worth</b>.</li><li>Your emergency fund${ans.purpose === "saving" && ans.goal.name ? " and " + esc(ans.goal.name) : ""} ${ans.purpose === "saving" && ans.goal.name ? "are" : "is"} on <b>Goals</b>.</li></ul>
    <div class="ob-nav"><button class="btn" type="button" data-obact="finish">Skip the tour</button><button class="btn primary" type="button" data-obact="tour">Show me around (1 minute)</button></div>`;
}

const view = () => freqToView((ans.people[0] || {}).freq || "fortnightly");
function payTotal() {
  const yr = householdIncome(ans.people); if (!yr) return "";
  const v = view();
  return `Together that’s about <b>${m0(yr / perYear(v))}</b> ${WORDS[v].per}, or ${m0(yr)} a year.`;
}
function bucketAmount(b) {
  const yr = householdIncome(ans.people); if (!yr) return "";
  const v = view();
  return `${m0(yr * n(b.pct) / 100 / perYear(v))}${WORDS[v].short}`;
}

function setAns(path, v) {
  const p = path.split("."); let o = ans;
  for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
  o[p[p.length - 1]] = v;
}

function finishBudget() {
  app.state = buildBudget(ans, split, app.today);
  app.hasData = true;
  changed({ full: false });
  step = 5; draw();
  toast("Your budget is saved.");
}

export function initSetupEvents() {
  document.addEventListener("input", e => {
    const el = e.target; if (!app.setup || !el.dataset || el.dataset.ob === undefined) return;
    const key = el.dataset.ob;
    if (key.startsWith("split.")) {
      const b = split.buckets[Number(key.slice(6))]; b.pct = el.value === "" ? 0 : Math.max(0, Number(el.value));
      const t = splitTotal(split.buckets), chip = $('[data-obk="total"]');
      chip.textContent = fmtNum(t) + "%"; chip.className = "chip " + (Math.round(t * 100) === 10000 ? "ok" : "bad");
      const amt = $(`[data-obk="amt.${key.slice(6)}"]`); if (amt) amt.textContent = bucketAmount(b);
      $('[data-obact="next"]').disabled = Math.round(t * 100) !== 10000;
      return;
    }
    setAns(key, el.dataset.obt === "num" ? num(el.value) : el.value);
    if (key.startsWith("people.") || key.startsWith("goal.") || key.startsWith("have.")) split = null; // answers changed → re-suggest
    const tot = $('[data-obk="paytotal"]'); if (tot) tot.innerHTML = payTotal();
    if (step === 1) $('[data-obact="next"]').disabled = ans.people.every(p => blank((p.name || "").trim()));
  });
  document.addEventListener("change", e => { if (app.setup && e.target.dataset && e.target.dataset.ob && e.target.tagName === "SELECT") { const tot = $('[data-obk="paytotal"]'); if (tot) tot.innerHTML = payTotal(); } });
  document.addEventListener("focusout", e => { const el = e.target; if (app.setup && el.dataset && el.dataset.obt === "num") el.value = fmtNum(num(el.value)); });
  document.addEventListener("keydown", e => { if (app.setup && e.key === "Enter" && e.target.matches && e.target.matches(".ob-card input")) { e.preventDefault(); const nx = $('[data-obact="next"]'); if (nx && !nx.disabled) nx.click(); } });
  document.addEventListener("click", e => {
    if (!app.setup) return;
    const ch = e.target.closest("[data-purpose]");
    if (ch) {
      ans.purpose = ch.dataset.purpose; split = null;
      if (ans.purpose === "solo") ans.people = ans.people.slice(0, 1);
      else if (ans.people.length === 1 && ["household", "family"].includes(ans.purpose)) ans.people.push({ name: "", pay: null, freq: "fortnightly", payday: "" });
      draw(); return;
    }
    const b = e.target.closest("[data-obact]"); if (!b) return;
    const act = b.dataset.obact, i = Number(b.dataset.i);
    if (act === "skip") return skip();
    if (act === "back") { step = Math.max(0, step - 1); return draw(); }
    if (act === "next") {
      if (step === 1) ans.people = ans.people.filter((p, k) => k === 0 || !blank((p.name || "").trim()));
      if (step === 4) return finishBudget();
      step++; return draw();
    }
    if (act === "addperson") { if (ans.people.length < MAX_PEOPLE) ans.people.push({ name: "", pay: null, freq: "fortnightly", payday: "" }); draw(); const ins = document.querySelectorAll('[data-ob$=".name"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
    if (act === "rmperson") { ans.people.splice(i, 1); split = null; return draw(); }
    if (act === "adddebt") { ans.have.debts.push({ name: "", balance: null }); draw(); const ins = document.querySelectorAll('[data-ob^="have.debts."][data-ob$=".name"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
    if (act === "rmdebt") { ans.have.debts.splice(i, 1); split = null; return draw(); }
    if (act === "finish" || act === "tour") {
      endSetup(); app.render();
      if (act === "tour") app.startTour();
    }
  });
}

/* Setup (Phase 7B): three short steps from a new household to a first budget.

     Step 1  Make it yours     who's budgeting (just me / with someone / joining), and the household's
                               name. Creating the household is the same reliable create_household path as
                               Phase 7A; that screen lives in ui/auth.js (it comes before there's a budget).
     Step 2  Your income       take-home pay and how often (payday tucked under "More pay details").
                               Optional: leave it blank and set it up later.
     Step 3  Your starting plan  the starter split, as % of pay with the $ it means. Adjust any number.

   Then "Your budget is ready!", shown only once the save has actually reached the database.

   The money thinking is unchanged and lives in js/model/onboarding.js (suggestSplit, buildBudget).
   Savings, KiwiSaver, investments and debts are no longer asked for here: they're filled in later on
   Net worth and Goals. Setup only ever starts for a household whose budget is empty, so it can never
   replace a budget that exists; and if someone else in the household sets theirs up meanwhile, theirs
   is kept and opened. Answers live in memory only (never stored on the device) until they're saved. */
import { app, changed } from "./ctx.js";
import { $, esc, toast } from "./dom.js";
import { fmtNum } from "./inputs.js";
import { suggestSplit, buildBudget, splitTotal, householdIncome } from "../model/onboarding.js";
import { blankBudget, MAX_PEOPLE } from "../model/schema.js";
import { WORDS, freqToView, perYear } from "../model/periods.js";
import { money as fmtMoney } from "../model/format.js";
import { n, blank } from "../model/util.js";
import { HERO } from "./hero-art.js";
import { setThemeColour } from "./auth.js";
import { markTour } from "./tour.js";
import { holdUndoForSetup } from "./history.js";

export const STAGES = ["Make it yours", "Your income", "Your starting plan"];
const FREQS = [["weekly", "Weekly"], ["fortnightly", "Fortnightly"], ["monthly", "Monthly"]];
/** Colours for the starter buckets (fixed, so they never follow the personal accent). */
const BUCKET_COL = { essentials: "var(--c-blue)", fun: "var(--c-coral)", emergency: "var(--c-slate)", goals: "var(--joint)", invest: "var(--invest)", personalGoals: "var(--c-gold)", debt: "var(--bad)" };
const SHORT_HELP = { essentials: "Rent, power, groceries, transport", fun: "Each person’s own spending", emergency: "A safety net for surprises", goals: "Things you’re saving for", invest: "Long-term growth", personalGoals: "Each person’s own savings goals", debt: "Extra debt repayments" };

let ans = null, stage = 2, done = 1, split = null, dir = 1, saving = false, saveErr = "";

/* ---------- the shared look: a small header with the step, and a slim progress bar ----------
   doneCount: how many of the three steps are finished (and saved where that matters). */
export function obHeader(current, doneCount, extra = "") {
  const label = current <= 3 ? `Step ${current} of 3` : "All set";
  const name = current <= 3 ? STAGES[current - 1] : "Your budget is ready";
  return `<header class="ob-top">
    <div class="ob-top-row"><span class="ob-brand"><span class="logo sm" aria-hidden="true">$</span>Moni Money</span>${extra}</div>
    <p class="ob-stage"><b>${label}</b><span>${esc(name)}</span></p>
    <div class="ob-prog" role="progressbar" aria-label="Setup progress" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${doneCount}" aria-valuetext="${doneCount} of 3 steps done"><span style="width:${(doneCount / 3) * 100}%"></span></div>
  </header>`;
}

/* ---------- who's budgeting: chosen on the create-household screen, remembered for this person ----------
   Only the choice (not any money), in this tab's session, keyed to the signed-in person. */
const MODE_KEY = () => `mb-ob-mode-${app.meId}`;
export function rememberMode(mode) { try { sessionStorage.setItem(MODE_KEY(), mode); } catch (_) {} }
function savedMode() { try { return sessionStorage.getItem(MODE_KEY()); } catch (_) { return null; } }

export function startSetup() {
  const me = app.members.find(m => m.user_id === app.meId);
  const md = (app.session && app.session.user && app.session.user.user_metadata) || {};
  const myName = (me && me.display_name) || md.name || (md.full_name || "").trim().split(/\s+/)[0] || "";
  const mode = savedMode() || (app.members.length > 1 ? "with" : "solo");
  ans = { mode, people: [{ name: myName, pay: null, freq: "fortnightly", payday: "" }], needName: !myName };
  stage = 2; done = 1; split = null; dir = 1; saving = false; saveErr = ""; shownStage = 0;
  app.setup = { render: draw };
  document.body.classList.add("setting-up"); setThemeColour(true);
}
export function endSetup() { app.setup = null; document.body.classList.remove("setting-up"); setThemeColour(false); }

/** "Set up later": an empty budget in memory (nothing saved, nothing invented), straight into the app. */
function skip() {
  endSetup();
  if (!app.hasData) {
    // the empty budget is saved together with your first edit: that first save is the starting point, not an undo
    holdUndoForSetup(); const me = app.members.find(m => m.user_id === app.meId); app.state = blankBudget({ name: (me && me.display_name) || (ans && ans.people[0].name) || "" }); }
  app.render();
  window.scrollTo({ top: 0 });
}

/* ---------- drawing ----------
   The page has two parts: the small header (step, progress bar) and the card for the current step.
   Moving between steps keeps the header and swaps only the card, so the progress bar glides to its
   new width, and the old card slides out as the new one slides in (the browser's own View
   Transitions where it has them; elsewhere the new card simply eases in). With "reduce motion" on,
   the step changes straight away. Nothing waits on an animation: the new step is drawn at once. */
let shownStage = 0;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function header(shell) {
  const tmp = document.createElement("div");
  tmp.innerHTML = obHeader(stage, done, stage <= 3 ? `<button class="linkish ob-later" type="button" data-obact="skip">Set up later</button>` : "");
  const fresh = tmp.firstElementChild, old = shell.querySelector(".ob-top");
  old.querySelector(".ob-top-row").replaceWith(fresh.querySelector(".ob-top-row"));
  old.querySelector(".ob-stage").replaceWith(fresh.querySelector(".ob-stage"));
  const bar = old.querySelector(".ob-prog"), nb = fresh.querySelector(".ob-prog");
  ["aria-valuenow", "aria-valuetext"].forEach(a => bar.setAttribute(a, nb.getAttribute(a)));
  bar.firstElementChild.style.width = nb.firstElementChild.style.width; // the bar's width eases (CSS)
}
function draw() {
  const el = $("#app"), html = body(), moved = shownStage !== stage;
  let shell = el.querySelector(":scope > .ob");
  const swap = () => {
    if (!shell) { el.innerHTML = `<div class="ob im"><div class="ob-in-wrap">${obHeader(stage, done, "")}<div class="ob-card" role="group" aria-labelledby="obTitle"></div></div></div>`; shell = el.firstElementChild; }
    header(shell);
    const card = shell.querySelector(".ob-card");
    card.className = `ob-card st-${stage}`; card.innerHTML = html;
    // Tell screen readers where they are, without popping up the keyboard
    const h = $("#obTitle"); if (h && moved) h.focus({ preventScroll: true });
    if (moved) { window.scrollTo({ top: 0 }); shell.scrollTop = 0; }
  };
  const animate = shell && moved && shownStage && !calm();
  shownStage = stage;
  if (animate && document.startViewTransition) {
    document.documentElement.dataset.obDir = dir < 0 ? "back" : "fwd";
    try { document.startViewTransition(swap); return; } catch (_) { /* fall through: draw it plainly */ }
  }
  swap();
  if (animate) { const c = shell.querySelector(".ob-card"); c.classList.add("ob-in"); if (dir < 0) c.classList.add("back"); }
}

const nav = (next, { disabled = false, back = true, cls = "" } = {}) => `<div class="ob-nav">${back ? `<button class="btn ob-back" type="button" data-obact="back">Back</button>` : ""}<button class="btn primary ${cls}" type="button" data-obact="next"${disabled ? " disabled" : ""}>${next}</button></div>`;
const choice = (value, title, blurb, icon, checked) => `<label class="ob-opt"><input type="radio" name="obmode" value="${value}"${checked ? " checked" : ""}><span class="ob-opt-ic" aria-hidden="true">${icon}</span><span class="ob-opt-t"><b>${title}</b><small>${blurb}</small></span><span class="ob-tick" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg></span></label>`;
export const ICONS = {
  solo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="5.2" r="2.6"/><path d="M3 13.8a5 5 0 0 1 10 0"/></svg>',
  with: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="5.6" cy="5.4" r="2.2"/><circle cx="11" cy="6" r="1.8"/><path d="M1.8 13.6a3.8 3.8 0 0 1 7.6 0M9.4 10.4a3 3 0 0 1 4.8 2.6"/></svg>',
  join: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1.6"/><path d="M2.4 4.2L8 8.6l5.6-4.4"/></svg>',
};
export const modeChoices = (cur, withJoin) => `<fieldset class="ob-opts"><legend class="sr-only">Who’s budgeting</legend>
  ${choice("solo", "Just me", "A budget for one", ICONS.solo, cur === "solo")}
  ${choice("with", "With someone", "Shared with a partner or family", ICONS.with, cur === "with")}
  ${withJoin ? choice("join", "Joining a household", "Someone has invited you", ICONS.join, cur === "join") : ""}</fieldset>`;

function body() {
  const P = ans.people;
  if (stage === 1) return `<div class="ob-art" aria-hidden="true">${HERO.together()}</div><h2 id="obTitle" tabindex="-1">Let’s make this yours</h2><p class="lead">Are you budgeting on your own or with someone else?</p>
    ${modeChoices(ans.mode, false)}
    <p class="ob-hint">${app.household ? `Your household: <b>${esc(app.household.name)}</b>. You can rename it or invite people in Household settings.` : ""}</p>
    ${nav("Continue", { back: false })}`;

  if (stage === 2) return `<div class="ob-art" aria-hidden="true">${HERO.jar()}</div><h2 id="obTitle" tabindex="-1">Let’s start with your income</h2><p class="lead">How much do you usually take home after tax?</p>
    ${ans.needName ? `<label class="ob-field"><span>Your first name</span><input type="text" data-ob="people.0.name" value="${esc(P[0].name)}" autocomplete="given-name" placeholder="First name"></label>` : ""}
    ${P.map((p, i) => payBlock(p, i)).join("")}
    ${ans.mode === "with" && P.length < MAX_PEOPLE ? `<button class="add-row ob-add" type="button" data-obact="addperson">+ Add ${P.length > 1 ? "someone else’s" : "their"} pay too <small>optional</small></button>` : ""}
    <p class="ob-hint">You can change this anytime, or leave it blank for now.</p>
    ${nav("Continue")}`;

  if (stage === 3) {
    split = split || suggestSplit({ purpose: P.length > 1 ? "household" : "solo", people: P, have: {} });
    const yr = householdIncome(P), t = splitTotal(split.buckets), v = view();
    return `<h2 id="obTitle" tabindex="-1">Here’s your starting plan</h2><p class="lead">A simple way to divide ${P.length > 1 ? "everyone’s" : "your"} pay. Change anything you like.</p>
    <div class="ob-sum">
      <div><small>${P.length > 1 ? "Your pay together" : "Your pay"}</small><b>${yr ? `${fmtMoney(yr / perYear(v), true)}<i>${WORDS[v].short}</i>` : "Not added yet"}</b></div>
      <div><small>Planned</small><b data-obk="tot">${fmtNum(t)}%</b></div>
    </div>
    <div class="split ob-bar" data-obk="bar" aria-hidden="true">${barHTML()}</div>
    ${yr ? "" : `<p class="ob-note">Add your income to see what each part is in dollars. <button class="linkish" type="button" data-obact="back">Add income</button></p>`}
    <ul class="ob-buckets">${split.buckets.map((b, i) => `<li style="--bc:${BUCKET_COL[b.key] || "var(--faint)"}">
      <span class="ob-b-dot" aria-hidden="true"></span>
      <span class="ob-b-name"><b>${esc(b.name)}</b><small>${esc(SHORT_HELP[b.key] || b.help)}${b.perPerson && P.length > 1 ? " · one each" : ""}</small></span>
      <span class="unit ob-pct"><input type="text" inputmode="decimal" data-ob="split.${i}" value="${fmtNum(b.pct)}" aria-label="${esc(b.name)}, percent of pay"><i>%</i></span>
      <span class="ob-b-amt" data-obk="amt.${i}">${bucketAmount(b)}</span></li>`).join("")}</ul>
    ${saveErr ? `<p class="msg err" role="alert">${esc(saveErr)}</p>` : ""}
    <div class="ob-foot"><p class="ob-status" data-obk="status" aria-live="polite">${statusHTML(t)}</p>
    ${nav(saving ? "Saving your budget…" : saveErr ? "Try again" : "Use this plan", { disabled: saving || Math.round(t * 100) !== 10000 })}</div>
    <p class="ob-skip"><button class="linkish" type="button" data-obact="skip">Start with a blank budget instead</button></p>`;
  }

  // Step 4: saved. The picture and words sit in the middle; the two choices sit where "Continue" was.
  const first = (P[0].name || "").trim();
  return `<div class="ob-done"><div class="ob-done-mid">
      <div class="ob-done-art" aria-hidden="true">${HERO.grow()}<span class="ob-done-ic"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg></span></div>
      <h2 id="obTitle" tabindex="-1">Your budget is ready${first ? `, ${esc(first)}` : ""}!</h2>
      <p class="lead">It’s saved. You can adjust everything whenever you like, and add your accounts and goals when you’re ready.</p></div>
    <div class="ob-done-acts"><button class="btn primary block" type="button" data-obact="finish">Open my budget</button>
    <button class="btn ghost block" type="button" data-obact="tour">Show me around</button></div></div>`;
}

function payBlock(p, i) {
  const other = i > 0;
  return `<section class="ob-pay" aria-label="${other ? esc(p.name || "Their") + " pay" : "Your pay"}">
    ${other ? `<div class="ob-pay-h"><label class="ob-field grow"><span>Their first name</span><input type="text" data-ob="people.${i}.name" value="${esc(p.name)}" autocomplete="off" placeholder="First name"></label><button class="icon-x" type="button" data-obact="rmperson" data-i="${i}" aria-label="Remove ${esc(p.name || "this person")}">×</button></div>`
      : ans.people.length > 1 ? `<p class="ob-who">${esc(p.name || "You")}</p>` : ""}
    <label class="ob-amount"><span class="sr-only">${other ? "Their" : "Your"} take-home pay</span><span class="ob-cur" aria-hidden="true">$</span><input type="text" inputmode="decimal" autocomplete="off" data-ob="people.${i}.pay" data-obt="num" value="${blank(p.pay) ? "" : fmtNum(p.pay)}" placeholder="0"></label>
    <div class="seg seg-radio ob-freq" role="radiogroup" aria-label="How often">${FREQS.map(([v, l]) => `<label><input type="radio" name="freq${i}" value="${v}" data-ob="people.${i}.freq"${p.freq === v ? " checked" : ""}><span>${l}</span></label>`).join("")}</div>
    <details class="ob-more"${p.payday ? " open" : ""}><summary>More pay details</summary>
      <label class="ob-field"><span>A recent payday <em>(optional)</em></span><input type="date" data-ob="people.${i}.payday" value="${esc(p.payday)}"></label>
      <small class="ob-small">Lets the app spot years with an extra payday.</small></details>
  </section>`;
}

const view = () => freqToView((ans.people[0] || {}).freq || "fortnightly");
function bucketAmount(b) {
  const yr = householdIncome(ans.people); if (!yr) return "";
  const v = view();
  return `${fmtMoney(yr * n(b.pct) / 100 / perYear(v), true)}<small>${WORDS[v].short}</small>`;
}
function barHTML() {
  const t = Math.max(100, splitTotal(split.buckets));
  return split.buckets.map(b => `<span style="width:${n(b.pct) / t * 100}%;background:${BUCKET_COL[b.key] || "var(--faint)"}"></span>`).join("");
}
/** Change the bar's widths in place, so each part glides to its new size. */
function syncBar() {
  const bar = $('[data-obk="bar"]'); if (!bar) return;
  const t = Math.max(100, splitTotal(split.buckets)), parts = bar.children;
  if (parts.length !== split.buckets.length) { bar.innerHTML = barHTML(); return; }
  split.buckets.forEach((b, i) => { parts[i].style.width = `${n(b.pct) / t * 100}%`; });
}
function statusHTML(t) {
  const r = Math.round(t * 100) / 100;
  if (Math.round(t * 100) === 10000) return `<span class="chip ok">✓ All planned</span>`;
  return r < 100 ? `<span class="chip warn">${fmtNum(Math.round((100 - r) * 100) / 100)}% left to plan</span>` : `<span class="chip bad">${fmtNum(Math.round((r - 100) * 100) / 100)}% over</span>`;
}

const num = v => { const c = String(v ?? "").replace(/[,$\s]/g, ""); return c === "" || isNaN(Number(c)) ? null : Number(c); };
function setAns(path, v) {
  const p = path.split("."); let o = ans;
  for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
  o[p[p.length - 1]] = v;
}
function go(to) { dir = to > stage ? 1 : -1; stage = to; draw(); }

/* ---------- saving: only "ready" once the database has it ---------- */
async function finishBudget() {
  if (saving) return;
  // Someone else in the household set the budget up while you were here: keep theirs, open it.
  const server = app.store && app.store.serverCopy();
  if (server && server.version && server.people && Object.keys(server.people).length) {
    endSetup(); toast("Someone in your household has already set up this budget, so we’ve opened it.");
    app.reloadHouseholds(app.household.id); return;
  }
  saving = true; saveErr = ""; draw();
  holdUndoForSetup(); // the plan becomes the budget's starting point, not something Undo can take back
  ans.people.forEach(p => { p.name = (p.name || "").trim(); });
  app.state = buildBudget({ purpose: ans.people.length > 1 ? "household" : "solo", people: ans.people, have: {} }, split, app.today);
  app.hasData = true;
  changed({ full: false });
  try { await app.store.flushNow(); } catch (_) {}
  saving = false;
  if (app.saveStatus === "saved") { done = 3; stage = 4; dir = 1; draw(); return; }
  if (app.saveStatus === "offline") { done = 3; stage = 4; draw(); toast("Saved on this device. It’ll sync when you’re back online."); return; }
  saveErr = "We couldn’t save your budget yet. Check your connection and try again.";
  draw();
}

export function initSetupEvents() {
  document.addEventListener("input", e => {
    const el = e.target; if (!app.setup || !el.dataset || el.dataset.ob === undefined) return;
    const key = el.dataset.ob;
    if (key.startsWith("split.")) {
      const i = Number(key.slice(6)), b = split.buckets[i];
      const v = num(el.value); b.pct = v === null ? 0 : Math.max(0, v);
      const t = splitTotal(split.buckets);
      $('[data-obk="tot"]').textContent = fmtNum(t) + "%";
      $('[data-obk="status"]').innerHTML = statusHTML(t);
      syncBar();
      const amt = $(`[data-obk="amt.${i}"]`); if (amt) amt.innerHTML = bucketAmount(b);
      const nx = $('[data-obact="next"]'); if (nx && !saving) nx.disabled = Math.round(t * 100) !== 10000;
      return;
    }
    if (el.type === "radio" && !el.checked) return;
    setAns(key, el.dataset.obt === "num" ? num(el.value) : el.value);
    // Pay, how often, payday or a name changed: the plan's percentages (including any you changed) stay;
    // only the dollars, worked out from the new pay, change. Adding or removing a person redoes the plan.
  });
  // Money boxes: tidy the number only when you leave the box (commas are fine while typing), so the
  // cursor never jumps and selecting the old amount then typing replaces it
  document.addEventListener("focusout", e => { const el = e.target; if (app.setup && el.dataset && el.dataset.obt === "num") el.value = blank(num(el.value)) ? "" : fmtNum(num(el.value)); });
  document.addEventListener("keydown", e => {
    if (!app.setup || e.key !== "Enter" || !e.target.matches || !e.target.matches(".ob-card input:not([type=radio])")) return;
    e.preventDefault(); const nx = $('[data-obact="next"]'); if (nx && !nx.disabled) nx.click();
  });
  document.addEventListener("change", e => {
    if (!app.setup || e.target.name !== "obmode") return;
    ans.mode = e.target.value; rememberMode(ans.mode);
  });
  document.addEventListener("click", e => {
    if (!app.setup) return;
    const b = e.target.closest("[data-obact]"); if (!b || b.disabled) return;
    const act = b.dataset.obact, i = Number(b.dataset.i);
    if (act === "skip") return skip();
    if (act === "back") return go(Math.max(1, stage - 1));
    if (act === "next") {
      if (stage === 1) { if (ans.mode === "solo") { ans.people = ans.people.slice(0, 1); split = null; } return go(2); }
      if (stage === 2) {
        ans.people = ans.people.filter((p, k) => k === 0 || !blank((p.name || "").trim()) || n(p.pay) > 0);
        done = Math.max(done, 2); return go(3);
      }
      if (stage === 3) return finishBudget();
    }
    if (act === "addperson") {
      if (ans.people.length < MAX_PEOPLE) ans.people.push({ name: "", pay: null, freq: ans.people[0].freq, payday: "" });
      split = null; draw();
      const ins = document.querySelectorAll('[data-ob$=".name"]'); if (ins.length) ins[ins.length - 1].focus();
      return;
    }
    if (act === "rmperson") { ans.people.splice(i, 1); split = null; return draw(); }
    if (act === "finish" || act === "tour") {
      // "Show me around" is the Budget tour; "Open my budget" counts as having been offered it
      if (act === "finish") markTour("budget", "offered");
      endSetup(); app.render(); window.scrollTo({ top: 0 });
      if (act === "tour") app.startTour("budget");
    }
  });
}

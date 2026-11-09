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
import { app, changed, TAB_HASH } from "./ctx.js";
import { $, esc, toast } from "./dom.js";
import { fmtNum } from "./inputs.js";
import { suggestSplit, buildBudget, splitTotal, householdIncome } from "../model/onboarding.js";
import { blankBudget, MAX_PEOPLE, isShared, nextPos } from "../model/schema.js";
import { WORDS, freqToView, perYear } from "../model/periods.js";
import { money as fmtMoney } from "../model/format.js";
import { n, blank, uid, ymd } from "../model/util.js";
import { nwType, nwIcon } from "./views/networth.js";
import { HERO } from "./hero-art.js";
import { setThemeColour } from "./auth.js";
import { markTour } from "./tour.js";
import { holdUndoForSetup } from "./history.js";
import { calm } from "./motion.js";
import { feedback } from "./feedback.js";
import { accentSwatchesHTML, lookSeg, THEMES } from "./accent.js";

export const STAGES = ["Make it yours", "Your income", "Your starting plan", "Your accounts"];
const STEPS = STAGES.length; // Phase 9A: four steps, the last one optional
const FREQS = [["weekly", "Weekly"], ["fortnightly", "Fortnightly"], ["monthly", "Monthly"]];
/** Colours for the starter buckets (fixed, so they never follow the personal accent). */
const BUCKET_COL = { essentials: "var(--c-blue)", fun: "var(--c-coral)", emergency: "var(--c-slate)", goals: "var(--joint)", invest: "var(--invest)", personalGoals: "var(--c-gold)", debt: "var(--bad)" };
const SOLO_HELP = { fun: "Your own money to spend", goals: "Everything you’re saving for" };
const SHORT_HELP = { essentials: "Rent, power, groceries, transport", fun: "Each person’s own spending", emergency: "A safety net for surprises", goals: "Things you’re saving for", invest: "Long-term growth", personalGoals: "Each person’s own savings goals", debt: "Extra debt repayments" };

let ans = null, stage = 2, done = 1, split = null, dir = 1, saving = false, saveErr = "";

/* ---------- the shared look: a small header with the step, and a slim progress bar ----------
   doneCount: how many of the three steps are finished (and saved where that matters). */
export function obHeader(current, doneCount, extra = "") {
  const label = current <= STEPS ? `Step ${current} of ${STEPS}` : "All set";
  const name = current <= STEPS ? STAGES[current - 1] + (current === 4 ? " (optional)" : "") : "Your budget is ready";
  return `<header class="ob-top">
    <div class="ob-top-row"><span class="ob-brand"><span class="logo sm" aria-hidden="true">$</span>Moni Money</span>${extra}</div>
    <p class="ob-stage"><b>${label}</b><span>${esc(name)}</span></p>
    <div class="ob-prog" role="progressbar" aria-label="Setup progress" aria-valuemin="0" aria-valuemax="${STEPS}" aria-valuenow="${doneCount}" aria-valuetext="${doneCount} of ${STEPS} steps done"><span style="width:${(doneCount / STEPS) * 100}%"></span></div>
  </header>`;
}

/* ---------- who's budgeting: chosen on the create-household screen, remembered for this person ----------
   Only the choice (not any money), in this tab's session, keyed to the signed-in person. */
const MODE_KEY = () => `mb-ob-mode-${app.meId}`;
export function rememberMode(mode) { try { sessionStorage.setItem(MODE_KEY(), mode); } catch (_) {} }
function savedMode() { try { return sessionStorage.getItem(MODE_KEY()); } catch (_) { return null; } }
/** Step 1's choice as the plan's mode (Phase 8): "Just me" → a solo plan, "With someone" → a shared one,
    however many people's pay has been added so far. */
const planOf = () => ans && ans.mode === "solo" ? { mode: "solo", purpose: "solo" } : { mode: "shared", purpose: "household" };

/* ---------- Step 4: your accounts (Phase 9A) ----------
   Optional. Accounts typed here are kept on this device (this tab only) until you press Save, so a
   refresh brings the step back with them; each has its id from the start, so saving twice can't add
   it twice. They're saved like the plan itself: one whole-budget save marked as the setup, so Undo
   never offers to take them away. Skipping saves nothing and invents nothing. */
const ACC_KEY = () => `mb-ob-accounts-${app.household ? app.household.id : "x"}`;
let accs = [], accForm = null, accErr = "";
const keepAccs = () => { try { sessionStorage.setItem(ACC_KEY(), JSON.stringify(accs)); } catch (_) {} };
const dropAccs = () => { try { sessionStorage.removeItem(ACC_KEY()); } catch (_) {} };
/** After a refresh: accounts started on step 4 but not yet saved (null when there's nothing to resume). */
export function pendingAccounts() { try { const v = JSON.parse(sessionStorage.getItem(ACC_KEY()) || "null"); return Array.isArray(v) ? v : null; } catch (_) { return null; } }
/** Re-open step 4 (the budget itself is already saved). */
export function resumeAccounts(list) {
  startSetup(); ans.people = app.state.people.map(p => ({ name: p.name, pay: p.pay, freq: p.freq, payday: p.payday }));
  accs = list || []; stage = 4; done = 3; shownStage = 0;
}

export function startSetup() {
  accs = []; accForm = null; accErr = "";
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

function accountsStep(P) {
  const S = app.state, shared = isShared(S) && S.people.length > 0, v = x => fmtMoney(x, true);
  const rows = accs.map((a, k) => {
    const t = nwType(a.type), owner = shared && a.owner ? (S.people.find(p => p.id === a.owner) || {}).name : shared ? "Shared" : "";
    return `<li class="ob-acc"><button class="ob-acc-row" type="button" data-obact="acc-edit" data-i="${k}" aria-label="Edit ${esc(a.name)}">
      <span class="ex-ic" style="--cat:${t.col}" aria-hidden="true">${nwIcon(a.type)}</span>
      <span class="ob-acc-t"><b>${esc(a.name)}</b><small>${esc(t.label)}${owner ? ` · ${esc(owner)}` : ""}</small></span>
      <span class="ob-acc-v${a.type === "Debt" ? " owed" : ""}">${a.balance === null ? "No balance" : v(a.balance)}${a.type === "Debt" && a.balance !== null ? "<small>owed</small>" : ""}</span></button>
      <button class="ob-acc-x" type="button" data-obact="acc-rm" data-i="${k}" aria-label="Remove ${esc(a.name)}">✕</button></li>`;
  }).join("");
  const own = accs.filter(a => a.type !== "Debt").reduce((s, a) => s + n(a.balance), 0), owe = accs.filter(a => a.type === "Debt").reduce((s, a) => s + n(a.balance), 0);
  const totals = accs.length ? `<div class="ob-sum ob-acc-sum"><div><small>You have</small><b>${v(own)}</b></div><div><small>You owe</small><b>${v(owe)}</b></div><div><small>Net worth</small><b>${v(own - owe)}</b></div></div>` : "";
  const form = accForm ? accFormHTML(shared) : `<button class="add-row ob-add" type="button" data-obact="acc-add">+ Add ${accs.length ? "another" : "an"} account</button>`;
  return `${accs.length || accForm ? "" : `<div class="ob-art" aria-hidden="true">${HERO.jar()}</div>`}<h2 id="obTitle" tabindex="-1">Let’s add your accounts</h2>
    <p class="lead">Add what you have and what you owe. You can always do this later.</p>
    ${rows ? `<ul class="ob-accs">${rows}</ul>` : ""}${totals}${form}
    ${accErr ? `<p class="msg err" role="alert">${esc(accErr)}</p>` : ""}
    ${accForm ? "" : `<div class="ob-nav">${accs.length ? `<button class="btn ob-back" type="button" data-obact="acc-skip">Skip for now</button><button class="btn primary" type="button" data-obact="next"${saving ? " disabled" : ""}>${saving ? "Saving…" : accErr ? "Try again" : `Save ${accs.length === 1 ? "account" : `${accs.length} accounts`}`}</button>`
      : `<button class="btn primary block" type="button" data-obact="acc-skip">Skip for now</button>`}</div>`}`;
}
const ACC_TYPES = ["Operating", "Savings", "Investment", "Super", "Debt"];
function accFormHTML(shared) {
  const f = accForm, S = app.state, me = myPersonId();
  return `<form class="ob-acc-form" data-acc-form novalidate>
    <label class="ob-field"><span>Name</span><input type="text" data-acc="name" value="${esc(f.name)}" placeholder="e.g. Everyday account" maxlength="60" autocomplete="off"></label>
    <fieldset class="ob-field"><legend>Type</legend><div class="seg seg-radio wrap ob-acc-types">${ACC_TYPES.map(k => `<label><input type="radio" name="obacctype" value="${k}"${f.type === k ? " checked" : ""}><span>${esc(nwType(k).label)}</span></label>`).join("")}</div></fieldset>
    <label class="ob-field"><span>${f.type === "Debt" ? "Amount owed" : "Balance"}</span><span class="ob-amount ob-acc-amt"><span class="ob-cur" aria-hidden="true">$</span><input type="text" inputmode="decimal" data-acc="balance" value="${f.balance === null || f.balance === undefined ? "" : fmtNum(f.balance)}" placeholder="0" autocomplete="off"></span></label>
    ${shared ? `<label class="ob-field"><span>Whose account</span><select data-acc="owner"><option value="">Shared</option>${S.people.map(p => `<option value="${esc(p.id)}"${(f.owner ?? me) === p.id ? " selected" : ""}>${esc(p.name || "Unnamed")}</option>`).join("")}</select></label>` : ""}
    ${f.type === "Savings" ? `<p class="ob-hint">Just the account’s balance. If some of it is for your emergency fund or a goal, you can say so later on Goals; it’s never counted twice.</p>` : ""}
    ${f.err ? `<p class="msg err" role="alert">${esc(f.err)}</p>` : ""}
    <div class="ob-nav"><button class="btn ob-back" type="button" data-obact="acc-cancel">Cancel</button><button class="btn primary" type="button" data-obact="acc-keep">${f.k === null ? "Add" : "Done"}</button></div></form>`;
}
/** Which person in the budget is you (by your name), for "Whose account". */
function myPersonId() {
  const nm = (app.members.find(m => m.user_id === app.meId) || {}).display_name || (ans && ans.people[0] && ans.people[0].name) || "";
  const p = app.state.people.find(x => nm && (x.name || "").trim().toLowerCase() === nm.trim().toLowerCase());
  return p ? p.id : (isShared(app.state) ? "" : (app.state.people[0] || {}).id);
}
function readForm() {
  const f = accForm, root = document.querySelector("[data-acc-form]"); if (!root) return;
  f.name = (root.querySelector('[data-acc="name"]').value || "").trim();
  const raw = (root.querySelector('[data-acc="balance"]').value || "").replace(/[,$\s]/g, "");
  f.balance = raw === "" ? null : Number(raw);
  const o = root.querySelector('[data-acc="owner"]'); if (o) f.owner = o.value;
  const t = root.querySelector('input[name="obacctype"]:checked'); if (t) f.type = t.value;
}
function accountAct(act, i) {
  if (saving) return;
  accErr = "";
  if (act === "acc-add") { accForm = { k: null, name: "", type: "Operating", balance: null, owner: undefined }; draw(); focusName(); return; }
  if (act === "acc-edit") { const a = accs[i]; if (!a) return; accForm = { k: i, ...a }; draw(); focusName(); return; }
  if (act === "acc-rm") { accs.splice(i, 1); keepAccs(); draw(); return; }
  if (act === "acc-cancel") { accForm = null; draw(); return; }
  if (act === "acc-keep") {
    readForm(); const f = accForm;
    if (!f.name) { f.err = "Give the account a name."; draw(); focusName(); return; }
    if (f.balance !== null && (!Number.isFinite(f.balance) || f.balance < 0)) { f.err = f.type === "Debt" ? "Enter what you owe as a positive number." : "Enter the balance as a number (0 or more)."; draw(); return; }
    if (accs.some((a, k) => k !== f.k && a.name.trim().toLowerCase() === f.name.toLowerCase()) || app.state.nw.accounts.some(a => (a.name || "").trim().toLowerCase() === f.name.toLowerCase())) { f.err = "You already have an account with that name. Goals find accounts by name, so give each a different one."; draw(); focusName(); return; }
    const shared = isShared(app.state);
    const a = { id: f.k === null ? uid() : accs[f.k].id, name: f.name, type: f.type, balance: f.balance, ...(shared ? { owner: f.owner === undefined ? myPersonId() || null : f.owner || null } : {}) };
    if (f.k === null) accs.push(a); else accs[f.k] = a;
    accForm = null; keepAccs(); draw(); return;
  }
  if (act === "acc-skip") { dropAccs(); accs = []; done = 4; stage = 5; dir = 1; draw(); return; }
}
const focusName = () => setTimeout(() => { const el = document.querySelector('[data-acc="name"]'); if (el) el.focus(); }, 30);
async function saveAccounts() {
  if (saving) return;
  if (!accs.length) return accountAct("acc-skip");
  saving = true; accErr = ""; draw();
  const L = app.state.nw.accounts, have = new Set(L.map(a => a.id));
  accs.forEach(a => { if (!have.has(a.id)) L.push({ id: a.id, name: a.name, type: a.type, balance: a.balance, ...("owner" in a ? { owner: a.owner } : {}), pos: nextPos(L) }); });
  if (accs.some(a => a.balance !== null)) app.state.nw.reviewed = ymd(app.today); // balances just entered: as good as reviewed today
  holdUndoForSetup(); // part of setting up: not something Undo takes back
  changed({ full: false });
  try { await app.store.flushNow(); } catch (_) {}
  saving = false;
  if (app.saveStatus === "saved" || app.saveStatus === "offline") {
    dropAccs(); done = 4; stage = 5; dir = 1; draw(); feedback("success");
    if (app.saveStatus === "offline") toast("Saved on this device. It’ll sync when you’re back online.");
    return;
  }
  accErr = "We couldn’t save your accounts yet. They’re still here: check your connection and try again.";
  draw();
}

/** "Set up later": an empty budget in memory (nothing saved, nothing invented), straight into the app. */
function skip() {
  endSetup();
  if (!app.hasData) {
    // the empty budget is saved together with your first edit: that first save is the starting point, not an undo
    holdUndoForSetup(); const me = app.members.find(m => m.user_id === app.meId); app.state = blankBudget({ name: (me && me.display_name) || (ans && ans.people[0].name) || "", mode: planOf().mode }); }
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
    card.className = `ob-card st-${stage}${stage === 1 && lookOpen ? " look-open" : ""}`; card.innerHTML = html;
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

/* Phase 8: "Make it look like yours": optional, folded into one link until wanted. Your colour and
   light/dark are personal (saved to your login, never to the budget), so choosing them here adds
   nothing to the household's history or Undo. These setup screens stay dark; your choice of light or
   dark shows once you're in. */
let lookOpen = false;
const LOOK_DOTS = ["#7FD4A8", "#7FB9F2", "#B9A6F5", "#F4A285"];
const lookPart = () => `<div class="ob-look"><button class="linkish ob-look-btn" type="button" data-obact="look" aria-expanded="${lookOpen}" aria-controls="obLook"><span class="ob-look-dots" aria-hidden="true">${LOOK_DOTS.map(c => `<i style="background:${c}"></i>`).join("")}</span>Make it look like yours <small class="dim">optional</small></button>
  <div class="ob-look-body" id="obLook"${lookOpen ? "" : " hidden"}>${accentSwatchesHTML()}${lookSeg("theme", THEMES, "Light, dark or auto")}</div></div>`;

function body() {
  const P = ans.people;
  if (stage === 1) return `<div class="ob-art" aria-hidden="true">${HERO.together()}</div><h2 id="obTitle" tabindex="-1">Let’s make this yours</h2><p class="lead">Are you budgeting on your own or with someone else?</p>
    ${modeChoices(ans.mode, false)}
    ${lookPart()}
    <p class="ob-hint">${app.household ? `Your household: <b>${esc(app.household.name)}</b>. You can rename it or invite people in Household settings.` : ""}</p>
    ${nav("Continue", { back: false })}`;

  if (stage === 2) return `<div class="ob-art" aria-hidden="true">${HERO.jar()}</div><h2 id="obTitle" tabindex="-1">Let’s start with your income</h2><p class="lead">How much do you usually take home after tax?</p>
    ${ans.needName ? `<label class="ob-field"><span>Your first name</span><input type="text" data-ob="people.0.name" value="${esc(P[0].name)}" autocomplete="given-name" placeholder="First name"></label>` : ""}
    ${P.map((p, i) => payBlock(p, i)).join("")}
    ${ans.mode === "with" && P.length < MAX_PEOPLE ? `<button class="add-row ob-add" type="button" data-obact="addperson">+ Add ${P.length > 1 ? "someone else’s" : "their"} pay too <small>optional</small></button>` : ""}
    <p class="ob-hint">You can change this anytime, or leave it blank for now.</p>
    ${nav("Continue")}`;

  if (stage === 3) {
    split = split || suggestSplit({ ...planOf(), people: P, have: {} });
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
      <span class="ob-b-name"><b>${esc(b.name)}</b><small>${esc((split.mode === "solo" && SOLO_HELP[b.key]) || SHORT_HELP[b.key] || b.help)}${b.perPerson && P.length > 1 ? " · one each" : ""}</small></span>
      <span class="unit ob-pct"><input type="text" inputmode="decimal" data-ob="split.${i}" value="${fmtNum(b.pct)}" aria-label="${esc(b.name)}, percent of pay"><i>%</i></span>
      <span class="ob-b-amt" data-obk="amt.${i}">${bucketAmount(b)}</span></li>`).join("")}</ul>
    ${saveErr ? `<p class="msg err" role="alert">${esc(saveErr)}</p>` : ""}
    <div class="ob-foot"><p class="ob-status" data-obk="status" aria-live="polite">${statusHTML(t)}</p>
    ${nav(saving ? "Saving your budget…" : saveErr ? "Try again" : "Use this plan", { disabled: saving || Math.round(t * 100) !== 10000 })}</div>
    ${split.mode === "shared" && P.length === 1 ? `<p class="ob-hint ob-shared-hint">The shared parts are ready for whoever joins you. Add their pay later in the Budget tab.</p>` : ""}
    <p class="ob-skip"><button class="linkish" type="button" data-obact="skip">Start with a blank budget instead</button></p>`;
  }

  if (stage === 4) return accountsStep(P);

  // Done. The picture and words sit in the middle; the two choices sit where "Continue" was.
  const first = (P[0].name || "").trim(), withAccs = (app.state.nw.accounts || []).length > 0;
  return `<div class="ob-done"><div class="ob-done-mid">
      <div class="ob-done-art" aria-hidden="true">${HERO.grow()}<span class="ob-done-ic"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg></span></div>
      <h2 id="obTitle" tabindex="-1">Your budget is ready${first ? `, ${esc(first)}` : ""}!</h2>
      <p class="lead">${withAccs ? "Your plan and accounts are saved. You can change anything whenever you like." : "Your plan is saved. Add your accounts any time in Wealth, and your goals when you’re ready."}</p></div>
    <div class="ob-done-acts"><button class="btn primary block" type="button" data-obact="finish">Open Moni Money</button>
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
  app.state = buildBudget({ ...planOf(), people: ans.people, have: {} }, split, app.today);
  app.hasData = true;
  changed({ full: false });
  try { await app.store.flushNow(); } catch (_) {}
  saving = false;
  if (app.saveStatus === "saved") { done = 3; stage = 4; dir = 1; keepAccs(); draw(); feedback("success"); return; }
  if (app.saveStatus === "offline") { done = 3; stage = 4; keepAccs(); draw(); toast("Saved on this device. It’ll sync when you’re back online."); return; }
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
    e.preventDefault(); const nx = $(accForm ? '[data-obact="acc-keep"]' : '[data-obact="next"]'); if (nx && !nx.disabled) nx.click();
  });
  document.addEventListener("change", e => {
    if (app.setup && e.target.name === "obacctype" && accForm) { readForm(); draw(); const r = document.querySelector(`input[name="obacctype"][value="${accForm.type}"]`); if (r) r.focus(); return; }
    if (!app.setup || e.target.name !== "obmode") return;
    if (ans.mode !== e.target.value) split = null; // a different plan for a different choice
    ans.mode = e.target.value; rememberMode(ans.mode);
  });
  document.addEventListener("click", e => {
    if (!app.setup) return;
    const b = e.target.closest("[data-obact]"); if (!b || b.disabled) return;
    const act = b.dataset.obact, i = Number(b.dataset.i);
    if (act === "skip") return skip();
    if (act === "look") {
      lookOpen = !lookOpen; b.setAttribute("aria-expanded", String(lookOpen));
      const body = document.getElementById("obLook"); if (body) body.hidden = !lookOpen;
      const card = b.closest(".ob-card"); if (card) card.classList.toggle("look-open", lookOpen);
      return;
    }
    if (act === "back") { if (stage === 4) return; return go(Math.max(1, stage - 1)); } // the plan is saved: step 4 doesn't go back into it
    if (act && act.startsWith("acc-")) return accountAct(act, i);
    if (act === "next") {
      if (stage === 1) { if (ans.mode === "solo") { ans.people = ans.people.slice(0, 1); split = null; } return go(2); }
      if (stage === 2) {
        ans.people = ans.people.filter((p, k) => k === 0 || !blank((p.name || "").trim()) || n(p.pay) > 0);
        done = Math.max(done, 2); return go(3);
      }
      if (stage === 3) return finishBudget();
      if (stage === 4) return saveAccounts();
    }
    if (act === "addperson") {
      if (ans.people.length < MAX_PEOPLE) ans.people.push({ name: "", pay: null, freq: ans.people[0].freq, payday: "" });
      split = null; draw();
      const ins = document.querySelectorAll('[data-ob$=".name"]'); if (ins.length) ins[ins.length - 1].focus();
      return;
    }
    if (act === "rmperson") { ans.people.splice(i, 1); split = null; return draw(); }
    if (act === "finish" || act === "tour") {
      // "Show me around" is the Budget tour; "Open Moni Money" (Phase 9A: to Home) counts as having been offered it
      if (act === "finish") markTour("budget", "offered");
      dropAccs(); endSetup();
      const to = act === "tour" ? "budget" : "home"; app.tab = to; history.replaceState(null, "", "#" + TAB_HASH[to]);
      app.render(); window.scrollTo({ top: 0 });
      if (act === "tour") app.startTour("budget");
    }
  });
}

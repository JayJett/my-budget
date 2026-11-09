/* Budget tab: editing sheets (an allocation, or a person's pay), reorder mode, and which insight
   sections are open.

   The sheets contain the very same boxes the old table had (data-l / data-i / data-f), so typing in
   them goes through the usual input handler in events.js: it updates app.state, recalculates, and
   saves change by change, exactly as before. There's no Save button because nothing is held back.
   Adding, removing, recolouring and reordering also use the existing handlers. */
import { app, changed, readOnly } from "./ctx.js";
import { $, esc } from "./dom.js";
import { K, attrs, fmtNum, pc } from "./inputs.js";
import { COLOUR_KEYS, PERSON_COLOURS, roleNote, isShared, addPerson, MAX_PEOPLE } from "../model/schema.js";
import { WORDS } from "../model/periods.js";
import { addRow } from "./events.js";
import { BILL_PERIODS } from "../model/periods.js";
import { tipq } from "./inputs.js";
import { SP_TYPES, typeIcon } from "./views/spending.js";
import { NW_TYPES, nwIcon, nwType } from "./views/networth.js";
import { goalSheet, goalGroups } from "./views/goals.js";
import { investSheet } from "./views/invest.js";
import { itemIcon, iconPickerHTML, appearanceHTML, pickerOpen } from "./icons.js";
import { OBJECT_COLOURS, isObjectColour } from "./palette.js";
import { accIcon } from "./views/budget.js";
import { list } from "./render.js";
import { openPop, closePop } from "./dom.js";
import { money } from "../model/format.js";
import { blank } from "../model/util.js";

// sheet: { kind: "acc" | "person" | "sp" | "nw" | "goal", id, tab, l (goal list key) }; fresh: a row just added (removed again if left blank)
const UI = { reorder: false, reorderTab: null, open: new Set(), sheet: null, fresh: null };
/** What the Budget and Spending views need to know: reorder mode is per tab. */
export const budgetUI = () => ({ reorder: UI.reorder && UI.reorderTab === app.tab, open: UI.open });

const FREQ_OPTS = [["weekly", "a week"], ["fortnightly", "a fortnight"], ["monthly", "a month"]];
const TYPES = ["Joint", "Personal", "Investment"];
const dis = () => readOnly() ? " disabled" : "";

/* ---------- the sheet ---------- */
function show(title, body) {
  const d = $("#sheet");
  d.innerHTML = `<div class="sheet-head"><h3 tabindex="-1" autofocus>${esc(title)}</h3><button class="btn small primary" type="button" data-sheet="close">Done</button></div><div class="sheet-body bsheet">${body}</div>`;
  if (!d.open) d.showModal();
}
const isOurs = () => $("#sheet").open && !!$("#sheet .bsheet");

/** Type: Joint / Personal / Investment. On your own there's nothing to share, so the choice is just
    everyday money or investing (an older "Joint" allocation still shows as it is). The stored value is
    the same field as always, so the Budget, Goals and Investments maths are unchanged. */
function typeField(a, S) {
  const solo = !isShared(S);
  const opts = solo ? [["Personal", "Everyday money"], ...(a.type === "Joint" ? [["Joint", "Joint"]] : []), ["Investment", "Investing"]] : TYPES.map(t => [t, t]);
  if (solo && a.type && !opts.some(([v]) => v === a.type)) opts.push([a.type, a.type]);
  return `<fieldset class="bs-field"><legend>${solo ? "Kind" : "Type"}</legend><div class="seg seg-radio">${opts.map(([t, l]) => `<label><input type="radio" name="type-${esc(a.id)}" value="${esc(t)}" ${attrs("acc", a.id, "type", "text")}${a.type === t ? " checked" : ""}${dis()}><span>${esc(l)}</span></label>`).join("")}</div></fieldset>`;
}

function accountSheet(a) {
  const S = app.state, P = S.people, multi = P.length > 1, w = WORDS[S.viewAs];
  const ownerOpts = [["", "Shared"], ...P.map(p => [p.id, p.name || "Unnamed"])];
  const showOwner = multi && a.type === "Personal" && a.role !== "personalGoals";
  return `<div class="bs-hero"><span class="a-ic big" data-k="acc.${esc(a.id)}.ic" aria-hidden="true">${accIcon(a)}</span><div><div class="bs-amt">${K(`acc.${a.id}.t`)}</div><small>${esc(w.per)}${multi ? ", from everyone" : ""}</small></div></div>
    <label class="bs-field"><span>Name</span><input class="bs-in" type="text" ${attrs("acc", a.id, "name", "text")} value="${esc(a.name)}" placeholder="e.g. Groceries account" autocomplete="off"${dis()}></label>
    ${a.role ? `<p class="bs-note">${esc(roleNote(a.role, S))}</p>` : ""}
    ${typeField(a, S)}
    ${showOwner ? `<label class="bs-field"><span>Whose account</span><select class="bs-in" ${attrs("acc", a.id, "owner", "text")}${dis()}>${ownerOpts.map(([v, l]) => `<option value="${esc(v)}"${v === (a.owner || "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>` : ""}
    <div class="bs-field"><span class="bs-label">${multi ? "Share of each person’s pay" : "Share of your pay"}</span>
      <ul class="bs-shares">${P.map(p => `<li class="${pc(p)}">
        <span class="bs-who">${multi ? `<span class="av sm">${esc((p.name || "?").charAt(0).toUpperCase())}</span>${esc(p.name || "Unnamed")}` : "Your pay"}</span>
        <span class="unit person"><input type="number" step="any" inputmode="decimal" ${attrs("acc", a.id, `split.${p.id}`, "pct")} value="${a.split[p.id] == null ? "" : +(a.split[p.id] * 100).toFixed(4)}" aria-label="${esc(p.name || "Their")} percent of pay to ${esc(a.name || "this account")}"${dis()}><i>%</i></span>
        <span class="bs-val">${K(`acc.${a.id}.v.${p.id}`)}</span>
        <small class="bs-sub">${multi ? esc(p.name || "Unnamed") + ": " : ""}${K(`tot.p.${p.id}`)} of pay allocated in total</small></li>`).join("")}</ul></div>
    ${appearanceHTML({ l: "acc", id: a.id, icon: a.icon, def: accIcon({ ...a, icon: null }), colour: a.colour, colours: OBJECT_COLOURS, defColour: app.colours[a.id] && !isObjectColour(a.colour) ? app.colours[a.id] : "var(--faint)", disabled: readOnly() })}
    ${!a.role && !readOnly() ? `<button class="btn danger-soft block" type="button" data-del="acc" data-i="${esc(a.id)}">Delete allocation</button>` : ""}`;
}

const PERIOD_LABEL = { Week: "Weekly", Fortnight: "Fortnightly", Month: "Monthly", Year: "Yearly" };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function expenseSheet(x) {
  const S = app.state, w = WORDS[S.viewAs], types = SP_TYPES.map(t => t.key), cat = (SP_TYPES.find(t => t.key === x.type) || { col: "var(--faint)" }).col;
  if (x.type && !types.includes(x.type)) types.push(x.type); // keep any older type as it is
  const periods = BILL_PERIODS.includes(x.period) || !x.period ? BILL_PERIODS : [x.period, ...BILL_PERIODS];
  const yearly = x.type === "Sinking" && x.period === "Year";
  const sinking = x.type !== "Sinking" ? "" : !yearly
    ? `<p class="bs-note">To track a due month and how much is set aside, make this a yearly bill.</p>`
    : `<div class="bs-two">
        <label class="bs-field"><span>Due ${tipq("The month the bill lands. The app works out how much you should have set aside by now.")}</span>
          <select class="bs-in" ${attrs("sp", x.id, "due", "month")}${dis()}><option value="">Pick a month</option>${MONTH_NAMES.map((m, k) => `<option value="${k + 1}"${x.due === k + 1 ? " selected" : ""}>${m}</option>`).join("")}</select></label>
        <label class="bs-field"><span>Set aside so far</span><span class="unit wide"><i>$</i><input type="text" inputmode="decimal" ${attrs("sp", x.id, "aside", "num")} value="${fmtNum(x.aside)}" aria-label="Set aside so far"${dis()}></span></label></div>
      <div class="sk-box">${K(`sp.${x.id}.sk`, "chip")}<p>${K(`sp.${x.id}.sk2`)}</p>
        <div class="ex-prog big" aria-hidden="true"><span data-k="sp.${esc(x.id)}.bar"></span></div><small>${K(`sp.${x.id}.saved`)}</small></div>`;
  return `<div class="bs-hero"><span class="ex-ic big" style="--cat:${isObjectColour(x.colour) ? `var(--o-${x.colour})` : cat}" aria-hidden="true">${itemIcon(x.icon) || typeIcon(x.type)}</span><div><div class="bs-amt">${K(`sp.${x.id}.v`)}</div><small>${esc(w.per)}${K(`sp.${x.id}.pb`)}</small></div></div>
    <label class="bs-field"><span>Name</span><input class="bs-in" type="text" ${attrs("sp", x.id, "name", "text")} value="${esc(x.name)}" placeholder="e.g. Groceries" autocomplete="off"${dis()}></label>
    <fieldset class="bs-field"><legend>Type ${tipq(SP_TYPES.map(t => `${t.key}: ${t.help}`).join(" "))}</legend><div class="seg seg-radio">${types.map(t => `<label><input type="radio" name="sptype-${esc(x.id)}" value="${esc(t)}" ${attrs("sp", x.id, "type", "text")}${x.type === t ? " checked" : ""}${dis()}><span>${esc(t)}</span></label>`).join("")}</div></fieldset>
    <div class="bs-field"><span class="bs-label">Cost ${tipq(`Enter it however it’s billed. It’s converted to an amount ${w.per}, so everything adds up.`)}</span>
      <div class="bs-pay"><span class="unit wide"><i>$</i><input type="text" inputmode="decimal" ${attrs("sp", x.id, "amount", "num")} value="${fmtNum(x.amount)}" aria-label="Amount"${dis()}></span>
        <select class="bs-in" ${attrs("sp", x.id, "period", "text")} aria-label="How often it’s billed"${dis()}>${periods.map(p => `<option value="${esc(p)}"${p === x.period ? " selected" : ""}>${esc(PERIOD_LABEL[p] || p)}</option>`).join("")}</select></div>
      <small class="bs-sub">${K(`sp.${x.id}.about`)}</small></div>
    ${sinking}
    <label class="bs-field"><span>Notes</span><textarea class="bs-in" rows="2" ${attrs("sp", x.id, "notes", "text")} placeholder="Optional"${dis()}>${esc(x.notes || "")}</textarea></label>
    ${iconPickerHTML("sp", x.id, x.icon, typeIcon(x.type), readOnly(), { colour: x.colour, colours: OBJECT_COLOURS, defColour: cat })}
    ${readOnly() ? "" : `<button class="btn danger-soft block" type="button" data-del="sp" data-i="${esc(x.id)}">Delete expense</button>`}`;
}

/** Goals whose Saved money is tagged to this account (matched by name, the same way the totals are). */
export const goalsIn = a => blank(a.name) ? [] : [app.state.goals.ef, ...app.state.goals.joint, ...Object.values(app.state.goals.personal).flat()].filter(g => !blank(g.name) && g.account === a.name);

function networthSheet(a) {
  const t = nwType(a.type), types = NW_TYPES.map(x => x.key), linked = goalsIn(a);
  if (a.type && !types.includes(a.type)) types.push(a.type); // keep any older type as it is
  const savings = a.type === "Savings" && !blank(a.name);
  const goalBox = !savings ? `<p class="bs-note">${K(`nw.${a.id}.st`, "chip")}</p>`
    : `<div class="sk-box nw-em-box"><div class="nw-em-figs"><span><small>For goals</small><b>${K(`nw.${a.id}.em`)}</b></span><span><small>Not earmarked</small><b>${K(`nw.${a.id}.buf`)}</b></span></div>
        <div class="ex-prog big nw-em" aria-hidden="true"><span data-k="nw.${esc(a.id)}.bar"></span></div>${K(`nw.${a.id}.st`, "chip")}
        ${linked.length ? `<details class="more"><summary>${linked.length === 1 ? "1 goal uses" : `${linked.length} goals use`} this account</summary><ul class="nw-goals">${linked.map(g => `<li><span>${esc(g.name)}</span><b>${money(Number(g.saved) || 0)}</b></li>`).join("")}</ul>
          <p class="bs-note">Change which account a goal uses on the Goals tab.</p></details>` : `<p class="bs-note">No goals use this account yet. Pick it as a goal’s account on the Goals tab.</p>`}</div>`;
  return `<div class="bs-hero"><span class="ex-ic big" style="--cat:${isObjectColour(a.colour) ? `var(--o-${a.colour})` : t.col}" aria-hidden="true">${itemIcon(a.icon) || nwIcon(a.type)}</span><div><div class="bs-amt">${K(`nw.${a.id}.v`)}</div><small>${esc(t.label)}${a.type === "Debt" ? ", owed" : ""}</small></div></div>
    <label class="bs-field"><span>${a.type === "Debt" ? "Amount owed" : "Balance"}</span><span class="unit wide nw-bal"><i>$</i><input type="text" inputmode="decimal" ${attrs("nw", a.id, "balance", "num")} value="${fmtNum(a.balance)}" aria-label="${a.type === "Debt" ? "Amount owed" : "Balance"}"${dis()}></span>
      <small class="bs-sub">${a.type === "Debt" ? "Enter what you owe as a positive number. It’s taken off your assets." : "What’s in the account right now, from your banking app."}</small></label>
    <label class="bs-field"><span>Name</span><input class="bs-in" type="text" ${attrs("nw", a.id, "name", "text")} value="${esc(a.name)}" placeholder="e.g. Everyday account" autocomplete="off"${dis()}>
      <small class="bs-sub">Goals find this account by its name, so give each account a different one.</small></label>
    <fieldset class="bs-field"><legend>Type ${tipq(NW_TYPES.map(x => `${x.key}: ${x.help}`).join(" "))}</legend><div class="seg seg-radio wrap">${types.map(k => `<label><input type="radio" name="nwtype-${esc(a.id)}" value="${esc(k)}" ${attrs("nw", a.id, "type", "text")}${a.type === k ? " checked" : ""}${dis()}><span>${esc(nwType(k).label)}</span></label>`).join("")}</div>
      <small class="bs-sub">${esc(t.help)}</small></fieldset>
    ${isShared(app.state) ? `<label class="bs-field"><span>Whose account</span><select class="bs-in" ${attrs("nw", a.id, "owner", "text")}${dis()}><option value=""${a.owner ? "" : " selected"}>Shared</option>${app.state.people.map(p => `<option value="${esc(p.id)}"${a.owner === p.id ? " selected" : ""}>${esc(p.name || "Unnamed")}</option>`).join("")}</select><small class="bs-sub">Just a label: it doesn’t change any totals.</small></label>` : ""}
    ${goalBox}
    ${appearanceHTML({ l: "nw", id: a.id, icon: a.icon, def: nwIcon(a.type), colour: a.colour, colours: OBJECT_COLOURS, defColour: t.col, disabled: readOnly() })}
    ${readOnly() ? "" : `<button class="btn danger-soft block" type="button" data-del="nw" data-i="${esc(a.id)}">Delete account</button>`}`;
}

function personSheet(p) {
  const S = app.state, multi = S.people.length > 1;
  return `<div class="bs-hero ${pc(p)}"><span class="av lg">${esc((p.name || "?").charAt(0).toUpperCase())}</span><div><div class="bs-amt">${K(`inc.${p.id}.v`)}</div><small>${esc(WORDS[S.viewAs].per)}</small></div></div>
    <label class="bs-field"><span>Name</span><input class="bs-in" type="text" ${attrs("pp", p.id, "name", "text")} value="${esc(p.name)}" placeholder="Their name" autocomplete="off"${dis()}></label>
    <div class="bs-field"><span class="bs-label">Take-home pay</span>
      <div class="bs-pay"><span class="unit wide"><i>$</i><input type="text" inputmode="decimal" ${attrs("pp", p.id, "pay", "num")} value="${fmtNum(p.pay)}" aria-label="Pay, after tax"${dis()}></span>
        <select class="bs-in" ${attrs("pp", p.id, "freq", "text")} aria-label="How often they’re paid"${dis()}>${FREQ_OPTS.map(([v, l]) => `<option value="${v}"${v === p.freq ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <small class="bs-sub">${K(`inc.${p.id}.sub`)}</small></div>
    <label class="bs-field"><span>A recent payday</span><input class="bs-in" type="date" ${attrs("pp", p.id, "payday", "date")} value="${esc(p.payday)}"${dis()}></label>
    <p class="bs-note">${K(`p27.${p.id}`, "p27")}</p>
    <div class="bs-field"><span class="bs-label">Colour in charts</span>
      <div class="swatches" role="group" aria-label="Colour">${COLOUR_KEYS.map(k => `<button type="button" class="swatch-btn pc-${k}" data-colour="${k}" data-i="${esc(p.id)}" aria-pressed="${k === p.colour}" aria-label="${PERSON_COLOURS[k].label}"${dis()}></button>`).join("")}</div>
      ${(() => { const twin = S.people.find(o => o.id !== p.id && o.colour === p.colour); return twin ? `<small class="bs-sub pc-twin">${esc(twin.name || "Someone else")} uses ${esc(PERSON_COLOURS[p.colour].label.toLowerCase())} too. A different colour makes the charts easier to read, but it’s up to you.</small>` : ""; })()}</div>
    ${multi && !readOnly() ? `<button class="btn danger-soft block" type="button" data-rmperson="${esc(p.id)}">Remove ${esc(p.name || "this person")}</button>` : ""}`;
}

/** Draw (or redraw) the open sheet from the current budget, keeping the cursor where it was. */
function draw() {
  const s = UI.sheet; if (!s) return;
  const S = app.state, item = s.kind === "inv" ? S.invest : (s.kind === "goal" ? list(s.l) || [] : s.kind === "acc" ? S.accounts : s.kind === "sp" ? S.spend : s.kind === "nw" ? S.nw.accounts : S.people).find(x => x.id === s.id);
  if (!item || app.tab !== s.tab) { close(); return; } // deleted (here or by someone else), or left the tab
  const ae = document.activeElement, keep = ae && ae.closest && ae.closest("#sheet") && ae.dataset && ae.dataset.f ? { l: ae.dataset.l, i: ae.dataset.i, f: ae.dataset.f, v: ae.type === "radio" ? ae.value : null, s: ae.selectionStart } : null;
  const y = $("#sheet").scrollTop;
  const title = item.name || { acc: "New allocation", sp: "New expense", nw: "New account", goal: "New goal", person: "Person" }[s.kind];
  show(s.kind === "inv" ? "Assumptions" : title, s.kind === "inv" ? investSheet() : s.kind === "goal" ? goalSheet(s.l, item) : s.kind === "acc" ? accountSheet(item) : s.kind === "sp" ? expenseSheet(item) : s.kind === "nw" ? networthSheet(item) : personSheet(item));
  $("#sheet").scrollTop = y;
  if (keep) {
    const sel = `#sheet [data-l="${CSS.escape(keep.l)}"][data-i="${CSS.escape(keep.i)}"][data-f="${CSS.escape(keep.f)}"]${keep.v ? `[value="${CSS.escape(keep.v)}"]` : ""}`;
    const el = $(sel); if (el) { el.focus({ preventScroll: true }); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.s); } catch (_) {} }
  }
}
function close() { UI.sheet = null; const d = $("#sheet"); if (d.open && d.querySelector(".bsheet")) d.close(); }

function openSheet(kind, id, focusName) {
  pickerOpen.v = false; UI.sheet = { kind, id, tab: app.tab }; draw(); app.refresh();
  if (focusName) { const el = $(`#sheet [data-f="name"]`); if (el) el.focus(); }
}
export const openExpenseSheet = (id, o = {}) => openSheet("sp", id, o.focusName);
export const openNetWorthSheet = (id, o = {}) => openSheet("nw", id, o.focusName);
export function openGoalSheet(l, id, { focusName } = {}) {
  pickerOpen.v = false; UI.sheet = { kind: "goal", l, id, tab: app.tab }; draw(); app.refresh();
  if (focusName) { const el = $(`#sheet [data-f="name"]`); if (el) el.focus(); }
}
function newGoal(l) { const id = addRow(l); UI.fresh = { id }; changed({ full: true }); openGoalSheet(l, id, { focusName: true }); }
export function openAccountSheet(id, { focusName } = {}) {
  UI.sheet = { kind: "acc", id, tab: app.tab }; draw(); app.refresh();
  if (focusName) { const el = $(`#sheet [data-f="name"]`); if (el) el.focus(); }
}
export function openPersonSheet(id, { focusName } = {}) {
  UI.sheet = { kind: "person", id, tab: app.tab }; draw(); app.refresh();
  if (focusName) { const el = $(`#sheet [data-f="name"]`); if (el) el.focus(); }
}

/* ---------- clicks ---------- */
/* Focus goes back to the card or row that opened a sheet when it closes (the tab is redrawn, so the
   original element is replaced): keyboard and screen-reader users carry on where they were. */
const TRIGGERS = "[data-edit-acc], [data-edit-sp], [data-edit-nw], [data-edit-goal], [data-edit-person], [data-iv-edit]";
let opener = null;
function rememberOpener(el) {
  const keys = ["data-edit-acc", "data-edit-sp", "data-edit-nw", "data-edit-goal", "data-edit-person", "data-iv-edit", "data-i"];
  opener = keys.filter(k => el.hasAttribute(k)).map(k => `[${k}="${CSS.escape(el.getAttribute(k))}"]`).join("");
}
function restoreFocus() {
  const sel = opener; opener = null; if (!sel) return;
  requestAnimationFrame(() => { const a = document.activeElement; if (a && a !== document.body && !a.closest("#sheet")) return; const el = document.querySelector(sel); if (el) el.focus({ preventScroll: true }); });
}

export function initBudgetSheets() {
  document.addEventListener("click", e => { const t = e.target.closest && e.target.closest(TRIGGERS); if (t && !t.disabled) rememberOpener(t); }, true);
  // After every full redraw: keep an open sheet in step (a new type, a new colour, a person removed…)
  app.beforeRefresh = () => { if (UI.sheet && isOurs()) draw(); else if (UI.sheet) UI.sheet = null; };
  // Closing a sheet redraws the tab, so names and labels typed in it show in the list too.
  // Closing a sheet redraws the tab, so names typed in it show in the list too. A row that was just
  // added and left completely blank is removed again, so cancelling leaves nothing behind.
  $("#sheet").addEventListener("close", () => {
    const was = UI.sheet, fresh = UI.fresh; UI.sheet = null; UI.fresh = null;
    if (!was || !app.household) return;
    restoreFocus();
    if (fresh && fresh.id === was.id && !readOnly()) {
      const L = was.kind === "goal" ? list(was.l) : was.kind === "sp" ? app.state.spend : was.kind === "acc" ? app.state.accounts : was.kind === "nw" ? app.state.nw.accounts : null, i = L ? L.findIndex(x => x.id === fresh.id) : -1;
      const x = i >= 0 ? L[i] : null;
      const blankRow = x && !String(x.name || "").trim() && (was.kind === "sp" ? x.amount == null && !String(x.notes || "").trim() && x.aside == null && x.due == null
        : was.kind === "nw" ? x.balance == null
        : was.kind === "goal" ? x.target == null && x.saved == null && !x.deadline && x.pct == null && !Object.values(x.split || {}).some(v => v != null)
        : !Object.values(x.split || {}).some(v => v != null));
      if (blankRow) { L.splice(i, 1); changed({ full: true }); return; }
    }
    app.render();
  });

  document.addEventListener("click", e => {
    const t = e.target;
    const ea = t.closest("[data-edit-acc]"); if (ea && !ea.disabled) { openAccountSheet(ea.dataset.editAcc); return; }
    const es = t.closest("[data-edit-sp]"); if (es && !es.disabled) { openExpenseSheet(es.dataset.editSp); return; }
    const en = t.closest("[data-edit-nw]"); if (en && !en.disabled) { openNetWorthSheet(en.dataset.editNw); return; }
    if (t.closest("[data-iv-edit]")) { UI.sheet = { kind: "inv", id: "inv", tab: app.tab }; draw(); app.refresh(); return; }
    const eg = t.closest("[data-edit-goal]"); if (eg && !eg.disabled) { openGoalSheet(eg.dataset.editGoal, eg.dataset.i); return; }
    const ep = t.closest("[data-edit-person]"); if (ep) { openPersonSheet(ep.dataset.editPerson); return; }
    if (readOnly()) return;
    const oc = t.closest("[data-oc-pick]");
    if (oc && !oc.disabled) { // a colour is just how the item looks too
      const it = (list(oc.dataset.ocl) || []).find(x => x.id === oc.dataset.oci); if (!it) return;
      const k = oc.dataset.ocPick; if ((it.colour || "") === k) return;
      if (isObjectColour(k)) it.colour = k; else delete it.colour;
      changed({ full: true }); return;
    }
    const rs = t.closest("[data-look-reset-l]");
    if (rs) { const it = (list(rs.dataset.lookResetL) || []).find(x => x.id === rs.dataset.lookResetI); if (!it) return; delete it.icon; delete it.colour; changed({ full: true }); return; }
    const ic = t.closest("[data-icon-l]");
    if (ic && !ic.disabled) { // an icon is just how the item looks: saved on the item like any other edit
      const it = (list(ic.dataset.iconL) || []).find(x => x.id === ic.dataset.iconI); if (!it) return;
      if ((it.icon || "") === ic.dataset.icon) return; // already that one: no save, no Undo step
      if (ic.dataset.icon) it.icon = ic.dataset.icon; else delete it.icon;
      changed({ full: true }); return;
    }
    if (t.closest("[data-reorder]")) { const on = !(UI.reorder && UI.reorderTab === app.tab); UI.reorder = on; UI.reorderTab = app.tab; app.render(); return; }
    if (t.closest("[data-acc-new]")) { const id = addRow("acc"); UI.fresh = { id }; changed({ full: true }); openAccountSheet(id, { focusName: true }); return; }
    const sn = t.closest("[data-sp-new]");
    if (sn) {
      const id = addRow("sp"), x = app.state.spend.find(e => e.id === id);
      if (SP_TYPES.some(ty => ty.key === sn.dataset.spNew)) x.type = sn.dataset.spNew; // added from a group: start with that type
      UI.fresh = { id }; changed({ full: true }); openExpenseSheet(id, { focusName: true }); return;
    }
    const nn = t.closest("[data-nw-new]");
    if (nn) {
      const id = addRow("nw"), x = app.state.nw.accounts.find(e => e.id === id);
      if (NW_TYPES.some(ty => ty.key === nn.dataset.nwNew)) x.type = nn.dataset.nwNew; // added from a group: start with that type
      UI.fresh = { id }; changed({ full: true }); openNetWorthSheet(id, { focusName: true }); return;
    }
    const gn = t.closest("[data-goal-new]");
    if (gn) {
      if (gn.dataset.goalNew !== "pick") { newGoal(gn.dataset.goalNew); return; }
      // Which pot pays for it? (Phase 7D.2: the question in plain words, with what each pot gets per period.
      // Nothing is moved between pots: the goal just joins the list it's funded from.)
      const C = app.C, w = WORDS[app.state.viewAs];
      const opts = goalGroups(app.state).filter(g => g.kind !== "ef");
      const per = g => C ? money(C.v(g.kind === "joint" ? C.pool.goals.t : C.pool.personalGoals[g.kind.id] || 0)) + w.short : "";
      openPop(gn, `<div class="pop-h">Where should the money come from?</div>${opts.map(g => `<button class="item gl-pot" type="button" data-pick-goal="${esc(g.key)}"><span>${esc(g.title)}</span><small>${per(g)} going to it</small></button>`).join("")}`, b => { closePop(); newGoal(b.dataset.pickGoal); }, { label: "Choose where the money comes from" });
      return;
    }
    if (t.closest("[data-person-new]")) {
      if (app.state.people.length >= MAX_PEOPLE) return;
      const p = addPerson(app.state, { name: "" }); changed({ full: true }); openPersonSheet(p.id, { focusName: true }); return;
    }
  });
  // Remember which insight sections are open, so a redraw doesn't fold them away
  document.addEventListener("toggle", e => {
    const d = e.target; if (!d.dataset || !d.dataset.ins) return;
    if (d.open) UI.open.add(d.dataset.ins); else UI.open.delete(d.dataset.ins);
  }, true);
}

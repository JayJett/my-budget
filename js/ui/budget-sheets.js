/* Budget tab: editing sheets (an allocation, or a person's pay), reorder mode, and which insight
   sections are open.

   The sheets contain the very same boxes the old table had (data-l / data-i / data-f), so typing in
   them goes through the usual input handler in events.js: it updates app.state, recalculates, and
   saves change by change, exactly as before. There's no Save button because nothing is held back.
   Adding, removing, recolouring and reordering also use the existing handlers. */
import { app, changed, readOnly } from "./ctx.js";
import { $, esc } from "./dom.js";
import { K, attrs, fmtNum, pc } from "./inputs.js";
import { COLOUR_KEYS, PERSON_COLOURS, ROLES, addPerson, MAX_PEOPLE } from "../model/schema.js";
import { WORDS } from "../model/periods.js";
import { addRow } from "./events.js";

const UI = { reorder: false, open: new Set(), sheet: null }; // sheet: { kind: "acc" | "person", id }
export const budgetUI = () => UI;

const FREQ_OPTS = [["weekly", "a week"], ["fortnightly", "a fortnight"], ["monthly", "a month"]];
const TYPES = ["Joint", "Personal", "Investment"];
const dis = () => readOnly() ? " disabled" : "";

/* ---------- the sheet ---------- */
function show(title, body) {
  const d = $("#sheet");
  d.innerHTML = `<div class="sheet-head"><h3>${esc(title)}</h3><button class="btn small primary" type="button" data-sheet="close">Done</button></div><div class="sheet-body bsheet">${body}</div>`;
  if (!d.open) d.showModal();
}
const isOurs = () => $("#sheet").open && !!$("#sheet .bsheet");

function accountSheet(a) {
  const S = app.state, P = S.people, multi = P.length > 1, w = WORDS[S.viewAs];
  const ownerOpts = [["", "Shared"], ...P.map(p => [p.id, p.name || "Unnamed"])];
  const showOwner = multi && a.type === "Personal" && a.role !== "personalGoals";
  return `<div class="bs-hero"><span class="a-sw big" data-k="acc.${esc(a.id)}.sw"></span><div><div class="bs-amt">${K(`acc.${a.id}.t`)}</div><small>${esc(w.per)}${multi ? ", from everyone" : ""}</small></div></div>
    <label class="bs-field"><span>Name</span><input class="bs-in" type="text" ${attrs("acc", a.id, "name", "text")} value="${esc(a.name)}" placeholder="e.g. Groceries account" autocomplete="off"${dis()}></label>
    ${a.role ? `<p class="bs-note">${esc(ROLES[a.role])}</p>` : ""}
    <fieldset class="bs-field"><legend>Type</legend><div class="seg seg-radio">${TYPES.map(t => `<label><input type="radio" name="type-${esc(a.id)}" value="${t}" ${attrs("acc", a.id, "type", "text")}${a.type === t ? " checked" : ""}${dis()}><span>${t}</span></label>`).join("")}</div></fieldset>
    ${showOwner ? `<label class="bs-field"><span>Whose account</span><select class="bs-in" ${attrs("acc", a.id, "owner", "text")}${dis()}>${ownerOpts.map(([v, l]) => `<option value="${esc(v)}"${v === (a.owner || "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>` : ""}
    <div class="bs-field"><span class="bs-label">${multi ? "Share of each person’s pay" : "Share of your pay"}</span>
      <ul class="bs-shares">${P.map(p => `<li class="${pc(p)}">
        <span class="bs-who">${multi ? `<span class="av sm">${esc((p.name || "?").charAt(0).toUpperCase())}</span>${esc(p.name || "Unnamed")}` : "Your pay"}</span>
        <span class="unit person"><input type="number" step="any" inputmode="decimal" ${attrs("acc", a.id, `split.${p.id}`, "pct")} value="${a.split[p.id] == null ? "" : +(a.split[p.id] * 100).toFixed(4)}" aria-label="${esc(p.name || "Their")} percent of pay to ${esc(a.name || "this account")}"${dis()}><i>%</i></span>
        <span class="bs-val">${K(`acc.${a.id}.v.${p.id}`)}</span>
        <small class="bs-sub">${multi ? esc(p.name || "Unnamed") + ": " : ""}${K(`tot.p.${p.id}`)} of pay allocated in total</small></li>`).join("")}</ul></div>
    ${!a.role && !readOnly() ? `<button class="btn danger-soft block" type="button" data-del="acc" data-i="${esc(a.id)}">Delete allocation</button>` : ""}`;
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
      <div class="swatches" role="group" aria-label="Colour">${COLOUR_KEYS.map(k => `<button type="button" class="swatch-btn pc-${k}" data-colour="${k}" data-i="${esc(p.id)}" aria-pressed="${k === p.colour}" aria-label="${PERSON_COLOURS[k].label}"${dis()}></button>`).join("")}</div></div>
    ${multi && !readOnly() ? `<button class="btn danger-soft block" type="button" data-rmperson="${esc(p.id)}">Remove ${esc(p.name || "this person")}</button>` : ""}`;
}

/** Draw (or redraw) the open sheet from the current budget, keeping the cursor where it was. */
function draw() {
  const s = UI.sheet; if (!s) return;
  const S = app.state, item = s.kind === "acc" ? S.accounts.find(a => a.id === s.id) : S.people.find(p => p.id === s.id);
  if (!item || app.tab !== "budget") { close(); return; } // deleted (here or by someone else), or left the tab
  const ae = document.activeElement, keep = ae && ae.closest && ae.closest("#sheet") && ae.dataset && ae.dataset.f ? { l: ae.dataset.l, i: ae.dataset.i, f: ae.dataset.f, v: ae.type === "radio" ? ae.value : null, s: ae.selectionStart } : null;
  const y = $("#sheet").scrollTop;
  const title = s.kind === "acc" ? (item.name || "Allocation") : (item.name || "Person");
  show(title, s.kind === "acc" ? accountSheet(item) : personSheet(item));
  $("#sheet").scrollTop = y;
  if (keep) {
    const sel = `#sheet [data-l="${CSS.escape(keep.l)}"][data-i="${CSS.escape(keep.i)}"][data-f="${CSS.escape(keep.f)}"]${keep.v ? `[value="${CSS.escape(keep.v)}"]` : ""}`;
    const el = $(sel); if (el) { el.focus({ preventScroll: true }); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.s); } catch (_) {} }
  }
}
function close() { UI.sheet = null; const d = $("#sheet"); if (d.open && d.querySelector(".bsheet")) d.close(); }

export function openAccountSheet(id, { focusName } = {}) {
  UI.sheet = { kind: "acc", id }; draw(); app.refresh();
  if (focusName) { const el = $(`#sheet [data-f="name"]`); if (el) el.focus(); }
}
export function openPersonSheet(id, { focusName } = {}) {
  UI.sheet = { kind: "person", id }; draw(); app.refresh();
  if (focusName) { const el = $(`#sheet [data-f="name"]`); if (el) el.focus(); }
}

/* ---------- clicks ---------- */
export function initBudgetSheets() {
  // After every full redraw: keep an open sheet in step (a new type, a new colour, a person removed…)
  app.beforeRefresh = () => { if (UI.sheet && isOurs()) draw(); else if (UI.sheet) UI.sheet = null; };
  // Closing a sheet redraws the tab, so names and labels typed in it show in the list too.
  $("#sheet").addEventListener("close", () => { const was = UI.sheet; UI.sheet = null; if (was && app.tab === "budget" && app.household) app.render(); });

  document.addEventListener("click", e => {
    const t = e.target;
    const ea = t.closest("[data-edit-acc]"); if (ea && !ea.disabled) { openAccountSheet(ea.dataset.editAcc); return; }
    const ep = t.closest("[data-edit-person]"); if (ep) { openPersonSheet(ep.dataset.editPerson); return; }
    if (readOnly()) return;
    if (t.closest("[data-reorder]")) { UI.reorder = !UI.reorder; app.render(); return; }
    if (t.closest("[data-acc-new]")) { const id = addRow("acc"); changed({ full: true }); openAccountSheet(id, { focusName: true }); return; }
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

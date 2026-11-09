/* Phase 9C.1: "Choose your regular expenses". Tap the ones you have, optionally give each an amount
   and how often, then add them. Used by setup (step 4) and the Expenses tab: one picker, one list.

   - Nothing is added until "Add …". Closing after picking asks first.
   - A blank amount saves the expense with no amount (null). It shows "Needs an amount" and isn't
     counted until it has one; it is never a $0 bill.
   - Each pick gets its id when it's picked, and the save sets exactly those ids in one step
     (store.commit: all or nothing, one Undo), so double taps or a retry can't add anything twice.
   - Something you already have is marked "Already added"; you can still add another on purpose. */
import { app, readOnly } from "./ctx.js";
import { $, esc, toast, confirmDel } from "./dom.js";
import { SUGGESTIONS, byKey, buildExpenses, alreadyHas, readAmount } from "../model/suggestions.js";
import { BILL_PERIODS } from "../model/periods.js";
import { itemIcon } from "./icons.js";
import { uid } from "../model/util.js";

const PERIOD_LABEL = { Week: "a week", Fortnight: "a fortnight", Month: "a month", Year: "a year" };
let X = null; // { hh, step: "pick"|"amounts", picks: [{ key, id, amount, period }], busy, err, errors, onDone }
const isOpen = () => !!(X && $("#sheet").open && $("#sheet .xp"));
const picked = k => X.picks.find(p => p.key === k);

/** Open the picker. opts.onDone(count): called after a successful save (setup uses it to carry on). */
export function openExpensePicker(opts = {}) {
  if (readOnly() || !app.household) return;
  X = { hh: app.household.id, step: "pick", picks: [], busy: false, err: "", errors: {}, onDone: opts.onDone || null };
  draw(true);
}

function draw(first) {
  const d = $("#sheet"), S = app.state, y = d.scrollTop;
  const ae = document.activeElement, keep = ae && ae.closest && ae.closest("#sheet .xp") && ae.dataset.xpk ? { k: ae.dataset.xpk, s: ae.selectionStart } : null;
  const n = X.picks.length;
  let body;
  if (X.step === "pick") {
    body = SUGGESTIONS.map(g => `<section class="xp-g" aria-labelledby="xp-${g.key}"><h4 id="xp-${g.key}">${esc(g.label)}</h4><div class="xp-chips">${g.items.map(s => {
      const on = !!picked(s.key), had = alreadyHas(S, s.name);
      return `<button type="button" class="xp-chip${on ? " on" : ""}${had ? " had" : ""}" data-xp-pick="${s.key}" aria-pressed="${on}"${had ? ` aria-description="Already added"` : ""}>
        <span class="xp-ic" aria-hidden="true">${itemIcon(s.icon) || ""}</span><span>${esc(s.name)}</span>${had && !on ? `<small>Added</small>` : on ? `<span class="xp-tick" aria-hidden="true">✓</span>` : ""}</button>`;
    }).join("")}</div></section>`).join("");
  } else {
    body = `<p class="xp-lead">Amounts are optional. Leave one blank and add it later.</p><ul class="xp-rows">${X.picks.map(p => {
      const s = byKey(p.key), err = X.errors[p.key];
      return `<li class="xp-row${err ? " bad" : ""}"><div class="xp-row-h"><span class="xp-ic" aria-hidden="true">${itemIcon(s.icon) || ""}</span><b>${esc(s.name)}</b>${alreadyHas(S, s.name) ? `<small class="xp-dup">You already have one</small>` : ""}<button type="button" class="xp-x" data-xp-pick="${s.key}" aria-label="Remove ${esc(s.name)}">✕</button></div>
        <div class="xp-row-f"><span class="unit money"><i>$</i><input type="text" inputmode="decimal" autocomplete="off" data-xpk="a-${p.key}" data-xp-amount="${p.key}" value="${esc(p.amount || "")}" placeholder="Amount" aria-label="${esc(s.name)} amount (optional)"></span>
        <select class="bs-in" data-xp-period="${p.key}" aria-label="${esc(s.name)}: how often">${BILL_PERIODS.map(k => `<option value="${k}"${(p.period || s.period) === k ? " selected" : ""}>${PERIOD_LABEL[k]}</option>`).join("")}</select></div>
        ${err ? `<p class="xp-err" role="alert">${esc(err)}</p>` : ""}</li>`;
    }).join("")}</ul>`;
  }
  const foot = X.step === "pick"
    ? `<button class="btn primary" type="button" data-xp="next"${n ? "" : " disabled"}>${n ? `Next · ${n} chosen` : "Choose some expenses"}</button>`
    : `<button class="btn primary" type="button" data-xp="save"${X.busy || !n ? " disabled" : ""}>${X.busy ? "Adding…" : `Add ${n} ${n === 1 ? "expense" : "expenses"}`}</button><button class="btn ghost" type="button" data-xp="back">Back</button>`;
  d.innerHTML = `<div class="sheet-head"><h3 tabindex="-1" autofocus>${X.step === "pick" ? "Your regular expenses" : "Amounts (optional)"}</h3><button class="btn icon" type="button" data-xp="close" aria-label="Close">✕</button></div>
    <div class="sheet-body xp">${body}${X.err ? `<p class="rb-msg bad" role="alert">${esc(X.err)}</p>` : ""}<div class="rb-foot">${foot}</div></div>`;
  if (!d.open) d.showModal();
  if (first) { const h = d.querySelector("h3"); if (h) h.focus({ preventScroll: true }); }
  d.scrollTop = X.step === "pick" && !first ? y : first ? 0 : y;
  if (keep) { const el = d.querySelector(`[data-xpk="${CSS.escape(keep.k)}"]`); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.s); } catch (_) {} } }
}

async function save() {
  if (!X || X.busy || readOnly()) return;
  if (!app.household || app.household.id !== X.hh) { X.err = "This was for a different household, so nothing was added."; draw(); return; }
  const B = buildExpenses(app.state, X.picks, uid);
  X.errors = B.errors;
  if (!B.ok) { draw(); return; }
  if (app.offline || navigator.onLine === false) { X.err = "You’re offline. Connect to add these."; draw(); return; }
  X.busy = true; X.err = ""; draw();
  try {
    const ops = B.items.map(e => ({ op: "set", path: ["spend", e.id], value: e }));
    const res = await app.store.commit(ops, () => true); // adding by fixed ids: nothing anyone else did can clash
    if (!res.ok) throw new Error("not saved");
    const n = B.items.length, done = X.onDone; X = null;
    $("#sheet").close();
    if (done) done(n); else { app.render(); toast(`Added ${n} ${n === 1 ? "expense" : "expenses"}${B.items.some(e => e.amount === null) ? ". Add amounts when you know them." : "."}`); }
  } catch (e) {
    if (!X) return;
    X.busy = false; X.err = "Couldn’t add them, so nothing was added. Check your connection and try again."; draw();
  }
}

async function closeAsk() {
  if (!X || X.busy) return;
  if (X.picks.length && !(await confirmDel("Discard your choices?", "Nothing has been added yet.", "Discard"))) return;
  X = null; const d = $("#sheet"); if (d.open) d.close();
}

export function initExpensePicker() {
  const d = $("#sheet");
  d.addEventListener("click", e => {
    if (!isOpen()) return;
    const p = e.target.closest("[data-xp-pick]");
    if (p) {
      const k = p.dataset.xpPick, i = X.picks.findIndex(x => x.key === k);
      if (i >= 0) X.picks.splice(i, 1); else X.picks.push({ key: k, id: uid(), amount: "", period: byKey(k).period });
      delete X.errors[k]; X.err = "";
      if (X.step === "amounts" && !X.picks.length) X.step = "pick";
      draw(); return;
    }
    const b = e.target.closest("[data-xp]"); if (!b || b.disabled) return;
    const a = b.dataset.xp;
    if (a === "close") { e.preventDefault(); closeAsk(); }
    else if (a === "next") { X.step = "amounts"; draw(true); }
    else if (a === "back") { X.step = "pick"; draw(true); }
    else if (a === "save") save();
  });
  d.addEventListener("cancel", e => { if (isOpen()) { e.preventDefault(); closeAsk(); } });
  d.addEventListener("input", e => {
    if (!isOpen()) return; const t = e.target;
    if (t.matches("[data-xp-amount]")) {
      const p = picked(t.dataset.xpAmount); if (!p) return; p.amount = t.value;
      if (X.errors[p.key] && readAmount(t.value).ok) { delete X.errors[p.key]; draw(); }
    }
  });
  d.addEventListener("change", e => {
    if (!isOpen()) return; const t = e.target;
    if (t.matches("[data-xp-period]")) { const p = picked(t.dataset.xpPeriod); if (p) p.period = t.value; }
  });
  document.addEventListener("click", e => {
    const o = e.target.closest && e.target.closest("[data-xp-open]"); if (!o || o.disabled) return;
    openExpensePicker();
  });
}

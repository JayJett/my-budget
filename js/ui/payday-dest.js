/* Phase 10: where money goes on payday. A small, optional field in the allocation sheet ("Payday
   destination") and in each person's pay sheet ("Pay goes into").

   - Choose one of the Wealth accounts money can go to (by its id, so renaming it is fine), type a
     name ("Joint bills"), or leave it unset. A typed name is only a name: no balance, not in net worth.
   - In a shared allocation, one person can send their part somewhere else (tucked under "Different
     place for each person"). This never changes who the allocation belongs to or its type.
   - Saved in the budget like any other edit (Undo works); amounts aren't touched. */
import { app, changed, readOnly } from "./ctx.js";
import { esc } from "./dom.js";
import { destAccounts } from "../model/payday.js";
import { nwType } from "./views/networth.js";

const valueOf = d => !d ? "" : d.nw ? `nw:${d.nw}` : typeof d.label === "string" ? "label" : "";
function picker(d, attrs, { none = "Not chosen yet" } = {}) {
  const S = app.state, accs = destAccounts(S), v = valueOf(d), dis = readOnly() ? " disabled" : "";
  const gone = d && d.nw && !accs.some(a => a.id === d.nw);
  return `<select class="bs-in" ${attrs}${dis}>
      <option value=""${v === "" || gone ? " selected" : ""}>${gone ? "Account removed: choose again" : esc(none)}</option>
      ${accs.length ? `<optgroup label="Your accounts">${accs.map(a => `<option value="nw:${esc(a.id)}"${v === `nw:${a.id}` ? " selected" : ""}>${esc(a.name)} · ${esc(nwType(a.type).label)}</option>`).join("")}</optgroup>` : ""}
      <option value="label"${v === "label" ? " selected" : ""}>Somewhere else (type a name)</option></select>
    ${v === "label" ? `<input class="bs-in pd-label" type="text" maxlength="60" ${attrs.replace(/data-pd=/, "data-pd-label=")} value="${esc(d.label || "")}" placeholder="e.g. Joint bills" aria-label="Name of where it goes" autocomplete="off"${dis}>` : ""}`;
}

/** For the allocation sheet. */
export function destFieldHTML(a) {
  const S = app.state, payers = S.people.filter(p => Number(a.split && a.split[p.id]) > 0);
  const each = payers.length > 1 ? `<details class="pd-each"${a.destBy && Object.keys(a.destBy).length ? " open" : ""}><summary>Different place for each person</summary>
      ${payers.map(p => `<label class="bs-field pd-person"><span>${esc(p.name || "Unnamed")}</span>${picker(a.destBy && a.destBy[p.id], `data-pd="accp" data-i="${esc(a.id)}" data-p="${esc(p.id)}"`, { none: "Same as above" })}</label>`).join("")}</details>` : "";
  return `<div class="bs-field pd-dest"><span class="bs-label">Payday destination</span>${picker(a.dest, `data-pd="acc" data-i="${esc(a.id)}" aria-label="Payday destination"`)}${each}</div>`;
}
/** For a person's pay sheet. */
export function srcFieldHTML(p) {
  return `<div class="bs-field pd-dest"><span class="bs-label">Pay goes into</span>${picker(p.src, `data-pd="src" data-i="${esc(p.id)}" aria-label="Where this pay goes into"`, { none: "Not chosen yet" })}</div>`;
}

/* ---------- saving ---------- */
function target(el) {
  const S = app.state, kind = el.dataset.pd || el.dataset.pdLabel, id = el.dataset.i;
  if (kind === "src") { const p = S.people.find(x => x.id === id); return p ? { obj: p, field: "src" } : null; }
  const a = S.accounts.find(x => x.id === id); if (!a) return null;
  if (kind === "accp") { a.destBy = a.destBy || {}; return { obj: a.destBy, field: el.dataset.p, owner: a }; }
  return { obj: a, field: "dest" };
}
function tidy(t) { if (t && t.owner && t.owner.destBy && !Object.keys(t.owner.destBy).length) delete t.owner.destBy; }
export function initPaydayDest() {
  document.addEventListener("change", e => {
    const el = e.target; if (readOnly() || !el.matches) return;
    if (el.matches("select[data-pd]")) {
      const t = target(el); if (!t) return;
      const v = el.value;
      if (!v) delete t.obj[t.field];
      else if (v === "label") t.obj[t.field] = { label: (t.obj[t.field] && t.obj[t.field].label) || "" };
      else t.obj[t.field] = { nw: v.slice(3) };
      tidy(t); changed({ full: true }); // (redraws the open sheet, to show or hide the name box)
      if (v === "label") setTimeout(() => { const i = document.querySelector(`#sheet [data-pd-label="${el.dataset.pd}"][data-i="${CSS.escape(el.dataset.i)}"]${el.dataset.p ? `[data-p="${CSS.escape(el.dataset.p)}"]` : ""}`); if (i) i.focus(); }, 30);
    } else if (el.matches("input[data-pd-label]")) changed({ full: false }); // leaving the box: no redraw (it would swallow a tap on Done)
  });
  // typing a name: saved as you type, without redrawing the sheet under your cursor
  document.addEventListener("input", e => {
    const el = e.target; if (readOnly() || !el.matches || !el.matches("input[data-pd-label]")) return;
    const t = target(el); if (!t) return;
    t.obj[t.field] = { label: el.value.slice(0, 60) };
    app.hasData = true; if (app.store) app.store.schedule();
  });
}

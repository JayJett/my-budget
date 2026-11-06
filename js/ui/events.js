/* Everything the user can do on the page: typing, clicking, dragging. Each change edits app.state
   and then calls changed(), which redraws and queues a save. */
import { app, changed, readOnly, TAB_HASH } from "./ctx.js";
import { $, esc, toast, openPop, closePop, confirmDel } from "./dom.js";
import { fmtNum } from "./inputs.js";
import { list, render } from "./render.js";
import { addPerson, removePerson, renamePerson, nextPos, moveItem, MAX_PEOPLE } from "../model/schema.js";
import { uid, ymd, n, blank } from "../model/util.js";
import { pct, possessive } from "../model/format.js";
import { mainMenu, menuAct } from "./menu.js";

function readVal(el) {
  const t = el.dataset.t, raw = el.value;
  if (t === "num") { const c = raw.replace(/[,$\s]/g, ""); return c === "" || isNaN(Number(c)) ? null : Number(c); }
  if (t === "pct") return raw === "" ? null : Number(raw) / 100;
  if (t === "month") return raw === "" ? null : Number(raw);
  return raw;
}
/** Set obj["a.b.c"] = v, creating objects along the way. */
function setPath(obj, path, v) {
  const p = path.split("."); let o = obj;
  for (let i = 0; i < p.length - 1; i++) { if (typeof o[p[i]] !== "object" || o[p[i]] === null) o[p[i]] = {}; o = o[p[i]]; }
  if (v === null && p.length > 1 && p[0] === "split") delete o[p[p.length - 1]]; else o[p[p.length - 1]] = v;
}
const allGoals = () => [app.state.goals.ef, ...app.state.goals.joint, ...Object.values(app.state.goals.personal).flat()];
const rowHasData = it => Object.entries(it).some(([k, v]) => !["id", "type", "period", "account", "due", "pos", "split", "owner", "role"].includes(k) && !blank(v) && v !== 0);

/** Which fields need the whole tab redrawn when they change (they add or remove columns or labels). */
const REDRAW_ON_CHANGE = new Set(["type", "period", "note", "freq", "owner"]);

export function initEvents() {
  document.addEventListener("input", e => {
    const el = e.target; if (!el.dataset || !el.dataset.f || readOnly()) return;
    const v = readVal(el), l = el.dataset.l, f = el.dataset.f;
    if (l === "root") setPath(app.state, f, v);
    else {
      const item = list(l)?.find(x => x.id === el.dataset.i); if (!item) return;
      if (l === "pp" && f === "name") renamePerson(app.state, item.id, v);
      else if (l === "pp" && f === "freq") item.freq = v;
      else {
        if (l === "nw" && f === "name") { const old = item.name; allGoals().forEach(g => { if (old && g.account === old) g.account = v; }); }
        setPath(item, f, v);
      }
    }
    changed();
  });
  // Show money without commas while editing. If the whole number was selected (e.g. after Tab),
  // keep it selected, so typing replaces it instead of adding to the end.
  document.addEventListener("focusin", e => {
    const el = e.target; if (!el.dataset || el.dataset.t !== "num" || !el.value.includes(",")) return;
    const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    el.value = el.value.replace(/,/g, "");
    if (all) el.select();
  });
  document.addEventListener("focusout", e => { const el = e.target; if (el.dataset && el.dataset.t === "num") el.value = fmtNum(readVal(el)); });
  document.addEventListener("change", e => {
    const d = e.target.dataset || {};
    if (REDRAW_ON_CHANGE.has(d.f) || (d.l === "pp" && d.f === "name")) render();
  });

  document.addEventListener("click", async e => {
    const pop = $("#pop"), path = e.composedPath();
    if (!path.includes(pop) && !e.target.closest("#menuBtn") && !e.target.closest("[data-fill]")) closePop();
    if (path.includes(pop)) return;
    const tb = e.target.closest("[data-tab]");
    if (tb) { const h = TAB_HASH[tb.dataset.tab]; if (location.hash !== "#" + h) location.hash = h; else { app.tab = tb.dataset.tab; render(); } window.scrollTo({ top: 0 }); return; }
    if (e.target.closest('[data-act="import"]')) { $("#importFile").click(); return; }
    if (e.target.closest("#menuBtn")) { if (!pop.hidden) { closePop(); return; } openPop(e.target.closest("#menuBtn"), mainMenu(), menuAct); return; }
    if (readOnly()) return;

    const va = e.target.closest("[data-viewas]");
    if (va) { app.state.viewAs = va.dataset.viewas; changed({ full: true }); return; }

    const fb = e.target.closest("[data-fill]");
    if (fb) {
      const pid = fb.dataset.fill, p = app.state.people.find(x => x.id === pid); if (!p) return;
      const rem = 1 - app.C.tot.pct[pid];
      const items = app.state.accounts.map(a => `<button class="item" type="button" data-acc="${esc(a.id)}">${esc(a.name || "Unnamed account")}<small>${blank(a.split[pid]) ? "0%" : pct(n(a.split[pid]), 1)} now, ${pct(n(a.split[pid]) + rem, 1)} after</small></button>`).join("");
      openPop(fb, `<div class="pop-h">Put the remaining ${pct(rem, 1)} of ${esc(possessive(p.name || "their"))} pay into</div>${items}`, b => {
        const a = app.state.accounts.find(x => x.id === b.dataset.acc); if (!a) return;
        a.split[pid] = Math.round((n(a.split[pid]) + rem) * 1e6) / 1e6; closePop(); changed({ full: true });
        toast(`${a.name || "Account"} now gets ${pct(a.split[pid], 1)} of ${possessive(p.name || "their")} pay`);
      });
      return;
    }

    if (e.target.closest("[data-addperson]")) {
      if (app.state.people.length >= MAX_PEOPLE) return;
      const p = addPerson(app.state, { name: "" });
      changed({ full: true });
      const inp = $(`[data-l="pp"][data-i="${CSS.escape(p.id)}"][data-f="name"]`); if (inp) inp.focus();
      return;
    }
    const rp = e.target.closest("[data-rmperson]");
    if (rp) {
      const p = app.state.people.find(x => x.id === rp.dataset.rmperson); if (!p) return;
      const nm = p.name || "this person";
      if (!(await confirmDel(`Remove ${nm}?`, `${nm}’s pay, their percentages, their personal accounts and their personal goals will be removed from this budget. Everything else stays.`))) return;
      removePerson(app.state, p.id); changed({ full: true }); toast(`${nm} removed`);
      return;
    }
    const sw = e.target.closest("[data-colour]");
    if (sw) { const p = app.state.people.find(x => x.id === sw.dataset.i); if (p) { p.colour = sw.dataset.colour; changed({ full: true }); } return; }

    const ad = e.target.closest("[data-add]");
    if (ad) {
      const l = ad.dataset.add, L = list(l), id = uid(), pos = nextPos(L);
      const defs = {
        acc: { id, name: "", type: "Personal", owner: null, role: null, split: {}, pos },
        nw: { id, name: "", type: "Savings", balance: null, pos },
        sp: { id, name: "", type: "Flexible", amount: null, period: "Fortnight", notes: "", due: null, aside: null, pos },
        gj: { id, name: "", target: null, saved: null, account: "", split: {}, deadline: "", pos },
      };
      L.push(defs[l] || { id, name: "", target: null, saved: null, account: "", pct: null, deadline: "", pos });
      changed({ full: true });
      const inp = $(`[data-l="${CSS.escape(l)}"][data-i="${id}"][data-f="name"]`); if (inp) inp.focus();
      return;
    }
    const dl = e.target.closest("[data-del]");
    if (dl) {
      const L = list(dl.dataset.del), i = L.findIndex(x => x.id === dl.dataset.i); if (i < 0) return;
      if (rowHasData(L[i]) && !(await confirmDel(`Remove “${L[i].name || "this row"}”?`, "Its numbers will be cleared for everyone in the household."))) return;
      L.splice(i, 1); changed({ full: true }); return;
    }
    const efb = e.target.closest("[data-ef]");
    if (efb) { app.state.goals.ef.target = Math.round(app.C.mCommitted * Number(efb.dataset.ef)); changed({ full: true }); toast(`Emergency fund target set to ${efb.dataset.ef} months`); return; }
    if (e.target.id === "noteX") { app.state.note = ""; changed({ full: true }); return; }
    if (e.target.id === "revToday") { app.state.nw.reviewed = ymd(app.today); changed({ full: true }); return; }
  });

  /* ---------- drag to reorder (mouse, touch, or arrow keys on the handle) ---------- */
  let drag = null;
  document.addEventListener("pointerdown", e => {
    const g = e.target.closest(".grip"); if (!g || readOnly()) return;
    e.preventDefault();
    const tr = g.closest("tr");
    drag = { l: g.dataset.grip, id: g.dataset.i, tr, tb: tr.parentElement, target: null };
    tr.classList.add("dragging"); document.body.classList.add("is-dragging");
    try { g.setPointerCapture(e.pointerId); } catch (_) {}
  });
  document.addEventListener("pointermove", e => {
    if (!drag) return;
    const rows = [...drag.tb.children]; let idx = rows.length;
    for (let k = 0; k < rows.length; k++) { const b = rows[k].getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { idx = k; break; } }
    rows.forEach(r => r.classList.remove("drop-before", "drop-after"));
    if (idx < rows.length) rows[idx].classList.add("drop-before"); else rows[rows.length - 1].classList.add("drop-after");
    drag.target = idx;
  });
  const endDrag = commit => {
    if (!drag) return;
    const L = list(drag.l), from = L.findIndex(x => x.id === drag.id); let to = drag.target;
    document.body.classList.remove("is-dragging");
    const moved = commit && to !== null && from > -1 && (to > from ? to - 1 : to) !== from;
    if (moved) moveItem(L, from, to > from ? to - 1 : to);
    drag = null;
    if (moved) changed({ full: true }); else render();
  };
  document.addEventListener("pointerup", () => endDrag(true));
  document.addEventListener("pointercancel", () => endDrag(false));
  document.addEventListener("keydown", e => {
    const g = e.target.closest && e.target.closest(".grip"); if (!g || (e.key !== "ArrowUp" && e.key !== "ArrowDown") || readOnly()) return;
    e.preventDefault();
    const L = list(g.dataset.grip), i = L.findIndex(x => x.id === g.dataset.i), j = i + (e.key === "ArrowUp" ? -1 : 1);
    if (i < 0 || j < 0 || j >= L.length) return;
    moveItem(L, i, j); changed({ full: true });
    const ng = $(`.grip[data-grip="${CSS.escape(g.dataset.grip)}"][data-i="${CSS.escape(g.dataset.i)}"]`); if (ng) ng.focus();
  });

  window.addEventListener("hashchange", () => {
    const h = location.hash.replace(/^#/, ""), t = Object.keys(TAB_HASH).find(k => TAB_HASH[k] === h);
    if (t && t !== app.tab) { app.tab = t; if (app.household) render(); window.scrollTo({ top: 0 }); }
  });
}

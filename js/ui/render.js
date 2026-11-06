/* Drawing the page. render() rebuilds the current tab; refresh() only updates the calculated
   numbers (so typing in a box never loses focus). */
import { app, readOnly } from "./ctx.js";
import { $, $$, esc } from "./dom.js";
import { pc } from "./inputs.js";
import { compute } from "../model/calc.js";
import { WORDS, VIEWS } from "../model/periods.js";
import { pct } from "../model/format.js";
import { accountColours, personVar } from "./charts.js";
import { TABS } from "./views/labels.js";
import * as budget from "./views/budget.js";
import * as networth from "./views/networth.js";
import * as spending from "./views/spending.js";
import * as goals from "./views/goals.js";
import * as invest from "./views/invest.js";

const VIEWS_BY_TAB = { budget, networth, spending, goals, invest };

const ICONS = {
  budget: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6.2"/><path d="M8 1.8V8h6.2"/></svg>',
  networth: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 14h12M3.5 14V8M6.5 14V5M9.5 14V7M12.5 14V3"/></svg>',
  spending: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 6h11l-1.2 7.5H3.7z"/><path d="M5.5 6l2.5-4 2.5 4"/></svg>',
  goals: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="3.4"/><circle cx="8" cy="8" r=".9" fill="currentColor"/></svg>',
  invest: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12l4-4 3 2.5L14 4"/><path d="M10.5 4H14v3.5"/></svg>',
};

/** Which in-memory list a data-l key points at. "gp:<id>" is one person's goals. */
export function list(l) {
  const S = app.state;
  if (l.startsWith("gp:")) return S.goals.personal[l.slice(3)] || (S.goals.personal[l.slice(3)] = []);
  return { acc: S.accounts, nw: S.nw.accounts, sp: S.spend, gj: S.goals.joint, ef: [S.goals.ef], pp: S.people }[l];
}

export function applyUI() {
  const t = app.ui.theme;
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  document.body.classList.toggle("compact", app.ui.density === "compact");
}

const initials = P => P.map(p => (p.name || "?").trim().charAt(0).toUpperCase() || "?").join(P.length === 2 ? "+" : "");

/** Header: logo, names, "per fortnight" label and the browser tab title. */
export function renderBrand() {
  const P = app.state.people, w = WORDS[app.state.viewAs];
  const names = P.filter(p => p.name);
  const logo = $(".top .logo");
  if (logo) {
    logo.textContent = initials(P).slice(0, 4);
    logo.style.background = P.length > 1 ? `linear-gradient(135deg, ${P.map((p, i) => `${personVar(p)} ${i / P.length * 100}% ${(i + 1) / P.length * 100}%`).join(", ")})` : personVar(P[0]);
  }
  const brand = $("#brandNames");
  if (brand) brand.innerHTML = (names.length ? names.map(p => `<span class="${pc(p)}">${esc(p.name)}</span>`).join('<span class="plus">+</span>') : esc(app.household ? app.household.name : "Budget"))
    + `<small>${esc(app.household ? app.household.name + " · " : "")}Amounts shown ${w.per}</small>`;
  document.title = (names.length ? names.map(p => p.name).join(" + ") : "My") + " · Budget";
}

const viewAsBar = () => {
  const v = app.state.viewAs;
  return `<div class="viewas"><span>Show amounts per</span><div class="seg" role="group" aria-label="Show amounts per">${VIEWS.map(k => `<button type="button" data-viewas="${k}" aria-pressed="${k === v}">${WORDS[k].noun[0].toUpperCase() + WORDS[k].noun.slice(1)}</button>`).join("")}</div><small>Applies to everyone in the household.</small></div>`;
};

const welcomeBox = () => `<div class="welcome"><h3>Start your budget</h3><p>Nothing has been saved here yet. Fill in the tinted fields to begin, or bring in the numbers from a file you saved from an earlier version.</p><button class="btn soft" type="button" data-act="import">Import a saved file</button></div>`;

export function render() {
  if (!VIEWS_BY_TAB[app.tab]) app.tab = "budget";
  applyUI();
  app.C = compute(app.state, app.today);
  app.colours = accountColours(app.state);
  $("#tabs").innerHTML = TABS(app.state).map(([k, l]) => `<button class="tab" role="tab" type="button" data-tab="${k}" aria-selected="${k === app.tab}">${ICONS[k]}${esc(l)}<span class="mark" data-mark="${k}"></span></button>`).join("");
  $("#app").innerHTML = (app.loaded && !app.hasData && app.canWrite ? welcomeBox() : "") + viewAsBar() + VIEWS_BY_TAB[app.tab].view();
  refresh();
  const ro = readOnly();
  document.body.classList.toggle("readonly", ro);
  if (ro) $$("#app [data-f], #app [data-add], #app [data-del], #app [data-addperson], #app [data-rmperson], #app [data-colour], #app [data-viewas]").forEach(el => el.disabled = true);
}

export function refresh() {
  const C = app.C = compute(app.state, app.today), D = {};
  app.colours = accountColours(app.state);
  const mod = VIEWS_BY_TAB[app.tab];
  mod.fill(D, C);
  $$("[data-k]").forEach(el => {
    const v = D[el.dataset.k]; if (v === undefined) return;
    if (typeof v === "object") {
      if ("bg" in v) { el.style.background = v.bg; return; }
      if ("w" in v) { el.style.width = (v.w * 100) + "%"; return; }
      if ("pw" in v) { el.style.width = `calc((100% - 20px) * ${Math.max(0, Math.min(1, v.pw))})`; return; }
      el.textContent = v.t; el.className = (el.dataset.base || "") + " " + (v.c || "");
    } else el.textContent = v;
  });
  if (mod.draw) mod.draw(C);
  renderBrand();
  // tab markers, attention box, allocation meter
  TABS(app.state).forEach(([k]) => { const m = $(`[data-mark="${k}"]`), c = C.issues[k].length; if (m) { m.textContent = c || ""; m.parentElement.dataset.tip = c ? C.issues[k].join(" ") : ""; } });
  const at = $("#attn"), li = C.issues[app.tab] || [];
  if (at) { at.hidden = !li.length; at.innerHTML = li.length ? `<h3>${li.length === 1 ? "One thing" : li.length + " things"} to look at</h3><ul>${li.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""; }
  const me = $("#meter");
  me.hidden = app.tab !== "budget";
  if (app.tab === "budget") {
    const part = p => { const x = C.tot.pct[p.id], ok = Math.round(x * 1e4) === 1e4, rem = 1 - x;
      return `<div class="mt ${pc(p)}"><b>${esc(p.name || "Unnamed")}</b><span class="mt-bar"><span style="width:${Math.min(x, 1) * 100}%"></span></span><span class="mt-v ${ok ? "ok" : "bad"}">${pct(x, 1)}</span>${rem > 0.00005 ? `<button class="fill-btn" type="button" data-fill="${esc(p.id)}">Fill ${pct(rem, 1)}</button>` : ""}</div>`; };
    me.innerHTML = `<span class="lbl">Allocated</span>${C.people.map(part).join("")}`;
  }
}

app.render = render;
app.refresh = refresh;

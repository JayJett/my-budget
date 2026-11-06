/* Drawing the page. render() rebuilds the current tab; refresh() only updates the calculated
   numbers (so typing in a box never loses focus). */
import { app, readOnly } from "./ctx.js";
import { $, $$, esc } from "./dom.js";
import { pc } from "./inputs.js";
import { compute } from "../model/calc.js";
import { WORDS, VIEWS } from "../model/periods.js";
import { listNames } from "../model/format.js";
import { accountColours } from "./charts.js";
import { TABS, SHORT } from "./views/labels.js";
import * as budget from "./views/budget.js";
import * as networth from "./views/networth.js";
import * as spending from "./views/spending.js";
import * as goals from "./views/goals.js";
import * as invest from "./views/invest.js";
import * as progress from "./views/progress.js";

const VIEWS_BY_TAB = { budget, networth, spending, goals, invest, progress };

const ICONS = {
  budget: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6.2"/><path d="M8 1.8V8h6.2"/></svg>',
  networth: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 14h12M3.5 14V8M6.5 14V5M9.5 14V7M12.5 14V3"/></svg>',
  spending: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 6h11l-1.2 7.5H3.7z"/><path d="M5.5 6l2.5-4 2.5 4"/></svg>',
  goals: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="3.4"/><circle cx="8" cy="8" r=".9" fill="currentColor"/></svg>',
  invest: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12l4-4 3 2.5L14 4"/><path d="M10.5 4H14v3.5"/></svg>',
  progress: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.5V8l2.4 1.6"/></svg>',
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

const initial = p => (p.name || "?").trim().charAt(0).toUpperCase() || "?";

/** Header: one small avatar per person in the budget (in their colour), the household's name,
    and, for more than one person, their names underneath. Nothing here is fixed to particular people. */
export function renderBrand() {
  const P = app.state.people, names = P.map(p => (p.name || "").trim()).filter(Boolean);
  const title = app.household ? app.household.name : (names.length ? listNames(names) : "Moni Money");
  const av = $("#avatars");
  if (av) av.innerHTML = P.slice(0, 4).map(p => `<span class="av ${pc(p)}">${esc(initial(p))}</span>`).join("");
  const brand = $("#brandNames");
  if (brand) brand.innerHTML = `<span class="brand-t">${esc(title)}</span>${P.length > 1 && names.length ? `<small>${esc(listNames(names))}</small>` : ""}`;
  document.title = `${title} · Budget`;
}

const viewAsBar = () => {
  const v = app.state.viewAs;
  return `<div class="viewas"><span>Show amounts per</span><div class="seg" role="group" aria-label="Show amounts per">${VIEWS.map(k => `<button type="button" data-viewas="${k}" aria-pressed="${k === v}">${WORDS[k].noun[0].toUpperCase() + WORDS[k].noun.slice(1)}</button>`).join("")}</div><small>Applies to everyone in the household.</small></div>`;
};

const welcomeBox = () => `<div class="welcome"><h3>Start your budget</h3><p>Nothing’s saved yet. Add your pay below, let the setup guide build a starting plan, or bring in a file you saved earlier.</p><button class="btn primary" type="button" data-act="setup">Use the setup guide</button> <button class="btn soft" type="button" data-act="import">Import a saved file</button></div>`;

export function render() {
  if (!VIEWS_BY_TAB[app.tab]) app.tab = "budget";
  applyUI();
  if (app.setup) { renderBrand(); app.setup.render(); return; } // the setup guide has the page to itself
  app.C = compute(app.state, app.today);
  app.colours = accountColours(app.state);
  $("#tabs").innerHTML = TABS(app.state).map(([k, l]) => `<button class="tab" role="tab" type="button" data-tab="${k}" aria-selected="${k === app.tab}"><span class="ti">${ICONS[k]}</span><span class="tl">${esc(l)}</span><span class="ts">${esc(SHORT[k])}</span><span class="mark" data-mark="${k}"></span></button>`).join("");
  const note = !app.canWrite && app.household ? `<div class="welcome ro-note"><h3>You’re viewing ${esc(app.household.name)}</h3><p>You can look around, but changes are switched off. An owner can make you an editor in Household settings.</p></div>` : "";
  // (Budget and Spending have their own period switch, in their top card.)
  $("#app").innerHTML = note + (app.loaded && !app.hasData && app.canWrite && app.tab === "budget" ? welcomeBox() : "") + (["progress", "budget", "spending", "networth", "goals", "invest"].includes(app.tab) ? "" : viewAsBar()) + VIEWS_BY_TAB[app.tab].view();
  if (app.beforeRefresh) app.beforeRefresh(); // e.g. an open editing sheet redraws itself from the new state
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
  // tab markers and the attention box
  TABS(app.state).forEach(([k]) => { const m = $(`[data-mark="${k}"]`), list = C.issues[k] || [], c = list.length; if (m) { m.textContent = c || ""; m.parentElement.dataset.tip = c ? list.join(" ") : ""; } });
  const at = $("#attn"), li = C.issues[app.tab] || [];
  if (at) { at.hidden = !li.length; at.innerHTML = li.length ? `<h3>${li.length === 1 ? "One thing" : li.length + " things"} to look at</h3><ul>${li.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""; }
}

app.render = render;
app.refresh = refresh;

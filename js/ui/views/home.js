/* Home (Phase 9A): the front door. A greeting, the next payday, whether every dollar of pay has a
   plan, a few key figures and a short list of useful next steps.

   Every number comes from compute() (model/calc.js) through model/home.js, the same figures the
   Budget, Expenses, Goals and Wealth screens show. Nothing is invented for an empty budget: no
   balances, no payday countdown without a payday, no score. Missing things become suggestions. */
import { app, readOnly, TAB_HASH } from "../ctx.js";
import { esc } from "../dom.js";
import { money, m0, pct } from "../../model/format.js";
import { WORDS } from "../../model/periods.js";
import { parseDate } from "../../model/util.js";
import { isShared } from "../../model/schema.js";
import { paydays, planStatus, homeActions, homeFigures } from "../../model/home.js";
import { myName } from "../profile.js";
import { insightCopy, homePlanLines } from "../insight-view.js";

const I = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  pay: I('<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5h.01M17.5 14.5h.01"/>'),
  cal: I('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>'),
  plan: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>'),
  acct: I('<path d="M3.5 9.5 12 4l8.5 5.5"/><path d="M5.5 10v8M10 10v8M14 10v8M18.5 10v8M3.5 19.5h17"/>'),
  goal: I('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  bills: I('<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>'),
  snap: I('<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v10.5H4z"/><circle cx="12" cy="13.5" r="3.3"/>'),
  review: I('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V8h3.5"/><path d="M9 12.5l2 2 4-4.5"/>'),
  invest: I('<path d="M3.5 17l5.5-5.5 4 3.5 7-8"/><path d="M15 7h5v5"/>'),
  save: I('<path d="M5 13a7 6 0 0 1 7-6h2a6.5 6 0 0 1 4.8 2.2l1.7-.5v3.7l-1.5.6a6.5 6 0 0 1-2 2.6V19H15v-1.5h-4V19H9v-2.3A6 6 0 0 1 5 13z"/>'),
  chev: '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = d => d === 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`;
const dateLine = s => { const d = parseDate(s); return `${DAYNAMES[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
const FREQ = { weekly: "weekly", fortnightly: "fortnightly", monthly: "monthly" };
/** Morning/afternoon/evening by this device's clock (the person's own time, wherever they are). */
const hello = () => { const h = new Date().getHours(); return h < 5 ? "Hello" : h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening"; };

function payCard(S, C, w) {
  const L = paydays(S, C, app.today), shared = isShared(S) && S.people.length > 1;
  if (!L.length) return `<section class="card ho-pay ho-hero"><span class="eyebrow">Payday</span>
    <p class="ho-big">Add your pay</p><p class="ho-sub">Tell Moni Money what you take home, and it’ll plan where every dollar goes.</p>
    ${readOnly() ? "" : `<button class="btn primary small" type="button" data-home-go="budget" data-home-person="${esc((S.people[0] || {}).id || "")}">Add your pay</button>`}</section>`;
  // Phase 9A.1: one date, the countdown, then who's paid that day and how much. People paid on another
  // day (or with no payday yet) are listed underneath with their own date. Nobody's pay is added up.
  const first = L[0], day = first.date, same = L.filter(p => p.date && p.date === day), rest = L.filter(p => !same.includes(p));
  const amt = p => `<b class="ho-amt">${money(p.pay)}</b>`;
  const who = p => shared ? `<span class="ho-who">${esc(p.name || "Someone")}</span>` : `<span class="ho-who">Your pay</span>`;
  const row = (p, when = "") => `<li class="person pc-${esc(p.colour)}">${who(p)}${when ? `<small class="ho-on">${esc(when)}</small>` : ""}${amt(p)}</li>`;
  const short = s => { const d = parseDate(s); return `${DAYNAMES[d.getDay()].slice(0, 3)} ${d.getDate()} ${MON[d.getMonth()]}`; };
  if (!day) return `<section class="card ho-pay ho-hero"><span class="eyebrow">Your pay</span>
    <ul class="ho-pays">${L.map(p => row(p)).join("")}</ul>
    ${readOnly() ? "" : `<button class="btn soft small" type="button" data-home-go="budget" data-home-person="${esc(first.id)}">Set a payday</button>`}</section>`;
  return `<section class="card ho-pay ho-hero" aria-labelledby="hoPayT"><span class="eyebrow" id="hoPayT">Next payday</span>
    <p class="ho-big">${esc(dateLine(day))}</p><p class="ho-when">${when(first.inDays)}</p>
    <ul class="ho-pays">${same.map(p => row(p)).join("")}${rest.map(p => row(p, p.date ? short(p.date) : "No payday yet")).join("")}</ul></section>`;
}

function planCard(S, C, w) {
  const st = planStatus(C);
  if (st.k === "none") return "";
  const v = x => money(C.v(x)) + w.short;
  const line = st.k === "ok" ? `${shareWord(S)} has a plan` : st.k === "over" ? `Your plan is over by ${v(st.over)}` : `${v(st.left)} still to plan`;
  const sub = st.k === "ok" ? `${m0(C.v(C.incTotal))} ${w.per}` : st.k === "over" ? "More is planned than comes in. Trim an allocation on Budget." : "Give the rest a job on Budget.";
  // Phase 9B: a few plain facts under it (essentials, whether expenses fit their budget, room to adjust)
  const lines = homePlanLines(S, C);
  return `<button class="card ho-plan ho-tap ${st.k}" type="button" data-home-go="budget">
    <span class="ho-ic" aria-hidden="true">${IC.plan}</span>
    <span class="ho-plan-t"><b>${esc(line)}</b><small>${esc(sub)}</small>
      <span class="ho-bar" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, st.pct * 100)).toFixed(1)}%"></span></span>
      ${lines.length ? `<span class="ho-lines">${lines.map(([k, v, c]) => `<span class="ho-line${c ? " " + c : ""}"><span>${esc(k)}</span><b>${esc(v)}</b></span>`).join("")}</span>` : ""}</span>${IC.chev}</button>`;
}
const shareWord = S => isShared(S) && S.people.length > 1 ? "All of your pay" : "100% of your pay";

function figures(S, C, w) {
  const F = homeFigures(S, C), v = x => m0(C.v(x));
  const tile = (go, icon, label, value, sub, cls = "") => `<button class="ho-fig ${cls}" type="button" data-home-go="${go}"><span class="ho-ic" aria-hidden="true">${icon}</span><small>${esc(label)}</small><b>${value}</b><span class="ho-fig-sub">${esc(sub)}</span></button>`;
  const T = [];
  T.push(F.hasAccounts ? tile("networth", IC.acct, "Net worth", m0(F.netWorth), "", F.netWorth < 0 ? "neg" : "")
                       : tile("networth", IC.acct, "Net worth", "—", "Add an account to see it", "empty"));
  if (C.incTotal > 0) {
    T.push(tile("goals", IC.save, "Saving", v(F.saving) + `<i>${esc(w.short)}</i>`, F.ef ? `Emergency fund ${pct(Math.min(1, F.ef.saved / F.ef.target))} of target` : ""));
    T.push(tile("invest", IC.invest, "Investing", v(F.investing) + `<i>${esc(w.short)}</i>`, ""));
    T.push(F.hasSpend ? tile("spending", IC.bills, "Expenses", v(F.committed) + `<i>${esc(w.short)}</i>`, `Of ${v(F.spendingBudget)}${w.short} set aside`, F.committed > F.spendingBudget + 0.5 ? "warn" : "")
                      : tile("spending", IC.bills, "Expenses", "—", "Add your regular bills", "empty"));
  }
  return `<div class="ho-figs" role="list">${T.map(t => `<div role="listitem">${t}</div>`).join("")}</div>`;
}

/* Phase 9B: the words come from ui/insight-view.js (the same as Budget and Expenses); Home adds icons. */
const ICON_OF = { pay: IC.pay, payday: IC.cal, left: IC.plan, over: IC.plan, short: IC.bills, nobudget: IC.bills, accounts: IC.acct, review: IC.review, goal: IC.goal, bills: IC.bills, unmarked: IC.bills, amounts: IC.bills, snapshot: IC.snap };
const ACT = new Proxy({}, { get: (_, k) => a => ({ icon: ICON_OF[k] || IC.plan, ...insightCopy(a) }) });
function actions(S, C) {
  if (readOnly()) return "";
  const L = homeActions(S, C, { snapshots: app.snapshots });
  if (!L.length) return "";
  return `<section class="ho-next" aria-labelledby="hoNextT"><h2 id="hoNextT">Next steps</h2><ul class="card ho-list">${L.map(a => {
    const x = ACT[a.key](a);
    return `<li><button class="ho-act" type="button" data-home-go="${x.go}"${x.person ? ` data-home-person="${esc(x.person)}"` : ""}${x.click ? ` data-home-click="${esc(x.click)}"` : ""} data-home-act="${a.key}">
      <span class="ho-ic" aria-hidden="true">${x.icon}</span><span class="ho-act-t"><b>${esc(x.t)}</b><small>${esc(x.s)}</small></span>${IC.chev}</button></li>`;
  }).join("")}</ul></section>`;
}

function homeHTML() {
  const S = app.state, C = app.C, w = WORDS[S.viewAs], name = (myName() || "").split(/\s+/)[0];
  return `<div class="home" id="homeRoot">
    <section class="ho-greet"><h2>${esc(name ? `${hello()}, ${name}` : "Your money at a glance")}</h2></section>
    <div class="ho-grid"><div class="ho-col">${payCard(S, C, w)}${planCard(S, C, w)}</div>
    <div class="ho-col">${figures(S, C, w)}${actions(S, C)}</div></div>
  </div>`;
}

export function view() { return homeHTML(); }
/** Numbers changed (an edit, or someone else's): redraw Home from the same figures. */
export function fill() { const el = document.getElementById("homeRoot"); if (el && app.C) el.outerHTML = homeHTML(); }

/** Home's links: go to the screen (by its address, so Back works), then open the right sheet or button. */
export function initHome() {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-home-go]"); if (!b) return;
    const tab = b.dataset.homeGo, person = b.dataset.homePerson, click = b.dataset.homeClick;
    const then = () => {
      if (person) import("../budget-sheets.js").then(m => m.openPersonSheet(person, { focusName: false }));
      else if (click && !readOnly()) { const el = document.querySelector(`#app ${click.split(",").map(s => s.trim()).join(", #app ")}`); if (el) el.click(); }
    };
    if (location.hash === "#" + TAB_HASH[tab]) { then(); return; }
    location.hash = TAB_HASH[tab];
    setTimeout(then, 30);
  });
}

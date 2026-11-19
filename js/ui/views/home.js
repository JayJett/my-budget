/* A payday first, followed by the two separate questions about the budget. All
   displayed values come from the existing Home model and expense coverage model. */
import { app, readOnly, TAB_HASH } from "../ctx.js";
import { esc } from "../dom.js";
import { money } from "../../model/format.js";
import { WORDS } from "../../model/periods.js";
import { parseDate } from "../../model/util.js";
import { paydays, planStatus } from "../../model/home.js";
import { shortfallFix } from "../../model/rebalance.js";
import { coverage, commitments } from "../../model/intelligence.js";
import { primaryFinding } from "../insight-view.js";

const icon = path => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
const CAL = icon('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M8 3v4m8-4v4M4 10h16"/>');
const CARD = icon('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-13 4h3"/>');
const CHECK = icon('<path d="m5 12 4 4L19 6"/>');
const WARN = icon('<path d="M12 3 2 20h20L12 3zm0 6v4m0 3h.01"/>');
const ARROW = icon('<path d="M4 12h15m-5-5 5 5-5 5"/>');
const FORWARD = icon('<path d="m9 6 6 6-6 6"/>');

const fullDate = new Intl.DateTimeFormat("en-NZ", { weekday:"long", day:"numeric", month:"long" });
const shortDate = new Intl.DateTimeFormat("en-NZ", { weekday:"short", day:"numeric", month:"short" });
const when = d => d === 0 ? "Today" : d === 1 ? "Tomorrow" : "In " + d + " days";
const amount = v => { const formatted = money(v); return formatted.includes(".") ? formatted : formatted + ".00"; };
const per = (C, annual) => amount(C.v(annual)) + " " + WORDS[app.state.viewAs].per;
const label = person => person.name || "Unnamed person";

function linkAttrs(go, { person, click, id } = {}) {
  return 'data-home-go="' + go + '"' + (person && !readOnly() ? ' data-home-person="' + esc(person) + '"' : "")
    + (click && !readOnly() ? ' data-home-click="' + esc(click) + '"' : "") + (id ? ' data-home-act="' + esc(id) + '"' : "");
}

function statusIcon(svg, tone = "") {
  return '<span class="ind-row-icon ' + tone + '">' + svg + '</span>';
}
function statusRow(title, sub, svg, tone = "") {
  return statusIcon(svg, tone) + '<span class="ind-row-copy"><strong>' + esc(title) + '</strong>' +
    (sub ? '<small>' + esc(sub) + '</small>' : "") + '</span><span class="ind-chevron">' + FORWARD + '</span>';
}

function payCard(S, next, same) {
  if (!next) {
    const cta = readOnly() ? "" : '<button type="button" class="ind-primary" ' + linkAttrs("budget", { person:S.people[0]?.id }) + '>Add your pay</button>';
    return '<section class="ind-card ho-empty ho-pay"><p class="ind-kicker">Payday</p><h2>No regular pay yet</h2><p>Enter take-home pay to see your next payday.</p>' + cta + '</section>';
  }
  if (!next.date) {
    const cta = readOnly() ? "" : '<button type="button" class="ind-primary" ' + linkAttrs("budget", { person:next.id }) + '>Set a payday</button>';
    return '<section class="ind-card ho-empty ho-pay"><p class="ind-kicker">Your pay</p><h2>No payday set</h2><p>' + esc(label(next)) + ' · ' + amount(next.pay) + ' take-home pay</p>' + cta + '</section>';
  }
  const peers = same.map(person => '<button class="ind-row" type="button" data-pb-open="' + esc(person.id) + '">' +
    statusIcon(CAL, "ind-pastel") + '<span class="ind-row-copy"><strong>' + esc(label(person)) + '</strong><small>Also paid on this date</small></span>' +
    '<b class="ind-row-amount">' + amount(person.pay) + '</b></button>').join("");
  return '<section class="ind-card ho-pay" aria-labelledby="hoPayT">' +
    '<div class="ho-pay-top"><h2 class="ind-kicker" id="hoPayT">Next payday</h2><span class="ho-count">' + CAL + esc(when(next.inDays)) + '</span></div>' +
    '<p class="ind-amount ho-big">' + amount(next.pay) + '</p><p class="ho-date"><time datetime="' + esc(next.date) + '">' +
    esc(fullDate.format(parseDate(next.date))) + '</time></p><p class="ho-person">' + esc(label(next)) + ' · Take-home pay</p>' +
    '<button class="ind-primary ho-pb" type="button" data-pb-open="' + esc(next.id) + '">Open Payday Playbook ' + ARROW + '</button>' +
    (peers ? '<div class="ho-peers">' + peers + '</div>' : "") + '</section>';
}

function coverageRow(S, C) {
  const cv = coverage(S, C), todo = commitments(S, C).incompleteIds;
  const known = C.incTotal > 0 && ["covered", "even", "short", "nobudget"].includes(cv.state);
  const warning = cv.state === "short" || cv.state === "nobudget";
  const good = known && !warning && !todo.length;
  if (!known) {
    const finding = primaryFinding(S, C);
    return '<button type="button" class="ind-row" ' + linkAttrs(finding.act.go, { ...finding.act, id:finding.id }) + '>' +
      statusRow(finding.t, finding.s, CARD, "ind-pastel") + '</button>';
  }
  const title = cv.state === "short" ? "Expenses are over budget" : cv.state === "nobudget" ? "Expenses have no budget yet" :
    todo.length ? "Some expenses need amounts" : "Expenses are covered";
  const sub = cv.state === "short" ? per(C, cv.short) + " short" :
    cv.state === "nobudget" ? per(C, cv.planned) + " planned" : todo.length ?
    (todo.length === 1 ? "1 expense still to check" : todo.length + " expenses still to check") :
    cv.state === "even" ? "Exactly covered" : per(C, cv.unassigned) + " spare in bills plan";
  const fix = cv.state === "nobudget" && cv.allocation ? { go: "budget", click: '[data-edit-acc="' + CSS.escape(cv.allocation.id) + '"]', label:"Set a budget" } :
    todo.length ? {go:"spending", click:'[data-edit-sp="' + CSS.escape(todo[0]) + '"]', label:"Add expense amounts"} : null;
  return '<details class="ho-coverage"><summary class="ind-row">' + statusRow(title, sub, warning || todo.length ? WARN : CHECK, good ? "ind-positive" : "ind-warning") +
    '</summary><div class="ho-breakdown"><dl><div><dt>Planned expenses</dt><dd>' + per(C, cv.planned) + '</dd></div><div><dt>Set aside for expenses</dt><dd>' + per(C, cv.budget) +
    '</dd></div></dl><button class="ind-link" type="button" ' + linkAttrs(fix && !readOnly() ? fix.go : "spending", fix || {}) + '>' +
    (fix && !readOnly() ? fix.label : "Open Expenses") + '</button>' +
    (cv.state === "short" && !readOnly() && shortfallFix(S, C) ? ' <button class="ind-link" type="button" ' +
      linkAttrs("budget", { click:'[data-rb-open="fix"]', id:"short" }) + '>Adjust budget</button>' : "") + '</div></details>';
}

function allocationRow(C) {
  const status = planStatus(C);
  if (status.k === "none") return "";
  const title = status.k === "ok" ? "Pay fully allocated" : status.k === "over" ? "Pay is overallocated" : "Pay still to allocate";
  const sub = status.k === "ok" ? C.people.filter(p => p.annual > 0).map(label).join(" · ") :
    per(C, status.k === "over" ? status.over : status.left);
  return '<button class="ind-row" type="button" data-home-go="budget">' +
    statusRow(title, sub, status.k === "over" ? WARN : CARD, status.k === "over" ? "ind-warning" : "ind-pastel") + '</button>';
}
function otherPaydays(people) {
  if (!people.length) return "";
  return '<section class="ho-group"><h2>' + (people.length === 1 && people[0].date ? "Later payday" : "Other paydays") + '</h2><div class="ind-card ind-list">' +
    people.map(p => '<button class="ind-row" type="button" data-pb-open="' + esc(p.id) + '">' +
      statusRow(label(p), p.date ? shortDate.format(parseDate(p.date)) : "No payday yet", CAL, "ind-warm") + '</button>').join("") + '</div></section>';
}
function homeHTML() {
  const S = app.state, C = app.C, [next, ...rest] = paydays(S, C, app.today);
  const same = next?.date ? rest.filter(p => p.date === next.date) : [];
  return '<div class="home" id="homeRoot"><h2 class="ind-title">Home</h2>' + payCard(S, next, same) +
    '<section class="ho-group"><h2>Budget status</h2><div class="ind-card ind-list">' + coverageRow(S, C) + allocationRow(C) + '</div></section>' +
    otherPaydays(rest.filter(p => !same.includes(p))) + '</div>';
}
export function view() { return homeHTML(); }
export function fill() {
  const root = document.getElementById("homeRoot");
  if (!root || !app.C) return;
  const coverageOpen = root.querySelector(".ho-coverage")?.open;
  root.outerHTML = homeHTML();
  if (coverageOpen) {
    const details = document.querySelector("#homeRoot .ho-coverage");
    if (details) details.open = true;
  }
}

/** Follow a link only while its originating household and destination are current. */
export function initHome() {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-home-go]");
    if (!b) return;
    const { homeGo:tab, homePerson:person, homeClick:selector } = b.dataset;
    const store = app.store;
    const go = "#" + TAB_HASH[tab];
    const current = () => store?.isActive() && app.store === store && location.hash === go;
    const then = () => {
      if (!current() || readOnly()) return;
      if (person) import("../budget-sheets.js").then(m => { if (current() && !readOnly()) m.openPersonSheet(person, { focusName:false }); });
      else if (selector) {
        const target = document.querySelector("#app " + selector.split(",").map(s => s.trim()).join(", #app "));
        if (target) target.click();
      }
    };
    if (location.hash === go) { then(); return; }
    location.hash = go;
    if (person || selector) setTimeout(then, 30);
  });
}

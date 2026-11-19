/* Spending tab: the spending budget (pool) from the Budget tab, what's planned against it, and the
   expenses themselves, including yearly "sinking" bills.

   Layout only. Every figure comes from compute() (model/calc.js) through fill(), exactly as before,
   and every edit goes through the same boxes (data-l="sp" …) and handlers, in the editing sheet
   (ui/budget-sheets.js). These are planned costs, not money already spent, so the wording says
   "planned", "budget" and "remaining", never "spent". */
import { app, readOnly } from "../ctx.js";
import { esc } from "../dom.js";
import { K } from "../inputs.js";
import { WORDS, VIEWS } from "../../model/periods.js";
import { money, m0, pct, monthYear } from "../../model/format.js";
import { n, blank } from "../../model/util.js";
import { drawSplit } from "../charts.js";
import { spendLabel } from "./labels.js";
import { budgetUI } from "../budget-sheets.js";
import { itemIcon } from "../icons.js";
import { isObjectColour } from "../palette.js";
import { essentialsHTML, refreshEssentials } from "../insight-view.js";

/** The three expense types, with their (fixed) colours and small icons. Colours never follow the accent. */
export const SP_TYPES = [
  { key: "Fixed", col: "var(--cat-fixed)", help: "The same every time, like rent." },
  { key: "Flexible", col: "var(--cat-flex)", help: "Varies, and is where you have choice, like groceries." },
  { key: "Sinking", col: "var(--cat-sink)", help: "A bill that lands now and then, like car rego, saved for a little at a time." },
];
const ICON = {
  Fixed: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>',
  Flexible: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h10l-1 8.5H4z"/><path d="M6 5V4a2 2 0 0 1 4 0v1"/></svg>',
  Sinking: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h8v6a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 12.5z"/><path d="M5 6.5V5h6v1.5M6.5 9.5h3"/></svg>',
  Other: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="5"/></svg>',
};
export const typeIcon = t => ICON[t] || ICON.Other;
const typeInfo = t => SP_TYPES.find(x => x.key === t) || { key: t || "Other", col: "var(--faint)" };
const PERIOD_WORD = { Week: "weekly", Fortnight: "fortnightly", Month: "monthly", Year: "yearly" };
const isYearlySinking = s => s.type === "Sinking" && s.period === "Year";

function row(s, ui, i, L) {
  const t = typeInfo(s.type);
  return `<li class="ex">
    <button class="ex-row" type="button" data-edit-sp="${esc(s.id)}"${ui.reorder ? " disabled" : ""} aria-label="${esc(s.name || "Unnamed")}: edit" aria-describedby="expense-detail-${encodeURIComponent(s.id)} expense-value-${encodeURIComponent(s.id)}">
      <span class="ex-ic" style="--cat:${isObjectColour(s.colour) ? `var(--o-${s.colour})` : t.col}" aria-hidden="true">${itemIcon(s.icon) || typeIcon(t.key)}</span>
      <span class="ex-main"><span class="ex-name">${esc(s.name || "Unnamed")}</span>
        <span class="ex-sub" id="expense-detail-${encodeURIComponent(s.id)}">${ui.reorder ? esc(t.key) : K(`sp.${s.id}.cadence`)}${isYearlySinking(s) && !ui.reorder ? ` ${K(`sp.${s.id}.sk`, "chip")}` : ""}</span>
        ${isYearlySinking(s) && !ui.reorder ? `<span class="ex-prog" aria-hidden="true"><span data-k="sp.${esc(s.id)}.bar"></span></span>` : ""}</span>
      <span class="ex-amt" id="expense-value-${encodeURIComponent(s.id)}">${K(`sp.${s.id}.v`)}</span>${ui.reorder ? "" : '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'}</button>
    ${ui.reorder ? `<span class="mv-row"><button class="mv-btn" type="button" data-move="up" data-l="sp" data-i="${esc(s.id)}" aria-label="Move ${esc(s.name || "this")} up"${i === 0 ? " disabled" : ""}>↑</button><button class="mv-btn" type="button" data-move="down" data-l="sp" data-i="${esc(s.id)}" aria-label="Move ${esc(s.name || "this")} down"${i === L.length - 1 ? " disabled" : ""}>↓</button></span>` : ""}
  </li>`;
}

export function view() {
  const S = app.state, L = S.spend, w = WORDS[S.viewAs], ro = readOnly(), ui = budgetUI();
  const seg = `<div class="viewas seg-wrap"><div class="seg" role="group" aria-label="Show amounts per">${VIEWS.map(k => `<button type="button" data-viewas="${k}" aria-pressed="${k === S.viewAs}">${WORDS[k].noun[0].toUpperCase() + WORDS[k].noun.slice(1)}</button>`).join("")}</div></div>`;

  const summary = `<section class="ind-card sp-sum" aria-live="polite">
    <p class="ind-kicker">Planned expenses</p><p class="ind-amount">${K("sp.com")}</p><p class="ind-sub">${esc(w.per[0].toUpperCase() + w.per.slice(1))}</p>
    ${seg}
    <div class="ind-sp-funding"><span>Allocated to expenses</span><b>${K("sp.pool")}</b></div>
    <div class="sp-head" id="spHead"><span class="amt">${K("sp.head")}</span><span class="lab">${K("sp.head.lab")}</span></div>
    <p class="sp-nopool" data-k="sp.nopool" data-base="sp-nopool"></p>${K("sp.incomplete", "ind-sp-incomplete")}</section>`;
  const breakdown = `<details class="ind-card ind-detail sp-detail"><summary>Expense breakdown</summary>
    ${essentialsHTML(S, app.C)}
    <div class="sp-bar-wrap"><div class="split sp-bar" id="poolsplit" role="img" aria-label="Spending budget breakdown"></div></div>
    <div class="split-key" id="poolkey"></div>
    <p class="sp-funding-source">${esc(spendLabel(S))}</p><p>Budget: ${K("sp.pool.y")}. Planned: ${K("sp.com.y")}. Used: ${K("sp.used")}.</p>
    <p>${K("sp.buf.s")}: ${K("sp.buf")} ${esc(w.per)}. ${K("sp.sinkhelp")}.</p></details>`;

  let list;
  if (!L.length) list = `<section class="card sp-empty"><div class="sp-empty-ic" aria-hidden="true">${typeIcon("Flexible")}</div><h2>No expenses yet</h2>
    <p class="dim">Add what this budget pays for: rent, groceries, the yearly car rego.</p>${ro ? "" : `<div class="sp-empty-acts"><button class="btn primary" type="button" data-xp-open>Choose from common expenses</button></div>`}</section>`;
  else if (ui.reorder) list = `<section class="sp-list">
    <div class="b-row sec"><h2>Regular expenses</h2><button class="btn small ghost" type="button" data-reorder aria-pressed="true">Done</button></div>
    <p class="dim small-note">Move expenses up or down. The order is kept within each type.</p>
    <ul class="card ex-list reordering">${L.map((s, i) => row(s, ui, i, L)).join("")}</ul></section>`;
  else {
    const known = SP_TYPES.map(t => t.key), groups = [...SP_TYPES.map(t => t.key), ...new Set(L.map(s => s.type).filter(t => !known.includes(t)))];
    list = `<section class="sp-list">
      <div class="b-row sec"><h2>Regular expenses</h2>${ro ? "" : `<button class="btn small ghost" type="button" data-reorder aria-pressed="false">Reorder</button>`}</div>
      ${groups.map(g => {
        const items = L.filter(s => (s.type || "") === g); if (!items.length) return "";
        const t = typeInfo(g);
        return `<div class="ex-group" style="--cat:${t.col}"><div class="ex-gh"><h3>${esc(g || "Other")}</h3>${ro ? "" : `<button class="icon-add" type="button" data-sp-new="${esc(g)}" aria-label="Add a ${esc(g.toLowerCase())} expense">+</button>`}</div>
          <ul class="ind-card ex-list">${items.map(s => row(s, ui, L.indexOf(s), L)).join("")}</ul></div>`;
      }).join("")}
      ${ro ? "" : `<p class="sp-more"><button class="ind-link" type="button" data-xp-open>Choose suggested expenses</button></p>`}
    </section>`;
  }
  return `<div class="ind-finance sp-page"><div class="ind-page-head"><h2 class="ind-title">Expenses</h2>${ro || ui.reorder ? "" : '<button class="ind-link" type="button" data-sp-new="Flexible">+ Add expense</button>'}</div><div class="ind-fin-summary">${summary}</div><div class="ind-fin-list">${list}${breakdown}</div></div>`;
}

/** "over", "under", "even" (matches to the cent shown) or "nopool". */
function spState(C) {
  const buf = C.v(C.spBuffer);
  return !(C.pool.spending > 0.004) ? "nopool" : Math.abs(buf) < 0.005 ? "even" : buf < 0 ? "over" : "under";
}

export function fill(D, C) {
  const v = C.v, w = WORDS[C.view];
  const incomplete = C.sp.filter(s => s.annual !== null && blank(s.amount)).length;
  D["sp.incomplete"] = incomplete ? `${incomplete} ${incomplete === 1 ? "expense needs" : "expenses need"} an amount` : "";
  D["sp.pool"] = money(v(C.pool.spending)); D["sp.pool.y"] = `From the budget, ${m0(C.pool.spending)} a year`;
  D["sp.com"] = money(v(C.committed)); D["sp.com.y"] = `Across categories, ${m0(C.committed)} a year`;
  D["sp.buf"] = money(v(C.spBuffer)); D["sp.buf.s"] = C.spBuffer >= 0 ? "Not yet assigned to an expense" : "Over budget"; // (Phase 9B: a plan, not spare cash)
  C.sp.forEach(s => {
    const todo = s.annual !== null && blank(s.amount); // Phase 9C.1: named, amount still to come (not $0)
    D[`sp.${s.id}.v`] = s.annual === null || todo ? "" : money(v(s.annual));
    D[`sp.${s.id}.p`] = s.annual === null || !C.pool.spending ? "" : pct(s.annual / C.pool.spending, 1);
    if (s.type === "Sinking" && s.period === "Year") {
      const k = s.sink;
      D[`sp.${s.id}.sk`] = !k ? (blank(s.due) && n(s.amount) > 0 ? { t: "Pick a due month", c: "warn" } : { t: "", c: "" }) : k.st;
      D[`sp.${s.id}.sk2`] = !k ? "" : `Due ${monthYear(k.next)}, ${k.periodsAway} ${k.periodsAway === 1 ? w.noun : w.plural} away${k.need ? `. Needs ${money(k.need)}${w.short}` : ""}`;
      // new: the thin progress bar on the row (set aside ÷ the bill), and the "Due Oct 2026" line
      D[`sp.${s.id}.bar`] = { w: k && k.A > 0 ? Math.min(1, n(s.aside) / k.A) : 0 };
    }
    // new: for the editing sheet
    D[`sp.${s.id}.pb`] = s.annual === null || !C.pool.spending ? "" : ` · ${pct(s.annual / C.pool.spending, 1)} of budget`;
    D[`sp.${s.id}.about`] = s.annual === null ? (blank(s.name) ? "Add a name to count this expense." : "") : `About ${money(v(s.annual))} ${w.per}`;
    if (s.type === "Sinking" && s.period === "Year") D[`sp.${s.id}.saved`] = `${money(n(s.aside))} set aside of ${money(n(s.amount))}`;
    // new: the small line under each expense, and "/fn" next to its amount
    D[`sp.${s.id}.per`] = s.annual === null || todo ? "" : w.short;
    D[`sp.${s.id}.sub`] = s.annual === null ? "Add a name to count it" : todo ? "Needs an amount"
      : s.type === "Sinking" && s.period === "Year" ? (s.sink ? `${money(n(s.amount))} · due ${monthYear(s.sink.next)}` : `${money(n(s.amount))} a year`)
      : s.period && s.period.toLowerCase() !== C.view ? `${money(n(s.amount))} ${PERIOD_WORD[s.period] || ""}`.trim()
      : (s.notes || "").trim().slice(0, 60);
    D[`sp.${s.id}.cadence`] = s.annual === null || todo || isYearlySinking(s) ? D[`sp.${s.id}.sub`] : PERIOD_WORD[s.period] || "";
  });
  D["sp.tot"] = money(v(C.committed)); D["sp.totp"] = C.pool.spending ? pct(C.committed / C.pool.spending, 1) : "";
  const fx = C.spType("Fixed"), fl = C.spType("Flexible"), sk = C.spType("Sinking");
  D["sp.fixed"] = money(v(fx)); D["sp.flex"] = money(v(fl)); D["sp.sink"] = money(v(sk));
  D["sp.sinkhelp"] = `Builds to ${m0(sk)} across the year for bills that land once`;

  // new: the headline. Compared at the cents shown, so rounding never shows "−$0.00 over".
  const buf = v(C.spBuffer), noPool = !(C.pool.spending > 0.004);
  const state = spState(C);
  D["sp.head"] = state === "over" ? money(-buf) : state === "under" ? money(buf) : state === "even" ? "On budget" : money(v(C.committed));
  D["sp.head.lab"] = { over: "over budget", under: "not yet assigned to an expense", even: "✓ planned spending matches the budget", nopool: "planned" }[state];
  refreshEssentials();
  D["sp.used"] = D["sp.totp"] || "—";
  D["sp.nopool"] = { t: noPool ? "There’s no spending budget yet. Give this budget’s spending account a share of pay on the Budget tab." : "", c: noPool ? "on" : "" };
}

export function draw(C) {
  const v = C.v, $ = s => document.querySelector(s);
  const pp = $("#poolsplit"); if (!pp) return;
  const parts = [...SP_TYPES.map(t => ({ name: t.key, v: v(C.spType(t.key)), col: t.col })), { name: "Remaining", v: Math.max(v(C.spBuffer), 0), col: "var(--unalloc)" }];
  const total = Math.max(v(C.pool.spending), v(C.committed));
  // Over budget: the bar is the whole plan, with a line where the budget ends.
  const state = spState(C), over = state === "over";
  const head = $("#spHead"); if (head) head.className = "sp-head " + state;
  drawSplit(pp, parts, total, over ? [v(C.pool.spending) / total] : []);
  pp.classList.toggle("over", over);
  const words = parts.filter(p => p.v > 0).map(p => `${p.name} ${money(p.v)}`);
  pp.setAttribute("aria-label", (`${words.join(", ")}${over ? `. Over budget by ${money(v(-C.spBuffer))}` : ""}`) || "Nothing planned yet");
  $("#poolkey").innerHTML = parts.filter(p => p.v > 0 || p.name !== "Remaining").map(p => `<span><i style="background:${p.col}"></i>${p.name} ${money(p.v)}</span>`).join("")
    + (over ? `<span class="over-tag">▲ Over by ${money(v(-C.spBuffer))}</span>` : "");
}

/* Budget tab: income, how much is allocated, the allocations, the fair split, and optional insights.

   Layout only. Every figure comes from compute() (model/calc.js) through fill(), exactly as before,
   and every edit goes through the same boxes (data-l / data-i / data-f) and handlers (events.js),
   now inside editing sheets (ui/budget-sheets.js) instead of a big table. */
import { app, readOnly } from "../ctx.js";
import { esc } from "../dom.js";
import { K, attrs, pc } from "../inputs.js";
import { MAX_PEOPLE, isShared } from "../../model/schema.js";
import { transitionNote } from "../household-mode.js";
import { itemIcon } from "../icons.js";
/** An allocation's icon: the one picked for it, or one that fits what it's for (Phase 8). */
export const accIconKey = a => a.icon && itemIcon(a.icon) ? a.icon
  : { spending: "home", emergency: "shield", goals: "target", personalGoals: "star", invest: "trend" }[a.role]
  || (a.type === "Investment" ? "trend" : /debt|loan|card/i.test(a.name || "") ? "card" : /spend|fun/i.test(a.name || "") ? "wallet" : "coins");
export const accIcon = a => itemIcon(accIconKey(a));
import { WORDS, VIEWS, perYear, freqToView } from "../../model/periods.js";
import { money, m0, pct, listNames } from "../../model/format.js";
import { drawDonuts, drawFlow, drawSplit, personVar } from "../charts.js";
import { spendLabel } from "./labels.js";
import { budgetUI } from "../budget-sheets.js";
import { planCheckHTML, refreshPlanCheck } from "../insight-view.js";
import { coverage } from "../../model/intelligence.js";

const CHEV = `<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TYPE_WORD = { Joint: "Joint", Personal: "Personal", Investment: "Investment" };
const initial = p => (p.name || "?").trim().charAt(0).toUpperCase() || "?";

/** On your own, an allocation is described by what it's for, not whose it is (it's all yours). */
const PURPOSE = { spending: "Bills", emergency: "Safety net", goals: "Goals", personalGoals: "Goals", invest: "Investing" };
export const purposeWord = a => PURPOSE[a.role] || (a.type === "Investment" ? "Investing" : "Yours");
/** "Joint", "Personal · Madi", "Investment"; on your own: "Bills & spending", "Goals", "Investing"… */
function typeLine(a, P, S) {
  if (!isShared(S)) return purposeWord(a);
  const owner = a.owner && P.length > 1 ? P.find(p => p.id === a.owner) : null;
  return [TYPE_WORD[a.type] || a.type || "", owner ? owner.name || "Unnamed" : ""].filter(Boolean).join(" · ");
}

export function view() {
  const S = app.state, P = S.people, multi = P.length > 1, w = WORDS[S.viewAs], ro = readOnly();
  const ui = budgetUI();
  const seg = `<div class="viewas seg-wrap"><div class="seg" role="group" aria-label="Show amounts per">${VIEWS.map(k => `<button type="button" data-viewas="${k}" aria-pressed="${k === S.viewAs}">${WORDS[k].noun[0].toUpperCase() + WORDS[k].noun.slice(1)}</button>`).join("")}</div></div>`;

  const income = `<section class="card b-income">
    <div class="b-row"><span class="eyebrow">${multi ? "Household income" : "Income"}</span>${seg}</div>
    <div class="hero-amt"><span class="amt">${K("inc.c")}</span><span class="per">${esc(w.per)}</span></div>
    ${multi ? `<div class="ribbon" id="ribbon" aria-hidden="true"></div>` : ""}
    <ul class="members">${P.map(p => `<li><button class="member-row ${pc(p)}" type="button" data-edit-person="${esc(p.id)}" aria-label="${esc(p.name || "Unnamed")}: pay and settings">
        <span class="av">${esc(initial(p))}</span>
        <span class="m-main"><span class="m-name">${esc(p.name || "Unnamed")}</span><small>${K(`pp.${p.id}.line`)}</small></span>
        <span class="m-amt">${K(`inc.${p.id}.v`)}${multi ? `<small>${K(`inc.${p.id}.share`)}</small>` : ""}</span>${CHEV}</button></li>`).join("")}</ul>
    ${!ro && P.length < MAX_PEOPLE ? `<button class="link-btn" type="button" data-person-new>+ Add a person</button>` : ""}
  </section>`;

  const status = `<section class="card b-status" id="allocStatus" aria-live="polite">
    <div class="b-row"><h2>Allocated</h2>${K("st.summary", "chip")}</div>
    <ul class="st-list">${P.map(p => `<li class="${pc(p)}">
      ${multi ? `<span class="st-name">${esc(p.name || "Unnamed")}</span>` : ""}
      <span class="st-bar"><span data-k="st.${esc(p.id)}.bar"></span></span>
      <span class="st-v">${K(`st.${p.id}.t`, "st-t")}</span>${ro ? "" : `<span data-k="fill.${esc(p.id)}"></span>`}</li>`).join("")}</ul>
  </section>`;

  const allocs = `${transitionNote()}<section class="b-allocs">
    <div class="b-row sec"><h2>Your allocations</h2>${ro ? "" : `<button class="btn small ghost" type="button" data-reorder aria-pressed="${ui.reorder}">${ui.reorder ? "Done" : "Reorder"}</button>`}</div>
    <ul class="card alloc-list${ui.reorder ? " reordering" : ""}">${S.accounts.map((a, i) => `<li class="alloc">
      <button class="alloc-row" type="button" data-edit-acc="${esc(a.id)}"${ui.reorder ? " disabled" : ""} aria-label="${esc(a.name || "Unnamed")}: edit">
        <span class="a-ic" data-k="acc.${esc(a.id)}.ic" aria-hidden="true">${accIcon(a)}</span>
        <span class="a-main"><span class="a-name">${esc(a.name || "Unnamed")}</span>
          <span class="a-meta">${esc(typeLine(a, P, S))}${multi ? "" : ` · ${K(`acc.${a.id}.pct.${P[0].id}`)}`}</span>
          ${a.role === "spending" ? `<span data-k="acc.${esc(a.id)}.cov" data-base="a-cov"></span>` : ""}
          ${multi ? `<span class="a-parts">${P.map(p => `<span data-k="acc.${esc(a.id)}.part.${esc(p.id)}" data-base="a-part ${pc(p)}" class="a-part ${pc(p)}"></span>`).join("")}</span>` : ""}</span>
        <span class="a-amt">${K(`acc.${a.id}.t`)}<small>${esc(w.short)}</small></span>${ui.reorder ? "" : CHEV}</button>
      ${ui.reorder ? `<span class="mv-row"><button class="mv-btn" type="button" data-move="up" data-l="acc" data-i="${esc(a.id)}" aria-label="Move ${esc(a.name || "this")} up"${i === 0 ? " disabled" : ""}>↑</button><button class="mv-btn" type="button" data-move="down" data-l="acc" data-i="${esc(a.id)}" aria-label="Move ${esc(a.name || "this")} down"${i === S.accounts.length - 1 ? " disabled" : ""}>↓</button></span>` : ""}
    </li>`).join("")}</ul>
    ${ro ? "" : `<button class="add-row" type="button" data-acc-new>+ Add allocation</button>`}
  </section>`;

  const fair = `<section class="card b-fair" id="fairSec" hidden>
    <div class="b-row"><h2>Fair split</h2></div>
    <p class="fair-verdict">${K("fair.verdict")}</p>
    <div class="fbar-row"><div class="lab"><span>Income</span><span>${K("fair.inc")}</span></div><div class="fbar" id="fbInc"></div></div>
    <div class="fbar-row"><div class="lab"><span>Shared money</span><span>${K("fair.sh")}</span></div><div class="fbar" id="fbSh"></div></div>
    <div class="split-key">${P.map(p => `<span><i style="background:${personVar(p)}"></i>${esc(p.name || "Unnamed")}</span>`).join("")}<span>${K("fair.line")}</span></div>
    <details class="more"><summary>See the numbers</summary><p>${K("fair.detail")}</p><p>${K("fair.personal")}</p>
      <p class="dim">Shared money is what goes to joint accounts and investments. Splitting equally and splitting by income are both fair; this shows which one you’re doing.</p></details>
  </section>`;

  const open = k => ui.open.has(k) ? " open" : "";
  const check = planCheckHTML(S, app.C);
  const insights = `<section class="card b-insights">
    <details data-ins="where"${open("where")}><summary><span>Where it goes</span><small>${K("ins.where")}</small></summary>
      <ul class="dest">
        ${isShared(S) ? `<li><span class="dotc" style="background:var(--joint)"></span><span>Joint accounts</span><b>${K("sum.joint")}</b><small>${K("sum.joint.y")}</small></li>
        <li><span class="dotc" style="background:var(--c-${esc(P[0].colour)})"></span><span>Personal accounts</span><b>${K("sum.personal")}</b><small>${K("sum.personal.y")}</small></li>`
        : `<li><span class="dotc" style="background:var(--joint)"></span><span>Spending and saving</span><b>${K("sum.own")}</b><small>${K("sum.own.y")}</small></li>`}
        <li><span class="dotc" style="background:var(--invest)"></span><span>Investments</span><b>${K("sum.investment")}</b><small>${K("sum.investment.y")}</small></li>
      </ul>
      <h3 class="mini">Investing vs cash savings</h3>
      <div class="split" id="invsplit"></div>
      <div class="split-key"><span><i style="background:var(--invest)"></i>${K("ivc.inv")}</span><span><i style="background:var(--joint)"></i>${K("ivc.cash")}</span></div>
    </details>
    <details data-ins="flow"${open("flow")}><summary><span>Money flow</span><small>Pay → accounts → ${esc(spendLabel(S).toLowerCase())}</small></summary>
      <div class="flow-wrap" id="flow" tabindex="0" aria-label="Money flow chart (scrolls sideways on small screens)"></div>
      <div class="flow-cap">${P.map(p => `<span><i style="background:${personVar(p)}"></i>From ${esc(p.name || "Unnamed")}</span>`).join("")}<span><i style="background:var(--unalloc)"></i>Not allocated / buffer</span></div>
    </details>
    <details data-ins="charts"${open("charts")}><summary><span>Breakdown charts</span><small>Each person’s pay, by account</small></summary>
      <div class="viz" id="donuts"></div><div class="legend" id="legend"></div>
    </details>
  </section>`;

  const note = `<div class="b-note"><input class="note-input" ${attrs("root", "", "note", "text")} value="${esc(S.note)}" placeholder="Add a note" aria-label="Budget note">${S.note && !ro ? '<button class="note-x" type="button" id="noteX" aria-label="Remove note">×</button>' : ""}</div>`;

  // Phones: one column in this order. Wide screens: income, status and fair split on the left; allocations on the right.
  return `<div class="budget"><div class="b-col">${income}${status}${multi ? fair : `<div id="fairSec" hidden></div>`}</div><div class="b-col">${allocs}${check}${insights}${note}</div></div>`;
}

/** Other periods, for the line under each pay: "≈ $2,000 a fortnight, $4,333 a month, $52,000 a year". */
function equivalents(annual, skip) {
  return "≈ " + [...VIEWS.filter(v => v !== skip).map(v => `${m0(annual / perYear(v))} a ${WORDS[v].noun}`), `${m0(annual)} a year`].join(", ");
}
const FREQ_WORD = { weekly: "weekly", fortnightly: "fortnightly", monthly: "monthly" };

export function fill(D, C) {
  const v = C.v, w = WORDS[C.view];
  C.people.forEach(p => {
    D[`inc.${p.id}.sub`] = equivalents(p.annual, freqToView(p.freq));
    const xp = C.extraPay[p.id];
    D[`p27.${p.id}`] = p.freq === "monthly" ? { t: "Monthly pay always has 12 paydays a year.", c: "" }
      : xp === null ? { t: `Add a payday to check for ${p.freq === "weekly" ? "53" : "27"}-pay years.`, c: "" }
      : xp.length ? { t: `${xp[0].count} paydays in ${xp.slice(0, 3).map(x => x.year === app.today.getFullYear() ? x.year + " (this year)" : x.year).join(", ")}: one extra pay of ${m0(p.pay || 0)}`, c: "hit" }
      : { t: `No ${p.freq === "weekly" ? "53" : "27"}-pay years in the next 20 years.`, c: "" };
    // new for the redesign: each person's pay in the chosen period, their share, and a short pay line
    D[`inc.${p.id}.v`] = money(v(p.annual));
    D[`inc.${p.id}.share`] = C.incTotal ? pct(p.annual / C.incTotal) : "";
    const extra = xp && xp.length && xp[0].year === app.today.getFullYear() ? ` · ${xp[0].count} pays this year` : "";
    D[`pp.${p.id}.line`] = p.annual > 0 ? `${m0(p.pay || 0)} ${FREQ_WORD[p.freq] || ""}${extra}` : "Add pay";
  });
  D["inc.c"] = m0(v(C.incTotal)); D["inc.c.sub"] = equivalents(C.incTotal, C.view);
  C.rows.forEach(r => {
    C.people.forEach(p => {
      D[`acc.${r.id}.v.${p.id}`] = money(v(r.by[p.id])); D[`acc.${r.id}.b.${p.id}`] = { pw: p.annual ? r.by[p.id] / p.annual : 0 };
      // new: "Madi $427.50" chips (hidden when someone puts nothing in), and "25% of pay"
      D[`acc.${r.id}.part.${p.id}`] = { t: `${p.name || "Unnamed"} ${money(v(r.by[p.id]))}`, c: r.by[p.id] > 0.004 ? "" : "zero" };
      D[`acc.${r.id}.pct.${p.id}`] = `${pct(Number(r.split[p.id]) || 0, 1)} of pay`;
    });
    D[`acc.${r.id}.t`] = money(v(r.t)); D[`acc.${r.id}.tb`] = { pw: C.incTotal ? r.t / C.incTotal : 0 };
    D[`acc.${r.id}.sw`] = { bg: app.colours[r.id] }; D[`acc.${r.id}.ic`] = { oc: app.colours[r.id] };
  });
  const check100 = x => Math.round(x * 1e4) === 1e4 ? { t: "100%", c: "ok" } : { t: pct(x, 1), c: "bad" };
  C.people.forEach(p => { D[`tot.p.${p.id}`] = pct(C.tot.pct[p.id], 1); D[`tot.a.${p.id}`] = money(v(C.tot.amt[p.id])); D[`tot.c.${p.id}`] = check100(C.tot.pct[p.id]); });
  D["tot.t"] = money(v(C.tot.t));

  // Allocation status, from the same totals the old meter used
  const st = C.people.map(p => {
    const x = C.tot.pct[p.id], ok = Math.round(x * 1e4) === 1e4, left = p.annual - C.tot.amt[p.id];
    if (!(p.annual > 0)) return { p, k: "none", t: "No pay yet" };
    if (ok) return { p, k: "ok", t: C.people.length > 1 ? "All allocated ✓" : "100% ✓" };
    if (x < 1) return { p, k: "left", t: `${pct(1 - x, 1)} left · ${money(v(left))}` };
    return { p, k: "over", t: `Over by ${pct(x - 1, 1)} · ${money(v(-left))}` };
  });
  st.forEach(s => {
    D[`st.${s.p.id}.t`] = { t: s.t, c: s.k };
    D[`st.${s.p.id}.bar`] = { w: Math.min(1, Math.max(0, C.tot.pct[s.p.id])) };
  });
  const earners = st.filter(s => s.k !== "none");
  D["st.summary"] = !earners.length ? { t: "Add pay to start", c: "" }
    : earners.some(s => s.k === "over") ? { t: "⚠ Over-allocated", c: "bad" }
    : earners.every(s => s.k === "ok") ? { t: C.people.length > 1 ? "✓ All income allocated" : "✓ All allocated", c: "ok" }
    : { t: "Some left to allocate", c: "warn" };

  const yr = x => `${m0(x)} a year`;
  D["sum.joint"] = money(v(C.joint)); D["sum.joint.y"] = `${w.per}, ${yr(C.joint)}`;
  D["sum.personal"] = money(v(C.personal)); D["sum.personal.y"] = `${w.per}, ${yr(C.personal)}`;
  D["sum.investment"] = money(v(C.investment)); D["sum.investment.y"] = `${w.per}, ${yr(C.investment)}`;
  D["sum.own"] = money(v(C.joint + C.personal)); D["sum.own.y"] = `${w.per}, ${yr(C.joint + C.personal)}`;
  // Phase 9B: does the bills allocation cover the entered expenses?
  const cv = coverage(app.state, C);
  if (cv.allocation) D[`acc.${cv.allocation.id}.cov`] = cv.state === "short" ? { t: `Short of expenses by ${money(v(cv.short))}${w.short}`, c: "bad" }
    : cv.state === "covered" || cv.state === "even" ? { t: "✓ Covers your entered expenses", c: "ok" } : cv.state === "nobudget" ? { t: "No budget for your expenses yet", c: "bad" } : { t: "", c: "" };
  refreshPlanCheck();
  D["ins.where"] = isShared(app.state) ? `Joint ${m0(v(C.joint))} · Personal ${m0(v(C.personal))} · Invest ${m0(v(C.investment))}`
    : `Spend & save ${m0(v(C.joint + C.personal))} · Invest ${m0(v(C.investment))}`;
  const ivc = C.investment + C.cash;
  D["ivc.inv"] = `Investing ${money(v(C.investment))}${ivc ? ` (${pct(C.investment / ivc)})` : ""}`; D["ivc.cash"] = `Cash savings ${money(v(C.cash))}${ivc ? ` (${pct(C.cash / ivc)})` : ""}`;

  // fair split (2+ earners only)
  const E = C.earners, sh = C.fairShared;
  const shareText = (get, total) => total ? E.map(p => pct(get(p) / total)).join(" / ") : "";
  D["fair.inc"] = shareText(p => p.annual, C.incTotal);
  D["fair.sh"] = shareText(p => C.fair[p.id].shared, sh);
  D["fair.line"] = E.length === 2 ? "The line marks 50/50" : E.length > 2 ? "The lines mark an equal split" : "";
  D["fair.verdict"] = C.fairVerdict ? C.fairVerdict.t : "";
  D["fair.detail"] = sh ? `${E.map(p => `${p.name || "Unnamed"} puts in ${money(v(C.fair[p.id].shared))}`).join(", ")} ${w.per} to joint accounts and investments. An equal split would be ${money(v(sh / E.length))} each.` : "";
  D["fair.personal"] = `Kept for yourselves: ${listNames(E.map(p => `${p.name || "Unnamed"} ${money(v(C.fair[p.id].personal))} (${p.annual ? pct(C.fair[p.id].personal / p.annual) : "0%"} of their pay)`))}.`;

  // "Fill" buttons, where someone's pay isn't fully allocated
  C.people.forEach(p => {
    const rem = 1 - C.tot.pct[p.id];
    document.querySelectorAll(`[data-k="fill.${CSS.escape(p.id)}"]`).forEach(el => el.innerHTML = rem > 0.00005 && p.annual > 0 ? `<button class="fill-btn" type="button" data-fill="${esc(p.id)}">Fill ${pct(rem, 1)}</button>` : "");
  });
}

export function draw(C) {
  const v = C.v, $ = s => document.querySelector(s);
  const rib = $("#ribbon"); if (rib) rib.innerHTML = C.incTotal ? C.people.map(p => `<span style="width:${p.annual / C.incTotal * 100}%;background:${personVar(p)}"></span>`).join("") : "";
  drawDonuts(C, app.colours, app.state, WORDS[C.view]);
  drawFlow(C, app.colours, spendLabel(app.state));
  drawSplit($("#invsplit"), [{ name: "Investing", v: v(C.investment), col: "var(--invest)" }, { name: "Cash savings", v: v(C.cash), col: "var(--joint)" }], v(C.investment + C.cash));
  const fs = $("#fairSec");
  if (fs) {
    fs.hidden = !C.showFair;
    const E = C.earners, marks = E.length >= 2 ? E.slice(1).map((_, i) => (i + 1) / E.length) : [];
    drawSplit($("#fbInc"), E.map(p => ({ name: p.name, v: p.annual, col: personVar(p) })), C.incTotal, marks);
    drawSplit($("#fbSh"), E.map(p => ({ name: p.name, v: C.fair[p.id].shared, col: personVar(p) })), C.fairShared, marks);
  }
}

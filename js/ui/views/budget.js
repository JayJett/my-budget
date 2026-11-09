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
import { paydays } from "../../model/home.js";
import { parseDate } from "../../model/util.js";
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

/* ---------- Phase 10A: how things are shown (never what they're worth) ----------
   Names: in a shared budget, an allocation that belongs to someone is often named after them
   ("Jarden — Personal Goals", "Madi Spending"). Their name is already on the line underneath, in their
   colour, so the row just says "Personal Goals". Only the words on screen change: the saved name is
   untouched, and the edit sheet (and screen readers) still have it in full. */
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function shortName(a, P, S) {
  const full = a.name || "Unnamed";
  if (!a.owner || !isShared(S) || P.length < 2) return full;
  const o = P.find(p => p.id === a.owner), nm = o && (o.name || "").trim();
  if (!nm) return full;
  const m = full.match(new RegExp(`^${reEsc(nm)}(?:['’]s)?(?=[\\s—–\\-:·|])[\\s—–\\-:·|]+(.+)$`, "i"));
  const rest = m ? m[1].trim() : "";
  return rest.length >= 2 ? rest.charAt(0).toUpperCase() + rest.slice(1) : full;
}
const DOWN = `<svg class="dn" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>`;
let incMore = false; // "Pay details" open or closed (kept across redraws)
export const incMoreOpen = () => incMore;
export function toggleIncMore(btn) {
  incMore = !incMore;
  const box = document.getElementById("incMore"); if (box) box.hidden = !incMore;
  if (btn) btn.setAttribute("aria-expanded", String(incMore));
}

export function view() {
  const S = app.state, P = S.people, multi = P.length > 1, w = WORDS[S.viewAs], ro = readOnly();
  const ui = budgetUI(), anyPay = P.some(p => Number(p.pay) > 0);
  const seg = `<div class="viewas seg-wrap bi-seg"><div class="seg" role="group" aria-label="Show amounts per">${VIEWS.map(k => `<button type="button" data-viewas="${k}" aria-pressed="${k === S.viewAs}">${WORDS[k].noun[0].toUpperCase() + WORDS[k].noun.slice(1)}</button>`).join("")}</div></div>`;

  // 1. Income: the total, a slim bar of who brings in what (couples and more), one tap per person.
  //    Each person's actual pay, how often, and adding someone are under "Pay details".
  const people = `<ul class="bi-people${multi ? " multi" : ""}">${P.map(p => `<li><button class="bi-p ${pc(p)}" type="button" data-edit-person="${esc(p.id)}" aria-label="${esc(p.name || "Unnamed")}: pay and settings">
      <span class="bi-name m-name">${esc(p.name || "Unnamed")}</span>
      ${multi ? `<span class="bi-v">${K(`inc.${p.id}.v`)}</span><span class="bi-sh">${K(`inc.${p.id}.share`)}</span>` : `<span class="bi-line">${K(`pp.${p.id}.freq`)}</span>`}${CHEV}</button></li>`).join("")}</ul>`;
  const more = `<div class="bi-more" id="incMore"${incMore ? "" : " hidden"}>
      <ul class="bi-pays">${P.map(p => `<li class="${pc(p)}"><b>${esc(p.name || "Unnamed")}</b><span>${K(`pp.${p.id}.line`)}</span><small>${K(`inc.${p.id}.sub`)}</small></li>`).join("")}</ul>
      ${!ro && P.length < MAX_PEOPLE ? `<button class="link-btn bi-add" type="button" data-person-new>+ Add a person</button>` : ""}</div>`;
  const income = `<section class="card b-income">
    <div class="bi-top"><span class="eyebrow">${multi ? "Household income" : "Income"}</span>${seg}</div>
    <p class="bi-amt"><span class="amt">${K("inc.c")}</span><span class="per">${esc(w.per)}</span></p>
    ${multi ? `<div class="bi-bar split" id="incBar" role="img"></div>` : ""}
    ${people}
    <div class="b-inc-acts"><button class="link-btn bi-more-btn" type="button" data-inc-more aria-expanded="${incMore}" aria-controls="incMore">Pay details${DOWN}</button></div>
    ${more}
  </section>`;

  // 2. Status: one card. How much has a plan (people only listed when someone isn't done), whether the
  //    entered expenses fit their budget (its own check, never implied by the first), and the next payday.
  const status = `<section class="card b-status" id="allocStatus" aria-live="polite">
    <div class="bs-top"><span data-k="st.ic" data-base="bs-ic" class="bs-ic" aria-hidden="true"></span>
      <div class="bs-t"><p class="bs-h">${K("st.summary")}</p><p class="bs-s">${K("st.sub")}</p></div></div>
    <ul class="st-list" hidden>${P.map(p => `<li class="${pc(p)}" data-st="${esc(p.id)}">
      ${multi ? `<span class="st-name">${esc(p.name || "Unnamed")}</span>` : ""}
      <span class="st-bar"><span data-k="st.${esc(p.id)}.bar"></span></span>
      <span class="st-v">${K(`st.${p.id}.t`, "st-t")}</span>${ro ? "" : `<span data-k="fill.${esc(p.id)}"></span>`}</li>`).join("")}</ul>
    ${planCheckHTML(S, app.C)}
    ${anyPay ? `<button class="bs-pay" type="button" data-pb-open><span class="bs-pay-ic">${CAL}</span><span class="bs-pay-t"><b>Payday plan</b><small>${K("pd.when")}</small></span>${CHEV}</button>` : ""}
  </section>`;

  // 3. Allocations: the main list. Amounts are all per the chosen period, said once in the heading.
  const head = ro ? "" : ui.reorder ? `<button class="btn small ghost" type="button" data-reorder aria-pressed="true">Done</button>`
    : `<button class="btn small ghost b-add" type="button" data-acc-new><span aria-hidden="true">+</span> Add</button><button class="btn small ghost b-manage" type="button" data-b-manage aria-haspopup="menu" aria-expanded="false">Manage${DOWN}</button>`;
  const row = (a, i) => {
    const solo = !multi, joint = multi && !(a.type === "Personal" && a.owner), full = a.name || "Unnamed", short = shortName(a, P, S);
    const owner = a.owner && multi ? P.find(p => p.id === a.owner) : null;
    const meta = joint ? `<span class="a-meta a-parts">${P.map(p => `<span data-k="acc.${esc(a.id)}.part.${esc(p.id)}" data-base="a-part ${pc(p)}" class="a-part ${pc(p)}"></span>`).join("")}<span data-k="acc.${esc(a.id)}.none" class="a-none"></span></span>`
      : owner ? `<span class="a-meta"><span class="a-who ${pc(owner)}">${esc(owner.name || "Unnamed")}</span> · ${esc(TYPE_WORD[a.type] || a.type || "")}</span>`
      : `<span class="a-meta">${esc(typeLine(a, P, S))}${solo ? ` · ${K(`acc.${a.id}.pct.${P[0].id}`)}` : ""}</span>`;
    const label = `${full}${joint ? ", shared" : owner ? `, ${owner.name || "Unnamed"}’s` : ""}: edit`;
    return `<li class="alloc">
      <button class="alloc-row" type="button" data-edit-acc="${esc(a.id)}"${ui.reorder ? " disabled" : ""} aria-label="${esc(label)}">
        <span class="a-ic" data-k="acc.${esc(a.id)}.ic" aria-hidden="true">${accIcon(a)}</span>
        <span class="a-main"><span class="a-name"${short !== full ? ` title="${esc(full)}"` : ""}>${esc(short)}</span>${meta}
          ${a.role === "spending" ? `<span data-k="acc.${esc(a.id)}.cov" data-base="a-cov"></span>` : ""}</span>
        <span class="a-amt">${K(`acc.${a.id}.t`)}</span>${ui.reorder ? "" : CHEV}</button>
      ${ui.reorder ? `<span class="mv-row"><button class="mv-btn" type="button" data-move="up" data-l="acc" data-i="${esc(a.id)}" aria-label="Move ${esc(full)} up"${i === 0 ? " disabled" : ""}>↑</button><button class="mv-btn" type="button" data-move="down" data-l="acc" data-i="${esc(a.id)}" aria-label="Move ${esc(full)} down"${i === S.accounts.length - 1 ? " disabled" : ""}>↓</button></span>` : ""}
    </li>`;
  };
  const allocs = `${transitionNote()}<section class="b-allocs">
    <div class="b-row sec"><h2 class="b-h2">Your allocations<small class="b-per">Amounts ${esc(w.per)}</small></h2>${head ? `<span class="b-acts">${head}</span>` : ""}</div>
    ${ui.reorder ? `<p class="dim small-note">Use the arrows to move an allocation up or down.</p>` : ""}
    <ul class="card alloc-list${ui.reorder ? " reordering" : ""}">${S.accounts.map(row).join("")}</ul>
  </section>`;

  // 4. Fair split: the verdict and each person's share in two short lines; the bars and sums on request.
  const fair = `<section class="card b-fair" id="fairSec" hidden>
    <div class="b-row"><h2>Fair split</h2></div>
    <p class="fair-verdict">${K("fair.verdict")}</p>
    <ul class="fs-rows">${P.map(p => `<li class="${pc(p)}"><span class="fs-name">${esc(p.name || "Unnamed")}</span><span class="fs-v">${K(`fs.${p.id}`)}</span></li>`).join("")}</ul>
    <details class="more fs-more"><summary>See the details${DOWN}</summary>
      <div class="fbar-row"><div class="lab"><span>Share of income</span><span>${K("fair.inc")}</span></div><div class="fbar" id="fbInc"></div></div>
      <div class="fbar-row"><div class="lab"><span>Share of shared money</span><span>${K("fair.sh")}</span></div><div class="fbar" id="fbSh"></div></div>
      <div class="split-key">${P.map(p => `<span><i style="background:${personVar(p)}"></i>${esc(p.name || "Unnamed")}</span>`).join("")}<span class="fs-mark">${K("fair.line")}</span></div>
      <p>${K("fair.detail")}</p><p>${K("fair.personal")}</p>
      <p class="dim">Shared money is what goes to joint accounts and investments. Splitting equally and splitting by income are both fair; this shows which one you’re doing.</p></details>
  </section>`;

  // 5. Breakdowns: compact rows, a title and one short line each; the charts inside are unchanged.
  const open = k => ui.open.has(k) ? " open" : "";
  const sum = (t, sub) => `<summary><span class="ins-t"><span>${t}</span><small>${sub}</small></span></summary>`;
  const insights = `<section class="card b-insights">
    <details data-ins="where"${open("where")}>${sum("Where it goes", K("ins.where"))}
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
    <details data-ins="flow"${open("flow")}>${sum("Money flow", `Pay → allocations → ${esc(spendLabel(S).toLowerCase())}`)}
      <div class="flow-wrap" id="flow" tabindex="0" aria-label="Money flow chart (scrolls sideways on small screens)"></div>
      <div class="flow-cap">${P.map(p => `<span><i style="background:${personVar(p)}"></i>From ${esc(p.name || "Unnamed")}</span>`).join("")}<span><i style="background:var(--unalloc)"></i>Not allocated / buffer</span></div>
    </details>
    <details data-ins="charts"${open("charts")}>${sum("Breakdown charts", multi ? "Each person’s pay, by allocation" : "Your pay, by allocation")}
      <div class="viz" id="donuts"></div><div class="legend" id="legend"></div>
    </details>
  </section>`;

  // Phase 9C.2: no note box at the bottom of the tab any more. A note someone already wrote isn't lost:
  // it's kept as it is (and in downloads), and can be read, changed or removed under "Note" here.
  const note = S.note ? `<details class="b-note-old"><summary><span class="ins-t"><span>Note</span></span></summary><div class="b-note"><input class="note-input" ${attrs("root", "", "note", "text")} value="${esc(S.note)}" aria-label="Budget note">${!ro ? '<button class="note-x" type="button" id="noteX" aria-label="Remove note">×</button>' : ""}</div></details>` : "";

  // Phones: one column in this order. Wide screens: income, status and fair split on the left; allocations on the right.
  return `<div class="budget"><div class="b-col">${income}${status}${multi ? fair : `<div id="fairSec" hidden></div>`}</div><div class="b-col">${allocs}${insights.replace(/<\/section>$/, note + "</section>")}</div></div>`;
}

/** Other periods, for the line under each pay: "≈ $2,000 a fortnight, $4,333 a month, $52,000 a year". */
function equivalents(annual, skip) {
  return "≈ " + [...VIEWS.filter(v => v !== skip).map(v => `${m0(annual / perYear(v))} a ${WORDS[v].noun}`), `${m0(annual)} a year`].join(", ");
}
const FREQ_WORD = { weekly: "weekly", fortnightly: "fortnightly", monthly: "monthly" };
const DAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
    // Phase 10A: one person's row says how they're paid, not the same amount again
    D[`pp.${p.id}.freq`] = p.annual > 0 ? `Paid ${FREQ_WORD[p.freq] || ""}${freqToView(p.freq) === C.view ? "" : ` · ${m0(p.pay || 0)} a pay`}${extra}` : "Add your pay";
  });
  D["inc.c"] = m0(v(C.incTotal)); D["inc.c.sub"] = equivalents(C.incTotal, C.view);
  C.rows.forEach(r => {
    C.people.forEach(p => {
      D[`acc.${r.id}.v.${p.id}`] = money(v(r.by[p.id])); D[`acc.${r.id}.b.${p.id}`] = { pw: p.annual ? r.by[p.id] / p.annual : 0 };
      // new: "Madi $427.50" chips (hidden when someone puts nothing in), and "25% of pay"
      D[`acc.${r.id}.part.${p.id}`] = { t: `${p.name || "Unnamed"} ${money(v(r.by[p.id]))}`, c: r.by[p.id] > 0.004 ? "" : "zero" };
      D[`acc.${r.id}.pct.${p.id}`] = `${pct(Number(r.split[p.id]) || 0, 1)} of pay`;
    });
    D[`acc.${r.id}.none`] = r.t > 0.004 ? "" : `${TYPE_WORD[r.type] || "Joint"} · no share of pay yet`; // (joint rows: nobody puts anything in yet)
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
  // Phase 10A: one headline in money, not a row of identical "All allocated" bars. People are only
  // listed (with their bar and Fill) while someone isn't done.
  const leftT = earners.reduce((t, s) => t + Math.max(0, s.p.annual - C.tot.amt[s.p.id]), 0);
  const overT = earners.reduce((t, s) => t + Math.max(0, C.tot.amt[s.p.id] - s.p.annual), 0);
  const names = k => listNames(earners.filter(s => s.k === k).map(s => s.p.name || "Someone"));
  const multi = C.people.length > 1;
  const head = !earners.length ? { h: "Add your pay to start", s: "Then give every dollar a job", c: "none", i: "•" }
    : earners.some(s => s.k === "over") ? { h: `Over-allocated by ${money(v(overT))}`, s: multi ? `${names("over")}: more is planned than comes in` : "More is planned than comes in", c: "bad", i: "!" }
    : earners.every(s => s.k === "ok") ? { h: `All ${money(v(C.incTotal))} allocated`, s: "", c: "ok", i: "✓" }
    : { h: `${money(v(leftT))} left to allocate`, s: multi ? `${names("left")} ${earners.filter(s => s.k === "left").length > 1 ? "have" : "has"} pay without a job yet` : `${pct(1 - C.tot.pct[earners[0].p.id], 1)} of your pay has no job yet`, c: "warn", i: "!" };
  D["st.summary"] = head.h; D["st.sub"] = head.s; D["st.ic"] = { t: head.i, c: head.c };
  const showList = st.some(s => s.k === "left" || s.k === "over") || (multi && earners.length > 0 && st.some(s => s.k === "none"));
  document.querySelectorAll("#allocStatus .st-list").forEach(el => {
    el.hidden = !showList;
    st.forEach(s => { const li = el.querySelector(`[data-st="${CSS.escape(s.p.id)}"]`); if (li) li.hidden = s.k === "ok"; });
  });
  // the next payday, for the Payday plan row
  const L = paydays(app.state, C, app.today), first = L.find(x => x.date);
  if (first) {
    const d = parseDate(first.date), same = L.filter(x => x.date === first.date);
    D["pd.when"] = [`Next ${DAY3[d.getDay()]} ${d.getDate()} ${MON3[d.getMonth()]}`, first.inDays === 0 ? "today" : first.inDays === 1 ? "tomorrow" : `in ${first.inDays} days`, multi ? listNames(same.map(x => x.name || "Someone")) : ""].filter(Boolean).join(" · ");
  } else D["pd.when"] = L.length ? "Add a payday to see the dates" : "";

  const yr = x => `${m0(x)} a year`;
  D["sum.joint"] = money(v(C.joint)); D["sum.joint.y"] = `${w.per}, ${yr(C.joint)}`;
  D["sum.personal"] = money(v(C.personal)); D["sum.personal.y"] = `${w.per}, ${yr(C.personal)}`;
  D["sum.investment"] = money(v(C.investment)); D["sum.investment.y"] = `${w.per}, ${yr(C.investment)}`;
  D["sum.own"] = money(v(C.joint + C.personal)); D["sum.own.y"] = `${w.per}, ${yr(C.joint + C.personal)}`;
  // Phase 9B: does the bills allocation cover the entered expenses?
  const cv = coverage(app.state, C);
  if (cv.allocation) D[`acc.${cv.allocation.id}.cov`] = cv.state === "short" ? { t: `Short of expenses by ${money(v(cv.short))}${w.short}`, c: "bad" }
    : cv.state === "covered" || cv.state === "even" ? { t: "✓ Covers your entered expenses", c: "ok quiet" } : cv.state === "nobudget" ? { t: "No budget for your expenses yet", c: "bad" } : { t: "", c: "" };
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
  // Phase 10A: each person in one short line: their share of the shared money, and of the income
  C.people.forEach(p => { D[`fs.${p.id}`] = E.includes(p) && sh ? `${pct(C.fair[p.id].shared / sh)} of shared money · ${pct(p.annual / C.incTotal)} of income` : ""; });
  D["fair.personal"] = `Kept for yourselves: ${listNames(E.map(p => `${p.name || "Unnamed"} ${money(v(C.fair[p.id].personal))} (${p.annual ? pct(C.fair[p.id].personal / p.annual) : "0%"} of their pay)`))}.`;

  // "Fill" buttons, where someone's pay isn't fully allocated
  C.people.forEach(p => {
    const rem = 1 - C.tot.pct[p.id];
    document.querySelectorAll(`[data-k="fill.${CSS.escape(p.id)}"]`).forEach(el => el.innerHTML = rem > 0.00005 && p.annual > 0 ? `<button class="fill-btn" type="button" data-fill="${esc(p.id)}">Fill ${pct(rem, 1)}</button>` : "");
  });
}

export function draw(C) {
  const v = C.v, $ = s => document.querySelector(s);
  // Phase 9C.1: each person's share of the household's pay, as a small doughnut (it was a thin bar)
  // Phase 10A: each person's share of the household's pay, as one slim bar (with the same words for screen readers)
  const ib = $("#incBar");
  if (ib) {
    drawSplit(ib, C.people.map(p => ({ name: p.name || "Unnamed", v: p.annual, col: personVar(p) })), C.incTotal);
    ib.setAttribute("aria-label", "Share of household pay: " + (C.incTotal ? C.people.filter(p => p.annual > 0).map(p => `${p.name || "Unnamed"} ${pct(p.annual / C.incTotal)}`).join(", ") : "no pay yet"));
  }
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

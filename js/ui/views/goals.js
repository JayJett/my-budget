/* Goals tab: emergency fund, joint goals and each person's own goals, funded in priority order.

   Layout only. Every figure comes from compute() (model/calc.js) through fill(), exactly as before:
   what each goal gets (including shares passed down from finished goals), its status and finish
   date, and the emergency fund's months of cover. Every edit goes through the same boxes
   (data-l="ef" / "gj" / "gp:<id>" …) and handlers, in the goal sheet (goalSheet below, opened by
   ui/budget-sheets.js).

   Words matter here: "saved" is money already put aside (the goal's Saved amount, typed in by you);
   "a fortnight" amounts are the plan from the Budget tab, never counted as saved. */
import { app, readOnly } from "../ctx.js";
import { esc, toast } from "../dom.js";
import { K, tipq, attrs, fmtNum, pc } from "../inputs.js";
import { goalStatus } from "../../model/calc.js";
import { WORDS, VIEWS } from "../../model/periods.js";
import { money, m0, pct, possessive } from "../../model/format.js";
import { n, blank } from "../../model/util.js";
import { jointGoalsLabel } from "./labels.js";
import { budgetUI } from "../budget-sheets.js";
import { itemIcon, iconPickerHTML } from "../icons.js";
import { ART } from "../art.js";

const CHEV = '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const SHIELD = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8l5 2v4c0 3.1-2.1 5.4-5 6.4-2.9-1-5-3.3-5-6.4v-4z"/><path d="M5.8 8.2l1.6 1.6 3-3.2"/></svg>';
const TARGET = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="3.4"/><circle cx="8" cy="8" r=".9" fill="currentColor"/></svg>';

/** A goal is "reached" exactly as the model decides it (calc.js allocGoals / goalStatus). */
export const isDone = g => !blank(g.name) && !blank(g.target) && Math.max(n(g.target) - n(g.saved), 0) === 0;
/** The goal lists on this tab: [{ key, kind: "ef" | "joint" | person, title, goals }]. */
export function goalGroups(S) {
  return [
    { key: "ef", kind: "ef", title: "Emergency fund", goals: [S.goals.ef] },
    { key: "gj", kind: "joint", title: jointGoalsLabel(S), goals: S.goals.joint },
    // (Phase 7D.2) on your own, your personal pot is just "Personal goals"; with others, it's named after its person
    ...S.people.map(p => ({ key: "gp:" + p.id, kind: p, title: S.people.length > 1 ? `${possessive(p.name || "Unnamed")} goals` : "Personal goals", goals: S.goals.personal[p.id] || [] })),
  ];
}
export const groupOf = (S, key) => goalGroups(S).find(g => g.key === key);
/** A small round badge: the shield for the emergency fund, otherwise the goal's first letter. */
const defaultBadge = (g, grp) => grp.kind === "ef" ? SHIELD : blank(g.name) ? TARGET : esc(String(g.name).trim().charAt(0).toUpperCase());
/** The goal's chosen icon if it has one, otherwise the usual badge. */
export const badge = (g, grp, big = "") => `<span class="gl-ic${grp.kind === "ef" ? " ef" : ""} ${big}" aria-hidden="true">${itemIcon(g.icon) || defaultBadge(g, grp)}</span>`;

function card(g, grp, ui, i) {
  const done = isDone(g), named = !blank(g.name);
  const mv = ui.reorder && grp.kind !== "ef" ? `<span class="mv-row"><button class="mv-btn" type="button" data-move="up" data-l="${esc(grp.key)}" data-i="${esc(g.id)}" aria-label="Move ${esc(g.name || "this goal")} up"${i === 0 ? " disabled" : ""}>↑</button><button class="mv-btn" type="button" data-move="down" data-l="${esc(grp.key)}" data-i="${esc(g.id)}" aria-label="Move ${esc(g.name || "this goal")} down"${i === grp.goals.length - 1 ? " disabled" : ""}>↓</button></span>` : "";
  if (ui.reorder) return `<li class="gl-li"><div class="gl-card compact">${badge(g, grp)}<span class="gl-name">${i + 1}. ${esc(g.name || "Unnamed goal")}</span></div>${mv}</li>`;
  return `<li class="gl-li"><button class="gl-card${done ? " done" : ""}" type="button" data-edit-goal="${esc(grp.key)}" data-i="${esc(g.id)}" aria-label="${esc(g.name || "Unnamed goal")}: edit">
      <span class="gl-top">${badge(g, grp)}<span class="gl-name">${esc(g.name || "Unnamed goal")}</span>${done ? `<span class="gl-done">${CHECK}Reached</span>` : `<span class="gl-pc">${K(`g.${g.id}.pc`)}</span>`}${CHEV}</span>
      <span class="gl-amt">${K(`g.${g.id}.amt`)}</span>
      <span class="gl-bar" aria-hidden="true"><span data-k="g.${esc(g.id)}.bar"></span></span>
      <span class="gl-foot"><span class="gl-line">${K(`g.${g.id}.line`)}</span>${grp.kind === "ef" ? K("ef.cover", "chip") : ""}${done ? "" : K(`g.${g.id}.st`, "chip")}${named ? K(`g.${g.id}.accflag`, "chip") : ""}</span>
    </button></li>`;
}

/** No goals at all yet (the emergency fund doesn't count: it's always there). */
const size = x => Array.isArray(x) ? x.length : Object.keys(x || {}).length;
const anyGoals = S => size(S.goals.joint) > 0 || Object.values(S.goals.personal || {}).some(g => size(g) > 0);
/** Which person-groups to show: anyone with goals, or with money going to their goals pool. */
const shown = (S, grp) => grp.kind === "ef" || grp.kind === "joint" || grp.goals.length > 0
  || (app.C && app.C.pool.personalGoals[grp.kind.id] > 0 && (S.people.length > 1 || anyGoals(S))); // on your own, with no goals yet, the one card below is the place to start


/** Where the first goal's money can come from: straight to the goals fund when that's the only pot with
    money going to it, otherwise ask (see the "pick" chooser in budget-sheets.js). */
export const goalPots = S => goalGroups(S).filter(g => g.kind !== "ef" && (g.kind === "joint" || (app.C && app.C.pool.personalGoals[g.kind.id] > 0)));
const firstGoalKey = S => goalPots(S).length > 1 ? "pick" : "gj";

function section(S, grp, ui, ro) {
  const isPerson = grp.kind !== "ef" && grp.kind !== "joint", P = S.people;
  const pool = grp.kind === "ef" ? K("g.ef.fn") : grp.kind === "joint" ? K("gp.jg") : K(`gpool.${grp.kind.id}`);
  const addBtn = ro || grp.kind === "ef" || (grp.kind === "joint" && !anyGoals(S)) ? "" : `<button class="icon-add" type="button" data-goal-new="${esc(grp.key)}" aria-label="Add a goal to ${esc(grp.title)}">+</button>`;
  // How much of each pool is shared out between the goals (unchanged checks: 100%, % left, over)
  const alloc = ui.reorder || !grp.goals.length ? "" : grp.kind === "joint"
    ? `<p class="gl-alloc"><span>Shared out</span>${P.map(p => `<span class="${pc(p)}">${P.length > 1 ? `<i class="gl-dot"></i>${esc(p.name || "Unnamed")} ` : ""}${K(`gj.c.${p.id}`, "chip")}</span>`).join("")}${tipq("Each goal gets a % of the fund. Below 100%, the rest stays in reserve; over 100%, goals are promised more than the fund has.")}</p>`
    : isPerson ? `<p class="gl-alloc"><span>Shared out</span>${K(`gp.${grp.kind.id}.c`, "chip")}</p>` : "";
  const spare = grp.kind === "joint" ? `<p class="gl-spare" data-k="gl.gj.spare" data-base="gl-spare"></p>` : isPerson ? `<p class="gl-spare" data-k="gl.${esc(grp.kind.id)}.spare" data-base="gl-spare"></p>` : "";
  const body = grp.goals.length ? `<ul class="gl-list">${grp.goals.map((g, i) => card(g, grp, ui, i)).join("")}</ul>`
    : grp.kind === "joint" && !anyGoals(S) ? `<div class="card gl-first"><div class="empty-art" aria-hidden="true">${ART.target()}</div><h3>Start saving for something</h3><p>A holiday, a car, a house deposit: set a target and watch it fill.</p>${ro ? "" : `<button class="btn primary gl-first-btn" type="button" data-goal-new="${firstGoalKey(S)}">+ Add a goal</button>`}</div>`
    : `<div class="card gl-none"><p>${isPerson ? "No personal goals yet." : "No goals yet."}</p>${ro ? "" : `<button class="btn small soft" type="button" data-goal-new="${esc(grp.key)}">+ Add a goal</button>`}</div>`;
  return `<section class="gl-group ${isPerson ? pc(grp.kind) : grp.kind === "ef" ? "ef" : "joint"}">
    <div class="ex-gh"><span class="ex-dot" aria-hidden="true"></span><h3>${esc(grp.title)}</h3>${grp.kind === "ef" ? "" : `<small>${grp.goals.length}</small>`}
      <span class="ex-gt">${pool}<small class="per">${K("gl.per")}</small></span>${ui.reorder ? "" : addBtn}</div>
    ${alloc}${spare}${body}</section>`;
}

export function view() {
  const S = app.state, ro = readOnly(), ui = budgetUI(), groups = goalGroups(S).filter(g => shown(S, g));
  const seg = `<div class="viewas seg-wrap"><div class="seg" role="group" aria-label="Show amounts per">${VIEWS.map(k => `<button type="button" data-viewas="${k}" aria-pressed="${k === S.viewAs}">${WORDS[k].noun[0].toUpperCase() + WORDS[k].noun.slice(1)}</button>`).join("")}</div></div>`;
  const pools = groups.map(g => `<li class="${g.kind !== "ef" && g.kind !== "joint" ? pc(g.kind) : g.kind}"><i class="gl-dot"></i><span>${esc(g.title)}</span><b>${g.kind === "ef" ? K("g.ef.fn") : g.kind === "joint" ? K("gp.jg") : K(`gpool.${g.kind.id}`)}</b></li>`).join("");
  const summary = `<section class="card gl-sum" aria-live="polite">
    <div class="b-row"><span class="eyebrow">Goals</span>${seg}</div>
    <div class="sp-head"><span class="amt">${K("gl.saved")}</span><span class="lab">saved so far</span></div>
    <p class="gl-sub">${K("gl.saved.sub")}</p>
    <div class="gl-bar big" aria-hidden="true"><span data-k="gl.bar"></span></div>
    <div class="gl-pools"><span class="eyebrow">Going to goals ${K("gl.perword")} ${tipq("The plan from the Budget tab. It isn’t counted as saved until you update a goal’s Saved amount.")}</span><ul>${pools}</ul></div>
  </section>`;
  const head = `<div class="b-row sec"><h2>Your goals</h2>${ro ? "" : `<button class="btn small ghost" type="button" data-reorder aria-pressed="${ui.reorder}">${ui.reorder ? "Done" : "Reorder"}</button>`}</div>
    ${ui.reorder ? `<p class="dim small-note">Goals higher in a list are funded first. When one is reached, its share moves to the next unfinished goal below it (or above, if it’s last).</p>` : ""}`;
  const sections = groups.filter(g => !ui.reorder || g.kind !== "ef").map(g => section(S, g, ui, ro)).join("");
  const hidden = goalGroups(S).filter(g => !shown(S, g));
  const addAny = ro || ui.reorder || !anyGoals(S) ? "" : `<button class="add-row" type="button" data-goal-new="${groups.length + hidden.length > 2 ? "pick" : "gj"}">+ Add goal</button>`;
  const help = `<details class="help"><summary>How goals are funded</summary><ul>
    <li>The Budget tab decides how much goes to the emergency fund, ${S.people.length > 1 ? "the joint goals fund and each person’s goals pool" : "and to your goals"}. Each goal gets a % of its fund.</li>
    <li>Goals higher in a list are funded first. When a goal is reached, its share moves to the next unfinished goal below it (or above, if it’s last). If every goal is reached, the money shows as spare.</li>
    <li>Saved is money already put aside, in the account you pick. Picking an account doesn’t move any money. The Net worth tab checks the goals in each savings account add up.</li>
    <li>Leave the deadline blank for an estimated finish date, or set one to see whether you’re on track.</li>
  </ul></details>`;
  return `<div class="gl-page"><div class="gl-side">${summary}</div><div class="gl-main">${head}${sections}${addAny}${help}</div></div>`;
}

/* ---------- the goal sheet (opened from ui/budget-sheets.js) ---------- */
export function goalSheet(key, g) {
  const S = app.state, C = app.C, grp = groupOf(S, key), w = WORDS[S.viewAs], P = S.people, ro = readOnly(), dis = ro ? " disabled" : "";
  const isEF = grp.kind === "ef", isJoint = grp.kind === "joint", person = !isEF && !isJoint ? grp.kind : null;
  const money$ = (f, label, v) => `<span class="unit wide nw-bal"><i>$</i><input type="text" inputmode="decimal" ${attrs(key, g.id, f, "num")} value="${fmtNum(v)}" aria-label="${esc(label)}"${dis}></span>`;
  const pctIn = (f, v, label) => `<span class="unit person"><input type="number" step="any" inputmode="decimal" ${attrs(key, g.id, f, "pct")} value="${blank(v) ? "" : +(v * 100).toFixed(4)}" aria-label="${esc(label)} percent"${dis}><i>%</i></span>`;
  // the account picker: savings accounts from Net worth, by name (as before)
  const savings = (C && C.savingsNames) || [], nwA = S.nw.accounts;
  const opts = savings.map(x => `<option value="${esc(x)}"${x === g.account ? " selected" : ""}>${esc(x)}</option>`);
  if (!blank(g.account) && !savings.includes(g.account)) opts.unshift(`<option value="${esc(g.account)}" selected>${esc(g.account)} (not a savings account)</option>`);
  if (blank(g.account)) opts.unshift('<option value="" selected>Pick an account</option>');
  const acct = nwA.find(a => a.type === "Savings" && !blank(a.name) && a.name === g.account);
  const acctInfo = acct && C ? `<p class="bs-note">${esc(acct.name)} has ${money(n(acct.balance))}, and ${money(C.earmark[acct.id])} of it is earmarked by goals.</p>` : "";
  const shares = isEF ? `<p class="bs-note">Set by the emergency fund’s share of pay on the Budget tab.</p>`
    : isJoint ? `<ul class="bs-shares">${P.map(p => `<li class="${pc(p)}"><span class="bs-who">${P.length > 1 ? `<span class="av sm">${esc((p.name || "?").charAt(0).toUpperCase())}</span>${esc(p.name || "Unnamed")}` : "Share of the fund"}</span>${pctIn(`split.${p.id}`, g.split && g.split[p.id], `${p.name || "Their"} share`)}<small class="bs-sub">${P.length > 1 ? `${esc(possessive(p.name || "Their"))} part of the fund: ` : ""}${K(`gj.t.${p.id}`)} shared out ${K(`gj.c.${p.id}`, "chip")}</small></li>`).join("")}</ul>
        <small class="bs-sub">Fund ${w.per}: ${K("gp.jg.s")}</small>`
    : `<ul class="bs-shares"><li class="${pc(person)}"><span class="bs-who">Share of ${esc(possessive(person.name || "their"))} pool</span>${pctIn("pct", g.pct, "Share of pool")}<small class="bs-sub">${K(`gp.${person.id}.tp`)} shared out ${K(`gp.${person.id}.c`, "chip")}</small></li></ul>`;
  return `<div class="bs-hero gl-hero ${person ? pc(person) : isEF ? "ef" : "joint"}">${badge(g, grp, "big")}<div><div class="bs-amt">${K(`g.${g.id}.amt`)}</div><small>${K(`g.${g.id}.pc`)} reached</small></div></div>
    <div class="gl-bar big" aria-hidden="true"><span data-k="g.${esc(g.id)}.bar"></span></div>
    <p class="gl-st">${K(`g.${g.id}.st`, "chip")}</p>
    ${isEF ? `<p class="banner" data-k="ef.banner" data-base="banner"></p>` : `<label class="bs-field"><span>Name</span><input class="bs-in" type="text" ${attrs(key, g.id, "name", "text")} value="${esc(g.name)}" placeholder="e.g. Holiday" autocomplete="off"${dis}></label>`}
    <label class="bs-field"><span>Target</span>${money$("target", "Target", g.target)}</label>
    ${isEF ? `<div class="ef-suggest" id="efSuggest"></div>` : ""}
    <h4 class="bs-h">Saved</h4>
    <label class="bs-field"><span>Saved so far ${tipq("Money already put aside for this goal. Planned contributions aren’t added automatically: update this when you check your balances.")}</span>${money$("saved", "Saved so far", g.saved)}</label>
    <label class="bs-field"><span>Kept in</span><select class="bs-in" ${attrs(key, g.id, "account", "text")} aria-label="Account"${dis}>${opts.join("")}</select>
      <small class="bs-sub">The savings account the money sits in. Picking one doesn’t move any money.${savings.length ? "" : " Add a Savings account on the Net worth tab to pick one."}</small>
      <small class="bs-warn">${K(`g.${g.id}.acw`)}</small></label>
    ${acctInfo}
    <h4 class="bs-h">Plan</h4>
    <div class="gl-plan"><b>${K(`g.${g.id}.fn`)}</b> <span>${esc(w.per)}</span><small>${K(`g.${g.id}.roll`)}</small></div>
    ${shares}
    <label class="bs-field"><span>Deadline (optional)</span><input class="bs-in" type="date" ${attrs(key, g.id, "deadline", "date")} value="${esc(g.deadline || "")}"${dis}>
      <small class="bs-sub">Leave it blank to see an estimated finish date.</small></label>
    ${iconPickerHTML(key, g.id, g.icon, defaultBadge(g, grp), ro)}
    ${isEF || ro ? "" : `<button class="btn danger-soft block" type="button" data-del="${esc(key)}" data-i="${esc(g.id)}">Delete goal</button>`}`;
}

export function fill(D, C) {
  const S = app.state, v = C.v, w = WORDS[C.view];
  const jg = C.pool.goals, P = C.people;
  D["gp.jg"] = money(v(jg.t));
  D["gp.jg.s"] = (P.length > 1 ? P.map(p => `${p.name || "Unnamed"} ${m0(v(jg.by[p.id] || 0))}`).join(" + ") : `${m0(jg.t)} a year`) + (C.gj.spare > 0.01 ? `, ${m0(v(C.gj.spare))} currently spare` : "");
  P.forEach(p => {
    const pool = C.pool.personalGoals[p.id], A = C.gp[p.id];
    D[`gpool.${p.id}`] = money(v(pool));
    D[`gpool.${p.id}.s`] = `${w.per}, ${m0(pool)} a year` + (A.spare > 0.01 ? `, ${m0(v(A.spare))} spare` : "");
    D[`gp.${p.id}.note`] = `Funded from ${possessive(p.name || "their")} ${m0(v(pool))} ${w.per} pool. Top goal gets priority.`;
  });
  const ef = S.goals.ef, mc = C.mCommitted;
  if (n(ef.saved) === 0) D["ef.banner"] = { t: "Set a Saved amount on the emergency fund below to see how many months it covers.", c: "warn" };
  else if (!mc) D["ef.banner"] = { t: "Add spending categories to see how many months your emergency fund covers.", c: "warn" };
  else { const mo = n(ef.saved) / mc; D["ef.banner"] = { t: `Emergency fund: ${m0(n(ef.saved))} saved, covering ${mo.toFixed(1)} months of committed costs (${m0(mc)}/month). The usual target is 3–6 months.`, c: mo >= 3 ? "ok" : "warn" }; }
  const es = document.querySelector("#efSuggest");
  if (es) es.innerHTML = mc > 0 ? `<span>Suggested target, from committed costs of <b>${m0(mc)}</b>/month:</span><button class="btn small soft" type="button" data-ef="3"${readOnly() ? " disabled" : ""}>3 months, ${m0(mc * 3)}</button><button class="btn small soft" type="button" data-ef="6"${readOnly() ? " disabled" : ""}>6 months, ${m0(mc * 6)}</button>` : "<span>Add spending categories to get a suggested target.</span>";

  const goalRow = (g, perYear, isEF, A, i) => {
    D[`g.${g.id}.fn`] = perYear === null ? "" : money(v(perYear));
    D[`g.${g.id}.rem`] = blank(g.target) ? "" : money(Math.max(n(g.target) - n(g.saved), 0));
    D[`g.${g.id}.st`] = goalStatus(g, perYear, isEF, C.today, C.view);
    const done = !blank(g.name) && !blank(g.target) && Math.max(n(g.target) - n(g.saved), 0) === 0;
    const p = blank(g.target) ? null : done ? 1 : n(g.target) === 0 ? 0 : n(g.saved) / n(g.target);
    D[`g.${g.id}.pc`] = p === null ? "" : pct(p); D[`g.${g.id}.bar`] = { w: Math.min(1, Math.max(0, p || 0)) };
    D[`g.${g.id}.acw`] = !blank(g.account) && !C.savingsNames.includes(g.account) ? "Not a savings account, so nothing is earmarked" : "";
    let roll = { t: "", c: "" };
    if (A) {
      if (A.to[i] !== null) roll = A.to[i] ? { t: `Share moved to ${A.to[i]}`, c: "roll" } : { t: "Share is spare", c: "spare" };
      else if (A.from[i].length) roll = { t: `incl. ${money(v(A.from[i].reduce((s, x) => s + x.v, 0)))} from ${A.from[i].map(x => x.name).join(", ")}`, c: "roll" };
    }
    D[`g.${g.id}.roll`] = roll;
    // new: the card's "saved of target" line, its plan line, and a short flag for an account that isn't savings
    D[`g.${g.id}.amt`] = blank(g.target) ? `${money(n(g.saved))} saved` : `${money(n(g.saved))} of ${money(n(g.target))}`;
    D[`g.${g.id}.line`] = done ? (roll.t || "Target reached") : roll.t && A && A.from[i].length ? `${D[`g.${g.id}.fn`]}${w.short} · ${roll.t}` : perYear ? `${D[`g.${g.id}.fn`]}${w.short}` : blank(g.name) ? "Add a name to fund it" : "Nothing going to it yet";
    D[`g.${g.id}.accflag`] = D[`g.${g.id}.acw`] ? { t: "Not in a savings account", c: "warn" } : { t: "", c: "" };
  };
  goalRow(ef, C.pool.emergency, true);
  S.goals.joint.forEach((g, i) => goalRow(g, C.gj.eff[i], false, C.gj, i));
  P.forEach(p => (S.goals.personal[p.id] || []).forEach((g, i) => goalRow(g, C.gp[p.id].eff[i], false, C.gp[p.id], i)));

  const fundCheck = x => Math.round(x * 1e4) === 1e4 ? { t: "100%", c: "ok" } : x < 1 ? { t: `${pct(1 - x)} left`, c: "warn" } : { t: "Over 100%", c: "bad" };
  P.forEach(p => { const s = S.goals.joint.reduce((a, g) => a + n(g.split[p.id]), 0); D[`gj.t.${p.id}`] = pct(s); D[`gj.c.${p.id}`] = fundCheck(s); });
  D["gj.tv"] = money(v(C.gj.eff.reduce((s, x) => s + n(x), 0)));
  const poolCheck = x => Math.round(x * 1e4) === 1e4 ? { t: "Fully allocated", c: "ok" } : x < 1 ? { t: `${pct(1 - x)} in reserve`, c: "warn" } : { t: `Over by ${pct(x - 1)}`, c: "bad" };
  P.forEach(p => {
    const L = S.goals.personal[p.id] || [], tp = L.reduce((s, g) => s + n(g.pct), 0);
    D[`gp.${p.id}.tp`] = pct(tp); D[`gp.${p.id}.tv`] = money(v(C.gp[p.id].eff.reduce((s, x) => s + n(x), 0))); D[`gp.${p.id}.c`] = poolCheck(tp);
  });

  // new: the summary card. Saved is what's already put aside (each goal's Saved), never the plan.
  const all = goalGroups(S).flatMap(g => g.goals).filter(g => !blank(g.name));
  const saved = all.reduce((s, g) => s + n(g.saved), 0), targets = all.filter(g => !blank(g.target)).reduce((s, g) => s + n(g.target), 0);
  const reached = all.filter(isDone).length;
  D["gl.saved"] = money(saved);
  D["gl.saved.sub"] = !all.length ? "No goals yet" : `${targets > 0 ? `of ${money(targets)} in targets · ` : ""}${all.length} ${all.length === 1 ? "goal" : "goals"}${reached ? `, ${reached} reached` : ""}`;
  D["gl.bar"] = { w: targets > 0 ? Math.min(1, saved / targets) : 0 };
  D["gl.per"] = w.short; D["gl.perword"] = w.per.replace("per ", "each ");
  // months of cover: the same sum as the emergency fund message above, shown short on the card
  D["ef.cover"] = n(ef.saved) === 0 ? { t: "", c: "" } : !mc ? { t: "Cover unknown", c: "" } : { t: `${(n(ef.saved) / mc).toFixed(1)} months cover`, c: n(ef.saved) / mc >= 3 ? "ok" : "warn" };
  D["gl.gj.spare"] = { t: C.gj.spare > 0.01 ? `${money(v(C.gj.spare))}${w.short} is spare: every goal here is reached. Add a goal to use it.` : "", c: C.gj.spare > 0.01 ? "on" : "" };
  P.forEach(p => { const A = C.gp[p.id]; D[`gl.${p.id}.spare`] = { t: A.spare > 0.01 ? `${money(v(A.spare))}${w.short} is spare: every goal here is reached. Add a goal to use it.` : "", c: A.spare > 0.01 ? "on" : "" }; });
}

/* ---------- a little cheer for real progress ----------
   Only when your own edit to a goal's Saved or Target moves it past 25%, 50%, 75% or to reached (using the
   same "reached" rule as everywhere else). Never on opening the app, reloading, or someone else's change,
   so old achievements aren't celebrated again. Nothing is stored. */
const progressOf = g => blank(g.target) ? null : isDone(g) ? 1 : n(g.target) === 0 ? 0 : n(g.saved) / n(g.target);
const STEPS = [[0.75, "three-quarters of the way"], [0.5, "halfway there"], [0.25, "a quarter of the way"]];
const findGoal = (l, id) => { const G = app.state.goals; return l === "ef" ? G.ef : (l === "gj" ? G.joint : G.personal[l.slice(3)] || []).find(g => g.id === id); };
export function initGoals() {
  let before = null;
  const isGoalMoney = el => el && el.dataset && /^(ef|gj|gp:.+)$/.test(el.dataset.l || "") && ["saved", "target"].includes(el.dataset.f);
  document.addEventListener("focusin", e => { if (!isGoalMoney(e.target)) return; const g = findGoal(e.target.dataset.l, e.target.dataset.i); before = g ? { id: g.id, p: progressOf(g) } : null; });
  // Checked a moment after you stop typing (so "1", "10", "100", "1000" is one step), and when you leave the box.
  let t = null;
  document.addEventListener("input", e => { if (!isGoalMoney(e.target)) return; clearTimeout(t); const el = e.target; t = setTimeout(() => check(el), 900); });
  document.addEventListener("change", e => { if (!isGoalMoney(e.target)) return; clearTimeout(t); check(e.target); });
  function check(el) {
    if (readOnly()) return;
    const g = findGoal(el.dataset.l, el.dataset.i); if (!g || !before || before.id !== g.id || blank(g.name)) return;
    const was = before.p ?? 0, now = progressOf(g); before = { id: g.id, p: now };
    if (now === null || now <= was) return;
    let line = null;
    if (now >= 1 && was < 1) line = `${g.name} reached its target`;
    else { const step = STEPS.find(([s]) => was < s && now >= s); if (step) line = `${g.name} is ${step[1]}`; }
    if (!line) return;
    toast(line, "ok");
    document.querySelectorAll(`#sheet .gl-bar.big, [data-edit-goal][data-i="${CSS.escape(g.id)}"]`).forEach(x => { x.classList.remove("cheer"); void x.offsetWidth; x.classList.add("cheer"); });
  }
}

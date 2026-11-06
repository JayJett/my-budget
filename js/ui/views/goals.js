/* Goals tab: emergency fund, joint goals and each person's own goals, funded in priority order. */
import { app } from "../ctx.js";
import { esc } from "../dom.js";
import { K, TH, tipq, tIn, pIn, $In, dIn, gAcc, grip, del, pc, attnBox } from "../inputs.js";
import { goalStatus } from "../../model/calc.js";
import { WORDS } from "../../model/periods.js";
import { money, m0, pct, possessive } from "../../model/format.js";
import { n, blank } from "../../model/util.js";
import { jointGoalsLabel } from "./labels.js";

/** key: list key for inputs ("ef", "gj", or "gp:<personId>"). kind: "ef" | "joint" | person object. */
function goalTable(key, goals, kind) {
  const S = app.state, w = WORDS[S.viewAs], savings = app.C.savingsNames;
  const isJoint = kind === "joint", isEF = kind === "ef", person = isJoint || isEF ? null : kind;
  const tone = person ? pc(person) : "";
  const P = S.people;
  const pctCols = isJoint ? P.map(p => TH(`<span class="who ${pc(p)}">${esc(p.name || "Unnamed")}</span>%`, `Share of ${possessive(p.name || "this person")} part of the joint goals fund.`, "num")).join("")
    : isEF ? "" : TH("% of fund", "Share of this person’s goals pool.", "num");
  const head = `<tr>${isEF ? "" : "<th></th>"}${TH("Goal", "What you’re saving for. Higher in the list = higher priority.")}${TH("Target", "How much the goal needs in total.", "num")}${TH("Saved", "How much is already put aside for it.", "num")}${TH("Account", "The savings account this money lives in. Only Savings accounts from Net worth are listed.")}
    ${pctCols}${TH(`Per ${w.noun}`, `Money going to this goal each ${w.noun}, including any share passed down from finished goals above it.`, "num")}${TH("Remaining", "Target minus saved.", "num")}${TH("Deadline", "Optional. Leave blank to see an estimated finish date instead.")}${TH("Status", "Done, on track, or what’s needed to catch up.")}${isEF ? "" : "<th></th>"}</tr>`;
  const body = goals.map(g => `<tr>
    ${isEF ? "" : `<td class="c-grip">${grip(key, g.id)}</td>`}
    <td class="c-name" data-label="Goal">${isEF ? `<b>${esc(g.name)}</b>` : tIn(key, g.id, "name", g.name, "name", "Goal name")}</td>
    <td class="num" data-label="Target">${$In(key, g.id, "target", g.target, tone, "Target")}</td>
    <td class="num" data-label="Saved">${$In(key, g.id, "saved", g.saved, tone, "Saved")}</td>
    <td data-label="Account"><div>${gAcc(key, g, savings)}${K(`g.${g.id}.acw`, "acw")}</div></td>
    ${isJoint ? P.map(p => `<td class="num" data-label="${esc(p.name)} %">${pIn(key, g.id, `split.${p.id}`, g.split[p.id], pc(p), `${p.name} share`)}</td>`).join("") : isEF ? "" : `<td class="num" data-label="% of fund">${pIn(key, g.id, "pct", g.pct, tone, "Share of fund")}</td>`}
    <td class="num" data-label="Per ${w.noun}"><div><div>${K(`g.${g.id}.fn`)}</div><div class="sub" data-k="g.${esc(g.id)}.roll" data-base="sub"></div></div></td>
    <td class="num" data-label="Remaining">${K(`g.${g.id}.rem`)}</td>
    <td data-label="Deadline">${dIn(key, g.id, "deadline", g.deadline)}</td>
    <td class="c-status"><div class="status-cell">${K(`g.${g.id}.st`, "chip")}<div class="prog"><span class="bar">${K(`g.${g.id}.bar`)}</span>${K(`g.${g.id}.pc`)}</div></div></td>
    ${isEF ? "" : `<td class="c-del">${del(key, g.id)}</td>`}</tr>`).join("");
  let foot = "", extra = "";
  if (isJoint) foot = `<tfoot><tr><td></td><td>Totals</td><td></td><td></td><td></td>${P.map(p => `<td class="num">${K(`gj.t.${p.id}`)}</td>`).join("")}<td class="num">${K("gj.tv")}</td><td></td><td></td><td></td><td></td></tr>
    <tr class="check"><td></td><td colspan="4">${P.length > 1 ? "Each person’s column" : "The % column"} should total 100% to use the full fund</td>${P.map(p => `<td class="num">${K(`gj.c.${p.id}`, "chip")}</td>`).join("")}<td colspan="5"></td></tr></tfoot>`;
  else if (isEF) extra = `<div class="ef-suggest" id="efSuggest"></div>`;
  else foot = `<tfoot><tr><td></td><td>Totals</td><td></td><td></td><td></td><td class="num">${K(`gp.${person.id}.tp`)}</td><td class="num">${K(`gp.${person.id}.tv`)}</td><td></td><td></td><td></td><td></td></tr>
    <tr class="check"><td></td><td colspan="4">The % column should total 100% to use the full pool</td><td colspan="2" class="num">${K(`gp.${person.id}.c`, "chip")}</td><td colspan="4"></td></tr></tfoot>`;
  return `<div class="panel ${isEF ? "" : "scroll"} w-goal cards"><div class="${isEF ? "scroll" : ""}"><table><thead>${head}</thead><tbody>${body}</tbody>${foot}</table></div>${extra}${isEF ? "" : `<button class="add" type="button" data-add="${esc(key)}">+ Add a goal</button>`}</div>`;
}

export function view() {
  const S = app.state, G = S.goals, w = WORDS[S.viewAs], P = S.people;
  return `${attnBox()}
  <div class="stat-row">
    <div class="stat big"><div class="k">${jointGoalsLabel(S)} fund, ${w.per}</div><div class="v">${K("gp.jg")}</div><div class="s">${K("gp.jg.s")}</div></div>
    ${P.map(p => `<div class="stat big ${pc(p)}"><div class="k" style="color:var(--pc)">${esc(possessive(p.name || "Unnamed"))} goals pool</div><div class="v">${K(`gpool.${p.id}`)}</div><div class="s">${K(`gpool.${p.id}.s`)}</div></div>`).join("")}
  </div>
  ${K("ef.banner", "banner")}

  <section><div class="sec-head"><h2>Emergency fund</h2>${tipq("A safety net for job loss, car repairs or surprise bills. A common rule of thumb is 3–6 months of essential costs.")}<span class="sec-note">Your safety net for when life happens.</span></div>${goalTable("ef", [G.ef], "ef")}</section>
  <section><div class="sec-head"><h2>${jointGoalsLabel(S)}</h2>${tipq("Goals are funded in priority order, top to bottom. When a goal is finished, its share automatically moves to the next unfinished goal below it.")}<span class="sec-note">Top of the list is the highest priority. Drag to reorder; a finished goal passes its share down.</span></div>${goalTable("gj", G.joint, "joint")}</section>
  ${P.map(p => `<section class="${pc(p)}"><div class="sec-head"><h2 style="color:var(--pc)">${esc(possessive(p.name || "Unnamed"))} personal goals</h2><span class="sec-note">${K(`gp.${p.id}.note`)}</span></div>${goalTable("gp:" + p.id, G.personal[p.id] || [], p)}</section>`).join("")}

  <details class="help"><summary>How it works</summary><ul>
    <li>Each goal lives in a real savings account. Several goals can share one account; Net worth checks the totals add up.</li>
    ${P.length > 1 ? "<li>Joint goals have a separate % for each person, so you can fund them unevenly.</li>" : ""}
    <li>When a goal reaches its target, its share flows to the next unfinished goal below it (or above, if it’s last). If every goal is done, the money is flagged as spare so you can add a new goal.</li>
    <li>Leave the deadline blank for an estimated finish date, or set one to see whether you’re on track.</li>
  </ul></details>`;
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
  if (es) es.innerHTML = mc > 0 ? `<span>Suggested target, from committed costs of <b>${m0(mc)}</b>/month:</span><button class="btn small soft" type="button" data-ef="3">3 months, ${m0(mc * 3)}</button><button class="btn small soft" type="button" data-ef="6">6 months, ${m0(mc * 6)}</button>` : "<span>Add spending categories to get a suggested target.</span>";

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
}

/* (Joint) spending tab: what the spending pool pays for, including yearly "sinking" bills. */
import { app } from "../ctx.js";
import { K, TH, tipq, tIn, sIn, $In, grip, del, attrs, attnBox } from "../inputs.js";
import { WORDS, BILL_PERIODS } from "../../model/periods.js";
import { money, m0, pct, monthYear, MONTHS } from "../../model/format.js";
import { n, blank } from "../../model/util.js";
import { drawSplit } from "../charts.js";
import { spendLabel } from "./labels.js";

export function view() {
  const S = app.state, L = S.spend, w = WORDS[S.viewAs], lab = spendLabel(S);
  return `${attnBox()}
  <div class="stat-row">
    <div class="stat big"><div class="k">${lab} pool</div><div class="v">${K("sp.pool")}</div><div class="s">${K("sp.pool.y")}</div></div>
    <div class="stat big"><div class="k">Committed</div><div class="v">${K("sp.com")}</div><div class="s">${K("sp.com.y")}</div></div>
    <div class="stat big" id="bufStat"><div class="k">Buffer ${tipq(`Pool minus committed. A little buffer gives you room for unplanned small things.`)}</div><div class="v">${K("sp.buf")}</div><div class="s">${K("sp.buf.s")}</div></div>
  </div>
  <div class="panel" style="padding:16px 20px;margin-top:14px"><div class="split" id="poolsplit"></div><div class="split-key" id="poolkey"></div></div>

  <section>
    <div class="sec-head"><h2>Spending categories</h2>${tipq(`Fixed: same every time (rent). Flexible: varies, and is where you have choice (eating out). Sinking: a yearly bill you save for a little each ${w.noun} (rego).`)}<span class="sec-note">Enter each amount however it’s billed. For yearly sinking costs, add the month it’s due and how much is set aside, and the app works out whether you’re on track.</span></div>
    <div class="panel scroll w-sp cards"><table>
      <thead><tr><th></th>${TH("Category", "What the money is for.")}${TH("Type", "Fixed, Flexible or Sinking. Only Sinking items get a due month.")}${TH("Amount", "Enter it however it’s billed: per week, fortnight, month or year.", "num")}${TH("Period", "How often the amount is billed.")}${TH(`Per ${w.noun}`, `Everything converted to a ${w.adj.toLowerCase()} amount, so it all adds up.`, "num")}${TH("% of pool", "This category’s share of the spending pool.", "num")}${TH("Due", "For yearly sinking costs: the month the bill lands.")}${TH("Set aside", "How much you’ve already saved toward this bill.", "num")}${TH("Progress", "Compares what you’ve set aside with what you should have by now, counting from the last due date.")}${TH("Notes", "")}<th></th></tr></thead>
      <tbody>${L.map(s => {
        const sk = s.type === "Sinking" && s.period === "Year";
        return `<tr>
        <td class="c-grip">${grip("sp", s.id)}</td>
        <td class="c-name">${tIn("sp", s.id, "name", s.name, "name", "Category")}</td>
        <td data-label="Type">${sIn("sp", s.id, "type", s.type, ["Fixed", "Flexible", "Sinking"])}</td>
        <td class="num" data-label="Amount">${$In("sp", s.id, "amount", s.amount, "", "Amount")}</td>
        <td data-label="Billed every">${sIn("sp", s.id, "period", s.period, BILL_PERIODS)}</td>
        <td class="num" data-label="Per ${w.noun}">${K(`sp.${s.id}.v`)}</td><td class="num dim" data-label="% of pool">${K(`sp.${s.id}.p`)}</td>
        <td data-label="Due"${sk ? "" : ' class="m-hide"'}>${sk ? `<select class="cell month" ${attrs("sp", s.id, "due", "month")} aria-label="Due month"><option value="">Pick</option>${MONTHS.map((mo, k) => `<option value="${k + 1}"${s.due === k + 1 ? " selected" : ""}>${mo}</option>`).join("")}</select>` : `<span class="dim"${s.type === "Sinking" ? ' data-tip="Due dates work for yearly bills. Set the period to Year to track this one."' : ""}>—</span>`}</td>
        <td class="num${sk ? "" : " m-hide"}" data-label="Set aside">${sk ? $In("sp", s.id, "aside", s.aside, "", "Set aside") : '<span class="dim">—</span>'}</td>
        <td data-label="Progress"${sk ? "" : ' class="m-hide"'}>${sk ? `<div class="stack-r">${K(`sp.${s.id}.sk`, "chip")}<div class="sub">${K(`sp.${s.id}.sk2`)}</div></div>` : ""}</td>
        <td data-label="Notes">${tIn("sp", s.id, "notes", s.notes, "note", "Notes")}</td><td class="c-del">${del("sp", s.id)}</td></tr>`;
      }).join("")}</tbody>
      <tfoot><tr><td></td><td>Totals</td><td></td><td></td><td></td><td class="num">${K("sp.tot")}</td><td class="num">${K("sp.totp")}</td><td></td><td></td><td></td><td></td><td></td></tr></tfoot>
    </table><button class="add" type="button" data-add="sp">+ Add category</button></div>
  </section>

  <section>
    <div class="stat-row">
      <div class="stat"><div class="k"><span class="dotc" style="background:#3E5A63"></span>Fixed costs</div><div class="v">${K("sp.fixed")}</div><div class="s">Locked in every ${w.noun}</div></div>
      <div class="stat"><div class="k"><span class="dotc" style="background:var(--joint)"></span>Flexible buckets</div><div class="v">${K("sp.flex")}</div><div class="s">Variable, where you have choice</div></div>
      <div class="stat"><div class="k"><span class="dotc" style="background:var(--invest)"></span>Sinking funds</div><div class="v">${K("sp.sink")}</div><div class="s">${K("sp.sinkhelp")}</div></div>
    </div>
  </section>`;
}

export function fill(D, C) {
  const v = C.v, w = WORDS[C.view];
  D["sp.pool"] = money(v(C.pool.spending)); D["sp.pool.y"] = `From the budget, ${m0(C.pool.spending)} a year`;
  D["sp.com"] = money(v(C.committed)); D["sp.com.y"] = `Across categories, ${m0(C.committed)} a year`;
  D["sp.buf"] = money(v(C.spBuffer)); D["sp.buf.s"] = C.spBuffer >= 0 ? "Room to spare" : "Over budget";
  C.sp.forEach(s => {
    D[`sp.${s.id}.v`] = s.annual === null ? "" : money(v(s.annual));
    D[`sp.${s.id}.p`] = s.annual === null || !C.pool.spending ? "" : pct(s.annual / C.pool.spending, 1);
    if (s.type === "Sinking" && s.period === "Year") {
      const k = s.sink;
      D[`sp.${s.id}.sk`] = !k ? (blank(s.due) && n(s.amount) > 0 ? { t: "Pick a due month", c: "warn" } : { t: "", c: "" }) : k.st;
      D[`sp.${s.id}.sk2`] = !k ? "" : `Due ${monthYear(k.next)}, ${k.periodsAway} ${k.periodsAway === 1 ? w.noun : w.plural} away${k.need ? `. Needs ${money(k.need)}${w.short}` : ""}`;
    }
  });
  D["sp.tot"] = money(v(C.committed)); D["sp.totp"] = C.pool.spending ? pct(C.committed / C.pool.spending, 1) : "";
  const fx = C.spType("Fixed"), fl = C.spType("Flexible"), sk = C.spType("Sinking");
  D["sp.fixed"] = money(v(fx)); D["sp.flex"] = money(v(fl)); D["sp.sink"] = money(v(sk));
  D["sp.sinkhelp"] = `Builds to ${m0(sk)} across the year for bills that land once`;
}

export function draw(C) {
  const v = C.v, $ = s => document.querySelector(s);
  const bs = $("#bufStat"); if (bs) bs.classList.toggle("bad", C.spBuffer < 0);
  const pp = $("#poolsplit"); if (!pp) return;
  const parts = [{ name: "Fixed", v: v(C.spType("Fixed")), col: "#3E5A63" }, { name: "Flexible", v: v(C.spType("Flexible")), col: "var(--joint)" },
    { name: "Sinking", v: v(C.spType("Sinking")), col: "var(--invest)" }, { name: "Buffer", v: Math.max(v(C.spBuffer), 0), col: "var(--unalloc)" }];
  drawSplit(pp, parts, Math.max(v(C.pool.spending), v(C.committed)));
  $("#poolkey").innerHTML = parts.map(p => `<span><i style="background:${p.col}"></i>${p.name} ${money(p.v)}</span>`).join("") + (C.spBuffer < 0 ? `<span style="color:var(--bad);font-weight:650">Over by ${money(v(-C.spBuffer))}</span>` : "");
}

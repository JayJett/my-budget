/* Budget tab: people and pay, the allocation plan, money flow, breakdowns and the fair-split check. */
import { app } from "../ctx.js";
import { esc } from "../dom.js";
import { K, TH, tipq, pIn, tIn, sIn, vIn, grip, del, attrs, fmtNum, pc, attnBox } from "../inputs.js";
import { COLOUR_KEYS, PERSON_COLOURS, MAX_PEOPLE, ROLES } from "../../model/schema.js";
import { WORDS, VIEWS, perYear, freqToView } from "../../model/periods.js";
import { money, m0, pct, listNames, possessive } from "../../model/format.js";
import { drawDonuts, drawFlow, drawSplit, personVar } from "../charts.js";
import { spendLabel } from "./labels.js";

const FREQ_OPTS = [["weekly", "a week"], ["fortnightly", "a fortnight"], ["monthly", "a month"]];

function personCard(p, multi) {
  const id = p.id;
  return `<div class="cell-h pc-${p.colour}">
    <div class="person-head"><span class="dotc person"></span>
      <input class="person-name" ${attrs("pp", id, "name", "text")} value="${esc(p.name)}" placeholder="Their name" aria-label="Name">
      ${multi ? `<button class="person-x" type="button" data-rmperson="${esc(id)}" aria-label="Remove ${esc(p.name || "this person")}" data-tip="Remove ${esc(p.name || "this person")} from the budget">×</button>` : ""}</div>
    <div class="pay-row"><div class="fig person"><span class="cur">$</span><input type="text" inputmode="decimal" ${attrs("pp", id, "pay", "num")} value="${fmtNum(p.pay)}" aria-label="${esc(possessive(p.name || "Their"))} pay, after tax"></div>
      ${vIn("pp", id, "freq", p.freq, FREQ_OPTS, "freq", "How often they're paid")}</div>
    <div class="fig-sub">${K(`inc.${id}.sub`)}</div>
    <div class="payday"><label for="pd-${esc(id)}">A recent payday</label><input type="date" id="pd-${esc(id)}" ${attrs("pp", id, "payday", "date")} value="${esc(p.payday)}">${tipq("Paid fortnightly? Roughly every 11 years a calendar year has 27 paydays instead of 26. Paid weekly? Some years have 53. That’s one extra pay, which is handy to plan for.")}</div>
    <div class="p27" data-k="p27.${esc(id)}" data-base="p27"></div>
    <div class="swatches" role="group" aria-label="Colour">${COLOUR_KEYS.map(k => `<button type="button" class="swatch-btn pc-${k}" data-colour="${k}" data-i="${esc(id)}" aria-pressed="${k === p.colour}" aria-label="${PERSON_COLOURS[k].label}" title="${PERSON_COLOURS[k].label}"></button>`).join("")}</div>
  </div>`;
}

export function view() {
  const S = app.state, P = S.people, multi = P.length > 1, w = WORDS[S.viewAs];
  const A = S.accounts;
  const ownerOpts = [["", "Shared"], ...P.map(p => [p.id, p.name || "Unnamed"])];
  return `${attnBox()}
  <div class="note-row"><input class="note-input" size="${Math.max(30, Math.round((S.note || "").length * 0.82) + 2)}" ${attrs("root", "", "note", "text")} value="${esc(S.note)}" placeholder="+ Add a note to the top of your budget" aria-label="Budget note">${S.note ? '<button class="note-x" type="button" id="noteX" aria-label="Remove note">×</button>' : ""}<span>Tinted fields are inputs; everything else works itself out. Changes save as you go.</span></div>
  <div class="hero">
    ${P.map(p => personCard(p, multi)).join("")}
    ${P.length < MAX_PEOPLE ? `<button class="add-person" type="button" data-addperson><span>+</span>Add a person</button>` : ""}
    ${multi ? `<div class="cell-h combined"><div class="fig-label">Combined household, ${w.per}</div><div class="fig">${K("inc.c")}</div><div class="fig-sub">${K("inc.c.sub")}</div></div>
    <div class="ribbon" id="ribbon"></div><div class="ribbon-cap" id="ribbonCap"></div>` : ""}
  </div>

  <section>
    <div class="sec-head"><h2>Allocation plan</h2>${tipq(multi ? "Each payday, you each split your own pay across these accounts. When every column reaches 100%, every dollar has a job." : "Each payday, split your pay across these accounts. When the column reaches 100%, every dollar has a job.")}<span class="sec-note">What % of ${multi ? "your own" : "your"} pay goes where. Drag rows by the handle (or use the arrows on a phone) to reorder.</span></div>
    <div class="panel scroll w-acc cards"><table>
      <thead><tr><th></th>${TH("Account", "The real bank account or bucket the money lands in.")}${TH("Type", "Joint is shared, Personal belongs to one person, Investment is long-term money that grows.")}
        ${P.map(p => TH(`<span class="who ${pc(p)}">${esc(p.name || "Unnamed")}</span>% of pay`, `The share of ${possessive(p.name || "this person")} pay that goes to this account.`, "num") + TH("$ to account", `${possessive(p.name || "Their")} % turned into dollars ${w.per}. The faint bar shows its size compared with their whole pay.`, "num")).join("")}
        ${multi ? TH("Total", `What lands in this account ${w.per} from everyone.`, "num") : ""}<th></th></tr></thead>
      <tbody>${A.map(a => `<tr>
        <td class="c-grip">${grip("acc", a.id)}</td>
        <td class="c-name"><div class="name-wrap">${K(`acc.${a.id}.sw`, "swatch")}${tIn("acc", a.id, "name", a.name, "name", "Account name")}</div>${a.role ? `<div class="sub" title="${esc(ROLES[a.role])}">${esc(ROLES[a.role])}</div>` : ""}</td>
        <td data-label="Type"><div class="stack">${sIn("acc", a.id, "type", a.type, ["Joint", "Personal", "Investment"])}${multi && a.type === "Personal" && a.role !== "personalGoals" ? `<div style="margin-top:4px">${vIn("acc", a.id, "owner", a.owner || "", ownerOpts, "cell", "Whose account")}</div>` : ""}</div></td>
        ${P.map(p => `<td class="num" data-label="${esc(p.name || "Unnamed")} % of pay">${pIn("acc", a.id, `split.${p.id}`, a.split[p.id], pc(p), `${p.name} to ${a.name}`)}</td><td class="num pc" data-label="${esc(p.name || "Unnamed")} $">${K(`acc.${a.id}.b.${p.id}`, `pbar ${pc(p)}`)}<span class="pv">${K(`acc.${a.id}.v.${p.id}`)}</span></td>`).join("")}
        ${multi ? `<td class="num pc" data-label="Total">${K(`acc.${a.id}.tb`, "pbar t")}<b class="pv">${K(`acc.${a.id}.t`)}</b></td>` : ""}
        <td class="c-del">${a.role ? "" : del("acc", a.id)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td></td><td>Totals</td><td></td>${P.map(p => `<td class="num">${K(`tot.p.${p.id}`)}</td><td class="num">${K(`tot.a.${p.id}`)}</td>`).join("")}${multi ? `<td class="num">${K("tot.t")}</td>` : ""}<td></td></tr>
      <tr class="check"><td></td><td>${multi ? "Each column should total 100%" : "This should total 100%"}</td><td></td>${P.map(p => `<td class="num">${K(`tot.c.${p.id}`, "chip")}<span data-k="fill.${esc(p.id)}"></span></td><td></td>`).join("")}${multi ? "<td></td>" : ""}<td></td></tr></tfoot>
    </table><button class="add" type="button" data-add="acc">+ Add account</button></div>
  </section>

  <section>
    <div class="sec-head"><h2>Money flow</h2>${tipq(`Read it left to right: pay flows into accounts, and the ${spendLabel(S).toLowerCase()} pool splits into what it actually pays for. Thicker band, more money. Hover a band to see the amount.`)}<span class="sec-note">Where every ${w.noun}’s pay goes, in one picture.</span></div>
    <div class="panel"><div class="flow-wrap" id="flow"></div>
      <div class="flow-cap">${P.map(p => `<span><i style="background:${personVar(p)}"></i>From ${esc(p.name || "Unnamed")}</span>`).join("")}<span><i style="background:var(--unalloc)"></i>Not allocated / buffer</span></div></div>
  </section>

  <section>
    <div class="sec-head"><h2>Visual breakdown</h2><span class="sec-note">Same colour means the same account in every chart. Grey is pay not yet allocated.</span></div>
    <div class="panel"><div class="viz" id="donuts"></div><div class="legend" id="legend"></div></div>
  </section>

  <section>
    <div class="sec-head"><h2>Where the money lands</h2></div>
    <div class="stat-row">
      <div class="stat"><div class="k"><span class="dotc" style="background:var(--joint)"></span>Joint accounts</div><div class="v">${K("sum.joint")}</div><div class="s">${K("sum.joint.y")}</div></div>
      <div class="stat"><div class="k"><span class="dotc" style="background:var(--c-${P[0].colour})"></span>Personal accounts</div><div class="v">${K("sum.personal")}</div><div class="s">${K("sum.personal.y")}</div></div>
      <div class="stat"><div class="k"><span class="dotc" style="background:var(--invest)"></span>Investments</div><div class="v">${K("sum.investment")}</div><div class="s">${K("sum.investment.y")}</div></div>
    </div>
    <div class="panel" style="padding:18px 20px 16px;margin-top:14px">
      <h3 style="margin-bottom:12px">Investing vs cash savings</h3>
      <div class="split" id="invsplit"></div>
      <div class="split-key"><span><i style="background:var(--invest)"></i>${K("ivc.inv")}</span><span><i style="background:var(--joint)"></i>${K("ivc.cash")}</span></div>
    </div>
  </section>

  <section id="fairSec" hidden>
    <div class="sec-head"><h2>Fair split check</h2>${tipq("Households usually split shared costs either equally or in proportion to income. Neither is right or wrong; this just shows which one you’re actually doing.")}<span class="sec-note">How much each person puts into the shared pot, compared with what they earn.</span></div>
    <div class="panel fair">
      <div>
        <div class="fbar-row"><div class="lab"><span>Share of household income</span><span>${K("fair.inc")}</span></div><div class="fbar" id="fbInc"></div></div>
        <div class="fbar-row"><div class="lab"><span>Share of shared contributions (joint + investments)</span><span>${K("fair.sh")}</span></div><div class="fbar" id="fbSh"></div></div>
        <div class="split-key">${P.map(p => `<span><i style="background:${personVar(p)}"></i>${esc(p.name || "Unnamed")}</span>`).join("")}<span>${K("fair.line")}</span></div>
      </div>
      <div><p class="fair-verdict">${K("fair.verdict")}</p><p>${K("fair.detail")}</p><p>${K("fair.personal")}</p></div>
    </div>
  </section>

  <details class="help"><summary>How to use this tab</summary><ul>
    <li>Enter each person’s take-home pay and how often it arrives. Weekly, fortnightly and monthly pay can be mixed: everything is converted so it adds up.</li>
    <li>Use “Show amounts per” at the top to see every figure per week, fortnight or month.</li>
    <li>Set what % of each person’s pay goes to each account until each column reaches 100%. The bar under the tabs tracks this while you scroll, and “Fill” tops up the last few % into an account you choose.</li>
    <li>Personal Goals accounts are money for the Goals tab to draw from.</li>
    <li>Hover any ? for a quick explanation. Changes save automatically, and everyone in the household sees the same numbers.</li>
  </ul></details>`;
}

/** Other periods, for the line under each pay: "≈ $2,000 a fortnight, $4,333 a month, $52,000 a year". */
function equivalents(annual, skip) {
  return "≈ " + [...VIEWS.filter(v => v !== skip).map(v => `${m0(annual / perYear(v))} a ${WORDS[v].noun}`), `${m0(annual)} a year`].join(", ");
}

export function fill(D, C) {
  const S = app.state, v = C.v, w = WORDS[C.view];
  C.people.forEach(p => {
    D[`inc.${p.id}.sub`] = equivalents(p.annual, freqToView(p.freq));
    const xp = C.extraPay[p.id];
    D[`p27.${p.id}`] = p.freq === "monthly" ? { t: "Monthly pay always has 12 paydays a year.", c: "" }
      : xp === null ? { t: `Add a payday to check for ${p.freq === "weekly" ? "53" : "27"}-pay years.`, c: "" }
      : xp.length ? { t: `${xp[0].count} paydays in ${xp.slice(0, 3).map(x => x.year === app.today.getFullYear() ? x.year + " (this year)" : x.year).join(", ")}: one extra pay of ${m0(p.pay || 0)}`, c: "hit" }
      : { t: `No ${p.freq === "weekly" ? "53" : "27"}-pay years in the next 20 years.`, c: "" };
  });
  D["inc.c"] = m0(v(C.incTotal)); D["inc.c.sub"] = equivalents(C.incTotal, C.view);
  C.rows.forEach(r => {
    C.people.forEach(p => { D[`acc.${r.id}.v.${p.id}`] = money(v(r.by[p.id])); D[`acc.${r.id}.b.${p.id}`] = { pw: p.annual ? r.by[p.id] / p.annual : 0 }; });
    D[`acc.${r.id}.t`] = money(v(r.t)); D[`acc.${r.id}.tb`] = { pw: C.incTotal ? r.t / C.incTotal : 0 };
    D[`acc.${r.id}.sw`] = { bg: app.colours[r.id] };
  });
  const check100 = x => Math.round(x * 1e4) === 1e4 ? { t: "100%", c: "ok" } : { t: pct(x, 1), c: "bad" };
  C.people.forEach(p => { D[`tot.p.${p.id}`] = pct(C.tot.pct[p.id], 1); D[`tot.a.${p.id}`] = money(v(C.tot.amt[p.id])); D[`tot.c.${p.id}`] = check100(C.tot.pct[p.id]); });
  D["tot.t"] = money(v(C.tot.t));
  const yr = x => `${m0(x)} a year`;
  D["sum.joint"] = money(v(C.joint)); D["sum.joint.y"] = `${w.per}, ${yr(C.joint)}`;
  D["sum.personal"] = money(v(C.personal)); D["sum.personal.y"] = `${w.per}, ${yr(C.personal)}`;
  D["sum.investment"] = money(v(C.investment)); D["sum.investment.y"] = `${w.per}, ${yr(C.investment)}`;
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

  // fill buttons under each column
  C.people.forEach(p => {
    const rem = 1 - C.tot.pct[p.id];
    document.querySelectorAll(`[data-k="fill.${CSS.escape(p.id)}"]`).forEach(el => el.innerHTML = rem > 0.00005 ? `<button class="fill-btn" type="button" data-fill="${esc(p.id)}">Fill ${pct(rem, 1)}</button>` : "");
  });
}

export function draw(C) {
  const v = C.v, $ = s => document.querySelector(s);
  const rib = $("#ribbon"); if (rib) rib.innerHTML = C.incTotal ? C.people.map(p => `<span style="width:${p.annual / C.incTotal * 100}%;background:${personVar(p)}"></span>`).join("") : "";
  const cap = $("#ribbonCap"); if (cap) cap.innerHTML = C.incTotal ? C.people.filter(p => p.annual > 0).map(p => `<span>${esc(p.name || "Unnamed")} ${pct(p.annual / C.incTotal)}</span>`).join("") : "";
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

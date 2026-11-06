/* Investments tab: a 30-year projection of what regular investing could grow to. */
import { app } from "../ctx.js";
import { K, TH, tipq, attrs, attnBox } from "../inputs.js";
import { WORDS } from "../../model/periods.js";
import { money, m0, pct } from "../../model/format.js";
import { blank } from "../../model/util.js";
import { drawCurve } from "../charts.js";

export function view() {
  const S = app.state, w = WORDS[S.viewAs];
  const pctIn = (f, v, lab) => `<input class="stat-input" type="number" step="0.1" inputmode="decimal" ${attrs("root", "", f, "pct")} value="${blank(v) ? "" : +(v * 100).toFixed(4)}" aria-label="${lab}">%`;
  return `${attnBox()}
  <div class="stat-row">
    <div class="stat"><div class="k">Starting balance</div><div class="v">${K("iv.start")}</div><div class="s">From Investment accounts on Net worth</div></div>
    <div class="stat"><div class="k">Annual return ${tipq("The average yearly growth you expect, after tax. 5% is conservative, 7% is typical for index funds, 9% is growth-heavy.")}</div><div class="v">${pctIn("invest.rate", S.invest.rate, "Annual return percent")}</div><div class="s">Compound, after tax</div></div>
    <div class="stat"><div class="k">Contributions grow ${tipq("Optional. If your pay rises over time, your investment contributions probably will too. 2–3% a year roughly keeps pace with pay rises.")}</div><div class="v">${pctIn("invest.growth", S.invest.growth, "Yearly contribution increase percent")}</div><div class="s">Increase per year</div></div>
    <div class="stat"><div class="k">Fund fees ${tipq("Optional. Most funds charge a yearly fee as a % of your balance. Small numbers add up over decades.")}</div><div class="v">${pctIn("invest.fee", S.invest.fee, "Yearly fund fee percent")}</div><div class="s">Per year, on your balance</div></div>
    <div class="stat"><div class="k"><span class="dotc" style="background:var(--invest)"></span>Per ${w.noun}</div><div class="v">${K("iv.per")}</div><div class="s">${K("iv.yr")}</div></div>
  </div>

  <section><div class="sec-head"><h2>30-year curve</h2>${tipq("The gap between the two lines is compound growth: your returns earning returns of their own.")}<span class="sec-note">Hover the chart for any year.</span></div>
    <div class="panel"><div class="line-wrap" id="curve"></div>
      <div class="split-key" style="padding:0 18px 16px"><span><i style="background:var(--invest)"></i>Balance</span><span><i style="background:var(--faint)"></i>Contributed</span></div></div>
    <p class="pull">${K("iv.pull")}</p>
    <p class="pull" style="margin-top:6px">${K("iv.fees")}</p>
  </section>

  <section><div class="sec-head"><h2>Key milestones</h2></div>
    <div class="panel miles">${[5, 10, 20, 30].map(y => `<div><div class="k">At ${y} years</div><div class="v">${K(`iv.m${y}`)}</div><div class="s">${K(`iv.m${y}.s`)}</div></div>`).join("")}</div>
  </section>

  <section><div class="sec-head"><h2>Year by year</h2></div>
    <div class="panel scroll"><table>
      <thead><tr><th>Year</th>${TH("Contributed", "Your own money put in, including the starting balance.", "num")}${TH("Balance", "Projected value at the end of the year.", "num")}${TH("Compound growth", "Balance minus contributed: what the investments earned for you.", "num")}${TH("Multiplier", "Balance ÷ contributed. 2× means every dollar you put in became two.", "num")}</tr></thead>
      <tbody>${Array.from({ length: 30 }, (_, i) => i + 1).map(y => `<tr><td>${y}</td><td class="num">${K(`iv.y${y}.c`)}</td><td class="num"><b>${K(`iv.y${y}.b`)}</b></td><td class="num">${K(`iv.y${y}.g`)}</td><td class="num dim">${K(`iv.y${y}.x`)}</td></tr>`).join("")}</tbody>
    </table></div>
  </section>

  <details class="help"><summary>About this projection</summary><ul>
    <li>Contributions are spread evenly through the year and grow at a fixed yearly rate. Real markets are lumpier, so treat the curve as long-term shape, not a promise.</li>
    <li>Try 5% for conservative (cash and bonds heavy), 7% for typical index investing, 9% for growth-heavy.</li>
    <li>The amount going in comes from every Investment account on the Budget tab. Change it with those accounts’ % of pay.</li>
  </ul></details>`;
}

export function fill(D, C) {
  const I = C.inv, w = WORDS[C.view];
  D["iv.start"] = money(I.start); D["iv.per"] = money(C.v(I.annual)); D["iv.yr"] = `${m0(I.annual)} in year one`;
  [5, 10, 20, 30].forEach(y => { const d = I.years[y]; D[`iv.m${y}`] = m0(d.bal); D[`iv.m${y}.s`] = `Contributed ${m0(d.contrib)}, grown by ${m0(d.growth)}`; });
  for (let y = 1; y <= 30; y++) { const d = I.years[y]; D[`iv.y${y}.c`] = m0(d.contrib); D[`iv.y${y}.b`] = m0(d.bal); D[`iv.y${y}.g`] = m0(d.growth); D[`iv.y${y}.x`] = d.mult === null ? "—" : d.mult.toFixed(2) + "×"; }
  const d30 = I.years[30];
  document.querySelectorAll('[data-k="iv.pull"]').forEach(el => el.innerHTML = `In 30 years you’ll have put in <b>${m0(d30.contrib)}</b> of your own money, and compounding adds another <b>${m0(d30.growth)}</b> on top. Total: <b>${m0(d30.bal)}</b>.`);
  document.querySelectorAll('[data-k="iv.fees"]').forEach(el => el.innerHTML = I.fee > 0 ? `Fees of ${pct(I.fee, 2)} a year cost you about <b>${m0(d30.noFee - d30.bal)}</b> over 30 years.` : "");
}

export const draw = C => drawCurve(C);

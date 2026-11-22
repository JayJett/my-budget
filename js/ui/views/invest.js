/* Invest tab: a forecast of what regular investing could grow to, over the next 5 to 30 years.

   Layout only. Every figure comes from compute() → C.inv (projectInvestments in model/calc.js), exactly
   as before: the starting balance is the Investment accounts on Net worth, the amount going in is the
   Investment allocations on Budget, and the three assumptions are the same saved settings. Choosing
   how many years to look at, or tapping the chart, only changes what's shown: nothing is worked out
   again and nothing is saved. It's a projection, never shown as money you have. */
import { app, readOnly } from "../ctx.js";
import { esc } from "../dom.js";
import { K, TH, attrs } from "../inputs.js";
import { WORDS } from "../../model/periods.js";
import { money, m0, pct } from "../../model/format.js";
import { blank } from "../../model/util.js";
import { drawGrowth } from "../charts.js";

export const HORIZONS = [5, 10, 20, 30];          // milestones in the projection (it runs to 30 years)
const horizon = () => HORIZONS.includes(app.ivH) ? app.ivH : 30;
const picked = () => Math.min(app.ivSel ?? horizon(), horizon());
const pctText = v => `${+(Number(v || 0) * 100).toFixed(2)}%`;

export function view() {
  const S = app.state, w = WORDS[S.viewAs], h = horizon(), ro = readOnly();
  const empty = !!app.C && !(app.C.inv.start > 0) && !(app.C.inv.annual > 0); // nothing to forecast: no $0 chart or $0 milestones
  const hero = `<section class="ind-card iv-hero" aria-live="polite">
    ${empty ? `<div class="iv-empty"><h2>Nothing invested yet</h2><p class="ind-sub">Add an investment account in Wealth or allocate pay to investments in Budget.</p><span hidden>${K("iv.h.bal")}</span></div>`
      : `<p class="ind-kicker">${K("iv.h.lab")}</p>
    <div class="sp-head"><span class="amt ind-amount">${K("iv.h.bal")}</span></div>
    <p class="ind-sub">Illustrative estimate after fees, not a guarantee.</p>
    <div class="seg iv-h" role="group" aria-label="Years ahead">${HORIZONS.map(y => `<button type="button" data-iv-h="${y}" aria-label="${y} years" aria-pressed="${y === h}">${y}y</button>`).join("")}</div>
    <div class="iv-chart" id="ivChart" tabindex="0" role="group" aria-label="Forecast chart. Use the left and right arrow keys to pick a year." aria-describedby="ivRead"></div>
    <div class="iv-read" id="ivRead" aria-live="polite"></div>`}
  </section>`;
  const sources = `<section class="iv-src">
    <button type="button" class="card iv-src-i" data-tab="networth"><small>Starting investments</small><b>${K("iv.start")}</b><span>From Net worth</span></button>
    <button type="button" class="card iv-src-i" data-tab="budget"><small>Going in</small><b>${K("iv.per")}<i>${esc(w.short)}</i></b><span>From Budget · ${K("iv.yr")}</span></button>
  </section>`;
  const assumptions = `<section class="iv-as">
    <ul class="iv-as-l"><li><small>Return</small><b>${K("iv.as.rate")}</b></li><li><small>Contributions grow</small><b>${K("iv.as.growth")}</b></li><li><small>Fees</small><b>${K("iv.as.fee")}</b></li></ul>
  </section>`;
  const miles = `<section class="iv-miles"><div class="b-row sec"><h2>Milestones</h2></div>
    <div class="iv-m-grid">${HORIZONS.map(y => `<button type="button" class="card iv-m${y === h ? " on" : ""}" data-iv-h="${y}" aria-pressed="${y === h}"><small>${y} years</small><b>${K(`iv.m${y}`)}</b><span>${K(`iv.m${y}.s`)}</span></button>`).join("")}</div></section>`;
  const table = `<details class="ind-card ind-detail iv-years" id="ivYears"${app.ivYearsOpen ? " open" : ""}><summary><span>Yearly breakdown</span><small>All 30 years</small></summary>
    <div class="iv-tbl"><table>
      <thead><tr><th>Year</th>${TH("Put in", "Your own money put in so far, including the starting balance.", "num")}${TH("Balance", "Projected value at the end of the year.", "num")}${TH("Growth", "Balance minus what you put in: what the investments could earn, after fees.", "num")}${TH("Multiplier", "Balance ÷ put in. 2× means every dollar you put in became two.", "num")}</tr></thead>
      <tbody>${Array.from({ length: 30 }, (_, i) => i + 1).map(y => `<tr${y === h ? ' class="on"' : ""}><td>${y}</td><td class="num">${K(`iv.y${y}.c`)}</td><td class="num"><b>${K(`iv.y${y}.b`)}</b></td><td class="num">${K(`iv.y${y}.g`)}</td><td class="num dim">${K(`iv.y${y}.x`)}</td></tr>`).join("")}</tbody>
    </table></div></details>`;
  const help = `<details class="help"><summary>About this forecast</summary><ul>
    <li>It starts from your Investment accounts on Net worth and adds what your Investment allocations on Budget put in, spread evenly through each year.</li>
    <li>Returns compound and fees come off the balance every fortnight, so the growth shown is after fees. Contributions rise by the yearly increase you set.</li>
    <li>Markets go up and down; the smooth line is the long-term shape under fixed assumptions, not a prediction.</li>
  </ul></details>`;
  const advanced = document.getElementById("ivDetails")?.open;
  return `<div class="iv-page"><div class="iv-side">${hero}
    <button class="ind-primary iv-edit" type="button" data-iv-edit>${ro ? "View assumptions" : "Edit assumptions"}</button></div>
    <div class="iv-main"><details class="ind-card ind-detail iv-details" id="ivDetails"${advanced ? " open" : ""}><summary>Forecast assumptions and breakdown</summary>
      ${assumptions}${sources}${empty ? "" : `<div class="sp-figs iv-figs"><div><small>You put in</small><b>${K("iv.h.c")}</b></div><div><small>Growth after fees</small><b>${K("iv.h.g")}</b></div></div>${miles}`}${help}</details>
      ${empty ? "" : table}</div></div>`;
}

/** The assumptions sheet (opened from ui/budget-sheets.js). The same three saved settings as before. */
export function investSheet() {
  const S = app.state, dis = readOnly() ? " disabled" : "";
  const field = (f, v, label, help) => `<label class="bs-field"><span>${label}</span>
      <span class="unit wide nw-bal"><input type="number" step="0.1" inputmode="decimal" ${attrs("root", "", f, "pct")} value="${blank(v) ? "" : +(v * 100).toFixed(4)}" aria-label="${esc(label)} percent"${dis}><i>%</i></span>
      <small class="bs-sub">${help}</small></label>`;
  return `<div class="bs-hero"><span class="gl-ic big iv-ic" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12l3.5-4 3 2.5 4.5-6"/><path d="M10.5 4.5h3v3"/></svg></span>
      <div><div class="bs-amt">${K("iv.h.bal")}</div><small>${K("iv.h.lab")}</small></div></div>
    ${field("invest.rate", S.invest.rate, "Yearly return", "The average yearly growth you assume, after tax. Real returns vary year to year.")}
    ${field("invest.growth", S.invest.growth, "Contributions grow by", "Optional. How much more you put in each year, for example as pay rises.")}
    ${field("invest.fee", S.invest.fee, "Fund fees", "Optional. The fund’s yearly fee, as a % of the balance.")}
    <p class="bs-note" data-k="iv.fees"></p>`;
}

/** The figures beside the chart for the picked year (straight from the projection). */
function readout(C) {
  const el = document.querySelector("#ivRead"); if (!el) return;
  const y = picked(), d = C.inv.years[y];
  el.innerHTML = `<b>${y === 0 ? "Now" : `Year ${y}`}</b><span>Balance ${m0(d.bal)}</span>`;
}

export function fill(D, C) {
  const I = C.inv, w = WORDS[C.view];
  D["iv.start"] = money(I.start); D["iv.per"] = money(C.v(I.annual)); D["iv.yr"] = `${m0(I.annual)} in year one`;
  [5, 10, 20, 30].forEach(y => { const d = I.years[y]; D[`iv.m${y}`] = m0(d.bal); D[`iv.m${y}.s`] = `Contributed ${m0(d.contrib)}, grown by ${m0(d.growth)}`; });
  for (let y = 1; y <= 30; y++) { const d = I.years[y]; D[`iv.y${y}.c`] = m0(d.contrib); D[`iv.y${y}.b`] = m0(d.bal); D[`iv.y${y}.g`] = m0(d.growth); D[`iv.y${y}.x`] = d.mult === null ? "—" : d.mult.toFixed(2) + "×"; }
  const d30 = I.years[30];
  document.querySelectorAll('[data-k="iv.pull"]').forEach(el => el.innerHTML = `In 30 years you’ll have put in <b>${m0(d30.contrib)}</b> of your own money, and compounding adds another <b>${m0(d30.growth)}</b> on top. Total: <b>${m0(d30.bal)}</b>.`);
  document.querySelectorAll('[data-k="iv.fees"]').forEach(el => el.innerHTML = I.fee > 0 ? `Fees of ${pct(I.fee, 2)} a year cost you about <b>${m0(d30.noFee - d30.bal)}</b> over 30 years.` : "");
  // new: the forecast for the years chosen (the same yearly figures as the milestones and table)
  const h = horizon(), dh = I.years[h];
  D["iv.h.bal"] = m0(dh.bal); D["iv.h.lab"] = `Projected in ${h} years`;
  D["iv.h.c"] = m0(dh.contrib); D["iv.h.g"] = m0(dh.growth);
  D["iv.as.rate"] = pctText(I.rate); D["iv.as.growth"] = pctText(I.g); D["iv.as.fee"] = pctText(I.fee);
  D["iv.perw"] = w.short;
}

export function draw(C) {
  const el = document.querySelector("#ivChart"); if (!el) return;
  const pick = y => { app.ivSel = y; drawGrowth(el, C.inv.years, horizon(), y, pick); readout(C); };
  drawGrowth(el, C.inv.years, horizon(), picked(), pick);
  readout(C);
}

export function initInvest() {
  document.addEventListener("click", e => {
    const hb = e.target.closest("[data-iv-h]");
    if (hb) { app.ivH = Number(hb.dataset.ivH); app.ivSel = app.ivH; app.render(); return; }
  });
  document.addEventListener("toggle", e => { if (e.target.id === "ivYears") app.ivYearsOpen = e.target.open; }, true);
  let t = null; // redraw the chart at the new width when the screen turns
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (app.tab === "invest" && app.C) draw(app.C); }, 200); });
}

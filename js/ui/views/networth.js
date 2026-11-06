/* Net worth tab: real account balances, and whether goal money lines up with savings. */
import { app } from "../ctx.js";
import { esc } from "../dom.js";
import { K, TH, tipq, tIn, sIn, $In, grip, del, attrs, attnBox } from "../inputs.js";
import { nwStatus } from "../../model/calc.js";
import { money, m0 } from "../../model/format.js";
import { n, blank } from "../../model/util.js";

export function view() {
  const S = app.state, L = S.nw.accounts;
  return `${attnBox()}
  <div class="stat-row">
    <div class="stat big"><div class="k">Net worth ${tipq("Everything you own (cash, savings, investments, super) minus everything you owe.")}</div><div class="v">${K("nw.net")}</div><div class="s">${K("nw.net.sub")}</div></div>
    <div class="stat"><div class="k">Cash</div><div class="v">${K("nw.cash")}</div><div class="s">Operating + savings</div></div>
    <div class="stat"><div class="k">Investments</div><div class="v">${K("nw.inv")}</div><div class="s">Feeds the Investments tab</div></div>
    <div class="stat"><div class="k">Super / debt</div><div class="v">${K("nw.supdebt")}</div><div class="s">Long-term, and what you owe</div></div>
  </div>
  <div class="review"><label for="rev">Last reviewed</label>
    <input type="date" class="cell" id="rev" ${attrs("root", "", "nw.reviewed", "date")} value="${esc(S.nw.reviewed || "")}">
    <button class="btn small" type="button" id="revToday">Reviewed today</button>${K("nw.rev", "chip")}</div>

  <section>
    <div class="sec-head"><h2>Accounts</h2><span class="sec-note">One row per real account. Goals on the Goals tab are tagged to these, so each name should be unique.</span></div>
    <div class="panel scroll cards"><table>
      <thead><tr><th></th>${TH("Account name", "Use the same name you’d recognise in your banking app. Goals are matched to accounts by this name.")}${TH("Type", "Operating: everyday bills. Savings: where goal money lives. Investment: shares and funds. Super: retirement, like KiwiSaver. Debt: what you owe.")}${TH("Balance", "What’s in the account right now.", "num")}${TH("Earmarked", "How much of this balance is already promised to goals (their Saved amounts).", "num")}${TH("Buffer", "Balance minus earmarked: money in the account that no goal has claimed yet.", "num")}${TH("Status", "Whether goals and the balance line up.")}<th></th></tr></thead>
      <tbody>${L.map(a => `<tr>
        <td class="c-grip">${grip("nw", a.id)}</td>
        <td class="c-name">${tIn("nw", a.id, "name", a.name, "name", "Account name")}</td>
        <td data-label="Type">${sIn("nw", a.id, "type", a.type, ["Operating", "Savings", "Investment", "Super", "Debt"])}</td>
        <td class="num" data-label="Balance">${$In("nw", a.id, "balance", a.balance, "", "Balance")}</td>
        <td class="num" data-label="Earmarked">${K(`nw.${a.id}.em`)}</td><td class="num" data-label="Buffer">${K(`nw.${a.id}.buf`)}</td>
        <td data-label="Status">${K(`nw.${a.id}.st`, "chip")}</td><td class="c-del">${del("nw", a.id)}</td></tr>`).join("")}</tbody>
    </table><button class="add" type="button" data-add="nw">+ Add account</button></div>
  </section>

  <details class="help"><summary>How it works</summary><ul>
    <li>Operating accounts are where daily bills come out, so they aren’t reconciled against goals.</li>
    <li>Savings accounts hold goal money. Earmarked adds up what’s tagged to the account on the Goals tab; Buffer is what’s left over.</li>
    <li>Investment balances feed the starting balance on the Investments tab.</li>
    <li>Enter debts as positive numbers; they’re subtracted from your assets.</li>
    <li>Update balances roughly monthly and press “Reviewed today”.</li>
  </ul></details>`;
}

export function fill(D, C) {
  D["nw.net"] = money(C.nw.net); D["nw.net.sub"] = `Assets ${m0(C.nw.assets)} minus liabilities ${m0(C.nw.debt)}`;
  D["nw.cash"] = money(C.nw.cash); D["nw.inv"] = money(C.nw.inv); D["nw.supdebt"] = `${m0(C.nw.sup)} / ${m0(C.nw.debt)}`;
  D["nw.rev"] = C.reviewDue ? { t: "Review due", c: "warn" } : { t: "Recently reviewed", c: "ok" };
  app.state.nw.accounts.forEach(a => {
    const em = C.earmark[a.id], named = !blank(a.name), noEm = ["Operating", "Super", "Debt", "Investment"].includes(a.type);
    D[`nw.${a.id}.em`] = !named || noEm ? "" : money(em);
    D[`nw.${a.id}.buf`] = !named ? "" : a.type === "Savings" ? money(n(a.balance) - em) : a.type === "Debt" ? "" : money(n(a.balance));
    D[`nw.${a.id}.st`] = nwStatus(a, em, C);
  });
}

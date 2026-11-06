/* Test budgets for the Invest regression test (all from the shared RICH fixture): different starting
   balances, contributions and assumptions. Figures come from tabFigures("invest", …) in nwgoals-figures.mjs. */
export function investCases(RICH, toStored, migrate) {
  const base = () => migrate(RICH);
  const tweak = f => { const s = base(); f(s); return toStored(s); };
  const noInvestAccounts = s => { s.accounts.forEach(a => { if (a.type === "Investment") Object.keys(a.split).forEach(k => { a.split[k] = 0; }); }); };
  return {
    rich: toStored(base()),                                                         // $8,000 start, 7% / 2% / 0.5%
    noStart: tweak(s => { s.nw.accounts = s.nw.accounts.filter(a => a.type !== "Investment"); }),
    noContrib: tweak(noInvestAccounts),
    nothing: tweak(s => { noInvestAccounts(s); s.nw.accounts = s.nw.accounts.filter(a => a.type !== "Investment"); }),
    flat: tweak(s => { s.invest = { rate: 0, growth: 0, fee: 0 }; }),
    negative: tweak(s => { s.invest = { rate: -0.02, growth: 0, fee: 0.01 }; }),
    big: tweak(s => { s.invest = { rate: 0.12, growth: 0.05, fee: 0 }; s.nw.accounts.find(a => a.type === "Investment").balance = 2500000; }),
    twoAccounts: tweak(s => { s.nw.accounts.push({ id: "n9", name: "Shares", type: "Investment", balance: 4321.5, pos: 9 }); }),
  };
}

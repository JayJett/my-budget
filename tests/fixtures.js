/* Sample budgets used by the tests. */

/** The exact shape of the budget saved in the live database before the upgrade (Nov 2026). */
export const LIVE_V3 = {
  nw: { accounts: [{ id: "xg4s1cei", name: "test", type: "Debt", balance: 50000 }, { id: "xw7fghwj", name: "cash", type: "Savings", balance: 200000 }, { id: "xqmkmsy5", name: "", type: "Investment", balance: 50000 }], reviewed: "" },
  note: "",
  goals: { ef: { id: "ef", name: "Emergency Fund", saved: null, target: null, account: "", deadline: "" }, madi: [], joint: [], jarden: [] },
  spend: [],
  income: { j: 1000, m: 500 },
  invest: { fee: 0, rate: 0.07, growth: 0 },
  paydays: { j: "", m: "" },
  version: 3,
  accounts: [
    { j: null, m: null, id: "js", name: "Joint Spending", type: "Joint" },
    { j: null, m: null, id: "ef", name: "Emergency Fund", type: "Joint" },
    { j: null, m: null, id: "jg", name: "Joint Goals", type: "Joint" },
    { j: 0.5, m: null, id: "ji", name: "Joint Investments", type: "Investment" },
    { j: null, m: null, id: "jpg", name: "Jarden — Personal Goals", type: "Personal" },
    { j: null, m: null, id: "mpg", name: "Madi — Personal Goals", type: "Personal" },
  ],
};

/** A fuller version 3 budget that uses every feature. */
export const RICH_V3 = {
  version: 3, note: "Test budget",
  income: { j: 2400, m: 1900 }, paydays: { j: "2026-01-01", m: "2025-12-25" },
  accounts: [
    { id: "js", name: "Joint Spending", type: "Joint", j: 0.4, m: 0.45 },
    { id: "ef", name: "Emergency Fund", type: "Joint", j: 0.05, m: 0.05 },
    { id: "jg", name: "Joint Goals", type: "Joint", j: 0.1, m: 0.1 },
    { id: "ji", name: "Joint Investments", type: "Investment", j: 0.1, m: 0.05 },
    { id: "jpg", name: "Jarden — Personal Goals", type: "Personal", j: 0.1, m: null },
    { id: "mpg", name: "Madi — Personal Goals", type: "Personal", j: null, m: 0.1 },
    { id: "xjs", name: "Jarden Spending", type: "Personal", j: 0.25, m: null },
    { id: "xms", name: "Madi Spending", type: "Personal", j: null, m: 0.25 },
  ],
  nw: { reviewed: "2026-02-20", accounts: [
    { id: "n1", name: "Everyday", type: "Operating", balance: 1500 },
    { id: "n2", name: "Joint Savings", type: "Savings", balance: 12000 },
    { id: "n3", name: "Index fund", type: "Investment", balance: 8000 },
    { id: "n4", name: "KiwiSaver", type: "Super", balance: 30000 },
    { id: "n5", name: "Car loan", type: "Debt", balance: 6000 },
  ] },
  spend: [
    { id: "s1", name: "Rent", type: "Fixed", amount: 1200, period: "Fortnight", notes: "", due: null, aside: null },
    { id: "s2", name: "Power", type: "Fixed", amount: 180, period: "Month", notes: "", due: null, aside: null },
    { id: "s3", name: "Groceries", type: "Flexible", amount: 300, period: "Fortnight", notes: "", due: null, aside: null },
    { id: "s4", name: "Car rego", type: "Sinking", amount: 120, period: "Year", notes: "", due: 7, aside: 30 },
    { id: "s5", name: "Insurance", type: "Sinking", amount: 1300, period: "Year", notes: "", due: 11, aside: 900 },
  ],
  goals: {
    ef: { id: "ef", name: "Emergency Fund", target: 15000, saved: 9000, account: "Joint Savings", deadline: "" },
    joint: [
      { id: "g1", name: "Holiday", target: 3000, saved: 3000, account: "Joint Savings", j: 0.5, m: 0.5, deadline: "" },
      { id: "g2", name: "New couch", target: 2000, saved: 200, account: "Joint Savings", j: 0.5, m: 0.3, deadline: "2026-09-01" },
      { id: "g3", name: "House deposit", target: 80000, saved: 0, account: "Joint Savings", j: null, m: 0.2, deadline: "" },
    ],
    jarden: [{ id: "g4", name: "Bike", target: 1500, saved: 100, account: "Joint Savings", pct: 1, deadline: "" }],
    madi: [
      { id: "g5", name: "Course", target: 900, saved: 900, account: "Joint Savings", pct: 0.6, deadline: "" },
      { id: "g6", name: "Camera", target: 1200, saved: 0, account: "Joint Savings", pct: 0.4, deadline: "" },
    ],
  },
  invest: { rate: 0.07, growth: 0.02, fee: 0.005 },
};

export const TODAY = new Date(2026, 2, 1); // 1 March 2026

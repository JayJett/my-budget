/* The setup guide's thinking: turn a few answers into a suggested split and a ready-made budget.
   No page code here, so it's tested on its own (tests/onboarding.test.js).

   answers = {
     purpose: "household" | "solo" | "saving" | "debt" | "family",
     people: [{ name, pay, freq, payday }],                 // 1–4 people
     have: { savings, emergency, kiwisaver, investments,     // balances (numbers or blank)
             debts: [{ name, balance }] },
     goal: { name, target, deadline },                       // only for "saving for something"
   }

   answers.mode = "solo" | "shared" (Phase 8): who the budget is FOR, chosen in step 1 ("Just me" or
   "With someone"). It's not the same as how many people are listed: someone budgeting with a partner
   may add only their own pay at first, and still gets a shared plan.

   A solo plan is built for one person: every allocation is theirs (no "Joint"), and there's one Goals
   allocation rather than "Goals" plus "Personal Goals". The money still feeds the same places (the
   Spending tab, the emergency fund, goals, investments): that's decided by each allocation's role.

   The split is the same % of each person's own pay, so bigger earners put in more dollars
   (a split "in proportion to income"). People can change it all later. */

import { VERSION, makePerson, personalGoalsName, MAX_PEOPLE } from "./schema.js";
import { perYear, freqToView } from "./periods.js";
import { n, blank, uid, ymd } from "./util.js";

export const PURPOSES = {
  household: { label: "Our shared household", blurb: "Two or more of you, sharing bills and goals." },
  solo:      { label: "Just me",              blurb: "Your own money, your own plan." },
  saving:    { label: "Saving for something", blurb: "A house deposit, a trip, a car…" },
  debt:      { label: "Paying off debt",      blurb: "Clear what you owe, step by step." },
  family:    { label: "Our family",           blurb: "Kids, bills and everything in between." },
};

/** Yearly take-home pay for everyone together. */
export const householdIncome = people => people.reduce((s, p) => s + n(p.pay) * perYear(p.freq || "fortnightly"), 0);
/** Three months of "bills & essentials" at the suggested 50% (55% for families). */
export const emergencyTarget = (people, purpose) => Math.round(householdIncome(people) * (purpose === "family" ? 0.55 : 0.5) / 12 * 3);

/** Solo or shared, from the answers: an explicit mode wins; otherwise "solo" purpose means solo. */
export const planMode = answers => answers.mode === "solo" || answers.mode === "shared" ? answers.mode : (answers.purpose === "solo" ? "solo" : "shared");

/** The suggested split: a list of buckets with a % of each person's pay, always adding to 100%. */
export function suggestSplit(answers) {
  const purpose = answers.purpose || "household";
  const solo = planMode(answers) === "solo";
  const have = answers.have || {};
  const debtTotal = (have.debts || []).reduce((s, d) => s + n(d.balance), 0);
  const efCovered = n(have.emergency) > 0 && n(have.emergency) >= emergencyTarget(answers.people || [], purpose);

  const pct = { essentials: 50, fun: 15, emergency: 10, goals: 10, invest: 10, personalGoals: 5, debt: 0 };
  const why = [];
  if (purpose === "family") { pct.essentials = 55; pct.fun = 10; why.push("Families usually spend more on essentials, so bills get 55%."); }
  if (purpose === "saving") { pct.goals += 5; pct.invest -= 5; why.push("You’re saving for something, so goals get a bigger share."); }
  if (purpose === "debt" && debtTotal > 0) { pct.debt = pct.invest; pct.invest = 0; why.push("Paying off debt usually beats investing, so investing waits until the debt is gone."); }
  if (efCovered) {
    const freed = pct.emergency; pct.emergency = 0;
    if (pct.debt > 0) pct.debt += freed; else { pct.goals += freed / 2; pct.invest += freed / 2; }
    why.push("Your emergency fund already covers about three months of essentials, so that money goes elsewhere.");
  } else why.push("10% builds an emergency fund towards three months of essentials.");
  why.push("Everyone puts in the same % of their own pay, so the split is in proportion to income.");

  if (solo) {
    // One person: their own goals and "personal goals" are the same thing, so it's one Goals allocation
    // with both shares (e.g. 10% + 5% = 15%). Nothing else about the suggestion changes.
    pct.goals += pct.personalGoals; pct.personalGoals = 0;
    const buckets = [
      { key: "essentials", name: "Bills & essentials", type: "Personal", role: "spending", pct: pct.essentials, help: "Rent or mortgage, power, groceries, insurance, transport." },
      { key: "fun", name: "Spending money", type: "Personal", role: null, pct: pct.fun, perPerson: true, help: "Your own money to spend, no questions asked." },
      { key: "emergency", name: "Emergency Fund", type: "Personal", role: "emergency", pct: pct.emergency, help: "A safety net for surprises." },
      { key: "goals", name: "Goals", type: "Personal", role: "goals", pct: pct.goals, help: "Saving for the things you want." },
      { key: "invest", name: "Investments", type: "Investment", role: "invest", pct: pct.invest, help: "Long-term money that grows." },
    ];
    if (pct.debt > 0) buckets.splice(2, 0, { key: "debt", name: "Debt repayments", type: "Personal", role: null, pct: pct.debt, help: "Extra payments on top of the minimums." });
    return { buckets, why, debtTotal, efCovered, mode: "solo" };
  }
  const buckets = [
    { key: "essentials", name: "Bills & essentials", type: "Joint", role: "spending", pct: pct.essentials, help: "Rent or mortgage, power, groceries, insurance, transport." },
    { key: "fun", name: "Spending money", type: "Personal", role: null, pct: pct.fun, perPerson: true, help: "Each person’s own money to spend, no questions asked." },
    { key: "emergency", name: "Emergency Fund", type: "Joint", role: "emergency", pct: pct.emergency, help: "A safety net for surprises." },
    { key: "goals", name: "Joint Goals", type: "Joint", role: "goals", pct: pct.goals, help: "Saving for the things you want, together." },
    { key: "invest", name: "Joint Investments", type: "Investment", role: "invest", pct: pct.invest, help: "Long-term money that grows." },
    { key: "personalGoals", name: "Personal Goals", type: "Personal", role: "personalGoals", pct: pct.personalGoals, perPerson: true, help: "Each person’s own savings goals." },
  ];
  if (pct.debt > 0) buckets.splice(2, 0, { key: "debt", name: "Debt repayments", type: "Joint", role: null, pct: pct.debt, help: "Extra payments on top of the minimums." });
  return { buckets, why, debtTotal, efCovered, mode: "shared" };
}

const total = buckets => buckets.reduce((s, b) => s + n(b.pct), 0);
export const splitTotal = total;

/** Build a full version 4 budget from the answers and the (possibly tweaked) split. */
export function buildBudget(answers, split, today = new Date()) {
  const purpose = answers.purpose || "household";
  const mode = split.mode || planMode(answers), solo = mode === "solo";
  const raw = (answers.people || []).filter(p => !blank(p.name) || n(p.pay) > 0).slice(0, solo ? 1 : MAX_PEOPLE);
  const list = raw.length ? raw : [{ name: "" }];
  const colours = [];
  const people = list.map((p, i) => {
    const person = makePerson({ name: (p.name || "").trim(), pay: blank(p.pay) ? null : n(p.pay), freq: p.freq || "fortnightly", payday: p.payday || "", pos: i + 1 }, colours);
    colours.push(person.colour);
    return person;
  });
  const fixedIds = { essentials: "js", emergency: "ef", goals: "jg", invest: "ji" };
  const accounts = [];
  const put = (a) => accounts.push({ split: {}, owner: null, role: null, ...a, pos: accounts.length + 1 });
  const pctOf = b => Math.round(n(b.pct) * 100) / 10000; // 50 → 0.5, keeping 2 decimal places of a %
  for (const b of split.buckets) {
    if (b.perPerson) {
      people.forEach(p => {
        const name = b.role === "personalGoals" ? personalGoalsName(p.name) : solo ? b.name : `${p.name || "Personal"} — ${b.name}`;
        put({ id: uid(), name, type: "Personal", owner: p.id, role: b.role, split: n(b.pct) ? { [p.id]: pctOf(b) } : {} });
      });
    } else {
      const sp = {}; if (n(b.pct)) people.forEach(p => { sp[p.id] = pctOf(b); });
      // solo: the whole plan is this one person's money, so each allocation is theirs
      put({ id: fixedIds[b.key] || uid(), name: b.name, type: b.type, owner: solo && b.type === "Personal" ? people[0].id : null, role: b.role, split: sp });
    }
  }
  // Shared plans: every person has a personal-goals account. (Solo plans have one Goals allocation instead.)
  if (!solo) people.forEach(p => { if (!accounts.some(a => a.role === "personalGoals" && a.owner === p.id)) put({ id: uid(), name: personalGoalsName(p.name), type: "Personal", owner: p.id, role: "personalGoals" }); });

  // What you already have → Net worth
  const have = answers.have || {}, nw = [];
  const addNW = (name, type, balance) => nw.push({ id: uid(), name, type, balance: blank(balance) ? null : n(balance), pos: nw.length + 1 });
  if (!blank(have.savings) || (purpose === "saving" && answers.goal && !blank(answers.goal.name))) addNW("Savings", "Savings", have.savings);
  // (Phase 9A) only an account someone actually told us about: no empty "Emergency Fund" placeholder.
  // The emergency fund is a goal; which account holds its money is chosen later, so nothing is counted twice.
  if (!blank(have.emergency)) addNW("Emergency Fund", "Savings", have.emergency);
  if (!blank(have.kiwisaver)) addNW("KiwiSaver", "Super", have.kiwisaver);
  if (!blank(have.investments)) addNW("Investments", "Investment", have.investments);
  (have.debts || []).filter(d => !blank(d.name) || n(d.balance) > 0).forEach(d => addNW(d.name || "Debt", "Debt", d.balance));

  // Goals
  const efTarget = emergencyTarget(people, purpose);
  const ef = { id: "ef", name: "Emergency Fund", target: efTarget || null, saved: blank(have.emergency) ? null : n(have.emergency), account: blank(have.emergency) ? "" : "Emergency Fund", deadline: "" };
  const joint = [];
  const g = answers.goal;
  if (purpose === "saving" && g && !blank(g.name)) {
    joint.push({ id: uid(), name: g.name.trim(), target: blank(g.target) ? null : n(g.target), saved: blank(have.savings) ? null : n(have.savings),
      account: "Savings", split: Object.fromEntries(people.map(p => [p.id, 1])), deadline: g.deadline || "", pos: 1 });
  }

  return {
    version: VERSION,
    note: "",
    mode,
    viewAs: freqToView(people[0].freq),
    people,
    accounts,
    nw: { reviewed: nw.some(a => a.balance !== null) ? ymd(today) : "", accounts: nw },
    spend: [],
    goals: { ef, joint, personal: Object.fromEntries(people.map(p => [p.id, []])) },
    invest: { rate: 0.07, growth: 0, fee: 0 },
  };
}

/** Phase 9C.2: setup step 2. Everyone whose pay is entered needs a valid last payday of their own,
    today or earlier (it sets their payday plan). Someone with no pay yet needs none. Nothing is filled
    in for anyone. Returns { index: message } for the ones that can't be used yet (empty when all fine). */
export function paydayErrors(people, todayYmd) {
  const out = {};
  (people || []).forEach((p, i) => {
    if (!(Number(p.pay) > 0)) return;
    const d = String(p.payday || "").trim();
    if (!d) { out[i] = "Add the date you were last paid"; return; }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d), dt = m && new Date(+m[1], +m[2] - 1, +m[3]);
    if (!m || !dt || dt.getFullYear() !== +m[1] || dt.getMonth() !== +m[2] - 1 || dt.getDate() !== +m[3]) { out[i] = "That isn’t a date"; return; }
    if (todayYmd && d > todayYmd) out[i] = "Pick your last payday: today or earlier";
  });
  return out;
}

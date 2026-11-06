/* The setup guide's thinking: turn a few answers into a suggested split and a ready-made budget.
   No page code here, so it's tested on its own (tests/onboarding.test.js).

   answers = {
     purpose: "household" | "solo" | "saving" | "debt" | "family",
     people: [{ name, pay, freq, payday }],                 // 1–4 people
     have: { savings, emergency, kiwisaver, investments,     // balances (numbers or blank)
             debts: [{ name, balance }] },
     goal: { name, target, deadline },                       // only for "saving for something"
   }

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

/** The suggested split: a list of buckets with a % of each person's pay, always adding to 100%. */
export function suggestSplit(answers) {
  const purpose = answers.purpose || "household";
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

  const multi = (answers.people || []).length > 1;
  const buckets = [
    { key: "essentials", name: "Bills & essentials", type: "Joint", role: "spending", pct: pct.essentials, help: "Rent or mortgage, power, groceries, insurance, transport." },
    { key: "fun", name: "Spending money", type: "Personal", role: null, pct: pct.fun, perPerson: true, help: "Each person’s own money to spend, no questions asked." },
    { key: "emergency", name: "Emergency Fund", type: "Joint", role: "emergency", pct: pct.emergency, help: "A safety net for surprises." },
    { key: "goals", name: multi ? "Joint Goals" : "Goals", type: "Joint", role: "goals", pct: pct.goals, help: "Saving for the things you want." },
    { key: "invest", name: multi ? "Joint Investments" : "Investments", type: "Investment", role: "invest", pct: pct.invest, help: "Long-term money that grows." },
    { key: "personalGoals", name: "Personal Goals", type: "Personal", role: "personalGoals", pct: pct.personalGoals, perPerson: true, help: "Each person’s own savings goals." },
  ];
  if (pct.debt > 0) buckets.splice(2, 0, { key: "debt", name: "Debt repayments", type: multi ? "Joint" : "Personal", role: null, pct: pct.debt, help: "Extra payments on top of the minimums." });
  return { buckets, why, debtTotal, efCovered };
}

const total = buckets => buckets.reduce((s, b) => s + n(b.pct), 0);
export const splitTotal = total;

/** Build a full version 4 budget from the answers and the (possibly tweaked) split. */
export function buildBudget(answers, split, today = new Date()) {
  const purpose = answers.purpose || "household";
  const raw = (answers.people || []).filter(p => !blank(p.name) || n(p.pay) > 0).slice(0, MAX_PEOPLE);
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
        const name = b.role === "personalGoals" ? personalGoalsName(p.name) : `${p.name || "Personal"} — ${b.name}`;
        put({ id: uid(), name, type: "Personal", owner: p.id, role: b.role, split: n(b.pct) ? { [p.id]: pctOf(b) } : {} });
      });
    } else {
      const sp = {}; if (n(b.pct)) people.forEach(p => { sp[p.id] = pctOf(b); });
      put({ id: fixedIds[b.key] || uid(), name: b.name, type: b.type, role: b.role, split: sp });
    }
  }
  // Every person must have a personal-goals account (the app relies on it).
  people.forEach(p => { if (!accounts.some(a => a.role === "personalGoals" && a.owner === p.id)) put({ id: uid(), name: personalGoalsName(p.name), type: "Personal", owner: p.id, role: "personalGoals" }); });

  // What you already have → Net worth
  const have = answers.have || {}, nw = [];
  const addNW = (name, type, balance) => nw.push({ id: uid(), name, type, balance: blank(balance) ? null : n(balance), pos: nw.length + 1 });
  if (!blank(have.savings) || (purpose === "saving" && answers.goal && !blank(answers.goal.name))) addNW("Savings", "Savings", have.savings);
  addNW("Emergency Fund", "Savings", have.emergency);
  if (!blank(have.kiwisaver)) addNW("KiwiSaver", "Super", have.kiwisaver);
  if (!blank(have.investments)) addNW("Investments", "Investment", have.investments);
  (have.debts || []).filter(d => !blank(d.name) || n(d.balance) > 0).forEach(d => addNW(d.name || "Debt", "Debt", d.balance));

  // Goals
  const efTarget = emergencyTarget(people, purpose);
  const ef = { id: "ef", name: "Emergency Fund", target: efTarget || null, saved: blank(have.emergency) ? null : n(have.emergency), account: "Emergency Fund", deadline: "" };
  const joint = [];
  const g = answers.goal;
  if (purpose === "saving" && g && !blank(g.name)) {
    joint.push({ id: uid(), name: g.name.trim(), target: blank(g.target) ? null : n(g.target), saved: blank(have.savings) ? null : n(have.savings),
      account: "Savings", split: Object.fromEntries(people.map(p => [p.id, 1])), deadline: g.deadline || "", pos: 1 });
  }

  return {
    version: VERSION,
    note: "",
    viewAs: freqToView(people[0].freq),
    people,
    accounts,
    nw: { reviewed: nw.some(a => a.balance !== null) ? ymd(today) : "", accounts: nw },
    spend: [],
    goals: { ef, joint, personal: Object.fromEntries(people.map(p => [p.id, []])) },
    invest: { rate: 0.07, growth: 0, fee: 0 },
  };
}

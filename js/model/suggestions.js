/* Phase 9C.1: common expenses to start from. A fixed, hand-picked list (no AI), grouped so it's quick
   to scan. Picking one only ever adds what you chose, after you confirm.

   - The type (Fixed / Flexible / Sinking) and period are suggestions you can change. Whether something
     is essential is NOT guessed: that stays your call (Phase 9B).
   - An amount is optional. Left blank, the expense is saved with no amount (null, never 0): it shows as
     "Needs an amount" and isn't counted anywhere until it has one (model/intelligence.js incomplete).
   - Every expense in this app is paid from the budget's spending allocation (the Spending tab), for a
     shared household and on your own alike, so nothing here decides who pays. */
import { BILL_PERIODS } from "./periods.js";

const G = (key, label, items) => ({ key, label, items: items.map(([k, name, type, period, icon]) => ({ key: k, name, type, period, icon })) });
export const SUGGESTIONS = [
  G("housing", "Housing", [
    ["rent", "Rent", "Fixed", "Week", "home"], ["mortgage", "Mortgage repayments", "Fixed", "Fortnight", "key"],
    ["rates", "Council rates", "Sinking", "Year", "building"], ["bodycorp", "Body corporate", "Sinking", "Year", "building"],
  ]),
  G("utilities", "Utilities", [
    ["power", "Electricity", "Fixed", "Month", "bolt"], ["gas", "Gas", "Fixed", "Month", "bolt"], ["water", "Water", "Fixed", "Month", "drop"],
    ["internet", "Internet", "Fixed", "Month", "wifi"], ["mobile", "Mobile phone", "Fixed", "Month", "phone"],
  ]),
  G("living", "Everyday", [
    ["groceries", "Groceries", "Flexible", "Week", "basket"], ["fuel", "Fuel", "Flexible", "Week", "fuel"],
    ["pt", "Public transport", "Flexible", "Week", "bus"], ["household", "Household supplies", "Flexible", "Month", "bag"],
  ]),
  G("insurance", "Insurance", [
    ["contents", "Contents insurance", "Fixed", "Month", "umbrella"], ["carins", "Car insurance", "Fixed", "Month", "umbrella"],
    ["health", "Health insurance", "Fixed", "Month", "heart"], ["life", "Life insurance", "Fixed", "Month", "umbrella"],
  ]),
  G("subs", "Subscriptions", [
    ["streaming", "Streaming", "Fixed", "Month", "repeat"], ["software", "Software", "Fixed", "Month", "laptop"], ["gym", "Gym", "Fixed", "Month", "heart"],
  ]),
  G("car", "Car", [
    ["rego", "Car rego", "Sinking", "Year", "car"], ["wof", "WOF", "Sinking", "Year", "car"], ["service", "Car servicing", "Sinking", "Year", "car"],
  ]),
  G("debt", "Repayments", [
    ["debt", "Debt repayments", "Fixed", "Month", "card"], ["loan", "Loan repayments", "Fixed", "Month", "bank"],
  ]),
  G("family", "Family & pets", [
    ["childcare", "Childcare", "Fixed", "Week", "baby"], ["school", "School costs", "Sinking", "Year", "book"], ["pets", "Pet costs", "Flexible", "Month", "paw"],
  ]),
];
export const ALL = SUGGESTIONS.flatMap(g => g.items);
export const byKey = k => ALL.find(x => x.key === k) || null;

const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
/** Names already in the budget (to show "already added"; adding another is still allowed). */
export function existingNames(S) { return new Set((S.spend || []).map(e => norm(e.name)).filter(Boolean)); }
export const alreadyHas = (S, name) => existingNames(S).has(norm(name));

/** Read what was typed for an amount: "" → null (no amount yet), a number above 0, or an error. */
export function readAmount(raw) {
  const t = String(raw == null ? "" : raw).replace(/[$,\s]/g, "");
  if (t === "") return { ok: true, value: null };
  const v = Number(t);
  if (!isFinite(v) || v <= 0) return { ok: false, error: "Enter an amount above $0, or leave it blank" };
  return { ok: true, value: Math.round(v * 100) / 100 };
}

/**
 * The expenses to add, from picks [{ key, amount (text), period }] in the order chosen. Nothing is
 * added for anything not picked. Returns { ok, items, errors: { key: message } }. ids: a function
 * giving a new id (each expense gets its id here, once, so saving twice can't add it twice).
 */
export function buildExpenses(S, picks, ids) {
  const errors = {}, items = [];
  let pos = Math.max(0, ...(S.spend || []).map(e => Number(e.pos) || 0));
  for (const p of picks || []) {
    const s = byKey(p.key); if (!s) continue;
    const a = readAmount(p.amount);
    const period = BILL_PERIODS.includes(p.period) ? p.period : s.period;
    if (!a.ok) { errors[p.key] = a.error; continue; }
    items.push({ id: p.id || ids(), name: s.name, type: s.type, amount: a.value, period, notes: "", due: null, aside: null, pos: ++pos, icon: s.icon });
  }
  return { ok: !Object.keys(errors).length && items.length > 0, items, errors };
}

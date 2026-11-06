/* Pay frequencies and "view as" periods.

   The rule used everywhere: turn every amount into a YEARLY amount first,
   then divide by how many of the chosen period fit in a year.
   e.g. $2,000 a fortnight = $52,000 a year = $1,000 a week = $4,333.33 a month. */

import { addDays, addMonths } from "./util.js";

/** How often someone is paid. */
export const FREQS = ["weekly", "fortnightly", "monthly"];
/** Periods amounts can be shown in. */
export const VIEWS = ["week", "fortnight", "month"];
/** Periods a spending item can be billed in. */
export const BILL_PERIODS = ["Week", "Fortnight", "Month", "Year"];

const PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12, week: 52, fortnight: 26, month: 12, year: 1,
                   Week: 52, Fortnight: 26, Month: 12, Year: 1 };

/** How many of this period fit in a normal year (weekly → 52, fortnight → 26, month → 12, year → 1). */
export function perYear(period) {
  const k = PER_YEAR[period];
  if (!k) throw new Error(`Unknown period: ${period}`);
  return k;
}
/** An amount per period → an amount per year. */
export const toAnnual = (amount, period) => amount * perYear(period);
/** An amount per year → an amount per period. */
export const fromAnnual = (annual, period) => annual / perYear(period);
/** Convert straight from one period to another. */
export const convert = (amount, from, to) => fromAnnual(toAnnual(amount, from), to);

/** Length of one period in days, for "how many periods until …" questions.
    Weeks and fortnights are exact; a month is an average (30.44 days). */
export function periodDays(period) {
  if (period === "week" || period === "weekly") return 7;
  if (period === "fortnight" || period === "fortnightly") return 14;
  return 365.25 / perYear(period);
}

/** Step a date forward by a number of whole periods. */
export function addPeriods(date, k, period) {
  if (period === "week" || period === "weekly") return addDays(date, 7 * k);
  if (period === "fortnight" || period === "fortnightly") return addDays(date, 14 * k);
  if (period === "month" || period === "monthly") return addMonths(date, k);
  throw new Error(`Unknown period: ${period}`);
}

/** Words for labels: "per fortnight", "/fn", "fortnights" etc. */
export const WORDS = {
  week:      { per: "per week",      short: "/wk", plural: "weeks",      noun: "week",      adj: "Weekly" },
  fortnight: { per: "per fortnight", short: "/fn", plural: "fortnights", noun: "fortnight", adj: "Fortnightly" },
  month:     { per: "per month",     short: "/mo", plural: "months",     noun: "month",     adj: "Monthly" },
};
export const FREQ_WORDS = { weekly: "every week", fortnightly: "every fortnight", monthly: "every month" };
/** The matching view period for a pay frequency. */
export const freqToView = f => ({ weekly: "week", fortnightly: "fortnight", monthly: "month" }[f] || "fortnight");

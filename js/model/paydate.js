/* When people are paid. Moved here unchanged from home.js in Phase 10 so the daily reminders function
   (which has its own copy of js/model/) can use the very same maths as Home and the Payday Playbook.
   Dates are plain calendar days (no times, no time zones): a payday is a day, not a moment. */
import { parseDate, addDays, daysBetween } from "./util.js";

const DAYS = { weekly: 7, fortnightly: 14 };

/** The next payday on or after today, from any past or future payday and the pay frequency.
    Monthly pay keeps the same day of the month (the 31st becomes the last day of shorter months). */
export function nextPayday(payday, freq, today) {
  const d0 = parseDate(payday); if (!d0) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (freq === "monthly") {
    const day = d0.getDate(), at = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
    if (d0 >= t) return d0;
    let c = at(t.getFullYear(), t.getMonth());
    if (c < t) c = at(t.getFullYear(), t.getMonth() + 1);
    return c;
  }
  const step = DAYS[freq] || 14, diff = daysBetween(d0, t);
  if (diff <= 0) return d0;
  return addDays(d0, Math.ceil(diff / step) * step);
}

/** The payday `k` steps from the next one (k = -1 the one before it, 1 the one after), on the same
    schedule. Monthly pay keeps the day of the month from the payday it's counted from. */
export function payOccurrence(payday, freq, today, k = 0) {
  const next = nextPayday(payday, freq, today); if (!next) return null;
  if (!k) return next;
  if (freq === "monthly") {
    const day = parseDate(payday).getDate(), m = next.getMonth() + k, y = next.getFullYear() + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    return new Date(y, mm, Math.min(day, new Date(y, mm + 1, 0).getDate()));
  }
  return addDays(next, k * (DAYS[freq] || 14));
}

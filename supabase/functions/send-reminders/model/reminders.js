// COPY of js/model/ — don't edit here. Change js/model/ and run: node tools/sync-function.mjs
/* Gentle reminders: which ones a person gets today, and the words. No page code here.

   The same file runs in two places:
   - in the browser, to show "Based on your budget today, you'd get…" in Reminder settings;
   - in the daily Supabase function (supabase/functions/send-reminders), which puts them in people's inboxes.
   tools/sync-function.mjs copies js/model/ into the function, and a test checks the copies match.

   Every reminder has a `key`. The database sends each key to each person only once, so the key
   decides how often a reminder can repeat:
     review:2026-11             once a month
     sink-due:s4:2027-07-01     once per bill per due date
     sink-behind:s4:2026-W45    at most once a week, while it's behind
     goal-done:g1:3000          once per goal (again only if its target changes)
     goal-risk:g2:2026-W45      at most once a week, while it's at risk
     alloc:m:2026-W45           at most once a week, while it isn't 100%
     payday:pa:2026-11-18       once per person per payday (Phase 10; only to the member who is that person)  */
import { compute, goalStatus } from "./calc.js";
import { n, blank, is100, parseDate, daysBetween, ymd } from "./util.js";
import { WORDS } from "./periods.js";
import { money, m0, monthYear, possessive } from "./format.js";
import { nextPayday } from "./paydate.js";

/** Every reminder starts switched off. */
export const DEFAULT_PREFS = { review: false, review_day: 1, sink_due: false, due_weeks: 6, sink_behind: false, goal_done: false, goal_risk: false, allocation: false, payday: false };
export const DUE_WEEKS = [2, 4, 6, 8];

/** The switches, with plain-language explanations (used by the settings screen). */
export const REMINDER_TYPES = [
  { pref: "review", title: "Review your balances", help: "Once a month, a nudge to update your account balances on the Net worth tab, so your Progress charts stay accurate." },
  { pref: "sink_due", title: "Yearly bill due soon", help: "A heads-up before a yearly bill (a sinking fund, like car rego) is due, and how much is set aside for it." },
  { pref: "sink_behind", title: "Yearly bill falling behind", help: "When less is set aside for a yearly bill than there should be by now, and how much to put aside to catch up." },
  { pref: "goal_done", title: "Goal reached", help: "A small celebration when a goal is fully funded." },
  { pref: "goal_risk", title: "Goal deadline at risk", help: "When a goal with a deadline won’t get there at the current rate, and how much more it needs." },
  { pref: "allocation", title: "Allocation not at 100%", help: "When someone’s pay isn’t fully allocated on the Budget tab (or adds up to more than 100%), so every dollar has a job." },
  { pref: "payday", title: "It’s payday", help: "On your payday, a nudge that your payday plan is ready. No amounts are shown in the notification.", needsPerson: true },
];

/** "2026-W45": the ISO week a date falls in (Monday to Sunday). */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

const pctText = v => (Math.round(v * 1000) / 10).toString().replace(/\.0$/, "") + "%";

/** The reminders one person should have today, for one household's budget (in-memory shape).
    `today` is a Date at midnight, NZ date. Returns [{ kind, key, title, body, tab }]. */
export function remindersFor(S, prefs, today, { personId = null } = {}) {
  const P = { ...DEFAULT_PREFS, ...(prefs || {}) }, out = [];
  if (!S || !S.people || !S.people.length) return out;
  const C = compute(S, today), w = WORDS[C.view], week = isoWeek(today);
  const add = (kind, key, title, body, tab) => out.push({ kind, key, title, body, tab });

  // Monthly balance review: on the chosen day, or the first check after it if a day was missed.
  if (P.review && today.getDate() >= Math.min(28, Math.max(1, n(P.review_day) || 1))) {
    const rev = parseDate(S.nw.reviewed);
    const last = rev ? ` They were last reviewed on ${rev.toLocaleDateString("en-NZ", { day: "numeric", month: "long" })}.` : "";
    if (!rev || daysBetween(rev, today) >= 7) // already done this week? no need to nag
      add("review", `review:${ymd(today).slice(0, 7)}`, "Time to review your balances",
        `Update your account balances on the Net worth tab, so your net worth and Progress charts stay accurate.${last}`, "networth");
  }

  // Yearly bills (sinking funds)
  C.sp.forEach(s => {
    const k = s.sink; if (!k) return;
    const days = daysBetween(today, k.next);
    if (P.sink_due && days <= n(P.due_weeks || 6) * 7) {
      const weeks = Math.round(days / 7), when = weeks <= 1 ? (days <= 7 ? "next week" : "in about a week") : `in about ${weeks} weeks`;
      const aside = blank(s.aside) ? `It’s ${m0(k.A)}.` : n(s.aside) >= k.A ? `It’s ${m0(k.A)}, and you’ve set aside enough. 👍` : `It’s ${m0(k.A)}, and ${m0(n(s.aside))} is set aside so far.`;
      add("sink_due", `sink-due:${s.id}:${ymd(k.next)}`, `${s.name} is due in ${k.next.toLocaleDateString("en-NZ", { month: "long" })}`, `That’s ${when}. ${aside}`, "spending");
    }
    if (P.sink_behind && k.behind)
      add("sink_behind", `sink-behind:${s.id}:${week}`, `${s.name} is behind by ${m0(k.behind)}`,
        `Put aside ${money(k.need)} a ${w.noun} to be ready by ${monthYear(k.next)}.`, "spending");
  });

  // Goals: the emergency fund, joint goals, and each person's
  const goals = [{ g: S.goals.ef, per: C.pool.emergency, ef: true, label: "The emergency fund" }];
  S.goals.joint.forEach((g, i) => goals.push({ g, per: C.gj.eff[i] }));
  C.people.forEach(p => (S.goals.personal[p.id] || []).forEach((g, i) => goals.push({ g, per: C.gp[p.id].eff[i], who: p })));
  goals.forEach(({ g, per, ef, label, who }) => {
    if (blank(g.name)) return;
    const name = label || (who && C.multi ? `${possessive(who.name || "Someone")} goal “${g.name}”` : g.name);
    const target = n(g.target);
    if (P.goal_done && target > 0 && n(g.saved) >= target)
      add("goal_done", `goal-done:${g.id}:${target}`, `🎉 ${ef ? "The emergency fund is" : `${g.name} is`} fully funded!`,
        `${name} has reached its target of ${m0(target)}. Nice work.`, "goals");
    if (P.goal_risk && !blank(g.deadline)) {
      const st = goalStatus(g, per, !!ef, today, C.view);
      if (st.c === "bad") {
        const dl = parseDate(g.deadline), short = Math.max(target - n(g.saved), 0);
        const body = st.t === "Deadline passed"
          ? `The deadline (${dl ? dl.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : g.deadline}) has passed, and it’s ${m0(short)} short. Pick a new deadline, or put more towards it.`
          : `At the current rate it won’t reach ${m0(target)} by ${monthYear(dl)}. It ${st.t.toLowerCase().replace(/\/(wk|fn|mo)/, ` a ${w.noun}`)} to get there.`;
        add("goal_risk", `goal-risk:${g.id}:${week}`, `${ef ? "The emergency fund" : g.name} might miss its deadline`, body, "goals");
      }
    }
  });

  // Allocation: each earner's pay should add up to 100%
  if (P.allocation) C.people.forEach(p => {
    const t = C.tot.pct[p.id];
    if (!(p.annual > 0) || is100(t)) return;
    const who = C.multi ? possessive(p.name || "Someone") : "Your";
    const body = t < 1
      ? `${pctText(1 - t)} of each pay has no job yet. Adjust the Allocation plan on the Budget tab so it adds up to 100%.`
      : `That’s ${pctText(t - 1)} more than the pay itself. Adjust the Allocation plan on the Budget tab so it adds up to 100%.`;
    add("allocation", `alloc:${p.id}:${week}`, `${who} pay is ${pctText(t)} allocated`, body, "budget");
  });

  // Phase 10: it's payday. Only for the person this member said they are; no amounts (lock screens).
  if (P.payday && personId) {
    const p = S.people.find(x => x.id === personId);
    const next = p && n(p.pay) > 0 ? nextPayday(p.payday, p.freq, today) : null;
    if (next && ymd(next) === ymd(today))
      add("payday", `payday:${p.id}:${ymd(today)}`, "It’s payday!", "Your payday plan is ready in Moni Money.", "payday");
  }
  return out;
}

/** Today's date in New Zealand, as a Date at midnight (for the daily function, which runs on UTC time). */
export function nzToday(now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-").map(Number);
  return new Date(y, m - 1, d);
}

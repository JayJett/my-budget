/* The daily reminders run (called by index.ts). Plain JavaScript, so the tests can run it in Node too.

   1. Fetch, with the run's one-time pass, the budgets of households where someone has reminders on.
   2. Work out each person's reminders with the app's own rules (model/reminders.js, a copy of js/model/).
   3. Hand them back with the same pass. The database skips any already sent and fills the inboxes.

   `sb` is a Supabase client signed in as nobody (the public anon key): the pass is what lets it in. */
import { migrate } from "./model/migrate.js";
import { remindersFor } from "./model/reminders.js";

export async function runReminders(sb, token) {
  const { data, error } = await sb.rpc("reminder_run_data", { p_token: token });
  if (error) throw new Error(error.message);
  const [y, m, d] = String(data.today).split("-").map(Number);
  const today = new Date(y, m - 1, d); // NZ date, at midnight
  const items = [], problems = [];
  for (const h of data.households || []) {
    try {
      const S = migrate(h.state);
      if (!S) continue;
      for (const p of h.people || []) {
        for (const r of remindersFor(S, p.prefs, today)) items.push({ ...r, user_id: p.user_id, household_id: h.id });
      }
    } catch (e) {
      problems.push(`${h.id}: ${e && e.message}`); // one odd budget shouldn't stop everyone else's reminders
    }
  }

  /* EMAIL REMINDERS (not set up yet).
     To add email later:
       1. Choose an email service (e.g. Resend or Postmark), and add its API key in the Supabase dashboard:
          Edge Functions → Secrets → e.g. EMAIL_API_KEY. Never put it in the code or in js/config.js.
       2. Add an "email" switch to reminder_prefs (default off), and include the person's email address in
          what reminder_run_data returns (from household_members.email) for people who turned it on.
       3. Have reminder_run_save return the reminders that were actually new (not ones already sent),
          and send one short email per person here, listing them, with a link to the app.
     Keep it gentle: one email per person per day at most, and an unsubscribe link back to Reminder settings. */

  const { data: created, error: e2 } = await sb.rpc("reminder_run_save", { p_token: token, p_items: items });
  if (e2) throw new Error(e2.message);
  return { households: (data.households || []).length, worked_out: items.length, created, problems };
}

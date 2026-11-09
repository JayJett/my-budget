/* The daily reminders run (called by index.ts). Plain JavaScript, so the tests can run it in Node too.

   1. Fetch, with the run's one-time pass, the budgets of households where someone has reminders on.
   2. Work out each person's reminders with the app's own rules (model/reminders.js, a copy of js/model/).
   3. Hand them back with the same pass. The database skips any already sent and fills the inboxes.

   `sb` is a Supabase client signed in as nobody (the public anon key): the pass is what lets it in. */
import { migrate } from "./model/migrate.js";
import { remindersFor } from "./model/reminders.js";
import { sendPush } from "./webpush.js";

/** Where each tab lives in the app (matches TAB_HASH in js/ui/ctx.js). */
const TAB_HASH = { budget: "budget", networth: "net-worth", spending: "joint-spending", goals: "goals", invest: "investments", progress: "progress", payday: "payday" };

/** One notification per person: a single reminder as it is, several as "3 new reminders". */
export function notificationFor(list) {
  if (list.length === 1) {
    const r = list[0];
    return { title: r.title, body: r.body, url: `./#${TAB_HASH[r.tab] || "budget"}`, tag: "mb-reminders" };
  }
  const body = list.map(r => r.title).join(" · ");
  return { title: `${list.length} new reminders`, body: body.length > 180 ? body.slice(0, 179) + "…" : body, url: "./#reminders", tag: "mb-reminders" };
}

/** Send each person's new reminders to their devices. Returns { sent: [ids], gone: [ids], failed }. */
export async function deliver(pushes, devices, { jwk, subject, send = sendPush }) {
  const out = { sent: [], gone: [], failed: 0 };
  const byUser = new Map();
  for (const p of pushes || []) { if (!byUser.has(p.user_id)) byUser.set(p.user_id, []); byUser.get(p.user_id).push(p); }
  for (const d of devices || []) {
    const list = byUser.get(d.user_id); if (!list) continue;
    try {
      const r = await send(d, notificationFor(list), { jwk, subject });
      if (r.ok) out.sent.push(d.id); else if (r.gone) out.gone.push(d.id); else out.failed++;
    } catch (_) { out.failed++; }
  }
  return out;
}

/** opts.jwk: the private key (from the VAPID_PRIVATE_KEY secret), or null if phone notifications aren't set up.
    opts.send: replaced in the tests by a pretend push service. */
export async function runReminders(sb, token, opts = {}) {
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
        for (const r of remindersFor(S, p.prefs, today, { personId: p.person_id || null })) items.push({ ...r, user_id: p.user_id, household_id: h.id });
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

  const { data: saved, error: e2 } = await sb.rpc("reminder_run_save", { p_token: token, p_items: items });
  if (e2) throw new Error(e2.message);
  // Phone and computer notifications for the brand-new reminders (if set up)
  const push = opts.jwk ? await deliver(saved.pushes, saved.devices, opts) : { sent: [], gone: [], failed: 0, notSetUp: true };
  const { error: e3 } = await sb.rpc("reminder_run_finish", { p_token: token, p_gone: push.gone, p_sent: push.sent });
  if (e3) throw new Error(e3.message);
  return { households: (data.households || []).length, worked_out: items.length, created: saved.created, problems,
    push: push.notSetUp ? "not set up" : { sent: push.sent.length, gone: push.gone.length, failed: push.failed } };
}

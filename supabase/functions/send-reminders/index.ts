// Reminders function. Three jobs, all without any secret key except the push signing key:
//  1. { token }      The morning run, started by the database (public.start_reminder_run) with a one-time pass.
//                    Fills inboxes, then sends phone/computer notifications for new reminders.
//  2. { publicKey }  The app asks for the public half of the push key, to turn notifications on.
//  3. { test }       "Send a test" from Reminder settings, signed in: a test notification to your own devices.
// It uses the public anon key that Supabase gives every function (plus your sign-in, for the test).
// The push signing key is the VAPID_PRIVATE_KEY secret, which you add in the Supabase dashboard
// (made by tools/make-push-keys.html). Without it, everything works except notifications.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runReminders } from "./run.js";
import { sendPush, publicKeyFromJwk, b64u } from "./webpush.js";

const SUBJECT = "https://jayjett.github.io/my-budget/"; // who's sending, for Apple and Google
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

function pushKey() {
  try {
    const jwk = JSON.parse(Deno.env.get("VAPID_PRIVATE_KEY") || "null");
    return jwk && jwk.d && jwk.x && jwk.y ? jwk : null;
  } catch (_) { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* no body */ }
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const jwk = pushKey();

  if (body.publicKey) {
    if (!jwk) return json({ error: "Phone notifications aren’t set up yet" }, 503);
    return json({ publicKey: b64u.encode(publicKeyFromJwk(jwk)) });
  }

  if (body.test) {
    if (!jwk) return json({ error: "Phone notifications aren’t set up yet" }, 503);
    const auth = req.headers.get("Authorization") || "";
    const sb = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
    const { data: devices, error } = await sb.rpc("push_test_targets"); // checks you're signed in, and the once-a-minute limit
    if (error) return json({ error: error.message }, 400);
    const message = { title: "🔔 Test from My Budget", body: "Notifications are working on this device. Reminders arrive around 8:30am.", url: "./#budget", tag: "mb-test" };
    let sent = 0, failed = 0; const gone: number[] = [];
    for (const d of devices || []) {
      try { const r = await sendPush(d, message, { jwk, subject: SUBJECT }); if (r.ok) sent++; else if (r.gone) gone.push(d.id); else failed++; }
      catch (_) { failed++; }
    }
    if (gone.length) await sb.from("push_subscriptions").delete().in("id", gone);
    return json({ sent, failed, gone: gone.length });
  }

  const token = String(body.token || "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "Missing pass" }, 400);
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  try {
    return json(await runReminders(sb, token, { jwk, subject: SUBJECT }));
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});

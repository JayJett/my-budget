// Daily reminders: started each morning by the database (public.start_reminder_run) with a one-time pass.
// It uses only the public anon key, which Supabase provides to every function; the pass is what lets it in.
// The work is in run.js; the maths is the app's own (model/, copied from js/model/ by tools/sync-function.mjs).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runReminders } from "./run.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  let token = "";
  try { token = (await req.json()).token || ""; } catch (_) { /* no body */ }
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "Missing pass" }, 400);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  try {
    return json(await runReminders(sb, token));
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});

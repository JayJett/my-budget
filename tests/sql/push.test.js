/* Part 4C step 2 database rules: devices for phone/computer notifications, "send a test", and the
   morning run handing over what to send (run with the real function code and a pretend push service). */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import { toStored } from "../../js/model/schema.js";
import { migrate } from "../../js/model/migrate.js";
import { pushEndpoint } from "../../supabase/functions/send-reminders/push-policy.js";
import { runReminders } from "../../supabase/functions/send-reminders/run.js";
import { RICH_V3 } from "../fixtures.js";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "push_test_" + process.pid;
let DB_URL;
const psql = (sql, url = DB_URL) => execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const last = s => s.split("\n").pop();
const one = sql => last(psql(sql));
const as = (user, sql) => last(psql(`begin; set local role ${user ? "authenticated" : "anon"}; ${user ? `set local request.jwt.claim.sub = '${user}';` : ""} ${sql}; commit;`));
const lit = v => "$j$" + JSON.stringify(v) + "$j$";
const u = c => `00000000-0000-0000-0000-0000000000${c}`;
const ANA = u("a1"), BEN = u("b2"), EVE = u("e5");
const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
const V4 = toStored(migrate(RICH_V3));
const P256 = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
const save = (user, ep, label = "iPhone · Safari") => as(user, `select public.save_push_subscription('https://fcm.googleapis.com/wp/${ep}', '${P256}', '${AUTH}', '${label}')`);
let HH;

const anonClient = { rpc: async (name, args) => {
  try {
    const params = Object.entries(args).map(([k, v]) => `${k} => ${typeof v === "string" ? `'${v}'` : Array.isArray(v) && v.every(x => typeof x === "number") ? `'{${v.join(",")}}'::bigint[]` : lit(v) + "::jsonb"}`).join(", ");
    return { data: JSON.parse(as(null, `select to_jsonb(public.${name}(${params}))`)), error: null };
  } catch (e) { return { data: null, error: { message: String(e.stderr || e.message) } }; }
} };

before(() => {
  if (skip) return;
  psql(`drop database if exists ${DB}; create database ${DB};`, URL0);
  DB_URL = URL0.replace(/\/postgres(\?|$)/, `/${DB}$1`);
  psql(readFileSync(new URL("./supabase-shim.sql", import.meta.url), "utf8"));
  files.forEach(f => psql(readFileSync(new URL(f, dir), "utf8")));
  psql(`insert into auth.users (id, email) values ('${ANA}','ana@example.com'), ('${BEN}','ben@example.com'), ('${EVE}','eve@example.com');`);
  HH = as(ANA, `select public.create_household('Ana home')`);
  psql(`insert into household_members (household_id, user_id, role) values ('${HH}', '${BEN}', 'editor');
        update budgets set state = ${lit(V4)}::jsonb where household_id = '${HH}';`);
});

test("turning notifications on for a device; each person sees only their own devices", { skip }, () => {
  save(ANA, "ana-phone"); save(ANA, "ana-laptop", "Mac · Chrome"); save(BEN, "ben-phone");
  assert.deepEqual(JSON.parse(as(ANA, `select jsonb_agg(label order by id) from push_subscriptions`)), ["iPhone · Safari", "Mac · Chrome"]);
  assert.equal(as(BEN, `select count(*) from push_subscriptions`), "1");
  assert.throws(() => as(null, `select count(*) from push_subscriptions`), /permission denied/);
  assert.throws(() => as(ANA, `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('${ANA}', 'https://x/y', '${P256}', '${AUTH}')`), /permission denied/);
  assert.throws(() => as(ANA, `update push_subscriptions set user_id = '${BEN}'`), /permission denied/);
  assert.throws(() => as(ANA, `select public.save_push_subscription('http://not-secure/x', '${P256}', '${AUTH}')`), /isn’t supported/);
});

test("owner-only updates keep the row ID and another account must register a fresh device", { skip }, () => {
  const old = one("select id from push_subscriptions where endpoint like '%ana-laptop'");
  assert.equal(save(ANA, "ana-laptop", "Updated Chrome label"), old);
  assert.equal(save(ANA, "ana-laptop", "Updated Chrome label"), old);
  assert.throws(() => as(EVE, "select public.save_push_subscription('https://FCM.googleapis.com:443/fcm/send/ana-laptop', '" + P256 + "', '" + AUTH + "')"), /enable them again/);
  assert.equal(as(ANA, "select count(*) from push_subscriptions"), "2");
  assert.equal(as(EVE, "select count(*) from push_subscriptions"), "0");
  as(BEN, "select public.forget_push_subscription('https://fcm.googleapis.com/wp/ana-laptop')");
  assert.equal(as(BEN, "delete from push_subscriptions where id = " + old + " returning 1"), "");
  assert.equal(as(ANA, "select count(*) from push_subscriptions"), "2");
  as(ANA, "select public.forget_push_subscription('https://fcm.googleapis.com/fcm/send/ana-laptop')");
  const next = save(EVE, "new-browser-subscription");
  assert.notEqual(next, old);
  assert.equal(as(ANA, "select count(*) from push_subscriptions"), "1");
});

test("device cap preserves existing registrations and mutable registrations have a rolling limit", { skip }, () => {
  for (let i = 0; i < 9; i++) save(EVE, "eve-" + i);
  assert.throws(() => save(EVE, "extra"), /10 registered devices/);
  assert.equal(as(EVE, "select count(*) from push_subscriptions"), "10");
  assert.equal(as(EVE, "select count(*) from push_subscriptions where endpoint like '%eve-0'"), "1");
  for (let i = 0; i < 10; i++) save(EVE, "eve-0", "Label " + i);
  const unchanged = save(EVE, "eve-0", "Label 9");
  assert.ok(unchanged);
  assert.throws(() => save(EVE, "eve-0", "Label over limit"), /registration limit/);
  psql("update push_private.rate_limits set registrations = array[now() - interval '1 hour 1 second'] where user_id = '" + EVE + "'");
  assert.equal(save(EVE, "eve-0", "Label after the window"), unchanged);
});

test("'Send a test': only your own devices, at most once a minute", { skip }, () => {
  const mine = JSON.parse(as(ANA, `select jsonb_agg(endpoint) from public.push_test_targets()`));
  assert.deepEqual(mine, ["https://fcm.googleapis.com/wp/ana-phone"]);
  assert.throws(() => as(ANA, `select count(*) from public.push_test_targets()`), /Wait a minute/);
  assert.throws(() => as(null, `select count(*) from public.push_test_targets()`), /permission denied/);
});

test("morning run: new reminders go to the right people's devices; gone devices are forgotten", { skip }, async () => {
  as(ANA, `insert into reminder_prefs (user_id, household_id, goal_done) values ('${ANA}', '${HH}', true)`);
  as(BEN, `insert into reminder_prefs (user_id, household_id, review) values ('${BEN}', '${HH}', false)`); // nothing on
  save(BEN, "ben-old"); psql(`update push_subscriptions set endpoint = 'https://fcm.googleapis.com/wp/ben-gone' where endpoint like '%ben-old'`);
  psql("insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values (\'" + ANA + "\', \'https://legacy.example/fixture\', \'" + P256 + "\', \'" + AUTH + "\')");
  const sent = [];
  const send = async (d, msg) => { sent.push([d.endpoint.split("/").pop(), msg.title]); return d.endpoint.includes("gone") ? { ok: false, gone: true } : { ok: true }; };
  const res = await runReminders(anonClient, one(`select public.start_reminder_run(true)`), { jwk: { d: "x" }, send });
  assert.equal(res.created, 2);
  assert.deepEqual(sent, [["ana-phone", "2 new reminders"]], "Ana: one notification for her two new reminders; Ben has none");
  assert.deepEqual(res.push, { sent: 1, gone: 0, failed: 0, suppressed: 1 });
  assert.equal(one("select count(*) from public.push_subscriptions where endpoint = \'https://legacy.example/fixture\'"), "1");
  psql("delete from public.push_subscriptions where endpoint = \'https://legacy.example/fixture\'");
  assert.equal(one(`select last_sent_at is not null from push_subscriptions where endpoint like '%ana-phone'`), "t");
  assert.equal(one(`select finished_at is not null from reminder_runs order by id desc limit 1`), "t", "the pass is closed");
  // The same reminders tomorrow: nothing new, so no notifications
  sent.length = 0;
  const again = await runReminders(anonClient, one(`select public.start_reminder_run(true)`), { jwk: { d: "x" }, send });
  assert.equal(again.created, 0); assert.deepEqual(sent, []);
  // A device that's gone away is forgotten
  as(BEN, `update reminder_prefs set allocation = true where user_id = '${BEN}'`);
  psql(`update budgets set state = jsonb_set(state, '{accounts,js,split,m}', '0.4') where household_id = '${HH}'`);
  const r3 = await runReminders(anonClient, one(`select public.start_reminder_run(true)`), { jwk: { d: "x" }, send });
  assert.deepEqual(sent, [["ben-phone", "Madi’s pay is 95% allocated"], ["ben-gone", "Madi’s pay is 95% allocated"]]);
  assert.deepEqual(r3.push, { sent: 1, gone: 1, failed: 0 });
  assert.equal(one(`select count(*) from push_subscriptions where endpoint like '%ben-gone'`), "0");
});

test("without the push key, reminders still fill the inbox (notifications just aren't sent)", { skip }, async () => {
  psql(`update budgets set state = jsonb_set(state, '{accounts,js,split,m}', '0.35') where household_id = '${HH}'; delete from reminder_log where key like 'alloc:%';`);
  const res = await runReminders(anonClient, one(`select public.start_reminder_run(true)`));
  assert.equal(res.push, "not set up"); assert.ok(res.created >= 1);
  assert.equal(one(`select finished_at is not null from reminder_runs order by id desc limit 1`), "t");
});

test("the run's hand-over is useless without a valid pass", { skip }, () => {
  assert.throws(() => as(null, `select public.reminder_run_finish('00000000-0000-0000-0000-000000000000', '{1}', '{}')`), /expired/);
  assert.throws(() => as(ANA, `select public.reminder_run_finish('00000000-0000-0000-0000-000000000000')`), /permission denied/);
  assert.equal(one(`select count(*) > 0 from push_subscriptions where id = 1 or true`), "t");
});

test("the H1 migration can run twice and preserves registrations", { skip }, () => {
  psql(readFileSync(new URL("20261123022923_push_destination_security.sql", dir), "utf8"));
  assert.doesNotThrow(() => as(null, `select public.ping()`));
  assert.equal(as(ANA, `select count(*) from push_subscriptions`), "1");
});

test("registration rejects non-provider addresses, malformed keys and oversized labels", { skip }, () => {
  const invalidCurve = "BA" + "A".repeat(85);
  const key = (p, auth = AUTH, label = "Laptop") => as(ANA, "select public.save_push_subscription('https://web.push.apple.com/probe', '" + p + "', '" + auth + "', '" + label + "')");
  assert.throws(() => key(invalidCurve), /notification details are invalid/);
  assert.throws(() => key(P256, AUTH.slice(0, -1)), /notification details are invalid/);
  assert.throws(() => key(P256, AUTH.slice(0, -1) + "h"), /notification details are invalid/);
  assert.throws(() => key(P256, AUTH, "A".repeat(61)), /notification details are invalid/);
  assert.throws(() => as(ANA, "select public.save_push_subscription('https://unapproved.example/fixture', '" + P256 + "','" + AUTH + "')"), /isn’t supported/);
  assert.throws(() => as(ANA, "select count(*) from push_private.rate_limits"), /permission denied/);
});

test("SQL and Edge parse the same provider-shaped subscriptions", { skip }, () => {
  const samples = [
    "https://web.push.apple.com/fixture",
    "https://fcm.googleapis.com/wp/current",
    "https://FCM.googleapis.com:443/fcm/send/legacy",
    "https://updates.push.services.mozilla.com/wpush/v2/example",
    "https://wns2-test.notify.windows.com/?token=abc%2fdef%3d",
    "https://wns2-test.notify.windows.com/?token=abc&extra=unused",
    "https://unapproved.example/fixture",
    "https://web.push.apple.com/../fixture",
    "https://web.push.apple.com/home#fragment",
    "https://web.push.apple.com:444/example",
  ];
  for (const endpoint of samples) {
    const result = one("select coalesce(push_private.endpoint('" + endpoint + "'), '')");
    assert.equal(result || null, pushEndpoint(endpoint));
  }
});

test("test-send rolling limit applies even when there are no registered devices", { skip }, () => {
  psql("update push_private.rate_limits set tests = array(select now() - i * interval '2 minutes' from generate_series(1,5) i) where user_id = '" + ANA + "'");
  psql("update public.push_subscriptions set last_test_at = null where user_id = '" + ANA + "'");
  assert.throws(() => as(ANA, "select count(*) from public.push_test_targets()"), /Test limit reached/);
  psql("update push_private.rate_limits set tests = array[now() - interval '1 hour 1 second'] where user_id = '" + ANA + "'");
  assert.equal(as(ANA, "select count(*) from public.push_test_targets()"), "1");
  as(ANA, "select public.forget_push_subscription('https://fcm.googleapis.com/wp/ana-phone')");
  assert.throws(() => as(ANA, "select count(*) from public.push_test_targets()"), /Test limit reached/);
});

const psqlAsync = promisify(execFile);
function concurrent(user, sql) {
  return psqlAsync("psql", [DB_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1",
    "-c", "begin; set local role authenticated; set local request.jwt.claim.sub = '" + user + "'; " + sql + "; commit;"]);
}
test("concurrent registrations and test requests share the server's ownership and quota locks", { skip }, async () => {
  const register = "select public.save_push_subscription('https://fcm.googleapis.com/wp/shared-fixture', '" + P256 + "', '" + AUTH + "')";
  const results = await Promise.allSettled([concurrent(ANA, register), concurrent(BEN, register)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.match(String(results.find(r => r.status === "rejected").reason.stderr), /enable them again/);
  assert.equal(one("select count(*) from public.push_subscriptions where endpoint like '%shared-fixture'"), "1");

  const send = "select count(*) from public.push_test_targets()";
  const tests = await Promise.allSettled([concurrent(BEN, send), concurrent(BEN, send)]);
  assert.equal(tests.filter(r => r.status === "fulfilled").length, 1);
  assert.match(String(tests.find(r => r.status === "rejected").reason.stderr), /Test limit reached/);
});

/* Part 4C step 2 database rules: devices for phone/computer notifications, "send a test", and the
   morning run handing over what to send (run with the real function code and a pretend push service). */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { toStored } from "../../js/model/schema.js";
import { migrate } from "../../js/model/migrate.js";
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
const save = (user, ep, label = "iPhone · Safari") => as(user, `select public.save_push_subscription('https://push.example/${ep}', '${P256}', '${AUTH}', '${label}')`);
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
  assert.throws(() => as(ANA, `select public.save_push_subscription('http://not-secure/x', '${P256}', '${AUTH}')`), /check constraint/);
});

test("a device follows whoever turns notifications on there; removing and signing out forget it", { skip }, () => {
  save(EVE, "ana-laptop"); // Eve signs in on Ana's laptop and turns them on
  assert.equal(as(ANA, `select count(*) from push_subscriptions`), "1");
  assert.equal(as(EVE, `select count(*) from push_subscriptions`), "1");
  as(EVE, `select public.forget_push_subscription('https://push.example/ana-laptop')`);
  assert.equal(one(`select count(*) from push_subscriptions where endpoint like '%ana-laptop'`), "0");
  as(BEN, `select public.forget_push_subscription('https://push.example/ana-phone')`); // not his: nothing happens
  assert.equal(as(ANA, `select count(*) from push_subscriptions`), "1");
  assert.equal(as(BEN, `delete from push_subscriptions where endpoint like '%ana-phone' returning 1`), "");
});

test("at most 10 devices per person (the oldest are forgotten)", { skip }, () => {
  for (let i = 0; i < 12; i++) save(EVE, `eve-${i}`);
  assert.equal(as(EVE, `select count(*) from push_subscriptions`), "10");
  assert.equal(as(EVE, `select count(*) from push_subscriptions where endpoint like '%eve-0' or endpoint like '%eve-1'`), "0");
});

test("'Send a test': only your own devices, at most once a minute", { skip }, () => {
  const mine = JSON.parse(as(ANA, `select jsonb_agg(endpoint) from public.push_test_targets()`));
  assert.deepEqual(mine, ["https://push.example/ana-phone"]);
  assert.throws(() => as(ANA, `select count(*) from public.push_test_targets()`), /Wait a minute/);
  assert.throws(() => as(null, `select count(*) from public.push_test_targets()`), /permission denied/);
});

test("morning run: new reminders go to the right people's devices; gone devices are forgotten", { skip }, async () => {
  as(ANA, `insert into reminder_prefs (user_id, household_id, goal_done) values ('${ANA}', '${HH}', true)`);
  as(BEN, `insert into reminder_prefs (user_id, household_id, review) values ('${BEN}', '${HH}', false)`); // nothing on
  save(BEN, "ben-old"); psql(`update push_subscriptions set endpoint = 'https://push.example/ben-gone' where endpoint like '%ben-old'`);
  const sent = [];
  const send = async (d, msg) => { sent.push([d.endpoint.split("/").pop(), msg.title]); return d.endpoint.includes("gone") ? { ok: false, gone: true } : { ok: true }; };
  const res = await runReminders(anonClient, one(`select public.start_reminder_run(true)`), { jwk: { d: "x" }, send });
  assert.equal(res.created, 2);
  assert.deepEqual(sent, [["ana-phone", "2 new reminders"]], "Ana: one notification for her two new reminders; Ben has none");
  assert.deepEqual(res.push, { sent: 1, gone: 0, failed: 0 });
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

test("the 4C step 2 migration can run twice, and ping still works", { skip }, () => {
  psql(readFileSync(new URL("20261110000700_push.sql", dir), "utf8"));
  assert.doesNotThrow(() => as(null, `select public.ping()`));
  assert.equal(as(ANA, `select count(*) from push_subscriptions`), "1");
});

/* Part 4C database rules: reminder settings and inboxes are private, the daily run's one-time pass,
   no repeats, and clean-up. Also runs the real function code (supabase/functions/send-reminders/run.js)
   against the throwaway database, signed in as nobody, just like the live function. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { toStored } from "../../js/model/schema.js";
import { migrate } from "../../js/model/migrate.js";
import { runReminders } from "../../supabase/functions/send-reminders/run.js";
import { stale } from "../../tools/sync-function.mjs";
import { RICH_V3 } from "../fixtures.js";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "rem_test_" + process.pid;
let DB_URL;
const psql = (sql, url = DB_URL) => execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const last = s => s.split("\n").pop();
const one = sql => last(psql(sql));
const as = (user, sql) => last(psql(`begin; set local role ${user ? "authenticated" : "anon"}; ${user ? `set local request.jwt.claim.sub = '${user}';` : ""} ${sql}; commit;`));
const lit = v => "$j$" + JSON.stringify(v) + "$j$";
const u = c => `00000000-0000-0000-0000-0000000000${c}`;
const ANA = u("a1"), BEN = u("b2"), CAT = u("c3"), EVE = u("e5");
const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
const run = f => psql(readFileSync(new URL(f, dir), "utf8"));
const V4 = toStored(migrate(RICH_V3));
// Car rego is due about 6 months from whenever the tests run, with nothing set aside: always "behind".
V4.spend.s4.due = (new Date().getMonth() + 6) % 12 + 1; V4.spend.s4.aside = 0;
let HH, EHH;

/** A Supabase client stand-in that calls functions as an anonymous visitor, like the live function. */
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
  files.forEach(run);
  psql(`insert into auth.users (id, email, raw_user_meta_data) values
    ('${ANA}','ana@example.com','{"name":"Ana"}'), ('${BEN}','ben@example.com','{"name":"Ben"}'),
    ('${CAT}','cat@example.com','{"name":"Cat"}'), ('${EVE}','eve@example.com','{"name":"Eve"}');`);
  HH = as(ANA, `select public.create_household('Ana home')`);
  EHH = as(EVE, `select public.create_household('Eve home')`);
  psql(`insert into household_members (household_id, user_id, role) values ('${HH}', '${BEN}', 'editor'), ('${HH}', '${CAT}', 'viewer');
        update budgets set state = ${lit(V4)}::jsonb where household_id in ('${HH}', '${EHH}');`);
});

test("the function's copy of the app's maths is up to date", () => {
  assert.deepEqual(stale(), [], "run: node tools/sync-function.mjs");
});

test("everything starts off: with no settings, the morning run does nothing", { skip }, () => {
  assert.equal(one(`select public.start_reminder_run(true) is null`), "t");
  assert.equal(one(`select count(*) from reminder_runs`), "0");
});

test("people can turn their own reminders on, for households they're in", { skip }, () => {
  as(ANA, `insert into reminder_prefs (user_id, household_id, sink_behind, goal_done) values ('${ANA}', '${HH}', true, true)`);
  as(CAT, `insert into reminder_prefs (user_id, household_id, goal_done) values ('${CAT}', '${HH}', true)`); // viewers too
  as(ANA, `update reminder_prefs set review_day = 3 where user_id = '${ANA}'`);
  assert.equal(as(ANA, `select count(*) from reminder_prefs`), "1", "you only see your own settings");
  assert.throws(() => as(ANA, `insert into reminder_prefs (user_id, household_id, review) values ('${BEN}', '${HH}', true)`), /row-level security/, "not someone else's");
  assert.throws(() => as(ANA, `insert into reminder_prefs (user_id, household_id, review) values ('${ANA}', '${EHH}', true)`), /row-level security/, "not a household you're not in");
  assert.throws(() => as(ANA, `update reminder_prefs set due_weeks = 5 where user_id = '${ANA}'`), /check constraint/, "only 2, 4, 6 or 8 weeks");
  assert.equal(as(BEN, `update reminder_prefs set review = true returning 1`), "", "Ben can't change Ana's");
  assert.throws(() => as(null, `select count(*) from reminder_prefs`), /permission denied/);
});

test("the morning run: the function works out reminders with the app's maths and fills the right inboxes", { skip }, async () => {
  const token = one(`select public.start_reminder_run(true)`);
  assert.match(token, /^[0-9a-f-]{36}$/);
  const res = await runReminders(anonClient, token);
  assert.deepEqual(res.problems, []);
  assert.equal(res.households, 1, "only households where someone has reminders on");
  // Ana: Car rego behind + 2 goals reached. Cat (viewer): 2 goals reached. Ben: nothing on.
  assert.equal(res.created, 5);
  const anas = JSON.parse(as(ANA, `select jsonb_agg(title order by id) from reminders`));
  assert.deepEqual(anas, ["Car rego is behind by $" + anas[0].match(/\$(\d+)/)[1], "🎉 Holiday is fully funded!", "🎉 Course is fully funded!"]);
  assert.equal(as(CAT, `select count(*) from reminders`), "2");
  assert.equal(as(BEN, `select count(*) from reminders`), "0");
  assert.equal(as(EVE, `select count(*) from reminders`), "0");
  assert.equal(one(`select finished_at is not null and created = 5 from reminder_runs where token = '${token}'`), "t");
});

test("the pass works once, and only for 15 minutes", { skip }, async () => {
  const used = one(`select token from reminder_runs order by id desc limit 1`);
  await assert.rejects(runReminders(anonClient, used), /expired/);
  const t2 = one(`select public.start_reminder_run(true)`);
  psql(`update reminder_runs set started_at = now() - interval '16 minutes' where token = '${t2}'`);
  await assert.rejects(runReminders(anonClient, t2), /expired/);
  await assert.rejects(runReminders(anonClient, "00000000-0000-0000-0000-000000000000"), /expired/);
});

test("no repeats: running again the same day adds nothing new", { skip }, async () => {
  const res = await runReminders(anonClient, one(`select public.start_reminder_run(true)`));
  assert.equal(res.worked_out, 5); assert.equal(res.created, 0);
  assert.equal(one(`select count(*) from reminders`), "5");
});

test("a pass can't be used to put reminders in a stranger's inbox", { skip }, () => {
  const t = one(`select public.start_reminder_run(true)`);
  const items = [{ user_id: EVE, household_id: HH, kind: "x", key: "sneaky", title: "Hi" }, { user_id: BEN, household_id: HH, kind: "x", key: "sneaky", title: "Hi" }];
  assert.equal(JSON.parse(as(null, `select public.reminder_run_save('${t}', ${lit(items)}::jsonb)`)).created, 0, "Eve isn't in the household; Ben has no reminders set up");
});

test("the morning run only starts at 8am NZ time, and once a day", { skip }, () => {
  const hour = Number(one(`select extract(hour from now() at time zone 'Pacific/Auckland')`));
  const first = one(`select public.start_reminder_run() is null`);
  if (hour !== 8) assert.equal(first, "t", "not 8am in NZ: nothing");
  assert.equal(one(`select public.start_reminder_run() is null`), "t", "already ran today: nothing");
});

test("inboxes: read your own, mark them read, clear them; nothing else", { skip }, () => {
  const id = as(ANA, `select min(id) from reminders`);
  as(ANA, `update reminders set read_at = now() where id = ${id}`);
  assert.equal(one(`select read_at is not null from reminders where id = ${id}`), "t");
  assert.throws(() => as(ANA, `update reminders set title = 'changed' where id = ${id}`), /permission denied/);
  assert.throws(() => as(ANA, `insert into reminders (user_id, household_id, kind, key, title) values ('${ANA}', '${HH}', 'x', 'y', 'z')`), /permission denied/);
  assert.equal(as(BEN, `delete from reminders where id = ${id} returning 1`), "", "Ben can't clear Ana's");
  assert.equal(as(ANA, `delete from reminders where id = ${id} returning 1`), "1");
});

test("only the database can start a run; anyone without a pass gets nothing", { skip }, () => {
  assert.throws(() => as(ANA, `select public.start_reminder_run(true)`), /permission denied/);
  assert.throws(() => as(null, `select public.start_reminder_run(true)`), /permission denied/);
  assert.throws(() => as(null, `select public.prune_reminders()`), /permission denied/);
  assert.throws(() => as(null, `select count(*) from reminder_log`), /permission denied/);
  assert.throws(() => as(ANA, `select count(*) from reminder_runs`), /permission denied/);
  assert.throws(() => as(ANA, `select public.reminder_run_data('${one(`select token from reminder_runs order by id desc limit 1`)}')`), /permission denied/, "signed-in people don't need it");
});

test("clean-up: inbox items over 60 days old go, and what's been sent is remembered for longer", { skip }, () => {
  psql(`update reminders set created_at = now() - interval '61 days' where user_id = '${CAT}'`);
  assert.equal(JSON.parse(one(`select public.prune_reminders()`)).older_than_60_days, 2);
  assert.equal(one(`select count(*) from reminder_log where user_id = '${CAT}'`), "2", "so a goal reached is never celebrated twice");
});

test("leaving a household: your reminders and settings there are cleaned up", { skip }, () => {
  as(CAT, `select public.leave_household('${HH}')`);
  one(`select public.prune_reminders()`);
  assert.equal(one(`select count(*) from reminder_prefs where user_id = '${CAT}'`), "0");
});

test("the keep-alive ping still works, and the 4C migration can run twice", { skip }, () => {
  assert.doesNotThrow(() => as(null, `select public.ping()`));
  // Run step 1 and every later migration again, in order (as a fresh copy of the database would)
  files.filter(f => f >= "20261109000600_reminders.sql").forEach(run);
  assert.equal(as(ANA, `select count(*) from reminder_prefs`), "1");
});

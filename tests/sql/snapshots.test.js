/* Part 4A database rules: monthly and "save now" snapshots, who can do what, and the size limits.
   Runs every migration in order on a throwaway Postgres (see start-local-db.sh). */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { toStored } from "../../js/model/schema.js";
import { migrate } from "../../js/model/migrate.js";
import { RICH_V3 } from "../fixtures.js";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "snap_test_" + process.pid;
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
let HH, EMPTY;

before(() => {
  if (skip) return;
  psql(`drop database if exists ${DB}; create database ${DB};`, URL0);
  DB_URL = URL0.replace(/\/postgres(\?|$)/, `/${DB}$1`);
  psql(readFileSync(new URL("./supabase-shim.sql", import.meta.url), "utf8"));
  const upTo = files.indexOf("20261107000400_snapshots.sql");
  files.slice(0, upTo).forEach(run);
  psql(`insert into auth.users (id, email, raw_user_meta_data) values
    ('${ANA}','ana@example.com','{"name":"Ana"}'), ('${BEN}','ben@example.com','{"name":"Ben"}'),
    ('${CAT}','cat@example.com','{"name":"Cat"}'), ('${EVE}','eve@example.com','{"name":"Eve"}');`);
  HH = as(ANA, `select public.create_household('Ana home')`);
  EMPTY = as(EVE, `select public.create_household('Eve empty')`);
  psql(`insert into household_members (household_id, user_id, role) values ('${HH}', '${BEN}', 'editor'), ('${HH}', '${CAT}', 'viewer');
        update budgets set state = ${lit(V4)}::jsonb where household_id = '${HH}';`);
  files.slice(upTo).forEach(run);
});

const count = (where = "") => one(`select count(*) from budget_snapshots where household_id = '${HH}' ${where}`);

test("going live takes a starting snapshot for each set-up budget, and none for empty ones", { skip }, () => {
  assert.equal(count("and kind = 'monthly'"), "1");
  assert.equal(one(`select count(*) from budget_snapshots where household_id = '${EMPTY}'`), "0");
  assert.equal(one(`select month = public._nz_month(now()) from budget_snapshots where household_id = '${HH}'`), "t");
});

test("a snapshot keeps people, net-worth accounts and goals, and nothing else", { skip }, () => {
  const d = JSON.parse(one(`select data from budget_snapshots where household_id = '${HH}' limit 1`));
  assert.deepEqual(Object.keys(d).sort(), ["goals", "nw", "people", "version"]);
  assert.deepEqual(d.nw, V4.nw);
  assert.deepEqual(d.goals, V4.goals);
  assert.deepEqual(d.people.j, { id: "j", name: "Jarden", colour: "blue", pos: 1 }, "no pay details, just names and colours");
});

test("one monthly snapshot per month: running the job again adds nothing", { skip }, () => {
  assert.equal(one(`select public.take_monthly_snapshots()`), "0");
  assert.equal(count("and kind = 'monthly'"), "1");
});

test("a new month gets a new snapshot (from the job or when someone opens the app)", { skip }, () => {
  psql(`update budget_snapshots set month = (month - interval '1 month')::date where household_id = '${HH}'`);
  assert.equal(as(CAT, `select public.ensure_monthly_snapshot('${HH}')`), "t", "even a viewer opening the app catches it up");
  assert.equal(as(CAT, `select public.ensure_monthly_snapshot('${HH}')`), "f");
  assert.equal(count("and kind = 'monthly'"), "2");
  assert.throws(() => as(EVE, `select public.ensure_monthly_snapshot('${HH}')`), /Not a member/);
});

test("NZ time decides the month: 12:30pm UTC on 31 October is already November in Auckland", { skip }, () => {
  assert.equal(one(`select public._nz_month('2026-10-31 12:30+00')`), "2026-11-01");
  assert.equal(one(`select public._nz_month('2026-10-31 10:00+00')`), "2026-10-01");
});

test("'Save a snapshot now': owners and editors yes, viewers and outsiders no", { skip }, () => {
  const r = JSON.parse(as(BEN, `select public.save_snapshot_now('${HH}')`));
  assert.equal(r.kind, "manual"); assert.equal(r.taken_by, BEN); assert.deepEqual(r.data.goals, V4.goals);
  assert.ok(as(ANA, `select public.save_snapshot_now('${HH}')`).includes('"manual"'));
  assert.throws(() => as(CAT, `select public.save_snapshot_now('${HH}')`), /Only owners and editors/);
  assert.throws(() => as(EVE, `select public.save_snapshot_now('${HH}')`), /Only owners and editors/);
  assert.throws(() => as(EVE, `select public.save_snapshot_now('${EMPTY}')`), /nothing to save/);
});

test("only the newest 24 'save now' snapshots are kept; monthly ones are never trimmed", { skip }, () => {
  for (let i = 0; i < 30; i++) as(BEN, `select public.save_snapshot_now('${HH}')`);
  assert.equal(count("and kind = 'manual'"), "24");
  assert.equal(count("and kind = 'monthly'"), "2");
  const newest = one(`select max(id) from budget_snapshots where household_id='${HH}' and kind='manual'`);
  const kept = one(`select bool_and(id > ${newest} - 24) from budget_snapshots where household_id='${HH}' and kind='manual'`);
  assert.equal(kept, "t", "the newest ones are the ones kept");
});

test("members see their own household's snapshots only; nobody can edit or delete them", { skip }, () => {
  assert.ok(Number(as(CAT, `select count(*) from budget_snapshots`)) >= 26, "a viewer can look");
  assert.equal(as(EVE, `select count(*) from budget_snapshots where household_id = '${HH}'`), "0");
  for (const sql of [`insert into budget_snapshots (household_id, month, kind, data) values ('${HH}', current_date, 'manual', '{}')`,
                     `update budget_snapshots set data = '{}' where household_id = '${HH}'`,
                     `delete from budget_snapshots where household_id = '${HH}'`]) {
    assert.throws(() => as(ANA, sql), /permission denied/, sql.slice(0, 30));
  }
});

test("only the scheduler can run the monthly job; signed-out visitors can't do anything", { skip }, () => {
  assert.throws(() => as(ANA, `select public.take_monthly_snapshots()`), /permission denied/);
  assert.throws(() => as(null, `select public.save_snapshot_now('${HH}')`), /permission denied/);
  assert.throws(() => as(null, `select count(*) from budget_snapshots`), /permission denied/);
  assert.ok(as(null, `select public.ping()`).length > 0, "the keep-alive ping still works");
});

test("leaving a household as its last member deletes its snapshots too", { skip }, () => {
  as(EVE, `select public.apply_budget_ops('${EMPTY}', ${lit([{ op: "replace", value: V4 }])}::jsonb)`);
  as(EVE, `select public.save_snapshot_now('${EMPTY}')`);
  assert.equal(one(`select count(*) from budget_snapshots where household_id = '${EMPTY}'`), "1");
  as(EVE, `select public.leave_household('${EMPTY}')`);
  assert.equal(one(`select count(*) from budget_snapshots where household_id = '${EMPTY}'`), "0");
});

test("running the 4A migration a second time is harmless", { skip }, () => {
  const before = one(`select count(*) from budget_snapshots`);
  run("20261107000400_snapshots.sql");
  assert.equal(one(`select count(*) from budget_snapshots`), before);
});

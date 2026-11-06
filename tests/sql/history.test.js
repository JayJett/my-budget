/* Part 4B database rules: the change history, merging quick edits, undo, restore, permissions and clean-up.
   Runs every migration in order on a throwaway Postgres (see start-local-db.sh). */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { toStored } from "../../js/model/schema.js";
import { migrate } from "../../js/model/migrate.js";
import { changesBetween, invert, stateAt } from "../../js/model/history.js";
import { RICH_V3 } from "../fixtures.js";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "hist_test_" + process.pid;
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
let HH;

before(() => {
  if (skip) return;
  psql(`drop database if exists ${DB}; create database ${DB};`, URL0);
  DB_URL = URL0.replace(/\/postgres(\?|$)/, `/${DB}$1`);
  psql(readFileSync(new URL("./supabase-shim.sql", import.meta.url), "utf8"));
  const upTo = files.indexOf("20261108000500_history.sql");
  files.slice(0, upTo).forEach(run);
  psql(`insert into auth.users (id, email, raw_user_meta_data) values
    ('${ANA}','ana@example.com','{"name":"Ana"}'), ('${BEN}','ben@example.com','{"name":"Ben"}'),
    ('${CAT}','cat@example.com','{"name":"Cat"}'), ('${EVE}','eve@example.com','{"name":"Eve"}');`);
  HH = as(ANA, `select public.create_household('Ana home')`);
  as(EVE, `select public.create_household('Eve home')`);
  psql(`insert into household_members (household_id, user_id, role) values ('${HH}', '${BEN}', 'editor'), ('${HH}', '${CAT}', 'viewer');
        update budgets set state = ${lit(V4)}::jsonb where household_id = '${HH}';`);
  // 25 old backups, to check the tidy-up keeps only the newest 20
  psql(`insert into budget_backups (household_id, state, reason, taken_at) select '${HH}', '{}'::jsonb, 'old ' || g, now() - (g || ' days')::interval from generate_series(1, 25) g`);
  files.slice(upTo).forEach(run);
});

const ops = (user, list) => JSON.parse(as(user, `select public.apply_budget_ops('${HH}', ${lit(list)}::jsonb)`));
const set = (path, value) => ({ op: "set", path, value });
const rows = () => JSON.parse(one(`select coalesce(jsonb_agg(c order by id), '[]') from budget_changes c where household_id = '${HH}'`));
const latest = () => rows().at(-1);
const state = () => JSON.parse(one(`select state from budgets where household_id = '${HH}'`));
/** Pretend the last entry was made a while ago, so the next save starts a new one. */
const age = (mins = 3) => psql(`update budget_changes set changed_at = changed_at - interval '${mins} minutes' where household_id = '${HH}'`);

test("going live keeps only the newest 20 backups per household", { skip }, () => {
  assert.equal(one(`select count(*) from budget_backups where household_id = '${HH}'`), "20");
  assert.equal(one(`select count(*) from budget_backups where household_id = '${HH}' and reason = 'old 1'`), "1", "the newest stay");
});

test("a save records who changed what, with the old and new values", { skip }, () => {
  const r = ops(ANA, [set(["spend", "s3", "amount"], 400)]);
  const e = latest();
  assert.equal(r.change_id, e.id, "the save says which history entry it went into");
  assert.equal(e.changed_by, ANA); assert.equal(e.kind, "edit"); assert.equal(e.seq, r.seq);
  assert.deepEqual(e.changes, [{ p: ["spend", "s3", "amount"], o: 300, n: 400 }]);
});

test("typing in the same box within 2 minutes makes one entry, not one per save", { skip }, () => {
  const before = rows().length;
  ops(ANA, [set(["spend", "s3", "amount"], 45)]);
  ops(ANA, [set(["spend", "s3", "amount"], 450)]);
  assert.equal(rows().length, before);
  assert.deepEqual(latest().changes, [{ p: ["spend", "s3", "amount"], o: 300, n: 450 }]);
});

test("a different box, a different person, or a pause of 2 minutes each start a new entry", { skip }, () => {
  let n = rows().length;
  ops(ANA, [set(["spend", "s2", "amount"], 190)]);
  assert.equal(rows().length, ++n, "different box");
  ops(BEN, [set(["spend", "s2", "amount"], 200)]);
  assert.equal(rows().length, ++n, "someone else");
  ops(ANA, [set(["spend", "s2", "amount"], 210)]);
  assert.equal(rows().length, ++n, "Ana again, but Ben saved in between");
  age();
  ops(ANA, [set(["spend", "s2", "amount"], 220)]);
  assert.equal(rows().length, ++n, "after a pause");
});

test("adding a row and then filling it in becomes one 'added' entry", { skip }, () => {
  age();
  const n = rows().length;
  ops(ANA, [set(["spend", "x9"], { id: "x9", name: "", type: "Flexible", amount: null, period: "Month", notes: "", due: null, aside: null, pos: 9 })]);
  ops(ANA, [set(["spend", "x9", "name"], "Netflix")]);
  ops(ANA, [set(["spend", "x9", "amount"], 20)]);
  assert.equal(rows().length, n + 1);
  const c = latest().changes;
  assert.equal(c.length, 1); assert.equal(c[0].o, undefined);
  assert.equal(c[0].n.name, "Netflix"); assert.equal(c[0].n.amount, 20);
});

test("changing something and changing it straight back leaves no entry", { skip }, () => {
  age();
  const n = rows().length;
  ops(ANA, [set(["note"], "Typo")]);
  assert.equal(rows().length, n + 1);
  const r = ops(ANA, [set(["note"], V4.note)]);
  assert.equal(rows().length, n); assert.equal(r.change_id, null);
});

test("an import (replace) is recorded with its reason and a backup, and never merged", { skip }, () => {
  const s = state(); s.note = "Imported note";
  ops(ANA, [{ op: "replace", value: s, reason: "Imported a file" }]);
  const e = latest();
  assert.equal(e.kind, "replace"); assert.equal(e.reason, "Imported a file");
  assert.deepEqual(e.changes, [{ p: ["note"], o: V4.note, n: "Imported note" }], "just what actually changed");
});

test("the database and the app agree on differences and on stepping back", { skip }, () => {
  const a = state(), b = JSON.parse(JSON.stringify(a));
  b.spend.s1.amount = 1250; delete b.spend.s2; b.spend.n1 = { id: "n1", name: "New", pos: 99 }; b.people.m.name = "Mads"; b.nw.reviewed = "2026-11-01";
  const sql = JSON.parse(one(`select public._jsonb_diff(${lit(a)}::jsonb, ${lit(b)}::jsonb)`));
  const key = c => JSON.stringify(c.p);
  assert.deepEqual([...sql].sort((x, y) => key(x).localeCompare(key(y))), changesBetween(a, b).sort((x, y) => key(x).localeCompare(key(y))));
  assert.deepEqual(JSON.parse(one(`select public._invert(${lit(b)}::jsonb, ${lit(sql)}::jsonb)`)), a);
  assert.deepEqual(invert(b, sql), a);
});

test("undo puts a change back, and it's recorded as a new change", { skip }, () => {
  age();
  ops(ANA, [set(["people", "j", "pay"], 2600)]);
  const target = latest();
  const r = JSON.parse(as(ANA, `select public.undo_budget_change('${HH}', ${target.id})`));
  assert.equal(state().people.j.pay, 2400);
  assert.deepEqual(r.skipped, []);
  const e = latest();
  assert.equal(e.kind, "undo"); assert.equal(e.ref_id, target.id); assert.equal(e.id, r.change_id);
  assert.deepEqual(e.changes, [{ p: ["people", "j", "pay"], o: 2600, n: 2400 }]);
  assert.ok(rows().find(x => x.id === target.id).undone_at, "the original is marked as undone");
  assert.throws(() => as(ANA, `select public.undo_budget_change('${HH}', ${target.id})`), /already been undone/);
  // and the undo itself can be undone
  as(ANA, `select public.undo_budget_change('${HH}', ${e.id})`);
  assert.equal(state().people.j.pay, 2600);
});

test("undo never overwrites someone else's newer change, and says who made it", { skip }, () => {
  age();
  ops(ANA, [set(["spend", "s1", "amount"], 1300), set(["spend", "s4", "amount"], 150)]);
  const mine = latest();
  ops(BEN, [set(["spend", "s1", "amount"], 1350)]);
  const r = JSON.parse(as(ANA, `select public.undo_budget_change('${HH}', ${mine.id})`));
  const s = state();
  assert.equal(s.spend.s1.amount, 1350, "Ben's newer value stays");
  assert.equal(s.spend.s4.amount, 120, "the rest is undone");
  assert.deepEqual(r.skipped, [{ p: ["spend", "s1", "amount"], by: BEN }]);
});

test("restore puts the whole budget back to how it was after an earlier change, and can be undone", { skip }, () => {
  age();
  const all0 = rows(), point = all0.at(-1), then = state();
  ops(ANA, [set(["spend", "s1", "amount"], 999)]);
  ops(BEN, [set(["people", "m", "pay"], 2100), set(["goals", "joint", "g9"], { id: "g9", name: "Boat", pos: 9 })]);
  const now = state();
  // The app's preview gives the same answer as the database
  assert.deepEqual(stateAt(now, rows(), point.id), then);
  const r = JSON.parse(as(BEN, `select public.restore_budget_version('${HH}', ${point.id})`));
  assert.deepEqual(state(), then);
  const e = latest();
  assert.equal(e.kind, "restore"); assert.equal(e.ref_id, point.id); assert.equal(e.id, r.change_id);
  as(BEN, `select public.undo_budget_change('${HH}', ${e.id})`);
  assert.deepEqual(state(), now, "undoing the restore brings everything back");
});

test("viewers and outsiders: viewers can read the history but not undo or restore; outsiders see nothing", { skip }, () => {
  const id = latest().id;
  assert.ok(Number(as(CAT, `select count(*) from budget_changes where household_id = '${HH}'`)) > 5);
  assert.equal(as(EVE, `select count(*) from budget_changes where household_id = '${HH}'`), "0");
  assert.throws(() => as(null, `select count(*) from budget_changes`), /permission denied/, "signed out: refused outright");
  assert.throws(() => as(CAT, `select public.undo_budget_change('${HH}', ${id})`), /Only owners and editors/);
  assert.throws(() => as(CAT, `select public.restore_budget_version('${HH}', ${id})`), /Only owners and editors/);
  assert.throws(() => as(EVE, `select public.undo_budget_change('${HH}', ${id})`), /Only owners and editors/);
  assert.throws(() => as(CAT, `select public.apply_budget_ops('${HH}', '[]'::jsonb)`), /view-only/);
});

test("nobody can write, edit or delete history directly, or run the helpers", { skip }, () => {
  const id = latest().id;
  assert.throws(() => as(ANA, `insert into budget_changes (household_id, kind, changes) values ('${HH}', 'edit', '[]')`), /permission denied/);
  assert.throws(() => as(ANA, `update budget_changes set changes = '[]' where id = ${id}`), /permission denied/);
  assert.throws(() => as(ANA, `delete from budget_changes where id = ${id}`), /permission denied/);
  assert.throws(() => as(ANA, `select public._save_budget('${HH}', '{}', '{}', 'edit')`), /permission denied/);
  assert.throws(() => as(ANA, `select public.prune_budget_history()`), /permission denied/);
  assert.throws(() => as(null, `select public.undo_budget_change('${HH}', ${id})`), /permission denied/);
});

test("clean-up: history older than 90 days goes, and at most 5,000 changes are kept per household", { skip }, () => {
  const n = rows().length;
  psql(`update budget_changes set changed_at = now() - interval '91 days' where id = (select min(id) from budget_changes where household_id = '${HH}')`);
  psql(`insert into budget_changes (household_id, kind, changes, changed_at) select '${HH}', 'edit', '[]', now() - interval '1 hour' from generate_series(1, 5000)`);
  const r = JSON.parse(one(`select public.prune_budget_history()`));
  assert.equal(r.older_than_90_days, 1);
  assert.equal(one(`select count(*) from budget_changes where household_id = '${HH}'`), "5000");
  assert.equal(r.over_5000, n - 1);
  psql(`delete from budget_changes where household_id = '${HH}' and changes = '[]'`);
});

test("the keep-alive ping still works without signing in", { skip }, () => {
  assert.doesNotThrow(() => as(null, `select public.ping()`));
});

test("running the 4B migration a second time is harmless", { skip }, () => {
  const n = rows().length;
  run("20261108000500_history.sql");
  assert.equal(rows().length, n);
  ops(ANA, [set(["note"], "Still saving")]);
  assert.equal(state().note, "Still saving");
});

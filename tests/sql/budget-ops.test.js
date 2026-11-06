/* Tests the database migrations on a throwaway Postgres.
   Needs DATABASE_URL (see tests/sql/start-local-db.sh). Skipped when it isn't set.
   Every run builds a fresh database, so it is safe to run again and again. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { applyOps, diff } from "../../js/sync/ops.js";
import { toStored, fromStored, addPerson, moveItem } from "../../js/model/schema.js";
import { migrate } from "../../js/model/migrate.js";
import { clone, uid } from "../../js/model/util.js";
import { RICH_V3, LIVE_V3 } from "../fixtures.js";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "budget_test_" + process.pid;
let DB_URL;

const psql = (sql, url = DB_URL) => execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
const lit = v => "$j$" + JSON.stringify(v) + "$j$";
const ALICE = "00000000-0000-0000-0000-00000000000a", BOB = "00000000-0000-0000-0000-00000000000b", EVE = "00000000-0000-0000-0000-00000000000e";
let HH;

/** Run SQL as a signed-in user (or signed out, with user = null). */
const as = (user, sql) => psql(`begin; set local role ${user ? "authenticated" : "anon"}; ${user ? `set local request.jwt.claim.sub = '${user}';` : ""} ${sql}; commit;`);
const ops = (user, list) => JSON.parse(as(user, `select public.apply_budget_ops('${HH}', ${lit(list)}::jsonb)`));
const stateNow = () => JSON.parse(psql(`select state from budgets where household_id = '${HH}'`));

const dir = new URL("../../supabase/migrations/", import.meta.url);
const migrationFiles = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
const runFile = f => psql(readFileSync(new URL(f, dir), "utf8"));

before(() => {
  if (skip) return;
  psql(`drop database if exists ${DB}; create database ${DB};`, URL0);
  DB_URL = URL0.replace(/\/postgres(\?|$)/, `/${DB}$1`);
  psql(readFileSync(new URL("./supabase-shim.sql", import.meta.url), "utf8"));
  runFile(migrationFiles[0]); // baseline: the database as it was before Phase 1
  psql(`insert into auth.users (id, email, raw_user_meta_data) values
    ('${ALICE}', 'alice@example.com', '{"name":"Alice"}'), ('${BOB}', 'bob@example.com', '{"name":"Bob"}'), ('${EVE}', 'eve@example.com', '{}');`);
  HH = as(ALICE, `select public.create_household('Test')`).split("\n").pop();
  psql(`insert into household_members (household_id, user_id, role) values ('${HH}', '${BOB}', 'member');
        update budgets set state = ${lit(LIVE_V3)}::jsonb, rev = 'old' where household_id = '${HH}';`);
  runFile(migrationFiles[1]); // the Phase 1 change, applied on top of an existing v3 budget
});

test("the upgrade backs up every existing budget first", { skip }, () => {
  const b = JSON.parse(psql(`select json_agg(json_build_object('state', state, 'reason', reason)) from budget_backups where household_id = '${HH}'`));
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].state, LIVE_V3);
  assert.match(b[0].reason, /version 4/);
});

test("the old whole-budget save still works until the last step (old app stays usable)", { skip }, () => {
  const out = as(BOB, `update budgets set state = state || '{"note":"old app"}' where household_id = '${HH}' returning seq`);
  assert.ok(Number(out.split("\n").pop()) >= 1);
  assert.equal(stateNow().note, "old app");
});

test("upgrade to v4 with 'replace' keeps a backup of what it replaced", { skip }, () => {
  const before = stateNow();
  const v4 = toStored(migrate(before));
  const r = ops(ALICE, [{ op: "replace", value: v4, reason: "Upgrade to version 4" }]);
  assert.deepEqual(r.state, v4);
  const last = JSON.parse(psql(`select state from budget_backups where household_id = '${HH}' order by id desc limit 1`));
  assert.deepEqual(last, before);
});

test("the database applies changes exactly like the browser does", { skip }, () => {
  // Make lots of different edits in the browser model, turn them into ops, and apply them both ways.
  for (let round = 0; round < 12; round++) {
    const server = stateNow();
    const s = fromStored(server);
    const r = (k) => Math.floor(Math.random() * k);
    const edits = [
      () => { s.accounts[r(s.accounts.length)].split[s.people[0].id] = Math.round(Math.random() * 100) / 100; },
      () => { s.spend.push({ id: uid(), name: "Item " + round, type: "Fixed", amount: r(500), period: "Month", notes: "", due: null, aside: null, pos: s.spend.length + 1 }); },
      () => { if (s.spend.length) s.spend.splice(r(s.spend.length), 1); },
      () => { if (s.spend.length > 1) moveItem(s.spend, r(s.spend.length), 0); },
      () => { s.note = "Note “" + round + "” with emoji 🧾 and $ signs"; },
      () => { if (s.people.length < 4) addPerson(s, { name: "P" + round, pay: r(3000) }); },
      () => { s.viewAs = ["week", "fortnight", "month"][r(3)]; },
      () => { s.goals.ef.target = r(20000); s.goals.ef.deadline = ""; },
      () => { s.nw.accounts.push({ id: uid(), name: "Acc " + round, type: "Savings", balance: null, pos: 99 }); },
    ];
    for (let k = 0; k < 4; k++) edits[r(edits.length)]();
    const list = diff(server, toStored(s));
    const viaDb = ops(ALICE, list).state;
    assert.deepEqual(viaDb, applyOps(server, list), `round ${round}`);
    assert.deepEqual(viaDb, toStored(s), `round ${round}`);
  }
});

test("set builds missing parents and del ignores missing paths, same as the browser", { skip }, () => {
  const server = stateNow();
  const list = [{ op: "set", path: ["extra", "a", "b"], value: [1, 2] }, { op: "set", path: ["note", "x"], value: 1 },
                { op: "del", path: ["nope", "nothing"] }, { op: "set", path: ["n"], value: null }];
  assert.deepEqual(ops(ALICE, list).state, applyOps(server, list));
  ops(ALICE, [{ op: "del", path: ["extra"] }, { op: "del", path: ["n"] }, { op: "set", path: ["note"], value: "" }]);
});

test("two people saving different changes from the same starting point: both survive", { skip }, () => {
  const server = stateNow();
  const a = clone(server); a.accounts.js.split.j = 0.33;
  const b = clone(server); const id = uid(); b.spend[id] = { id, name: "Bob's row", pos: 50 };
  ops(ALICE, diff(server, a));
  ops(BOB, diff(server, b));
  const now = stateNow();
  assert.equal(now.accounts.js.split.j, 0.33);
  assert.equal(now.spend[id].name, "Bob's row");
});

test("every save bumps the counter, so the app can ignore older updates", { skip }, () => {
  const s1 = ops(ALICE, [{ op: "set", path: ["note"], value: "a" }]).seq;
  const s2 = ops(BOB, [{ op: "set", path: ["note"], value: "b" }]).seq;
  assert.equal(s2, s1 + 1);
});

test("only members can save, and only when signed in", { skip }, () => {
  assert.throws(() => ops(EVE, [{ op: "set", path: ["note"], value: "hacked" }]), /Not a member/);
  assert.throws(() => ops(null, [{ op: "set", path: ["note"], value: "hacked" }]), /permission denied/);
  assert.notEqual(stateNow().note, "hacked");
});

test("bad input is refused without changing anything", { skip }, () => {
  const before = stateNow();
  assert.throws(() => ops(ALICE, { op: "set" }), /must be a list/);
  assert.throws(() => ops(ALICE, [{ op: "set", path: [], value: 1 }]), /needs a path/);
  assert.throws(() => ops(ALICE, [{ op: "set", path: ["note"], value: "x" }, { op: "explode", path: ["a"] }]), /Unknown change type/);
  assert.throws(() => ops(ALICE, [{ op: "replace", value: [1, 2] }]), /must be an object/);
  assert.deepEqual(stateNow(), before, "a failed batch changes nothing");
});

test("backups can be read by members only, and never written directly", { skip }, () => {
  assert.ok(Number(as(BOB, `select count(*) from budget_backups`).split("\n").pop()) >= 2);
  assert.equal(as(EVE, `select count(*) from budget_backups`).split("\n").pop(), "0");
  assert.throws(() => as(ALICE, `insert into budget_backups (household_id, state) values ('${HH}', '{}')`), /permission denied/);
});

test("the keep-alive ping still works when signed out", { skip }, () => {
  assert.ok(as(null, `select public.ping()`).length > 0);
});

test("last step: whole-budget saves are switched off, change-by-change saves still work", { skip }, () => {
  runFile(migrationFiles[2]);
  const out = as(BOB, `update budgets set state = '{}' where household_id = '${HH}' returning 1`);
  assert.equal(out.split("\n").filter(x => x === "1").length, 0, "the old-style update touches no rows");
  assert.notDeepEqual(stateNow(), {});
  assert.equal(ops(BOB, [{ op: "set", path: ["note"], value: "still saving" }]).state.note, "still saving");
});

test("running the Phase 1 migration a second time is harmless", { skip }, () => {
  const before = stateNow();
  runFile(migrationFiles[1]);
  assert.deepEqual(stateNow(), before);
});

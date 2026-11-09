/* Phase 10: "which person is me", private payday checklists, and the opt-in payday reminder.
   Throwaway Postgres only. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "payday_test_" + process.pid;
let DB_URL, HH, OTHER;
const psql = (sql, url = DB_URL) => execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const last = s => s.split("\n").pop();
const as = (user, sql) => last(psql(`begin; set local role ${user ? "authenticated" : "anon"}; ${user ? `set local request.jwt.claim.sub = '${user}';` : ""} ${sql}; commit;`));
const ANA = "00000000-0000-0000-0000-0000000000a1", BEN = "00000000-0000-0000-0000-0000000000b2", VIC = "00000000-0000-0000-0000-0000000000c3", EVE = "00000000-0000-0000-0000-0000000000e4";
const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = () => readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
const link = (user, hh, p) => as(user, `select public.link_budget_person('${hh}', ${p === null ? "null" : `'${p}'`})`);
const PLAN = JSON.stringify({ v: 1, pay: 290000, groups: [{ key: "move:label:savings", cents: 30000 }, { key: "keep:nw:a1", cents: 100000 }] });
const mark = (user, hh, p, day, key, on, plan = PLAN) => as(user, `select public.payday_check_mark('${hh}', '${p}', '${day}', '${plan}'::jsonb, '${key}', ${on})`);
const DAY = new Date().toISOString().slice(0, 10);

before(() => {
  if (skip) return;
  psql(`drop database if exists ${DB}; create database ${DB};`, URL0);
  DB_URL = URL0.replace(/\/postgres(\?|$)/, `/${DB}$1`);
  psql(readFileSync(new URL("./supabase-shim.sql", import.meta.url), "utf8"));
  for (const f of files()) psql(readFileSync(new URL(f, dir), "utf8"));
  psql(`insert into auth.users (id, email) values ('${ANA}','ana@example.com'), ('${BEN}','ben@example.com'), ('${VIC}','vic@example.com'), ('${EVE}','eve@example.com');`);
  HH = as(ANA, `select public.create_household('Ana and Ben')`);
  OTHER = as(EVE, `select public.create_household('Eve')`);
  psql(`insert into public.household_members (household_id, user_id, role) values ('${HH}', '${BEN}', 'editor'), ('${HH}', '${VIC}', 'viewer');`);
  // the budget has three people: Ana (pa), Ben (pb) and Sam, who hasn't signed up (ps)
  psql(`insert into public.budgets (household_id, state) values ('${HH}', '{"version":4,"people":{"pa":{"id":"pa","name":"Ana"},"pb":{"id":"pb","name":"Ben"},"ps":{"id":"ps","name":"Ana"}}}'::jsonb)
        on conflict (household_id) do update set state = excluded.state;
        insert into public.budgets (household_id, state) values ('${OTHER}', '{"version":4,"people":{"pe":{"id":"pe","name":"Eve"}}}'::jsonb)
        on conflict (household_id) do update set state = excluded.state;`);
});

test("you say which budget person you are; only yourself, only a person in the budget, never someone else's", { skip }, () => {
  assert.equal(link(ANA, HH, "pa"), "pa");
  assert.equal(as(BEN, `select person_id from public.household_members where household_id = '${HH}' and user_id = '${ANA}'`), "pa", "others in the household can see who's who");
  assert.throws(() => link(BEN, HH, "pa"), /already said that's them/, "two people can't be the same person");
  assert.throws(() => link(BEN, HH, "nobody"), /isn't in this budget/);
  assert.throws(() => link(EVE, HH, "pb"), /Not a member/);
  assert.throws(() => link(null, HH, "pb"), /permission denied|Not signed in/);
  assert.throws(() => link(EVE, OTHER, "pa"), /isn't in this budget/, "not a person from another household");
  assert.throws(() => as(BEN, `update public.household_members set person_id = 'pa' where household_id = '${HH}' and user_id = '${BEN}'`), /permission denied/, "the column can't be written directly");
  assert.equal(link(BEN, HH, "pb"), "pb");
  assert.equal(link(VIC, HH, "ps"), "ps", "a viewer can say who they are (it isn't a budget edit)");
  assert.equal(link(VIC, HH, null), "", "and undo it");
  assert.equal(as(VIC, `select coalesce(person_id, '-') from public.household_members where household_id = '${HH}' and user_id = '${VIC}'`), "-");
});

test("checklists: yours only; the first tick keeps the instructions; ticks are idempotent and reversible", { skip }, () => {
  assert.equal(as(ANA, `select coalesce(public.payday_check_get('${HH}', 'pa', '${DAY}')::text, 'none')`), "none");
  mark(ANA, HH, "pa", DAY, "move:label:savings", true);
  mark(ANA, HH, "pa", DAY, "move:label:savings", true); // twice: still one row, one tick
  const r = JSON.parse(as(ANA, `select public.payday_check_get('${HH}', 'pa', '${DAY}')`));
  assert.deepEqual(r.done, { "move:label:savings": true }); assert.equal(r.plan.pay, 290000);
  assert.equal(as(ANA, `select count(*) from public.payday_checks`), "1");
  // a later tick with different instructions doesn't rewrite the kept copy
  mark(ANA, HH, "pa", DAY, "keep:nw:a1", true, JSON.stringify({ v: 1, pay: 1, groups: [] }));
  assert.equal(JSON.parse(as(ANA, `select public.payday_check_get('${HH}', 'pa', '${DAY}')`)).plan.pay, 290000);
  mark(ANA, HH, "pa", DAY, "keep:nw:a1", false);
  assert.deepEqual(JSON.parse(as(ANA, `select public.payday_check_get('${HH}', 'pa', '${DAY}')`)).done, { "move:label:savings": true });
});

test("nobody else sees or changes your checklist, not even the owner; no ticking as someone else", { skip }, () => {
  assert.equal(as(BEN, `select count(*) from public.payday_checks`), "0", "Ben can't read Ana's");
  assert.throws(() => as(BEN, `select public.payday_check_get('${HH}', 'pa', '${DAY}')`), /for someone else/);
  assert.throws(() => mark(BEN, HH, "pa", DAY, "x", true), /for someone else/, "Ben can't tick for Ana's person");
  assert.throws(() => mark(VIC, HH, "ps", DAY, "x", true), /for someone else/, "not linked: no checklist");
  assert.throws(() => mark(EVE, HH, "pa", DAY, "x", true), /Not a member/);
  assert.throws(() => as(ANA, `insert into public.payday_checks (household_id, user_id, person_id, payday, plan) values ('${HH}', '${BEN}', 'pb', '${DAY}', '{}')`), /permission denied/, "no writing the table directly");
  assert.throws(() => as(ANA, `update public.payday_checks set user_id = '${BEN}'`), /permission denied/, "ownership can't be moved");
  assert.equal(as(EVE, `select count(*) from public.payday_checks`), "0");
  // each payday is its own list
  const next = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  mark(BEN, HH, "pb", next, "keep:nw:b1", true);
  assert.equal(as(BEN, `select count(*) from public.payday_checks`), "1");
  assert.equal(as(ANA, `select coalesce(public.payday_check_get('${HH}', 'pa', '${next}')::text, 'none')`), "none");
});

test("switching to the new plan keeps ticks for instructions still there", { skip }, () => {
  const plan2 = JSON.stringify({ v: 1, pay: 300000, groups: [{ key: "move:label:savings", cents: 40000 }, { key: "move:label:fun", cents: 10000 }] });
  mark(ANA, HH, "pa", DAY, "keep:nw:a1", true);
  const r = JSON.parse(as(ANA, `select public.payday_check_replan('${HH}', 'pa', '${DAY}', '${plan2}'::jsonb)`));
  assert.equal(r.plan.pay, 300000); assert.deepEqual(r.done, { "move:label:savings": true }, "the kept-in-account tick went with its instruction");
  assert.throws(() => as(BEN, `select public.payday_check_replan('${HH}', 'pa', '${DAY}', '${plan2}'::jsonb)`), /for someone else/);
});

test("the payday reminder: off by default; a reason to run; the run says which person each member is", { skip }, () => {
  as(ANA, `insert into public.reminder_prefs (user_id, household_id) values ('${ANA}', '${HH}')`);
  assert.equal(as(ANA, `select payday from public.reminder_prefs where user_id = '${ANA}'`), "f");
  psql(`delete from public.reminder_runs;`);
  assert.equal(psql(`select coalesce(public.start_reminder_run(true)::text, 'none')`).length > 4, false, "nothing on: no run");
  as(ANA, `update public.reminder_prefs set payday = true where user_id = '${ANA}'`);
  const tok = psql(`select public.start_reminder_run(true)`);
  const d = JSON.parse(as(null, `select public.reminder_run_data('${tok}')`));
  const ppl = d.households.find(h => h.id === HH).people;
  assert.deepEqual(ppl.map(p => [p.user_id, p.person_id, p.prefs.payday]), [[ANA, "pa", true]]);
});

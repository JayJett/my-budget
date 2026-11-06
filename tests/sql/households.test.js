/* Phase 7A database rule: creating a household twice in a row (double tap, retry, two tabs) makes one. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "hh_test_" + process.pid;
let DB_URL;
const psql = (sql, url = DB_URL) => execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const last = s => s.split("\n").pop();
const asSql = (user, sql) => `begin; set local role authenticated; set local request.jwt.claim.sub = '${user}'; ${sql}; commit;`;
const as = (user, sql) => last(psql(asSql(user, sql)));
const u = c => `00000000-0000-0000-0000-0000000000${c}`;
const ANA = u("a1"), BEN = u("b2");
const dir = new URL("../../supabase/migrations/", import.meta.url);
const count = user => Number(psql(`select count(*) from public.households where created_by = '${user}'`));

before(() => {
  if (skip) return;
  psql(`drop database if exists ${DB}; create database ${DB};`, URL0);
  DB_URL = URL0.replace(/\/postgres(\?|$)/, `/${DB}$1`);
  psql(readFileSync(new URL("./supabase-shim.sql", import.meta.url), "utf8"));
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) psql(readFileSync(new URL(f, dir), "utf8"));
  psql(`insert into auth.users (id, email, raw_user_meta_data) values ('${ANA}', 'ana@example.com', '{"name":"Ana"}'), ('${BEN}', 'ben@example.com', '{}');`);
});

test("the same request twice returns the same household, with one membership and one budget", { skip }, () => {
  const a = as(ANA, `select public.create_household('Ana home')`), b = as(ANA, `select public.create_household('Ana home')`);
  assert.equal(a, b);
  assert.equal(count(ANA), 1);
  assert.equal(psql(`select count(*) from public.household_members where household_id = '${a}'`), "1");
  assert.equal(psql(`select count(*) from public.budgets where household_id = '${a}'`), "1");
  assert.equal(psql(`select role from public.household_members where household_id = '${a}' and user_id = '${ANA}'`), "owner");
});

test("two requests at the same moment (two tabs) still make one household", { skip }, async () => {
  const run = () => new Promise((res, rej) => {
    const p = spawn("psql", [DB_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"]);
    let out = ""; p.stdout.on("data", d => { out += d; }); p.on("close", c => c ? rej(new Error("psql failed")) : res(last(out.trim())));
    p.stdin.end(asSql(BEN, `select public.create_household('Two tabs'), pg_sleep(0.3)`).replace("pg_sleep(0.3)", "pg_sleep(0.3)::text"));
  });
  const ids = await Promise.all([run(), run(), run()]);
  assert.equal(new Set(ids.map(x => x.split("|")[0])).size, 1);
  assert.equal(Number(psql(`select count(*) from public.households where created_by = '${BEN}' and name = 'Two tabs'`)), 1);
});

test("a different name, or the same name later, still makes a new household as before", { skip }, () => {
  const before = count(ANA);
  as(ANA, `select public.create_household('Ana second')`);
  assert.equal(count(ANA), before + 1);
  psql(`update public.households set created_at = now() - interval '5 minutes' where created_by = '${ANA}' and name = 'Ana home'`);
  as(ANA, `select public.create_household('Ana home')`);
  assert.equal(count(ANA), before + 2, "after 2 minutes the same name is a new household");
});

test("leaving a just-made household and creating again makes a fresh one (never hands back one you're not in)", { skip }, () => {
  const id = as(ANA, `select public.create_household('Brief')`);
  psql(`delete from public.household_members where household_id = '${id}'`);
  const again = as(ANA, `select public.create_household('Brief')`);
  assert.notEqual(again, id);
});

test("signed out: still refused", { skip }, () => {
  assert.throws(() => psql(`begin; set local role anon; select public.create_household('x'); commit;`), /Not signed in|permission denied/);
});

/* Phase 7D: household data isolation, checked across EVERY table, not one feature at a time.

   Two people each make their own household (and save something in it). Then, for every table in the
   app's schema: row-level security must be switched on, an outsider must see none of the other
   household's rows, and a signed-out visitor must see nothing at all. Any table added later without
   row-level security fails this test straight away. Runs on a throwaway Postgres only. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "isolation_test_" + process.pid;
let DB_URL;
const psql = (sql, url = DB_URL) => execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const last = s => s.split("\n").pop();
const as = (user, sql) => last(psql(`begin; set local role ${user ? "authenticated" : "anon"}; ${user ? `set local request.jwt.claim.sub = '${user}';` : ""} ${sql}; commit;`));
const ANA = "00000000-0000-0000-0000-0000000000a1", ZED = "00000000-0000-0000-0000-0000000000f9";
let HA, HZ;

before(() => {
  if (skip) return;
  psql(`drop database if exists ${DB}; create database ${DB};`, URL0);
  DB_URL = URL0.replace(/\/postgres(\?|$)/, `/${DB}$1`);
  psql(readFileSync(new URL("./supabase-shim.sql", import.meta.url), "utf8"));
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) psql(readFileSync(new URL(f, dir), "utf8"));
  psql(`insert into auth.users (id, email, raw_user_meta_data) values ('${ANA}','ana@example.com','{"name":"Ana"}'), ('${ZED}','zed@example.com','{"name":"Zed"}');`);
  HA = as(ANA, `select public.create_household('Ana home')`);
  HZ = as(ZED, `select public.create_household('Zed home')`);
  for (const [u, h] of [[ANA, HA], [ZED, HZ]]) as(u, `select public.apply_budget_ops('${h}', '[{"op":"set","path":["note"],"value":"private"}]'::jsonb)`);
});

/** Every table in the app's schema, and the column that says which household a row belongs to. */
const tables = () => psql(`select c.relname || '|' || c.relrowsecurity || '|' ||
    coalesce((select a.attname from pg_attribute a where a.attrelid = c.oid and a.attname in ('household_id') and not a.attisdropped), case when c.relname = 'households' then 'id' else '' end)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)
  .split("\n").filter(Boolean).map(l => { const [name, rls, col] = l.split("|"); return { name, rls: rls === "t" || rls === "true", col }; });

test("every table has row-level security switched on", { skip }, () => {
  const T = tables();
  assert.ok(T.length >= 8, `found ${T.length} tables`);
  const off = T.filter(t => !t.rls).map(t => t.name);
  assert.deepEqual(off, [], `tables without row-level security: ${off.join(", ")}`);
});

test("someone in another household sees none of your household's rows, in any table", { skip }, () => {
  const scoped = tables().filter(t => t.col);
  assert.ok(scoped.some(t => t.name === "budgets") && scoped.some(t => t.name === "household_members"));
  // sanity: Ana really can see her own budget, so a 0 below means "hidden", not "empty"
  assert.equal(as(ANA, `select count(*) from budgets where household_id = '${HA}'`), "1");
  // (some tables, like the reminder log, can't be read by people at all: "permission denied" is private too)
  const count = (u, sql) => { try { return as(u, sql); } catch (e) { if (/permission denied/.test(String(e.stderr || e.message))) return "0"; throw e; } };
  for (const t of scoped) {
    assert.equal(count(ZED, `select count(*) from public.${t.name} where ${t.col} = '${HA}'`), "0", `${t.name}: Zed can see Ana's rows`);
    assert.equal(count(ANA, `select count(*) from public.${t.name} where ${t.col} = '${HZ}'`), "0", `${t.name}: Ana can see Zed's rows`);
  }
});

test("an outsider can't save into, rename, or join another household", { skip }, () => {
  assert.throws(() => as(ZED, `select public.apply_budget_ops('${HA}', '[{"op":"set","path":["note"],"value":"hacked"}]'::jsonb)`));
  as(ZED, `update households set name = 'hacked' where id = '${HA}'`); // silently matches no rows under RLS
  assert.throws(() => as(ZED, `insert into household_members (household_id, user_id, role) values ('${HA}', '${ZED}', 'owner')`));
  assert.equal(as(ANA, `select name from households where id = '${HA}'`), "Ana home");
  assert.equal(as(ANA, `select state->>'note' from budgets where household_id = '${HA}'`), "private");
});

test("signed out: nothing from any table", { skip }, () => {
  for (const t of tables()) {
    let n;
    try { n = as(null, `select count(*) from public.${t.name}`); } catch (e) { if (!/permission denied/.test(String(e.stderr || e.message))) throw e; n = "0"; /* no access at all is fine too */ }
    assert.equal(n, "0", `${t.name}: visible when signed out`);
  }
});

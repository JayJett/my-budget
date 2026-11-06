/* Phase 2 database rules: roles, invites, managing members, leaving, deleting an account.
   Runs every migration in order on a throwaway Postgres (see start-local-db.sh). */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "roles_test_" + process.pid;
let DB_URL;
const psql = (sql, url = DB_URL) => execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const last = s => s.split("\n").pop();
const as = (user, sql) => last(psql(`begin; set local role ${user ? "authenticated" : "anon"}; ${user ? `set local request.jwt.claim.sub = '${user}';` : ""} ${sql}; commit;`));
const u = c => `00000000-0000-0000-0000-0000000000${c}`;
const ANA = u("a1"), BEN = u("b2"), CAT = u("c3"), DAN = u("d4"), EVE = u("e5");
const one = sql => last(psql(sql));

const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
const run = f => psql(readFileSync(new URL(f, dir), "utf8"));
let HH; // Ana's household

before(() => {
  if (skip) return;
  psql(`drop database if exists ${DB}; create database ${DB};`, URL0);
  DB_URL = URL0.replace(/\/postgres(\?|$)/, `/${DB}$1`);
  psql(readFileSync(new URL("./supabase-shim.sql", import.meta.url), "utf8"));
  run(files[0]);
  psql(`insert into auth.users (id, email, raw_user_meta_data) values
    ('${ANA}','ana@example.com','{"name":"Ana"}'), ('${BEN}','ben@example.com','{"name":"Ben"}'),
    ('${CAT}','cat@example.com','{"name":"Cat"}'), ('${DAN}','dan@example.com','{"name":"Dan"}'), ('${EVE}','eve@example.com','{"name":"Eve"}');`);
  HH = as(ANA, `select public.create_household('Ana home')`);
  // Ben joins the old way, as a Phase 1 "member"
  psql(`insert into household_members (household_id, user_id, display_name, email, role, joined_at) values ('${HH}', '${BEN}', 'Ben', 'ben@example.com', 'member', now());`);
  for (const f of files.slice(1)) run(f);
});

const save = (user, note) => as(user, `select (public.apply_budget_ops('${HH}', '[{"op":"set","path":["note"],"value":"${note}"}]'::jsonb))->>'seq'`);
const roleOf = (user, hh = HH) => one(`select coalesce((select role from household_members where household_id='${hh}' and user_id='${user}'), 'none')`);

test("Phase 1 'member' becomes 'editor'; the creator stays owner", { skip }, () => {
  assert.equal(roleOf(ANA), "owner");
  assert.equal(roleOf(BEN), "editor");
});

test("invites carry a role: Cat joins as a viewer", { skip }, () => {
  as(ANA, `select public.invite_member('${HH}', 'Cat@Example.com', 'viewer')`);
  assert.equal(as(CAT, `select public.accept_invites()`), "1");
  assert.equal(roleOf(CAT), "viewer");
});

test("the old two-part invite (no role) still works and means editor", { skip }, () => {
  as(BEN, `select public.invite_member('${HH}', 'dan@example.com')`);
  as(DAN, `select public.accept_invites()`);
  assert.equal(roleOf(DAN), "editor");
});

test("viewers can't invite anyone", { skip }, () => {
  assert.throws(() => as(CAT, `select public.invite_member('${HH}', 'eve@example.com', 'editor')`), /Only owners and editors/);
  assert.throws(() => as(ANA, `select public.invite_member('${HH}', 'eve@example.com', 'owner')`), /editor or a viewer/);
});

test("owners and editors can save; viewers and outsiders can't", { skip }, () => {
  assert.ok(Number(save(ANA, "from Ana")) > 0);
  assert.ok(Number(save(BEN, "from Ben")) > 0);
  assert.throws(() => save(CAT, "from Cat"), /view-only/);
  assert.throws(() => save(EVE, "from Eve"), /Not a member/);
  assert.equal(one(`select state->>'note' from budgets where household_id='${HH}'`), "from Ben");
});

test("nobody can give themselves a new role by editing their own row", { skip }, () => {
  assert.throws(() => as(CAT, `update household_members set role = 'owner' where user_id = '${CAT}'`), /permission denied/);
  assert.equal(roleOf(CAT), "viewer");
  as(CAT, `update household_members set display_name = 'Catherine' where user_id = '${CAT}'`);
  assert.equal(one(`select display_name from household_members where user_id='${CAT}'`), "Catherine");
});

test("only owners can rename the household", { skip }, () => {
  as(BEN, `update households set name = 'Ben was here' where id = '${HH}'`);
  assert.equal(one(`select name from households where id='${HH}'`), "Ana home", "the editor's rename changed nothing");
  as(ANA, `update households set name = 'Our place' where id = '${HH}'`);
  assert.equal(one(`select name from households where id='${HH}'`), "Our place");
  assert.throws(() => as(ANA, `update households set created_by = '${BEN}' where id = '${HH}'`), /permission denied/);
});

test("roles: only owners change them, and there's always at least one owner", { skip }, () => {
  assert.throws(() => as(BEN, `select public.set_member_role('${HH}', '${CAT}', 'editor')`), /Only an owner/);
  assert.throws(() => as(ANA, `select public.set_member_role('${HH}', '${ANA}', 'editor')`), /at least one owner/);
  as(ANA, `select public.set_member_role('${HH}', '${CAT}', 'editor')`);
  assert.equal(roleOf(CAT), "editor");
  as(ANA, `select public.set_member_role('${HH}', '${CAT}', 'viewer')`);
});

test("removing people: owners only, and not themselves", { skip }, () => {
  assert.throws(() => as(BEN, `select public.remove_member('${HH}', '${CAT}')`), /Only an owner/);
  assert.throws(() => as(ANA, `select public.remove_member('${HH}', '${ANA}')`), /Leave household/);
  as(ANA, `select public.remove_member('${HH}', '${DAN}')`);
  assert.equal(roleOf(DAN), "none");
});

test("the only owner leaves: the longest-standing member becomes owner", { skip }, () => {
  assert.equal(as(ANA, `select public.leave_household('${HH}')`), "ownership passed on");
  assert.equal(roleOf(ANA), "none");
  assert.equal(roleOf(BEN), "owner", "Ben joined before Cat");
  assert.equal(roleOf(CAT), "viewer");
  assert.equal(one(`select count(*) from budgets where household_id='${HH}'`), "1", "the budget stays");
});

test("one login can be in several households", { skip }, () => {
  const second = as(CAT, `select public.create_household('Mum''s budget')`);
  assert.equal(roleOf(CAT, second), "owner");
  assert.equal(as(CAT, `select count(*) from household_members where user_id = '${CAT}'`), "2");
  assert.equal(as(CAT, `select count(*) from households`), "2", "Cat sees both households");
});

test("the last person leaving deletes the household, its budget and backups", { skip }, () => {
  const solo = as(EVE, `select public.create_household('Eve solo')`);
  as(EVE, `select public.apply_budget_ops('${solo}', '[{"op":"replace","value":{"a":1}}]'::jsonb)`);
  assert.equal(one(`select count(*) from budget_backups where household_id='${solo}'`), "1");
  assert.equal(as(EVE, `select public.leave_household('${solo}')`), "household deleted");
  assert.equal(one(`select count(*) from households where id='${solo}'`), "0");
  assert.equal(one(`select count(*) from budgets where household_id='${solo}'`), "0");
  assert.equal(one(`select count(*) from budget_backups where household_id='${solo}'`), "0");
});

test("deleting your account: shared households live on, solo ones go, the login is gone", { skip }, () => {
  // Ben owns the shared household (Cat is a viewer there) and has a solo one too.
  const solo = as(BEN, `select public.create_household('Ben solo')`);
  as(BEN, `select public.invite_member('${HH}', 'someone@example.com', 'viewer')`);
  as(BEN, `select public.delete_my_account()`);
  assert.equal(one(`select count(*) from auth.users where id='${BEN}'`), "0");
  assert.equal(one(`select count(*) from households where id='${solo}'`), "0", "Ben's solo household is gone");
  assert.equal(one(`select count(*) from households where id='${HH}'`), "1", "the shared household stays");
  assert.equal(roleOf(CAT), "owner", "Cat, the last one left, now owns it");
  assert.equal(one(`select count(*) from budgets where household_id='${HH}'`), "1");
  assert.equal(one(`select count(*) from household_invites where email='someone@example.com'`), "1", "Ben's pending invite still works");
  assert.equal(one(`select updated_by is null from budgets where household_id='${HH}'`), "t", "no dangling link to Ben");
});

test("profile sync copies your current name and email into every household", { skip }, () => {
  psql(`update auth.users set raw_user_meta_data = '{"name":"Cathy"}', email = 'cathy@example.com' where id = '${CAT}'`);
  as(CAT, `select public.sync_my_profile()`);
  assert.equal(one(`select string_agg(distinct display_name || ' ' || email, ',') from household_members where user_id='${CAT}'`), "Cathy cathy@example.com");
});

test("signed-out visitors can't call any of the new functions; ping still works", { skip }, () => {
  for (const call of [`public.leave_household('${HH}')`, `public.delete_my_account()`, `public.member_role('${HH}')`, `public.set_member_role('${HH}', '${CAT}', 'viewer')`]) {
    assert.throws(() => as(null, `select ${call}`), /permission denied/, call);
  }
  assert.ok(as(null, `select public.ping()`).length > 0);
});

test("running the Phase 2 migration twice is harmless", { skip }, () => {
  const before = one(`select json_agg(m order by user_id)::text from household_members m`);
  run(files[3]);
  assert.equal(one(`select json_agg(m order by user_id)::text from household_members m`), before);
});

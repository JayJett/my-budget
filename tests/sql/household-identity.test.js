/* Phase 8: a household's look (colour, icon, photo). Everyone in the household sees it; only owners and
   editors change it; household photos are private to the household. Throwaway Postgres only. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "hhlook_test_" + process.pid;
let DB_URL, HH, OTHER;
const psql = (sql, url = DB_URL) => execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const last = s => s.split("\n").pop();
const as = (user, sql) => last(psql(`begin; set local role ${user ? "authenticated" : "anon"}; ${user ? `set local request.jwt.claim.sub = '${user}';` : ""} ${sql}; commit;`));
const ANA = "00000000-0000-0000-0000-0000000000a1", BEN = "00000000-0000-0000-0000-0000000000b2", VIC = "00000000-0000-0000-0000-0000000000c3", EVE = "00000000-0000-0000-0000-0000000000e4";
const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = () => readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
const put = (user, folder, file = "1731456000000.jpg") => as(user, `insert into storage.objects (bucket_id, name) values ('household-photos', '${folder}/${file}')`);
const look = (user, hh, obj) => as(user, `select public.set_household_appearance('${hh}', '${JSON.stringify(obj)}'::jsonb)`);

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
});

test("existing households start with no look (the app falls back to initials)", { skip }, () => {
  assert.equal(as(ANA, `select appearance::text from public.households where id = '${HH}'`), "{}");
});

test("owners and editors set the look; everyone in the household sees it; only known keys are kept", { skip }, () => {
  assert.equal(look(ANA, HH, { colour: "teal", icon: "home", junk: "x", photo: "elsewhere/1.jpg" }), '{"icon": "home", "colour": "teal"}');
  assert.equal(as(VIC, `select appearance->>'colour' from public.households where id = '${HH}'`), "teal", "a viewer sees it");
  assert.equal(look(BEN, HH, { colour: "rose", photo: `${HH}/1731456000000.jpg` }), `{"photo": "${HH}/1731456000000.jpg", "colour": "rose"}`);
});

test("viewers and outsiders can't change it, and nobody can write the column directly", { skip }, () => {
  assert.throws(() => look(VIC, HH, { colour: "blue" }), /Only owners and editors/);
  assert.throws(() => look(EVE, HH, { colour: "blue" }), /Not a member/);
  assert.throws(() => look(null, HH, { colour: "blue" }), /permission denied|Not signed in/);
  assert.throws(() => as(ANA, `update public.households set appearance = '{"colour":"red"}' where id = '${HH}'`), /permission denied/);
  assert.equal(as(EVE, `select count(*) from public.households where id = '${HH}'`), "0", "outsiders don't even see the household");
});

test("household photos: members see them, owners and editors add/replace/remove, viewers and outsiders can't", { skip }, () => {
  put(ANA, HH);
  put(BEN, HH, "1731456000001.jpg");
  assert.throws(() => put(VIC, HH, "1731456000002.jpg"), /row-level security/, "viewers can't add");
  assert.throws(() => put(EVE, HH, "1731456000003.jpg"), /row-level security/, "outsiders can't add");
  assert.throws(() => put(ANA, OTHER, "1731456000004.jpg"), /row-level security/, "not into another household's folder");
  assert.throws(() => put(ANA, "not-a-household", "x.jpg"), /row-level security/, "a bad folder name is refused, not an error");
  assert.equal(as(VIC, `select count(*) from storage.objects where bucket_id = 'household-photos'`), "2", "a viewer can see them");
  assert.equal(as(EVE, `select count(*) from storage.objects where bucket_id = 'household-photos'`), "0", "an outsider sees none");
  as(VIC, `delete from storage.objects where name = '${HH}/1731456000000.jpg'`);
  as(EVE, `delete from storage.objects where name = '${HH}/1731456000000.jpg'`);
  assert.equal(as(ANA, `select count(*) from storage.objects where bucket_id = 'household-photos'`), "2", "still both");
  as(BEN, `delete from storage.objects where name = '${HH}/1731456000000.jpg'`);
  assert.equal(as(ANA, `select count(*) from storage.objects where bucket_id = 'household-photos'`), "1");
});

test("signed out: nothing", { skip }, () => {
  assert.equal(as(null, `select count(*) from storage.objects where bucket_id = 'household-photos'`), "0");
});

test("the bucket is private, images only, small; running the migration again is harmless", { skip }, () => {
  assert.equal(psql(`select public::text || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'household-photos'`), "false|524288|image/jpeg,image/png,image/webp");
  psql(readFileSync(new URL(files().find(f => f.includes("household_identity")), dir), "utf8"));
  assert.equal(psql(`select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'household photos:%'`), "4");
  assert.equal(as(ANA, `select appearance->>'colour' from public.households where id = '${HH}'`), "rose", "the look survives");
});

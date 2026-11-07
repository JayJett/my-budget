/* Phase 7D.2: profile pictures. The avatars bucket is private, and each person can only see, add,
   replace or remove files in the folder named after their own user id. Throwaway Postgres only. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const URL0 = process.env.DATABASE_URL;
const skip = !URL0 && "DATABASE_URL not set (run tests/sql/start-local-db.sh)";
const DB = "avatars_test_" + process.pid;
let DB_URL;
const psql = (sql, url = DB_URL) => execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const last = s => s.split("\n").pop();
const as = (user, sql) => last(psql(`begin; set local role ${user ? "authenticated" : "anon"}; ${user ? `set local request.jwt.claim.sub = '${user}';` : ""} ${sql}; commit;`));
const ANA = "00000000-0000-0000-0000-0000000000a1", BEN = "00000000-0000-0000-0000-0000000000b2";
const put = (user, owner, file = "1.jpg") => as(user, `insert into storage.objects (bucket_id, name) values ('avatars', '${owner}/${file}')`);
const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = () => readdirSync(dir).filter(f => f.endsWith(".sql")).sort();

before(() => {
  if (skip) return;
  psql(`drop database if exists ${DB}; create database ${DB};`, URL0);
  DB_URL = URL0.replace(/\/postgres(\?|$)/, `/${DB}$1`);
  psql(readFileSync(new URL("./supabase-shim.sql", import.meta.url), "utf8"));
  for (const f of files()) psql(readFileSync(new URL(f, dir), "utf8"));
  psql(`insert into auth.users (id, email) values ('${ANA}','ana@example.com'), ('${BEN}','ben@example.com');`);
});

test("the avatars bucket is private, images only, and small", { skip }, () => {
  assert.equal(psql(`select public::text || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'avatars'`), "false|524288|image/jpeg,image/png,image/webp");
});

test("you can add, see, replace and remove pictures in your own folder", { skip }, () => {
  put(ANA, ANA);
  assert.equal(as(ANA, `select count(*) from storage.objects where bucket_id = 'avatars'`), "1");
  as(ANA, `update storage.objects set name = '${ANA}/2.jpg' where name = '${ANA}/1.jpg'`);
  assert.equal(as(ANA, `select name from storage.objects where bucket_id = 'avatars'`), `${ANA}/2.jpg`);
  as(ANA, `delete from storage.objects where name = '${ANA}/2.jpg'`);
  assert.equal(as(ANA, `select count(*) from storage.objects where bucket_id = 'avatars'`), "0");
});

test("nobody can put a picture in someone else's folder, or see, change or remove theirs", { skip }, () => {
  put(ANA, ANA, "mine.jpg");
  assert.throws(() => put(BEN, ANA, "sneaky.jpg"), /row-level security/);
  assert.throws(() => put(BEN, "avatars", "loose.jpg"), /row-level security/, "not outside a folder either");
  assert.equal(as(BEN, `select count(*) from storage.objects where bucket_id = 'avatars'`), "0", "Ben sees none of Ana's");
  as(BEN, `update storage.objects set name = '${BEN}/stolen.jpg' where name = '${ANA}/mine.jpg'`);
  as(BEN, `delete from storage.objects where name = '${ANA}/mine.jpg'`);
  assert.equal(as(ANA, `select name from storage.objects where bucket_id = 'avatars'`), `${ANA}/mine.jpg`, "still Ana's, untouched");
  assert.throws(() => as(ANA, `update storage.objects set name = '${BEN}/gift.jpg' where name = '${ANA}/mine.jpg'`), /row-level security/, "can't move yours into someone else's folder");
});

test("signed out: nothing", { skip }, () => {
  assert.equal(as(null, `select count(*) from storage.objects`), "0");
  assert.throws(() => as(null, `insert into storage.objects (bucket_id, name) values ('avatars', '${ANA}/x.jpg')`), /row-level security/);
});

test("running the avatars migration again is harmless", { skip }, () => {
  psql(readFileSync(new URL(files().find(f => f.includes("avatars")), dir), "utf8"));
  assert.equal(psql(`select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'avatars:%'`), "4");
});

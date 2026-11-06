import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, isEmpty } from "../js/model/migrate.js";
import { toStored, fromStored, blankBudget, addPerson, removePerson, renamePerson, moveItem } from "../js/model/schema.js";
import { LIVE_V3, RICH_V3 } from "./fixtures.js";

test("an empty budget stays empty (the app starts a fresh one)", () => {
  assert.equal(migrate({}), null);
  assert.equal(migrate(null), null);
  assert.ok(isEmpty({}));
});

test("your live budget converts without losing anything", () => {
  const s = migrate(LIVE_V3);
  assert.equal(s.version, 4);
  assert.deepEqual(s.people.map(p => [p.id, p.name, p.pay, p.freq]), [["j", "Jarden", 1000, "fortnightly"], ["m", "Madi", 500, "fortnightly"]]);
  assert.deepEqual(s.accounts.find(a => a.id === "ji").split, { j: 0.5 });
  assert.deepEqual(s.accounts.map(a => a.id), ["js", "ef", "jg", "ji", "jpg", "mpg"]);
  assert.equal(s.accounts.find(a => a.id === "jpg").owner, "j");
  assert.equal(s.accounts.find(a => a.id === "mpg").role, "personalGoals");
  assert.deepEqual(s.nw.accounts.map(a => [a.name, a.type, a.balance]), [["test", "Debt", 50000], ["cash", "Savings", 200000], ["", "Investment", 50000]]);
  assert.deepEqual(s.invest, { fee: 0, rate: 0.07, growth: 0 });
  assert.equal(s.viewAs, "fortnight");
});

test("every goal, spending line and percentage carries across", () => {
  const s = migrate(RICH_V3);
  assert.equal(s.spend.length, 5);
  assert.deepEqual(s.spend.map(x => x.name), RICH_V3.spend.map(x => x.name));
  assert.deepEqual(s.goals.joint.map(g => [g.name, g.split]), [["Holiday", { j: 0.5, m: 0.5 }], ["New couch", { j: 0.5, m: 0.3 }], ["House deposit", { m: 0.2 }]]);
  assert.deepEqual(s.goals.personal.j.map(g => g.name), ["Bike"]);
  assert.deepEqual(s.goals.personal.m.map(g => [g.name, g.pct]), [["Course", 0.6], ["Camera", 0.4]]);
  assert.equal(s.goals.ef.target, 15000);
  assert.equal(s.accounts.find(a => a.id === "xjs").owner, "j", "Jarden's own account is recognised by name");
  assert.equal(s.accounts.find(a => a.id === "xms").owner, "m");
  assert.equal(s.people[0].payday, "2026-01-01");
  assert.equal(s.note, "Test budget");
});

test("converting twice gives exactly the same result (safe if two phones upgrade at once)", () => {
  assert.deepEqual(toStored(migrate(RICH_V3)), toStored(migrate(RICH_V3)));
});

test("a converted budget survives saving and loading unchanged", () => {
  const s = migrate(RICH_V3);
  assert.deepEqual(fromStored(toStored(s)), s);
  assert.deepEqual(migrate(toStored(s)), s, "already version 4: left alone");
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(s))), s, "a downloaded backup loads too");
});

test("the original input is never modified", () => {
  const copy = structuredClone(RICH_V3);
  migrate(RICH_V3);
  assert.deepEqual(RICH_V3, copy);
});

test("adding and removing people keeps everything tidy", () => {
  const s = blankBudget({ name: "Ana" });
  const b = addPerson(s, { name: "Ben" });
  assert.notEqual(b.colour, s.people[0].colour, "each person gets their own colour");
  assert.ok(s.accounts.some(a => a.owner === b.id && a.role === "personalGoals"));
  s.accounts[0].split[b.id] = 0.2;
  removePerson(s, b.id);
  assert.equal(s.people.length, 1);
  assert.ok(!s.accounts.some(a => a.owner === b.id));
  assert.equal(s.accounts[0].split[b.id], undefined);
  assert.equal(s.goals.personal[b.id], undefined);
  assert.throws(() => removePerson(s, s.people[0].id), /at least one/);
});

test("renaming a person renames their default personal-goals account", () => {
  const s = blankBudget({ name: "Ana" });
  renamePerson(s, s.people[0].id, "Anna");
  assert.equal(s.accounts.find(a => a.role === "personalGoals").name, "Anna — Personal Goals");
});

test("reordering moves only the item that moved", () => {
  const L = [1, 2, 3, 4].map(i => ({ id: "i" + i, pos: i }));
  moveItem(L, 3, 0);
  assert.deepEqual(L.map(x => x.id), ["i4", "i1", "i2", "i3"]);
  assert.deepEqual(L.slice(1).map(x => x.pos), [1, 2, 3], "others keep their positions");
  assert.ok(L[0].pos < 1);
  moveItem(L, 0, 2);
  assert.deepEqual(L.map(x => x.id), ["i1", "i2", "i4", "i3"]);
  assert.ok(L[1].pos < L[2].pos && L[2].pos < L[3].pos);
});

test("half-rows (deleted by one person while another typed in them) are dropped", () => {
  const d = toStored(migrate(RICH_V3));
  d.spend.s1 = undefined; delete d.spend.s1;
  d.spend.s1 = { name: "Rent!" }; // someone's edit landed after the delete
  const s = fromStored(d);
  assert.ok(!s.spend.some(x => x.name === "Rent!"));
});

test("unpacking a saved budget never shares objects with it (edits must not leak back)", () => {
  const stored = toStored(migrate(RICH_V3)), copy = structuredClone(stored);
  const s = fromStored(stored);
  s.accounts[0].split.j = 0.99; s.people[0].name = "Changed"; s.goals.personal.j[0].name = "X"; s.spend[0].amount = 1;
  assert.deepEqual(stored, copy);
});

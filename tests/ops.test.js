import { test } from "node:test";
import assert from "node:assert/strict";
import { diff, applyOps, same } from "../js/sync/ops.js";
import { toStored, fromStored, addPerson } from "../js/model/schema.js";
import { migrate } from "../js/model/migrate.js";
import { clone, uid } from "../js/model/util.js";
import { RICH_V3 } from "./fixtures.js";

const base = () => toStored(migrate(RICH_V3));

test("one edit makes one small change, not a whole-budget save", () => {
  const a = base(), b = clone(a);
  b.accounts.js.split.j = 0.42;
  assert.deepEqual(diff(a, b), [{ op: "set", path: ["accounts", "js", "split", "j"], value: 0.42 }]);
});

test("adding and deleting rows", () => {
  const a = base(), b = clone(a);
  b.spend.new1 = { id: "new1", name: "Wifi", pos: 9 };
  delete b.spend.s2;
  const ops = diff(a, b);
  assert.deepEqual(ops, [{ op: "set", path: ["spend", "new1"], value: b.spend.new1 }, { op: "del", path: ["spend", "s2"] }]);
  assert.deepEqual(applyOps(a, ops), b);
});

test("diff + applyOps always rebuild the target", () => {
  const a = base();
  const s = fromStored(a);
  addPerson(s, { name: "Sam", pay: 900 });
  s.spend.pop(); s.goals.joint[0].saved = 1; s.viewAs = "month"; s.note = "";
  const b = toStored(s);
  assert.deepEqual(applyOps(a, diff(a, b)), b);
  assert.deepEqual(diff(b, b), []);
});

test("two people editing different things at once: both changes survive", () => {
  const server = base();
  const mine = clone(server); mine.accounts.js.split.j = 0.3;
  const theirs = clone(server); theirs.spend.s1.amount = 1250;
  let s = applyOps(server, diff(server, mine));
  s = applyOps(s, diff(server, theirs));
  assert.equal(s.accounts.js.split.j, 0.3);
  assert.equal(s.spend.s1.amount, 1250);
});

test("two people adding rows at once: both rows survive", () => {
  const server = base();
  const mine = clone(server); const id1 = uid(); mine.spend[id1] = { id: id1, name: "Gym", pos: 6 };
  const theirs = clone(server); const id2 = uid(); theirs.spend[id2] = { id: id2, name: "Phone", pos: 6 };
  let s = applyOps(server, diff(server, mine));
  s = applyOps(s, diff(server, theirs));
  const names = fromStored(s).spend.map(x => x.name);
  assert.ok(names.includes("Gym") && names.includes("Phone"));
});

test("two people editing the same box: the later one wins, only for that box", () => {
  const server = base();
  const mine = clone(server); mine.spend.s1.amount = 1; mine.spend.s1.notes = "mine";
  const theirs = clone(server); theirs.spend.s1.amount = 2;
  let s = applyOps(server, diff(server, mine));
  s = applyOps(s, diff(server, theirs));
  assert.equal(s.spend.s1.amount, 2);
  assert.equal(s.spend.s1.notes, "mine");
});

test("set creates missing parents; del of something missing does nothing", () => {
  assert.deepEqual(applyOps({}, [{ op: "set", path: ["a", "b", "c"], value: 1 }]), { a: { b: { c: 1 } } });
  assert.deepEqual(applyOps({ a: 5 }, [{ op: "set", path: ["a", "b"], value: 1 }]), { a: { b: 1 } });
  assert.deepEqual(applyOps({ a: 1 }, [{ op: "del", path: ["x", "y"] }]), { a: 1 });
});

test("replace swaps the whole budget (used for upgrades and imports)", () => {
  assert.deepEqual(applyOps({ a: 1 }, [{ op: "replace", value: { b: 2 } }]), { b: 2 });
  assert.deepEqual(diff({ a: 1 }, null), [{ op: "replace", value: null }]);
});

test("applyOps never changes its input", () => {
  const a = base(), copy = clone(a);
  applyOps(a, [{ op: "set", path: ["note"], value: "x" }, { op: "del", path: ["spend"] }]);
  assert.ok(same(a, copy));
});

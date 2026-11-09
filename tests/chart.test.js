/* Phase 9C.1: the small doughnuts only ever show honest parts of a whole. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { donutParts } from "../js/model/chart.js";

test("percent labels add up to 100, deterministically", () => {
  const D = donutParts([{ label: "A", v: 1 }, { label: "B", v: 1 }, { label: "C", v: 1 }]);
  assert.deepEqual(D.map(p => p.pct), [34, 33, 33]);
  assert.deepEqual(donutParts([{ label: "J", v: 2400 }, { label: "M", v: 1900 }]).map(p => p.pct), [56, 44]);
  const many = donutParts(Array.from({ length: 7 }, (_, i) => ({ label: String(i), v: i + 1 })));
  assert.equal(many.reduce((s, p) => s + p.pct, 0), 100);
  assert.ok(Math.abs(many.reduce((s, p) => s + p.frac, 0) - 1) < 1e-12);
});
test("zero parts are left out; one part is the whole", () => {
  const D = donutParts([{ label: "A", v: 0 }, { label: "B", v: 5 }]);
  assert.equal(D.length, 1); assert.equal(D[0].pct, 100); assert.equal(D[0].frac, 1);
});
test("nothing, negatives or non-numbers: no doughnut at all", () => {
  assert.equal(donutParts([]), null);
  assert.equal(donutParts([{ label: "A", v: 0 }]), null);
  assert.equal(donutParts([{ label: "A", v: 10 }, { label: "B", v: -3 }]), null, "a negative can't be a slice");
  assert.equal(donutParts([{ label: "A", v: NaN }]), null);
  assert.equal(donutParts([{ label: "A", v: Infinity }]), null);
  assert.equal(donutParts(null), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { perYear, toAnnual, fromAnnual, convert, addPeriods } from "../js/model/periods.js";
import { ymd } from "../js/model/util.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("pay frequencies turn into yearly amounts", () => {
  assert.equal(toAnnual(1000, "weekly"), 52000);
  assert.equal(toAnnual(2000, "fortnightly"), 52000);
  assert.equal(toAnnual(4000, "monthly"), 48000);
});

test("view-as periods divide the yearly amount", () => {
  close(fromAnnual(52000, "week"), 1000);
  close(fromAnnual(52000, "fortnight"), 2000);
  close(fromAnnual(52000, "month"), 52000 / 12);
});

test("converting fortnightly to monthly uses 26/12, not 2", () => {
  close(convert(2000, "fortnightly", "month"), 2000 * 26 / 12); // $4,333.33, not $4,000
  close(convert(4000, "monthly", "fortnight"), 4000 * 12 / 26);
  close(convert(500, "Year", "week"), 500 / 52);
});

test("unknown periods are refused loudly", () => {
  assert.throws(() => perYear("daily"));
});

test("stepping dates forward by periods", () => {
  const d = new Date(2026, 0, 31);
  assert.equal(ymd(addPeriods(d, 2, "week")), "2026-02-14");
  assert.equal(ymd(addPeriods(d, 1, "fortnight")), "2026-02-14");
  assert.equal(ymd(addPeriods(new Date(2026, 0, 15), 3, "month")), "2026-04-15");
});

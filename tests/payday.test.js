/* Phase 10: Payday Playbook maths (tests A–O from the brief) and the payday reminder. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { paydayPlan, splitCents, readDest, planSnapshot, sameAsSnapshot, destAccounts } from "../js/model/payday.js";
import { nextPayday, payOccurrence } from "../js/model/paydate.js";
import { nextPayday as homeNext } from "../js/model/home.js";
import { remindersFor } from "../js/model/reminders.js";
import { compute } from "../js/model/calc.js";
import { blankBudget, addPerson } from "../js/model/schema.js";

const T = new Date(2026, 10, 9); // Mon 9 Nov 2026
const id = (S, role) => S.accounts.find(a => a.role === role).id;
const $ = c => c / 100;
function solo({ pay = 2000, freq = "fortnightly", payday = "2026-11-11", shares = { spending: 0.5, emergency: 0.2, goals: 0.2, invest: 0.1 } } = {}) {
  const S = blankBudget({ name: "Sam", mode: "solo" }), p = S.people[0];
  Object.assign(p, { pay, freq, payday });
  S.accounts.forEach(a => { if (shares[a.role] != null) a.split[p.id] = shares[a.role]; });
  return S;
}
function couple() {
  const S = blankBudget({ name: "Jarden", mode: "shared" }); addPerson(S, { name: "Madi" });
  const [j, m] = S.people;
  Object.assign(j, { pay: 2900, freq: "fortnightly", payday: "2026-11-18" }); Object.assign(m, { pay: 600, freq: "weekly", payday: "2026-11-12" });
  const set = (role, a, b) => { const acc = S.accounts.find(x => x.role === role); acc.split[j.id] = a; acc.split[m.id] = b; };
  set("spending", 0.4, 0.5); set("emergency", 0.1, 0.1); set("goals", 0.1, 0.1); set("invest", 0.2, 0.1);
  S.accounts.filter(a => a.role === "personalGoals").forEach(a => { a.split = {}; });
  S.accounts.push({ id: "pj", name: "Jarden spending", type: "Personal", owner: j.id, role: null, split: { [j.id]: 0.2 }, pos: 20 });
  S.accounts.push({ id: "pm", name: "Madi spending", type: "Personal", owner: m.id, role: null, split: { [m.id]: 0.2 }, pos: 21 });
  return S;
}

describe("instructions A–O", () => {
  test("A: solo fortnightly: each allocation's part of one pay, to the cent, summing to the pay", () => {
    const S = solo(), P = paydayPlan(S, S.people[0].id, T);
    assert.equal(P.date, "2026-11-11"); assert.equal(P.inDays, 2); assert.equal(P.status, "ok");
    assert.deepEqual(P.lines.map(l => $(l.cents)), [1000, 400, 400, 200]);
    assert.equal(P.lines.reduce((s, l) => s + l.cents, 0), P.payC);
    assert.ok(P.groups.every(g => g.kind === "aside"), "no destinations yet: set aside, never a made-up transfer");
  });
  test("B: weekly: the next weekly payday and one week's pay", () => {
    const S = solo({ pay: 750, freq: "weekly", payday: "2026-10-01" }), P = paydayPlan(S, S.people[0].id, T);
    assert.equal(P.date, "2026-11-12"); assert.equal($(P.payC), 750);
    assert.deepEqual(P.lines.map(l => $(l.cents)), [375, 150, 150, 75]);
  });
  test("C: monthly: same day each month (the 31st becomes the 30th in November)", () => {
    const S = solo({ pay: 4333.33, freq: "monthly", payday: "2026-08-31" }), P = paydayPlan(S, S.people[0].id, T);
    assert.equal(P.date, "2026-11-30"); assert.equal(P.payC, 433333);
    assert.equal(P.lines.reduce((s, l) => s + l.cents, 0), 433333);
    assert.equal(ymdOf(payOccurrence("2026-08-31", "monthly", T, 1)), "2026-12-31");
    assert.equal(ymdOf(payOccurrence("2026-08-31", "monthly", T, -1)), "2026-10-31");
  });
  test("D: mixed frequencies: each person their own payday and pay; never one household payday", () => {
    const S = couple(), [j, m] = S.people;
    const J = paydayPlan(S, j.id, T), M = paydayPlan(S, m.id, T);
    assert.equal(J.date, "2026-11-18"); assert.equal($(J.payC), 2900);
    assert.equal(M.date, "2026-11-12"); assert.equal($(M.payC), 600);
    assert.equal(ymdOf(payOccurrence(m.payday, m.freq, T, 1)), "2026-11-19");
  });
  test("E: shared allocation: each person's own part from their own share", () => {
    const S = couple(), [j, m] = S.people, sp = id(S, "spending");
    assert.equal($(paydayPlan(S, j.id, T).lines.find(l => l.id === sp).cents), 1160);
    assert.equal($(paydayPlan(S, m.id, T).lines.find(l => l.id === sp).cents), 300);
  });
  test("F: personal allocation: only its owner's plan has it", () => {
    const S = couple(), [j, m] = S.people;
    assert.ok(paydayPlan(S, j.id, T).lines.some(l => l.id === "pj")); assert.ok(!paydayPlan(S, j.id, T).lines.some(l => l.id === "pm"));
    assert.ok(paydayPlan(S, m.id, T).lines.some(l => l.id === "pm")); assert.ok(!paydayPlan(S, m.id, T).lines.some(l => l.id === "pj"));
  });
  test("G: under 100%: the rest is 'not allocated yet', not a transfer", () => {
    const S = solo({ shares: { spending: 0.5, emergency: 0.1, goals: 0.2, invest: 0.1 } }), P = paydayPlan(S, S.people[0].id, T);
    assert.equal(P.status, "left"); assert.equal($(P.leftC), 200); assert.equal($(P.plannedC), 1800);
    assert.equal(P.lines.reduce((s, l) => s + l.cents, 0) + P.leftC, P.payC);
  });
  test("H: over 100%: no instructions at all, just the problem", () => {
    const S = solo({ shares: { spending: 0.6, emergency: 0.2, goals: 0.2, invest: 0.1 } }), P = paydayPlan(S, S.people[0].id, T);
    assert.equal(P.status, "over"); assert.deepEqual(P.groups, []); assert.deepEqual(P.lines, []);
    assert.ok(Math.abs(P.overPct - 0.1) < 1e-9);
  });
  test("I: cents: odd amounts and thirds reconcile exactly, deterministically", () => {
    const S = solo({ pay: 1000.01, shares: { spending: 1 / 3, emergency: 1 / 3, goals: 1 / 3, invest: 0 } });
    const P = paydayPlan(S, S.people[0].id, T);
    assert.equal(P.status, "ok"); assert.deepEqual(P.lines.map(l => l.cents), [33334, 33334, 33333]);
    assert.deepEqual(splitCents(100, [1, 1, 1]), [34, 33, 33]); assert.deepEqual(splitCents(0, [1, 2]), [0, 0]);
    assert.deepEqual(paydayPlan(S, S.people[0].id, T), P, "the same every time");
  });
  test("J: no pay or no payday: no invalid numbers, no made-up date", () => {
    const S = solo({ pay: 0 }); assert.equal(paydayPlan(S, S.people[0].id, T).status, "nopay");
    const N = solo({ payday: "" }), P = paydayPlan(N, N.people[0].id, T);
    assert.equal(P.status, "nodate"); assert.equal(P.date, null); assert.equal(P.lines.reduce((s, l) => s + l.cents, 0), P.payC);
    assert.equal(paydayPlan(S, "nobody", T).status, "nopay");
    [solo(), couple()].forEach(B => B.people.forEach(p => paydayPlan(B, p.id, T).lines.forEach(l => assert.ok(Number.isInteger(l.cents) && l.cents > 0))));
  });
  test("K: renamed allocations are followed by id", () => {
    const S = solo(); S.accounts.find(a => a.role === "invest").name = "Shares 🚀";
    assert.ok(paydayPlan(S, S.people[0].id, T).lines.some(l => l.name === "Shares 🚀" && l.cents === 20000));
  });
  test("L: different destinations stay separate; M: the same one is grouped, parts kept", () => {
    const S = solo();
    S.nw.accounts = [{ id: "ev", name: "Everyday", type: "Operating", balance: 100 }, { id: "sv", name: "Savings", type: "Savings", balance: 500 }];
    S.accounts.find(a => a.role === "emergency").dest = { nw: "sv" };
    S.accounts.find(a => a.role === "goals").dest = { nw: "sv" };
    S.accounts.find(a => a.role === "invest").dest = { label: "Sharesies" };
    const P = paydayPlan(S, S.people[0].id, T);
    const sv = P.groups.find(g => g.key === "move:nw:sv");
    assert.equal($(sv.cents), 800); assert.deepEqual(sv.parts.map(x => $(x.cents)), [400, 400]);
    assert.equal(P.groups.find(g => g.key === "move:label:sharesies").name, "Sharesies");
    assert.equal(P.groups.filter(g => g.kind === "move").length, 2);
    assert.equal(P.groups.reduce((s, g) => s + g.cents, 0), P.plannedC, "grouping never changes the total");
  });
  test("N: money for the account pay lands in is 'kept', not transferred to itself", () => {
    const S = solo(); S.nw.accounts = [{ id: "ev", name: "Everyday", type: "Operating" }];
    S.people[0].src = { nw: "ev" };
    S.accounts.find(a => a.role === "spending").dest = { nw: "ev" };
    const P = paydayPlan(S, S.people[0].id, T);
    assert.deepEqual(P.groups[0], { key: "keep:nw:ev", kind: "keep", name: "Everyday", dest: P.groups[0].dest, cents: 100000, parts: P.groups[0].parts });
    assert.equal(P.src.name, "Everyday");
  });
  test("O: no destination (or a removed account): still shown, set aside, never a transfer", () => {
    const S = solo(); S.accounts.find(a => a.role === "goals").dest = { nw: "deleted" };
    const P = paydayPlan(S, S.people[0].id, T);
    assert.equal(P.groups.length, 4); assert.ok(P.groups.every(g => g.kind === "aside"));
    assert.equal(readDest(S, { nw: "deleted" }).gone, true);
    assert.equal(readDest(S, { label: "   " }), null);
  });
});

describe("people, destinations and safety", () => {
  test("a shared allocation can send one person's part elsewhere; ownership doesn't change", () => {
    const S = couple(), [j, m] = S.people, inv = S.accounts.find(a => a.role === "invest");
    inv.dest = { label: "Joint shares" }; inv.destBy = { [m.id]: { label: "Madi's KiwiSaver top-up" } };
    assert.equal(paydayPlan(S, j.id, T).groups.find(g => g.parts.some(x => x.id === inv.id)).name, "Joint shares");
    assert.equal(paydayPlan(S, m.id, T).groups.find(g => g.parts.some(x => x.id === inv.id)).name, "Madi's KiwiSaver top-up");
    assert.equal(inv.type, "Investment");
  });
  test("destinations are only accounts money can go to (not debts or super); labels aren't accounts", () => {
    const S = solo(); S.nw.accounts = [{ id: "a", name: "Everyday", type: "Operating" }, { id: "d", name: "Car loan", type: "Debt" }, { id: "k", name: "KiwiSaver", type: "Super" }, { id: "s", name: "Shares", type: "Investment" }];
    assert.deepEqual(destAccounts(S).map(a => a.id), ["a", "s"]);
    assert.equal(readDest(S, { nw: "d" }).gone, true, "a debt can't be a destination");
    S.accounts[0].dest = { label: "Joint bills" };
    const C = compute(S, T);
    assert.equal(C.nw.net, 0, "a label adds nothing to net worth");
  });
  test("working out a plan changes nothing in the budget", () => {
    const S = couple(), before = JSON.stringify(S);
    S.people.forEach(p => { paydayPlan(S, p.id, T); paydayPlan(S, p.id, T, -1); planSnapshot(paydayPlan(S, p.id, T)); });
    assert.equal(JSON.stringify(S), before);
  });
  test("a kept copy: matches until the budget changes", () => {
    const S = solo(), pid = S.people[0].id, snap = planSnapshot(paydayPlan(S, pid, T));
    assert.equal(sameAsSnapshot(paydayPlan(S, pid, T), snap), true);
    S.accounts.find(a => a.role === "goals").split[pid] = 0.15;
    assert.equal(sameAsSnapshot(paydayPlan(S, pid, T), snap), false);
    assert.equal(snap.groups.find(g => g.key.startsWith("aside:")).cents > 0, true);
  });
  test("the payday maths is the same one Home uses", () => {
    assert.equal(homeNext, nextPayday);
    assert.equal(ymdOf(nextPayday("2026-11-09", "fortnightly", T)), "2026-11-09", "today counts");
  });
});

describe("payday reminder", () => {
  const S = solo({ payday: "2026-11-09" }), pid = S.people[0].id;
  test("only when switched on, only for the member who is that person, only on the day, no amounts", () => {
    assert.deepEqual(remindersFor(S, {}, T, { personId: pid }), [], "off by default");
    const r = remindersFor(S, { payday: true }, T, { personId: pid });
    assert.deepEqual(r.map(x => [x.kind, x.key, x.tab]), [["payday", `payday:${pid}:2026-11-09`, "payday"]]);
    assert.doesNotMatch(r[0].title + r[0].body, /\$|\d{2,}/, "no amounts on the lock screen");
    assert.deepEqual(remindersFor(S, { payday: true }, T), [], "not linked to a person: nothing");
    assert.deepEqual(remindersFor(S, { payday: true }, new Date(2026, 10, 10), { personId: pid }), [], "not on other days");
    assert.deepEqual(remindersFor(S, { payday: true }, new Date(2026, 10, 23), { personId: pid }).map(x => x.key), [`payday:${pid}:2026-11-23`], "next fortnight: a new key");
    const W = solo({ freq: "weekly", payday: "2026-11-02" });
    assert.equal(remindersFor(W, { payday: true }, T, { personId: W.people[0].id }).length, 1, "weekly");
    const Z = solo({ pay: 0, payday: "2026-11-09" });
    assert.deepEqual(remindersFor(Z, { payday: true }, T, { personId: Z.people[0].id }), [], "no pay: no payday reminder");
  });
});

function ymdOf(d) { return d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

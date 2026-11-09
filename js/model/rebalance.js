/* Phase 9C: rebalancing. Change how much one allocation gets, and decide where the difference comes
   from (or goes to), as a proposal that changes nothing until it's applied.

   How the app's money works (calc.js): every allocation takes a SHARE of EACH PERSON'S PAY
   (accounts[].split[personId], a fraction). So each person's plan balances on its own. A rebalance
   therefore works person by person:
   - The target's change is divided between the people who pay into it ("who pays"): by default the
     same way they pay into it now; a Personal allocation with an owner is only ever its owner's.
   - Each person's part is then found in THAT person's plan only: from their pay with no plan yet (if
     chosen), and from the other allocations the person has chosen to take it from. Nothing is taken
     from an allocation that isn't chosen, and nothing is assumed (savings and investing included).
   - A lower amount frees money in each person's plan. It stays "no plan yet" unless the person picks
     allocations to give it to.

   Exactness: the amount you type is in the period you're viewing, in cents. Every split of money is
   done in whole cents of that period with largest remainders (deterministic), and an allocation that
   gives everything goes to exactly 0%, so the before/after rows add up to the cent. Shares are stored
   as fractions of each person's pay, as always, so changing the viewing period changes nothing.

   Only allocation shares change. Names, icons, colours, order, expenses, goals, balances, snapshots and
   history are never touched. Nothing here saves; ui/rebalance.js saves an approved proposal in one step. */
import { n } from "./util.js";
import { perYear } from "./periods.js";
import { compute } from "./calc.js";
import { planStatus } from "./home.js";
import { coverage } from "./intelligence.js";

const SAVING_ROLES = ["emergency", "goals", "personalGoals", "invest"];
export const isSaving = a => SAVING_ROLES.includes(a.role) || a.type === "Investment";
/** Can this person put money into this allocation? (Someone else's personal allocation: no.) */
export const canFund = (a, pid) => a.type !== "Personal" || !a.owner || a.owner === pid;

const toC = (annual, per) => Math.round(annual / per * 100);      // annual → whole cents of the shown period
const fromC = (c, per) => c * per / 100;                          // and back
const clean = x => (Math.abs(x) < 1e-12 ? 0 : +x.toFixed(12));   // a share, without float dust

/** Share out T whole cents by weight, largest remainder first (ties: list order). Always sums to T. */
export function shareOut(T, weights) {
  const W = weights.reduce((s, w) => s + Math.max(0, w), 0), k = weights.length;
  if (!k || T <= 0) return weights.map(() => 0);
  const raw = weights.map(w => (W > 0 ? T * Math.max(0, w) / W : T / k));
  const out = raw.map(Math.floor); let left = T - out.reduce((s, x) => s + x, 0);
  raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i)
    .forEach(({ i }) => { if (left > 0 && (W > 0 ? weights[i] > 0 : true)) { out[i]++; left--; } });
  return out;
}

/** Can this budget be rebalanced at all? */
export function canRebalance(S, C) {
  if (!S.accounts.length) return { ok: false, reason: "Add an allocation first" };
  if (!(C.incTotal > 0)) return { ok: false, reason: "Add your pay first" };
  return { ok: true };
}

/** What a proposal is based on: pay and every allocation share. If any of this changes before the
    proposal is applied (another person's edit, say), the proposal is out of date. */
export function fingerprint(S) {
  const r = x => (typeof x === "number" && isFinite(x) ? +x.toFixed(10) : null);
  return JSON.stringify([
    S.people.map(p => [p.id, r(p.pay), p.freq || ""]).sort(),
    S.accounts.map(a => [a.id, a.type || "", a.owner || "", a.role || "", S.people.map(p => r(a.split[p.id]))]).sort(),
  ]);
}

/** The ways a change can be divided between people, for this allocation. */
export function whoOptions(S, C, targetId) {
  const a = S.accounts.find(x => x.id === targetId); if (!a) return [];
  const earners = C.people.filter(p => p.annual > 0 && canFund(a, p.id));
  if (earners.length < 2) return [];
  const row = C.rows.find(r => r.id === targetId), now = earners.filter(p => row.by[p.id] > 0);
  const opts = [];
  if (now.length) opts.push({ k: "asNow", label: "As now" });
  opts.push({ k: "byPay", label: "By pay" }, { k: "equal", label: "Equally" });
  earners.forEach(p => opts.push({ k: p.id, label: `${p.name || "Unnamed"} only` }));
  return opts;
}

/**
 * Work out a proposal. Nothing is saved or changed: S and C are only read.
 * input: {
 *   target:  allocation id to change
 *   amount:  its new amount, per the shown period (dollars)
 *   who:     "asNow" (default) | "byPay" | "equal" | a person id: who pays an increase
 *   useFree: take an increase from pay with no plan yet first (default true)
 *   from:    ids of allocations chosen to take an increase from / give a decrease to
 *   manual:  { id: dollars per shown period } exact amounts for some of those (one person affected only)
 * }
 * Returns { ok, errors, kind, target, people, changes, splits, ops, unfunded, before, after, ... }.
 */
export function propose(S, C, input = {}) {
  const per = perYear(S.viewAs || "fortnight"), errors = [];
  const out = { ok: false, errors, kind: "none", splits: {}, changes: [], people: [], unfunded: 0, ops: [], basis: fingerprint(S), per };
  const can = canRebalance(S, C); if (!can.ok) { errors.push({ k: "unavailable", t: can.reason }); return out; }
  const acc = S.accounts.find(a => a.id === input.target), row = acc && C.rows.find(r => r.id === acc.id);
  if (!acc) { errors.push({ k: "noTarget", t: "Choose an allocation to change" }); return out; }
  const amt = Number(input.amount);
  if (input.amount === "" || input.amount == null || !isFinite(amt) || amt < 0) { errors.push({ k: "badAmount", t: "Enter an amount of $0 or more" }); return out; }

  const P = C.people, idx = Object.fromEntries(P.map((p, i) => [p.id, i]));
  const newC = Math.round(amt * 100), oldC = toC(row.t, per), D = newC - oldC;
  out.target = { id: acc.id, name: acc.name || "Unnamed", before: row.t, after: row.t, delta: 0 };
  // new contributions, per person per allocation (annual), starting from today's
  const by = Object.fromEntries(C.rows.map(r => [r.id, { ...r.by }]));
  const exact0 = new Set(); // "acc|pid" given everything: exactly 0%
  const free = Object.fromEntries(P.map(p => [p.id, Math.max(0, p.annual - C.tot.amt[p.id])]));
  const chosen = (input.from || []).filter((id, i, L) => id !== acc.id && L.indexOf(id) === i && S.accounts.some(a => a.id === id));
  const manual = input.manual || {};

  if (D === 0 && !(newC === 0 && row.t > 0)) { errors.push({ k: "noChange", t: "Enter a new amount to see what changes" }); return finish(); }

  // 1. who pays the change to the target
  const dPer = {}; // person → cents of the shown period (+ more, − less)
  if (D > 0) {
    out.kind = "up";
    const earners = P.filter(p => p.annual > 0 && canFund(acc, p.id));
    let who = input.who || "asNow";
    if (!earners.length) { errors.push({ k: "noEarner", t: "Nobody who can pay into this has pay entered" }); return finish(); }
    if (earners.length === 1) who = earners[0].id;
    let payers, w;
    if (who === "asNow" && earners.some(p => row.by[p.id] > 0)) { payers = earners; w = payers.map(p => row.by[p.id]); }
    else if (who === "equal") { payers = earners; w = payers.map(() => 1); }
    else if (idx[who] != null && earners.some(p => p.id === who)) { payers = earners.filter(p => p.id === who); w = [1]; }
    else { payers = earners; w = payers.map(p => p.annual); } // by pay (also "as now" when nobody pays in yet)
    shareOut(D, w).forEach((c, i) => { dPer[payers[i].id] = c; });
    out.who = who;
  } else {
    out.kind = "down";
    const payers = P.filter(p => row.by[p.id] > 0);
    if (newC === 0) payers.forEach(p => { dPer[p.id] = -toC(row.by[p.id], per); exact0.add(acc.id + "|" + p.id); });
    else shareOut(-D, payers.map(p => row.by[p.id])).forEach((c, i) => { dPer[payers[i].id] = -Math.min(c, toC(row.by[payers[i].id], per)); });
  }
  Object.entries(dPer).forEach(([pid, c]) => { by[acc.id][pid] = exact0.has(acc.id + "|" + pid) ? 0 : Math.max(0, by[acc.id][pid] + fromC(c, per)); });

  // 2. each person balances their own part
  const affected = Object.keys(dPer).filter(pid => dPer[pid] !== 0);
  const manualOk = affected.length === 1;
  if (Object.keys(manual).length && !manualOk) errors.push({ k: "manualMany", t: "Exact amounts work when only one person’s plan changes" });
  let unfundedC = 0;
  affected.forEach(pid => {
    const p = P[idx[pid]], c = dPer[pid];
    const info = { id: pid, name: p.name || "", change: c, fromFree: 0, unfunded: 0, toFree: 0, freeBefore: free[pid] };
    if (c > 0) {
      let need = c;
      if (input.useFree !== false) { const f = Math.min(need, Math.floor(toC(free[pid], per) + 1e-6)); info.fromFree = f; need -= f; }
      const srcs = chosen.map(id => C.rows.find(r => r.id === id)).filter(r => r && by[r.id][pid] > 0 && canFund(r, pid));
      const avail = r => toC(by[r.id][pid], per);
      const take = (r, cents) => { // take cents from this allocation, exactly everything when it's all of it
        const all = avail(r);
        if (cents >= all) { exact0.add(r.id + "|" + pid); by[r.id][pid] = 0; return all; }
        by[r.id][pid] = Math.max(0, by[r.id][pid] - fromC(cents, per)); return cents;
      };
      if (manualOk) srcs.filter(r => manual[r.id] != null).forEach(r => {
        const m = Math.round(Math.max(0, Number(manual[r.id]) || 0) * 100);
        need -= take(r, Math.min(m, need));
      });
      const auto = srcs.filter(r => !(manualOk && manual[r.id] != null) && avail(r) > 0);
      const room = auto.reduce((s, r) => s + avail(r), 0), T = Math.min(Math.max(0, need), room);
      if (T === room) auto.forEach(r => { need -= take(r, avail(r)); });
      else {
        // proportional to what each gives now; a rounding cent that would overdraw one moves on
        const parts = shareOut(T, auto.map(r => by[r.id][pid]));
        let carry = 0;
        auto.forEach((r, i) => { const want = parts[i] + carry, got = Math.min(want, avail(r)); carry = want - got; need -= take(r, got); });
      }
      info.unfunded = Math.max(0, need); unfundedC += info.unfunded;
    } else {
      let freed = -c;
      const dests = chosen.map(id => C.rows.find(r => r.id === id)).filter(r => r && canFund(r, pid));
      const give = (r, cents) => { by[r.id][pid] += fromC(cents, per); freed -= cents; };
      if (manualOk) dests.filter(r => manual[r.id] != null).forEach(r => give(r, Math.min(Math.round(Math.max(0, Number(manual[r.id]) || 0) * 100), freed)));
      const auto = dests.filter(r => !(manualOk && manual[r.id] != null));
      if (auto.length && freed > 0) { const w = auto.map(r => by[r.id][pid]); shareOut(freed, w.some(x => x > 0) ? w : w.map(() => 1)).forEach((cents, i) => give(auto[i], cents)); }
      info.toFree = freed;
    }
    out.people.push(info);
  });
  out.unfunded = unfundedC;
  if (unfundedC > 0) errors.push({ k: "unfunded", t: "Choose where the rest comes from", cents: unfundedC });

  // 3. new shares (fractions of each person's pay), only where something changed
  C.rows.forEach(r => P.forEach(p => {
    if (!(p.annual > 0)) return;
    const was = n(S.accounts.find(a => a.id === r.id).split[p.id]);
    const now = exact0.has(r.id + "|" + p.id) ? 0 : clean(by[r.id][p.id] / p.annual);
    if (Math.abs(now - was) > 1e-12) (out.splits[r.id] = out.splits[r.id] || {})[p.id] = Math.max(0, now);
  }));
  return finish();

  function finish() {
    const next = withSplits(S, out.splits), C2 = compute(next, C.today);
    out.next = next; out.C2 = C2;
    out.changes = C.rows.map(r => {
      const r2 = C2.rows.find(x => x.id === r.id);
      return { id: r.id, name: r.name || "Unnamed", icon: r.icon, colour: r.colour, type: r.type, role: r.role, owner: r.owner || null,
        before: r.t, after: r2.t, delta: r2.t - r.t, saving: isSaving(r), target: r.id === acc.id,
        by: Object.fromEntries(P.map(p => [p.id, { before: r.by[p.id], after: r2.by[p.id] }])) };
    }).filter(x => out.splits[x.id]).sort((a, b) => (b.target - a.target));
    if (out.target) { const t = C2.rows.find(r => r.id === out.target.id); out.target.after = t.t; out.target.delta = t.t - out.target.before; }
    out.before = { plan: planStatus(C), cover: coverage(S, C) };
    out.after = { plan: planStatus(C2), cover: coverage(next, C2) };
    // a person whose plan changed must not end up over 100% (it can't, but never save it if it did)
    P.forEach(p => { if (p.annual > 0 && Object.values(out.splits).some(s => s[p.id] != null) && C2.tot.pct[p.id] > 1 + 1e-6 && C2.tot.pct[p.id] > C.tot.pct[p.id] + 1e-9) errors.push({ k: "over", t: `${p.name || "Someone"}’s plan would be over 100%` }); });
    Object.values(out.splits).forEach(s => Object.values(s).forEach(v => { if (!(v >= 0) || !isFinite(v)) errors.push({ k: "invalid", t: "Something doesn’t add up" }); }));
    out.ops = Object.entries(out.splits).flatMap(([id, s]) => Object.entries(s).map(([pid, v]) => ({ op: "set", path: ["accounts", id, "split", pid], value: v })));
    out.ok = !errors.length && out.ops.length > 0;
    return out;
  }
}

/** A copy of the budget with these shares set (for the preview). The budget passed in isn't changed. */
export function withSplits(S, splits) {
  const T = JSON.parse(JSON.stringify(S));
  Object.entries(splits || {}).forEach(([id, s]) => { const a = T.accounts.find(x => x.id === id); if (a) Object.entries(s).forEach(([pid, v]) => { a.split[pid] = v; }); });
  return T;
}

/** For the Budget card's shortfall: the allocation that pays for the entered expenses, and how much
    more it needs (per the shown period), or null when that isn't known for sure. */
export function shortfallFix(S, C) {
  const cv = coverage(S, C);
  if (cv.state !== "short" || !cv.allocation) return null;
  const row = C.rows.find(r => r.id === cv.allocation.id); if (!row) return null;
  const per = perYear(S.viewAs || "fortnight");
  return { target: row.id, amount: (toC(row.t, per) + Math.ceil(cv.short / per * 100 - 1e-6)) / 100 };
}

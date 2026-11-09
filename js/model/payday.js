/* Phase 10: the Payday Playbook. For one person and one payday: how their pay splits across their
   allocations, where each part goes, and what to do (keep it, move it, or set it aside).

   Nothing new is worked out about the budget itself. Each allocation already says what share of each
   person's pay it gets (accounts[].split[personId], the same numbers compute() uses), and each person's
   pay is what they enter for one payday (people[].pay, with how often). So on a payday:
       this allocation's part = that pay × that person's share
   It's the pay of ONE payday as entered, never a yearly figure divided back down, so a year with an
   extra payday doesn't change what each payday says.

   Cents: every split is done in whole cents, with leftover cents going to the largest fractions (ties
   in list order). The parts add up exactly to what's planned of that pay; anything not planned is
   shown as "not allocated yet", never as a transfer. A plan over 100% gets no instructions at all,
   just the problem and where to fix it.

   Where money goes (all optional, all metadata: no balance, goal or net worth ever changes):
   - An allocation can name a destination: one of the Wealth accounts (by its id, never its name) or a
     plain label ("Joint bills"). A label is only a name: it's not an account, has no balance and isn't
     in net worth.
   - In a shared allocation, one person can send their part somewhere else (destBy[personId]).
   - A person can say where their pay lands (src). Money for an allocation whose destination is that
     same place is "kept" there, not transferred to itself.
   Parts going to the same destination are grouped into one instruction, with the parts listed under
   it. Parts with no destination stay separate ("set aside"), and never look like a finished transfer. */
import { n, is100, blank, ymd, daysBetween } from "./util.js";
import { payOccurrence } from "./paydate.js";

/** Wealth account types money can be sent to. (Not super, which you can't pay into like an account,
    and not debts.) */
export const DEST_TYPES = ["Operating", "Savings", "Investment"];
export const destAccounts = S => (S.nw && S.nw.accounts || []).filter(a => DEST_TYPES.includes(a.type) && !blank(a.name));

/** A stored destination ({ nw: accountId } or { label: "..." }) made usable, or null. A link to an
    account that no longer exists counts as none (and says so with `gone`). */
export function readDest(S, d) {
  if (!d || typeof d !== "object") return null;
  if (d.nw) {
    const a = (S.nw && S.nw.accounts || []).find(x => x.id === d.nw);
    if (!a || !DEST_TYPES.includes(a.type)) return { gone: true };
    return { key: `nw:${a.id}`, name: a.name || "Unnamed account", nw: a.id, type: a.type };
  }
  const label = typeof d.label === "string" ? d.label.trim().slice(0, 60) : "";
  return label ? { key: `label:${label.toLowerCase()}`, name: label, label } : null;
}
/** Where this person's part of this allocation goes: their own choice, else the allocation's. */
export function destFor(S, acc, pid) {
  const own = acc.destBy && acc.destBy[pid] ? readDest(S, acc.destBy[pid]) : null;
  if (own && !own.gone) return own;
  return readDest(S, acc.dest);
}

/** Share out T whole cents by weight, largest remainder first (ties: list order). Always sums to T. */
export function splitCents(T, weights) {
  const W = weights.reduce((s, w) => s + w, 0);
  if (!(T > 0) || !(W > 0)) return weights.map(() => 0);
  const raw = weights.map(w => T * w / W), out = raw.map(Math.floor);
  let left = T - out.reduce((s, x) => s + x, 0);
  raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i).forEach(({ i }) => { if (left > 0 && weights[i] > 0) { out[i]++; left--; } });
  return out;
}

/** People with pay and a payday: the ones with a playbook. */
export const earners = S => (S.people || []).filter(p => n(p.pay) > 0);

/**
 * One person's payday. k: which payday (0 = the next one, today included; -1 the one before; 1 the
 * one after). Returns { person, date, inDays, payC, status, lines, groups, plannedC, leftC, overPct }:
 *   status "ok" (all planned), "left" (some not planned yet), "over" (more than 100%: no instructions),
 *          "nopay", or "nodate" (no payday entered: amounts but no date).
 *   lines: each allocation's part in cents.  groups: the instructions, in the order to show them.
 */
export function paydayPlan(S, pid, today, k = 0) {
  const p = (S.people || []).find(x => x.id === pid);
  const out = { person: p ? { id: p.id, name: p.name || "", freq: p.freq, pay: n(p.pay), colour: p.colour } : null, date: null, inDays: null, payC: 0, status: "nopay", lines: [], groups: [], plannedC: 0, leftC: 0, overPct: 0, src: null };
  if (!p || !(n(p.pay) > 0)) return out;
  const d = payOccurrence(p.payday, p.freq, today, k);
  if (d) { out.date = ymd(d); out.inDays = daysBetween(today, d); }
  out.payC = Math.round(n(p.pay) * 100);
  const accs = (S.accounts || []).filter(a => n(a.split && a.split[pid]) > 0);
  const total = accs.reduce((s, a) => s + n(a.split[pid]), 0);
  out.src = readDest(S, p.src); if (out.src && out.src.gone) out.src = null;
  if (total > 1 && !is100(total)) { out.status = "over"; out.overPct = total - 1; return out; }
  out.plannedC = is100(total) ? out.payC : Math.min(out.payC, Math.round(out.payC * total));
  out.leftC = out.payC - out.plannedC;
  const cents = splitCents(out.plannedC, accs.map(a => n(a.split[pid])));
  out.lines = accs.map((a, i) => { const d = destFor(S, a, pid); return { id: a.id, name: a.name || "Unnamed", icon: a.icon, colour: a.colour, type: a.type, role: a.role, owner: a.owner || null, cents: cents[i], dest: d && !d.gone ? d : null, gone: !!(d && d.gone) }; })
    .filter(l => l.cents > 0);
  const groups = new Map();
  out.lines.forEach(l => {
    const kind = !l.dest ? "aside" : out.src && out.src.key === l.dest.key ? "keep" : "move";
    const key = kind === "aside" ? `aside:${l.id}` : `${kind}:${l.dest.key}`;
    if (!groups.has(key)) groups.set(key, { key, kind, name: kind === "aside" ? l.name : l.dest.name, dest: l.dest, cents: 0, parts: [] });
    const g = groups.get(key); g.cents += l.cents; g.parts.push({ id: l.id, name: l.name, icon: l.icon, colour: l.colour, cents: l.cents });
  });
  const order = { keep: 0, move: 1, aside: 2 };
  out.groups = [...groups.values()].sort((a, b) => order[a.kind] - order[b.kind]); // stable: allocation order within each kind
  out.status = !out.date ? "nodate" : out.leftC > 0 ? "left" : "ok";
  return out;
}

/** What's kept with a checklist when it's started: enough to show it again exactly as it was. */
export function planSnapshot(P) {
  return { v: 1, date: P.date, pay: P.payC, left: P.leftC, src: P.src ? P.src.name : null,
    groups: P.groups.map(g => ({ key: g.key, kind: g.kind, name: g.name, cents: g.cents, parts: g.parts.map(x => ({ id: x.id, name: x.name, cents: x.cents })) })) };
}
/** Does a kept checklist still match the budget's instructions for that payday? */
export function sameAsSnapshot(P, snap) {
  if (!snap || !snap.groups) return true;
  const a = planSnapshot(P);
  return a.pay === snap.pay && a.left === snap.left && JSON.stringify(a.groups) === JSON.stringify(snap.groups);
}
/** Instructions that can be ticked: keep and move (a "set aside" has nowhere to go yet). */
export const tickable = g => g.kind === "keep" || g.kind === "move";

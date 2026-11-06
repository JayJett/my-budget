/* The shape of a budget (version 4), plus helpers to change it safely.

   In memory, lists are ordinary arrays (easy to loop over and draw).
   In the database, every list is stored as an object keyed by each item's id,
   with a `pos` number giving the order. That way two people editing different
   rows at the same time never overwrite each other (see js/sync/ops.js). */

import { uid, clone } from "./util.js";

export const VERSION = 4;
export const MAX_PEOPLE = 4;

/** Person colours. Each key has matching CSS variables (--c-<key>, -tint, -edge) in css/app.css,
    and a family of shades used for that person's accounts in the charts. */
export const PERSON_COLOURS = {
  blue:  { label: "Blue",  hex: "#2F6DB5", fam: ["#2F6DB5", "#5D93D0", "#92B8E3", "#1F4F85"] },
  gold:  { label: "Gold",  hex: "#A9720A", fam: ["#C08510", "#DDA944", "#ECCB80", "#8E620B"] },
  coral: { label: "Coral", hex: "#C0603C", fam: ["#C0603C", "#D88A6B", "#8E452B", "#E6B39B"] },
  rose:  { label: "Rose",  hex: "#B04A7C", fam: ["#B04A7C", "#CD79A3", "#86345C", "#E3AECA"] },
  slate: { label: "Slate", hex: "#4F6B7A", fam: ["#4F6B7A", "#7894A3", "#36505D", "#A9C0CC"] },
};
export const COLOUR_KEYS = Object.keys(PERSON_COLOURS);

/** Account "roles": the built-in accounts other tabs read from. They can be renamed but not deleted. */
export const ROLES = {
  spending: "Feeds the Joint spending tab",
  emergency: "Feeds the emergency fund",
  goals: "Feeds the joint goals",
  invest: "Feeds the Investments tab",
  personalGoals: "Feeds this person’s goals",
};

/* ---------- order within lists ---------- */
/** The position number for a new item at the end of a list. */
export const nextPos = list => list.reduce((m, x) => Math.max(m, typeof x.pos === "number" ? x.pos : 0), 0) + 1;
/** Sort by position, then id so the order is the same on every device. */
export const byPos = (a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity) || String(a.id).localeCompare(String(b.id));

/** Move list[from] to index `to`, changing only the moved item's `pos` where possible. */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || from >= list.length) return;
  const [it] = list.splice(from, 1);
  list.splice(to, 0, it);
  const before = list[to - 1], after = list[to + 1];
  const lo = before ? before.pos : (after ? after.pos - 2 : 0);
  const hi = after ? after.pos : lo + 2;
  if (typeof lo === "number" && typeof hi === "number" && hi - lo > 1e-6) it.pos = (lo + hi) / 2;
  else list.forEach((x, i) => { x.pos = i + 1; }); // gap too small: renumber everything
}
/** Give every item in a list a clean 1, 2, 3… position. */
export const renumber = list => { list.forEach((x, i) => { x.pos = i + 1; }); return list; };

/* ---------- people ---------- */
export function makePerson(fields = {}, taken = []) {
  const colour = fields.colour || COLOUR_KEYS.find(k => !taken.includes(k)) || "blue";
  return { id: fields.id || uid(), name: fields.name ?? "", colour, freq: fields.freq || "fortnightly",
           pay: fields.pay ?? null, payday: fields.payday || "", pos: fields.pos ?? 1 };
}
export const personalGoalsName = name => `${name || "Personal"} — Personal Goals`;

/** Add a person, with their own personal-goals account and goal list. */
export function addPerson(state, fields = {}) {
  if (state.people.length >= MAX_PEOPLE) throw new Error(`A household can have up to ${MAX_PEOPLE} people.`);
  const p = makePerson({ ...fields, pos: nextPos(state.people) }, state.people.map(x => x.colour));
  state.people.push(p);
  state.accounts.push({ id: uid(), name: personalGoalsName(p.name), type: "Personal", owner: p.id, role: "personalGoals", split: {}, pos: nextPos(state.accounts) });
  state.goals.personal[p.id] = [];
  return p;
}

/** Remove a person, their percentages, their personal accounts and their personal goals. */
export function removePerson(state, pid) {
  if (state.people.length <= 1) throw new Error("A budget needs at least one person.");
  state.people = state.people.filter(p => p.id !== pid);
  state.accounts = state.accounts.filter(a => a.owner !== pid);
  state.accounts.forEach(a => { if (a.split) delete a.split[pid]; });
  state.goals.joint.forEach(g => { if (g.split) delete g.split[pid]; });
  delete state.goals.personal[pid];
}

/** Rename helper: keeps a person's personal-goals account name in step when it still uses the default. */
export function renamePerson(state, pid, name) {
  const p = state.people.find(x => x.id === pid); if (!p) return;
  const acc = state.accounts.find(a => a.owner === pid && a.role === "personalGoals");
  if (acc && (acc.name === personalGoalsName(p.name) || !acc.name)) acc.name = personalGoalsName(name);
  p.name = name;
}

/* ---------- a fresh budget ---------- */
/** A new, empty budget for one person. (Phase 6: its starting accounts are named plainly, not "Joint …",
    since there's only one person; existing budgets keep whatever names they have.) */
export function blankBudget({ name = "" } = {}) {
  const me = makePerson({ name, colour: "blue", pos: 1 });
  const acc = (id, name, type, role, pos, owner = null) => ({ id, name, type, owner, role, split: {}, pos });
  return {
    version: VERSION, note: "", viewAs: "fortnight",
    people: [me],
    accounts: [
      acc("js", "Spending", "Joint", "spending", 1),
      acc("ef", "Emergency Fund", "Joint", "emergency", 2),
      acc("jg", "Goals", "Joint", "goals", 3),
      acc("ji", "Investments", "Investment", "invest", 4),
      acc(uid(), personalGoalsName(name), "Personal", "personalGoals", 5, me.id),
    ],
    nw: { reviewed: "", accounts: [] },
    spend: [],
    goals: { ef: { id: "ef", name: "Emergency Fund", target: null, saved: null, account: "", deadline: "" }, joint: [], personal: { [me.id]: [] } },
    invest: { rate: 0.07, growth: 0, fee: 0 },
  };
}

/* ---------- arrays ⇄ stored (keyed) form ---------- */
const keyed = arr => Object.fromEntries((arr || []).map((x, i) => [x.id, { ...x, pos: typeof x.pos === "number" ? x.pos : i + 1 }]));
/* Items without an id are skipped: that happens if one person deletes a row while
   someone else is still typing in it. The delete wins, rather than leaving half a row. */
const listed = obj => Object.entries(obj || {}).filter(([k, x]) => x && typeof x === "object" && x.id === k).map(([, x]) => x).sort(byPos);

/** In-memory budget → the shape saved in the database. */
export function toStored(s) {
  const out = clone(s);
  out.people = keyed(s.people);
  out.accounts = keyed(s.accounts);
  out.nw = { ...out.nw, accounts: keyed(s.nw.accounts) };
  out.spend = keyed(s.spend);
  out.goals = { ...out.goals, joint: keyed(s.goals.joint),
    personal: Object.fromEntries(Object.entries(s.goals.personal || {}).map(([pid, L]) => [pid, keyed(L)])) };
  return out;
}

/** Saved shape → in-memory budget, filling in anything missing so the app never trips over a gap. */
export function fromStored(input) {
  const d = clone(input), s = clone(input); // never share objects with the input
  s.people = listed(d.people);
  s.accounts = listed(d.accounts);
  s.nw = { reviewed: "", ...(d.nw || {}), accounts: listed(d.nw && d.nw.accounts) };
  s.spend = listed(d.spend);
  const g = d.goals || {};
  s.goals = { ...g, ef: { id: "ef", name: "Emergency Fund", target: null, saved: null, account: "", deadline: "", ...(g.ef || {}) },
    joint: listed(g.joint),
    personal: Object.fromEntries(Object.entries(g.personal || {}).map(([pid, L]) => [pid, listed(L)])) };
  return normalise(s);
}

/** Make sure every required field exists. Safe to run any number of times. */
export function normalise(s) {
  s.version = VERSION;
  if (s.note === undefined) s.note = "";
  if (!["week", "fortnight", "month"].includes(s.viewAs)) s.viewAs = "fortnight";
  s.invest = { rate: 0.07, growth: 0, fee: 0, ...(s.invest || {}) };
  s.people.forEach((p, i) => {
    if (!PERSON_COLOURS[p.colour]) p.colour = COLOUR_KEYS[i % COLOUR_KEYS.length];
    if (!["weekly", "fortnightly", "monthly"].includes(p.freq)) p.freq = "fortnightly";
    if (p.payday === undefined) p.payday = "";
    if (s.goals.personal[p.id] === undefined) s.goals.personal[p.id] = [];
  });
  s.accounts.forEach(a => { if (!a.split || typeof a.split !== "object") a.split = {}; if (a.owner === undefined) a.owner = null; if (a.role === undefined) a.role = null; });
  s.goals.joint.forEach(g => { if (!g.split || typeof g.split !== "object") g.split = {}; });
  s.spend.forEach(x => { if (!("due" in x)) x.due = null; if (!("aside" in x)) x.aside = null; });
  return s;
}

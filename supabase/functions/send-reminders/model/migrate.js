// COPY of js/model/ — don't edit here. Change js/model/ and run: node tools/sync-function.mjs
/* Bring any saved budget up to version 4.

   Handles:
   - nothing saved yet ({} or null)       → returns null (the app starts a fresh budget)
   - version 3 and older (Jarden + Madi)  → converted, keeping every number
   - version 4 as stored in the database  → unpacked
   - version 4 from a downloaded backup   → tidied up

   Version 3 stored Jarden's numbers under "j" and Madi's under "m". They become
   people with the ids "j" and "m", so converting twice (say, on two phones at once)
   gives exactly the same result. */

import { VERSION, fromStored, toStored, normalise, personalGoalsName } from "./schema.js";
import { clone } from "./util.js";

export const isEmpty = d => !d || typeof d !== "object" || Object.keys(d).length === 0;

export function migrate(input) {
  if (isEmpty(input)) return null;
  const d = clone(input);
  if (d.people && !Array.isArray(d.people)) return fromStored(d);        // v4, database shape
  if (Array.isArray(d.people)) return fromStored(toStored(d));           // v4, in-memory shape (e.g. a backup file)
  return fromV3(d);
}

/** Version 3 (and the older files version 3 could read) → version 4. */
export function fromV3(s) {
  const income = s.income || {}, paydays = s.paydays || {};
  const people = [
    { id: "j", name: "Jarden", colour: "blue", freq: "fortnightly", pay: income.j ?? null, payday: paydays.j || "", pos: 1 },
    { id: "m", name: "Madi",   colour: "gold", freq: "fortnightly", pay: income.m ?? null, payday: paydays.m || "", pos: 2 },
  ];
  const ROLE_BY_ID = { js: "spending", ef: "emergency", jg: "goals", ji: "invest", jpg: "personalGoals", mpg: "personalGoals" };
  const OWNER_BY_ID = { jpg: "j", mpg: "m" };
  const accounts = (s.accounts || []).map((a, i) => {
    const role = ROLE_BY_ID[a.id] || null;
    let owner = OWNER_BY_ID[a.id] || null;
    if (!owner && a.type === "Personal") owner = /jarden/i.test(a.name || "") ? "j" : /madi/i.test(a.name || "") ? "m" : null;
    const split = {};
    if (a.j !== null && a.j !== undefined) split.j = a.j;
    if (a.m !== null && a.m !== undefined) split.m = a.m;
    return { id: a.id, name: a.name ?? "", type: a.type || "Personal", owner, role, split, pos: i + 1 };
  });
  // Make sure both personal-goals pools exist, even if an old file was missing one.
  [["jpg", "j", "Jarden"], ["mpg", "m", "Madi"]].forEach(([id, pid, nm]) => {
    if (!accounts.some(a => a.role === "personalGoals" && a.owner === pid))
      accounts.push({ id, name: personalGoalsName(nm), type: "Personal", owner: pid, role: "personalGoals", split: {}, pos: accounts.length + 1 });
  });
  const goals = s.goals || {};
  const withPos = L => (L || []).map((x, i) => ({ ...x, pos: i + 1 }));
  const joint = withPos(goals.joint).map(({ j, m, ...g }) => {
    const split = {};
    if (j !== null && j !== undefined) split.j = j;
    if (m !== null && m !== undefined) split.m = m;
    return { ...g, split };
  });
  const out = {
    version: VERSION,
    note: s.note ?? "",
    viewAs: "fortnight",
    people,
    accounts,
    nw: { reviewed: (s.nw && s.nw.reviewed) || "", accounts: withPos(s.nw && s.nw.accounts) },
    spend: withPos(s.spend),
    goals: {
      ef: { id: "ef", name: "Emergency Fund", target: null, saved: null, account: "", deadline: "", ...(goals.ef || {}) },
      joint,
      personal: { j: withPos(goals.jarden), m: withPos(goals.madi) },
    },
    invest: { rate: 0.07, growth: 0, fee: 0, ...(s.invest || {}) },
  };
  return normalise(out);
}

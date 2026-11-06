/* Version history: the maths and the plain-language wording. No page code here.

   The database keeps one entry per change (table budget_changes). Each entry has a list of
   { p: path, o: old value, n: new value }, where "o" is missing if something was added and
   "n" is missing if it was removed. Paths are in the stored (keyed) budget shape, e.g.
   ["spend", "s3", "amount"].

   changesBetween and invert match the database's _jsonb_diff and _invert exactly, so the
   preview here shows what "Restore this version" will really do. */
import { same } from "../sync/ops.js";
import { money, pct, possessive, MONTHS } from "./format.js";
import { parseDate } from "./util.js";

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const copy = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
const has = (c, k) => Object.prototype.hasOwnProperty.call(c, k);

/* ---------- maths ---------- */
/** Every difference between two stored budgets, as [{p, o, n}]. */
export function changesBetween(a, b, path = [], out = []) {
  if (same(a, b)) return out;
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!has(a, k)) out.push({ p: [...path, k], n: copy(b[k]) });
      else if (!has(b, k)) out.push({ p: [...path, k], o: copy(a[k]) });
      else changesBetween(a[k], b[k], [...path, k], out);
    }
    return out;
  }
  out.push({ p: path, o: copy(a), n: copy(b) });
  return out;
}

export function getPath(s, p) {
  let c = s;
  for (const k of p) { if (!isObj(c) || !has(c, k)) return undefined; c = c[k]; }
  return c;
}
function put(s, p, v) {
  let c = s;
  for (let i = 0; i < p.length - 1; i++) { if (!isObj(c[p[i]])) c[p[i]] = {}; c = c[p[i]]; }
  c[p[p.length - 1]] = copy(v);
}
function drop(s, p) {
  let c = s;
  for (let i = 0; i < p.length - 1; i++) { if (!isObj(c)) return; c = c[p[i]]; }
  if (isObj(c)) delete c[p[p.length - 1]];
}

/** The budget as it was before these changes (a new object). */
export function invert(state, changes) {
  const s = isObj(state) ? copy(state) : {};
  for (const c of [...changes].reverse()) { if (has(c, "o")) put(s, c.p, c.o); else drop(s, c.p); }
  return s;
}

/** The budget as it was right after entry `id`: start from now and step back through every later entry. */
export function stateAt(current, entries, id) {
  return [...entries].filter(e => Number(e.id) > Number(id)).sort((a, b) => b.id - a.id)
    .reduce((s, e) => invert(s, e.changes || []), copy(current));
}

/* ---------- wording ---------- */
const PERIOD = { Week: "weekly", Fortnight: "fortnightly", Month: "monthly", Year: "yearly" };
const FREQ = { weekly: "weekly", fortnightly: "fortnightly", monthly: "monthly" };
const VIEW = { week: "per week", fortnight: "per fortnight", month: "per month" };
const blankish = v => v === undefined || v === null || v === "";
const dateText = v => { const d = parseDate(v); return d ? d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : String(v); };
const quote = v => { const t = String(v).replace(/\s+/g, " ").trim(); return `“${t.length > 40 ? t.slice(0, 39) + "…" : t}”`; };
const FMT = {
  money: v => typeof v === "number" ? money(v) : String(v),
  pct: v => typeof v === "number" ? pct(v, Math.abs(v * 100 - Math.round(v * 100)) > 1e-6 ? 1 : 0) : String(v),
  date: dateText,
  month: v => MONTHS[Number(v) - 1] || String(v),
  text: quote,
  plain: v => String(v),
};
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;

/** Paths that are a whole item in a list: adding or removing one is described as one thing. */
function itemAt(p) {
  if (p.length === 2 && ["people", "accounts", "spend"].includes(p[0])) return p.length;
  if (p.length === 3 && p[0] === "nw" && p[1] === "accounts") return 3;
  if (p.length === 3 && p[0] === "goals" && p[1] === "joint") return 3;
  if (p.length === 4 && p[0] === "goals" && p[1] === "personal") return 4;
  return 0;
}

/** Break "set a whole object" changes into one change per box, except for whole items added or removed. */
export function explode(changes) {
  const out = [];
  for (const c of changes) {
    if (!itemAt(c.p) && (isObj(c.o) || isObj(c.n)) && !(c.p.length === 0)) {
      const inner = changesBetween(isObj(c.o) ? c.o : {}, isObj(c.n) ? c.n : {}, c.p);
      if (!isObj(c.o) && has(c, "o") && !blankish(c.o)) inner.unshift({ p: c.p, o: c.o });
      if (!isObj(c.n) && has(c, "n") && !blankish(c.n)) inner.push({ p: c.p, n: c.n });
      out.push(...inner);
    } else out.push(c);
  }
  return out;
}

/** Names of things, looked up in the budget after the change, then before it. */
function namer(before, after) {
  const look = p => { const a = getPath(after, p), b = getPath(before, p); return (isObj(a) && a) || (isObj(b) && b) || {}; };
  const nm = (p, fallback) => { const x = look(p); return (x.name && String(x.name).trim()) || fallback; };
  return {
    item: look,
    person: id => nm(["people", id], "someone"),
    account: id => nm(["accounts", id], "an account"),
    nw: id => nm(["nw", "accounts", id], "an account"),
    spend: id => nm(["spend", id], "a spending category"),
    goal: p => p[1] === "ef" ? "the emergency fund" : nm(p[1] === "joint" ? ["goals", "joint", p[2]] : ["goals", "personal", p[2], p[3]], "a goal"),
  };
}

/** One change in words. Returns { text: "changed Groceries from $400 to $450", short: "Groceries: $400 → $450", order }
    or null for things not worth showing (like the format version number). */
export function describeChange(c, before, after) {
  const N = namer(before, after), p = c.p, [top] = p;
  const removed = !has(c, "n");
  const o = c.o, n = c.n;

  // value change: "changed <subject> from A to B"
  const value = (subject, fmt = "plain", order = 2) => {
    const f = FMT[fmt], ob = blankish(o), nb = blankish(n);
    if (ob && nb) return null;
    const text = ob ? `set ${subject} to ${f(n)}` : nb ? `cleared ${subject} (was ${f(o)})` : `changed ${subject} from ${f(o)} to ${f(n)}`;
    return { text, short: `${cap(subject)}: ${ob ? "blank" : f(o)} → ${nb ? "blank" : f(n)}`, order };
  };
  const rename = (what, fallback) => {
    if (blankish(o)) return value(`the name of ${fallback}`, "text");
    if (blankish(n)) return { text: `cleared the name of ${what} ${quote(o)}`, short: `${cap(what)} ${quote(o)}: name cleared`, order: 2 };
    return { text: `renamed ${what} ${quote(o)} to ${quote(n)}`, short: `${cap(what)} ${quote(o)} → ${quote(n)}`, order: 2 };
  };
  const addRemove = (noun, order = 1) => removed
    ? { text: `removed ${noun}`, short: `${cap(noun)}: removed`, order }
    : { text: `added ${noun}`, short: `${cap(noun)}: added`, order };
  const reorder = list => ({ text: `reordered ${list}`, short: `${cap(list)}: new order`, order: 9 });
  const val = removed ? o : n;
  const nameIn = v => isObj(v) && v.name ? String(v.name).trim() : "";

  if (top === "version") return null;
  if (top === "note") return blankish(o) ? { text: `wrote a budget note: ${quote(n)}`, short: `Budget note: ${quote(n)}`, order: 3 } : value("the budget note", "text", 3);
  if (top === "viewAs") return { text: `switched the budget to show amounts ${VIEW[n] || n}`, short: `Amounts shown ${VIEW[n] || n}`, order: 8 };

  if (top === "people") {
    const id = p[1], who = N.person(id);
    if (p.length === 2) {
      const name = nameIn(val) || "a person";
      return removed ? { text: `removed ${name} from the budget`, short: `${name}: removed`, order: 0 } : { text: `added ${name} to the budget`, short: `${name}: added`, order: 0 };
    }
    const f = p[2];
    if (f === "name") return rename("the person", "a person");
    if (f === "pay") return value(`${possessive(who)} pay`, "money");
    if (f === "freq") return { ...value(`how often ${who} is paid`, "plain"), ...(FREQ[o] && FREQ[n] ? { text: `changed ${who} from being paid ${FREQ[o]} to ${FREQ[n]}`, short: `${possessive(who)} pay: ${FREQ[o]} → ${FREQ[n]}` } : {}) };
    if (f === "payday") return value(`${possessive(who)} payday`, "date");
    if (f === "colour") return { text: `changed ${possessive(who)} colour to ${n}`, short: `${possessive(who)} colour: ${n}`, order: 8 };
    if (f === "pos") return reorder("the people");
  }
  if (top === "accounts") {
    const id = p[1], acc = N.account(id);
    if (p.length === 2) return addRemove(nameIn(val) ? `the account ${quote(nameIn(val))}` : "an account");
    const f = p[2];
    if (f === "name") return rename("the account", "an account");
    if (f === "split") return value(`the share of ${possessive(N.person(p[3]))} pay going to ${acc}`, "pct");
    if (f === "type") return value(`the type of ${acc}`);
    if (f === "owner") { const to = blankish(n) ? "both of you (joint)" : N.person(n); return { text: `changed who ${acc} belongs to: now ${to}`, short: `${cap(acc)} belongs to: ${to}`, order: 2 }; }
    if (f === "pos") return reorder("the accounts in the allocation plan");
  }
  if (top === "nw") {
    if (p[1] === "reviewed") return blankish(n) ? null : { text: `marked the balances as reviewed on ${dateText(n)}`, short: `Balances reviewed: ${dateText(n)}`, order: 5 };
    if (p[1] === "accounts") {
      const id = p[2], acc = N.nw(id);
      if (p.length === 3) return addRemove(nameIn(val) ? `the Net worth account ${quote(nameIn(val))}` : "a Net worth account");
      const f = p[3];
      if (f === "balance") return value(`the ${acc} balance`, "money");
      if (f === "name") return rename("the Net worth account", "a Net worth account");
      if (f === "type") return value(`the type of ${acc}`);
      if (f === "pos") return reorder("the Net worth accounts");
    }
  }
  if (top === "spend") {
    const id = p[1], it = N.spend(id);
    if (p.length === 2) return addRemove(nameIn(val) ? `the spending category ${quote(nameIn(val))}` : "a spending category");
    const f = p[2];
    if (f === "amount") return value(it, "money");
    if (f === "name") return rename("the spending category", "a spending category");
    if (f === "type") return value(`the type of ${it}`);
    if (f === "period") return { ...value(`how often ${it} is billed`), ...(PERIOD[o] && PERIOD[n] ? { text: `changed ${it} from ${PERIOD[o]} to ${PERIOD[n]}`, short: `${cap(it)}: ${PERIOD[o]} → ${PERIOD[n]}` } : {}) };
    if (f === "due") return value(`when ${it} is due`, "month");
    if (f === "aside") return value(`the amount set aside for ${it}`, "money");
    if (f === "notes") return value(`the notes for ${it}`, "text", 3);
    if (f === "icon") return value(`the icon for ${it}`);
    if (f === "pos") return reorder("the spending categories");
  }
  if (top === "goals") {
    const personal = p[1] === "personal", depth = personal ? 4 : p[1] === "joint" ? 3 : 2;
    if (personal && p.length === 3) return null; // a person's whole goal list: comes with adding or removing the person
    const goal = N.goal(p), whose = personal ? `${possessive(N.person(p[2]))} goal` : "the joint goal";
    if (p.length === depth && p[1] !== "ef") return addRemove(nameIn(val) ? `${whose} ${quote(nameIn(val))}` : personal ? `a goal for ${N.person(p[2])}` : "a joint goal");
    const f = p[depth];
    if (f === "target") return value(`the ${goal} target`, "money");
    if (f === "saved") return value(`the amount saved for ${goal}`, "money");
    if (f === "account") return value(`the account for ${goal}`);
    if (f === "deadline") return value(`the ${goal} deadline`, "date");
    if (f === "icon") return value(`the icon for ${goal}`);
    if (f === "name") return rename(personal ? `${possessive(N.person(p[2]))} goal` : "the goal", "a goal");
    if (f === "split") return value(`${possessive(N.person(p[depth + 1]))} share of the joint goals fund for ${goal}`, "pct");
    if (f === "pct") return value(`${goal}’s share of ${possessive(N.person(p[2]))} goals fund`, "pct");
    if (f === "pos") return reorder(personal ? `${possessive(N.person(p[2]))} goals` : "the joint goals");
  }
  if (top === "invest") {
    const f = p[1];
    if (f === "rate") return value("the expected investment return", "pct");
    if (f === "growth") return value("how much investment contributions grow each year", "pct");
    if (f === "fee") return value("the yearly fund fee", "pct");
  }
  const AREA = { people: "Budget", accounts: "Budget", nw: "Net worth", spend: "Spending", goals: "Goals", invest: "Investments" };
  return { text: `changed something on the ${AREA[top] || "Budget"} tab`, short: `Something on the ${AREA[top] || "Budget"} tab`, order: 7 };
}

/** All the changes in an entry, in words: the most important first, with repeats removed. */
export function describeChanges(changes, before, after) {
  const seen = new Set(), out = [];
  explode(changes || []).map(c => describeChange(c, before, after)).filter(Boolean)
    .map((d, i) => ({ ...d, i })).sort((a, b) => a.order - b.order || a.i - b.i)
    .forEach(d => { if (!seen.has(d.text)) { seen.add(d.text); out.push(d); } });
  return out;
}

/* ---------- entries ---------- */
const TIME = (d, tz) => d.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }).replace(/\s/g, "").toLowerCase();
const DAYKEY = (d, tz) => d.toLocaleDateString("en-CA", { timeZone: tz }); // 2026-11-06
export const timeText = (iso, tz) => TIME(new Date(iso), tz);
/** "6 Nov, 2:14pm" (with the year if it isn't this year). */
export function whenText(iso, now = new Date(), tz) {
  const d = new Date(iso), sameYear = DAYKEY(d, tz).slice(0, 4) === DAYKEY(now, tz).slice(0, 4);
  return `${d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: tz })}, ${TIME(d, tz)}`;
}

/** "Today", "Yesterday", or "Thu 5 Nov". */
export function dayLabel(iso, now = new Date(), tz) {
  const k = DAYKEY(new Date(iso), tz), today = DAYKEY(now, tz), yest = DAYKEY(new Date(now.getTime() - 864e5), tz);
  if (k === today) return "Today";
  if (k === yest) return "Yesterday";
  const d = new Date(iso);
  return d.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", ...(k.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }), timeZone: tz }).replace(",", "");
}

const REASONS = [
  [/^upgrade/i, "upgraded the budget to the new format"],
  [/^imported/i, "imported a saved file"],
  [/^converted/i, "converted a save from the old app"],
];

/** Walk back from the current budget through the entries (newest first), describing each one.
    Returns [{ ...entry, who, headline, lines, time, day }], newest first.
    `whoName(id)` turns a user id into "You", "Madi", etc. */
export function describeEntries(current, entries, { whoName = () => "Someone", now = new Date(), tz } = {}) {
  let after = copy(current);
  return [...entries].sort((a, b) => b.id - a.id).map(e => {
    const before = invert(after, e.changes || []);
    const lines = describeChanges(e.changes, before, after);
    const who = whoName(e.changed_by);
    let main;
    if (e.kind === "restore") main = `restored the version from ${whenText(e.ref_at, now, tz)}`;
    else if (e.kind === "undo") main = lines.length === 1 ? `undid a change: ${lines[0].text}` : `undid a change from ${whenText(e.ref_at, now, tz)}`;
    else if (e.kind === "replace") main = (REASONS.find(([re]) => re.test(e.reason || "")) || [null, `replaced the whole budget${e.reason ? ` (${e.reason})` : ""}`])[1];
    else if (!lines.length) main = "made a small change";
    else main = lines[0].text + (lines.length > 1 ? `, and ${lines.length - 1} other ${lines.length === 2 ? "change" : "changes"}` : "");
    after = before;
    return { ...e, who, headline: `${who} ${main}`, lines, time: TIME(new Date(e.changed_at), tz), day: dayLabel(e.changed_at, now, tz) };
  });
}

/** Group described entries by day label, keeping order: [{ day, entries }]. */
export function groupByDay(list) {
  const out = [];
  for (const e of list) { const g = out[out.length - 1]; if (g && g.day === e.day) g.entries.push(e); else out.push({ day: e.day, entries: [e] }); }
  return out;
}

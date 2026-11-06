/* Saving per change.

   Instead of sending the whole budget every time, the app sends a short list of
   "changes" (ops), each one either:
     { op: "set", path: ["accounts", "js", "split", "j"], value: 0.2 }
     { op: "del", path: ["spend", "x1a2b3c"] }
     { op: "replace", value: {...whole budget...}, reason: "upgrade to v4" }   (rare: upgrades and imports)

   The database function apply_budget_ops (supabase/migrations/) applies them to the
   saved budget in one step, so changes from two people at once both survive.
   applyOps below does exactly the same thing in the browser; the tests check they agree. */

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);

/** Same value? (Plain JSON data only.) */
export function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]));
}

/** The smallest list of ops that turns `from` into `to`. Both are budgets in the stored (keyed) shape.
    undefined values are skipped (JSON can't store them). */
export function diff(from, to, path = [], out = []) {
  if (isObj(from) && isObj(to)) {
    for (const k of Object.keys(to)) {
      if (to[k] === undefined) continue;
      if (!(k in from) || from[k] === undefined) out.push({ op: "set", path: [...path, k], value: to[k] });
      else diff(from[k], to[k], [...path, k], out);
    }
    for (const k of Object.keys(from)) if (from[k] !== undefined && (!(k in to) || to[k] === undefined)) out.push({ op: "del", path: [...path, k] });
    return out;
  }
  if (!same(from, to)) {
    if (path.length === 0) out.push({ op: "replace", value: to });
    else out.push({ op: "set", path, value: to });
  }
  return out;
}

const copy = v => v === undefined ? v : JSON.parse(JSON.stringify(v));

/** Apply ops to a stored budget, returning a new object. Matches the SQL function's behaviour:
    "set" creates any missing parent objects; "del" on a missing path does nothing. */
export function applyOps(doc, ops) {
  let s = copy(doc) || {};
  for (const o of ops) {
    if (o.op === "replace") { s = copy(o.value) || {}; continue; }
    if (!Array.isArray(o.path) || !o.path.length) throw new Error("Bad path");
    if (o.op === "set") {
      let cur = s;
      for (let i = 0; i < o.path.length - 1; i++) {
        const k = o.path[i];
        if (!isObj(cur[k])) cur[k] = {};
        cur = cur[k];
      }
      cur[o.path[o.path.length - 1]] = copy(o.value === undefined ? null : o.value);
    } else if (o.op === "del") {
      let cur = s;
      for (let i = 0; i < o.path.length - 1 && isObj(cur); i++) cur = cur[o.path[i]];
      if (isObj(cur)) delete cur[o.path[o.path.length - 1]];
    } else throw new Error("Unknown change type");
  }
  return s;
}

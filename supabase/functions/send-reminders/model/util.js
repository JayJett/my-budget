// COPY of js/model/ — don't edit here. Change js/model/ and run: node tools/sync-function.mjs
/* Small helpers shared by the money maths. Nothing in js/model touches the page,
   so every function here can be tested on its own (see tests/). */

/** A number, or 0 if the value is blank or not a real number. */
export const n = v => (typeof v === "number" && isFinite(v)) ? v : 0;
/** True for values a person hasn't filled in yet. */
export const blank = v => v === null || v === undefined || v === "";
export const clone = o => JSON.parse(JSON.stringify(o));
export const uid = () => "x" + Math.random().toString(36).slice(2, 9);
/** Round to cents, to stop tiny floating-point errors showing up as $0.01. */
export const cents = v => Math.round(v * 100) / 100;
/** True when a set of fractions adds up to 100% (to 0.01%). */
export const is100 = v => Math.round(v * 1e4) === 1e4;

/* ---------- dates (always local dates, never times) ---------- */
export const DAY = 864e5;
export const parseDate = s => { if (!s) return null; const [y, m, d] = String(s).split("-").map(Number); if (!y || !m || !d) return null; return new Date(y, m - 1, d); };
export const addDays = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
export const addMonths = (d, k) => { const x = new Date(d); x.setMonth(x.getMonth() + k); return x; };
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
/** Whole days from a to b, safe across daylight-saving changes. */
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

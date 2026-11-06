// COPY of js/model/ — don't edit here. Change js/model/ and run: node tools/sync-function.mjs
/* Turning numbers into friendly NZ text. No page code here, so the maths can use it in messages too. */

export function money(v, forceWhole) {
  const r = Math.round(v * 100) / 100, whole = forceWhole || Math.abs(r - Math.round(r)) < 0.005;
  return (r < -0.004 ? "−" : "") + "$" + Math.abs(whole ? Math.round(r) : r).toLocaleString("en-NZ", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}
/** Whole dollars. */
export const m0 = v => money(v, true);
export const pct = (v, dp = 0) => (v * 100).toFixed(dp).replace(/\.0+$/, "") + "%";
export const monthYear = d => d.toLocaleDateString("en-NZ", { month: "short", year: "numeric" });
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Jarden", "Jarden and Madi", "Jarden, Madi and Sam" */
export const listNames = names => names.length <= 1 ? (names[0] || "") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
export const possessive = name => name ? (/s$/i.test(name) ? `${name}’` : `${name}’s`) : "Their";

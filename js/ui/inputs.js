/* Building blocks for editable cells. Every input carries data-l (which list), data-i (which row),
   data-f (which field, dots for nested e.g. "split.j") and data-t (text/num/pct/date/month),
   so one input handler (events.js) can save any of them. */
import { blank } from "../model/util.js";
import { esc } from "./dom.js";

export const fmtNum = v => blank(v) ? "" : Number(v).toLocaleString("en-NZ", { maximumFractionDigits: 2 });
export const attrs = (l, i, f, t) => `data-l="${esc(l)}" data-i="${esc(i)}" data-f="${esc(f)}" data-t="${t}"`;
/** CSS classes that give an element a person's colour. */
export const pc = p => p ? `person pc-${p.colour}` : "";

export const tIn = (l, i, f, v, cls = "", ph = "") => `<input class="cell ${cls}" ${attrs(l, i, f, "text")} value="${esc(v)}" placeholder="${esc(ph)}" aria-label="${esc(ph || f)}">`;
export function pIn(l, i, f, v, tone = "", label = "") {
  const val = blank(v) ? "" : +(v * 100).toFixed(4);
  return `<span class="unit ${tone}"><input type="number" step="any" inputmode="decimal" ${attrs(l, i, f, "pct")} value="${val}" aria-label="${esc(label || f)} percent"><i>%</i></span>`;
}
export const $In = (l, i, f, v, tone = "", label = "") => `<span class="unit wide ${tone}"><i>$</i><input type="text" inputmode="decimal" ${attrs(l, i, f, "num")} value="${fmtNum(v)}" aria-label="${esc(label || f)}"></span>`;
/** A dropdown of plain text options. */
export function sIn(l, i, f, v, opts) {
  const o = opts.includes(v) || blank(v) ? opts : [v, ...opts];
  return `<select class="cell" ${attrs(l, i, f, "text")} aria-label="${esc(f)}">${blank(v) ? '<option value=""></option>' : ""}${o.map(x => `<option${x === v ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
}
/** A dropdown of [value, label] pairs. */
export const vIn = (l, i, f, v, pairs, cls = "cell", label = "") =>
  `<select class="${cls}" ${attrs(l, i, f, "text")} aria-label="${esc(label || f)}">${pairs.map(([val, lab]) => `<option value="${esc(val)}"${val === (v ?? "") ? " selected" : ""}>${esc(lab)}</option>`).join("")}</select>`;
export const dIn = (l, i, f, v) => `<input type="date" class="cell" ${attrs(l, i, f, "date")} value="${esc(v || "")}" aria-label="${esc(f)}">`;
export function gAcc(l, g, savings) {
  const opts = savings.map(x => `<option${x === g.account ? " selected" : ""}>${esc(x)}</option>`);
  if (!blank(g.account) && !savings.includes(g.account)) opts.unshift(`<option value="${esc(g.account)}" selected>${esc(g.account)} (not savings)</option>`);
  if (blank(g.account)) opts.unshift('<option value="" selected>Pick an account</option>');
  return `<select class="cell" ${attrs(l, g.id, "account", "text")} aria-label="Account">${opts.join("")}</select>`;
}
/** A placeholder that refresh() fills with a calculated value. */
export const K = (k, cls = "") => `<span data-k="${esc(k)}" data-base="${cls}" class="${cls}"></span>`;
export const del = (l, i) => `<button class="del" type="button" data-del="${esc(l)}" data-i="${esc(i)}" aria-label="Remove row">×</button>`;
export const grip = (l, i) => `<button class="grip" type="button" data-grip="${esc(l)}" data-i="${esc(i)}" aria-label="Drag to reorder, or use the arrow keys"><svg viewBox="0 0 12 18" fill="currentColor"><circle cx="3.5" cy="3.5" r="1.4"/><circle cx="8.5" cy="3.5" r="1.4"/><circle cx="3.5" cy="9" r="1.4"/><circle cx="8.5" cy="9" r="1.4"/><circle cx="3.5" cy="14.5" r="1.4"/><circle cx="8.5" cy="14.5" r="1.4"/></svg></button>`;
export const tipq = t => `<span class="qi" tabindex="0" data-tip="${esc(t)}" aria-label="${esc(t)}">?</span>`;
export const TH = (label, tip, cls = "") => `<th class="${cls}">${tip ? `<span class="tip-t" tabindex="0" data-tip="${esc(tip)}">${label}<span class="qi" aria-hidden="true">?</span></span>` : label}</th>`;
export const attnBox = () => `<div class="attn" id="attn" hidden></div>`;

/* Icons people can pick for a goal or an expense. Purely how an item looks: an icon never changes a
   type, an amount or anything worked out from it. The choice is saved on the item itself in the
   household's budget (field "icon"), so everyone in the household sees the same icon, and only owners
   and editors can change it, like any other part of the budget. A missing or unknown icon falls back
   to the usual one (the goal's first letter, or the expense type's icon).

   One style throughout: 16×16, 1.6 stroke, round caps, drawn in currentColor. */
const P = d => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ITEM_ICONS = [
  { key: "home", label: "Home", svg: P('<path d="M2.5 7.5L8 3l5.5 4.5"/><path d="M4 6.5v6.5h8V6.5"/><path d="M6.8 13v-3.2h2.4V13"/>') },
  { key: "car", label: "Car", svg: P('<path d="M3 10.5V8.3l1.4-3.2a1.3 1.3 0 0 1 1.2-.8h4.8a1.3 1.3 0 0 1 1.2.8L13 8.3v2.2"/><path d="M2.5 8.5h11v3h-11z"/><circle cx="5" cy="11.5" r=".6"/><circle cx="11" cy="11.5" r=".6"/>') },
  { key: "plane", label: "Travel", svg: P('<path d="M6.8 9.2L2.5 7.8l.9-.9 4.6.4 3.3-3.3a1.2 1.2 0 0 1 1.7 1.7L9.7 9l.4 4.6-.9.9-1.4-4.3-2 2v1.3l-.8.8-.6-1.7-1.7-.6.8-.8H4.8z"/>') },
  { key: "sun", label: "Holiday", svg: P('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1"/>') },
  { key: "shield", label: "Safety net", svg: P('<path d="M8 1.8l5 2v4c0 3.1-2.1 5.4-5 6.4-2.9-1-5-3.3-5-6.4v-4z"/><path d="M5.8 8.2l1.6 1.6 3-3.2"/>') },
  { key: "cap", label: "Study", svg: P('<path d="M1.8 6.3L8 3.5l6.2 2.8L8 9.1z"/><path d="M4.5 7.6v3c1 .9 2.2 1.4 3.5 1.4s2.5-.5 3.5-1.4v-3M14.2 6.3v3.5"/>') },
  { key: "ring", label: "Wedding", svg: P('<circle cx="8" cy="9.8" r="3.9"/><path d="M6.3 3.6L8 5.6l1.7-2-.9-1.4H7.2z"/>') },
  { key: "heart", label: "Health", svg: P('<path d="M8 13.3S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.4c0 3.8-5.5 6.9-5.5 6.9z"/><path d="M5.5 8h1.4l.8-1.3L9 9.3l.7-1.3h.8"/>') },
  { key: "laptop", label: "Tech", svg: P('<rect x="3.2" y="3.8" width="9.6" height="6.4" rx="1"/><path d="M1.8 12.4h12.4"/>') },
  { key: "family", label: "Family", svg: P('<circle cx="5.5" cy="5" r="1.8"/><circle cx="11" cy="6" r="1.4"/><path d="M2.5 13v-1.5a3 3 0 0 1 6 0V13M9 13v-1a2 2 0 0 1 4 0v1"/>') },
  { key: "paw", label: "Pets", svg: P('<circle cx="4.3" cy="7" r="1.1"/><circle cx="6.6" cy="4.3" r="1.1"/><circle cx="9.4" cy="4.3" r="1.1"/><circle cx="11.7" cy="7" r="1.1"/><path d="M8 7.8c-1.8 0-3.4 2.4-3.4 3.8 0 1 .8 1.6 1.7 1.6.6 0 1.1-.3 1.7-.3s1.1.3 1.7.3c.9 0 1.7-.6 1.7-1.6 0-1.4-1.6-3.8-3.4-3.8z"/>') },
  { key: "gift", label: "Gifts", svg: P('<rect x="2.5" y="6" width="11" height="3" rx=".6"/><path d="M3.5 9v4.5h9V9M8 6v7.5M8 6C6.6 6 4.8 5.6 4.8 4.3c0-1.6 2.2-1.4 3.2 1.7 1-3.1 3.2-3.3 3.2-1.7C11.2 5.6 9.4 6 8 6z"/>') },
  { key: "wallet", label: "Savings", svg: P('<path d="M2.5 5.2A1.2 1.2 0 0 1 3.7 4h8.6v2"/><rect x="2.5" y="5.5" width="11" height="7.5" rx="1.4"/><path d="M10.5 9.3h3"/>') },
  { key: "basket", label: "Groceries", svg: P('<path d="M2.3 6.5h11.4l-1.2 6.3a1 1 0 0 1-1 .7H4.5a1 1 0 0 1-1-.7z"/><path d="M5.5 6.5L7.2 2.8M10.5 6.5L8.8 2.8M6 9v2.4M10 9v2.4"/>') },
  { key: "bolt", label: "Power", svg: P('<path d="M8.8 1.8L3.8 9h4l-.6 5.2 5-7.2h-4z"/>') },
  { key: "drop", label: "Water", svg: P('<path d="M8 2.2S4 6.5 4 9.4a4 4 0 0 0 8 0C12 6.5 8 2.2 8 2.2z"/>') },
  { key: "wifi", label: "Internet", svg: P('<path d="M2 6.2a8.7 8.7 0 0 1 12 0M4.2 8.6a5.6 5.6 0 0 1 7.6 0M6.4 10.9a2.5 2.5 0 0 1 3.2 0"/><circle cx="8" cy="12.9" r=".5"/>') },
  { key: "phone", label: "Phone", svg: P('<rect x="4.5" y="1.8" width="7" height="12.4" rx="1.6"/><path d="M7 12h2"/>') },
  { key: "repeat", label: "Subscriptions", svg: P('<path d="M3 7.3V6.2a2 2 0 0 1 2-2h8M11 2.2l2 2-2 2M13 8.7v1.1a2 2 0 0 1-2 2H3M5 13.8l-2-2 2-2"/>') },
  { key: "fuel", label: "Fuel & transport", svg: P('<path d="M3.5 13.5V3.3a1 1 0 0 1 1-1H9a1 1 0 0 1 1 1v10.2M2.5 13.5h8.5M5 5.5h3.5"/><path d="M10 6.5h1.2a1 1 0 0 1 1 1v3.6a.9.9 0 0 0 1.8 0V5.4L12.6 4"/>') },
  { key: "ticket", label: "Fun", svg: P('<path d="M2.5 5.2a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1.3a1.5 1.5 0 0 0 0 3v1.3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9.5a1.5 1.5 0 0 0 0-3z"/><path d="M9.8 4.2v7.6" stroke-dasharray="1.2 1.4"/>') },
  { key: "food", label: "Eating out", svg: P('<path d="M4.5 2.2v4a1.5 1.5 0 0 0 3 0v-4M6 2.2v11.6M11.5 13.8V2.2c-1.4.5-2.3 2.2-2.3 4.4 0 1.4.9 2.3 2.3 2.3"/>') },
  { key: "umbrella", label: "Insurance", svg: P('<path d="M2 8.2a6 6 0 0 1 12 0z"/><path d="M8 8.2v4.3a1.4 1.4 0 0 1-2.8 0M8 2.2v.8"/>') },
  { key: "baby", label: "Kids", svg: P('<circle cx="8" cy="7.6" r="4.6"/><path d="M6.2 7.2h.01M9.8 7.2h.01M6.6 9.6c.8.6 2 .6 2.8 0M8 3c-.6-.6-.4-1.4.4-1.4"/>') },
];
const BY_KEY = Object.fromEntries(ITEM_ICONS.map(i => [i.key, i]));
/** The SVG for a saved icon, or null when there isn't one (or it's not one we know). */
export const itemIcon = key => (key && BY_KEY[key] ? BY_KEY[key].svg : null);

/** The icon picker for an item's sheet. l/id: the list and item (for saving); cur: its icon; def: what
    "Default" looks like (the usual icon). Readers can look but not choose. */
export function iconPickerHTML(l, id, cur, def, disabled) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const btn = (k, inner, label) => `<button type="button" role="radio" data-icon-l="${esc(l)}" data-icon-i="${esc(id)}" data-icon="${esc(k)}" aria-checked="${(cur || "") === k || (!BY_KEY[cur] && k === "")}" aria-label="${esc(label)}"${k === "" ? ' class="def"' : ""}${disabled ? " disabled" : ""}>${inner}</button>`;
  const grid = `<div class="ico-pick" role="radiogroup" aria-label="Icon">${btn("", def, "Default icon")}${ITEM_ICONS.map(i => btn(i.key, i.svg, i.label)).join("")}</div>`;
  // Folded away until wanted, so the money comes first; stays open while you try a few.
  return `<details class="ico-box" data-ico-box${pickerOpen.v ? " open" : ""}><summary><span class="bs-label">Icon</span><span class="ico-cur" aria-hidden="true">${itemIcon(cur) || def}</span><span class="ico-ch">${disabled ? "See all" : "Change"}</span></summary>${grid}</details>`;
}
/** Whether the icon list is open in the sheet (so choosing one doesn't fold it away again). */
export const pickerOpen = { v: false };
document.addEventListener("toggle", e => { if (e.target.dataset && "icoBox" in e.target.dataset) pickerOpen.v = e.target.open; }, true);

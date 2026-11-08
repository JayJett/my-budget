/* Icons people can pick for a goal, an expense, an allocation or a net worth account (Phase 8: grouped
   into categories, with a colour too). Purely how an item looks: an icon never changes a
   type, an amount or anything worked out from it. The choice is saved on the item itself in the
   household's budget (field "icon"), so everyone in the household sees the same icon, and only owners
   and editors can change it, like any other part of the budget. A missing or unknown icon falls back
   to the usual one (the goal's first letter, or the expense type's icon).

   One style throughout: 16×16, 1.6 stroke, round caps, drawn in currentColor. */
const P = d => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ITEM_ICONS = [
  { key: "home", cat: "home", label: "Home", svg: P('<path d="M2.5 7.5L8 3l5.5 4.5"/><path d="M4 6.5v6.5h8V6.5"/><path d="M6.8 13v-3.2h2.4V13"/>') },
  { key: "car", cat: "transport", label: "Car", svg: P('<path d="M3 10.5V8.3l1.4-3.2a1.3 1.3 0 0 1 1.2-.8h4.8a1.3 1.3 0 0 1 1.2.8L13 8.3v2.2"/><path d="M2.5 8.5h11v3h-11z"/><circle cx="5" cy="11.5" r=".6"/><circle cx="11" cy="11.5" r=".6"/>') },
  { key: "plane", cat: "travel", label: "Travel", svg: P('<path d="M6.8 9.2L2.5 7.8l.9-.9 4.6.4 3.3-3.3a1.2 1.2 0 0 1 1.7 1.7L9.7 9l.4 4.6-.9.9-1.4-4.3-2 2v1.3l-.8.8-.6-1.7-1.7-.6.8-.8H4.8z"/>') },
  { key: "sun", cat: "travel", label: "Holiday", svg: P('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1"/>') },
  { key: "shield", cat: "savings", label: "Safety net", svg: P('<path d="M8 1.8l5 2v4c0 3.1-2.1 5.4-5 6.4-2.9-1-5-3.3-5-6.4v-4z"/><path d="M5.8 8.2l1.6 1.6 3-3.2"/>') },
  { key: "cap", cat: "education", label: "Study", svg: P('<path d="M1.8 6.3L8 3.5l6.2 2.8L8 9.1z"/><path d="M4.5 7.6v3c1 .9 2.2 1.4 3.5 1.4s2.5-.5 3.5-1.4v-3M14.2 6.3v3.5"/>') },
  { key: "ring", cat: "goals", label: "Wedding", svg: P('<circle cx="8" cy="9.8" r="3.9"/><path d="M6.3 3.6L8 5.6l1.7-2-.9-1.4H7.2z"/>') },
  { key: "heart", cat: "health", label: "Health", svg: P('<path d="M8 13.3S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.4c0 3.8-5.5 6.9-5.5 6.9z"/><path d="M5.5 8h1.4l.8-1.3L9 9.3l.7-1.3h.8"/>') },
  { key: "laptop", cat: "shopping", label: "Tech", svg: P('<rect x="3.2" y="3.8" width="9.6" height="6.4" rx="1"/><path d="M1.8 12.4h12.4"/>') },
  { key: "family", cat: "home", label: "Family", svg: P('<circle cx="5.5" cy="5" r="1.8"/><circle cx="11" cy="6" r="1.4"/><path d="M2.5 13v-1.5a3 3 0 0 1 6 0V13M9 13v-1a2 2 0 0 1 4 0v1"/>') },
  { key: "paw", cat: "home", label: "Pets", svg: P('<circle cx="4.3" cy="7" r="1.1"/><circle cx="6.6" cy="4.3" r="1.1"/><circle cx="9.4" cy="4.3" r="1.1"/><circle cx="11.7" cy="7" r="1.1"/><path d="M8 7.8c-1.8 0-3.4 2.4-3.4 3.8 0 1 .8 1.6 1.7 1.6.6 0 1.1-.3 1.7-.3s1.1.3 1.7.3c.9 0 1.7-.6 1.7-1.6 0-1.4-1.6-3.8-3.4-3.8z"/>') },
  { key: "gift", cat: "goals", label: "Gifts", svg: P('<rect x="2.5" y="6" width="11" height="3" rx=".6"/><path d="M3.5 9v4.5h9V9M8 6v7.5M8 6C6.6 6 4.8 5.6 4.8 4.3c0-1.6 2.2-1.4 3.2 1.7 1-3.1 3.2-3.3 3.2-1.7C11.2 5.6 9.4 6 8 6z"/>') },
  { key: "wallet", cat: "savings", label: "Savings", svg: P('<path d="M2.5 5.2A1.2 1.2 0 0 1 3.7 4h8.6v2"/><rect x="2.5" y="5.5" width="11" height="7.5" rx="1.4"/><path d="M10.5 9.3h3"/>') },
  { key: "basket", cat: "food", label: "Groceries", svg: P('<path d="M2.3 6.5h11.4l-1.2 6.3a1 1 0 0 1-1 .7H4.5a1 1 0 0 1-1-.7z"/><path d="M5.5 6.5L7.2 2.8M10.5 6.5L8.8 2.8M6 9v2.4M10 9v2.4"/>') },
  { key: "bolt", cat: "utilities", label: "Power", svg: P('<path d="M8.8 1.8L3.8 9h4l-.6 5.2 5-7.2h-4z"/>') },
  { key: "drop", cat: "utilities", label: "Water", svg: P('<path d="M8 2.2S4 6.5 4 9.4a4 4 0 0 0 8 0C12 6.5 8 2.2 8 2.2z"/>') },
  { key: "wifi", cat: "utilities", label: "Internet", svg: P('<path d="M2 6.2a8.7 8.7 0 0 1 12 0M4.2 8.6a5.6 5.6 0 0 1 7.6 0M6.4 10.9a2.5 2.5 0 0 1 3.2 0"/><circle cx="8" cy="12.9" r=".5"/>') },
  { key: "phone", cat: "utilities", label: "Phone", svg: P('<rect x="4.5" y="1.8" width="7" height="12.4" rx="1.6"/><path d="M7 12h2"/>') },
  { key: "repeat", cat: "utilities", label: "Subscriptions", svg: P('<path d="M3 7.3V6.2a2 2 0 0 1 2-2h8M11 2.2l2 2-2 2M13 8.7v1.1a2 2 0 0 1-2 2H3M5 13.8l-2-2 2-2"/>') },
  { key: "fuel", cat: "transport", label: "Fuel & transport", svg: P('<path d="M3.5 13.5V3.3a1 1 0 0 1 1-1H9a1 1 0 0 1 1 1v10.2M2.5 13.5h8.5M5 5.5h3.5"/><path d="M10 6.5h1.2a1 1 0 0 1 1 1v3.6a.9.9 0 0 0 1.8 0V5.4L12.6 4"/>') },
  { key: "ticket", cat: "fun", label: "Fun", svg: P('<path d="M2.5 5.2a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1.3a1.5 1.5 0 0 0 0 3v1.3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9.5a1.5 1.5 0 0 0 0-3z"/><path d="M9.8 4.2v7.6" stroke-dasharray="1.2 1.4"/>') },
  { key: "food", cat: "food", label: "Eating out", svg: P('<path d="M4.5 2.2v4a1.5 1.5 0 0 0 3 0v-4M6 2.2v11.6M11.5 13.8V2.2c-1.4.5-2.3 2.2-2.3 4.4 0 1.4.9 2.3 2.3 2.3"/>') },
  { key: "umbrella", cat: "health", label: "Insurance", svg: P('<path d="M2 8.2a6 6 0 0 1 12 0z"/><path d="M8 8.2v4.3a1.4 1.4 0 0 1-2.8 0M8 2.2v.8"/>') },
  { key: "baby", cat: "home", label: "Kids", svg: P('<circle cx="8" cy="7.6" r="4.6"/><path d="M6.2 7.2h.01M9.8 7.2h.01M6.6 9.6c.8.6 2 .6 2.8 0M8 3c-.6-.6-.4-1.4.4-1.4"/>') },
  // Phase 8: more, for allocations and accounts
  { key: "target", cat: "goals", label: "Target", svg: P('<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="3.2"/><circle cx="8" cy="8" r=".8" fill="currentColor"/>') },
  { key: "star", cat: "goals", label: "Star", svg: P('<path d="M8 2.3l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11.1 4.5 13l.8-3.9-2.9-2.7 3.9-.5z"/>') },
  { key: "piggy", cat: "savings", label: "Piggy bank", svg: P('<path d="M3 9.5a5 4 0 0 1 5-4h1.5a4.5 4 0 0 1 3.4 1.6l1.1-.4v2.6l-1 .4a4.5 4 0 0 1-1.5 1.8V13H10v-1h-3v1H5.5v-1.6A4 4 0 0 1 3 9.5z"/><path d="M7 3.5h2.5"/>') },
  { key: "coins", cat: "savings", label: "Coins", svg: P('<ellipse cx="6.5" cy="5" rx="3.8" ry="1.8"/><path d="M2.7 5v2.6c0 1 1.7 1.8 3.8 1.8s3.8-.8 3.8-1.8V5"/><path d="M5.7 10.7v1.2c0 1 1.7 1.8 3.8 1.8s3.8-.8 3.8-1.8V9.3c0-.9-1.4-1.7-3.2-1.8"/>') },
  { key: "bank", cat: "money", label: "Bank", svg: P('<path d="M2.2 6L8 2.6 13.8 6z"/><path d="M3.5 6.5v5M6.5 6.5v5M9.5 6.5v5M12.5 6.5v5M2.2 13.3h11.6"/>') },
  { key: "card", cat: "money", label: "Card", svg: P('<rect x="2" y="4" width="12" height="8.5" rx="1.8"/><path d="M2 7h12M4.5 10h2.5"/>') },
  { key: "receipt", cat: "money", label: "Bills", svg: P('<path d="M3.8 2.2h8.4v11.6l-1.4-1-1.4 1-1.4-1-1.4 1-1.4-1-1.4 1z"/><path d="M6 5.5h4M6 8h4M6 10.3h2.4"/>') },
  { key: "trend", cat: "invest", label: "Growth", svg: P('<path d="M2.5 12l3.5-4 3 2.5 4.5-6"/><path d="M10.5 4.5h3v3"/>') },
  { key: "chart", cat: "invest", label: "Chart", svg: P('<path d="M2.5 13.5h11"/><rect x="3.5" y="8" width="2.2" height="4" rx=".5"/><rect x="6.9" y="5.5" width="2.2" height="6.5" rx=".5"/><rect x="10.3" y="3" width="2.2" height="9" rx=".5"/>') },
  { key: "sprout", cat: "invest", label: "Long term", svg: P('<path d="M8 14V8"/><path d="M8 8c0-2.8 1.8-4.5 4.8-4.5 0 3-1.8 4.5-4.8 4.5zM8 9.5C8 7.4 6.6 6 4 6c0 2.3 1.4 3.5 4 3.5z"/>') },
  { key: "key", cat: "home", label: "Mortgage", svg: P('<circle cx="5.3" cy="10.7" r="2.6"/><path d="M7.2 8.8l5.5-5.5M10.6 5.4l1.5 1.5M11.9 4.1l1.3 1.3"/>') },
  { key: "building", cat: "home", label: "Property", svg: P('<rect x="3.5" y="2.5" width="9" height="11" rx="1"/><path d="M6 5h1M9 5h1M6 7.6h1M9 7.6h1M6 10.2h1M9 10.2h1M7 13.5v-1.8h2v1.8"/>') },
  { key: "book", cat: "education", label: "Books", svg: P('<path d="M2.5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8.5a1.3 1.3 0 0 0-1.3-1.2H2.5zM13.5 3.5h-4A1.5 1.5 0 0 0 8 5v8.5a1.3 1.3 0 0 1 1.3-1.2h4.2z"/>') },
  { key: "music", cat: "fun", label: "Music", svg: P('<path d="M6 12V3.6l7-1.4v8.3"/><circle cx="4.4" cy="12" r="1.6"/><circle cx="11.4" cy="10.5" r="1.6"/>') },
  { key: "game", cat: "fun", label: "Games", svg: P('<path d="M4.3 5h7.4a2.3 2.3 0 0 1 2.2 1.7l.8 3.3a1.6 1.6 0 0 1-2.8 1.4L10.6 10H5.4l-1.3 1.4a1.6 1.6 0 0 1-2.8-1.4l.8-3.3A2.3 2.3 0 0 1 4.3 5z"/><path d="M5 7v2M4 8h2M10.5 7.5h.01M11.5 8.5h.01"/>') },
  { key: "bag", cat: "shopping", label: "Shopping", svg: P('<path d="M3 5.5h10l-.8 8H3.8z"/><path d="M5.8 5.5V4.3a2.2 2.2 0 0 1 4.4 0v1.2"/>') },
  { key: "shirt", cat: "shopping", label: "Clothes", svg: P('<path d="M5.5 2.5L2.5 4.3l1.2 2.4 1.3-.6v7.4h6v-7.4l1.3.6 1.2-2.4-3-1.8a2 2 0 0 1-4 0z"/>') },
  { key: "bus", cat: "transport", label: "Public transport", svg: P('<rect x="3.2" y="2.5" width="9.6" height="9.5" rx="1.6"/><path d="M3.2 8h9.6M5 12v1.5M11 12v1.5"/><circle cx="5.6" cy="10" r=".5"/><circle cx="10.4" cy="10" r=".5"/>') },
  { key: "pill", cat: "health", label: "Medicine", svg: P('<rect x="2.3" y="5.6" width="11.4" height="4.8" rx="2.4" transform="rotate(-40 8 8)"/><path d="M6.2 6.3l3.6 3.4"/>') },
  { key: "tag", cat: "general", label: "Tag", svg: P('<path d="M2.5 2.5h5l6 6-5 5-6-6z"/><circle cx="5.4" cy="5.4" r=".9"/>') },
  { key: "dot", cat: "general", label: "Circle", svg: P('<circle cx="8" cy="8" r="5"/>') },
];
const BY_KEY = Object.fromEntries(ITEM_ICONS.map(i => [i.key, i]));
/** The SVG for a saved icon, or null when there isn't one (or it's not one we know). */
export const itemIcon = key => (key && BY_KEY[key] ? BY_KEY[key].svg : null);

export const ICON_CATS = [
  ["home", "Home"], ["utilities", "Bills & utilities"], ["food", "Food"], ["transport", "Transport"], ["shopping", "Shopping"],
  ["savings", "Savings"], ["goals", "Goals"], ["travel", "Travel"], ["education", "Study"], ["health", "Health"],
  ["fun", "Fun"], ["invest", "Investing"], ["money", "Money"], ["general", "General"],
];

const escA = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** One "Appearance" box for an item's sheet: an icon (grouped by category) and, optionally, a colour.
    l/id: the list and item (for saving); cur: its icon; def: what "Default" looks like; colour: its
    colour key; colours: the palette (js/ui/palette.js OBJECT_COLOURS) or null for no colour choice.
    Readers can look but not choose. Folded away until wanted, so the money comes first. */
export function appearanceHTML({ l, id, icon: cur, def, colour = "", colours = null, defColour = "var(--faint)", disabled = false, label = "Appearance" }) {
  const sel = (k, c) => (c || "") === k || (k === "" && !BY_KEY[c]);
  const btn = (k, inner, lab) => `<button type="button" role="radio" data-icon-l="${escA(l)}" data-icon-i="${escA(id)}" data-icon="${escA(k)}" aria-checked="${sel(k, cur)}" aria-label="${escA(lab)}"${k === "" ? ' class="def"' : ""}${disabled ? " disabled" : ""}>${inner}</button>`;
  const groups = ICON_CATS.map(([c, name]) => { const L = ITEM_ICONS.filter(i => i.cat === c); return L.length ? `<div class="ico-cat"><h5>${escA(name)}</h5><div class="ico-pick" role="group" aria-label="${escA(name)}">${L.map(i => btn(i.key, i.svg, i.label)).join("")}</div></div>` : ""; }).join("");
  const known = colours && colours.some(c => c.key === colour);
  const swatch = (k, lab) => `<button type="button" role="radio" class="oc-sw${k ? "" : " def"}" data-ocl="${escA(l)}" data-oci="${escA(id)}" data-oc-pick="${escA(k)}"${k ? ` data-oc="${escA(k)}"` : ` style="--oc:${defColour}"`} aria-checked="${k ? colour === k : !known}" aria-label="${escA(lab)}"${disabled ? " disabled" : ""}></button>`;
  const colourRow = colours ? `<div class="oc-row"><span class="bs-label">Colour</span><div class="oc-pick" role="radiogroup" aria-label="Colour">${swatch("", "Default colour")}${colours.map(c => swatch(c.key, c.label)).join("")}</div></div>` : "";
  const tile = `<span class="ico-cur"${known ? ` data-oc="${escA(colour)}"` : ` style="--oc:${defColour}"`} aria-hidden="true">${itemIcon(cur) || def}</span>`;
  const reset = !disabled && (BY_KEY[cur] || known) ? `<button type="button" class="linkish ico-reset" data-look-reset-l="${escA(l)}" data-look-reset-i="${escA(id)}">Back to the default look</button>` : "";
  return `<details class="ico-box" data-ico-box${pickerOpen.v ? " open" : ""}><summary><span class="bs-label">${escA(label)}</span>${tile}<span class="ico-ch">${disabled ? "See" : "Change"}</span></summary>
    <div class="ico-body">${colourRow}<div class="ico-grid" role="radiogroup" aria-label="Icon">${btn("", def, "Default icon")}${groups}</div>${reset}
      <p class="ico-note">Just how it looks. It doesn’t change its type or any amounts.</p></div></details>`;
}
/** The older icon-only picker (goals and expenses call this): now the same box, with colours. */
export function iconPickerHTML(l, id, cur, def, disabled, opts = {}) {
  return appearanceHTML({ l, id, icon: cur, def, disabled, ...opts });
}
/** Whether the icon list is open in the sheet (so choosing one doesn't fold it away again). */
export const pickerOpen = { v: false };
document.addEventListener("toggle", e => { if (e.target.dataset && "icoBox" in e.target.dataset) pickerOpen.v = e.target.open; }, true);

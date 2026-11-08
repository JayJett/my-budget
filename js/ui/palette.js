/* Phase 8: colours you can pick, and the maths that keeps them readable. No page code here, so the
   tests can check every colour (tests/palette.test.js).

   Four kinds of colour, kept apart on purpose:
   - your accent (buttons, links, selected things): personal, on your login (ui/accent.js)
   - a household's colour (its avatar, the switcher): shared by the household
   - a person's colour in a household (charts, "whose is this"): model/schema.js PERSON_COLOURS
   - an allocation's, account's or goal's colour (its dot, icon tile and chart slice): on that record
   Status colours (good, warning, over budget, debt) are never pickable, so a red allocation never
   looks like a warning: those keep their own meaning. */

/* ---------- contrast maths (WCAG) ---------- */
const hex2rgb = h => h.replace("#", "").match(/../g).map(x => parseInt(x, 16));
const rgb2hex = c => "#" + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
export const isHex = v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
export function luminance(hex) {
  const c = hex2rgb(hex).map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Mix two colours: t = 0 gives a, 1 gives b. */
export const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
/** Darken (towards black) or lighten (towards white) a colour, a little at a time, until it reaches
    the contrast asked for against every background given. */
export function fit(hex, bgs, min, towards) {
  let c = hex;
  for (let i = 0; i <= 40 && !bgs.every(b => contrast(c, b) >= min); i++) c = mix(hex, towards, i / 40);
  return c;
}

/* ---------- the app's own surfaces (from css/app.css) ---------- */
export const SURFACES = {
  light: { bg: "#F3F4F1", surface: "#FFFFFF", hero: "#2D3C3F" },
  dark: { bg: "#121614", surface: "#1A1F1C", hero: "#243433" },
};

/** Accent tokens for any colour (a custom accent): readable text and buttons in light and dark mode. */
export function accentTokens(hex) {
  const L = SURFACES.light, D = SURFACES.dark;
  // light mode: dark enough for text on the page, on cards and on its own soft fill
  let accent = fit(hex, [L.bg, L.surface], 4.6, "#000000");
  let soft = mix(accent, "#FFFFFF", 0.88);
  accent = fit(accent, [L.bg, L.surface, soft], 4.6, "#000000");
  const hover = mix(accent, "#000000", 0.14);
  // dark mode: light enough on the dark page, cards, its soft fill and the hero cards
  let dAccent = fit(hex, [D.bg, D.surface, D.hero, L.hero], 4.6, "#FFFFFF");
  const dSoft = mix(dAccent, D.surface, 0.84);
  dAccent = fit(dAccent, [D.bg, D.surface, D.hero, L.hero, dSoft], 4.6, "#FFFFFF");
  const dHover = mix(dAccent, "#FFFFFF", 0.18);
  const dOn = fit(mix(dAccent, "#000000", 0.88), [dAccent, dHover], 4.6, "#000000");
  return {
    light: { accent, "accent-hover": hover, "accent-soft": soft, "on-accent": "#FFFFFF" },
    dark: { accent: dAccent, "accent-hover": dHover, "accent-soft": dSoft, "on-accent": dOn },
    hero: { "acc-d": dAccent, "on-acc-d": dOn },
  };
}

/* ---------- colours for households, allocations, accounts and goals ----------
   Each has a light-mode and a dark-mode version, both clear against cards (3:1, the WCAG level for
   shapes and icons). Names are for screen readers and the picker. */
export const OBJECT_COLOURS = [
  { key: "blue", label: "Blue", light: "#2F6DB5", dark: "#8AB7EA" },
  { key: "sky", label: "Sky", light: "#1B7CA6", dark: "#7CC6E6" },
  { key: "teal", label: "Teal", light: "#16807A", dark: "#6FCFC4" },
  { key: "mint", label: "Mint", light: "#2C846B", dark: "#6CC4A6" },
  { key: "green", label: "Green", light: "#4A7D27", dark: "#A3D07A" },
  { key: "amber", label: "Amber", light: "#946500", dark: "#E9B85E" },
  { key: "orange", label: "Orange", light: "#B5590F", dark: "#F2A766" },
  { key: "coral", label: "Coral", light: "#B4502E", dark: "#EC9A7A" },
  { key: "rose", label: "Rose", light: "#AE3D6E", dark: "#E592BC" },
  { key: "purple", label: "Purple", light: "#8247B0", dark: "#C9A6EE" },
  { key: "lavender", label: "Lavender", light: "#5F62C2", dark: "#A9ABF2" },
  { key: "slate", label: "Slate", light: "#4A6574", dark: "#9BB6C4" },
];
export const OBJECT_KEYS = OBJECT_COLOURS.map(c => c.key);
export const isObjectColour = k => OBJECT_KEYS.includes(k);
/** The CSS colour for a saved choice (follows light/dark via the --o-<key> variables). */
export const objVar = k => isObjectColour(k) ? `var(--o-${k})` : null;
/** Two colours that would be hard to tell apart in a chart. */
export function tooClose(a, b) {
  const x = OBJECT_COLOURS.find(c => c.key === a) || {}, y = OBJECT_COLOURS.find(c => c.key === b) || {};
  if (!x.light || !y.light) return false;
  const d = (p, q) => Math.hypot(...hex2rgb(p).map((v, i) => v - hex2rgb(q)[i]));
  return a === b || d(x.light, y.light) < 40;
}

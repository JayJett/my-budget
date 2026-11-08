/* Your look: accent colour, light or dark, and row spacing. Personal settings, never part of the
   household's budget.

   Where they're kept:
   - On your login (Supabase Auth user_metadata: accent, theme, density), the same place your display
     name lives. So they follow you to every device, and nobody else in the household is affected.
   - A copy on this device, filed under your user id ("mb-accent-<id>"), so the app opens in your look
     straight away, even offline. Two people on one device each have their own. A change made offline
     is kept as "not sent yet" and goes to your login when you're back online.
   Signing out goes back to the defaults, so the next person never sees your look.

   Before this, light/dark and spacing were kept per device ("jm-budget-prefs"). The first time you
   sign in without them on your login, the device's choice is used and saved to your login, so nothing
   anyone had already picked is lost. */
import { app, savePrefs } from "./ctx.js";
import { esc } from "./dom.js";
import { ACCENTS, DEFAULT_ACCENT, CUSTOM_ACCENT } from "./accent-list.js";
import { accentTokens, isHex } from "./palette.js";
import { applyUI } from "./render.js";

const KEY = id => `mb-accent-${id}`;
export const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
export const DENSITIES = [["comfortable", "Comfortable"], ["compact", "Compact"]];
/* Phase 8: also your own colour (accentHex, used when accent is "custom"), motion ("auto" follows the
   phone's Reduce Motion setting; "reduce" calms the app whatever the phone says) and touch feedback
   (vibration, only offered on phones that can do it: see ui/feedback.js). */
export const MOTIONS = [["auto", "Auto"], ["reduce", "Reduced"]];
export const FEEDBACKS = [["on", "On"], ["off", "Off"]];
const VALID = {
  accent: k => ACCENTS.some(a => a.key === k) || k === CUSTOM_ACCENT,
  accentHex: isHex,
  theme: k => THEMES.some(t => t[0] === k),
  density: k => DENSITIES.some(t => t[0] === k),
  motion: k => MOTIONS.some(t => t[0] === k),
  feedback: k => FEEDBACKS.some(t => t[0] === k),
};
export const DEFAULT_LOOK = { accent: DEFAULT_ACCENT, accentHex: "", theme: "auto", density: "comfortable", motion: "auto", feedback: "on" };
const DEFAULT = DEFAULT_LOOK;
const FIELDS = Object.keys(DEFAULT);
const read = id => { try { return JSON.parse(localStorage.getItem(KEY(id)) || "null"); } catch (_) { return null; } };
const write = (id, v) => { try { localStorage.setItem(KEY(id), JSON.stringify(v)); } catch (_) {} };
const legacyDevice = () => { try { return JSON.parse(localStorage.getItem("jm-budget-prefs") || "{}") || {}; } catch (_) { return {}; } };
/** Changes made here that haven't reached your login yet. Older copies only had { accent, pending }. */
const dirtyOf = local => local ? (local.dirty || (local.pending && VALID.accent(local.accent) ? { accent: local.accent } : {})) : {};

/** A custom accent's tokens, as a small style sheet (light, dark by the phone's setting, and dark chosen). */
function customCSS(hex) {
  const t = accentTokens(hex), d = o => Object.entries(o).map(([k, v]) => `--${k}:${v};`).join("");
  return `:root[data-accent="custom"]{${d(t.light)}${d(t.hero)}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"])[data-accent="custom"]{${d(t.dark)}}}
:root[data-theme="dark"][data-accent="custom"]{${d(t.dark)}}
.acc-sw[data-accent-pick="custom"]{--sw:${t.light.accent};}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .acc-sw[data-accent-pick="custom"]{--sw:${t.dark.accent};}}
:root[data-theme="dark"] .acc-sw[data-accent-pick="custom"]{--sw:${t.dark.accent};}`;
}
/** Show an accent now (no saving). Only the accent tokens change: never category, member or status colours. */
export function applyAccent(key, hex) {
  const root = document.documentElement;
  if (key === CUSTOM_ACCENT && !isHex(hex)) key = DEFAULT_ACCENT; // a custom choice with no colour: the default
  let st = document.getElementById("accCustom");
  if (key === CUSTOM_ACCENT) {
    if (!st) { st = document.createElement("style"); st.id = "accCustom"; document.head.appendChild(st); }
    st.textContent = customCSS(hex);
  } else if (st) st.remove();
  if (!VALID.accent(key) || key === DEFAULT_ACCENT) delete root.dataset.accent; else root.dataset.accent = key;
}
export const currentAccent = () => document.documentElement.dataset.accent || DEFAULT_ACCENT;
/** Your motion choice on the page: "reduce" calms everything (ui/motion.js reads it too). */
function applyMotion(m) { const root = document.documentElement; if (m === "reduce") root.dataset.motion = "reduce"; else delete root.dataset.motion; }
let shown = { ...DEFAULT };
/** The look showing right now (for previews and the feedback utility). */
export const currentLook = () => ({ ...shown });
function applyLook(look) {
  shown = { ...look };
  applyAccent(look.accent, look.accentHex);
  applyMotion(look.motion);
  app.ui.theme = look.theme; app.ui.density = look.density;
  applyUI();
}

/** The signed-in person's look: a change made on this device that hasn't been sent wins, then the one
    on their login, then this device's copy of it, then (light/dark and spacing only) the old device setting. */
export function lookFor(user) {
  if (!user) return { ...DEFAULT };
  const local = read(user.id) || {}, dirty = dirtyOf(local), remote = user.user_metadata || {}, device = legacyDevice(), out = {};
  FIELDS.forEach(f => {
    out[f] = [dirty[f], remote[f], local[f], f === "accent" ? undefined : device[f]].find(v => VALID[f](v)) ?? DEFAULT[f];
  });
  return out;
}
export const accentFor = user => lookFor(user).accent;

/** Called when someone signs in (or their login details change). Also sends anything chosen offline. */
export function useAccentOf(user) {
  const look = lookFor(user);
  applyLook(look);
  if (!user) return;
  const local = read(user.id) || {}, dirty = { ...dirtyOf(local) }, remote = user.user_metadata || {};
  // carry the old per-device light/dark and spacing over to this login, once
  FIELDS.forEach(f => { if (f !== "accent" && !VALID[f](remote[f]) && look[f] !== DEFAULT[f]) dirty[f] = look[f]; });
  write(user.id, { ...look, dirty });
  if (Object.keys(dirty).length && navigator.onLine !== false) save(user.id);
}

let timer = null;
async function save(uid) {
  if (!app.sb || !app.session || app.session.offline) return;
  const sent = { ...dirtyOf(read(uid)) }; if (!Object.keys(sent).length) return;
  const { error } = await app.sb.auth.updateUser({ data: sent });
  if (error) return; // kept as "not sent yet"; tried again when back online or on next sign-in
  const now = read(uid) || {}, left = { ...dirtyOf(now) };
  Object.keys(sent).forEach(f => { if (left[f] === sent[f]) delete left[f]; }); // anything changed meanwhile stays queued
  write(uid, { ...now, dirty: left, pending: false });
}

/** Change one part of your look: shows straight away, keeps it on this device, and saves it to your login
    a moment later (so trying a few colours in a row sends just one save). */
export function chooseLook(field, value) {
  if (!VALID[field] || !VALID[field](value)) return;
  const root = document.documentElement;
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) { root.classList.add("theme-anim"); clearTimeout(chooseLook._t); chooseLook._t = setTimeout(() => root.classList.remove("theme-anim"), 450); }
  const u = app.session && app.session.user;
  const look = u ? lookFor(u) : { ...shown, theme: app.ui.theme, density: app.ui.density };
  look[field] = value; applyLook(look);
  if (!u) { savePrefs(); return; } // signed out: this device only
  const local = read(u.id) || {};
  write(u.id, { ...local, ...look, dirty: { ...dirtyOf(local), [field]: value } });
  clearTimeout(timer);
  timer = setTimeout(() => save(u.id), 700);
}
export const chooseAccent = key => chooseLook("accent", key);

/** Back to the defaults (signing out, or "Not you?"). */
export function resetAccent() { clearTimeout(timer); applyLook({ ...DEFAULT }); }
/** "Reset to defaults" in Appearance: every personal look setting back to how the app starts, saved. */
export function resetLook() {
  const u = app.session && app.session.user;
  applyLook({ ...DEFAULT });
  if (!u) { savePrefs(); return; }
  const local = read(u.id) || {}, dirty = { ...dirtyOf(local) };
  FIELDS.forEach(f => { dirty[f] = DEFAULT[f]; });
  delete dirty.accentHex; // nothing to clear on the login: an unused custom colour is harmless
  write(u.id, { ...DEFAULT, dirty });
  clearTimeout(timer); timer = setTimeout(() => save(u.id), 300);
}

/** The colour picker: a small preview of each accent (a button and a progress bar), its name, and a tick. */
const TICK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
export function accentPickerHTML({ custom = true } = {}) {
  const cur = currentAccent(), hex = shown.accentHex;
  const tile = (key, label) => `<button type="button" class="acc-sw" role="radio" data-accent-pick="${key}" aria-checked="${key === cur}" aria-label="${esc(label)}">
    <span class="acc-prev" aria-hidden="true"><span class="acc-pill"></span><span class="acc-bar"><i></i></span></span>
    <span class="acc-name"><span class="acc-dot" aria-hidden="true">${TICK}</span>${esc(label)}</span></button>`;
  return `<div class="acc-picker" role="radiogroup" aria-label="Accent colour">${ACCENTS.map(a => tile(a.key, a.label)).join("")}${custom && isHex(hex) ? tile(CUSTOM_ACCENT, "Yours") : ""}</div>
    ${custom ? `<label class="acc-custom"><span class="acc-custom-sw" aria-hidden="true" style="--sw:${isHex(hex) ? hex : "conic-gradient(#e66,#eb4,#6c6,#4bd,#86e,#e66)"}"></span><span>Choose your own colour<small>We’ll adjust it so text stays easy to read</small></span><input type="color" data-accent-custom value="${isHex(hex) ? hex : "#2E7553"}" aria-label="Choose your own accent colour"></label>` : ""}`;
}
/** Small swatches only (setup step 1): the curated colours, nothing else. */
export const accentSwatchesHTML = () => { const cur = currentAccent(); return `<div class="acc-mini" role="radiogroup" aria-label="Accent colour">${ACCENTS.map(a => `<button type="button" class="acc-mini-sw" role="radio" data-accent-pick="${a.key}" aria-checked="${a.key === cur}" aria-label="${esc(a.label)}">${TICK}</button>`).join("")}</div>`; };
/** A two- or three-way choice (light/dark, spacing) as a segmented control. */
export const lookSeg = (field, opts, label) => `<div class="seg seg-look" role="radiogroup" aria-label="${esc(label)}">${opts.map(([v, l]) => `<button type="button" role="radio" data-look="${field}" data-v="${v}" aria-checked="${app.ui[field] === v}">${esc(l)}</button>`).join("")}</div>`;

export function initAccent() {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-accent-pick]");
    if (b) {
      chooseAccent(b.dataset.accentPick);
      const g = b.closest(".acc-picker, .acc-mini");
      if (g) g.querySelectorAll("[data-accent-pick]").forEach(x => x.setAttribute("aria-checked", String(x === b)));
      return;
    }
    const l = e.target.closest("[data-look]");
    if (l) { chooseLook(l.dataset.look, l.dataset.v); l.parentElement.querySelectorAll("[data-look]").forEach(x => x.setAttribute("aria-checked", String(x === l))); }
  });
  // Arrow keys move between choices, like other radio groups
  document.addEventListener("keydown", e => {
    const b = e.target.closest && e.target.closest("[data-accent-pick], [data-look]"); if (!b || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const all = [...b.parentElement.querySelectorAll("[data-accent-pick], [data-look]")], i = all.indexOf(b), d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const n = all[(i + d + all.length) % all.length]; e.preventDefault(); n.focus(); n.click();
  });
  // your own colour: shows as you drag, saved when you let go
  document.addEventListener("input", e => {
    if (!e.target.matches || !e.target.matches("[data-accent-custom]")) return;
    applyAccent(CUSTOM_ACCENT, e.target.value);
    const sw = e.target.parentElement.querySelector(".acc-custom-sw"); if (sw) sw.style.setProperty("--sw", e.target.value);
  });
  document.addEventListener("change", e => {
    if (!e.target.matches || !e.target.matches("[data-accent-custom]")) return;
    chooseLook("accentHex", e.target.value.toUpperCase()); chooseLook("accent", CUSTOM_ACCENT);
    const g = document.querySelector(".acc-picker");
    if (g && !g.querySelector('[data-accent-pick="custom"]')) { const tmp = document.createElement("div"); tmp.innerHTML = accentPickerHTML(); g.replaceWith(tmp.firstElementChild); }
    document.querySelectorAll("[data-accent-pick]").forEach(x => x.setAttribute("aria-checked", String(x.dataset.accentPick === CUSTOM_ACCENT)));
  });
  window.addEventListener("online", () => { const u = app.session && app.session.user; if (u && Object.keys(dirtyOf(read(u.id))).length) save(u.id); });
}

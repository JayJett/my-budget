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
import { ACCENTS, DEFAULT_ACCENT } from "./accent-list.js";
import { applyUI } from "./render.js";

const KEY = id => `mb-accent-${id}`;
export const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
export const DENSITIES = [["comfortable", "Comfortable"], ["compact", "Compact"]];
const VALID = {
  accent: k => ACCENTS.some(a => a.key === k),
  theme: k => THEMES.some(t => t[0] === k),
  density: k => DENSITIES.some(t => t[0] === k),
};
const DEFAULT = { accent: DEFAULT_ACCENT, theme: "auto", density: "comfortable" };
const FIELDS = Object.keys(DEFAULT);
const read = id => { try { return JSON.parse(localStorage.getItem(KEY(id)) || "null"); } catch (_) { return null; } };
const write = (id, v) => { try { localStorage.setItem(KEY(id), JSON.stringify(v)); } catch (_) {} };
const legacyDevice = () => { try { return JSON.parse(localStorage.getItem("jm-budget-prefs") || "{}") || {}; } catch (_) { return {}; } };
/** Changes made here that haven't reached your login yet. Older copies only had { accent, pending }. */
const dirtyOf = local => local ? (local.dirty || (local.pending && VALID.accent(local.accent) ? { accent: local.accent } : {})) : {};

/** Show an accent now (no saving). Only the accent tokens change: never category, member or status colours. */
export function applyAccent(key) {
  const root = document.documentElement;
  if (!VALID.accent(key) || key === DEFAULT_ACCENT) delete root.dataset.accent; else root.dataset.accent = key;
}
export const currentAccent = () => document.documentElement.dataset.accent || DEFAULT_ACCENT;
function applyLook(look) {
  applyAccent(look.accent);
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
  const look = u ? lookFor(u) : { accent: currentAccent(), theme: app.ui.theme, density: app.ui.density };
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

/** The colour picker: a small preview of each accent (a button and a progress bar), its name, and a tick. */
export function accentPickerHTML() {
  const cur = currentAccent();
  return `<div class="acc-picker" role="radiogroup" aria-label="Accent colour">${ACCENTS.map(a => `<button type="button" class="acc-sw" role="radio" data-accent-pick="${a.key}" aria-checked="${a.key === cur}" aria-label="${esc(a.label)}">
    <span class="acc-prev" aria-hidden="true"><span class="acc-pill"></span><span class="acc-bar"><i></i></span></span>
    <span class="acc-name"><span class="acc-dot" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg></span>${esc(a.label)}</span></button>`).join("")}</div>`;
}
/** A two- or three-way choice (light/dark, spacing) as a segmented control. */
export const lookSeg = (field, opts, label) => `<div class="seg seg-look" role="radiogroup" aria-label="${esc(label)}">${opts.map(([v, l]) => `<button type="button" role="radio" data-look="${field}" data-v="${v}" aria-checked="${app.ui[field] === v}">${esc(l)}</button>`).join("")}</div>`;

export function initAccent() {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-accent-pick]");
    if (b) {
      chooseAccent(b.dataset.accentPick);
      const g = b.closest(".acc-picker");
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
  window.addEventListener("online", () => { const u = app.session && app.session.user; if (u && Object.keys(dirtyOf(read(u.id))).length) save(u.id); });
}

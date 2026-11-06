/* Your accent colour: a personal setting, not part of the household's budget.

   Where it's kept:
   - On your login (Supabase Auth user_metadata.accent), the same place your display name lives.
     So it follows you to every device, and nobody else in the household is affected.
   - A copy on this device, filed under your user id ("mb-accent-<id>"), so the app opens in your colour
     straight away, even offline. Two people on one device each have their own.
   Signing out goes back to the default, so the next person never sees your colour. */
import { app } from "./ctx.js";
import { $, esc } from "./dom.js";
import { ACCENTS, DEFAULT_ACCENT } from "./accent-list.js";

const KEY = id => `mb-accent-${id}`;
const valid = k => ACCENTS.some(a => a.key === k);
const read = id => { try { return JSON.parse(localStorage.getItem(KEY(id)) || "null"); } catch (_) { return null; } };
const write = (id, v) => { try { localStorage.setItem(KEY(id), JSON.stringify(v)); } catch (_) {} };

/** Show an accent now (no saving). */
export function applyAccent(key) {
  const root = document.documentElement;
  if (!valid(key) || key === DEFAULT_ACCENT) delete root.dataset.accent; else root.dataset.accent = key;
}
export const currentAccent = () => document.documentElement.dataset.accent || DEFAULT_ACCENT;

/** The signed-in person's accent: a change made on this device that hasn't reached the server yet wins,
    then the one on their login, then this device's copy. */
export function accentFor(user) {
  if (!user) return DEFAULT_ACCENT;
  const local = read(user.id), remote = user.user_metadata && user.user_metadata.accent;
  if (local && local.pending && valid(local.accent)) return local.accent;
  if (valid(remote)) return remote;
  return local && valid(local.accent) ? local.accent : DEFAULT_ACCENT;
}

/** Called when someone signs in (or their login details change). Also sends a choice made offline. */
export function useAccentOf(user) {
  const key = accentFor(user);
  applyAccent(key);
  if (!user) return;
  const local = read(user.id);
  write(user.id, { accent: key, pending: !!(local && local.pending) });
  if (local && local.pending && navigator.onLine !== false) save(user.id, key);
}

let timer = null;
async function save(uid, key) {
  if (!app.sb || !app.session || app.session.offline) return;
  const { error } = await app.sb.auth.updateUser({ data: { accent: key } });
  if (!error && read(uid) && read(uid).accent === key) write(uid, { accent: key, pending: false });
}

/** Choose an accent: shows straight away, keeps it on this device, and saves it to your login
    a moment later (so trying a few colours in a row sends just one save). */
export function chooseAccent(key) {
  if (!valid(key)) return;
  applyAccent(key);
  const u = app.session && app.session.user; if (!u) return;
  write(u.id, { accent: key, pending: true });
  clearTimeout(timer);
  timer = setTimeout(() => save(u.id, key), 700);
}

/** Back to the default (signing out, or "Not you?"). */
export function resetAccent() { clearTimeout(timer); applyAccent(DEFAULT_ACCENT); }

/** The picker, for Account settings. */
export function accentPickerHTML() {
  const cur = currentAccent();
  return `<div class="acc-picker" role="radiogroup" aria-label="Accent colour">${ACCENTS.map(a => `<button type="button" class="acc-sw" role="radio" data-accent-pick="${a.key}" aria-checked="${a.key === cur}">
    <span class="acc-dot" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg></span><span class="acc-name">${esc(a.label)}</span></button>`).join("")}</div>`;
}

export function initAccent() {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-accent-pick]"); if (!b) return;
    chooseAccent(b.dataset.accentPick);
    const g = b.closest(".acc-picker");
    if (g) g.querySelectorAll("[data-accent-pick]").forEach(x => x.setAttribute("aria-checked", String(x === b)));
  });
  // Arrow keys move between colours, like other radio groups
  document.addEventListener("keydown", e => {
    const b = e.target.closest && e.target.closest("[data-accent-pick]"); if (!b || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const all = [...b.parentElement.querySelectorAll("[data-accent-pick]")], i = all.indexOf(b), d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const n = all[(i + d + all.length) % all.length]; e.preventDefault(); n.focus(); n.click();
  });
  window.addEventListener("online", () => { const u = app.session && app.session.user; if (u && read(u.id) && read(u.id).pending) save(u.id, read(u.id).accent); });
}

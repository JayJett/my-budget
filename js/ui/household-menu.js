/* The household menu (Phase 9A): tap the household's picture or name in the header for a small
   dropdown, right under it. It lists the household you're in and your other households (tap one to
   switch), Household settings, and Create a household.

   - Your own avatar on the far left still opens YOUR menu (the drawer). Two people-things, two places.
   - Switching uses the app's one way of switching (app.switchHousehold), which shows a loading screen
     until the new household is loaded, so nothing from the old one can show in the new one.
   - Creating a household reuses the existing form and database function (create_household).
   - It's a small popover, not a sheet: the page isn't locked, and it closes when you tap outside,
     press Escape, or choose something. Arrow keys move between its items. */
import { app } from "./ctx.js";
import { $, esc } from "./dom.js";
import { hhAvatarHTML } from "./household-look.js";
import { openHouseholdSettings, openCreateHousehold } from "./settings.js";
import { calm } from "./motion.js";

const ROLE = { owner: "Owner", editor: "Editor", viewer: "View only" };
const I = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const GEAR = I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>');
const PLUS = I('<path d="M12 5v14M5 12h14"/>');
const TICK = '<svg class="hp-tick" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';

let pop = null, trigger = null, openedAt = 0;
export const householdMenuOpen = () => !!pop;

function menuHTML() {
  const cur = app.household, all = app.households || [];
  const others = all.filter(h => !cur || h.id !== cur.id);
  const row = (h, on) => `<button class="hp-hh" type="button" role="menuitemradio" aria-checked="${on}" data-switch="${esc(h.id)}">${hhAvatarHTML(on ? { ...h, look: cur.look } : h, "sm")}<span class="hp-t"><b>${esc(h.name)}</b><small>${on ? "Open now" : esc(ROLE[h.role] || "")}</small></span>${on ? TICK : ""}</button>`;
  const me = cur && all.find(h => h.id === cur.id);
  return `<div class="hp-sec" role="group" aria-label="Your households">${me ? row({ ...me, name: cur.name }, true) : ""}${others.length ? `<div class="hp-sub">Switch to</div>${others.map(h => row(h, false)).join("")}` : ""}</div>
    <div class="hp-sec hp-acts" role="group" aria-label="Household actions">
      <button class="hp-act" type="button" role="menuitem" data-hp="settings">${GEAR}<span>Household settings</span></button>
      <button class="hp-act" type="button" role="menuitem" data-hp="create">${PLUS}<span>Create a household</span></button></div>`;
}

function place() {
  if (!pop || !trigger) return;
  const r = trigger.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const w = Math.min(320, vw - 16), left = Math.max(8, Math.min(r.left - 6, vw - w - 8));
  pop.style.width = w + "px"; pop.style.left = left + "px"; pop.style.top = Math.round(r.bottom + 8) + "px";
  pop.style.maxHeight = `calc(100dvh - ${Math.round(r.bottom + 24)}px - env(safe-area-inset-bottom))`;
  pop.style.setProperty("--hp-arrow", Math.max(16, Math.min(w - 16, r.left + 18 - left)) + "px");
}

export function openHouseholdMenu(btn) {
  if (pop) { closeHouseholdMenu(); return; }
  trigger = btn;
  pop = document.createElement("div");
  pop.className = "hh-pop"; pop.id = "hhPop"; pop.setAttribute("role", "menu"); pop.setAttribute("aria-label", "Households");
  pop.innerHTML = menuHTML();
  document.body.appendChild(pop);
  place();
  btn.setAttribute("aria-expanded", "true");
  if (!calm()) { pop.classList.add("in"); requestAnimationFrame(() => requestAnimationFrame(() => pop && pop.classList.remove("in"))); }
  const first = pop.querySelector('[aria-checked="true"]') || pop.querySelector("button");
  if (first) first.focus({ preventScroll: true });
  pop.addEventListener("click", onPick);
  pop.addEventListener("keydown", onKey);
  // listen for outside taps straight away; the tap that opened the menu came before this moment
  openedAt = performance.now(); document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", closeHouseholdMenu, { once: true });
}
export function closeHouseholdMenu({ focus = false } = {}) {
  if (!pop) return;
  document.removeEventListener("pointerdown", outside, true);
  const p = pop; pop = null;
  if (trigger) { trigger.setAttribute("aria-expanded", "false"); if (focus && trigger.isConnected) trigger.focus({ preventScroll: true }); }
  if (calm()) p.remove(); else { p.classList.add("out"); setTimeout(() => p.remove(), 140); }
}
function outside(e) { if (e.timeStamp && e.timeStamp < openedAt) return; if (pop && !pop.contains(e.target) && !(trigger && trigger.contains(e.target))) closeHouseholdMenu(); }
function onKey(e) {
  if (e.key === "Escape") { e.preventDefault(); closeHouseholdMenu({ focus: true }); return; }
  if (e.key === "Tab") { closeHouseholdMenu(); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const items = [...pop.querySelectorAll("button")], i = items.indexOf(document.activeElement);
  const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[n].focus();
}
function onPick(e) {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.switch) {
    const id = b.dataset.switch;
    closeHouseholdMenu({ focus: id === (app.household && app.household.id) });
    // only households you're in are listed (from your memberships), and the switch checks again
    if (app.household && id !== app.household.id && (app.households || []).some(h => h.id === id)) app.switchHousehold(id);
    return;
  }
  closeHouseholdMenu();
  if (b.dataset.hp === "settings") openHouseholdSettings();
  if (b.dataset.hp === "create") openCreateHousehold();
}

export function initHouseholdMenu() {
  document.addEventListener("click", e => {
    const t = e.target.closest("#hhBtn"); if (!t) return;
    openHouseholdMenu(t);
  });
}

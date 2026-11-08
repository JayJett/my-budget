/* The account menu (Phase 7D.2): a drawer from the left, opened from your avatar in the header.
   Your profile at the top (tap for My profile), then short labelled rows with icons, households to
   switch between when you're in more than one, "Data & backups" and "Guided tours" as small sub-lists,
   and Sign out at the bottom. Every action is the same one the old ⋯ menu ran. */
import { app, readOnly } from "./ctx.js";
import { $, esc, toast } from "./dom.js";
import { openDrawer, setDrawerContent, closeDrawer } from "./drawer.js";
import { toursMenu } from "./tour.js";
import { exportCSV, exportJSON } from "./exports.js";
import { openAccount, openHouseholdSettings, openAppearance, openProfile } from "./settings.js";
import { openHistory } from "./history.js";
import { openReminderSettings } from "./reminders.js";
import { avatarHTML, myName } from "./profile.js";

const ROLE = { owner: "Owner", editor: "Editor", viewer: "View only" };
/** One icon family: 24px grid, 1.8 stroke, round caps (like the tab bar's). */
const I = d => `<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const MENU_ICONS = {
  household: I('<path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9v10.5h13V9"/><path d="M10 19.5v-5h4v5"/>'),
  reminders: I('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  history: I('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V8h3.5"/><path d="M12 8v4.5l3 2"/>'),
  appearance: I('<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.6-2.1-.5-1.2.3-2.4 1.6-2.4H17a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9z"/><circle cx="7.8" cy="11.5" r="1.1"/><circle cx="10.5" cy="7.6" r="1.1"/><circle cx="15" cy="8" r="1.1"/>'),
  account: I('<circle cx="10" cy="8" r="3.5"/><path d="M3.5 19.5a6.5 6.5 0 0 1 10.5-5.1"/><circle cx="17.5" cy="17" r="2.2"/><path d="M17.5 13.3v1.5M17.5 19.2v1.5M14.3 15.1l1.3.8M19.4 18.1l1.3.8M14.3 18.9l1.3-.8M19.4 15.9l1.3-.8"/>'),
  tours: I('<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  data: I('<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/>'),
  signout: I('<path d="M14 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H14"/><path d="M10.5 12H20"/><path d="M16.5 8.5 20 12l-3.5 3.5"/>'),
  csv: I('<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8 8.5h8M8 12h8M8 15.5h5"/>'),
  backup: I('<path d="M12 4v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M4.5 18.5h15"/>'),
  import: I('<path d="M12 15.5v-11"/><path d="M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 18.5h15"/>'),
  back: I('<path d="M14.5 6 8.5 12l6 6"/>'),
  chev: '<svg class="mi-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
};
const row = (act, icon, label, extra = "") => `<button class="dr-row" type="button" data-act="${act}"${extra}>${MENU_ICONS[icon]}<span>${esc(label)}</span>${MENU_ICONS.chev}</button>`;
const close = `<button class="dr-x" type="button" data-dr-close aria-label="Close menu"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>`;
const subHead = title => `<div class="dr-sub-h"><button class="dr-back-btn" type="button" data-act="menu-back" aria-label="Back to the menu">${MENU_ICONS.back}</button><h2>${esc(title)}</h2>${close}</div>`;

export function mainMenu() {
  const s = app.session, hhs = app.households || [];
  const name = myName() || (s && s.user.email) || "You";
  const profile = s ? `<button class="dr-me" type="button" data-act="profile" aria-label="My profile: ${esc(name)}">${avatarHTML("lg")}<span class="dr-me-t"><b>${esc(name)}</b><small>View my profile</small></span>${MENU_ICONS.chev}</button>` : "";
  const switcher = hhs.length > 1 ? `<div class="dr-sec"><h3 class="dr-h">Households</h3>${hhs.map(h => {
      const on = app.household && h.id === app.household.id;
      return `<button class="dr-hh" type="button" data-switch="${esc(h.id)}" aria-current="${on}"><span class="dr-hh-n">${esc(h.name)}</span><small>${on ? "Open now" : ROLE[h.role] || ""}</small></button>`;
    }).join("")}</div>` : "";
  return `<div class="dr-top">${profile}${close}</div>${switcher}
    <nav class="dr-sec" aria-label="Menu">
      ${row("household", "household", "Household")}
      ${row("reminders", "reminders", "Reminders")}
      ${row("history", "history", "History")}
      ${row("appearance", "appearance", "Appearance")}
      ${row("tours", "tours", "Guided tours")}
    </nav>
    <div class="dr-sec">${row("data", "data", "Data & backups")}</div>
    ${s ? `<div class="dr-foot"><button class="dr-row dr-out" type="button" data-act="signout">${MENU_ICONS.signout}<span>Sign out</span></button></div>` : ""}`;
}

/** Data & backups: the same three actions as before, each with a few words, since they're less obvious. */
function dataMenu() {
  return `${subHead("Data & backups")}<div class="dr-sec">
    <button class="dr-row tall" type="button" data-act="csv">${MENU_ICONS.csv}<span>Export to CSV<small>Opens in Excel or Google Sheets</small></span></button>
    <button class="dr-row tall" type="button" data-act="backup">${MENU_ICONS.backup}<span>Download a backup<small>A copy of this budget, just in case</small></span></button>
    <button class="dr-row tall" type="button" data-act="import"${readOnly() ? " disabled" : ""}>${MENU_ICONS.import}<span>Import a saved file<small>${readOnly() ? "Owners and editors only" : "From a backup or an earlier version"}</small></span></button></div>`;
}
/** Guided tours: the list from tour.js, under the same sub-list heading. */
const toursView = () => `${subHead("Guided tours")}<div class="dr-sec dr-tours">${toursMenu().replace(/<div class="pop-h">[^<]*<\/div>/, "").replace(/<hr>[\s\S]*$/, "")}</div>`;

export function openMenu(trigger) {
  openDrawer({ html: mainMenu(), label: "Account menu", from: "left", trigger, onAction: menuAct, className: "dr-menu" });
}

export function menuAct(b) {
  const act = b.dataset.act;
  // sub-lists open inside the drawer itself
  if (act === "tours") { setDrawerContent(toursView()); return; }
  if (act === "data") { setDrawerContent(dataMenu()); return; }
  if (act === "menu-back") { setDrawerContent(mainMenu()); return; }
  if (!act && !b.dataset.tourReplay && !b.dataset.switch) return;
  closeDrawer({ focus: !["household", "history", "appearance", "account", "reminders", "profile", "import"].includes(act) });
  if (b.dataset.tourReplay) { if (app.setup) { toast("Finish setting up first, then take a tour."); return; } app.startTour(b.dataset.tourReplay); return; }
  if (b.dataset.switch) { if (app.household && b.dataset.switch === app.household.id) return; app.switchHousehold(b.dataset.switch); return; }
  if (act === "csv") exportCSV();
  if (act === "import") { if (readOnly()) { toast("You have view-only access, so you can’t import."); return; } $("#importFile").click(); }
  if (act === "backup") exportJSON();
  if (act === "history") openHistory();
  if (act === "reminders") openReminderSettings();
  if (act === "household") openHouseholdSettings();
  if (act === "account") openAccount(); // (older links: account settings are part of My profile now)
  if (act === "appearance") openAppearance();
  if (act === "profile") openProfile();
  if (act === "signout") app.signOut();
}

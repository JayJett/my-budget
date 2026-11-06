/* The "⋯" menu: households (switch between them), settings, appearance, export and import. */
import { app, readOnly, savePrefs } from "./ctx.js";
import { $, esc, openPop, closePop, toast } from "./dom.js";
import { applyUI } from "./render.js";
import { exportCSV, exportJSON } from "./exports.js";
import { openAccount, openHouseholdSettings } from "./settings.js";
import { openHistory } from "./history.js";
import { openInbox } from "./reminders.js";

const ROLE = { owner: "Owner", editor: "Editor", viewer: "View only" };

export function mainMenu() {
  const seg = (grp, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-${grp}="${v}" aria-pressed="${v === cur}">${l}</button>`).join("")}</div>`;
  const s = app.session, me = app.members.find(m => m.user_id === app.meId);
  const hhs = app.households || [];
  const switcher = hhs.length > 1 ? `<div class="pop-h">Households</div>${hhs.map(h => `<button class="item hh-item" type="button" data-switch="${esc(h.id)}" aria-current="${app.household && h.id === app.household.id}">${esc(h.name)}<small>${ROLE[h.role] || ""}${app.household && h.id === app.household.id ? " · open now" : ""}</small></button>`).join("")}<hr>` : "";
  return `${s ? `<div class="who-me">Signed in as<b>${esc((me && me.display_name) || (s.user.user_metadata && s.user.user_metadata.name) || s.user.email)}</b>${esc(s.user.email)}</div><hr>${switcher}
    <button class="item" type="button" data-act="reminders">Reminders<small>Gentle nudges, all optional. Choose yours.</small></button>
    <button class="item" type="button" data-act="history">History<small>Who changed what, and when. Undo or go back.</small></button>
    <button class="item" type="button" data-act="household">Household settings<small>${esc(app.household ? app.household.name : "")}: people, roles, invites</small></button>
    <button class="item" type="button" data-act="account">Account settings<small>Your colour, name, email, password</small></button>
    <button class="item" type="button" data-act="tour">Take the tour<small>A one-minute look around</small></button><hr>` : ""}
    <div class="pop-h">Appearance</div>${seg("theme", [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]], app.ui.theme)}
    <div class="pop-h">Row spacing</div>${seg("density", [["comfortable", "Comfortable"], ["compact", "Compact"]], app.ui.density)}
    <hr><button class="item" type="button" data-act="csv">Export to CSV<small>Opens in Excel or Google Sheets</small></button>
    <button class="item" type="button" data-act="backup">Download a backup<small>A .json copy of this budget, just in case</small></button>
    <button class="item" type="button" data-act="import"${readOnly() ? " disabled" : ""}>Import a saved file<small>From a backup or an earlier version</small></button>
    ${s ? `<hr><button class="item" type="button" data-act="signout">Sign out</button>` : ""}`;
}

export function menuAct(b) {
  if (b.dataset.theme) { app.ui.theme = b.dataset.theme; applyUI(); savePrefs(); openPop($("#menuBtn"), mainMenu(), menuAct); return; }
  if (b.dataset.density) { app.ui.density = b.dataset.density; applyUI(); savePrefs(); openPop($("#menuBtn"), mainMenu(), menuAct); return; }
  closePop();
  if (b.dataset.switch) { app.switchHousehold(b.dataset.switch); return; }
  const act = b.dataset.act;
  if (act === "csv") exportCSV();
  if (act === "import") { if (readOnly()) { toast("You have view-only access, so you can’t import."); return; } $("#importFile").click(); }
  if (act === "backup") exportJSON();
  if (act === "history") openHistory();
  if (act === "reminders") openInbox();
  if (act === "household") openHouseholdSettings();
  if (act === "account") openAccount();
  if (act === "tour") { if (app.setup) { toast("Finish setting up first, then take the tour."); return; } app.startTour(); }
  if (act === "signout") app.signOut();
}

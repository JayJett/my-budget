/* The "⋯" menu: account, household, appearance, export and import. */
import { app, readOnly, savePrefs } from "./ctx.js";
import { $, esc, openPop, closePop, toast } from "./dom.js";
import { applyUI } from "./render.js";
import { exportCSV, exportJSON } from "./exports.js";

export function mainMenu() {
  const seg = (grp, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-${grp}="${v}" aria-pressed="${v === cur}">${l}</button>`).join("")}</div>`;
  const me = app.members.find(m => m.user_id === app.meId), s = app.session;
  return `${s ? `<div class="who-me">Signed in as<b>${esc((me && me.display_name) || s.user.email)}</b>${esc(s.user.email)}</div><button class="item" type="button" data-act="household">Household and invites<small>${esc(app.household ? app.household.name : "")}</small></button><button class="item" type="button" data-act="signout">Sign out</button><hr>` : ""}<div class="pop-h">Appearance</div>${seg("theme", [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]], app.ui.theme)}
    <div class="pop-h">Row spacing</div>${seg("density", [["comfortable", "Comfortable"], ["compact", "Compact"]], app.ui.density)}
    <hr><button class="item" type="button" data-act="csv">Export to CSV<small>Opens in Excel or Google Sheets</small></button>
    <button class="item" type="button" data-act="backup">Download a backup<small>A .json copy of every number, just in case</small></button>
    <button class="item" type="button" data-act="import"${readOnly() ? " disabled" : ""}>Import a saved file<small>From a backup or an earlier version</small></button>`;
}

export function menuAct(b) {
  if (b.dataset.theme) { app.ui.theme = b.dataset.theme; applyUI(); savePrefs(); openPop($("#menuBtn"), mainMenu(), menuAct); return; }
  if (b.dataset.density) { app.ui.density = b.dataset.density; applyUI(); savePrefs(); openPop($("#menuBtn"), mainMenu(), menuAct); return; }
  closePop();
  const act = b.dataset.act;
  if (act === "csv") exportCSV();
  if (act === "import") { if (readOnly()) { toast("You have view-only access, so you can’t import."); return; } $("#importFile").click(); }
  if (act === "backup") exportJSON();
  if (act === "household") app.openHousehold();
  if (act === "signout") app.signOut();
}

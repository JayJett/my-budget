/* Account settings (name, email, password, download, delete) and household settings
   (rename, members and roles, invites, leave, new household). Both open in the #sheet dialog. */
import { app } from "./ctx.js";
import { bindSettingsSheet, settingsScope } from "./settings-scope.js";
import { $, esc, toast, confirmDel, offerFile } from "./dom.js";
import { ymd } from "../model/util.js";
import { accentPickerHTML, lookSeg, THEMES, DENSITIES, MOTIONS, FEEDBACKS, resetLook } from "./accent.js";
import { canVibrate } from "./feedback.js";
import { modeSection, combineLink } from "./household-mode.js";
import { lookSection } from "./household-look.js";
import { avatarHTML, myName, checkFile, loadImage, cropper, savePhoto, removePhoto, refreshAvatars } from "./profile.js";

const ROLE_LABEL = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
const ROLE_HELP = { owner: "Can do everything, including managing people", editor: "Can change the budget and invite people", viewer: "Can look, but not change anything" };
const here = () => location.origin + location.pathname;
const friendly = e => app.friendly ? app.friendly(e) : (e && e.message) || "Something went wrong.";

function open(title, html) {
  const d = $("#sheet");
  d.innerHTML = `<div class="sheet-head"><h3 tabindex="-1" autofocus>${esc(title)}</h3><button class="btn icon" type="button" data-sheet="close" aria-label="Close">✕</button></div><div class="sheet-body ind-settings">${html}</div>`;
  if (!d.open) d.showModal();
  return bindSettingsSheet(d.querySelector(".ind-settings"));
}
const msg = (id, text, kind = "err") => { const m = $("#" + id); if (m) { m.className = "msg " + kind; m.textContent = text; } };
const close = () => { const d = $("#sheet"); if (d.open) d.close(); };

/* ---------- appearance (personal: saved to your login, never to the household's budget) ---------- */
/* Phase 8: grouped (your app's look, how it moves and feels, and where the household's and people's
   colours live), with a live preview at the top and a way back to the defaults. Everything here is
   yours alone: it follows you to every household and device, and changes nobody else's view. */
const PREVIEW = `<div class="ap-prev" aria-hidden="true"><div class="ap-prev-card"><span class="ap-prev-t">Preview</span><span class="chip ok">✓ On track</span>
  <div class="ap-prev-bar"><i></i></div><div class="ap-prev-row"><span class="btn primary small">Save</span><span class="linkish">Link</span><span class="ap-prev-sw"></span></div></div></div>`;
export function openAppearance() {
  const vib = canVibrate();
  open("Appearance", `
    <p class="ind-sub">Your appearance is personal to your account.</p>
    <section class="set"><h4>Theme</h4>${lookSeg("theme", THEMES, "Light or dark")}<p class="set-note">Auto follows your phone, and changes when it does.</p></section>
    <section class="set"><h4>Your colour</h4>${accentPickerHTML()}<p class="set-note">Just for you: everyone in the household picks their own. People’s colours, your allocations’ colours and money colours (like over budget) don’t change.</p></section>
    <details class="ind-card ind-detail ap-display"><summary>Spacing, motion and feedback</summary><section class="set"><h4>Spacing</h4>${lookSeg("density", DENSITIES, "Spacing")}<p class="set-note">Compact fits a little more on screen.</p></section>
    <section class="set"><h4>Motion</h4>${lookSeg("motion", MOTIONS, "Motion")}<p class="set-note">Auto follows your phone’s Reduce Motion setting. Reduced keeps everything still.</p></section>
    ${vib ? `<section class="set"><h4>Touch feedback</h4>${lookSeg("feedback", FEEDBACKS, "Touch feedback")}<p class="set-note">A tiny vibration when you choose something or reach a goal.</p></section>` : ""}
    </details>
    <details class="ind-card ind-detail"><summary>Preview appearance</summary>${PREVIEW}</details>
    <section class="set"><h4>Household and item colours</h4><div class="ap-links">
      ${app.household ? `<button class="dr-row" type="button" data-ap-go="household"><span>Household look<small>Its colour, icon or photo, in Household settings</small></span></button>` : ""}
      <button class="dr-row" type="button" data-ap-go="people"><span>People’s colours<small>On the Budget tab: tap a person</small></span></button>
      <p class="set-note">Each allocation, account, goal and expense has its own colour and icon too: open it and look for Appearance.</p></div></section>
    <section class="set"><button class="btn ghost block" type="button" data-ap-reset>Reset my appearance to the defaults</button>
    ${app.session ? `<p class="set-note">Saved to your login, so it follows you to your other devices and households.</p>` : ""}</section>`);
}

/* ---------- my profile (Phase 7D.2): your picture and your name; security stays in Account settings ---------- */
let crop = null;
export function openProfile() {
  const u = app.session.user, name = myName() || (u.user_metadata && u.user_metadata.name) || "", has = !!(u.user_metadata && u.user_metadata.avatar);
  crop = null;
  const scope = open("My profile", `
    <section class="prof">
      <div class="prof-av" data-my-avatar="xl">${avatarHTML("xl")}</div>
      <div class="prof-acts"><button class="btn small soft" type="button" data-prof="pick">${has ? "Change photo" : "Add a photo"}</button>${has ? `<button class="btn small ghost" type="button" data-prof="remove">Remove photo</button>` : ""}</div>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-prof-file hidden>
      <div class="msg" id="mProf" role="status" aria-live="polite"></div>
      <div class="prof-crop" id="cropBox" hidden>
        <canvas class="prof-canvas" tabindex="0" aria-label="Your photo. Drag, or use the arrow keys, to move it inside the circle."></canvas>
        <label class="prof-zoom"><span>Zoom</span><input type="range" min="1" max="3" step="0.01" value="1" data-crop-zoom></label>
        <div class="prof-crop-acts"><button class="btn" type="button" data-prof="cancel">Cancel</button><button class="btn primary" type="button" data-prof="save">Save photo</button></div>
      </div>
    </section>
    <section class="set"><h4>Your name</h4><form id="setName" class="set-row"><input type="text" name="name" value="${esc(name)}" autocomplete="given-name" required aria-label="Your name" maxlength="60"><button class="btn primary" type="submit">Save</button></form><div class="msg" id="mName"></div>
      <p class="set-note">How you appear to other people in your households.</p></section>
    <details class="ind-card ind-detail" id="profileSecurity"><summary>Security and sign-in</summary><section class="set"><h4>Email</h4><form id="setEmail" class="set-row"><input type="email" name="email" value="${esc(u.email || "")}" autocomplete="email" required aria-label="Email"><button class="btn primary" type="submit">Change</button></form><div class="msg" id="mEmail"></div>
      <p class="set-note">We’ll email a confirmation link. The change happens once you open it.</p></section>
    <section class="set"><h4>Password</h4><form id="setPass" class="set-row"><input type="password" name="password" minlength="8" autocomplete="new-password" required placeholder="New password (8+ characters)" aria-label="New password"><button class="btn primary" type="submit">Change</button></form><div class="msg" id="mPass"></div></section></details>
    <details class="ind-card ind-detail" id="profileData"><summary>Personal data</summary><section class="set"><h4>Download your data</h4><p class="set-note">Download everything we store about you: your account details, every household you’re in, their budgets, backups and change history.</p><button class="btn" type="button" data-sheet="download">Download all my data</button><div class="msg" id="mDl"></div></section>
    <section class="set danger-zone"><h4>Delete my account</h4><div id="delPlan" class="set-note">Working out what would happen…</div>
      <form id="setDelete" class="set-row"><input type="text" name="confirm" autocomplete="off" placeholder="Type DELETE to confirm" aria-label="Type DELETE to confirm"><button class="btn danger" type="submit">Delete my account</button></form><div class="msg" id="mDel"></div></section></details>`);
  explainDelete(scope);
}
async function profileAction(scope, act, btn) {
  const box = $("#cropBox");
  if (act === "pick") { $("[data-prof-file]").click(); return; }
  if (act === "cancel") { crop = null; box.hidden = true; return; }
  if (act === "save") {
    if (!crop) return;
    btn.disabled = true; btn.textContent = "Saving…"; msg("mProf", "", "info");
    try {
      const blob = await crop.blob();
      if (!scope.current()) return;
      await savePhoto(blob, scope.current);
      if (!scope.current()) return;
      toast("Photo saved", "ok"); openProfile(); app.render();
    }
    catch (e) { if (!scope.current()) return; msg("mProf", `${e.message} Your previous picture hasn’t changed.`); btn.disabled = false; btn.textContent = "Try again"; }
    return;
  }
  if (act === "remove") {
    if (!(await confirmDel("Remove your photo?", "Your initial shows instead. You can add a photo again any time.", "Remove"))) return;
    if (!scope.current()) return;
    try { await removePhoto(scope.current); if (scope.current()) { toast("Photo removed"); openProfile(); app.render(); } }
    catch (e) { if (scope.current()) msg("mProf", e.message); }
  }
}
async function photoChosen(scope, input) {
  const f = input.files && input.files[0]; input.value = "";
  const bad = checkFile(f); if (bad) { msg("mProf", bad); return; }
  try {
    const img = await loadImage(f);
    if (!scope.current() || !input.isConnected) return;
    const box = scope.body.querySelector("#cropBox");
    crop = cropper(img).mount(box); box.hidden = false; msg("mProf", "Drag to position, zoom if you like, then save.", "info");
    box.querySelector("canvas").focus({ preventScroll: true });
  } catch (e) { if (scope.current()) msg("mProf", e.message); }
}

/* ---------- account ---------- */
/** Account settings now live in My profile (Phase 7D.2 follow-up): one page for you. */
export function openAccount() { openProfile(); }

function myHouseholds(scope) {
  return scope.request(sb => sb.from("household_members").select("household_id, role, joined_at, households(name)").eq("user_id", scope.userId).order("joined_at"));
}
async function explainDelete(scope) {
  const { data: mine, error } = await myHouseholds(scope), lines = [];
  if (!scope.current()) return;
  const el = scope.body.querySelector("#delPlan");
  if (error) { el.textContent = friendly(error); return; }
  for (const h of mine || []) {
    const { data: ms, error } = await scope.request(sb => sb.from("household_members").select("user_id, display_name, role, joined_at").eq("household_id", h.household_id).order("joined_at"));
    if (!scope.current()) return;
    if (error) { el.textContent = friendly(error); return; }
    const others = (ms || []).filter(m => m.user_id !== scope.userId), name = esc(h.households?.name || "A household");
    if (!others.length) lines.push(`<li><b>${name}</b> and its budget will be deleted (you’re the only one in it).</li>`);
    else if (h.role === "owner" && !others.some(m => m.role === "owner")) lines.push(`<li><b>${name}</b> stays with the others; <b>${esc(others[0].display_name || "the longest-standing member")}</b> becomes its owner.</li>`);
    else lines.push(`<li><b>${name}</b> stays with the others.</li>`);
  }
  el.innerHTML = `This can’t be undone. Your login is deleted, and:<ul>${lines.join("") || "<li>You’re not in any households.</li>"}</ul>Download your data first if you might want it.`;
}

async function downloadAll(scope) {
  msg("mDl", "Gathering your data…", "info");
  const u = app.session.user, out = { exported_at: new Date().toISOString(),
    account: { id: u.id, email: u.email, name: u.user_metadata?.name, created_at: u.created_at }, households: [] };
  const { data: mine, error } = await myHouseholds(scope);
  if (!scope.current()) return;
  if (error) return msg("mDl", friendly(error));
  for (const h of mine || []) {
    const id = h.household_id;
    const [members, budget, backups, invites, history] = await Promise.all([
      scope.request(sb => sb.from("household_members").select("display_name, email, role, joined_at").eq("household_id", id)),
      scope.request(sb => sb.from("budgets").select("state, updated_at").eq("household_id", id).maybeSingle()),
      scope.request(sb => sb.from("budget_backups").select("state, reason, taken_at").eq("household_id", id).order("taken_at")),
      scope.request(sb => sb.from("household_invites").select("email, role, created_at, accepted_at").eq("household_id", id)),
      scope.request(sb => sb.from("budget_changes").select("changed_by, changed_at, kind, reason, changes").eq("household_id", id).order("id")),
    ]);
    if (!scope.current()) return;
    out.households.push({ id, name: h.households?.name, your_role: h.role, joined_at: h.joined_at,
      members: members.data || [], budget: budget.data || null, backups: backups.data || [], invites: invites.data || [], history_last_90_days: history.data || [] });
  }
  offerFile(`my-budget-data-${ymd(new Date())}.json`, JSON.stringify(out, null, 1), "Your data");
  msg("mDl", "", "info");
}

/* ---------- create a household (Phase 9A: from the household menu) ----------
   The same form and database function as in Household settings (create_household), nothing new. */
export function openCreateHousehold() {
  open("Create a household", `<section class="set"><p class="set-note">A separate budget with its own people, for example if you help someone with theirs. Your other households stay exactly as they are.</p>
    <form id="setNewHH" class="set-row"><input type="text" name="name" placeholder="e.g. Mum’s budget" required aria-label="New household name" maxlength="60"><button class="btn primary" type="submit">Create</button></form><div class="msg" id="mNew"></div></section>`);
  const i = document.querySelector('#setNewHH input'); if (i) setTimeout(() => i.focus(), 50);
}

/* ---------- household ---------- */
export async function openHouseholdSettings() {
  if (!app.store?.isActive() || !app.household) return;
  const scope = open("Household settings", '<p class="set-note" role="status">Loading household settings…</p>');
  const hh = scope.household;
  const { data: roster, error } = await scope.request(sb => sb.from("household_members").select("user_id, display_name, email, role, joined_at").eq("household_id", hh.id).order("joined_at"));
  if (!scope.current()) return;
  const role = roster?.find(m => m.user_id === scope.userId)?.role;
  if (error || !ROLE_HELP[role]) {
    scope.body.innerHTML = `<p class="msg err" role="status">${esc(error ? friendly(error) : "You no longer have access to this household.")}</p>`;
    return;
  }
  // Refresh the store's permissions when the server reports that the role has changed.
  if (role !== scope.role) {
    scope.body.innerHTML = '<p class="msg" role="status">Your access changed. Reopening the budget…</p>';
    return reloadAfterChange(scope, hh.id, null, "mPeople");
  }
  scope.roster = roster;
  const isOwner = role === "owner", canInvite = isOwner || role === "editor";
  const { data: inv, error: inviteError } = canInvite
    ? await scope.request(sb => sb.from("household_invites").select("id, email, role").eq("household_id", hh.id).is("accepted_at", null).order("created_at"))
    : { data: [] };
  if (!scope.current()) return;
  const roleSel = m => `<select class="cell role-sel" data-role-for="${esc(m.user_id)}" aria-label="Role for ${esc(m.display_name || m.email)}">${Object.keys(ROLE_LABEL).map(r => `<option value="${r}"${m.role === r ? " selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select>`;
  scope.body.innerHTML = `
    <section class="set"><h4>Name</h4>${isOwner ? `<form id="setHHName" class="set-row"><input type="text" name="name" value="${esc(hh.name)}" required aria-label="Household name"><button class="btn primary" type="submit">Rename</button></form><div class="msg" id="mHH"></div>` : `<p>${esc(hh.name)}</p>`}
      <p class="set-note">You’re ${role === "owner" ? "an owner" : role === "editor" ? "an editor" : "a viewer"} here: ${esc(ROLE_HELP[role].toLowerCase())}.</p></section>
    <section class="set"><h4>Members</h4><ul class="hh-list">${roster.map(m => `<li><span>${esc(m.display_name || m.email)}${m.user_id === scope.userId ? " (you)" : ""}<small>${esc(m.email)}</small></span>
      <span class="hh-acts">${isOwner && m.user_id !== scope.userId ? `${roleSel(m)}<button class="btn small" type="button" data-remove="${esc(m.user_id)}" data-name="${esc(m.display_name || m.email)}">Remove</button>` : `<span class="chip ${m.role === "owner" ? "ok" : ""}" title="${esc(ROLE_HELP[m.role] || "")}">${ROLE_LABEL[m.role] || m.role}</span>`}</span></li>`).join("")}</ul>
      <div class="msg" id="mPeople"></div>
      <p class="set-note">Owners can do everything. Editors can change the budget and invite people. Viewers can look but not change anything.</p></section>
    ${canInvite ? `<section class="set"><h4>Invite someone</h4><form id="setInvite" class="set-row"><input type="email" name="email" placeholder="their@email.com" autocomplete="email" required aria-label="Email to invite">
      <select class="cell" name="role" aria-label="Their role"><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button class="btn primary" type="submit">Invite</button></form><div class="msg" id="mInv">${inviteError ? esc(friendly(inviteError)) : ""}</div>
      <p class="set-note">They create an account with that exact email, confirm it, and join as soon as they sign in.</p>
      <ul class="hh-list" ${(inv || []).length ? "" : "hidden"}>${(inv || []).map(i => `<li><span>${esc(i.email)}<small>Invited as ${ROLE_LABEL[i.role] || "Editor"}. Waiting for them to sign up</small></span><button class="btn small" type="button" data-uninvite="${esc(i.id)}">Cancel</button></li>`).join("")}</ul></section>` : ""}
    ${lookSection(canInvite)}
    ${app.hasData ? modeSection() + combineLink() : ""}
    <section class="set"><h4>Other households</h4><p class="set-note">One login can be in several households, for example if you help someone with theirs. Switch between them by tapping the household’s name at the top.</p>
      <form id="setNewHH" class="set-row"><input type="text" name="name" placeholder="e.g. Mum’s budget" required aria-label="New household name"><button class="btn" type="submit">Create a household</button></form><div class="msg" id="mNew"></div></section>
    <section class="set danger-zone"><h4>Leave this household</h4><p class="set-note">${leaveText(scope)}</p><button class="btn danger" type="button" data-sheet="leave">Leave ${esc(hh.name)}</button><div class="msg" id="mLeave"></div></section>`;
}
function leaveText(scope) {
  const others = scope.roster.filter(m => m.user_id !== scope.userId);
  if (!others.length) return "You’re the only one here, so leaving deletes this household and its budget for good.";
  if (scope.role === "owner" && !others.some(m => m.role === "owner")) return `${esc(others[0].display_name || "The longest-standing member")} will become the owner. The budget stays with them.`;
  return "The budget stays with everyone else. You’d need a new invite to come back.";
}

async function reloadAfterChange(scope, preferId, notice, messageId) {
  if (notice) toast(notice);
  try { await app.reloadHouseholds(preferId, scope); }
  catch (error) {
    if (!scope.current()) return;
    const target = scope.body.querySelector("#" + messageId);
    if (target) msg(messageId, friendly(error));
    else scope.body.textContent = friendly(error);
  }
}

/* ---------- wiring ---------- */
export function initSettings() {
  const d = $("#sheet");
  d.addEventListener("click", async e => {
    if (e.target === d) { close(); return; } // click on the dimmed background
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.sheet === "close") return close();
    const scope = settingsScope(b);
    if (b.dataset.sheet === "download" && scope) return downloadAll(scope);
    if (b.dataset.sheet === "appearance") return openAppearance();
    if ("apReset" in b.dataset) {
      if (!(await confirmDel("Reset your appearance?", "Your colour, light or dark, spacing, motion and touch feedback go back to how the app starts. Nothing else changes.", "Reset"))) return;
      if (!scope?.current()) return;
      resetLook(); openAppearance(); toast("Appearance reset"); return;
    }
    if (b.dataset.apGo === "household") { close(); return openHouseholdSettings(); }
    if (b.dataset.apGo === "people") { close(); location.hash = "budget"; setTimeout(() => { const el = document.querySelector("[data-edit-person]"); if (el) { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); } }, 60); return; }
    if (b.dataset.sheet === "account") return openAccount();
    if (!scope) return;
    if (b.dataset.prof) return profileAction(scope, b.dataset.prof, b);
    if (b.dataset.sheet === "leave" && scope.roster && !b.disabled) {
      if (!(await confirmDel(`Leave ${scope.household.name}?`, leaveText(scope).replace(/<[^>]+>/g, ""), "Leave")) || !scope.current()) return;
      b.disabled = true;
      const { data, error } = await scope.rpc("leave_household", {});
      if (!scope.current()) return;
      if (error) { b.disabled = false; return msg("mLeave", friendly(error)); }
      return reloadAfterChange(scope, undefined, data === "household deleted" ? "Household deleted" : "You’ve left the household", "mLeave");
    }
    if (b.dataset.remove && scope.role === "owner") {
      const { remove: user, name } = b.dataset;
      if (!(await confirmDel(`Remove ${name}?`, "They’ll lose access to this budget straight away. The budget itself doesn’t change.", "Remove")) || !scope.current()) return;
      const { error } = await scope.rpc("remove_member", { p_user: user });
      if (!scope.current()) return;
      if (error) return msg("mPeople", friendly(error));
      toast(`${name} removed`); return openHouseholdSettings();
    }
    if (b.dataset.uninvite && ["owner", "editor"].includes(scope.role)) {
      const id = b.dataset.uninvite;
      const { data, error } = await scope.request(sb => sb.from("household_invites").delete().eq("household_id", scope.household.id).eq("id", id).select("id"));
      if (!scope.current()) return;
      if (error || !data?.length) return msg("mInv", error ? friendly(error) : "This invitation is no longer available to cancel.");
      return openHouseholdSettings();
    }
  });
  d.addEventListener("change", async e => {
    const scope = settingsScope(e.target);
    if (!scope) return;
    if (e.target.matches("[data-prof-file]")) return photoChosen(scope, e.target);
    const s = e.target.closest("[data-role-for]"); if (!s || scope.role !== "owner" || s.disabled) return;
    const user = s.dataset.roleFor, role = s.value;
    s.disabled = true;
    const { error } = await scope.rpc("set_member_role", { p_user: user, p_role: role });
    if (!scope.current()) return;
    s.disabled = false;
    const member = scope.roster.find(m => m.user_id === user);
    if (error) { s.value = member.role; return msg("mPeople", friendly(error)); }
    member.role = role;
    msg("mPeople", "");
    toast("Role updated");
  });
  d.addEventListener("submit", async e => {
    const f = e.target; e.preventDefault();
    const scope = settingsScope(f);
    if (!scope) return;
    const v = Object.fromEntries(new FormData(f).entries()), btn = f.querySelector('button[type="submit"]');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    try {
      if (f.id === "setName") {
        const { error } = await app.sb.auth.updateUser({ data: { name: v.name.trim() } });
        if (!scope.current()) return;
        if (error) return msg("mName", friendly(error));
        await scope.request(sb => sb.rpc("sync_my_profile"));
        if (!scope.current()) return;
        app.rememberMe();
        const me = (app.members || []).find(m => m.user_id === scope.userId); if (me) me.display_name = v.name.trim();
        refreshAvatars(); app.render();
        msg("mName", "Saved.", "ok");
      }
      if (f.id === "setEmail") {
        const { error } = await app.sb.auth.updateUser({ email: v.email.trim() }, { emailRedirectTo: here() });
        if (!scope.current()) return;
        msg("mEmail", error ? friendly(error) : `Check ${v.email.trim()} for a confirmation link (and your old inbox too, if asked).`, error ? "err" : "ok");
      }
      if (f.id === "setPass") {
        const { error } = await app.sb.auth.updateUser({ password: v.password });
        if (!scope.current()) return;
        msg("mPass", error ? friendly(error) : "Password changed.", error ? "err" : "ok"); if (!error) f.reset();
      }
      if (f.id === "setDelete") {
        if (v.confirm.trim() !== "DELETE") return msg("mDel", "Type DELETE (in capitals) to confirm.");
        const { error } = await scope.request(sb => sb.rpc("delete_my_account"));
        if (!scope.current()) return;
        if (error) return msg("mDel", friendly(error));
        app.forgetMe({ discardDraftsFor: scope.userId }); close(); toast("Your account has been deleted");
        await app.sb.auth.signOut();
      }
      if (f.id === "setHHName" && scope.role === "owner") {
        const { data, error } = await scope.request(sb => sb.from("households").update({ name: v.name.trim() }).eq("id", scope.household.id).select("name"));
        if (!scope.current()) return;
        if (error || !data?.length) return msg("mHH", error ? friendly(error) : "Only an owner can rename this household.");
        const name = data[0].name;
        scope.household.name = name;
        const entry = app.households.find(h => h.id === scope.household.id);
        if (entry) entry.name = name;
        app.render(); msg("mHH", "Renamed.", "ok");
      }
      if (f.id === "setInvite" && ["owner", "editor"].includes(scope.role)) {
        const { error } = await scope.rpc("invite_member", { p_email: v.email.trim(), p_role: v.role });
        if (!scope.current()) return;
        if (error) return msg("mInv", friendly(error));
        toast(`Invite saved for ${v.email.trim()}`); return openHouseholdSettings();
      }
      if (f.id === "setNewHH") {
        const { data, error } = await scope.request(sb => sb.rpc("create_household", { p_name: v.name.trim() }));
        if (!scope.current()) return;
        if (error) return msg("mNew", friendly(error));
        return await reloadAfterChange(scope, data, `${v.name.trim()} created`, "mNew");
      }
    } finally { if (btn.isConnected) btn.disabled = false; }
  });
}

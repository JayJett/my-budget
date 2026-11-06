/* Account settings (name, email, password, download, delete) and household settings
   (rename, members and roles, invites, leave, new household). Both open in the #sheet dialog. */
import { app } from "./ctx.js";
import { $, esc, toast, confirmDel, offerFile } from "./dom.js";
import { ymd } from "../model/util.js";

const ROLE_LABEL = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
const ROLE_HELP = { owner: "Can do everything, including managing people", editor: "Can change the budget and invite people", viewer: "Can look, but not change anything" };
const here = () => location.origin + location.pathname;
const friendly = e => app.friendly ? app.friendly(e) : (e && e.message) || "Something went wrong.";

function open(title, html) {
  const d = $("#sheet");
  d.innerHTML = `<div class="sheet-head"><h3>${esc(title)}</h3><button class="btn icon" type="button" data-sheet="close" aria-label="Close">✕</button></div><div class="sheet-body">${html}</div>`;
  if (!d.open) d.showModal();
}
const msg = (id, text, kind = "err") => { const m = $("#" + id); if (m) { m.className = "msg " + kind; m.textContent = text; } };
const close = () => { const d = $("#sheet"); if (d.open) d.close(); };

/* ---------- account ---------- */
export function openAccount() {
  const u = app.session.user, name = (u.user_metadata && u.user_metadata.name) || "";
  open("Your account", `
    <section class="set"><h4>Your name</h4><form id="setName" class="set-row"><input type="text" name="name" value="${esc(name)}" autocomplete="given-name" required aria-label="Your name"><button class="btn primary" type="submit">Save</button></form><div class="msg" id="mName"></div>
      <p class="set-note">This is how you appear to other people in your households. Names inside a budget are changed on its Budget tab.</p></section>
    <section class="set"><h4>Email</h4><form id="setEmail" class="set-row"><input type="email" name="email" value="${esc(u.email || "")}" autocomplete="email" required aria-label="Email"><button class="btn primary" type="submit">Change</button></form><div class="msg" id="mEmail"></div>
      <p class="set-note">We’ll email a confirmation link. The change happens once you open it.</p></section>
    <section class="set"><h4>Password</h4><form id="setPass" class="set-row"><input type="password" name="password" minlength="8" autocomplete="new-password" required placeholder="New password (8+ characters)" aria-label="New password"><button class="btn primary" type="submit">Change</button></form><div class="msg" id="mPass"></div></section>
    <section class="set"><h4>Your data</h4><p class="set-note">Download everything we store about you: your account details, every household you’re in, their budgets, backups and change history.</p><button class="btn" type="button" data-sheet="download">Download all my data</button><div class="msg" id="mDl"></div></section>
    <section class="set danger-zone"><h4>Delete my account</h4><div id="delPlan" class="set-note">Working out what would happen…</div>
      <form id="setDelete" class="set-row"><input type="text" name="confirm" autocomplete="off" placeholder="Type DELETE to confirm" aria-label="Type DELETE to confirm"><button class="btn danger" type="submit">Delete my account</button></form><div class="msg" id="mDel"></div></section>`);
  explainDelete();
}

async function myHouseholds() {
  const { data } = await app.sb.from("household_members").select("household_id, role, joined_at, households(name)").eq("user_id", app.meId).order("joined_at");
  return data || [];
}
async function explainDelete() {
  const mine = await myHouseholds(), lines = [];
  for (const h of mine) {
    const { data: ms } = await app.sb.from("household_members").select("user_id, display_name, role, joined_at").eq("household_id", h.household_id).order("joined_at");
    const others = (ms || []).filter(m => m.user_id !== app.meId), name = esc((h.households && h.households.name) || "A household");
    if (!others.length) lines.push(`<li><b>${name}</b> and its budget will be deleted (you’re the only one in it).</li>`);
    else if (h.role === "owner" && !others.some(m => m.role === "owner")) lines.push(`<li><b>${name}</b> stays with the others; <b>${esc(others[0].display_name || "the longest-standing member")}</b> becomes its owner.</li>`);
    else lines.push(`<li><b>${name}</b> stays with the others.</li>`);
  }
  const el = $("#delPlan");
  if (el) el.innerHTML = `This can’t be undone. Your login is deleted, and:<ul>${lines.join("") || "<li>You’re not in any households.</li>"}</ul>Download your data first if you might want it.`;
}

async function downloadAll() {
  msg("mDl", "Gathering your data…", "info");
  const sb = app.sb, u = app.session.user, out = { exported_at: new Date().toISOString(),
    account: { id: u.id, email: u.email, name: u.user_metadata && u.user_metadata.name, created_at: u.created_at }, households: [] };
  for (const h of await myHouseholds()) {
    const id = h.household_id;
    const [members, budget, backups, invites, history] = await Promise.all([
      sb.from("household_members").select("display_name, email, role, joined_at").eq("household_id", id),
      sb.from("budgets").select("state, updated_at").eq("household_id", id).maybeSingle(),
      sb.from("budget_backups").select("state, reason, taken_at").eq("household_id", id).order("taken_at"),
      sb.from("household_invites").select("email, role, created_at, accepted_at").eq("household_id", id),
      sb.from("budget_changes").select("changed_by, changed_at, kind, reason, changes").eq("household_id", id).order("id"),
    ]);
    out.households.push({ id, name: h.households && h.households.name, your_role: h.role, joined_at: h.joined_at,
      members: members.data || [], budget: budget.data || null, backups: backups.data || [], invites: invites.data || [], history_last_90_days: history.data || [] });
  }
  offerFile(`my-budget-data-${ymd(new Date())}.json`, JSON.stringify(out, null, 1), "Your data");
  msg("mDl", "", "info");
}

/* ---------- household ---------- */
export async function openHouseholdSettings() {
  const hh = app.household, role = app.role, isOwner = role === "owner", canInvite = role === "owner" || role === "editor";
  const { data: ms } = await app.sb.from("household_members").select("user_id, display_name, email, role, joined_at").eq("household_id", hh.id).order("joined_at");
  app.members = ms || [];
  const { data: inv } = canInvite ? await app.sb.from("household_invites").select("id, email, role").eq("household_id", hh.id).is("accepted_at", null).order("created_at") : { data: [] };
  const roleSel = m => `<select class="cell role-sel" data-role-for="${esc(m.user_id)}" aria-label="Role for ${esc(m.display_name || m.email)}">${Object.keys(ROLE_LABEL).map(r => `<option value="${r}"${m.role === r ? " selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select>`;
  open("Household settings", `
    <section class="set"><h4>Name</h4>${isOwner ? `<form id="setHHName" class="set-row"><input type="text" name="name" value="${esc(hh.name)}" required aria-label="Household name"><button class="btn primary" type="submit">Rename</button></form><div class="msg" id="mHH"></div>` : `<p>${esc(hh.name)}</p>`}
      <p class="set-note">You’re ${role === "owner" ? "an owner" : role === "editor" ? "an editor" : "a viewer"} here: ${esc(ROLE_HELP[role].toLowerCase())}.</p></section>
    <section class="set"><h4>People</h4><ul class="hh-list">${app.members.map(m => `<li><span>${esc(m.display_name || m.email)}${m.user_id === app.meId ? " (you)" : ""}<small>${esc(m.email)}</small></span>
      <span class="hh-acts">${isOwner && m.user_id !== app.meId ? `${roleSel(m)}<button class="btn small" type="button" data-remove="${esc(m.user_id)}" data-name="${esc(m.display_name || m.email)}">Remove</button>` : `<span class="chip ${m.role === "owner" ? "ok" : ""}" title="${esc(ROLE_HELP[m.role] || "")}">${ROLE_LABEL[m.role] || m.role}</span>`}</span></li>`).join("")}</ul>
      <div class="msg" id="mPeople"></div>
      <p class="set-note">Owners can do everything. Editors can change the budget and invite people. Viewers can look but not change anything.</p></section>
    ${canInvite ? `<section class="set"><h4>Invite someone</h4><form id="setInvite" class="set-row"><input type="email" name="email" placeholder="their@email.com" autocomplete="email" required aria-label="Email to invite">
      <select class="cell" name="role" aria-label="Their role"><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button class="btn primary" type="submit">Invite</button></form><div class="msg" id="mInv"></div>
      <p class="set-note">They create an account with that exact email, confirm it, and join as soon as they sign in.</p>
      <ul class="hh-list" ${(inv || []).length ? "" : "hidden"}>${(inv || []).map(i => `<li><span>${esc(i.email)}<small>Invited as ${ROLE_LABEL[i.role] || "Editor"}. Waiting for them to sign up</small></span><button class="btn small" type="button" data-uninvite="${esc(i.id)}">Cancel</button></li>`).join("")}</ul></section>` : ""}
    <section class="set"><h4>Other households</h4><p class="set-note">One login can be in several households, for example if you help someone with theirs. Switch between them from the ⋯ menu.</p>
      <form id="setNewHH" class="set-row"><input type="text" name="name" placeholder="e.g. Mum’s budget" required aria-label="New household name"><button class="btn" type="submit">Create a household</button></form><div class="msg" id="mNew"></div></section>
    <section class="set danger-zone"><h4>Leave this household</h4><p class="set-note">${leaveText()}</p><button class="btn danger" type="button" data-sheet="leave">Leave ${esc(hh.name)}</button><div class="msg" id="mLeave"></div></section>`);
}
function leaveText() {
  const others = app.members.filter(m => m.user_id !== app.meId);
  if (!others.length) return "You’re the only one here, so leaving deletes this household and its budget for good.";
  if (app.role === "owner" && !others.some(m => m.role === "owner")) return `${esc(others[0].display_name || "The longest-standing member")} will become the owner. The budget stays with them.`;
  return "The budget stays with everyone else. You’d need a new invite to come back.";
}

/* ---------- wiring ---------- */
export function initSettings() {
  const d = $("#sheet");
  d.addEventListener("click", async e => {
    if (e.target === d) { close(); return; } // click on the dimmed background
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.sheet === "close") return close();
    if (b.dataset.sheet === "download") return downloadAll();
    if (b.dataset.sheet === "leave") {
      if (!(await confirmDel(`Leave ${app.household.name}?`, leaveText().replace(/<[^>]+>/g, ""), "Leave"))) return;
      const { data, error } = await app.sb.rpc("leave_household", { p_household: app.household.id });
      if (error) return msg("mLeave", friendly(error));
      close(); toast(data === "household deleted" ? "Household deleted" : "You’ve left the household");
      return app.reloadHouseholds();
    }
    if (b.dataset.remove) {
      if (!(await confirmDel(`Remove ${b.dataset.name}?`, "They’ll lose access to this budget straight away. The budget itself doesn’t change.", "Remove"))) return;
      const { error } = await app.sb.rpc("remove_member", { p_household: app.household.id, p_user: b.dataset.remove });
      if (error) return msg("mPeople", friendly(error));
      toast(`${b.dataset.name} removed`); return openHouseholdSettings();
    }
    if (b.dataset.uninvite) { await app.sb.from("household_invites").delete().eq("id", b.dataset.uninvite); return openHouseholdSettings(); }
  });
  d.addEventListener("change", async e => {
    const s = e.target.closest("[data-role-for]"); if (!s) return;
    const { error } = await app.sb.rpc("set_member_role", { p_household: app.household.id, p_user: s.dataset.roleFor, p_role: s.value });
    if (error) { msg("mPeople", friendly(error)); return openHouseholdSettings(); }
    toast("Role updated");
  });
  d.addEventListener("submit", async e => {
    const f = e.target; e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries()), btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      if (f.id === "setName") {
        const { error } = await app.sb.auth.updateUser({ data: { name: v.name.trim() } });
        if (error) return msg("mName", friendly(error));
        await app.sb.rpc("sync_my_profile");
        app.rememberMe();
        msg("mName", "Saved.", "ok");
      }
      if (f.id === "setEmail") {
        const { error } = await app.sb.auth.updateUser({ email: v.email.trim() }, { emailRedirectTo: here() });
        msg("mEmail", error ? friendly(error) : `Check ${v.email.trim()} for a confirmation link (and your old inbox too, if asked).`, error ? "err" : "ok");
      }
      if (f.id === "setPass") {
        const { error } = await app.sb.auth.updateUser({ password: v.password });
        msg("mPass", error ? friendly(error) : "Password changed.", error ? "err" : "ok"); if (!error) f.reset();
      }
      if (f.id === "setDelete") {
        if (v.confirm.trim() !== "DELETE") return msg("mDel", "Type DELETE (in capitals) to confirm.");
        const { error } = await app.sb.rpc("delete_my_account");
        if (error) return msg("mDel", friendly(error));
        app.forgetMe(); close(); toast("Your account has been deleted");
        await app.sb.auth.signOut();
      }
      if (f.id === "setHHName") {
        const { data, error } = await app.sb.from("households").update({ name: v.name.trim() }).eq("id", app.household.id).select("name");
        if (error || !data || !data.length) return msg("mHH", error ? friendly(error) : "Only an owner can rename this household.");
        app.household.name = data[0].name; app.render(); msg("mHH", "Renamed.", "ok");
      }
      if (f.id === "setInvite") {
        const { error } = await app.sb.rpc("invite_member", { p_household: app.household.id, p_email: v.email.trim(), p_role: v.role });
        if (error) return msg("mInv", friendly(error));
        toast(`Invite saved for ${v.email.trim()}`); return openHouseholdSettings();
      }
      if (f.id === "setNewHH") {
        const { data, error } = await app.sb.rpc("create_household", { p_name: v.name.trim() });
        if (error) return msg("mNew", friendly(error));
        close(); toast(`${v.name.trim()} created`);
        return app.reloadHouseholds(data);
      }
    } finally { if (btn.isConnected) btn.disabled = false; }
  });
}

/* Signing in, choosing and switching households, roles, and starting the setup guide. */
import { app } from "./ctx.js";
import { $, esc, toast, closePop } from "./dom.js";
import { render } from "./render.js";
import { createStore, isNetworkError, clearDeviceCopies } from "../sync/store.js";
import { blankBudget } from "../model/schema.js";
import { startSetup, endSetup } from "./onboarding.js";

const here = () => location.origin + location.pathname;
const brand = `<div class="auth-brand"><div class="logo" aria-hidden="true">$</div><div class="brand">My Budget<small>Plan where every dollar goes, together</small></div></div>`;

/* ---------- "Welcome back, Jarden": remembered on this device only ---------- */
const WELCOME = "mb-welcome";
const remembered = () => { try { return JSON.parse(localStorage.getItem(WELCOME) || "null"); } catch (_) { return null; } };
function rememberMe() {
  const u = app.session && app.session.user; if (!u) return;
  try { localStorage.setItem(WELCOME, JSON.stringify({ name: (u.user_metadata && u.user_metadata.name) || "", email: u.email || "" })); } catch (_) {}
}
/** Forget this person on this device: the welcome-back name, the offline copy of who they are,
    and every budget copy (used for "Not you?", signing out and deleting the account). */
function forgetMe() { try { localStorage.removeItem(WELCOME); localStorage.removeItem(OFFLINE); } catch (_) {} clearDeviceCopies(); }

/* ---------- what's needed to open the app offline: who you are and your households ---------- */
const OFFLINE = "mb-offline";
const OFFLINE_MSG = "You’re offline. You can keep working: changes are kept on this phone and sync when you’re back online.";
const offlineProfile = () => { try { return JSON.parse(localStorage.getItem(OFFLINE) || "null"); } catch (_) { return null; } };
function saveOfflineProfile() {
  const u = app.session && app.session.user; if (!u || app.session.offline) return;
  const prev = offlineProfile(), members = { ...((prev && prev.user.id === u.id && prev.members) || {}) };
  if (app.household) members[app.household.id] = app.members;
  try { localStorage.setItem(OFFLINE, JSON.stringify({ user: { id: u.id, email: u.email, user_metadata: u.user_metadata || {} }, households: app.households, members })); } catch (_) {}
}
const lastHHKey = () => `mb-household-${app.meId}`;

/* ---------- save status in the header ---------- */
function setStatus(text, cls, tip) {
  const el = $("#saveState"); el.className = "save-state " + (cls || ""); $("#saveText").textContent = text;
  if (tip !== undefined) el.dataset.tip = tip;
}
function nameOf(id) {
  if (!id) return "";
  if (id === app.meId) return "you";
  const m = app.members.find(x => x.user_id === id); return (m && (m.display_name || (m.email || "").split("@")[0])) || "someone";
}
function showSaved(meta) {
  if (app.role === "viewer") { setStatus("View only", "ro", "You can see this budget but not change it. An owner can change your role."); return; }
  if (!meta || !meta.at) { setStatus("Saved", "", "Changes save automatically."); return; }
  const when = new Date(meta.at).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }), who = nameOf(meta.by);
  setStatus("Saved", "", `Changes save automatically. Last change${who ? ` by ${who}` : ""}, ${when}.`);
}
const showConn = msg => { const c = $("#conn"); c.textContent = msg || ""; c.hidden = !msg; };

/** Redraw after someone else's change, keeping the cursor where it was. */
function applyRemoteView(meta) {
  if (app.setup) return; // don't interrupt the setup guide
  const ae = document.activeElement;
  const focus = ae && ae.dataset && ae.dataset.f ? { l: ae.dataset.l, i: ae.dataset.i, f: ae.dataset.f, s: ae.selectionStart } : null, y = window.scrollY;
  app.hasData = true;
  render(); window.scrollTo(0, y);
  if (focus) {
    const el = document.querySelector(`[data-l="${CSS.escape(focus.l)}"][data-i="${CSS.escape(focus.i)}"][data-f="${CSS.escape(focus.f)}"]`);
    if (el) { el.focus(); try { if (focus.s !== null && focus.s !== undefined) el.setSelectionRange(focus.s, focus.s); } catch (_) {} }
  }
  if (meta && !meta.self && meta.by && meta.by !== app.meId) toast(`Updated by ${nameOf(meta.by)}`);
}

/* ---------- sign-in screens ---------- */
let recovering = false, entering = false;
export function showAuth(mode, msg, kind) {
  document.body.classList.add("signed-out"); const el = $("#auth"); el.hidden = false;
  const m = `<div class="msg ${kind || "err"}" id="authMsg">${msg ? esc(msg) : ""}</div>`;
  const tabs = `<div class="auth-tabs"><button type="button" data-auth="signin" aria-pressed="${mode === "signin"}">Sign in</button><button type="button" data-auth="signup" aria-pressed="${mode === "signup"}">Create account</button></div>`;
  const me = remembered();
  let body = "";
  if (mode === "setup") body = `<h2>Almost there</h2><p class="lead">This app isn’t connected to its database yet. Open <code class="k">js/config.js</code>, paste your Supabase project URL and anon key, and upload it again.</p>`;
  else if (mode === "signin" && me && me.email) body = `<h2>Welcome back${me.name ? ", " + esc(me.name) : ""}</h2><p class="lead">Enter your password to see your budget.</p>${m}
    <form id="fSignin"><input type="hidden" name="email" value="${esc(me.email)}">
    <div class="who-chip"><span>${esc(me.email)}</span><button class="linkish" type="button" data-auth="notme">Not ${me.name ? esc(me.name) : "you"}?</button></div>
    <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
    <input type="text" name="username" value="${esc(me.email)}" autocomplete="username" hidden>
    <button class="btn primary block" type="submit">Sign in</button></form>
    <div class="auth-foot"><button class="linkish" type="button" data-auth="forgot">Forgot your password?</button></div>`;
  else if (mode === "signin") body = `<h2>Welcome</h2><p class="lead">Sign in to see your budget.</p>${tabs}${m}
    <form id="fSignin"><label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
    <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn primary block" type="submit">Sign in</button></form>
    <div class="auth-foot"><button class="linkish" type="button" data-auth="forgot">Forgot your password?</button></div>`;
  else if (mode === "signup") body = `<h2>Create your account</h2><p class="lead">One account each. You can share a budget once you’re in the same household.</p>${tabs}${m}
    <form id="fSignup"><label class="field"><span>Your first name</span><input type="text" name="name" autocomplete="given-name" required></label>
    <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
    <label class="field"><span>Password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>
    <button class="btn primary block" type="submit">Create account</button></form>`;
  else if (mode === "forgot") body = `<h2>Reset your password</h2><p class="lead">We’ll email you a link to choose a new one.</p>${m}
    <form id="fForgot"><label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" value="${esc((me && me.email) || "")}" required></label>
    <button class="btn primary block" type="submit">Send reset link</button></form>
    <div class="auth-foot"><button class="linkish" type="button" data-auth="signin">Back to sign in</button></div>`;
  else if (mode === "check") body = `<h2>Check your email</h2><p class="lead">${esc(msg || "")}</p><div class="auth-foot"><button class="linkish" type="button" data-auth="signin">Back to sign in</button></div>`;
  else if (mode === "newpass") body = `<h2>Choose a new password</h2><p class="lead">Then you’ll go straight to your budget.</p>${m}
    <form id="fNewpass"><label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>
    <button class="btn primary block" type="submit">Save password</button></form>`;
  else if (mode === "household") {
    const email = app.session ? app.session.user.email : "";
    const nm = (app.session && app.session.user.user_metadata && app.session.user.user_metadata.name) || "";
    body = `<h2>Welcome${nm ? ", " + esc(nm) : ""}!</h2><p class="lead">A household holds one budget. Give yours a name, and we’ll help you set it up.</p>${m}
    <form id="fHousehold"><label class="field"><span>Household name</span><input type="text" name="name" value="${esc(nm ? nm + "’s budget" : "Our budget")}" required></label>
    <button class="btn primary block" type="submit">Create household</button></form>
    <div class="auth-foot"><span>Joining someone else’s? Ask them to invite <b>${esc(email)}</b>, then <button class="linkish" type="button" data-auth="recheck">check again</button>.</span><button class="linkish" type="button" data-auth="signout">Sign out</button></div>`;
  }
  else if (mode === "loading") body = `<p class="lead" style="margin:0">Loading…</p>`;
  el.innerHTML = `<div class="auth-card">${brand}${body}</div>`;
  const first = el.querySelector('form input:not([type="hidden"]):not([hidden])'); if (first) first.focus();
}
const authMsg = (text, kind) => { const m = $("#authMsg"); if (m) { m.className = "msg " + (kind || "err"); m.textContent = text; } };
export function friendly(err) {
  const t = (err && (err.message || err.error_description)) || "Something went wrong.";
  if (/invalid login credentials/i.test(t)) return "That email and password don’t match.";
  if (/email not confirmed/i.test(t)) return "Confirm your email first: open the link we sent you, then sign in.";
  if (/already registered|already exists/i.test(t)) return "There’s already an account with that email. Try signing in instead.";
  if (/rate limit|too many/i.test(t)) return "Too many attempts for now. Wait a few minutes and try again.";
  if (/failed to fetch|network/i.test(t)) return "Can’t reach the server. Check your connection and try again.";
  if (/should be different from the old/i.test(t)) return "That’s your current password. Choose a different one.";
  return t;
}
async function busy(form, fn) {
  const b = form.querySelector('button[type="submit"]'); const old = b.textContent; b.disabled = true; b.textContent = "One moment…";
  try { await fn(); } finally { if (b.isConnected) { b.disabled = false; b.textContent = old; } }
}

/* ---------- households ---------- */
async function loadMembers() {
  const { data, error } = await app.sb.from("household_members").select("user_id, display_name, email, role").eq("household_id", app.household.id).order("joined_at");
  const prof = offlineProfile();
  app.members = error && prof && prof.members ? (prof.members[app.household.id] || []) : (data || []);
}
async function loadHouseholds() {
  const { data, error } = await app.sb.from("household_members").select("household_id, role, households(name)").eq("user_id", app.meId).order("joined_at");
  if (error) {
    const prof = offlineProfile();
    if (isNetworkError(error) && prof && prof.user.id === app.meId && prof.households) { app.households = prof.households; return app.households; }
    throw error;
  }
  app.households = (data || []).map(r => ({ id: r.household_id, role: r.role, name: (r.households && r.households.name) || "Our budget" }));
  return app.households;
}

/** Open one household's budget: roles, saving, live updates, and the setup guide if it's empty. */
async function openHH(id) {
  if (app.store) { await app.store.stop(); app.store = null; }
  endSetup();
  const hh = app.households.find(h => h.id === id) || app.households[0];
  app.household = { id: hh.id, name: hh.name };
  app.role = hh.role;
  app.canWrite = hh.role !== "viewer";
  try { localStorage.setItem(lastHHKey(), hh.id); } catch (_) {}
  await loadMembers();
  app.store = createStore({
    sb: app.sb, householdId: hh.id,
    getState: () => app.state,
    setState: s => { app.state = s; },
    onStatus: (st, info) => {
      if (st === "saving") setStatus("Saving…", "wait");
      else if (st === "saved") showSaved(info);
      else if (st === "offline") setStatus("Offline", "offline", "You’re offline. Changes are kept on this phone and will sync when you’re back online.");
      else if (st === "error") setStatus("Couldn’t save", "off", /view-only/i.test((info && info.message) || "") ? "You have view-only access, so changes can’t be saved." : "Your last change didn’t save yet. It will keep trying; check your connection.");
    },
    onRemote: meta => applyRemoteView(meta),
  });
  const loaded = await app.store.load();
  document.body.classList.remove("signed-out"); $("#auth").hidden = true;
  app.loaded = true;
  app.offline = !!loaded.offline;
  saveOfflineProfile();
  if (loaded.state) { app.state = loaded.state; app.hasData = true; app.store.saveCache(); }
  else {
    const me = app.members.find(m => m.user_id === app.meId);
    app.state = blankBudget({ name: (me && me.display_name) || "" }); app.hasData = false;
    if (app.canWrite) startSetup();
  }
  render();
  if (loaded.upgraded && app.canWrite) { app.store.schedule(); toast("Your budget was upgraded to the new version. A backup of the old one was kept."); }
  else if (loaded.resumed && app.canWrite) { app.store.schedule(); toast("Saving the changes you made while offline…"); }
  else if (loaded.offline) { setStatus("Offline", "offline", "You’re offline. Changes are kept on this phone and will sync when you’re back online."); showConn(OFFLINE_MSG); }
  else showSaved(loaded.meta && { by: loaded.meta.updated_by, at: loaded.meta.updated_at });
  if (app.offline) return; // live updates start when the app reconnects
  app.store.subscribe(status => {
    if (status === "SUBSCRIBED") showConn(navigator.onLine === false ? OFFLINE_MSG : "");
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") showConn("Live updates are paused. Your changes still save; refresh to see others’ latest changes.");
  });
}

/** Re-read which households you're in (after creating, leaving or being removed), then open one. */
async function reloadHouseholds(preferId) {
  const list = await loadHouseholds();
  if (!list.length) { teardown(); showAuth("household"); return; }
  let last = null; try { last = localStorage.getItem(lastHHKey()); } catch (_) {}
  const pick = [preferId, app.household && app.household.id, last].find(id => id && list.some(h => h.id === id)) || list[0].id;
  await openHH(pick);
}

async function switchHousehold(id) {
  if (app.household && id === app.household.id) return;
  showAuth("loading");
  await openHH(id);
  toast(`Switched to ${app.household.name}`);
}

async function enterApp() {
  if (entering) return; entering = true;
  const sb = app.sb;
  try {
    showAuth("loading");
    app.meId = app.session.user.id;
    await sb.rpc("accept_invites");
    await sb.rpc("sync_my_profile"); // keep your name/email current in every household (harmless if it fails)
    rememberMe();
    if (recovering) { showAuth("newpass"); return; }
    await reloadHouseholds();
  } catch (e) { showAuth("signin", friendly(e)); }
  finally { entering = false; }
}

function teardown() {
  if (app.store) { app.store.stop(); app.store = null; }
  endSetup();
  app.household = null; app.households = []; app.members = []; app.meId = null; app.hasData = false; app.loaded = false; app.role = null;
  app.state = blankBudget();
  $("#app").innerHTML = ""; showConn(""); closePop();
  const d = $("#sheet"); if (d.open) d.close();
}
export async function signOut() {
  if (app.store) await app.store.flushNow();
  if (app.store && app.store.hasUnsaved() && !confirm("Some changes haven’t reached the server yet (you may be offline). Sign out anyway and lose them?")) return;
  // A signed-out device keeps no copy of your budgets (the "Welcome back" name stays).
  try { localStorage.removeItem(OFFLINE); } catch (_) {}
  clearDeviceCopies();
  await app.sb.auth.signOut();
}

/** Opened with no connection and no usable sign-in: use the copy kept on this device. */
async function enterOffline(prof) {
  app.session = { user: prof.user, offline: true };
  app.meId = prof.user.id;
  try { await reloadHouseholds(); } catch (_) { showAuth("signin", "You’re offline, and this budget isn’t saved on this device yet. Connect to sign in."); return; }
  showConn(OFFLINE_MSG);
}

export function initAuth(sb) {
  app.sb = sb;
  app.signOut = signOut;
  app.friendly = friendly;
  app.reloadHouseholds = reloadHouseholds;
  app.switchHousehold = switchHousehold;
  app.rememberMe = rememberMe;
  app.forgetMe = forgetMe;
  document.addEventListener("submit", async e => {
    const f = e.target; if (!f.id || !/^f[A-Z]/.test(f.id)) return; e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    if (f.id === "fSignin") await busy(f, async () => { const { error } = await sb.auth.signInWithPassword({ email: v.email.trim(), password: v.password }); if (error) authMsg(friendly(error)); });
    if (f.id === "fSignup") await busy(f, async () => {
      const { data, error } = await sb.auth.signUp({ email: v.email.trim(), password: v.password, options: { data: { name: v.name.trim() }, emailRedirectTo: here() } });
      if (error) return authMsg(friendly(error));
      if (!data.session) showAuth("check", `We’ve sent a confirmation link to ${v.email.trim()}. Open it on this device to finish creating your account.`);
    });
    if (f.id === "fForgot") await busy(f, async () => { const { error } = await sb.auth.resetPasswordForEmail(v.email.trim(), { redirectTo: here() }); if (error) return authMsg(friendly(error)); showAuth("check", `If there’s an account for ${v.email.trim()}, a reset link is on its way.`); });
    if (f.id === "fNewpass") await busy(f, async () => { const { error } = await sb.auth.updateUser({ password: v.password }); if (error) return authMsg(friendly(error)); recovering = false; toast("Password updated"); enterApp(); });
    if (f.id === "fHousehold") await busy(f, async () => { const { data, error } = await sb.rpc("create_household", { p_name: v.name }); if (error) return authMsg(friendly(error)); await reloadHouseholds(data); });
  });
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-auth]"); if (!a) return;
    const m = a.dataset.auth;
    if (m === "signout") signOut();
    else if (m === "recheck") enterApp();
    else if (m === "notme") { forgetMe(); showAuth("signin"); }
    else showAuth(m);
  });

  window.addEventListener("offline", () => { if (app.household) showConn(OFFLINE_MSG); });
  window.addEventListener("online", () => {
    if (app.session && app.session.offline) { location.reload(); return; } // sign in properly now; offline edits are kept and sent
    if (app.offline && app.household) { app.offline = false; reloadHouseholds(app.household.id); return; } // fetch the latest, merge offline edits
    showConn("");
  });

  if (/type=recovery/.test(location.hash)) recovering = true;
  showAuth("loading");
  sb.auth.onAuthStateChange((event, s) => {
    // Work is deferred so it never runs inside Supabase's own callback.
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") { recovering = true; app.session = s; showAuth("newpass"); return; }
      if (event === "SIGNED_OUT") { app.session = null; teardown(); showAuth("signin"); return; }
      if (!s) {
        if (event !== "INITIAL_SESSION") return;
        const prof = offlineProfile();
        if (navigator.onLine === false && prof) { enterOffline(prof); return; }
        showAuth("signin"); return;
      }
      const wasSignedIn = !!app.session; app.session = s;
      if (event === "USER_UPDATED") rememberMe();
      if (!recovering && !wasSignedIn) enterApp();
    }, 0);
  });
}

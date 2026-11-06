/* Signing in, creating an account, choosing a household, and the household/invites dialog. */
import { app } from "./ctx.js";
import { $, esc, toast, closePop } from "./dom.js";
import { render } from "./render.js";
import { createStore } from "../sync/store.js";
import { blankBudget } from "../model/schema.js";

const here = () => location.origin + location.pathname;
const brand = `<div class="auth-brand"><div class="logo" aria-hidden="true">$</div><div class="brand">My Budget<small>Plan where every dollar goes, together</small></div></div>`;

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
  if (!meta || !meta.at) { setStatus("Saved", "", "Changes save automatically."); return; }
  const when = new Date(meta.at).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }), who = nameOf(meta.by);
  setStatus("Saved", "", `Changes save automatically. Last change${who ? ` by ${who}` : ""}, ${when}.`);
}
const showConn = msg => { const c = $("#conn"); c.textContent = msg || ""; c.hidden = !msg; };

/** Redraw after someone else's change, keeping the cursor where it was. */
function applyRemoteView(meta) {
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
  let body = "";
  if (mode === "setup") body = `<h2>Almost there</h2><p class="lead">This app isn’t connected to its database yet. Open <code class="k">js/config.js</code>, paste your Supabase project URL and anon key, and upload it again.</p>`;
  else if (mode === "signin") body = `<h2>Welcome back</h2><p class="lead">Sign in to see your budget.</p>${tabs}${m}
    <form id="fSignin"><label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
    <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn primary block" type="submit">Sign in</button></form>
    <div class="auth-foot"><button class="linkish" type="button" data-auth="forgot">Forgot your password?</button></div>`;
  else if (mode === "signup") body = `<h2>Create your account</h2><p class="lead">One account each. You’ll share a budget once you’re in the same household.</p>${tabs}${m}
    <form id="fSignup"><label class="field"><span>Your first name</span><input type="text" name="name" autocomplete="given-name" required></label>
    <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
    <label class="field"><span>Password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>
    <button class="btn primary block" type="submit">Create account</button></form>`;
  else if (mode === "forgot") body = `<h2>Reset your password</h2><p class="lead">We’ll email you a link to choose a new one.</p>${m}
    <form id="fForgot"><label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
    <button class="btn primary block" type="submit">Send reset link</button></form>
    <div class="auth-foot"><button class="linkish" type="button" data-auth="signin">Back to sign in</button></div>`;
  else if (mode === "check") body = `<h2>Check your email</h2><p class="lead">${esc(msg || "")}</p><div class="auth-foot"><button class="linkish" type="button" data-auth="signin">Back to sign in</button></div>`;
  else if (mode === "newpass") body = `<h2>Choose a new password</h2><p class="lead">Then you’ll go straight to your budget.</p>${m}
    <form id="fNewpass"><label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>
    <button class="btn primary block" type="submit">Save password</button></form>`;
  else if (mode === "household") {
    const email = app.session ? app.session.user.email : "";
    const nm = (app.session && app.session.user.user_metadata && app.session.user.user_metadata.name) || "";
    body = `<h2>Set up your household</h2><p class="lead">A household holds one shared budget. Create it here, then invite others from the menu.</p>${m}
    <form id="fHousehold"><label class="field"><span>Household name</span><input type="text" name="name" value="${esc(nm ? nm + "’s budget" : "Our budget")}" required></label>
    <button class="btn primary block" type="submit">Create household</button></form>
    <div class="auth-foot"><span>Joining someone else’s? Ask them to invite <b>${esc(email)}</b>, then <button class="linkish" type="button" data-auth="recheck">check again</button>.</span><button class="linkish" type="button" data-auth="signout">Sign out</button></div>`;
  }
  else if (mode === "loading") body = `<p class="lead" style="margin:0">Loading…</p>`;
  el.innerHTML = `<div class="auth-card">${brand}${body}</div>`;
  const first = el.querySelector("form input"); if (first) first.focus();
}
const authMsg = (text, kind) => { const m = $("#authMsg"); if (m) { m.className = "msg " + (kind || "err"); m.textContent = text; } };
export function friendly(err) {
  const t = (err && (err.message || err.error_description)) || "Something went wrong.";
  if (/invalid login credentials/i.test(t)) return "That email and password don’t match.";
  if (/email not confirmed/i.test(t)) return "Confirm your email first: open the link we sent you, then sign in.";
  if (/already registered|already exists/i.test(t)) return "There’s already an account with that email. Try signing in instead.";
  if (/rate limit|too many/i.test(t)) return "Too many attempts for now. Wait a few minutes and try again.";
  if (/failed to fetch|network/i.test(t)) return "Can’t reach the server. Check your connection and try again.";
  return t;
}
async function busy(form, fn) {
  const b = form.querySelector('button[type="submit"]'); const old = b.textContent; b.disabled = true; b.textContent = "One moment…";
  try { await fn(); } finally { if (b.isConnected) { b.disabled = false; b.textContent = old; } }
}

/* ---------- entering the app ---------- */
async function loadMembers() {
  const { data } = await app.sb.from("household_members").select("user_id, display_name, email, role").eq("household_id", app.household.id).order("joined_at");
  app.members = data || [];
}

async function enterApp() {
  if (entering) return; entering = true;
  const sb = app.sb;
  try {
    showAuth("loading");
    app.meId = app.session.user.id;
    await sb.rpc("accept_invites");
    if (recovering) { showAuth("newpass"); return; }
    const { data: mine, error } = await sb.from("household_members").select("household_id, households(name)").eq("user_id", app.meId).order("joined_at");
    if (error) { showAuth("signin", friendly(error)); return; }
    if (!mine || !mine.length) { showAuth("household"); return; }
    app.household = { id: mine[0].household_id, name: (mine[0].households && mine[0].households.name) || "Our budget" };
    await loadMembers();
    app.store = createStore({
      sb, householdId: app.household.id,
      getState: () => app.state,
      setState: s => { app.state = s; },
      onStatus: (st, info) => {
        if (st === "saving") setStatus("Saving…", "wait");
        else if (st === "saved") showSaved(info);
        else if (st === "error") setStatus("Couldn’t save", "off", "Your last change didn’t save yet. It will keep trying; check your connection.");
      },
      onRemote: meta => applyRemoteView(meta),
    });
    let loaded;
    try { loaded = await app.store.load(); } catch (e2) { showAuth("signin", friendly(e2)); return; }
    if (recovering) { showAuth("newpass"); return; }
    document.body.classList.remove("signed-out"); $("#auth").hidden = true;
    app.loaded = true; app.canWrite = true;
    if (loaded.state) { app.state = loaded.state; app.hasData = true; }
    else {
      const me = app.members.find(m => m.user_id === app.meId);
      app.state = blankBudget({ name: (me && me.display_name) || "" }); app.hasData = false;
    }
    render();
    if (loaded.upgraded) { app.store.schedule(); toast("Your budget was upgraded to the new version. A backup of the old one was kept."); }
    else showSaved(loaded.meta && { by: loaded.meta.updated_by, at: loaded.meta.updated_at });
    app.store.subscribe(status => {
      if (status === "SUBSCRIBED") showConn("");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") showConn("Live updates are paused. Your changes still save; refresh to see others’ latest changes.");
    });
  } finally { entering = false; }
}

function teardown() {
  if (app.store) { app.store.stop(); app.store = null; }
  app.household = null; app.members = []; app.meId = null; app.hasData = false; app.loaded = false;
  app.state = blankBudget();
  $("#app").innerHTML = ""; showConn(""); closePop();
}
export async function signOut() {
  if (app.store) await app.store.flushNow();
  const d = $("#hh"); if (d.open) d.close();
  await app.sb.auth.signOut();
}

/* ---------- household dialog ---------- */
export async function openHousehold() {
  const d = $("#hh"); $("#hhMsg").textContent = ""; $("#hhMsg").className = "msg";
  $("#hhLead").textContent = `${app.household.name}: everyone listed here sees and edits the same budget.`;
  await loadMembers();
  $("#hhMembers").innerHTML = app.members.map(m => `<li><span>${esc(m.display_name || m.email)}${m.user_id === app.meId ? " (you)" : ""}<small>${esc(m.email)}</small></span><span class="chip ${m.role === "owner" ? "ok" : ""}">${m.role === "owner" ? "Owner" : "Member"}</span></li>`).join("");
  await loadInvites();
  if (!d.open) d.showModal();
}
async function loadInvites() {
  const { data } = await app.sb.from("household_invites").select("id, email, accepted_at").eq("household_id", app.household.id).is("accepted_at", null).order("created_at");
  $("#hhInvites").innerHTML = (data || []).map(i => `<li><span>${esc(i.email)}<small>Waiting for them to sign up and confirm their email</small></span><button class="btn small" type="button" data-uninvite="${esc(i.id)}">Cancel</button></li>`).join("");
  $("#hhInvites").hidden = !(data || []).length;
}

export function initAuth(sb) {
  app.sb = sb;
  app.openHousehold = openHousehold;
  app.signOut = signOut;
  document.addEventListener("submit", async e => {
    const f = e.target; if (!f.id || !f.id.startsWith("f")) return; e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    if (f.id === "fSignin") await busy(f, async () => { const { error } = await sb.auth.signInWithPassword({ email: v.email.trim(), password: v.password }); if (error) authMsg(friendly(error)); });
    if (f.id === "fSignup") await busy(f, async () => {
      const { data, error } = await sb.auth.signUp({ email: v.email.trim(), password: v.password, options: { data: { name: v.name.trim() }, emailRedirectTo: here() } });
      if (error) return authMsg(friendly(error));
      if (!data.session) showAuth("check", `We’ve sent a confirmation link to ${v.email.trim()}. Open it on this device to finish creating your account.`);
    });
    if (f.id === "fForgot") await busy(f, async () => { const { error } = await sb.auth.resetPasswordForEmail(v.email.trim(), { redirectTo: here() }); if (error) return authMsg(friendly(error)); showAuth("check", `If there’s an account for ${v.email.trim()}, a reset link is on its way.`); });
    if (f.id === "fNewpass") await busy(f, async () => { const { error } = await sb.auth.updateUser({ password: v.password }); if (error) return authMsg(friendly(error)); recovering = false; toast("Password updated"); enterApp(); });
    if (f.id === "fHousehold") await busy(f, async () => { const { error } = await sb.rpc("create_household", { p_name: v.name }); if (error) return authMsg(friendly(error)); enterApp(); });
  });
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-auth]"); if (!a) return;
    const m = a.dataset.auth;
    if (m === "signout") signOut(); else if (m === "recheck") enterApp(); else showAuth(m);
  });
  $("#hhForm").addEventListener("submit", async e => {
    e.preventDefault(); const email = $("#hhEmail").value.trim(); if (!email) return;
    const { error } = await sb.rpc("invite_member", { p_household: app.household.id, p_email: email });
    const m = $("#hhMsg");
    if (error) { m.className = "msg err"; m.textContent = friendly(error); return; }
    m.className = "msg ok"; m.textContent = `Invite saved. Ask them to open this page, choose “Create account” and use ${email}. They’ll join as soon as they sign in.`;
    $("#hhEmail").value = ""; loadInvites();
  });
  $("#hhInvites").addEventListener("click", async e => { const b = e.target.closest("[data-uninvite]"); if (!b) return; await sb.from("household_invites").delete().eq("id", b.dataset.uninvite); loadInvites(); });
  $("#hhClose").addEventListener("click", () => $("#hh").close());
  $("#hhSignOut").addEventListener("click", signOut);

  if (/type=recovery/.test(location.hash)) recovering = true;
  showAuth("loading");
  sb.auth.onAuthStateChange((event, s) => {
    // Work is deferred so it never runs inside Supabase's own callback.
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") { recovering = true; app.session = s; showAuth("newpass"); return; }
      if (event === "SIGNED_OUT") { app.session = null; teardown(); showAuth("signin"); return; }
      if (!s) { if (event === "INITIAL_SESSION") showAuth("signin"); return; }
      const wasSignedIn = !!app.session; app.session = s;
      if (!recovering && !wasSignedIn) enterApp();
    }, 0);
  });
}

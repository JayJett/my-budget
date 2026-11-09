/* Signing in, choosing and switching households, roles, and starting the setup guide. */
import { app } from "./ctx.js";
import { $, esc, toast, closePop, openPop } from "./dom.js";
import { render } from "./render.js";
import { createStore, isNetworkError, clearDeviceCopies } from "../sync/store.js";
import { blankBudget } from "../model/schema.js";
import { startSetup, endSetup, obHeader, modeChoices, rememberMode, pendingAccounts, resumeAccounts } from "./onboarding.js";
import { HERO } from "./hero-art.js";
import { loadSnapshots, ensureMonthly } from "./views/progress.js";
import { rememberChange, resetUndo, updateUndo, historyNoticeRemote } from "./history.js";
import { loadReminders, resetReminders, openFromHash } from "./reminders.js";
import { disablePush } from "./push.js";
import { useAccentOf, resetAccent } from "./accent.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";
import { calm } from "./motion.js";

const here = () => location.origin + location.pathname;
/* Emails with a code to type in (Phase 7A) need Supabase's email templates to include the code, and
   customising those needs your own email service (custom SMTP). Until then the emails are Supabase's
   standard ones, which contain a link only, so the app asks people to open the link. Set this to true
   once the templates include {{ .Token }} again (see docs/auth-setup.md): the code screens come back. */
export const EMAIL_CODES = false;
const what = () => EMAIL_CODES ? "code" : "link";

const brand = `<div class="auth-brand"><div class="logo" aria-hidden="true">$</div><div class="brand">Moni Money<small>Give every dollar a purpose, on your own or together</small></div></div>`;
/* The welcome (Phase 7C redesign): three slides you can swipe through, with the two buttons always
   underneath. Shown to someone new on this device; after they tap either button it isn't shown again
   here (anyone already remembered on this device gets "Welcome back" instead). */
const WELCOME_KEY = "mb-welcome-seen";
const welcomeSeen = () => { try { return localStorage.getItem(WELCOME_KEY) === "1"; } catch (_) { return true; } };
const markWelcome = () => { try { localStorage.setItem(WELCOME_KEY, "1"); } catch (_) {} };
const SLIDES = [
  ["plan", "Give every dollar a job", "Plan your pay in minutes, and see exactly where it goes."],
  ["together", "Better together", "Share one budget with a partner, each with your own login."],
  ["grow", "Watch it grow", "Goals, net worth and progress, all in one calm place."],
];
const welcomeHTML = () => `<div class="wl">
  <div class="wl-track" id="wlTrack" tabindex="0" role="region" aria-roledescription="carousel" aria-label="About Moni Money">
    ${SLIDES.map(([art, h, t], i) => `<section class="wl-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${SLIDES.length}"><div class="wl-text">${i === 0 ? `<h2 id="obTitle" tabindex="-1">${h}</h2>` : `<h2>${h}</h2>`}<p>${t}</p></div><div class="wl-art">${HERO[art]()}</div></section>`).join("")}
  </div>
  <div class="wl-dots" role="group" aria-label="Choose a slide">${SLIDES.map((_, i) => `<button type="button" data-wl="${i}" aria-label="Slide ${i + 1} of ${SLIDES.length}" aria-current="${i === 0}"></button>`).join("")}</div>
  <div class="wl-acts"><button class="btn primary block" type="button" data-auth="signup" data-welcome-done>Create account</button><button class="btn block im-outline" type="button" data-auth="signin" data-welcome-done>Sign in</button></div>
</div>`;
const backToWelcome = `<button class="im-back" type="button" data-auth="welcome" aria-label="Back"><svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg></button>`;

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
app.saveOfflineProfile = saveOfflineProfile;
const lastHHKey = () => `mb-household-${app.meId}`;

/* ---------- small helpers (Phase 7A) ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Give up waiting after `ms` (the request may still finish: callers check before doing anything twice). */
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("Timed out"), { timeout: true })), ms))]);
/** The sign-in itself is no longer valid (expired, revoked, or the database didn't see one). */
const isAuthError = e => !!e && (e.status === 401 || /jwt|not signed in|refresh token|session (has )?expired|invalid claim/i.test((e.message || "") + " " + (e.code || "")));

/* ---------- "check your email" in progress: remembered on this device, so a refresh doesn't lose it ----------
   Only the email address and which kind of code it is (never a code or a token). Cleared once you're signed in. */
const PENDING = "mb-verify";
const DAY_MS = 864e5;
function pending() { try { const p = JSON.parse(localStorage.getItem(PENDING) || "null"); return p && p.email && Date.now() - p.at < DAY_MS ? p : null; } catch (_) { return null; } }
function setPending(p) { try { localStorage.setItem(PENDING, JSON.stringify({ ...pending(), ...p, at: (pending() && pending().at) || Date.now() })); } catch (_) {} }
function startPending(email, kind) { try { localStorage.setItem(PENDING, JSON.stringify({ email, kind, at: Date.now() })); } catch (_) {} }
function clearPending() { try { localStorage.removeItem(PENDING); } catch (_) {} }

/* ---------- Google / Apple: only shown when this Supabase project has them switched on ----------
   The project's public auth settings say which providers are enabled, so a button never appears
   for a provider that would just fail. Nothing secret is involved. */
const PROVIDERS = { google: "Google", apple: "Apple" };
let providers = []; // e.g. ["apple", "google"], once known
async function loadProviders() {
  try {
    const r = await withTimeout(fetch(`${SUPABASE_URL.trim().replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY.trim() } }), 8000);
    if (!r.ok) return;
    const ext = (await r.json()).external || {};
    providers = Object.keys(PROVIDERS).filter(k => ext[k] === true).sort();
    const shown = $("#auth"); if (!shown.hidden && shown.querySelector("[data-oauth-slot]")) shown.querySelector("[data-oauth-slot]").outerHTML = oauthButtons();
  } catch (_) { /* unknown: show no provider buttons */ }
}
const ICON = {
  apple: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M11.2 8.5c0-1.6 1.3-2.3 1.4-2.4-.8-1.1-1.9-1.3-2.3-1.3-1-.1-1.9.6-2.4.6-.5 0-1.3-.6-2.1-.5-1.1 0-2.1.6-2.6 1.6-1.1 2-.3 4.9.8 6.5.5.8 1.2 1.6 2 1.6s1.1-.5 2.1-.5 1.2.5 2.1.5c.9 0 1.4-.8 1.9-1.6.6-.9.8-1.7.8-1.8 0 0-1.6-.6-1.7-2.7zM9.6 3.6c.4-.5.7-1.2.6-1.9-.6 0-1.4.4-1.8.9-.4.4-.7 1.1-.6 1.8.7.1 1.4-.3 1.8-.8z"/></svg>',
  google: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="#4285F4" d="M15.4 8.2c0-.5 0-1-.1-1.5H8v2.8h4.2c-.2 1-.7 1.8-1.5 2.3v1.9h2.4c1.4-1.3 2.3-3.2 2.3-5.5z"/><path fill="#34A853" d="M8 15.6c2 0 3.7-.7 5-1.8l-2.4-1.9c-.7.5-1.5.7-2.6.7-2 0-3.6-1.3-4.2-3.1H1.3v1.9C2.5 13.9 5 15.6 8 15.6z"/><path fill="#FBBC05" d="M3.8 9.5c-.3-.9-.3-1.9 0-2.8V4.8H1.3a7.6 7.6 0 0 0 0 6.6z"/><path fill="#EA4335" d="M8 3.4c1.1 0 2.1.4 2.9 1.1l2.1-2.1A7.3 7.3 0 0 0 1.3 4.8l2.5 1.9C4.4 4.8 6 3.4 8 3.4z"/></svg>',
};
const oauthButtons = () => `<div class="auth-alt" data-oauth-slot>${providers.length ? `<div class="auth-or"><span>or</span></div>${providers.map(p => `<button class="btn block oauth" type="button" data-oauth="${p}">${ICON[p]}Continue with ${PROVIDERS[p]}</button>`).join("")}` : ""}</div>`;

/* ---------- coming back from an email link or Google/Apple with an error ---------- */
function callbackError() {
  const raw = (location.hash || "").replace(/^#/, "") + "&" + (location.search || "").replace(/^\?/, "");
  const q = new URLSearchParams(raw), code = q.get("error_code") || q.get("error");
  if (!code) return null;
  // Remove it from the address bar (and any other sign-in leftovers), keeping only the app's own address
  try { history.replaceState(null, "", location.pathname); } catch (_) {}
  if (/otp_expired|expired/i.test(code + (q.get("error_description") || ""))) return "That link has expired or was already used. If you opened it before, your email is confirmed: sign in. Otherwise request a new code.";
  if (/access_denied/i.test(code)) return "Sign-in was cancelled. Choose how you’d like to sign in.";
  return "That sign-in didn’t work. Please try again.";
}

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
  if (meta !== undefined) lastSavedMeta = meta;
  if (livePaused) { setStatus("Live updates paused", "paused"); delete $("#saveState").dataset.tip; return; }
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
  if (meta && !meta.self && meta.by && meta.by !== app.meId) { toast(`Updated by ${nameOf(meta.by)}`); historyNoticeRemote(); }
}

/* ---------- sign-in screens ---------- */
let recovering = false, entering = false;
export function showAuth(mode, msg, kind) {
  document.body.classList.add("signed-out"); const el = $("#auth"); el.hidden = false; el.classList.add("im");
  setThemeColour(true);
  if (mode === "signin" && !msg && !remembered() && !welcomeSeen()) mode = "welcome";
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
    <button class="btn primary block" type="submit">Sign in</button></form>${oauthButtons()}
    <div class="auth-foot"><button class="linkish" type="button" data-auth="forgot">Forgot your password?</button><button class="linkish" type="button" data-auth="codein">Email me a sign-in ${what()} instead</button></div>`;
  else if (mode === "signin") body = `<h2>Welcome to Moni Money</h2><p class="lead">Sign in to see your budget.</p>${tabs}${m}
    <form id="fSignin"><label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
    <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn primary block" type="submit">Sign in</button></form>${oauthButtons()}
    <div class="auth-foot"><button class="linkish" type="button" data-auth="forgot">Forgot your password?</button><button class="linkish" type="button" data-auth="codein">Email me a sign-in ${what()} instead</button></div>`;
  else if (mode === "signup") body = `<h2>Create your account</h2><p class="lead">One account each. You can share a budget once you’re in the same household.</p>${tabs}${m}
    <form id="fSignup"><label class="field"><span>Your first name</span><input type="text" name="name" autocomplete="given-name" required></label>
    <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
    <label class="field"><span>Password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>
    <button class="btn primary block" type="submit">Create account</button></form>${oauthButtons()}`;
  else if (mode === "codein") body = `<h2>Sign in with ${EMAIL_CODES ? "a code" : "an email link"}</h2><p class="lead">We’ll email you a ${what()}. No password needed.</p>${m}
    <form id="fCodeIn"><label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" inputmode="email" value="${esc((pending() && pending().email) || (me && me.email) || "")}" required></label>
    <button class="btn primary block" type="submit">Email me a ${what()}</button></form>
    <div class="auth-foot"><button class="linkish" type="button" data-auth="signin">Sign in with a password</button></div>`;
  else if (mode === "verify") {
    const p = pending() || {}, wait = Math.max(0, Math.ceil(((p.until || 0) - Date.now()) / 1000));
    body = EMAIL_CODES ? `<h2>Check your email</h2><p class="lead">We sent an email to <b>${esc(p.email || "")}</b>. Enter the code from it here, or open the link in it. It can take a minute to arrive.</p>${m}
    <form id="fVerify" novalidate><label class="field"><span>Code from the email</span>
      <input class="otp" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" required aria-describedby="otpHelp" spellcheck="false"></label>
      <small class="field-help" id="otpHelp">Numbers only. You can paste the whole code.</small>
      <button class="btn primary block" type="submit">Verify</button></form>`
    : `<h2>Check your email</h2><p class="lead">We sent an email to <b>${esc(p.email || "")}</b>. Tap the link in it to ${p.kind === "signup" ? "confirm your email and carry on" : "sign in"}. It can take a minute to arrive, so check your spam folder too.</p>${m}
    <div id="vWait" class="v-wait"><span class="v-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.8 6.2 12 12.5l8.2-6.3"/></svg></span><p>Open it on this device for the quickest way back in.</p></div>`;
    body += `
    <div class="auth-foot"><button class="linkish" type="button" data-auth="resend"${wait ? " disabled" : ""}>${wait ? `Send a new ${what()} (${wait}s)` : `Send a new ${what()}`}</button>
      <button class="linkish" type="button" data-auth="${p.kind === "email" ? "codein" : "signup"}" data-forget="1">Use a different email</button>
      <button class="linkish" type="button" data-auth="signin" data-forget="1">${p.kind === "signup" ? "Already confirmed? Sign in" : "Back to sign in"}</button></div>`;
  }
  else if (mode === "loadfail") body = `<h2>Something went wrong</h2>${m}
    <button class="btn primary block" type="button" data-auth="recheck">Try again</button>
    <div class="auth-foot"><button class="linkish" type="button" data-auth="signout">Sign out</button></div>`;
  else if (mode === "forgot") body = `<h2>Reset your password</h2><p class="lead">We’ll email you a link to choose a new one.</p>${m}
    <form id="fForgot"><label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" value="${esc((me && me.email) || "")}" required></label>
    <button class="btn primary block" type="submit">Send reset link</button></form>
    <div class="auth-foot"><button class="linkish" type="button" data-auth="signin">Back to sign in</button></div>`;
  else if (mode === "check") body = `<h2>Check your email</h2><p class="lead">${esc(msg || "")}</p><div class="auth-foot"><button class="linkish" type="button" data-auth="signin">Back to sign in</button></div>`;
  else if (mode === "newpass") body = `<h2>Choose a new password</h2><p class="lead">Then you’ll go straight to your budget.</p>${m}
    <form id="fNewpass"><label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>
    <button class="btn primary block" type="submit">Save password</button></form>`;
  else if (mode === "household") {
    // Setup step 1 (Phase 7B): who's budgeting, and the household's name. Creating it is the same
    // reliable createHousehold() as Phase 7A. Nothing is chosen for you: pick the one that fits.
    const email = app.session ? app.session.user.email : "";
    const md = (app.session && app.session.user.user_metadata) || {};
    const nm = md.name || (md.full_name || "").trim().split(/\s+/)[0] || ""; // Google/Apple may give a full name, or none at all
    // Choosing never makes the screen taller: the name box and the invitation note share one slot,
    // and "Continue" and "Check for my invitation" share the button's place.
    body = `<div class="ob-art" aria-hidden="true">${HERO.together()}</div><h2 id="obTitle" tabindex="-1">Let’s make this yours</h2><p class="lead">${nm ? `Hi ${esc(nm)}! ` : ""}Are you budgeting on your own or with someone?</p>${m}
    <form id="fHousehold" data-suggest="${esc(nm ? nm + "’s budget" : "My budget")}">${modeChoices(null, true)}
      <div class="ob-slot"><div class="ob-name"><label class="field"><span>Household name <em>(you can change it later)</em></span><input type="text" name="name" value="${esc(nm ? nm + "’s budget" : "My budget")}" autocomplete="off" required></label></div>
      <div class="ob-join" hidden><p class="ob-note">Ask whoever set it up to invite <b>${esc(email)}</b> from Household settings, then check here.</p></div></div>
      <button class="btn primary block" type="submit" disabled>Continue</button>
      <button class="btn primary block ob-join-act" type="button" data-auth="recheck" hidden>Check for my invitation</button></form>`;
  }
  else if (mode === "loading") body = `<p class="lead" style="margin:0">Loading…</p>`;
  if (mode === "welcome") body = welcomeHTML();
  const back = ["signin", "signup", "codein", "forgot"].includes(mode) && !remembered() ? backToWelcome : "";
  el.innerHTML = mode === "household" ? `<div class="auth-card ob-auth">${obHeader(1, 0, `<button class="linkish ob-later" type="button" data-auth="signout">Sign out</button>`)}<div class="ob-in">${body}</div></div>`
    : mode === "welcome" ? `<div class="auth-card im-welcome"><div class="ob-top-row"><span class="ob-brand"><span class="logo sm" aria-hidden="true">$</span>Moni Money</span></div>${body}</div>`
    : `<div class="auth-card im-form">${back}${brand}${body}</div>`;
  if (mode === "welcome") initWelcome(el);
  const first = mode === "household" || mode === "welcome" ? el.querySelector("#obTitle") : el.querySelector('form input:not([type="hidden"]):not([hidden])'); if (first) first.focus({ preventScroll: true });
  if (mode === "verify") tickResend(); // a wait from an earlier "send a new code" carries on after a refresh
}
/** Safari's toolbar colour matches the dark screens while they're showing. */
const LIGHT_BAR = "#FFFFFF", IM_BAR = "#123F36";
export function setThemeColour(dark) {
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    if (!m.dataset.orig) m.dataset.orig = m.getAttribute("content") || LIGHT_BAR;
    m.setAttribute("content", dark ? IM_BAR : m.dataset.orig);
  });
}
/** The welcome slides: swipe (or use the dots, or the arrow keys); the dots follow along. */
function initWelcome(el) {
  const track = el.querySelector("#wlTrack"), dots = [...el.querySelectorAll("[data-wl]")];
  if (!track) return;
  const at = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const show = i => { const k = Math.max(0, Math.min(dots.length - 1, i)); track.scrollTo({ left: k * track.clientWidth, behavior: calm() ? "auto" : "smooth" }); };
  let raf = 0;
  track.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const i = at(); dots.forEach((d, k) => d.setAttribute("aria-current", String(k === i))); }); }, { passive: true });
  dots.forEach((d, k) => d.addEventListener("click", () => show(k)));
  track.addEventListener("keydown", e => { if (e.key === "ArrowRight") { e.preventDefault(); show(at() + 1); } if (e.key === "ArrowLeft") { e.preventDefault(); show(at() - 1); } });
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
  if (/token has expired|otp_expired|invalid.*(otp|token)|token.*invalid/i.test(t)) return "That code didn’t work, or it has expired. Check it, or request a new one.";
  if (/after \d+ seconds?/i.test(t)) return `Please wait a moment before asking for another ${what()}.`;
  if (isAuthError(err)) return "Your session has expired. Please sign in again.";
  if (/provider is not enabled|unsupported provider/i.test(t)) return "That way of signing in isn’t available right now. Use your email instead.";
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
  // Phase 8: each household's look comes too. Until the database has it, ask for the name alone.
  let { data, error } = await app.sb.from("household_members").select("household_id, role, households(name, appearance)").eq("user_id", app.meId).order("joined_at");
  if (error && /appearance|42703|column/i.test(`${error.code} ${error.message}`)) ({ data, error } = await app.sb.from("household_members").select("household_id, role, households(name)").eq("user_id", app.meId).order("joined_at"));
  if (error) {
    const prof = offlineProfile();
    if (isNetworkError(error) && prof && prof.user.id === app.meId && prof.households) { app.households = prof.households; return app.households; }
    throw error;
  }
  app.households = (data || []).map(r => ({ id: r.household_id, role: r.role, name: (r.households && r.households.name) || "Our budget",
    look: (r.households && r.households.appearance && typeof r.households.appearance === "object") ? r.households.appearance : {} }));
  return app.households;
}

/** Open one household's budget: roles, saving, live updates, and the setup guide if it's empty. */
async function openHH(id) {
  if (app.store) { await app.store.stop(); app.store = null; }
  livePaused = false; lastSavedMeta = null;
  endSetup();
  // Forget the last household's history views straight away, so nothing from it can show while this one loads
  app.snapshots = null; app.compareId = null; app.pgSel = null; app.snapshotsOffline = false;
  const hh = app.households.find(h => h.id === id) || app.households[0];
  app.household = { id: hh.id, name: hh.name, look: hh.look || {} };
  app.role = hh.role;
  app.canWrite = hh.role !== "viewer";
  try { localStorage.setItem(lastHHKey(), hh.id); } catch (_) {}
  await loadMembers();
  app.store = createStore({
    sb: app.sb, householdId: hh.id,
    getState: () => app.state,
    setState: s => { app.state = s; },
    onStatus: (st, info) => {
      app.saveStatus = st;
      if (st === "saving") setStatus("Saving…", "wait");
      else if (st === "saved") { app.saveErrShown = false; showSaved(info); }
      else if (st === "offline") setStatus("Offline", "offline", "You’re offline. Changes are kept on this phone and will sync when you’re back online.");
      else if (st === "error") {
        const ro = /view-only/i.test((info && info.message) || "");
        setStatus("Couldn’t save", "off", ro ? "You have view-only access, so changes can’t be saved." : "Your last change didn’t save yet. It will keep trying; check your connection.");
        // a failed save is never just a small dot: say it once, over the page (nothing moves)
        if (!app.saveErrShown) { app.saveErrShown = true; toast(ro ? "You have view-only access, so changes can’t be saved." : "Your last change didn’t save yet. It will keep trying; check your connection."); }
      }
    },
    onRemote: meta => applyRemoteView(meta),
    onSaved: data => rememberChange(data),
  });
  const loaded = await app.store.load();
  document.body.classList.remove("signed-out"); $("#auth").hidden = true; setThemeColour(false);
  app.loaded = true;
  app.offline = !!loaded.offline;
  app.snapshots = null; app.compareId = null;
  resetReminders();
  resetUndo(); // Undo only steps back through changes made in this household, this session
  saveOfflineProfile();
  if (loaded.state) {
    app.state = loaded.state; app.hasData = true; app.store.saveCache();
    // Phase 9A: refreshed during setup step 4 (the plan saved, accounts not yet): carry on there
    const pend = app.canWrite ? pendingAccounts() : null; if (pend) resumeAccounts(pend);
  }
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
  loadSnapshots();
  loadReminders();
  openFromHash();
  if (app.offline) return; // live updates start when the app reconnects
  ensureMonthly();
  liveSubscribe();
}

/* ---------- live updates (Phase 9C.2) ----------
   When the live connection drops (on iPhone it usually does when the app goes to the background), it
   no longer puts a banner in the page that pushes everything down. The header's status dot turns
   amber instead, and tapping it explains and offers to reconnect. The app also reconnects by itself
   when it comes back to the front or back online, and fetches anything it missed. Saving doesn't use
   the live connection, so a failed save is still shown loudly (see onStatus). */
let livePaused = false, lastSavedMeta = null;
function liveSubscribe() {
  if (!app.store || app.offline) return;
  const store = app.store;
  store.subscribe(status => {
    if (store !== app.store) return; // a household we've since left
    if (status === "SUBSCRIBED") {
      showConn(navigator.onLine === false ? OFFLINE_MSG : "");
      if (livePaused) { livePaused = false; store.catchUp().catch(() => {}); refreshLive(); }
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      if (status === "CLOSED" && !livePaused && document.visibilityState === "visible" && navigator.onLine !== false) return; // closed on purpose (switching household)
      livePaused = true; refreshLive();
    }
  });
}
function refreshLive() { if (app.saveStatus === "saved" || !app.saveStatus) showSaved(lastSavedMeta); }
function reconnectLive() { if (livePaused && app.household && navigator.onLine !== false) liveSubscribe(); }

/** Re-read which households you're in (after creating, leaving or being removed), then open one. */
async function reloadHouseholds(preferId) {
  const list = await loadHouseholds();
  if (!list.length) { closeHousehold(); showAuth("household"); return; }
  await openHH(pickHousehold(list, preferId));
}
/** Which household to open: the one asked for, else the one open now, else the last one used here, else the first. */
function pickHousehold(list, preferId) {
  let last = null; try { last = localStorage.getItem(lastHHKey()); } catch (_) {}
  return [preferId, app.household && app.household.id, last].find(id => id && list.some(h => h.id === id)) || list[0].id;
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
    clearPending(); // signed in: any "check your email" step is done
    await reloadHouseholds();
  } catch (e) {
    if (isAuthError(e)) showAuth("signin", "Your session has expired. Please sign in again.");
    else showAuth("loadfail", isNetworkError(e) ? "We couldn’t connect. Check your connection and try again." : "We couldn’t load your household. Try again.");
  }
  finally { entering = false; }
}

/** Close whatever household is open (its budget, history, reminders), but stay signed in.
    Phase 7A fix: this used to also forget who you are (app.meId), so a brand-new person on the
    "Create household" screen had no id: after creating a household the app looked for "households
    belonging to nobody", found none, and showed the same screen again (and a second tap made a
    second household). Only signing out forgets who you are now. */
function closeHousehold() {
  if (app.store) { app.store.stop(); app.store = null; }
  endSetup();
  app.household = null; app.households = []; app.members = []; app.hasData = false; app.loaded = false; app.role = null;
  resetUndo(); resetReminders();
  app.snapshots = null; app.compareId = null; app.pgSel = null; // nothing of the last person's history stays in memory
  app.state = blankBudget();
  $("#app").innerHTML = ""; showConn(""); closePop();
  const d = $("#sheet"); if (d.open) d.close();
}
/** Signing out: close the household and forget who was signed in. */
function teardown() { closeHousehold(); app.meId = null; }
export async function signOut() {
  if (app.store) await app.store.flushNow();
  if (app.store && app.store.hasUnsaved() && !confirm("Some changes haven’t reached the server yet (you may be offline). Sign out anyway and lose them?")) return;
  // A signed-out device keeps no copy of your budgets (the "Welcome back" name stays).
  try { localStorage.removeItem(OFFLINE); } catch (_) {}
  clearDeviceCopies();
  await disablePush(); // this device stops getting your notifications
  await app.sb.auth.signOut();
}

/* ---------- creating your first household (Phase 7A) ----------
   One tap, one household. Before creating, it checks whether you already have one (an earlier tap may
   have worked even though we never heard back), and after creating it confirms the household is really
   there and opens it. Every path ends in the setup guide or a clear message: never an endless spinner.
   create_household() makes the household, your owner membership and its empty budget in one database
   transaction, so there's never half a household. */
let creating = false;
async function loadHouseholdsWithin(ms) { return withTimeout(loadHouseholds(), ms); }
/** Look for your household(s) and open one. true if one was opened. */
async function openIfAny(preferId, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await loadHouseholdsWithin(15000);
      if (list.length) { await openHH(pickHousehold(list, preferId)); return true; }
    } catch (e) { if (isAuthError(e)) throw e; }
    if (i < tries - 1) await sleep(700 * (i + 1));
  }
  return false;
}
async function createHousehold(form, name) {
  if (creating) return;
  creating = true;
  const b = form.querySelector('button[type="submit"]'), label = b.textContent;
  b.disabled = true; b.textContent = "Creating your household…"; authMsg("", "info");
  try {
    if (await openIfAny(null, 1)) return; // already have one: open it, don't make another
    let res;
    try { res = await withTimeout(app.sb.rpc("create_household", { p_name: name }), 20000); } catch (e) { res = { error: e }; }
    if (res.error) {
      if (isAuthError(res.error)) { showAuth("signin", "Your session has expired. Please sign in again."); return; }
      if (res.error.timeout || isNetworkError(res.error)) {
        authMsg("Checking whether your household was created…", "info");
        if (await openIfAny(null)) return;
        authMsg("We couldn’t reach the server, so your household may not have been created. Check your connection, then tap Create household again.");
        return;
      }
      authMsg(friendly(res.error)); return;
    }
    if (await openIfAny(res.data)) return; // created, and it's there: on to the setup guide
    authMsg("Your household was created, but we couldn’t open it yet. Tap “check again” below.");
  } catch (e) {
    if (isAuthError(e)) showAuth("signin", "Your session has expired. Please sign in again.");
    else authMsg("We couldn’t finish setting up your household. Please try again.");
  } finally {
    creating = false;
    if (b.isConnected) { b.disabled = false; b.textContent = label; }
  }
}

/* ---------- email codes (Phase 7A) ----------
   kind "signup": confirming a new account (the same email also has a link).
   kind "email": signing in with a code instead of a password (existing accounts only).
   Supabase checks the code; we only move on once it has signed you in. */
let verifying = false;
async function verifyCode(form, token) {
  const p = pending(); if (!p) { showAuth("signin"); return; }
  if (verifying) return;
  if (token.length < 6) { authMsg("Enter the whole code from the email."); return; }
  verifying = true;
  const b = form.querySelector('button[type="submit"]'); b.disabled = true; b.textContent = "Checking…";
  try {
    const { data, error } = await withTimeout(app.sb.auth.verifyOtp({ email: p.email, token, type: p.kind === "email" ? "email" : "signup" }), 20000);
    if (error) {
      authMsg(p.kind === "signup" && /expired|invalid/i.test(error.message || "") ? friendly(error) + " If you already opened the link in the email, your email is confirmed: sign in instead." : friendly(error));
      const inp = form.querySelector(".otp"); if (inp) { inp.select(); }
      return;
    }
    if (data && data.session) { clearPending(); showAuth("loading"); } // signed in: the app opens from here
  } catch (e) { authMsg(e && e.timeout ? "We couldn’t connect. Check your connection and try again." : friendly(e)); }
  finally { verifying = false; if (b.isConnected) { b.disabled = false; b.textContent = "Verify"; } }
}
/** Ask for another code. Any waiting time comes from Supabase's own limit, never a guess. */
async function resendCode(btn) {
  const p = pending(); if (!p || btn.disabled) return;
  btn.disabled = true; btn.textContent = "Sending…";
  const opts = { emailRedirectTo: here() };
  const { error } = p.kind === "email"
    ? await app.sb.auth.signInWithOtp({ email: p.email, options: { ...opts, shouldCreateUser: false } })
    : await app.sb.auth.resend({ type: "signup", email: p.email, options: opts });
  const wait = error && /after (\d+) seconds?/i.exec(error.message || "");
  if (wait) setPending({ until: Date.now() + Number(wait[1]) * 1000 });
  showAuth("verify", error && !(p.kind === "email" && /signups? not allowed|not found/i.test(error.message || "")) ? friendly(error) : `A new ${what()} is on its way. It can take a minute to arrive.`, error && !/signups? not allowed|not found/i.test(error.message || "") ? "err" : "info");
  if (wait) tickResend();
}
let tick = null;
function tickResend() {
  clearInterval(tick);
  tick = setInterval(() => {
    const p = pending(), b = document.querySelector('[data-auth="resend"]');
    if (!p || !b) { clearInterval(tick); return; }
    const left = Math.max(0, Math.ceil(((p.until || 0) - Date.now()) / 1000));
    b.disabled = left > 0; b.textContent = left ? `Send a new ${what()} (${left}s)` : `Send a new ${what()}`;
    if (!left) clearInterval(tick);
  }, 1000);
}

/** Opened with no connection and no usable sign-in: use the copy kept on this device. */
async function enterOffline(prof) {
  app.session = { user: prof.user, offline: true };
  useAccentOf(prof.user);
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
      if (!data.session) { startPending(v.email.trim(), "signup"); showAuth("verify"); }
    });
    if (f.id === "fForgot") await busy(f, async () => { const { error } = await sb.auth.resetPasswordForEmail(v.email.trim(), { redirectTo: here() }); if (error) return authMsg(friendly(error)); showAuth("check", `If there’s an account for ${v.email.trim()}, a reset link is on its way.`); });
    if (f.id === "fNewpass") await busy(f, async () => { const { error } = await sb.auth.updateUser({ password: v.password }); if (error) return authMsg(friendly(error)); recovering = false; toast("Password updated"); enterApp(); });
    if (f.id === "fHousehold") { if (!v.obmode || v.obmode === "join") return; rememberMode(v.obmode); await createHousehold(f, v.name); }
    if (f.id === "fVerify") await verifyCode(f, (v.code || "").replace(/\D/g, ""));
    if (f.id === "fCodeIn") await busy(f, async () => {
      const email = v.email.trim();
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: here() } });
      // Never say whether an account exists: "no such user" looks the same as success. Rate limits and connection problems are real, so say those.
      if (error && (/rate limit|too many|after \d+ seconds|failed to fetch|network/i.test(error.message || ""))) return authMsg(friendly(error));
      startPending(email, "email"); showAuth("verify", `If there’s an account for ${email}, a ${what()} is on its way.`, "info");
    });
  });
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-auth]"); if (!a) return;
    const m = a.dataset.auth;
    if (a.dataset.welcomeDone !== undefined) markWelcome();
    if (a.dataset.forget) clearPending();
    if (m === "resend") { resendCode(a); return; }
    if (m === "signout") signOut();
    else if (m === "recheck") enterApp();
    else if (m === "notme") { forgetMe(); showAuth("signin"); }
    else showAuth(m);
  });
  // Setup step 1: show the name box for "just me" / "with someone", the invitation note for "joining"
  document.addEventListener("change", e => {
    const r = e.target; if (r.name !== "obmode" || !r.closest("#fHousehold")) return;
    const f = r.closest("#fHousehold"), join = r.value === "join", nameIn = f.querySelector('[name="name"]');
    f.querySelector(".ob-name").hidden = join; f.querySelector(".ob-join").hidden = !join;
    f.querySelector('button[type="submit"]').hidden = join; f.querySelector('button[type="submit"]').disabled = join;
    f.querySelector(".ob-join-act").hidden = !join;
    if (!join && !nameIn.dataset.edited) nameIn.value = r.value === "with" ? "Our budget" : f.dataset.suggest;
  });
  document.addEventListener("input", e => { if (e.target.name === "name" && e.target.closest("#fHousehold")) e.target.dataset.edited = "1"; });
  // Google / Apple: leaves for the provider and comes back here signed in (or with an error, handled on return)
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-oauth]"); if (!b || b.disabled) return;
    b.disabled = true; const old = b.innerHTML; b.textContent = "Opening " + PROVIDERS[b.dataset.oauth] + "…";
    const { error } = await sb.auth.signInWithOAuth({ provider: b.dataset.oauth, options: { redirectTo: here() } });
    if (error) { b.disabled = false; b.innerHTML = old; authMsg(friendly(error)); }
  });
  // Pasting or auto-filling the whole code (iPhone offers it from Mail/Messages) verifies straight away
  document.addEventListener("input", e => {
    const el = e.target; if (!el.matches || !el.matches("#fVerify .otp")) return;
    const digits = el.value.replace(/\D/g, "").slice(0, 10); if (digits !== el.value) el.value = digits;
    if (digits.length >= 6 && e.inputType !== "insertText" && e.inputType !== "deleteContentBackward") el.form.requestSubmit();
  });

  window.addEventListener("offline", () => { if (app.household) showConn(OFFLINE_MSG); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reconnectLive(); });
  // the amber dot: what it means, and a way to reconnect now
  document.addEventListener("click", e => {
    const ss = e.target.closest && e.target.closest("#saveState.paused"); if (!ss) return;
    e.preventDefault(); e.stopPropagation();
    openPop(ss, `<div class="live-pop"><b>Live updates paused</b><p>Your changes still save. Changes other people make may not show until it reconnects.</p><button class="btn primary small" type="button" data-live="retry">Reconnect</button></div>`, b => { if (b.dataset.live === "retry") { closePop(); reconnectLive(); } }, { label: "Live updates" });
  }, true);
  document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("#saveState.paused")) { e.preventDefault(); e.target.click(); } });
  window.addEventListener("online", () => {
    if (app.session && app.session.offline) { location.reload(); return; } // sign in properly now; offline edits are kept and sent
    if (app.offline && app.household) { app.offline = false; reloadHouseholds(app.household.id).then(updateUndo); return; } // fetch the latest, merge offline edits
    showConn(""); reconnectLive();
  });

  if (/type=recovery/.test(location.hash)) recovering = true;
  const cbErr = callbackError();
  loadProviders();
  showAuth("loading");
  sb.auth.onAuthStateChange((event, s) => {
    // Work is deferred so it never runs inside Supabase's own callback.
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") { recovering = true; app.session = s; showAuth("newpass"); return; }
      if (event === "SIGNED_OUT") { app.session = null; resetAccent(); teardown(); showAuth("signin"); return; }
      if (!s) {
        if (event !== "INITIAL_SESSION") return;
        const prof = offlineProfile();
        if (navigator.onLine === false && prof) { enterOffline(prof); return; }
        if (cbErr) { showAuth("signin", cbErr); return; }
        if (pending()) { showAuth("verify"); return; } // refreshed (or came back) while waiting for the email code
        showAuth("signin"); return;
      }
      const wasSignedIn = !!app.session; app.session = s;
      useAccentOf(s.user); // your own colour (or the default), never the last person's
      if (event === "USER_UPDATED") rememberMe();
      if (!recovering && !wasSignedIn) enterApp();
    }, 0);
  });
}

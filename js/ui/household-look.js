/* Phase 8: how a household looks (its colour, an icon, or a photo).

   - It belongs to the HOUSEHOLD, so everyone in it sees the same thing. It's kept on the household
     itself (households.appearance, see supabase/migrations/..._household_identity.sql), so the
     household switcher can show every household's look, not just the open one.
   - Only owners and editors can change it (the database checks this too). Viewers see it.
   - A photo lives in a PRIVATE bucket ("household-photos"), in a folder named after the household:
     only people in that household can see it, through a short-lived signed link. The same crop step
     as profile pictures (ui/profile.js): a small 320×320 JPEG, the photo's hidden details dropped.
   - Nothing chosen (or the database update isn't in yet): the household's initial on a colour picked
     from its id, so each household still looks different.
   - Separate from your own profile picture (the menu button) and from people's colours in charts. */
import { app, readOnly } from "./ctx.js";
import { $, esc, toast, confirmDel } from "./dom.js";
import { OBJECT_COLOURS, isObjectColour } from "./palette.js";
import { ITEM_ICONS, itemIcon } from "./icons.js";
import { checkFile, loadImage, cropper } from "./profile.js";

export const HH_BUCKET = "household-photos";
const HH_ICONS = ["home", "family", "heart", "paw", "building", "key", "star", "sun", "plane", "piggy", "sprout", "gift"];
const KEY = id => `mb-hhphoto-${id}`;
const read = id => { try { return JSON.parse(localStorage.getItem(KEY(id)) || "null"); } catch (_) { return null; } };
const write = (id, v) => { try { if (v) localStorage.setItem(KEY(id), JSON.stringify(v)); else localStorage.removeItem(KEY(id)); } catch (_) {} };

/** The household's look ({} when nothing's chosen, or the database doesn't have it yet). */
export const lookOf = h => (h && h.look && typeof h.look === "object") ? h.look : {};
/** A colour for a household that hasn't chosen one: the same one every time, from its id. */
export function defaultColour(h) {
  const s = String((h && h.id) || ""); let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
  return OBJECT_COLOURS[x % OBJECT_COLOURS.length].key;
}
export const colourOf = h => isObjectColour(lookOf(h).colour) ? lookOf(h).colour : defaultColour(h);
const initialOf = h => ((h && h.name) || "?").trim().charAt(0).toUpperCase() || "?";

/* ---------- the photo link ---------- */
function photoSrc(h) {
  const path = lookOf(h).photo; if (!path || !h) return null;
  const c = read(h.id);
  if (c && c.path === path && c.src && (!c.exp || c.exp > Date.now() + 60e3)) return c.src;
  fetchLink(h, path);
  return c && c.path === path && c.copy ? c.copy : null;
}
const fetching = new Set();
async function fetchLink(h, path) {
  if (fetching.has(path) || !app.sb || !app.sb.storage || (app.session && app.session.offline)) return;
  fetching.add(path);
  try {
    const { data, error } = await app.sb.storage.from(HH_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (error || !data || !data.signedUrl) return;
    write(h.id, { ...(read(h.id) || {}), path, src: data.signedUrl, exp: Date.now() + 6.5 * 864e5 });
    refreshHouseholdAvatars();
  } finally { fetching.delete(path); }
}

/** A household's avatar: its photo, else its icon, else its initial; always on its colour. */
export function hhAvatarHTML(h, size = "") {
  const k = colourOf(h), L = lookOf(h), src = photoSrc(h), ic = itemIcon(L.icon);
  const inner = src ? `<img src="${esc(src)}" alt="" data-hh-img="${esc(h.id)}" onerror="this.remove()"><i>${esc(initialOf(h))}</i>` : ic || esc(initialOf(h));
  return `<span class="hh-av ${size}${src ? " photo" : ic ? " icon" : ""}" data-oc="${esc(k)}" data-hh-av="${esc((h && h.id) || "")}" aria-hidden="true">${inner}</span>`;
}
/** Redraw every household avatar on screen. */
export function refreshHouseholdAvatars() {
  document.querySelectorAll("[data-hh-av]").forEach(el => {
    const h = app.household && app.household.id === el.dataset.hhAv ? app.household : (app.households || []).find(x => x.id === el.dataset.hhAv);
    if (h) el.outerHTML = hhAvatarHTML(h, [...el.classList].find(c => ["sm", "md", "lg", "xl"].includes(c)) || "");
  });
  const p = $("#hhLookPrev"); if (p && app.household) p.innerHTML = hhAvatarHTML(app.household, "xl");
}

/* ---------- Household settings: "How it looks" ---------- */
const canEdit = () => !readOnly() && ["owner", "editor"].includes(app.role);
export function lookSection() {
  const h = app.household; if (!h) return "";
  const L = lookOf(h), ed = canEdit(), dis = ed ? "" : " disabled", cur = colourOf(h);
  const sw = c => `<button type="button" role="radio" class="oc-sw" data-hh-oc="${c.key}" data-oc="${c.key}" aria-checked="${cur === c.key}" aria-label="${esc(c.label)}"${dis}></button>`;
  const ib = (k, inner, label) => `<button type="button" role="radio" data-hh-icon="${esc(k)}" aria-checked="${(L.icon || "") === k}" aria-label="${esc(label)}"${dis}>${inner}</button>`;
  return `<section class="set hh-look" id="hhLookSec"><h4>How it looks</h4>
    <div class="hh-look-top"><span id="hhLookPrev">${hhAvatarHTML(h, "xl")}</span>
      <div class="hh-look-acts">${ed ? `<button class="btn small soft" type="button" data-hh-photo="pick">${L.photo ? "Change photo" : "Add a photo"}</button>${L.photo ? `<button class="btn small ghost" type="button" data-hh-photo="remove">Remove photo</button>` : ""}` : ""}
        <small>${ed ? "Everyone in the household sees this." : "Owners and editors can change this."}</small></div></div>
    ${ed ? `<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-hh-file hidden>
    <div class="msg" id="mHHLook" role="status" aria-live="polite"></div>
    <div class="prof-crop" id="hhCropBox" hidden>
      <canvas class="prof-canvas" tabindex="0" aria-label="The household photo. Drag, or use the arrow keys, to move it inside the circle."></canvas>
      <label class="prof-zoom"><span>Zoom</span><input type="range" min="1" max="3" step="0.01" value="1" data-crop-zoom></label>
      <div class="prof-crop-acts"><button class="btn" type="button" data-hh-photo="cancel">Cancel</button><button class="btn primary" type="button" data-hh-photo="save">Save photo</button></div>
    </div>` : ""}
    <div class="oc-row"><span class="bs-label">Colour</span><div class="oc-pick" role="radiogroup" aria-label="Household colour">${OBJECT_COLOURS.map(sw).join("")}</div></div>
    <div class="oc-row"><span class="bs-label">${L.photo ? "Icon (shown if there’s no photo)" : "Icon"}</span><div class="ico-pick hh-icons" role="radiogroup" aria-label="Household icon">${ib("", `<b>${esc(initialOf(h))}</b>`, "Initial")}${HH_ICONS.map(k => ib(k, itemIcon(k), (ITEM_ICONS.find(i => i.key === k) || {}).label || k)).join("")}</div></div>
  </section>`;
}
const msg = (text, kind = "err") => { const m = $("#mHHLook"); if (m) { m.className = "msg " + kind; m.textContent = text; } };
const notReady = e => /PGRST202|Could not find the function|does not exist|schema cache/i.test(`${e && e.code} ${e && e.message}`);
const NOT_READY = "Household looks need a quick database update first (see the Phase 8 notes). Everything else still works.";

/* Saving: the newest choice wins. Tapping through colours quickly sends one save at a time, and only
   the last one counts; if a save fails, the look goes back to what was last saved. */
let saved = null, want = null, busy = false;
async function saveLook(next) {
  const h = app.household; if (!h || !canEdit()) return;
  if (saved === null) saved = { ...lookOf(h) };
  want = next; setLook(h, next);
  if (busy) return;
  busy = true;
  try {
    while (want) {
      const send = want; want = null;
      const { data, error } = await app.sb.rpc("set_household_appearance", { p_household: h.id, p_appearance: send });
      if (error) { want = null; setLook(h, saved); msg(notReady(error) ? NOT_READY : (app.friendly ? app.friendly(error) : error.message)); return false; }
      saved = { ...(data || send) };
      if (!want) setLook(h, saved);
    }
    if (app.saveOfflineProfile) app.saveOfflineProfile();
    msg("Saved.", "ok"); return true;
  } finally { busy = false; }
}
/** Show a look everywhere: the open household and its entry in the switcher list stay the same. */
function setLook(h, L) {
  h.look = { ...L }; const e = (app.households || []).find(x => x.id === h.id); if (e) e.look = { ...L };
  refreshHouseholdAvatars(); syncControls();
}
function syncControls() {
  const h = app.household, L = lookOf(h), k = colourOf(h);
  document.querySelectorAll("[data-hh-oc]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.hhOc === k)));
  document.querySelectorAll("[data-hh-icon]").forEach(b => b.setAttribute("aria-checked", String((L.icon || "") === b.dataset.hhIcon)));
}

/* ---------- the photo ---------- */
let crop = null;
async function savePhoto(blob) {
  const h = app.household; if (!h || !app.sb) throw new Error("You need to be signed in.");
  if (!blob || blob.size > 512 * 1024) throw new Error("That picture is too big to save. Try zooming in a little.");
  const old = lookOf(h).photo, path = `${h.id}/${Date.now()}.jpg`, bucket = app.sb.storage.from(HH_BUCKET);
  const up = await bucket.upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
  if (up.error) throw new Error(/not found|bucket/i.test(up.error.message || "") ? NOT_READY : /row-level security/i.test(up.error.message || "") ? "Only owners and editors can change the household photo." : (app.friendly ? app.friendly(up.error) : up.error.message));
  const ok = await saveLook({ ...lookOf(h), photo: path });
  if (!ok) { await bucket.remove([path]); throw new Error("We couldn’t save the photo."); }
  const copy = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(null); fr.readAsDataURL(blob); });
  write(h.id, { path, copy, src: copy, exp: 0 });
  if (old && old !== path && old.startsWith(h.id + "/")) bucket.remove([old]); // only this household's folder
  refreshHouseholdAvatars();
}
async function removePhoto() {
  const h = app.household, old = lookOf(h).photo; if (!old) return;
  const { photo, ...rest } = lookOf(h);
  const ok = await saveLook(rest); if (!ok) return;
  write(h.id, null);
  if (old.startsWith(h.id + "/")) app.sb.storage.from(HH_BUCKET).remove([old]);
  refreshHouseholdAvatars();
}
function redrawSection() { const s = $("#hhLookSec"); if (s) s.outerHTML = lookSection(); saved = null; }

export function initHouseholdLook() {
  document.addEventListener("click", async e => {
    const c = e.target.closest("[data-hh-oc]");
    if (c && !c.disabled) { const h = app.household; if (colourOf(h) === c.dataset.hhOc && isObjectColour(lookOf(h).colour)) return; saveLook({ ...lookOf(h), colour: c.dataset.hhOc }); return; }
    const i = e.target.closest("[data-hh-icon]");
    if (i && !i.disabled) { const h = app.household, L = { ...lookOf(h) }; if ((L.icon || "") === i.dataset.hhIcon) return; if (i.dataset.hhIcon) L.icon = i.dataset.hhIcon; else delete L.icon; saveLook(L); return; }
    const p = e.target.closest("[data-hh-photo]"); if (!p || p.disabled) return;
    const act = p.dataset.hhPhoto, box = $("#hhCropBox");
    if (act === "pick") { $("[data-hh-file]").click(); return; }
    if (act === "cancel") { crop = null; box.hidden = true; msg("", "info"); return; }
    if (act === "save") {
      if (!crop) return;
      p.disabled = true; p.textContent = "Saving…"; msg("", "info");
      try { await savePhoto(await crop.blob()); crop = null; toast("Household photo saved", "ok"); redrawSection(); }
      catch (err) { msg(`${err.message} The household’s look hasn’t changed.`); p.disabled = false; p.textContent = "Try again"; }
      return;
    }
    if (act === "remove") {
      if (!(await confirmDel("Remove the household photo?", "Its icon or initial shows instead. You can add a photo again any time.", "Remove"))) return;
      await removePhoto(); toast("Household photo removed"); redrawSection();
    }
  });
  document.addEventListener("change", async e => {
    if (!e.target.matches || !e.target.matches("[data-hh-file]")) return;
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    const bad = checkFile(f); if (bad) { msg(bad); return; }
    try {
      const img = await loadImage(f), box = $("#hhCropBox");
      crop = cropper(img).mount(box); box.hidden = false; msg("Drag to position, zoom if you like, then save.", "info");
      box.querySelector("canvas").focus({ preventScroll: true });
    } catch (err) { msg(err.message); }
  });
  // an expired link: fetch a fresh one
  document.addEventListener("error", e => {
    if (!e.target || !e.target.matches || !e.target.matches("[data-hh-img]")) return;
    const id = e.target.dataset.hhImg, c = read(id); if (c) write(id, { ...c, src: null, exp: 0 });
  }, true);
}

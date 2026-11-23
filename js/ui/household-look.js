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
import { settingsScope, settingsStorage } from "./settings-scope.js";
import { $, esc, toast, confirmDel } from "./dom.js";
import { OBJECT_COLOURS, isObjectColour } from "./palette.js";
import { ITEM_ICONS, itemIcon } from "./icons.js";
import { checkFile, loadImage, cropper } from "./profile.js";

export const HH_BUCKET = "household-photos";
const HH_ICONS = ["home", "family", "heart", "paw", "building", "key", "star", "sun", "plane", "piggy", "sprout", "gift"];
const KEY = id => `mb-hhphoto-${app.meId}-${id}`;
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
const fetching = new WeakMap();
async function fetchLink(h, path) {
  const store = app.store;
  if (!store?.isActive()) return;
  if (!fetching.has(store)) fetching.set(store, new Set());
  const paths = fetching.get(store);
  if (paths.has(path)) return;
  paths.add(path);
  try {
    const { data, error } = await store.withSession(token => settingsStorage(token).from(HH_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7));
    if (!store.isActive() || lookOf(h).photo !== path || error || !data?.signedUrl) return;
    write(h.id, { ...(read(h.id) || {}), path, src: data.signedUrl, exp: Date.now() + 6.5 * 864e5 });
    refreshHouseholdAvatars();
  } finally { paths.delete(path); }
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
export function lookSection(ed = canEdit()) {
  const h = app.household; if (!h) return "";
  const L = lookOf(h), dis = ed ? "" : " disabled", cur = colourOf(h);
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

/* Serialize saves for this store so rapid colour and icon choices compose in order. */
const pending = new WeakMap();
function queueLook(scope, action) {
  const { store, current } = scope;
  const task = (pending.get(store) || Promise.resolve()).then(async () => {
    if (!current()) return;
    try { await action(); }
    catch (error) { if (current()) msg(app.friendly ? app.friendly(error) : error.message); }
  });
  pending.set(store, task);
  return task;
}

async function saveLook(scope, next) {
  const h = scope.household;
  const { data, error } = await scope.rpc("set_household_appearance", { p_appearance: next });
  if (!scope.current()) return false;
  if (error) { msg(notReady(error) ? NOT_READY : (app.friendly ? app.friendly(error) : error.message)); return false; }
  h.look = { ...(data || next) };
  const entry = app.households.find(x => x.id === h.id);
  if (entry) entry.look = { ...h.look };
  refreshHouseholdAvatars();
  const L = lookOf(h), k = colourOf(h);
  scope.body.querySelectorAll("[data-hh-oc]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.hhOc === k)));
  scope.body.querySelectorAll("[data-hh-icon]").forEach(b => b.setAttribute("aria-checked", String((L.icon || "") === b.dataset.hhIcon)));
  app.saveOfflineProfile?.();
  msg("Saved.", "ok");
  return true;
}

const crops = new WeakMap();
const storage = (scope, action) => scope.store.withSession(token => action(settingsStorage(token).from(HH_BUCKET)), scope.current);
const redraw = scope => { scope.body.querySelector("#hhLookSec").outerHTML = lookSection(); };

async function savePhoto(scope, blob) {
  if (!blob || blob.size > 512 * 1024) throw new Error("That picture is too big to save. Try zooming in a little.");
  const h = scope.household, old = lookOf(h).photo;
  const path = `${h.id}/${Date.now()}.jpg`;
  const { error } = await storage(scope, bucket => bucket.upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" }));
  if (!scope.current()) return;
  if (error) throw new Error(/not found|bucket/i.test(error.message || "") ? NOT_READY : error.message);
  const ok = await saveLook(scope, { ...lookOf(h), photo: path });
  if (!scope.current()) return;
  if (!ok) { await storage(scope, bucket => bucket.remove([path])); return; }
  const copy = await new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.onerror = () => r(null);
    fr.readAsDataURL(blob);
  });
  if (!scope.current()) return;
  write(h.id, { path, copy, src: copy, exp: 0 });
  if (old && old !== path && old.startsWith(h.id + "/")) await storage(scope, bucket => bucket.remove([old]));
  if (!scope.current()) return;
  refreshHouseholdAvatars();
  crops.delete(scope);
  toast("Household photo saved", "ok");
  redraw(scope);
}

async function removePhoto(scope) {
  const h = scope.household, { photo, ...rest } = lookOf(h);
  if (!photo || !await saveLook(scope, rest) || !scope.current()) return;
  write(h.id, null);
  if (photo.startsWith(h.id + "/")) await storage(scope, bucket => bucket.remove([photo]));
  if (!scope.current()) return;
  refreshHouseholdAvatars();
  toast("Household photo removed");
  redraw(scope);
}

export function initHouseholdLook() {
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-hh-oc], [data-hh-icon], [data-hh-photo]");
    if (!b || b.disabled) return;
    const scope = settingsScope(b);
    if (!scope || !canEdit()) return;
    const { hhOc, hhIcon, hhPhoto } = b.dataset;
    if (hhOc) return queueLook(scope, () => {
      const L = lookOf(scope.household);
      if (L.colour !== hhOc) return saveLook(scope, { ...L, colour: hhOc });
    });
    if (hhIcon !== undefined) return queueLook(scope, () => {
      const { icon, ...rest } = lookOf(scope.household);
      if ((icon || "") !== hhIcon) return saveLook(scope, hhIcon ? { ...rest, icon: hhIcon } : rest);
    });
    if (hhPhoto === "pick") { scope.body.querySelector("[data-hh-file]").click(); return; }
    if (hhPhoto === "cancel") {
      crops.delete(scope); scope.body.querySelector("#hhCropBox").hidden = true; msg("", "info"); return;
    }
    if (hhPhoto === "save") {
      const crop = crops.get(scope);
      if (!crop) return;
      b.disabled = true; b.textContent = "Saving…"; msg("", "info");
      await queueLook(scope, async () => {
        const blob = await crop.blob();
        if (scope.current()) await savePhoto(scope, blob);
      });
      if (scope.current() && b.isConnected) { b.disabled = false; b.textContent = "Try again"; }
      return;
    }
    if (hhPhoto === "remove" && await confirmDel("Remove the household photo?", "Its icon or initial shows instead. You can add a photo again any time.", "Remove") && scope.current()) {
      await queueLook(scope, () => removePhoto(scope));
    }
  });
  document.addEventListener("change", async e => {
    const input = e.target;
    if (!input.matches("[data-hh-file]")) return;
    const scope = settingsScope(input);
    if (!scope || !canEdit()) return;
    const f = input.files && input.files[0]; input.value = "";
    const bad = checkFile(f); if (bad) { msg(bad); return; }
    try {
      const img = await loadImage(f);
      if (!scope.current() || !input.isConnected) return;
      const box = scope.body.querySelector("#hhCropBox");
      crops.set(scope, cropper(img).mount(box));
      box.hidden = false; msg("Drag to position, zoom if you like, then save.", "info");
      box.querySelector("canvas").focus({ preventScroll: true });
    } catch (err) { if (scope.current()) msg(err.message); }
  });
  document.addEventListener("error", e => {
    if (!e.target?.matches?.("[data-hh-img]")) return;
    const id = e.target.dataset.hhImg, c = read(id); if (c) write(id, { ...c, src: null, exp: 0 });
  }, true);
}

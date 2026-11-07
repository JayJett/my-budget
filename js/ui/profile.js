/* Your profile picture (Phase 7D.2).

   - Personal, never the household's: it belongs to your login, so it's the same in every household,
     and nobody else's picture is ever shown as yours. Household members' colours are a separate system
     and are untouched.
   - Stored in a PRIVATE Supabase Storage bucket, "avatars", in a folder named after your user id
     (supabase/migrations/..._avatars.sql: only you can read, add, replace or remove files in your
     folder). Your login remembers which file is current (user_metadata.avatar).
   - The picture is cropped to a circle in the browser and saved as a small 320×320 JPEG (about
     20–40 KB). Re-drawing it on a canvas also drops the photo's hidden details (location, camera).
   - Shown through a signed link that expires; a copy is kept on this device so it appears straight
     away, and a fresh link is fetched when the old one has run out.
   - No picture (or the upload failed, or the bucket isn't set up yet): your initial, as before. */
import { app } from "./ctx.js";
import { esc, toast } from "./dom.js";

export const AVATAR_BUCKET = "avatars";
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const SIZE = 320;
const KEY = uid => `mb-avatar-${uid}`;
const uid = () => (app.session && app.session.user && app.session.user.id) || null;
const meta = () => (app.session && app.session.user && app.session.user.user_metadata) || {};
const read = id => { try { return JSON.parse(localStorage.getItem(KEY(id)) || "null"); } catch (_) { return null; } };
const write = (id, v) => { try { if (v) localStorage.setItem(KEY(id), JSON.stringify(v)); else localStorage.removeItem(KEY(id)); } catch (_) {} };

/** Your name as others see it: your household membership name, then your login's name. */
export function myName() {
  const me = (app.members || []).find(m => m.user_id === app.meId), md = meta();
  return ((me && me.display_name) || md.name || (md.full_name || "").trim().split(/\s+/)[0] || "").trim();
}

/** The picture to show now (a link or a saved copy), or null for your initial. */
export function avatarSrc() {
  const id = uid(), path = meta().avatar; if (!id || !path) return null;
  const c = read(id);
  if (c && c.path === path && c.src && (!c.exp || c.exp > Date.now() + 60e3)) return c.src;
  fetchLink(id, path);
  return c && c.path === path && c.copy ? c.copy : null;
}
let fetching = null;
async function fetchLink(id, path) {
  if (fetching === path || !app.sb || !app.sb.storage || (app.session && app.session.offline)) return;
  fetching = path;
  try {
    const { data, error } = await app.sb.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (error || !data || !data.signedUrl) return;
    const now = read(id) || {};
    write(id, { ...now, path, src: data.signedUrl, exp: Date.now() + 6.5 * 864e5 });
    refreshAvatars();
  } finally { fetching = null; }
}

/** An avatar: your picture if you have one, otherwise your initial in your colour. */
export function avatarHTML(size = "") {
  const src = avatarSrc(), nm = myName(), initial = (nm.charAt(0) || "?").toUpperCase();
  const mine = (app.state.people || []).find(p => nm && (p.name || "").trim().toLowerCase() === nm.toLowerCase());
  return src ? `<span class="av av-img ${size}" aria-hidden="true"><img src="${esc(src)}" alt="" data-av-img onerror="this.closest('.av').classList.add('av-broken')"><i>${esc(initial)}</i></span>`
    : `<span class="av ${size} ${mine ? `person pc-${mine.colour}` : "me-accent"}" aria-hidden="true">${esc(initial)}</span>`;
}
/** Redraw every avatar of yours on screen (header, menu, My profile). */
export function refreshAvatars() {
  const h = document.querySelector("#meSlot"); if (h) h.innerHTML = avatarHTML();
  document.querySelectorAll("[data-my-avatar]").forEach(el => { el.innerHTML = avatarHTML(el.dataset.myAvatar || ""); });
  document.querySelectorAll(".dr-me").forEach(el => { const a = el.querySelector(".av"); if (a) a.outerHTML = avatarHTML("lg"); });
}
// a link that has expired: fetch a new one
document.addEventListener("error", e => {
  if (e.target && e.target.matches && e.target.matches("[data-av-img]")) { const id = uid(), c = id && read(id); if (c) { write(id, { ...c, src: null, exp: 0 }); avatarSrc(); } }
}, true);

/* ---------- choosing, cropping and saving a picture ---------- */
/** Check a chosen file before anything else happens. Returns a message, or "" when it's fine. */
export function checkFile(f) {
  if (!f) return "No picture chosen.";
  if (f.type && !OK_TYPES.includes(f.type) && !/^image\//.test(f.type)) return "That isn’t a picture. Choose a photo (JPEG, PNG or WebP).";
  if (f.size > MAX_SOURCE_BYTES) return "That photo is over 5 MB. Choose a smaller one.";
  return "";
}

/** The crop step: drag to move, the slider to zoom. Returns { html, mount(el) → { blob() } }. */
export function cropper(img) {
  const st = { z: 1, x: 0, y: 0 };
  const base = () => Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight); // the photo always fills the circle
  const clamp = () => {
    const s = base() * st.z, w = img.naturalWidth * s, h = img.naturalHeight * s;
    st.x = Math.min(0, Math.max(SIZE - w, st.x)); st.y = Math.min(0, Math.max(SIZE - h, st.y));
  };
  const centre = () => { const s = base() * st.z; st.x = (SIZE - img.naturalWidth * s) / 2; st.y = (SIZE - img.naturalHeight * s) / 2; };
  centre();
  return {
    mount(root) {
      const cv = root.querySelector("canvas"), ctx = cv.getContext("2d"), zoom = root.querySelector("[data-crop-zoom]");
      cv.width = SIZE; cv.height = SIZE;
      const draw = () => { clamp(); const s = base() * st.z; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, SIZE, SIZE); ctx.drawImage(img, st.x, st.y, img.naturalWidth * s, img.naturalHeight * s); };
      draw();
      let p = null;
      cv.addEventListener("pointerdown", e => { p = { x: e.clientX, y: e.clientY, ox: st.x, oy: st.y }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener("pointermove", e => { if (!p) return; const k = SIZE / cv.getBoundingClientRect().width; st.x = p.ox + (e.clientX - p.x) * k; st.y = p.oy + (e.clientY - p.y) * k; draw(); });
      const up = () => { p = null; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
      zoom.addEventListener("input", () => {
        const before = base() * st.z, cx = (SIZE / 2 - st.x) / before, cy = (SIZE / 2 - st.y) / before;
        st.z = Number(zoom.value); const after = base() * st.z; st.x = SIZE / 2 - cx * after; st.y = SIZE / 2 - cy * after; draw();
      });
      // keyboard: arrow keys move the photo
      cv.addEventListener("keydown", e => { const d = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key]; if (!d) return; e.preventDefault(); st.x += d[0]; st.y += d[1]; draw(); });
      return { blob: () => new Promise(r => cv.toBlob(r, "image/jpeg", 0.86)) };
    },
  };
}

/** Load a chosen file into an <img>. Fails kindly for files the browser can't open. */
export function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("We couldn’t open that photo. Try a JPEG or PNG.")); };
    img.src = url;
  });
}

/** Save a cropped picture: upload first, then point your login at it, then tidy the old one away.
    If any step fails, your previous picture stays exactly as it was. */
export async function savePhoto(blob) {
  const id = uid(); if (!id || !app.sb) throw new Error("You need to be signed in.");
  if (!blob || blob.size > 512 * 1024) throw new Error("That picture is too big to save. Try zooming in a little.");
  const old = meta().avatar, path = `${id}/${Date.now()}.jpg`, bucket = app.sb.storage.from(AVATAR_BUCKET);
  const up = await bucket.upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
  if (up.error) throw new Error(/not found|bucket/i.test(up.error.message || "") ? "Profile pictures aren’t switched on yet." : app.friendly ? app.friendly(up.error) : up.error.message);
  const { data, error } = await app.sb.auth.updateUser({ data: { avatar: path } });
  if (error) { await bucket.remove([path]); throw new Error(app.friendly ? app.friendly(error) : error.message); }
  if (data && data.user) app.session.user = data.user;
  const copy = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(null); fr.readAsDataURL(blob); });
  write(id, { path, copy, src: copy, exp: 0 });
  if (old && old !== path && old.startsWith(id + "/")) bucket.remove([old]); // only ever your own folder
  refreshAvatars();
}

/** Remove your picture: your login forgets it first, then the file goes. Your initial comes back. */
export async function removePhoto() {
  const id = uid(), old = meta().avatar; if (!id || !old) return;
  const { data, error } = await app.sb.auth.updateUser({ data: { avatar: null } });
  if (error) throw new Error(app.friendly ? app.friendly(error) : error.message);
  if (data && data.user) app.session.user = data.user;
  write(id, null);
  if (old.startsWith(id + "/")) app.sb.storage.from(AVATAR_BUCKET).remove([old]);
  refreshAvatars();
}

/** Signing out: nothing of yours stays on screen (the saved copy stays, filed under your id). */
export function forgetShownAvatar() { const h = document.querySelector("#meSlot"); if (h) h.innerHTML = ""; }
export const toastErr = e => toast(e && e.message ? e.message : "Something went wrong.");

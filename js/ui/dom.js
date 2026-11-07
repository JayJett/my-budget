/* Page helpers: finding elements, escaping text, tooltips, pop-up menus, toasts and the confirm dialog. */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const trunc = (s, k) => s.length > k ? s.slice(0, k - 1) + "…" : s;

/** A short message at the bottom. kind "ok" adds a small tick, for things that really did just happen. */
export function toast(msg, kind) {
  const t = $("#toast");
  if (kind === "ok") t.innerHTML = `<span class="toast-ic" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg></span>${esc(msg)}`;
  else t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 2800);
}

/* ---------- tooltips ---------- */
export function initTooltips() {
  const tt = $("#tt");
  const show = el => {
    const t = el.dataset.tip; if (!t) return; tt.textContent = t; tt.classList.add("on");
    const b = el.getBoundingClientRect(), w = tt.offsetWidth, h = tt.offsetHeight;
    let x = Math.min(window.innerWidth - w - 8, Math.max(8, b.left + b.width / 2 - w / 2)), y = b.top - h - 8; if (y < 8) y = b.bottom + 8;
    tt.style.left = x + "px"; tt.style.top = y + "px";
  };
  const hide = () => tt.classList.remove("on");
  // Mouse: show on hover. Keyboard: show on focus. Touch: tap a "?" to show, tap anywhere else to hide.
  document.addEventListener("pointerover", e => { if (e.pointerType !== "mouse") return; const el = e.target.closest("[data-tip]"); if (el && el.dataset.tip) show(el); });
  document.addEventListener("pointerout", e => { if (e.pointerType === "mouse" && e.target.closest("[data-tip]")) hide(); });
  document.addEventListener("focusin", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el && el.dataset.tip && el.matches(":focus-visible")) show(el); });
  let tapped = null; // the "?" a finger last tapped: tap it again (or anywhere else) to hide
  document.addEventListener("click", e => {
    const q = e.target.closest(".qi[data-tip], .tip-t[data-tip]");
    if (q && q !== tapped) { show(q); tapped = q; } else { hide(); tapped = null; }
  });
  document.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, { passive: true });
}

/* ---------- pop-up menus ----------
   On a wide screen: a small menu beside the button that opened it, as before.
   On a phone (Phase 7C): a bottom sheet. A dimmed backdrop, the page behind stays still (and can't be
   tapped or focused), and it closes with the close button, a tap on the backdrop, Escape, or by
   dragging it down by its handle (or from its list, when the list is already scrolled to the top).
   The same three menus use it: the ⋯ menu, "Fill" and "Add a goal to". Their buttons and actions are
   unchanged; only how the panel opens and closes is new. */
let popHandler = null, popOpener = null, popSheet = false, popTimer = null;
const isPhone = () => matchMedia("(max-width:760px)").matches;
const calmMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const BEHIND = [".top", "#app", ".conn-wrap"];

/* Keeping the page still behind a sheet. Counted, so two things that both need it can't unlock each
   other early. Nothing about the page's position changes, so it's exactly where it was afterwards. */
let lockCount = 0, touchY = 0;
function touchGuard(e) {
  const sc = e.target.closest && e.target.closest("[data-scroll-ok]");
  if (!sc) { if (e.cancelable) e.preventDefault(); return; }
  const dy = e.touches[0].clientY - touchY, atTop = sc.scrollTop <= 0, atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1;
  if ((dy > 0 && atTop) || (dy < 0 && atEnd)) { if (e.cancelable) e.preventDefault(); }
}
const touchStart = e => { touchY = e.touches[0].clientY; };
/* Mouse wheels and trackpads: the same rule (the sheet's own list may scroll, nothing behind it). */
function wheelGuard(e) {
  const sc = e.target.closest && e.target.closest("[data-scroll-ok]");
  if (!sc) { e.preventDefault(); return; }
  const atTop = sc.scrollTop <= 0, atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1;
  if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atEnd)) e.preventDefault();
}
export function lockScroll() {
  if (lockCount++) return;
  // On a screen with a visible scrollbar, hiding it would widen the page and reflow it; keep its room.
  const root = document.documentElement, bar = window.innerWidth - root.clientWidth;
  document.body.style.paddingRight = bar > 0 ? bar + "px" : "";
  root.classList.add("scroll-locked");
  document.addEventListener("touchstart", touchStart, { passive: true });
  document.addEventListener("touchmove", touchGuard, { passive: false });
  document.addEventListener("wheel", wheelGuard, { passive: false });
}
export function unlockScroll() {
  if (!lockCount) return;
  if (--lockCount) return;
  document.documentElement.classList.remove("scroll-locked");
  document.body.style.paddingRight = "";
  document.removeEventListener("touchstart", touchStart);
  document.removeEventListener("touchmove", touchGuard);
  document.removeEventListener("wheel", wheelGuard);
}
const setBehind = on => BEHIND.forEach(s => { const el = $(s); if (el) { if (on) el.setAttribute("inert", ""); else el.removeAttribute("inert"); } });

export function openPop(anchor, html, handler, { label = "Options" } = {}) {
  const pop = $("#pop"), back = $("#popBack");
  clearTimeout(popTimer);
  const wasSheet = popSheet && !pop.hidden;
  popHandler = handler; popOpener = anchor; popSheet = isPhone();
  if (anchor && anchor.hasAttribute("aria-haspopup")) anchor.setAttribute("aria-expanded", "true");
  pop.classList.toggle("as-sheet", popSheet); pop.classList.remove("closing");
  if (popSheet) {
    pop.innerHTML = `<div class="pop-grab" data-pop-grab><span class="pop-handle" aria-hidden="true"></span><button class="pop-x" type="button" data-pop-close aria-label="Close"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div><div class="pop-body" data-scroll-ok>${html}</div>`;
    pop.setAttribute("role", "dialog"); pop.setAttribute("aria-modal", "true"); pop.setAttribute("aria-label", label); pop.tabIndex = -1;
    pop.style.left = pop.style.top = pop.style.transform = "";
    pop.hidden = false;
    if (back) { back.hidden = false; requestAnimationFrame(() => back.classList.add("on")); }
    if (!wasSheet) {
      lockScroll(); setBehind(true);
      if (!calmMotion()) { pop.classList.add("entering"); pop.getBoundingClientRect(); requestAnimationFrame(() => pop.classList.remove("entering")); }
    }
    pop.focus({ preventScroll: true });
    return;
  }
  ["role", "aria-modal", "aria-label"].forEach(a => pop.removeAttribute(a)); pop.removeAttribute("tabindex");
  pop.innerHTML = html; pop.hidden = false;
  const b = anchor.getBoundingClientRect(), w = pop.offsetWidth;
  // opens under its button, lined up with whichever side of the screen the button is on
  const x = b.left + b.width / 2 < window.innerWidth / 2 ? b.left : b.right - w;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x)) + "px"; pop.style.top = (b.bottom + 6) + "px";
}
/** Swap what an open menu shows (a sub-list), keeping it open. */
export function setPopContent(html) {
  const pop = $("#pop"); if (pop.hidden) return;
  const into = popSheet ? pop.querySelector(".pop-body") : pop;
  into.innerHTML = html; if (popSheet) into.scrollTop = 0;
  const f = into.querySelector("button:not([disabled])"); if (f && !popSheet) f.focus();
}
export function closePop() {
  const pop = $("#pop"), back = $("#popBack");
  if (pop.hidden || pop.classList.contains("closing")) return;
  popHandler = null;
  if (popOpener && popOpener.hasAttribute("aria-haspopup")) popOpener.setAttribute("aria-expanded", "false");
  const opener = popOpener; popOpener = null;
  const hadFocus = pop.contains(document.activeElement) || document.activeElement === document.body;
  if (popSheet) {
    popSheet = false;
    setBehind(false); unlockScroll();
    if (back) back.classList.remove("on");
    const finish = () => { pop.hidden = true; pop.classList.remove("closing", "as-sheet"); pop.style.transform = ""; pop.style.transition = ""; if (back) back.hidden = true; };
    if (calmMotion()) finish();
    else { pop.style.transition = ""; pop.classList.add("closing"); pop.style.transform = ""; clearTimeout(popTimer); popTimer = setTimeout(finish, 260); }
  } else pop.hidden = true;
  if (hadFocus && opener && opener.isConnected && !opener.closest("[inert]")) opener.focus({ preventScroll: true });
}

/* Dragging the sheet down: it follows your finger; let go past a third of its height (or with a quick
   flick) and it closes, otherwise it settles back. */
let drag = null;
function dragStart(y) { const pop = $("#pop"); if (!popSheet || pop.hidden) return; drag = { y0: y, t0: performance.now(), dy: 0, h: pop.offsetHeight }; pop.style.transition = "none"; }
function dragMove(y) {
  if (!drag) return;
  drag.dy = Math.max(0, y - drag.y0);
  $("#pop").style.transform = `translateY(${drag.dy}px)`;
  const back = $("#popBack"); if (back) back.style.opacity = String(Math.max(0, 1 - drag.dy / drag.h));
}
function dragEnd() {
  if (!drag) return;
  const d = drag; drag = null;
  const pop = $("#pop"), back = $("#popBack"), v = d.dy / Math.max(1, performance.now() - d.t0);
  if (back) back.style.opacity = "";
  if (d.dy > Math.min(140, d.h / 3) || (v > 0.6 && d.dy > 24)) { pop.style.transition = ""; pop.style.transform = `translateY(${d.dy}px)`; closePop(); return; }
  pop.style.transition = ""; pop.style.transform = "";
}

/** Phase 7D: the editing and settings sheets (<dialog>) keep the page still too (as the menu does):
    no scrolling behind them on iPhone, and the page is exactly where it was when they close. */
function lockWithDialogs() {
  const locked = new WeakSet();
  const sync = d => {
    if (d.open && !locked.has(d)) { locked.add(d); d.setAttribute("data-scroll-ok", ""); lockScroll(); }
    else if (!d.open && locked.has(d)) { locked.delete(d); unlockScroll(); }
  };
  const mo = new MutationObserver(list => list.forEach(m => sync(m.target)));
  document.querySelectorAll("dialog").forEach(d => { mo.observe(d, { attributes: true, attributeFilter: ["open"] }); sync(d); });
}

export function initPop() {
  lockWithDialogs();
  const pop = $("#pop");
  if (!$("#popBack")) { const b = document.createElement("div"); b.id = "popBack"; b.className = "pop-back"; b.hidden = true; pop.before(b); b.addEventListener("click", closePop); }
  pop.addEventListener("click", e => {
    if (e.target.closest("[data-pop-close]")) { closePop(); return; }
    const b = e.target.closest("button"); if (b && popHandler && !b.disabled) popHandler(b);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !pop.hidden) { e.preventDefault(); closePop(); } });
  // the handle: mouse, pen or finger
  pop.addEventListener("pointerdown", e => {
    if (!e.target.closest("[data-pop-grab]") || e.target.closest("[data-pop-close]")) return;
    dragStart(e.clientY); try { pop.setPointerCapture(e.pointerId); } catch (_) {}
  });
  pop.addEventListener("pointermove", e => { if (drag && !drag.touch) dragMove(e.clientY); });
  pop.addEventListener("pointerup", () => { if (drag && !drag.touch) dragEnd(); });
  pop.addEventListener("pointercancel", () => { if (drag && !drag.touch) dragEnd(); });
  // the list: pulling down while it's already at the top drags the sheet instead
  let ty = null;
  pop.addEventListener("touchstart", e => { ty = e.target.closest(".pop-body") ? e.touches[0].clientY : null; }, { passive: true });
  pop.addEventListener("touchmove", e => {
    if (ty === null || !popSheet) return;
    const body = pop.querySelector(".pop-body"), y = e.touches[0].clientY;
    if (!drag && y - ty > 6 && body && body.scrollTop <= 0) { dragStart(ty); if (drag) drag.touch = true; }
    if (drag && drag.touch) { if (e.cancelable) e.preventDefault(); dragMove(y); }
  }, { passive: false });
  pop.addEventListener("touchend", () => { ty = null; if (drag && drag.touch) dragEnd(); });
  pop.addEventListener("touchcancel", () => { ty = null; if (drag && drag.touch) dragEnd(); });
  // turning the phone or resizing the window: a sheet that no longer fits closes rather than misbehaving
  matchMedia("(max-width:760px)").addEventListener?.("change", () => { if (!pop.hidden) closePop(); });
}

/* ---------- confirm dialog ---------- */
export function confirmDel(title, msg, yes) {
  const d = $("#dlg"); $("#dlgT").textContent = title; $("#dlgP").textContent = msg; $("#dlgYes").textContent = yes || "Remove";
  return new Promise(res => {
    const done = v => { d.close(); res(v); };
    $("#dlgYes").onclick = () => done(true); $("#dlgNo").onclick = () => done(false); d.oncancel = () => res(false); d.showModal();
  });
}

export function offerFile(filename, data, label) {
  const type = filename.endsWith(".csv") ? "text/csv" : "application/json";
  const blob = new Blob([data], { type }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(`${label} downloaded`);
}

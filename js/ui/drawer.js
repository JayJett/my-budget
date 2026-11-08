/* A side drawer (Phase 7D.2): the account menu slides in from the left, notifications from the right.

   - The page behind dims, can't scroll (the shared lockScroll from dom.js), can't be tapped or reached
     with the keyboard (inert), and is exactly where it was when the drawer closes.
   - It closes with a swipe back towards its edge, a tap on the dimmed page, Escape, its ✕, or by
     choosing something in it. Swiping follows your finger; let go past a third (or flick) to close,
     otherwise it settles back. A mostly-vertical swipe is left alone, so the drawer's own list scrolls.
   - Opening by swiping in from the screen edge isn't offered: Safari uses that edge for Back.
   - Keyboard focus stays inside while it's open and goes back to the button that opened it.
   One drawer element is shared; its content is whatever the caller puts in it. */
import { $, lockScroll, unlockScroll, setBehind, closePop } from "./dom.js";
import { calm } from "./motion.js";

let el = null, back = null, side = "left", opener = null, handler = null, timer = null, open = false;
export const drawerOpen = () => open;

function build() {
  back = document.createElement("div"); back.className = "dr-back"; back.hidden = true;
  el = document.createElement("aside"); el.id = "drawer"; el.className = "drawer"; el.hidden = true; el.tabIndex = -1;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  el.innerHTML = `<div class="dr-body" data-scroll-ok></div>`;
  document.body.append(back, el);
  back.addEventListener("click", () => closeDrawer());
  el.addEventListener("click", e => {
    if (e.target.closest("[data-dr-close]")) { closeDrawer(); return; }
    const b = e.target.closest("button, [data-dr-act]"); if (b && handler && !b.disabled) handler(b, e);
  });
  document.addEventListener("keydown", e => {
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); closeDrawer(); return; }
    if (e.key === "Tab") { // keep focus inside
      const f = [...el.querySelectorAll("button:not([disabled]), [href], input, select, [tabindex='0']")].filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  // swipe back towards the drawer's edge to close
  let s = null;
  el.addEventListener("touchstart", e => { const t = e.touches[0]; s = { x: t.clientX, y: t.clientY, t: performance.now(), drag: false, dx: 0 }; }, { passive: true });
  el.addEventListener("touchmove", e => {
    if (!s) return;
    const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, toward = side === "left" ? -dx : dx;
    if (!s.drag) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { s = null; return; } // scrolling the list
      if (toward > 8 && Math.abs(dx) > Math.abs(dy)) { s.drag = true; el.style.transition = "none"; back.style.transition = "none"; }
    }
    if (s && s.drag) {
      if (e.cancelable) e.preventDefault();
      s.dx = Math.max(0, toward);
      el.style.transform = `translateX(${side === "left" ? -s.dx : s.dx}px)`;
      back.style.opacity = String(Math.max(0, 1 - s.dx / el.offsetWidth));
    }
  }, { passive: false });
  const end = () => {
    if (!s || !s.drag) { s = null; return; }
    const v = s.dx / Math.max(1, performance.now() - s.t), far = s.dx > el.offsetWidth / 3 || (v > 0.5 && s.dx > 30);
    el.style.transition = ""; back.style.transition = ""; back.style.opacity = "";
    s = null;
    if (far) closeDrawer(); else el.style.transform = "";
  };
  el.addEventListener("touchend", end); el.addEventListener("touchcancel", end);
  // (changing tab closes it: switchTab in events.js; a #reminders link opens the notifications drawer)
}

/** Open the drawer. html: its content; onAction(button): what a tap on a button inside does. */
export function openDrawer({ html, label = "Menu", from = "left", trigger = null, onAction = null, className = "" }) {
  if (!el) build();
  closePop();
  clearTimeout(timer);
  const already = open;
  side = from; handler = onAction; opener = trigger || document.activeElement;
  el.className = `drawer dr-${side} ${className}`.trim();
  el.setAttribute("aria-label", label);
  el.querySelector(".dr-body").innerHTML = html;
  el.style.transform = ""; el.hidden = false; back.hidden = false;
  if (!already) {
    open = true; lockScroll(); setBehind(true);
    if (opener && opener.hasAttribute && opener.hasAttribute("aria-expanded")) opener.setAttribute("aria-expanded", "true");
    if (!calm()) { el.classList.add("dr-enter"); el.getBoundingClientRect(); }
    requestAnimationFrame(() => { el.classList.remove("dr-enter"); back.classList.add("on"); });
  }
  el.focus({ preventScroll: true });
}

/** Change what an open drawer shows (a sub-list), keeping it open. */
export function setDrawerContent(html, { focus = true } = {}) {
  if (!open) return;
  const body = el.querySelector(".dr-body"); body.innerHTML = html; body.scrollTop = 0;
  if (focus) { const f = body.querySelector("button:not([disabled])"); (f || el).focus({ preventScroll: true }); }
}

export function closeDrawer({ focus = true } = {}) {
  if (!open) return;
  open = false; handler = null;
  setBehind(false); unlockScroll();
  back.classList.remove("on");
  const o = opener; opener = null;
  if (o && o.hasAttribute && o.hasAttribute("aria-expanded")) o.setAttribute("aria-expanded", "false");
  const finish = () => { el.hidden = true; back.hidden = true; el.classList.remove("dr-leave"); el.style.transform = ""; };
  if (calm()) finish(); else { el.classList.add("dr-leave"); timer = setTimeout(finish, 240); }
  if (focus && o && o.isConnected && !o.closest("[inert]")) o.focus({ preventScroll: true });
}

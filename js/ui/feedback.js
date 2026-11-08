/* Phase 8: a small, shared touch-feedback helper.

   What it can and can't do, honestly:
   - It uses the standard Vibration API (navigator.vibrate). Chrome and other Chromium browsers on
     Android support it, on phones with a vibration motor, after you've tapped the page.
   - Safari on iPhone and iPad doesn't support it (there's no web API for the iPhone's haptics), and
     desktop browsers have nothing to vibrate. There, this does nothing at all, and the app relies on
     its visual feedback instead: buttons press in, choices spring into place, progress glides.
     We don't use workarounds to force a buzz on iPhone; that would need a native app.
   - It's short and rare: a few milliseconds, only for meaningful taps (choosing something, finishing
     setup, a goal milestone), never while typing or scrolling, and never more than once every 120 ms.
   - You can switch it off (Appearance → Touch feedback), shown only on phones that can do it. It's off
     too when "Reduce motion" is on, so one setting quiets everything. */
import { calm } from "./motion.js";
import { currentLook } from "./accent.js";

const PATTERNS = { select: 8, tap: 6, success: [14, 60, 22], warn: [24, 60, 24] };
/** Whether this device can vibrate at all (a phone's browser with the Vibration API). */
export const canVibrate = () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
  && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
let last = 0;
export function feedback(kind = "select") {
  if (!canVibrate() || calm() || currentLook().feedback === "off") return false;
  const now = Date.now(); if (now - last < 120) return false;
  last = now;
  try { return navigator.vibrate(PATTERNS[kind] ?? PATTERNS.select); } catch (_) { return false; }
}

/** The taps that get a tiny buzz: choosing things (segments, colours, icons, modes, tabs). */
const CHOICES = "[data-viewas], [data-look], [data-accent-pick], [data-oc-pick], [data-icon], [data-hh-oc], [data-hh-icon], [data-hh-mode], [data-colour], [data-tab], .seg-radio input, input[name=obmode]";
export function initFeedback() {
  document.addEventListener("click", e => {
    const el = e.target.closest && e.target.closest(CHOICES);
    if (el && !el.disabled && el.getAttribute("aria-checked") !== "true" && el.getAttribute("aria-pressed") !== "true" && el.getAttribute("aria-selected") !== "true") feedback("select");
  }, true);
}

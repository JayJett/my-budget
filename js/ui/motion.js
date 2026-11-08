/* Phase 8: one answer to "should this move?", used by every animation in the app.
   Calm (no animation) when the phone asks for less motion (Reduce Motion / prefers-reduced-motion),
   or when you've chosen "Reduced" in Appearance (saved on your login: ui/accent.js). */
export const calm = () => (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)
  || (typeof document !== "undefined" && document.documentElement.dataset.motion === "reduce");

/* A short guided tour: a spotlight moves around the page with a friendly explanation at each stop.
   Shown after setup, and any time from the menu ("Take the tour"). */
import { app } from "./ctx.js";
import { $ } from "./dom.js";

const STOPS = [
  { sel: "#app .viewas", title: "Pick your period", text: "Every amount can be shown per week, fortnight or month. It doesn’t change the plan, just how you see it." },
  { sel: "#app .b-income", title: "Income", text: "Everyone’s take-home pay, added up. Tap a person to change their pay, how often it arrives, or their colour." },
  { sel: "#allocStatus", title: "Every dollar has a job", text: "How much of each person’s pay is planned. Aim for 100%, and use Fill to top up the last bit." },
  { sel: "#app .b-allocs", title: "Your allocations", text: "Where the pay goes, account by account. Tap one to change its share of each person’s pay." },
  { sel: "#tabs", title: "The other tabs", text: "Net worth is what you own and owe. Spending is where the bills money goes. Goals and Investments show what your saving adds up to." },
  { sel: "#menuBtn", title: "Settings live here", text: "Your account, household members and roles, switching households, downloads, and this tour again." },
];
const KEY = () => `mb-tour-done-${app.meId || "anon"}`;
let i = 0, el = null;

export function startTour() {
  i = 0;
  if (app.tab !== "budget") { app.tab = "budget"; history.replaceState(null, "", "#budget"); app.render(); }
  if (!el) {
    el = document.createElement("div");
    el.className = "tour"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "tourT");
    el.innerHTML = `<div class="tour-spot"></div><div class="tour-card"><div class="tour-n"></div><h3 id="tourT"></h3><p></p>
      <div class="tour-acts"><button class="linkish" type="button" data-tour="end">Skip tour</button><span><button class="btn small" type="button" data-tour="back">Back</button> <button class="btn small primary" type="button" data-tour="next">Next</button></span></div></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", e => { const b = e.target.closest("[data-tour]"); if (!b) return; const a = b.dataset.tour; if (a === "end") end(); if (a === "back") go(i - 1); if (a === "next") (i === STOPS.length - 1 ? end() : go(i + 1)); });
    document.addEventListener("keydown", e => { if (!el || el.hidden) return; if (e.key === "Escape") end(); if (e.key === "ArrowRight") go(Math.min(i + 1, STOPS.length - 1)); if (e.key === "ArrowLeft") go(i - 1); });
    window.addEventListener("resize", () => { if (el && !el.hidden) place(); });
  }
  el.hidden = false;
  go(0);
}

function go(k) {
  if (k < 0) return;
  i = k;
  const s = STOPS[i], t = $(s.sel);
  if (!t) { if (i < STOPS.length - 1) return go(i + 1); return end(); }
  t.scrollIntoView({ block: "center" });
  el.querySelector(".tour-n").textContent = `${i + 1} of ${STOPS.length}`;
  el.querySelector("h3").textContent = s.title;
  el.querySelector("p").textContent = s.text;
  el.querySelector('[data-tour="back"]').disabled = i === 0;
  el.querySelector('[data-tour="next"]').textContent = i === STOPS.length - 1 ? "Done" : "Next";
  requestAnimationFrame(place);
  el.querySelector('[data-tour="next"]').focus();
}

function place() {
  const t = $(STOPS[i].sel); if (!t) return;
  const r = t.getBoundingClientRect(), pad = 6, spot = el.querySelector(".tour-spot"), card = el.querySelector(".tour-card");
  const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
  const h = Math.min(r.height + pad * 2, window.innerHeight - top - 4), w = Math.min(r.width + pad * 2, window.innerWidth - left - 4);
  Object.assign(spot.style, { top: top + "px", left: left + "px", width: w + "px", height: h + "px" });
  const cw = card.offsetWidth, ch = card.offsetHeight;
  let y = top + h + 12; if (y + ch > window.innerHeight - 8) y = Math.max(8, top - ch - 12);
  if (y + ch > window.innerHeight - 8) y = window.innerHeight - ch - 8; // tall target: sit inside it
  const x = Math.min(window.innerWidth - cw - 8, Math.max(8, left));
  Object.assign(card.style, { top: y + "px", left: x + "px" });
}

function end() {
  if (el) el.hidden = true;
  try { localStorage.setItem(KEY(), "1"); } catch (_) {}
}
export const tourDone = () => { try { return localStorage.getItem(KEY()) === "1"; } catch (_) { return true; } };

app.startTour = startTour;

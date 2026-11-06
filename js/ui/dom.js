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

/* ---------- pop-up menus ---------- */
let popHandler = null;
export function openPop(anchor, html, handler) {
  const pop = $("#pop");
  pop.innerHTML = html; pop.hidden = false; popHandler = handler;
  const b = anchor.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, b.right - w)) + "px"; pop.style.top = (b.bottom + 6) + "px";
}
export function closePop() { $("#pop").hidden = true; popHandler = null; }
export function initPop() {
  $("#pop").addEventListener("click", e => { const b = e.target.closest("button"); if (b && popHandler && !b.disabled) popHandler(b); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });
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

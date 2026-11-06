/* Page helpers: finding elements, escaping text, tooltips, pop-up menus, toasts and the confirm dialog. */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const trunc = (s, k) => s.length > k ? s.slice(0, k - 1) + "…" : s;

export function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
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
  document.addEventListener("pointerover", e => { const el = e.target.closest("[data-tip]"); if (el && el.dataset.tip) show(el); });
  document.addEventListener("pointerout", e => { if (e.target.closest("[data-tip]")) hide(); });
  document.addEventListener("focusin", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el && el.dataset.tip) show(el); });
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

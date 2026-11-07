/* Progress tab: recorded snapshots as your financial story, plus "compare with today".

   The maths lives in js/model/snapshots.js (unchanged); this file draws it and talks to the database.
   Everything plotted is a recorded snapshot (one per month, the latest that month, as before), plus
   "Today", which is today's balances from the Net worth tab, drawn hollow and joined by a dashed line
   so it's never mistaken for a saved snapshot. Nothing is filled in between snapshots, and looking at
   the chart, changing the time range or comparing never writes anything. */
import { app, readOnly } from "../ctx.js";
import { $, esc, toast } from "../dom.js";
import { tipq } from "../inputs.js";
import { trendPoints, progressNotes, goalNote, goalHistory, compare, summarize, summarizeSnapshot, diffText, isGood, monthOf, previousMonthPoint } from "../../model/snapshots.js";
import { money, m0, monthYear } from "../../model/format.js";
import { drawMixChart, drawHistory, sparkline } from "../charts.js";
import { addMonths } from "../../model/util.js";
import { itemIcon } from "../icons.js";
import { ART } from "../art.js";

const CACHE = id => `mb-snaps-v1-${id}`;
const MIX = [
  { key: "cash", name: "Cash", color: "var(--joint)" },
  { key: "investments", name: "Investments", color: "var(--invest)" },
  { key: "super", name: "KiwiSaver / super", color: "#3E5A63" },
  { key: "debt", name: "Debt", color: "var(--bad)", below: true },
];
/** The goal's icon as chosen on the Goals tab (today's goal with the same id), or its first letter. */
function goalIcon(g) {
  const G = app.state.goals, cur = [G.ef, ...G.joint, ...Object.values(G.personal).flat()].find(x => x.id === g.id);
  return `<span class="gl-ic${g.id === "ef" ? " ef" : ""}" aria-hidden="true">${itemIcon(cur && cur.icon) || esc(String(g.name || "?").trim().charAt(0).toUpperCase())}</span>`;
}
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';

/* ---------- data ---------- */
/** Load this household's snapshots: the copy on this device first (works offline), then the latest. */
export async function loadSnapshots() {
  const hh = app.household; if (!hh || !app.sb) return;
  try { const c = JSON.parse(localStorage.getItem(CACHE(hh.id)) || "null"); if (c && !app.snapshots) app.snapshots = c; } catch (_) {}
  const { data, error } = await app.sb.from("budget_snapshots").select("id, month, kind, taken_at, taken_by, data").eq("household_id", hh.id).order("taken_at");
  if (!app.household || app.household.id !== hh.id) return; // switched household meanwhile
  if (error) { if (!app.snapshots) app.snapshots = []; app.snapshotsOffline = true; }
  else {
    app.snapshots = data || []; app.snapshotsOffline = false;
    try { localStorage.setItem(CACHE(hh.id), JSON.stringify(app.snapshots)); } catch (_) {}
  }
  if (app.tab === "progress") app.render();
}

/** On opening a household: take this month's snapshot if the scheduler hasn't yet (a safety net). */
export async function ensureMonthly() {
  const hh = app.household; if (!hh || app.offline) return;
  const { data } = await app.sb.rpc("ensure_monthly_snapshot", { p_household: hh.id });
  if (data === true) loadSnapshots();
}

let saving = false;
async function saveNow(btn) {
  if (saving) return; // one at a time
  saving = true; document.querySelectorAll('[data-snap="save"]').forEach(b => { b.disabled = true; b.dataset.label = b.textContent; b.textContent = "Saving…"; });
  if (app.store && app.store.busy()) await app.store.flushNow(); // a snapshot is of what's saved, so finish saving first
  const { data, error } = await app.sb.rpc("save_snapshot_now", { p_household: app.household.id });
  saving = false;
  document.querySelectorAll('[data-snap="save"]').forEach(b => { b.disabled = false; if (b.dataset.label) b.textContent = b.dataset.label; });
  if (error) { toast(app.friendly ? app.friendly(error) : "Couldn’t save a snapshot"); return; }
  app.snapshots = [...(app.snapshots || []).filter(s => s.kind !== "manual" || s.id !== data.id), data];
  try { localStorage.setItem(CACHE(app.household.id), JSON.stringify(app.snapshots)); } catch (_) {}
  toast("Snapshot saved", "ok"); // only once the database has confirmed it
  app.pgSel = null;
  app.render();
}

/* ---------- screen ---------- */
const whoSaved = s => {
  if (s.kind === "monthly") return "Monthly snapshot";
  if (s.taken_by === app.meId) return "Saved by you";
  const m = app.members.find(x => x.user_id === s.taken_by);
  return `Saved by ${(m && (m.display_name || m.email)) || "someone"}`;
};
const dateText = s => new Date(s.taken_at).toLocaleString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
const snapLabel = s => s.kind === "monthly" ? monthYear(monthOf(s)) : dateText(s);
const canSave = () => !readOnly() && !app.offline;
const saveHelp = () => readOnly() ? "Only owners and editors can save snapshots." : app.offline ? "Saving a snapshot needs a connection." : "Handy right after you’ve updated your balances on Net worth.";
const saveBtn = (primary, label = "Save snapshot") => `<button class="btn small ${primary ? "primary" : "ghost"}" type="button" data-snap="save"${canSave() ? "" : " disabled"}${saving ? " disabled" : ""}>${saving ? "Saving…" : label}</button>`;

/** "+$440" / "−$80" with words for debt: "$200 less owed". Never colour alone: the sign or words say it. */
const changeText = (d, kind) => Math.abs(d) < 0.5 ? "No change" : kind === "debt" ? `${m0(Math.abs(d))} ${d < 0 ? "less" : "more"} owed` : diffText(d, kind);
const changeChip = (d, kind) => `<span class="chip ${Math.abs(d) < 0.5 ? "" : isGood(d, kind) ? "ok" : "bad"}">${esc(changeText(d, kind))}</span>`;

/** Recorded points in the chosen time range, then Today. */
function rangePoints(pts) {
  const rec = pts.filter(p => !p.now), r = app.pgRange, cut = r === "6m" ? addMonths(app.today, -6) : r === "1y" ? addMonths(app.today, -12) : null;
  return [...(cut ? rec.filter(p => p.date >= new Date(cut.getFullYear(), cut.getMonth(), 1)) : rec), ...pts.filter(p => p.now)];
}
/** Which ranges make sense for the history recorded so far (none when it's all short). */
function ranges(pts) {
  const rec = pts.filter(p => !p.now); if (!rec.length) return [];
  const months = (app.today.getFullYear() - rec[0].date.getFullYear()) * 12 + app.today.getMonth() - rec[0].date.getMonth();
  return months > 6 ? [["6m", "6M"], ...(months > 12 ? [["1y", "1Y"]] : []), ["all", "All"]] : [];
}

export function view() {
  const snaps = app.snapshots;
  if (!snaps) return `<div class="card pg-empty"><p class="lead">Loading your snapshots…</p></div>`;
  const nowSum = summarize(app.state);
  if (!snaps.length) return `<div class="pg-page"><section class="card pg-hero pg-start">
      <span class="eyebrow">Your progress</span>
      <div class="sp-head"><span class="amt">${money(nowSum.netWorth)}</span><span class="lab">net worth today</span></div>
      <div class="empty-art" aria-hidden="true">${ART.growth()}</div>
      <h2>Your journey starts here</h2>
      <p class="lead">A snapshot keeps a copy of your balances and goals. One is saved automatically on the 1st of every month, and each one adds a point to your history.</p>
      <div class="pg-save">${saveBtn(true, "Save your first snapshot")}<small>${esc(saveHelp())}</small></div>
    </section></div>`;

  const pts = trendPoints(snaps, app.state, app.today), rec = pts.filter(p => !p.now), now = pts[pts.length - 1];
  const prev = previousMonthPoint(pts, app.today);
  const rg = ranges(pts);
  if (!rg.some(r => r[0] === app.pgRange)) app.pgRange = "all";
  const shown = rangePoints(pts);
  const hero = `<section class="card pg-hero" aria-live="polite">
    <div class="b-row"><span class="eyebrow">Your progress</span>${saveBtn(false)}</div>
    <div class="sp-head"><span class="amt">${money(now.netWorth)}</span><span class="lab">net worth today</span></div>
    ${prev ? `<p class="pg-delta">${changeChip(now.netWorth - prev.netWorth, "total")} <span>since ${esc(monthYear(prev.date))}</span></p>` : ""}
    <ul class="pg-notelist" id="pgNotes">${progressNotes(pts, app.today).map(t => `<li>${esc(t)}</li>`).join("")}</ul>
  </section>`;

  const history = rec.length < 2 ? `<section class="card pg-hist pg-sparse">
      <div class="b-row"><h2>Net worth history</h2></div>
      <div class="pg-two"><div><small>${esc(rec.length ? snapLabel(rec[0].snap) : "")} · snapshot</small><b>${money(rec[0].netWorth)}</b></div><div><small>Today · current balances</small><b>${money(now.netWorth)}</b></div></div>
      <p class="dim small-note">Your history chart starts with your second monthly snapshot. Nothing is filled in between.</p>
    </section>`
    : `<section class="card pg-hist">
      <div class="b-row"><h2>Net worth history ${tipq("Each solid dot is a recorded snapshot (the latest of each month). The hollow dot is today, from your Net worth tab.")}</h2>
        ${rg.length ? `<div class="seg iv-h" role="group" aria-label="Time range">${rg.map(([k, l]) => `<button type="button" data-pg-range="${k}" aria-pressed="${k === app.pgRange}">${l}</button>`).join("")}</div>` : ""}</div>
      <div class="iv-chart" id="pgNet" tabindex="0" role="group" aria-label="Net worth history chart. Use the left and right arrow keys to pick a point." aria-describedby="pgRead"></div>
      <div class="iv-read pg-read" id="pgRead" aria-live="polite"></div>
      <p class="sr-only">Recorded net worth: ${shown.map(p => `${p.now ? "today" : p.label} ${m0(p.netWorth)}`).join(", ")}.</p>
    </section>`;

  const cats = [["cash", "Cash", "Everyday and savings"], ["investments", "Investments", ""], ["super", "KiwiSaver / super", ""], ["debt", "Debt", ""]];
  const assets = `<section class="card pg-ad">
    <div class="b-row"><h2>Assets & debt</h2>${prev ? `<small class="dim">Change since ${esc(monthYear(prev.date))}</small>` : ""}</div>
    <ul class="pg-rows">${cats.map(([k, label, sub]) => `<li><i class="dot" style="background:${MIX.find(q => q.key === k).color}"></i><span class="pg-rl">${label}${sub ? `<small>${sub}</small>` : ""}</span><b>${money(now[k])}</b>${prev ? changeChip(now[k] - prev[k], k === "debt" ? "debt" : "total") : ""}</li>`).join("")}</ul>
    ${rec.length >= 2 ? `<details class="more" id="pgMixBox"${app.pgMixOpen ? " open" : ""}><summary>Show the mix over time</summary><div class="line-wrap" id="pgMix"></div><div class="split-key">${MIX.map(q => `<span><i style="background:${q.color}"></i>${q.name}</span>`).join("")}</div></details>` : ""}
  </section>`;

  const goals = `<section class="pg-gl"><div class="b-row sec"><h2>Savings progress</h2></div>
    ${now.goals.length ? `<ul class="pg-glist">${now.goals.map(g => {
      const done = g.pct !== null && g.pct >= 1, hist = goalHistory(pts, g.id);
      return `<li class="card pg-g${done ? " done" : ""}"><div class="pg-g-top">${goalIcon(g)}<span class="pg-g-n"><b>${esc(g.name)}</b><small>${esc(g.group)}</small></span>${done ? `<span class="gl-done">${CHECK}Reached</span>` : ""}</div>
        <div class="pg-g-row"><div class="pg-g-main"><span class="pg-g-v">${m0(g.saved)}${g.target ? `<small> of ${m0(g.target)}</small>` : ""}</span>
          ${g.target ? `<span class="gl-bar"><span style="width:${Math.min(1, g.pct || 0) * 100}%"></span></span>` : ""}
          <small class="dim">${esc(goalNote(g, pts, app.today) || "Add a target to track progress")}</small></div>${sparkline(hist.map(h => h.saved), g.target, "var(--accent)")}</div></li>`;
    }).join("")}</ul>` : `<div class="card gl-none"><p>No goals yet. Add some on the Goals tab and they’ll show here.</p></div>`}</section>`;

  const cmp = app.compareId && snaps.find(s => String(s.id) === String(app.compareId));
  const options = [...snaps].reverse().map(s => `<option value="${esc(s.id)}"${cmp && String(cmp.id) === String(s.id) ? " selected" : ""}>${esc(snapLabel(s))} · ${esc(whoSaved(s))}</option>`).join("");
  const compareBox = `<section class="card pg-cmp" id="pgCompare">
    <div class="b-row"><h2>Compare</h2>${cmp ? `<button class="btn small ghost" type="button" data-compare="close">Close</button>` : ""}</div>
    <label class="bs-field pg-cmp-pick"><span>Today’s balances compared with a snapshot</span><select class="bs-in" id="pgCmpSel"><option value="">Pick a snapshot</option>${options}</select></label>
    ${cmp ? compareHTML(cmp) : ""}
  </section>`;

  const list = [...snaps].reverse();
  const nwOf = s => summarizeSnapshot(s).netWorth;
  const historyList = `<section class="card pg-hl">
    <div class="b-row"><h2>History</h2><small class="dim">${snaps.length} ${snaps.length === 1 ? "snapshot" : "snapshots"}</small></div>
    <ul class="pg-list">${list.map((s, i) => {
      const older = list[i + 1], d = older ? nwOf(s) - nwOf(older) : null;
      return `<li><span><b>${esc(snapLabel(s))}</b><small>${esc(whoSaved(s))}</small></span>
        <span class="pg-nw">${m0(nwOf(s))}${d === null ? "" : `<small>${esc(changeText(d, "total"))} vs before</small>`}</span>
        <button class="btn small ghost" type="button" data-compare="${esc(s.id)}"${cmp && String(cmp.id) === String(s.id) ? ' aria-pressed="true"' : ""}>Compare</button></li>`;
    }).join("")}</ul>
    <div class="pg-save">${saveBtn(false)}<small>${esc(saveHelp())}${app.snapshotsOffline ? " Showing the copy saved on this device." : ""} The newest 24 saved snapshots are kept, plus every monthly one.</small></div>
  </section>`;

  const help = `<details class="help"><summary>About snapshots</summary><ul>
    <li>A snapshot is a copy of your Net worth balances and your goals at one moment. One is saved automatically on the 1st of each month (NZ time); you can save one any time too.</li>
    <li>Snapshots are never changed afterwards: editing balances or goals today only changes “Today”.</li>
  </ul></details>`;
  return `<div class="pg-page"><div class="pg-side">${hero}${history}</div><div class="pg-main">${assets}${goals}${compareBox}${historyList}${help}</div></div>`;
}

function compareHTML(s) {
  const then = summarizeSnapshot(s), now = summarize(app.state), rows = compare(then, now);
  const label = snapLabel(s);
  const cell = v => v === null ? "—" : money(v);
  return `<p class="pg-cmp-h"><span><small>Then</small>${esc(label)}</span><span>→</span><span><small>Now</small>Today</span></p>
    <p class="dim small-note">${esc(whoSaved(s))}${then.reviewed ? `. Balances were last reviewed ${esc(new Date(then.reviewed).toLocaleDateString("en-NZ", { day: "numeric", month: "short" }))} at the time.` : "."}</p>
    <ul class="pg-cmp-l">${rows.map(r => `<li class="cmp-${r.kind}"><span class="pg-cmp-n"><b>${esc(r.label)}</b>${r.group ? `<small>${esc(r.group)}${r.kind === "goal" && r.targetNow ? ` · target ${m0(r.targetNow)}` : ""}</small>` : ""}
      <small class="pg-cmp-v">${cell(r.then)} → ${cell(r.now)}</small></span>${changeChip(r.diff, r.kind)}</li>`).join("")}</ul>`;
}

export function fill() {}

/** The figures beside the history chart for the picked point (recorded, or Today). */
function readout(p) {
  const el = $("#pgRead"); if (!el || !p) return;
  el.innerHTML = `<b>${p.now ? "Today · current balances" : esc(snapLabel(p.snap))}</b><span>Net worth ${money(p.netWorth)}</span><span class="dim">Cash ${m0(p.cash)} · Investments ${m0(p.investments)} · Super ${m0(p.super)} · Debt ${m0(p.debt)}</span>`;
}

export function draw() {
  const snaps = app.snapshots; if (!snaps || !snaps.length) return;
  const pts = trendPoints(snaps, app.state, app.today), shown = rangePoints(pts);
  const el = $("#pgNet");
  if (el) {
    const sel = Math.min(app.pgSel ?? shown.length - 1, shown.length - 1);
    const pick = i => { app.pgSel = i; drawHistory(el, shown, shown.map(p => p.netWorth), i, pick); readout(shown[i]); };
    pick(sel);
  }
  if ($("#pgMix") && $("#pgMixBox").open) drawMixChart($("#pgMix"), pts, MIX);
}

/* ---------- clicks ---------- */
export function initProgress() {
  let t = null; // redraw the charts at the new size when the screen turns or the window changes
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (app.tab === "progress" && app.snapshots && app.snapshots.length) draw(); }, 200); });
  document.addEventListener("toggle", e => { if (e.target.id === "pgMixBox") { app.pgMixOpen = e.target.open; if (e.target.open) draw(); } }, true);
  document.addEventListener("change", e => {
    if (e.target.id !== "pgCmpSel") return;
    app.compareId = e.target.value || null; app.render();
    const box = $("#pgCompare"); if (box) box.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  document.addEventListener("click", e => {
    const s = e.target.closest("[data-snap]");
    if (s && s.dataset.snap === "save" && !s.disabled) { saveNow(s); return; }
    const r = e.target.closest("[data-pg-range]");
    if (r) { app.pgRange = r.dataset.pgRange; app.pgSel = null; app.render(); return; }
    const c = e.target.closest("[data-compare]");
    if (c) {
      app.compareId = c.dataset.compare === "close" || String(app.compareId) === c.dataset.compare ? null : c.dataset.compare;
      app.render();
      const box = $("#pgCompare"); if (box && app.compareId) box.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  });
}

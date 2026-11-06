/* Progress tab: monthly snapshots as friendly trend charts, plus "compare with today".
   The maths lives in js/model/snapshots.js; this file draws it and talks to the database. */
import { app, readOnly } from "../ctx.js";
import { $, esc, toast } from "../dom.js";
import { attnBox, tipq } from "../inputs.js";
import { trendPoints, progressNotes, goalNote, goalHistory, compare, summarize, summarizeSnapshot, diffText, isGood, monthOf } from "../../model/snapshots.js";
import { money, m0, monthYear } from "../../model/format.js";
import { drawLineChart, drawMixChart, sparkline } from "../charts.js";

const CACHE = id => `mb-snaps-v1-${id}`;
const MIX = [
  { key: "cash", name: "Cash", color: "var(--joint)" },
  { key: "investments", name: "Investments", color: "var(--invest)" },
  { key: "super", name: "KiwiSaver / super", color: "#3E5A63" },
  { key: "debt", name: "Debt", color: "var(--bad)", below: true },
];

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

async function saveNow(btn) {
  btn.disabled = true;
  if (app.store && app.store.busy()) await app.store.flushNow(); // a snapshot is of what's saved, so finish saving first
  const { data, error } = await app.sb.rpc("save_snapshot_now", { p_household: app.household.id });
  btn.disabled = false;
  if (error) { toast(app.friendly ? app.friendly(error) : "Couldn’t save a snapshot"); return; }
  app.snapshots = [...(app.snapshots || []).filter(s => s.kind !== "manual" || s.id !== data.id), data];
  try { localStorage.setItem(CACHE(app.household.id), JSON.stringify(app.snapshots)); } catch (_) {}
  toast("Snapshot saved");
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

export function view() {
  const snaps = app.snapshots;
  const canSave = !readOnly() && !app.offline;
  const saveBtn = `<button class="btn ${snaps && snaps.length ? "" : "primary"}" type="button" data-snap="save"${canSave ? "" : " disabled"}>Save a snapshot now</button>`;
  const saveHelp = readOnly() ? "Only owners and editors can save snapshots." : app.offline ? "Saving a snapshot needs a connection." : "Handy right after you’ve updated your balances on Net worth.";
  if (!snaps) return `${attnBox()}<div class="panel pg-empty"><p class="lead">Loading your snapshots…</p></div>`;
  if (!snaps.length) return `${attnBox()}
    <div class="panel pg-empty">
      <h2>Your progress will show here</h2>
      <p class="lead">Charts appear after your first <b>snapshot</b>: a copy of your account balances and goals at one moment in time.</p>
      <ul class="ob-why"><li>A snapshot is saved automatically on the <b>1st of every month</b> (NZ time), even if nobody opens the app.</li>
        <li>Each month adds a point to the charts, so you can see your net worth, debts and goals change over time.</li>
        <li>Charts use the balances on the <b>Net worth</b> tab, so keep those up to date.</li></ul>
      <div class="pg-save">${saveBtn}<small>${esc(saveHelp)}</small></div>
    </div>`;
  const cmp = app.compareId && snaps.find(s => String(s.id) === String(app.compareId));
  return `${attnBox()}
  <div class="pg-notes panel" id="pgNotes"></div>
  ${cmp ? compareHTML(cmp) : ""}
  <section><div class="sec-head"><h2>Net worth over time</h2>${tipq("Everything you own minus everything you owe, from your Net worth tab. One point per month; the hollow dot is today.")}<span class="sec-note">One point per month, and today at the end.</span></div>
    <div class="panel"><div class="line-wrap" id="pgNet"></div></div></section>
  <section><div class="sec-head"><h2>What you own and owe</h2>${tipq("Above the line: cash, investments and KiwiSaver. Below the line: debts. A shrinking red bar is good news.")}<span class="sec-note">Above the line is what you own; below it is what you owe.</span></div>
    <div class="panel"><div class="line-wrap" id="pgMix"></div><div class="split-key" style="padding:0 18px 16px">${MIX.map(q => `<span><i style="background:${q.color}"></i>${q.name}</span>`).join("")}</div></div></section>
  <section><div class="sec-head"><h2>Goal progress</h2><span class="sec-note">How much is saved towards each goal, month by month. The dashed line is the target.</span></div>
    <div class="pg-goals" id="pgGoals"></div></section>
  <section><div class="sec-head"><h2>Snapshots</h2>${tipq("A snapshot is a copy of your balances and goals at one moment. One is saved automatically on the 1st of each month.")}<span class="sec-note">Tap one to compare it with today.</span></div>
    <div class="panel"><ul class="pg-list">${[...snaps].reverse().map(s => `<li><span><b>${esc(s.kind === "monthly" ? monthYear(monthOf(s)) : dateText(s))}</b><small>${esc(whoSaved(s))}</small></span>
      <span class="pg-nw">${m0(summarizeSnapshot(s).netWorth)}</span><button class="btn small" type="button" data-compare="${esc(s.id)}"${String(app.compareId) === String(s.id) ? ' aria-pressed="true"' : ""}>Compare</button></li>`).join("")}</ul>
      <div class="pg-save">${saveBtn}<small>${esc(saveHelp)}${app.snapshotsOffline ? " Showing the copy saved on this device." : ""} The newest 24 saved snapshots are kept, plus every monthly one.</small></div></div></section>`;
}

function compareHTML(s) {
  const then = summarizeSnapshot(s), now = summarize(app.state), rows = compare(then, now);
  const label = s.kind === "monthly" ? monthYear(monthOf(s)) : dateText(s);
  const cell = v => v === null ? '<span class="dim">—</span>' : money(v);
  return `<section class="pg-compare" id="pgCompare"><div class="sec-head"><h2>${esc(label)} vs today</h2><button class="btn small" type="button" data-compare="close">Close</button>
      <span class="sec-note">${esc(whoSaved(s))}${then.reviewed ? `. Balances were last reviewed ${esc(new Date(then.reviewed).toLocaleDateString("en-NZ", { day: "numeric", month: "short" }))} at the time.` : "."}</span></div>
    <div class="panel scroll cards"><table>
      <thead><tr><th></th><th class="num">${esc(label)}</th><th class="num">Today</th><th class="num">Change</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="cmp-${r.kind}"><td class="c-name"><b>${esc(r.label)}</b>${r.group ? `<small class="dim"> · ${esc(r.group)}</small>` : ""}${r.kind === "goal" && r.targetNow ? `<small class="dim"> · target ${m0(r.targetNow)}</small>` : ""}</td>
        <td class="num" data-label="${esc(label)}">${cell(r.then)}</td><td class="num" data-label="Today">${cell(r.now)}</td>
        <td class="num" data-label="Change"><span class="chip ${Math.abs(r.diff) < 0.5 ? "" : isGood(r.diff, r.kind) ? "ok" : "bad"}">${diffText(r.diff, r.kind)}</span></td></tr>`).join("")}</tbody>
    </table></div></section>`;
}

export function fill() {}

export function draw() {
  const snaps = app.snapshots; if (!snaps || !snaps.length) return;
  const pts = trendPoints(snaps, app.state, app.today);
  const notes = progressNotes(pts, app.today);
  const now = pts[pts.length - 1];
  const nb = $("#pgNotes");
  if (nb) nb.innerHTML = `<div class="pg-big"><div class="k">Net worth today</div><div class="v">${money(now.netWorth)}</div></div><ul>${notes.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`;
  drawLineChart($("#pgNet"), pts, [{ name: "Net worth", values: pts.map(p => p.netWorth), color: "var(--accent)" }], "Net worth over time");
  drawMixChart($("#pgMix"), pts, MIX);
  const gl = $("#pgGoals");
  if (gl) gl.innerHTML = now.goals.length ? now.goals.map(g => {
    const hist = goalHistory(pts, g.id);
    return `<div class="pg-goal panel"><div class="pg-goal-h"><b>${esc(g.name)}</b><small>${esc(g.group)}</small></div>
      <div class="pg-goal-row"><div><div class="v">${m0(g.saved)}${g.target ? `<small> of ${m0(g.target)}</small>` : ""}</div>
        <div class="bar"><span style="width:${(g.pct || 0) * 100}%"></span></div><small class="dim">${esc(goalNote(g, pts, app.today) || "Add a target to track progress")}</small></div>
        ${sparkline(hist.map(h => h.saved), g.target, "var(--accent)")}</div></div>`;
  }).join("") : `<p class="dim">No goals yet. Add some on the Goals tab and they’ll show here.</p>`;
}

/* ---------- clicks ---------- */
export function initProgress() {
  let t = null; // redraw the charts at the new size when the screen turns or the window changes
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (app.tab === "progress" && app.snapshots && app.snapshots.length) draw(); }, 200); });
  document.addEventListener("click", e => {
    const s = e.target.closest("[data-snap]");
    if (s && s.dataset.snap === "save" && !s.disabled) { saveNow(s); return; }
    const c = e.target.closest("[data-compare]");
    if (c) {
      app.compareId = c.dataset.compare === "close" || String(app.compareId) === c.dataset.compare ? null : c.dataset.compare;
      app.render();
      const box = $("#pgCompare"); if (box) box.scrollIntoView({ block: "start", behavior: "smooth" }); else window.scrollTo({ top: 0 });
    }
  });
}

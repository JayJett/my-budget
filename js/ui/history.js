/* History panel (⋯ menu → History), "Preview this version" and restore, and the Undo button in the header.
   The wording and the maths live in js/model/history.js; the database does the actual undo and restore
   (undo_budget_change, restore_budget_version), so they're safe even if two people are editing. */
import { app, readOnly } from "./ctx.js";
import { $, esc, toast, confirmDel } from "./dom.js";
import { describeEntries, describeChanges, changesBetween, stateAt, groupByDay, whenText, getPath } from "../model/history.js";
import { possessive } from "../model/format.js";

const PAGE = 60;
const COLS = "id, changed_by, changed_at, kind, reason, ref_id, ref_at, undone_at, changes";
const friendly = e => app.friendly ? app.friendly(e) : (e && e.message) || "Something went wrong.";
const canChange = () => !readOnly() && !app.offline;

/** "You", "Madi", or "Someone" for a person who's since left. */
export function whoName(id) {
  if (id && id === app.meId) return "You";
  const m = id && app.members.find(x => x.user_id === id);
  return (m && (m.display_name || (m.email || "").split("@")[0])) || "Someone";
}

/* ---------- the panel ---------- */
const H = { entries: [], current: null, more: false, view: "list", busy: false };

function sheet(title, html) {
  const d = $("#sheet");
  d.innerHTML = `<div class="sheet-head"><h3 tabindex="-1" autofocus>${esc(title)}</h3><button class="btn icon" type="button" data-sheet="close" aria-label="Close">✕</button></div><div class="sheet-body hist">${html}</div>`;
  if (!d.open) d.showModal();
}
const isOpen = () => $("#sheet").open && !!$("#sheet .hist");

export async function openHistory() {
  H.view = "list"; H.entries = []; H.current = null;
  sheet("History", `<p class="set-note">Loading…</p>`);
  if (app.offline || navigator.onLine === false) { sheet("History", `<p class="lead">History needs a connection. Your changes are kept on this phone and will show here once they sync.</p>`); return; }
  if (app.store && app.store.busy()) await app.store.flushNow(); // so your latest change is in the list
  await load();
}

/** Fetch the latest budget and the newest entries (or the next page of older ones). */
async function load(older) {
  const hh = app.household; if (!hh) return;
  let q = app.sb.from("budget_changes").select(COLS).eq("household_id", hh.id);
  if (older && H.entries.length) q = q.lt("id", H.entries[H.entries.length - 1].id);
  const [{ data, error }, b] = await Promise.all([q.order("id", { ascending: false }).limit(PAGE),
    older ? Promise.resolve({ data: { state: H.current } }) : app.sb.from("budgets").select("state, seq").eq("household_id", hh.id).maybeSingle()]);
  if (!isOpen() || !app.household || app.household.id !== hh.id) return;
  if (error || b.error) { sheet("History", `<div class="msg err">${esc(friendly(error || b.error))}</div>`); return; }
  H.current = (b.data && b.data.state) || {};
  H.entries = older ? [...H.entries, ...(data || [])] : (data || []);
  H.more = (data || []).length === PAGE;
  drawList();
}

function drawList() {
  H.view = "list";
  const list = describeEntries(H.current, H.entries, { whoName });
  const intro = `<p class="set-note hist-intro">Every change to this budget from the last 90 days: who made it and when. ${canChange() ? "Tap one to see the details, undo it, or go back to how the budget was at that point." : readOnly() ? "You can look, but only owners and editors can undo changes." : ""}</p>`;
  if (!list.length) { sheet("History", `${intro}<div class="hist-empty"><b>No changes yet</b><p class="set-note">When anyone changes the budget, it’ll show here.</p></div>`); return; }
  const item = e => {
    const setupEntry = isSetupEntry(e);
    const tag = e.undone_at ? `<span class="chip">Undone</span>` : setupEntry ? `<span class="chip info">Budget set up</span>` : e.kind === "restore" ? `<span class="chip info">Restore</span>` : e.kind === "undo" ? `<span class="chip">Undo</span>` : "";
    const lines = e.lines.length > 1 || e.kind !== "edit" ? `<ul class="hist-lines">${e.lines.slice(0, 40).map(l => `<li>${esc(l.short)}</li>`).join("")}${e.lines.length > 40 ? `<li class="dim">…and ${e.lines.length - 40} more</li>` : ""}</ul>` : "";
    const acts = `<div class="hist-acts">${canChange() && !e.undone_at && !setupEntry ? `<button class="btn small" type="button" data-hist="undo" data-id="${e.id}">Undo this change</button>` : ""}
      <button class="btn small" type="button" data-hist="preview" data-id="${e.id}">See the budget at this point</button></div>`;
    return `<li class="hist-item${e.undone_at ? " undone" : ""}"><details><summary><span class="hist-text">${esc(e.headline)} ${tag}</span><span class="hist-time">${esc(e.time)}</span></summary>
      <div class="hist-body">${lines}${acts}</div></details></li>`;
  };
  sheet("History", `${intro}${groupByDay(list).map(g => `<h4 class="hist-day">${esc(g.day)}</h4><ul class="hist-list">${g.entries.map(item).join("")}</ul>`).join("")}
    ${H.more ? `<div class="hist-more"><button class="btn" type="button" data-hist="older">Show older changes</button></div>` : ""}
    <p class="set-note">History is kept for 90 days. For longer-term trends, see the Progress tab.</p>`);
}

/* ---------- preview and restore ---------- */
async function preview(id) {
  const e = H.entries.find(x => String(x.id) === String(id)); if (!e) return;
  H.view = "preview";
  sheet("History", `<p class="set-note">Working out how the budget looked…</p>`);
  if (app.store && app.store.busy()) await app.store.flushNow();
  // Always from the latest copy, in case someone changed something since the list was loaded.
  const hh = app.household;
  const [b, later] = await Promise.all([
    app.sb.from("budgets").select("state, seq").eq("household_id", hh.id).maybeSingle(),
    app.sb.from("budget_changes").select(COLS).eq("household_id", hh.id).gt("id", e.id).order("id", { ascending: false }),
  ]);
  if (!isOpen() || H.view !== "preview") return;
  if (b.error || later.error) { sheet("History", `<div class="msg err">${esc(friendly(b.error || later.error))}</div>${backBtn}`); return; }
  const now = b.data.state, then = stateAt(now, later.data || [], e.id);
  const lines = describeChanges(changesBetween(now, then), now, then);
  const [d] = describeEntries(then, [e], { whoName }); // the headline, worded with the names as they were then
  const when = whenText(e.changed_at);
  const restore = canChange() && lines.length ? `<button class="btn primary" type="button" data-hist="restore" data-id="${e.id}">Restore this version</button>` : "";
  sheet("History", `<section class="set"><h4>The budget on ${esc(when)}</h4>
      <p class="set-note">Right after: ${esc(d.headline)}.</p></section>
    <section class="set">${lines.length ? `<h4>Going back to this version would change ${lines.length === 1 ? "1 thing" : `${lines.length} things`}</h4>
      <ul class="hist-lines big">${lines.slice(0, 60).map(l => `<li>${esc(l.short)}</li>`).join("")}${lines.length > 60 ? `<li class="dim">…and ${lines.length - 60} more</li>` : ""}</ul>`
      : `<h4>Nothing to change</h4><p class="set-note">The budget is the same now as it was then.</p>`}
      ${readOnly() && lines.length ? `<p class="set-note">Only owners and editors can restore an earlier version.</p>` : ""}
      ${app.offline ? `<p class="set-note">Restoring needs a connection.</p>` : ""}</section>
    <div class="hist-acts">${backBtn}${restore}</div>`);
}
const backBtn = `<button class="btn" type="button" data-hist="back">Back to history</button>`;

async function restore(id, btn) {
  const e = H.entries.find(x => String(x.id) === String(id)); if (!e) return;
  const when = whenText(e.changed_at);
  if (!await confirmDel("Restore this version?", `The budget goes back to how it was on ${when}. This is saved as a new change, so you can undo it afterwards.`, "Restore")) return;
  btn.disabled = true;
  if (app.store && app.store.busy()) await app.store.flushNow();
  const { data, error } = await app.sb.rpc("restore_budget_version", { p_household: app.household.id, p_change_id: e.id });
  btn.disabled = false;
  if (error) { toast(friendly(error)); return; }
  adoptResult(data);
  rememberChange(data); // so the Undo button can take the restore back
  toast(`Restored the version from ${when}`);
  await openHistory();
}

/* ---------- undo ---------- */
/* Phase 7D.1: the budget's starting point is never something to undo.
   Setting the budget up (the setup guide's plan, or the empty budget behind "Set up later") is saved as
   one change like any other, but it's the baseline, not an edit: undoing it would wipe the setup.
   So the save that creates the budget is held back from the Undo button (holdUndoForSetup), and in
   the History panel an entry that creates the budget is labelled "Budget set up" with no Undo.
   It's also saved as one whole-budget "replace" labelled SETUP_REASON, which the database never merges
   with later edits. (A normal save would have been: the database groups your edits to the same area
   within 2 minutes into one entry, and setup touches every area, so your first real edit used to be
   folded into the setup entry, and undoing it undid the whole setup.) */
export const SETUP_REASON = "Budget set up";
export function holdUndoForSetup() {
  app.undoHold = true;
  if (app.store && app.store.replaceNext) app.store.replaceNext(SETUP_REASON);
}
/** A history entry that created the budget: saved by setup, or (older budgets) its version went from nothing to something. */
export const isSetupEntry = e => (e.kind === "replace" && e.reason === SETUP_REASON)
  || (e.changes || []).some(c => Array.isArray(c.p) && c.p.length === 1 && c.p[0] === "version" && (c.o === null || c.o === undefined));

/** Your changes made in this session, newest last (history entry ids), for the Undo button. */
export function rememberChange(data) {
  if (!data || !data.change_id || readOnly()) return;
  if (app.undoHold || app.setup) { app.undoHold = false; return; } // the budget's starting point: not undoable
  const s = app.undoStack || (app.undoStack = []);
  if (s[s.length - 1] !== data.change_id) s.push(data.change_id);
  updateUndo();
}
export function resetUndo() { app.undoStack = []; app.undoHold = false; updateUndo(); }

export function updateUndo() {
  const b = $("#undoBtn"); if (!b) return;
  const show = !readOnly() && !!(app.undoStack && app.undoStack.length);
  b.hidden = !show;
  b.disabled = !!app.offline || navigator.onLine === false || H.busy;
  b.dataset.tip = b.disabled && !H.busy ? "Undo needs a connection." : "Undo your last change";
}

/** Put the new budget from an undo or restore on screen (and into the device copy). */
function adoptResult(data) {
  if (!data || !app.store) return;
  app.store.receive({ state: data.state, seq: data.seq, updated_by: data.updated_by, updated_at: data.updated_at });
}

/** The thing a path is about, for messages: "Groceries", "Madi’s pay", "the investment settings". */
function thingName(p, s) {
  const name = q => { const x = getPath(s, q); return x && x.name ? String(x.name) : null; };
  if (p[0] === "spend") return name(["spend", p[1]]) || "a spending category";
  if (p[0] === "accounts") return name(["accounts", p[1]]) || "an account";
  if (p[0] === "nw" && p[1] === "accounts") return name(["nw", "accounts", p[2]]) || "a Net worth account";
  if (p[0] === "people") return p[2] === "pay" ? `${possessive(name(["people", p[1]]) || "")} pay` : name(["people", p[1]]) || "a person";
  if (p[0] === "goals") return p[1] === "ef" ? "the emergency fund" : (p[1] === "joint" ? name(["goals", "joint", p[2]]) : name(["goals", "personal", p[2], p[3]])) || "a goal";
  if (p[0] === "invest") return "the investment settings";
  if (p[0] === "note") return "the budget note";
  return "that";
}

/** Undo one change: the newest of yours from the Undo button, or any from the History panel. */
async function undo(id, { fromButton } = {}) {
  if (H.busy) return; H.busy = true; updateUndo();
  try {
    if (app.store && app.store.busy()) await app.store.flushNow();
    const stack = app.undoStack || [];
    for (;;) {
      const target = id || stack.pop();
      if (!target) { toast("Nothing left to undo"); return; }
      const before = app.store ? app.store.serverCopy() : null;
      const { data, error } = await app.sb.rpc("undo_budget_change", { p_household: app.household.id, p_change_id: target });
      if (error) {
        // Already undone (e.g. from History) or merged away: try the one before it.
        if (fromButton && /already been undone|no longer in the history/i.test(error.message || "")) continue;
        toast(friendly(error)); return;
      }
      if (!fromButton) { const i = stack.indexOf(Number(target)); if (i >= 0) stack.splice(i, 1); }
      adoptResult(data);
      const skipped = (data.skipped || []).map(x => `${x.by === app.meId ? "You have" : `${whoName(x.by)} has`} changed ${thingName(x.p, data.state)} since, so it was left as it is.`);
      const lines = before ? describeChanges(changesBetween(before, data.state), before, data.state) : [];
      if (!data.change_id) toast(skipped.length ? `Nothing to undo. ${[...new Set(skipped)].join(" ")}` : "Nothing to undo: it’s already back how it was.");
      else toast(`Undone${lines.length === 1 ? `. ${lines[0].short}` : ""}${skipped.length ? `. ${[...new Set(skipped)].join(" ")}` : ""}`);
      return;
    }
  } finally {
    H.busy = false; updateUndo();
    if (isOpen() && H.view === "list") load();
  }
}

/* ---------- clicks ---------- */
export function initHistory() {
  const d = $("#sheet");
  d.addEventListener("click", e => {
    const b = e.target.closest("[data-hist]"); if (!b || b.disabled) return;
    const act = b.dataset.hist;
    if (act === "older") { b.disabled = true; load(true); }
    if (act === "preview") preview(b.dataset.id);
    if (act === "back") drawList();
    if (act === "restore") restore(b.dataset.id, b);
    if (act === "undo") undo(b.dataset.id);
  });
  document.addEventListener("click", e => { if (e.target.closest("#undoBtn") && !e.target.closest("#undoBtn").disabled) undo(null, { fromButton: true }); });
  // Ctrl+Z / ⌘Z outside a text box (inside one, the browser's own undo for typing still works)
  document.addEventListener("keydown", e => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
    const t = e.target; if (t && (t.closest("input, textarea, select, [contenteditable]") || t.closest("dialog[open]"))) return;
    const b = $("#undoBtn"); if (!b || b.hidden || b.disabled) return;
    e.preventDefault(); undo(null, { fromButton: true });
  });
  window.addEventListener("online", updateUndo);
  window.addEventListener("offline", updateUndo);
}

/** Someone else saved while the History list is open: refresh it. */
export function historyNoticeRemote() { if (isOpen() && H.view === "list") load(); }

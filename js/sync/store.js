/* Saving and live updates.

   How it works, in plain terms:
   - `base` is the budget exactly as the database last told us it is (stored shape).
   - When you edit, we wait 0.8s, then send only the differences between `base` and your screen
     (diff in ops.js) to the database function apply_budget_ops.
   - The database applies them and sends back the full, up-to-date budget, which may include
     someone else's changes. Any edits you made *while* it was saving are put back on top
     ("rebasing"), so nothing you typed is lost.
   - When someone else saves, the live-update channel tells us, and we rebase the same way.
   - Every save has a number (seq). Anything older than what we already have is ignored.
   - A copy of the budget, including edits not yet sent, is kept on this device (localStorage),
     so the app opens offline and sends those edits when the connection comes back. */
import { diff, applyOps, same } from "./ops.js";
import { toStored, fromStored, VERSION } from "../model/schema.js";
import { migrate } from "../model/migrate.js";

export function createStore({ sb, householdId, getState, setState, onStatus, onRemote }) {
  let base = {}, seq = -1;
  let timer = null, writing = false, again = false, retryTimer = null, chain = 0;
  let replaceReason = null;  // set when the next save must replace the whole budget (upgrade/import)
  let queuedRemote = null;   // a live update that arrived while we were saving
  let channel = null;

  const local = () => toStored(getState());
  const dirty = () => replaceReason !== null || diff(base, local()).length > 0;

  /* ---------- the copy kept on this device ---------- */
  const CACHE_KEY = CACHE_PREFIX + householdId;
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ base, seq, local: local(), replaceReason, at: Date.now() })); } catch (_) { /* full or blocked: carry on */ }
  }
  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (_) { return null; } }
  const goOnline = () => { if (dirty()) flush(); };
  window.addEventListener("online", goOnline);

  /** Accept a newer server copy, put `pending` (our unsaved edits) on top, and show the result. */
  function adopt(serverDoc, serverSeq, pending, meta) {
    const before = local();
    base = serverDoc; seq = serverSeq;
    const merged = applyOps(serverDoc, pending);
    if (!same(merged, before)) { setState(fromStored(merged)); onRemote(meta); }
    saveCache();
  }

  /** Load the budget. Returns { state (null if nothing saved yet), upgraded, offline, resumed, meta }.
      offline: the database couldn't be reached, so this is the copy on this device.
      resumed: edits made earlier on this device (e.g. offline) were put back on top and need saving. */
  async function load() {
    const cached = readCache();
    const { data, error } = await sb.from("budgets").select("state, seq, updated_by, updated_at").eq("household_id", householdId).maybeSingle();
    if (error) {
      if (!cached || !isNetworkError(error)) throw error;
      base = cached.base || {}; seq = Number(cached.seq ?? -1); replaceReason = cached.replaceReason ?? null;
      return { state: migrate(cached.local) || migrate(base), upgraded: false, offline: true, resumed: false, meta: null };
    }
    const raw = (data && data.state) || {};
    base = raw; seq = data ? Number(data.seq ?? 0) : 0;
    // Edits made on this device that never reached the database: put them on top of the latest copy.
    if (cached && cached.local && raw.version === VERSION && !Array.isArray(raw.people)) {
      const pending = cached.replaceReason ? diff(raw, cached.local) : diff(cached.base || {}, cached.local);
      if (pending.length) {
        const merged = applyOps(raw, pending);
        if (!same(merged, raw)) {
          replaceReason = cached.replaceReason || null; // e.g. a file imported while offline still saves with a backup
          return { state: fromStored(merged), upgraded: false, offline: false, resumed: true, meta: data };
        }
      }
    }
    const state = migrate(raw);
    if (!state) { saveCache(); return { state: null, upgraded: false, offline: false, resumed: false, meta: data }; }
    const upgraded = raw.version !== VERSION || Array.isArray(raw.people);
    if (upgraded) replaceReason = `Upgrade from version ${raw.version ?? "?"} to version ${VERSION}`;
    return { state, upgraded, offline: false, resumed: false, meta: data };
  }

  function schedule() {
    chain = 0;
    clearTimeout(timer); clearTimeout(retryTimer);
    saveCache(); // keep the latest edits on this device straight away
    onStatus(navigator.onLine === false ? "offline" : "saving");
    timer = setTimeout(() => { timer = null; flush(); }, 800);
  }

  function processQueued() {
    if (!queuedRemote) return;
    const r = queuedRemote; queuedRemote = null; receive(r);
  }

  async function flush(retried) {
    if (writing) { again = true; return; }
    const target = local();
    const ops = replaceReason !== null ? [{ op: "replace", value: target, reason: replaceReason }] : diff(base, target);
    if (!ops.length) { onStatus("saved"); processQueued(); return; }
    writing = true;
    const { data, error } = await sb.rpc("apply_budget_ops", { p_household: householdId, p_ops: ops });
    writing = false;
    if (error) {
      saveCache();
      if (isNetworkError(error) && navigator.onLine === false) { onStatus("offline"); return; } // the "online" event will retry
      if (!retried && !/not a member|permission|not signed in|view-only/i.test(error.message || "")) {
        await new Promise(r => setTimeout(r, 700 + Math.random() * 900));
        return flush(true);
      }
      onStatus("error", error);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => flush(), 15000); // keep trying quietly in the background
      return;
    }
    replaceReason = null;
    const pending = diff(target, local()); // anything typed while the save was on its way
    adopt(data.state, Number(data.seq), pending, { by: data.updated_by, at: data.updated_at, self: true });
    processQueued();
    // Keep going if there's more to save, but never loop forever on our own.
    if ((again || dirty()) && chain++ < 3) { again = false; return flush(); }
    again = false;
    onStatus(dirty() ? "error" : "saved", { by: data.updated_by, at: data.updated_at });
  }

  /** A live update from the database. */
  function receive(row) {
    const rseq = Number(row.seq ?? 0);
    if (rseq <= seq) return;                         // old news, or our own save echoing back
    if (writing || timer) { if (!queuedRemote || rseq > Number(queuedRemote.seq)) queuedRemote = row; return; }
    const doc = row.state || {};
    const meta = { by: row.updated_by, at: row.updated_at };
    if (doc.version !== VERSION || Array.isArray(doc.people)) {
      // Someone saved with the old app: convert it, and save the converted copy.
      base = doc; seq = rseq;
      const s = migrate(doc);
      if (s) { setState(s); replaceReason = "Converted a save from the old app"; onRemote(meta); schedule(); }
      return;
    }
    const pending = replaceReason !== null ? [] : diff(base, local());
    adopt(doc, rseq, pending, meta);
    if (pending.length) schedule();
  }

  function subscribe(onConn) {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("budget-" + householdId)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "budgets", filter: "household_id=eq." + householdId }, payload => { if (payload.new) receive(payload.new); })
      .subscribe(status => onConn(status));
  }

  async function stop() {
    clearTimeout(retryTimer);
    window.removeEventListener("online", goOnline);
    if (timer) { clearTimeout(timer); timer = null; await flush(); }
    if (channel) { sb.removeChannel(channel); channel = null; }
  }

  return {
    load, schedule, subscribe, stop, receive,
    flushNow: () => { if (timer) { clearTimeout(timer); timer = null; } return flush(); },
    busy: () => !!(timer || writing),
    hasUnsaved: () => !!(timer || writing) || dirty(),
    replaceNext: reason => { replaceReason = reason; saveCache(); },
    saveCache,
  };
}

/* ---------- helpers shared with the rest of the app ---------- */
export const CACHE_PREFIX = "mb-cache-v1-";
/** True when a request failed because there's no connection (rather than being refused). */
export const isNetworkError = e => navigator.onLine === false || /failed to fetch|network|load failed|fetch failed|offline/i.test((e && (e.message || e.details)) || "");
/** Forget every budget copy kept on this device (used when signing out or deleting your account). */
export function clearDeviceCopies() {
  try { Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k)); } catch (_) {}
}

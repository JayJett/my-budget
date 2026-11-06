/* Saving and live updates.

   How it works, in plain terms:
   - `base` is the budget exactly as the database last told us it is (stored shape).
   - When you edit, we wait 0.8s, then send only the differences between `base` and your screen
     (diff in ops.js) to the database function apply_budget_ops.
   - The database applies them and sends back the full, up-to-date budget, which may include
     someone else's changes. Any edits you made *while* it was saving are put back on top
     ("rebasing"), so nothing you typed is lost.
   - When someone else saves, the live-update channel tells us, and we rebase the same way.
   - Every save has a number (seq). Anything older than what we already have is ignored. */
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

  /** Accept a newer server copy, put `pending` (our unsaved edits) on top, and show the result. */
  function adopt(serverDoc, serverSeq, pending, meta) {
    const before = local();
    base = serverDoc; seq = serverSeq;
    const merged = applyOps(serverDoc, pending);
    if (!same(merged, before)) { setState(fromStored(merged)); onRemote(meta); }
  }

  /** Load the budget. Returns { state (null if nothing saved yet), upgraded, meta }. */
  async function load() {
    const { data, error } = await sb.from("budgets").select("state, seq, updated_by, updated_at").eq("household_id", householdId).maybeSingle();
    if (error) throw error;
    const raw = (data && data.state) || {};
    base = raw; seq = data ? Number(data.seq ?? 0) : 0;
    const state = migrate(raw);
    if (!state) return { state: null, upgraded: false, meta: data };
    const upgraded = raw.version !== VERSION || Array.isArray(raw.people);
    if (upgraded) replaceReason = `Upgrade from version ${raw.version ?? "?"} to version ${VERSION}`;
    return { state, upgraded, meta: data };
  }

  function schedule() {
    chain = 0;
    clearTimeout(timer); clearTimeout(retryTimer);
    onStatus("saving");
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
      if (!retried && !/not a member|permission|not signed in/i.test(error.message || "")) {
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
    if (timer) { clearTimeout(timer); timer = null; await flush(); }
    if (channel) { sb.removeChannel(channel); channel = null; }
  }

  return {
    load, schedule, subscribe, stop, receive,
    flushNow: () => { if (timer) { clearTimeout(timer); timer = null; } return flush(); },
    busy: () => !!(timer || writing),
    hasUnsaved: () => !!(timer || writing) || dirty(),
    replaceNext: reason => { replaceReason = reason; },
  };
}

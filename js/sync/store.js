/* A store owns one user's working copy of one household. UI edits are handed to
   it synchronously. Network continuations never read the active screen. */
import { diff, applyOps, same } from "./ops.js";
import { toStored, fromStored, VERSION } from "../model/schema.js";
import { migrate } from "../model/migrate.js";

export const CACHE_PREFIX = "mb-cache-v2-";
const LEGACY_PREFIX = "mb-cache-v1-";
const DRAFT_PREFIX = "mb-draft-v2-";
const closingWrites = new Map();
const copy = value => JSON.parse(JSON.stringify(value));
const read = (storage, key) => {
  try { return JSON.parse(storage.getItem(key) || "null"); } catch (_) { return null; }
};
const hasChanges = draft => !!draft?.local && (!!draft.replaceReason || !same(draft.base, draft.local));
const cancelled = () => ({ message: "The budget is no longer open", cancelled: true });
const denied = error => /not a member|permission|not signed in|view.only|no longer have access/i.test(error?.message || "") || error?.code === "42501";
export const isNetworkError = e => navigator.onLine === false || /failed to fetch|network|load failed|fetch failed|offline|abort/i.test((e && (e.message || e.details)) || "");

export function hasLegacyBudgetDraft(householdId) {
  return hasChanges(read(localStorage, LEGACY_PREFIX + householdId));
}

export function hasDeviceBudgetDrafts(userId, householdId) {
  const prefix = DRAFT_PREFIX + encodeURIComponent(userId) + ":" + (householdId ? encodeURIComponent(householdId) + ":" : "");
  try { return Object.keys(localStorage).some(key => key.startsWith(prefix) && hasChanges(read(localStorage, key))); }
  catch (_) { return false; }
}

// The session ID is stable across token refreshes. Use it only to distinguish local lifecycles.
export function sessionIdentity(session) {
  try {
    const claims = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(claims)).session_id || null;
  } catch (_) { return null; }
}

export function createStore({ sb, userId, householdId, sessionId = null, canWrite, isCurrent, setState, onStatus, onRemote, onSaved = () => {}, onDenied = () => {} }) {
  if (!userId || !householdId) throw new Error("A budget store needs a user and household");
  const device = localStorage, tab = sessionStorage;
  const identity = encodeURIComponent(userId) + ":" + encodeURIComponent(householdId);
  const cacheKey = CACHE_PREFIX + identity;
  const pointerKey = DRAFT_PREFIX + identity;
  const draftPrefix = pointerKey + ":";
  const draftKey = draftPrefix + crypto.randomUUID();
  let previousDraft = read(tab, pointerKey);
  if (typeof previousDraft !== "string" || !previousDraft.startsWith(draftPrefix)) previousDraft = null;
  let base = {}, local = {}, seq = -1;
  let timer = null, flight = null, writing = false, retryTimer = null, chain = 0;
  let replaceReason = null, stopped = false, blocked = false;
  let queuedRemote = null, channel = null, persistedDraft = null;

  const active = () => !stopped && isCurrent();
  const dirty = () => canWrite && (replaceReason !== null || !same(base, local));
  const draft = () => ({ base, seq, local, replaceReason });

  function saveDraft(detached = false) {
    try {
      if (detached && (persistedDraft === null || device.getItem(draftKey) !== persistedDraft)) return false;
      if (dirty()) {
        const value = JSON.stringify(draft());
        device.setItem(draftKey, value);
        persistedDraft = value;
        if (!detached) tab.setItem(pointerKey, JSON.stringify(draftKey));
      } else {
        device.removeItem(draftKey);
        persistedDraft = null;
        if (!detached && read(tab, pointerKey) === draftKey) tab.removeItem(pointerKey);
      }
      if (!detached && previousDraft) {
        if (read(tab, pointerKey) === previousDraft) tab.removeItem(pointerKey);
        device.removeItem(previousDraft);
        previousDraft = null;
      }
      return true;
    } catch (_) { return false; }
  }

  function cacheBase() {
    try {
      const cached = read(device, cacheKey);
      if (cached && Number(cached.seq) > seq) return;
      device.setItem(cacheKey, JSON.stringify({ base, seq }));
    } catch (_) { /* The server copy is still authoritative. */ }
  }

  // Pin the bearer for this specific request. The shared SDK may refresh its
  // session or switch users before its fetch executes.
  async function withSession(send, stillRelevant = () => true) {
    const current = () => active() && stillRelevant();
    if (!current()) return { error: cancelled() };
    if (navigator.onLine === false) return { error: { message: "Offline" } };
    try {
      const { data, error } = await sb.auth.getSession();
      if (!current()) return { error: cancelled() };
      if (error) return { error };
      const session = data?.session;
      if (session?.user?.id !== userId || !session.access_token || (sessionId && sessionIdentity(session) !== sessionId)) {
        return { error: { message: "Not signed in to this budget" } };
      }
      return await send(session.access_token);
    } catch (error) { return { error }; }
  }

  function request(makeRequest, stillRelevant) {
    return withSession(async token => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        return await makeRequest(sb).setHeader("Authorization", "Bearer " + token).abortSignal(controller.signal);
      } finally { clearTimeout(timeout); }
    }, stillRelevant);
  }

  const readBudget = () => request(() => sb.from("budgets").select("state, seq, updated_by, updated_at")
    .eq("household_id", householdId).maybeSingle());
  const writeBudget = ops => request(() => sb.rpc("apply_budget_ops", { p_household: householdId, p_ops: ops }));

  function publish(merged, meta) {
    const changed = !same(merged, local);
    local = merged;
    if (!active()) { saveDraft(true); return; }
    cacheBase();
    if (canWrite) saveDraft();
    if (changed) {
      setState(fromStored(merged));
      onRemote(meta);
    }
  }

  function adopt(data, pending, meta) {
    const next = Number(data.seq);
    if (next < seq) return;
    base = data.state;
    seq = next;
    publish(applyOps(base, pending), meta);
  }

  async function load() {
    // Returning to the same budget can wait for its prior request to settle.
    // Opening a different household never waits for that request.
    const closing = previousDraft && closingWrites.get(previousDraft);
    if (closing) await closing;
    if (!active()) throw cancelled();
    const pending = canWrite && previousDraft ? read(device, previousDraft) : null;
    const cached = read(device, cacheKey);
    const { data, error } = await readBudget();
    if (!active()) throw cancelled();
    if (!error && !data) throw new Error("You no longer have access to this household");
    const offline = !!error && isNetworkError(error) && !denied(error);
    if (error && (!offline || (!cached && !pending))) throw error;
    const source = offline ? cached || pending : data;
    const raw = (offline ? source.base : source.state) || {};
    base = local = raw;
    seq = Number(source.seq ?? 0);
    const verified = migrate(raw);
    let state = verified;
    let resumed = false;
    const hasPending = hasChanges(pending);
    if (hasPending) {
      const merged = pending.replaceReason
        ? pending.local
        : applyOps(raw, diff(pending.base || {}, pending.local));
      if (!same(merged, raw)) {
        state = migrate(merged);
        if (!state) throw new Error("Pending changes could not be opened");
        local = toStored(state);
        replaceReason = pending.replaceReason || null;
        resumed = true;
      }
    }
    const upgraded = !resumed && !!verified && (raw.version !== VERSION || Array.isArray(raw.people));
    if (upgraded && canWrite) {
      local = toStored(verified);
      replaceReason = { reason: `Upgrade from version ${raw.version ?? "?"} to version ${VERSION}` };
    }
    if (!offline) cacheBase();
    if (canWrite && (resumed || previousDraft)) saveDraft();
    return { state, upgraded, offline, resumed, meta: data };
  }

  function schedule(state) {
    if (!active() || !canWrite) return;
    if (state) local = toStored(state);
    chain = 0;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    saveDraft();
    if (blocked) return;
    onStatus(navigator.onLine === false ? "offline" : "saving");
    timer = setTimeout(() => { timer = null; flush(); }, 800);
  }

  function processQueued() {
    if (!queuedRemote) return;
    const row = queuedRemote;
    queuedRemote = null;
    receive(row);
  }

  function fail(error, retried, retry = true) {
    if (!active()) return { status: "cancelled", error };
    saveDraft();
    if (denied(error)) {
      blocked = true;
      onStatus("error", error);
      onDenied(error);
      return { status: "error", error };
    }
    if (isNetworkError(error) && navigator.onLine === false) {
      onStatus("offline");
      return { status: "offline", error };
    }
    if (retry) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => flush(true), retried ? 15000 : 800);
    }
    onStatus("error", error);
    return { status: "error", error };
  }

  async function save(retried) {
    while (dirty() && active() && !blocked) {
      const target = local, replacement = replaceReason;
      const ops = replacement ? [{ op: "replace", value: target, reason: replacement.reason }] : diff(base, target);
      writing = true;
      const { data, error } = await writeBudget(ops);
      writing = false;
      if (error) {
        if (active() && !retried && !denied(error) && navigator.onLine !== false) {
          retried = true;
          await new Promise(resolve => setTimeout(resolve, 800));
          if (active()) continue;
        }
        return fail(error, retried);
      }
      if (replaceReason === replacement) replaceReason = null;
      // A whole new replacement chosen during this request must remain intact.
      const pending = replaceReason ? diff(data.state, local) : diff(target, local);
      adopt(data, pending, { by: data.updated_by, at: data.updated_at, self: true });
      if (!active()) return { status: "cancelled", acknowledged: true };
      onSaved(data);
      processQueued();
      if (dirty() && ++chain >= 4) break;
      if (!dirty()) {
        onStatus("saved", { by: data.updated_by, at: data.updated_at });
        return { status: "saved" };
      }
    }
    if (!active()) return { status: "cancelled" };
    if (dirty()) return fail({ message: "Changes are still waiting to save" }, retried);
    onStatus("saved");
    processQueued();
    return { status: "saved" };
  }

  function flush(retried = false) {
    if (!active()) return Promise.resolve({ status: "cancelled" });
    if (!canWrite || blocked) return Promise.resolve({ status: "error" });
    if (flight) return flight;
    clearTimeout(retryTimer);
    const task = save(retried).finally(() => {
      if (flight === task) flight = null;
      if (active() && !writing && !timer) processQueued();
    });
    flight = task;
    return task;
  }

  function receive(row) {
    if (!active() || blocked || (row.household_id && row.household_id !== householdId)) return;
    const next = Number(row.seq ?? 0);
    if (next <= seq) return;
    if (writing || timer) {
      if (!queuedRemote || next > Number(queuedRemote.seq)) queuedRemote = row;
      return;
    }
    const doc = row.state || {};
    const meta = { by: row.updated_by, at: row.updated_at };
    if (doc.version !== VERSION || Array.isArray(doc.people)) {
      const state = migrate(doc);
      if (!state) return;
      const pending = dirty();
      const merged = replaceReason ? local : applyOps(toStored(state), pending ? diff(base, local) : []);
      base = doc; seq = next;
      if (canWrite && !replaceReason) replaceReason = { reason: "Converted a save from the old app" };
      publish(merged, meta);
      if (canWrite) schedule();
      return;
    }
    adopt(row, replaceReason ? diff(doc, local) : diff(base, local), meta);
    if (dirty()) schedule();
  }

  function subscribe(onConn) {
    if (!active()) return;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("budget-" + householdId)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "budgets", filter: "household_id=eq." + householdId }, payload => { if (payload.new) receive(payload.new); })
      .subscribe(status => { if (active()) onConn(status); });
  }

  const goOnline = () => { if (active() && dirty() && !blocked) flush(); };
  window.addEventListener("online", goOnline);

  function stop() {
    stopped = true;
    clearTimeout(timer); timer = null;
    clearTimeout(retryTimer);
    queuedRemote = null;
    window.removeEventListener("online", goOnline);
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (flight) {
      const done = flight.catch(() => {}).finally(() => closingWrites.delete(draftKey));
      closingWrites.set(draftKey, done);
    }
  }

  async function commit(ops, stillValid) {
    if (!active()) throw cancelled();
    if (!canWrite || blocked) throw new Error("You can’t change this budget");
    if (timer) { clearTimeout(timer); timer = null; }
    if (flight || dirty()) await flush();
    if (!active()) throw cancelled();
    if (flight || dirty()) throw new Error("Your other changes haven’t saved yet");
    const { data: row, error } = await readBudget();
    if (!active()) throw cancelled();
    if (error) throw error;
    if (!row) throw new Error("This household has no budget yet");
    if (flight || dirty()) throw new Error("Your other changes haven’t saved yet");
    const fresh = migrate(row.state || {});
    if (!fresh || !stillValid(fresh)) { receive(row); return { stale: true }; }
    const target = local;
    writing = true;
    const task = writeBudget(ops).then(({ data, error: writeError }) => {
      writing = false;
      if (writeError) {
        if (denied(writeError)) fail(writeError, false, false);
        throw writeError;
      }
      adopt(data, diff(target, local), { by: data.updated_by, at: data.updated_at, self: true });
      if (active()) {
        onSaved(data);
        processQueued();
        onStatus(dirty() ? "saving" : "saved", { by: data.updated_by, at: data.updated_at });
      }
      return { ok: true, data };
    }).finally(() => {
      if (flight === task) flight = null;
      if (active()) {
        if (dirty() && !timer && !blocked) schedule();
        else if (!timer) processQueued();
      }
    });
    flight = task;
    return task;
  }

  async function catchUp() {
    const { data, error } = await readBudget();
    if (!error && data) receive(data);
  }

  return Object.freeze({
    userId, householdId, load, schedule, subscribe, stop, receive, commit, catchUp,
    isActive: active,
    scopedRequest: request, withSession,
    householdRpc: (name, params) => request(() => sb.rpc(name, { ...params, p_household: householdId })),
    flushNow: async () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (flight) {
        const inProgress = await flight.catch(error => ({ status: "error", error }));
        if (inProgress.status) return inProgress;
      }
      return flush();
    },
    busy: () => !!(timer || flight),
    hasUnsaved: () => dirty(),
    keepPending: () => !dirty() || saveDraft(),
    replaceNext: reason => { if (active() && canWrite) replaceReason = { reason }; },
    serverCopy: () => copy(base),
  });
}

/** Clear device display copies on sign-out. Pending edits remain keyed to their
    original user and household, including legacy drafts of uncertain ownership. */
export function clearDeviceCopies({ discardDraftsFor } = {}) {
  try {
    const discardPrefix = discardDraftsFor ? DRAFT_PREFIX + encodeURIComponent(discardDraftsFor) + ":" : null;
    for (const key of Object.keys(localStorage)) {
      if ([CACHE_PREFIX, "mb-snaps-v1-", "mb-snaps-v2-", "mb-rem-v1-", "mb-rem-v2-"].some(prefix => key.startsWith(prefix))
          || (key.startsWith(LEGACY_PREFIX) && !hasChanges(read(localStorage, key)))
          || (discardPrefix && key.startsWith(discardPrefix))) localStorage.removeItem(key);
    }
    if (discardDraftsFor) {
      const setupPrefix = "mb-ob-accounts-v2-" + encodeURIComponent(discardDraftsFor) + ":";
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith(discardPrefix) || key.startsWith(setupPrefix)) sessionStorage.removeItem(key);
      }
    }
  } catch (_) {}
}

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createStore, clearDeviceCopies, hasDeviceBudgetDrafts, hasLegacyBudgetDraft } from "../js/sync/store.js";
import { blankBudget, toStored } from "../js/model/schema.js";
import { applyOps } from "../js/sync/ops.js";

class MemoryStorage {
  getItem(key) { return this[key] ?? null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { delete this[key]; }
}

let connectivity;
beforeEach(() => {
  connectivity = { onLine: true };
  Object.defineProperty(globalThis, "navigator", { value: connectivity, configurable: true });
  globalThis.window = new EventTarget();
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const row = (name, note) => ({ state: toStored({ ...blankBudget({ name, mode: "solo" }), note }), seq: 1 });
const fail = message => ({ data: null, error: { message } });

function fixture() {
  const budgets = { alpha: row("Alex", "Alpha"), beta: row("Blair", "Beta") };
  const writes = [];
  let session = "editor", nextWrite = null;
  const sb = {
    auth: { async getSession() { return { data: { session: session && { user: { id: session }, access_token: session + "-token" } } }; } },
    from() {
      const builder = query(() => ({ data: structuredClone(budgets[builder.hid]) }));
      return builder;
    },
    rpc(_name, args) {
      return query(async auth => {
        writes.push({ ...structuredClone(args), auth });
        const plan = nextWrite; nextWrite = null;
        if (plan) {
          plan.started.resolve();
          const error = await plan.result.promise;
          if (error) return fail(error);
        }
        const b = budgets[args.p_household];
        b.state = applyOps(b.state, args.p_ops); b.seq++;
        return { data: structuredClone(b) };
      });
    },
  };
  function query(run) {
    let auth;
    return {
      select() { return this; }, eq(_column, hid) { this.hid = hid; return this; }, maybeSingle() { return this; },
      setHeader(name, value) { assert.equal(name, "Authorization"); auth = value; return this; },
      abortSignal() { return this; },
      then(resolve, reject) { return Promise.resolve().then(() => run(auth)).then(resolve, reject); },
    };
  }
  function open(householdId, { userId = "editor", canWrite = true } = {}) {
    const statuses = [], updates = [], saves = [];
    const store = createStore({ sb, userId, householdId, canWrite, isCurrent: () => true,
      setState: state => updates.push(state), onStatus: status => statuses.push(status), onRemote: () => {},
      onSaved: data => saves.push(data) });
    return { store, statuses, updates, saves };
  }
  return { budgets, writes, open, changeSession: userId => { session = userId; },
    delayWrite() { const started = deferred(), result = deferred(); nextWrite = { started, result }; return { started: started.promise, finish: result.resolve }; } };
}

test("a departing editor's acknowledgement stays in that household, and later edits resume there only", async () => {
  const f = fixture();
  const a = f.open("alpha"), base = (await a.store.load()).state;
  const hold = f.delayWrite();
  a.store.schedule({ ...base, note: "Alpha saved first" });
  const saving = a.store.flushNow();
  await hold.started;
  a.store.schedule({ ...base, note: "Alpha saved first", viewAs: "month" });
  assert.equal(a.store.keepPending(), true);
  a.store.stop();

  const b = f.open("beta");
  const other = (await b.store.load()).state;
  b.store.schedule({ ...other, note: "Beta edit" });
  assert.deepEqual(await b.store.flushNow(), { status: "saved" });
  hold.finish();
  assert.deepEqual(await saving, { status: "cancelled", acknowledged: true });
  assert.deepEqual(a.saves, []);
  assert.deepEqual(a.updates, []);
  assert.ok(!a.statuses.includes("saved"));
  assert.deepEqual(b.statuses, ["saving", "saved"]);
  assert.deepEqual(f.writes.map(w => [w.p_household, w.auth, ...w.p_ops.map(o => o.value)]), [
    ["alpha", "Bearer editor-token", "Alpha saved first"], ["beta", "Bearer editor-token", "Beta edit"],
  ]);

  const again = f.open("alpha");
  const resumed = await again.store.load();
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.state.note, "Alpha saved first");
  assert.equal(resumed.state.viewAs, "month");
  assert.equal((await again.store.flushNow()).status, "saved");
  assert.deepEqual(f.writes.at(-1).p_ops, [{ op: "set", path: ["viewAs"], value: "month" }]);
  assert.equal(f.budgets.beta.state.note, "Beta edit");
  assert.equal(f.budgets.beta.state.viewAs, other.viewAs);
  again.store.stop(); b.store.stop();
});

test("a late save error does not retry or announce it in a viewer's household", async () => {
  const f = fixture(), a = f.open("alpha");
  const state = (await a.store.load()).state, hold = f.delayWrite();
  a.store.schedule({ ...state, note: "pending in Alpha" });
  const result = a.store.flushNow();
  await hold.started;
  a.store.stop();
  const b = f.open("beta", { canWrite: false });
  assert.equal((await b.store.load()).state.note, "Beta");
  hold.finish("Failed to fetch");
  assert.equal((await result).status, "cancelled");
  window.dispatchEvent(new Event("online"));
  assert.equal(f.writes.length, 1);
  assert.deepEqual(b.statuses, []);
  assert.equal(f.budgets.beta.state.note, "Beta");
  assert.equal(hasDeviceBudgetDrafts("editor", "alpha"), true);
  b.store.stop();
});

test("a failed online save reports failure, and reconnect saves the original draft", async () => {
  const f = fixture(), a = f.open("alpha");
  const state = (await a.store.load()).state, hold = f.delayWrite();
  a.store.schedule({ ...state, note: "retry this" });
  const result = a.store.flushNow();
  await hold.started;
  const retry = f.delayWrite();
  hold.finish("Failed to fetch");
  await retry.started;
  retry.finish("Failed to fetch");
  assert.equal((await result).status, "error");
  assert.equal(a.statuses.at(-1), "error");
  assert.equal(a.store.hasUnsaved(), true);
  window.dispatchEvent(new Event("online"));
  assert.equal((await a.store.flushNow()).status, "saved");
  assert.deepEqual(f.writes.map(w => w.p_household), ["alpha", "alpha", "alpha"]);
  assert.equal(f.budgets.alpha.state.note, "retry this");
  a.store.stop();
});

test("revoked write access keeps the draft, blocks retry and presents server data in view-only mode", async () => {
  const f = fixture(), a = f.open("alpha");
  const state = (await a.store.load()).state, hold = f.delayWrite();
  a.store.schedule({ ...state, note: "keep until access is restored" });
  const result = a.store.flushNow();
  await hold.started;
  hold.finish("You have view-only access to this budget");
  assert.equal((await result).status, "error");
  window.dispatchEvent(new Event("online"));
  assert.equal((await a.store.flushNow()).status, "error");
  assert.equal(f.writes.length, 1);
  a.store.stop();
  const viewer = f.open("alpha", { canWrite: false });
  assert.equal((await viewer.store.load()).state.note, "Alpha");
  assert.equal(hasDeviceBudgetDrafts("editor", "alpha"), true);
  viewer.store.stop();
  const restored = f.open("alpha");
  assert.equal((await restored.store.load()).state.note, "keep until access is restored");
  restored.store.stop();
});

test("sign-out keeps a pending edit tied to its account and ignores an acknowledgement in the new session", async () => {
  const f = fixture(), a = f.open("alpha");
  const state = (await a.store.load()).state, hold = f.delayWrite();
  a.store.schedule({ ...state, note: "approved edit" });
  const result = a.store.flushNow();
  await hold.started;
  a.store.schedule({ ...state, note: "still pending" });
  a.store.stop();
  clearDeviceCopies();
  f.changeSession("second-user");
  const other = f.open("alpha", { userId: "second-user" });
  assert.equal((await other.store.load()).state.note, "Alpha");
  hold.finish();
  assert.equal((await result).status, "cancelled");
  assert.equal(hasDeviceBudgetDrafts("second-user"), false);
  assert.equal(hasDeviceBudgetDrafts("editor"), true);
  assert.deepEqual(other.updates, []);
  assert.deepEqual(other.saves, []);
  other.store.stop();
  f.changeSession("editor");
  const returning = f.open("alpha");
  assert.equal((await returning.store.load()).state.note, "still pending");
  returning.store.stop();
});

test("a mismatched authenticated user cannot send a pending write", async () => {
  const f = fixture(), a = f.open("alpha");
  const state = (await a.store.load()).state;
  a.store.schedule({ ...state, note: "still mine" });
  f.changeSession("another-user");
  const result = await a.store.flushNow();
  assert.equal(result.status, "error");
  assert.deepEqual(f.writes, []);
  assert.equal(hasDeviceBudgetDrafts("editor", "alpha"), true);
  a.store.stop();
});

test("offline edits restore for the original tab and account, and replay onto the latest server copy", async () => {
  const f = fixture(), a = f.open("alpha");
  const state = (await a.store.load()).state;
  connectivity.onLine = false;
  a.store.schedule({ ...state, note: "offline edit" });
  assert.equal((await a.store.flushNow()).status, "offline");
  a.store.stop();
  const b = f.open("alpha");
  const cached = await b.store.load();
  assert.equal(cached.offline, true);
  assert.equal(cached.state.note, "offline edit");
  b.store.stop();
  f.budgets.alpha.state.viewAs = "month";
  f.budgets.alpha.seq++;
  connectivity.onLine = true;
  const c = f.open("alpha");
  const resumed = await c.store.load();
  assert.equal(resumed.state.note, "offline edit");
  assert.equal(resumed.state.viewAs, "month");
  assert.equal((await c.store.flushNow()).status, "saved");
  assert.deepEqual(f.writes.at(-1).p_ops, [{ op: "set", path: ["note"], value: "offline edit" }]);
  c.store.stop();
});

test("an unscoped legacy draft remains stored and is never shown or sent automatically", async () => {
  const f = fixture();
  const base = f.budgets.alpha.state;
  localStorage.setItem("mb-cache-v1-alpha", JSON.stringify({ base, local: { ...base, note: "unverified" } }));
  const a = f.open("alpha");
  assert.equal((await a.store.load()).state.note, "Alpha");
  assert.equal(hasLegacyBudgetDraft("alpha"), true);
  assert.deepEqual(f.writes, []);
  a.store.stop();
});

test("two tabs keep independent pending drafts for the same signed-in editor", async () => {
  const f = fixture();
  const tabOne = sessionStorage;
  const a = f.open("alpha"), first = (await a.store.load()).state;
  a.store.schedule({ ...first, note: "edit from tab one" });
  const tabTwo = new MemoryStorage();
  globalThis.sessionStorage = tabTwo;
  const b = f.open("alpha"), second = (await b.store.load()).state;
  assert.equal(second.note, "Alpha");
  b.store.schedule({ ...second, viewAs: "month" });
  assert.equal(Object.keys(localStorage).filter(k => k.startsWith("mb-draft-v2-editor:alpha:")).length, 2);
  a.store.stop(); b.store.stop();
  const fromTwo = f.open("alpha");
  assert.equal((await fromTwo.store.load()).state.viewAs, "month");
  assert.equal((await fromTwo.store.flushNow()).status, "saved");
  fromTwo.store.stop();
  globalThis.sessionStorage = tabOne;
  const fromOne = f.open("alpha"), original = (await fromOne.store.load()).state;
  assert.equal(original.note, "edit from tab one");
  assert.equal(original.viewAs, "month");
  assert.equal((await fromOne.store.flushNow()).status, "saved");
  assert.equal(f.budgets.alpha.state.note, "edit from tab one");
  assert.equal(f.budgets.alpha.state.viewAs, "month");
  fromOne.store.stop();
});


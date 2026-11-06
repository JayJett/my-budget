/* A pretend Supabase for browser tests. The test swaps the real Supabase script for this one,
   so the app runs against an in-memory budget and nothing touches the real database.
   Set window.__FAKE_INIT = { budget: {...}, seq: 0 } before the page loads.
   window.__fake exposes what the app sent (rpcCalls) and lets a test push a "someone else saved" update. */
(function () {
  const init = window.__FAKE_INIT || {};
  const ME = "u-me", HH = "hh-1";
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const copy = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
  // Same rules as the database function apply_budget_ops.
  function applyOps(doc, ops) {
    let s = copy(doc) || {};
    for (const o of ops) {
      if (o.op === "replace") { fake.backups.push(copy(s)); s = copy(o.value) || {}; continue; }
      if (o.op === "set") { let c = s; for (let i = 0; i < o.path.length - 1; i++) { if (!isObj(c[o.path[i]])) c[o.path[i]] = {}; c = c[o.path[i]]; } c[o.path[o.path.length - 1]] = copy(o.value === undefined ? null : o.value); }
      else if (o.op === "del") { let c = s; for (let i = 0; i < o.path.length - 1 && isObj(c); i++) c = c[o.path[i]]; if (isObj(c)) delete c[o.path[o.path.length - 1]]; }
      else throw new Error("Unknown change type");
    }
    return s;
  }
  const fake = window.__fake = {
    budget: copy(init.budget || {}), seq: init.seq || 0, rpcCalls: [], backups: [], listeners: [], failNext: 0,
    members: init.members || [{ user_id: ME, display_name: "Jarden", email: "jarden@example.com", role: "owner" }],
    /** Simulate someone else saving: apply ops on the "server" and notify the app. */
    remote(ops, by = "u-other") {
      fake.budget = applyOps(fake.budget, ops); fake.seq++;
      const row = { household_id: HH, state: copy(fake.budget), seq: fake.seq, updated_by: by, updated_at: new Date().toISOString() };
      fake.listeners.forEach(fn => fn({ new: row }));
    },
  };
  const session = { user: { id: ME, email: "jarden@example.com", user_metadata: { name: "Jarden" } } };

  function query(table) {
    const q = { table, filters: {}, single: false, del: false };
    const result = () => {
      if (table === "household_members") {
        if (q.cols && q.cols.includes("households")) return { data: [{ household_id: HH, households: { name: "Test household" } }], error: null };
        return { data: copy(fake.members), error: null };
      }
      if (table === "budgets") return { data: { state: copy(fake.budget), seq: fake.seq, updated_by: ME, updated_at: new Date().toISOString() }, error: null };
      if (table === "household_invites") return { data: [], error: null };
      return { data: [], error: null };
    };
    const b = {
      select(cols) { q.cols = cols; return b; }, eq() { return b; }, is() { return b; }, order() { return b; },
      delete() { q.del = true; return b; }, maybeSingle() { q.single = true; return b; },
      then(res, rej) { return Promise.resolve(result()).then(res, rej); },
    };
    return b;
  }

  window.supabase = {
    createClient() {
      return {
        auth: {
          onAuthStateChange(cb) { setTimeout(() => cb("INITIAL_SESSION", session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
          signOut: async () => ({ error: null }),
          signInWithPassword: async () => ({ error: null }),
        },
        from: query,
        async rpc(name, args) {
          fake.rpcCalls.push({ name, args: copy(args) });
          await new Promise(r => setTimeout(r, 30));
          if (name === "accept_invites") return { data: 0, error: null };
          if (name === "apply_budget_ops") {
            if (fake.failNext > 0) { fake.failNext--; return { data: null, error: { message: "Failed to fetch" } }; }
            fake.budget = applyOps(fake.budget, args.p_ops); fake.seq++;
            return { data: { state: copy(fake.budget), seq: fake.seq, updated_at: new Date().toISOString(), updated_by: ME }, error: null };
          }
          return { data: null, error: { message: "Unknown function " + name } };
        },
        channel() {
          const ch = { on(_e, _f, fn) { fake.listeners.push(fn); return ch; }, subscribe(cb) { setTimeout(() => cb("SUBSCRIBED"), 0); return ch; } };
          return ch;
        },
        removeChannel() {},
      };
    },
  };
})();

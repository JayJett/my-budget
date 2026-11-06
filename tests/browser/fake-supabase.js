/* A pretend Supabase for browser tests. The test swaps the real Supabase script for this one,
   so the app runs against in-memory data and nothing touches the real database.

   Before the page loads, set window.__FAKE_INIT to either
     { budget: {...}, seq: 0 }                                   (one household, you're the owner)
   or
     { households: [{ id, name, role, budget, members: [...] }] } (several households)
   window.__fake exposes what the app sent (rpcCalls, authCalls) and lets a test simulate
   "someone else saved" with __fake.remote(ops). */
(function () {
  const init = window.__FAKE_INIT || {};
  const ME = "u-me";
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const copy = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
  const meMember = role => ({ user_id: ME, display_name: init.myName || "Jarden", email: "jarden@example.com", role, joined_at: "2026-01-01" });

  // Same rules as the database function apply_budget_ops.
  function applyOps(hh, ops) {
    let s = copy(hh.budget) || {};
    for (const o of ops) {
      if (o.op === "replace") { fake.backups.push(copy(s)); hh.backups.push({ state: copy(s), reason: o.reason, taken_at: new Date().toISOString() }); s = copy(o.value) || {}; continue; }
      if (o.op === "set") { let c = s; for (let i = 0; i < o.path.length - 1; i++) { if (!isObj(c[o.path[i]])) c[o.path[i]] = {}; c = c[o.path[i]]; } c[o.path[o.path.length - 1]] = copy(o.value === undefined ? null : o.value); }
      else if (o.op === "del") { let c = s; for (let i = 0; i < o.path.length - 1 && isObj(c); i++) c = c[o.path[i]]; if (isObj(c)) delete c[o.path[o.path.length - 1]]; }
      else throw new Error("Unknown change type");
    }
    return s;
  }

  const households = (init.households || [{ id: "hh-1", name: "Test household", role: "owner", budget: init.budget || {}, seq: init.seq || 0 }])
    .map(h => ({ seq: 0, backups: [], invites: [], ...copy(h), members: h.members ? copy(h.members) : [meMember(h.role || "owner")] }));
  const user = { id: ME, email: "jarden@example.com", user_metadata: { name: init.myName || "Jarden" }, created_at: "2026-01-01T00:00:00Z" };
  let authCb = null;

  const fake = window.__fake = {
    households, rpcCalls: [], authCalls: [], backups: [], listeners: [], failNext: 0, deleted: false,
    get budget() { return households[0].budget; },
    get seq() { return households[0].seq; },
    hh: id => households.find(h => h.id === id),
    /** Simulate someone else saving to the first (or given) household. */
    remote(ops, by = "u-other", id = households[0].id) {
      const hh = fake.hh(id); hh.budget = applyOps(hh, ops); hh.seq++;
      const row = { household_id: id, state: copy(hh.budget), seq: hh.seq, updated_by: by, updated_at: new Date().toISOString() };
      fake.listeners.filter(l => l.id === id).forEach(l => l.fn({ new: row }));
    },
  };
  const mine = () => households.filter(h => h.members.some(m => m.user_id === ME));
  const roleIn = id => { const h = fake.hh(id); const m = h && h.members.find(x => x.user_id === ME); return m ? m.role : null; };
  const err = message => ({ data: null, error: { message } });

  function query(table) {
    const q = { eq: {}, is: {}, update: null, del: false, cols: "" };
    const run = () => {
      const hid = q.eq.household_id || q.eq.id;
      if (table === "household_members") {
        if (q.eq.user_id === ME) return { data: mine().map(h => ({ household_id: h.id, role: roleIn(h.id), joined_at: "2026-01-01", households: { name: h.name } })), error: null };
        return { data: copy((fake.hh(hid) || { members: [] }).members), error: null };
      }
      if (table === "households" && q.update) {
        const h = fake.hh(hid); if (!h || roleIn(hid) !== "owner") return { data: [], error: null };
        Object.assign(h, q.update); return { data: [{ name: h.name }], error: null };
      }
      if (table === "budgets") { const h = fake.hh(hid); return { data: h ? { state: copy(h.budget), seq: h.seq, updated_by: ME, updated_at: new Date().toISOString() } : null, error: null }; }
      if (table === "budget_backups") return { data: copy((fake.hh(hid) || { backups: [] }).backups), error: null };
      if (table === "household_invites") {
        if (q.del) { households.forEach(h => { h.invites = h.invites.filter(i => i.id !== q.eq.id); }); return { data: null, error: null }; }
        return { data: copy((fake.hh(hid) || { invites: [] }).invites), error: null };
      }
      return { data: [], error: null };
    };
    const b = {
      select(cols) { q.cols = cols || ""; return b; }, eq(k, v) { q.eq[k] = v; return b; }, is(k, v) { q.is[k] = v; return b; }, order() { return b; },
      update(v) { q.update = v; return b; }, delete() { q.del = true; return b; }, maybeSingle() { return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }

  async function rpc(name, a) {
    fake.rpcCalls.push({ name, args: copy(a) });
    await new Promise(r => setTimeout(r, 30));
    const id = a && a.p_household;
    switch (name) {
      case "accept_invites": case "sync_my_profile": return { data: 0, error: null };
      case "apply_budget_ops": {
        if (fake.failNext > 0) { fake.failNext--; return err("Failed to fetch"); }
        if (!roleIn(id)) return err("Not a member of this household");
        if (roleIn(id) === "viewer") return err("You have view-only access to this budget");
        const hh = fake.hh(id); hh.budget = applyOps(hh, a.p_ops); hh.seq++;
        return { data: { state: copy(hh.budget), seq: hh.seq, updated_at: new Date().toISOString(), updated_by: ME }, error: null };
      }
      case "create_household": {
        const h = { id: "hh-" + (households.length + 1), name: a.p_name, budget: {}, seq: 0, backups: [], invites: [], members: [meMember("owner")] };
        households.push(h); return { data: h.id, error: null };
      }
      case "invite_member":
        if (!["owner", "editor"].includes(roleIn(id))) return err("Only owners and editors can invite people");
        fake.hh(id).invites.push({ id: "inv-" + Date.now(), email: a.p_email, role: a.p_role || "editor" }); return { data: null, error: null };
      case "set_member_role": {
        if (roleIn(id) !== "owner") return err("Only an owner can change roles");
        const h = fake.hh(id), m = h.members.find(x => x.user_id === a.p_user);
        if (m.role === "owner" && a.p_role !== "owner" && h.members.filter(x => x.role === "owner").length === 1) return err("A household needs at least one owner. Make someone else an owner first.");
        m.role = a.p_role; return { data: null, error: null };
      }
      case "remove_member": {
        if (roleIn(id) !== "owner") return err("Only an owner can remove people");
        const h = fake.hh(id); h.members = h.members.filter(x => x.user_id !== a.p_user); return { data: null, error: null };
      }
      case "leave_household": {
        const h = fake.hh(id), was = roleIn(id);
        h.members = h.members.filter(x => x.user_id !== ME);
        if (!h.members.length) { households.splice(households.indexOf(h), 1); return { data: "household deleted", error: null }; }
        if (was === "owner" && !h.members.some(x => x.role === "owner")) { h.members[0].role = "owner"; return { data: "ownership passed on", error: null }; }
        return { data: "left", error: null };
      }
      case "delete_my_account": fake.deleted = true; households.forEach(h => { h.members = h.members.filter(x => x.user_id !== ME); }); return { data: null, error: null };
      default: return err("Unknown function " + name);
    }
  }

  window.supabase = {
    createClient() {
      return {
        auth: {
          onAuthStateChange(cb) { authCb = cb; setTimeout(() => cb(init.signedOut ? "INITIAL_SESSION" : "INITIAL_SESSION", init.signedOut ? null : { user }), 0); return { data: { subscription: { unsubscribe() {} } } }; },
          async signOut() { fake.authCalls.push({ name: "signOut" }); setTimeout(() => authCb && authCb("SIGNED_OUT", null), 0); return { error: null }; },
          async signInWithPassword(c) { fake.authCalls.push({ name: "signIn", email: c.email }); setTimeout(() => authCb && authCb("SIGNED_IN", { user }), 0); return { error: null }; },
          async updateUser(c) {
            fake.authCalls.push({ name: "updateUser", ...copy(c) });
            if (c.data) Object.assign(user.user_metadata, c.data);
            setTimeout(() => authCb && authCb("USER_UPDATED", { user }), 0);
            return { data: { user }, error: null };
          },
        },
        from: query,
        rpc,
        channel(name) {
          const id = String(name).replace(/^budget-/, "");
          const ch = { on(_e, _f, fn) { fake.listeners.push({ id, fn }); return ch; }, subscribe(cb) { setTimeout(() => cb("SUBSCRIBED"), 0); return ch; } };
          return ch;
        },
        removeChannel() {},
      };
    },
  };
})();

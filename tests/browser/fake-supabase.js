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

  /* History, like the database's budget_changes (see supabase/migrations/..._history.sql). */
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function changesBetween(a, b, path = [], out = []) {
    if (same(a, b)) return out;
    if (isObj(a) && isObj(b)) {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        if (!has(a, k)) out.push({ p: [...path, k], n: copy(b[k]) });
        else if (!has(b, k)) out.push({ p: [...path, k], o: copy(a[k]) });
        else changesBetween(a[k], b[k], [...path, k], out);
      }
      return out;
    }
    out.push({ p: path, o: copy(a), n: copy(b) }); return out;
  }
  const getPath = (s, p) => { let c = s; for (const k of p) { if (!isObj(c) || !has(c, k)) return undefined; c = c[k]; } return c; };
  function invert(s0, changes) {
    const s = copy(s0) || {};
    for (const c of [...changes].reverse()) {
      if (has(c, "o")) { let x = s; for (let i = 0; i < c.p.length - 1; i++) { if (!isObj(x[c.p[i]])) x[c.p[i]] = {}; x = x[c.p[i]]; } x[c.p[c.p.length - 1]] = copy(c.o); }
      else { let x = s; for (let i = 0; i < c.p.length - 1 && isObj(x); i++) x = x[c.p[i]]; if (isObj(x)) delete x[c.p[c.p.length - 1]]; }
    }
    return s;
  }
  let changeId = 500;
  /** Record a save in the household's history; returns the entry id (or null). Merges quick follow-ups. */
  function record(hh, before, after, by, kind = "edit", reason = "", refId = null, refAt = null) {
    const ch = changesBetween(before || {}, after || {});
    if (!ch.length) return null;
    const now = Date.now(), last = hh.changes[hh.changes.length - 1];
    if (kind === "edit" && last && last.kind === "edit" && last.changed_by === by && !last.undone_at && now - Date.parse(last.changed_at) < 120000) {
      const merged = copy(last.changes); let ok = true;
      for (const c of ch) {
        const e = merged.find(x => x.p.length <= c.p.length && same(c.p.slice(0, x.p.length), x.p));
        if (!e) { ok = false; break; }
        if (e.p.length === c.p.length) { if (has(c, "n")) e.n = copy(c.n); else delete e.n; }
        else if (isObj(e.n)) { const rest = c.p.slice(e.p.length); e.n = has(c, "n") ? invert(e.n, [{ p: rest, o: c.n }]) : invert(e.n, [{ p: rest }]); }
        else { ok = false; break; }
      }
      if (ok) {
        last.changes = merged.filter(x => !(has(x, "o") === has(x, "n") && (!has(x, "o") || same(x.o, x.n))));
        if (!last.changes.length) { hh.changes.pop(); return null; }
        last.changed_at = new Date(now).toISOString(); return last.id;
      }
    }
    const row = { id: ++changeId, household_id: hh.id, changed_by: by, changed_at: new Date(now).toISOString(), kind, reason, ref_id: refId, ref_at: refAt, undone_at: null, changes: ch };
    hh.changes.push(row); return row.id;
  }

  const households = (init.households || [{ id: "hh-1", name: "Test household", role: "owner", budget: init.budget || {}, seq: init.seq || 0 }])
    .map(h => ({ seq: 0, backups: [], invites: [], snapshots: [], changes: [], reminders: [], remPrefs: null, ...copy(h), members: h.members ? copy(h.members) : [meMember(h.role || "owner")] }));
  const user = { id: ME, email: "jarden@example.com", user_metadata: { name: init.myName || "Jarden", ...(init.accent ? { accent: init.accent } : {}), ...(init.meta || {}) }, created_at: "2026-01-01T00:00:00Z" };
  let authCb = null;

  const fake = window.__fake = {
    households, rpcCalls: [], authCalls: [], backups: [], remUpdates: [], prefSaves: [], devices: copy(init.devices || []), fnCalls: [],
    pushKey: init.pushKey === undefined ? "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4" : init.pushKey, listeners: [], failNext: 0, checks: {}, noPersonLinks: !!init.noPersonLinks, liveCb: null, liveDown: false, live(st) { if (this.liveCb) this.liveCb(st); }, files: copy(init.files || {}), storageCalls: [], failUpload: 0, storageOn: init.storageOn !== false, noLook: !!init.noLook, deleted: false, createMode: init.createMode || null, invite: init.invite || null, failMembers: init.failMembers || 0, createDelay: init.createDelay || 0, resendWait: init.resendWait || 0,
    get budget() { return households[0].budget; },
    get seq() { return households[0].seq; },
    hh: id => households.find(h => h.id === id),
    /** Simulate someone else saving to the first (or given) household. */
    remote(ops, by = "u-other", id = households[0].id) {
      const hh = fake.hh(id), before = copy(hh.budget); hh.budget = applyOps(hh, ops); hh.seq++;
      record(hh, before, hh.budget, by);
      const row = { household_id: id, state: copy(hh.budget), seq: hh.seq, updated_by: by, updated_at: new Date().toISOString() };
      fake.listeners.filter(l => l.id === id).forEach(l => l.fn({ new: row }));
    },
  };
  const mine = () => households.filter(h => h.members.some(m => m.user_id === ME));
  const roleIn = id => { const h = fake.hh(id); const m = h && h.members.find(x => x.user_id === ME); return m ? m.role : null; };
  const err = message => ({ data: null, error: { message } });
  // Snapshots, like the database's _snapshot_data / _nz_month
  const nzMonth = () => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit" }).format(new Date()); return p.slice(0, 7) + "-01"; };
  const snapData = b => !b || !b.people || Array.isArray(b.people) ? null : { version: b.version, nw: copy(b.nw || {}), goals: copy(b.goals || {}),
    people: Object.fromEntries(Object.entries(b.people).map(([k, p]) => [k, { id: p.id, name: p.name, colour: p.colour, pos: p.pos }])) };
  let snapId = 1000;
  const offline = () => navigator.onLine === false;
  const NET = { data: null, error: { message: "TypeError: Failed to fetch" } };

  function query(table) {
    const q = { eq: {}, is: {}, lt: {}, gt: {}, in: {}, limit: Infinity, desc: false, update: null, upsert: null, del: false, cols: "" };
    const run = () => {
      if (offline()) return NET;
      const hid = q.eq.household_id || q.eq.id;
      if (table === "household_members" && fake.failMembers > 0) { fake.failMembers--; return { data: null, error: { message: "Failed to fetch" } }; }
      if (table === "household_members") {
        if (q.eq.user_id === ME) {
          // Phase 8: a household's look comes along with its name, once the database has the column
          if (/appearance/.test(q.cols) && fake.noLook) return { data: null, error: { code: "42703", message: "column households_1.appearance does not exist" } };
          return { data: mine().map(h => ({ household_id: h.id, role: roleIn(h.id), joined_at: "2026-01-01", households: /appearance/.test(q.cols) ? { name: h.name, appearance: copy(h.appearance || {}) } : { name: h.name } })), error: null };
        }
        // Phase 10: who's who (person_id), once the database has the column
        if (/person_id/.test(q.cols) && fake.noPersonLinks) return { data: null, error: { code: "42703", message: "column household_members.person_id does not exist" } };
        return { data: copy((fake.hh(hid) || { members: [] }).members).map(m => /person_id/.test(q.cols) ? { person_id: null, ...m } : (({ person_id, ...r }) => r)(m)), error: null };
      }
      if (table === "households" && q.update) {
        const h = fake.hh(hid); if (!h || roleIn(hid) !== "owner") return { data: [], error: null };
        Object.assign(h, q.update); return { data: [{ name: h.name }], error: null };
      }
      if (table === "budgets") { const h = fake.hh(hid); return { data: h ? { state: copy(h.budget), seq: h.seq, updated_by: ME, updated_at: new Date().toISOString() } : null, error: null }; }
      if (table === "budget_snapshots") return { data: copy((fake.hh(hid) || { snapshots: [] }).snapshots), error: null };
      if (table === "push_subscriptions") {
        if (q.del) { fake.devices = fake.devices.filter(d => d.id !== q.eq.id); return { data: null, error: null }; }
        return { data: copy(fake.devices), error: null };
      }
      if (table === "reminders") {
        const all = households.flatMap(h => h.reminders);
        if (q.update) { const ids = q.in.id || [q.eq.id]; all.filter(r => ids.includes(r.id)).forEach(r => Object.assign(r, q.update)); fake.remUpdates.push({ ids: copy(ids), ...copy(q.update) }); return { data: null, error: null }; }
        let rows = copy((fake.hh(hid) || { reminders: [] }).reminders).sort((a, b) => b.created_at.localeCompare(a.created_at));
        return { data: rows.slice(0, q.limit), error: null };
      }
      if (table === "reminder_prefs") {
        if (q.upsert) { const h = fake.hh(q.upsert.household_id); h.remPrefs = copy(q.upsert); fake.prefSaves.push(copy(q.upsert)); return { data: null, error: null }; }
        return { data: copy((fake.hh(hid) || {}).remPrefs || null), error: null };
      }
      if (table === "budget_changes") {
        let rows = copy((fake.hh(hid) || { changes: [] }).changes).filter(r => (q.lt.id === undefined || r.id < q.lt.id) && (q.gt.id === undefined || r.id > Number(q.gt.id)));
        if (q.desc) rows.reverse();
        return { data: rows.slice(0, q.limit), error: null };
      }
      if (table === "budget_backups") return { data: copy((fake.hh(hid) || { backups: [] }).backups), error: null };
      if (table === "household_invites") {
        if (q.del) { households.forEach(h => { h.invites = h.invites.filter(i => i.id !== q.eq.id); }); return { data: null, error: null }; }
        return { data: copy((fake.hh(hid) || { invites: [] }).invites), error: null };
      }
      return { data: [], error: null };
    };
    const b = {
      select(cols) { q.cols = cols || ""; return b; }, eq(k, v) { q.eq[k] = v; return b; }, is(k, v) { q.is[k] = v; return b; },
      order(_c, o) { q.desc = !!(o && o.ascending === false); return b; }, lt(k, v) { q.lt[k] = Number(v); return b; }, gt(k, v) { q.gt[k] = Number(v); return b; }, limit(n) { q.limit = n; return b; },
      in(k, v) { q.in[k] = v; return b; }, upsert(v) { q.upsert = v; return b; },
      update(v) { q.update = v; return b; }, delete() { q.del = true; return b; }, maybeSingle() { return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }

  const folder = path => String(path).split("/")[0];
  const mayRead = (bucket, path) => bucket === "household-photos" ? !!roleIn(folder(path)) : path.startsWith(ME + "/");
  const mayWrite = (bucket, path) => bucket === "household-photos" ? ["owner", "editor"].includes(roleIn(folder(path))) : path.startsWith(ME + "/");
  async function rpc(name, a) {
    await new Promise(r => setTimeout(r, 30));
    if (offline()) return NET;
    fake.rpcCalls.push({ name, args: copy(a) });
    const id = a && a.p_household;
    switch (name) {
      case "sync_my_profile": return { data: 0, error: null };
      // Phase 10: the same rules as the database functions (supabase/migrations/..._payday_playbook.sql)
      case "link_budget_person": {
        if (fake.failNext > 0) { fake.failNext--; return err("Failed to fetch"); }
        const hh = fake.hh(id); if (!roleIn(id)) return err("Not a member of this household");
        const mem = hh.members.find(m => m.user_id === ME);
        if (a.p_person === null) { mem.person_id = null; return { data: null, error: null }; }
        if (!hh.budget.people || !hh.budget.people[a.p_person]) return err("That person isn't in this budget");
        if (hh.members.some(m => m.person_id === a.p_person && m.user_id !== ME)) return err("Someone else in this household has already said that's them");
        mem.person_id = a.p_person; return { data: a.p_person, error: null };
      }
      case "payday_check_get": case "payday_check_mark": case "payday_check_replan": {
        if (fake.failNext > 0) { fake.failNext--; return err("Failed to fetch"); }
        const hh = fake.hh(id); if (!roleIn(id)) return err("Not a member of this household");
        if (!hh.members.some(m => m.user_id === ME && m.person_id === a.p_person)) return err("This checklist is for someone else");
        const k = `${id}|${ME}|${a.p_person}|${a.p_payday}`, row = fake.checks[k];
        const out = r => r ? { payday: a.p_payday, plan: copy(r.plan), done: copy(r.done), updated_at: new Date().toISOString() } : null;
        if (name === "payday_check_get") return { data: out(row), error: null };
        if (name === "payday_check_mark") {
          const r = row || (fake.checks[k] = { plan: copy(a.p_plan || {}), done: {} });
          if (a.p_on) r.done[a.p_key] = true; else delete r.done[a.p_key];
          return { data: out(r), error: null };
        }
        if (!row) return { data: null, error: null };
        const keys = (a.p_plan.groups || []).map(g => g.key);
        row.plan = copy(a.p_plan); row.done = Object.fromEntries(Object.entries(row.done).filter(([kk]) => keys.includes(kk)));
        return { data: out(row), error: null };
      }
      case "set_household_appearance": { // like the database function: owners and editors, known keys only
        if (fake.noLook) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.set_household_appearance(p_appearance, p_household) in the schema cache" } };
        const h = fake.hh(a.p_household), r = roleIn(a.p_household);
        if (!h || !r) return { data: null, error: { message: "Not a member of this household" } };
        if (r === "viewer") return { data: null, error: { message: "Only owners and editors can change how the household looks" } };
        const v = a.p_appearance || {}, clean = {};
        if (/^[a-z]{2,12}$/.test(v.colour || "")) clean.colour = v.colour;
        if (/^[a-z]{2,16}$/.test(v.icon || "")) clean.icon = v.icon;
        if (new RegExp(`^${h.id}/\\d{10,16}\\.jpg$`).test(v.photo || "")) clean.photo = v.photo;
        h.appearance = clean; fake.lookSaves = (fake.lookSaves || 0) + 1;
        return { data: copy(clean), error: null };
      }
      case "accept_invites": { // an invitation waiting for this email (init.invite) becomes a membership, with the role it was given
        if (!fake.invite) return { data: 0, error: null };
        const v = fake.invite; fake.invite = null;
        households.push({ id: v.id, name: v.name, budget: v.budget || {}, seq: 0, backups: [], invites: [], snapshots: [], changes: [], reminders: [], remPrefs: null, members: [meMember(v.role || "editor")] });
        return { data: 1, error: null };
      }
      case "save_push_subscription": {
        fake.devices = fake.devices.filter(d => d.endpoint !== a.p_endpoint);
        const row = { id: 900 + fake.devices.length + fake.rpcCalls.length, endpoint: a.p_endpoint, label: a.p_label, created_at: new Date().toISOString() };
        fake.devices.push(row); return { data: row.id, error: null };
      }
      case "forget_push_subscription": fake.devices = fake.devices.filter(d => d.endpoint !== a.p_endpoint); return { data: null, error: null };
      case "ensure_monthly_snapshot": {
        const hh = fake.hh(id); if (!roleIn(id)) return err("Not a member of this household");
        const d = snapData(hh.budget), m = nzMonth();
        if (init.noAutoSnapshot || !d || hh.snapshots.some(x => x.kind === "monthly" && x.month === m)) return { data: false, error: null };
        hh.snapshots.push({ id: ++snapId, month: m, kind: "monthly", taken_at: new Date().toISOString(), taken_by: null, data: d });
        return { data: true, error: null };
      }
      case "save_snapshot_now": {
        if (fake.failNext > 0) { fake.failNext--; return err("Failed to fetch"); }
        if (!["owner", "editor"].includes(roleIn(id))) return err("Only owners and editors can save a snapshot");
        const hh = fake.hh(id), d = snapData(hh.budget);
        if (!d) return err("There’s nothing to save yet: set up the budget first");
        const row = { id: ++snapId, month: nzMonth(), kind: "manual", taken_at: new Date().toISOString(), taken_by: ME, data: d };
        hh.snapshots.push(row);
        const manual = hh.snapshots.filter(x => x.kind === "manual");
        if (manual.length > 24) hh.snapshots = hh.snapshots.filter(x => x.kind !== "manual" || manual.slice(-24).includes(x));
        return { data: copy(row), error: null };
      }
      case "apply_budget_ops": {
        if (fake.failNext > 0) { fake.failNext--; return err("Failed to fetch"); }
        if (!roleIn(id)) return err("Not a member of this household");
        if (roleIn(id) === "viewer") return err("You have view-only access to this budget");
        const hh = fake.hh(id), before = copy(hh.budget); hh.budget = applyOps(hh, a.p_ops); hh.seq++;
        const rep = a.p_ops.find(o => o.op === "replace");
        const change_id = record(hh, before, hh.budget, ME, rep ? "replace" : "edit", rep ? rep.reason || "Replaced" : "");
        return { data: { state: copy(hh.budget), seq: hh.seq, updated_at: new Date().toISOString(), updated_by: ME, change_id }, error: null };
      }
      case "undo_budget_change": {
        if (!["owner", "editor"].includes(roleIn(id))) return err("Only owners and editors can undo changes");
        const hh = fake.hh(id), r = hh.changes.find(x => x.id === Number(a.p_change_id));
        if (!r) return err("That change is no longer in the history");
        if (r.undone_at) return err("That change has already been undone");
        const before = copy(hh.budget); let s = copy(hh.budget); const skipped = [];
        for (const c of [...r.changes].reverse()) {
          const cur = getPath(s, c.p);
          if (has(c, "n") ? same(cur, c.n) : cur === undefined) s = invert(s, [c]);
          else skipped.push({ p: c.p, by: ([...hh.changes].reverse().find(l => l.id > r.id && l.changes.some(lc => same(lc.p.slice(0, c.p.length), c.p.slice(0, lc.p.length)))) || {}).changed_by || null });
        }
        if (same(before, s)) return { data: { state: before, seq: hh.seq, updated_at: new Date().toISOString(), updated_by: ME, change_id: null, skipped }, error: null };
        hh.budget = s; hh.seq++;
        const change_id = record(hh, before, s, ME, "undo", "", r.id, r.changed_at);
        r.undone_at = new Date().toISOString();
        return { data: { state: copy(s), seq: hh.seq, updated_at: new Date().toISOString(), updated_by: ME, change_id, skipped }, error: null };
      }
      case "restore_budget_version": {
        if (!["owner", "editor"].includes(roleIn(id))) return err("Only owners and editors can restore an earlier version");
        const hh = fake.hh(id), r = hh.changes.find(x => x.id === Number(a.p_change_id));
        if (!r) return err("That version is no longer in the history");
        const before = copy(hh.budget);
        const target = [...hh.changes].filter(x => x.id > r.id).reverse().reduce((s, x) => invert(s, x.changes), copy(hh.budget));
        if (same(before, target)) return { data: { state: before, seq: hh.seq, updated_at: new Date().toISOString(), updated_by: ME, change_id: null }, error: null };
        hh.budget = target; hh.seq++;
        const change_id = record(hh, before, target, ME, "restore", "", r.id, r.changed_at);
        return { data: { state: copy(target), seq: hh.seq, updated_at: new Date().toISOString(), updated_by: ME, change_id }, error: null };
      }
      case "create_household": {
        // Phase 7A test modes: "fail" (no connection, nothing made), "lost" (made, but the reply never arrives),
        // "expired" (the sign-in has expired); createDelay: a slow connection.
        if (fake.createDelay) await new Promise(r => setTimeout(r, fake.createDelay));
        if (fake.createMode === "fail") return err("Failed to fetch");
        if (fake.createMode === "expired") return { data: null, error: { message: "JWT expired", status: 401 } };
        const h = { id: "hh-" + (households.length + 1), name: a.p_name, budget: {}, seq: 0, backups: [], invites: [], snapshots: [], changes: [], reminders: [], remPrefs: null, members: [meMember("owner")] };
        households.push(h);
        if (fake.createMode === "lost") return err("Failed to fetch");
        return { data: h.id, error: null };
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

  // The project's public auth settings (which sign-in providers are switched on): none unless a test says so
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => /\/auth\/v1\/settings$/.test(String(url))
    ? Promise.resolve(new Response(JSON.stringify({ external: { email: true, ...(init.providers || {}) } }), { status: 200, headers: { "Content-Type": "application/json" } }))
    : realFetch(url, opts);
  window.supabase = {
    createClient() {
      return {
        auth: {
          // Like the real client: with no connection and an expired sign-in, there's no session to give.
          onAuthStateChange(cb) { authCb = cb; setTimeout(() => cb("INITIAL_SESSION", init.signedOut || offline() ? null : { user }), 0); return { data: { subscription: { unsubscribe() {} } } }; },
          async signOut() { fake.authCalls.push({ name: "signOut" }); setTimeout(() => authCb && authCb("SIGNED_OUT", null), 0); return { error: null }; },
          // Phase 7A: sign-up with an email code, sign-in codes, resending, Google/Apple
          async signUp(c) { fake.authCalls.push({ name: "signUp", email: c.email, data: copy(c.options && c.options.data), redirect: c.options && c.options.emailRedirectTo }); return { data: { user: { id: "new" }, session: null }, error: null }; },
          async verifyOtp(c) {
            fake.authCalls.push({ name: "verifyOtp", email: c.email, type: c.type });
            await new Promise(r => setTimeout(r, 30));
            if (c.token !== (init.code || "123456")) return { data: {}, error: { message: "Token has expired or is invalid", status: 403 } };
            setTimeout(() => authCb && authCb("SIGNED_IN", { user }), 0);
            return { data: { session: { user }, user }, error: null };
          },
          async resend(c) {
            fake.authCalls.push({ name: "resend", type: c.type, email: c.email });
            if (fake.resendWait) return { data: {}, error: { message: `For security purposes, you can only request this after ${fake.resendWait} seconds.`, status: 429 } };
            return { data: {}, error: null };
          },
          async signInWithOtp(c) {
            fake.authCalls.push({ name: "signInWithOtp", email: c.email, shouldCreateUser: c.options && c.options.shouldCreateUser });
            if (c.email !== user.email) return { data: {}, error: { message: "Signups not allowed for otp", status: 422 } };
            return { data: {}, error: null };
          },
          async signInWithOAuth(c) { fake.authCalls.push({ name: "oauth", provider: c.provider, redirectTo: c.options && c.options.redirectTo }); return { data: { url: "about:blank" }, error: null }; },
          async signInWithPassword(c) { fake.authCalls.push({ name: "signIn", email: c.email }); setTimeout(() => authCb && authCb("SIGNED_IN", { user }), 0); return { error: null }; },
          async updateUser(c) {
            fake.authCalls.push({ name: "updateUser", ...copy(c) });
            if (c.data) Object.assign(user.user_metadata, c.data);
            setTimeout(() => authCb && authCb("USER_UPDATED", { user }), 0);
            return { data: { user }, error: null };
          },
        },
        from: query,
        // Storage, like the real buckets' rules: profile pictures only in your own folder; household photos
        // (Phase 8) seen by the household, changed by its owners and editors
        storage: { from(bucket) { return {
          async upload(path, blob, opts) {
            fake.storageCalls.push({ op: "upload", bucket, path, type: opts && opts.contentType, size: blob.size });
            if (fake.failUpload) { fake.failUpload--; return { data: null, error: { message: "Upload failed" } }; }
            if (!fake.storageOn) return { data: null, error: { message: "Bucket not found" } };
            if (!mayWrite(bucket, path)) return { data: null, error: { message: "new row violates row-level security policy" } };
            fake.files[path] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
            return { data: { path }, error: null };
          },
          async remove(paths) { fake.storageCalls.push({ op: "remove", bucket, paths }); paths.forEach(p => { if (mayWrite(bucket, p)) delete fake.files[p]; }); return { data: [], error: null }; },
          async createSignedUrl(path) { fake.storageCalls.push({ op: "sign", bucket, path }); const u = mayRead(bucket, path) && fake.files[path]; return u ? { data: { signedUrl: u }, error: null } : { data: null, error: { message: "Object not found" } }; },
        }; } },
        rpc,
        // Edge Functions: the reminders function's "public key" and "send a test" jobs
        functions: { async invoke(name, opts) {
          await new Promise(r => setTimeout(r, 30));
          const body = (opts && opts.body) || {};
          fake.fnCalls.push({ name, body: copy(body) });
          const fail = msg => ({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: msg }) } } });
          if (offline()) return { data: null, error: { message: "Failed to fetch" } };
          if (!fake.pushKey) return fail("Phone notifications aren’t set up yet");
          if (body.publicKey) return { data: { publicKey: fake.pushKey }, error: null };
          if (body.test) return { data: { sent: fake.devices.length, failed: 0, gone: 0 }, error: null };
          return fail("Missing pass");
        } },
        channel(name) {
          const id = String(name).replace(/^budget-/, "");
          const ch = { on(_e, _f, fn) { fake.listeners.push({ id, fn }); return ch; }, subscribe(cb) { fake.liveCb = cb; fake.subscribes = (fake.subscribes || 0) + 1; setTimeout(() => cb(fake.liveDown ? "CHANNEL_ERROR" : "SUBSCRIBED"), 0); return ch; } };
          return ch;
        },
        removeChannel() {},
      };
    },
  };
})();

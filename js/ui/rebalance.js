/* Phase 9C: the "Rebalance budget" sheet. Pick an allocation, give it a new amount, choose where the
   difference comes from (or goes to), check the before → after, then Apply.

   - Everything shown is a proposal (model/rebalance.js). Nothing is saved, and the budget on screen
     doesn't change, until "Apply changes". Closing with changes asks before throwing them away.
   - Applying sends only the changed shares, in one database call (all or nothing), so it's one entry
     in History and one tap of Undo. Just before saving, the budget in the database is checked against
     what the preview was worked out from; if anyone changed pay or allocations meanwhile, nothing is
     saved and the preview is shown again with the new numbers.
   - Only owners and editors see it (the database refuses anyone else anyway). */
import { app, readOnly } from "./ctx.js";
import { $, esc, toast, confirmDel } from "./dom.js";
import { money } from "../model/format.js";
import { WORDS, perYear } from "../model/periods.js";
import { isShared } from "../model/schema.js";
import { propose, fingerprint, whoOptions, canRebalance, canFund, shortfallFix } from "../model/rebalance.js";
import { accIcon } from "./views/budget.js";

let R = null; // { hh, basis, target, amount, who, useFree, from: Set, manual: {}, dirty, busy, msg }

const per = () => perYear(app.state.viewAs || "fortnight");
const sh = () => WORDS[app.state.viewAs || "fortnight"].short;
const $v = annual => money(annual / per());
const signed = annual => { const c = Math.round(annual / per() * 100); return c === 0 ? money(0) : `${c > 0 ? "+" : "−"}${money(Math.abs(c) / 100)}`; };
const cents = c => money(c / 100);
const isOpen = () => !!(R && $("#sheet").open && $("#sheet .rb"));
const nameOf = pid => ((app.state.people.find(p => p.id === pid) || {}).name || "Someone");
const ownerTag = a => isShared(app.state) && a.type === "Personal" && a.owner ? nameOf(a.owner) : "";

/** Open the sheet. opts: { target, amount (per shown period), from: [ids] }. */
export function openRebalance(opts = {}) {
  if (readOnly() || !app.household) return;
  const S = app.state, C = app.C, ok = canRebalance(S, C);
  if (!ok.ok) { toast(ok.reason); return; }
  const target = S.accounts.some(a => a.id === opts.target) ? opts.target : S.accounts[0].id;
  const row = C.rows.find(r => r.id === target);
  R = { hh: app.household.id, basis: fingerprint(S), target, who: "asNow", useFree: true, from: new Set(opts.from || []), manual: {}, dirty: false, busy: false, msg: null,
    amount: opts.amount != null ? String(opts.amount) : (Math.round(row.t / per() * 100) / 100).toFixed(2), preset: opts.amount != null };
  draw(true);
}

function proposal() {
  return propose(app.state, app.C, { target: R.target, amount: R.amount === "" ? "" : Number(String(R.amount).replace(/[$,\s]/g, "")), who: R.who, useFree: R.useFree, from: [...R.from], manual: R.manual });
}

function draw(first) {
  const d = $("#sheet"), S = app.state, C = app.C, P = proposal();
  // keep the cursor where it was while redrawing
  const ae = document.activeElement, keep = ae && ae.closest && ae.closest("#sheet .rb") && ae.dataset.rbk ? { k: ae.dataset.rbk, s: ae.selectionStart } : null, y = d.scrollTop;
  const row = C.rows.find(r => r.id === R.target), whoOpts = whoOptions(S, C, R.target);
  const up = P.kind === "up", down = P.kind === "down";
  const affected = P.people.filter(p => p.change !== 0), manualOk = affected.length === 1;
  const pid = manualOk ? affected[0].id : null;
  const freeNow = up ? P.people.reduce((s, p) => s + p.fromFree, 0) : 0;
  const freeAvail = C.people.reduce((s, p) => s + Math.max(0, p.annual - C.tot.amt[p.id]), 0);

  // the allocations that could take part: not the target; for an increase, only ones someone affected pays into
  const cands = C.rows.filter(r => r.id !== R.target && (down ? affected.some(p => canFund(r, p.id)) : affected.some(p => r.by[p.id] > 0)));
  const after = id => P.C2 ? P.C2.rows.find(x => x.id === id) : null;
  const src = cands.map(r => {
    const on = R.from.has(r.id), a2 = after(r.id), dlt = a2 ? a2.t - r.t : 0, tag = ownerTag(r);
    return `<li class="rb-src${on ? " on" : ""}"><label class="rb-pick"><input type="checkbox" data-rb-from="${esc(r.id)}"${on ? " checked" : ""}>
        <span class="a-ic sm" aria-hidden="true">${accIcon(r)}</span><span class="rb-n"><b>${esc(r.name || "Unnamed")}</b><small>${tag ? `${esc(tag)} · ` : ""}${$v(r.t)}${esc(sh())} now</small></span>
        <span class="rb-d${dlt < 0 ? " neg" : dlt > 0 ? " pos" : ""}">${on && Math.abs(dlt) > 0.004 ? signed(dlt) : on ? money(0) : `<span class="rb-keep">Unchanged</span>`}</span></label>
      ${on && manualOk ? `<label class="rb-exact"><span>Exact amount</span><span class="unit money"><i>$</i><input type="text" inputmode="decimal" data-rbk="m-${esc(r.id)}" data-rb-manual="${esc(r.id)}" value="${R.manual[r.id] != null ? esc(R.manual[r.id]) : ""}" placeholder="Auto" aria-label="Exact amount from ${esc(r.name || "this")}"></span></label>` : ""}</li>`;
  }).join("");

  const unf = P.errors.find(e => e.k === "unfunded");
  const leftLine = up ? (unf ? `<p class="rb-left bad" role="status"><b>${cents(unf.cents)}${esc(sh())}</b> still to find</p>` : P.ok ? `<p class="rb-left ok" role="status">✓ Balanced</p>` : "")
    : down ? (() => { const kept = P.people.reduce((s, p) => s + p.toFree, 0); return `<p class="rb-left" role="status">${kept > 0 ? `<b>${cents(kept)}${esc(sh())}</b> will have no plan yet` : "✓ All of it has a new job"}</p>`; })() : "";

  const changes = P.ok || unf ? P.changes : [];
  const review = changes.length ? `<section class="rb-sec rb-review" aria-labelledby="rbRevT"><h4 id="rbRevT">Review</h4>
      <ul class="rb-rows">${changes.map(c => `<li><span class="a-ic sm" aria-hidden="true">${accIcon(c)}</span><span class="rb-n"><b>${esc(c.name)}</b>${ownerTag(c) ? `<small>${esc(ownerTag(c))}</small>` : ""}${isShared(S) && C.multi ? personLine(c) : ""}</span>
        <span class="rb-ba"><span>${$v(c.before)} → <b>${$v(c.after)}</b></span><small class="${c.delta < 0 ? "neg" : "pos"}">${signed(c.delta)}${esc(sh())}</small></span></li>`).join("")}</ul>
      ${outcome(P)}</section>` : "";

  const msg = R.msg ? `<p class="rb-msg ${R.msg.c || ""}" role="alert">${esc(R.msg.t)}</p>` : "";
  const firstErr = P.errors.find(e => !["unfunded", "noChange"].includes(e.k));
  d.innerHTML = `<div class="sheet-head"><h3 tabindex="-1" autofocus>Rebalance budget</h3><button class="btn icon" type="button" data-rb="close" aria-label="Close">✕</button></div>
    <div class="sheet-body rb">
      <section class="rb-sec">
        <label class="bs-field"><span>Change</span><select class="bs-in" data-rb-target>${S.accounts.map(a => `<option value="${esc(a.id)}"${a.id === R.target ? " selected" : ""}>${esc(a.name || "Unnamed")}${ownerTag(a) ? ` (${esc(ownerTag(a))})` : ""}</option>`).join("")}</select></label>
        <div class="rb-amt"><label class="bs-field"><span>New amount ${esc(WORDS[S.viewAs].per)}</span><span class="unit money big"><i>$</i><input type="text" inputmode="decimal" autocomplete="off" data-rbk="amt" data-rb-amount value="${esc(R.amount)}" aria-describedby="rbNow"></span></label>
          <p class="rb-now" id="rbNow">Now ${$v(row.t)}${esc(sh())}${P.target && Math.abs(P.target.delta) > 0.004 ? ` · <b class="${P.target.delta < 0 ? "neg" : "pos"}">${signed(P.target.delta)}</b>` : ""}</p></div>
        ${up && whoOpts.length ? `<fieldset class="bs-field rb-who"><legend>Who pays the extra</legend><div class="seg seg-radio">${whoOpts.map(o => `<label><input type="radio" name="rbWho" value="${esc(o.k)}" data-rb-who${(R.who === o.k || (R.who === "asNow" && !whoOpts.some(x => x.k === "asNow") && o.k === "byPay")) ? " checked" : ""}><span>${esc(o.label)}</span></label>`).join("")}</div></fieldset>` : ""}
        ${firstErr ? `<p class="rb-msg bad">${esc(firstErr.t)}</p>` : ""}
      </section>
      ${up || down ? `<section class="rb-sec" aria-labelledby="rbSrcT"><div class="rb-h"><h4 id="rbSrcT">${up ? "Take it from" : "Give it to"}</h4>${leftLine}</div>
        ${up && freeAvail > 0.004 ? `<label class="rb-pick rb-free"><input type="checkbox" data-rb-free${R.useFree ? " checked" : ""}><span class="rb-n"><b>Pay with no plan yet</b><small>${$v(freeAvail)}${esc(sh())} available</small></span><span class="rb-d${freeNow ? " neg" : ""}">${R.useFree && freeNow ? `−${cents(freeNow)}` : ""}</span></label>` : ""}
        ${cands.length ? `<ul class="rb-list">${src}</ul>` : `<p class="dim">${up ? "There’s nothing else in this plan to take it from." : ""}</p>`}
        ${cands.length ? `<p class="rb-hint">${up ? "Ticked allocations give in proportion to their size, unless you set an amount. The rest stay unchanged." : "Unticked, the money is left with no plan yet."}</p>` : ""}
      </section>` : ""}
      ${review}
      ${msg}
      <div class="rb-foot"><button class="btn primary" type="button" data-rb="apply"${P.ok && !R.busy ? "" : " disabled"}>${R.busy ? "Applying…" : "Apply changes"}</button>
        <button class="btn ghost" type="button" data-rb="close">Cancel</button></div>
    </div>`;
  if (!d.open) d.showModal();
  if (first) { const h = d.querySelector("h3"); if (h) h.focus({ preventScroll: true }); }
  d.scrollTop = y;
  if (keep) { const el = d.querySelector(`[data-rbk="${CSS.escape(keep.k)}"]`); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.s); } catch (_) {} } }
}

function personLine(c) {
  const parts = Object.entries(c.by).filter(([, x]) => Math.abs(x.after - x.before) > 0.004);
  return parts.length ? `<small class="rb-who-l">${parts.map(([pid, x]) => `${esc(nameOf(pid))} ${signed(x.after - x.before)}`).join(" · ")}</small>` : "";
}

/** What it means: the plan's total, expenses, and any saving or investing that goes down. */
function outcome(P) {
  const L = [], st = P.after.plan, b = P.before.plan;
  const plan = s => s.k === "ok" ? "100% allocated" : s.k === "over" ? `Over-allocated by ${$v(s.over)}${sh()}` : s.k === "left" ? `${$v(s.left)}${sh()} with no plan yet` : "";
  if (plan(b) !== plan(st)) L.push(["Plan", `${plan(b)} → ${plan(st)}`, st.k === "over" ? "bad" : ""]);
  else L.push(["Plan", plan(st), st.k === "over" ? "bad" : ""]);
  const cv = s => s.state === "short" ? `${$v(s.short)}${sh()} short` : s.state === "covered" || s.state === "even" ? "Entered expenses covered" : s.state === "nobudget" ? "No budget" : "";
  const cb = cv(P.before.cover), ca = cv(P.after.cover);
  if (ca && cb !== ca) L.push(["Expenses", `${cb} → ${ca}`, P.after.cover.state === "short" ? "bad" : "ok"]);
  const less = P.changes.filter(c => c.saving && c.delta < -0.004);
  less.forEach(c => L.push([c.name, `${$v(-c.delta)}${sh()} less going here`, "warn"]));
  return `<ul class="rb-out">${L.map(([k, v, c]) => `<li class="${c}"><span>${esc(k)}</span><b>${esc(v)}</b></li>`).join("")}</ul>`;
}

/* ---------- applying ---------- */
async function apply() {
  if (!R || R.busy || readOnly()) return;
  if (!app.household || app.household.id !== R.hh) { R.msg = { t: "This was for a different household, so nothing was changed.", c: "bad" }; draw(); return; }
  if (fingerprint(app.state) !== R.basis) { // someone's change arrived while you were here
    R.basis = fingerprint(app.state); R.msg = { t: "Your budget was just changed, so the numbers above are updated. Check them and apply again.", c: "warn" }; draw(); return;
  }
  const P = proposal(); if (!P.ok) return;
  if (app.offline || navigator.onLine === false) { R.msg = { t: "You’re offline. Connect to apply these changes.", c: "bad" }; draw(); return; }
  R.busy = true; R.msg = null; draw();
  const basis = R.basis;
  try {
    const res = await app.store.commit(P.ops, fresh => fingerprint(fresh) === basis);
    if (!isOpen()) return;
    if (res.stale) {
      R.busy = false; R.basis = fingerprint(app.state);
      R.msg = { t: "Your budget was changed by someone else, so the numbers above are updated. Check them and apply again.", c: "warn" }; draw(); return;
    }
    R = null; $("#sheet").close(); app.render();
    toast("Budget rebalanced. You can undo this.");
  } catch (e) {
    if (!R) return;
    R.busy = false; R.msg = { t: "Couldn’t apply the changes, so nothing was changed. Check your connection and try again.", c: "bad" }; draw();
  }
}

async function closeAsk() {
  if (!R) return;
  if (R.busy) return;
  if (R.dirty && !(await confirmDel("Discard this rebalance?", "Nothing has been changed yet.", "Discard"))) return;
  R = null; const d = $("#sheet"); if (d.open) d.close();
}

export function initRebalance() {
  const d = $("#sheet");
  d.addEventListener("click", e => {
    if (!isOpen()) return;
    const b = e.target.closest("[data-rb]"); if (!b || b.disabled) return;
    if (b.dataset.rb === "close") { e.preventDefault(); closeAsk(); }
    else if (b.dataset.rb === "apply") apply();
  });
  d.addEventListener("cancel", e => { if (isOpen()) { e.preventDefault(); closeAsk(); } }); // Escape
  d.addEventListener("close", () => { if (R && !$("#sheet .rb")) R = null; });
  const edit = (fn, now = true) => { fn(); R.dirty = true; R.msg = R.msg && R.msg.c === "warn" ? R.msg : null; if (now) draw(); };
  d.addEventListener("input", e => {
    if (!isOpen()) return;
    const t = e.target;
    if (t.matches("[data-rb-amount]")) edit(() => { R.amount = t.value; });
    else if (t.matches("[data-rb-manual]")) edit(() => { const v = t.value.replace(/[$,\s]/g, ""); if (v === "") delete R.manual[t.dataset.rbManual]; else R.manual[t.dataset.rbManual] = v; });
  });
  d.addEventListener("change", e => {
    if (!isOpen()) return;
    const t = e.target;
    if (t.matches("[data-rb-target]")) edit(() => {
      R.target = t.value; R.from.delete(t.value); R.manual = {}; R.who = "asNow";
      const row = app.C.rows.find(r => r.id === t.value); R.amount = (Math.round(row.t / per() * 100) / 100).toFixed(2);
    });
    else if (t.matches("[data-rb-from]")) edit(() => { const k = t.dataset.rbFrom; if (t.checked) R.from.add(k); else { R.from.delete(k); delete R.manual[k]; } });
    else if (t.matches("[data-rb-free]")) edit(() => { R.useFree = t.checked; });
    else if (t.matches("[data-rb-who]")) edit(() => { R.who = t.value; });
  });
  // the page underneath redrew (someone else's change, say): keep the open sheet in step
  const prev = app.beforeRefresh;
  app.beforeRefresh = () => { if (prev) prev(); if (isOpen() && !R.busy) draw(); };
  // entry points: the Budget allocations header, and the expense check's "Adjust budget"
  document.addEventListener("click", e => {
    const o = e.target.closest && e.target.closest("[data-rb-open]"); if (!o || o.disabled) return;
    if (o.dataset.rbOpen === "fix") { const f = shortfallFix(app.state, app.C); if (f) return openRebalance({ target: f.target, amount: f.amount }); }
    openRebalance();
  });
}

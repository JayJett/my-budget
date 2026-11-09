/* Phase 8: who the budget is for ("Just me" or "With others"), and the optional tidy-up for older solo
   budgets that have two goal pots.

   - The mode is part of the household's budget (state.mode), so everyone in the household sees the same
     thing. Changing it changes words and layout only: no money moves (see model/schema.js isShared).
   - Combining goal pots is only ever offered, never done for you. The review shows each goal's money
     before and after; nothing changes until you press "Combine them", and Undo takes it back. */
import { app, changed, readOnly } from "./ctx.js";
import { $, esc, toast } from "./dom.js";
import { isShared } from "../model/schema.js";
import { goalPotsToCombine, combinePreview } from "../model/household.js";
import { money, pct } from "../model/format.js";
import { WORDS, perYear } from "../model/periods.js";
import { ICONS } from "./onboarding.js";

const hhKey = k => `mb-${k}-${app.household ? app.household.id : "local"}`;
const getFlag = k => { try { return localStorage.getItem(hhKey(k)) === "1"; } catch (_) { return false; } };
const setFlag = k => { try { localStorage.setItem(hhKey(k), "1"); } catch (_) {} };

/* ---------- Household settings: "Who's this budget for?" ---------- */
export function modeSection() {
  const S = app.state, many = S.people.length > 1, shared = isShared(S), ro = readOnly();
  const opt = (v, title, blurb, on, disabled) => `<button class="hm-opt" type="button" data-hh-mode="${v}" aria-pressed="${on}"${disabled || ro ? " disabled" : ""}><span class="ob-opt-ic" aria-hidden="true">${ICONS[v === "solo" ? "solo" : "with"]}</span><span class="hm-t"><b>${title}</b><small>${blurb}</small></span></button>`;
  return `<section class="set" id="hhModeSec"><h4>Who’s this budget for?</h4>
    <div class="hm-opts" role="group" aria-label="Who’s this budget for">
      ${opt("solo", "Just me", "Your own money", !shared, many)}
      ${opt("shared", "With others", "Shared and personal money", shared, false)}</div>
    <p class="set-note">${many ? `There are ${S.people.length} people in this budget, so it’s shared.` : "This only changes how things are labelled. No money moves."}</p></section>`;
}
function setMode(v) {
  const S = app.state; if (readOnly() || !["solo", "shared"].includes(v)) return;
  if (v === "solo" && S.people.length > 1) return;
  if (S.mode === v) return;
  S.mode = v; changed({ full: true });
  const sec = $("#hhModeSec"); if (sec) sec.outerHTML = modeSection();
  toast(v === "solo" ? "Set to just you" : "Set to shared");
}

/* ---------- Budget tab: after a second person joins a budget that started as "just me" ---------- */
export function transitionNote() {
  const S = app.state;
  if (readOnly() || S.mode !== "solo" || S.people.length < 2 || getFlag("solo-shared-seen")) return "";
  return `<div class="card hm-note" role="note"><p><b>This budget started as just you.</b> Everything you set up is still yours. To share bills or goals, open an allocation and choose <b>Joint</b>.</p>
    <button class="btn small soft" type="button" data-hh-note="ok">Got it</button></div>`;
}

/* ---------- Goals tab: the tidy-up offer ---------- */
export function combineCard() {
  const S = app.state, c = goalPotsToCombine(S);
  if (!c || readOnly() || getFlag("combine-later")) return "";
  return `<div class="card hm-combine" role="note"><div><b>Two goal pots, one of you</b><p>Your budget has a Goals pot and a Personal goals pot. As it’s just you, you can combine them into one, keeping every goal and its money.</p></div>
    <div class="hm-acts"><button class="btn small primary" type="button" data-combine="review">Review</button><button class="btn small ghost" type="button" data-combine="later">Not now</button></div></div>`;
}
export function openCombineReview() {
  const S = app.state, P = combinePreview(S, app.today); if (!P) return;
  const per = WORDS[S.viewAs].per, v = x => money(x / perYear(S.viewAs));
  const d = $("#sheet");
  const rows = P.rows.map(r => `<li><span>${esc(r.name)}</span><b>${v(r.before)} → ${v(r.after)}</b></li>`).join("");
  d.innerHTML = `<div class="sheet-head"><h3 tabindex="-1" autofocus>Combine your goal pots</h3><button class="btn icon" type="button" data-sheet="close" aria-label="Close">✕</button></div>
    <div class="sheet-body hm-review">
      <p>Your goals pot (“${esc(P.goals.name || "Goals")}”) gets ${pct(P.a, 2)} of your pay and your personal goals pot gets ${pct(P.b, 2)}. After combining, one Goals allocation gets <b>${pct(P.a + P.b, 2)}</b>.</p>
      <h4>What each goal gets ${esc(per)}</h4>
      ${rows ? `<ul class="hm-rows">${rows}</ul>` : `<p class="dim">No goals yet, so only the allocation changes.</p>`}
      <p class="${P.same ? "msg ok" : "msg"}">${P.same ? "Every goal keeps the same money. Saved amounts, targets, deadlines and accounts don’t change." : "A goal that’s already reached passes its share to the next goal in the list, so some amounts above move between goals. The total stays the same."}</p>
      <p class="set-note">Your other allocations, balances and history aren’t touched. You can undo this straight afterwards.</p>
      <div class="hm-acts"><button class="btn primary" type="button" data-combine="go">Combine them</button><button class="btn ghost" type="button" data-sheet="close">Cancel</button></div>
    </div>`;
  if (!d.open) d.showModal();
}
function combine() {
  const P = combinePreview(app.state, app.today); if (!P || readOnly()) return;
  app.state = P.next; changed({ full: true });
  const d = $("#sheet"); if (d.open) d.close();
  toast("Combined into one Goals allocation. You can undo this.");
}

export function initHouseholdMode() {
  document.addEventListener("click", e => {
    const m = e.target.closest("[data-hh-mode]"); if (m && !m.disabled) return setMode(m.dataset.hhMode);
    const nt = e.target.closest("[data-hh-note]"); if (nt) { setFlag("solo-shared-seen"); const c = nt.closest(".hm-note"); if (c) c.remove(); return; }
    const c = e.target.closest("[data-combine]"); if (!c) return;
    if (c.dataset.combine === "review") return openCombineReview();
    if (c.dataset.combine === "later") { setFlag("combine-later"); const card = c.closest(".hm-combine"); if (card) card.remove(); toast("You can combine them later from Household settings."); return; }
    if (c.dataset.combine === "go") return combine();
  });
}
/** For Household settings: the tidy-up, available again even after "Not now". */
export const combineLink = () => goalPotsToCombine(app.state) && !readOnly()
  ? `<p class="set-note">Your budget has two goal pots for one person. <button class="linkish" type="button" data-combine="review">Review combining them</button></p>` : "";

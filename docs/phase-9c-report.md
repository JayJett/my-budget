# Phase 9C report: rebalance budget

## A. Overview
- **What it does:** you pick an allocation, give it a new amount, choose where the difference comes from (or goes to), check a before → after review, then tap **Apply changes**.
- **What changes:** only allocation shares, and only after you tap Apply. The save is one all-or-nothing step: one entry in History, one tap of Undo.
- **The expense shortfall card** now offers two different fixes side by side:
  - **Review expenses**: change the expenses themselves.
  - **Adjust budget**: give the expenses more of your pay. It opens rebalancing with exactly the missing amount filled in.

## B. How the calculation works (`js/model/rebalance.js`)
- **The app's real money model (calc.js):** every allocation takes a share of each person's pay (`accounts[].split[personId]`), so each person's plan balances separately. Rebalancing follows that rule:
  1. **Who pays the change:** by default, the same way people pay into that allocation now. You can switch to By pay, Equally or "<name> only". A Personal allocation with an owner is only ever its owner's.
  2. **Finding an increase:** each person's part comes from their own plan:
     - first from their pay with no plan yet (if ticked)
     - then from the allocations you tick
  3. **Freeing money with a decrease:** it stays "no plan yet" unless you tick allocations to give it to.
- **How the money is shared out:**
  - Each ticked allocation gives in proportion to what it gives now, or you set an exact amount (when only one person's plan changes).
  - Amounts are worked out in whole cents of the period you're viewing, with leftover cents going to the largest share (deterministic).
  - An allocation that gives everything goes to exactly 0%.
  - The before/after rows reconcile to the cent.
- **Storage:** shares are still saved as fractions of each person's own pay, so weekly, fortnightly and monthly pay all convert correctly, and switching the viewing period changes nothing.
- **Reuse:** the preview is the real `compute()` run on a copy of the budget with the new shares, plus the Phase 9B `planStatus` and `coverage`. No second engine was added.
- **Validity:**
  - The amount must be a number of $0 or more. A failed rule shows a message; there's no NaN or Infinity.
  - An increase must be fully found. "$X still to find" disables Apply, and no proposal is made up.
  - Nobody's plan may go over 100%.
  - No negative shares.
  - The allocation must exist.
  - There must be an actual change.
  - With no pay entered, rebalancing isn't offered ("Add your pay first").
- **What it never assumes:**
  - Nothing is ticked for you.
  - Savings, investing and the emergency fund are never treated as optional.
  - "Room to adjust" isn't used as money to spend; rebalancing works from real allocation records.

## C. The experience
- **Entry points:**
  - **Rebalance** (a small button next to Reorder in "Your allocations").
  - **Adjust budget** on the expense card, only when expenses are over budget and the allocation that pays for them is known.
  - Home's "Planned expenses are over their budget" step, which now says "Adjust your plan or trim expenses" and opens the same fix on Budget.
- **The sheet:**
  1. Change: a list of your real allocations, by id, with their names, icons and colours.
  2. New amount for the shown period, with "Now $X · +$Y" beside it.
  3. Who pays the extra (shared allocations only).
  4. Take it from / Give it to: "Pay with no plan yet" first, then a tick list with each allocation's current amount and what it would give. Unticked rows say **Unchanged**: unticked means protected for this rebalance.
  5. A live "$X still to find" or "✓ Balanced".
  6. Review: compact rows "$1,000 → **$1,215.31** +$215.31/fn", with each person's part in shared households, then:
     - Plan: 100% allocated, still to assign, or over
     - Expenses: "$215.31/fn short → Entered expenses covered", shown only when that's actually true
     - any saving or investing that goes down: "$X/fn less going here"
- **Apply changes** is the only primary button.
- **Closing:** closing after you've changed something asks "Discard this rebalance?". An untouched sheet closes straight away, and Escape works the same way.

## D. Households
- **Solo:** a single plan, no "who pays" choice, and no shared wording.
- **Shared:**
  - Each person's part is shown ("Jarden +$116 · Madi +$96").
  - Someone's Personal allocation can only fund or receive their own part (shown as "Madi spending, Madi").
  - Other people's plans aren't touched by "<name> only".
- **Permissions:**
  - View-only members don't see Rebalance or Adjust budget.
  - The database refuses saves from them anyway (unchanged).

## E. Saving and data integrity
- **When:** only on Apply changes. The preview works on a copy; the budget on screen isn't touched until then.
- **One step:** the new `store.commit()`:
  1. finishes any other edits waiting to save
  2. re-reads the budget from the database
  3. sends just the changed shares in a single `apply_budget_ops` call, which runs as one database transaction under a row lock, so it's all or nothing
- **Conflicts:**
  - Each proposal remembers what it was based on: pay and every allocation share (names and colours don't count).
  - If that changed (another person's edit, or a live update while you're looking), nothing is saved. The numbers update and you're asked to check and apply again.
  - A tiny window between that check and the save remains; closing it fully needs a small database change (see K).
- **Failure:** nothing is claimed, the stored budget is unchanged (the save is all or nothing), and the proposal stays for a retry.
- **Wrong household:** a proposal is tied to the household it was made in.
- **Undo:** one rebalance is one history entry, so Undo reverses all of it together. Cancelled proposals never reach History.
- **Never touched:** expenses, goals and their saved amounts, account balances, net worth, snapshots, names, icons, colours and order (tested).

## F. Budget and Home
- **Order unchanged:** income card, then the compact expense check, then Allocated, then allocations.
- **Additions:** only the small Rebalance button and the Adjust budget action.
- **Home:** no new cards. The existing shortfall step now leads to the fix.
- **One set of findings:** the 9B insight engine, unchanged.

## G. Technical changes
- **New:**
  - `js/model/rebalance.js` (`propose`, `shareOut`, `fingerprint`, `whoOptions`, `shortfallFix`, `withSplits`, `canRebalance`)
  - `js/ui/rebalance.js` (the sheet)
  - `tests/rebalance.test.js`
  - `tests/browser/phase9c.test.js`
- **Changed:**
  - `js/sync/store.js`: `commit()`.
  - `js/ui/insight-view.js`: the Adjust budget action and the Home step wording.
  - `js/ui/views/budget.js`: the Rebalance button.
  - `js/main.js`: init.
  - `css/app.css`.
  - `sw.js`.
- **Not added:** dependencies, schema changes or migrations.

## H. Testing
- **Build, lint and type-check:** not applicable (plain JavaScript, no build step). The function copies check (`tools/sync-function.mjs --check`) passes.
- **Unit:** 249 pass, 17 of them new. They cover the brief's tests 1–12:
  - fully, under- and over-allocated budgets; shared households; mixed weekly/fortnightly pay
  - unticked allocations left alone; exact amounts; proportional sharing with cent remainders
  - not enough to take from; zero pay; cents; custom names, icons and colours
  - the ops match the preview exactly; freed money; the shortfall fix; the "based on" check; no change
- **Browser (fake Supabase), 8 new tests:**
  - shortfall → preview → apply (one history entry) → Undo restores everything
  - preview, then cancel: nothing sent, and a discard question only when edited
  - failed save (nothing changes; retry works)
  - another person's change meanwhile (nothing overwritten; preview updated; apply again)
  - wrong household; view-only access
  - shared mixed pay; Home step
  - 320/375/390/430 px, with Apply on screen and no sideways scrolling
- **Full browser suite:** all 284 pass.
- **Not verified:** a real iPhone.

## I. Git
- **Branch:** `phase-9c-rebalance`.
- **Pull request:** draft. Merge after your "go".

## J. iPhone checklist
1. **Increase:** Budget → Rebalance. Pick Goals, raise it by $50, tick Fun or Spending money, check the review, then Apply.
2. **Decrease:** pick Investments and lower it. With nothing ticked, the review says "$X will have no plan yet". Tick Goals to give it there instead.
3. **Fully allocated:** with nothing ticked, you see "still to find" and Apply is greyed out.
4. **Shortfall:** on the expense card, tap Adjust budget. The amount is filled in; tick where it comes from, then Apply. The card should change to "Your expenses are covered".
5. **Protect:** leave Investments unticked. It says Unchanged and stays the same.
6. **Preview only:** make changes, then ✕ → Discard. Nothing changed.
7. **Apply:** a toast confirms, and figures update on Budget and Home.
8. **Undo:** tap Undo once and everything goes back together.
9. **Unchanged data:** account balances, net worth and History snapshots are the same.
10. **Shared household:** in Jarden + Madi, raise Joint Spending. Each person's part shows; try "Jarden only".

## K. Remaining issues
- **Financial integrity, small:** between the "still the same?" check and the save there's a gap of a fraction of a second. Two people applying at almost the same instant could still overlap. Fully closing it needs a small change to `apply_budget_ops` (an optional "only if this value is still X" check). I can prepare that as a migration for your OK. Nothing has been applied.
- **Undo merging:** the database merges a quick follow-up (within 2 minutes) that touches exactly the same shares as your previous edit into that edit. A rebalance usually changes at least one new share, so it gets its own entry. The rare case is documented here.
- **History wording:** a rebalance is listed as "changed X's share…, and N other changes". A "Rebalanced budget" label would need the database to store a reason for edits.
- **Who pays:** the choice applies to increases. Decreases always come off in proportion to what each person pays in now.

## L. Phase 10 preparation
- **`propose()`:** it's already a pure "what if" for allocation shares. It returns the full next budget (`next`) and its `compute()` result (`C2`).
- **`extraCost()` (9B):** gives the cost of a new commitment.
- **A scenario engine could:**
  - chain proposals
  - compare `C` and `C2` across Goals and Investments
  - keep them unsaved

  It would add nothing to how saving works.

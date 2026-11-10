# Phase 10A report: Budget tab redesign

Presentation only. Calculations, budget data, the database and Phase 10's payday workflows are unchanged. Every figure the Budget tab works out is still compared, in all three periods, with the screen recorded before the UI phase 1 redesign (`budget-ui.test.js`, first test). They all match.

## A. What I found
- **Order on a phone (top to bottom):**
  1. Income card (period switch on its own row, then the total, a doughnut, a 58px row per person, and Add a person / Payday plan).
  2. Expense check card.
  3. "Allocated" card (a full bar for every person, even when everyone was done).
  4. Allocations, with Rebalance and Reorder in the heading and a dashed Add allocation button at the bottom.
  5. Fair split.
  6. Breakdowns.
- **First screen:** at 390×844 it ended just under the "Your allocations" heading, before any allocation.
- **Phase 10 pieces on Budget:** "Payday plan ›" on the income card, and payday destinations inside the allocation and pay sheets. Both are kept.
- **Data available for grouping:** an allocation's `type` (Joint, Personal, Investment) and owner are reliable. A `role` exists only on the five built-in allocations. Order is the user's own (Reorder).
- **A bug along the way:** an old, general `.review` style (Net worth's review row) also matched the expense check's "review" state. That is why "Add expenses to check they're covered" sat oddly, with the icon above the text. Fixed.

## B. What changed (top to bottom)
1. **Income:**
   - The same dark card, with less padding.
   - A compact Week/Fortnight/Month switch beside the "Household income" label. On the narrowest phones it drops underneath.
   - **Couples and larger households:** a slim bar showing who brings in what (with the same words for screen readers: "Share of household pay: Jarden 56%, Madi 44%"), then one tile per person with their pay for the chosen period and their share. Tapping a tile edits their pay, as before.
   - **One person:** no bar and no shares. One row says "Paid fortnightly" rather than repeating the amount. The pay per payday is added only when it differs from the period shown.
   - **Pay details** (collapsed): each person's actual pay and frequency, extra-pay years, the week/month/year equivalents, and **+ Add a person**. It stays open across redraws.
2. **Status (one card instead of two):**
   - **Headline in money:** "All $4,300 allocated", "$285 left to allocate", or "Over-allocated by $190". A short line underneath says who.
   - **People:** listed only while someone isn't done, and only the people who aren't. Each has a slim bar, what's left, and Fill. No more rows of full bars.
   - **Expense check:** the existing check, now a row inside this card. It is its own statement, so all pay being allocated never implies the bills are covered. A chevron opens the same breakdown as before. Review expenses and Adjust budget still show when needed.
   - **Payday plan** (Phase 10): "Payday plan · Next Thu 12 Nov · in 3 days · Madi", opening the playbook.
3. **Allocations (the main list):**
   - The heading says "Amounts per fortnight" once, so rows don't repeat "/fn". **+ Add** and **Manage** sit beside it.
   - **Manage** opens a small menu with **Rebalance** and **Reorder**. While reordering, the heading just says Done.
   - **Rows** are shorter (58px). The name has room, the amount is right-aligned in tabular figures, and icons are consistent.
   - **Shared rows:** "Jarden $960 · Madi $855" under the name, each person's part in a slightly deepened version of their colour.
   - **Someone's own rows:** e.g. "Personal Goals" with "Jarden · Personal" underneath. In a shared budget, a leading owner name ("Jarden — Personal Goals", "Madi Spending") is left off on screen because the line underneath already says whose it is. **The saved name is not changed.** The edit sheet, tooltip and screen-reader label still use the full name.
   - **Shared rows with nothing in them yet** say "Joint · no share of pay yet".
   - **Spending row:** "Covers your entered expenses" is no longer repeated there, since the status card says it. "Short of expenses" still shows.
4. **Fair split:**
   - **By default:** the verdict, then one line per person: "Jarden 56% of shared money · 56% of income". When the two match, that's visible at a glance.
   - **See the details:** the two bars, the 50/50 line (now a clean notch), the sums, and the explanation. Nothing is removed.
   - **When it shows:** still only with two or more earners.
5. **Breakdowns:**
   - Each collapsed row is 56px, with the title and a short description underneath. Descriptions wrap rather than being cut off with "…".
   - The charts inside are unchanged.
   - An old note, if any, is still the last row.
6. **Wide screens:** the same two columns as before.

## C. Decisions where there was a choice
- **No grouping of allocations.** Roles exist only on the built-in five, and guessing a group from a name would be unreliable. Grouping by type would also override the order people set with Reorder. I kept their order and spent the effort on the rows.
- **The period switch stays at 40px tall.** That's the app's minimum tap size, which the iPhone test checks. It's compact by being narrower and sitting beside the label.
- **Add a person** moved under Pay details, which is one tap away and labelled. Adding people is occasional; looking at pay is constant.
- **Names, not dots:** person colour is used on names (as Phase 9C.1 chose), deepened slightly for readable contrast on white.
- **Expense check toggle:** a chevron-only button (labelled "Expense details" for screen readers) instead of a separate "View breakdown" line. This saves a line on every visit.
- **Tour wording** for the status and allocations stops was updated to match ("Where things stand"; "+ Add; Manage has Rebalance and Reorder").

## D. Files
- **Changed:**
  - `js/ui/views/budget.js`: the layout, new display-only keys (`pp.*.freq`, `st.sub`, `st.ic`, `pd.when`, `fs.*`, `acc.*.none`), the income bar, and `shortName()`.
  - `js/ui/budget-sheets.js`: the Manage menu and the Pay details toggle.
  - `js/ui/insight-view.js`: the expense check as a row (no card of its own) with a chevron toggle.
  - `js/ui/tour.js`: two stop texts.
  - `css/app.css`: a new "Phase 10A" section at the end.
  - `sw.js`: version.
- **Tests:**
  - New: `tests/browser/phase10a.test.js` (8 tests).
  - Updated for the new layout: `budget-ui`, `phase7d2`, `phase8`, `phase9b`, `phase9c`, `phase9c1`, `phase9c2` and `smoke`, plus two helpers in `helpers.js`.
  - The figure-by-figure safety net is unchanged.
- **Not changed:** money maths, budget data, Supabase, the edge function, other tabs.

## E. Testing
- **Lint, type-check, build:** not applicable (plain JavaScript, no build step).
- **Unit:** 279 pass. **Database:** 102 pass. **Browser:** see the pull request for the final full run.
- **New browser tests cover:**
  - The first screen at 375 and 390: income, status and the first allocation are visible above the tab bar, in the agreed order.
  - The income bar and its words, person tiles, Pay details (stays open after changing period), and editing a person.
  - Status when fully allocated but expenses are over budget (both said, neither implied), over-allocated (in money, who), and one person with Fill.
  - Short names with the full name kept in the sheet and the saved budget, shared parts, one period in the heading, and Add.
  - The Manage menu: Rebalance opens, and Reorder moves and saves, then Done.
  - Fair split default and details, and its absence for one person.
  - Breakdown rows 56–64px at 390, with no "…".
  - 320px with very long names and $123,456 pay: nothing sideways.
  - Dark appearance.
- **Looked at by eye:** screenshots at 375 and 390 for two people, the live budget, one person, partly allocated and a new budget; Manage, Pay details, reordering and Fair split open; and 320px dark with long names.
- **Not verified:** a real iPhone.

## F. Worth a look on the phone
1. **Period switch:** whether its size feels right beside the label.
2. **Pay details:** whether "+ Add a person" under it feels findable enough for you.
3. **Short allocation names:** whether they read naturally in your real budget.
4. **Expense check chevron:** whether it's obvious enough.

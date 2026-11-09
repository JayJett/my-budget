# Phase 9B.1 report: simpler Budget, flat cards

## A. Budget page layout
- **Phone order:**
  1. The Budget hero (income, Week/Fortnight/Month, people)
  2. The expense check card
  3. Allocated status
  4. Your allocations
  5. Fair split
  6. Charts
  7. Note
- **The bug:** the Phase 9B card had no position set, so it jumped above the hero card.
- **Wide screens:** the expense check sits under the income card in the left column.
- **Unchanged:** the hero card itself.

## B. Expense check card
- **Collapsed (default):**
  - no visible title (screen readers hear "Expense check")
  - an icon (✓, ! or •, so it isn't colour alone), one status line, and at most one short detail line
  - at most one action, plus "View breakdown"
- **Status, in priority order:**
  1. Expenses are over budget: "$X/fn short" → Review expenses.
  2. Your expenses have no budget yet → Set a budget (opens the bills allocation).
  3. Your expenses are covered: "$X/fn not yet assigned to an expense" (or "Exactly, to the cent").
  4. No expenses yet: "Add expenses to check they're covered" → Add expenses.
  5. No pay yet: "Add your pay to check your expenses".
- **Not repeated here:** "Every dollar of pay has a plan" stays on the Allocated card, where it already lives.
- **Expanded ("View breakdown" / "Hide breakdown"):**
  - Where pay goes: the bar and rows, shown only when the parts add up to pay.
  - Room to adjust: rows only, plus a "Less expenses over budget" row when there's a shortfall, so the total is never misleading.
  - The unmarked-expenses finding, which opens the first unmarked expense.
  - The button reports open/closed (`aria-expanded`) and stays open while you edit.
  - Short fade-in, turned off with reduced motion.
- **Removed copy:**
  - "Based on what you've marked. It's a plan, not money in your account."
  - "That's about the plan being complete, not whether it's right for you." (also from Home's next steps)
  - the "Adjustable: …" paragraph (names now sit in the row label)
- **One short line left:** "Mark allocations adjustable or expenses flexible to add them here." It shows only inside the breakdown, and only when nothing is marked.

## C. Financial information kept
- **Phase 9B calculations:** no change to any of them (`js/model/intelligence.js` is untouched). Everything is still reachable:
  - coverage: card status, the coverage tag on the bills allocation, and Home
  - essential, flexible and unmarked expenses: the Expenses Essentials card and Home
  - where pay goes and room to adjust: View breakdown
  - over/under-allocation: the Allocated card
  - the insights engine: Home's next steps
- **Unit tests:** all 232 pass unchanged.

## D. Home subtitle
- **Removed:** "Your household's plan, shown per fortnight." (and its solo and "no pay" versions). Nothing replaces it.
- **Unchanged:** the greeting itself, and period labels on amounts.

## E. Card shadows
- **Shared changes:**
  - the `--shadow` token is now `none`, which flattens `.card`, `.stat`, `.panel`, `.hero`, `.gl-card`, `.ho-fig`, the auth and onboarding cards, and phone table rows
  - the hero cards' own shadow is removed
  - light-mode cards get a hairline border (`--line`) so they still stand apart from the page; dark mode already had flat cards with borders
- **Kept, because they float:**
  - the household dropdown, menus/popovers (`.pop`), bottom sheets, tour cards and spotlight, the update bar, the tab bar
  - segmented-control thumbs
  - selection rings on swatches and options, drag indicators and focus rings

## F. Files changed
- `js/ui/insight-view.js`: the new card (`primaryFinding`, `planCheckHTML`, open/close).
- `js/ui/views/budget.js`: the card moved under the income card.
- `js/ui/views/home.js`: subtitle removed.
- `css/app.css`: a Phase 9B.1 section.
- `sw.js`: version bump.
- `tests/browser/phase9b.test.js`: updated and new tests.
- No database changes and no migrations.

## G. Testing
- **Build, lint and type-check:** not applicable (plain JavaScript, no build step).
- **Unit:** 232 pass.
- **Browser, Phase 9B (10 tests):**
  - order (income → check → allocated), no title, collapsed by default, expand/collapse with `aria-expanded`
  - the covered state; the shortfall leads even when 100% is allocated, with no duplicate success line
  - no expenses: no "covered" claim; the unmarked finding opens the expense
  - Home: no subtitle; no card shadows on any tab; the household menu still has its shadow
  - shared household; 320/375/390/430 px with the breakdown open
- **Full browser suite:** all 276 pass.
- **Not verified:** a real iPhone.

## H. Git
- **Branch:** `phase-9b1-simplify`.
- **Pull request:** draft. Merge after your "go".

## I. iPhone checklist
1. **Card order:** Budget shows the income card first and the expense card right under it.
2. **Collapsed card:** one line ("Your expenses are covered" or "Expenses are over budget"), one short detail and "View breakdown".
3. **Breakdown:** tap View breakdown to see where pay goes and room to adjust; tap again to close.
4. **Over budget:** raise an expense above Joint Spending. The card shows "Expenses are over budget, $X/fn short" and Review expenses opens Expenses.
5. **Home:** the greeting has no line under it.
6. **Flat cards:** no shadows under cards (light and dark); the household dropdown still floats.
7. **Consistency:** switch Week/Fortnight/Month and accent colours, and switch households.

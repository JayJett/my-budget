# Phase 9B report: budget intelligence, affordability and room to adjust

## A. Architecture audit
- **Income:** each person has `pay`, a frequency (weekly / fortnightly / monthly) and a "recent payday". `compute()` turns each into a yearly amount (`C.people[].annual`, `C.incTotal`). Extra-payday years come from the payday (`extraPayYears`).
- **Allocations:** each has a share of each person's pay (`split`), a role (spending, emergency, goals, personalGoals, invest, or none), a type (Joint / Personal / Investment) and an owner.
  - `compute()` gives `C.rows[].t` (yearly), `C.tot` (allocated per person) and `C.pool` (what each role receives).
  - Unallocated and over-allocated are per person (pay − allocated).
- **Expenses:** each has a type (Fixed / Flexible / Sinking), an amount and a period (Week / Fortnight / Month / Year), plus a due month and set-aside amount for yearly bills. `compute()` gives each a yearly amount (`C.sp[].annual`) and a total (`C.committed`).
- **The link between Budget and Expenses:** every entered expense is paid from the one allocation with the role **"spending"**. That allocation's description reads "Feeds the Spending tab", and the tab already showed budget minus planned (`C.spBuffer`). This is a real identifier link, not name matching.
- **Limitation:** expenses can't yet be paid from other allocations (for example a person's "Spending money"), so coverage is about the household's bills/spending budget. A per-expense funding choice is a possible Phase 9C addition.
- **Missing before 9B:** a way to say whether an expense is essential, or whether an allocation could change. Both were added as optional fields stored in the budget (no database change). See C and E.
- **Goals, investments, accounts and snapshots:** used as they are, and unchanged.

## B. Definitions (`js/model/intelligence.js`)
| Term | Meaning |
|---|---|
| Planned income | Everyone's take-home pay, per year, shown per period (`C.incTotal`). |
| Allocated / unallocated | Pay given a job on Budget, or not yet. Unallocated is not "money to spend". |
| Planned expenses | What's on Expenses, as yearly amounts. Yearly bills are counted once, spread across the year. Plans, not purchases. |
| Essential expenses | Expenses the person marked Essential. Unmarked ones are shown as "not marked", never guessed. |
| Adjustable allocations | Allocations the person marked "Yes, it's adjustable". Nothing else is assumed adjustable: not savings, not investing, not the emergency fund. |
| Expense coverage | The spending-role allocation minus planned expenses. Positive is "not yet assigned to an expense", negative is a shortfall, and with no expenses it's unknown. |
| Room to adjust | Four parts that never overlap: pay with no plan yet; the bills budget not assigned to an expense; allocations marked adjustable; expenses marked flexible. Shortfalls and over-allocation are shown separately and taken off before anything "fits". |
| Account balances | Only on Wealth → Accounts. Never mixed with the plan. |

## C. Essential expenses
- Each expense sheet now asks **"Is this essential?"** with the choices Essential, Flexible or Not sure. The answer is stored as `need`, and nothing is pre-filled.
- Expenses gets an **Essentials** card:
  - a bar and amounts for essential, flexible and not marked
  - essentials as a share of pay
  - when some aren't marked yet: "may be higher", plus a **Mark them** button that opens the first unmarked expense
- **Frequencies:** all use the app's own conversions. Weekly, fortnightly, monthly and yearly are tested to the cent.

## D. Coverage
- **Bills allocation row (Budget):** shows "✓ Covers your entered expenses", "Short of expenses by $X/fn" or "No budget for your expenses yet".
- **Expenses tab:** the headline now says "not yet assigned to an expense" (it used to say "remaining", and the detail "Room to spare").
- **With no expenses entered:** coverage is unknown, there's no "covered" message, and the bills budget isn't counted as room.
- **Cash timing:** a yearly bill spread across the year doesn't mean the cash is there on the due date. The existing set-aside tracker for yearly bills is unchanged.

## E. Room to adjust (method)
1. **Pay with no plan yet:** the sum, per person, of pay minus allocated (never negative).
2. **Bills budget not assigned to an expense:** only when expenses are entered and the budget covers them.
3. **Allocations marked adjustable:** their planned amount. The bills allocation can't be marked, so its money isn't counted twice.
4. **Expenses marked flexible:** their planned amount. These sit inside part 2's budget but aren't part of 2, so there's no overlap.

- **No overlap:** the four parts never cover the same money. A test checks that, together with essentials, other expenses and saving, they add up to pay exactly.
- **Shortfalls:** shown as their own warning, and taken off before anything is said to "fit".
- **Wording:** "Room to adjust: up to $X/fn. Based on what you've marked. It's a plan, not money in your account."
- **Nothing marked yet:** it says so instead of guessing.
- **Shared households:** adjustable allocations are named with their owner. Personal allocations never count towards shared bills.
- **`extraCost(amount, period)`:** the yearly and per-period cost of a new recurring expense, and whether it fits the room. It's pure arithmetic for Phase 10 and changes nothing.

## F. Insight rules (`insights()`, one list for every screen)
| Rule | Level | Leads to |
|---|---|---|
| Plan over-allocated (by how much) | Needs attention | Budget |
| Planned expenses over their budget (by how much) | Needs attention | Expenses |
| Expenses but no budget for them | Needs attention | The bills allocation |
| No pay entered | Worth a look | That person's pay |
| No payday set | Worth a look | That person's pay |
| Pay with no plan yet | Worth a look | Budget |
| No accounts, or balances not reviewed in 30+ days (the existing rule) | Worth a look | Wealth → Accounts (opens "add account") |
| No goals | Worth a look | Goals (opens "add a goal") |
| No expenses | Worth a look | Expenses (opens "add expense") |
| Expenses not marked essential or flexible | Worth a look | The first unmarked expense itself |
| No snapshot yet (once known) | Worth a look | Wealth → History |
| Every dollar has a plan | Done | Budget |
| Expenses fit their budget | Done | Expenses |
| Every expense marked | Done | Expenses |

- **Order on Home:** problems first, then up to three "worth a look" items.
- **Budget:** shows the budget-related findings.
- **"Done" items** say what they mean. For example, "Every dollar of pay has a plan" adds "That's about the plan being complete, not whether it's right for you".

## G. Screens
- **Budget:** a new **Plan check** card under the allocations, plus the coverage tag on the bills allocation row.
- **Expenses:** a new **Essentials** card under the summary, and clearer "not yet assigned" wording.
- **Home:** up to three short lines inside the existing plan card (essentials, expenses fit or not, room to adjust), and next steps from the same rules. No new cards.
- **Sheets:** "Is this essential?" (expense) and "Could this change if needed?" (allocation, not the bills one).
- **Polish:** Home's columns no longer grow wider than the screen, and Home uses whole dollars.

## H. Technical changes
- **New files:** `js/model/intelligence.js`, `js/ui/insight-view.js`, `tests/intelligence.test.js`, `tests/browser/phase9b.test.js`.
- **Changed files:**
  - `js/model/home.js`: next steps now come from `insights()`.
  - `js/ui/views/home.js`, `js/ui/views/budget.js`, `js/ui/views/spending.js`.
  - `js/ui/budget-sheets.js`: the two new questions.
  - `js/ui/events.js`: the screen redraws when they change.
  - `css/app.css`.
  - Tests: `tests/home.test.js` (one fixture marked essential), the Spending baseline and its test (two labels reworded; all figures unchanged).
- **Not needed:** no new dependencies, schema changes, database migration or external configuration.

## I. Data safety
- **Unchanged:** account balances, existing allocations, household permissions, historical snapshots and Supabase policies.
- **No migrations.**
- **New fields:** `need` and `adjustable` are written only when a person sets them, and they're ordinary undoable edits.
- **Viewing is read-only:** a test visits every screen and checks that nothing is saved.

## J. Testing
- **Build, lint and type-check:** not applicable (plain JavaScript, no build step).
- **Unit tests:** 232 pass (20 new), including:
  - A–L from the brief: fully, under- and over-allocated; covered, short and unmapped
  - no expenses; unmarked; mixed frequencies; yearly bills; no or zero pay; odd values
  - room to adjust with no double counting (adds up to pay); `extraCost`; shortfalls
  - solo and shared households; read-only
- **Browser tests:** new `phase9b` tests:
  - marking expenses and allocations
  - Plan check and Essentials
  - a shortfall shown consistently on Home and Budget, opening Expenses
  - no-expenses states; the unmarked finding opening the expense
  - viewing saves nothing; switching households
  - shared mixed pay; 320–430 px with big numbers
  - The full-suite result is in the PR.
- **Regression:** the existing calculation, onboarding, history, goals, investment, net worth and snapshot tests pass. The Spending baseline's numbers are unchanged; only two labels were reworded.
- **Not verified:** a real iPhone. Separately, Playwright's touch emulation had trouble tapping the bottom bar over Home tiles in one screenshot script (a known emulator quirk), so the new tests tap tabs directly; existing navigation tests are unaffected.

## K. Git and deployment
- **Branch:** `phase-9b-intelligence`.
- **Pull request:** draft (link in chat).
- **Deployment:** deploys on merge, after your "go".

## L. iPhone checklist
1. **Essential expense marking:** on Expenses, open an expense. "Is this essential?" → Essential. The Essentials card updates, and "x% of pay" appears.
2. **Coverage:** on Budget, the Bills & essentials row says it covers your entered expenses. Raise one expense above the budget: it says "Short by…", and Home shows the same amount.
3. **Room to adjust:** on Budget → Plan check, open an allocation (for example Investments) → "Yes, it's adjustable". It appears under Room to adjust. Change it back.
4. **Home:** the plan card shows essentials, whether expenses fit, and room to adjust. Next steps only list real gaps.
5. **Budget:** the Plan check bar and legend add up to 100%.
6. **Solo household:** no shared wording.
7. **Shared household:** essentials as a share of everyone's pay; adjustable items show whose they are.
8. **Mixed pay frequencies:** a weekly and a monthly earner; the figures stay consistent between Home and Budget.
9. **Household switching:** switch households and every summary changes.
10. **Consistency:** the same shortfall or amount appears on Home, Budget and Expenses.

## M. Deferred
- **9C:** smart rebalancing (preview and approve changes), and choosing which allocation pays each expense.
- **10:** the what-if planner, built on `extraCost()` and `breathingRoom()`.
- **11:** payday experience: transfers, and cash timing for yearly bills.
- **12:** check-ins: balance updates and progress.

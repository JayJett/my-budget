# Phase 9C.1 report: calmer screens, small doughnuts, suggested expenses

## A. UI simplification
I audited every tab at 390px with a two-person budget. These were changed:

**Removed text**
- Home Net worth tile: "From the balances you've entered".
- Home Investing tile: "Planned each pay".
- Home Saving tile: "Planned for goals and your safety net" (shown when there's no emergency fund target).
- Home plan card: "…, every dollar given a job." It now reads "$4,300 per fortnight".

**Removed dots**
- The coloured dot before each name on Home's payday card (the names say who it is).
- The member dots on every Budget allocation row ("• Jarden $960 • Madi $855"). Shared rows now read "Jarden $960 · Madi $855".
- Personal allocations no longer repeat their owner's amount underneath: "Personal · Jarden" already says whose it is.
- The member dots in Goals' "Shared out" row.
- The dots beside "Assets" and "Owed" in Wealth.

**Replaced bars**
- Budget's thin income bar, Wealth's asset bar with its dot legend, and the Essentials bar are now small doughnuts (C).

**What stays visible, and why**
- Amounts with their period.
- Whose allocation it is.
- Warnings (over-earmarked, over budget, behind on a bill).
- Progress bars for goals, the allocated status, sinking bills, and the expenses bar (planned against budget, with the "over" line). These are progress or comparison, so they stay bars.

## B. Home payday card
- **Padding:** 18px → 22px on the sides and top, 20px at the bottom.
- **Spacing:** a little more space above the divider (18px) and below it (14px), and between people (12px). It's only a few pixels taller.
- **Names:** no dots now.

## C. Small doughnuts (`js/ui/mini-donut.js`, maths in `js/model/chart.js`)
| Where | What it shows | From |
|---|---|---|
| Budget hero, beside household income (two or more people) | each person's share of household pay | each person's pay, per year (`C.people[].annual`), in their own colour |
| Wealth → Accounts, net worth card | what you own, by kind (Everyday, Savings, Investments, Super) | account balances (`C.nw.op/sav/inv/sup`); debt is never a slice |
| Expenses, Essentials card | planned expenses: essential, flexible, not marked | Phase 9B `commitments()` |

- **When it's drawn:** only for real parts of one whole. Nothing to show, a negative part or a non-number means no doughnut (`donutParts` returns null).
- **Percentages:** whole numbers that always add to 100 (largest remainder).
- **Size:** 58–72px, plain SVG, with no new library.
- **Accessibility:** each has a text equivalent as its accessible name, e.g. "Share of household pay: Jarden 56%, Madi 44%". The exact amounts are listed beside it, so nothing relies on colour or hover.
- **Motion:** a short transition when values change, turned off with reduced motion.

## D. Suggested expenses
- **Library** (`js/model/suggestions.js`): a fixed, hand-picked list of 28 items in 8 groups:
  - Housing; Utilities; Everyday; Insurance; Subscriptions; Car (rego, WOF, servicing); Repayments; Family & pets
  - Each item has an existing icon and a suggested type and period, all of which you can change.
  - Whether something is essential is never guessed.
- **Choosing:**
  1. Tap chips (with a selected state and a count on the button).
  2. **Next** opens a short list where each item has an optional amount and how often.
  3. **Add N expenses** saves them.
- **Optional amounts:**
  - A blank amount is saved as no amount (`null`, never 0). The row says "Needs an amount".
  - These aren't counted in totals, coverage, essentials, room to adjust, rebalancing or Home's figures. Home shows one quiet step, "2 expenses need an amount", which opens the first one.
  - A typed amount must be above $0.
- **Duplicates:**
  - Expenses you already have are marked "Added", and "You already have one" on the amounts list. You can still add another on purpose (two insurance policies, for example).
  - Each pick gets its id once, and the save sets exactly those ids in one step, so a double tap or a retry can't add anything twice.
- **Saving:** all or nothing in one database call (the Phase 9C `store.commit`). A failed save adds nothing and keeps your choices. Closing after picking asks first.
- **Where it appears:**
  - Setup step 4: a quiet "Or choose your regular expenses" link under "+ Add an account". Afterwards it shows "✓ N regular expenses added", and "Skip for now" becomes "Done for now".
  - Expenses: "Choose from common expenses" when the list is empty, and "Add from suggestions" under the list.
  - Both use the same picker.
- **Households:**
  - Every expense in this app is paid from the budget's spending allocation, so for solo and shared budgets alike there's no owner to pick and nothing is assumed about who pays.
  - People joining an existing household don't go through setup.
  - Only owners and editors can open the picker.
  - A save is tied to the household it was opened in.

## E. Data and Supabase
- **Not changed:** the database, storage, RLS policies or the reminders function.
- **Not added:** dependencies or migrations.
- **Name-only expenses:** use the existing expense shape (amount may be empty).
- **The daily reminders function** (which has its own copy of the calculations) is untouched. A name-only expense is $0 there, as it always was for an expense without an amount.

## F. Financial correctness
- **Unchanged:** every existing calculation. The only logic change is in the Phase 9B intelligence layer: a named expense with no amount is "incomplete", so it's left out of the expense count, coverage and essentials instead of counting as a $0 bill.
- **Tests confirm** that name-only expenses don't change room to adjust or rebalancing proposals, and that they can't make coverage "covered".

## G. Testing
- **Build, lint and type-check:** not applicable (plain JavaScript, no build step). The function copies check passes.
- **Unit tests:** 258 pass (9 new):
  - doughnut maths: sums, zeros, negatives, non-numbers
  - the suggestion library; blank vs $0; mixed picks; name-only not counted (coverage, Home, room to adjust, rebalancing); bad amounts; fixed ids; existing names
- **Browser tests:** 6 new:
  - Expenses picking with mixed amounts (one save, allocations and balances untouched, "Needs an amount", Home step)
  - again later (marked as added, adding another on purpose, discard question, bad amount, failed save then retry with no doubles)
  - setup step 4 choosing and skipping
  - doughnuts (text equivalents add to 100; debt isn't a slice), calmer Home, payday padding
  - 320–430px
- **Full browser suite:** 290 pass. The net worth test was updated: amounts are now listed beside the doughnut, and its text equivalent gives percentages.
- **Not verified:** a real iPhone.

## H. Git
- **Branch:** `phase-9c1-simplify`.
- **Pull request:** draft. Merge after your "go".

## I. iPhone checklist
1. **Payday card:** Home's payday card has more room around the edges, with names and no dots.
2. **Less clutter:**
   - Home tiles have no "From the balances…" or "Planned each pay".
   - Budget allocation rows have no dots.
   - Personal rows don't repeat their owner's amount.
3. **Doughnuts:** a small ring beside household income on Budget, beside the account kinds on Wealth → Accounts, and on Expenses → Essentials.
4. **Chart details:** the amounts are listed beside each doughnut. With VoiceOver, the ring reads its percentages.
5. **Setup:** create a test household; on step 4 tap "Or choose your regular expenses".
6. **Name-only:** pick Rent and Internet, leave the amounts blank and add them. They show "Needs an amount", and Expenses' Planned figure doesn't change.
7. **With amounts:** add Groceries at $200 a week. Planned goes up by $400/fn.
8. **Skipping:** "Skip for now" adds nothing.
9. **Later:** on Expenses, tap "Add from suggestions". What you have shows "Added".
10. **Consistency:** Home, Budget and Expenses figures agree, and incomplete expenses never show as "covered".

# Phase 9A report: Home, five tabs, household menu, accounts in setup

## A. Navigation architecture
- **The bottom bar has five tabs:** Home, Budget, Expenses, Goals and Wealth.
  - Expenses is the former Spending screen.
  - Wealth contains **Accounts | Investments | History**: the former Net worth, Invest and Progress screens. Their content and calculations are unchanged.
  - A segmented switch at the top of Wealth moves between the three, and Wealth reopens on the last one used.
- **Addresses:**
  - New: `#home`, `#budget`, `#expenses`, `#goals`, `#wealth/accounts`, `#wealth/investments`, `#wealth/history`.
  - Old bookmarks still work: `#net-worth` → Accounts, `#investments` → Investments, `#progress` → History, `#joint-spending` → Expenses.
  - The app tidies the address after redirecting. Back and Forward work (tested), and the hash-based addresses suit GitHub Pages (no server routing).
- **Kept as they were:** internally each screen keeps its old name. So these are unchanged:
  - reminders that link to a screen
  - saved tour progress (nobody repeats tours)
  - attention markers (Wealth's badge adds up its three sections)
- **Tours:** Wealth's three sections keep their own tours, now named Accounts, Investments and History. The Budget tour's "other tabs" and "settings" stops describe the new layout.

## B. Home dashboard
Every value comes from `compute()` (`js/model/calc.js`), via `js/model/home.js`, so Home always agrees with the other screens. Nothing on Home calculates money independently.

1. **Greeting:** your profile's first name and the time of day on your device, e.g. "Morning, Alex". With no name it says "Your money at a glance".
2. **Payday card:** each earner's own next payday.
   - It's worked out from their "recent payday" and frequency. Monthly pay keeps the day of the month, and the 31st becomes the month's last day.
   - Several people's pay is never added together. The soonest is shown large, the others listed below it.
   - With no payday date there's no countdown, just "Add a payday" (it opens that person's pay settings).
   - It says "Planned, not yet in your account."
3. **Plan status:** "100% of your pay has a plan", "$X still to plan" or "Your plan is over by $X", using the Budget tab's own totals. It doesn't claim the plan is healthy.
4. **Figures:** each opens its own screen.
   - **Net worth:** "—" until there's an account.
   - **Saving:** money planned for the emergency fund and goals, plus the emergency fund's progress if it has a target.
   - **Investing:** money planned for investments.
   - **Expenses:** planned expenses against the money set aside for them.
5. **Next steps:** at most three, and only when true. In priority order:
   - add your pay, or set a payday
   - money left to plan, or over-allocated
   - add an account, or review balances (the app's existing 30-day rule)
   - create a goal
   - add your bills
   - save your first snapshot (only once snapshots are known to be empty)
   - Each opens the right screen. For example, "Add an account" opens the new-account sheet and "Set your payday" opens the person's pay.
6. **Solo or shared:** solo shows "Your plan" with no names on payday. Shared shows "Your household's plan" and each person's payday.
7. **Switching households** shows the loading screen until the new household has loaded, so the previous household's figures never appear.
8. **Deferred to Phase 9B:** affordability, flexibility, commitments analysis and any "financial health" judgement.

## C. Wealth
Accounts, Investments and History are the existing screens, unchanged. Everything they had is still there:
- **Accounts:** net worth, groups, the account sheet, earmarks, review and appearance.
- **Investments:** assumptions, forecast, milestones and the year table.
- **History:** snapshots, charts, comparison and "save now".

Financial snapshot History is separate from edit History (menu → History), which is untouched.

## D. Header and household menu
- **Your avatar** (left) opens your personal menu, as before: My profile, Reminders, History, Appearance, Guided tours, Data & backups, Sign out.
- **The household's picture and name** now open a small dropdown anchored underneath, containing:
  - the household you're in (ticked)
  - your other households (tap one to switch, using the existing switch)
  - Household settings (the existing sheet)
  - Create a household (the existing form and `create_household` function)
- **Behaviour:**
  - It closes on an outside tap, Escape or a choice.
  - Arrow keys move through it, and focus returns to the name.
  - It stays inside the screen and scrolls within itself if long, and it doesn't lock the page.
- **Permissions:** unchanged. Only your memberships are listed, the switch re-checks access, and settings still enforce roles.
- **Your menu:** the duplicate "Household" row and household list were removed from it.

## E. Profile ✕
- **Cause:** the green ring was the browser's focus ring. Opening a sheet put focus on its first button, the ✕.
- **Fix:** sheets now open with focus on their title, and the ✕ shows its ring only for keyboard focus.
- **Tested:** the ✕ looks plain when the sheet opens, is still 44×44, still closes, and shows a ring when reached with Tab.

## F. Onboarding
- **Four steps:** Make it yours → Your income → Your starting plan → **Your accounts (optional)** → done → Home.
- **Account types:** the app's own types, Everyday, Savings, Investments, Super (KiwiSaver) and Debt (entered as what's owed).
- **Workflow:**
  - "+ Add an account" opens a compact inline form (name, type, balance, and "Whose account" in shared households).
  - Accounts appear as rows with totals for "you have", "you owe" and net worth. You can edit or remove them.
  - Then Save, or Skip for now.
- **Validation:** a name is required, the balance must be 0 or more, and names can't be duplicated (goals find accounts by name).
- **Saving:**
  - It happens once, as part of setup (a whole-budget save marked as setup), so Undo never offers to remove it.
  - Every account has a fixed id from the start, so double taps or a retry can't duplicate it.
  - A failed save keeps everything and offers Try again.
  - Until saved, the accounts are kept in this browser tab, so a refresh returns to step 4 with them.
- **Skipping** saves nothing and invents nothing. A balance left blank stays blank, not $0.
- **Ownership:**
  - Solo has no question.
  - Shared defaults to you, with Shared as a choice.
  - It's a label only, also editable in the account sheet, and changes no totals.
- **Emergency fund:**
  - New plans no longer create an empty "Emergency Fund" net worth account.
  - The emergency fund is a goal; you later choose which account its money sits in, so it's never counted twice.
  - Existing budgets are unchanged.
- **Joiners:** people joining a household that already has a budget never see setup (unchanged).
- **Not included:** icon and colour choice during setup. Accounts get their default icons and can be personalised later in Wealth → Accounts.

## G. Financial integrity
- No calculation module changed: `calc.js`, `periods.js`, the snapshot model and the database are untouched.
- `tests/home.test.js` checks that Home's net worth, saving, investing and expenses equal `compute()`. The browser test compares Home with Accounts and Goals on screen.
- The existing finance-matrix, calc, snapshots, history and onboarding suites pass.
- **Behaviour change:** onboarding no longer adds the empty Emergency Fund account, for new budgets only.

## H. Technical changes
- **Added:**
  - `js/model/home.js`, `js/ui/views/home.js`, `js/ui/household-menu.js`
  - `tests/home.test.js`, `tests/browser/phase9a.test.js`
- **Changed:**
  - `js/ui/ctx.js` (addresses), `js/ui/views/labels.js` (names), `js/ui/render.js` (bar, Wealth switch, header button), `js/ui/events.js`
  - `js/ui/menu.js`, `js/ui/settings.js` (create sheet), `js/ui/onboarding.js` (step 4), `js/ui/auth.js` (resume step 4)
  - `js/ui/budget-sheets.js` ("Whose account"), `js/ui/tour.js` (wording), `js/model/onboarding.js` (no empty Emergency Fund account)
  - `css/app.css`
- **Dependencies:** none new.
- **Database:** no changes. The account owner is an optional field in the budget.
- **External configuration:** none.

## I. Testing
- **Build, lint and type-check:** not applicable (plain JavaScript, no build step).
- **Unit tests:** 212 pass.
- **Browser tests:** see the PR for the final count.
  - Five tabs, Wealth sections, old addresses, Back/Forward
  - Bar fit at 320/375/390/430 px
  - Home in solo, shared and new budgets; huge numbers at 320 px
  - Household menu (anchoring, keyboard, outside tap, switch, settings, create)
  - Profile ✕
  - Step 4: add, edit, remove, duplicate names, double tap, refresh, failed save, shared ownership
- **SQL tests:** no database changes this phase; CI runs them.
- **Not verified:** a physical iPhone or Android device.

## J. Deployment
Branch `phase-9a-home`, draft pull request (see the link in chat). It deploys on merge, after your "go". There are no blockers and no database step.

## K. iPhone checklist
1. **Five tabs:** Home, Budget, Expenses, Goals, Wealth. In Wealth, tap Accounts, Investments and History. Leave Wealth and come back: it remembers where you were.
2. **Home:**
   - The greeting should use your name.
   - The payday card should show your pay; set a payday and see the countdown.
   - "Next steps" should only list things you really haven't done.
   - Tap a figure and it opens the right screen with the same number.
3. **Household menu:**
   - Tap your household's name: a small dropdown appears under it.
   - Tap outside to close it.
   - Your avatar on the left still opens your own menu, with no household items.
4. **Switching:** with two households, switch from the dropdown. The header, Home and every tab should change, with no flash of the old one.
5. **Profile ✕:** menu → My profile. The ✕ should be plain, with no green circle.
6. **Setup step 4:**
   - Sign up with a fresh email and do steps 1–3.
   - Step 4 should say "(optional)". Add Everyday, Savings and a Credit card. Check the totals, then save.
   - Home should show your net worth.
   - Try another fresh email and Skip: Home should offer "Add an account".
7. **Money:** compare a few numbers on Budget, Goals and Wealth with before. They should be the same.

## L. Deferred
- **9B:** what you can afford, flexibility, commitments and insights.
- **10:** what-if planning.
- **11:** payday checklists and transfers.
- **12:** check-ins.
- **Later possibilities:**
  - a short Home tour
  - account icons during setup
  - showing whose account it is in the Accounts list

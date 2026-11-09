# Phase 10 report: Payday Playbook

## A. Architecture findings
- **Budget people** (`state.people`, ids like `j`) earn pay and have a pay frequency and a "recent payday". **Household members** (`household_members.user_id`) are logins. Until now nothing reliably linked the two: the app only matched names (for "Whose account" in setup).
- **Allocations** (`state.accounts`) give each person's pay a share (`split[personId]`), and have an owner and type. They say what money is for. **Wealth accounts** (`state.nw.accounts`) are balances you type in. They're separate, and still are.
- **Paydays:** `nextPayday` (Home) works out each person's next payday from their date and frequency.
- **Reminders:** a daily server run at 8am NZ reads each household's budget plus the switches of members who turned reminders on, works out reminders with the app's own code (`js/model/reminders.js`, copied into the function), de-duplicates them by key, and pushes them to devices where set up.

## B. "Which person is me?"
- **Database (migration below):** a new `household_members.person_id`, set only through `link_budget_person(household, person)`. That function:
  - is only for yourself (the column can't be written directly)
  - only accepts a person who is in that household's budget
  - never accepts a person someone else in the household has already linked to (enforced by a unique index)
- **Nothing is linked by name.** Existing households start with nobody linked.
- **In the app:** the Payday Playbook asks "Is this your pay? Yes, this is me" for an unlinked person. People without a login can still have their plan viewed by others; their checklist just isn't available until they link.
- **Leaving a household:** your membership row goes, and the link with it.

## C. Destinations
- **Allocation sheet → "Payday destination":**
  - One of your Wealth accounts money can go to (Everyday, Savings, Investments; not debts, not super). It's linked by id, so renaming the account is fine. A deleted account shows "Account removed: choose again".
  - Or "Somewhere else (type a name)", e.g. "Joint bills". A name is only a name: it has no balance, isn't in Wealth and doesn't affect net worth.
  - Or nothing.
- **Shared allocations:** "Different place for each person" (collapsed) lets one person's part go somewhere else (`destBy[person]`).
- **Pay sheet → "Pay goes into":** where each person's pay lands (`src`).
- **Storage:** all of this is metadata in the budget (`acc.dest`, `acc.destBy`, `person.src`). It's saved and undoable like any edit, and it never changes ownership, type, amounts or balances.

## D. Payday amounts
- **Formula:** for one person and one payday, each allocation gets **that payday's pay × that person's share**. It uses the pay as entered (per payday), never a yearly figure divided back down, so extra-payday years don't change what a payday says.
- **Cents:** split in whole cents, with leftover cents going to the largest fractions (ties in list order). Parts always add up exactly.
  - Under 100%: "$X not allocated yet". It's never a transfer.
  - Over 100%: no instructions, just "This plan is X% over the pay", with Fix it in Budget and Rebalance.
- **Instruction types:**
  - **Keep in** (the destination is where pay lands).
  - **Transfer to** (anywhere else). Parts going to the same place are grouped into one transfer, with the parts listed.
  - **Set aside** (no destination yet; never looks like a finished transfer).
- **Dates:** each person's own payday from the same `nextPayday` Home uses (moved unchanged to `js/model/paydate.js` so the reminder function can share it). Weekly, fortnightly and monthly are supported, the 31st falls on the last day of shorter months, and dates are calendar days with no time-zone shifting. Previous and Next step through paydays.

## E. Payday Playbook screen
- **Opens from:**
  - Home's payday card ("See your payday plan", or "Set up your payday plan" before any destinations are chosen)
  - Budget's income card ("Payday plan ›")
  - a payday reminder (`#payday`)
- **Contents:**
  - Person chips in shared budgets, and a dark header with the date, how soon, the pay and where it lands.
  - The list of Keep, Transfer and Set aside items, with amounts.
  - "N of M marked done".
  - "Choose where your money goes" while nothing is set.
  - Review budget.
- **No new tab**, and Home is only one line larger.

## F. Checklist
- **Who:** optional, and only for your own linked person.
- **What you can tick:** Keep and Transfer. Set aside can't be ticked.
- **Saving:** each tick is saved immediately by `payday_check_mark`, which is idempotent. One payday is one record (household, you, person, date), so each payday has its own list.
- **First tick:** keeps a copy of that payday's instructions. If the budget changes afterwards, the list stays as it was, with "Your budget changed after you started this checklist · Use the new plan". Choosing it keeps ticks for instructions that are still there.
- **If a tick fails:** it goes back unticked and says "Couldn't save that tick".
- **Undo:** ticks aren't budget edits, so they never appear in Undo or History.
- **Privacy:** ticks are private to you. Owners can't see them either.

## G. Reminders
- **New switch:** "It's payday" in Reminder settings. It's off by default and only shown once you've said which person you are.
- **Delivery:** the existing daily run adds it (`payday:<person>:<date>`, once per payday) only for the member linked to that person, on that person's payday.
- **Lock screen:** no amounts; the text is "It's payday! Your payday plan is ready in Moni Money".
- **Opening it:** tapping it opens the plan. Push works as before where it's set up; the bell inbox always works.

## H. Financial integrity
- **Never changed by viewing or ticking:** budgets, balances, net worth, goals and saved amounts, investments, snapshots, history and Undo. Tested: viewing and ticking send no budget saves, and the budget is byte-for-byte the same.

## I. Supabase changes (applied with your OK)
- **New migration file:** `supabase/migrations/20261120001100_payday_playbook.sql`. It's additive only:
  - `household_members.person_id` (+ unique per household, length check) and `link_budget_person()`.
  - New table `payday_checks` (household, user, person, date, plan copy, done; size limits). RLS lets people read only their own rows; direct writes are revoked.
  - Functions `payday_check_get`, `payday_check_mark` and `payday_check_replan` check that you're a member and that the person is yours. Your own checklists older than about 400 days are tidied away.
  - `reminder_prefs.payday` (default off); `start_reminder_run` and `reminder_run_data` updated to include it and each member's `person_id`.
- **Edge function `send-reminders`:** `run.js` and the model copies changed, so it needs redeploying.
- **Done:** the migration is applied to the live database and checked (new column and table present, row-level security on, direct writes blocked). `send-reminders` is redeployed (version 5), and every deployed file was compared with the repo and matches.
- **No other external configuration.**

## J. Technical changes
- **New:**
  - `js/model/payday.js`, `js/model/paydate.js`
  - `js/ui/payday.js`, `js/ui/payday-dest.js`
  - the migration
  - `tests/payday.test.js`, `tests/sql/payday.test.js`, `tests/browser/phase10.test.js`
- **Changed:**
  - `js/model/home.js`: `nextPayday` moved, unchanged.
  - `js/model/reminders.js`: payday reminder.
  - `js/ui/auth.js`: loads `person_id` when the database has it.
  - `js/ui/reminders.js`, `js/ui/budget-sheets.js`, `js/ui/views/home.js`, `js/ui/views/budget.js`, `js/main.js`.
  - `css/app.css`, `sw.js`.
  - `tools/sync-function.mjs` and the function copies; `supabase/functions/send-reminders/run.js`.
  - The fake Supabase.
- **Not added:** dependencies.

## K. Testing
- **Build, lint and type-check:** not applicable (plain JavaScript, no build step).
- **Unit:** 279 pass. New ones cover:
  - A–O from your brief: solo, weekly, monthly with month-end, mixed frequencies, shared and personal, under and over 100%, cents, zero pay and no date, renamed allocations, separate and grouped destinations, keep vs transfer, missing or removed destination
  - per-person overrides, eligible accounts, no change to the budget, snapshots, the same payday maths as Home
  - the payday reminder: opt-in, the right person only, on the day, no amounts, weekly, no pay
- **Database (throwaway Postgres):** 102 pass, 5 new:
  - linking rules: only yourself, only a person in the budget, no doubles, no direct writes
  - checklist privacy, even from owners and other members
  - idempotent ticks, a kept copy, each payday separate, replan
  - reminder data
- **Browser:**
  - 8 new: new solo, destinations and grouping, tick, reopen, untick, next payday, nothing financial changes, plan change, failed tick, over 100%, couples with different paydays and people, choosing destinations in the sheets, "before the database part", reminders switch and link, 320–430px
  - Full suite: all 306 pass.
- **Not verified:** a real iPhone, and a real payday reminder arriving (the next one goes out on an actual payday morning).

## L. Git
- **Branch:** `phase-10-payday-playbook`.
- **Pull request:** [JayJett/my-budget#31](https://github.com/JayJett/my-budget/pull/31), merged after your "go".

## M. iPhone checklist
1. **Opening it:** Home → "See/Set up your payday plan" opens it.
2. **Solo:** the date, pay and each allocation's amount add up to your pay.
3. **Couple:** switch between people with the chips. Each shows their own date and pay.
4. **Destinations:** Budget → open an allocation → Payday destination → pick an account or type a name.
5. **Grouping:** point two allocations at the same account. One "Transfer to", showing "2 parts".
6. **Keep:** your pay sheet → "Pay goes into" Everyday, and an allocation going to Everyday → "Keep in Everyday".
7. **Missing destination:** it's "Set aside", with "Choose where it goes".
8. **Checklist:** "Yes, this is me", then tick an item. You see "1 of N marked done".
9. **Revisit:** close and reopen, or refresh. The tick is still there.
10. **Second payday:** Next › shows the next payday's own empty list.
11. **Budget change:** change an allocation's % after ticking. "Your budget changed…", then Use the new plan.
12. **Reminder:** Reminder settings → "It's payday" (off until you turn it on).
13. **Switch households:** each has its own plans.
14. **Nothing financial moves:** Wealth balances and net worth are unchanged after ticking.

## N. Known limitations
- One payday reminder per payday at about 8:30am NZ time. Time zones outside NZ use NZ dates (unchanged from existing reminders).
- Existing members aren't linked automatically; each says "this is me" once.
- No account numbers or banking details are stored, on purpose.

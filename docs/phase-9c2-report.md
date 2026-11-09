# Phase 9C.2 report: mobile polish and bug fixes

## A. Guided tours
- **Cause:** during a tour the app hid the page's overflow (`overflow:hidden` on `<html>`) to stop scrolling. On iPhone Safari that unsticks the sticky header. Once you'd scrolled down, the header went off the top of the screen, taking the avatar (the last Budget stop) with it. The spotlight was then pinned to the top edge and the card landed over the wrong rows.
- **Fix:**
  - The tour now stops scrolling only by catching touches and the scroll wheel (`guardScroll` in `js/ui/dom.js`). It doesn't hide the page's overflow, so the header stays put.
  - Placement is measured against the visible part of the screen (`visualViewport`). The card goes below the spotlight, else above it, else docks at the bottom of the screen.
  - If a stop is ever off screen, the spotlight hides and the card docks at the bottom, so the buttons are always reachable. No fixed pixel offsets were used.
- **Wording:** the last step is now "Your settings: Tap your initial for your profile, appearance, reminders and tours. Tap the household's name to switch or manage households."
- **Unchanged:** other tour stops, and saved tour progress.

## B. Onboarding
- **Last screen:** **Show me around** is now the main button (it starts the Budget tour). **Open Moni Money** is a quieter link that goes to Home with no tour. The existing "offered" record still means skipping is respected.
- **Payday required:**
  - Step 2 now asks "When were you last paid?" right under pay and frequency (no longer hidden in "More pay details").
  - With pay entered, a valid date of today or earlier is needed. Without one, you can't continue: the message reads "Add the date you were last paid" and the date box gets focus.
  - Nothing is filled in for you.
- **Two or more people:** each person with pay needs their own date. One person's date is never copied to another. Someone whose pay is left blank needs none, and leaving all pay blank for now still works.
- **Existing households:** nothing is blocked or changed. A missing payday is still offered through Home's "Set your payday" step and the pay sheet.
- **Scheduling:** unchanged; the date feeds the existing payday maths.
- **Date box:** keeps the earlier overflow fix (`appearance:none; width:100%; min-width:0`) and fits at 320px.

## C. Expenses empty state
- "Choose from common expenses" is a full-width main button, with "+ Add your own" as a link underneath.
- Both are at least 44px tall, stay inside the card at 320–430px, and work as before.

## D. Doughnuts
- **Cause:** the ring's radius (15.9) plus half its stroke (2.5) reached 18.4 units, past the 18-unit half-width of the drawing area, so all four sides were shaved off.
- **Fix:** radius 15 (outer edge 17.5). This is fixed once in `js/ui/mini-donut.js`, so all three doughnuts benefit. Proportions, colours and data are unchanged.

## E. Expense check breakdown
- **No complete expenses:** there's nothing to break down, so there's no "View breakdown". The card shows one next step:
  - **Add expenses:** opens the suggestions.
  - **Add amounts:** when expenses are waiting for an amount. It opens the first one, and those expenses are never counted as $0.
- **With expenses:** "View breakdown" shows just two numbers: Entered expenses and Budget for them. (The difference is already in the card.) "More detail" holds where pay goes, room to adjust and unmarked expenses, so nothing is lost.
- **Unchanged:** every 9B calculation.

## F. Live updates
- **Why the banner appeared:** Supabase's live channel reports an error or timeout when the connection drops. On iPhone that usually happens when the app goes to the background. Nothing reconnected it, and the app inserted a banner into the page, pushing everything down.
- **Now:**
  - There's no banner. The header's existing status dot (already reserved space) turns amber with a "!", so nothing moves.
  - Tapping it explains ("Live updates paused · Your changes still save…") and offers **Reconnect**.
  - The app also reconnects by itself when it comes back to the front or online, then fetches the latest budget once so nothing missed is lost.
  - Switching households resets the state.
- **Save failures:** these are separate (saving doesn't use the live channel). The dot turns red, and a message now appears over the page once ("Your last change didn't save yet…"). Before, on phones it was only a dot.
- **Unchanged:** the offline banner (a different state, where edits are only on the phone), and conflict handling.

## G. Tab note and page endings
- **The tab note:** the Budget tab's "Add a note" box at the bottom is gone (it was the only tab-level note).
  - A note someone already wrote is kept unchanged in the budget and in downloads. It can be read, changed or removed under a collapsed "Note" in the Budget insights card.
  - Notes on individual expenses, goals and accounts are untouched.
- **Page endings:** the divider line above Goals' and Wealth's final "How it works" link is gone, and the large gap before it shrank (50px → 20px).
  - Tested: on Home, Budget, Expenses and Goals, the space after the last item is under 200px. That's the bottom bar plus breathing room.

## H. Goals hero
- **Layout:** "Saved so far $X" sits on the left and "Your goals N" on the right, on the same line, with "N reached" under the count when there are any. The line below now reads "of $X total target", so the count isn't said twice.
- **Count:** same definition as before: every named goal, emergency fund included.
- **Small screens:** it stacks gracefully on very narrow screens.
- **A bug caught along the way:** the class name I first used was already used by each goal card's top row. It was renamed before shipping.

## I. Technical changes
- **Changed:**
  - `js/ui/dom.js`: `guardScroll`.
  - `js/ui/tour.js`: placement and wording.
  - `js/ui/onboarding.js`: CTA order and payday field. `js/model/onboarding.js`: `paydayErrors`.
  - `js/ui/views/spending.js`, `js/ui/mini-donut.js`, `js/ui/insight-view.js`.
  - `js/sync/store.js`: `catchUp`. `js/ui/auth.js`: live status, reconnect, save-failure message.
  - `js/ui/views/budget.js`: the note. `js/ui/views/goals.js`.
  - `css/app.css`, `sw.js`.
  - The fake Supabase can now simulate a dropped connection.
- **Not changed:** dependencies, the database, migrations or RLS.

## J. Testing
- **Build, lint and type-check:** not applicable (plain JavaScript, no build step).
- **Unit:** 259 pass (1 new: the payday rules, including leap day, future dates, blank pay and two people).
- **Browser:** 8 new:
  - the tour's last stop at 320×568 and 390×844 (lit, card on screen, header still sticky)
  - payday needed, then accepted; two earners
  - CTA order
  - empty-state layout at 320 and 390
  - ring inside its box
  - expense check states
  - live paused (no banner, nothing moves, popover, reconnect, failed save message)
  - note kept; Goals hero; page endings
- **Older tests updated:** setup tests now enter a payday, tests that typed into the tab note open it first, and the expectations for a new solo Home and an empty expense check were updated.
- **Full suite:** all 298 pass. `budget-ui` now checks that the last card, rather than the old note box, clears the tab bar.
- **Not verified:** a real iPhone.

## K. Git
- **Branch:** `phase-9c2-polish`.
- **Pull request:** draft. Merge after your "go".

## L. iPhone checklist
1. **Tour:** Budget → scroll to the bottom → avatar → Tours → Budget. Step 6 lights up your initial, and the card is fully visible with Back and Done.
2. **Setup:** create a test household. Enter pay without a date: Continue asks for "When were you last paid?". Add the date and continue. On the last screen, "Show me around" is the main button.
3. **Expenses with nothing yet:** a full-width "Choose from common expenses" with "+ Add your own" underneath.
4. **Doughnuts:** the rings on Budget, Wealth → Accounts and Expenses → Essentials are perfectly round, with no flat sides.
5. **Expense check:** with no expenses there's just "Add expenses". With expenses, View breakdown shows two numbers, and "More detail" shows the rest.
6. **Live updates:** leave the app in the background for a while, then return. There's no banner. If the dot turns amber with "!", tap it for details and Reconnect.
7. **Note:** there's no note box at the bottom of Budget. An old note is under "Note" in the bottom card.
8. **Page endings:** Goals and Wealth end without a line above "How it works" and without a big empty run.
9. **Goals hero:** $ saved on the left, number of goals on the right, total target underneath.

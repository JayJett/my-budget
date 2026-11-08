# Phase 8 report: solo or shared, personalisation, motion

## 1. What changed

- **Solo budgeting.**
  - "Just me" builds a plan for one: Bills & essentials, Spending money, Emergency Fund, **one Goals allocation** and Investments.
  - Every allocation belongs to that person, and none is labelled Joint.
  - The usual suggestion logic is unchanged. The personal-goals share is simply added to Goals (default 50 / 15 / 10 / **15** / 10). With the 20% spending and 5% emergency fund from your test, it gives exactly 50 / 20 / 5 / 15 / 10.
- **Shared budgeting.**
  - "With someone" builds the shared plan: shared bills, emergency fund, goals and investments, plus each person's own spending money and personal goals.
  - This happens even if only your pay has been added so far.
  - Plans for 3 or 4 people work too, and everyone starts with a different colour.
- **Joining a household** never builds a second plan. Joiners open the existing budget. If a budget appears while you're in setup, the app opens it instead of saving yours (unchanged).
- **Goals for solo users:** one Goals pot, so one "Add a goal" goes straight in, with no "where from?" question.
  - Older solo budgets with two pots get an *offer* on the Goals tab: review → combine → undo if you like.
  - Every goal keeps its saved amount, target, deadline, account, icon and money each fortnight.
- **Customisation:**
  - 10 accents plus your own colour, adjusted automatically to stay readable.
  - A colour and icon for allocations, net worth accounts, goals and expenses.
  - 3 more people colours, with a gentle note if two people share one.
- **Household identity:** colour, icon or photo, shown in the header, the switcher and Household settings.
- **Onboarding appearance:** an optional "Make it look like yours" on step 1 (swatches + Light / Dark / Auto).
- **Animation:**
  - One spring curve for presses, choices and sheets. Progress bars glide.
  - Celebrations only for real milestones you just reached (the existing rule).
- **Touch feedback:** the Vibration API where it exists (see section 5).

## 2. Technical architecture

- **New files:**
  - `js/model/household.js`: combining goal pots, with a preview
  - `js/ui/household-mode.js`: solo/shared setting, transition note, combine offer
  - `js/ui/household-look.js`: household avatar, look editor, photo
  - `js/ui/palette.js`: colours and contrast maths
  - `js/ui/motion.js`: one "calm" check
  - `js/ui/feedback.js`: vibration helper
- **Changed:**
  - `js/model/onboarding.js` (solo plan), `js/model/schema.js` (mode, `isShared`, `roleNote`, solo blank budget, 3 people colours)
  - `js/ui/accent.js` (custom colour, motion, feedback, reset), `js/ui/icons.js` (categories, Appearance box)
  - sheets, lists and charts to use object colours and icons
  - Appearance sheet, setup step 1, CSS
- **Data model:**
  - Budget JSON: `mode` (optional). On allocations, accounts, goals and expenses: `icon` and `colour` (optional). There's no schema change, and old records simply lack these fields.
  - Your login (`user_metadata`): `accentHex`, `motion`, `feedback` are added next to `accent`, `theme` and `density`.
  - Household: `households.appearance`.
- **Storage and policies:** a private `household-photos` bucket.
  - Members can read their household's folder.
  - Owners and editors can add, replace and remove files.
  - `set_household_appearance()` checks the role and keeps only `colour`, `icon` and `photo` (the photo must be in that household's folder).
  - The column can't be written directly.
- **New dependencies:** none.
- **Migration:** `supabase/migrations/20261115001000_household_identity.sql`.
  - It's additive and safe to run twice.
  - **It needs your OK, and it is not yet applied.**
  - Until it's applied, households load and look as before, and saving a household look shows a friendly message.

## 3. Financial correctness

- No formula in `js/model/calc.js` changed. The money for spending, the emergency fund, goals, personal goals and investments has always been worked out from each allocation's **role** (its purpose), and that's untouched.
- Whose money it is comes from the allocation's **owner** and **type**. These now come out right for solo plans: each allocation belongs to the person, with no "Joint". They only affect the fair-split view (two or more earners) and labels.
- **Verified:**
  - Solo and shared plans add to 100% for every pay
  - Pools receive the right amounts
  - Solo → shared moves no money and keeps every goal and balance
  - Combining goal pots keeps each goal's money a fortnight and every total
  - The existing finance matrix, calc, snapshots, history and onboarding suites still pass
- **Limitation (the review shows it if it happens):** when goal pots are combined and a goal is already reached, its share passes to the next unfinished goal in the *combined* list, which could be a different goal than before. Totals never change.

## 4. Mobile UX

- **Tested in automated browsers:**
  - Widths 320, 375, 390 and 768
  - Light and dark, several accents, solo and shared, long names
  - Step 1 fits without scrolling at 390×844 and 375×667, folded or opened. At 320×568 the step already scrolled before this phase, and that's unchanged.
  - No sideways scrolling in the sheets or the Budget tab
  - On narrow phones, allocation names wrap to two lines instead of being cut off
- **Not tested:** a real iPhone or Android phone. Please do the checklist below.

## 5. Touch feedback (haptics)

- **Supported:** browsers with the Web Vibration API on phones with a motor. In practice that's Chrome, Samsung Internet and Edge on Android. The browser may need a tap on the page first.
- **Tested:** in an emulated Android Chrome, it buzzes on choices, is throttled to once per 120 ms, and stays silent when switched off. In an emulated browser with no vibration, nothing breaks and the switch is hidden.
- **Not supported:** iPhone/iPad Safari (any iOS browser), and desktop browsers. There, the app uses visual feedback only: presses, springs and selected states.
- **Real iPhone haptics** would need a native or hybrid app wrapper, which is out of scope for this phase.

## 6. Testing

- **No build, lint or type-check step:** the app is plain JavaScript, so there's nothing to build.
- **Unit tests:** 202 pass.
  - New: solo, shared and 3–4 person plans, the mode, solo → shared, combining goal pots.
  - New: every custom colour stays readable, and object and accent colours meet contrast.
- **Browser tests:** all pass (246 before the final additions).
  - New: solo and shared setup, mode switching, the combine flow and Undo, allocation, account and goal appearance, household look, photo and viewer permissions, the "database not updated yet" case, step-1 look, Appearance, and touch feedback on and off, including no-vibration browsers.
- **SQL tests:** 97 pass on a local Postgres. New: household look (owner, editor, viewer, outsider, signed out), private photos, and running the migration twice.
- **Supabase permission checks:** covered by the SQL tests. The live project is unchanged until you approve.

## 7. Deployment

- Branch `phase-8-personal`, pull request: https://github.com/JayJett/my-budget/pull/23 (draft).
- It goes live on GitHub Pages once merged (on your "go").
- **Outstanding:** apply the household-look migration, with your OK.

## 8. iPhone checklist (live app, after merging)

1. **New solo household:**
   - Sign up with a new email and choose "Just me".
   - Open "Make it look like yours" and pick a colour plus Dark.
   - Add your pay. The plan should show 5 rows with one "Goals" and no "Joint" or "Personal Goals".
   - Use the plan, then check there's no Undo button.
2. **Goals tab:** "Add a goal" goes straight in. Set a goal and its saved amount past 25%, and you should see a little cheer.
3. **Shared household:**
   - Another new email, "With someone". The plan should show Joint Goals and Personal Goals.
   - Household settings → "Who's this budget for?" shows *With others*.
4. **Appearance:** try colours, your own colour, Light/Dark/Auto (change the iPhone's setting while on Auto), and Reduced motion. Then reset.
5. **Allocation colours:** open an allocation → Appearance → pick a colour and an icon. Check the list and Breakdown charts.
6. **Account icons:** in Net worth, give a savings account a house icon. It should still say Savings.
7. **Household photo** (after the migration): Household settings → How it looks → Add a photo, crop and save. Check the header and the switcher, then replace and remove it.
8. **Animations:** tap buttons, tabs and choices, and open and close sheets. They should feel springy but quick. The iPhone won't vibrate (expected).
9. **Money:** compare a few numbers on Budget, Goals and Invest with before. They should be identical.

# My Budget

A friendly household budget **visualiser** (not a transaction tracker): enter your pay, decide what
percentage goes where, and see it as charts, goals and a 30-year investment curve.
Live at **https://jayjett.github.io/my-budget/**.

There's **no build step**. GitHub Pages serves these files exactly as they are.

## What's where

| Path | What it is |
|---|---|
| `index.html` | The page outline. Loads the CSS, the Supabase client and `js/main.js`, plus the icon, splash-screen and "install" tags. |
| `manifest.webmanifest` | Name, icon and colours used when the app is added to a home screen. |
| `sw.js` | The service worker: keeps a copy of the app on the device so it opens offline, and offers updates. |
| `icons/` | App icons and iPhone splash screens (made by `tools/make-icons.mjs`). |
| `vendor/` | A pinned copy of the Supabase client (2.45.4, from npm), so the app doesn't depend on a CDN. |
| `tools/` | Small helper scripts you run by hand (see "Changing the app" below). Not a build step. |
| `css/app.css` | All the styling (colours, light/dark mode, layout). |
| `js/config.js` | The Supabase URL and the public anon key. Never put the service_role key here. |
| `js/model/` | **The money maths.** No page code, so it can be tested on its own. |
| `js/model/periods.js` | Weekly / fortnightly / monthly maths. Everything is worked out per year first. |
| `js/model/schema.js` | The shape of a budget (version 4): people, accounts, goals… |
| `js/model/migrate.js` | Converts older saved budgets (version 3, "Jarden + Madi") to version 4. |
| `js/model/calc.js` | Every calculation: allocation, goal roll-over, sinking funds, 27-pay years, investments. |
| `js/model/onboarding.js` | The setup guide's thinking: turns answers into a suggested split and a ready-made budget. |
| `js/sync/ops.js` | "Save per change": works out the small list of changes to send. |
| `js/sync/store.js` | Saving, live updates and merging other people's changes. |
| `js/ui/` | The screens. `views/` has one file per tab; `onboarding.js` is the setup guide, `tour.js` the guided tour, `settings.js` the account and household settings. |
| `supabase/migrations/` | Every database change, in order. `…_baseline.sql` is a record of how things were before. |
| `tests/` | Automated tests (see below). |
| `.github/workflows/tests.yml` | Runs all the tests on every push. |
| `.github/workflows/keep-alive.yml` | Pings the database every 3 days so the free project doesn't pause. |

## Look and feel (UI phase 1)

- **Design tokens** live at the top of `css/app.css`: colours (light and dark), spacing (`--sp-*`), type sizes
  (`--fs-*`), corner radii and motion. Use them rather than raw values. Headings use the system's rounded font.
- **Three kinds of colour, kept apart:**
  - the *accent* (`--accent*`): each person's own choice, used for buttons, the selected tab, links and focus;
  - *member colours* (`--c-blue` etc., `.pc-*`): one per person in the budget, used in charts and contributions;
  - *status* and *chart* colours (`--ok`, `--warn`, `--bad`, `--joint`, `--invest`): never change with the accent.
- **Accent colours** (Mint, Ocean, Lavender, Coral, Rose, Amber) are in `js/ui/accent-list.js` and `css/app.css`.
  Each person picks theirs in Account settings. It's saved on their login (Supabase Auth `user_metadata.accent`),
  so it follows them across devices and never affects anyone else. A copy is kept on the device under their user
  id for a quick start. `tests/accent.test.js` checks every accent is readable in light and dark mode.
- **Budget tab**: compact cards and rows; tapping a person or an allocation opens an editing sheet
  (`js/ui/budget-sheets.js`) with the same boxes as before, so saving, history and undo work unchanged.
  `tests/browser/budget-ui.test.js` checks every figure matches what the old screen showed
  (`tests/browser/budget-baseline.json`).

### Spending tab (UI phase 2)

- One summary card (planned vs budget, with "remaining" / "over budget" / "on budget" / "no budget yet"),
  a bar by expense type with a line where the budget ends when it's over, then the expenses grouped as
  Fixed, Flexible and Sinking. Tapping one opens the expense sheet (the same `data-l="sp"` boxes as before).
- Expense type colours are `--cat-fixed`, `--cat-flex` and `--cat-sink`; they never follow the accent.
- Sinking-fund tracking (due month, set aside, status) shows for yearly sinking bills, as it always has.
  Switching an expense's type or billing period hides those fields but keeps their values.
- "+ Add expense" (or the + on a group) opens a new expense; closing it while still blank removes it again.
  The same applies to "+ Add allocation" on the Budget tab.
- `tests/browser/spending-ui.test.js` checks every figure against `tests/browser/spending-baseline.json`,
  recorded from the old screen with a fixed date, for six situations (under, over, exactly on budget,
  no budget, no expenses, and the full test budget).

### Net worth tab (UI phase 3)

- A net worth card first (net worth, assets, what's owed, and a bar of what you own by type), then
  "Goal money in savings" (in savings / for goals / not earmarked). Goal money is a slice of the savings
  balance, never added on top of it. Then when balances were last reviewed, then the accounts.
- Accounts are grouped on screen as Cash (Operating + Savings), Investments and super, and Debt. That's
  only a heading: each account keeps its stored type, order and id. Tapping one opens the account sheet
  (the same `data-l="nw"` boxes as before): balance first, then name, type, and for savings accounts how
  much goals have earmarked and which goals they are.
- Goals still find their account by its name. Renaming an account in the sheet updates those goals, as
  before. Deleting an account that goals use says which goals; they keep their saved amounts and you
  pick another account for them on the Goals tab. Nothing is deleted with the account.
- Account type colours are `--nw-op`, `--nw-sav`, `--nw-inv`, `--nw-sup` and `--nw-debt`; they never
  follow the accent.
- `tests/browser/networth-ui.test.js` checks every figure against `tests/browser/nwgoals-baseline.json`,
  recorded from the old screen with a fixed date (the same file holds the Goals tab's figures).

### Goals tab (UI phase 3)

- A summary card first: how much is saved across goals (each goal's Saved amount, never the plan), the
  total of the targets, and what's going to each fund each period (from the Budget tab).
- Then the emergency fund, the joint goals (just "Goals" for one person) and each person's goals, as
  cards: saved of target, a progress bar, what's going to it each period and its estimate or status.
  A person's section only shows when they have goals or money going to their goals pool; "+ Add goal"
  can add to any list. Reached goals say "Reached" (not just a colour) and where their share went.
- Tapping a card opens the goal sheet (the same `data-l="ef" / "gj" / "gp:<id>"` boxes as before):
  name, target, saved, the account it's kept in (linking only; no money moves), each person's % (joint)
  or the % of the pool (personal), and the deadline. The emergency fund has no name box, % or delete;
  its share comes from the Budget tab, and its sheet keeps the months-of-cover message and the
  3- and 6-month suggested targets.
- Priority: "Reorder" swaps the cards for a numbered list with up/down buttons. Finished goals still pass
  their share down exactly as calc.js `allocGoals` decides.
- Goal icons are the goal's first letter (the emergency fund has a shield). Custom icons would need a new
  field on goals, so they're left for the personalisation phase.
- `tests/browser/goals-ui.test.js` checks every figure against `tests/browser/nwgoals-baseline.json`, plus
  edge cases, editing, add/cancel/delete, reorder, cross-tab effects, widths and viewers.

### Invest and Progress tabs (UI phase 4)

- **Invest** leads with the forecast for the years chosen (5, 10, 20 or 30), what you put in and the growth
  after fees, and the chart. Tapping, dragging or the arrow keys pick a year; its figures show under the
  chart. All of it comes from `C.inv.years` (`projectInvestments`, unchanged): choosing years or picking a
  point never recalculates or saves anything. Starting investments (Net worth) and the amount going in
  (Budget) link to their tabs. The three assumptions are adjusted in a sheet with the same saved fields.
  Milestones pick the years; the yearly breakdown (all 30 years, every column) is folded away.
- **Progress** leads with net worth today and the change since last month's snapshot, then the history
  chart: a solid dot per recorded month (the latest snapshot that month, as before), placed by date and
  joined by straight lines, and a hollow "Today" dot joined by a dashed line. 6M / 1Y ranges appear
  once there's more than six months of history; they only filter. With no snapshots there's a "journey
  starts here" card; with one, two figures and no line. Assets & debt show today with the change worded
  ("$200 less owed"); compare picks any snapshot; History lists them all. Nothing in `snapshots.js`
  changed, and nothing here writes a snapshot except "Save snapshot".
- Shared drawing: `drawGrowth` and `drawHistory` in `js/ui/charts.js`. Tests: `invest-ui.test.js`
  (every figure checked against `invest-baseline.json`, recorded from the old screen) and
  `progress-ui.test.js`.

### Personal look, item icons and polish (UI phase 5)

- **Your look** (menu → Appearance): accent colour, light/dark/auto and spacing, all personal. Saved to
  your login (`user_metadata.accent`, `.theme`, `.density`) with a per-user copy on the device
  (`mb-accent-<id>`), so it follows you across devices and two people on one device keep their own.
  Sign-out returns to the defaults. Light/dark and spacing used to be per device (`jm-budget-prefs`);
  that choice carries over to your login the first time you sign in. Only accent tokens change with your
  colour: expense/account-type, people's, status and chart-series colours never do.
- **Item icons**: goals and expenses can have an icon (`icon` on the item in the household budget, one of
  the keys in `js/ui/icons.js`). Shared with the household; only owners and editors can change it; it
  never changes a type or a figure. No icon (or an unknown one) shows the usual badge. No database change
  was needed: the budget already keeps any field on an item.
- **Cheer**: when your own edit to a goal's Saved or Target moves it past 25/50/75% or to reached (the
  usual "reached" rule), a short message and a one-off glow. Never on opening, reloading or someone
  else's change. Nothing is stored.
- **Motion**: pressed states on tappable cards, a short colour cross-fade when changing look, and all of it
  off with reduced motion. Compact spacing now applies to the redesigned screens (tap targets stay 44px+).
- Tests: `tests/browser/phase5-ui.test.js`.
- Not done (on purpose): goal colours (personal goals already use each person's colour, and a second
  colour would blur that), and a personal "show amounts per" default (that setting belongs to the
  household's budget, so changing it per person would change it for everyone).

### Phase 6 audit

The closing audit's findings, fixes and remaining items are in `docs/phase6-audit.md`. Regression tests:
`tests/phase6.test.js`, `tests/browser/phase6-ui.test.js`, and the status and people colour contrast test in
`tests/accent.test.js`.

### Sign-in and first household (Phase 7A)

- **Create household** now always ends somewhere clear:
  - It reacts to one tap at a time.
  - It checks for an existing household first (an earlier tap may have worked).
  - It confirms the new one is there, then opens the setup guide.
  - Requests that hang time out, a lost answer is checked rather than re-sent, and every outcome gets a plain message.
  - Root cause of the stuck screen: closing the empty household view also forgot who was signed in (`app.meId`), so the app looked for "nobody's" households after creating one. `closeHousehold()` now keeps that; only `teardown()` (sign-out) clears it.
- **Email codes**: after sign-up the app shows a code screen.
  - It remembers the address on this device for 24h, so a refresh keeps the screen.
  - You can paste or auto-fill the code.
  - "Send a new code" follows Supabase's own wait.
  - "Email me a sign-in code instead" signs existing accounts in with `shouldCreateUser: false`, and says the same thing whether or not the email has an account.
- **Google / Apple** buttons appear only when the project's public auth settings say they're switched on.
- **Returning from a link with an error** (expired or cancelled) shows a plain message and tidies the address bar.
- Setup steps for the dashboards: `docs/auth-setup.md`. Tests: `tests/browser/auth-7a.test.js`.

### Setup in three steps, and Moni Money (Phase 7B)

- **The app is now called Moni Money** (moni is the Māori word for money). This covers the tab title, Home Screen name, manifest, sign-in and setup.
  - Technical names are unchanged: repository, URL, Supabase project, storage keys.
  - Email template wording is done in Supabase; see `docs/auth-setup.md`.
- **Setup** (`js/ui/onboarding.js`) is three steps under one slim progress bar:
  1. **Make it yours**: just me / with someone / joining, plus a household name. This is the create-household screen in `auth.js`, using the same reliable `createHousehold()` as 7A.
  2. **Your income**: one large amount box, weekly/fortnightly/monthly, and an optional payday under "More pay details". "With someone" can add their pay (optional). Your name comes from your account and is only asked for if it's missing.
  3. **Your starting plan**: the same `suggestSplit` / `buildBudget` as before, shown as rows of % and $, with a live total and "x% left / x% over".
- **Saving.** "Your budget is ready" only appears after the save comes back from the database (or is kept offline). A failed save says so, with Try again.
- **Optional parts.**
  - "Set up later" goes in with an empty budget and saves nothing.
  - The tour is optional ("Show me around").
- **Removed from setup.** The purpose question and the savings/KiwiSaver/debts step are gone. Those balances are filled in on Net worth and Goals.
- **Existing budgets.** Setup only starts for an empty budget, and it keeps someone else's budget if they finish first.
- Tests: `tests/browser/phase7b.test.js`.

### Phone polish, menu sheet and tours for every tab (Phase 7C)

- **Setup fits the screen.** Short steps no longer scroll into empty space; long ones still scroll as normal.
  - What caused the scrolling: the sign-in area used `100vh`, which on iPhone Safari is taller than the visible screen; setup kept ~110px at the bottom for a tab bar it doesn't have; and the notch gap was added twice.
  - Now the setup screen is the visible height (`dvh`, falling back to `vh`, minus the notch and home bar). The step's button sits at the bottom when there's room.
  - On the plan step the header and "Use this plan" (with its status) stay on screen while the list scrolls.
- **Illustrations** (`js/ui/art.js`): small original SVG drawings (a jar of coins, overlapping circles, a plant, a wallet, a target, a growth line). They're coloured by the theme, so they follow light/dark and each person's accent. They only take room that's spare and are hidden on very short screens.
- **Motion.** One small set of timings is used everywhere. Steps slide between each other (View Transitions where the browser has them). The progress bar and plan bar glide. Choice cards respond and tick, and "More pay details" eases open. "Reduce motion" turns all of it off.
- **Sign-in.** The tagline wraps instead of being cut off; spacing is evened out.
- **Menus on phones are a bottom sheet** (`js/ui/dom.js`): the ⋯ menu, Fill and "Add a goal to".
  - It has a dimmed backdrop, and the page behind can't scroll, be tapped or be focused. Your scroll position is kept exactly.
  - It closes with ✕, a tap on the backdrop, Escape, or a drag down on the handle (or on the list when it's already at the top).
  - Focus goes back to the button that opened it. On wide screens it's still a small menu beside the button.
- **Guided tours for all six tabs** (`js/ui/tour.js`).
  - The first time you open a tab, a small card offers its tour ("Take a quick tour" / "Not now"). It's shown once per tab, never during setup, a sheet or menu, another tour, a save or typing, and never more than one at a time.
  - Each tour is 3–6 spotlight stops that only point things out; stops for things not on screen are skipped. Changing tab ends a tour cleanly.
  - Replay any tab's tour from ⋯ → **Guided tours**.
  - Progress is personal: it's kept on your login (`user_metadata.tours`, no new table) and on the device under your user id. The old Budget tour's "done" still counts.
- **First-use empty states** with a picture and one action: Net worth ("Start with an account"), Goals ("Create your first goal"), Progress and Investments.
- Tests: `tests/browser/phase7c.test.js`.

## How saving works

The whole budget lives in one row (`budgets.state`), but the app never overwrites it. Each edit is
sent as a tiny change, like "set `accounts → js → split → j` to 0.2", to the database function
`apply_budget_ops`. So two people editing different things at the same time both keep their changes.
If you both edit the *same* box, the later one wins for that box only. Anything that replaces the
whole budget (the version 4 upgrade, importing a file) first saves a copy in `budget_backups`.

## On phones, and offline

- On a phone the tabs move to a bar at the bottom, tables become cards, and menus slide up from the bottom as a sheet you can swipe away.
- **Add to Home Screen** (Safari's Share button on iPhone, or the install prompt on Android) gives a full-screen app with its own icon.
- The app opens without a connection. Your budget's last copy is kept on the device, and edits made offline are kept
  (even if you close the app) and sent when you're back online, merging with anyone else's changes.
- Signing out removes the budget copies from that device.

## Changing the app

After changing any file the app loads (HTML, CSS, JS, icons), run:

```bash
node tools/sw-version.mjs
```

It updates the list of files the service worker stores, and its version, so phones pick up the new version
("A new version is ready. Tap to refresh"). The tests fail if you forget. To redraw the icons and splash screens: `node tools/make-icons.mjs`.

## Progress and snapshots

The **Progress** tab charts how net worth, the cash / investments / KiwiSaver / debt mix and each goal change over time.
It's built from **snapshots**: copies of the net-worth balances and goals, saved in `budget_snapshots`.

- A scheduled database job (pg_cron, Supabase's built-in scheduler) runs daily just after midnight NZ time and saves each
  household's snapshot for the month if it doesn't have one yet. The app also asks for it when opened, as a safety net.
- Editors and owners can press **Save a snapshot now**. Only the newest 24 of those are kept per household;
  monthly snapshots (about 2 KB each) are all kept.
- Totals are worked out in the app (`js/model/snapshots.js`) with the same maths as the Net worth tab.

## History and undo

Every change to a budget is recorded in `budget_changes`: who made it, when, and each box's old and new value.

- It's written by the database itself, inside `apply_budget_ops`, so nothing can skip it (offline edits appear once they sync).
- Quick follow-ups by the same person to the same thing within 2 minutes are merged into one entry, so typing
  "4… 45… 450" shows as one change from $400 to $450.
- **Undo** (next to "Saved", or Ctrl/⌘+Z outside a text box) steps back through *your* changes from this session.
  It never overwrites a newer change by someone else; it leaves that box alone and says who changed it.
- **History** (⋯ menu) lists changes in plain language, grouped by day. From there, owners and editors can undo any
  change or restore the whole budget to how it was after an earlier change. Undo and restore are saved as new
  changes, so they can be undone too. Viewers can look but not change anything.
- The wording and the "step back" maths live in `js/model/history.js`; the database does the real undo and
  restore (`undo_budget_change`, `restore_budget_version`), and tests check both give the same answer.
- Clean-up: a nightly job (`budget-history-cleanup`) deletes history older than 90 days, keeps at most 5,000
  changes per household, and keeps the newest 20 "before a replace" backups per household.

## Reminders

Gentle, optional reminders, shown under the bell 🔔 (⋯ → Reminders to choose them). Everything is off until each
person switches it on, separately for each household: monthly balance review, yearly bill due soon or behind,
goal reached, goal deadline at risk, and allocation not at 100%.

- The rules and wording are in `js/model/reminders.js`. Each reminder has a key that decides how often it can
  repeat (monthly, once per due date, at most weekly while a problem lasts, once per goal reached).
- Every morning at about 8:30 NZ time, the database (`start_reminder_run`, via pg_cron) makes a one-time pass
  and calls the Supabase Edge Function `supabase/functions/send-reminders`. The function uses only the public
  anon key: the pass lets it fetch the budgets of people with reminders on and hand back their reminders. The
  pass works once, for 15 minutes. No secret keys are involved.
- The function runs the app's own maths: `node tools/sync-function.mjs` copies `js/model/` into it. **Run that
  after changing anything in `js/model/`** (a test fails if the copy is out of date), then redeploy the function.
- Clean-up: inbox items older than 60 days go (at most 200 per person). What's been sent is remembered for
  400 days, so a goal is never celebrated twice.
- Email reminders aren't set up; `supabase/functions/send-reminders/run.js` has notes on adding them later.

### Phone and computer notifications

- Each person turns them on per device in Reminder settings ("Notifications on this device"). Devices are saved
  in `push_subscriptions` (each person sees only their own; at most 10). Signing out turns them off on that device.
- iPhone/iPad: only in the installed app (Add to Home Screen, iOS 16.4+). Android, Windows, Mac and Linux
  browsers work directly.
- After the morning run fills inboxes, the function sends each person one notification per device for their new
  reminders (several become "3 new reminders"). Tapping it opens the right tab, or the inbox. `sw.js` shows them.
- Messages are encrypted for the device and signed (`supabase/functions/send-reminders/webpush.js`, built on the
  browser's Web Crypto, tested against the web-push standard's own example).
- **The one secret:** `VAPID_PRIVATE_KEY`, an Edge Function secret you add in the Supabase dashboard
  (Edge Functions → Secrets). Make it with `tools/make-push-keys.html`, which runs only in your browser.
  The app gets the public half from the function, so nothing else needs changing. Without the secret, reminders
  still appear under the bell; only notifications are off.

## Households and roles

One login can be in several households (switch from the ⋯ menu). In each household you're an
**owner** (everything, including managing people), an **editor** (can change the budget and invite
people) or a **viewer** (can look, but the database refuses any change). If the only owner leaves or
deletes their account, the longest-standing remaining member becomes owner. A household is only
deleted when its last person leaves.

## Running the tests

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm test                 # money maths, migration, save-per-change (no setup needed)
npm run test:sql         # database changes; needs DATABASE_URL (tests/sql/start-local-db.sh starts one)
npm run test:browser     # clicks through the app in Chromium with a fake Supabase; needs Playwright
```

The browser tests never touch the real database.

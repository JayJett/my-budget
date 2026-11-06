# My Budget

A friendly household budget **visualiser** (not a transaction tracker): enter your pay, decide what
percentage goes where, and see it as charts, goals and a 30-year investment curve.
Live at **https://jayjett.github.io/my-budget/**.

There's **no build step**. GitHub Pages serves these files exactly as they are.

## What's where

| Path | What it is |
|---|---|
| `index.html` | The page outline. Loads the CSS, the Supabase client and `js/main.js`. |
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

## How saving works

The whole budget lives in one row (`budgets.state`), but the app never overwrites it. Each edit is
sent as a tiny change, like "set `accounts → js → split → j` to 0.2", to the database function
`apply_budget_ops`. So two people editing different things at the same time both keep their changes.
If you both edit the *same* box, the later one wins for that box only. Anything that replaces the
whole budget (the version 4 upgrade, importing a file) first saves a copy in `budget_backups`.

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

# Moni Money 2.0 · Phase 11B.3

The draft starts from the live Phase 11B.2 merge, 6086889. The three Wealth sections, household setup and settings use the same Indigo tokens as Home, Budget, Expenses and Goals. The [post-merge baseline run](https://github.com/JayJett/my-budget/actions/runs/45079947239) passed before implementation.

## What the user sees

| Screen | First view | Available on demand |
| --- | --- | --- |
| Wealth Accounts | Net worth, assets and debt, and a label identifying manually entered balances. The account list shows ownership, type, balance and actionable warnings. Add account opens the existing editor. | Review dates, asset composition and goal earmarks. Account types, reordering, reconciliation, and safeguards for deleting a linked account are retained. Earmarks are already part of the balance. |
| Wealth Investments | One after-fees forecast, the 5-, 10-, 20- and 30-year chooser, a keyboard and touch chart, and Edit assumptions. | Sources, contributions, fees, growth, milestones and the yearly table. The figures come from the existing projection. |
| Wealth History | Change between the latest two recorded months when both exist. A dated trend distinguishes the hollow current-balance point. A short snapshot list offers Save snapshot and one-tap comparison. | Older snapshots, a comparison picker, current balances, asset and debt changes, and goal detail. A single record has no trend. Budget edit history is in Settings. |
| Onboarding | One task per step, visible pay labels, and a clear reason for the payday field. The completion card leads with Show me around. | Household choices, partner income, the starter split, optional accounts, suggested expenses and Open Moni Money. The existing validation and setup resume paths apply. |
| Settings | Profile and account, Household, Appearance, Notifications, Data and backups, and Help. Household identity and the user's role are visible. | Personal security and data, household appearance and roles, preview and advanced appearance controls, import/export, budget edit history and tours. Existing actions, confirmations and role checks still apply. |

## Visual comparisons

All captures use synthetic NZD figures. The approved prototype contains representative balances. The app comparison uses the same fixture before and after. The 390 px full-size review pack contains 30 matched captures in both themes.

- [Wealth Accounts, Investments and History](phase-11b3/wealth.jpg)
- [Onboarding, optional setup and completion](phase-11b3/onboarding.jpg)
- [Settings, appearance and household management](phase-11b3/settings.jpg)
- [Account editor and empty history](phase-11b3/editor-and-empty.jpg)
- [The five-tab application in light and dark](phase-11b3/five-tabs.jpg)

## Shared components and validation

- Reused the Indigo card, amount, primary and text button, disclosure, list and row components. Extended the same surfaces to first-run and sign-in views, the settings and notification drawers, editing sheets, confirmations, save feedback and view-only states.
- Wealth has one shared title and a segmented Accounts, Investments and History tablist. The arrows move focus and Enter or Space opens a section. The previous hash routes and the five primary tabs are preserved.
- Layout checks use 320, 375, 390, 430, 768 and 1280 px. They cover 150% text, longer names, large amounts, custom accent, light and dark themes, keyboard focus, modal sizing and 44 px Wealth tab targets. Existing browser checks cover first-run forms, reduced motion and smaller phone viewports.
- The numeric fixtures for Budget, Expenses, Goals, Net Worth and Investments were run on the deployed baseline and the branch. Snapshot assertions check recorded values and dates, today-versus-recorded labels, asset and debt signs, immutability, and household switching. The existing setup, private Payday Playbook, save, Undo, offline draft, preferences and isolation suites apply to the draft. The final results appear under the pull request's Checks.
- Calculation modules, preference stores, database migrations and household authorisation stay on their existing paths. The draft updates the static service-worker fingerprint. A frontend rollback should restore the verified 11B.2 presentation with a fresh fingerprint and preserve the scoped saved drafts and Phase 12A isolation.

## Manual iPhone review before approval

1. Open a private copy with a synthetic solo and shared household, in Safari and as an installed web app. Check the notch and bottom safe area at the default system size and larger text. Switch through all five tabs in Light, Dark, Auto and a custom accent.
2. Open a long-name Wealth account and edit a balance with the decimal keyboard. Check ownership, correct debt treatment and an over-earmark warning. Reconcile the review date, test an account linked to goals, and cancel its deletion confirmation.
3. Select all four Investments horizons. With VoiceOver, read the selected year and amount and inspect the assumptions sheet and table. In History, compare two saved dates and today's balance, then save a synthetic snapshot. Check the empty and one-snapshot cases.
4. Start a fresh setup. Confirm the payday field is required when regular pay is present. Resume optional accounts, try suggested expenses, then check Show me around and the secondary Open Moni Money choice.
5. Open each Settings group and check focus returns after closing. Verify a viewer can read Wealth and Household without owner controls. In an isolated review account, go offline, make a test edit, return online, then switch households. Check save feedback, draft scope and the update prompt.

Hardware Safari, installed-mode safe areas and VoiceOver still require this manual pass.

## Separate Phase 12B review

Verify deployed policy and callable-function permissions against the intended role matrix. Review scoped local drafts and notification data, restore and backup drills, release rollback, and monitoring that avoids recording budget details. Treat these as review items and verify them against the live configuration in the separate backend phase.

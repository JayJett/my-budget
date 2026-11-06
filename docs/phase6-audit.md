# Phase 6 audit (UI/UX redesign close-out)

How it was audited:
- **Automated scan.** axe-core 4.10.2 (WCAG 2.0/2.1/2.2 A and AA rules), tap-target sizes, iOS input-zoom checks, sideways overflow, clipped amounts, and NaN/undefined text. It covered 70 views: all six tabs, their edit sheets, the menu and the Appearance sheet, for a couple and for one person, in light and dark, at 320/390/768/1280px.
- **Visual review.** Screenshots of a brand-new blank budget and of the full test budget.
- **Speed.** Measurements under iPhone 13 emulation in Chromium.
- **Live database.** The Supabase security advisor (read-only).

## Findings

| # | Finding | Sev. | Area | Action | Verified |
|---|---|---|---|---|---|
| 1 | The "offline: opens with no connection" browser test failed about 1 run in 7, on main too. Cause: the "leave this page?" prompt relied on `navigator.onLine` alone, which can read "online" when there is no internet. So an offline reload could stop to ask, and on a phone a person could get a pointless prompt with their edits already kept. | P2 | Saving / CI | The prompt now also uses the app's own offline state (loaded from the device, or the last save found no connection). | 40/40 + 10/10 runs pass (was 2/14 failing). New test with `onLine` forced to true. |
| 2 | Warning chips (#A8650F on #FBEEDA) were 4.04:1. The gold person colour was 4.11:1 on white and 3.79:1 on its tint, and coral was 4.43:1 on its tint. All below AA 4.5:1. | P2 | Accessibility | Slightly darker light-mode `--warn` (#95580A), `--c-gold` (#8F6007) and `--c-coral` (#AC4F2C). | axe: 0 contrast issues; new unit test covers all status and person colours. |
| 3 | The hidden tooltip box had `role="tooltip"` with no name. | P3 | Accessibility | Made `aria-hidden` (each "?" already carries the text in its `aria-label`). The save status now has `role="status"`. | axe: 0 violations in 70 views. |
| 4 | "?" help dots were 22px; "How it works" fold-outs were 21px tall; sheet Done/✕ were 36px. | P2 | Touch | 44px touch areas (invisible padding for the dots; min-height for the rest). | Phone test measures 44px+. |
| 5 | The Budget note box was 13.6px text at tablet and desktop widths, so iPad Safari would zoom. | P3 | iPad | 16px. | Audit: no inputs under 16px. |
| 6 | The "Start your budget" card repeated on all six tabs, and its wording ("fill in the tinted fields") described the old screens. | P2 | New user | Shown on Budget only, with current wording. | New test. |
| 7 | A new blank (one-person) budget started with "Joint Spending", "Joint Goals" and "Joint Investments". | P2 | One person | New blank budgets use "Spending", "Goals" and "Investments". Existing budgets are unchanged. | Unit test. |
| 8 | Before any accounts existed, Net worth showed "Review due" and a red tab badge. | P2 | New user | No review card or warning until there's an account. | Unit and browser tests. |
| 9 | With nothing invested, Invest drew a $0 chart, $0 milestones and a table of zeros under "Nothing invested yet". | P3 | New user | Those are hidden until there is something to forecast. | Browser test. |
| 10 | Warnings for one person said "Joint spending is $x over the pool" and "committed joint costs". | P3 | One person | Wording only: "Spending is $x a fortnight over budget"; "joint" only for two or more people. No numbers or rules changed. | Unit test (couple wording kept). |
| 11 | After closing an edit sheet, keyboard focus was lost (the tab redraws). | P2 | Keyboard / screen readers | Focus returns to the card that opened it. | Browser test (Enter, Escape, Done). |
| 12 | Switching household only cleared Progress's snapshots after the new budget loaded, and sign-out didn't clear them from memory. | P3 (hardening) | Isolation | Cleared at the start of a switch and on sign-out. | Browser test: the second household shows only its own snapshot. |

## Checked and fine (no change)

- **Layout and text.** No sideways scrolling, clipped amounts, NaN or undefined text in any of the 70 views.
- **Figures.** Every figure baseline is unchanged (Budget, Spending, Net worth and Goals, Invest).
- **Secrets.** Only the public anon key is in the app; there are no secrets in the repository.
- **Database advisor.** Same notes as before, all by design:
  - Three reminder functions callable without signing in are guarded by a one-time token.
  - Functions callable when signed in check membership.
  - Two internal tables are intentionally unreachable.
  - Leaked-password protection is an optional dashboard setting.
- **Speed (emulated, not a real phone).** First open about 140 ms to load; each tab redraws in 3–7 ms (median); a colour change paints in about 15 ms; about 0.5 MB transferred.

## Left for later (product decisions, not defects)

- **Account type label.** It still reads "Joint" for a one-person budget's shared accounts. It's a real type (Joint/Personal/Investment), so renaming it for one person is a product decision.
- **No undo for item deletes.** Deleting an account, goal or expense is confirmed but has no "undo" toast. History → Undo does cover it.
- **Personal default period.** "Show amounts per" is a household setting (part of the shared budget), so it can't be personal without a change to how settings are stored.
- **Needs a real iPhone.** Safari keyboard behaviour, home-indicator and safe-area spacing, push notifications, and how the chart's drag feels.

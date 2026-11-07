# Phase 7D: quality, accessibility, reliability and regression pass

## How it was checked

| Kind of check | What |
|---|---|
| Source review | Navigation and routing (`js/ui/events.js`), menus and sheets (`js/ui/dom.js`, `budget-sheets.js`, `settings.js`), inputs (`inputs.js`, `events.js`), money maths (`js/model/*`), database rules (`supabase/migrations/*`). |
| Automated layout sweep (temporary script, not committed) | 4 households: two people, one person, three people with a long household name and a very large balance, and an empty budget. Each tab at widths 320, 360, 375, 390, 393, 414, 430, 768 and 1280. Checked for: sideways page scroll, elements wider than the screen, last content hidden under the tab bar, buttons under 40px on phones, buttons or inputs without an accessible name, and "NaN", "Infinity", "undefined" or "null" on screen. |
| axe-core 4.10 (installed in a scratch folder only, not added to the app) | Every tab at 390px, light and dark, in all 4 households. |
| Browser emulation (Chromium via Playwright) | Interaction flows, screenshots, Back button, sheets, scroll positions. **This is not a real iPhone.** |
| Supabase advisors (read-only) | Security and performance lints on the live project. Nothing was changed. |
| Automated tests | Unit, SQL (throwaway Postgres) and browser (fake Supabase). |

**Baseline before changes** (main at `838a4b2`, CI): 152 unit, 207 browser and 82 SQL tests, all passing.

## What was found

| # | Issue | Area | Severity | Cause | Resolution | Verified |
|---|---|---|---|---|---|---|
| 1 | Browser Back (or a hash change) switched tab but left an editing sheet, confirm box or the ⋯ menu open over the new tab | Navigation | P2 | Tab switches didn't close overlays | One `switchTab()` closes the sheet, confirm box and menu (sheets save as you type, so nothing is lost) | Browser test |
| 2 | Every tab switch jumped to the top, so coming back to a long tab lost your place | Navigation | P2 | `scrollTo(0)` on every switch | Each tab remembers its scroll position; tapping the tab you're already on goes to the top | Browser test |
| 3 | Editing and settings sheets (`<dialog>`) relied on `body{overflow:hidden}` only; on iPhone, touch scrolling can still move the page behind | Sheets | P2 | Only the 7C menu sheet used the touch-proof scroll lock | All dialogs use the same counted lock as the menu, and the position is kept exactly | Browser test (emulation) |
| 4 | Typing e.g. `1e400` into a money or % box saved `Infinity` | Inputs / data | P2 | `isNaN()` lets Infinity through | Only finite numbers are saved | Browser test |
| 5 | Mouse-wheel over a focused % box changed the number (desktop) | Inputs | P2 | Native `type=number` behaviour | The wheel blurs the box, so the page scrolls instead | Manual reasoning; low risk |
| 6 | Net worth "Pick a date" box overflowed the screen by 9–18px at 320–375px | Layout | P3 | Fixed-width date input | Constrained to its row | Layout sweep now clean |
| 7 | Header at ≤380px with three avatars cut the household name to "The Fe…" | Header | P3 | Avatars take the room | Avatars hidden at ≤380px (names stay in the line underneath) | Screenshot |
| 8 | Spending bar announced an empty label when nothing is planned | Accessibility | P3 | Empty `aria-label` | "Nothing planned yet" | axe |
| 9 | Unit tests ran only in NZ time | Tests | P3 | CI | Also run in UTC | CI |
| 10 | No single test that every table keeps households apart | Security tests | P2 (test gap) | Per-feature tests only | `tests/sql/isolation.test.js`: row-level security on for every table; outsiders and signed-out see nothing | SQL test |
| 11 | No end-to-end money check across all tabs at once | Finance tests | P2 (test gap) | Per-function tests only | `tests/finance-matrix.test.js`: hand-worked four-person household | Unit test, NZ / UTC / Los Angeles |

**Checked and found fine (no change needed):**
- No sideways page scrolling at any tested width or state.
- No content hidden under the tab bar.
- No NaN or undefined on screen.
- Every button and input has an accessible name.
- Help "?" icons have 44px hit areas.
- Double-tap protection on create household, snapshot, sign-in, OAuth and history actions.
- All accent colours pass AA contrast (`tests/accent.test.js`).
- Reduced motion is respected (global rule plus per-feature rules).

**Investigated, not a bug:** a test showed the page jumping to the top when a sheet opened. That was Playwright scrolling to its click target. A real tap keeps the position.

## Money maths (`tests/finance-matrix.test.js`)

The household: Ana weekly $1,000, Ben fortnightly $2,000, Cat monthly $3,000, Dee no pay. Every expected value was worked out by hand.

| Area | Result |
|---|---|
| Income | Ana $52,000, Ben $52,000, Cat $36,000 and Dee $0 a year; total $140,000. Conversions use 52, 26 and 12. |
| Allocations | Spending $42,000, emergency $7,000, joint goals $14,000, investments $7,800. Ana 100%, Ben 105% (warned) and Cat 85% (warned). No warning for Ana or for Dee, who has no pay. |
| Fair split | Shared money: Ana $28,600, Ben $26,000, Cat $16,200, total $70,800. The app correctly says "Ana covers more than their income share". |
| Spending | Pool $42,000; planned $37,180; $4,820 left. Car rego: 195 of 365 days have passed, so $417 should be aside; the app asks for $60 a fortnight over the 13 fortnights to September. Year rollover checked. |
| Net worth | Assets $59,500, debt $6,000, net $53,500. The $8,000 earmarked for goals is **not** counted twice. The snapshot gives the same net worth. |
| Goals | Holiday gets half of each person's goals money ($7,000). A goal saved past its target counts as 100% and finished. |
| Invest | Start $8,000 plus $7,800 a year at 7% minus 1% fees, compounded fortnightly. Matches the closed-form formula at years 1, 5 and 30. Zero return, a lump sum alone, and nothing at all were also checked: no NaN. |
| Progress | One snapshot: no "since last month" change is invented. Two months: the change is today minus last month, and today's balance doesn't rewrite February. |
| Edge cases | Empty or blank budget: every figure is a finite number, and there are no warnings before any pay is entered. |

**No calculation discrepancies were found. No formula was changed.**

## Household and data safety
- **Database:** no migration, no RLS change, no production data touched.
- **Isolation test:** every one of the 12 public tables has row-level security switched on. Someone in another household sees none of your rows; reminder logs and runs aren't readable by people at all. Signed-out visitors see nothing. Outsiders can't save to, rename or join another household.
- **Supabase advisors (live):**
  - Signed-in callable security-definer functions are the app's intended entry points, and each checks membership (covered by SQL tests).
  - The three `reminder_run_*` functions are gated by a one-off pass (tested).
  - *Optional, owner action:* turn on **Leaked password protection** (Authentication → Sign In / Providers → Email). Supabase may only offer this on a paid plan; check in the dashboard.
  - Performance notes (unindexed foreign keys; `auth.uid()` re-evaluated in a few policies) only matter at much larger scale. Fixing them needs a migration, so it is left for an approved later change.
- **Personal preferences:** colour and tours live on each person's login and per-user device keys (tested in 7C).

## Remaining issues (not launch-blocking)

| Priority | Issue |
|---|---|
| P2 | Real-iPhone checks still needed: Safari toolbar changes, keyboard over sheets, Home Screen app safe areas. Emulation can't confirm these. |
| P3 | With very large amounts (e.g. $98,765 a fortnight) at 320px, allocation names truncate early ("Joint Spen…"). Still readable and tappable. |
| P3 | Opening a sheet doesn't add a browser history entry, so Back on the first tab leaves the site rather than closing the sheet. Changing this interacts with hash routing; left as is. |
| P3 | Database performance lints (see above). They need an approved migration. |
| Owner | Leaked-password protection; Supabase email templates wording (from 7B). |

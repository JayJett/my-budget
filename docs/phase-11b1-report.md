# Moni Money 2.0 · Phase 11B.1

## Scope and review

Phase 11B.1 applies the approved Indigo prototype to the app shell, Home and Payday Playbook. The branch starts from secured main at 7b4f1e718b8e4421936a4f014541d08bfc254757. The rollout requires explicit approval to merge or deploy.

The before-and-after gallery in the review pack uses synthetic NZD households. It pairs the old and new Home in both themes for solo and shared cases, the Playbook in both themes, an expanded transfer, a checked instruction, the mobile tab bar and an allocation editing sheet. It also includes approved prototype frames alongside the implementation.

| Area | Implementation |
|---|---|
| Foundations and chrome | css/indigo.css adds role-based light and dark surfaces, typography with tabular amounts, spacing, cards, compact rows, button and focus styles. index.html and js/ui/render.js keep the household selector, profile, reminders and save feedback. The five-tab bottom bar keeps existing hashes, Wealth subroutes and scroll restoration. js/ui/events.js adds keyboard navigation to the tab bar. |
| Appearance | js/ui/accent-list.js, js/ui/accent.js and the existing signup entry point register Indigo. New registrations receive Indigo. Existing people keep saved theme, density and colour or their previous effective Mint default. Custom accent contrast still uses the existing palette generator. |
| Home | js/ui/views/home.js shows the next actual payday, its owner and amount. The primary action opens that exact person's Playbook. Shared households see the later date with its amount accessible in one tap. There is no combined payday. Expenses and allocation status stay distinct. Expense coverage expands to its original values and the existing adjustment action. The four financial tiles and allocation meter leave Home. Existing account, goal and investment workflows are available in their own tabs. |
| Playbook | js/ui/payday.js shows a mobile detail view with the selected person, pay date, pay and source. Visual groups replace repeated instruction verbs. Combined transfers retain their breakdown and stay open through checklist updates. The checklist is private, supports a kept plan and replan, and never writes budget operations. Scope checks retain the active store guard on all asynchronous actions. |
| Installed app | tools/sw-version.mjs includes the new CSS in the offline cache. sw.js has a regenerated fingerprint. |

## Prototype comparison

The Home order, figure scale, card tint, action prominence, later-payday treatment and tab bar follow Indigo. The app retains real household and profile avatars and the existing sync indicator. The covered and fully allocated rows can show different states at the same time.

The Playbook follows the proposed person picker, pay summary and instruction groups. It uses expandable inline transfer details, the existing real fit and ownership warnings, and a direct way to link an unmatched destination after a plan has destinations. The actual preview exposes those production-only states because the model and permissions drive the display. Unscoped routes such as Budget retain their existing presentation in this slice.

## Validation and limits

- The existing calculation, browser and database suites remain the release checks. The Budget, Expenses, investments, net-worth and goals numerical baseline fixtures are unchanged.
- New browser assertions cover missing pay and dates, independent expense and allocation warnings, shared paydays, private checklists, focus and disclosure persistence, compact layouts, custom accents and 200% base text size.
- Chromium validation covers 320, 375, 390, 430, 768 and 1280 px, light and dark. Both keyboard and text contrast checks are covered by the automated review. Hardware safe areas and VoiceOver still require iPhone review.
- The visual changes leave the calculation model, household store, migration files and production records outside the diff. The default scope for a Playbook opened from a reminder or Budget is preserved.
- Draft deployment remains separate. If a released build needs rollback, use a verified frontend retaining the Phase 12A isolation fix and issue a new service-worker version. Preserve existing scoped drafts.

- The desktop Expenses summary no longer sticks over Reorder when the expenses list shares its column with the summary. Expenses calculations and editing stay on their existing paths.

## Manual iPhone review

1. Use a private review server from the branch with a synthetic fixture or sandbox account for both solo and shared households. Open it in Safari and add the review copy to the Home Screen. Check both in portrait at default and largest useful text sizes.
2. Open Home. Verify top and bottom safe areas, the five tab names, the household switcher, the account menu and reminders. Compare the date and amount on Home with the person selected in the Playbook.
3. Open the later payday. Verify its date and actual amount. Return to Home using the Playbook header, and verify that an editor and a view-only user get the appropriate actions.
4. In the linked synthetic member's Playbook, expand a shared transfer, mark an item, close and reopen. Confirm that progress persists, amount totals stay stable and another household member's checklist remains private.
5. Turn on VoiceOver. Read the payday amount and date in order, move through the tabs, open the modal, expand the transfer and check that progress is announced. Escape or close should restore focus. Check Light, Dark, System and a custom accent.
6. After a successful online load, use Airplane Mode on the review copy. Check the offline indicator and unavailable checklist, then reconnect. Switch households and confirm the previous household's values do not appear. Test the review application's update prompt with a synthetic pending draft.

## Recommended Phase 11B.2

Carry these components into Budget, Expenses and Goals. Put Rebalance directly in the Budget header and keep per-person percentages and destinations inside an allocation row. Keep the expense period and billing cadence clear, preserve optional suggestions, and add the Goals empty state. Re-run the existing numerical baselines and the household switching and failed-save regression cases. Submit this as a separate approval-gated pull request.

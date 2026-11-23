# Phase 12B.2 H6 · Household Settings isolation

Base `ba5bbd334f31087e4b1cf40ffbac7579afd376c8` on `main`, including Phase 12A (PR #33) and Indigo phases 11B.1–11B.3 (PRs #34–36).

## Root cause and correction

The Settings dialog is reused across screens. A household read or write could outlive that dialog, and some handlers then used the currently selected household or rendered into whatever sheet occupied the dialog. Household appearance could also queue a new write behind an old request without binding the queue to the original view.

Each Settings sheet now owns its original user, authenticated session, household store, role and dialog body. Closing or replacing that body, changing household, signing out or entering a different session retires the context. Normal token refresh retains the same session ID. Requests reuse the Phase 12A pattern of pinning the bearer and household, and check the sheet both before and after looking up the token. Confirmation and response handlers check the originating sheet before dispatch or UI work. An already dispatched request can finish for its original household.

Roster and invite reads use the captured household. Roster data stays in the sheet so a delayed response cannot replace the app’s member state. A refreshed roster that reports a different role triggers a guarded household reload. Rename, invite, cancel, role change, remove, leave and create keep their current permissions and messages. Invite cancellation uses both household and invite ID. Account export uses the authenticated user’s membership list and only delivers its file if the originating view is still current. Household appearance and photo operations use the originating store and sheet, including queued choices and subsequent Storage calls. Database authorisation remains authoritative. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)

## Files

- `js/ui/settings.js` and `js/ui/settings-scope.js` bind roster, management, export and related callbacks to the sheet.
- `js/ui/auth.js` recognises a replacement session for the same user and guards Settings-initiated household reloads.
- `js/sync/store.js` exposes the existing pinned request mechanism to Settings and checks the session ID when available.
- `js/ui/household-look.js` and `js/ui/profile.js` guard deferred appearance callbacks. Household photo caches are scoped to their current user and household.
- `sw.js` refreshes the cached frontend fingerprint.
- `tests/browser/fake-supabase.js` models originally dispatched request identity and controllable replies. `tests/browser/settings-isolation.test.js` tests request targeting and visible state separately.

## Verification

- Unit and financial regression suite passed locally in Pacific/Auckland and UTC, 291 tests each.
- Browser coverage includes repeated switching, replacement sheets, all six household mutation responses, confirmation and session lookup interruption, same-user reauthentication, positive operations, permission changes, queued appearance, household creation refresh and profile data export. New cases use synthetic accounts at 320, 375, 390 and 430px. Existing Phase 12A tests cover pending budget drafts, offline edits and reconnect.
- The GitHub **Tests** workflow runs the complete Chromium suite and all migration and RLS cases against a throwaway PostgreSQL instance. See draft PR checks for results against its exact head. Production is outside the test setup.
- No calculation, financial schema, access policy, reminder infrastructure or visual design changes are part of this PR. An already accepted write can settle after its sheet closes, so navigating back can be needed to see the server outcome. If a household photo upload finishes after its sheet retires, its follow-up attachment is suppressed and an unattached object in that original household folder may remain.

## Manual mobile review and rollback

On a physical iPhone using a disposable test account, repeat the Settings workflow in Safari and the installed app, including background/foreground during an invite, then close and switch budgets during a delayed response. Sign out and back in as the same and a different user. Check that no old household data appears, a viewer sees the correct controls, and authorised actions give feedback. With VoiceOver, check heading and focus on open, leaving and returning from confirmation, and feedback on failures. Reload an installed build with an identity-scoped draft and confirm it still resumes only for the original account and household.

After explicit approval, use the ordinary reviewed merge and Pages release, then verify the exact `sw.js` fingerprint and smoke-test a synthetic household. If a rollback is needed, prefer a narrow corrective release. A reviewed revert of this PR restores the preceding frontend and its Phase 12A protection, with the H6 issue reopened. Verify service-worker activation and pending drafts after recovery. There are no database rollback steps.

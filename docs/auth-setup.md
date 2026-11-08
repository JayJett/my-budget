# Sign-in setup (Phase 7A)

The app's code for email codes, Google and Apple is in place. Three things have to be switched on in dashboards that only the project owner can open. Never paste a secret (client secret, private key) into chat or into the code; each one goes straight into the Supabase dashboard.

The app lives at **https://jayjett.github.io/my-budget/** (GitHub Pages, served from the repository root). Every sign-in link and provider comes back to that one address; the app reads the result from the part after `#`, so no extra pages or server rewrites are needed.

## 1. Supabase: where sign-in links may return (check this first)

Open supabase.com → project **my-budget** → **Authentication → URL Configuration**.

- **Site URL**: `https://jayjett.github.io/my-budget/`
- **Redirect URLs**: make sure `https://jayjett.github.io/my-budget/` is in the list. Don't add wildcards like `https://*`.

Verify: create an account with a spare email address. The link in the email should open the app and continue to "Create household".

## 2. Supabase: put a code in the emails (needed for "enter the code")

Today's emails only contain a link. To add the code, go to **Authentication → Emails → Templates**:

- **Confirm signup**: keep the link, and add a line such as:
  `<p>Or enter this code in the app: <strong>{{ .Token }}</strong></p>`
- **Magic Link** (used by "Email me a sign-in code instead"): add the same line.

Then check **Authentication → Sign In / Providers → Email**:

- "Confirm email" should be **on**.
- **Email OTP length**: the default of 6 is ideal. The app accepts 6 to 10 digits.
- **Email OTP expiration**: leave as it is. The app uses whatever Supabase decides.

Verify: sign up with a spare address, type the code from the email into the app, and you should reach "Create household".

**Email limits.** Supabase's built-in email sender only sends a handful of emails per hour, on purpose. That's fine for trying things out, but real sign-ups will need your own email service (**Authentication → Emails → SMTP Settings**). That's the email service you paused earlier. When the limit is hit, the app says "Too many attempts for now…". "Send a new code" always follows Supabase's own wait time.

## For now: Supabase's standard emails (a link, no code)

Codes in emails need the templates to include `{{ .Token }}`, and properly customising emails needs your own email service (custom SMTP). Until you have one, the app uses Supabase's **standard emails, which contain a link only**:

- After sign-up, the app says "Check your email … tap the link in it". There's no code box.
- "Email me a sign-in link instead" sends a link (existing accounts only).
- In the code this is one switch, `EMAIL_CODES = false` in `js/ui/auth.js`. The code screens are still there for later.

**What to do in Supabase** (you already did this if your emails have no code in them): go to Authentication → Emails → Templates. For **Confirm signup** and **Magic Link**, either use **Reset to default**, or delete the line you added with `{{ .Token }}`. Keep `{{ .ConfirmationURL }}`; that's the link. Save each one.

To bring codes back later: set up custom SMTP, add the `{{ .Token }}` line to both templates again, and change `EMAIL_CODES` to `true`.

## 3. Google sign-in

1. Go to **console.cloud.google.com** and create a project (or pick one).
2. Open **APIs & Services → OAuth consent screen** and set it to External. Fill in the app name and your email. Add the scopes `email`, `profile` and `openid`.
3. Open **APIs & Services → Credentials → Create credentials → OAuth client ID** and choose **Web application**.
   - **Authorised JavaScript origins**: `https://jayjett.github.io`
   - **Authorised redirect URIs**: `https://fygldnqpvmezcmhywjtn.supabase.co/auth/v1/callback`
4. Copy the **Client ID** (not secret) and the **Client secret** (**secret**).
5. In Supabase, open **Authentication → Sign In / Providers → Google**. Turn it on, paste both values, and save.

The "Continue with Google" button appears by itself. The app asks Supabase which providers are on, so there's no redeploy.

Verify on your iPhone:
- Continue with Google, then pick your account. You should come back signed in.
- Do it again and press Cancel. You should see "Sign-in was cancelled".

## 4. Apple sign-in

This needs a paid Apple Developer account. In **developer.apple.com → Certificates, Identifiers & Profiles**:

1. **Identifiers → App IDs**: create one (e.g. `io.github.jayjett.mybudget`) with **Sign in with Apple** ticked.
2. **Identifiers → Services IDs**: create one (e.g. `io.github.jayjett.mybudget.web`). This is the **Client ID**, and it isn't secret.
   - Tick Sign in with Apple, then **Configure**.
   - **Domains**: `fygldnqpvmezcmhywjtn.supabase.co`
   - **Return URLs**: `https://fygldnqpvmezcmhywjtn.supabase.co/auth/v1/callback`
3. **Keys**: create a key with Sign in with Apple and download the `.p8` file (**secret**). Note the **Key ID** and your **Team ID**.
4. In Supabase, open **Authentication → Sign In / Providers → Apple** and turn it on.
   - Enter the Services ID.
   - Supabase needs a client secret made from the `.p8` key, Team ID and Key ID. Its Apple page links to the tool that makes it.
   - That secret expires after at most 6 months, so set a reminder to renew it.

The "Continue with Apple" button then appears by itself.

Verify:
- Continue with Apple, and choose "Hide My Email". You should come back signed in.
- New people go to "Create household". Someone already in a household goes to it.

## Same person, different ways in

Supabase joins sign-in methods into one account **only when the emails match and are verified**:

- If you created your account with jarden@… and then use Google with the same Gmail address, you get the same account, households and budget.
- If you use Apple with "Hide My Email", Apple gives a different address (…@privaterelay.appleid.com). That becomes a **separate new account** with no household.
  - The app never joins accounts by guessing from email addresses.
  - For now, use the same method you signed up with.
  - A "link Apple to my account" option in Account settings would be a later, separate piece of work.

Invitations work the same way: they're accepted when someone signs in with **the email address they were invited at**. An Apple "Hide My Email" address won't match an invitation, so the inviter would need to invite that address instead.

## The database refuses duplicate households too (applied)

The app never makes a second household by accident: one tap at a time, a check for an existing household first, and if an answer is lost it checks again rather than re-sending. The database now guards this as well (migration `20261111000800_create_household_once.sql`, applied with the owner's OK):

- Requests from the same person are handled one at a time, even from two browser tabs.
- The same household name again within 2 minutes returns the household just made instead of creating another.
- A different name, or the same name later, makes a new household as before.

Tests: `tests/sql/households.test.js`.

## Moni Money in the emails (Phase 7B, owner action)

Sign-in emails are written in Supabase, not in this repository, so the new name has to be added there.

1. **Authentication → Emails → Templates**. In each template (Confirm signup, Magic Link, Reset password, Change email, Invite user), replace any mention of the old name with **Moni Money**. Keep the `{{ .Token }}` and `{{ .ConfirmationURL }}` lines exactly as they are.
   - Suggested Confirm signup subject: `Your Moni Money code`
   - Suggested Magic Link subject: `Sign in to Moni Money`
2. **Sender name** (the "From" name people see):
   - With Supabase's built-in email, the sender can't be changed.
   - Once you use your own email service (**Authentication → Emails → SMTP Settings**), set **Sender name** to `Moni Money`.

Verify: sign up with a spare address. The email subject and wording should say Moni Money, and the code should still work.

The app's own name has already changed in code: the browser tab, the Home Screen name, the install details, the sign-in screens and setup. The repository name, the web address (jayjett.github.io/my-budget), the Supabase project and all stored data keep their old names on purpose, so nothing breaks.

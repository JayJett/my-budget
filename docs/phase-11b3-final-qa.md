# Phase 11B.3 final QA

## Before and after

The comparisons use synthetic NZD data and the same viewport and text size on both sides. “Before” is the earlier Phase 11B.3 draft at `f986959`.

- [Appearance picker at 390 px and at 320 px with enlarged text](phase-11b3/polish-appearance.jpg)
- [Income setup in Light, Dark and a custom accent](phase-11b3/polish-income.jpg)
- [Account editor and investment forecast stress cases in both themes](phase-11b3/polish-wealth.jpg)

The colour grid now sizes its columns with the type instead of squeezing names. The selection tick sits in the preview area, leaving the full width for the name. The saved custom colour keeps its own swatch if another accent is selected. Onboarding distinguishes leaving income blank from entering an amount, which requires a valid payday date. Navigation and Wealth sub-tabs have room for whole labels. The account editor places less visual weight on the heading and keeps the editable balance prominent. Investment axes use higher-contrast text and compact units for very large figures, and keyboard focus stays on the selected horizon.

## Local iPhone preview

The preview serves this branch and reuses the browser-test data. It starts signed into a synthetic household. It accepts local asset requests, swaps in an in-memory backend, and restricts browser connections to the preview origin. Edits are for review. The preview runs on its own origin.

1. Get the draft branch and open a terminal in the checkout. Use Node.js 22 or newer.

   ```sh
   git clone --single-branch --branch phase-11b3-indigo-wealth-and-settings https://github.com/JayJett/my-budget.git moni-iphone-review
   cd moni-iphone-review
   ```

2. Connect the computer and iPhone to the same trusted Wi-Fi. Find the computer's local IPv4 address in its network settings. Substitute that address for the example below, and start the server. If prompted by Windows Firewall, allow access on the private network only.

   ```sh
   node tools/iphone-preview.mjs --host 192.168.1.20
   ```

3. Open the printed address in iPhone Safari for the synthetic household. Open the second address ending in `/?setup` for fresh income setup. Stop the preview with Ctrl+C when done.

### Installed app and secure-context review

For a trusted HTTPS preview, provide a certificate valid for the computer's local IP and one that the iPhone trusts. The preview command accepts a certificate and private key:

```sh
node tools/iphone-preview.mjs --host 192.168.1.20 --cert preview.pem --key preview-key.pem
```

If you already use mkcert, create those two files with `mkcert -cert-file preview.pem -key-file preview-key.pem 192.168.1.20`. Transfer and install only the public root certificate on your test iPhone, then enable full trust for it. Keep the root and server private keys on the computer. Use the printed HTTPS address, add it to the Home Screen with **Open as Web App**, and remove the test certificate profile when finished. [mkcert mobile setup](https://github.com/FiloSottile/mkcert#mobile-devices) · [Apple certificate trust instructions](https://support.apple.com/en-ie/102390) · [Apple Home Screen web app guide](https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26)

### Physical iPhone checklist

- In Safari, review all five tabs in portrait and landscape at default and enlarged page text. Confirm the bottom navigation clears the home indicator and the header clears the notch. Open Appearance in Light and Dark. Select Indigo and a custom colour, then check that the saved custom swatch remains identifiable after selecting another preset.
- Open a long-name account and check the balance editor, decimal keyboard, type options, scroll and Done button. Open the forecast, select a horizon, and move between chart points. Verify the displayed units and readout.
- In `/?setup`, continue with income blank. Go back, enter regular pay, verify a blank or future payday is rejected, then enter a valid date and continue. Check the optional expenses step and **Show me around** on completion.
- Launch the HTTPS preview from its Home Screen icon. Repeat the layout and editing checks with the browser bars gone. Verify that the app has registered its service worker before checking an offline reopen and return online. Production sync and recovery require a dedicated environment.
- Turn on VoiceOver. Confirm the accent picker announces each name and the selected state, the account sheet and fields are identifiable and focus returns when it closes, and the pay-date requirement and a validation message can be found. Verify the Investments chart readout and accessible Wealth tab names.

Physical Safari, installed mode and VoiceOver await device testing. Chromium review and GitHub checks are recorded on PR #36.

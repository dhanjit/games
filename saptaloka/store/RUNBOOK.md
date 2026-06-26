# Saptaloka → Google Play — runbook (Phases C–F)

Phase B (installable PWA: icons, service worker, manifest, privacy page) is **done
and committed**. What follows are the steps that run on external services
(PWABuilder + Play Console) and your personal Google account — they can't be
automated from the repo. Verified against current (2026) policy.

**Account type:** Personal ($25). Triggers the closed-test gate in Phase E.

---

## Phase B.5 — Deploy (gates everything)

PWABuilder reads your **live** site, so deploy Phase B first:

1. Merge branch `claude/friendly-mayer-de90d8` → `main`.
2. Cloudflare Pages auto-deploys. Verify live:
   - https://games.dhanjit.me/saptaloka/manifest.webmanifest → 3 PNG icons
   - https://games.dhanjit.me/saptaloka/sw.js → 200
   - https://games.dhanjit.me/saptaloka/privacy.html → 200
   - https://games.dhanjit.me/.well-known/assetlinks.json → 200, `application/json`
3. (Optional) Lighthouse → Installable check passes.

---

## Phase C — Build the AAB (PWABuilder, cloud, no local SDK)

1. Go to https://www.pwabuilder.com → enter `https://games.dhanjit.me/saptaloka/`.
2. Package For Stores → **Android** → **Google Play** → Generate.
3. Options to set:
   - **Package ID:** `me.dhanjit.saptaloka`  ← permanent, must match assetlinks.json
   - **App name:** `Saptaloka — Seven Worlds`   **Launcher name:** `Saptaloka`
   - **App version:** `1.0.0`   **Version code:** `1`
   - **Theme / background / nav color:** `#0b0613`
   - **Display:** standalone   **Splash:** uses manifest
   - **Signing key:** "Create new" (let PWABuilder generate one).
   - **Confirm `targetSdkVersion` ≥ 35** in the generated project (Play's hard floor).
4. Download the zip. It contains: `app-release-bundle.aab`, `app-release-signed.apk`
   (for local testing), `signing.keystore`, `signing-key-info.txt`, `assetlinks.json`.
5. **⚠️ Back up `signing.keystore` + `signing-key-info.txt` (key/store passwords +
   alias) to Infisical NOW.** Lose them → you can never update the app.

---

## Phase D — Play Console setup

1. https://play.google.com/console → pay **$25**, complete identity verification
   (2-Step + government ID). New personal accounts: expect a short manual review.
2. **Create app:** name `Saptaloka — Seven Worlds`, Game, Free, declarations.
3. **Store listing** (use `listing.md`):
   - Short + full description.
   - App icon → `store/store-icon-512.png`
   - Feature graphic → `store/feature-graphic.png`
   - Phone screenshots → **capture ≥2** (see below).
4. **App content / Policy:**
   - Privacy policy → `https://games.dhanjit.me/saptaloka/privacy.html`
   - Data safety → "no data collected or shared".
   - Content rating → IARC questionnaire (no violence/sex/profanity → Everyone).
   - Target audience → 13+ (not child-directed). Ads → No.
5. **Release > Setup > App signing:** enable **Play App Signing** (default).
6. Upload `app-release-bundle.aab` to a release (start with the closed track, Phase E).
7. **Fix assetlinks (critical):** open **Release > Setup > App signing**, copy the
   **App signing key SHA-256**. Paste it into `/.well-known/assetlinks.json`
   (replace `REPLACE_WITH_PLAY_APP_SIGNING_KEY_SHA256`). Also replace
   `REPLACE_WITH_UPLOAD_KEY_SHA256` with the **Upload key SHA-256** shown on the
   same page (lets sideloaded test APKs verify too). Commit, push, redeploy.
   Then install on a device and confirm the app opens **with no browser URL bar**.

### Capturing phone screenshots
Open `https://games.dhanjit.me/saptaloka/` on an Android phone (or Chrome DevTools
device mode, e.g. Pixel 7 / 1080×2400). Capture: (1) title screen, (2) an encounter
card mid-run, (3) the Mirror of Maya, (4) an ending screen. Need ≥2; 4 is better for
featuring. PNG/JPEG, 9:16 portrait.

---

## Phase E — The closed-test gate (personal account)

This is the long pole — start it the moment a build is uploadable.

1. **Testing > Closed testing** → create a track (e.g. "alpha"). NOT Internal —
   internal testing does **not** count toward the requirement.
2. Add **≥12 testers** (email list or a Google Group). Share the opt-in URL.
3. All 12 must **opt in and stay opted in for 14 consecutive days.** Opt-out + back
   in **resets** the counter. Track the count in the dashboard.
4. After 14 continuous days with ≥12 testers → **apply for production access**
   (Console prompts you). Manual review, typically up to ~7 days.

---

## Phase F — Launch & updates

1. On production access granted → promote the release to **Production**. Live after
   Google's standard review.
2. **Updates afterward:**
   - **Game content** (cards, balance, art) → just push to Cloudflare. The TWA serves
     the live site; no new AAB. Remember to **bump the `sw.js` CACHE version** so
     cached players get the update.
   - **App shell** (icon, name, permissions, target SDK) → rebuild in PWABuilder with a
     **higher version code**, upload a new AAB.

---

## Gotchas (verified 2026)

- assetlinks.json must be at the **domain root**, return **200 + application/json**,
  **no redirect**. Cloudflare Pages serves `.well-known/` fine.
- Target **API 35+** is enforced — a lower AAB is rejected at upload.
- `versionCode` must **strictly increase** every upload.
- applicationId + signing key are **permanent** once published.
- Monetization later: ads (web AdSense in the site) are the easy fit for a TWA; in-app
  purchases need the Digital Goods API bridge (awkward in TWA) — Capacitor would be
  friendlier if you ever go heavy on IAP.

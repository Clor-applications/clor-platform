# CLOR on phones

One web build serves every app address. Three ways onto a phone, all the same code:

| | How | Who sets it up |
|---|---|---|
| **Browser** | attendance.clor.in (HR) and attendance.clor.in/#/portal (employees). Below 768px the rail becomes a menu sheet and a bottom tab bar. | nothing |
| **Installable web app** | Each address carries its own manifest (`public/manifest-<app>.webmanifest`, picked in `index.html` by hostname) and icons (`public/icons/<app>-*.png`). Android Chrome offers *Install app*; iPhone uses *Add to Home Screen*. The service worker keeps the app shell for a start with no network. | nothing |
| **Android app (Play Store + direct APK)** | `mobile/attendance`: a Capacitor shell around a web build pinned to Attendance (`VITE_MOBILE_APP=attendance`). Built by GitHub Actions on a tag. | founder: keystore, Play Console, download bucket (below) |

iOS native wrapper: the same Capacitor project takes `npx cap add ios`; it needs a Mac with Xcode and an Apple Developer account, and is not set up yet.

## Building the Android app

Locally (needs Java 21 and the Android SDK — not on the development Mac today):

    npm run build:mobile:attendance          # web build → dist-mobile/attendance → android project
    cd mobile/attendance && npx cap open android   # Android Studio: Build → Generate signed bundle/APK

In CI (no local toolchain needed): push a tag.

    git tag attendance-v1.0.0 && git push origin attendance-v1.0.0

`.github/workflows/android-attendance.yml` builds a signed APK + AAB when the signing secrets exist (a debug APK otherwise), uploads them as the run's artifact, and publishes the APK to the download bucket when the R2 secrets exist. `versionCode` is the run number, so it always increases; `versionName` is the tag.

## One-time set-up (founder)

1. **Upload keystore** — made once, kept forever; losing it means a new Play listing.

       keytool -genkeypair -v -keystore clor-upload.jks -alias clor-upload -keyalg RSA -keysize 2048 -validity 10000

   Then in the repo's *Settings → Secrets → Actions*: `ANDROID_KEYSTORE_BASE64` (`base64 -i clor-upload.jks | pbcopy`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`clor-upload`), `ANDROID_KEY_PASSWORD`. Keep the `.jks` in the password manager, not in git (`.gitignore` refuses it).

2. **Play Console** (one-time USD 25): create the app *CLOR Attendance*, package `in.clor.attendance`. Upload the AAB from the workflow artifact to *Internal testing* first. Listing needs: the 512px icon (`public/icons/attendance-512.png`), a 1024×500 feature graphic (`public/store/attendance-feature.png`), 2–8 phone screenshots, the privacy policy URL `https://attendance.clor.in/#/legal/privacy`, a Data safety form (the app sends attendance, location when punching, and an optional selfie to CLOR's own servers in India; nothing to third parties), and a contact e-mail. Content rating: Business, no ads.

3. **Direct download** (your own site): a Cloudflare R2 bucket, e.g. `clor-downloads`, with a public custom domain `downloads.clor.in`. Secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. The workflow writes `clor-attendance-latest.apk`, a versioned copy and `clor-attendance-latest.json`; the page at `attendance.clor.in/download/` reads that JSON and turns the button on. Set CORS on the bucket to allow `https://attendance.clor.in` for the JSON read.

4. **Play Store badge** on the download page: once the listing is live, replace the "coming soon" link in `public/download/index.html` with `https://play.google.com/store/apps/details?id=in.clor.attendance`.

## What the shell does on a phone (packages/shell)

- `PHONE_QUERY` (`max-width: 767px`): the rail is not rendered; a **Menu** button in the header opens the full navigation as a sheet; a **tab bar** shows the app's `mobileTabs` (Attendance: Today, Records, Leave requests, Corrections) plus Menu.
- Page padding is 16px with room under the content for the bar; page-heading actions drop under the title.
- Dense tables hide their secondary columns (`hidden md:table-cell`) and scroll in their container for the rest.
- The employee portal keeps its own phone layout and bottom tabs.

## Next apps

Payroll and Accounting follow the same recipe: `mobileTabs` in the app manifest, `mobile/<app>` with its own `appId` (`in.clor.payroll`, `in.clor.accounting`), a copy of the workflow with the names changed, and a listing each.

# CLOR on phones

One web build serves every app address. Three ways onto a phone, all the same code:

| | How | Who sets it up |
|---|---|---|
| **Browser** | attendance.clor.in (HR) and attendance.clor.in/#/portal (employees). Below 768px the rail becomes a menu sheet and a bottom tab bar. | nothing |
| **Installable web app** | Each address carries its own manifest (`public/manifest-<app>.webmanifest`, picked in `index.html` by hostname) and icons (`public/icons/<app>-*.png`). Android Chrome offers *Install app*; iPhone uses *Add to Home Screen*. The service worker keeps the app shell for a start with no network. | nothing |
| **Android app (Play Store + direct APK)** | `mobile/attendance`: a Capacitor shell around a web build pinned to Attendance (`VITE_MOBILE_APP=attendance`). Built by GitHub Actions on a tag. | founder: keystore, Play Console, download bucket (below) |

| **iPhone / iPad app (App Store + TestFlight)** | `mobile/<app>/ios`: the same Capacitor shells with an iOS project (Swift Package Manager, no CocoaPods). Built by GitHub Actions on an `ios-<app>-v…` tag; a Simulator build always, a signed upload to App Store Connect when the Apple secrets exist. | founder: Apple Developer Program, App Store Connect records, secrets (below) |

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

3. **Direct download** (your own site): the Cloudflare Pages project `clor-downloads` (no billing, unlike R2). Secrets: `CLOUDFLARE_API_TOKEN` (dashboard → My Profile → API Tokens → Create → *Edit Cloudflare Workers* template, or custom with *Cloudflare Pages: Edit*) and `CLOUDFLARE_ACCOUNT_ID` (`75db448c3bf439d9c369e3b491e20e20`). Each release run publishes `clor-<app>-latest.apk` + `clor-<app>-latest.json` there, keeping the other apps' files; `<app>.clor.in/download/` reads the JSON and turns the button on. Optional: attach `downloads.clor.in` as a custom domain of that project and set it in the page's `download-base` meta.

4. **Play Store badge** on the download page: once the listing is live, replace the "coming soon" link in `public/download/index.html` with `https://play.google.com/store/apps/details?id=in.clor.attendance`.

## iOS (iPhone and iPad)

Each shell has an iOS project: `mobile/attendance/ios`, `mobile/payroll/ios`, `mobile/accounting/ios`. Bundle ids are the same as Android's package names: `in.clor.attendance`, `in.clor.payroll`, `in.clor.accounting`. Attendance asks for the camera (selfie punch), location (work-site check) and photos (attachments); the others for camera and photos. The texts are in each `ios/App/App/Info.plist`.

### Locally, on this Mac (Xcode 27)

    npm run build:mobile:attendance:ios          # web build → dist-mobile/attendance → ios project
    cd mobile/attendance && npx cap open ios     # Xcode: pick an iPhone simulator, press Run

Running on your own iPhone from Xcode needs only a free Apple ID (Xcode → Settings → Accounts; the app then lasts 7 days on the phone). Anything for other people needs the paid programme.

### Releases, in CI

    git tag ios-attendance-v1.0.0 && git push origin ios-attendance-v1.0.0

`.github/workflows/ios.yml` builds on a macOS runner: always a Simulator build (artifact), and, when the secrets exist, an App Store archive uploaded to App Store Connect. It then appears in TestFlight after Apple processes it; from there it goes to testers, or to App Review and the App Store. The build number is the run number; the version is the tag.

### One-time set-up (founder)

1. **Apple Developer Program** — developer.apple.com/programs, USD 99 a year. Enrol as an organisation (needs a D-U-N-S number for Clor; free, takes a few days) so the store shows the company, not a person. Note the **Team ID** (Membership page).
2. **App records** — App Store Connect → My Apps → +: *CLOR Attendance* (`in.clor.attendance`), *CLOR Payroll*, *CLOR Accounting*. Register the bundle ids first under Certificates, Identifiers & Profiles → Identifiers if they are not offered.
3. **Distribution certificate** — Xcode → Settings → Accounts → your team → Manage Certificates → + → *Apple Distribution*. Then Keychain Access → My Certificates → right-click it → Export → `.p12` with a password.
4. **App Store Connect API key** — Users and Access → Integrations → App Store Connect API → +, role *App Manager*. Download the `.p8` once; note the Key ID and the Issuer ID.
5. **Secrets** in GitHub (Settings → Secrets → Actions): `APPLE_TEAM_ID`, `IOS_DIST_CERT_P12_BASE64` (`base64 -i dist.p12 | pbcopy`), `IOS_DIST_CERT_PASSWORD`, `APPSTORE_API_KEY_ID`, `APPSTORE_API_ISSUER_ID`, `APPSTORE_API_KEY_P8_BASE64` (`base64 -i AuthKey_XXXX.p8 | pbcopy`). Keep the `.p12` and `.p8` in the password manager, not in git.
6. **Store listing** — per app: 1024×1024 icon (from `mobile/<app>/assets/icon-only.png`), iPhone 6.9" screenshots (3–10), privacy policy URL, the *App Privacy* questionnaire (same answers as Play's Data safety), age rating, support URL, and a demo login for App Review (App Review signs in; give it a test company).

App Review note: a shell that only shows a website can be refused under guideline 4.2 (minimum functionality). CLOR's apps are full products with sign-in, punching with camera and location, and offline start, which is what the guideline asks for; say so in the review notes.

## What the shell does on a phone (packages/shell)

- `PHONE_QUERY` (`max-width: 767px`): the rail is not rendered; a **Menu** button in the header opens the full navigation as a sheet; a **tab bar** shows the app's `mobileTabs` (Attendance: Today, Records, Leave requests, Corrections) plus Menu.
- Page padding is 16px with room under the content for the bar; page-heading actions drop under the title.
- Dense tables hide their secondary columns (`hidden md:table-cell`) and scroll in their container for the rest.
- The employee portal keeps its own phone layout and bottom tabs.

## The apps

| App | Package | Project | Workflow / tag | Store assets |
|---|---|---|---|---|
| Attendance | `in.clor.attendance` | `mobile/attendance` | `android-attendance.yml`, `attendance-v1.2.3` | `public/icons/attendance-512.png`, `public/store/attendance-feature.png` |
| Payroll | `in.clor.payroll` | `mobile/payroll` | `android-payroll.yml`, `payroll-v1.2.3` | `public/icons/payroll-512.png`, `public/store/payroll-feature.png` |
| Accounting | `in.clor.accounting` | `mobile/accounting` | `android-accounting.yml`, `accounting-v1.2.3` | `public/icons/accounting-512.png`, `public/store/accounting-feature.png` |

Every app shares the same four signing secrets and the same download site; the workflow writes `clor-<app>-latest.apk` and `clor-<app>-latest.json`, and `<app>.clor.in/download/` (one static page) reads the one for its hostname. Each Play listing is its own app in the Console.

Accounting draws its own screens under the platform bar (`Root` in its manifest) and carries its own phone drawer, so the shell shows no Menu button or tab bar for it.

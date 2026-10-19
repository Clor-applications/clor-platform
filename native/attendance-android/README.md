# CLOR Attendance — Android (native)

The employee app, native on Android: **Kotlin + Jetpack Compose (Material 3)**.
It replaces the web-in-a-wrapper app for employees with the few things they
need on a phone, and leaves everything else to the web.

| Tab | What it does | API (`/api/portal`) |
|---|---|---|
| Sign in | Company code + employee code + password; first time, HR's activation code | `POST /login`, `POST /activate` |
| Privacy notice | Shown until the current version is read (DPDP) | `GET /privacy-notice`, `POST /privacy-notice/read` |
| Today | Shift, one punch button (location, optional selfie), today's punches | `GET /me`, `POST /punch` |
| Attendance | Month, totals, why a day counts as it does, ask to fix a day | `GET /attendance`, `GET /attendance/explain`, `POST /corrections` |
| Leave | Balances, apply, cancel | `GET /leave`, `POST /leave`, `POST /leave/:id/cancel` |
| Approvals | Only for people with reportees: approve / decline | `GET /approvals`, `POST /approvals/:type/:id` |
| Me | Documents, my data, privacy notice, permissions, password, sign out | `GET /documents`, `GET /my-data`, `POST /password` |

The server decides everything (the time of a punch, whether it is inside a
site, what a day counts as); the app asks and shows the answer.

## Permissions

| Permission | Why | When asked |
|---|---|---|
| Location (precise) | Check a phone punch is at a work site | When Punch is pressed |
| Camera | Optional selfie with a punch | When "Add a selfie" is ticked and Punch pressed |
| Notifications (Android 13+) | Punch reminders, request decisions | "Turn on reminders" on Today |
| Storage (Android 8–9 only) | Save documents / my data to Downloads | When saving; Android 10+ needs none |

Reminders run on the phone (WorkManager, about every 30 minutes while
online): punch-in after the shift starts, punch-out an hour after it ends,
and decisions on leave and corrections. There is no push server yet.

The sign-in token is encrypted with an Android Keystore key; backups are off.

## Build

No Android tools are needed locally; GitHub Actions builds it
(`.github/workflows/android-attendance-native.yml`, "Run workflow", or a tag
`attendance-native-v1.2.3`). Locally, with JDK 17+ and the Android SDK:

    cd native/attendance-android
    gradle :app:assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
    gradle :app:testDebugUnitTest

`-PCLOR_API_BASE=https://…/api/portal` points it at another server.

Application id `in.clor.attendance.employee` (installs beside the web-based
`in.clor.attendance` while that is retired).

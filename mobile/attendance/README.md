# CLOR Attendance — Android / iOS shell

The web app, pinned to Attendance at build time, inside a Capacitor shell.
Nothing here knows what a punch is; it is the same `dist` the browser gets.

    npm run build:mobile:attendance     # from the repo root: web build + cap sync
    cd mobile/attendance && npx cap open android

Releases are built by `.github/workflows/android-attendance.yml` (tag
`attendance-v1.2.3`). See `docs/MOBILE.md` for signing, Play Console and the
download page.

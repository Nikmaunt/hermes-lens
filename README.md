# Hermes Lens

Personal Android dashboard for the Hermes self-hosted AI agent — a private,
single-user, sideloaded app that visualizes the agent's "brain": memory,
timeline, projects, people, documents, habits, briefs, agent chat, and a fast
capture inbox. Built mock-first: fully functional offline on bundled fake
data; later it connects to a small read-only JSON API on the VPS (see
[API-CONTRACT.md](API-CONTRACT.md)).

**Privacy stance:** no telemetry, no crash reporting, no push services, no
third-party network calls. Five Android permissions: `INTERNET` and
`USE_BIOMETRIC`, plus three runtime-gated ones — `READ_CALENDAR` /
`WRITE_CALENDAR` (reminder → calendar sync, local "Hermes" calendar by
default) and `RECORD_AUDIO` (voice capture through the on-device
recognizer). One system-bound service: the notification listener, active
only after you grant notification access, capturing only the apps you
allowlist. Network requests still happen only while the app is in the
foreground — captured notifications are buffered on-device and replayed
on the next open.

## Stack

React 19 + TypeScript (strict) + Vite 8 · Capacitor 8 (Android) ·
Tailwind CSS 4 · TanStack Query 5 · React Router 8 · zod 4 · vitest 4.
All versions pinned exactly in `package.json`.

## Prerequisites

- **Node.js 24 LTS** (React Router 8 needs ≥ 22.22)
- **JDK 21** (`JAVA_HOME` pointing at it)
- **Android SDK** with platform 36, build-tools 36, platform-tools
  (`ANDROID_HOME` set). Android Studio is *not* required — the Gradle wrapper
  does the build.

## Development

```bash
npm install
npm run dev        # web dev server (mock data)
npm run check      # tsc --noEmit + eslint + vitest — the quality gate
```

## Building the APK

```bash
npm run apk
# = npm run build (tsc + vite) → npx cap sync android → gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Installing on the phone

**Via USB (adb):**

1. Enable *Developer options* → *USB debugging* on the phone.
2. Plug in, accept the debugging prompt, then:

   ```bash
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

**Via file transfer:** copy `app-debug.apk` to the phone (USB file transfer,
or any private channel you trust), open it in a file manager, and allow
"install unknown apps" for that file manager when asked.

## Switching from mock data to the real VPS API

1. Implement the API from [API-CONTRACT.md](API-CONTRACT.md) on the VPS,
   reachable over your Tailscale network only.
2. In the app: **More → Settings → Data source → Agent API**.
3. Enter the base URL (e.g. `http://hermes-vps:8787`) and the bearer token.
4. That's it — the whole UI is agnostic to the data source. If the VPS is
   unreachable, every screen falls back to the last cached payload with a
   "stale since…" banner, and captures/triage/flag actions queue up and sync
   when the agent is back.

## Changing the token

Settings → Data source → Bearer token (masked; use *show* to verify). The
token is stored on-device via Capacitor Preferences, sent only in the
`Authorization` header to your configured base URL, and never logged.

## Home-screen widget

Long-press the home screen → Widgets → **Hermes Lens** shows the Today
summary (follow-ups, next deadline, inbox count). It refreshes whenever the
app itself refreshes the Today screen — `updatePeriodMillis` is 0, so the
widget never polls or drains the battery.

## App lock

Settings → Security → App lock gates the app behind fingerprint biometrics
with a 6-digit PIN fallback (stored as a salted SHA-256 hash). Memory items
marked *sensitive* additionally require a fresh biometric/PIN confirmation to
reveal, regardless of the app-lock setting.

## Project layout

```
src/schemas/        zod schemas — the API contract, types inferred from them
src/data/           DataSource interface, Mock + Api implementations,
                    offline cache, offline mutation queue, mock fixtures
src/features/       one folder per screen
src/components/     small local UI primitives (no UI kit)
src/lib/            pure logic: streaks, snooze, dates, PIN hashing
android/            Capacitor Android project + native widget and
                    notification listener (TodayWidgetProvider.java,
                    WidgetBridgePlugin.java, HermesNotificationListenerService.java)
```

## Tests

`npm test` runs the unit suite: streak math, offline queue, endpoint cache,
PIN hashing, date utilities, the fixture↔schema contract test, and a
full-app smoke test (boots the app on mock data in jsdom).

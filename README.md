# MMS Field App

React Native / Expo mobile application for MMS technicians.
Offline-first, targets rugged Android tablets, distributed via Google Play Internal Track + MDM.

---

## Architecture

```
app/                        Expo Router file-based routes
src/
  screens/                  Screen components (one per route)
  components/               Shared UI components
  db/                       SQLite schema + typed query helpers
  services/
    api.ts                  Authenticated HTTP client → on-prem API
    syncEngine.ts           Pull (API → SQLite) + Push (outbox drain)
    backgroundSync.ts       Expo background fetch task
  store/
    authStore.ts            Zustand auth state + SecureStore persistence
  hooks/
    useSync.ts              Network watcher, foreground sync trigger
    useWorkOrders.ts        SQLite read hooks + write helpers (+ outbox)
  utils/
    config.ts               API_URL env var, sync constants
    types.ts                TypeScript types mirroring API schema
    format.ts               Formatting utilities
```

---

## Quick Start (Development)

### Prerequisites
- Node.js 18+
- Expo CLI: `npm install -g expo-cli eas-cli`
- Android Studio with an emulator, or a physical Android device

### 1. Install dependencies
```bash
npm install
```

### 2. Set your API URL
Create a `.env` file in the project root:
```
EXPO_PUBLIC_API_URL=http://192.168.1.50:3001
```
Replace `192.168.1.50` with your on-prem server's LAN IP.

### 3. Run in development
```bash
npx expo start --android
```

---

## Building for Production

### First-time EAS setup
```bash
eas login
eas build:configure        # links project to EAS
```

Update `app.json`:
- Set `android.package` to your reverse-domain identifier (e.g. `com.acme.mms`)
- Replace `YOUR_EAS_PROJECT_ID` with the ID from `eas build:configure`

### Build a preview APK (for testing on physical devices)
```bash
# Set production API URL in EAS dashboard first
eas build --platform android --profile preview
```
Downloads a `.apk` you can sideload or push via MDM.

### Build for Play Store Internal Track
```bash
eas build --platform android --profile production
```
Produces a signed `.aab`. Submit with:
```bash
eas submit --platform android
```
Requires `play-store-key.json` (Google Play service account key).

### Build for MDM direct distribution
```bash
eas build --platform android --profile mdm
```
Produces a signed `.aab` you can upload to Intune / Workspace ONE directly.

---

## Environment Variables

Set in EAS Dashboard → Project → Environment Variables, or in `.env` for local dev:

| Variable | Description | Example |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | On-prem API base URL | `http://192.168.1.50:3001` |

---

## Offline Behaviour

| Scenario | Behaviour |
|---|---|
| Online on launch | Full sync: drain outbox → pull WOs → pull tasks |
| WiFi disconnects mid-session | All writes go to SQLite + outbox queue |
| WiFi reconnects | `useSync` hook detects reconnect → drains outbox → re-pulls |
| Background (app minimised) | `expo-background-fetch` drains outbox every ~30s |
| Outbox item fails with 4xx | Marked as failed with error message, skipped, rest of queue continues |
| Outbox item fails with network error | Queue drain stops, retried on next connect |

---

## MDM / Google Play Managed Distribution

1. Enrol tablets in Android Enterprise via your MDM (Intune, VMware WS1, Jamf)
2. Upload the `.aab` to Google Play Console → Internal Testing track
3. Add the managed Google account emails to the tester list
4. In MDM: add the app from Play Store (managed) and assign to device group
5. App installs silently on enrolled tablets — no user action needed
6. Future updates: bump `versionCode` in `app.json`, build + submit, MDM auto-pushes

---

## Key Decisions

- **No PWA** — rugged Android tablets need native camera (`expo-camera`), reliable background sync, and MDM-managed distribution. PWA cannot deliver all three reliably on Android.
- **Expo managed workflow** — avoids native build complexity. EAS handles signing and CI.
- **SQLite via expo-sqlite** — WAL mode, foreign keys enforced, survives app kills.
- **Outbox pattern** — writes are always local-first. Server is never a dependency for field work. Conflict policy is last-write-wins (appropriate for single-technician WOs).
- **Corporate WiFi only** — no VPN, no certificate pinning needed. API URL is a plain LAN address configured at build time.

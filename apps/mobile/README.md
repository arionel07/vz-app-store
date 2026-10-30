# Vizaje Staff Mobile

Expo Router application for the Vizaje Staff iOS/Android application.

The app uses the existing Hono API for QR activation, staff email/password
login and mobile bearer sessions. Access tokens are stored only in
`expo-secure-store`; no session data is kept in AsyncStorage or exposed to
screen components. Password login is limited server-side to active staff
accounts with a provisioned email and password; managers and administrators
continue to use the Admin web login.

Run from the repository root with `bun run --cwd apps/mobile start`.

`EXPO_PUBLIC_API_URL` is required. For the iOS Simulator use
`http://127.0.0.1:3000`, and for the Android Emulator use
`http://10.0.2.2:3000`. Local HTTP requires
`EXPO_PUBLIC_ALLOW_INSECURE_HTTP=true` and is accepted only in a development
runtime for loopback/private/LAN hosts. For a physical device, prefer a
reachable HTTPS staging origin or HTTPS tunnel; a phone cannot use the host's
localhost address. Release builds always reject HTTP.

`EXPO_PUBLIC_ACTIVATION_LINK_BASE_URL` is optional and must match the Admin
`NEXT_PUBLIC_ACTIVATION_LINK_BASE_URL` value, such as
`https://staff.example.com/activate`. HTTPS links require domain association
and native device verification; `vizaje://activate` remains the development
fallback until that configuration is complete.

The app uses the system appearance by default and includes a manual theme
selector on the Profile screen. QR camera permission is requested only after
the employee taps the scan action. Published quizzes and attempts use
the API's immutable revision IDs. Unsent answer selections are stored locally
in SecureStore per attempt and removed after a successful submission; there is
no invented draft-sync endpoint. If protected local storage is unavailable,
the app warns the employee and keeps the current selections in memory until
submission. Photo uploads and private photo history use authenticated API
requests; uploads are foreground-only and are not persisted after the app is
terminated. See [NATIVE_QA.md](./NATIVE_QA.md) for native build and manual QA
instructions.

The Home screen also opens a read-only schedule view. It requests only the
authenticated staff member's published schedule with a bounded local date
range; drafts, other employees, and unauthorized stores are never shown by
the API. Local shift times and overnight business dates come from the
server's timezone-aware schedule contract.

The Home screen also opens **Задания** without adding another bottom tab. The task flow loads only assigned occurrences, preserves server-side checklist versions, supports start/complete/submit transitions, and uploads optional or required evidence through authenticated foreground requests. Private evidence previews are downloaded to the device cache only; task tokens and storage keys are never persisted or logged.

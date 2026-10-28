# Vizaje Staff Mobile

Expo Router application for the Vizaje Staff iOS/Android application.

The app uses the existing Hono API for QR activation, staff email/password
login and mobile bearer sessions. Access tokens are stored only in
`expo-secure-store`; no session data is kept in AsyncStorage or exposed to
screen components. Password login is limited server-side to active staff
accounts with a provisioned email and password; managers and administrators
continue to use the Admin web login.

Run from the repository root with `bun run --cwd apps/mobile start`.

`EXPO_PUBLIC_API_URL` is required. Use `http://127.0.0.1:3000` for the iOS
Simulator, `http://10.0.2.2:3000` for the Android Emulator, or a reachable
HTTPS staging origin for a physical device. A phone cannot use the host's
localhost address.

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

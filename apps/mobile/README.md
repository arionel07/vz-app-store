# Vizaje Staff Mobile

Expo Router application for the Vizaje Staff iOS/Android application.

The app uses the existing Hono API for QR activation and mobile bearer
sessions. Access tokens are stored only in `expo-secure-store`; no session
data is kept in AsyncStorage or exposed to screen components.

Run from the repository root with `bun run --cwd apps/mobile start`.

The app uses the system appearance by default and includes a manual theme
selector on the Profile screen. QR camera permission is requested only after
the employee taps the scan action. Quizzes, photos, production signing and
backend features outside authentication remain deferred.

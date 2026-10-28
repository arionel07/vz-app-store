# Vizaje Staff Mobile

Expo Router foundation for the Vizaje Staff iOS/Android application.

Milestone 10.1 is visual-only: the screens use clearly marked demonstration
content and do not call the API, create sessions, request camera/gallery
permissions, or persist credentials.

Run from the repository root with `bun run --cwd apps/mobile start`.

The app uses the system appearance by default and includes a manual theme
selector on the Profile screen. Native camera, photo library, authentication,
and production signing configuration are intentionally deferred.

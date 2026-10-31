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

The Home header opens the authenticated inbox. It contains task, quiz, schedule,
photo-review and targeted announcement messages. Push permission is requested
only from the inbox, never during launch or login. Registration uses the current
mobile bearer session and stores only a device identifier in SecureStore;
logout removes that device registration. Expo push delivery also requires an
EAS project ID in `expo.extra.eas.projectId`. The inbox remains usable when
permission is denied or the provider is unavailable.

## Retail operations (M19.3)

From Home, **Операции** opens an employee flow without adding a bottom tab.
Choose one of the currently assigned active stores, then use **Акции**,
**Выкладка**, **Сообщить о проблеме**, or **Мои заявки**. Store IDs in links
are checked against the authenticated profile on every screen; the API also
enforces live membership and operation-level permissions.

Campaigns display only published work available to the employee's stores.
Employees can complete the configured action checklist, attach an optional or
required photo, add a saved note, submit, and view review status/comments and
submission history. Rejected submissions can be corrected and sent again.
Merchandising shows the reference photo separately from the employee's actual
photo, checklist, review result, note, and audit history; rejected inspections
can be resubmitted. Issues and operational requests support creation with
optional photo evidence and details/history for records reported by the
employee. Admin/manager-only transitions remain unavailable in the mobile UI.

Camera and gallery permissions are requested only after the employee taps the
corresponding action. Images are resized/converted to JPEG and constrained by
the existing upload size limit before upload. Uploads happen in the foreground;
there is no offline queue. Upload and submission requests use idempotency keys
so a retry after a lost response does not create duplicate records. Private
operation evidence is fetched through the parent-record authorization endpoint
with the current bearer session, written to a temporary cache file, and removed
when the preview is unmounted. App-owned private photo/evidence cache files are
also cleared on logout and when the selected store context changes. No storage
URLs, keys, or access tokens are written into operation records or logs.

Operation notification links resolve the target against the current employee's
authorized campaigns, inspections, issues, and requests before navigating.
The payload is never treated as authorization. Missing, stale, cross-store, or
revoked targets show a safe unavailable state. A removed membership is checked
again on refresh and private media requests; records are not persisted as an
offline cache.

Real-device QA is still required for camera/gallery permission prompts, HEIC
selection and conversion, private image preview and cache cleanup, app resume,
network loss during multipart upload, and opening operation push links on iOS
and Android. Campaign and inspection history uses the API's supported versions;
the API currently does not expose a separate employee-readable history for
every operation type. Assignment details expose a responsible-user ID but no
authorized name lookup endpoint, so the UI reports that an assignee exists
without displaying the raw ID. Campaigns, issues, and requests accept up to five
evidence photos per submission; merchandising inspections use one actual photo
per inspection, matching the API contract.

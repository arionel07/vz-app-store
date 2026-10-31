# Design QA — Vizaje Staff Linear Minimal

## Source visual truth

- Path: `/workspace/generated_images/exec-13d112b6-0513-4bb8-979f-afb1ccbf5835.png`
- Source dimensions: 1440 × 1024 px.
- Source state: light theme, Overview screen, employees workspace selected, employee inspector open.

## Implementation target

- URL: `http://127.0.0.1:3001/`
- Intended viewport: 1440 × 1024 CSS px, device scale factor 1.
- Intended state: light theme, Overview screen, first employee selected, inspector open.
- HTTP smoke check: `GET /` returned 200 and the rendered HTML contains the expected Russian navigation and demo content.

## Comparison status

The source visual was opened and inspected. The in-app browser panel was opened for the local implementation, but this environment did not expose a browser screenshot or console-inspection result to the agent. Headless Chromium could not produce a screenshot in the sandbox. Because the implementation screenshot is unavailable, a normalized full-view or focused-region comparison cannot be completed.

Required fidelity surfaces remain unverified:

- Fonts and typography: source/code intent reviewed; rendered fidelity not verified.
- Spacing and layout rhythm: source/code intent reviewed; rendered fidelity not verified.
- Colors and visual tokens: source/code intent reviewed; rendered fidelity not verified.
- Image quality and asset fidelity: no custom image assets are used in the implementation; rendered fidelity not verified.
- Copy and content: source/code intent reviewed; rendered fidelity not verified.

## Findings

- [P1] Browser-rendered implementation evidence is unavailable. A screenshot and console check are required to validate the selected 1440 × 1024 state and compare the dense table/right inspector composition.

## Comparison history

- Initial implementation: not comparable because no browser-rendered screenshot was available.

## Implementation checklist

- [x] Replaced KPI-card-heavy overview with a Linear-style workspace table and right inspector.
- [x] Added compact sidebar, global search, inline summary strip, filters, status dots, progress bars, and pagination.
- [x] Kept the light theme as the default while preserving light/dark/system switching inside the account menu.
- [x] Preserved demo-only behavior and explicit API-disabled messaging.
- [ ] Capture the browser-rendered implementation at 1440 × 1024.
- [ ] Check primary row selection, inspector tabs, filters, theme switching, and toast feedback in the browser.
- [ ] Re-run comparison after the capture.

## Follow-up polish

- Replace demo initials and generated thumbnail placeholders with real API-backed image metadata when the backend is connected.
- Reassess table density at 1280px after the first real employee/store dataset is available.

## Mobile login and QR entry QA

- Source visual truth: two inline login/QR screenshots from the user's request. Their original files are unavailable in the workspace, so no source filesystem path or reliable source-pixel metadata exists.
- Implementation screenshots: `/tmp/vz-login-qa.UW75Se/login.png`, `/tmp/vz-login-qa.UW75Se/qr.png`, and `/tmp/vz-login-qa.UW75Se/login-dark.png`.
- Viewport: 393 × 852 CSS px, device scale factor 1; each implementation capture is 393 × 852 pixels. Source dimensions/density cannot be verified; no density normalization was possible.
- State: unauthenticated; login/light, QR/light after selecting «Войти по QR-коду», and login/dark. Captures show the app viewport without native phone chrome. iOS status bar, home indicator, safe-area behavior, and device keyboard remain unverified.
- Browser: Chromium via Playwright because an in-app browser tool was unavailable. The web preview used a temporary in-memory SecureStore stub inside ignored `node_modules` only to render the unauthenticated state; it was restored immediately. Expo web logs unsupported notification API errors; this is not native-device verification.
- Full view: both login and QR states were opened and inspected. The implementation follows the hierarchy of back control, brand, title, rounded fields, blue primary action, password-help link, divider, and alternate QR/email action.
- Focused regions: input fields, password visibility control, primary/secondary actions, and scan target were inspected. A valid side-by-side source comparison could not be created because the original source images are not mounted in the workspace.
- Typography: native system sans-serif, bold centered title, neutral placeholders, and larger action labels. Exact font and baseline matching is unverified.
- Spacing: responsive safe-area-aware layout; the QR target was reduced and scan action widened after the first browser capture showed it too narrow. Post-fix evidence is at the QR screenshot path above.
- Colors: existing white/neutral and blue theme tokens in light mode; semantic dark colors retained.
- Image/brand fidelity: source contains a solid angular Vizaje mark; current screen reuses the existing outlined Lucide `Leaf` mark because no approved logo asset was found. This is a visible mismatch.
- Copy: visible labels match the Russian reference, retaining the “Email” placeholder.
- Interaction: email-to-QR transition rendered the expected QR title/actions. Authentication was not submitted.
- [P1] Replace the Leaf mark with the approved angular logo asset.
- [P2] Compare the native screen at matching crop/viewport/density and verify safe areas, keyboard, and system chrome on an iPhone simulator/device.
- Comparison history: initial QR capture showed the blue scan action only as wide as its content. The action was stretched to the content width and the scan target reduced; corrected screenshot: `/tmp/vz-login-qa.UW75Se/qr.png`. An ordinary browser URL also initially appeared as an invalid activation link; only activation-intent URLs are now parsed, with regression coverage for unrelated URLs and malformed activation links.
- [ ] Provide the approved angular logo asset.
- [ ] Re-open the inline references as local image files for normalized side-by-side comparison.
- [ ] Verify the screen on an iPhone simulator or physical device.

## Mobile profile design QA

- Source visual truth: profile reference screenshot inline in the user's latest message. The original image file is not available locally; source dimensions/density cannot be inspected.
- Implementation target: `apps/mobile/app/(tabs)/profile.tsx`, registered as the fourth Expo Router tab.
- Rendered screenshot: not captured. The profile requires an authenticated mobile session and live employee/quiz data. This environment has no authenticated test session or native simulator, and no employee/API fixtures were fabricated for visual QA.
- Viewport and density: not captured; a normalized comparison is unavailable.
- Intended state: authenticated employee, assigned store(s), quiz totals from API, Profile tab selected. Data is rendered from the current user's session and authorized API responses only.
- Full-view and focused-region comparison: blocked because no authenticated rendering or local source image is available.
- Typography and spacing: uses the existing React Native system font and responsive safe-area-aware `Screen`; compact rows, rounded store/quiz cards, grouped settings, and floating pill tab bar follow the reference's hierarchy. Pixel fidelity is unverified.
- Colors: existing semantic light/dark theme tokens. The progress fill follows text color to match the monochrome reference.
- Image/brand fidelity: reuses the current Leaf mark because no approved angular logo file exists; this differs from the reference.
- Copy and content: employee name, role, email, assigned store names/codes, quiz totals, and unread count come from authenticated app state or APIs. The API provides a submitted-attempt count, so the card says «завершено» rather than claiming all submitted attempts passed. Store addresses are not present in the shared Store contract and are not invented.
- Interactions implemented: notification navigation, quiz navigation, theme selection, profile details, store details, security/language/about information, and existing logout confirmation/revocation. Face ID remains visibly disabled because biometric login is not implemented.
- [P1] The reference's angular brand mark is replaced with the existing Leaf icon. Fix requires the approved logo asset.
- [P2] No authenticated native/browser screenshot or source-file comparison is available; verify on an iPhone simulator/device with a test account.
- [P2] Face ID is a disabled informational control, not an active biometric setting. Implementing biometric authentication is outside this visual-only change.
- Remaining: attach the original profile screenshot and approved logo, then compare matching viewport/density and test interactions with a development account on device.

final result: blocked

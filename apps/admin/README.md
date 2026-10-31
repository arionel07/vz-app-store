# Vizaje Staff Admin

Desktop-first management interface for the internal Vizaje Staff application. The Admin uses the authenticated same-origin BFF and typed shared contracts for employee/store management, quizzes, photo review, dashboard data, work schedules, retail tasks, knowledge, and the functionally accepted M19.2 Retail Operations workflows.

## Run locally

From the repository root:

```bash
bun install --frozen-lockfile
VIZAJE_API_URL=http://127.0.0.1:3000 bun run --cwd apps/admin dev -- --port 3001
```

Open `http://localhost:3001`. The visual component catalogue is available at `/design-system` in development only and is excluded from production through a server-side `notFound()` guard.

Set `NEXT_PUBLIC_ACTIVATION_LINK_BASE_URL` to the configured public HTTPS
activation page, for example `https://staff.example.com/activate`, to enable
the **Скопировать ссылку** action in the activation dialog. The value is a
public URL, not a secret, and must match the mobile
`EXPO_PUBLIC_ACTIVATION_LINK_BASE_URL` setting.

For a staff member, open the employee card and choose **Задать пароль** to
provision or reset mobile email/password access. Passwords must be at least 12
characters, are hashed by the API, and active mobile sessions are revoked
after a change. No password is returned in employee responses or sent by
email.

## Checks

```bash
bun run --cwd apps/admin typecheck
bun run --cwd apps/admin test
bun run --cwd apps/admin build
```

The UI supports light, dark, and system themes. Theme preference is local to the browser; no server-side user preference is persisted yet.

The **Расписание** section is scoped by the API to the administrator or manager's active stores. Draft periods support shift/day-off CRUD, publication, explicit revisions of published periods, and actor history. All schedule dates are interpreted in the period's IANA timezone; the current default is `Europe/Chisinau`.

The **Задания** section uses the same management scope. It creates versioned task templates and one-time assignments, lists deadlines and statuses, opens private evidence through the authenticated BFF, and checks or rejects submissions with immutable history. Recurring assignments are generated explicitly through the API; there is no hidden scheduler or notification delivery.

## Retail Operations (M19.2 Admin)

The Admin routes are `/operations/campaigns`, `/operations/merchandising`, `/operations/issues`, and `/operations/requests`. Navigation exposes them under **Операции**. These pages use real API records only; they do not provide mock production data.

| Admin screen | Backend routes used | Supported work |
| --- | --- | --- |
| Кампании | `GET/POST /api/v1/management/operations/campaigns`, campaign detail/update/publish/transition/history routes, campaign-execution review | Admin creates/edits drafts, chooses stores and existing authorized photos, publishes with confirmation, checks store execution submissions, and completes/cancels/archives only through backend transitions. |
| Выкладка | `GET /api/v1/management/operations/merchandising`, display create/update, inspection review/history | Admins and managers create/update scoped displays, select existing private reference photos, enable/disable displays, compare reference and submitted images, and approve/reject inspections with a required rejection reason. |
| Проблемы | `GET /api/v1/operations/issues`, issue detail/history, management update/priority | Scoped managers/admins assign/reassign employees, change priority with expected-current-value concurrency checking, start, resolve with notes, close, or reopen with a reason. |
| Заявки | `GET /api/v1/operations/requests`, request detail/history, management decision/update | Scoped managers/admins approve/reject, assign, start fulfillment, and complete requests. Rejection comments are mandatory. |

The explicit same-origin BFF endpoints live under `/api/admin/operations/*`; each route fixes its upstream path, validates request/response data with `@vizaje/contracts`, forwards only the session cookie and existing CSRF header, and returns authenticated responses with `private, no-store`. Private images are streamed through `/api/admin/operations/evidence/[kind]/[recordId]/[photoId]`; storage keys and public object URLs are never sent to the browser. The existing photo BFF is used for selecting/displaying already authorized reference media.

Authorization is enforced by the API, not by client-side filters: campaign definition and lifecycle actions are admin-only; campaign/inspection reviews, merchandising administration, issue management, and request decisions are limited to admin/manager roles and the manager's active store scope. Assignee candidates are drawn from existing active staff/manager records associated with the affected store. UI mutations are disabled while pending; HTTP 409 responses refresh the operation and explain that another user changed it.

Known constraints follow the current API: campaign filters are status/store (there is no campaign text-search or date-range contract); campaign completion is rejected until every targeted store's report has been checked; issues and requests are created by the employee workflows, not from the Admin; photo uploads remain in the existing photo flow. M19 Admin workflows passed browser and API acceptance. Physical-device QA and production readiness remain separate release gates.

## Reporting (M20.2 Admin)

The new `/analytics` page adds one **Аналитика** sidebar entry with internal views for **Обзор**, **Магазины**, **Сотрудники**, **Обучение**, **Фотоотчёты**, **Задания**, **Расписание**, and **Операции**. The existing dashboard at `/` and its KPI semantics are unchanged. Reporting data comes only from the M20.1 API via explicit same-origin BFF GET routes at `/api/admin/reports/{overview,time-series,stores,employees,training,photos,tasks,schedules,operations,metric-definitions}`.

Period, timezone, store, view, employee drilldown, and page parameters are URL-backed. Dates use the API's inclusive local-calendar periods in `Europe/Chisinau` by default; custom ranges are limited to 366 days. The manager's store options and all aggregate responses are obtained from the server-scoped reporting API. The BFF forwards only the HttpOnly session cookie, validates each query/response against shared Zod contracts, preserves API authorization errors, and marks authenticated results `private, no-store`. It is not a general-purpose API proxy.

The overview cards use the exact M20.1 metrics for active stores, active assigned staff, participating stores, checked-task completion, and outstanding reviews. Status breakdowns distinguish period events from current-state snapshots; planned schedule hours are not represented as attendance. Daily charts project only the API's time-series points (including the API's explicit zero-valued dates), and a table provides a text alternative. KPI explanations and denominator/history notes come from `/metric-definitions`; time-series labels follow the API response fields and source-of-truth definitions. Store comparison is limited to the API's current page and employee reporting omits email, phone, HR, and credential fields. Quiz attempts attributed to stores are non-additive across employees with multiple store memberships, as documented in [`docs/reporting-metrics.md`](../../docs/reporting-metrics.md).

The Operations view links to the four existing M19 modules rather than duplicating their management workflows. Keyboard access, labels, visible focus, loading/empty/error states, retries, and scope-keyed stale-response suppression are implemented. Automated Admin checks cover BFF session forwarding, query validation, no-store/error behavior, period boundaries, URL persistence, response/chart mapping, and stale-scope keys.

M20.3 browser acceptance passed on 2026-10-31 against the isolated local API/database: Chromium covered all eight views, Light and Dark themes, URL-persistent period/store filters, previous/next pagination, a text table for daily chart values, loading and 503 error states, keyboard filter order, 1440×1024 desktop and 768×1024 tablet layouts, and single-store manager scope including a denied cross-store filter. The tablet page had no document-level horizontal overflow and the browser reported no JavaScript errors. This is local functional/UI acceptance only—not production deployment, a production performance guarantee, or physical-device QA.

All 44 Admin tests passed, including typecheck and production build. The existing dashboard route and definitions were not changed. Metric definitions and data-attribution limitations are maintained in [`docs/reporting-metrics.md`](../../docs/reporting-metrics.md).

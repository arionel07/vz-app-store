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

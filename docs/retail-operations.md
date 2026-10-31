# Retail operations (Milestone 19)

This document describes the four store-scoped workflows implemented across
the Admin, Hono API, PostgreSQL, mobile app, and the existing notification
outbox. The feature does not add a generic workflow engine or a fifth mobile
tab.

## Workflows and state transitions

| Module | Lifecycle | Rules |
| --- | --- | --- |
| Campaigns | Campaign: `draft` → `scheduled` or `active` on publish → `completed`, `cancelled`, then `archived` where allowed. Per-store execution: `not_started` / `in_progress` / `rejected` → `submitted` → `checked` or `rejected`. | Publish chooses `scheduled` when `startsAt` is in the future, otherwise `active`. Each target store has an independent execution and append-only submissions/reviews. A rejected execution can be resubmitted as a new version. Completion requires every target store to be checked. |
| Merchandising | Display: active ↔ inactive. Inspection: `draft` → `submitted` → `checked` or `rejected`; a rejected inspection can be corrected as a new version. | Inspection snapshots retain the display name, brand, checklist, reference photo, and actual photo for that version. Inactive displays cannot receive new inspections. |
| Store issues | `open` → `in_progress` → `resolved` → `closed`; `resolved` or `closed` → `open` with a reopen reason. | Resolving requires resolution notes. Assignment and priority changes are recorded in history; priority writes include the expected current value to detect concurrent edits. |
| Operational requests | `submitted` → `approved` or `rejected`; approved → `in_progress` → `completed`. | Rejection requires a comment. Assignment, decisions, and status changes are written to immutable history. |

## Authorization

Authorization is evaluated by the API against the authenticated active
principal, current active store, and current user-store membership on each
request. Client-provided role or store scope is never trusted.

| Role | Scope and allowed work |
| --- | --- |
| Admin | Global access to active stores; creates, edits, publishes, and transitions campaigns; manages displays and reviews; manages issues and requests. |
| Manager | Management and review only for currently assigned active stores; may manage displays, issues, and requests. Campaign publication remains admin-only. A submitter cannot review their own work. |
| Staff | Published campaigns for assigned active stores; may submit campaign and merchandising evidence, create issues and requests, and read only their own issue/request records and their own inspection submissions. No management or review actions. |

Store-scoped records outside a manager's scope return `403`. Staff record
lookups deliberately return `404` for records that are not theirs, avoiding
confirmation that another employee's record exists. Missing, unrelated, or
unauthorized private evidence also returns a non-disclosing error.

## API surface

All mutations require the existing authenticated session or mobile bearer
session. Mobile issue/request submissions accept `Idempotency-Key`; campaign
and inspection submission contracts include an idempotency key.

| Module | Employee/mobile routes | Management routes |
| --- | --- | --- |
| Campaigns | `GET /api/v1/operations/campaigns`, `GET /:id`, `GET /:id/history`, `POST /:id/stores/:storeId/submit` | `GET/POST /api/v1/management/operations/campaigns`, `PATCH /:id`, `POST /:id/publish`, `POST /:id/transition`, `POST /api/v1/management/operations/campaign-executions/:id/review`, history routes |
| Merchandising | `GET /api/v1/operations/merchandising`, inspection detail/history, `POST /api/v1/operations/merchandising/displays/:id/inspections` | List/create/update displays and review inspections under `/api/v1/management/operations/merchandising/*` |
| Issues | `GET/POST /api/v1/operations/issues`, `GET /:id`, `GET /:id/history` | `PATCH /api/v1/management/operations/issues/:id`, `POST /:id/priority` |
| Requests | `GET/POST /api/v1/operations/requests`, `GET /:id`, `GET /:id/history` | `POST /api/v1/management/operations/requests/:id/decision`, `PATCH /:id` |
| Evidence | `GET /api/v1/operations/evidence/:kind/:recordId/:photoId` | Admin BFF stream: `GET /api/admin/operations/evidence/:kind/:recordId/:photoId` |

The Admin uses explicit same-origin BFF routes under
`/api/admin/operations/*`; each route fixes its upstream endpoint and validates
shared `@vizaje/contracts` schemas. The BFF forwards only the session cookie
and required CSRF header and marks authenticated responses `private, no-store`.
There is no unrestricted proxy.

Mobile operation links route to
`/operations/record/:id`. The app resolves the target against the currently
authorized API records before navigating; a notification target is not an
authorization grant.

## Private evidence

Campaign reference/evidence, inspection reference/actual photos, issue photos,
and request attachments use relational photo links with foreign keys. The
evidence endpoint verifies both the parent operation and the photo-to-parent
relationship before streaming bytes. Responses are private and non-cacheable,
include `X-Content-Type-Options: nosniff`, and never expose storage keys or
public object URLs. Admin images are streamed through the authenticated BFF;
mobile previews use the authenticated API client and temporary cache files.

## Notifications

Operation events are inserted in the same database transaction as the state
change. The existing notification consumer resolves active recipients by
store membership, filters inactive stores/users, respects the
`operationsNotifications` preference, and creates one inbox item per
recipient/event. A unique event-consumption record makes retries idempotent.
Notification targets contain only a safe operation ID and are re-authorized
by Mobile when opened.

Events include campaign publication/submission/review/completion/cancellation;
merchandising submission/review; issue creation/assignment/status changes; and
request submission/decision/assignment/completion. Automated tests consume
events locally and do not send real push notifications. Production push
delivery still depends on the existing worker/provider configuration.

## Database and deployment

- `0017_retail_operations.sql` adds campaign, merchandising, issue, request,
  evidence-link, history, and notification preference structures.
- `0018_mobile_operations_idempotency.sql` adds scoped issue/request retry
  identity and payload hashes.
- `0019_operation_employee_notes.sql` adds employee notes to campaign
  submissions and merchandising inspections.

Apply migrations through the normal Drizzle migration command during a
controlled deployment. Take the usual database backup and deploy the API before
relying on the new clients. No production deployment is part of M19.4.

Campaign timestamps are stored as instants and carry the configured IANA zone
for display and operation context. Existing work-schedule local-time validation
rejects DST gaps using runtime IANA timezone data. The repository pins Bun
1.4.4 because Bun 1.3.6's older ICU data disagrees with current tzdata for the
2026-03-29 `Europe/Chisinau` gap; the regression test uses nonexistent local
time `03:30` and is expected to reject it. Schedule business logic is unchanged.

## Testing safely

PostgreSQL suites are opt-in. Never point them at development or production
data. Create a uniquely named disposable database, confirm that it does not
already exist, verify its owner, apply migrations using that database's
explicit `DATABASE_URL`, and then run the API suite twice:

```bash
docker compose -f infra/docker-compose.yml up -d postgres
docker exec infra-postgres-1 createdb -U vizaje -O vizaje vizaje_m19_disposable
DATABASE_URL=postgres://vizaje:vizaje@127.0.0.1:5432/vizaje_m19_disposable bun run --cwd apps/api db:migrate
DATABASE_URL=postgres://vizaje:vizaje@127.0.0.1:5432/vizaje_m19_disposable RUN_INTEGRATION_TESTS=1 bun run --cwd apps/api test
```

Use a fresh unique name for each validation run. Do not drop, truncate, or
reuse any database whose ownership and disposable purpose have not been
verified. The current integration suites include service-level PostgreSQL
coverage and a real loopback HTTP acceptance scenario. Admin BFF tests are
automated separately; screenshot/browser and physical-device checks are
reported independently from API integration results.

## Mobile limits and release checks

The mobile app keeps its existing Home/Quizzes/Photos tabs; Operations is a
Home entry. Campaigns, issues, and requests support up to five selected photos
per submission; an inspection has one actual photo per current API contract.
The current upload flow is foreground-only, with idempotency for safe retries;
there is no offline upload queue. HEIC selection is converted through the
existing image-manipulation path into JPEG before upload. App-owned downloaded
photo, task, knowledge, and operations evidence cache files are cleared on
logout and selected-store context changes; stale photo-history downloads are
discarded. Native camera/gallery permissions, actual HEIC/JPEG conversion,
interruption/retry, and notification deep links still need iOS/Android device
verification.

Automated API/Admin/Mobile tests and browser acceptance do not establish
physical-device acceptance or production readiness. Production still needs
the standard database migration/backup plan, private object-storage and push
worker configuration, HTTPS endpoints, operational monitoring, and real
device QA.

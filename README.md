# Vizaje Staff

Foundation monorepo for Vizaje Staff.

## Stack

- Bun 1.4.4 + Hono + TypeScript
- PostgreSQL 16
- Drizzle ORM and Drizzle Kit
- Zod
- Bun workspaces
- Docker Compose for local PostgreSQL

## Repository layout

```text
vizaje-staff/
├── apps/
│   ├── api/          # Bun + Hono API
│   ├── admin/        # Reserved for the Next.js admin app
│   └── mobile/       # Reserved for the Expo mobile app
├── packages/
│   └── contracts/    # Shared Zod schemas and inferred API types
├── infra/
│   └── docker-compose.yml
└── README.md
```

## Prerequisites

- Bun 1.4.4 (pinned in `package.json`). This version includes current ICU timezone data required for deterministic IANA DST validation. Install from <https://bun.sh> if it is not available.
- Docker Engine with Docker Compose.

## Local setup

```bash
bun install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
docker compose -f infra/docker-compose.yml up -d postgres
bun run db:migrate
```

The API starts on `http://localhost:3000`:

```bash
bun run dev
```

Health endpoints:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/health
```

`/health` is a liveness check. `/api/v1/health` is a readiness check and verifies PostgreSQL with `SELECT 1`.

CORS origins are configured with `CORS_ALLOWED_ORIGINS` as a comma-separated list. Development defaults include the standard local Next.js origins; production requires explicit origins and rejects `*`.

The Compose PostgreSQL port is bound to `127.0.0.1` and uses development-only credentials. Never reuse those credentials in production.

## Checks

```bash
bun run typecheck
bun test
bun run build
RUN_INTEGRATION_TESTS=1 bun test
```

Database commands are run from the repository root:

```bash
bun run db:generate   # generate a migration after changing the Drizzle schema
bun run db:migrate    # apply migrations to DATABASE_URL
bun run auth:bootstrap-admin  # interactively create the first administrator
```

The project intentionally does not include Redis, a separate broker, microservices, or deployment configuration. Notifications use the PostgreSQL outbox worker described in [`docs/notifications.md`](docs/notifications.md).

Production configuration, backup/restore, reverse-proxy, S3, and reconciliation procedures are documented in [`docs/production-readiness.md`](docs/production-readiness.md). No production credentials or external S3 verification are included in this repository.

Users and Stores domain services and contracts are now available for trusted application callers. Management HTTP routes use the authenticated trusted principal resolver; client-supplied role or user ID headers are ignored.

## Work schedules

Milestone 15 adds timezone-aware employee schedules for active stores. Management users can create draft periods, add/edit/remove shifts and days off, publish a revision, create an explicit revision of a published period, and inspect actor history. Staff can read only their own current published schedule through `GET /api/v1/me/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD`.

Schedule times are entered as local wall-clock values and stored with UTC instants plus the IANA timezone snapshot (default `Europe/Chisinau`). Overnight shifts keep the starting business date. Nonexistent and ambiguous DST times are rejected. Publication and superseding revisions, mutations, and history are written transactionally with `schedule.updated` or `schedule.published` domain events. Payroll, attendance, swaps, and vacation workflows are intentionally out of scope.

## Tasks and checklists

Milestone 16 adds explicit retail tasks. Admins and managers create versioned templates or assign one-time tasks to eligible employees, stores, or roles within their scope. Employees see only their assigned occurrences in Mobile, complete independent checklist snapshots, attach private evidence when required, and submit for review. The API enforces `assigned → in_progress → submitted → checked/rejected`, requires a rejection comment, prevents self-approval, keeps immutable history, and supports explicit idempotent daily/weekly/monthly recurrence generation. Task evidence is stored separately from photo reports and is never returned as an object key or public URL. Milestone 17 adds the PostgreSQL-backed notification inbox, explicit Expo push registration, bounded outbox worker, and scoped announcements; see `docs/notifications.md` for startup and security details. Milestone 18 adds the scoped internal knowledge base with immutable Markdown revisions, private attachments, search, acknowledgements, and mobile reading; see `docs/knowledge.md`.

## Authentication

- `POST /api/v1/auth/login` authenticates active admin/manager accounts with email and password.
- `POST /api/v1/auth/logout` revokes the current browser session and requires `X-CSRF-Token`.
- `GET /api/v1/auth/me` returns the authenticated user.
- `POST /api/v1/auth/activation` creates a five-minute, one-time staff activation payload for an authorized manager.
- `POST /api/v1/auth/activation/redeem` exchanges the payload secret for a bounded mobile session.
- `POST /api/v1/auth/mobile/renew` rotates a mobile session before its maximum lifetime.
- `/api/v1/auth/sessions` lists and revokes sessions within the principal's authorization scope.

Browser sessions use HttpOnly SameSite cookies plus a separate CSRF token header. Mobile sessions use bearer tokens. Activation QR rendering remains a client responsibility; managers must verify the employee and show the QR directly to them. Passwords, session tokens, and activation secrets are never stored in plaintext or returned in browser responses.

## Quiz Engine

The quiz engine supports immutable published revisions and eight typed question formats: single choice, multiple choice, weighted choice, free text, opinion, rating, scenario, and photo answer. Revisions can run as an exam, practice, or non-scoring survey. Legacy single-choice payloads remain valid.

Authoring routes require an authenticated admin or manager:

- `POST /api/v1/management/quizzes` creates a draft.
- `GET /api/v1/management/quizzes` and `GET /api/v1/management/quizzes/:id` read drafts/current revisions.
- `PUT /api/v1/management/quizzes/:id/draft` replaces the editable revision graph, including ordered questions, options, passing score, and store assignment.
- `POST /api/v1/management/quizzes/:id/publish` validates and publishes the draft.
- `POST /api/v1/management/quizzes/:id/archive` archives the quiz.
- `GET /api/v1/management/quizzes/:id/results` returns scoped attempt results without answers or correct-option data.
- `GET /api/v1/management/quiz-reviews` lists scoped free-text/photo answers awaiting manual review.
- `POST /api/v1/management/quiz-attempts/:attemptId/questions/:questionId/review` awards a bounded manual score and records review history.

Staff routes require an authenticated active staff principal:

- `GET /api/v1/quizzes` and `GET /api/v1/quizzes/:id` list/open published quizzes available through active store memberships.
- `POST /api/v1/quizzes/:id/attempts` starts one active attempt per user and revision.
- `POST /api/v1/attempts/:id/submit` validates answers and computes the score server-side.
- `POST /api/v1/attempts/:attemptId/questions/:questionId/photo` uploads a private photo answer for the active attempt.
- `GET /api/v1/attempts` and `GET /api/v1/attempts/:id` expose only the current user's attempts.

Quiz data is split across `quizzes`, immutable `quiz_revisions`, `quiz_questions`, `quiz_options`, `quiz_assignments`, `quiz_assignment_targets`, `quiz_attempts`, `quiz_attempt_answers`, and review history tables. Publishing freezes a revision. Editing a published quiz creates the next draft revision, so prior attempts retain their exact question and option IDs. Attempt limits, availability windows, deadlines, time limits, and persisted randomization orders are enforced by the API. A new attempt cannot be started after archive, while an already-started attempt may be submitted and viewed historically; this keeps in-progress work deterministic without changing past scores.

Managers may only author selected-store quizzes inside their trusted active store scope. Global assignments are administrator-only. Staff responses never include `isCorrect`, option weights, or hidden explanations. Multiple-choice partial credit uses `floor(maxPoints * correctSelected / correctCount) - ceil(maxPoints * wrongSelected / wrongOptionCount)`, clamped to zero and the question maximum. Free-text and photo answers remain pending until an authorized reviewer awards points. Practice attempts are excluded from dashboard exam metrics; surveys do not produce a pass/fail score. Results are calculated from the published revision in a transaction protected by a row lock, and repeated submissions return the stored result.

The PostgreSQL-backed quiz integration tests are opt-in because they require the local Compose database:

```bash
docker compose -f infra/docker-compose.yml up -d postgres
bun run db:migrate
RUN_INTEGRATION_TESTS=1 bun test
```

## Retail operations

Milestone 19 adds store-scoped campaigns, merchandising inspections, maintenance
issues, and operational requests across the Admin, API, PostgreSQL, Mobile, and
notification outbox. Workflow states, API routes, role/store boundaries, private
evidence behavior, notification events, migrations, and isolated test commands
are documented in [`docs/retail-operations.md`](docs/retail-operations.md).

## Photo Uploads

Photo uploads are private and require an authenticated principal. Active staff can upload one JPEG, PNG, or WebP image to an assigned active store. Managers and staff can list/read photos within their active store scope; administrators can list/read across stores. Client-supplied user IDs and roles are never used.

- `POST /api/v1/stores/:storeId/photos` accepts one `multipart/form-data` field named `file`.
- `GET /api/v1/photos` lists photos for administrators; scoped principals must provide `storeId`.
- `GET /api/v1/stores/:storeId/photos` lists photos for an authorized store.
- `GET /api/v1/photos/:id` streams the private image after authorization.
- `DELETE /api/v1/photos/:id` permanently deletes a photo; only administrators may call it.
- `GET /api/v1/photo-reports` lists versioned reports for administrators and scoped managers; staff are restricted to their own active-store reports.
- `GET /api/v1/me/photo-reports` lists the authenticated staff member's reports with current review status and rejection comment.
- `GET /api/v1/photo-reports/:id` and `/history` return the authorized report versions and immutable transition history.
- `POST /api/v1/photo-reports/:id/check` and `/reject` are manager/admin-only, scope-checked transitions; rejection requires a comment.
- `POST /api/v1/photo-reports/:id/resubmit` accepts a corrected multipart image and creates a new pending version without overwriting prior media.

The API validates the multipart size, declared MIME type, image signature, actual decodability, maximum dimension (8192 pixels), and maximum pixel count (25 million by default). Sharp safely re-encodes accepted JPEG, PNG, and WebP images, applying EXIF orientation and dropping metadata such as GPS coordinates. Storage keys are server-generated UUID paths and are never returned to clients. Images are not stored in PostgreSQL; only metadata and the storage key are persisted. Downloads use private, non-cacheable responses and no public object URLs.

Upload retries may send an `Idempotency-Key` (up to 128 allowed characters). The key is scoped to the authenticated uploader and is bound to the store, MIME type, filename, and original bytes. Reusing it with a different payload returns `409`; concurrent retries converge on one photo record. Failed validation or storage writes do not reserve a key, so a corrected retry is safe.

Administrator deletion removes the private storage object before deleting its database metadata. A report-linked checked/rejected or multi-version photo is retained to protect review history; a single pending version can still be removed for backwards-compatible cleanup. If storage deletion fails, metadata remains and the request returns `503`; if the database delete fails after storage deletion, the metadata remains for a safe retry. Storage deletes are idempotent, so repeating the request converges to no object and no row. This is an intentionally simple retry-based consistency strategy, not a background cleanup queue.

New uploads create a `PENDING` report/version, and legacy rows are backfilled as explicitly unapproved `PENDING` versions. Review transitions write `photo.submitted`, `photo.checked`, `photo.rejected`, and `photo.resubmitted` records to `domain_events` in the same database transaction. Event payloads contain safe identifiers only; no storage keys, session tokens, or image bytes are emitted.

Development and tests use private local filesystem storage at `PHOTO_STORAGE_PATH` (default `./.data/photos`). Production startup requires `PHOTO_STORAGE_DRIVER=s3` plus the S3-compatible bucket and credentials. S3 writes request server-side AES-256 encryption. Do not commit storage credentials or reuse development credentials in production.

## Dashboard API

The dashboard endpoints require an authenticated active administrator or manager. Staff users receive `403`. Administrators can query all active stores or one active store; managers can query only their assigned active stores. An unauthorized or inactive `storeId` returns `403`.

- `GET /api/v1/dashboard/overview` returns current active employee and published quiz counts plus period-scoped completed attempts, unique participants, average score, pass rate, and uploaded photos.
- `GET /api/v1/dashboard/photos` returns period-scoped total uploads, a UTC daily series (including zero-count days), per-active-store counts, and distinct active uploaders.
- `GET /api/v1/dashboard/quizzes` returns period-scoped completed-attempt summary and paginated per-quiz summaries.

`startDate` and `endDate` must be ISO-8601 timestamps with an explicit offset. Reporting uses UTC and the half-open interval `[startDate, endDate)`. The default activity period is the previous 30 days ending at request time; explicit periods are limited to 366 days. Active employee and published quiz counts are current-state metrics and are not date-filtered. An employee is an active non-admin user assigned to an active in-scope store. A published quiz count uses the current published revision available in the scope. Completed attempts require `submitted` status and a non-draft published/archived revision; unfinished attempts are excluded. Retakes count as separate attempts, while unique participants are counted once. Historical attempts remain visible after quiz archival.

Dashboard SQL uses PostgreSQL aggregation and correlated `EXISTS` predicates for store scope. This prevents duplicate counts for users assigned to multiple stores or quizzes assigned to multiple stores. Inactive users, inactive stores, and records outside the active scope are excluded from activity metrics.

## Architecture notes

- `apps/api/src/app.ts` builds a dependency-injected Hono app, keeping HTTP behavior testable without a live database.
- `apps/api/src/db/client.ts` owns the PostgreSQL/Drizzle connection. The readiness endpoint is the first database connectivity probe.
- `apps/api/src/config/env.ts` validates runtime configuration with Zod before the server starts.
- `apps/api/src/server/shutdown.ts` closes the HTTP server and database client exactly once on termination signals.
- `packages/contracts` is the single place for API response schemas shared by future clients.
- JSON logging and a single Hono error boundary provide consistent operational output without introducing an external logging service.

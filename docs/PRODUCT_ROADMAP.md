# Vizaje Staff — Architecture Review and Product Roadmap

Status: planning document only
Reviewed branch: `upgrade/mobile-expo-sdk-58`
Reviewed commit: `df003ea7a82e11987cd628606a2ee42f4ff519fd`
Scope: architecture inventory and milestones 12–20; no product feature implementation

## 1. Executive summary

Vizaje Staff is a Bun workspace monorepo with three applications and one shared contract package:

- `apps/api`: Bun + Hono HTTP API, Drizzle ORM and PostgreSQL.
- `apps/admin`: Next.js App Router administration interface with a same-origin BFF.
- `apps/mobile`: Expo Router / React Native staff application with bearer sessions.
- `packages/contracts`: shared Zod schemas and inferred TypeScript types.

The current foundation is suitable for incremental growth. The safest direction is to keep the existing modular monolith, add domain modules behind explicit Hono route groups, keep authorization in the API domain services, and use PostgreSQL transactions for state changes. A transactional outbox can be added when the first durable domain events are needed; Redis, a broker, microservices, and a generic workflow engine are not justified by the current scale of approximately 12 stores.

The most important architectural boundaries are:

1. Authentication and authorization are separate from employee profile data.
2. Store scope is resolved from trusted server-side memberships, never from client-supplied role or store headers.
3. Published quiz revisions are immutable and historical attempts retain their revision IDs.
4. Uploaded photo metadata and private object storage are separate from the future review record and review history.
5. Photo and task reviews should share conventions for audit history and transitions, but remain domain-specific state machines.
6. Notifications should consume domain events and must not be called directly from photo, task, schedule, or quiz business logic.

## 2. Current repository findings

### 2.1 Runtime and application layout

The root `package.json` declares Bun workspaces for `apps/*` and `packages/*`. The root scripts currently target the API; Admin and Mobile expose their own typecheck, test, build/export, and validation scripts. The mobile app is on Expo SDK 58 with Expo Router, React Native, SecureStore, camera, image picker, image manipulation, and authenticated image downloads.

The API is dependency-injected in `apps/api/src/app.ts`. Hono registers explicit route modules for authentication, management, quizzes, photos, and dashboard. A single error boundary maps `DomainError` values to the shared error response contract. CORS is allowlist-based and credentials-aware.

The Admin App Router has a server-side protected layout (`requireAdminUser`) and explicit BFF routes. The BFF allowlists authentication, management, activation, quiz, photo, and dashboard upstream paths; it forwards only the browser session cookie and CSRF header. It does not expose a general upstream proxy.

Mobile uses bearer tokens, stores sessions in `expo-secure-store`, renews mobile sessions with single-flight protection, and keeps authentication and navigation guards in the app layout/auth context. It has QR activation, one-time HTTPS/custom-scheme activation payload parsing, staff email/password login, quizzes/attempts, and photo upload/history screens.

### 2.2 Database and migrations

The Drizzle schema currently contains these PostgreSQL structures:

| Area | Existing tables/types | Current purpose |
| --- | --- | --- |
| Identity | `users`, `user_role` | Names, phone, email, password hash, role, active flag |
| Organization | `stores`, `user_stores` | Store directory and many-to-many memberships |
| Sessions | `sessions`, `session_type` | Browser/mobile sessions, token hashes, expiry, revocation |
| Activation | `activation_tokens` | Five-minute, hashed, single-use staff activation secrets |
| Photos | `photos`, `photo_reports`, `photo_report_versions`, `photo_review_history`, `domain_events` | Private media plus versioned review state, immutable history, and durable review events |
| Quizzes | `quizzes`, `quiz_revisions`, `quiz_questions`, `quiz_options`, `quiz_assignments` | Draft/published/archive lifecycle, revision graph and store assignment |
| Attempts | `quiz_attempts`, `quiz_attempt_answers`, `quiz_attempt_status` | One active attempt per user/revision and server-calculated result |

There are ten Drizzle migrations (`0000`–`0009`). The employee profile and photo review migrations are additive and backfill only deterministic relationships. Schedule, task, notification/outbox, knowledge base, and operational campaign tables are still outside the implemented scope.

The existing `users` table mixes identity/contact fields with authentication state. `password_hash` is nullable, which supports activated staff accounts that do not yet have a password. API responses correctly omit the hash. `user_stores` is the existing relationship for multi-store assignment.

### 2.3 Roles and authorization

The server-side roles are `admin`, `manager`, and `staff`.

- Administrators can manage all users/stores and have network-wide store access.
- Managers can manage staff users in overlapping active store scope, can manage memberships within their own scope, can access assigned active stores, and can author selected-store quizzes. They cannot create/manage managers or admins and cannot publish global quizzes.
- Staff can access their own profile/session, assigned active stores, published quizzes available through those memberships, their own attempts, and photo upload/read operations within assigned active stores. They cannot manage users/stores, author quizzes, review photos, or view other users' data.

Authorization is enforced in domain services using a trusted principal resolved from the current session. Examples include `assertCanManageTargetUser`, `assertCanAccessAssignedStore`, `assertCanManageMembership`, and staff-only quiz/attempt checks. This is the correct security boundary; Admin visibility is not sufficient by itself.

Important current behavior to preserve:

- Browser sessions are HttpOnly, SameSite cookies with a separate CSRF token. Browser mutations require `X-CSRF-Token`.
- Mobile sessions use bearer tokens and do not use browser cookies.
- Browser sessions default to 8 hours. Mobile sessions default to 30 days and rotate until a 90-day maximum lifetime.
- Deactivated users are rejected during session authentication and active sessions are revocable.
- Login rate limiting is currently in-memory and therefore process-local.

### 2.4 Employee and store management

Existing API routes provide paginated user/store lists, search, supported filters, detail reads, create/update, active/inactive changes, and user-store assignment/removal. The Admin has real employee and store pages plus explicit BFF routes. The existing contracts include only:

- user name, phone, email, role, active flag, store IDs, created/updated timestamps;
- store name, code, active flag, created/updated timestamps.

There is no job title, profile photo, employment date, birth date, gender, employee status history, or profile-specific contract yet.

### 2.5 Quiz architecture

The existing quiz graph is already revision-oriented:

- A quiz has a lifecycle (`draft`, `published`, `archived`).
- A revision has a number, status, title, description, passing score, and assignment mode (`all` or `selected`).
- Questions have an ordered prompt and options with an `isCorrect` flag.
- Store assignment is represented by `quiz_assignments`.
- Attempts point to both `quiz_id` and immutable `revision_id`.
- Answers currently store one nullable `option_id` per question.
- Submission is protected by a row lock and is idempotent after an attempt is submitted.
- Staff contracts omit `isCorrect`; authoring contracts include it.

The current engine supports a single-choice style assessment with server-side scoring. It does not yet support multiple choice, weighted scoring, text/photo answers, survey mode, deadlines, attempt limits, randomization, manual review, individual/role assignments, or draft autosave on the server. Historical revision behavior is a strong base for the advanced engine and must not be replaced with mutable published rows.

### 2.6 Photo architecture

Staff upload one JPEG, PNG, or WebP file to an assigned active store. The API validates size, signature, decodability, dimensions, pixel count, and MIME type, normalizes the image with Sharp, strips metadata, and stores a generated object key. PostgreSQL stores only metadata and the private storage key.

Uploads support an idempotency key scoped to the uploader and payload. Reads are private and authorization-aware; image responses are non-cacheable. Local filesystem storage is used in development/tests and S3 is required for production configuration.

The `photos` table remains the private immutable media record. Milestone 13 adds a `photo_reports` parent, immutable `photo_report_versions`, `photo_review_history`, and durable `domain_events`. Legacy photos are represented as `PENDING` initial versions with an explicit historical note; they are not treated as approved. Rejected resubmissions create a new media/version row and retain prior versions. There is still no notification delivery infrastructure.

### 2.7 Admin, Mobile, and shared contracts

Admin already has pages/BFFs for overview, employees, stores, quizzes, results, and photos. The protected layout performs a server-side admin/manager check. Managers see scoped data because the API applies the scope, not because the UI hides rows.

Mobile already has screens for Home, quizzes/attempts/results, photo capture/upload/history, profile, activation, and login. It does not yet have schedules, tasks, notifications, knowledge base, review status, or expanded employee profile fields.

`packages/contracts` is the shared validation boundary. It contains auth, activation, users, stores, quizzes, photos, dashboard, and health contracts. Future modules should add explicit files and exports rather than duplicating schemas in Admin, Mobile, and API.

### 2.8 Notifications and tests

No notification provider, Expo push-token registration, in-app notification table, outbox, queue, broker, Redis integration, or announcement module exists. The repository README explicitly records that queues, microservices, and push automation are not present.

Coverage is meaningful for the existing foundation:

- API unit tests cover auth, environment validation, contracts, app/error behavior, shutdown, and photo storage.
- PostgreSQL integration tests cover auth, user/store relationships, quizzes, dashboard, and photos when the integration environment is enabled.
- Admin tests cover auth, management, quiz, media, and dashboard BFF behavior.
- Mobile tests cover API validation/errors, activation payload parsing, navigation safety, SecureStore session behavior, quiz drafts/model, photo processing/queue, and store selection.

There are no tests for the future modules described below because those modules do not exist yet.

## 3. Existing functionality versus planned functionality

| Capability | Current status | Planning consequence |
| --- | --- | --- |
| Admin/manager browser authentication | Implemented | Reuse session and CSRF boundaries |
| Staff QR/link activation | Implemented | Preserve five-minute single-use semantics |
| Staff password login | Implemented | Keep staff-only policy and mobile session format |
| Employee/store CRUD and scope | Implemented | Extend contracts and services without weakening scope |
| Quiz revisions and basic results | Implemented | Add question/assessment capabilities through new revision fields/tables |
| Private photo upload/history | Implemented | Add review aggregate/history without making old uploads public or mutable |
| Dashboard aggregates | Implemented | Extend only after event/status definitions are stable |
| Employee HR profile | Implemented | Milestone 12 is complete; profile media remains deferred |
| Photo review and resubmission | Implemented | Milestone 13 is complete on the SDK 58 upgrade branch |
| Advanced quiz engine | Implemented | Milestone 14 |
| Work schedules | Not implemented | Milestone 15 |
| Tasks/checklists | Not implemented | Milestone 16 |
| In-app/push notifications and announcements | Not implemented | Milestone 17 |
| Knowledge base | Not implemented | Milestone 18 |
| Retail operations | Not implemented | Milestone 19 |
| Advanced reporting | Not implemented | Milestone 20 |

## 4. Proposed module boundaries

Keep one deployable API and one PostgreSQL database, but separate the code by domain:

```text
apps/api/src/
  auth/                 # sessions, activation, credential policies
  domain/identity/      # trusted principal and authorization policies
  domain/employees/     # employee profile and employment metadata
  domain/stores/        # stores and memberships
  domain/photos/        # upload, private media, photo review
  domain/quizzes/       # authoring, publishing, attempts, scoring
  domain/schedules/     # shifts, publication, days off
  domain/tasks/         # task templates, assignments, submissions, review
  domain/notifications/ # notification records, preferences, delivery adapters
  domain/knowledge/     # articles, revisions, visibility, acknowledgements
  domain/operations/    # campaigns, merchandising, issues, requests
  domain/events/        # event envelope and transactional outbox
```

The domain service owns authorization, transactions, state transitions, and persistence. Hono route modules parse shared contracts and call the service. Admin BFF routes are explicit adapters, not business logic. Mobile uses the same API contracts and bearer session client.

Use shared primitives only where their semantics are genuinely the same:

- `audit_log` can record actor, action, aggregate, before/after references, and timestamp.
- `domain_events/outbox` can record durable event delivery state.
- Review history can share an audit shape, but photo and task transition validators remain separate.

Do not build a configurable universal workflow engine. It would make photo and task rules less explicit, harder to test, and harder to authorize.

## 5. Data model direction

The following is a target model for future migrations, not a request to create these tables now.

### 5.1 Employee profiles

Keep `users` as the authentication/authorization identity. Add a one-to-one `employee_profiles` table for HR and display metadata:

- `user_id` primary key and foreign key to `users`;
- `job_title` nullable;
- `employment_started_on` nullable date;
- `profile_photo_id` nullable reference to a controlled media record;
- `birth_date` nullable;
- `gender` nullable only if a documented business purpose is approved;
- profile timestamps and optional version/audit metadata.

Phone and email currently live on `users` and are required by role-specific contracts. Do not move them in the first profile migration. Decide later whether a normalized contact model is warranted. Sensitive fields must have separate response projections and must not be returned from staff list endpoints. Birth date and gender should be omitted by default from manager/mobile responses, with explicit field-level authorization and retention rules if the business confirms the need.

### 5.2 Photo reports and review history

Treat the existing `photos` row as a private media/version record, not as the complete review aggregate. Introduce a `photo_reports` parent and a `photo_report_versions` or equivalent link so a corrected upload is a new version and prior submissions remain immutable. A compatible migration can backfill one report per existing photo before enabling the new submission flow.

Minimum future fields:

- report ID, store ID, employee ID, current version ID;
- version ID, photo ID, submission number, submitted timestamp;
- review status and version (`PENDING`, `CHECKED`, `REJECTED`);
- reviewer ID, reviewed timestamp, rejection/comment text;
- transition history with actor, from/to state, comment, idempotency key, and timestamp.

If a simpler first migration adds review columns to `photos`, it must still add a separate immutable history table and a parent/report identity before allowing resubmissions. A single mutable status column is insufficient.

### 5.3 Quiz engine extensions

Preserve `quizzes`, `quiz_revisions`, and revision IDs. Add explicit fields rather than encoding all behavior in UI conventions:

- revision assessment mode: `exam`, `practice`, `survey`;
- attempt limit, deadline policy, randomization settings, and optional answer explanations;
- question type: `single_choice`, `multiple_choice`, `weighted_choice`, `free_text`, `opinion`, `rating`, `scenario`, `photo`;
- question scoring/manual-review policy;
- option weight/score data while retaining legacy correctness semantics for old revisions;
- answer payload JSON or normalized answer tables for text, ratings, multiple options, and media references;
- answer/result review status and reviewer fields for manually reviewed answers;
- explicit assignment targets for all, store, role, or individual users.

Published revisions must remain immutable. A save after publish creates the next draft revision. Attempts must retain revision ID and a server-side scoring-policy snapshot or immutable policy reference. Staff responses must never expose correct answers, weights, review metadata, or hidden scoring rules.

Existing single-choice attempts must continue to deserialize and calculate exactly as they do today. New answer formats should be additive and versioned rather than reinterpreting existing `option_id` rows.

### 5.4 Schedules

Add store-local timezone configuration only after business owners confirm each store's IANA timezone. Store it explicitly; do not infer timezone from a phone or server.

Suggested model:

- `schedule_periods`: store/scope, date range, status `DRAFT`/`PUBLISHED`, publisher and timestamps;
- `shifts`: employee, store, local business date, start/end instants, timezone snapshot, status;
- `schedule_days_off`: explicit employee/date or period entries where “no shift” is a meaningful published decision;
- `schedule_change_history`: actor, action, previous/new values, timestamp.

Accept local date/time input at the API boundary, resolve it with the store timezone, store UTC instants plus the timezone snapshot, and allow an end instant on the following local date for overnight shifts. Validate overlaps transactionally, preferably with a PostgreSQL exclusion constraint or a locked conflict query. Keep schedules separate from attendance and payroll.

### 5.5 Tasks and checklists

Use domain-specific tables:

- `task_templates` and `task_template_items` for reusable checklist definitions;
- `tasks` for a concrete occurrence, deadline, priority, recurrence metadata, and store/role/user target;
- `task_assignments` for resolved employee/store responsibility;
- `task_submissions` and `task_submission_items` for completion data;
- `task_evidence` referencing private photo records;
- `task_review_history` for manager approval/rejection and comments.

Store-scoped authorization must apply both when a task is assigned and when it is reviewed. Recurring tasks should materialize concrete occurrences with stable IDs so deadlines and audit history are not rewritten when a rule changes.

### 5.6 Notifications and announcements

Add durable in-app records, device registrations, preferences, and an outbox/delivery-attempt model. Do not put notification state only in Expo's service. Suggested entities:

- `domain_events`: aggregate event name, version, payload, actor, occurred time, dedupe key;
- `notification_outbox`: event reference, recipient, channel, status, attempts, next retry, provider ID;
- `notifications`: recipient-visible in-app record, read/acknowledged state, target deep link;
- `device_push_tokens`: user/device, Expo token, platform, last seen, invalidated time;
- `notification_preferences`: per-user/event/channel preferences;
- `announcements` and `announcement_targets` for authored content and acknowledgements.

Emit events inside the same transaction as the business state change. A later worker can deliver in-app records and Expo push messages with retries. Push payloads should contain a notification ID and safe route metadata, not employee personal data, passwords, access tokens, or photo/activation secrets.

### 5.7 Knowledge base and operations

Knowledge base should use `articles`, `article_revisions`, categories, visibility targets, attachments, and optional acknowledgements. Published revision content must be immutable and search should start with PostgreSQL full-text/trigram capabilities before introducing an external search service.

Retail operations can later add campaign definitions, store execution records, reference media, submitted evidence, maintenance issues, and internal requests. These should reference the existing store/user/media identities and reuse event/audit conventions without coupling to tasks or photos.

## 6. API and contract design

Keep explicit versioned endpoints under `/api/v1`. Every new mutable resource should have:

- a Zod request schema in `packages/contracts`;
- a Zod response schema that excludes secrets and fields outside the caller's projection;
- an explicit Hono route group;
- an Admin BFF route only for the needed upstream path;
- a domain service method that receives a trusted principal;
- consistent `401`/`403`/`404`/`409`/`422`/`429`/`503` error codes;
- transaction and idempotency behavior documented for retries.

Recommended route families:

| Module | API examples | Admin adapter | Mobile adapter |
| --- | --- | --- | --- |
| Employee profiles | `/api/v1/users/:id/profile`, `/api/v1/me/profile` | `/api/admin/employees/:id/profile` | `/api/v1/me/profile` through bearer client |
| Photo review | `/api/v1/management/photo-reports`, `/api/v1/photo-reports/:id/review` | `/api/admin/photo-reports...` | `/api/v1/photo-reports/mine` |
| Quizzes | `/api/v1/management/quizzes/...`, `/api/v1/quizzes/...` | existing explicit quiz BFF extended | existing staff quiz client extended |
| Schedules | `/api/v1/management/schedules`, `/api/v1/me/schedule` | `/api/admin/schedules...` | `/api/v1/me/schedule` |
| Tasks | `/api/v1/management/tasks`, `/api/v1/tasks/:id/submissions` | `/api/admin/tasks...` | `/api/v1/tasks...` |
| Notifications | `/api/v1/me/notifications`, `/api/v1/me/push-tokens` | `/api/admin/announcements...` | `/api/v1/me/notifications...` |
| Knowledge | `/api/v1/knowledge/articles`, `/api/v1/management/knowledge` | `/api/admin/knowledge...` | `/api/v1/knowledge...` |

Use page pagination initially to match current contracts. Add cursor pagination for high-volume notification, audit, and media-history feeds before their volume requires it. Use `Idempotency-Key` on operations that can be retried after network loss: photo submission, review transitions, task completion, schedule publication, and push-token registration where appropriate.

The BFF must continue to forward only the two browser authentication cookies needed by the API, the CSRF header for browser mutations, and the request body required by the explicit route. It must set private/no-store response headers for authenticated data and never proxy arbitrary paths or expose mobile bearer tokens.

## 7. Permission matrix

The matrix below is the target policy. The API, not the UI, must enforce it. “Scoped” means only active stores in the manager's trusted membership set, with historical access rules explicitly defined per module.

| Capability | Administrator | Manager | Staff |
| --- | --- | --- | --- |
| Manage network stores | All | No | No |
| Read active stores | All | Assigned scope | Assigned active stores |
| Manage users | All roles | Staff in overlapping scope | No |
| Manage employee HR profile | All, field-filtered | Staff in scope, sensitive fields restricted | Own allowed projection |
| Issue staff activation | Any eligible staff in authorized store | Eligible staff in own scope | No |
| Author quizzes | All scopes | Selected stores in own scope | No |
| Publish global quiz | Yes | No | No |
| Take assigned quiz | No requirement | No requirement | Own available quizzes |
| View quiz results | All | Staff/assignments in scope | Own results only |
| Upload photo | Operationally optional; not a staff action | No | Own assigned active stores |
| Review photo | All stores | Assigned stores | No |
| Read private photos | All | Assigned stores | Own/submitted and assigned-store policy only |
| Create/publish schedules | All | Assigned stores | No |
| Read schedule | All | Assigned stores | Own schedule |
| Create/assign tasks | All | Assigned stores | No |
| Complete assigned task | No requirement | No requirement | Own assignments |
| Review task submission | All | Assigned stores | No |
| Publish knowledge articles | All | Explicitly granted scope | No |
| Read knowledge articles | All | Allowed scope | Allowed scope |
| Manage announcements | All | Explicitly granted scope | No |
| Receive/acknowledge announcements | Yes | Yes | Yes |

Policy details to preserve:

- A manager must not gain access to another manager, administrator, or unrelated store merely because an employee has multiple memberships.
- When a store membership is removed, future access must stop immediately. Historical quiz/photo/task/schedule visibility needs an explicit product rule and should not be inferred accidentally from current membership.
- Sensitive profile fields should be returned through separate projections and should not appear in list endpoints, staff APIs, push payloads, or broad dashboard aggregates.

## 8. State machines

### 8.1 Photo review

```text
PENDING ──approve──> CHECKED
   │
   └──reject(reason)──> REJECTED ──resubmit(new version)──> PENDING
```

Rules:

- Upload creates a new immutable version in `PENDING`.
- Only an authorized manager/admin can transition a pending version to `CHECKED` or `REJECTED`.
- Rejection requires a non-empty reason.
- A rejected submission is not edited in place; resubmission creates a new version and preserves the previous record.
- `CHECKED` is terminal for that version unless an explicit later correction policy is approved.
- Transitions are transactional, compare the expected current status, and accept an idempotency key. A repeated identical transition returns the stored result; a conflicting transition returns `409`.
- Viewing/download never changes review state.

Events:

- `photo.submitted`
- `photo.checked`
- `photo.rejected`
- `photo.resubmitted`

### 8.2 Task review

```text
DRAFT ──publish──> ASSIGNED ──submit──> SUBMITTED
                                      │
                         approve ────┴────> CHECKED
                         reject(reason) ──> REJECTED ──resubmit──> SUBMITTED
```

Task status should be separate from checklist item status. A task cannot be approved before required items and evidence rules pass. Rejection requires a reason, and each submission/review remains auditable. Recurrence creates new concrete tasks rather than reopening old history.

### 8.3 Quiz lifecycle and attempt

```text
QUIZ DRAFT -> PUBLISHED REVISION -> ARCHIVED

ATTEMPT: IN_PROGRESS -> SUBMITTED
```

Editing a published quiz creates a new revision. Existing attempts remain attached to the old revision and scoring policy. A future deadline/expiry rule may add `EXPIRED`, but it must be additive and must not reinterpret historical `SUBMITTED` results.

## 9. Advanced quiz model and scoring

The advanced engine should be implemented as a revisioned policy, not as a collection of UI flags.

### 9.1 Question type contract

| Type | Answer payload | Scoring/review |
| --- | --- | --- |
| Single choice | One option ID | Exact correct option; legacy-compatible |
| Multiple choice | Set of option IDs | Explicit exact or partial-credit policy; no ambiguous default |
| Weighted choice | One/set of option IDs | Sum configured weights, bounded by revision policy |
| Free text | Text, length/format validated | Manual review or explicit rubric; no guessed correctness |
| Opinion/survey | Choice/text/rating | No examination score; stored for analysis |
| Rating | Integer/decimal scale | No score unless revision explicitly defines one |
| Scenario | Structured answer set | Question-level policy, potentially partial/manual |
| Photo answer | Private photo reference | Manual review; media authorization applies |

Each question must declare its type and scoring policy. “Survey” mode must not write pass/fail or examination score. Free-text and photo answers must not be auto-marked correct unless a separately approved evaluator is added.

### 9.2 Assignment and attempt rules

Use explicit assignment targets for global, store, role, and individual assignment. Resolve the effective assignment at attempt creation and retain enough snapshot data to explain why the staff member could start the quiz. Enforce attempt limits and deadlines in the API, not in Mobile.

Autosave should be a server endpoint only after an answer payload/version and conflict policy are defined. Until then, the current Mobile SecureStore draft is an acceptable local recovery mechanism for the existing single-choice flow.

Correct answers, weights, rubrics, review notes, and hidden explanations must not be returned in staff contracts. Admin results should be scoped and paginated; detailed manual-review data should require the relevant permission.

## 10. Notification event architecture

Domain code should publish an internal event after the transaction commits logically by inserting an outbox record in the same database transaction:

```text
business command
  -> domain validation and state transition
  -> business row + audit row + outbox row (one transaction)
  -> delivery worker reads outbox
  -> in-app notification and optional Expo push delivery
  -> retry/backoff or permanent invalid-token handling
```

Event envelope fields should include event ID, event type, schema version, aggregate type/ID, actor ID, occurred time, and a minimal non-sensitive payload. Recipients are resolved server-side from role/store/user targeting. Delivery must be idempotent by event/recipient/channel.

Initial event catalog:

- `quiz.assigned`, `quiz.deadline_approaching`;
- `photo.submitted`, `photo.checked`, `photo.rejected`, `photo.resubmitted`;
- `schedule.published`, `schedule.changed`;
- `task.assigned`, `task.deadline_approaching`, `task.checked`, `task.rejected`;
- `announcement.published`, `announcement.acknowledged`.

Start with a PostgreSQL-backed outbox and a small worker process or scheduled worker. Revisit Redis/broker only when measured retry volume, throughput, or multi-region delivery needs justify it.

## 11. Refined milestones

Each milestone below is intentionally scoped into Backend, Admin, Mobile, Shared contracts, Database migrations, Tests, and acceptance criteria.

### Milestone 12 — Extended employee profiles

Dependencies: current users/stores/auth services; business approval of optional sensitive fields.

- **Backend:** Add profile service and field-level authorization. Keep password/session data in auth. Define projections for admin, manager, and self. Profile photo upload/reference is deferred until media ownership can be modeled separately from store photo reports; no profile image should reuse the current staff upload endpoint.
- **Admin:** Add profile fields to employee detail/edit flow; show only fields permitted by role and keep the existing shell. Profile photo UI remains deferred with the secure media design.
- **Mobile:** Show the staff member's allowed name, job title, assigned stores, and employment date; never expose password hash/session data, sensitive HR fields, or an unowned profile image.
- **Shared contracts:** Add profile request/response schemas, redacted projections, and date/optional-field validation. Do not add a profile-media contract until ownership and retention are defined.
- **Database migrations:** Add `employee_profiles` and backfill only deterministic existing values; leave unknown fields null. Do not attach profile media to the current `photos` table.
- **Automated tests:** Field authorization, manager scope, self-access, validation, inactive users, migration/backfill, and contract parsing. Add profile-media tests only with its dedicated design.
- **Acceptance criteria:** Admin can edit approved profile fields; managers cannot read out-of-scope/sensitive fields; staff can see only their own allowed profile; profile images remain explicitly unavailable until a secure media ownership design is approved; existing login, activation, and store assignment behavior is unchanged.

### Milestone 13 — Photo review workflow (implemented on `upgrade/mobile-expo-sdk-58`)

Dependencies: Milestone 12 identity projections; current private photo storage and idempotent upload behavior.

- **Backend:** Add report/version model, state transition service, review comments, audit history, scoped manager review, idempotent approve/reject/resubmit, and event records.
- **Admin:** Add scoped pending/rejected/checked queues, private preview, approve/reject dialog with required reason, history, and filters by store/employee/status.
- **Mobile:** Show status and reviewer comment for the employee's own submissions; add corrected resubmission without deleting history.
- **Shared contracts:** Add status enums, report/version responses, transition inputs, history entries, and event-safe DTOs.
- **Database migrations:** Backfill legacy photos into a compatible initial report state; add review parent/version/history tables and indexes.
- **Automated tests:** State machine, rejection reason, duplicate/concurrent transitions, cross-store denial, private image authorization, resubmission history, idempotency, and event creation.
- **Acceptance criteria:** New uploads begin `PENDING`; authorized reviewers can approve/reject only in scope; rejection requires a reason; resubmission preserves all prior versions; viewing never approves; no token/object URL leaks. Review-linked media deletion is retained only for still-pending single-version records; checked/rejected histories are protected from deletion.

### Milestone 14 — Advanced quiz engine

Dependencies: immutable revision behavior and assignment scope; event/outbox conventions if assignment notifications are enabled.

- **Backend:** Add question types, assessment modes, scoring policies, manual-review paths, limits/deadlines, randomization, assignment targets, and historical scoring snapshots.
- **Admin:** Extend authoring with explicit question-type editors, scoring/manual-review settings, assignment controls, preview, publish validation, and result/review views.
- **Mobile:** Render supported question types, save drafts safely, restore attempts, show survey versus exam semantics, submit text/photo answers through authorized endpoints, and hide correct-answer data.
- **Shared contracts:** Add discriminated question/answer schemas, scoring/result contracts, assignment contracts, and versioned attempt payloads.
- **Database migrations:** Add revision mode/policy fields, question type/config, answer payload/review data, assignment targets, and immutable scoring references while preserving legacy rows.
- **Automated tests:** Every scoring rule, partial credit, survey non-scoring, deadlines, limits, randomization reproducibility, historical results, manual review, staff answer redaction, and cross-store assignment.
- **Acceptance criteria:** Published revisions cannot change; old attempts retain old semantics; all listed question types have explicit behavior; survey results do not affect exam scores; staff APIs never leak answers or scoring internals.

Status: implemented on the SDK 58 upgrade branch. The additive `0011_advanced_quiz_engine` migration stores assessment settings, question configuration, assignment targets, persisted attempt order, typed answer payloads, manual-review state, review history, and private photo-answer references. The API owns deterministic scoring, attempt limits/deadlines, role/store/user eligibility checks, and transactional `quiz.*` domain events. Admin authoring exposes modes, limits, randomization, typed questions, store/role assignment, and a scoped review queue. Mobile renders choice, text, rating, and photo-answer flows while keeping scoring data server-side. Individual-user assignment storage is supported by the shared contract and API; the current Admin editor exposes store and role targets, with individual targeting remaining an API-level capability.

### Milestone 15 — Work schedules

Dependencies: employee profiles, store timezone decisions, current memberships and authorization.

- **Backend:** Add draft/published periods, shifts, days off, overlap validation, overnight handling, publication/history, and scope checks.
- **Admin:** Build manager/admin schedule editor with store/employee filters, draft validation, publish confirmation, and history.
- **Mobile:** Add read-only schedule/calendar, days off, local-time display, and clear offline/stale-data state.
- **Shared contracts:** Add timezone-aware shift, period, day-off, publication, and history schemas.
- **Database migrations:** Add store timezone/configuration, schedule periods, shifts, days off, and change history with appropriate range indexes/constraints.
- **Automated tests:** Local-to-UTC conversion, DST/overnight cases, overlap conflicts, scope, publish immutability/history, inactive employee/store behavior, and mobile date rendering.
- **Acceptance criteria:** Managers publish only their scope; staff see only their schedule; overlapping shifts are rejected; overnight shifts remain correct; published history is auditable; attendance/payroll are not introduced.

### Milestone 16 — Tasks and checklists

Dependencies: review/audit conventions from Milestone 13; photo evidence access; store scope.

- **Backend:** Add templates, one-time/recurring task occurrences, assignments, deadlines, checklist completion, evidence, submission, review, and idempotent transitions.
- **Admin:** Manage templates and assignments, monitor status/deadlines, inspect evidence, approve/reject with comments, and view history.
- **Mobile:** List assigned tasks, show checklist/deadline/priority, save completion locally where safe, submit evidence, and handle retry/duplicate submission.
- **Shared contracts:** Add task/template/assignment/submission/review/event schemas and explicit status transitions.
- **Database migrations:** Add task/template/items/assignment/submission/evidence/review tables and recurrence materialization records.
- **Automated tests:** Scope, recurring occurrence identity, checklist validation, evidence authorization, concurrent review, rejection/resubmission, deadlines, idempotency, and offline retry behavior.
- **Acceptance criteria:** Employees can submit only assigned tasks; managers review only authorized stores; required checklist/evidence rules are enforced; prior submissions remain auditable; recurring changes do not rewrite history.

### Milestone 17 — Notifications and announcements

Dependencies: stable domain events from photo, quiz, schedule, and task modules; Expo native notification decisions.

- **Backend:** Add in-app notifications, device tokens, preferences, announcements, targeting, outbox worker, retry/backoff, dedupe, and token invalidation.
- **Admin:** Compose/publish targeted announcements, view delivery/ack status, and manage only authorized scopes.
- **Mobile:** Register/revoke push token, list/read/acknowledge in-app notifications, handle safe deep links, and honor preferences.
- **Shared contracts:** Add event envelopes, notification, announcement, preference, token, and delivery status schemas.
- **Database migrations:** Add outbox, notifications, device tokens, preferences, announcements, targets, and delivery attempts.
- **Automated tests:** Transactional event creation, recipient scope, dedupe, retries, invalid tokens, preference suppression, deep-link safety, logout/revocation, and no-sensitive-payload checks.
- **Acceptance criteria:** Business actions remain correct if delivery is unavailable; events are not lost in the transaction; duplicate push/in-app deliveries are prevented; payloads contain no secrets or sensitive employee data; unread state is durable.

### Milestone 18 — Knowledge base

Dependencies: role/store visibility policy, private media attachments, optional notification/acknowledgement support.

- **Backend:** Add categories, article revisions, publish/archive, search, visibility targets, attachments, and acknowledgement rules.
- **Admin:** Author, preview, publish, archive, categorize, target, and inspect revision history.
- **Mobile:** Search and read allowed articles, open private attachments, and acknowledge required content.
- **Shared contracts:** Add article/revision/search/visibility/attachment/ack schemas.
- **Database migrations:** Add article, revision, category, target, attachment, and acknowledgement tables plus search indexes.
- **Automated tests:** Published revision immutability, search scope, draft exclusion, attachment authorization, acknowledgement state, and manager/admin targeting.
- **Acceptance criteria:** Staff see only published content in their role/store scope; edits create revisions; private attachments remain protected; required acknowledgement is recorded per employee and revision.

### Milestone 19 — Retail operations

Dependencies: photos/review, tasks, knowledge, notifications, and stable store scope.

- **Backend:** Add campaign execution, merchandising checks, reference/submitted media links, maintenance issues, and operational requests as separate bounded modules.
- **Admin:** Add scoped operational queues and store summaries without changing existing employee/store/quiz workflows.
- **Mobile:** Add only the approved operational flows, with evidence and retry semantics reused from task/photo conventions.
- **Shared contracts:** Add explicit operation-specific request/response/state schemas.
- **Database migrations:** Add campaign/check/issue/request tables and references to existing stores/users/media/tasks.
- **Automated tests:** Scope, evidence privacy, state transitions, assignment, audit, idempotency, and notification events.
- **Acceptance criteria:** Each operational workflow has a documented owner, status model, and store-scope rule; no module uses an unbounded generic workflow or bypasses existing authorization.

### Milestone 20 — Advanced reporting

Dependencies: stable event/status history, review outcomes, schedules/tasks/notifications, and agreed metric definitions.

- **Backend:** Add scoped aggregate queries/read models for employee, store, quiz, photo, schedule, task, and campaign metrics; define UTC/local-time reporting rules.
- **Admin:** Add filters, drill-downs, exports only where approved, and role-scoped comparisons; preserve current dashboard semantics until replacements are validated.
- **Mobile:** Keep mobile reporting minimal and limited to personal progress/status unless a separate product decision approves more.
- **Shared contracts:** Add metric definitions, periods, dimensions, pagination, and export job contracts if needed.
- **Database migrations:** Add indexes/materialized/read-model tables only after measured query plans justify them.
- **Automated tests:** Metric definitions, date boundaries, duplicate memberships/assignments, scope, historical revisions, null/empty behavior, and performance budgets.
- **Acceptance criteria:** Every metric has a written definition and scope; reports reconcile with source records; unauthorized comparisons are impossible; expensive aggregation is measured before introducing a separate analytics system.

## 12. Recommended implementation sequence

1. **Milestone 12:** Separate employee profile concerns from authentication and establish field-level data minimization.
2. **Milestone 13:** Add photo review/history and the first durable domain events. This resolves the current photo model gap and establishes review/audit conventions.
3. **Milestone 14:** Extend the revisioned quiz model while legacy attempts remain readable and immutable.
4. **Milestone 15:** Add store timezone decisions, schedule publication, and history.
5. **Milestone 16:** Build tasks using explicit task review and photo-evidence references.
6. **Milestone 17:** Operationalize the event/outbox records into in-app and Expo push delivery.
7. **Milestone 18:** Add knowledge content and targeted acknowledgements.
8. **Milestone 19:** Add only the retail operations workflows validated by the chain's operating processes.
9. **Milestone 20:** Build reporting after source state and event semantics are stable.

Before each milestone, write a short domain decision record for fields, status transitions, permissions, retention, and acceptance fixtures. Keep migrations additive where practical, deploy schema changes before code that reads new columns, and retain compatibility adapters for existing Admin/Mobile clients during rollout.

## 13. Risks and migration considerations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `users` contains both contacts and auth state | Sensitive profile data may be overexposed | Add `employee_profiles`; use role-specific projections; do not return hashes |
| Current photos have no review identity/history | A status-only migration would lose resubmission history | Add report/version/history model and backfill legacy uploads deterministically |
| Quiz options currently use `isCorrect` and one `optionId` | New scoring types could corrupt old attempts | Add typed/versioned answer payloads; preserve old scoring path and revision IDs |
| In-memory rate limiter | Brute-force limits differ across API instances/restarts | Keep current behavior for the single instance; plan durable/shared limiting before horizontal scale |
| Manager scope changes over time | Historical records may disappear or leak | Define current versus historical access per module; audit scope decisions |
| Missing store timezone | Shifts can be wrong across DST/overnight boundaries | Require explicit IANA timezone before schedule rollout |
| Notification delivery failure | Staff may miss deadlines | Commit event/outbox with business transaction; make delivery retryable and visible |
| N+1 queries in existing domain code | Future lists/reports may become slow | Add query plans, scoped joins/EXISTS, pagination, and measured indexes per milestone |
| Admin and Mobile BFF/client duplication | Contracts can drift | Keep Zod schemas in `packages/contracts`; add route-level contract tests |
| Private image retention and personal data | Privacy and storage cost | Define retention/deletion policy before review/profile rollout; keep object keys private |
| Overly broad workflow abstraction | Authorization and state rules become opaque | Keep photo/task workflows separate; share only audit/event primitives |
| Reporting built on mutable current state | Historical metrics become irreproducible | Base historical metrics on immutable revisions, event timestamps, and review history |

Migration rules:

- Never use destructive reset/clean operations to migrate this repository or database.
- Add nullable columns/tables first, backfill in bounded batches, then enable stricter constraints after validation.
- Keep old API response fields stable until all clients have moved.
- Use transaction boundaries for state transitions and append-only history.
- Add indexes with production-sized data in mind and inspect query plans before adding read models.
- Treat storage/object cleanup as a separately retryable concern; do not make a database row claim an object is public.

## 14. Unresolved product and architecture questions

These questions should be answered before implementation of the corresponding milestone:

1. Which employee profile fields are required for an actual business process? What is the purpose, retention period, and access policy for birth date and gender?
2. Should managers see phone/email for every staff member in scope, and may staff edit their own contacts?
3. What timezone and holiday/calendar rules apply to each store? Is there one local timezone for all current stores?
4. Are schedules published per store, per manager scope, or company-wide? Can a shift cross stores on one day?
5. What is the exact photo review SLA, and can a manager reopen a checked submission?
6. Should photo review be per photo version or per report/campaign occurrence?
7. Which advanced quiz types are required in the first release, and what are the approved partial-credit/scoring formulas?
8. Are quiz assignments by role and individual required immediately, or can store assignments remain the first extension?
9. Are free-text/photo answers reviewed by managers, and what is the rubric/retention policy?
10. Which task recurrence rules are needed, and who owns templates across stores?
11. Should push notifications use Expo Push Service initially, and what operational owner handles invalid tokens and delivery failures?
12. Which announcements require acknowledgement, and what is the legal/operational meaning of an acknowledgement?
13. Who can publish knowledge articles and attachments, and how long must old revisions remain available?
14. Which retail operations workflows have measurable business value for the first 12 stores?
15. What reporting definitions must be reconciled with current dashboard metrics before historical comparisons are exposed?

## 15. Planning conclusion

The current repository is not missing a backend foundation; it has a working identity/store/authentication layer, private photo storage, revisioned quizzes, results, dashboard aggregates, and explicit Admin/Mobile clients. The future work is additive domain expansion.

Milestones 12–14 address employee profiles, photo review, and the advanced revisioned quiz engine. Schedules, tasks, notifications, knowledge base, retail operations, and advanced reporting remain future milestones.

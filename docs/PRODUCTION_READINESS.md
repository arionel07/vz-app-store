# Production Readiness and Security Audit

Audit snapshot: 2026-10-31

Repository: `arionel07/vz-app-store`

Branch/commit reviewed: `upgrade/mobile-expo-sdk-58` / `69626b7c76abecb34005d0fa68b760d75116a7fe`

## Executive assessment

M1–M20 functionality has passed the repository's recorded local acceptance, but this is not yet a production-ready deployment. The repo contains a development-only PostgreSQL Compose service, not deployable API/Admin/worker images or a staging stack. The VPS, its running services, available resources, firewall, reverse proxy, backups, DNS, and Cloudflare configuration were not accessible in this audit and are not inferred from the Codex Docker host. No deployment, DNS change, live migration, or push delivery was performed.

The application has useful security boundaries already: server-side Admin route guards; API-side role/store authorization; HttpOnly browser sessions with CSRF validation; bearer sessions for Mobile; current active-user/membership checks; explicit BFF API path allowlists; authenticated private media streaming; bounded image parsing; a PostgreSQL outbox; and structured logs. These lower risk but do not replace deployment controls.

No confirmed remotely exploitable vulnerability was established by this source/configuration review. This is not a penetration test, external S3 test, dependency CVE scan, or VPS assessment.

## Architecture reviewed

- Admin: Next.js App Router with a server-side protected layout and same-origin BFF; API calls use exact route allowlists and forward only the session cookie, CSRF token, and selected headers.
- API: Bun/Hono; PostgreSQL with Drizzle migrations; browser and mobile sessions are stored as token hashes; role and store scope are resolved by API services.
- Mobile: Expo SDK 58; public `EXPO_PUBLIC_*` configuration contains an API origin, not credentials; session credentials are stored using SecureStore.
- Media: local filesystem for development/tests and S3-compatible object storage in production configuration; media bytes are served through authorized API/BFF routes, not public URLs.
- Notifications: transactional domain events and PostgreSQL-backed outbox; a separate `notifications:worker` command handles delivery through Expo Push Service.
- CI: `.github/workflows/ci.yml` currently runs the API job and PostgreSQL tests. It pins Bun 1.3.6 while root `package.json` declares Bun 1.4.4.
- Containers: `infra/docker-compose.yml` defines only local PostgreSQL. No API/Admin/worker Dockerfiles or deploy Compose profile were found.

## Findings and priorities

Severity indicates potential impact; likelihood is an operational estimate, not evidence of an incident.

| ID | Priority | Finding and evidence | Required action |
| --- | --- | --- | --- |
| PR1-H1 | High / Medium likelihood | Login and activation throttles are bounded in-memory maps keyed by email or activation identifiers (`apps/api/src/auth/rate-limit.ts`). They reset on restart, are not shared across replicas, and login is not also limited by client/network at the edge. | Before public production exposure, add an edge/shared limiter, monitor 401/429 patterns, and verify proxy address handling. Keep an app-level account limiter as a second layer. |
| PR1-H2 | High / Medium likelihood | HTTPS is not fully fail-closed in production configuration. `apps/admin/src/lib/auth.ts` accepts `http:` for `VIZAJE_API_URL`; API CORS parsing accepts HTTP origins and production only rejects `*`. Browser cookie `Secure` depends on `NODE_ENV=production`. Mobile release builds do reject HTTP, but server-to-server Admin/API transport still depends on deployment configuration. | Set `NODE_ENV=production`, use HTTPS for public origins, and either HTTPS or a private isolated container network for Admin→API. Reject cleartext CORS origins in production and test that the deployed session cookie has `Secure; HttpOnly; SameSite=Lax`. |
| PR1-H3 | High / Medium likelihood | Runtime, worker, and migrator all construct the PostgreSQL client from `DATABASE_URL` (`apps/api/src/db/client.ts`, `src/db/migrate.ts`, `src/notifications/worker.ts`). The pool maximum is hard-coded at 10 per process. The repo does not provision separate runtime/migration roles or grants. | Provision distinct least-privilege runtime and migration DB roles; keep migration credentials out of API/worker containers. Budget connections across every API/worker replica and maintenance reserve before sizing PostgreSQL. |
| PR1-H4 | High / High likelihood | No staging/production service images or Compose deployment definition exist. The present Compose file starts only PostgreSQL with development defaults (bound to loopback). The Codex Docker host contains only `infra-postgres-1`; this is not evidence about the actual VPS. | Treat staging deployment as blocked until the owner inventories the VPS, proxy, ports, resources, persistence, and existing services, then approves a separately named staging stack. Never reuse the development Compose credentials. |
| PR1-M1 | Medium / Medium likelihood | CI only exercises API; Admin/Mobile tests, typechecks/builds, Docker validation, dependency auditing, and secret scanning are not workflow gates. Push triggers list `main` and `work`, not this upgrade branch; pull requests do run the workflow. CI pins Bun 1.3.6 while root `package.json` declares Bun 1.4.4. On this audit run, the API suite had one `schedule-timezone.test.ts` failure under 1.3.6: its bundled `Intl` timezone data treated the expected nonexistent Chisinau wall time as valid. The same test passed under Bun 1.4.4. | Align the pinned Bun version to 1.4.4, then require the API suite to pass in CI. Add Admin/Mobile validation, migration checks, dependency/secret/container scans, and branch protection before release. |
| PR1-M2 | Medium / Medium likelihood | Worker uses `SKIP LOCKED`, bounded exponential retries, attempt records, and permanent status, but has no health endpoint, graceful SIGTERM loop, queue-age alert, or operator dashboard. An accepted push can be repeated if the process fails after provider acceptance but before persisting the ticket; this is at-least-once delivery. Some non-`DeviceNotRegistered` receipt failures are terminal. | Run one worker initially; add backlog/oldest-item/permanent-failure/receipt alerts and document replay/triage. Confirm receipt retry policy against provider error classes. |
| PR1-M3 | Medium / Medium likelihood | `apps/admin/next.config.ts` adds no-store/referrer/nosniff/frame headers only to `/activate`; it does not set global HSTS, CSP, or Permissions-Policy. | Set HSTS at the TLS terminator; add an Admin-wide header policy (CSP in report-only then enforced after compatibility review, nosniff, frame denial, referrer policy, and a restrictive permissions policy). |
| PR1-M4 | Medium / Medium likelihood | App validates image signatures, bounds request/body and decoded dimensions, normalizes supported formats with Sharp, and emits private/no-store responses. S3 writes request SSE-S3 (`AES256`) and code does not issue signed/public URLs. However bucket public-access blocking, IAM policy, lifecycle/versioning, provider behavior, and retention are external and unverified; orphan reconciliation is manual. | Use separate private buckets/prefixes and identities per environment, block public access/listing, enable encryption/versioning as policy requires, define retention/deletion, and run an authenticated S3 integration/reconciliation test. |
| PR1-M5 | Medium / Medium likelihood | The code has `/health` and DB readiness endpoints, but no production monitoring/alerting or evidence of tested off-host backups. No DB role setup, connection budget, or formal restore drill is in the repo. | Configure external monitoring and encrypted backups, prove restoration to an isolated database, and set measurable RPO/RTO before any production approval. |
| PR1-L1 | Low / Medium likelihood | The EAS config has development and preview profiles, but no production profile; mobile config has no `extra.eas.projectId`. Physical-device QA is not established by this audit. | Create/select a separate staging Expo project and verify native QA before release preparation; never place secrets in `EXPO_PUBLIC_*`. |

### Security controls observed

- Browser session cookie is HttpOnly, SameSite=Lax, and receives `Secure` when API `NODE_ENV` is production. State-changing browser requests require the session-bound CSRF token/header. Admin BFF forwards only the named session cookie, not arbitrary cookies.
- Mobile uses bearer credentials; authentication checks active users and current memberships on requests. Inactive users/sessions are rejected by the API. Admin/manager/staff role policy and store scope are enforced at API service boundaries, not only in UI.
- API `/api/v1/*`, Admin BFF responses, and image/evidence streams set private/no-store headers. Private media access remains API-authorized; object keys are not returned as public URLs.
- Upload validation checks byte signatures and Sharp decoding, with configured body/byte/dimension/pixel limits. The local storage adapter uses restrictive file modes and validates keys against path traversal.
- CORS is an exact origin allowlist and production rejects wildcard origins. Production config does not currently reject HTTP origins or local defaults; the deployment must supply exact HTTPS origins and prevent direct public access to the Bun listener.

## Environment separation

Never copy production secrets, push tokens, signing credentials, or personal production data into staging. Prefer synthetic/anonymized staging fixtures.

| Concern | Local development | Isolated staging | Production |
| --- | --- | --- | --- |
| API/Admin URLs | Loopback/LAN only; HTTP allowed only for local development where supported. | Dedicated staging HTTPS Admin/API hostnames. No production domain or shared session cookies. | Approved HTTPS domains only; HSTS at proxy. |
| Database | Disposable local PostgreSQL; current Compose default is for local use only. Tests use a distinct disposable DB. | Separate DB and volume/cluster, private network, TLS, staging-only credentials/data. | Private PostgreSQL endpoint, TLS, separate runtime and migration roles, monitored connection budget. |
| Media | Local filesystem under ignored `.data` path. | Separate private bucket/prefix, test objects only, staging IAM. | Private bucket, public access blocked, scoped runtime identity, encryption, version/retention/reconciliation policy. |
| Secrets | Untracked developer-local values; never commit `.env`. | Separate secret namespace and credentials, injected at runtime. | Managed secret store or root-owned protected secret delivery; rotation and access audit. |
| Push | Fake provider/unit test; no real sends during this audit. | Separate Expo project/credentials and test devices; explicit owner approval before sending. | Dedicated Expo access token, restricted access and rotation; monitor receipts and invalidations. |
| Network/proxy | Local ports, no trusted external proxy. | Private service network; only proxy publishes 80/443; strip/overwrite forwarded headers. | Same, with reviewed firewall, TLS termination, exact CORS, direct API/DB exposure blocked. |
| Logs/monitoring | Local structured logs. | Staging-only sink and alerts; redact all auth/media secrets. | Central access-controlled logs, retention, alerting, backups and incident ownership. |

Relevant configuration names (values must be delivered out of band):

- API: `NODE_ENV`, `DATABASE_URL`, `HOST`, `PORT`, `LOG_LEVEL`, `CORS_ALLOWED_ORIGINS`, `PHOTO_STORAGE_DRIVER`, `PHOTO_STORAGE_PATH`, `PHOTO_MAX_BYTES`, `PHOTO_MAX_DIMENSION`, `PHOTO_MAX_PIXELS`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `EXPO_PUSH_ACCESS_TOKEN`, and `NOTIFICATION_WORKER_*`.
- Admin server: `VIZAJE_API_URL`; public activation-link base is `NEXT_PUBLIC_ACTIVATION_LINK_BASE_URL`.
- Mobile build-time public config: `EXPO_PUBLIC_API_URL` and optional `EXPO_PUBLIC_ACTIVATION_LINK_BASE_URL`. `EXPO_PUBLIC_ALLOW_INSECURE_HTTP` is development-only and must not be enabled in release builds. These `EXPO_PUBLIC_*` values are bundled and must never contain secrets.
- TLS private keys/certificates, database credentials, S3 credentials, Expo access tokens, and later EAS/store-signing material belong only in their environment's secret manager. Do not store them in the repository, image layers, build args, logs, or mobile bundle.

For this current workspace, `infra/docker-compose.yml` validates as a local PostgreSQL definition. The observed Docker daemon has one healthy `infra-postgres-1` container on loopback. No remote VPS inventory was available, so CPU/RAM/disk, current Compose projects, proxy, ports, backup jobs, DNS, and Cloudflare routing remain unknown.

## Staging deployment proposal (not executed)

First perform a read-only VPS inventory and obtain explicit staging approval. Use a separately named Compose project/network and isolated hostname; do not edit existing production containers, DNS, or Cloudflare. The target topology is:

```text
Internet ── TLS reverse proxy ── Admin (Next.js)
                         └────── API (Hono/Bun) ── private PostgreSQL
                                      ├────────── private object storage
                                      └────────── notification worker ── Expo Push Service
```

- Build immutable API/Admin images from the reviewed commit and pin the base/runtime images by version/digest. Add reviewed Dockerfiles and a staging Compose file before deployment; neither is present now.
- Services: `admin`, `api`, one `notification-worker`, a one-shot `migrate` job, and either a dedicated staging PostgreSQL service or an already provisioned *staging-only* PostgreSQL instance. Do not publish PostgreSQL or the API listener to the public host. Only the reverse proxy publishes 80/443.
- Use a separate private network for data services; mount a persistent volume only for the dedicated staging database. Backups must be outside that volume/host. Store uploaded media in a distinct private staging bucket. Admin→API can use HTTPS; if HTTP is chosen inside Docker, it must be constrained to a private, non-routable service network with no direct host/public exposure.
- Proxy terminates modern TLS, renews certificates, redirects HTTP to HTTPS, applies HSTS, limits upload size/timeouts, and overwrites rather than trusts client-supplied `Forwarded`/`X-Forwarded-*`. Direct API access is blocked. Configure exact staging CORS origins.
- Run migrations once as a separate job with migration credentials, then deploy API/Admin/worker images. The API should not automatically run migrations. Gate readiness on `/api/v1/health`; use `/health` for liveness. Add a lightweight Admin health check or proxy upstream check.
- Configure restart policy for long-running API/Admin/worker services, log rotation, CPU/memory/PID limits, health checks, stop grace periods, and explicit resource reservations/limits only after VPS capacity is measured. Keep at least 25–30% host memory/disk headroom for PostgreSQL, image processing, logs, and backups; do not guess resource caps before inventory.
- Keep staging secrets in its own secret store. In staging, use no production passwords, database snapshot, media bucket, Expo token, or signing profile. Use synthetic users and test stores.
- Rollback: retain the previous immutable app images and Compose config. Roll app images back only after checking schema compatibility. For an incompatible migration, restore the pre-migration DB backup into a new isolated DB and point the previous app at it; do not assume an automatic reverse migration exists. Coordinate DB and object-store restore points.

This is a proposal, not an executable deployment artifact or approval to deploy.

## Database safety and migration runbook

1. Identify the target by approved environment manifest and verify `current_database()`, `current_user`, server endpoint, and expected environment marker before any migration. Abort on mismatch. Never target development/production during tests.
2. Rehearse the exact reviewed migration set on a fresh staging clone/anonymized fixture. Review generated SQL, table/index lock impact, duration, and compatibility with both old and new application versions. Migrations are applied by Drizzle; the repo has no down-migration command. Treat rollback as restore or forward-fix, not SQL reversal.
3. Before deployment, take an encrypted custom-format `pg_dump` or provider snapshot, calculate/record a checksum, and copy it to access-controlled off-host storage. Include a coordinated object-storage recovery point where media consistency requires it.
4. Run one migration job with a dedicated, temporary migration identity. Keep runtime credentials DML-only and never mount migration credentials in API/worker services. Apply additive/expand schema first, deploy compatible code, then defer destructive cleanup to a later approved release.
5. Monitor locks, connections, disk, migration output and readiness. Abort rollout on unexpected lock duration, failed migration, or readiness regression. Preserve the previous image/config and the backup.
6. Restore only into a newly provisioned, explicitly isolated database; verify schema version, key table counts, sample referential integrity, application readiness and media object availability before any cutover.

Suggested initial policy (owner must approve): 7 daily, 4 weekly, 12 monthly encrypted backups, with off-host/object-lock protection where supported. Perform a restore drill at least quarterly and after major schema/storage changes. Define and test numeric RPO/RTO; “backup succeeded” is not restore verification. Set PostgreSQL `max_connections` from measured process count: the current pool allows 10 per API process and 10 per worker process, plus migration/maintenance clients, so replicas multiply connection use.

## Private media and evidence

Minimum production storage requirements:

- Dedicated private bucket per environment (or provably isolated prefixes and IAM); block public ACLs/policies and anonymous listing. Do not put object keys or credentials in API responses or client bundles.
- TLS to the provider, encryption at rest, scoped API identity limited to necessary object `Get/Put/Delete` operations, and independent backup/version-retention policy. The code requests AES-256 server-side encryption on S3 writes; provider-side enforcement and recovery were not tested.
- Route every read through the API/BFF after current session, role, employee, and store-scope authorization. Preserve `private, no-store`, `nosniff`, content-type validation and bounded uploads. Do not introduce long-lived public or signed URLs without a separate security review.
- Set a business/legal retention period for employee photos, evidence, and profile/quiz media; document deletion, access audit, backup expiry, and legal holds. The repository has no automatic media retention/cleanup worker. Reconcile DB rows against object inventory; quarantine unknown objects and require approval before deletion.
- Verify the disabled/inactive employee path, cross-store denial, object deletion retry, missing object handling, and S3 permission denial against staging with non-sensitive fixtures. Current local tests do not prove a real provider's policy.

## Notification infrastructure

The PostgreSQL event/outbox implementation has deduplication keys, `FOR UPDATE SKIP LOCKED`, stale-claim recovery after five minutes, bounded exponential retry, maximum attempts, delivery attempt records, Expo tickets/receipts, and invalidation for `DeviceNotRegistered`/invalid credentials. Run it as a distinct worker, initially one replica, and do not start it during this audit.

Before staging push tests: provision a separate Expo project/token, approve test recipients, confirm shutdown/restart behavior, and alert on worker last-success age, pending/retry depth, oldest pending age, claimed rows older than lease, permanent failures, receipt failures, invalidated devices, and provider throttling. Push is best-effort/at-least-once, not exactly-once. No real push notification was sent during this audit.

## Quality and security validation

- Recorded M20.3 local acceptance in `README.md`: API/PostgreSQL suite passed twice (86 tests / 702 assertions per run); Admin 44 tests, Mobile 64 tests, typechecks/builds and Expo exports passed; authenticated Admin BFF/browser checks passed. This is prior functional acceptance, not a PR1 penetration test or staging/provider validation.
- PR1 checks: repository was clean at audit start; `git diff --check` and `docker compose -f infra/docker-compose.yml config --quiet` passed. Compose validates only the local PostgreSQL service, not an app deployment.
- API tests under Bun 1.4.4: 86 passed, 0 failed, 702 assertions, including the full opt-in PostgreSQL suite on a newly created isolated PostgreSQL 16 database. The target DB identity was verified before migration; the test container/network were removed afterward. Existing `infra-postgres-1` was neither connected to nor modified. Under CI-pinned Bun 1.3.6, the non-integration run was 36 passed, 1 failed, 75 integration tests skipped; the single failure was the timezone-data discrepancy described in PR1-M1.
- Admin tests: 44 passed, 0 failed. Mobile tests: 64 passed, 0 failed. API/Admin/Mobile TypeScript checks passed. API build, Admin production build, Expo public config validation, Expo Web/iOS/Android export, and Drizzle check passed.
- `bun audit` was attempted but could not reach the audit service because TLS validation returned `SELF_SIGNED_CERT_IN_CHAIN`; this is a scanner/network failure, not a vulnerability finding. No dedicated `gitleaks`, `trivy`, `osv-scanner`, or Docker Scout scanner was installed. A bounded scan of tracked source for common credential/key patterns returned no matches; this is not full-history or entropy-based secret scanning. No dependency vulnerability result is available.
- The host shell has Node.js and installed workspace dependencies but no Bun executable; checks used the official Bun 1.4.4 container. No penetration test, external object-store verification, load test, production migration rehearsal, push send, or physical-device QA was performed for PR1.
- No penetration test, external object-store verification, load test, production migration rehearsal, push send, or physical-device QA was performed for PR1.

## Monitoring and device QA

Monitor API/Admin availability, 4xx/5xx and latency, authentication 401/429 rates, session errors, upload failures, DB connections/locks/storage/backup age, worker queue age/retries/receipts, S3 errors/capacity, host memory/disk/restarts, and TLS certificate expiry. Keep logs structured and access-controlled; redact cookies, bearer tokens, passwords, activation payloads, personal data, SQL connection strings, S3 keys, and multipart bodies at the application/proxy/collector. Establish alert owners and on-call escalation before production use.

Record each device run with build/commit, device model, OS, environment, date, tester, result (Pass/Fail/Blocked), evidence, and issue ID:

| Check | Expected result | Result / evidence |
| --- | --- | --- |
| Fresh install and first launch | No crash; activation/login entry is usable. | ___ |
| Light and Dark appearance | Text, controls, tables, photos, and dialogs remain legible. | ___ |
| Camera and photo permissions | Requested only in context; denial is recoverable. | ___ |
| QR scan and one-time activation link | Correct employee/store; expiry/single use enforced; no token in logs or UI. | ___ |
| Session restart/rotation/revocation | SecureStore restores valid session; expired/revoked session returns to login. | ___ |
| Quiz start/resume/submit | Server state and answers recover after app/network interruption. | ___ |
| Camera/gallery, HEIC/JPEG and upload retry | Supported images normalize; retry is idempotent; no public media URL. | ___ |
| Private evidence viewing | Only authorized active user/store can view; unauthorized response is denied. | ___ |
| Logout | Session and device registration are revoked/removed; protected screens are inaccessible. | ___ |
| Network loss/recovery | Clear offline feedback; no credential/session leakage; safe retry. | ___ |

## Production checklist and blockers

- [ ] VPS read-only inventory completed; resource sizing and existing proxy/network plan reviewed.
- [ ] Staging approved and isolated (host/project, domain, DB, bucket, Expo project, secrets).
- [ ] Production HTTPS and secure-cookie behavior verified; API/Admin cleartext configuration fail-closed or isolated.
- [ ] Shared/edge authentication rate limiting and alerting in place.
- [ ] Runtime/migration DB identities, grants, connection budget, TLS, backup and tested restore in place.
- [ ] Private object storage policy, retention, reconciliation and provider integration verified.
- [ ] Separate worker lifecycle, Expo credentials, receipt policy, queue alerts and no-duplicate operational recovery validated.
- [ ] CI covers API/Admin/Mobile and scans dependencies/secrets/images; branch protections require green checks.
- [ ] Staging smoke tests, browser acceptance, physical-device QA, load/capacity checks, incident contacts, rollback and restore rehearsal completed.
- [ ] Production deployment separately reviewed and explicitly approved. This document does not authorize it.

Current blockers: actual VPS inventory is unavailable; no staging deployment files/images exist; shared login throttling and production transport are not fail-closed by code; separate DB roles and connection sizing are not provisioned by the repo; backup/restore, object-store, worker monitoring, security scans and physical-device release evidence remain unverified.

## Recommended next action

Obtain a read-only inventory of the target VPS and an owner-approved staging environment manifest (domains, isolated DB/bucket/Expo project, secrets manager, backup destination, resource budget, and responsible operator). Review it before authoring staging Dockerfiles/Compose and CI security gates. Do not deploy or migrate until that review and explicit staging approval are complete.

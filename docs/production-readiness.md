# Production readiness runbook

This document describes the operational assumptions for the Vizaje Staff API. It does not create production credentials, infrastructure, or a production domain.

## Required configuration

Set these values through the deployment platform's secret/configuration manager. Do not commit a production `.env` file.

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Required. Use a private PostgreSQL endpoint and require TLS, for example with the provider's `sslmode=require` setting. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated exact `http(s)` origins. Do not use `*`. |
| `HOST`, `PORT` | Bind the API inside the runtime; expose it through the reverse proxy. |
| `LOG_LEVEL` | Usually `info` or `warn`; never log secrets or request bodies. |
| `PHOTO_STORAGE_DRIVER` | Must be `s3` in production. |
| `S3_BUCKET`, `S3_REGION` | Required for the private photo bucket. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Required secret values, scoped only to the private photo bucket. |
| `S3_ENDPOINT` | Optional for an S3-compatible provider; when set in production it must use HTTPS. |
| `PHOTO_MAX_BYTES`, `PHOTO_MAX_DIMENSION`, `PHOTO_MAX_PIXELS` | Keep aligned with proxy limits and available application memory. |

Development Compose credentials are intentionally public defaults for local use only. Never reuse them, or any local S3 credentials, in production.

## Network and browser security

Terminate HTTPS at a trusted reverse proxy or load balancer and forward only the headers it sets. The API does not blindly trust client-provided forwarding headers; configure the proxy/network so direct public access to the Bun listener is impossible. Preserve the original HTTPS scheme when proxying so secure browser cookies are appropriate.

Browser sessions use an HttpOnly, SameSite=Lax session cookie and a separate CSRF token cookie/header pair. All state-changing browser requests must send `X-CSRF-Token`. Mobile clients use bearer sessions. Do not disable CSRF validation or secure cookies in production.

`CORS_ALLOWED_ORIGINS` is an allowlist, not a reflection mechanism. Keep it limited to the actual Admin and any explicitly approved client origins. Preflight requests must be allowed only for configured origins and the required headers.

## Health, shutdown, and logs

- `GET /health` is liveness and does not access PostgreSQL.
- `GET /api/v1/health` is readiness and runs `SELECT 1`.
- Route readiness traffic to the readiness endpoint and restart only after it recovers.
- Forward SIGTERM/SIGINT to the process. The API stops accepting requests before closing the PostgreSQL pool and logs shutdown failures.
- Logs are structured JSON. Central log retention and access controls are an operational responsibility. Scrub authorization headers, cookies, passwords, activation payloads, S3 credentials, database URLs, and multipart bodies at the proxy/collector as well.

## PostgreSQL backup and restore

Create encrypted, access-controlled custom-format backups from an operator host:

```bash
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > vizaje-staff-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Restore only into a newly provisioned or explicitly disposable database. Never run this procedure with `--clean` against production or a shared database:

```bash
createdb "$RESTORE_DATABASE_URL"
pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" backup.dump
```

For a local drill, start a disposable PostgreSQL container, apply `bun run db:migrate`, insert dummy fixtures, dump it, restore to a second disposable container, and compare table counts and representative rows. Remove only those named disposable containers after the drill. Verify that backups are encrypted at rest and that restore credentials are not committed.

## Photo storage and reconciliation

Photos use a private S3-compatible bucket. Disable public access and anonymous listing; grant the API identity only the object operations required for its photo prefix. Object keys are UUID-based and database records contain the authoritative key.

Deletion is intentionally retry-based: the API deletes the object first, then metadata. If object deletion fails, the row remains and the API returns `503`. If the metadata delete fails after object deletion, the row remains and a repeated delete is safe because S3 deletion is idempotent. This can temporarily create metadata without an object, but it does not silently claim success.

Reconcile periodically without a queue:

1. Export `photos.id`, `photos.storage_key`, and `photos.created_at` from PostgreSQL.
2. List objects under the configured photo prefix using the provider's inventory or CLI and compare keys to the export.
3. For database rows with missing objects, retry retrieval/deletion as appropriate and flag them for manual review; do not fabricate replacement metadata.
4. For objects with no database row, quarantine them or retain them through the agreed retention window, then delete only after manual confirmation.
5. Record the comparison timestamp, operator, bucket/prefix, and actions taken. Never expose storage keys or credentials in application responses or public logs.

External S3 behavior is not verified by the repository test suite without provider credentials. Local filesystem storage tests do not replace an S3 integration test.

## Capacity assumptions

Dashboard analytics use PostgreSQL aggregates and indexed scope predicates, but no load test or materialized aggregation exists. Quiz listing and some result views still perform multiple application queries per page. Photo download and upload hold bounded buffers in process: the request is limited by multipart/body and image byte limits, while Sharp creates a normalized output buffer. Validate concurrency and memory against the selected runtime size before raising limits.

The initial baseline assumes a small internal deployment (single API process, up to roughly hundreds of active staff, low thousands of photos/quiz attempts) and should be revisited with production-like data before materially increasing traffic or upload limits.

Login and activation throttling is intentionally in-process and bounded. It reduces repeated attempts on a single API process, but it is not a shared distributed rate limiter; add an approved edge/shared limiter before running multiple API replicas or exposing authentication endpoints to untrusted public traffic.

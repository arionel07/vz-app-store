# Уведомления и объявления

Milestone 17 использует PostgreSQL как единственный durable source для
уведомлений. Изменение бизнес-сущности и запись `domain_events` происходят в
одной транзакции; отдельный worker читает события, создаёт inbox-записи и
планирует push-доставку. Redis, брокер и общий proxy не используются.

## API

Mobile endpoints:

- `GET /api/v1/me/notifications`
- `GET /api/v1/me/notifications/unread-count`
- `POST /api/v1/me/notifications/:id/read`
- `POST /api/v1/me/notifications/:id/acknowledge`
- `GET/PATCH /api/v1/me/notification-preferences`
- `POST /api/v1/me/push-devices` and `DELETE /api/v1/me/push-devices/:deviceId`
- `GET /api/v1/me/announcements/:id`

Admin/manager endpoints:

- `GET/POST /api/v1/management/announcements`
- `GET/PATCH /api/v1/management/announcements/:id`
- `POST /api/v1/management/announcements/:id/publish`

Web Admin calls only the corresponding explicit `/api/admin/announcements`
BFF routes. The BFF forwards only the session cookie and CSRF header; it is not
an arbitrary API proxy. API services enforce role and store scope again.

## Worker

Run from the repository root with the API environment and an already migrated
database:

```bash
bun run --cwd apps/api db:migrate
bun run --cwd apps/api notifications:worker
```

For a bounded smoke cycle:

```bash
bun run --cwd apps/api notifications:worker -- --once
```

The worker claims outbox rows with `FOR UPDATE SKIP LOCKED`, uses bounded
exponential backoff, caps attempts, invalidates rejected Expo tokens, and keeps
provider ticket IDs separate from receipt processing. `EXPO_PUSH_ACCESS_TOKEN`
is optional and must be supplied only through a secret environment mechanism.
No push token or session credential is logged.

## Targeting and deep links

Announcement targeting is stored as normalized store and role targets. Managers
can target active staff in their assigned stores; administrators can target
staff or managers and may publish network-wide messages. Recipients are resolved
at publication/event consumption and only active users receive notifications.

Mobile push payloads contain only an allowlisted `{ kind, id }` target. The app
maps it to known task, quiz, attempt, schedule, photo, or announcement routes;
arbitrary URLs are rejected. Inbox messages remain available when push is
denied, and no secrets are placed in notification payloads.

Push permission is requested from the inbox context. Device registration is
removed during logout, and multiple devices can be registered for one employee.

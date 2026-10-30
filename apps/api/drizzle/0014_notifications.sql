CREATE TYPE "public"."notification_target_kind" AS ENUM('task', 'photo_report', 'quiz', 'attempt', 'schedule', 'announcement');
CREATE TYPE "public"."notification_outbox_status" AS ENUM('pending', 'claimed', 'accepted', 'retry', 'permanent');
CREATE TYPE "public"."push_platform" AS ENUM('ios', 'android');
CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'published', 'archived');

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source_event_id" uuid REFERENCES "domain_events"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "category" text NOT NULL CHECK ("category" IN ('task', 'quiz', 'schedule', 'photo', 'announcement')),
  "title" text NOT NULL,
  "body" text NOT NULL,
  "target_kind" "notification_target_kind",
  "target_id" uuid,
  "requires_acknowledgement" boolean NOT NULL DEFAULT false,
  "read_at" timestamptz,
  "acknowledged_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "notifications_event_recipient_unique" ON "notifications" ("source_event_id", "recipient_user_id");
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" ("recipient_user_id", "created_at");
CREATE INDEX "notifications_recipient_read_idx" ON "notifications" ("recipient_user_id", "read_at", "created_at");
CREATE INDEX "notifications_target_idx" ON "notifications" ("target_kind", "target_id");

CREATE TABLE "push_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL,
  "platform" "push_platform" NOT NULL,
  "expo_push_token" text NOT NULL,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "invalidated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "push_devices_user_device_unique" ON "push_devices" ("user_id", "device_id");
CREATE UNIQUE INDEX "push_devices_token_unique" ON "push_devices" ("expo_push_token");
CREATE INDEX "push_devices_user_active_idx" ON "push_devices" ("user_id", "invalidated_at");

CREATE TABLE "notification_preferences" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "push_enabled" boolean NOT NULL DEFAULT true,
  "task_notifications" boolean NOT NULL DEFAULT true,
  "quiz_notifications" boolean NOT NULL DEFAULT true,
  "schedule_notifications" boolean NOT NULL DEFAULT true,
  "photo_review_notifications" boolean NOT NULL DEFAULT true,
  "announcement_notifications" boolean NOT NULL DEFAULT true,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "notification_event_consumptions" (
  "domain_event_id" uuid PRIMARY KEY REFERENCES "domain_events"("id") ON DELETE CASCADE,
  "consumed_at" timestamptz NOT NULL DEFAULT now(),
  "attempts" integer NOT NULL DEFAULT 1,
  "last_error" text
);

CREATE TABLE "notification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_id" uuid NOT NULL REFERENCES "notifications"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL REFERENCES "push_devices"("id") ON DELETE CASCADE,
  "channel" text NOT NULL DEFAULT 'push' CHECK ("channel" = 'push'),
  "status" "notification_outbox_status" NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "claimed_at" timestamptz,
  "provider_ticket_id" text,
  "provider_receipt_id" text,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "notification_outbox_notification_device_unique" ON "notification_outbox" ("notification_id", "device_id");
CREATE INDEX "notification_outbox_claim_idx" ON "notification_outbox" ("status", "next_attempt_at", "created_at");
CREATE INDEX "notification_outbox_ticket_idx" ON "notification_outbox" ("provider_ticket_id");

CREATE TABLE "announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "status" "announcement_status" NOT NULL DEFAULT 'draft',
  "requires_acknowledgement" boolean NOT NULL DEFAULT false,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "published_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "published_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "announcements_status_created_idx" ON "announcements" ("status", "created_at");

CREATE TABLE "announcement_store_targets" (
  "announcement_id" uuid NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE RESTRICT,
  PRIMARY KEY ("announcement_id", "store_id")
);
CREATE INDEX "announcement_store_targets_store_idx" ON "announcement_store_targets" ("store_id");

CREATE TABLE "announcement_role_targets" (
  "announcement_id" uuid NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
  "role" "user_role" NOT NULL,
  PRIMARY KEY ("announcement_id", "role")
);

CREATE TABLE "announcement_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "announcement_id" uuid NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "announcement_history_announcement_created_idx" ON "announcement_history" ("announcement_id", "created_at");

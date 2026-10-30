CREATE TABLE "notification_delivery_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outbox_id" uuid NOT NULL REFERENCES "notification_outbox"("id") ON DELETE CASCADE,
  "attempt_number" integer NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('accepted', 'retry', 'permanent')),
  "error_code" text,
  "provider_ticket_id" text,
  "provider_receipt_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "notification_delivery_attempts_number_unique" ON "notification_delivery_attempts" ("outbox_id", "attempt_number");
CREATE INDEX "notification_delivery_attempts_outbox_created_idx" ON "notification_delivery_attempts" ("outbox_id", "created_at");

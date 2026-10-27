ALTER TABLE "photos" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "idempotency_payload_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_uploaded_by_idempotency_unique" ON "photos" USING btree ("uploaded_by","idempotency_key");
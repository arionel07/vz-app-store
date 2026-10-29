ALTER TABLE "photo_review_history" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "photo_review_history_idempotency_unique" ON "photo_review_history" USING btree ("version_id","actor_id","idempotency_key");

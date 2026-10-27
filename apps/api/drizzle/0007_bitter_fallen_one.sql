CREATE INDEX "photos_created_idx" ON "photos" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "quiz_attempts_submitted_idx" ON "quiz_attempts" USING btree ("status","submitted_at");
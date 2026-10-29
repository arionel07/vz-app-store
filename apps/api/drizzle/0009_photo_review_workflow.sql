CREATE TYPE "photo_review_status" AS ENUM ('pending', 'checked', 'rejected');
--> statement-breakpoint
CREATE TABLE "photo_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "photo_review_status" DEFAULT 'pending' NOT NULL,
	"rejection_comment" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_review_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"from_status" "photo_review_status",
	"to_status" "photo_review_status" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"actor_id" uuid,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo_reports" ADD CONSTRAINT "photo_reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photo_reports" ADD CONSTRAINT "photo_reports_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photo_report_versions" ADD CONSTRAINT "photo_report_versions_report_id_photo_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."photo_reports"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photo_report_versions" ADD CONSTRAINT "photo_report_versions_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photo_report_versions" ADD CONSTRAINT "photo_report_versions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photo_review_history" ADD CONSTRAINT "photo_review_history_report_id_photo_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."photo_reports"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photo_review_history" ADD CONSTRAINT "photo_review_history_version_id_photo_report_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."photo_report_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photo_review_history" ADD CONSTRAINT "photo_review_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "photo_reports_store_updated_idx" ON "photo_reports" USING btree ("store_id","updated_at");
--> statement-breakpoint
CREATE INDEX "photo_reports_submitted_updated_idx" ON "photo_reports" USING btree ("submitted_by","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "photo_report_versions_report_number_unique" ON "photo_report_versions" USING btree ("report_id","version_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "photo_report_versions_photo_unique" ON "photo_report_versions" USING btree ("photo_id");
--> statement-breakpoint
CREATE INDEX "photo_report_versions_report_status_idx" ON "photo_report_versions" USING btree ("report_id","status");
--> statement-breakpoint
CREATE INDEX "photo_review_history_report_created_idx" ON "photo_review_history" USING btree ("report_id","created_at");
--> statement-breakpoint
CREATE INDEX "photo_review_history_version_created_idx" ON "photo_review_history" USING btree ("version_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_type_aggregate_created_unique" ON "domain_events" USING btree ("event_type","aggregate_id","created_at");
--> statement-breakpoint
CREATE INDEX "domain_events_aggregate_idx" ON "domain_events" USING btree ("aggregate_type","aggregate_id");
--> statement-breakpoint
CREATE INDEX "domain_events_occurred_idx" ON "domain_events" USING btree ("occurred_at");
--> statement-breakpoint
INSERT INTO "photo_reports" ("id", "store_id", "submitted_by", "created_at", "updated_at")
SELECT "id", "store_id", "uploaded_by", "created_at", "created_at" FROM "photos";
--> statement-breakpoint
INSERT INTO "photo_report_versions" ("id", "report_id", "photo_id", "version_number", "status", "submitted_at", "created_at")
SELECT "id", "id", "id", 1, 'pending', "created_at", "created_at" FROM "photos";
--> statement-breakpoint
INSERT INTO "photo_review_history" ("report_id", "version_id", "actor_id", "from_status", "to_status", "comment", "created_at")
SELECT "id", "id", "uploaded_by", NULL, 'pending', 'Историческая загрузка: фотография не считалась проверенной', "created_at" FROM "photos";

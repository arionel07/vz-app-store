CREATE TYPE "task_priority" AS ENUM ('low', 'normal', 'high', 'urgent');
--> statement-breakpoint
CREATE TYPE "task_status" AS ENUM ('assigned', 'in_progress', 'submitted', 'checked', 'rejected');
--> statement-breakpoint
CREATE TYPE "task_submission_status" AS ENUM ('submitted', 'checked', 'rejected');
--> statement-breakpoint
CREATE TYPE "task_recurrence_frequency" AS ENUM ('daily', 'weekly', 'monthly');
--> statement-breakpoint
CREATE TABLE "task_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL, "description" text, "category" text NOT NULL,
  "default_priority" "task_priority" DEFAULT 'normal' NOT NULL,
  "requires_review" boolean DEFAULT true NOT NULL, "requires_photo" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL, "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_template_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "template_id" uuid NOT NULL,
  "version" integer NOT NULL, "title" text NOT NULL, "description" text, "category" text NOT NULL,
  "priority" "task_priority" NOT NULL, "requires_review" boolean NOT NULL, "requires_photo" boolean NOT NULL,
  "created_by" uuid NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_template_checklist_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "version_id" uuid NOT NULL,
  "position" integer NOT NULL, "label" text NOT NULL, "is_required" boolean DEFAULT true NOT NULL, "requires_evidence" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_recurrences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "template_version_id" uuid NOT NULL, "store_id" uuid NOT NULL,
  "employee_ids" jsonb DEFAULT '[]'::jsonb NOT NULL, "roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "frequency" "task_recurrence_frequency" NOT NULL, "interval" integer DEFAULT 1 NOT NULL, "weekday" integer, "month_day" integer,
  "starts_on" date NOT NULL, "ends_on" date, "timezone" text DEFAULT 'Europe/Chisinau' NOT NULL, "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_occurrences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "assignment_group_id" uuid NOT NULL, "recurrence_id" uuid,
  "recurrence_local_date" date, "template_id" uuid, "template_version_id" uuid, "store_id" uuid NOT NULL, "assigned_employee_id" uuid NOT NULL,
  "title" text NOT NULL, "description" text, "category" text NOT NULL, "priority" "task_priority" DEFAULT 'normal' NOT NULL,
  "due_at" timestamp with time zone, "timezone" text DEFAULT 'Europe/Chisinau' NOT NULL, "status" "task_status" DEFAULT 'assigned' NOT NULL,
  "requires_review" boolean DEFAULT true NOT NULL, "requires_photo" boolean DEFAULT false NOT NULL, "version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone, "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "task_id" uuid NOT NULL, "position" integer NOT NULL, "label" text NOT NULL,
  "is_required" boolean DEFAULT true NOT NULL, "requires_evidence" boolean DEFAULT false NOT NULL, "completed" boolean DEFAULT false NOT NULL,
  "note" text, "completed_by" uuid, "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "task_id" uuid NOT NULL, "submitted_by" uuid NOT NULL, "submission_version" integer NOT NULL,
  "status" "task_submission_status" DEFAULT 'submitted' NOT NULL, "answers" jsonb DEFAULT '[]'::jsonb NOT NULL, "completion_note" text,
  "reviewer_comment" text, "idempotency_key" text, "idempotency_payload_hash" text, "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone, "reviewed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "task_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "task_id" uuid NOT NULL, "submission_id" uuid, "uploaded_by" uuid NOT NULL,
  "storage_key" text NOT NULL, "idempotency_key" text, "idempotency_payload_hash" text, "original_filename" text NOT NULL,
  "mime_type" text NOT NULL, "file_size" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_review_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "task_id" uuid NOT NULL, "submission_id" uuid, "actor_id" uuid NOT NULL,
  "action" text NOT NULL, "previous_status" "task_status", "next_status" "task_status" NOT NULL, "comment" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_template_versions" ADD CONSTRAINT "task_template_versions_template_id_task_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."task_templates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_template_versions" ADD CONSTRAINT "task_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_template_checklist_items" ADD CONSTRAINT "task_template_checklist_items_version_id_task_template_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."task_template_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_template_version_id_task_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."task_template_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_recurrence_id_task_recurrences_id_fk" FOREIGN KEY ("recurrence_id") REFERENCES "public"."task_recurrences"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_template_id_task_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."task_templates"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_template_version_id_task_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."task_template_versions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_assigned_employee_id_users_id_fk" FOREIGN KEY ("assigned_employee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_task_occurrences_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task_occurrences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_task_id_task_occurrences_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task_occurrences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_task_id_task_occurrences_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task_occurrences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_submission_id_task_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."task_submissions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_review_history" ADD CONSTRAINT "task_review_history_task_id_task_occurrences_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task_occurrences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_review_history" ADD CONSTRAINT "task_review_history_submission_id_task_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."task_submissions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_review_history" ADD CONSTRAINT "task_review_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_templates_active_idx" ON "task_templates" USING btree ("active", "updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "task_template_versions_template_number_unique" ON "task_template_versions" USING btree ("template_id", "version");
--> statement-breakpoint
CREATE INDEX "task_template_versions_template_idx" ON "task_template_versions" USING btree ("template_id", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "task_template_checklist_position_unique" ON "task_template_checklist_items" USING btree ("version_id", "position");
--> statement-breakpoint
CREATE INDEX "task_recurrences_active_idx" ON "task_recurrences" USING btree ("active", "starts_on", "ends_on");
--> statement-breakpoint
CREATE INDEX "task_recurrences_store_idx" ON "task_recurrences" USING btree ("store_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "task_occurrences_recurrence_employee_date_unique" ON "task_occurrences" USING btree ("recurrence_id", "store_id", "assigned_employee_id", "recurrence_local_date");
--> statement-breakpoint
CREATE INDEX "task_occurrences_store_status_idx" ON "task_occurrences" USING btree ("store_id", "status", "due_at");
--> statement-breakpoint
CREATE INDEX "task_occurrences_employee_status_idx" ON "task_occurrences" USING btree ("assigned_employee_id", "status", "due_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "task_checklist_items_task_position_unique" ON "task_checklist_items" USING btree ("task_id", "position");
--> statement-breakpoint
CREATE INDEX "task_checklist_items_task_idx" ON "task_checklist_items" USING btree ("task_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "task_submissions_task_version_unique" ON "task_submissions" USING btree ("task_id", "submission_version");
--> statement-breakpoint
CREATE UNIQUE INDEX "task_submissions_idempotency_unique" ON "task_submissions" USING btree ("task_id", "submitted_by", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "task_submissions_review_idx" ON "task_submissions" USING btree ("status", "submitted_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "task_evidence_storage_key_unique" ON "task_evidence" USING btree ("storage_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "task_evidence_uploader_idempotency_unique" ON "task_evidence" USING btree ("task_id", "uploaded_by", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "task_evidence_task_idx" ON "task_evidence" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "task_evidence_submission_idx" ON "task_evidence" USING btree ("submission_id");
--> statement-breakpoint
CREATE INDEX "task_review_history_task_idx" ON "task_review_history" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "task_review_history_submission_idx" ON "task_review_history" USING btree ("submission_id", "created_at");

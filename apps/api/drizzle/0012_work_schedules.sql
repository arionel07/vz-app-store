CREATE TYPE "schedule_status" AS ENUM ('draft', 'published');
--> statement-breakpoint
CREATE TABLE "schedule_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "timezone" text DEFAULT 'Europe/Chisinau' NOT NULL,
  "status" "schedule_status" DEFAULT 'draft' NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "superseded_at" timestamp with time zone,
  "created_by" uuid NOT NULL,
  "published_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone,
  CONSTRAINT "schedule_periods_date_order_check" CHECK ("start_date" <= "end_date")
);
--> statement-breakpoint
CREATE TABLE "schedule_shifts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "period_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "local_date" date NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "start_at" timestamp with time zone NOT NULL,
  "end_at" timestamp with time zone NOT NULL,
  "timezone" text NOT NULL,
  "note" text,
  "created_by" uuid NOT NULL,
  "updated_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "schedule_shifts_time_order_check" CHECK ("start_at" < "end_at")
);
--> statement-breakpoint
CREATE TABLE "schedule_days_off" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "period_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "local_date" date NOT NULL,
  "note" text,
  "created_by" uuid NOT NULL,
  "updated_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schedule_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid,
  "before" jsonb,
  "after" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_shifts" ADD CONSTRAINT "schedule_shifts_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_shifts" ADD CONSTRAINT "schedule_shifts_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_shifts" ADD CONSTRAINT "schedule_shifts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_shifts" ADD CONSTRAINT "schedule_shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_shifts" ADD CONSTRAINT "schedule_shifts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_days_off" ADD CONSTRAINT "schedule_days_off_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_days_off" ADD CONSTRAINT "schedule_days_off_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_days_off" ADD CONSTRAINT "schedule_days_off_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_days_off" ADD CONSTRAINT "schedule_days_off_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_days_off" ADD CONSTRAINT "schedule_days_off_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_history" ADD CONSTRAINT "schedule_history_schedule_id_schedule_periods_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule_periods"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_history" ADD CONSTRAINT "schedule_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "schedule_periods_store_dates_idx" ON "schedule_periods" USING btree ("store_id", "start_date", "end_date");
--> statement-breakpoint
CREATE INDEX "schedule_periods_status_idx" ON "schedule_periods" USING btree ("status", "superseded_at");
--> statement-breakpoint
CREATE INDEX "schedule_shifts_period_date_idx" ON "schedule_shifts" USING btree ("period_id", "local_date");
--> statement-breakpoint
CREATE INDEX "schedule_shifts_employee_time_idx" ON "schedule_shifts" USING btree ("employee_id", "start_at", "end_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_days_off_employee_date_unique" ON "schedule_days_off" USING btree ("period_id", "employee_id", "local_date");
--> statement-breakpoint
CREATE INDEX "schedule_days_off_period_date_idx" ON "schedule_days_off" USING btree ("period_id", "local_date");
--> statement-breakpoint
CREATE INDEX "schedule_history_schedule_created_idx" ON "schedule_history" USING btree ("schedule_id", "created_at");

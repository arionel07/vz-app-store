CREATE TYPE "public"."quiz_assignment_mode" AS ENUM('all', 'selected');--> statement-breakpoint
CREATE TYPE "public"."quiz_attempt_status" AS ENUM('in_progress', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."quiz_lifecycle" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."quiz_revision_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "quiz_assignments" (
	"revision_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_assignments_revision_id_store_id_pk" PRIMARY KEY("revision_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "quiz_attempt_answers" (
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"option_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_attempt_answers_attempt_id_question_id_pk" PRIMARY KEY("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "quiz_attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"score_percent" integer,
	"passed" boolean,
	CONSTRAINT "quiz_attempts_score_check" CHECK ("quiz_attempts"."score_percent" is null or "quiz_attempts"."score_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "quiz_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "quiz_revision_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"passing_score" integer NOT NULL,
	"assignment_mode" "quiz_assignment_mode" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "quiz_revisions_passing_score_check" CHECK ("quiz_revisions"."passing_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "quiz_lifecycle" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quiz_assignments" ADD CONSTRAINT "quiz_assignments_revision_id_quiz_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quiz_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_assignments" ADD CONSTRAINT "quiz_assignments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_option_id_quiz_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."quiz_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_revision_id_quiz_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quiz_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_options" ADD CONSTRAINT "quiz_options_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_revision_id_quiz_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quiz_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD CONSTRAINT "quiz_revisions_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiz_assignments_store_idx" ON "quiz_assignments" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "quiz_attempt_answers_option_idx" ON "quiz_attempt_answers" USING btree ("option_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_attempts_active_unique" ON "quiz_attempts" USING btree ("user_id","revision_id") WHERE "quiz_attempts"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "quiz_attempts_user_idx" ON "quiz_attempts" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "quiz_attempts_quiz_idx" ON "quiz_attempts" USING btree ("quiz_id","revision_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_options_question_position_unique" ON "quiz_options" USING btree ("question_id","position");--> statement-breakpoint
CREATE INDEX "quiz_options_question_idx" ON "quiz_options" USING btree ("question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_questions_revision_position_unique" ON "quiz_questions" USING btree ("revision_id","position");--> statement-breakpoint
CREATE INDEX "quiz_questions_revision_idx" ON "quiz_questions" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_revisions_quiz_number_unique" ON "quiz_revisions" USING btree ("quiz_id","revision_number");--> statement-breakpoint
CREATE INDEX "quiz_revisions_status_idx" ON "quiz_revisions" USING btree ("quiz_id","status","revision_number");--> statement-breakpoint
CREATE INDEX "quizzes_status_idx" ON "quizzes" USING btree ("status");
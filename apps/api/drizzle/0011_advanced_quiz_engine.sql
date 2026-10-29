CREATE TYPE "quiz_assessment_mode" AS ENUM ('exam', 'practice', 'survey');
--> statement-breakpoint
CREATE TYPE "quiz_question_type" AS ENUM ('single_choice', 'multiple_choice', 'weighted_choice', 'free_text', 'opinion', 'rating', 'scenario', 'photo_answer');
--> statement-breakpoint
CREATE TYPE "quiz_scoring_policy" AS ENUM ('all_or_nothing', 'partial_credit');
--> statement-breakpoint
CREATE TYPE "quiz_review_status" AS ENUM ('not_required', 'pending', 'completed');
--> statement-breakpoint
CREATE TYPE "quiz_answer_review_status" AS ENUM ('not_required', 'pending', 'reviewed');
--> statement-breakpoint
CREATE TYPE "quiz_assignment_target_type" AS ENUM ('store', 'role', 'user');
--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD COLUMN "assessment_mode" "quiz_assessment_mode" DEFAULT 'exam' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD COLUMN "max_attempts" integer;
--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD COLUMN "available_from" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD COLUMN "deadline" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD COLUMN "time_limit_seconds" integer;
--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD COLUMN "randomize_questions" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD COLUMN "randomize_options" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD COLUMN "show_results" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD COLUMN "show_explanations" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_revisions" ADD COLUMN "scoring_policy_version" text DEFAULT 'v1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "description" text;
--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "question_type" "quiz_question_type" DEFAULT 'single_choice' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "max_points" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "scoring_policy" "quiz_scoring_policy" DEFAULT 'all_or_nothing' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_options" ADD COLUMN "points" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_options" ADD COLUMN "explanation" text;
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "review_status" "quiz_review_status" DEFAULT 'not_required' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "finalized_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "question_order" jsonb;
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "option_order" jsonb;
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "scoring_policy_version" text DEFAULT 'v1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD COLUMN "option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD COLUMN "text_answer" text;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD COLUMN "rating" integer;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD COLUMN "photo_id" uuid;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD COLUMN "answer_payload" jsonb;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD COLUMN "earned_points" integer;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD COLUMN "max_points" integer;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD COLUMN "review_status" "quiz_answer_review_status" DEFAULT 'not_required' NOT NULL;
--> statement-breakpoint
CREATE TABLE "quiz_assignment_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"target_type" "quiz_assignment_target_type" NOT NULL,
	"store_id" uuid,
	"role" "user_role",
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_answer_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"status" "quiz_answer_review_status" DEFAULT 'pending' NOT NULL,
	"awarded_points" integer,
	"max_points" integer NOT NULL,
	"feedback" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_answer_review_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"previous_points" integer,
	"awarded_points" integer NOT NULL,
	"feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_answer_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_assignment_targets" ADD CONSTRAINT "quiz_assignment_targets_revision_id_quiz_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quiz_revisions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_assignment_targets" ADD CONSTRAINT "quiz_assignment_targets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_assignment_targets" ADD CONSTRAINT "quiz_assignment_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_answer_reviews" ADD CONSTRAINT "quiz_answer_reviews_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_answer_reviews" ADD CONSTRAINT "quiz_answer_reviews_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_answer_reviews" ADD CONSTRAINT "quiz_answer_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_answer_review_history" ADD CONSTRAINT "quiz_answer_review_history_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_answer_review_history" ADD CONSTRAINT "quiz_answer_review_history_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_answer_review_history" ADD CONSTRAINT "quiz_answer_review_history_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_answer_photos" ADD CONSTRAINT "quiz_answer_photos_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_answer_photos" ADD CONSTRAINT "quiz_answer_photos_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_answer_photos" ADD CONSTRAINT "quiz_answer_photos_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_answer_photos" ADD CONSTRAINT "quiz_answer_photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_assignment_targets_revision_target_unique" ON "quiz_assignment_targets" USING btree ("revision_id","target_type","store_id","role","user_id");
--> statement-breakpoint
CREATE INDEX "quiz_assignment_targets_revision_idx" ON "quiz_assignment_targets" USING btree ("revision_id");
--> statement-breakpoint
CREATE INDEX "quiz_assignment_targets_user_idx" ON "quiz_assignment_targets" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_answer_reviews_attempt_question_unique" ON "quiz_answer_reviews" USING btree ("attempt_id","question_id");
--> statement-breakpoint
CREATE INDEX "quiz_answer_reviews_status_idx" ON "quiz_answer_reviews" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "quiz_answer_review_history_answer_idx" ON "quiz_answer_review_history" USING btree ("attempt_id","question_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_answer_photos_attempt_question_unique" ON "quiz_answer_photos" USING btree ("attempt_id","question_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_answer_photos_photo_unique" ON "quiz_answer_photos" USING btree ("photo_id");

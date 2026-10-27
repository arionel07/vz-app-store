CREATE TYPE "public"."session_type" AS ENUM('browser', 'mobile');--> statement-breakpoint
CREATE TABLE "activation_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "session_type" NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token_hash" text,
	"device_id" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"max_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "activation_tokens" ADD CONSTRAINT "activation_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_tokens" ADD CONSTRAINT "activation_tokens_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_tokens" ADD CONSTRAINT "activation_tokens_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activation_tokens_secret_hash_unique" ON "activation_tokens" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "activation_tokens_user_active_idx" ON "activation_tokens" USING btree ("user_id","consumed_at","expires_at");--> statement-breakpoint
CREATE INDEX "activation_tokens_requested_by_idx" ON "activation_tokens" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "sessions_device_idx" ON "sessions" USING btree ("user_id","device_id");
CREATE TYPE "public"."user_role" AS ENUM('admin', 'manager', 'staff');--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_stores" (
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_stores_user_id_store_id_pk" PRIMARY KEY("user_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"email" text,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_e164_check" CHECK ("users"."phone" is null or "users"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stores_code_unique" ON "stores" USING btree ("code");--> statement-breakpoint
CREATE INDEX "stores_active_idx" ON "stores" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "user_stores_user_idx" ON "user_stores" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_stores_store_idx" ON "user_stores" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_ci_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_active_idx" ON "users" USING btree ("role","is_active");--> statement-breakpoint
CREATE INDEX "users_name_idx" ON "users" USING btree ("last_name","first_name");
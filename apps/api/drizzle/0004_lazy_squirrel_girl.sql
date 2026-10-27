CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_file_size_positive_check" CHECK ("photos"."file_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_storage_key_unique" ON "photos" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "photos_store_created_idx" ON "photos" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "photos_uploaded_by_created_idx" ON "photos" USING btree ("uploaded_by","created_at");
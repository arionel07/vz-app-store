ALTER TYPE "public"."notification_target_kind" ADD VALUE IF NOT EXISTS 'knowledge';
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_category_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_category_check" CHECK ("category" IN ('task', 'quiz', 'schedule', 'photo', 'announcement', 'knowledge'));

CREATE TYPE "public"."knowledge_article_status" AS ENUM('draft', 'published', 'archived');
CREATE TYPE "public"."knowledge_revision_status" AS ENUM('draft', 'published', 'archived');
CREATE TYPE "public"."knowledge_content_format" AS ENUM('markdown');
CREATE TYPE "public"."knowledge_visibility_kind" AS ENUM('all', 'store', 'role');

CREATE TABLE "knowledge_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "parent_id" uuid,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "knowledge_categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "knowledge_categories"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "knowledge_categories_slug_unique" ON "knowledge_categories" ("slug");
CREATE INDEX "knowledge_categories_parent_idx" ON "knowledge_categories" ("parent_id", "sort_order");

CREATE TABLE "knowledge_articles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category_id" uuid NOT NULL REFERENCES "knowledge_categories"("id") ON DELETE RESTRICT,
  "status" "knowledge_article_status" NOT NULL DEFAULT 'draft',
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "current_draft_revision_id" uuid,
  "published_revision_id" uuid,
  "requires_acknowledgement" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz,
  "archived_at" timestamptz
);
CREATE INDEX "knowledge_articles_status_updated_idx" ON "knowledge_articles" ("status", "updated_at");
CREATE INDEX "knowledge_articles_category_idx" ON "knowledge_articles" ("category_id", "status");

CREATE TABLE "knowledge_article_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "article_id" uuid NOT NULL REFERENCES "knowledge_articles"("id") ON DELETE CASCADE,
  "revision_number" integer NOT NULL,
  "status" "knowledge_revision_status" NOT NULL DEFAULT 'draft',
  "title" text NOT NULL,
  "summary" text,
  "body" text NOT NULL,
  "content_format" "knowledge_content_format" NOT NULL DEFAULT 'markdown',
  "content_version" integer NOT NULL DEFAULT 1,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "published_at" timestamptz
);
CREATE UNIQUE INDEX "knowledge_revisions_article_number_unique" ON "knowledge_article_revisions" ("article_id", "revision_number");
CREATE INDEX "knowledge_revisions_article_status_idx" ON "knowledge_article_revisions" ("article_id", "status");
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_draft_revision_fk" FOREIGN KEY ("current_draft_revision_id") REFERENCES "knowledge_article_revisions"("id") ON DELETE SET NULL;
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_published_revision_fk" FOREIGN KEY ("published_revision_id") REFERENCES "knowledge_article_revisions"("id") ON DELETE SET NULL;
CREATE INDEX "knowledge_articles_draft_revision_idx" ON "knowledge_articles" ("current_draft_revision_id");
CREATE INDEX "knowledge_articles_published_revision_idx" ON "knowledge_articles" ("published_revision_id");

CREATE TABLE "knowledge_visibility_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "article_id" uuid NOT NULL REFERENCES "knowledge_articles"("id") ON DELETE CASCADE,
  "kind" "knowledge_visibility_kind" NOT NULL,
  "store_id" uuid REFERENCES "stores"("id") ON DELETE RESTRICT,
  "role" "user_role",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "knowledge_visibility_target_shape_check" CHECK (
    ("kind" = 'all' AND "store_id" IS NULL AND "role" IS NULL)
    OR ("kind" = 'store' AND "store_id" IS NOT NULL AND "role" IS NULL)
    OR ("kind" = 'role' AND "role" IN ('staff', 'manager'))
  )
);
CREATE UNIQUE INDEX "knowledge_visibility_target_unique" ON "knowledge_visibility_targets" ("article_id", "kind", "store_id", "role");
CREATE INDEX "knowledge_visibility_target_store_idx" ON "knowledge_visibility_targets" ("store_id", "kind");

CREATE TABLE "knowledge_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "revision_id" uuid NOT NULL REFERENCES "knowledge_article_revisions"("id") ON DELETE CASCADE,
  "storage_key" text NOT NULL,
  "original_filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "uploaded_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "knowledge_attachments_size_check" CHECK ("file_size" > 0 AND "file_size" <= 10485760),
  CONSTRAINT "knowledge_attachments_mime_check" CHECK ("mime_type" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'))
);
CREATE UNIQUE INDEX "knowledge_attachments_storage_key_unique" ON "knowledge_attachments" ("storage_key");
CREATE INDEX "knowledge_attachments_revision_idx" ON "knowledge_attachments" ("revision_id", "created_at");

CREATE TABLE "knowledge_article_quiz_links" (
  "article_id" uuid NOT NULL REFERENCES "knowledge_articles"("id") ON DELETE CASCADE,
  "quiz_id" uuid NOT NULL REFERENCES "quizzes"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("article_id", "quiz_id")
);
CREATE INDEX "knowledge_article_quiz_links_quiz_idx" ON "knowledge_article_quiz_links" ("quiz_id");

CREATE TABLE "knowledge_acknowledgments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "article_id" uuid NOT NULL REFERENCES "knowledge_articles"("id") ON DELETE RESTRICT,
  "revision_id" uuid NOT NULL REFERENCES "knowledge_article_revisions"("id") ON DELETE RESTRICT,
  "acknowledged_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "knowledge_ack_employee_revision_unique" ON "knowledge_acknowledgments" ("employee_id", "revision_id");
CREATE INDEX "knowledge_ack_article_idx" ON "knowledge_acknowledgments" ("article_id", "acknowledged_at");
CREATE INDEX "knowledge_ack_employee_idx" ON "knowledge_acknowledgments" ("employee_id", "acknowledged_at");

CREATE INDEX "knowledge_revisions_search_idx" ON "knowledge_article_revisions" USING gin (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("summary", '') || ' ' || "body"));

INSERT INTO "knowledge_categories" ("name", "slug", "description", "sort_order") VALUES
  ('Бренды', 'brendy', 'История и стандарты брендов.', 10),
  ('Продукция', 'produkciya', 'Описание продукции и рекомендации.', 20),
  ('Уход за кожей', 'uhod-za-kozhey', 'Материалы по уходу за кожей.', 30),
  ('Парфюмерия', 'parfyumeriya', 'Ноты, семейства и консультации.', 40),
  ('Макияж', 'makiyazh', 'Техники и рекомендации по макияжу.', 50),
  ('Обслуживание клиентов', 'obsluzhivanie-klientov', 'Стандарты клиентского сервиса.', 60),
  ('Правила магазина', 'pravila-magazina', 'Внутренние правила и процессы.', 70),
  ('Акции и промо', 'akcii-i-promo', 'Актуальные акции и промо-материалы.', 80)
ON CONFLICT ("slug") DO NOTHING;

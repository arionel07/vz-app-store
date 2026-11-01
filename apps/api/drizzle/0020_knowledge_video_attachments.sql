ALTER TABLE "knowledge_attachments" DROP CONSTRAINT "knowledge_attachments_mime_check";
ALTER TABLE "knowledge_attachments" ADD CONSTRAINT "knowledge_attachments_mime_check"
  CHECK ("mime_type" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4'));

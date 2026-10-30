import { detectPhotoType, normalizePhotoImage, type PhotoProcessingLimits } from "../photos/image-processing";
import { DomainError } from "../errors";

export const KNOWLEDGE_MAX_BODY_BYTES = 200_000;
export const KNOWLEDGE_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function validateKnowledgeMarkdown(body: string): void {
  if (new TextEncoder().encode(body).byteLength > KNOWLEDGE_MAX_BODY_BYTES) throw new DomainError(400, "KNOWLEDGE_BODY_TOO_LARGE", "Текст статьи слишком большой");
  if (/<\/?[a-z][^>]*>|<script|<iframe|<object|<embed|on[a-z]+\s*=|(?:javascript|data|vbscript):/i.test(body)) {
    throw new DomainError(400, "KNOWLEDGE_UNSAFE_CONTENT", "HTML, скрипты и небезопасные ссылки запрещены");
  }
  const links = body.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g);
  for (const match of links) {
    if (!/^https:\/\//i.test(match[1] ?? "")) throw new DomainError(400, "KNOWLEDGE_UNSAFE_LINK", "Разрешены только HTTPS-ссылки");
  }
}

export function safeKnowledgeFilename(name: string): string {
  const normalized = name.replace(/[\\/\r\n]/g, "_").trim().slice(0, 255);
  return normalized || "attachment";
}

export async function prepareKnowledgeAttachment(file: File, limits: PhotoProcessingLimits): Promise<{ body: Uint8Array; mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp"; extension: string }> {
  if (file.size <= 0 || file.size > KNOWLEDGE_MAX_ATTACHMENT_BYTES) throw new DomainError(413, "KNOWLEDGE_ATTACHMENT_TOO_LARGE", "Файл превышает лимит 10 МБ");
  const input = new Uint8Array(await file.arrayBuffer());
	if (new TextDecoder().decode(input.slice(0, 5)) === "%PDF-") {
    if (file.type && file.type !== "application/pdf") throw new DomainError(415, "KNOWLEDGE_ATTACHMENT_TYPE", "Тип файла не совпадает с содержимым");
    return { body: input, mimeType: "application/pdf", extension: "pdf" };
  }
  const signature = detectPhotoType(input);
  if (!signature || (file.type && file.type !== signature.mimeType)) throw new DomainError(415, "KNOWLEDGE_ATTACHMENT_TYPE", "Поддерживаются PDF, JPEG, PNG и WebP");
  const body = await normalizePhotoImage(input, signature, { ...limits, maxBytes: KNOWLEDGE_MAX_ATTACHMENT_BYTES });
  return { body, mimeType: signature.mimeType, extension: signature.extension };
}

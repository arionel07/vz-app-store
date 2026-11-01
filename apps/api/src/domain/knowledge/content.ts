import { detectPhotoType, normalizePhotoImage, type PhotoProcessingLimits } from "../photos/image-processing";
import { DomainError } from "../errors";

export const KNOWLEDGE_MAX_BODY_BYTES = 200_000;
export const KNOWLEDGE_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const MP4_BRANDS = new Set(["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "dash", "MSNV"]);

function isMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || new TextDecoder().decode(bytes.slice(4, 8)) !== "ftyp") return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (boxSize < 16 || boxSize > bytes.length || (boxSize - 16) % 4 !== 0) return false;
  const majorBrand = new TextDecoder().decode(bytes.slice(8, 12));
  if (MP4_BRANDS.has(majorBrand)) return true;
  // Some MP4 files use a generic major brand while declaring a recognized
  // compatible brand in the ftyp box.
  for (let offset = 16; offset < boxSize; offset += 4) {
    if (MP4_BRANDS.has(new TextDecoder().decode(bytes.slice(offset, offset + 4)))) return true;
  }
  return false;
}

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

export async function prepareKnowledgeAttachment(file: File, limits: PhotoProcessingLimits): Promise<{ body: Uint8Array; mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "video/mp4"; extension: string }> {
  if (file.size <= 0 || file.size > KNOWLEDGE_MAX_ATTACHMENT_BYTES) throw new DomainError(413, "KNOWLEDGE_ATTACHMENT_TOO_LARGE", "Файл превышает лимит 10 МБ");
  const input = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(input.slice(0, 5)) === "%PDF-") {
    if (file.type && file.type !== "application/pdf") throw new DomainError(415, "KNOWLEDGE_ATTACHMENT_TYPE", "Тип файла не совпадает с содержимым");
    return { body: input, mimeType: "application/pdf", extension: "pdf" };
  }
  if (isMp4(input)) {
    if (file.type && file.type !== "video/mp4") throw new DomainError(415, "KNOWLEDGE_ATTACHMENT_TYPE", "Тип файла не совпадает с содержимым");
    return { body: input, mimeType: "video/mp4", extension: "mp4" };
  }
  const signature = detectPhotoType(input);
  if (!signature || (file.type && file.type !== signature.mimeType)) throw new DomainError(415, "KNOWLEDGE_ATTACHMENT_TYPE", "Поддерживаются MP4, PDF, JPEG, PNG и WebP");
  const body = await normalizePhotoImage(input, signature, { ...limits, maxBytes: KNOWLEDGE_MAX_ATTACHMENT_BYTES });
  return { body, mimeType: signature.mimeType, extension: signature.extension };
}

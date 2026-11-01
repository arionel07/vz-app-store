import { describe, expect, test } from "bun:test";
import { KNOWLEDGE_MAX_ATTACHMENT_BYTES, prepareKnowledgeAttachment, validateKnowledgeMarkdown } from "../src/domain/knowledge/content";

describe("knowledge content validation", () => {
  test("accepts the supported Markdown subset and HTTPS links", () => {
    expect(() => validateKnowledgeMarkdown("# Заголовок\n\n- **Важно**: https://example.com" )).not.toThrow();
  });

  test("rejects HTML, scripts and unsafe links", () => {
    expect(() => validateKnowledgeMarkdown("<img src=x>" )).toThrow();
    expect(() => validateKnowledgeMarkdown("[ссылка](javascript:alert(1))" )).toThrow();
    expect(() => validateKnowledgeMarkdown("[ссылка](http://example.com)" )).toThrow();
  });

  test("accepts MP4 by container signature, not filename alone", async () => {
    const bytes = new Uint8Array(24);
    new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
    bytes.set(new TextEncoder().encode("ftyp"), 4);
    bytes.set(new TextEncoder().encode("isom"), 8);
    bytes.set(new TextEncoder().encode("isommp42"), 16);
    const result = await prepareKnowledgeAttachment(new File([bytes], "lesson.mp4", { type: "video/mp4" }), { maxBytes: 1024, maxDimension: 1024, maxPixels: 1024 * 1024 });
    expect(result.mimeType).toBe("video/mp4");
    expect(result.extension).toBe("mp4");
    expect(result.body).toEqual(bytes);
  });

  test("rejects spoofed, mismatched and oversized video attachments", async () => {
    const invalid = new File(["not a video"], "lesson.mp4", { type: "video/mp4" });
    await expect(prepareKnowledgeAttachment(invalid, { maxBytes: 1024, maxDimension: 1024, maxPixels: 1024 * 1024 })).rejects.toMatchObject({ code: "KNOWLEDGE_ATTACHMENT_TYPE" });

    const bytes = new Uint8Array(24);
    new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
    bytes.set(new TextEncoder().encode("ftypisom"), 4);
    bytes.set(new TextEncoder().encode("isommp42"), 16);
    await expect(prepareKnowledgeAttachment(new File([bytes], "lesson.mp4", { type: "application/octet-stream" }), { maxBytes: 1024, maxDimension: 1024, maxPixels: 1024 * 1024 })).rejects.toMatchObject({ code: "KNOWLEDGE_ATTACHMENT_TYPE" });

    const oversized = { size: KNOWLEDGE_MAX_ATTACHMENT_BYTES + 1, type: "video/mp4", arrayBuffer: async () => new ArrayBuffer(0) } as File;
    await expect(prepareKnowledgeAttachment(oversized, { maxBytes: 1024, maxDimension: 1024, maxPixels: 1024 * 1024 })).rejects.toMatchObject({ code: "KNOWLEDGE_ATTACHMENT_TOO_LARGE" });
  });
});

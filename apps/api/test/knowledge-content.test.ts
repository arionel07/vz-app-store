import { describe, expect, test } from "bun:test";
import { validateKnowledgeMarkdown } from "../src/domain/knowledge/content";

describe("knowledge content validation", () => {
  test("accepts the supported Markdown subset and HTTPS links", () => {
    expect(() => validateKnowledgeMarkdown("# Заголовок\n\n- **Важно**: https://example.com" )).not.toThrow();
  });

  test("rejects HTML, scripts and unsafe links", () => {
    expect(() => validateKnowledgeMarkdown("<img src=x>" )).toThrow();
    expect(() => validateKnowledgeMarkdown("[ссылка](javascript:alert(1))" )).toThrow();
    expect(() => validateKnowledgeMarkdown("[ссылка](http://example.com)" )).toThrow();
  });
});

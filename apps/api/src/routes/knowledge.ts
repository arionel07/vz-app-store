import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  knowledgeAcknowledgmentListResponseSchema,
  knowledgeAcknowledgmentResponseSchema,
  knowledgeAdminArticleResponseSchema,
  knowledgeAdminListQuerySchema,
  knowledgeAdminListResponseSchema,
  knowledgeArticleCreateSchema,
  knowledgeArticleUpdateSchema,
  knowledgeCategoryCreateSchema,
  knowledgeCategoryListResponseSchema,
  knowledgeCategoryResponseSchema,
  knowledgeCategoryUpdateSchema,
  knowledgeRevisionListResponseSchema,
  knowledgeStaffArticleResponseSchema,
  knowledgeStaffListQuerySchema,
  knowledgeStaffListResponseSchema,
  knowledgeAttachmentResponseSchema,
} from "@vizaje/contracts";
import type { TrustedPrincipal } from "../domain/authz";
import { DomainError } from "../domain/errors";
import type { KnowledgeService } from "../domain/knowledge/service";
import type { PrincipalResolver } from "./management";

export interface KnowledgeRoutesOptions {
  knowledge: KnowledgeService;
  resolvePrincipal: PrincipalResolver;
  maxUploadBytes: number;
}

function parseInput<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

async function requirePrincipal(resolvePrincipal: PrincipalResolver, context: Context): Promise<TrustedPrincipal> {
  const principal = await resolvePrincipal(context);
  if (!principal) throw new DomainError(401, "UNAUTHENTICATED", "Authentication is required");
  return principal;
}

async function parseJson(context: Context): Promise<unknown> {
  try { return await context.req.json(); } catch { throw new DomainError(400, "INVALID_JSON", "Request body must be valid JSON"); }
}

function idParam(context: Context, name: string): string {
  return parseInput(z.string().uuid(), context.req.param(name));
}

async function parseAttachment(context: Context): Promise<File> {
  let form: FormData;
  try { form = await context.req.formData(); } catch { throw new DomainError(400, "INVALID_MULTIPART", "Request must be multipart/form-data"); }
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) throw new DomainError(400, "KNOWLEDGE_ATTACHMENT_REQUIRED", "Exactly one file field is required");
  return files[0];
}

function binaryResponse(result: Awaited<ReturnType<KnowledgeService["getAttachment"]>>): Response {
  const body = new ArrayBuffer(result.body.byteLength);
  new Uint8Array(body).set(result.body);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": result.attachment.mimeType,
      "Content-Length": String(result.body.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(result.attachment.originalFilename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function registerKnowledgeRoutes(app: Hono, options: KnowledgeRoutesOptions): void {
  const { knowledge, resolvePrincipal } = options;
  const uploadLimit = bodyLimit({
    maxSize: options.maxUploadBytes + 64 * 1024,
    onError: (context) => context.json({ error: { code: "KNOWLEDGE_ATTACHMENT_TOO_LARGE", message: "Файл превышает допустимый размер" } }, 413),
  });

  app.get("/api/v1/management/knowledge/categories", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeCategoryListResponseSchema.parse(await knowledge.listCategories(principal, true)), 200);
  });
  app.post("/api/v1/management/knowledge/categories", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeCategoryResponseSchema.parse(await knowledge.createCategory(principal, await parseJson(context))), 201);
  });
  app.patch("/api/v1/management/knowledge/categories/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeCategoryResponseSchema.parse(await knowledge.updateCategory(principal, idParam(context, "id"), await parseJson(context))), 200);
  });

  app.get("/api/v1/management/knowledge/articles", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await knowledge.listManagement(principal, parseInput(knowledgeAdminListQuerySchema, context.req.query()));
    return context.json(knowledgeAdminListResponseSchema.parse(result), 200);
  });
  app.post("/api/v1/management/knowledge/articles", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeAdminArticleResponseSchema.parse(await knowledge.createArticle(principal, parseInput(knowledgeArticleCreateSchema, await parseJson(context)))), 201);
  });
  app.get("/api/v1/management/knowledge/articles/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeAdminArticleResponseSchema.parse(await knowledge.getManagement(principal, idParam(context, "id"))), 200);
  });
  app.patch("/api/v1/management/knowledge/articles/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeAdminArticleResponseSchema.parse(await knowledge.updateArticle(principal, idParam(context, "id"), parseInput(knowledgeArticleUpdateSchema, await parseJson(context)))), 200);
  });
  app.post("/api/v1/management/knowledge/articles/:id/publish", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeAdminArticleResponseSchema.parse(await knowledge.publish(principal, idParam(context, "id"))), 200);
  });
  app.post("/api/v1/management/knowledge/articles/:id/archive", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeAdminArticleResponseSchema.parse(await knowledge.archive(principal, idParam(context, "id"))), 200);
  });
  app.get("/api/v1/management/knowledge/articles/:id/revisions", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeRevisionListResponseSchema.parse(await knowledge.listRevisions(principal, idParam(context, "id"))), 200);
  });
  app.get("/api/v1/management/knowledge/articles/:id/acknowledgments", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeAcknowledgmentListResponseSchema.parse(await knowledge.listAcknowledgments(principal, idParam(context, "id"))), 200);
  });
  app.post("/api/v1/management/knowledge/articles/:id/attachments", uploadLimit, async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeAttachmentResponseSchema.parse(await knowledge.uploadAttachment(principal, idParam(context, "id"), await parseAttachment(context))), 201);
  });
  app.delete("/api/v1/management/knowledge/articles/:id/attachments/:attachmentId", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    await knowledge.deleteAttachment(principal, idParam(context, "id"), idParam(context, "attachmentId"));
    return context.body(null, 204);
  });
  app.get("/api/v1/management/knowledge/articles/:id/attachments/:attachmentId", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return binaryResponse(await knowledge.getAttachment(principal, idParam(context, "id"), idParam(context, "attachmentId")));
  });

  app.get("/api/v1/me/knowledge/categories", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeCategoryListResponseSchema.parse(await knowledge.listCategories(principal)), 200);
  });
  app.get("/api/v1/me/knowledge/articles", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeStaffListResponseSchema.parse(await knowledge.listStaff(principal, parseInput(knowledgeStaffListQuerySchema, context.req.query()))), 200);
  });
  app.get("/api/v1/me/knowledge/articles/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeStaffArticleResponseSchema.parse(await knowledge.getStaff(principal, idParam(context, "id"))), 200);
  });
  app.post("/api/v1/me/knowledge/articles/:id/acknowledge", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(knowledgeAcknowledgmentResponseSchema.parse(await knowledge.acknowledge(principal, idParam(context, "id"))), 200);
  });
  app.get("/api/v1/me/knowledge/articles/:id/attachments/:attachmentId", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return binaryResponse(await knowledge.getAttachment(principal, idParam(context, "id"), idParam(context, "attachmentId")));
  });
}

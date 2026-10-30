import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  photoIdempotencyKeySchema,
  taskChecklistUpdateSchema,
  taskCreateSchema,
  taskListQuerySchema,
  taskRecurrenceCreateSchema,
  taskRecurrenceGenerateSchema,
  taskReviewSchema,
  taskSubmitSchema,
  taskTemplateCreateSchema,
  taskTemplateListQuerySchema,
  taskTemplateUpdateSchema,
  taskUpdateSchema,
} from "@vizaje/contracts";
import type { TrustedPrincipal } from "../domain/authz";
import { DomainError } from "../domain/errors";
import type { TasksService } from "../domain/tasks/service";
import type { PrincipalResolver } from "./management";

export interface TaskRoutesOptions {
  tasks: TasksService;
  resolvePrincipal: PrincipalResolver;
  maxUploadBytes: number;
}

function parseInput<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

async function parseJson(context: Context): Promise<unknown> {
  try { return await context.req.json(); } catch { throw new DomainError(400, "INVALID_JSON", "Request body must be valid JSON"); }
}

async function requirePrincipal(resolvePrincipal: PrincipalResolver, context: Context): Promise<TrustedPrincipal> {
  const principal = await resolvePrincipal(context);
  if (!principal) throw new DomainError(401, "UNAUTHENTICATED", "Authentication is required");
  return principal;
}

function idParam(context: Context, name: string): string { return parseInput(z.string().uuid(), context.req.param(name)); }

function idempotencyKey(context: Context): string | undefined {
  const raw = context.req.header("Idempotency-Key");
  return raw === undefined ? undefined : parseInput(photoIdempotencyKeySchema, raw);
}

async function parseTaskFile(context: Context): Promise<File> {
  let form: FormData;
  try { form = await context.req.formData(); } catch { throw new DomainError(400, "INVALID_MULTIPART", "Request must be multipart/form-data"); }
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) throw new DomainError(400, "PHOTO_REQUIRED", "Exactly one file field is required");
  return files[0];
}

export function registerTaskRoutes(app: Hono, options: TaskRoutesOptions): void {
  const uploadLimit = bodyLimit({
    maxSize: options.maxUploadBytes + 64 * 1024,
    onError: (context) => context.json({ error: { code: "PHOTO_TOO_LARGE", message: "Photo exceeds the maximum allowed size" } }, 413),
  });

  app.get("/api/v1/me/tasks", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.list(principal, parseInput(taskListQuerySchema, context.req.query())), 200);
  });
  app.get("/api/v1/me/tasks/:id", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.get(principal, idParam(context, "id")), 200);
  });
  app.post("/api/v1/me/tasks/:id/start", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.start(principal, idParam(context, "id")), 200);
  });
  app.patch("/api/v1/me/tasks/:id/checklist/:itemId", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.updateChecklist(principal, idParam(context, "id"), idParam(context, "itemId"), parseInput(taskChecklistUpdateSchema, await parseJson(context))), 200);
  });
  app.post("/api/v1/me/tasks/:id/submit", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.submit(principal, idParam(context, "id"), parseInput(taskSubmitSchema, await parseJson(context)), idempotencyKey(context)), 200);
  });
  app.post("/api/v1/me/tasks/:id/evidence", uploadLimit, async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.uploadEvidence(principal, idParam(context, "id"), await parseTaskFile(context), idempotencyKey(context)), 201);
  });

  app.get("/api/v1/management/tasks", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.list(principal, parseInput(taskListQuerySchema, context.req.query())), 200);
  });
  app.post("/api/v1/management/tasks", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.createTask(principal, parseInput(taskCreateSchema, await parseJson(context))), 201);
  });
  app.get("/api/v1/management/tasks/:id", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.get(principal, idParam(context, "id")), 200);
  });
  app.patch("/api/v1/management/tasks/:id", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.update(principal, idParam(context, "id"), parseInput(taskUpdateSchema, await parseJson(context))), 200);
  });
  app.get("/api/v1/management/tasks/:id/history", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.listHistory(principal, idParam(context, "id")), 200);
  });

  app.get("/api/v1/management/task-templates", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.listTemplates(principal, parseInput(taskTemplateListQuerySchema, context.req.query())), 200);
  });
  app.post("/api/v1/management/task-templates", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.createTemplate(principal, parseInput(taskTemplateCreateSchema, await parseJson(context))), 201);
  });
  app.patch("/api/v1/management/task-templates/:id", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.updateTemplate(principal, idParam(context, "id"), parseInput(taskTemplateUpdateSchema, await parseJson(context))), 200);
  });
  app.get("/api/v1/management/task-reviews", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.listReviews(principal, parseInput(taskListQuerySchema, context.req.query())), 200);
  });
  app.post("/api/v1/management/task-submissions/:id/check", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.review(principal, idParam(context, "id"), true, parseInput(taskReviewSchema, await parseJson(context))), 200);
  });
  app.post("/api/v1/management/task-submissions/:id/reject", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.review(principal, idParam(context, "id"), false, parseInput(taskReviewSchema, await parseJson(context))), 200);
  });
  app.post("/api/v1/management/task-recurrences", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.createRecurrence(principal, parseInput(taskRecurrenceCreateSchema, await parseJson(context))), 201);
  });
  app.post("/api/v1/management/task-recurrences/:id/generate", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.tasks.generateRecurrence(principal, idParam(context, "id"), parseInput(taskRecurrenceGenerateSchema, await parseJson(context))), 200);
  });

  app.get("/api/v1/task-evidence/:id", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    const result = await options.tasks.downloadEvidence(principal, idParam(context, "id"));
    const body = new ArrayBuffer(result.body.byteLength);
    new Uint8Array(body).set(result.body);
    return new Response(body, { status: 200, headers: {
      "Content-Type": result.evidence.mimeType,
      "Content-Length": String(result.body.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(result.evidence.originalFilename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  });
}

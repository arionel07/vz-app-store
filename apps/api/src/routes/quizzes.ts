import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  attemptListQuerySchema,
  quizCreateInputSchema,
  quizDraftInputSchema,
  quizListQuerySchema,
  quizReviewInputSchema,
  quizReviewListQuerySchema,
  submitAttemptInputSchema,
} from "@vizaje/contracts";
import type { TrustedPrincipal } from "../domain/authz";
import { DomainError } from "../domain/errors";
import type { QuizAttemptService } from "../domain/quizzes/attempt-service";
import type { PhotosService } from "../domain/photos/service";
import type { QuizService } from "../domain/quizzes/service";
import type { PrincipalResolver } from "./management";

export interface QuizRoutesOptions {
  quizzes: QuizService;
  attempts: QuizAttemptService;
  photos?: PhotosService;
  maxUploadBytes?: number;
  resolvePrincipal: PrincipalResolver;
}

function parseInput<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

async function parseJson(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new DomainError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

async function parsePhotoFile(context: Context): Promise<File> {
  let form: FormData;
  try {
    form = await context.req.formData();
  } catch {
    throw new DomainError(400, "INVALID_MULTIPART", "Request must be multipart/form-data");
  }
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) throw new DomainError(400, "PHOTO_REQUIRED", "Exactly one file field is required");
  return files[0];
}

async function requirePrincipal(resolvePrincipal: PrincipalResolver, context: Context): Promise<TrustedPrincipal> {
  const principal = await resolvePrincipal(context);
  if (!principal) throw new DomainError(401, "UNAUTHENTICATED", "Authentication is required");
  return principal;
}

function idParam(context: Context, name: string): string {
  return parseInput(z.string().uuid(), context.req.param(name));
}

export function registerQuizRoutes(app: Hono, options: QuizRoutesOptions): void {
  const { quizzes, attempts, photos, resolvePrincipal, maxUploadBytes = 10 * 1024 * 1024 } = options;

  app.post("/api/v1/management/quizzes", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const input = parseInput(quizCreateInputSchema, await parseJson(context));
    return context.json(await quizzes.createDraft(principal, input), 201);
  });

  app.get("/api/v1/management/quizzes", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const query = parseInput(quizListQuerySchema, context.req.query());
    return context.json(await quizzes.listAuthoring(principal, query), 200);
  });

  app.get("/api/v1/management/quizzes/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(await quizzes.getAuthoring(principal, idParam(context, "id")), 200);
  });

  app.put("/api/v1/management/quizzes/:id/draft", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const input = parseInput(quizDraftInputSchema, await parseJson(context));
    return context.json(await quizzes.saveDraft(principal, idParam(context, "id"), input), 200);
  });

  app.post("/api/v1/management/quizzes/:id/publish", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(await quizzes.publish(principal, idParam(context, "id")), 200);
  });

  app.post("/api/v1/management/quizzes/:id/archive", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    await quizzes.archive(principal, idParam(context, "id"));
    return context.json({ success: true }, 200);
  });

  app.get("/api/v1/management/quizzes/:id/results", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const query = parseInput(attemptListQuerySchema, { ...context.req.query(), quizId: idParam(context, "id") });
    return context.json(await attempts.listResults(principal, query), 200);
  });

  app.get("/api/v1/management/quiz-reviews", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const query = parseInput(quizReviewListQuerySchema, context.req.query());
    return context.json(await attempts.listReviews(principal, query), 200);
  });

  app.post("/api/v1/management/quiz-attempts/:attemptId/questions/:questionId/review", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const input = parseInput(quizReviewInputSchema, await parseJson(context));
    return context.json(await attempts.review(principal, idParam(context, "attemptId"), idParam(context, "questionId"), input), 200);
  });

  app.get("/api/v1/quizzes", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const query = parseInput(quizListQuerySchema, context.req.query());
    return context.json(await quizzes.listAvailable(principal, query), 200);
  });

  app.get("/api/v1/quizzes/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(await quizzes.getAvailable(principal, idParam(context, "id")), 200);
  });

  app.post("/api/v1/quizzes/:id/attempts", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(await attempts.start(principal, idParam(context, "id")), 201);
  });

  app.post("/api/v1/attempts/:id/submit", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const input = parseInput(submitAttemptInputSchema, await parseJson(context));
    return context.json(await attempts.submit(principal, idParam(context, "id"), input), 200);
  });

  if (photos) app.post("/api/v1/attempts/:attemptId/questions/:questionId/photo", bodyLimit({ maxSize: maxUploadBytes + 64 * 1024, onError: (context) => context.json({ error: { code: "PHOTO_TOO_LARGE", message: "Photo exceeds the maximum allowed size" } }, 413) }), async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const attemptId = idParam(context, "attemptId");
    const questionId = idParam(context, "questionId");
    const file = await parsePhotoFile(context);
    const storeId = await attempts.photoStoreId(principal, attemptId, questionId);
    const uploaded = await photos.uploadQuizAnswer(principal, storeId, file, context.req.header("Idempotency-Key"));
    await attempts.attachPhoto(principal, attemptId, questionId, uploaded.photo.id);
    return context.json(uploaded.photo, uploaded.created ? 201 : 200);
  });

  app.get("/api/v1/attempts", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const query = parseInput(attemptListQuerySchema, context.req.query());
    return context.json(await attempts.listMine(principal, query), 200);
  });

  app.get("/api/v1/attempts/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    return context.json(await attempts.getMine(principal, idParam(context, "id")), 200);
  });
}

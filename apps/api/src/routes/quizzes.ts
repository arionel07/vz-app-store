import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  attemptListQuerySchema,
  quizCreateInputSchema,
  quizDraftInputSchema,
  quizListQuerySchema,
  submitAttemptInputSchema,
} from "@vizaje/contracts";
import type { TrustedPrincipal } from "../domain/authz";
import { DomainError } from "../domain/errors";
import type { QuizAttemptService } from "../domain/quizzes/attempt-service";
import type { QuizService } from "../domain/quizzes/service";
import type { PrincipalResolver } from "./management";

export interface QuizRoutesOptions {
  quizzes: QuizService;
  attempts: QuizAttemptService;
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

async function requirePrincipal(resolvePrincipal: PrincipalResolver, context: Context): Promise<TrustedPrincipal> {
  const principal = await resolvePrincipal(context);
  if (!principal) throw new DomainError(401, "UNAUTHENTICATED", "Authentication is required");
  return principal;
}

function idParam(context: Context, name: string): string {
  return parseInput(z.string().uuid(), context.req.param(name));
}

export function registerQuizRoutes(app: Hono, options: QuizRoutesOptions): void {
  const { quizzes, attempts, resolvePrincipal } = options;

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

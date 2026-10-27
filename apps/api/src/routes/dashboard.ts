import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  dashboardFiltersSchema,
  dashboardQuizQuerySchema,
} from "@vizaje/contracts";
import type { TrustedPrincipal } from "../domain/authz";
import type { DashboardService } from "../domain/dashboard/service";
import { DomainError } from "../domain/errors";
import type { PrincipalResolver } from "./management";

export interface DashboardRoutesOptions {
  dashboard: DashboardService;
  resolvePrincipal: PrincipalResolver;
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

export function registerDashboardRoutes(app: Hono, options: DashboardRoutesOptions): void {
  const { dashboard, resolvePrincipal } = options;

  app.get("/api/v1/dashboard/overview", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const filters = parseInput(dashboardFiltersSchema, context.req.query());
    return context.json(await dashboard.overview(principal, filters), 200);
  });

  app.get("/api/v1/dashboard/photos", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const filters = parseInput(dashboardFiltersSchema, context.req.query());
    return context.json(await dashboard.photos(principal, filters), 200);
  });

  app.get("/api/v1/dashboard/quizzes", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const filters = parseInput(dashboardQuizQuerySchema, context.req.query());
    return context.json(await dashboard.quizzes(principal, filters), 200);
  });
}

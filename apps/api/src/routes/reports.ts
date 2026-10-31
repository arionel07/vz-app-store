import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  reportEmployeeFiltersSchema,
  reportEmployeesResponseSchema,
  reportFiltersSchema,
  reportMetricDefinitionsResponseSchema,
  reportOperationsResponseSchema,
  reportOverviewResponseSchema,
  reportPageFiltersSchema,
  reportPhotosResponseSchema,
  reportSchedulesResponseSchema,
  reportStoresResponseSchema,
  reportTasksResponseSchema,
  reportTimeSeriesResponseSchema,
  reportTrainingResponseSchema,
} from "@vizaje/contracts";
import type { TrustedPrincipal } from "../domain/authz";
import { reportMetricDefinitions } from "../domain/reports/definitions";
import type { ReportsService } from "../domain/reports/service";
import { DomainError } from "../domain/errors";
import type { PrincipalResolver } from "./management";

export interface ReportsRoutesOptions {
  reports: ReportsService;
  resolvePrincipal: PrincipalResolver;
}

function parseInput<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError(400, "VALIDATION_ERROR", result.error.issues[0]?.message ?? "Параметры отчёта указаны неверно");
  return result.data;
}

async function principal(resolve: PrincipalResolver, context: Context): Promise<TrustedPrincipal> {
  const current = await resolve(context);
  if (!current) throw new DomainError(401, "UNAUTHENTICATED", "Требуется авторизация");
  return current;
}

export function registerReportsRoutes(app: Hono, options: ReportsRoutesOptions): void {
  const { reports, resolvePrincipal } = options;
  const base = "/api/v1/management/reports";

  app.use(`${base}/*`, async (context, next) => {
    await next();
    context.header("Cache-Control", "private, no-store");
  });

  app.get(`${base}/overview`, async (context) => {
    const user = await principal(resolvePrincipal, context);
    const query = parseInput(reportFiltersSchema, context.req.query());
    return context.json(reportOverviewResponseSchema.parse(await reports.overview(user, query)), 200);
  });
  app.get(`${base}/time-series`, async (context) => {
    const user = await principal(resolvePrincipal, context);
    const query = parseInput(reportFiltersSchema, context.req.query());
    return context.json(reportTimeSeriesResponseSchema.parse(await reports.timeSeries(user, query)), 200);
  });
  app.get(`${base}/stores`, async (context) => {
    const user = await principal(resolvePrincipal, context);
    const query = parseInput(reportPageFiltersSchema, context.req.query());
    return context.json(reportStoresResponseSchema.parse(await reports.stores(user, query)), 200);
  });
  app.get(`${base}/employees`, async (context) => {
    const user = await principal(resolvePrincipal, context);
    const query = parseInput(reportEmployeeFiltersSchema, context.req.query());
    return context.json(reportEmployeesResponseSchema.parse(await reports.employees(user, query)), 200);
  });
  app.get(`${base}/training`, async (context) => {
    const user = await principal(resolvePrincipal, context);
    const query = parseInput(reportFiltersSchema, context.req.query());
    return context.json(reportTrainingResponseSchema.parse(await reports.training(user, query)), 200);
  });
  app.get(`${base}/photos`, async (context) => {
    const user = await principal(resolvePrincipal, context);
    const query = parseInput(reportFiltersSchema, context.req.query());
    return context.json(reportPhotosResponseSchema.parse(await reports.photos(user, query)), 200);
  });
  app.get(`${base}/tasks`, async (context) => {
    const user = await principal(resolvePrincipal, context);
    const query = parseInput(reportFiltersSchema, context.req.query());
    return context.json(reportTasksResponseSchema.parse(await reports.tasks(user, query)), 200);
  });
  app.get(`${base}/schedules`, async (context) => {
    const user = await principal(resolvePrincipal, context);
    const query = parseInput(reportFiltersSchema, context.req.query());
    return context.json(reportSchedulesResponseSchema.parse(await reports.schedules(user, query)), 200);
  });
  app.get(`${base}/operations`, async (context) => {
    const user = await principal(resolvePrincipal, context);
    const query = parseInput(reportFiltersSchema, context.req.query());
    return context.json(reportOperationsResponseSchema.parse(await reports.operations(user, query)), 200);
  });
  app.get(`${base}/metric-definitions`, async (context) => {
    const user = await principal(resolvePrincipal, context);
    // Definitions are still management data: the service checks active role/scope without querying report aggregates.
    if (!user.isActive) throw new DomainError(403, "INACTIVE_PRINCIPAL", "Учётная запись неактивна");
    if (user.role !== "admin" && user.role !== "manager") throw new DomainError(403, "FORBIDDEN", "Роль не имеет доступа к управленческой отчётности");
    return context.json(reportMetricDefinitionsResponseSchema.parse({ data: reportMetricDefinitions }), 200);
  });
}

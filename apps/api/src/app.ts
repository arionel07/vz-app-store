import { HTTPException } from "hono/http-exception";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql, type SQL } from "drizzle-orm";
import {
  errorResponseSchema,
  livenessResponseSchema,
  readinessResponseSchema,
} from "@vizaje/contracts";
import { DomainError } from "./domain/errors";
import { noopLogger, type Logger } from "./lib/logger";
import { registerAuthRoutes, type AuthRoutesOptions } from "./routes/auth";
import { registerQuizRoutes, type QuizRoutesOptions } from "./routes/quizzes";
import { registerPhotoRoutes, type PhotoRoutesOptions } from "./routes/photos";
import { registerDashboardRoutes, type DashboardRoutesOptions } from "./routes/dashboard";
import {
  registerManagementRoutes,
  type ManagementServices,
  type PrincipalResolver,
} from "./routes/management";
import { registerTaskRoutes, type TaskRoutesOptions } from "./routes/tasks";
import { registerNotificationRoutes, type NotificationRoutesOptions } from "./routes/notifications";

export interface AppDependencies {
  db: {
    execute(query: SQL): Promise<unknown>;
  };
  allowedOrigins: string[];
  managementServices?: ManagementServices;
  resolvePrincipal?: PrincipalResolver;
  authRoutes?: AuthRoutesOptions;
  quizRoutes?: QuizRoutesOptions;
  photoRoutes?: PhotoRoutesOptions;
  dashboardRoutes?: DashboardRoutesOptions;
  taskRoutes?: TaskRoutesOptions;
  notificationRoutes?: NotificationRoutesOptions;
  logger?: Logger;
}

export function createApp({
  db,
  allowedOrigins,
  managementServices,
  resolvePrincipal = () => null,
  logger = noopLogger,
  authRoutes,
  quizRoutes,
  photoRoutes,
  dashboardRoutes,
  taskRoutes,
  notificationRoutes,
}: AppDependencies) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : undefined),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "Idempotency-Key"],
      credentials: true,
      maxAge: 600,
    }),
  );

  app.use("/api/v1/*", async (context, next) => {
    await next();
    context.header("Cache-Control", "private, no-store");
    context.header("Vary", "Authorization, Cookie");
  });

  app.get("/health", (context) => {
    const response = livenessResponseSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    });

    return context.json(response, 200);
  });

  app.get("/api/v1/health", async (context) => {
    try {
      await db.execute(sql`select 1 as ok`);

      const response = readinessResponseSchema.parse({
        status: "ok",
        service: "api",
        database: "up",
        timestamp: new Date().toISOString(),
      });

      return context.json(response, 200);
    } catch (error) {
      logger.error("Database readiness check failed", { error });

      const response = errorResponseSchema.parse({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database is unavailable",
        },
      });

      return context.json(response, 503);
    }
  });

  registerManagementRoutes(app, managementServices, resolvePrincipal);
  if (authRoutes) registerAuthRoutes(app, authRoutes);
  if (quizRoutes) registerQuizRoutes(app, quizRoutes);
  if (photoRoutes) registerPhotoRoutes(app, photoRoutes);
  if (dashboardRoutes) registerDashboardRoutes(app, dashboardRoutes);
  if (taskRoutes) registerTaskRoutes(app, taskRoutes);
  if (notificationRoutes) registerNotificationRoutes(app, notificationRoutes);

  app.notFound((context) => {
    const response = errorResponseSchema.parse({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });

    return context.json(response, 404);
  });

  app.onError((error, context) => {
    logger.error("Unhandled request error", { error, path: context.req.path });

    if (error instanceof DomainError) {
      return context.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        error.status,
      );
    }

    if (error instanceof HTTPException) {
      const response = errorResponseSchema.parse({
        error: {
          code: "HTTP_ERROR",
          message: error.status >= 500 ? "Internal server error" : error.message || "Request failed",
        },
      });

      return context.json(response, error.status);
    }

    const response = errorResponseSchema.parse({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error",
      },
    });

    return context.json(response, 500);
  });

  return app;
}

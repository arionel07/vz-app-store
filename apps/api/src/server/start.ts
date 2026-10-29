import { createApp } from "../app";
import { createAuthService } from "../auth/service";
import { loadEnv } from "../config/env";
import { createDatabase } from "../db/client";
import { createStoresService } from "../domain/stores/service";
import { createUsersService } from "../domain/users/service";
import { createEmployeeProfileService } from "../domain/employees/profile-service";
import { createQuizAttemptService } from "../domain/quizzes/attempt-service";
import { createQuizService } from "../domain/quizzes/service";
import { createPhotosService } from "../domain/photos/service";
import { createDashboardService } from "../domain/dashboard/service";
import { createLogger } from "../lib/logger";
import { createPhotoStorage } from "../storage/photo-storage";
import { createShutdownHandler } from "./shutdown";

export function startServer() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const { db, client } = createDatabase(env);
  const auth = createAuthService(db);
  const quizzes = createQuizService(db);
  const attempts = createQuizAttemptService(db, quizzes);
  const photoStorage = createPhotoStorage(env);
  const photos = createPhotosService(db, photoStorage, {
    maxBytes: env.PHOTO_MAX_BYTES,
    maxDimension: env.PHOTO_MAX_DIMENSION,
    maxPixels: env.PHOTO_MAX_PIXELS,
  }, logger);
  const dashboard = createDashboardService(db);
  const usersService = createUsersService(db);
  const app = createApp({
    db,
    allowedOrigins: env.CORS_ALLOWED_ORIGINS,
    managementServices: {
      users: usersService,
      stores: createStoresService(db),
      profiles: createEmployeeProfileService(db, usersService),
    },
    resolvePrincipal: auth.principalResolver(),
    authRoutes: {
      auth,
      secureCookies: env.NODE_ENV === "production",
    },
    quizRoutes: {
      quizzes,
      attempts,
      resolvePrincipal: auth.principalResolver(),
    },
    photoRoutes: {
      photos,
      resolvePrincipal: auth.principalResolver(),
      maxUploadBytes: env.PHOTO_MAX_BYTES,
    },
    dashboardRoutes: {
      dashboard,
      resolvePrincipal: auth.principalResolver(),
    },
    logger,
  });

  const server = Bun.serve({
    fetch: app.fetch,
    hostname: env.HOST,
    port: env.PORT,
  });

  const shutdown = createShutdownHandler({ server, client, logger });
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  logger.info("API server started", {
    host: server.hostname,
    port: server.port,
    environment: env.NODE_ENV,
  });

  return { server, client, shutdown };
}

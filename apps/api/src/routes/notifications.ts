import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  announcementCreateSchema,
  announcementListQuerySchema,
  announcementResponseSchema,
  announcementRecipientResponseSchema,
  announcementUpdateSchema,
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationPreferencesSchema,
  notificationResponseSchema,
  notificationUnreadResponseSchema,
  pushDeviceResponseSchema,
} from "@vizaje/contracts";
import type { NotificationsService } from "../domain/notifications/service";
import type { TrustedPrincipal } from "../domain/authz";
import { DomainError } from "../domain/errors";
import type { PrincipalResolver } from "./management";

export interface NotificationRoutesOptions {
  notifications: NotificationsService;
  resolvePrincipal: PrincipalResolver;
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

function idParam(context: Context, name: string): string {
  return parseInput(z.string().uuid(), context.req.param(name));
}

export function registerNotificationRoutes(app: Hono, options: NotificationRoutesOptions): void {
  app.get("/api/v1/me/notifications", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    const result = await options.notifications.listMine(principal, parseInput(notificationListQuerySchema, context.req.query()));
    return context.json(notificationListResponseSchema.parse(result), 200);
  });

  app.get("/api/v1/me/notifications/unread-count", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(notificationUnreadResponseSchema.parse(await options.notifications.unreadCount(principal)), 200);
  });

  app.post("/api/v1/me/notifications/:id/read", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(notificationResponseSchema.parse(await options.notifications.markRead(principal, idParam(context, "id"))), 200);
  });

  app.post("/api/v1/me/notifications/:id/acknowledge", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(notificationResponseSchema.parse(await options.notifications.acknowledge(principal, idParam(context, "id"))), 200);
  });

  app.get("/api/v1/me/notification-preferences", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(notificationPreferencesSchema.parse(await options.notifications.getPreferences(principal)), 200);
  });

  app.patch("/api/v1/me/notification-preferences", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(notificationPreferencesSchema.parse(await options.notifications.updatePreferences(principal, await parseJson(context))), 200);
  });

  app.post("/api/v1/me/push-devices", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(pushDeviceResponseSchema.parse(await options.notifications.registerDevice(principal, await parseJson(context))), 201);
  });

  app.delete("/api/v1/me/push-devices/:deviceId", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    const deviceId = parseInput(z.string().trim().min(1).max(200), context.req.param("deviceId"));
    return context.json(await options.notifications.removeDevice(principal, deviceId), 200);
  });

  app.get("/api/v1/me/announcements/:id", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(announcementRecipientResponseSchema.parse(await options.notifications.getRecipientAnnouncement(principal, idParam(context, "id"))), 200);
  });

  app.get("/api/v1/management/announcements", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(await options.notifications.listAnnouncements(principal, parseInput(announcementListQuerySchema, context.req.query())), 200);
  });

  app.post("/api/v1/management/announcements", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(announcementResponseSchema.parse(await options.notifications.createAnnouncement(principal, parseInput(announcementCreateSchema, await parseJson(context)))), 201);
  });

  app.get("/api/v1/management/announcements/:id", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(announcementResponseSchema.parse(await options.notifications.getAnnouncement(principal, idParam(context, "id"))), 200);
  });

  app.patch("/api/v1/management/announcements/:id", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(announcementResponseSchema.parse(await options.notifications.updateAnnouncement(principal, idParam(context, "id"), parseInput(announcementUpdateSchema, await parseJson(context)))), 200);
  });

  app.post("/api/v1/management/announcements/:id/publish", async (context) => {
    const principal = await requirePrincipal(options.resolvePrincipal, context);
    return context.json(announcementResponseSchema.parse(await options.notifications.publishAnnouncement(principal, idParam(context, "id"))), 200);
  });
}

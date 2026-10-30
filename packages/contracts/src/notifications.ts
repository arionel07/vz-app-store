import { z } from "zod";
import { userRoleSchema } from "./users";

export const notificationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), id: z.string().uuid() }),
  z.object({ kind: z.literal("photo_report"), id: z.string().uuid() }),
  z.object({ kind: z.literal("quiz"), id: z.string().uuid() }),
  z.object({ kind: z.literal("attempt"), id: z.string().uuid() }),
  z.object({ kind: z.literal("schedule"), id: z.string().uuid() }),
  z.object({ kind: z.literal("announcement"), id: z.string().uuid() }),
  z.object({ kind: z.literal("knowledge"), id: z.string().uuid() }),
]);

export const notificationCategorySchema = z.enum(["task", "quiz", "schedule", "photo", "announcement", "knowledge"]);
export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  unreadOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

export const notificationResponseSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string().min(1),
  category: notificationCategorySchema,
  title: z.string(),
  body: z.string(),
  target: notificationTargetSchema.nullable(),
  requiresAcknowledgement: z.boolean(),
  readAt: z.string().datetime().nullable(),
  acknowledgedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const notificationListResponseSchema = z.object({
  data: z.array(notificationResponseSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
  unreadCount: z.number().int().nonnegative(),
});

export const notificationUnreadResponseSchema = z.object({ count: z.number().int().nonnegative() });
export const notificationPreferencesSchema = z.object({
  pushEnabled: z.boolean(),
  taskNotifications: z.boolean(),
  quizNotifications: z.boolean(),
  scheduleNotifications: z.boolean(),
  photoReviewNotifications: z.boolean(),
  announcementNotifications: z.boolean(),
});
export const notificationPreferencesUpdateSchema = notificationPreferencesSchema.partial().refine((value) => Object.keys(value).length > 0, "Укажите хотя бы одну настройку");
export const pushDeviceRegistrationSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  platform: z.enum(["ios", "android"]),
  expoPushToken: z.string().trim().min(1).max(255),
});
export const pushDeviceResponseSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string(),
  platform: z.enum(["ios", "android"]),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
});

export const announcementRoleSchema = z.enum(["staff", "manager"]);
export const announcementStatusSchema = z.enum(["draft", "published", "archived"]);
export const announcementCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  storeIds: z.array(z.string().uuid()).max(100).default([]),
  roles: z.array(announcementRoleSchema).min(1).max(2).default(["staff"]),
  requiresAcknowledgement: z.boolean().default(false),
});
export const announcementUpdateSchema = announcementCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "Укажите хотя бы одно поле");
export const announcementListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: announcementStatusSchema.optional(),
});

const announcementMetricsSchema = z.object({
  recipientCount: z.number().int().nonnegative(),
  readCount: z.number().int().nonnegative(),
  acknowledgedCount: z.number().int().nonnegative(),
});

export const announcementResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  status: announcementStatusSchema,
  storeIds: z.array(z.string().uuid()),
  roles: z.array(announcementRoleSchema),
  requiresAcknowledgement: z.boolean(),
  createdBy: z.string().uuid(),
  publishedBy: z.string().uuid().nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metrics: announcementMetricsSchema,
});
export const announcementListResponseSchema = z.object({
  data: z.array(announcementResponseSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});
export const announcementRecipientResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  requiresAcknowledgement: z.boolean(),
  publishedAt: z.string().datetime(),
});

export type NotificationTarget = z.infer<typeof notificationTargetSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type NotificationPreferencesUpdate = z.infer<typeof notificationPreferencesUpdateSchema>;
export type PushDeviceRegistration = z.infer<typeof pushDeviceRegistrationSchema>;
export type AnnouncementCreate = z.infer<typeof announcementCreateSchema>;
export type AnnouncementUpdate = z.infer<typeof announcementUpdateSchema>;
export type AnnouncementListQuery = z.infer<typeof announcementListQuerySchema>;
export type AnnouncementResponse = z.infer<typeof announcementResponseSchema>;
export type AnnouncementRecipientResponse = z.infer<typeof announcementRecipientResponseSchema>;
export type AnnouncementRole = z.infer<typeof announcementRoleSchema>;
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;
export type UserRoleForAnnouncement = Extract<z.infer<typeof userRoleSchema>, "staff" | "manager">;

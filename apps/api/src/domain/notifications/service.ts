import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  announcementHistory,
  announcementRoleTargets,
  announcements,
  announcementStoreTargets,
  domainEvents,
  notificationEventConsumptions,
  notificationOutbox,
  notificationPreferences,
  notifications,
  pushDevices,
  scheduleDaysOff,
  scheduleShifts,
  taskOccurrences,
  quizAttempts,
  photoReports,
  userStores,
  users,
  stores,
  knowledgeVisibilityTargets,
} from "../../db/schema";
import type { Database } from "../../db/client";
import {
  announcementCreateSchema,
  announcementListQuerySchema,
  announcementUpdateSchema,
  type AnnouncementCreate,
  type AnnouncementResponse,
  type AnnouncementRole,
  type NotificationCategory,
  notificationPreferencesSchema,
  notificationPreferencesUpdateSchema,
  notificationTargetSchema,
  type NotificationTarget,
  pushDeviceRegistrationSchema,
  type NotificationListQuery,
} from "@vizaje/contracts";
import type { TrustedPrincipal } from "../authz";
import { assertActivePrincipal } from "../authz";
import { DomainError } from "../errors";

type DbContext = any;

const defaultPreferences = {
  pushEnabled: true,
  taskNotifications: true,
  quizNotifications: true,
  scheduleNotifications: true,
  photoReviewNotifications: true,
  announcementNotifications: true,
};

function dateValue(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function categoryForEvent(eventType: string): NotificationCategory | null {
  if (eventType.startsWith("task.")) return "task";
  if (eventType.startsWith("quiz.")) return "quiz";
  if (eventType.startsWith("schedule.")) return "schedule";
  if (eventType.startsWith("photo.")) return "photo";
  if (eventType.startsWith("knowledge.")) return "knowledge";
  if (eventType === "announcement.published") return "announcement";
  return null;
}

function preferenceEnabled(preferences: typeof defaultPreferences, category: NotificationCategory): boolean {
  if (!preferences.pushEnabled) return false;
  if (category === "task") return preferences.taskNotifications;
  if (category === "quiz") return preferences.quizNotifications;
  if (category === "schedule") return preferences.scheduleNotifications;
  if (category === "photo") return preferences.photoReviewNotifications;
  return preferences.announcementNotifications;
}

function target(kind: NotificationTarget["kind"], id: string): NotificationTarget {
  return notificationTargetSchema.parse({ kind, id });
}

function asPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function payloadId(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export class NotificationsService {
  constructor(private readonly db: Database) {}

  async listMine(principal: TrustedPrincipal, input: NotificationListQuery) {
    assertActivePrincipal(principal);
    const query = input;
    const conditions = [eq(notifications.recipientUserId, principal.userId)];
    if (query.unreadOnly) conditions.push(isNull(notifications.readAt));
    const rows = await this.db.select().from(notifications).where(and(...conditions)).orderBy(desc(notifications.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const [{ total }] = await this.db.select({ total: count() }).from(notifications).where(and(...conditions));
    const [{ unread }] = await this.db.select({ unread: count() }).from(notifications).where(and(eq(notifications.recipientUserId, principal.userId), isNull(notifications.readAt)));
    return {
      data: rows.map((row) => this.notificationDto(row)),
      pagination: { page: query.page, pageSize: query.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / query.pageSize) },
      unreadCount: Number(unread),
    };
  }

  async unreadCount(principal: TrustedPrincipal) {
    assertActivePrincipal(principal);
    const [{ unread }] = await this.db.select({ unread: count() }).from(notifications).where(and(eq(notifications.recipientUserId, principal.userId), isNull(notifications.readAt)));
    return { count: Number(unread) };
  }

  async markRead(principal: TrustedPrincipal, notificationId: string) {
    assertActivePrincipal(principal);
    const [row] = await this.db.update(notifications).set({ readAt: sql`coalesce(${notifications.readAt}, now())` }).where(and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, principal.userId))).returning();
    if (!row) throw new DomainError(404, "NOTIFICATION_NOT_FOUND", "Уведомление не найдено");
    return this.notificationDto(row);
  }

  async acknowledge(principal: TrustedPrincipal, notificationId: string) {
    assertActivePrincipal(principal);
    const [row] = await this.db.update(notifications).set({ readAt: sql`coalesce(${notifications.readAt}, now())`, acknowledgedAt: sql`coalesce(${notifications.acknowledgedAt}, now())` }).where(and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, principal.userId), eq(notifications.requiresAcknowledgement, true))).returning();
    if (!row) throw new DomainError(404, "NOTIFICATION_NOT_FOUND", "Уведомление не найдено");
    return this.notificationDto(row);
  }

  async getPreferences(principal: TrustedPrincipal) {
    assertActivePrincipal(principal);
    const [row] = await this.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, principal.userId)).limit(1);
    return notificationPreferencesSchema.parse(row ? {
      pushEnabled: row.pushEnabled,
      taskNotifications: row.taskNotifications,
      quizNotifications: row.quizNotifications,
      scheduleNotifications: row.scheduleNotifications,
      photoReviewNotifications: row.photoReviewNotifications,
      announcementNotifications: row.announcementNotifications,
    } : defaultPreferences);
  }

  async updatePreferences(principal: TrustedPrincipal, input: unknown) {
    assertActivePrincipal(principal);
    const data = notificationPreferencesUpdateSchema.parse(input);
    const current = await this.getPreferences(principal);
    const next = { ...current, ...data };
    await this.db.insert(notificationPreferences).values({ userId: principal.userId, ...next }).onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...next, updatedAt: new Date() } });
    return next;
  }

  async registerDevice(principal: TrustedPrincipal, input: unknown) {
    assertActivePrincipal(principal);
    const data = pushDeviceRegistrationSchema.parse(input);
    const result = await this.db.transaction(async (tx) => {
      await tx.delete(pushDevices).where(and(eq(pushDevices.deviceId, data.deviceId), sql`${pushDevices.userId} <> ${principal.userId}`));
      await tx.delete(pushDevices).where(and(eq(pushDevices.expoPushToken, data.expoPushToken), sql`${pushDevices.userId} <> ${principal.userId}`));
      const [row] = await tx.insert(pushDevices).values({ userId: principal.userId, ...data, lastSeenAt: new Date(), invalidatedAt: null, updatedAt: new Date() }).onConflictDoUpdate({ target: [pushDevices.userId, pushDevices.deviceId], set: { platform: data.platform, expoPushToken: data.expoPushToken, lastSeenAt: new Date(), invalidatedAt: null, updatedAt: new Date() } }).returning();
      return row;
    });
    return { id: result.id, deviceId: result.deviceId, platform: result.platform, createdAt: result.createdAt.toISOString(), lastSeenAt: result.lastSeenAt.toISOString() };
  }

  async removeDevice(principal: TrustedPrincipal, deviceId: string) {
    assertActivePrincipal(principal);
    await this.db.delete(pushDevices).where(and(eq(pushDevices.userId, principal.userId), eq(pushDevices.deviceId, deviceId)));
    return { success: true as const };
  }

  async getRecipientAnnouncement(principal: TrustedPrincipal, announcementId: string) {
    assertActivePrincipal(principal);
    const [row] = await this.db.select({ announcement: announcements }).from(announcements).innerJoin(notifications, and(eq(notifications.targetKind, "announcement"), eq(notifications.targetId, announcements.id), eq(notifications.recipientUserId, principal.userId))).where(and(eq(announcements.id, announcementId), eq(announcements.status, "published"))).limit(1);
    if (!row) throw new DomainError(404, "ANNOUNCEMENT_NOT_FOUND", "Объявление не найдено");
    const announcement = row.announcement;
    return { id: announcement.id, title: announcement.title, body: announcement.body, requiresAcknowledgement: announcement.requiresAcknowledgement, publishedAt: announcement.publishedAt?.toISOString() ?? announcement.updatedAt.toISOString() };
  }

  async listAnnouncements(principal: TrustedPrincipal, input: unknown) {
    this.assertAnnouncementManager(principal);
    const query = announcementListQuerySchema.parse(input);
    const conditions = query.status ? [eq(announcements.status, query.status)] : [];
    const rows = await this.db.select().from(announcements).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(announcements.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const visible = principal.role === "admin" ? rows : (await Promise.all(rows.map(async (row) => {
      const targets = await this.readTargets(this.db, row.id);
      return targets.storeIds.length > 0 && targets.storeIds.every((storeId) => principal.storeIds.includes(storeId)) && targets.roles.every((role) => role === "staff") ? row : null;
    }))).filter((row): row is typeof rows[number] => Boolean(row));
    return { data: await Promise.all(visible.map((row) => this.announcementDto(row))), pagination: { page: query.page, pageSize: query.pageSize, total: visible.length, totalPages: Math.ceil(visible.length / query.pageSize) } };
  }

  async createAnnouncement(principal: TrustedPrincipal, input: AnnouncementCreate) {
    this.assertAnnouncementManager(principal);
    const data = announcementCreateSchema.parse(input);
    await this.validateAnnouncementTargets(principal, data.storeIds, data.roles);
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx.insert(announcements).values({ title: data.title, body: data.body, requiresAcknowledgement: data.requiresAcknowledgement, createdBy: principal.userId }).returning({ id: announcements.id });
      await this.writeTargets(tx, row.id, data.storeIds, data.roles);
      await tx.insert(announcementHistory).values({ announcementId: row.id, actorId: principal.userId, action: "created", after: data });
      return row.id;
    });
    return this.getAnnouncement(principal, id);
  }

  async updateAnnouncement(principal: TrustedPrincipal, announcementId: string, input: unknown) {
    this.assertAnnouncementManager(principal);
    const data = announcementUpdateSchema.parse(input);
    const id = await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(announcements).where(eq(announcements.id, announcementId)).for("update").limit(1);
      if (!current) throw new DomainError(404, "ANNOUNCEMENT_NOT_FOUND", "Объявление не найдено");
      if (current.status !== "draft") throw new DomainError(409, "ANNOUNCEMENT_IMMUTABLE", "Опубликованное объявление нельзя изменить");
      const currentTargets = await this.readTargets(tx, announcementId);
      const storeIds = data.storeIds ?? currentTargets.storeIds;
      const roles = data.roles ?? currentTargets.roles;
      await this.validateAnnouncementTargets(principal, storeIds, roles, tx);
      await tx.update(announcements).set({ title: data.title ?? current.title, body: data.body ?? current.body, requiresAcknowledgement: data.requiresAcknowledgement ?? current.requiresAcknowledgement, updatedAt: new Date() }).where(eq(announcements.id, announcementId));
      await tx.delete(announcementStoreTargets).where(eq(announcementStoreTargets.announcementId, announcementId));
      await tx.delete(announcementRoleTargets).where(eq(announcementRoleTargets.announcementId, announcementId));
      await this.writeTargets(tx, announcementId, storeIds, roles);
      await tx.insert(announcementHistory).values({ announcementId, actorId: principal.userId, action: "updated", before: { ...current, ...currentTargets }, after: { ...current, ...data, storeIds, roles } });
      return announcementId;
    });
    return this.getAnnouncement(principal, id);
  }

  async publishAnnouncement(principal: TrustedPrincipal, announcementId: string) {
    this.assertAnnouncementManager(principal);
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(announcements).where(eq(announcements.id, announcementId)).for("update").limit(1);
      if (!current) throw new DomainError(404, "ANNOUNCEMENT_NOT_FOUND", "Объявление не найдено");
      if (current.status !== "draft") throw new DomainError(409, "ANNOUNCEMENT_ALREADY_PUBLISHED", "Объявление уже опубликовано");
      const targets = await this.readTargets(tx, announcementId);
      await this.validateAnnouncementTargets(principal, targets.storeIds, targets.roles, tx);
      const recipients = await this.resolveRecipients(tx, targets.storeIds, targets.roles);
      const [event] = await tx.insert(domainEvents).values({ eventType: "announcement.published", aggregateType: "announcement", aggregateId: announcementId, actorId: principal.userId, payload: { announcementId } }).returning({ id: domainEvents.id });
      await tx.update(announcements).set({ status: "published", publishedBy: principal.userId, publishedAt: new Date(), updatedAt: new Date() }).where(eq(announcements.id, announcementId));
      await tx.insert(announcementHistory).values({ announcementId, actorId: principal.userId, action: "published", after: { recipientCount: recipients.length } });
      for (const recipientId of recipients) {
        await this.createNotification(tx, { recipientId, sourceEventId: event.id, eventType: "announcement.published", category: "announcement", title: current.title, body: current.body, target: target("announcement", announcementId), requiresAcknowledgement: current.requiresAcknowledgement });
      }
    });
    return this.getAnnouncement(principal, announcementId);
  }

  async getAnnouncement(principal: TrustedPrincipal, announcementId: string): Promise<AnnouncementResponse> {
    this.assertAnnouncementManager(principal);
    const [row] = await this.db.select().from(announcements).where(eq(announcements.id, announcementId)).limit(1);
    if (!row) throw new DomainError(404, "ANNOUNCEMENT_NOT_FOUND", "Объявление не найдено");
    if (principal.role === "manager") {
      const targets = await this.readTargets(this.db, announcementId);
      await this.validateAnnouncementTargets(principal, targets.storeIds, targets.roles);
    }
    return this.announcementDto(row);
  }

  async routePendingEvents(limit = 100): Promise<number> {
    const pending = await this.db.select({ id: domainEvents.id }).from(domainEvents).leftJoin(notificationEventConsumptions, eq(notificationEventConsumptions.domainEventId, domainEvents.id)).where(isNull(notificationEventConsumptions.domainEventId)).orderBy(asc(domainEvents.createdAt)).limit(limit);
    let routed = 0;
    for (const event of pending) if (await this.consumeEvent(event.id)) routed += 1;
    return routed;
  }

  async consumeEvent(eventId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(domainEvents).where(eq(domainEvents.id, eventId)).for("update").limit(1);
      if (!event) return false;
      const [claimed] = await tx.insert(notificationEventConsumptions).values({ domainEventId: event.id }).onConflictDoNothing().returning({ domainEventId: notificationEventConsumptions.domainEventId });
      if (!claimed) return false;
      const messages = await this.eventMessages(tx, event);
      for (const message of messages) await this.createNotification(tx, message);
      return true;
    });
  }

  private async eventMessages(tx: DbContext, event: typeof domainEvents.$inferSelect) {
    const payload = asPayload(event.payload);
    const category = categoryForEvent(event.eventType);
    if (!category || event.eventType === "announcement.published") return [];
    if (event.eventType === "knowledge.published") {
      const articleId = payloadId(payload, "articleId");
      if (!articleId) return [];
      const targets = await tx.select().from(knowledgeVisibilityTargets).where(eq(knowledgeVisibilityTargets.articleId, articleId));
      const recipients = await this.resolveKnowledgeRecipients(tx, targets);
      return recipients.map((recipientId) => ({ recipientId, sourceEventId: event.id, eventType: event.eventType, category, title: "Новый материал в базе знаний", body: "Вам доступен новый обучающий материал.", target: target("knowledge", articleId), requiresAcknowledgement: Boolean(payload.requiresAcknowledgement) }));
    }
    const taskId = payloadId(payload, "taskId") ?? (event.aggregateType === "task" ? event.aggregateId : null);
    if (event.eventType === "task.assigned" && taskId) {
      const recipientId = payloadId(payload, "assignedEmployeeId");
      return recipientId ? [{ recipientId, sourceEventId: event.id, eventType: event.eventType, category, title: "Новое задание", body: "Вам назначено новое задание.", target: target("task", taskId), requiresAcknowledgement: false }] : [];
    }
    if (taskId && ["task.checked", "task.rejected"].includes(event.eventType)) {
      const [task] = await tx.select({ recipientId: taskOccurrences.assignedEmployeeId }).from(taskOccurrences).where(eq(taskOccurrences.id, taskId)).limit(1);
      if (!task) return [];
      return [{ recipientId: task.recipientId, sourceEventId: event.id, eventType: event.eventType, category, title: event.eventType === "task.checked" ? "Задание проверено" : "Задание возвращено", body: event.eventType === "task.checked" ? "Проверка задания завершена." : "Задание возвращено на доработку.", target: target("task", taskId), requiresAcknowledgement: false }];
    }
    if (taskId && ["task.submitted", "task.resubmitted"].includes(event.eventType)) {
      const [task] = await tx.select({ storeId: taskOccurrences.storeId }).from(taskOccurrences).where(eq(taskOccurrences.id, taskId)).limit(1);
      if (!task) return [];
      const recipients = await this.resolveRecipients(tx, [task.storeId], ["admin", "manager"] as any);
      return recipients.map((recipientId) => ({ recipientId, sourceEventId: event.id, eventType: event.eventType, category, title: "Задание отправлено", body: "Сотрудник отправил задание на проверку.", target: target("task", taskId), requiresAcknowledgement: false }));
    }
    const reportId = payloadId(payload, "reportId") ?? (event.aggregateType === "photo_report" ? event.aggregateId : null);
    if (reportId && ["photo.submitted", "photo.resubmitted"].includes(event.eventType)) {
      const storeId = payloadId(payload, "storeId");
      if (!storeId) return [];
      const recipients = await this.resolveRecipients(tx, [storeId], ["admin", "manager"] as any);
      return recipients.map((recipientId) => ({ recipientId, sourceEventId: event.id, eventType: event.eventType, category, title: "Новое фото на проверку", body: "Появилась фотография, ожидающая проверки.", target: target("photo_report", reportId), requiresAcknowledgement: false }));
    }
    if (reportId && ["photo.checked", "photo.rejected"].includes(event.eventType)) {
      const [report] = await tx.select({ recipientId: photoReports.submittedBy }).from(photoReports).where(eq(photoReports.id, reportId)).limit(1);
      if (!report) return [];
      return [{ recipientId: report.recipientId, sourceEventId: event.id, eventType: event.eventType, category, title: event.eventType === "photo.checked" ? "Фото принято" : "Фото отклонено", body: event.eventType === "photo.checked" ? "Проверка фото завершена успешно." : "Фото отклонено. Откройте раздел фото для деталей.", target: target("photo_report", reportId), requiresAcknowledgement: false }];
    }
    if (event.eventType === "quiz.assigned") {
      const recipientId = payloadId(payload, "userId");
      const quizId = payloadId(payload, "quizId");
      return recipientId && quizId ? [{ recipientId, sourceEventId: event.id, eventType: event.eventType, category, title: "Новый тест", body: "Вам назначен новый тест.", target: target("quiz", quizId), requiresAcknowledgement: false }] : [];
    }
    if (["quiz.completed", "quiz.reviewed"].includes(event.eventType)) {
      const attemptId = payloadId(payload, "attemptId") ?? event.aggregateId;
      const [attempt] = await tx.select({ recipientId: quizAttempts.userId, quizId: quizAttempts.quizId }).from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
      if (!attempt) return [];
      return [{ recipientId: attempt.recipientId, sourceEventId: event.id, eventType: event.eventType, category, title: event.eventType === "quiz.completed" ? "Тест завершён" : "Результат теста обновлён", body: event.eventType === "quiz.completed" ? "Результат теста доступен." : "Ответы на тест проверены.", target: target("attempt", attemptId), requiresAcknowledgement: false }];
    }
    if (event.eventType === "schedule.published" || (event.eventType === "schedule.updated" && payload.action === "revised")) {
      const scheduleId = payloadId(payload, "scheduleId") ?? event.aggregateId;
      const shifts = await tx.select({ employeeId: scheduleShifts.employeeId }).from(scheduleShifts).where(eq(scheduleShifts.periodId, scheduleId));
      const daysOff = await tx.select({ employeeId: scheduleDaysOff.employeeId }).from(scheduleDaysOff).where(eq(scheduleDaysOff.periodId, scheduleId));
      return distinct([...shifts, ...daysOff].map((row) => row.employeeId)).map((recipientId) => ({ recipientId, sourceEventId: event.id, eventType: event.eventType, category, title: "Расписание опубликовано", body: "Ваше рабочее расписание обновлено.", target: target("schedule", scheduleId), requiresAcknowledgement: false }));
    }
    return [];
  }

  private async createNotification(tx: DbContext, input: { recipientId: string; sourceEventId: string; eventType: string; category: NotificationCategory; title: string; body: string; target: NotificationTarget; requiresAcknowledgement: boolean }) {
    const [recipient] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.recipientId), eq(users.isActive, true))).limit(1);
    if (!recipient) return;
    const [notification] = await tx.insert(notifications).values({ recipientUserId: input.recipientId, sourceEventId: input.sourceEventId, eventType: input.eventType, category: input.category, title: input.title, body: input.body, targetKind: input.target.kind, targetId: input.target.id, requiresAcknowledgement: input.requiresAcknowledgement }).onConflictDoNothing({ target: [notifications.sourceEventId, notifications.recipientUserId] }).returning();
    if (!notification) return;
    const [preferences] = await tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, input.recipientId)).limit(1);
    const effective = preferences ?? defaultPreferences;
    if (!preferenceEnabled(effective, input.category)) return;
    const devices = await tx.select({ id: pushDevices.id }).from(pushDevices).where(and(eq(pushDevices.userId, input.recipientId), isNull(pushDevices.invalidatedAt)));
    if (devices.length) await tx.insert(notificationOutbox).values(devices.map((device: { id: string }) => ({ notificationId: notification.id, deviceId: device.id }))).onConflictDoNothing({ target: [notificationOutbox.notificationId, notificationOutbox.deviceId] });
  }

  private notificationDto(row: typeof notifications.$inferSelect) {
    return { id: row.id, eventType: row.eventType, category: row.category as NotificationCategory, title: row.title, body: row.body, target: row.targetKind && row.targetId ? target(row.targetKind, row.targetId) : null, requiresAcknowledgement: row.requiresAcknowledgement, readAt: dateValue(row.readAt), acknowledgedAt: dateValue(row.acknowledgedAt), createdAt: row.createdAt.toISOString() };
  }

  private assertAnnouncementManager(principal: TrustedPrincipal) {
    assertActivePrincipal(principal);
    if (principal.role !== "admin" && principal.role !== "manager") throw new DomainError(403, "FORBIDDEN", "Объявления доступны только руководителям");
  }

  private async validateAnnouncementTargets(principal: TrustedPrincipal, storeIds: readonly string[], roles: readonly string[], tx: DbContext = this.db) {
    const uniqueStores = distinct(storeIds);
    const uniqueRoles = distinct(roles);
    if (!uniqueRoles.length || uniqueRoles.some((role) => !["staff", "manager"].includes(role))) throw new DomainError(400, "INVALID_ANNOUNCEMENT_TARGET", "Укажите допустимые роли получателей");
    if (principal.role === "manager" && (uniqueStores.length === 0 || uniqueRoles.some((role) => role !== "staff") || uniqueStores.some((storeId) => !principal.storeIds.includes(storeId)))) throw new DomainError(403, "FORBIDDEN", "Объявление выходит за пределы магазинов менеджера");
    if (uniqueStores.length) {
      const rows = await tx.select({ id: stores.id }).from(stores).where(and(inArray(stores.id, uniqueStores), eq(stores.isActive, true)));
      if (rows.length !== uniqueStores.length) throw new DomainError(400, "INVALID_ANNOUNCEMENT_TARGET", "Один из магазинов недоступен");
    }
  }

  private async writeTargets(tx: DbContext, announcementId: string, storeIds: readonly string[], roles: readonly string[]) {
    if (storeIds.length) await tx.insert(announcementStoreTargets).values(distinct(storeIds).map((storeId) => ({ announcementId, storeId })));
    await tx.insert(announcementRoleTargets).values(distinct(roles).map((role) => ({ announcementId, role: role as "admin" | "manager" | "staff" })));
  }

  private async readTargets(tx: DbContext, announcementId: string): Promise<{ storeIds: string[]; roles: AnnouncementRole[] }> {
    const [storeRows, roleRows] = await Promise.all([
      tx.select({ storeId: announcementStoreTargets.storeId }).from(announcementStoreTargets).where(eq(announcementStoreTargets.announcementId, announcementId)),
      tx.select({ role: announcementRoleTargets.role }).from(announcementRoleTargets).where(eq(announcementRoleTargets.announcementId, announcementId)),
    ]);
    return { storeIds: storeRows.map((row: { storeId: string }) => row.storeId), roles: roleRows.map((row: { role: AnnouncementRole }) => row.role) };
  }

  private async resolveRecipients(tx: DbContext, storeIds: string[], roles: readonly string[]): Promise<string[]> {
    const roleFilter = inArray(users.role, roles as ("admin" | "manager" | "staff")[]);
    const scopeFilter = storeIds.length ? (roles.includes("admin") ? or(eq(users.role, "admin"), inArray(userStores.storeId, storeIds)) : inArray(userStores.storeId, storeIds)) : undefined;
    const rows = await tx.selectDistinct({ id: users.id }).from(users).leftJoin(userStores, eq(userStores.userId, users.id)).where(and(eq(users.isActive, true), roleFilter, scopeFilter));
    return rows.map((row: { id: string }) => row.id);
  }

  private async resolveKnowledgeRecipients(tx: DbContext, targets: Array<typeof knowledgeVisibilityTargets.$inferSelect>): Promise<string[]> {
    const recipients: string[] = [];
    for (const targetRow of targets) {
      if (targetRow.kind === "all") {
        const rows = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "staff"), eq(users.isActive, true)));
        recipients.push(...rows.map((row: { id: string }) => row.id));
        continue;
      }
      const role = targetRow.role ?? "staff";
      const conditions = [eq(users.role, role), eq(users.isActive, true)];
      if (targetRow.storeId) conditions.push(eq(userStores.storeId, targetRow.storeId));
      const rows = await tx.selectDistinct({ id: users.id }).from(users).innerJoin(userStores, eq(userStores.userId, users.id)).where(and(...conditions));
      recipients.push(...rows.map((row: { id: string }) => row.id));
    }
    return distinct(recipients);
  }

  private async announcementDto(row: typeof announcements.$inferSelect): Promise<AnnouncementResponse> {
    const targets = await this.readTargets(this.db, row.id);
    const [metrics] = await Promise.all([
      this.db.select({ recipientCount: count(), readCount: sql<number>`count(*) filter (where ${notifications.readAt} is not null)`, acknowledgedCount: sql<number>`count(*) filter (where ${notifications.acknowledgedAt} is not null)` }).from(notifications).where(and(eq(notifications.targetKind, "announcement"), eq(notifications.targetId, row.id))),
    ]);
    return { id: row.id, title: row.title, body: row.body, status: row.status, storeIds: targets.storeIds, roles: targets.roles, requiresAcknowledgement: row.requiresAcknowledgement, createdBy: row.createdBy, publishedBy: row.publishedBy, publishedAt: dateValue(row.publishedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), metrics: { recipientCount: Number(metrics[0]?.recipientCount ?? 0), readCount: Number(metrics[0]?.readCount ?? 0), acknowledgedCount: Number(metrics[0]?.acknowledgedCount ?? 0) } };
  }
}

export function createNotificationsService(db: Database): NotificationsService {
  return new NotificationsService(db);
}

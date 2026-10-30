import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../src/app";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import { announcementHistory, announcementRoleTargets, announcementStoreTargets, announcements, domainEvents, notificationDeliveryAttempts, notificationEventConsumptions, notificationOutbox, notifications, pushDevices, stores, userStores, users } from "../src/db/schema";
import type { TrustedPrincipal } from "../src/domain/authz";
import { createNotificationsService } from "../src/domain/notifications/service";
import { NotificationWorker, type PushMessage, type PushProvider } from "../src/notifications/worker";
import { noopLogger } from "../src/lib/logger";

const suite = Bun.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

suite("Notifications and announcements PostgreSQL integration", () => {
  const { db, client } = createDatabase(loadEnv());
  const service = createNotificationsService(db);
  const suffix = crypto.randomUUID().slice(0, 8);
  let adminId = "";
  let managerId = "";
  let staffId = "";
  let storeId = "";
  const eventIds: string[] = [];
  let announcementId = "";
  let deviceId = "";
  const admin = (): TrustedPrincipal => ({ userId: adminId, role: "admin", storeIds: [], isActive: true });
  const manager = (): TrustedPrincipal => ({ userId: managerId, role: "manager", storeIds: [storeId], isActive: true });
  const staff = (): TrustedPrincipal => ({ userId: staffId, role: "staff", storeIds: [storeId], isActive: true });

  beforeAll(async () => {
    const [store] = await db.insert(stores).values({ name: `Notification Store ${suffix}`, code: `NTF-${suffix}` }).returning({ id: stores.id });
    storeId = store.id;
    const created = await db.insert(users).values([
      { firstName: "Notification", lastName: "Admin", email: `notification-admin-${suffix}@example.com`, role: "admin", isActive: true },
      { firstName: "Notification", lastName: "Manager", email: `notification-manager-${suffix}@example.com`, role: "manager", isActive: true },
      { firstName: "Notification", lastName: "Staff", email: `notification-staff-${suffix}@example.com`, role: "staff", isActive: true },
    ]).returning({ id: users.id });
    [adminId, managerId, staffId] = created.map((row) => row.id);
    await db.insert(userStores).values([{ userId: managerId, storeId }, { userId: staffId, storeId }]);
  });

  afterAll(async () => {
    if (announcementId) {
      await db.delete(announcementHistory).where(eq(announcementHistory.announcementId, announcementId));
      await db.delete(announcementRoleTargets).where(eq(announcementRoleTargets.announcementId, announcementId));
      await db.delete(announcementStoreTargets).where(eq(announcementStoreTargets.announcementId, announcementId));
      await db.delete(announcements).where(eq(announcements.id, announcementId));
    }
    for (const eventId of eventIds) {
      const notificationIds = (await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.sourceEventId, eventId))).map((row) => row.id);
      if (notificationIds.length) await db.delete(notificationOutbox).where(inArray(notificationOutbox.notificationId, notificationIds));
      await db.delete(notifications).where(eq(notifications.sourceEventId, eventId));
      await db.delete(notificationEventConsumptions).where(eq(notificationEventConsumptions.domainEventId, eventId));
      await db.delete(domainEvents).where(eq(domainEvents.id, eventId));
    }
    if (deviceId) await db.delete(pushDevices).where(eq(pushDevices.id, deviceId));
    await db.delete(userStores).where(inArray(userStores.userId, [managerId, staffId]));
    await db.delete(users).where(inArray(users.id, [adminId, managerId, staffId]));
    if (storeId) await db.delete(stores).where(eq(stores.id, storeId));
    await client.end();
  });

  test("routes scoped events, protects inbox access, delivers push and publishes targeted announcements", async () => {
    const device = await service.registerDevice(staff(), { deviceId: `iphone-${suffix}`, platform: "ios", expoPushToken: `ExponentPushToken[${suffix}]` });
    deviceId = device.id;
    const [event] = await db.insert(domainEvents).values({ eventType: "task.assigned", aggregateType: "task", aggregateId: crypto.randomUUID(), actorId: managerId, payload: { taskId: crypto.randomUUID(), assignedEmployeeId: staffId } }).returning({ id: domainEvents.id });
    eventIds.push(event.id);
    expect(await service.consumeEvent(event.id)).toBe(true);
    expect(await service.consumeEvent(event.id)).toBe(false);

    const app = createApp({ db, allowedOrigins: [], notificationRoutes: { notifications: service, resolvePrincipal: (context) => context.req.header("x-role") === "staff" ? staff() : manager() } });
    const staffInbox = await app.request("http://localhost/api/v1/me/notifications", { headers: { "x-role": "staff" } });
    expect(staffInbox.status).toBe(200);
    expect((await staffInbox.json()).unreadCount).toBe(1);
    const unreadInbox = await app.request("http://localhost/api/v1/me/notifications?unreadOnly=true", { headers: { "x-role": "staff" } });
    expect(unreadInbox.status).toBe(200);
    expect((await unreadInbox.json()).data).toHaveLength(1);
    const managerInbox = await app.request("http://localhost/api/v1/me/notifications", { headers: { "x-role": "manager" } });
    expect((await managerInbox.json()).data).toHaveLength(0);

    const delivered: PushMessage[] = [];
    const provider: PushProvider = { send: async (message) => { delivered.push(message); return { ok: true, ticketId: `ticket-${suffix}` }; } };
    const worker = new NotificationWorker(db, provider, noopLogger, { batchSize: 20 });
    await worker.processOnce();
    expect(delivered.some((message) => message.data?.target.kind === "task")).toBe(true);

    const rejectedDevice = await service.registerDevice(staff(), { deviceId: `android-${suffix}`, platform: "android", expoPushToken: `ExponentPushToken[bad-${suffix}]` });
    const [rejectedEvent] = await db.insert(domainEvents).values({ eventType: "task.assigned", aggregateType: "task", aggregateId: crypto.randomUUID(), actorId: managerId, payload: { taskId: crypto.randomUUID(), assignedEmployeeId: staffId } }).returning({ id: domainEvents.id });
    eventIds.push(rejectedEvent.id);
    await service.consumeEvent(rejectedEvent.id);
    const failingProvider: PushProvider = { send: async (message) => message.to.includes("bad-") ? { ok: false, errorCode: "DeviceNotRegistered" } : { ok: true, ticketId: `ticket-2-${suffix}` } };
    await new NotificationWorker(db, failingProvider, noopLogger, { batchSize: 20 }).processOnce();
    const [invalidated] = await db.select().from(pushDevices).where(eq(pushDevices.id, rejectedDevice.id));
    expect(invalidated.invalidatedAt).not.toBeNull();
    const rejectedNotification = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.sourceEventId, rejectedEvent.id));
    const attempts = await db.select().from(notificationDeliveryAttempts).where(inArray(notificationDeliveryAttempts.outboxId, (await db.select({ id: notificationOutbox.id }).from(notificationOutbox).where(inArray(notificationOutbox.notificationId, rejectedNotification.map((row) => row.id)))).map((row) => row.id)));
    expect(attempts.some((attempt) => attempt.status === "permanent")).toBe(true);

    const announcement = await service.createAnnouncement(admin(), { title: "Важная новость", body: "Проверьте расписание в приложении.", storeIds: [storeId], roles: ["staff"], requiresAcknowledgement: true });
    announcementId = announcement.id;
    const published = await service.publishAnnouncement(admin(), announcementId);
    expect(published.status).toBe("published");
    expect(published.metrics.recipientCount).toBe(1);
    const recipient = await service.getRecipientAnnouncement(staff(), announcementId);
    expect(recipient.title).toBe("Важная новость");
    await expect(service.getRecipientAnnouncement(manager(), announcementId)).rejects.toMatchObject({ status: 404 });
  });
});

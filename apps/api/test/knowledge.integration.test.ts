import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../src/app";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import { knowledgeAcknowledgments, knowledgeArticleRevisions, knowledgeArticles, knowledgeCategories, knowledgeVisibilityTargets, domainEvents, notificationEventConsumptions, notificationOutbox, notifications, stores, userStores, users } from "../src/db/schema";
import type { TrustedPrincipal } from "../src/domain/authz";
import { createKnowledgeService } from "../src/domain/knowledge/service";
import { createNotificationsService } from "../src/domain/notifications/service";
import { LocalPhotoStorage } from "../src/storage/photo-storage";

const suite = Bun.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

suite("Knowledge base PostgreSQL integration", () => {
  const { db, client } = createDatabase(loadEnv());
  const suffix = crypto.randomUUID().slice(0, 8);
  const knowledge = createKnowledgeService(db, new LocalPhotoStorage(`/tmp/vizaje-knowledge-tests-${suffix}`), { maxBytes: 10 * 1024 * 1024, maxDimension: 8192, maxPixels: 25_000_000 });
  const notificationsService = createNotificationsService(db);
  let adminId = "";
  let managerId = "";
  let staffId = "";
  let otherStaffId = "";
  let storeId = "";
  let otherStoreId = "";
  let categoryId = "";
  let articleId = "";
  const admin = (): TrustedPrincipal => ({ userId: adminId, role: "admin", storeIds: [], isActive: true });
  const manager = (): TrustedPrincipal => ({ userId: managerId, role: "manager", storeIds: [storeId], isActive: true });
  const staff = (): TrustedPrincipal => ({ userId: staffId, role: "staff", storeIds: [storeId], isActive: true });
  const otherStaff = (): TrustedPrincipal => ({ userId: otherStaffId, role: "staff", storeIds: [otherStoreId], isActive: true });

  beforeAll(async () => {
    const createdStores = await db.insert(stores).values([{ name: `Knowledge Store ${suffix}`, code: `KNW-${suffix}` }, { name: `Other Knowledge Store ${suffix}`, code: `KNW-2-${suffix}` }]).returning({ id: stores.id });
    storeId = createdStores[0]!.id; otherStoreId = createdStores[1]!.id;
    const createdUsers = await db.insert(users).values([
      { firstName: "Knowledge", lastName: "Admin", email: `knowledge-admin-${suffix}@example.com`, role: "admin", isActive: true },
      { firstName: "Knowledge", lastName: "Manager", email: `knowledge-manager-${suffix}@example.com`, role: "manager", isActive: true },
      { firstName: "Knowledge", lastName: "Staff", email: `knowledge-staff-${suffix}@example.com`, role: "staff", isActive: true },
      { firstName: "Other", lastName: "Staff", email: `knowledge-other-${suffix}@example.com`, role: "staff", isActive: true },
    ]).returning({ id: users.id });
    [adminId, managerId, staffId, otherStaffId] = createdUsers.map((row) => row.id);
    await db.insert(userStores).values([{ userId: managerId, storeId }, { userId: staffId, storeId }, { userId: otherStaffId, storeId: otherStoreId }]);
    const [category] = await db.insert(knowledgeCategories).values({ name: `Тестовая база ${suffix}`, slug: `test-${suffix}` }).returning({ id: knowledgeCategories.id });
    categoryId = category.id;
  });

  afterAll(async () => {
    if (articleId) {
      const revisionIds = (await db.select({ id: knowledgeArticleRevisions.id }).from(knowledgeArticleRevisions).where(eq(knowledgeArticleRevisions.articleId, articleId))).map((row) => row.id);
      await db.delete(knowledgeAcknowledgments).where(eq(knowledgeAcknowledgments.articleId, articleId));
      const eventRows = await db.select({ id: domainEvents.id }).from(domainEvents).where(and(eq(domainEvents.aggregateType, "knowledge_article"), eq(domainEvents.aggregateId, articleId)));
      for (const event of eventRows) {
        const notificationRows = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.sourceEventId, event.id));
        if (notificationRows.length) await db.delete(notificationOutbox).where(inArray(notificationOutbox.notificationId, notificationRows.map((row) => row.id)));
        await db.delete(notifications).where(eq(notifications.sourceEventId, event.id));
        await db.delete(notificationEventConsumptions).where(eq(notificationEventConsumptions.domainEventId, event.id));
      }
      await db.delete(domainEvents).where(and(eq(domainEvents.aggregateType, "knowledge_article"), eq(domainEvents.aggregateId, articleId)));
      await db.delete(knowledgeArticles).where(eq(knowledgeArticles.id, articleId));
      if (revisionIds.length) await db.delete(knowledgeArticleRevisions).where(inArray(knowledgeArticleRevisions.id, revisionIds));
    }
    if (categoryId) await db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, categoryId));
    if (managerId && staffId && otherStaffId) await db.delete(userStores).where(inArray(userStores.userId, [managerId, staffId, otherStaffId]));
    if (adminId) await db.delete(users).where(inArray(users.id, [adminId, managerId, staffId, otherStaffId]));
    if (storeId && otherStoreId) await db.delete(stores).where(inArray(stores.id, [storeId, otherStoreId]));
    await client.end();
  });

  test("publishes scoped revisions, protects staff visibility and supports idempotent acknowledgement", async () => {
    const draft = await knowledge.createArticle(manager(), {
      categoryId,
      title: "Стандарт консультации",
      summary: "Короткое описание",
      body: "# Консультация\n\n- Сначала уточните потребность клиента.",
      contentFormat: "markdown",
      visibilityTargets: [{ kind: "store", storeId }],
      requiresAcknowledgement: true,
      quizIds: [],
    });
    articleId = draft.id;
    expect(draft.status).toBe("draft");
    expect((await knowledge.listStaff(staff(), { page: 1, pageSize: 20 })).pagination.total).toBe(0);
    await expect(knowledge.getManagement(manager(), articleId)).resolves.toMatchObject({ id: articleId });
    await expect(knowledge.getManagement(manager(), "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });
    const published = await knowledge.publish(manager(), articleId);
    expect(published.status).toBe("published");
    expect(published.published?.body).toContain("Консультация");
    expect((await knowledge.listStaff(staff(), { page: 1, pageSize: 20 })).pagination.total).toBe(1);
    expect((await knowledge.listStaff(otherStaff(), { page: 1, pageSize: 20 })).pagination.total).toBe(0);
    const [publishedEvent] = await db.select({ id: domainEvents.id }).from(domainEvents).where(and(eq(domainEvents.aggregateType, "knowledge_article"), eq(domainEvents.aggregateId, articleId))).limit(1);
    expect(await notificationsService.consumeEvent(publishedEvent.id)).toBe(true);
    const inbox = await notificationsService.listMine(staff(), { page: 1, pageSize: 20, unreadOnly: undefined });
    expect(inbox.data[0]).toMatchObject({ category: "knowledge", target: { kind: "knowledge", id: articleId } });
    const app = createApp({ db, allowedOrigins: [], knowledgeRoutes: { knowledge, maxUploadBytes: 10 * 1024 * 1024, resolvePrincipal: (context) => context.req.header("x-test-role") === "staff" ? staff() : manager() } });
    const staffResponse = await app.request("http://localhost/api/v1/me/knowledge/articles", { headers: { "x-test-role": "staff" } });
    expect(staffResponse.status).toBe(200);
    const staffArticle = await app.request(`http://localhost/api/v1/me/knowledge/articles/${articleId}`, { headers: { "x-test-role": "staff" } });
    expect(staffArticle.status).toBe(200);
    const denied = await app.request(`http://localhost/api/v1/me/knowledge/articles/${articleId}`, { headers: { "x-test-role": "manager" } });
    expect(denied.status).toBe(403);
    const acknowledgement = await knowledge.acknowledge(staff(), articleId);
    expect(await knowledge.acknowledge(staff(), articleId)).toMatchObject({ revisionId: acknowledgement.revisionId });
    expect((await knowledge.listAcknowledgments(manager(), articleId)).data).toHaveLength(1);
    const revised = await knowledge.updateArticle(manager(), articleId, { body: "## Обновлённый стандарт\n\nТекст новой версии." });
    expect(revised.draft?.revisionNumber).toBe(2);
    expect(revised.published?.revisionNumber).toBe(1);
    const republished = await knowledge.publish(manager(), articleId);
    expect(republished.published?.revisionNumber).toBe(2);
    expect((await knowledge.getStaff(staff(), articleId)).acknowledgedAt).toBeNull();
  });
});

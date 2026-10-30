import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../src/app";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import { domainEvents, stores, taskChecklistItems, taskOccurrences, taskRecurrences, taskReviewHistory, taskSubmissions, taskTemplateChecklistItems, taskTemplateVersions, taskTemplates, users } from "../src/db/schema";
import type { TrustedPrincipal } from "../src/domain/authz";
import { createStoresService } from "../src/domain/stores/service";
import { createTasksService } from "../src/domain/tasks/service";
import { createUsersService } from "../src/domain/users/service";
import { LocalPhotoStorage } from "../src/storage/photo-storage";

const suite = Bun.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

suite("Retail tasks PostgreSQL integration", () => {
  const { db, client } = createDatabase(loadEnv());
  const storesService = createStoresService(db);
  const usersService = createUsersService(db);
  const tasks = createTasksService(db, new LocalPhotoStorage(`/tmp/vizaje-task-tests-${Date.now()}`), { maxBytes: 10 * 1024 * 1024, maxDimension: 8192, maxPixels: 25_000_000 });
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
  let adminId = "";
  let managerId = "";
  let staffId = "";
  let otherStaffId = "";
  let storeId = "";
  let otherStoreId = "";
  let templateId = "";
  let recurrenceId = "";
  const taskIds: string[] = [];
  const submissionIds: string[] = [];
  const admin = (): TrustedPrincipal => ({ userId: adminId, role: "admin", storeIds: [], isActive: true });
  const manager = (): TrustedPrincipal => ({ userId: managerId, role: "manager", storeIds: [storeId], isActive: true });
  const staff = (): TrustedPrincipal => ({ userId: staffId, role: "staff", storeIds: [storeId], isActive: true });

  beforeAll(async () => {
    const [adminUser] = await db.insert(users).values({ firstName: "Task", lastName: "Admin", email: `task-admin-${suffix}@example.com`, role: "admin", isActive: true }).returning({ id: users.id });
    adminId = adminUser.id;
    const first = await storesService.createStore(admin(), { name: `Task Store ${suffix}`, code: `TSK-${suffix}` });
    const second = await storesService.createStore(admin(), { name: `Other Task Store ${suffix}`, code: `TSK-2-${suffix}` });
    storeId = first.id; otherStoreId = second.id;
    const managerUser = await usersService.createUser(admin(), { firstName: "Task", lastName: "Manager", phone: `+37369${suffix}1`, email: `task-manager-${suffix}@example.com`, role: "manager", isActive: true, storeIds: [storeId] });
    const staffUser = await usersService.createUser(admin(), { firstName: "Task", lastName: "Staff", phone: `+37369${suffix}2`, email: `task-staff-${suffix}@example.com`, role: "staff", isActive: true, storeIds: [storeId] });
    const otherStaffUser = await usersService.createUser(admin(), { firstName: "Other", lastName: "Task Staff", phone: `+37369${suffix}3`, email: `task-other-staff-${suffix}@example.com`, role: "staff", isActive: true, storeIds: [otherStoreId] });
    managerId = managerUser.id; staffId = staffUser.id; otherStaffId = otherStaffUser.id;
  });

  afterAll(async () => {
    if (submissionIds.length) await db.delete(taskReviewHistory).where(inArray(taskReviewHistory.submissionId, submissionIds));
    if (taskIds.length) {
      await db.delete(taskReviewHistory).where(inArray(taskReviewHistory.taskId, taskIds));
      await db.delete(taskSubmissions).where(inArray(taskSubmissions.taskId, taskIds));
      await db.delete(taskChecklistItems).where(inArray(taskChecklistItems.taskId, taskIds));
      await db.delete(taskOccurrences).where(inArray(taskOccurrences.id, taskIds));
      await db.delete(domainEvents).where(and(eq(domainEvents.aggregateType, "task"), inArray(domainEvents.aggregateId, taskIds)));
    }
    if (recurrenceId) await db.delete(taskRecurrences).where(eq(taskRecurrences.id, recurrenceId));
    if (templateId) {
      const versions = await db.select({ id: taskTemplateVersions.id }).from(taskTemplateVersions).where(eq(taskTemplateVersions.templateId, templateId));
      if (versions.length) await db.delete(taskTemplateChecklistItems).where(inArray(taskTemplateChecklistItems.versionId, versions.map((version) => version.id)));
      await db.delete(taskTemplateVersions).where(eq(taskTemplateVersions.templateId, templateId));
      await db.delete(taskTemplates).where(eq(taskTemplates.id, templateId));
    }
    if (managerId && staffId && otherStaffId) await db.delete(users).where(inArray(users.id, [managerId, staffId, otherStaffId]));
    if (adminId) await db.delete(users).where(eq(users.id, adminId));
    if (storeId && otherStoreId) await db.delete(stores).where(inArray(stores.id, [storeId, otherStoreId]));
    await client.end();
  });

  test("assigns independently, supports reject/resubmit/check and scopes HTTP access", async () => {
    const template = await tasks.createTemplate(manager(), { title: "Проверка полки", description: null, category: "Мерчандайзинг", defaultPriority: "high", requiresReview: true, requiresPhoto: false, checklist: [{ label: "Проверить ценники", isRequired: true, requiresEvidence: false }], active: true });
    templateId = template.id;
    let task = await tasks.createTask(manager(), { templateId, title: "Проверка полки", description: null, category: "Мерчандайзинг", priority: "high", storeIds: [storeId], employeeIds: [staffId], roles: [], dueAt: null, timezone: "Europe/Chisinau", requiresReview: true, requiresPhoto: false, checklist: [] });
    taskIds.push(task.id);
    expect(task.status).toBe("assigned");
    await expect(tasks.get(manager(), task.id)).resolves.toMatchObject({ id: task.id });
    await expect(tasks.get(manager(), "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });
    await expect(tasks.list(staff(), { page: 1, pageSize: 20 })).resolves.toMatchObject({ pagination: { total: 1 } });
    task = await tasks.start(staff(), task.id);
    task = await tasks.updateChecklist(staff(), task.id, task.checklist[0]!.id, { completed: true, note: null, expectedVersion: task.version });
    task = await tasks.submit(staff(), task.id, { completionNote: "Готово", expectedVersion: task.version }, "task-submit-1");
    const submitted = task.latestSubmission!;
    submissionIds.push(submitted.id);
    await expect(tasks.review(manager(), submitted.id, false, { expectedVersion: task.version, comment: "Проверьте ещё раз" })).resolves.toMatchObject({ status: "rejected" });
    task = await tasks.start(staff(), task.id);
    task = await tasks.submit(staff(), task.id, { completionNote: "Исправлено", expectedVersion: task.version }, "task-submit-2");
    submissionIds.push(task.latestSubmission!.id);
    await expect(tasks.review(manager(), task.latestSubmission!.id, true, { expectedVersion: task.version, comment: null })).resolves.toMatchObject({ status: "checked" });
    const app = createApp({ db, allowedOrigins: [], taskRoutes: { tasks, maxUploadBytes: 10 * 1024 * 1024, resolvePrincipal: (context) => context.req.header("x-test-role") === "staff" ? staff() : manager() } });
    const response = await app.request("http://localhost/api/v1/me/tasks", { headers: { "x-test-role": "staff" } });
    expect(response.status).toBe(200);
    const denied = await app.request(`http://localhost/api/v1/management/tasks/${task.id}`, { headers: { "x-test-role": "staff" } });
    expect(denied.status).toBe(403);
    const events = await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateType, "task"), eq(domainEvents.aggregateId, task.id)));
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["task.assigned", "task.started", "task.submitted", "task.rejected", "task.checked"]));
  });

  test("generates recurrence idempotently and denies cross-store management", async () => {
    const recurrence = (await tasks.createRecurrence(manager(), { templateId, storeIds: [storeId], employeeIds: [staffId], roles: [], frequency: "daily", interval: 1, startsOn: "2026-04-01", endsOn: "2026-04-02", timezone: "Europe/Chisinau" }))[0]!;
    recurrenceId = recurrence.id;
    const first = await tasks.generateRecurrence(manager(), recurrence.id, { from: "2026-04-01", to: "2026-04-02" });
    taskIds.push(...first.taskIds);
    expect(first.createdCount).toBe(2);
    expect((await tasks.generateRecurrence(manager(), recurrence.id, { from: "2026-04-01", to: "2026-04-02" })).createdCount).toBe(0);
    const otherStoreTask = await tasks.createTask(admin(), { title: "Чужой магазин", description: null, category: "Контроль", priority: "normal", storeIds: [otherStoreId], employeeIds: [otherStaffId], roles: [], dueAt: null, timezone: "Europe/Chisinau", requiresReview: false, requiresPhoto: false, checklist: [] });
    taskIds.push(otherStoreTask.id);
    await expect(tasks.get(manager(), otherStoreTask.id)).rejects.toMatchObject({ status: 403 });
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { desc, eq, inArray } from "drizzle-orm";
import { createApp } from "../src/app";
import { createAuthService } from "../src/auth/service";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import { photos, quizAttempts, quizRevisions, quizzes, stores, users } from "../src/db/schema";
import { createDashboardService } from "../src/domain/dashboard/service";
import type { TrustedPrincipal } from "../src/domain/authz";
import { createQuizService } from "../src/domain/quizzes/service";
import { createStoresService } from "../src/domain/stores/service";
import { createUsersService } from "../src/domain/users/service";
import { noopLogger } from "../src/lib/logger";

const integrationEnabled = Bun.env.RUN_INTEGRATION_TESTS === "1";
const suite = integrationEnabled ? describe : describe.skip;

function suffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9);
}

function quizQuestions() {
  return [
    {
      prompt: "Dashboard question",
      position: 0,
      options: [
        { label: "Correct", position: 0, isCorrect: true },
        { label: "Incorrect", position: 1, isCorrect: false },
      ],
    },
  ];
}

async function responseJson(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

suite("Dashboard PostgreSQL integration", () => {
  const { db, client } = createDatabase(loadEnv());
  const usersService = createUsersService(db);
  const storesService = createStoresService(db);
  const quizzesService = createQuizService(db);
  const dashboard = createDashboardService(db);
  const auth = createAuthService(db);
  const id = suffix();
  const startDate = "2026-01-01T00:00:00.000Z";
  const endDate = "2026-02-01T00:00:00.000Z";
  const inPeriod = new Date("2026-01-15T12:00:00.000Z");
  const atStart = new Date(startDate);
  const atEnd = new Date(endDate);

  let adminId: string;
  let managerId: string;
  let multiStoreStaffId: string;
  let storeBStaffId: string;
  let storeCStaffId: string;
  let inactiveStaffId: string;
  let storeAId: string;
  let storeBId: string;
  let storeCId: string;
  let managerToken: string;
  let staffToken: string;
  let adminToken: string;
  let app: ReturnType<typeof createApp>;
  const quizIds: string[] = [];

  beforeAll(async () => {
    const [admin] = await db.insert(users).values({
      firstName: "Dashboard",
      lastName: "Admin",
      email: `dashboard-admin-${id}@example.com`,
      phone: null,
      role: "admin",
      isActive: true,
    }).returning({ id: users.id });
    adminId = admin.id;
    const adminPrincipal: TrustedPrincipal = { userId: adminId, role: "admin", storeIds: [], isActive: true };

    const storeA = await storesService.createStore(adminPrincipal, { name: `Dashboard Store A ${id}`, code: `DASH-A-${id}` });
    const storeB = await storesService.createStore(adminPrincipal, { name: `Dashboard Store B ${id}`, code: `DASH-B-${id}` });
    const storeC = await storesService.createStore(adminPrincipal, { name: `Dashboard Store C ${id}`, code: `DASH-C-${id}` });
    storeAId = storeA.id;
    storeBId = storeB.id;
    storeCId = storeC.id;

    const manager = await usersService.createUser(adminPrincipal, {
      firstName: "Dashboard",
      lastName: "Manager",
      phone: `+37369${id}`,
      email: `dashboard-manager-${id}@example.com`,
      role: "manager",
      isActive: true,
      storeIds: [storeAId],
    });
    const multiStoreStaff = await usersService.createUser(adminPrincipal, {
      firstName: "Multi",
      lastName: "Store Staff",
      phone: `+37368${id}`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeAId, storeBId],
    });
    const storeBStaff = await usersService.createUser(adminPrincipal, {
      firstName: "Store B",
      lastName: "Staff",
      phone: `+37367${id}`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeBId],
    });
    const storeCStaff = await usersService.createUser(adminPrincipal, {
      firstName: "Store C",
      lastName: "Staff",
      phone: `+37366${id}`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeCId],
    });
    const inactiveStaff = await usersService.createUser(adminPrincipal, {
      firstName: "Inactive",
      lastName: "Staff",
      phone: `+37365${id}`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeAId],
    });

    managerId = manager.id;
    multiStoreStaffId = multiStoreStaff.id;
    storeBStaffId = storeBStaff.id;
    storeCStaffId = storeCStaff.id;
    inactiveStaffId = inactiveStaff.id;
    await db.update(users).set({ isActive: false }).where(eq(users.id, inactiveStaffId));

    managerToken = (await auth.sessions.create(managerId, "mobile", { deviceId: `dashboard-manager-${id}` })).token;
    staffToken = (await auth.sessions.create(multiStoreStaffId, "mobile", { deviceId: `dashboard-staff-${id}` })).token;
    adminToken = (await auth.sessions.create(adminId, "mobile", { deviceId: `dashboard-admin-${id}` })).token;

    const globalQuiz = await quizzesService.createDraft(adminPrincipal, {
      title: `Dashboard Global ${id}`,
      passingScore: 50,
      assignmentMode: "all",
      storeIds: [],
      questions: quizQuestions(),
    });
    await quizzesService.publish(adminPrincipal, globalQuiz.id);
    quizIds.push(globalQuiz.id);

    const selectedQuiz = await quizzesService.createDraft(adminPrincipal, {
      title: `Dashboard Selected ${id}`,
      passingScore: 50,
      assignmentMode: "selected",
      storeIds: [storeAId, storeBId],
      questions: quizQuestions(),
    });
    await quizzesService.publish(adminPrincipal, selectedQuiz.id);
    quizIds.push(selectedQuiz.id);

    const archivedQuiz = await quizzesService.createDraft(adminPrincipal, {
      title: `Dashboard Archived ${id}`,
      passingScore: 50,
      assignmentMode: "selected",
      storeIds: [storeAId, storeBId],
      questions: quizQuestions(),
    });
    await quizzesService.publish(adminPrincipal, archivedQuiz.id);
    await quizzesService.archive(adminPrincipal, archivedQuiz.id);
    quizIds.push(archivedQuiz.id);

    const draftQuiz = await quizzesService.createDraft(adminPrincipal, {
      title: `Dashboard Draft ${id}`,
      passingScore: 50,
      assignmentMode: "selected",
      storeIds: [storeAId],
      questions: quizQuestions(),
    });
    quizIds.push(draftQuiz.id);

    const revisionIds = new Map<string, string>();
    for (const quizId of quizIds) {
      const [revision] = await db.select({ id: quizRevisions.id }).from(quizRevisions)
        .where(eq(quizRevisions.quizId, quizId)).orderBy(desc(quizRevisions.revisionNumber)).limit(1);
      revisionIds.set(quizId, revision.id);
    }

    const [globalQuizId, selectedQuizId, archivedQuizId] = quizIds;
    const attemptRows = [
      { quizId: globalQuizId, userId: multiStoreStaffId, scorePercent: 80, passed: true, submittedAt: inPeriod },
      { quizId: globalQuizId, userId: multiStoreStaffId, scorePercent: 40, passed: false, submittedAt: inPeriod },
      { quizId: selectedQuizId, userId: multiStoreStaffId, scorePercent: 100, passed: true, submittedAt: inPeriod },
      { quizId: archivedQuizId, userId: multiStoreStaffId, scorePercent: 60, passed: true, submittedAt: inPeriod },
      { quizId: selectedQuizId, userId: storeBStaffId, scorePercent: 50, passed: true, submittedAt: inPeriod },
      { quizId: globalQuizId, userId: multiStoreStaffId, scorePercent: 1, passed: false, submittedAt: atEnd },
      { quizId: globalQuizId, userId: inactiveStaffId, scorePercent: 99, passed: true, submittedAt: inPeriod },
    ];
    await db.insert(quizAttempts).values(attemptRows.map((attempt) => ({
      quizId: attempt.quizId,
      revisionId: revisionIds.get(attempt.quizId)!,
      userId: attempt.userId,
      status: "submitted" as const,
      startedAt: new Date(attempt.submittedAt.getTime() - 60 * 60 * 1000),
      submittedAt: attempt.submittedAt,
      scorePercent: attempt.scorePercent,
      passed: attempt.passed,
    })));
    await db.insert(quizAttempts).values({
      quizId: globalQuizId,
      revisionId: revisionIds.get(globalQuizId)!,
      userId: storeCStaffId,
      status: "in_progress",
      startedAt: inPeriod,
    });

    const photoRows = [
      { storeId: storeAId, uploadedBy: multiStoreStaffId, createdAt: atStart, key: "dashboard-a-start" },
      { storeId: storeAId, uploadedBy: multiStoreStaffId, createdAt: new Date("2026-01-10T12:00:00.000Z"), key: "dashboard-a-day" },
      { storeId: storeAId, uploadedBy: multiStoreStaffId, createdAt: atEnd, key: "dashboard-a-end" },
      { storeId: storeBId, uploadedBy: multiStoreStaffId, createdAt: inPeriod, key: "dashboard-b-multi" },
      { storeId: storeBId, uploadedBy: storeBStaffId, createdAt: inPeriod, key: "dashboard-b-staff" },
      { storeId: storeCId, uploadedBy: storeCStaffId, createdAt: inPeriod, key: "dashboard-c-staff" },
      { storeId: storeAId, uploadedBy: inactiveStaffId, createdAt: inPeriod, key: "dashboard-a-inactive" },
    ];
    await db.insert(photos).values(photoRows.map((photo) => ({
      storeId: photo.storeId,
      uploadedBy: photo.uploadedBy,
      storageKey: photo.key,
      originalFilename: `${photo.key}.png`,
      mimeType: "image/png",
      fileSize: 100,
      createdAt: photo.createdAt,
    })));

    app = createApp({
      db,
      allowedOrigins: ["http://localhost:3001"],
      resolvePrincipal: auth.principalResolver(),
      dashboardRoutes: {
        dashboard,
        resolvePrincipal: auth.principalResolver(),
      },
      logger: noopLogger,
    });
  });

  afterAll(async () => {
    const userIds = [managerId, multiStoreStaffId, storeBStaffId, storeCStaffId, inactiveStaffId].filter(Boolean);
    const storeIds = [storeAId, storeBId, storeCId].filter(Boolean);
    if (storeIds.length) await db.delete(photos).where(inArray(photos.storeId, storeIds));
    if (userIds.length) await db.delete(quizAttempts).where(inArray(quizAttempts.userId, userIds));
    if (quizIds.length) await db.delete(quizzes).where(inArray(quizzes.id, quizIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    if (adminId) await db.delete(users).where(eq(users.id, adminId));
    if (storeIds.length) await db.delete(stores).where(inArray(stores.id, storeIds));
    await client.end();
  });

  test("requires authenticated management principals and denies staff", async () => {
    const unauthenticated = await app.request("http://localhost/api/v1/dashboard/overview");
    expect(unauthenticated.status).toBe(401);

    const staff = await app.request("http://localhost/api/v1/dashboard/overview", {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(staff.status).toBe(403);
  });

  test("returns scoped overview metrics with UTC half-open date boundaries", async () => {
    const response = await app.request(`/api/v1/dashboard/overview?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(response.status).toBe(200);
    const body = await responseJson(response);
    expect(body.period).toMatchObject({ start: startDate, end: endDate, endExclusive: true, timezone: "UTC" });
    expect(body.metrics).toEqual({
      activeEmployeeCount: 2,
      publishedQuizCount: 2,
      completedAttemptCount: 4,
      completedEmployeeCount: 1,
      averageCompletedAttemptScore: 70,
      passRate: 75,
      uploadedPhotoCount: 2,
    });

    const unauthorizedStore = await app.request(`/api/v1/dashboard/overview?storeId=${storeBId}`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(unauthorizedStore.status).toBe(403);
  });

  test("returns network-wide and per-store photo analytics without inactive users", async () => {
    const response = await app.request(`/api/v1/dashboard/photos?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(response.status).toBe(200);
    const body = await responseJson(response);
    expect(body.totalPhotoCount).toBe(5);
    expect(body.distinctUploadingEmployeeCount).toBe(3);
    expect(body.perStoreUploads).toEqual([
      { storeId: storeAId, storeName: `Dashboard Store A ${id}`, count: 2 },
      { storeId: storeBId, storeName: `Dashboard Store B ${id}`, count: 2 },
      { storeId: storeCId, storeName: `Dashboard Store C ${id}`, count: 1 },
    ]);
    expect(body.dailyUploads.find((day: { date: string }) => day.date === "2026-01-01")).toEqual({ date: "2026-01-01", count: 1 });
    expect(body.dailyUploads.find((day: { date: string }) => day.date === "2026-01-15")).toEqual({ date: "2026-01-15", count: 3 });
    expect(body.dailyUploads.find((day: { date: string }) => day.date === "2026-02-01")).toBeUndefined();

    const managerPhotos = await app.request(`/api/v1/dashboard/photos?storeId=${storeAId}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(managerPhotos.status).toBe(200);
    expect((await responseJson(managerPhotos)).totalPhotoCount).toBe(2);
  });

  test("returns quiz summaries including archived historical revisions and paginates", async () => {
    const response = await app.request(`/api/v1/dashboard/quizzes?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&page=1&pageSize=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(response.status).toBe(200);
    const body = await responseJson(response);
    expect(body.summary).toEqual({
      completedAttemptCount: 5,
      participatingEmployeeCount: 2,
      averageScore: 66,
      passRate: 80,
    });
    expect(body.pagination).toEqual({ page: 1, pageSize: 1, total: 3, totalPages: 3 });
    expect(body.data).toHaveLength(1);
    expect(body.data[0].completedAttemptCount).toBeGreaterThan(0);

    const beyondLastPage = await app.request(`/api/v1/dashboard/quizzes?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&page=4&pageSize=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(beyondLastPage.status).toBe(200);
    expect((await responseJson(beyondLastPage)).pagination).toEqual({ page: 4, pageSize: 1, total: 3, totalPages: 3 });

    const managerResponse = await app.request(`/api/v1/dashboard/quizzes?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(managerResponse.status).toBe(200);
    const managerBody = await responseJson(managerResponse);
    expect(managerBody.summary).toEqual({
      completedAttemptCount: 4,
      participatingEmployeeCount: 1,
      averageScore: 70,
      passRate: 75,
    });
    expect(managerBody.pagination.total).toBe(3);
  });

  test("rejects invalid ranges and excludes inactive stores from network metrics", async () => {
    const invalid = await app.request(`/api/v1/dashboard/overview?startDate=${encodeURIComponent(endDate)}&endDate=${encodeURIComponent(startDate)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(invalid.status).toBe(400);
    expect((await responseJson(invalid)).error.code).toBe("VALIDATION_ERROR");

    const emptyStart = "2025-01-01T00:00:00.000Z";
    const emptyEnd = "2025-01-02T00:00:00.000Z";
    const empty = await app.request(`/api/v1/dashboard/overview?startDate=${encodeURIComponent(emptyStart)}&endDate=${encodeURIComponent(emptyEnd)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(empty.status).toBe(200);
    expect((await responseJson(empty)).metrics).toEqual({
      activeEmployeeCount: 4,
      publishedQuizCount: 2,
      completedAttemptCount: 0,
      completedEmployeeCount: 0,
      averageCompletedAttemptScore: null,
      passRate: null,
      uploadedPhotoCount: 0,
    });

    await db.update(stores).set({ isActive: false }).where(eq(stores.id, storeBId));
    const response = await app.request(`/api/v1/dashboard/overview?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(response.status).toBe(200);
    expect((await responseJson(response)).metrics.uploadedPhotoCount).toBe(3);

    const inactiveStore = await app.request(`/api/v1/dashboard/photos?storeId=${storeBId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(inactiveStore.status).toBe(403);
    await db.update(stores).set({ isActive: true }).where(eq(stores.id, storeBId));
  });
});

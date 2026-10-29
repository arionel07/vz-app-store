import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../src/app";
import { createAuthService } from "../src/auth/service";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import { quizAttempts, quizzes, stores, users } from "../src/db/schema";
import type { TrustedPrincipal } from "../src/domain/authz";
import { createQuizAttemptService } from "../src/domain/quizzes/attempt-service";
import { createQuizService } from "../src/domain/quizzes/service";
import { createStoresService } from "../src/domain/stores/service";
import { createUsersService } from "../src/domain/users/service";
import { noopLogger } from "../src/lib/logger";

const integrationEnabled = Bun.env.RUN_INTEGRATION_TESTS === "1";
const suite = integrationEnabled ? describe : describe.skip;

function numericSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9);
}

function draftBody(storeId: string, title: string, passingScore = 50) {
  return {
    title,
    description: "Integration quiz",
    passingScore,
    assignmentMode: "selected" as const,
    storeIds: [storeId],
    questions: [
      {
        prompt: "Question one",
        position: 0,
        options: [
          { label: "Correct one", position: 0, isCorrect: true },
          { label: "Wrong one", position: 1, isCorrect: false },
        ],
      },
      {
        prompt: "Question two",
        position: 1,
        options: [
          { label: "Wrong two", position: 0, isCorrect: false },
          { label: "Correct two", position: 1, isCorrect: true },
        ],
      },
    ],
  };
}

async function responseJson(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

suite("Quiz Engine PostgreSQL integration", () => {
  const { db, client } = createDatabase(loadEnv());
  const usersService = createUsersService(db);
  const storesService = createStoresService(db);
  const quizzesService = createQuizService(db);
  const attemptsService = createQuizAttemptService(db, quizzesService);
  const auth = createAuthService(db);
  const suffix = numericSuffix();

  let adminId: string;
  let managerId: string;
  let staffAId: string;
  let staffBId: string;
  let storeAId: string;
  let storeBId: string;
  let quizId: string;
  let advancedQuizId: string;
  let firstAttemptId: string;
  let managerToken: string;
  let staffAToken: string;
  let staffBToken: string;
  let app: ReturnType<typeof createApp>;

  let adminPrincipal: TrustedPrincipal;
  let managerPrincipal: TrustedPrincipal;
  let staffAPrincipal: TrustedPrincipal;

  beforeAll(async () => {
    const [admin] = await db
      .insert(users)
      .values({
        firstName: "Quiz",
        lastName: "Admin",
        email: `quiz-admin-${suffix}@example.com`,
        phone: null,
        role: "admin",
        isActive: true,
      })
      .returning({ id: users.id });
    adminId = admin.id;
    adminPrincipal = { userId: adminId, role: "admin", storeIds: [], isActive: true };

    const storeA = await storesService.createStore(adminPrincipal, { name: `Quiz Store A ${suffix}`, code: `QUIZ-A-${suffix}` });
    const storeB = await storesService.createStore(adminPrincipal, { name: `Quiz Store B ${suffix}`, code: `QUIZ-B-${suffix}` });
    storeAId = storeA.id;
    storeBId = storeB.id;

    const manager = await usersService.createUser(adminPrincipal, {
      firstName: "Quiz",
      lastName: "Manager",
      phone: `+37369${suffix}`,
      email: `quiz-manager-${suffix}@example.com`,
      role: "manager",
      isActive: true,
      storeIds: [storeAId],
    });
    managerId = manager.id;
    const staffA = await usersService.createUser(adminPrincipal, {
      firstName: "Quiz",
      lastName: "Staff A",
      phone: `+37368${suffix}`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeAId],
    });
    const staffB = await usersService.createUser(adminPrincipal, {
      firstName: "Quiz",
      lastName: "Staff B",
      phone: `+37367${suffix}`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeBId],
    });
    staffAId = staffA.id;
    staffBId = staffB.id;

    managerPrincipal = { userId: managerId, role: "manager", storeIds: [storeAId], isActive: true };
    staffAPrincipal = { userId: staffAId, role: "staff", storeIds: [storeAId], isActive: true };

    const managerSession = await auth.sessions.create(managerId, "mobile", { deviceId: `quiz-manager-${suffix}` });
    const staffASession = await auth.sessions.create(staffAId, "mobile", { deviceId: `quiz-staff-a-${suffix}` });
    const staffBSession = await auth.sessions.create(staffBId, "mobile", { deviceId: `quiz-staff-b-${suffix}` });
    managerToken = managerSession.token;
    staffAToken = staffASession.token;
    staffBToken = staffBSession.token;

    app = createApp({
      db,
      allowedOrigins: ["http://localhost:3001"],
      resolvePrincipal: auth.principalResolver(),
      quizRoutes: {
        quizzes: quizzesService,
        attempts: attemptsService,
        resolvePrincipal: auth.principalResolver(),
      },
      logger: noopLogger,
    });
  });

  afterAll(async () => {
    if (firstAttemptId) {
      await db.delete(quizAttempts).where(eq(quizAttempts.id, firstAttemptId));
    }
    if (staffAId && staffBId) {
      await db.delete(quizAttempts).where(inArray(quizAttempts.userId, [staffAId, staffBId]));
    }
    if (quizId) await db.delete(quizzes).where(eq(quizzes.id, quizId));
    if (advancedQuizId) await db.delete(quizzes).where(eq(quizzes.id, advancedQuizId));
    if (managerId && staffAId && staffBId) await db.delete(users).where(inArray(users.id, [managerId, staffAId, staffBId]));
    if (adminId) await db.delete(users).where(eq(users.id, adminId));
    if (storeAId && storeBId) await db.delete(stores).where(inArray(stores.id, [storeAId, storeBId]));
    await client.end();
  });

  test("requires trusted HTTP authentication and enforces manager assignment scope", async () => {
    const unauthenticatedApp = createApp({
      db,
      allowedOrigins: [],
      quizRoutes: {
        quizzes: quizzesService,
        attempts: attemptsService,
        resolvePrincipal: async () => null,
      },
      logger: noopLogger,
    });
    const unauthenticated = await unauthenticatedApp.request("http://localhost/api/v1/quizzes");
    expect(unauthenticated.status).toBe(401);

    const globalResponse = await app.request("http://localhost/api/v1/management/quizzes", {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Global quiz", passingScore: 50, assignmentMode: "all", questions: [] }),
    });
    expect(globalResponse.status).toBe(403);
    expect((await responseJson(globalResponse)).error.code).toBe("FORBIDDEN");

    const outsideScopeResponse = await app.request("http://localhost/api/v1/management/quizzes", {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Outside scope quiz", passingScore: 50, assignmentMode: "selected", storeIds: [storeBId] }),
    });
    expect(outsideScopeResponse.status).toBe(403);
  });

  test("creates, validates, publishes, scopes, and exposes safe quiz DTOs", async () => {
    const createResponse = await app.request("http://localhost/api/v1/management/quizzes", {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Scoped quiz", passingScore: 50, assignmentMode: "selected", storeIds: [storeAId] }),
    });
    expect(createResponse.status).toBe(201);
    const created = await responseJson(createResponse);
    quizId = created.id;
    expect(created.questions).toHaveLength(0);

    const emptyPublish = await app.request(`http://localhost/api/v1/management/quizzes/${quizId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(emptyPublish.status).toBe(400);
    expect((await responseJson(emptyPublish)).error.code).toBe("INVALID_QUIZ");

    const body = draftBody(storeAId, "Scoped quiz", 50);
    const invalidBody = {
      ...body,
      questions: body.questions.map((question, questionIndex) => ({
        ...question,
        options: questionIndex === 0 ? question.options.map((option) => ({ ...option, isCorrect: false })) : question.options,
      })),
    };
    const invalidDraftResponse = await app.request(`http://localhost/api/v1/management/quizzes/${quizId}/draft`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(invalidBody),
    });
    expect(invalidDraftResponse.status).toBe(200);
    const invalidPublish = await app.request(`http://localhost/api/v1/management/quizzes/${quizId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(invalidPublish.status).toBe(400);
    expect((await responseJson(invalidPublish)).error.code).toBe("INVALID_CORRECT_OPTION");

    const updateResponse = await app.request(`http://localhost/api/v1/management/quizzes/${quizId}/draft`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(updateResponse.status).toBe(200);
    const draft = await responseJson(updateResponse);
    expect(draft.revisionStatus).toBe("draft");
    expect(draft.questions).toHaveLength(2);

    const publishResponse = await app.request(`http://localhost/api/v1/management/quizzes/${quizId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(publishResponse.status).toBe(200);
    const published = await responseJson(publishResponse);
    expect(published.status).toBe("published");
    expect(published.revisionNumber).toBe(1);

    const staffResponse = await app.request(`http://localhost/api/v1/quizzes/${quizId}`, {
      headers: { Authorization: `Bearer ${staffAToken}` },
    });
    expect(staffResponse.status).toBe(200);
    const staffQuiz = await responseJson(staffResponse);
    expect(JSON.stringify(staffQuiz)).not.toContain("isCorrect");
    expect(staffQuiz.questions[0].options[0]).not.toHaveProperty("isCorrect");

    const otherStoreResponse = await app.request(`http://localhost/api/v1/quizzes/${quizId}`, {
      headers: { Authorization: `Bearer ${staffBToken}` },
    });
    expect(otherStoreResponse.status).toBe(404);
  });

  test("scores incomplete answers, supports retakes, and makes submission idempotent", async () => {
    const startResponse = await app.request(`http://localhost/api/v1/quizzes/${quizId}/attempts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}` },
    });
    expect(startResponse.status).toBe(201);
    const started = await responseJson(startResponse);
    firstAttemptId = started.id;

    const duplicateStartResponse = await app.request(`http://localhost/api/v1/quizzes/${quizId}/attempts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}` },
    });
    expect(duplicateStartResponse.status).toBe(201);
    expect((await responseJson(duplicateStartResponse)).id).toBe(firstAttemptId);

    const q1 = started.quiz.questions[0];
    const q2 = started.quiz.questions[1];
    const submitResponse = await app.request(`http://localhost/api/v1/attempts/${firstAttemptId}/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ answers: [{ questionId: q1.id, optionId: q1.options[0].id }, { questionId: q2.id, optionId: null }] }),
    });
    expect(submitResponse.status).toBe(200);
    const result = await responseJson(submitResponse);
    expect(result.scorePercent).toBe(50);
    expect(result.passed).toBe(true);

    const retryResponse = await app.request(`http://localhost/api/v1/attempts/${firstAttemptId}/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ answers: [{ questionId: crypto.randomUUID(), optionId: crypto.randomUUID() }] }),
    });
    expect(retryResponse.status).toBe(200);
    expect((await responseJson(retryResponse)).scorePercent).toBe(50);

    const retakeResponse = await app.request(`http://localhost/api/v1/quizzes/${quizId}/attempts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}` },
    });
    expect(retakeResponse.status).toBe(201);
    const retake = await responseJson(retakeResponse);
    expect(retake.id).not.toBe(firstAttemptId);
    const invalidOptionResponse = await app.request(`http://localhost/api/v1/attempts/${retake.id}/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ answers: [{ questionId: retake.quiz.questions[0].id, optionId: retake.quiz.questions[1].options[0].id }] }),
    });
    expect(invalidOptionResponse.status).toBe(400);
    expect((await responseJson(invalidOptionResponse)).error.code).toBe("INVALID_ANSWERS");

    const incompleteRetake = await app.request(`http://localhost/api/v1/attempts/${retake.id}/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ answers: [] }),
    });
    expect(incompleteRetake.status).toBe(200);
    expect((await responseJson(incompleteRetake)).scorePercent).toBe(0);

    const otherUserAttempt = await app.request(`http://localhost/api/v1/attempts/${firstAttemptId}`, {
      headers: { Authorization: `Bearer ${staffBToken}` },
    });
    expect(otherUserAttempt.status).toBe(403);
  });

  test("limits result visibility and preserves immutable revisions", async () => {
    const managerResults = await app.request(`http://localhost/api/v1/management/quizzes/${quizId}/results`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(managerResults.status).toBe(200);
    const resultList = await responseJson(managerResults);
    expect(resultList.data).toHaveLength(2);
    expect(resultList.data.every((result: Record<string, unknown>) => !("answers" in result))).toBe(true);

    const staffResults = await app.request(`http://localhost/api/v1/management/quizzes/${quizId}/results`, {
      headers: { Authorization: `Bearer ${staffAToken}` },
    });
    expect(staffResults.status).toBe(403);

    const revisionOneAttempt = await app.request(`http://localhost/api/v1/attempts/${firstAttemptId}`, {
      headers: { Authorization: `Bearer ${staffAToken}` },
    });
    const historical = await responseJson(revisionOneAttempt);
    expect(historical.revisionNumber).toBe(1);
    expect(historical.scorePercent).toBe(50);

    const versionTwoBody = draftBody(storeAId, "Scoped quiz revision two", 100);
    const draftResponse = await app.request(`http://localhost/api/v1/management/quizzes/${quizId}/draft`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(versionTwoBody),
    });
    expect(draftResponse.status).toBe(200);
    expect((await responseJson(draftResponse)).revisionNumber).toBe(2);

    const publishTwo = await app.request(`http://localhost/api/v1/management/quizzes/${quizId}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(publishTwo.status).toBe(200);
    const versionTwo = await responseJson(publishTwo);
    expect(versionTwo.revisionNumber).toBe(2);

    const newQuizResponse = await app.request(`http://localhost/api/v1/quizzes/${quizId}`, {
      headers: { Authorization: `Bearer ${staffAToken}` },
    });
    expect((await responseJson(newQuizResponse)).revisionNumber).toBe(2);

    const inProgressResponse = await app.request(`http://localhost/api/v1/quizzes/${quizId}/attempts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}` },
    });
    const inProgress = await responseJson(inProgressResponse);
    const archiveResponse = await app.request(`http://localhost/api/v1/management/quizzes/${quizId}/archive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(archiveResponse.status).toBe(200);

    const unavailable = await app.request(`http://localhost/api/v1/quizzes/${quizId}`, {
      headers: { Authorization: `Bearer ${staffAToken}` },
    });
    expect(unavailable.status).toBe(404);

    const archivedSubmission = await app.request(`http://localhost/api/v1/attempts/${inProgress.id}/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: inProgress.quiz.questions.map((question: { id: string; options: Array<{ id: string }> }) => ({
          questionId: question.id,
          optionId: question.options[0].id,
        })),
      }),
    });
    expect(archivedSubmission.status).toBe(200);
  });

  test("serializes concurrent submissions to one result", async () => {
    const rejected = await quizzesService.createDraft(managerPrincipal, {
      title: "Concurrent quiz",
      passingScore: 0,
      assignmentMode: "selected",
      storeIds: [storeAId],
      questions: draftBody(storeAId, "Concurrent quiz", 0).questions,
    });
    await quizzesService.publish(managerPrincipal, rejected.id);
    const first = await attemptsService.start(staffAPrincipal, rejected.id);
    const answers = first.quiz!.questions.map((question) => ({ questionId: question.id, optionId: question.options[0]!.id }));
    const results = await Promise.all([
      attemptsService.submit(staffAPrincipal, first.id, { answers }),
      attemptsService.submit(staffAPrincipal, first.id, { answers }),
    ]);
    expect(results[0].id).toBe(first.id);
    expect(results[1].id).toBe(first.id);
    await db.delete(quizAttempts).where(eq(quizAttempts.id, first.id));
    await db.delete(quizzes).where(eq(quizzes.id, rejected.id));
  });

  test("supports typed questions, manual review, persisted settings, and attempt limits", async () => {
    const createResponse = await app.request("/api/v1/management/quizzes", {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Advanced quiz",
        passingScore: 50,
        assignmentMode: "selected",
        storeIds: [storeAId],
        assessmentMode: "exam",
        maxAttempts: 1,
        timeLimitSeconds: 300,
        randomizeQuestions: true,
        randomizeOptions: true,
        showResults: true,
        questions: [
          { prompt: "Выберите варианты", position: 0, type: "multiple_choice", maxPoints: 4, scoringPolicy: "partial_credit", options: [{ label: "Да", position: 0, isCorrect: true }, { label: "Нет", position: 1, isCorrect: true }, { label: "Не знаю", position: 2, isCorrect: false }] },
          { prompt: "Объясните решение", position: 1, type: "free_text", maxPoints: 2, options: [] },
        ],
      }),
    });
    expect(createResponse.status).toBe(201);
    advancedQuizId = (await responseJson(createResponse)).id;
    const publishResponse = await app.request(`/api/v1/management/quizzes/${advancedQuizId}/publish`, { method: "POST", headers: { Authorization: `Bearer ${managerToken}` } });
    expect(publishResponse.status).toBe(200);

    const staffQuizResponse = await app.request(`/api/v1/quizzes/${advancedQuizId}`, { headers: { Authorization: `Bearer ${staffAToken}` } });
    const staffQuiz = await responseJson(staffQuizResponse);
    expect(staffQuiz.assessmentMode).toBe("exam");
    expect(JSON.stringify(staffQuiz)).not.toContain("isCorrect");
    expect(JSON.stringify(staffQuiz)).not.toContain("points");

    const startResponse = await app.request(`/api/v1/quizzes/${advancedQuizId}/attempts`, { method: "POST", headers: { Authorization: `Bearer ${staffAToken}` } });
    expect(startResponse.status).toBe(201);
    const started = await responseJson(startResponse);
    const multiple = started.quiz.questions.find((question: { type: string }) => question.type === "multiple_choice");
    const freeText = started.quiz.questions.find((question: { type: string }) => question.type === "free_text");
    const submitResponse = await app.request(`/api/v1/attempts/${started.id}/submit`, { method: "POST", headers: { Authorization: `Bearer ${staffAToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ answers: [{ questionId: multiple.id, optionIds: [multiple.options[0].id] }, { questionId: freeText.id, textAnswer: "Потому что это безопасно" }] }) });
    expect(submitResponse.status).toBe(200);
    expect((await responseJson(submitResponse)).reviewStatus).toBe("pending");

    const reviewQueue = await app.request(`/api/v1/management/quiz-reviews?quizId=${advancedQuizId}`, { headers: { Authorization: `Bearer ${managerToken}` } });
    expect(reviewQueue.status).toBe(200);
    const pending = await responseJson(reviewQueue);
    expect(pending.data).toHaveLength(1);
    const review = await app.request(`/api/v1/management/quiz-attempts/${started.id}/questions/${freeText.id}/review`, { method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ awardedPoints: 2, feedback: "Хорошо" }) });
    expect(review.status).toBe(200);
    const completed = await app.request(`/api/v1/attempts/${started.id}`, { headers: { Authorization: `Bearer ${staffAToken}` } });
    expect((await responseJson(completed)).reviewStatus).toBe("completed");
    const limited = await app.request(`/api/v1/quizzes/${advancedQuizId}/attempts`, { method: "POST", headers: { Authorization: `Bearer ${staffAToken}` } });
    expect(limited.status).toBe(409);
    expect((await responseJson(limited)).error.code).toBe("ATTEMPT_LIMIT_REACHED");
  });
});

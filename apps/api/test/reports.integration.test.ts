import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";
import { createApp } from "../src/app";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import {
  merchandisingDisplays, merchandisingInspections, operationalRequestHistory, operationalRequests,
  knowledgeAcknowledgments, knowledgeArticles, knowledgeArticleRevisions, knowledgeCategories, knowledgeVisibilityTargets,
  photoReportVersions, photoReports, photoReviewHistory, photos, quizAnswerReviews, quizAttemptAnswers,
  quizAttempts, quizQuestions, quizRevisions, quizzes, retailCampaignExecutions, retailCampaignStores, retailCampaignSubmissions, retailCampaigns, scheduleDaysOff,
  schedulePeriods, scheduleShifts, storeIssueHistory, storeIssues, stores, taskOccurrences,
  userStores, users,
} from "../src/db/schema";
import type { TrustedPrincipal } from "../src/domain/authz";
import { createReportsService } from "../src/domain/reports/service";

const suite = Bun.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;
const start = new Date("2026-10-01T00:00:00.000Z");
const middle = new Date("2026-10-15T10:00:00.000Z");
const end = new Date("2026-10-30T23:59:00.000Z");

suite("Reporting API PostgreSQL reconciliation", () => {
  const { db, client } = createDatabase(loadEnv());
  const reports = createReportsService(db);
  const suffix = crypto.randomUUID().slice(0, 8);
  let storeA = ""; let storeB = "";
  let adminId = ""; let managerId = ""; let multiStaffId = ""; let secondStaffId = "";
  let inactiveStaffId = "";
  let quizId = ""; let revisionId = ""; let surveyQuizId = ""; let campaignId = ""; let displayId = "";
  let knowledgeCategoryId = ""; let knowledgeArticleIds: string[] = []; let knowledgeRevisionIds: string[] = [];
  let taskIds: string[] = []; let photoIds: string[] = []; let issueId = ""; let requestId = ""; let periodId = "";
  const performanceStoreIds: string[] = []; const performanceStaffIds: string[] = []; const performanceTaskIds: string[] = [];
  const admin: TrustedPrincipal = { userId: "", role: "admin", storeIds: [], isActive: true };
  const manager: TrustedPrincipal = { userId: "", role: "manager", storeIds: [], isActive: true };
  const staff: TrustedPrincipal = { userId: "", role: "staff", storeIds: [], isActive: true };
  let app: ReturnType<typeof createApp>;
  const baseQuery = "period=custom&startDate=2026-10-01&endDate=2026-10-30&timezone=Europe%2FChisinau";

  beforeAll(async () => {
    const storeRows = await db.insert(stores).values([
      { name: `Reporting A ${suffix}`, code: `RPA-${suffix}` },
      { name: `Reporting B ${suffix}`, code: `RPB-${suffix}` },
    ]).returning({ id: stores.id });
    storeA = storeRows[0]!.id; storeB = storeRows[1]!.id;
    const userRows = await db.insert(users).values([
      { firstName: "Report", lastName: `Admin ${suffix}`, email: `report-admin-${suffix}@example.test`, role: "admin" },
      { firstName: "Report", lastName: `Manager ${suffix}`, email: `report-manager-${suffix}@example.test`, role: "manager" },
      { firstName: "Multi", lastName: `Staff ${suffix}`, email: `report-staff-a-${suffix}@example.test`, role: "staff" },
      { firstName: "StoreB", lastName: `Staff ${suffix}`, email: `report-staff-b-${suffix}@example.test`, role: "staff" },
      { firstName: "Inactive", lastName: `Staff ${suffix}`, email: `report-staff-inactive-${suffix}@example.test`, role: "staff", isActive: false },
    ]).returning({ id: users.id });
    [adminId, managerId, multiStaffId, secondStaffId, inactiveStaffId] = userRows.map((row) => row.id);
    Object.assign(admin, { userId: adminId }); Object.assign(manager, { userId: managerId }); Object.assign(staff, { userId: multiStaffId, storeIds: [storeA, storeB] });
    await db.insert(userStores).values([
      { userId: managerId, storeId: storeA }, { userId: multiStaffId, storeId: storeA },
      { userId: multiStaffId, storeId: storeB }, { userId: secondStaffId, storeId: storeB }, { userId: inactiveStaffId, storeId: storeA },
    ]);

    const taskRows = await db.insert(taskOccurrences).values([
      { assignmentGroupId: crypto.randomUUID(), storeId: storeA, assignedEmployeeId: multiStaffId, title: "Checked task", category: "report-test", status: "checked", createdBy: managerId, createdAt: middle, updatedAt: middle, dueAt: start },
      { assignmentGroupId: crypto.randomUUID(), storeId: storeA, assignedEmployeeId: multiStaffId, title: "Rejected task", category: "report-test", status: "rejected", createdBy: managerId, createdAt: middle, updatedAt: middle, dueAt: start },
      { assignmentGroupId: crypto.randomUUID(), storeId: storeA, assignedEmployeeId: multiStaffId, title: "At period start", category: "report-test", status: "assigned", createdBy: managerId, createdAt: new Date("2026-09-30T21:00:00.000Z"), updatedAt: middle },
      { assignmentGroupId: crypto.randomUUID(), storeId: storeA, assignedEmployeeId: multiStaffId, title: "Just before period end", category: "report-test", status: "checked", createdBy: managerId, createdAt: new Date("2026-10-30T21:59:59.999Z"), updatedAt: middle },
      { assignmentGroupId: crypto.randomUUID(), storeId: storeA, assignedEmployeeId: multiStaffId, title: "Before period start", category: "report-test", status: "checked", createdBy: managerId, createdAt: new Date("2026-09-30T20:59:59.999Z"), updatedAt: middle },
      { assignmentGroupId: crypto.randomUUID(), storeId: storeA, assignedEmployeeId: multiStaffId, title: "Exactly period end", category: "report-test", status: "checked", createdBy: managerId, createdAt: new Date("2026-10-30T22:00:00.000Z"), updatedAt: middle },
      { assignmentGroupId: crypto.randomUUID(), storeId: storeB, assignedEmployeeId: secondStaffId, title: "Other store task", category: "report-test", status: "assigned", createdBy: managerId, createdAt: middle, updatedAt: middle },
    ]).returning({ id: taskOccurrences.id });
    taskIds = taskRows.map((row) => row.id);

    const media = await db.insert(photos).values([
      { storeId: storeA, uploadedBy: multiStaffId, storageKey: `report-test/${suffix}-1.jpg`, originalFilename: "one.jpg", mimeType: "image/jpeg", fileSize: 10, createdAt: middle },
      { storeId: storeA, uploadedBy: multiStaffId, storageKey: `report-test/${suffix}-2.jpg`, originalFilename: "two.jpg", mimeType: "image/jpeg", fileSize: 10, createdAt: middle },
      { storeId: storeB, uploadedBy: secondStaffId, storageKey: `report-test/${suffix}-3.jpg`, originalFilename: "three.jpg", mimeType: "image/jpeg", fileSize: 10, createdAt: middle },
    ]).returning({ id: photos.id });
    photoIds = media.map((row) => row.id);
    const [report] = await db.insert(photoReports).values({ storeId: storeA, submittedBy: multiStaffId, createdAt: middle, updatedAt: middle }).returning({ id: photoReports.id });
    const [v1, v2] = await db.insert(photoReportVersions).values([
      { reportId: report!.id, photoId: photoIds[0]!, versionNumber: 1, status: "checked", submittedAt: middle, reviewedAt: new Date(middle.getTime() + 60 * 60 * 1000), reviewedBy: managerId },
      { reportId: report!.id, photoId: photoIds[1]!, versionNumber: 2, status: "rejected", submittedAt: new Date(middle.getTime() + 2 * 60 * 60 * 1000), reviewedAt: new Date(middle.getTime() + 3 * 60 * 60 * 1000), reviewedBy: managerId },
    ]).returning({ id: photoReportVersions.id });
    await db.insert(photoReviewHistory).values([
      { reportId: report!.id, versionId: v1!.id, actorId: managerId, fromStatus: "pending", toStatus: "checked", createdAt: new Date(middle.getTime() + 60 * 60 * 1000) },
      { reportId: report!.id, versionId: v2!.id, actorId: managerId, fromStatus: "pending", toStatus: "rejected", createdAt: new Date(middle.getTime() + 3 * 60 * 60 * 1000) },
    ]);

    const [quiz] = await db.insert(quizzes).values({ status: "published" }).returning({ id: quizzes.id }); quizId = quiz!.id;
    const [oldRevision, revision] = await db.insert(quizRevisions).values([
      { quizId, revisionNumber: 1, status: "archived", title: "Old report exam", passingScore: 60, assignmentMode: "all", assessmentMode: "exam", publishedAt: start },
      { quizId, revisionNumber: 2, status: "published", title: "Report exam", passingScore: 60, assignmentMode: "all", assessmentMode: "exam", publishedAt: middle },
    ]).returning({ id: quizRevisions.id }); revisionId = revision!.id;
    const [surveyQuiz] = await db.insert(quizzes).values({ status: "published" }).returning({ id: quizzes.id }); surveyQuizId = surveyQuiz!.id;
    const [surveyRevision] = await db.insert(quizRevisions).values({ quizId: surveyQuizId, revisionNumber: 1, status: "published", title: "Report survey", passingScore: 0, assignmentMode: "all", assessmentMode: "survey", publishedAt: middle }).returning({ id: quizRevisions.id });
    await db.insert(quizAttempts).values([
      { quizId, revisionId: oldRevision!.id, userId: multiStaffId, status: "submitted", startedAt: middle, submittedAt: middle, scorePercent: 80, passed: true },
      { quizId, revisionId, userId: multiStaffId, status: "submitted", startedAt: middle, submittedAt: middle, scorePercent: 50, passed: false },
      { quizId: surveyQuizId, revisionId: surveyRevision!.id, userId: multiStaffId, status: "submitted", startedAt: middle, submittedAt: middle, scorePercent: null, passed: null },
      { quizId, revisionId, userId: inactiveStaffId, status: "submitted", startedAt: middle, submittedAt: middle, scorePercent: 100, passed: true },
    ]);
    const [reviewQuestion] = await db.insert(quizQuestions).values({ revisionId, prompt: "Manual review fixture", position: 1, questionType: "free_text", maxPoints: 1 }).returning({ id: quizQuestions.id });
    const reviewAttempts = await db.insert(quizAttempts).values([
      { quizId, revisionId, userId: multiStaffId, status: "submitted", reviewStatus: "pending", startedAt: middle, submittedAt: middle },
      { quizId, revisionId, userId: secondStaffId, status: "submitted", reviewStatus: "pending", startedAt: middle, submittedAt: middle },
      { quizId, revisionId, userId: inactiveStaffId, status: "submitted", reviewStatus: "pending", startedAt: middle, submittedAt: middle },
    ]).returning({ id: quizAttempts.id });
    await db.insert(quizAttemptAnswers).values(reviewAttempts.map(({ id }) => ({ attemptId: id, questionId: reviewQuestion!.id, textAnswer: "Needs review", reviewStatus: "pending" as const, maxPoints: 1 })));
    await db.insert(quizAnswerReviews).values(reviewAttempts.map(({ id }) => ({ attemptId: id, questionId: reviewQuestion!.id, status: "pending" as const, maxPoints: 1 })));

    const [category] = await db.insert(knowledgeCategories).values({ name: `Reporting knowledge ${suffix}`, slug: `reporting-${suffix}` }).returning({ id: knowledgeCategories.id }); knowledgeCategoryId = category!.id;
    const articles = await db.insert(knowledgeArticles).values([
      { categoryId: knowledgeCategoryId, status: "published", createdBy: adminId, requiresAcknowledgement: true },
      { categoryId: knowledgeCategoryId, status: "published", createdBy: adminId, requiresAcknowledgement: true },
    ]).returning({ id: knowledgeArticles.id });
    knowledgeArticleIds = articles.map((row) => row.id);
    const revisions = await db.insert(knowledgeArticleRevisions).values([
      { articleId: knowledgeArticleIds[0]!, revisionNumber: 1, status: "published", title: "Current required article", body: "Test", createdBy: adminId, publishedBy: adminId, publishedAt: middle },
      { articleId: knowledgeArticleIds[1]!, revisionNumber: 1, status: "archived", title: "Old required article", body: "Old", createdBy: adminId, publishedBy: adminId, publishedAt: start },
      { articleId: knowledgeArticleIds[1]!, revisionNumber: 2, status: "published", title: "Revised required article", body: "New", createdBy: adminId, publishedBy: adminId, publishedAt: middle },
    ]).returning({ id: knowledgeArticleRevisions.id });
    knowledgeRevisionIds = revisions.map((row) => row.id);
    await db.update(knowledgeArticles).set({ publishedRevisionId: knowledgeRevisionIds[0], publishedAt: middle }).where(eq(knowledgeArticles.id, knowledgeArticleIds[0]!));
    await db.update(knowledgeArticles).set({ publishedRevisionId: knowledgeRevisionIds[2], publishedAt: middle }).where(eq(knowledgeArticles.id, knowledgeArticleIds[1]!));
    await db.insert(knowledgeVisibilityTargets).values(knowledgeArticleIds.map((articleId) => ({ articleId, kind: "all" as const })));
    await db.insert(knowledgeAcknowledgments).values([
      { employeeId: multiStaffId, articleId: knowledgeArticleIds[0]!, revisionId: knowledgeRevisionIds[0]!, acknowledgedAt: middle },
      { employeeId: multiStaffId, articleId: knowledgeArticleIds[1]!, revisionId: knowledgeRevisionIds[1]!, acknowledgedAt: middle },
    ]);

    await db.insert(schedulePeriods).values({ storeId: storeA, startDate: "2026-10-01", endDate: "2026-10-31", timezone: "Europe/Chisinau", status: "published", createdBy: managerId, publishedBy: managerId, publishedAt: middle }).returning({ id: schedulePeriods.id }).then(async ([period]) => {
      periodId = period!.id;
      await db.insert(scheduleShifts).values([
        { periodId, employeeId: multiStaffId, storeId: storeA, localDate: "2026-10-15", startTime: "22:00", endTime: "06:00", startAt: new Date("2026-10-15T19:00:00Z"), endAt: new Date("2026-10-16T03:00:00Z"), timezone: "Europe/Chisinau", createdBy: managerId, updatedBy: managerId },
        { periodId, employeeId: multiStaffId, storeId: storeA, localDate: "2026-10-15", startTime: "11:00", endTime: "15:00", startAt: new Date("2026-10-15T08:00:00Z"), endAt: new Date("2026-10-15T12:00:00Z"), timezone: "Europe/Chisinau", createdBy: managerId, updatedBy: managerId },
      ]);
      await db.insert(scheduleDaysOff).values([
        { periodId, employeeId: multiStaffId, storeId: storeA, localDate: "2026-10-16", createdBy: managerId, updatedBy: managerId },
        { periodId, employeeId: multiStaffId, storeId: storeA, localDate: "2026-10-17", createdBy: managerId, updatedBy: managerId },
      ]);
    });

    const [campaign] = await db.insert(retailCampaigns).values({ title: "Report campaign", description: "", status: "completed", startsAt: start, endsAt: end, timezone: "Europe/Chisinau", createdBy: managerId }).returning({ id: retailCampaigns.id }); campaignId = campaign!.id;
    await db.insert(retailCampaignStores).values([{ campaignId, storeId: storeA }, { campaignId, storeId: storeB }]);
    const campaignExecutions = await db.insert(retailCampaignExecutions).values([
      { campaignId, storeId: storeA, status: "checked", updatedAt: middle }, { campaignId, storeId: storeB, status: "not_started", updatedAt: middle },
    ]).returning({ id: retailCampaignExecutions.id });
    await db.insert(retailCampaignSubmissions).values({ executionId: campaignExecutions[0]!.id, version: 1, submittedBy: multiStaffId, actionResults: [true], idempotencyKey: `report-${suffix}`, submittedAt: middle });

    const [display] = await db.insert(merchandisingDisplays).values({ storeId: storeA, name: "Report display", brand: "A", referencePhotoId: photoIds[0]!, createdBy: managerId }).returning({ id: merchandisingDisplays.id }); displayId = display!.id;
    await db.insert(merchandisingInspections).values({ displayId, displayNameSnapshot: "Report display", brandSnapshot: "A", checklistSnapshot: [], referencePhotoId: photoIds[0]!, status: "submitted", submittedBy: multiStaffId, submittedAt: middle });
    const [issue] = await db.insert(storeIssues).values({ storeId: storeA, category: "test", title: "Report issue", description: "Issue", priority: "urgent", reporterId: multiStaffId, status: "open", createdAt: middle, updatedAt: middle }).returning({ id: storeIssues.id }); issueId = issue!.id;
    await db.insert(storeIssueHistory).values({ issueId, actorId: managerId, action: "created", toStatus: "open", createdAt: middle });
    const [request] = await db.insert(operationalRequests).values({ storeId: storeA, category: "test", description: "Report request", requesterId: multiStaffId, status: "completed", createdAt: middle, updatedAt: end }).returning({ id: operationalRequests.id }); requestId = request!.id;
    await db.insert(operationalRequestHistory).values([
      { requestId, actorId: managerId, fromStatus: "submitted", toStatus: "approved", createdAt: new Date(middle.getTime() + 60 * 60 * 1000) },
      { requestId, actorId: managerId, fromStatus: "in_progress", toStatus: "completed", createdAt: new Date(middle.getTime() + 4 * 60 * 60 * 1000) },
    ]);

    const resolver = (context: { req: { header(name: string): string | undefined } }) => {
      const role = context.req.header("x-report-principal");
      return role === "admin" ? admin : role === "manager" ? manager : role === "staff" ? staff : null;
    };
    app = createApp({ db, allowedOrigins: [], resolvePrincipal: resolver, reportsRoutes: { reports, resolvePrincipal: resolver } });
  });

  afterAll(async () => {
    if (requestId) await db.delete(operationalRequestHistory).where(eq(operationalRequestHistory.requestId, requestId));
    if (requestId) await db.delete(operationalRequests).where(eq(operationalRequests.id, requestId));
    if (issueId) await db.delete(storeIssueHistory).where(eq(storeIssueHistory.issueId, issueId));
    if (issueId) await db.delete(storeIssues).where(eq(storeIssues.id, issueId));
    if (displayId) {
      const inspectionIds = await db.select({ id: merchandisingInspections.id }).from(merchandisingInspections).where(eq(merchandisingInspections.displayId, displayId));
      if (inspectionIds.length) await db.delete(merchandisingInspections).where(eq(merchandisingInspections.displayId, displayId));
      await db.delete(merchandisingDisplays).where(eq(merchandisingDisplays.id, displayId));
    }
    if (campaignId) {
      const executionIds = await db.select({ id: retailCampaignExecutions.id }).from(retailCampaignExecutions).where(eq(retailCampaignExecutions.campaignId, campaignId));
      if (executionIds.length) await db.delete(retailCampaignSubmissions).where(inArray(retailCampaignSubmissions.executionId, executionIds.map((row) => row.id)));
      await db.delete(retailCampaignExecutions).where(eq(retailCampaignExecutions.campaignId, campaignId));
      await db.delete(retailCampaignStores).where(eq(retailCampaignStores.campaignId, campaignId));
      await db.delete(retailCampaigns).where(eq(retailCampaigns.id, campaignId));
    }
    if (periodId) { await db.delete(scheduleShifts).where(eq(scheduleShifts.periodId, periodId)); await db.delete(scheduleDaysOff).where(eq(scheduleDaysOff.periodId, periodId)); await db.delete(schedulePeriods).where(eq(schedulePeriods.id, periodId)); }
    if (taskIds.length) await db.delete(taskOccurrences).where(inArray(taskOccurrences.id, taskIds));
    const reportRows = photoIds.length ? await db.select({ id: photoReportVersions.id, reportId: photoReportVersions.reportId }).from(photoReportVersions).where(inArray(photoReportVersions.photoId, photoIds)) : [];
    if (reportRows.length) { await db.delete(photoReviewHistory).where(inArray(photoReviewHistory.versionId, reportRows.map((row) => row.id))); await db.delete(photoReportVersions).where(inArray(photoReportVersions.id, reportRows.map((row) => row.id))); await db.delete(photoReports).where(inArray(photoReports.id, [...new Set(reportRows.map((row) => row.reportId))])); }
    if (photoIds.length) await db.delete(photos).where(inArray(photos.id, photoIds));
    if (performanceTaskIds.length) await db.delete(taskOccurrences).where(inArray(taskOccurrences.id, performanceTaskIds));
    if (performanceStaffIds.length) await db.delete(userStores).where(inArray(userStores.userId, performanceStaffIds));
    if (performanceStaffIds.length) await db.delete(users).where(inArray(users.id, performanceStaffIds));
    if (performanceStoreIds.length) await db.delete(stores).where(inArray(stores.id, performanceStoreIds));
    if (quizId) { await db.delete(quizAttempts).where(eq(quizAttempts.quizId, quizId)); await db.delete(quizRevisions).where(eq(quizRevisions.quizId, quizId)); await db.delete(quizzes).where(eq(quizzes.id, quizId)); }
    if (surveyQuizId) { await db.delete(quizAttempts).where(eq(quizAttempts.quizId, surveyQuizId)); await db.delete(quizRevisions).where(eq(quizRevisions.quizId, surveyQuizId)); await db.delete(quizzes).where(eq(quizzes.id, surveyQuizId)); }
    if (knowledgeArticleIds.length) {
      await db.delete(knowledgeAcknowledgments).where(inArray(knowledgeAcknowledgments.articleId, knowledgeArticleIds));
      await db.delete(knowledgeVisibilityTargets).where(inArray(knowledgeVisibilityTargets.articleId, knowledgeArticleIds));
      await db.delete(knowledgeArticles).where(inArray(knowledgeArticles.id, knowledgeArticleIds));
      await db.delete(knowledgeArticleRevisions).where(inArray(knowledgeArticleRevisions.id, knowledgeRevisionIds));
    }
    if (knowledgeCategoryId) await db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, knowledgeCategoryId));
    if ([managerId, multiStaffId, secondStaffId, inactiveStaffId].filter(Boolean).length) await db.delete(userStores).where(inArray(userStores.userId, [managerId, multiStaffId, secondStaffId, inactiveStaffId].filter(Boolean)));
    if ([adminId, managerId, multiStaffId, secondStaffId, inactiveStaffId].filter(Boolean).length) await db.delete(users).where(inArray(users.id, [adminId, managerId, multiStaffId, secondStaffId, inactiveStaffId].filter(Boolean)));
    if (storeA && storeB) await db.delete(stores).where(inArray(stores.id, [storeA, storeB]));
    await client.end();
  });

  test("enforces management scope and never returns restricted employee details", async () => {
    expect((await app.request(`/api/v1/management/reports/overview?${baseQuery}`)).status).toBe(401);
    expect((await app.request(`/api/v1/management/reports/overview?${baseQuery}`, { headers: { "x-report-principal": "staff" } })).status).toBe(403);
    const managerResponse = await app.request(`/api/v1/management/reports/stores?${baseQuery}`, { headers: { "x-report-principal": "manager" } });
    expect(managerResponse.status).toBe(200);
    expect(managerResponse.headers.get("cache-control")).toBe("private, no-store");
    const managerBody = await managerResponse.json() as any;
    expect(managerBody.pagination.total).toBe(1);
    expect(managerBody.data[0].storeId).toBe(storeA);
    expect(JSON.stringify(managerBody)).not.toContain("report-staff-a-");
    expect((await app.request(`/api/v1/management/reports/stores?${baseQuery}&storeId=${storeB}`, { headers: { "x-report-principal": "manager" } })).status).toBe(404);
    expect((await app.request(`/api/v1/management/reports/employees?${baseQuery}&employeeId=${secondStaffId}`, { headers: { "x-report-principal": "manager" } })).status).toBe(404);
    await db.delete(userStores).where(eq(userStores.userId, managerId));
    const noMembership = await app.request(`/api/v1/management/reports/stores?${baseQuery}`, { headers: { "x-report-principal": "manager" } });
    expect((await noMembership.json() as any).pagination.total).toBe(0);
    await db.insert(userStores).values({ userId: managerId, storeId: storeA });
  });

  test("reconciles store, employee, training, photo, task, schedule and operations aggregates", async () => {
    const headers = { "x-report-principal": "manager" };
    const get = async (path: string) => {
      const response = await app.request(`/api/v1/management/reports/${path}?${baseQuery}`, { headers });
      expect(response.status).toBe(200);
      return await response.json() as any;
    };
    const overview = await get("overview");
    expect(overview.metrics).toMatchObject({ activeStoreCount: 1, activeAssignedEmployeeCount: 1, participatingStoreCount: 1, assignedTaskCount: 4, checkedTaskCount: 2, outstandingReviewCount: 2, taskCompletionRate: 50 });
    const series = await get("time-series");
    expect(series.interval).toBe("day");
    expect(series.data).toHaveLength(30);
    const activeDay = series.data.find((row: any) => row.localDate === "2026-10-15");
    expect(activeDay).toMatchObject({ taskOccurrencesCreated: 2, photoVersionsSubmitted: 2, quizAttemptsSubmitted: 4, campaignSubmissions: 1, merchandisingInspectionsSubmitted: 1, issuesCreated: 1, requestsCreated: 1 });
    const employees = await get("employees");
    expect(employees.data).toHaveLength(1);
    expect(employees.data[0]).toMatchObject({ employeeId: multiStaffId, assignedStoreCount: 1, submittedQuizAttemptCount: 4, passedExamAttemptCount: 1, failedExamAttemptCount: 1, assignedTaskCount: 4, checkedTaskCount: 2, submittedPhotoReportCount: 1 });
    const training = await get("training");
    expect(training.quizzes).toMatchObject({ availableAssignmentCount: 2, completedCurrentAssignmentCount: 2, submittedAttemptCount: 4, examAttemptCount: 3, surveyAttemptCount: 1, passedExamAttemptCount: 1, failedExamAttemptCount: 1, averageExamScore: 65 });
    expect(training.knowledge).toMatchObject({ requiredAcknowledgmentCount: 2, acknowledgedCount: 1, completionRate: 50 });
    const photosReport = await get("photos");
    expect(photosReport).toMatchObject({ submittedReportCount: 1, submittedVersionCount: 2, resubmissionCount: 1, currentStatus: { pending: 0, checked: 0, rejected: 1 }, reviewEventCount: 2, averageReviewHours: 1 });
    const taskReport = await get("tasks");
    expect(taskReport).toMatchObject({ assignedTaskCount: 4, checkedTaskCount: 2, rejectedTaskCount: 1, overdueTaskCount: 1, completionRate: 50 });
    const scheduleReport = await get("schedules");
    expect(scheduleReport).toMatchObject({ shiftCount: 2, plannedHours: 12, scheduledDayOffCount: 2, stores: [{ storeId: storeA, coveredLocalDateCount: 1 }] });
    const operationReport = await get("operations");
    expect(operationReport.campaigns).toMatchObject({ targetedStoreCount: 1, checkedExecutionCount: 1, pendingExecutionCount: 0, completionRate: 100, submissionEventCount: 1 });
    expect(operationReport.merchandising).toMatchObject({ pendingInspectionCount: 1 });
    expect(operationReport.issues).toMatchObject({ openCount: 1, urgentCount: 1, statusTransitionEventCount: 1 });
    expect(operationReport.requests).toMatchObject({ completedCount: 1, decisionEventCount: 1, averageDecisionHours: 1, averageCompletionHours: 4 });
    const definitions = await get("metric-definitions");
    expect(definitions.data.length).toBeGreaterThan(20);
  });

  test("administrator sees the network, multi-store users are not double counted, and empty values are explicit", async () => {
    const [overviewResponse, storesResponse, emptyResponse] = await Promise.all([
      app.request(`/api/v1/management/reports/overview?${baseQuery}`, { headers: { "x-report-principal": "admin" } }),
      app.request(`/api/v1/management/reports/stores?${baseQuery}&pageSize=1`, { headers: { "x-report-principal": "admin" } }),
      app.request(`/api/v1/management/reports/tasks?${baseQuery}&storeId=${storeB}`, { headers: { "x-report-principal": "manager" } }),
    ]);
    expect((await overviewResponse.json() as any).metrics).toMatchObject({ activeStoreCount: 2, activeAssignedEmployeeCount: 2, assignedTaskCount: 5, checkedTaskCount: 2, outstandingReviewCount: 3 });
    const adminTraining = await app.request(`/api/v1/management/reports/training?${baseQuery}`, { headers: { "x-report-principal": "admin" } });
    expect(adminTraining.status).toBe(200);
    expect((await adminTraining.json() as any).knowledge).toMatchObject({ requiredAcknowledgmentCount: 4, acknowledgedCount: 1, completionRate: 25 });
    expect((await storesResponse.json() as any).pagination).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    const adminOperations = await app.request(`/api/v1/management/reports/operations?${baseQuery}`, { headers: { "x-report-principal": "admin" } });
    expect(adminOperations.status).toBe(200);
    expect((await adminOperations.json() as any).campaigns).toMatchObject({ targetedStoreCount: 2, targetedExecutionCount: 2, checkedExecutionCount: 1, pendingExecutionCount: 1, completionRate: 50 });
    const adminSeries = await app.request(`/api/v1/management/reports/time-series?${baseQuery}`, { headers: { "x-report-principal": "admin" } });
    const adminSeriesDay = (await adminSeries.json() as any).data.find((row: any) => row.localDate === "2026-10-15");
    expect(adminSeriesDay.quizAttemptsSubmitted).toBe(5);
    expect(emptyResponse.status).toBe(404);
    const emptyStoreQuery = await app.request(`/api/v1/management/reports/tasks?${baseQuery}&storeId=${storeB}`, { headers: { "x-report-principal": "admin" } });
    const empty = await emptyStoreQuery.json() as any;
    expect(empty).toMatchObject({ assignedTaskCount: 1, checkedTaskCount: 0, completionRate: 0 });
    const emptyStore = await app.request(`/api/v1/management/reports/stores?period=custom&startDate=2026-01-01&endDate=2026-01-02&storeId=${storeA}`, { headers: { "x-report-principal": "admin" } });
    expect((await emptyStore.json() as any).data[0]).toMatchObject({ assignedTaskCount: 0, checkedTaskCount: 0, participated: false });
    const zeroTasks = await app.request(`/api/v1/management/reports/tasks?period=custom&startDate=2026-01-01&endDate=2026-01-02&storeId=${storeB}`, { headers: { "x-report-principal": "admin" } });
    expect((await zeroTasks.json() as any)).toMatchObject({ assignedTaskCount: 0, checkedTaskCount: 0, completionRate: null });
  });

  test("measures the scoped overview and representative aggregate plan on a synthetic 12-store dataset", async () => {
    const perfStores = await db.insert(stores).values(Array.from({ length: 12 }, (_, i) => ({ name: `Report Perf ${suffix} ${i}`, code: `RPF-${suffix}-${i}` }))).returning({ id: stores.id });
    performanceStoreIds.push(...perfStores.map((row) => row.id));
    const perfStaff = await db.insert(users).values(Array.from({ length: 120 }, (_, i) => ({ firstName: "Perf", lastName: `Staff ${suffix} ${i}`, email: `report-perf-${suffix}-${i}@example.test`, role: "staff" as const }))).returning({ id: users.id });
    performanceStaffIds.push(...perfStaff.map((row) => row.id));
    await db.insert(userStores).values(performanceStaffIds.map((userId, i) => ({ userId, storeId: performanceStoreIds[i % 12]! })));
    const allIds: string[] = [];
    for (let offset = 0; offset < 10_000; offset += 500) {
      const values = Array.from({ length: Math.min(500, 10_000 - offset) }, (_, inner) => {
        const index = offset + inner;
        const storeIndex = index % 12;
        const eventDay = 1 + (index % 30);
        return {
          assignmentGroupId: crypto.randomUUID(), storeId: performanceStoreIds[storeIndex]!, assignedEmployeeId: performanceStaffIds[index % 120]!,
          title: `Synthetic task ${index}`, category: "report-performance", status: (index % 5 === 0 ? "checked" : "assigned") as "checked" | "assigned",
          createdBy: adminId, createdAt: new Date(Date.UTC(2026, 9, eventDay, index % 24)), updatedAt: middle,
        };
      });
      const inserted = await db.insert(taskOccurrences).values(values).returning({ id: taskOccurrences.id });
      allIds.push(...inserted.map((row) => row.id));
    }
    performanceTaskIds.push(...allIds);

    const before = performance.now();
    const response = await app.request(`/api/v1/management/reports/overview?${baseQuery}&storeId=${performanceStoreIds[0]}`, { headers: { "x-report-principal": "admin" } });
    const apiMs = performance.now() - before;
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.metrics.assignedTaskCount).toBe(834);
    expect(body.metrics.activeAssignedEmployeeCount).toBe(10);

    const [planRow] = await db.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT COUNT(*) FROM "task_occurrences" WHERE "store_id" = ${performanceStoreIds[0]}::uuid
      AND "created_at" >= ${new Date("2026-09-30T21:00:00.000Z").toISOString()}::timestamptz
      AND "created_at" < ${new Date("2026-10-30T22:00:00.000Z").toISOString()}::timestamptz`) as unknown as Array<Record<string, unknown>>;
    const planJson = planRow?.["QUERY PLAN"] as Array<{ Plan?: Record<string, unknown>; "Planning Time"?: number; "Execution Time"?: number }>;
    const plan = planJson?.[0];
    const planChild = (plan?.Plan?.["Plans"] as Array<Record<string, unknown>> | undefined)?.[0];
    const planIndex = (planChild?.["Plans"] as Array<Record<string, unknown>> | undefined)?.[0];
    expect(plan?.Plan?.["Actual Rows"]).toBe(1);
    console.log("M20.1_REPORT_PERF", JSON.stringify({ stores: 12, employees: 120, taskOccurrences: 10_000, scopedStoreOccurrences: 834, periodDays: 30, overviewApiMs: Math.round(apiMs * 100) / 100, planNode: plan?.Plan?.["Node Type"], scanNode: planChild?.["Node Type"], scanRelation: planChild?.["Relation Name"], scanIndex: planIndex?.["Index Name"], scanActualRows: planChild?.["Actual Rows"], planExecutionMs: plan?.["Execution Time"], planPlanningMs: plan?.["Planning Time"], planSharedHitBlocks: plan?.Plan?.["Shared Hit Blocks"], planSharedReadBlocks: plan?.Plan?.["Shared Read Blocks"] }));
  });
});

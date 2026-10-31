import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { eq, inArray, sql } from "drizzle-orm";
import { createApp } from "../src/app";
import { createAuthService } from "../src/auth/service";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import {
  domainEvents,
  merchandisingDisplays,
  merchandisingInspections,
  merchandisingReviewHistory,
  notificationEventConsumptions,
  notificationOutbox,
  notifications,
  operationalRequestHistory,
  operationalRequestPhotos,
  operationalRequests,
  photoReportVersions,
  photoReports,
  photoReviewHistory,
  photos,
  retailCampaignExecutions,
  retailCampaignReferencePhotos,
  retailCampaignReviews,
  retailCampaignStores,
  retailCampaignSubmissionPhotos,
  retailCampaignSubmissions,
  retailCampaigns,
  sessions,
  storeIssueHistory,
  storeIssuePhotos,
  storeIssues,
  stores,
  userStores,
  users,
} from "../src/db/schema";
import { createNotificationsService } from "../src/domain/notifications/service";
import { OperationsService } from "../src/domain/operations/service";
import { createPhotosService } from "../src/domain/photos/service";
import { noopLogger } from "../src/lib/logger";
import { LocalPhotoStorage } from "../src/storage/photo-storage";

const enabled = Bun.env.RUN_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (value) => value.charCodeAt(0));

type BrowserAuth = { cookie: string; csrf: string };
type Json = Record<string, any>;

function cookieValue(header: string, name: string): string {
  const value = header.match(new RegExp(`${name}=([^;,]+)`))?.[1];
  if (!value) throw new Error(`Missing ${name} cookie`);
  return value;
}

suite("Retail operations real HTTP acceptance", () => {
  const { db, client } = createDatabase(loadEnv());
  const runId = crypto.randomUUID().slice(0, 8);
  const testPassword = `M19-acceptance-${crypto.randomUUID()}!`;
  const storageRoot = `/tmp/vizaje-m19-http-${runId}`;
  const storage = new LocalPhotoStorage(storageRoot);
  const auth = createAuthService(db);
  const operations = new OperationsService(db, storage);
  const notificationService = createNotificationsService(db);
  const photosService = createPhotosService(db, storage, { maxBytes: 10 * 1024 * 1024, maxDimension: 8192, maxPixels: 25_000_000 }, noopLogger);
  const userIds: string[] = [];
  const storeIds: string[] = [];
  const photoIds: string[] = [];
  const photoKeys: string[] = [];
  const campaignIds: string[] = [];
  const displayIds: string[] = [];
  const issueIds: string[] = [];
  const requestIds: string[] = [];
  let adminId = "";
  let managerAId = "";
  let managerBId = "";
  let staffAId = "";
  let staffBId = "";
  let storeAId = "";
  let storeBId = "";
  let apiOrigin = "";
  let server: ReturnType<typeof Bun.serve> | undefined;
  let adminAuth: BrowserAuth;
  let managerAAuth: BrowserAuth;
  let managerBAuth: BrowserAuth;
  let staffAToken = "";
  let staffBToken = "";
  let photoAReferenceId = "";
  let photoBReferenceId = "";
  let photoAEvidenceId = "";
  let photoBEvidenceId = "";

  async function request(path: string, init: RequestInit = {}) {
    if (!apiOrigin) throw new Error("HTTP test server has not started");
    return fetch(`${apiOrigin}${path}`, init);
  }

  function browserHeaders(session: BrowserAuth, body = true): HeadersInit {
    return { Cookie: session.cookie, "X-CSRF-Token": session.csrf, ...(body ? { "Content-Type": "application/json" } : {}) };
  }

  function bearerHeaders(token: string, body = true): HeadersInit {
    return { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) };
  }

  async function browserLogin(email: string): Promise<BrowserAuth> {
    const response = await request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: testPassword }) });
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    const session = cookieValue(setCookie, "vizaje_session");
    const csrf = cookieValue(setCookie, "vizaje_csrf");
    return { cookie: `vizaje_session=${session}; vizaje_csrf=${csrf}`, csrf };
  }

  async function mobileLogin(email: string, deviceId: string): Promise<string> {
    const response = await request("/api/v1/auth/mobile/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: testPassword, deviceId }) });
    expect(response.status).toBe(201);
    return ((await response.json()) as { accessToken: string }).accessToken;
  }

  async function uploadEvidence(token: string, storeId: string, filename: string, key: string): Promise<string> {
    const form = new FormData();
    form.append("file", new File([png], filename, { type: "image/png" }));
    const response = await request(`/api/v1/stores/${storeId}/photos`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key }, body: form });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${runId}`;
    const userRows = await db.insert(users).values([
      { firstName: "M19", lastName: "Admin", email: `m19-admin-${suffix}@example.test`, phone: null, role: "admin", isActive: true },
      { firstName: "M19", lastName: "Manager A", email: `m19-manager-a-${suffix}@example.test`, phone: null, role: "manager", isActive: true },
      { firstName: "M19", lastName: "Manager B", email: `m19-manager-b-${suffix}@example.test`, phone: null, role: "manager", isActive: true },
      { firstName: "M19", lastName: "Staff A", email: `m19-staff-a-${suffix}@example.test`, phone: null, role: "staff", isActive: true },
      { firstName: "M19", lastName: "Staff B", email: `m19-staff-b-${suffix}@example.test`, phone: null, role: "staff", isActive: true },
    ]).returning({ id: users.id, email: users.email });
    [adminId, managerAId, managerBId, staffAId, staffBId] = userRows.map((row) => row.id);
    userIds.push(...userRows.map((row) => row.id));
    await db.update(users).set({ passwordHash: await Bun.password.hash(testPassword, { algorithm: "argon2id" }) }).where(inArray(users.id, userIds));

    const storeRows = await db.insert(stores).values([
      { name: `M19 Store A ${suffix}`, code: `M19A-${runId}` },
      { name: `M19 Store B ${suffix}`, code: `M19B-${runId}` },
    ]).returning({ id: stores.id });
    [storeAId, storeBId] = storeRows.map((row) => row.id);
    storeIds.push(storeAId, storeBId);
    await db.insert(userStores).values([
      { userId: managerAId, storeId: storeAId }, { userId: managerBId, storeId: storeBId },
      { userId: staffAId, storeId: storeAId }, { userId: staffBId, storeId: storeBId },
    ]);

    const referenceRecords = [
      { storeId: storeAId, uploadedBy: staffAId, storageKey: `m19-http/${runId}-reference-a.png`, originalFilename: "reference-a.png" },
      { storeId: storeBId, uploadedBy: staffBId, storageKey: `m19-http/${runId}-reference-b.png`, originalFilename: "reference-b.png" },
    ];
    for (const record of referenceRecords) {
      photoKeys.push(record.storageKey);
      await storage.put(record.storageKey, png, "image/png");
    }
    const seededPhotos = await db.insert(photos).values(referenceRecords.map((record) => ({ ...record, mimeType: "image/png", fileSize: png.byteLength }))).returning({ id: photos.id });
    photoIds.push(...seededPhotos.map((row) => row.id));
    [photoAReferenceId, photoBReferenceId] = seededPhotos.map((row) => row.id);

    const app = createApp({
      db,
      allowedOrigins: [],
      resolvePrincipal: auth.principalResolver(),
      authRoutes: { auth, secureCookies: false },
      photoRoutes: { photos: photosService, resolvePrincipal: auth.principalResolver(), maxUploadBytes: 10 * 1024 * 1024 },
      notificationRoutes: { notifications: notificationService, resolvePrincipal: auth.principalResolver() },
      operationsRoutes: { operations, resolvePrincipal: auth.principalResolver() },
      logger: noopLogger,
    });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
    apiOrigin = `http://127.0.0.1:${server.port}`;

    adminAuth = await browserLogin(userRows[0]!.email!);
    managerAAuth = await browserLogin(userRows[1]!.email!);
    managerBAuth = await browserLogin(userRows[2]!.email!);
    staffAToken = await mobileLogin(userRows[3]!.email!, `m19-device-a-${runId}`);
    staffBToken = await mobileLogin(userRows[4]!.email!, `m19-device-b-${runId}`);
    photoAEvidenceId = await uploadEvidence(staffAToken, storeAId, "execution-a.png", `m19-upload-a-${runId}`);
    photoBEvidenceId = await uploadEvidence(staffBToken, storeBId, "execution-b.png", `m19-upload-b-${runId}`);
    photoIds.push(photoAEvidenceId, photoBEvidenceId);
  });

  afterAll(async () => {
    server?.stop(true);
    const campaignRows = campaignIds.length ? await db.select({ id: retailCampaignExecutions.id }).from(retailCampaignExecutions).where(inArray(retailCampaignExecutions.campaignId, campaignIds)) : [];
    const executionIds = campaignRows.map((row) => row.id);
    const submissions = executionIds.length ? await db.select({ id: retailCampaignSubmissions.id }).from(retailCampaignSubmissions).where(inArray(retailCampaignSubmissions.executionId, executionIds)) : [];
    if (submissions.length) await db.delete(retailCampaignSubmissionPhotos).where(inArray(retailCampaignSubmissionPhotos.submissionId, submissions.map((row) => row.id)));
    if (executionIds.length) await db.delete(retailCampaignReviews).where(inArray(retailCampaignReviews.executionId, executionIds));
    if (executionIds.length) await db.delete(retailCampaignSubmissions).where(inArray(retailCampaignSubmissions.executionId, executionIds));
    if (campaignIds.length) {
      await db.delete(retailCampaignReferencePhotos).where(inArray(retailCampaignReferencePhotos.campaignId, campaignIds));
      await db.delete(retailCampaignExecutions).where(inArray(retailCampaignExecutions.campaignId, campaignIds));
      await db.delete(retailCampaignStores).where(inArray(retailCampaignStores.campaignId, campaignIds));
      await db.delete(retailCampaigns).where(inArray(retailCampaigns.id, campaignIds));
    }
    if (displayIds.length) {
      const inspections = await db.select({ id: merchandisingInspections.id }).from(merchandisingInspections).where(inArray(merchandisingInspections.displayId, displayIds));
      if (inspections.length) {
        await db.delete(merchandisingReviewHistory).where(inArray(merchandisingReviewHistory.inspectionId, inspections.map((row) => row.id)));
        await db.delete(merchandisingInspections).where(inArray(merchandisingInspections.id, inspections.map((row) => row.id)));
      }
      await db.delete(merchandisingDisplays).where(inArray(merchandisingDisplays.id, displayIds));
    }
    if (issueIds.length) {
      await db.delete(storeIssueHistory).where(inArray(storeIssueHistory.issueId, issueIds));
      await db.delete(storeIssuePhotos).where(inArray(storeIssuePhotos.issueId, issueIds));
      await db.delete(storeIssues).where(inArray(storeIssues.id, issueIds));
    }
    if (requestIds.length) {
      await db.delete(operationalRequestHistory).where(inArray(operationalRequestHistory.requestId, requestIds));
      await db.delete(operationalRequestPhotos).where(inArray(operationalRequestPhotos.requestId, requestIds));
      await db.delete(operationalRequests).where(inArray(operationalRequests.id, requestIds));
    }
    if (userIds.length) {
      const eventRows = await db.select({ id: domainEvents.id }).from(domainEvents).where(inArray(domainEvents.actorId, userIds));
      const eventIds = eventRows.map((row) => row.id);
      if (eventIds.length) {
        const notificationRows = await db.select({ id: notifications.id }).from(notifications).where(inArray(notifications.sourceEventId, eventIds));
        const notificationIds = notificationRows.map((row) => row.id);
        if (notificationIds.length) {
          await db.delete(notificationOutbox).where(inArray(notificationOutbox.notificationId, notificationIds));
          await db.delete(notifications).where(inArray(notifications.id, notificationIds));
        }
        await db.delete(notificationEventConsumptions).where(inArray(notificationEventConsumptions.domainEventId, eventIds));
        await db.delete(domainEvents).where(inArray(domainEvents.id, eventIds));
      }
      const reports = await db.select({ id: photoReports.id }).from(photoReports).where(inArray(photoReports.submittedBy, userIds));
      const reportIds = reports.map((row) => row.id);
      if (reportIds.length) {
        const versions = await db.select({ id: photoReportVersions.id }).from(photoReportVersions).where(inArray(photoReportVersions.reportId, reportIds));
        if (versions.length) await db.delete(photoReviewHistory).where(inArray(photoReviewHistory.versionId, versions.map((row) => row.id)));
        if (reportIds.length) await db.delete(photoReportVersions).where(inArray(photoReportVersions.reportId, reportIds));
        await db.delete(photoReports).where(inArray(photoReports.id, reportIds));
      }
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(userStores).where(inArray(userStores.userId, userIds));
    }
    const storedPhotos = photoIds.length ? await db.select({ storageKey: photos.storageKey }).from(photos).where(inArray(photos.id, photoIds)) : [];
    photoKeys.push(...storedPhotos.map((photo) => photo.storageKey));
    if (photoIds.length) await db.delete(photos).where(inArray(photos.id, photoIds));
    for (const key of new Set(photoKeys)) await storage.delete(key);
    await rm(storageRoot, { recursive: true, force: true });
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    if (storeIds.length) await db.delete(stores).where(inArray(stores.id, storeIds));
    await client.end();
  });

  test("runs Admin, staff, evidence, review, request, and notification flows over real HTTP", async () => {
    const media = await request(`/api/v1/photos?storeId=${storeAId}`, { headers: browserHeaders(adminAuth, false) });
    expect(media.status).toBe(200);
    expect((await media.json() as Json).data.map((item: Json) => item.id)).toContain(photoAReferenceId);

    const draftResponse = await request("/api/v1/management/operations/campaigns", {
      method: "POST", headers: browserHeaders(adminAuth),
      body: JSON.stringify({ title: `Промо ${runId}`, description: "Проверка новой выкладки", startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString(), timezone: "Europe/Chisinau", storeIds: [storeAId, storeBId], requiredActions: ["Проверить стенд"], requiresPhoto: true, referencePhotoIds: [] }),
    });
    expect(draftResponse.status).toBe(201);
    const draft = await draftResponse.json() as Json;
    campaignIds.push(draft.id);
    expect(draft.status).toBe("draft");
    const editResponse = await request(`/api/v1/management/operations/campaigns/${draft.id}`, {
      method: "PATCH", headers: browserHeaders(adminAuth),
      body: JSON.stringify({ title: `Промо ${runId} · обновлено`, referencePhotoIds: [photoAReferenceId, photoBReferenceId], storeIds: [storeAId, storeBId] }),
    });
    expect(editResponse.status).toBe(200);
    expect((await editResponse.json() as Json).referencePhotoIds).toEqual([photoAReferenceId, photoBReferenceId]);
    const hiddenDraft = await request(`/api/v1/operations/campaigns/${draft.id}`, { headers: bearerHeaders(staffAToken, false) });
    expect(hiddenDraft.status).toBe(404);

    const publish = await request(`/api/v1/management/operations/campaigns/${draft.id}/publish`, { method: "POST", headers: browserHeaders(adminAuth) });
    expect(publish.status).toBe(200);
    expect((await publish.json() as Json).status).toBe("active");
    const campaignAResponse = await request(`/api/v1/operations/campaigns/${draft.id}`, { headers: bearerHeaders(staffAToken, false) });
    expect(campaignAResponse.status).toBe(200);
    const campaignA = await campaignAResponse.json() as Json;
    expect(campaignA.storeIds).toEqual([storeAId]);
    expect(JSON.stringify(campaignA)).not.toContain("m19-http/");
    const executionA = campaignA.executions[0].id as string;
    const submitCampaign = async (token: string, storeId: string, evidenceId: string, key: string) => request(`/api/v1/operations/campaigns/${draft.id}/stores/${storeId}/submit`, {
      method: "POST", headers: bearerHeaders(token), body: JSON.stringify({ actionResults: [true], photoIds: [evidenceId], employeeNote: "Проверено на месте", idempotencyKey: key }),
    });
    expect((await submitCampaign(staffAToken, storeAId, photoAEvidenceId, `campaign-a-${runId}`)).status).toBe(200);
    const approveA = await request(`/api/v1/management/operations/campaign-executions/${executionA}/review`, { method: "POST", headers: browserHeaders(managerAAuth), body: JSON.stringify({ decision: "checked", comment: "Принято" }) });
    expect(approveA.status).toBe(200);
    const campaignBResponse = await request(`/api/v1/operations/campaigns/${draft.id}`, { headers: bearerHeaders(staffBToken, false) });
    expect(campaignBResponse.status).toBe(200);
    const campaignB = await campaignBResponse.json() as Json;
    expect(campaignB.storeIds).toEqual([storeBId]);
    const executionB = campaignB.executions[0].id as string;
    expect((await submitCampaign(staffBToken, storeBId, photoBEvidenceId, `campaign-b-${runId}`)).status).toBe(200);
    const rejectB = await request(`/api/v1/management/operations/campaign-executions/${executionB}/review`, { method: "POST", headers: browserHeaders(managerBAuth), body: JSON.stringify({ decision: "rejected", comment: "Нужно исправить оформление" }) });
    expect(rejectB.status).toBe(200);
    expect((await rejectB.json() as Json).status).toBe("rejected");
    const deniedManager = await request(`/api/v1/management/operations/campaign-executions/${executionB}/review`, { method: "POST", headers: browserHeaders(managerAAuth), body: JSON.stringify({ decision: "checked", comment: "" }) });
    expect(deniedManager.status).toBe(403);
    expect((await submitCampaign(staffBToken, storeBId, photoBEvidenceId, `campaign-b-retry-${runId}`)).status).toBe(200);
    const approveB = await request(`/api/v1/management/operations/campaign-executions/${executionB}/review`, { method: "POST", headers: browserHeaders(managerBAuth), body: JSON.stringify({ decision: "checked", comment: "Исправлено" }) });
    expect(approveB.status).toBe(200);
    const history = await request(`/api/v1/operations/campaigns/${draft.id}/history`, { headers: bearerHeaders(staffBToken, false) });
    expect(history.status).toBe(200);
    expect((await history.json() as Json).data.filter((row: Json) => row.executionId === executionB).map((row: Json) => row.version).filter(Boolean)).toEqual([1, 2]);
    const complete = await request(`/api/v1/management/operations/campaigns/${draft.id}/transition`, { method: "POST", headers: browserHeaders(adminAuth), body: JSON.stringify({ action: "complete" }) });
    expect(complete.status).toBe(200);

    const displayResponse = await request("/api/v1/management/operations/merchandising/displays", {
      method: "POST", headers: browserHeaders(managerAAuth),
      body: JSON.stringify({ storeId: storeAId, name: `Выкладка ${runId}`, brand: "M19", referencePhotoId: photoAReferenceId, checklist: ["Ценник на месте"] }),
    });
    expect(displayResponse.status).toBe(201);
    const display = await displayResponse.json() as Json;
    displayIds.push(display.id);
    const displayList = await request(`/api/v1/operations/merchandising?storeId=${storeAId}`, { headers: bearerHeaders(staffAToken, false) });
    expect(displayList.status).toBe(200);
    expect((await displayList.json() as Json).data.some((item: Json) => item.displayId === display.id)).toBe(true);
    const inspect = async (photoId: string, key: string) => request(`/api/v1/operations/merchandising/displays/${display.id}/inspections`, {
      method: "POST", headers: bearerHeaders(staffAToken), body: JSON.stringify({ actualPhotoId: photoId, checklistResults: [true], employeeNote: "Проверено", idempotencyKey: key }),
    });
    const inspection1 = await inspect(photoAEvidenceId, `inspection-1-${runId}`);
    expect(inspection1.status).toBe(201);
    const inspection1Body = await inspection1.json() as Json;
    const rejectInspection = await request(`/api/v1/management/operations/merchandising/inspections/${inspection1Body.id}/review`, { method: "POST", headers: browserHeaders(managerAAuth), body: JSON.stringify({ decision: "rejected", comment: "Сделайте фото целиком" }) });
    expect(rejectInspection.status).toBe(200);
    const inspection1Detail = await request(`/api/v1/operations/merchandising/inspections/${inspection1Body.id}`, { headers: bearerHeaders(staffAToken, false) });
    expect(inspection1Detail.status).toBe(200);
    expect((await inspection1Detail.json() as Json)).toMatchObject({ referencePhotoId: photoAReferenceId, actualPhotoId: photoAEvidenceId, version: 1 });
    const inspection2 = await inspect(photoAReferenceId, `inspection-2-${runId}`);
    expect(inspection2.status).toBe(201);
    const inspection2Body = await inspection2.json() as Json;
    expect(inspection2Body.version).toBe(2);
    const approveInspection = await request(`/api/v1/management/operations/merchandising/inspections/${inspection2Body.id}/review`, { method: "POST", headers: browserHeaders(managerAAuth), body: JSON.stringify({ decision: "checked", comment: "Принято" }) });
    expect(approveInspection.status).toBe(200);
    const inspectionHistory = await request(`/api/v1/operations/merchandising/inspections/${inspection1Body.id}/history`, { headers: bearerHeaders(staffAToken, false) });
    expect((await inspectionHistory.json() as Json).data.map((row: Json) => row.toStatus)).toEqual(["submitted", "rejected"]);
    const disableDisplay = await request(`/api/v1/management/operations/merchandising/displays/${display.id}`, { method: "PATCH", headers: browserHeaders(managerAAuth), body: JSON.stringify({ active: false }) });
    expect(disableDisplay.status).toBe(200);
    expect((await inspect(photoAReferenceId, `inspection-disabled-${runId}`)).status).toBe(404);
    expect((await request(`/api/v1/operations/evidence/merchandising_inspection/${inspection1Body.id}/${photoAEvidenceId}`, { headers: bearerHeaders(staffAToken, false) })).status).toBe(200);

    const issueResponse = await request("/api/v1/operations/issues", {
      method: "POST", headers: { ...bearerHeaders(staffAToken), "Idempotency-Key": `issue-${runId}` },
      body: JSON.stringify({ storeId: storeAId, category: "equipment", title: `Терминал ${runId}`, description: "Нужна диагностика", priority: "normal", photoIds: [photoAEvidenceId] }),
    });
    expect(issueResponse.status).toBe(201);
    const issue = await issueResponse.json() as Json;
    issueIds.push(issue.id);
    const issueRetry = await request("/api/v1/operations/issues", {
      method: "POST", headers: { ...bearerHeaders(staffAToken), "Idempotency-Key": `issue-${runId}` },
      body: JSON.stringify({ storeId: storeAId, category: "equipment", title: `Терминал ${runId}`, description: "Нужна диагностика", priority: "normal", photoIds: [photoAEvidenceId] }),
    });
    expect((await issueRetry.json() as Json).id).toBe(issue.id);
    const assignIssue = await request(`/api/v1/management/operations/issues/${issue.id}`, { method: "PATCH", headers: browserHeaders(managerAAuth), body: JSON.stringify({ assignedTo: staffAId }) });
    expect(assignIssue.status).toBe(200);
    const priority = await request(`/api/v1/management/operations/issues/${issue.id}/priority`, { method: "POST", headers: browserHeaders(managerAAuth), body: JSON.stringify({ priority: "urgent", expectedPriority: "normal" }) });
    expect(priority.status).toBe(200);
    expect((await request(`/api/v1/operations/issues/${issue.id}`, { headers: browserHeaders(managerBAuth, false) })).status).toBe(403);
    expect((await request(`/api/v1/operations/issues/${issue.id}`, { headers: bearerHeaders(staffBToken, false) })).status).toBe(404);
    const issueTransition = async (body: Json) => request(`/api/v1/management/operations/issues/${issue.id}`, { method: "PATCH", headers: browserHeaders(managerAAuth), body: JSON.stringify(body) });
    expect((await issueTransition({ status: "in_progress" })).status).toBe(200);
    expect((await issueTransition({ status: "resolved", resolutionNotes: "Терминал перезапущен" })).status).toBe(200);
    expect((await issueTransition({ status: "closed" })).status).toBe(200);
    expect((await issueTransition({ status: "open", reopenReason: "Проблема повторилась" })).status).toBe(200);
    const issueHistoryResponse = await request(`/api/v1/operations/issues/${issue.id}/history`, { headers: bearerHeaders(staffAToken, false) });
    expect((await issueHistoryResponse.json() as Json).data.length).toBe(7);
    const invalidIssue = await request("/api/v1/operations/issues", { method: "POST", headers: { ...bearerHeaders(staffAToken), "Idempotency-Key": `issue-invalid-${runId}` }, body: JSON.stringify({ storeId: storeAId, category: "equipment", title: "Чужое фото", description: "Проверка связи", photoIds: [photoBEvidenceId] }) });
    expect(invalidIssue.status).toBe(403);

    const requestResponse = await request("/api/v1/operations/requests", {
      method: "POST", headers: { ...bearerHeaders(staffBToken), "Idempotency-Key": `request-${runId}` },
      body: JSON.stringify({ storeId: storeBId, category: "supplies", description: `Материалы ${runId}`, quantity: "4 коробки", attachmentPhotoIds: [photoBEvidenceId] }),
    });
    expect(requestResponse.status).toBe(201);
    const operationRequest = await requestResponse.json() as Json;
    requestIds.push(operationRequest.id);
    const requestDecision = await request(`/api/v1/management/operations/requests/${operationRequest.id}/decision`, { method: "POST", headers: browserHeaders(managerBAuth), body: JSON.stringify({ decision: "approved", comment: "Одобрено" }) });
    expect(requestDecision.status).toBe(200);
    expect((await request(`/api/v1/operations/requests/${operationRequest.id}`, { headers: browserHeaders(managerAAuth, false) })).status).toBe(403);
    const requestTransition = async (body: Json) => request(`/api/v1/management/operations/requests/${operationRequest.id}`, { method: "PATCH", headers: browserHeaders(managerBAuth), body: JSON.stringify(body) });
    expect((await requestTransition({ assignedTo: staffBId, comment: "Ответственный назначен" })).status).toBe(200);
    expect((await requestTransition({ status: "in_progress" })).status).toBe(200);
    expect((await requestTransition({ status: "completed", comment: "Передано магазину" })).status).toBe(200);
    const staffRequest = await request(`/api/v1/operations/requests/${operationRequest.id}`, { headers: bearerHeaders(staffBToken, false) });
    expect((await staffRequest.json() as Json)).toMatchObject({ status: "completed", assignedTo: staffBId, attachmentPhotoIds: [photoBEvidenceId] });
    const requestHistory = await request(`/api/v1/operations/requests/${operationRequest.id}/history`, { headers: bearerHeaders(staffBToken, false) });
    expect((await requestHistory.json() as Json).data.map((row: Json) => row.toStatus)).toEqual(["submitted", "approved", "approved", "in_progress", "completed"]);

    const issueEvidence = await request(`/api/v1/operations/evidence/store_issue/${issue.id}/${photoAEvidenceId}`, { headers: bearerHeaders(staffAToken, false) });
    expect(issueEvidence.status).toBe(200);
    expect(issueEvidence.headers.get("cache-control")).toContain("no-store");
    expect((await request(`/api/v1/operations/evidence/store_issue/${issue.id}/${photoBEvidenceId}`, { headers: bearerHeaders(staffAToken, false) })).status).toBe(404);
    expect((await request(`/api/v1/operations/evidence/store_issue/${issue.id}/${crypto.randomUUID()}`, { headers: bearerHeaders(staffAToken, false) })).status).toBe(404);

    const operationAggregateIds = [draft.id, executionA, executionB, inspection1Body.id, inspection2Body.id, issue.id, operationRequest.id];
    const events = await db.select({ id: domainEvents.id, aggregateId: domainEvents.aggregateId, eventType: domainEvents.eventType }).from(domainEvents).where(inArray(domainEvents.aggregateId, operationAggregateIds));
    expect(events.length).toBeGreaterThanOrEqual(20);
    const firstConsume = await Promise.all(events.map((event) => notificationService.consumeEvent(event.id)));
    expect(firstConsume.some(Boolean)).toBe(true);
    const retryConsume = await Promise.all(events.map((event) => notificationService.consumeEvent(event.id)));
    expect(retryConsume.every((consumed) => !consumed)).toBe(true);
    const staffInbox = await request("/api/v1/me/notifications?pageSize=100", { headers: bearerHeaders(staffAToken, false) });
    const staffNotifications = (await staffInbox.json() as Json).data as Json[];
    expect(staffNotifications.some((item) => item.category === "operations" && item.target?.kind === "operation" && item.target.id === issue.id)).toBe(true);
    const managerInbox = await request("/api/v1/me/notifications?pageSize=100", { headers: browserHeaders(managerBAuth, false) });
    expect((await managerInbox.json() as Json).data.some((item: Json) => item.eventType === "campaign.execution_submitted" && item.target?.kind === "operation")).toBe(true);
    const [consumptionCount] = await db.select({ count: sql<number>`count(*)` }).from(notificationEventConsumptions).where(inArray(notificationEventConsumptions.domainEventId, events.map((event) => event.id)));
    expect(Number(consumptionCount?.count)).toBe(events.length);
    const notificationRows = await db.select({ id: notifications.id, sourceEventId: notifications.sourceEventId, recipientUserId: notifications.recipientUserId }).from(notifications).where(inArray(notifications.sourceEventId, events.map((event) => event.id)));
    expect(new Set(notificationRows.map((row) => `${row.sourceEventId}:${row.recipientUserId}`)).size).toBe(notificationRows.length);
    expect((await db.select().from(notificationOutbox).innerJoin(notifications, eq(notificationOutbox.notificationId, notifications.id)).where(inArray(notifications.sourceEventId, events.map((event) => event.id)))).length).toBe(0);

    const campaignRows = await db.select().from(retailCampaignSubmissions).innerJoin(retailCampaignExecutions, eq(retailCampaignSubmissions.executionId, retailCampaignExecutions.id)).where(eq(retailCampaignExecutions.campaignId, draft.id));
    expect(campaignRows.map((row) => row.retail_campaign_submissions.version).sort()).toEqual([1, 1, 2]);
    const snapshots = await db.select().from(merchandisingInspections).where(eq(merchandisingInspections.displayId, display.id)).orderBy(merchandisingInspections.version);
    expect(snapshots.map((row) => [row.version, row.referencePhotoId, row.actualPhotoId])).toEqual([[1, photoAReferenceId, photoAEvidenceId], [2, photoAReferenceId, photoAReferenceId]]);
    expect((await db.select().from(storeIssueHistory).where(eq(storeIssueHistory.issueId, issue.id))).length).toBe(7);
    expect((await db.select().from(operationalRequestHistory).where(eq(operationalRequestHistory.requestId, operationRequest.id))).length).toBe(5);
  });
});

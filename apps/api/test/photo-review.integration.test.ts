import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app";
import { createAuthService } from "../src/auth/service";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import { domainEvents, photoReports, photoReportVersions, photoReviewHistory, photos, stores, userStores, users } from "../src/db/schema";
import { createPhotosService } from "../src/domain/photos/service";
import { createStoresService } from "../src/domain/stores/service";
import { createUsersService } from "../src/domain/users/service";
import { noopLogger } from "../src/lib/logger";
import { LocalPhotoStorage } from "../src/storage/photo-storage";

const integrationEnabled = Bun.env.RUN_INTEGRATION_TESTS === "1";
const suite = integrationEnabled ? describe : describe.skip;
const PNG_BYTES = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));

function suffix(): string { return `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9); }
async function json(response: Response): Promise<Record<string, any>> { return (await response.json()) as Record<string, any>; }
function uploadForm(file: File): FormData { const form = new FormData(); form.append("file", file); return form; }

suite("Photo review workflow PostgreSQL integration", () => {
  const { db, client } = createDatabase(loadEnv());
  const auth = createAuthService(db);
  const usersService = createUsersService(db);
  const storesService = createStoresService(db);
  const id = suffix();
  const root = join(tmpdir(), `vizaje-photo-review-${id}`);
  const storage = new LocalPhotoStorage(root);
  const service = createPhotosService(db, storage, { maxBytes: 10 * 1024 * 1024, maxDimension: 8192, maxPixels: 25_000_000 }, noopLogger);
  let adminId: string;
  let managerId: string;
  let staffId: string;
  let otherStaffId: string;
  let storeId: string;
  let otherStoreId: string;
  let adminToken: string;
  let managerToken: string;
  let staffToken: string;
  let otherStaffToken: string;
  let app: ReturnType<typeof createApp>;
  const reportIds: string[] = [];

  beforeAll(async () => {
    const [admin] = await db.insert(users).values({ firstName: "Review", lastName: "Admin", email: `review-admin-${id}@example.com`, role: "admin", isActive: true }).returning({ id: users.id });
    adminId = admin.id;
    const adminPrincipal = { userId: adminId, role: "admin" as const, storeIds: [] as string[], isActive: true };
    storeId = (await storesService.createStore(adminPrincipal, { name: `Review Store ${id}`, code: `REVIEW-${id}` })).id;
    otherStoreId = (await storesService.createStore(adminPrincipal, { name: `Other Review Store ${id}`, code: `REVIEW-OTHER-${id}` })).id;
    managerId = (await usersService.createUser(adminPrincipal, { firstName: "Review", lastName: "Manager", phone: `+37369${id}`, email: `review-manager-${id}@example.com`, role: "manager", isActive: true, storeIds: [storeId] })).id;
    staffId = (await usersService.createUser(adminPrincipal, { firstName: "Review", lastName: "Staff", phone: `+37368${id}`, email: null, role: "staff", isActive: true, storeIds: [storeId] })).id;
    otherStaffId = (await usersService.createUser(adminPrincipal, { firstName: "Other", lastName: "Staff", phone: `+37367${id}`, email: null, role: "staff", isActive: true, storeIds: [otherStoreId] })).id;
    adminToken = (await auth.sessions.create(adminId, "mobile", { deviceId: `review-admin-${id}` })).token;
    managerToken = (await auth.sessions.create(managerId, "mobile", { deviceId: `review-manager-${id}` })).token;
    staffToken = (await auth.sessions.create(staffId, "mobile", { deviceId: `review-staff-${id}` })).token;
    otherStaffToken = (await auth.sessions.create(otherStaffId, "mobile", { deviceId: `review-other-${id}` })).token;
    app = createApp({ db, allowedOrigins: [], resolvePrincipal: auth.principalResolver(), photoRoutes: { photos: service, resolvePrincipal: auth.principalResolver(), maxUploadBytes: 1024 * 1024 }, logger: noopLogger });
  });

  afterAll(async () => {
    if (reportIds.length) {
      await db.delete(domainEvents).where(inArray(domainEvents.aggregateId, reportIds));
      await db.delete(photoReviewHistory).where(inArray(photoReviewHistory.reportId, reportIds));
      await db.delete(photoReportVersions).where(inArray(photoReportVersions.reportId, reportIds));
      await db.delete(photoReports).where(inArray(photoReports.id, reportIds));
    }
    if (storeId && otherStoreId) await db.delete(photos).where(inArray(photos.storeId, [storeId, otherStoreId]));
    if (managerId && staffId && otherStaffId) await db.delete(users).where(inArray(users.id, [managerId, staffId, otherStaffId]));
    if (adminId) await db.delete(users).where(eq(users.id, adminId));
    if (storeId && otherStoreId) await db.delete(userStores).where(inArray(userStores.storeId, [storeId, otherStoreId]));
    if (storeId && otherStoreId) await db.delete(stores).where(inArray(stores.id, [storeId, otherStoreId]));
    await rm(root, { recursive: true, force: true });
    await client.end();
  });

  test("creates pending report and allows only scoped reviewers to transition it", async () => {
    const upload = await app.request(`/api/v1/stores/${storeId}/photos`, { method: "POST", headers: { Authorization: `Bearer ${staffToken}`, "Idempotency-Key": `review-pending-${id}` }, body: uploadForm(new File([PNG_BYTES], "pending.png", { type: "image/png" })) });
    expect(upload.status).toBe(201);
    const photo = await json(upload);
    const mine = await app.request(`/api/v1/me/photo-reports?storeId=${storeId}`, { headers: { Authorization: `Bearer ${staffToken}` } });
    expect(mine.status).toBe(200);
    const report = (await json(mine)).data[0];
    reportIds.push(report.id);
    expect(report.currentVersion.status).toBe("pending");
    expect(report.currentVersion.photo.id).toBe(photo.id);
    const staffReject = await app.request(`/api/v1/photo-reports/${report.id}/reject`, { method: "POST", headers: { Authorization: `Bearer ${staffToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ comment: "no" }) });
    expect(staffReject.status).toBe(403);
    const checked = await app.request(`/api/v1/photo-reports/${report.id}/check`, { method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json", "Idempotency-Key": `review-check-${id}` }, body: JSON.stringify({ comment: "Подходит" }) });
    expect(checked.status).toBe(200);
    expect((await json(checked)).currentVersion.status).toBe("checked");
    const repeated = await app.request(`/api/v1/photo-reports/${report.id}/check`, { method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json", "Idempotency-Key": `review-check-${id}` }, body: JSON.stringify({ comment: "Повтор запроса" }) });
    expect(repeated.status).toBe(200);
    const stale = await app.request(`/api/v1/photo-reports/${report.id}/reject`, { method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ comment: "Повторная проверка" }) });
    expect(stale.status).toBe(409);
  });

  test("rejects, resubmits as a new version and records safe events", async () => {
    const upload = await app.request(`/api/v1/stores/${storeId}/photos`, { method: "POST", headers: { Authorization: `Bearer ${staffToken}`, "Idempotency-Key": `review-rejected-${id}` }, body: uploadForm(new File([PNG_BYTES], "rejected.png", { type: "image/png" })) });
    expect(upload.status).toBe(201);
    const reports = await app.request(`/api/v1/me/photo-reports?storeId=${storeId}`, { headers: { Authorization: `Bearer ${staffToken}` } });
    const report = (await json(reports)).data.find((item: { currentVersion: { photo: { originalFilename: string } } }) => item.currentVersion.photo.originalFilename === "rejected.png");
    reportIds.push(report.id);
    const rejected = await app.request(`/api/v1/photo-reports/${report.id}/reject`, { method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ comment: "Нужен более общий план" }) });
    expect(rejected.status).toBe(200);
    const resubmit = await app.request(`/api/v1/photo-reports/${report.id}/resubmit`, { method: "POST", headers: { Authorization: `Bearer ${staffToken}`, "Idempotency-Key": `review-resubmit-${id}` }, body: uploadForm(new File([PNG_BYTES], "corrected.png", { type: "image/png" })) });
    expect(resubmit.status).toBe(201);
    const payload = await json(resubmit);
    expect(payload.created).toBe(true);
    expect(payload.report.currentVersion.status).toBe("pending");
    expect(payload.report.versionCount).toBe(2);
    expect(payload.report.currentVersion.photo.originalFilename).toBe("corrected.png");
    const history = await app.request(`/api/v1/photo-reports/${report.id}/history`, { headers: { Authorization: `Bearer ${managerToken}` } });
    expect((await json(history)).data.map((entry: { toStatus: string }) => entry.toStatus)).toEqual(["pending", "rejected", "pending"]);
    const events = await db.select({ eventType: domainEvents.eventType, payload: domainEvents.payload }).from(domainEvents).where(eq(domainEvents.aggregateId, report.id));
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["photo.submitted", "photo.rejected", "photo.resubmitted"]));
    expect(JSON.stringify(events)).not.toContain("storageKey");
  });

  test("enforces manager store scope for review reports", async () => {
    const upload = await app.request(`/api/v1/stores/${otherStoreId}/photos`, { method: "POST", headers: { Authorization: `Bearer ${otherStaffToken}`, "Idempotency-Key": `review-other-${id}` }, body: uploadForm(new File([PNG_BYTES], "other.png", { type: "image/png" })) });
    expect(upload.status).toBe(201);
    const reports = await app.request(`/api/v1/me/photo-reports?storeId=${otherStoreId}`, { headers: { Authorization: `Bearer ${otherStaffToken}` } });
    const report = (await json(reports)).data[0];
    reportIds.push(report.id);
    const denied = await app.request(`/api/v1/photo-reports/${report.id}/check`, { method: "POST", headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({}) });
    expect(denied.status).toBe(403);
    const adminList = await app.request(`/api/v1/photo-reports?storeId=${otherStoreId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(adminList.status).toBe(200);
  });
});

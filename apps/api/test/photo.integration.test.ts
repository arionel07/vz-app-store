import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createApp } from "../src/app";
import { createAuthService } from "../src/auth/service";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import { photos, stores, userStores, users } from "../src/db/schema";
import type { TrustedPrincipal } from "../src/domain/authz";
import { createPhotosService } from "../src/domain/photos/service";
import { createStoresService } from "../src/domain/stores/service";
import { createUsersService } from "../src/domain/users/service";
import { noopLogger } from "../src/lib/logger";
import { LocalPhotoStorage, type PhotoStorage } from "../src/storage/photo-storage";

const integrationEnabled = Bun.env.RUN_INTEGRATION_TESTS === "1";
const suite = integrationEnabled ? describe : describe.skip;
const PNG_BYTES = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));

function suffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9);
}

async function json(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

function uploadForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

class FailingDeleteStorage implements PhotoStorage {
  constructor(private readonly delegate: LocalPhotoStorage) {}

  put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    return this.delegate.put(key, data, contentType);
  }

  get(key: string): Promise<Uint8Array | null> {
    return this.delegate.get(key);
  }

  async delete(): Promise<void> {
    throw new Error("simulated storage delete failure");
  }
}

suite("Photo uploads PostgreSQL integration", () => {
  const { db, client } = createDatabase(loadEnv());
  const storesService = createStoresService(db);
  const usersService = createUsersService(db);
  const auth = createAuthService(db);
  const id = suffix();
  const root = join(tmpdir(), `vizaje-photo-integration-${id}`);
  const storage = new LocalPhotoStorage(root);
  const photosService = createPhotosService(db, storage, {
    maxBytes: 10 * 1024 * 1024,
    maxDimension: 8192,
    maxPixels: 25_000_000,
  }, noopLogger);

  let adminId: string;
  let managerId: string;
  let staffAId: string;
  let staffBId: string;
  let storeAId: string;
  let storeBId: string;
  let adminToken: string;
  let managerToken: string;
  let staffAToken: string;
  let staffBToken: string;
  let photoId: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const [admin] = await db.insert(users).values({
      firstName: "Photo",
      lastName: "Admin",
      email: `photo-admin-${id}@example.com`,
      phone: null,
      role: "admin",
      isActive: true,
    }).returning({ id: users.id });
    adminId = admin.id;
    const adminPrincipal: TrustedPrincipal = { userId: adminId, role: "admin", storeIds: [], isActive: true };
    const storeA = await storesService.createStore(adminPrincipal, { name: `Photo Store A ${id}`, code: `PHOTO-A-${id}` });
    const storeB = await storesService.createStore(adminPrincipal, { name: `Photo Store B ${id}`, code: `PHOTO-B-${id}` });
    storeAId = storeA.id;
    storeBId = storeB.id;

    const manager = await usersService.createUser(adminPrincipal, {
      firstName: "Photo",
      lastName: "Manager",
      phone: `+37369${id}`,
      email: `photo-manager-${id}@example.com`,
      role: "manager",
      isActive: true,
      storeIds: [storeAId],
    });
    const staffA = await usersService.createUser(adminPrincipal, {
      firstName: "Photo",
      lastName: "Staff A",
      phone: `+37368${id}`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeAId],
    });
    const staffB = await usersService.createUser(adminPrincipal, {
      firstName: "Photo",
      lastName: "Staff B",
      phone: `+37367${id}`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeBId],
    });
    managerId = manager.id;
    staffAId = staffA.id;
    staffBId = staffB.id;

    adminToken = (await auth.sessions.create(adminId, "mobile", { deviceId: `photo-admin-${id}` })).token;
    managerToken = (await auth.sessions.create(managerId, "mobile", { deviceId: `photo-manager-${id}` })).token;
    staffAToken = (await auth.sessions.create(staffAId, "mobile", { deviceId: `photo-staff-a-${id}` })).token;
    staffBToken = (await auth.sessions.create(staffBId, "mobile", { deviceId: `photo-staff-b-${id}` })).token;

    app = createApp({
      db,
      allowedOrigins: [],
      resolvePrincipal: auth.principalResolver(),
      photoRoutes: {
        photos: photosService,
        resolvePrincipal: auth.principalResolver(),
        maxUploadBytes: 1024,
      },
      logger: noopLogger,
    });
  });

  afterAll(async () => {
    if (storeAId && storeBId) await db.delete(photos).where(inArray(photos.storeId, [storeAId, storeBId]));
    if (managerId && staffAId && staffBId) await db.delete(users).where(inArray(users.id, [managerId, staffAId, staffBId]));
    if (adminId) await db.delete(users).where(eq(users.id, adminId));
    if (storeAId && storeBId) await db.delete(stores).where(inArray(stores.id, [storeAId, storeBId]));
    await rm(root, { recursive: true, force: true });
    await client.end();
  });

  test("requires authentication and records staff identity on upload", async () => {
    const unauthenticated = await app.request(`http://localhost/api/v1/stores/${crypto.randomUUID()}/photos`, { method: "POST" });
    expect(unauthenticated.status).toBe(401);

    const response = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Idempotency-Key": `photo-${id}` },
      body: uploadForm(new File([PNG_BYTES], "display.png", { type: "image/png" })),
    });
    expect(response.status).toBe(201);
    const photo = await json(response);
    photoId = photo.id;
    expect(photo.storeId).toBe(storeAId);
    expect(photo.uploadedBy).toBe(staffAId);
    expect(photo.mimeType).toBe("image/png");
    expect(photo.fileSize).toBeGreaterThan(0);
    expect(photo.storageKey).toBeUndefined();

    const retry = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Idempotency-Key": `photo-${id}` },
      body: uploadForm(new File([PNG_BYTES], "display.png", { type: "image/png" })),
    });
    expect(retry.status).toBe(200);
    expect((await json(retry)).id).toBe(photoId);

    const conflictingRetry = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Idempotency-Key": `photo-${id}` },
      body: uploadForm(new File([PNG_BYTES], "different-name.png", { type: "image/png" })),
    });
    expect(conflictingRetry.status).toBe(409);

    const concurrent = await Promise.all([
      app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${staffAToken}`, "Idempotency-Key": `concurrent-${id}` },
        body: uploadForm(new File([PNG_BYTES], "concurrent.png", { type: "image/png" })),
      }),
      app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${staffAToken}`, "Idempotency-Key": `concurrent-${id}` },
        body: uploadForm(new File([PNG_BYTES], "concurrent.png", { type: "image/png" })),
      }),
    ]);
    expect(concurrent.map((result) => result.status).sort()).toEqual([200, 201]);
    const concurrentIds = await Promise.all(concurrent.map(async (result) => (await json(result)).id));
    expect(new Set(concurrentIds).size).toBe(1);
    const deleteConcurrent = await app.request(`/api/v1/photos/${concurrentIds[0]}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(deleteConcurrent.status).toBe(204);

    const failedRetry = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Idempotency-Key": `failed-${id}` },
      body: uploadForm(new File([Uint8Array.from([1, 2, 3])], "failed.png", { type: "image/png" })),
    });
    expect(failedRetry.status).toBe(415);
    const successfulRetry = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Idempotency-Key": `failed-${id}` },
      body: uploadForm(new File([PNG_BYTES], "failed.png", { type: "image/png" })),
    });
    expect(successfulRetry.status).toBe(201);
    const failedRetryPhoto = await json(successfulRetry);
    const deleteFailedRetry = await app.request(`/api/v1/photos/${failedRetryPhoto.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(deleteFailedRetry.status).toBe(204);
  });

  test("enforces upload scope and validates image content and size", async () => {
    const crossStore = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffBToken}` },
      body: uploadForm(new File([PNG_BYTES], "display.png", { type: "image/png" })),
    });
    expect(crossStore.status).toBe(403);

    const managerUpload = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}` },
      body: uploadForm(new File([PNG_BYTES], "display.png", { type: "image/png" })),
    });
    expect(managerUpload.status).toBe(403);

    const badSignature = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}` },
      body: uploadForm(new File([Uint8Array.from([1, 2, 3])], "display.png", { type: "image/png" })),
    });
    expect(badSignature.status).toBe(415);

    const mismatchedType = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}` },
      body: uploadForm(new File([PNG_BYTES], "display.jpg", { type: "image/jpeg" })),
    });
    expect(mismatchedType.status).toBe(415);

    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    oversized.set(PNG_BYTES);
    const tooLarge = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}` },
      body: uploadForm(new File([oversized], "large.png", { type: "image/png" })),
    });
    expect(tooLarge.status).toBe(413);

    const tooWide = new Uint8Array(await sharp({
      create: { width: 9000, height: 1, channels: 3, background: "white" },
    }).png().toBuffer());
    await expect(photosService.upload(
      { userId: staffAId, role: "staff", storeIds: [storeAId], isActive: true },
      storeAId,
      new File([tooWide], "too-wide.png", { type: "image/png" }),
    )).rejects.toMatchObject({ code: "PHOTO_DIMENSIONS_TOO_LARGE", status: 413 });

    const tooManyPixels = new Uint8Array(await sharp({
      create: { width: 5001, height: 5000, channels: 3, background: "white" },
    }).png().toBuffer());
    await expect(photosService.upload(
      { userId: staffAId, role: "staff", storeIds: [storeAId], isActive: true },
      storeAId,
      new File([tooManyPixels], "too-many-pixels.png", { type: "image/png" }),
    )).rejects.toMatchObject({ code: "PHOTO_DIMENSIONS_TOO_LARGE", status: 413 });

    const withExif = new Uint8Array(await sharp({
      create: { width: 2, height: 1, channels: 3, background: "red" },
    }).withMetadata({ orientation: 6 }).jpeg().toBuffer());
    const normalized = await photosService.upload(
      { userId: staffAId, role: "staff", storeIds: [storeAId], isActive: true },
      storeAId,
      new File([withExif], "with-exif.jpg", { type: "image/jpeg" }),
    );
    const normalizedDownload = await photosService.get(
      { userId: staffAId, role: "staff", storeIds: [storeAId], isActive: true },
      normalized.photo.id,
    );
    const normalizedMetadata = await sharp(normalizedDownload.body).metadata();
    expect(normalizedMetadata.exif).toBeUndefined();
    await photosService.deletePhoto({ userId: adminId, role: "admin", storeIds: [], isActive: true }, normalized.photo.id);

    for (const [mimeType, extension] of [["image/jpeg", "jpg"], ["image/webp", "webp"]] as const) {
      const image = sharp({
        create: { width: 2, height: 2, channels: 3, background: "blue" },
      });
      const encoded = new Uint8Array(await (extension === "jpg" ? image.jpeg() : image.webp()).toBuffer());
      const preserved = await photosService.upload(
        { userId: staffAId, role: "staff", storeIds: [storeAId], isActive: true },
        storeAId,
        new File([encoded], `preserved.${extension}`, { type: mimeType }),
      );
      expect(preserved.photo.mimeType).toBe(mimeType);
      await photosService.deletePhoto({ userId: adminId, role: "admin", storeIds: [], isActive: true }, preserved.photo.id);
    }
  });

  test("enforces read scope, returns private bytes, and supports admin all-store listing", async () => {
    const staffList = await app.request(`/api/v1/stores/${storeAId}/photos`, { headers: { Authorization: `Bearer ${staffAToken}` } });
    expect(staffList.status).toBe(200);
    expect((await json(staffList)).data).toHaveLength(1);

    const managerList = await app.request(`/api/v1/stores/${storeAId}/photos`, { headers: { Authorization: `Bearer ${managerToken}` } });
    expect(managerList.status).toBe(200);
    expect((await json(managerList)).data[0].uploadedBy).toBe(staffAId);

    const managerAll = await app.request("/api/v1/photos", { headers: { Authorization: `Bearer ${managerToken}` } });
    expect(managerAll.status).toBe(400);

    const adminAll = await app.request("/api/v1/photos", { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(adminAll.status).toBe(200);
    expect((await json(adminAll)).data).toHaveLength(1);

    const photoPeriodStart = new Date(Date.now() - 60_000).toISOString();
    const photoPeriodEnd = new Date(Date.now() + 60_000).toISOString();
    const filtered = await app.request(`/api/v1/photos?uploadedBy=${staffAId}&startDate=${encodeURIComponent(photoPeriodStart)}&endDate=${encodeURIComponent(photoPeriodEnd)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(filtered.status).toBe(200);
    expect((await json(filtered)).data.map((photo: { id: string }) => photo.id)).toContain(photoId);

    const invalidRange = await app.request(`/api/v1/photos?startDate=${encodeURIComponent(photoPeriodEnd)}&endDate=${encodeURIComponent(photoPeriodStart)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(invalidRange.status).toBe(400);

    const otherStoreList = await app.request(`/api/v1/stores/${storeAId}/photos`, { headers: { Authorization: `Bearer ${staffBToken}` } });
    expect(otherStoreList.status).toBe(403);

    const download = await app.request(`/api/v1/photos/${photoId}`, { headers: { Authorization: `Bearer ${staffAToken}` } });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("image/png");
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    const downloadedMetadata = await sharp(new Uint8Array(await download.arrayBuffer())).metadata();
    expect(downloadedMetadata.width).toBe(1);
    expect(downloadedMetadata.height).toBe(1);

    const crossStoreDownload = await app.request(`/api/v1/photos/${photoId}`, { headers: { Authorization: `Bearer ${staffBToken}` } });
    expect(crossStoreDownload.status).toBe(404);
  });

  test("allows only admins to delete and makes deletion idempotent", async () => {
    const [stored] = await db.select({ storageKey: photos.storageKey }).from(photos).where(eq(photos.id, photoId)).limit(1);
    expect(stored).toBeDefined();

    const staffDelete = await app.request(`/api/v1/photos/${photoId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${staffAToken}` },
    });
    expect(staffDelete.status).toBe(403);
    const managerDelete = await app.request(`/api/v1/photos/${photoId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(managerDelete.status).toBe(403);

    const adminDelete = await app.request(`/api/v1/photos/${photoId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminDelete.status).toBe(204);
    expect(await storage.get(stored.storageKey)).toBeNull();

    const repeatedDelete = await app.request(`/api/v1/photos/${photoId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(repeatedDelete.status).toBe(204);

    const partialUpload = await app.request(`http://localhost/api/v1/stores/${storeAId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${staffAToken}`, "Idempotency-Key": `partial-${id}` },
      body: uploadForm(new File([PNG_BYTES], "partial.png", { type: "image/png" })),
    });
    expect(partialUpload.status).toBe(201);
    const partialPhoto = await json(partialUpload);
    const failingService = createPhotosService(db, new FailingDeleteStorage(storage), {
      maxBytes: 10 * 1024 * 1024,
      maxDimension: 8192,
      maxPixels: 25_000_000,
    }, noopLogger);
    await expect(failingService.deletePhoto({ userId: adminId, role: "admin", storeIds: [], isActive: true }, partialPhoto.id))
      .rejects.toMatchObject({ status: 503, code: "PHOTO_STORAGE_UNAVAILABLE" });
    expect((await db.select({ id: photos.id }).from(photos).where(eq(photos.id, partialPhoto.id))).length).toBe(1);
    await photosService.deletePhoto({ userId: adminId, role: "admin", storeIds: [], isActive: true }, partialPhoto.id);
  });

  test("hides photos from non-admins when the store becomes inactive", async () => {
    await db.update(stores).set({ isActive: false }).where(eq(stores.id, storeAId));
    const staffList = await app.request(`/api/v1/stores/${storeAId}/photos`, { headers: { Authorization: `Bearer ${staffAToken}` } });
    expect(staffList.status).toBe(403);
    const managerList = await app.request(`/api/v1/stores/${storeAId}/photos`, { headers: { Authorization: `Bearer ${managerToken}` } });
    expect(managerList.status).toBe(403);
    const adminList = await app.request(`/api/v1/stores/${storeAId}/photos`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(adminList.status).toBe(200);
    await db.update(stores).set({ isActive: true }).where(eq(stores.id, storeAId));

    await db.delete(userStores).where(eq(userStores.userId, staffAId));
    const revokedMembership = await app.request(`/api/v1/stores/${storeAId}/photos`, { headers: { Authorization: `Bearer ${staffAToken}` } });
    expect(revokedMembership.status).toBe(403);
    await db.insert(userStores).values({ userId: staffAId, storeId: storeAId });

    await db.update(users).set({ isActive: false }).where(eq(users.id, staffAId));
    const revokedAccount = await app.request(`/api/v1/stores/${storeAId}/photos`, { headers: { Authorization: `Bearer ${staffAToken}` } });
    expect([401, 403]).toContain(revokedAccount.status);
    await db.update(users).set({ isActive: true }).where(eq(users.id, staffAId));
  });
});

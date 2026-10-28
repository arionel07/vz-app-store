import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import {
  photoCollectionQuerySchema,
  photoIdempotencyKeySchema,
  type PhotoCollectionQuery,
  type PhotoResponse,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import { photos, stores, userStores } from "../../db/schema";
import { assertActivePrincipal, type TrustedPrincipal } from "../authz";
import { DomainError, isUniqueViolation } from "../errors";
import { detectPhotoType, normalizePhotoImage, type PhotoProcessingLimits, PhotoImageError } from "./image-processing";
import type { Logger } from "../../lib/logger";
import type { PhotoStorage } from "../../storage/photo-storage";

export interface PhotoDownload {
  photo: PhotoResponse;
  body: Uint8Array;
}

export interface PhotoUploadResult {
  photo: PhotoResponse;
  created: boolean;
}

function sanitizeFilename(filename: string): string {
  const basename = filename.replace(/\\/g, "/").split("/").pop() ?? "photo";
  const cleaned = basename.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return Array.from(cleaned || "photo").slice(0, 255).join("");
}

function toPhotoResponse(photo: typeof photos.$inferSelect): PhotoResponse {
  return {
    id: photo.id,
    storeId: photo.storeId,
    uploadedBy: photo.uploadedBy,
    originalFilename: photo.originalFilename,
    mimeType: photo.mimeType as PhotoResponse["mimeType"],
    fileSize: photo.fileSize,
    createdAt: photo.createdAt.toISOString(),
  };
}

export class PhotosService {
  constructor(
    private readonly db: Database,
    private readonly storage: PhotoStorage,
    private readonly limits: PhotoProcessingLimits,
    private readonly logger?: Logger,
  ) {}

  private async payloadHash(storeId: string, mimeType: string, filename: string, body: Uint8Array): Promise<string> {
    const prefix = new TextEncoder().encode(`${storeId}\u0000${mimeType}\u0000${filename}\u0000`);
    const payload = new Uint8Array(prefix.byteLength + body.byteLength);
    payload.set(prefix);
    payload.set(body, prefix.byteLength);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  private async existingIdempotent(principal: TrustedPrincipal, storeId: string, key: string, hash: string): Promise<PhotoUploadResult | null> {
    const [existing] = await this.db
      .select()
      .from(photos)
      .where(and(eq(photos.uploadedBy, principal.userId), eq(photos.idempotencyKey, key)))
      .limit(1);
    if (!existing) return null;
    if (existing.storeId !== storeId || existing.idempotencyPayloadHash !== hash) {
      throw new DomainError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different upload");
    }
    return { photo: toPhotoResponse(existing), created: false };
  }

  private async assertStoreReadable(principal: TrustedPrincipal, storeId: string): Promise<void> {
    assertActivePrincipal(principal);
    const [store] = await this.db.select({ id: stores.id, isActive: stores.isActive }).from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!store) throw new DomainError(404, "STORE_NOT_FOUND", "Store not found");
    if (principal.role === "admin") return;
    if (!store.isActive || !principal.storeIds.includes(storeId)) {
      throw new DomainError(403, "STORE_FORBIDDEN", "The store is outside the principal scope");
    }
    const [membership] = await this.db
      .select({ userId: userStores.userId })
      .from(userStores)
      .where(and(eq(userStores.userId, principal.userId), eq(userStores.storeId, storeId)))
      .limit(1);
    if (!membership) throw new DomainError(403, "STORE_FORBIDDEN", "The store is outside the principal scope");
  }

  private async assertCanUpload(principal: TrustedPrincipal, storeId: string): Promise<void> {
    await this.assertStoreReadable(principal, storeId);
    if (principal.role !== "staff") throw new DomainError(403, "FORBIDDEN", "Only staff users can upload photos");
  }

  private async listRows(whereClause: SQL | undefined, query: PhotoCollectionQuery) {
    const filters: SQL[] = [];
    if (whereClause) filters.push(whereClause);
    if (query.uploadedBy) filters.push(eq(photos.uploadedBy, query.uploadedBy));
    if (query.startDate) filters.push(gte(photos.createdAt, new Date(query.startDate)));
    if (query.endDate) filters.push(lt(photos.createdAt, new Date(query.endDate)));
    const combinedWhere = filters.length > 0 ? and(...filters) : undefined;
    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)` })
      .from(photos)
      .where(combinedWhere);
    const rows = await this.db
      .select()
      .from(photos)
      .where(combinedWhere)
      .orderBy(desc(photos.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return {
      data: rows.map(toPhotoResponse),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / query.pageSize),
      },
    };
  }

  async upload(principal: TrustedPrincipal, storeId: string, file: File, requestedIdempotencyKey?: string): Promise<PhotoUploadResult> {
    await this.assertCanUpload(principal, storeId);
    const idempotencyKey = requestedIdempotencyKey ? photoIdempotencyKeySchema.parse(requestedIdempotencyKey) : undefined;
    if (file.size <= 0) throw new DomainError(400, "EMPTY_PHOTO", "Photo file is empty");
    if (file.size > this.limits.maxBytes) throw new DomainError(413, "PHOTO_TOO_LARGE", "Photo exceeds the maximum allowed size");

    const input = new Uint8Array(await file.arrayBuffer());
    const signature = detectPhotoType(input);
    if (!signature || (file.type && file.type !== signature.mimeType)) {
      throw new DomainError(415, "UNSUPPORTED_PHOTO", "Only valid JPEG, PNG, and WebP images are supported");
    }
    const filename = sanitizeFilename(file.name);
    let body: Uint8Array;
    try {
      body = await normalizePhotoImage(input, signature, this.limits);
    } catch (error) {
      if (error instanceof PhotoImageError) {
        const status = error.code === "INVALID_IMAGE" ? 415 : 413;
        throw new DomainError(status, error.code, error.message);
      }
      throw error;
    }
    const hash = idempotencyKey ? await this.payloadHash(storeId, signature.mimeType, filename, input) : undefined;
    if (idempotencyKey && hash) {
      const existing = await this.existingIdempotent(principal, storeId, idempotencyKey, hash);
      if (existing) return existing;
    }

    const storageKey = `photos/${crypto.randomUUID()}.${signature.extension}`;
    try {
      await this.storage.put(storageKey, body, signature.mimeType);
    } catch (error) {
      this.logger?.error("Photo storage write failed", { error });
      throw new DomainError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is unavailable");
    }

    try {
      const [photo] = await this.db
        .insert(photos)
        .values({
          storeId,
          uploadedBy: principal.userId,
          storageKey,
          idempotencyKey: idempotencyKey ?? null,
          idempotencyPayloadHash: hash ?? null,
          originalFilename: filename,
          mimeType: signature.mimeType,
          fileSize: body.byteLength,
        })
        .returning();
      return { photo: toPhotoResponse(photo), created: true };
    } catch (error) {
      if (idempotencyKey && hash && isUniqueViolation(error)) {
        try {
          await this.storage.delete(storageKey);
        } catch (cleanupError) {
          this.logger?.error("Orphaned photo cleanup failed", { cleanupError, storageKey });
        }
        const existing = await this.existingIdempotent(principal, storeId, idempotencyKey, hash);
        if (existing) return existing;
      }
      if (!(idempotencyKey && hash && isUniqueViolation(error))) {
        try {
          await this.storage.delete(storageKey);
        } catch (cleanupError) {
          this.logger?.error("Orphaned photo cleanup failed", { cleanupError, storageKey });
        }
      }
      throw error;
    }
  }

  async deletePhoto(principal: TrustedPrincipal, photoId: string): Promise<void> {
    assertActivePrincipal(principal);
    if (principal.role !== "admin") throw new DomainError(403, "FORBIDDEN", "Only administrators can delete photos");
    const [photo] = await this.db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
    if (!photo) return;

    try {
      await this.storage.delete(photo.storageKey);
    } catch (error) {
      this.logger?.error("Photo storage delete failed", { error, photoId });
      throw new DomainError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is unavailable");
    }

    try {
      await this.db.delete(photos).where(eq(photos.id, photoId));
    } catch (error) {
      this.logger?.error("Photo metadata delete failed after object deletion", { error, photoId });
      throw error;
    }
  }

  async listByStore(principal: TrustedPrincipal, storeId: string, query: PhotoCollectionQuery): Promise<ReturnType<PhotosService["listRows"]>> {
    await this.assertStoreReadable(principal, storeId);
    return this.listRows(eq(photos.storeId, storeId), query);
  }

  async list(principal: TrustedPrincipal, query: PhotoCollectionQuery) {
    assertActivePrincipal(principal);
    const data = photoCollectionQuerySchema.parse(query);
    if (data.storeId) return this.listByStore(principal, data.storeId, data);
    if (principal.role !== "admin") throw new DomainError(400, "STORE_REQUIRED", "storeId is required for this principal");
    return this.listRows(undefined, data);
  }

  async get(principal: TrustedPrincipal, photoId: string): Promise<PhotoDownload> {
    assertActivePrincipal(principal);
    const [photo] = await this.db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
    if (!photo) throw new DomainError(404, "PHOTO_NOT_FOUND", "Photo not found");
    try {
      await this.assertStoreReadable(principal, photo.storeId);
    } catch (error) {
      if (error instanceof DomainError && error.status === 403) throw new DomainError(404, "PHOTO_NOT_FOUND", "Photo not found");
      throw error;
    }

    let body: Uint8Array | null;
    try {
      body = await this.storage.get(photo.storageKey);
    } catch (error) {
      this.logger?.error("Photo storage read failed", { error, photoId });
      throw new DomainError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is unavailable");
    }
    if (!body) {
      this.logger?.error("Photo object is missing", { photoId });
      throw new DomainError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is unavailable");
    }
    return { photo: toPhotoResponse(photo), body };
  }
}

export function createPhotosService(db: Database, storage: PhotoStorage, limits: PhotoProcessingLimits, logger?: Logger): PhotosService {
  return new PhotosService(db, storage, limits, logger);
}

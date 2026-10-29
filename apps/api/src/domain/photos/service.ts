import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import {
  photoCollectionQuerySchema,
  photoIdempotencyKeySchema,
  photoReviewCollectionQuerySchema,
  photoReviewMineQuerySchema,
  type PhotoReportDetailResponse,
  type PhotoReportListResponse,
  type PhotoReportResponse,
  type PhotoReviewHistoryEntry,
  type PhotoReviewStatus,
  type PhotoCollectionQuery,
  type PhotoResponse,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import { domainEvents, photoReports, photoReportVersions, photoReviewHistory, photos, stores, userStores } from "../../db/schema";
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

export interface PhotoReviewServiceResult {
  report: PhotoReportResponse;
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

function toVersionResponse(version: typeof photoReportVersions.$inferSelect, photo: typeof photos.$inferSelect) {
  return {
    id: version.id,
    reportId: version.reportId,
    photo: toPhotoResponse(photo),
    versionNumber: version.versionNumber,
    status: version.status as PhotoReviewStatus,
    rejectionComment: version.rejectionComment,
    submittedAt: version.submittedAt.toISOString(),
    reviewedAt: version.reviewedAt?.toISOString() ?? null,
    reviewedBy: version.reviewedBy,
  };
}

function toReportResponse(
  report: typeof photoReports.$inferSelect,
  version: typeof photoReportVersions.$inferSelect,
  photo: typeof photos.$inferSelect,
  versionCount: number,
): PhotoReportResponse {
  return {
    id: report.id,
    storeId: report.storeId,
    submittedBy: report.submittedBy,
    currentVersion: toVersionResponse(version, photo),
    versionCount,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

function toReportDetailResponse(rows: Array<{ report: typeof photoReports.$inferSelect; version: typeof photoReportVersions.$inferSelect; photo: typeof photos.$inferSelect }>): PhotoReportDetailResponse {
  const first = rows[0];
  return {
    ...toReportResponse(first.report, first.version, first.photo, rows.length),
    versions: rows.map((row) => toVersionResponse(row.version, row.photo)),
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
      const photo = await this.db.transaction(async (tx) => {
        const [createdPhoto] = await tx
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
        const [report] = await tx.insert(photoReports).values({ storeId, submittedBy: principal.userId }).returning();
        const [version] = await tx.insert(photoReportVersions).values({
          reportId: report.id,
          photoId: createdPhoto.id,
          versionNumber: 1,
          status: "pending",
          submittedAt: createdPhoto.createdAt,
        }).returning();
        await tx.insert(photoReviewHistory).values({
          reportId: report.id,
          versionId: version.id,
          actorId: principal.userId,
          fromStatus: null,
          toStatus: "pending",
          idempotencyKey: idempotencyKey ?? null,
        });
        await tx.insert(domainEvents).values({
          eventType: "photo.submitted",
          aggregateType: "photo_report",
          aggregateId: report.id,
          actorId: principal.userId,
          payload: { reportId: report.id, versionId: version.id, photoId: createdPhoto.id, storeId, submittedBy: principal.userId },
        });
        return createdPhoto;
      });
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

  /** Stores a private quiz answer image without creating a photo-report review item. */
  async uploadQuizAnswer(principal: TrustedPrincipal, storeId: string, file: File, requestedIdempotencyKey?: string): Promise<PhotoUploadResult> {
    await this.assertCanUpload(principal, storeId);
    const idempotencyKey = requestedIdempotencyKey ? photoIdempotencyKeySchema.parse(requestedIdempotencyKey) : undefined;
    if (file.size <= 0) throw new DomainError(400, "EMPTY_PHOTO", "Photo file is empty");
    if (file.size > this.limits.maxBytes) throw new DomainError(413, "PHOTO_TOO_LARGE", "Photo exceeds the maximum allowed size");
    const input = new Uint8Array(await file.arrayBuffer());
    const signature = detectPhotoType(input);
    if (!signature || (file.type && file.type !== signature.mimeType)) throw new DomainError(415, "UNSUPPORTED_PHOTO", "Only valid JPEG, PNG, and WebP images are supported");
    const filename = sanitizeFilename(file.name);
    let body: Uint8Array;
    try {
      body = await normalizePhotoImage(input, signature, this.limits);
    } catch (error) {
      if (error instanceof PhotoImageError) throw new DomainError(error.code === "INVALID_IMAGE" ? 415 : 413, error.code, error.message);
      throw error;
    }
    const hash = idempotencyKey ? await this.payloadHash(storeId, signature.mimeType, filename, input) : undefined;
    if (idempotencyKey && hash) {
      const existing = await this.existingIdempotent(principal, storeId, idempotencyKey, hash);
      if (existing) return existing;
    }
    const storageKey = `quiz-answer-photos/${crypto.randomUUID()}.${signature.extension}`;
    try {
      await this.storage.put(storageKey, body, signature.mimeType);
      const photo = await this.db.transaction(async (tx) => {
        const [createdPhoto] = await tx.insert(photos).values({ storeId, uploadedBy: principal.userId, storageKey, idempotencyKey: idempotencyKey ?? null, idempotencyPayloadHash: hash ?? null, originalFilename: filename, mimeType: signature.mimeType, fileSize: body.byteLength }).returning();
        await tx.insert(domainEvents).values({ eventType: "quiz.photo_answer_uploaded", aggregateType: "photo", aggregateId: createdPhoto.id, actorId: principal.userId, payload: { photoId: createdPhoto.id, storeId, uploadedBy: principal.userId } });
        return createdPhoto;
      });
      return { photo: toPhotoResponse(photo), created: true };
    } catch (error) {
      if (idempotencyKey && hash && isUniqueViolation(error)) {
        try { await this.storage.delete(storageKey); } catch (cleanupError) { this.logger?.error("Orphaned quiz answer photo cleanup failed", { cleanupError, storageKey }); }
        const existing = await this.existingIdempotent(principal, storeId, idempotencyKey, hash);
        if (existing) return existing;
      }
      if (!(idempotencyKey && hash && isUniqueViolation(error))) {
        try { await this.storage.delete(storageKey); } catch (cleanupError) { this.logger?.error("Orphaned quiz answer photo cleanup failed", { cleanupError, storageKey }); }
      }
      throw error;
    }
  }

  async deletePhoto(principal: TrustedPrincipal, photoId: string): Promise<void> {
    assertActivePrincipal(principal);
    if (principal.role !== "admin") throw new DomainError(403, "FORBIDDEN", "Only administrators can delete photos");
    const [photo] = await this.db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
    if (!photo) return;

    const linkedVersions = await this.db.select({ id: photoReportVersions.id, reportId: photoReportVersions.reportId, status: photoReportVersions.status })
      .from(photoReportVersions)
      .where(eq(photoReportVersions.photoId, photoId));
    const linkedReportIds = [...new Set(linkedVersions.map((version) => version.reportId))];
    const reportVersions = linkedReportIds.length > 0
      ? await this.db.select({ id: photoReportVersions.id, reportId: photoReportVersions.reportId, status: photoReportVersions.status }).from(photoReportVersions).where(inArray(photoReportVersions.reportId, linkedReportIds))
      : [];
    if (reportVersions.some((version) => version.status !== "pending") || reportVersions.length > 1) {
      throw new DomainError(409, "PHOTO_REVIEW_RETENTION", "Reviewed photo versions cannot be deleted");
    }

    try {
      await this.storage.delete(photo.storageKey);
    } catch (error) {
      this.logger?.error("Photo storage delete failed", { error, photoId });
      throw new DomainError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is unavailable");
    }

    try {
      await this.db.transaction(async (tx) => {
        if (linkedVersions[0]) {
          await tx.delete(photoReviewHistory).where(eq(photoReviewHistory.versionId, linkedVersions[0].id));
          await tx.delete(photoReportVersions).where(eq(photoReportVersions.photoId, photoId));
          await tx.delete(photoReports).where(eq(photoReports.id, linkedVersions[0].reportId));
        }
        await tx.delete(photos).where(eq(photos.id, photoId));
      });
    } catch (error) {
      this.logger?.error("Photo metadata delete failed after object deletion", { error, photoId });
      throw error;
    }
  }

  private async reportRows(whereClause: SQL | undefined, query: ReturnType<typeof photoReviewCollectionQuerySchema.parse>): Promise<PhotoReportListResponse> {
    const filters: SQL[] = [];
    if (whereClause) filters.push(whereClause);
    if (query.storeId) filters.push(eq(photoReports.storeId, query.storeId));
    if (query.uploadedBy) filters.push(eq(photoReports.submittedBy, query.uploadedBy));
    if (query.status) filters.push(eq(photoReportVersions.status, query.status));
    if (query.startDate) filters.push(gte(photoReportVersions.submittedAt, new Date(query.startDate)));
    if (query.endDate) filters.push(lt(photoReportVersions.submittedAt, new Date(query.endDate)));
    const latest = sql`${photoReportVersions.versionNumber} = (select max(latest_versions.version_number) from photo_report_versions latest_versions where latest_versions.report_id = ${photoReports.id})`;
    filters.push(latest);
    const combinedWhere = filters.length > 0 ? and(...filters) : undefined;
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)` }).from(photoReports)
      .innerJoin(photoReportVersions, eq(photoReportVersions.reportId, photoReports.id)).where(combinedWhere);
    const rows = await this.db.select({
      report: photoReports,
      version: photoReportVersions,
      photo: photos,
      versionCount: sql<number>`(select count(*) from photo_report_versions count_versions where count_versions.report_id = ${photoReports.id})`,
    })
      .from(photoReports)
      .innerJoin(photoReportVersions, eq(photoReportVersions.reportId, photoReports.id))
      .innerJoin(photos, eq(photos.id, photoReportVersions.photoId))
      .where(combinedWhere)
      .orderBy(desc(photoReports.updatedAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return {
      data: rows.map(({ report, version, photo, versionCount }) => toReportResponse(report, version, photo, Number(versionCount))),
      pagination: { page: query.page, pageSize: query.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / query.pageSize) },
    };
  }

  async listReports(principal: TrustedPrincipal, input: unknown): Promise<PhotoReportListResponse> {
    assertActivePrincipal(principal);
    const query = photoReviewCollectionQuerySchema.parse(input);
    const filters: SQL[] = [];
    if (principal.role === "staff") {
      filters.push(eq(photoReports.submittedBy, principal.userId));
      if (query.storeId) await this.assertStoreReadable(principal, query.storeId);
      else if (principal.storeIds.length > 0) filters.push(inArray(photoReports.storeId, [...principal.storeIds]));
      else return { data: [], pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 } };
    } else if (principal.role === "manager") {
      if (query.storeId) {
        await this.assertStoreReadable(principal, query.storeId);
      } else if (principal.storeIds.length > 0) {
        filters.push(inArray(photoReports.storeId, [...principal.storeIds]));
      } else {
        return { data: [], pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 } };
      }
    }
    return this.reportRows(filters.length > 0 ? and(...filters) : undefined, query);
  }

  async listMyReports(principal: TrustedPrincipal, input: unknown): Promise<PhotoReportListResponse> {
    assertActivePrincipal(principal);
    const query = photoReviewMineQuerySchema.parse(input);
    return this.listReports(principal, { ...query, uploadedBy: principal.userId });
  }

  private async reportWithVersions(reportId: string) {
    const rows = await this.db.select({ report: photoReports, version: photoReportVersions, photo: photos })
      .from(photoReports)
      .innerJoin(photoReportVersions, eq(photoReportVersions.reportId, photoReports.id))
      .innerJoin(photos, eq(photos.id, photoReportVersions.photoId))
      .where(eq(photoReports.id, reportId))
      .orderBy(desc(photoReportVersions.versionNumber));
    if (!rows[0]) throw new DomainError(404, "PHOTO_REPORT_NOT_FOUND", "Photo report not found");
    return rows;
  }

  private async assertReportReadable(principal: TrustedPrincipal, report: typeof photoReports.$inferSelect): Promise<void> {
    assertActivePrincipal(principal);
    if (principal.role === "admin") return;
    await this.assertStoreReadable(principal, report.storeId);
    if (principal.role === "staff" && report.submittedBy !== principal.userId) {
      throw new DomainError(404, "PHOTO_REPORT_NOT_FOUND", "Photo report not found");
    }
  }

  async getReport(principal: TrustedPrincipal, reportId: string): Promise<PhotoReportDetailResponse> {
    const rows = await this.reportWithVersions(reportId);
    await this.assertReportReadable(principal, rows[0].report);
    return toReportDetailResponse(rows);
  }

  async getHistory(principal: TrustedPrincipal, reportId: string): Promise<{ data: PhotoReviewHistoryEntry[] }> {
    const rows = await this.reportWithVersions(reportId);
    await this.assertReportReadable(principal, rows[0].report);
    const history = await this.db.select().from(photoReviewHistory).where(eq(photoReviewHistory.reportId, reportId)).orderBy(photoReviewHistory.createdAt);
    return { data: history.map((entry) => ({
      id: entry.id,
      reportId: entry.reportId,
      versionId: entry.versionId,
      actorId: entry.actorId,
      fromStatus: entry.fromStatus as PhotoReviewStatus | null,
      toStatus: entry.toStatus as PhotoReviewStatus,
      comment: entry.comment,
      createdAt: entry.createdAt.toISOString(),
    })) };
  }

  private async assertReviewAuthority(principal: TrustedPrincipal, reportId: string) {
    assertActivePrincipal(principal);
    if (principal.role !== "admin" && principal.role !== "manager") {
      throw new DomainError(403, "FORBIDDEN", "Only administrators and managers can review photos");
    }
    const rows = await this.reportWithVersions(reportId);
    await this.assertReportReadable(principal, rows[0].report);
    return rows;
  }

  private async transitionReview(principal: TrustedPrincipal, reportId: string, status: "checked" | "rejected", comment?: string, idempotencyKey?: string): Promise<PhotoReportDetailResponse> {
    await this.assertReviewAuthority(principal, reportId);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from photo_reports where id = ${reportId} for update`);
      const [current] = await tx.select().from(photoReportVersions).where(eq(photoReportVersions.reportId, reportId)).orderBy(desc(photoReportVersions.versionNumber)).limit(1);
      if (!current) throw new DomainError(404, "PHOTO_REPORT_NOT_FOUND", "Photo report not found");
      if (idempotencyKey) {
        const [previous] = await tx.select().from(photoReviewHistory).where(and(eq(photoReviewHistory.versionId, current.id), eq(photoReviewHistory.actorId, principal.userId), eq(photoReviewHistory.idempotencyKey, idempotencyKey))).limit(1);
        if (previous) {
          if (previous.toStatus !== status) throw new DomainError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for another review action");
          return;
        }
      }
      if (current.status !== "pending") throw new DomainError(409, "PHOTO_REVIEW_CONFLICT", "The photo report has already been reviewed");
      await tx.update(photoReportVersions).set({
        status,
        rejectionComment: status === "rejected" ? comment ?? null : null,
        reviewedAt: new Date(),
        reviewedBy: principal.userId,
      }).where(eq(photoReportVersions.id, current.id));
      await tx.insert(photoReviewHistory).values({ reportId, versionId: current.id, actorId: principal.userId, fromStatus: "pending", toStatus: status, comment: comment ?? null, idempotencyKey: idempotencyKey ?? null });
      await tx.insert(domainEvents).values({
        eventType: status === "checked" ? "photo.checked" : "photo.rejected",
        aggregateType: "photo_report",
        aggregateId: reportId,
        actorId: principal.userId,
        payload: { reportId, versionId: current.id, reviewerId: principal.userId, status },
      });
      await tx.update(photoReports).set({ updatedAt: new Date() }).where(eq(photoReports.id, reportId));
    });
    return this.getReport(principal, reportId);
  }

  approve(principal: TrustedPrincipal, reportId: string, comment?: string, idempotencyKey?: string): Promise<PhotoReportDetailResponse> {
    return this.transitionReview(principal, reportId, "checked", comment, idempotencyKey);
  }

  reject(principal: TrustedPrincipal, reportId: string, comment: string, idempotencyKey?: string): Promise<PhotoReportDetailResponse> {
    return this.transitionReview(principal, reportId, "rejected", comment, idempotencyKey);
  }

  async resubmit(principal: TrustedPrincipal, reportId: string, file: File, requestedIdempotencyKey?: string): Promise<PhotoReviewServiceResult> {
    assertActivePrincipal(principal);
    if (principal.role !== "staff") throw new DomainError(403, "FORBIDDEN", "Only staff users can resubmit photos");
    const initialRows = await this.reportWithVersions(reportId);
    await this.assertReportReadable(principal, initialRows[0].report);
    const idempotencyKey = requestedIdempotencyKey ? photoIdempotencyKeySchema.parse(requestedIdempotencyKey) : undefined;
    if (file.size <= 0) throw new DomainError(400, "EMPTY_PHOTO", "Photo file is empty");
    if (file.size > this.limits.maxBytes) throw new DomainError(413, "PHOTO_TOO_LARGE", "Photo exceeds the maximum allowed size");
    const input = new Uint8Array(await file.arrayBuffer());
    const signature = detectPhotoType(input);
    if (!signature || (file.type && file.type !== signature.mimeType)) throw new DomainError(415, "UNSUPPORTED_PHOTO", "Only valid JPEG, PNG, and WebP images are supported");
    const filename = sanitizeFilename(file.name);
    let body: Uint8Array;
    try {
      body = await normalizePhotoImage(input, signature, this.limits);
    } catch (error) {
      if (error instanceof PhotoImageError) throw new DomainError(error.code === "INVALID_IMAGE" ? 415 : 413, error.code, error.message);
      throw error;
    }
    const hash = idempotencyKey ? await this.payloadHash(initialRows[0].report.storeId, signature.mimeType, filename, input) : undefined;
    if (idempotencyKey && hash) {
      const existing = await this.existingIdempotent(principal, initialRows[0].report.storeId, idempotencyKey, hash);
      if (existing) {
        const [version] = await this.db.select({ reportId: photoReportVersions.reportId }).from(photoReportVersions).where(eq(photoReportVersions.photoId, existing.photo.id)).limit(1);
        if (version?.reportId !== reportId) throw new DomainError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for another report");
        return { report: await this.getReport(principal, reportId), created: false };
      }
    }

    const storageKey = `photos/${crypto.randomUUID()}.${signature.extension}`;
    try {
      await this.storage.put(storageKey, body, signature.mimeType);
    } catch (error) {
      this.logger?.error("Photo storage write failed", { error });
      throw new DomainError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is unavailable");
    }
    try {
      const createdReportId = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select id from photo_reports where id = ${reportId} for update`);
        const [current] = await tx.select().from(photoReportVersions).where(eq(photoReportVersions.reportId, reportId)).orderBy(desc(photoReportVersions.versionNumber)).limit(1);
        if (!current || current.status !== "rejected") throw new DomainError(409, "PHOTO_RESUBMIT_NOT_ALLOWED", "Only rejected photos can be resubmitted");
        const [photo] = await tx.insert(photos).values({
          storeId: initialRows[0].report.storeId,
          uploadedBy: principal.userId,
          storageKey,
          idempotencyKey: idempotencyKey ?? null,
          idempotencyPayloadHash: hash ?? null,
          originalFilename: filename,
          mimeType: signature.mimeType,
          fileSize: body.byteLength,
        }).returning();
        const [version] = await tx.insert(photoReportVersions).values({ reportId, photoId: photo.id, versionNumber: current.versionNumber + 1, status: "pending", submittedAt: photo.createdAt }).returning();
        await tx.insert(photoReviewHistory).values({ reportId, versionId: version.id, actorId: principal.userId, fromStatus: "rejected", toStatus: "pending", idempotencyKey: idempotencyKey ?? null });
        await tx.insert(domainEvents).values({
          eventType: "photo.resubmitted",
          aggregateType: "photo_report",
          aggregateId: reportId,
          actorId: principal.userId,
          payload: { reportId, versionId: version.id, photoId: photo.id, storeId: initialRows[0].report.storeId, submittedBy: principal.userId },
        });
        await tx.update(photoReports).set({ updatedAt: new Date() }).where(eq(photoReports.id, reportId));
        return reportId;
      });
      return { report: await this.getReport(principal, createdReportId), created: true };
    } catch (error) {
      if (idempotencyKey && hash && isUniqueViolation(error)) {
        try { await this.storage.delete(storageKey); } catch (cleanupError) { this.logger?.error("Orphaned photo cleanup failed", { cleanupError, storageKey }); }
        const existing = await this.existingIdempotent(principal, initialRows[0].report.storeId, idempotencyKey, hash);
        if (existing) return { report: await this.getReport(principal, reportId), created: false };
      }
      try { await this.storage.delete(storageKey); } catch (cleanupError) { this.logger?.error("Orphaned photo cleanup failed", { cleanupError, storageKey }); }
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

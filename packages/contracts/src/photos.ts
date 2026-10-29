import { z } from "zod";

export const photoMimeTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
export const photoIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/, "Invalid Idempotency-Key");

export const photoListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const photoCollectionQueryObject = photoListQuerySchema.extend({
  storeId: z.string().uuid().optional(),
  uploadedBy: z.string().uuid().optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
});

function validatePhotoDateRange(value: { startDate?: string; endDate?: string }, context: z.RefinementCtx): void {
  if (!value.startDate || !value.endDate) return;
  if (Date.parse(value.startDate) >= Date.parse(value.endDate)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "endDate must be later than startDate" });
  }
  if (Date.parse(value.endDate) - Date.parse(value.startDate) > 366 * 24 * 60 * 60 * 1000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "Photo periods cannot exceed 366 days" });
  }
}

export const photoCollectionQuerySchema = photoCollectionQueryObject.superRefine(validatePhotoDateRange);
export const photoStoreCollectionQuerySchema = photoCollectionQueryObject.omit({ storeId: true }).superRefine(validatePhotoDateRange);

export const photoResponseSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  uploadedBy: z.string().uuid(),
  originalFilename: z.string().min(1),
  mimeType: photoMimeTypeSchema,
  fileSize: z.number().int().positive(),
  createdAt: z.string().datetime(),
});

export const photoListResponseSchema = z.object({
  data: z.array(photoResponseSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export const photoReviewStatusSchema = z.enum(["pending", "checked", "rejected"]);

const photoReviewQueryObject = photoListQuerySchema.extend({
	storeId: z.string().uuid().optional(),
	uploadedBy: z.string().uuid().optional(),
	status: photoReviewStatusSchema.optional(),
	startDate: z.string().datetime({ offset: true }).optional(),
	endDate: z.string().datetime({ offset: true }).optional(),
});

export const photoReviewCollectionQuerySchema = photoReviewQueryObject.superRefine(validatePhotoDateRange);
export const photoReviewMineQuerySchema = photoListQuerySchema.extend({
	storeId: z.string().uuid().optional(),
	status: photoReviewStatusSchema.optional(),
});

export const photoReviewApproveSchema = z.object({
	comment: z.string().trim().max(2000).optional(),
});

export const photoReviewRejectSchema = z.object({
	comment: z.string().trim().min(1).max(2000),
});

export const photoReviewVersionResponseSchema = z.object({
	id: z.string().uuid(),
	reportId: z.string().uuid(),
	photo: photoResponseSchema,
	versionNumber: z.number().int().positive(),
	status: photoReviewStatusSchema,
	rejectionComment: z.string().nullable(),
	submittedAt: z.string().datetime(),
	reviewedAt: z.string().datetime().nullable(),
	reviewedBy: z.string().uuid().nullable(),
});

export const photoReportResponseSchema = z.object({
	id: z.string().uuid(),
	storeId: z.string().uuid(),
	submittedBy: z.string().uuid(),
	currentVersion: photoReviewVersionResponseSchema,
	versionCount: z.number().int().positive(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export const photoReportListResponseSchema = z.object({
	data: z.array(photoReportResponseSchema),
	pagination: z.object({
		page: z.number().int().positive(),
		pageSize: z.number().int().positive(),
		total: z.number().int().nonnegative(),
		totalPages: z.number().int().nonnegative(),
	}),
});

export const photoReportDetailResponseSchema = photoReportResponseSchema.extend({
	versions: z.array(photoReviewVersionResponseSchema),
});

export const photoReviewMutationResponseSchema = z.object({
	report: photoReportDetailResponseSchema,
	created: z.boolean(),
});

export const photoReviewHistoryEntrySchema = z.object({
	id: z.string().uuid(),
	reportId: z.string().uuid(),
	versionId: z.string().uuid(),
	actorId: z.string().uuid(),
	fromStatus: photoReviewStatusSchema.nullable(),
	toStatus: photoReviewStatusSchema,
	comment: z.string().nullable(),
	createdAt: z.string().datetime(),
});

export const photoReviewHistoryResponseSchema = z.object({
	data: z.array(photoReviewHistoryEntrySchema),
});

export type PhotoListQuery = z.infer<typeof photoListQuerySchema>;
export type PhotoCollectionQuery = z.infer<typeof photoCollectionQuerySchema>;
export type PhotoResponse = z.infer<typeof photoResponseSchema>;
export type PhotoListResponse = z.infer<typeof photoListResponseSchema>;
export type PhotoReviewStatus = z.infer<typeof photoReviewStatusSchema>;
export type PhotoReviewCollectionQuery = z.infer<typeof photoReviewCollectionQuerySchema>;
export type PhotoReviewMineQuery = z.infer<typeof photoReviewMineQuerySchema>;
export type PhotoReviewApprove = z.infer<typeof photoReviewApproveSchema>;
export type PhotoReviewReject = z.infer<typeof photoReviewRejectSchema>;
export type PhotoReviewVersionResponse = z.infer<typeof photoReviewVersionResponseSchema>;
export type PhotoReportResponse = z.infer<typeof photoReportResponseSchema>;
export type PhotoReportListResponse = z.infer<typeof photoReportListResponseSchema>;
export type PhotoReportDetailResponse = z.infer<typeof photoReportDetailResponseSchema>;
export type PhotoReviewMutationResponse = z.infer<typeof photoReviewMutationResponseSchema>;
export type PhotoReviewHistoryEntry = z.infer<typeof photoReviewHistoryEntrySchema>;

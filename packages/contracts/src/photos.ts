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

export type PhotoListQuery = z.infer<typeof photoListQuerySchema>;
export type PhotoCollectionQuery = z.infer<typeof photoCollectionQuerySchema>;
export type PhotoResponse = z.infer<typeof photoResponseSchema>;

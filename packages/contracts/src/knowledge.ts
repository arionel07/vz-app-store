import { z } from "zod";

export const knowledgeArticleStatusSchema = z.enum(["draft", "published", "archived"]);
export const knowledgeRevisionStatusSchema = z.enum(["draft", "published", "archived"]);
export const knowledgeContentFormatSchema = z.literal("markdown");
export const knowledgeRoleSchema = z.enum(["staff", "manager"]);

export const knowledgeCategoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug должен содержать латинские буквы, цифры и дефисы").max(120),
  description: z.string().trim().max(500).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).default(0),
  isActive: z.boolean().default(true),
});
export const knowledgeCategoryUpdateSchema = knowledgeCategoryCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "Укажите поле для изменения");
export const knowledgeCategoryResponseSchema = z.object({
  id: z.string().uuid(), name: z.string(), slug: z.string(), description: z.string().nullable(), parentId: z.string().uuid().nullable(), sortOrder: z.number().int(), isActive: z.boolean(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export const knowledgeCategoryListResponseSchema = z.object({ data: z.array(knowledgeCategoryResponseSchema) });

export const knowledgeVisibilityTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("store"), storeId: z.string().uuid() }),
  z.object({ kind: z.literal("role"), role: knowledgeRoleSchema, storeId: z.string().uuid().optional() }),
]);

export const knowledgeAttachmentResponseSchema = z.object({
  id: z.string().uuid(), originalFilename: z.string(), mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]), fileSize: z.number().int().positive(), createdAt: z.string().datetime(),
});

export const knowledgeQuizLinkSchema = z.object({ id: z.string().uuid(), title: z.string() });

const knowledgeRevisionFields = {
  id: z.string().uuid(), revisionNumber: z.number().int().positive(), status: knowledgeRevisionStatusSchema, title: z.string(), summary: z.string().nullable(), body: z.string(), contentFormat: knowledgeContentFormatSchema, contentVersion: z.number().int().positive(), createdBy: z.string().uuid(), createdAt: z.string().datetime(), publishedBy: z.string().uuid().nullable(), publishedAt: z.string().datetime().nullable(), attachments: z.array(knowledgeAttachmentResponseSchema), quizIds: z.array(z.string().uuid()),
};

export const knowledgeAdminRevisionSchema = z.object(knowledgeRevisionFields);
export const knowledgeAdminArticleResponseSchema = z.object({
  id: z.string().uuid(), category: knowledgeCategoryResponseSchema, status: knowledgeArticleStatusSchema, requiresAcknowledgement: z.boolean(), draft: knowledgeAdminRevisionSchema.nullable(), published: knowledgeAdminRevisionSchema.nullable(), visibilityTargets: z.array(knowledgeVisibilityTargetSchema), createdBy: z.string().uuid(), publishedAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), metrics: z.object({ eligibleCount: z.number().int().nonnegative(), acknowledgedCount: z.number().int().nonnegative() }),
});

export const knowledgeArticleSummarySchema = z.object({
  id: z.string().uuid(), category: knowledgeCategoryResponseSchema, title: z.string(), summary: z.string().nullable(), requiresAcknowledgement: z.boolean(), acknowledgedAt: z.string().datetime().nullable(), publishedAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export const knowledgeStaffArticleResponseSchema = knowledgeArticleSummarySchema.extend({
  body: z.string(), contentFormat: knowledgeContentFormatSchema, revisionId: z.string().uuid(), revisionNumber: z.number().int().positive(), attachments: z.array(knowledgeAttachmentResponseSchema), quizzes: z.array(knowledgeQuizLinkSchema),
});

export const knowledgeAdminListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(200).optional(), categoryId: z.string().uuid().optional(), status: knowledgeArticleStatusSchema.optional() });
export const knowledgeStaffListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20), search: z.string().trim().max(200).optional(), categoryId: z.string().uuid().optional() });
export const knowledgeAdminListResponseSchema = z.object({ data: z.array(knowledgeAdminArticleResponseSchema), pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }) });
export const knowledgeStaffListResponseSchema = z.object({ data: z.array(knowledgeArticleSummarySchema), pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }) });

export const knowledgeArticleCreateSchema = z.object({
  categoryId: z.string().uuid(), title: z.string().trim().min(1).max(240), summary: z.string().trim().max(1000).nullable().optional(), body: z.string().min(1).max(200000), contentFormat: knowledgeContentFormatSchema.default("markdown"), visibilityTargets: z.array(knowledgeVisibilityTargetSchema).min(1).max(200), requiresAcknowledgement: z.boolean().default(false), quizIds: z.array(z.string().uuid()).max(50).default([]),
});
export const knowledgeArticleUpdateSchema = knowledgeArticleCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "Укажите поле для изменения");

export const knowledgeRevisionListResponseSchema = z.object({ data: z.array(knowledgeAdminRevisionSchema) });
export const knowledgeAcknowledgmentResponseSchema = z.object({ articleId: z.string().uuid(), revisionId: z.string().uuid(), acknowledgedAt: z.string().datetime() });
export const knowledgeAcknowledgmentListResponseSchema = z.object({ data: z.array(z.object({ employeeId: z.string().uuid(), employeeName: z.string(), revisionId: z.string().uuid(), acknowledgedAt: z.string().datetime() })) });

export type KnowledgeCategoryCreate = z.infer<typeof knowledgeCategoryCreateSchema>;
export type KnowledgeCategoryUpdate = z.infer<typeof knowledgeCategoryUpdateSchema>;
export type KnowledgeCategoryResponse = z.infer<typeof knowledgeCategoryResponseSchema>;
export type KnowledgeVisibilityTarget = z.infer<typeof knowledgeVisibilityTargetSchema>;
export type KnowledgeArticleCreate = z.infer<typeof knowledgeArticleCreateSchema>;
export type KnowledgeArticleUpdate = z.infer<typeof knowledgeArticleUpdateSchema>;
export type KnowledgeAdminListQuery = z.infer<typeof knowledgeAdminListQuerySchema>;
export type KnowledgeStaffListQuery = z.infer<typeof knowledgeStaffListQuerySchema>;
export type KnowledgeAdminArticleResponse = z.infer<typeof knowledgeAdminArticleResponseSchema>;
export type KnowledgeStaffArticleResponse = z.infer<typeof knowledgeStaffArticleResponseSchema>;
export type KnowledgeStaffListResponse = z.infer<typeof knowledgeStaffListResponseSchema>;
export type KnowledgeArticleSummary = z.infer<typeof knowledgeArticleSummarySchema>;
export type KnowledgeAttachmentResponse = z.infer<typeof knowledgeAttachmentResponseSchema>;

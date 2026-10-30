import { z } from "zod";

export const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const taskStatusSchema = z.enum(["assigned", "in_progress", "submitted", "checked", "rejected"]);
export const taskSubmissionStatusSchema = z.enum(["submitted", "checked", "rejected"]);
export const taskRecurrenceFrequencySchema = z.enum(["daily", "weekly", "monthly"]);
export const taskReviewActionSchema = z.enum(["created", "started", "submitted", "checked", "rejected", "resubmitted", "updated"]);
export const taskRoleTargetSchema = z.enum(["staff", "manager"]);
export const taskDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате YYYY-MM-DD");

const nullableText = z.string().trim().max(2000).nullable().optional();
const checklistInput = z.object({ label: z.string().trim().min(1).max(500), isRequired: z.boolean().default(true), requiresEvidence: z.boolean().default(false) });
const recurrenceInput = z.object({
  frequency: taskRecurrenceFrequencySchema,
  interval: z.number().int().min(1).max(31).default(1),
  weekday: z.number().int().min(0).max(6).optional(),
  monthDay: z.number().int().min(1).max(31).optional(),
  startsOn: taskDateSchema,
  endsOn: taskDateSchema.nullable().optional(),
  timezone: z.string().trim().min(1).max(100).default("Europe/Chisinau"),
});

export const taskTemplateCreateSchema = z.object({
  title: z.string().trim().min(1).max(200), description: nullableText, category: z.string().trim().min(1).max(100), defaultPriority: taskPrioritySchema.default("normal"),
  requiresReview: z.boolean().default(true), requiresPhoto: z.boolean().default(false), checklist: z.array(checklistInput).max(100).default([]), active: z.boolean().default(true),
});
export const taskTemplateUpdateSchema = taskTemplateCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "Укажите хотя бы одно поле");

export const taskCreateSchema = z.object({
  templateId: z.string().uuid().optional(), title: z.string().trim().min(1).max(200), description: nullableText, category: z.string().trim().min(1).max(100),
  priority: taskPrioritySchema.default("normal"), storeIds: z.array(z.string().uuid()).min(1).max(100), employeeIds: z.array(z.string().uuid()).max(500).default([]), roles: z.array(taskRoleTargetSchema).max(2).default([]),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(), timezone: z.string().trim().min(1).max(100).default("Europe/Chisinau"), requiresReview: z.boolean().default(true), requiresPhoto: z.boolean().default(false), checklist: z.array(checklistInput).max(100).default([]),
  recurrence: recurrenceInput.nullable().optional(),
});
export const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(), description: nullableText, category: z.string().trim().min(1).max(100).optional(), priority: taskPrioritySchema.optional(), dueAt: z.string().datetime({ offset: true }).nullable().optional(), expectedVersion: z.number().int().positive(),
}).refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"), "Укажите поле для изменения");

export const taskListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), storeId: z.string().uuid().optional(), assignedEmployeeId: z.string().uuid().optional(), status: taskStatusSchema.optional(), priority: taskPrioritySchema.optional(), overdue: z.preprocess((value) => typeof value === "boolean" ? String(value) : value, z.enum(["true", "false"]).transform((value) => value === "true").optional()) });
export const taskTemplateListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50), active: z.enum(["true", "false"]).transform((value) => value === "true").optional() });

export const taskChecklistUpdateSchema = z.object({ completed: z.boolean(), note: nullableText, expectedVersion: z.number().int().positive() });
export const taskSubmitSchema = z.object({ completionNote: nullableText, expectedVersion: z.number().int().positive() });
export const taskReviewSchema = z.object({ expectedVersion: z.number().int().positive(), comment: nullableText });
export const taskRecurrenceCreateSchema = z.object({ templateId: z.string().uuid(), storeIds: z.array(z.string().uuid()).min(1).max(100), employeeIds: z.array(z.string().uuid()).max(500).default([]), roles: z.array(taskRoleTargetSchema).max(2).default([]), frequency: taskRecurrenceFrequencySchema, interval: z.number().int().min(1).max(31).default(1), weekday: z.number().int().min(0).max(6).optional(), monthDay: z.number().int().min(1).max(31).optional(), startsOn: taskDateSchema, endsOn: taskDateSchema.nullable().optional(), timezone: z.string().trim().min(1).max(100).default("Europe/Chisinau") }).superRefine((value, context) => { if (value.frequency === "weekly" && value.weekday === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["weekday"], message: "Для недельного правила укажите день недели" }); if (value.frequency === "monthly" && value.monthDay === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["monthDay"], message: "Для месячного правила укажите день месяца" }); if (value.endsOn && value.endsOn < value.startsOn) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "Дата окончания не может быть раньше даты начала" }); });
export const taskRecurrenceGenerateSchema = z.object({ from: taskDateSchema, to: taskDateSchema });

export const taskChecklistItemResponseSchema = z.object({ id: z.string().uuid(), position: z.number().int().nonnegative(), label: z.string(), isRequired: z.boolean(), requiresEvidence: z.boolean(), completed: z.boolean(), note: z.string().nullable(), completedAt: z.string().datetime().nullable() });
export const taskEvidenceResponseSchema = z.object({ id: z.string().uuid(), taskId: z.string().uuid(), submissionId: z.string().uuid().nullable(), uploadedBy: z.string().uuid(), originalFilename: z.string(), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), fileSize: z.number().int().positive(), createdAt: z.string().datetime() });
export const taskSubmissionResponseSchema = z.object({ id: z.string().uuid(), taskId: z.string().uuid(), submittedBy: z.string().uuid(), submissionVersion: z.number().int().positive(), status: taskSubmissionStatusSchema, completionNote: z.string().nullable(), reviewerComment: z.string().nullable(), submittedAt: z.string().datetime(), reviewedAt: z.string().datetime().nullable(), reviewedBy: z.string().uuid().nullable(), evidence: z.array(taskEvidenceResponseSchema) });
export const taskResponseSchema = z.object({
  id: z.string().uuid(), assignmentGroupId: z.string().uuid(), storeId: z.string().uuid(), storeName: z.string(), assignedEmployeeId: z.string().uuid(), assignedEmployeeName: z.string(), templateId: z.string().uuid().nullable(), templateVersionId: z.string().uuid().nullable(), title: z.string(), description: z.string().nullable(), category: z.string(), priority: taskPrioritySchema, dueAt: z.string().datetime().nullable(), timezone: z.string(), status: taskStatusSchema, requiresReview: z.boolean(), requiresPhoto: z.boolean(), version: z.number().int().positive(), overdue: z.boolean(), createdBy: z.string().uuid(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), startedAt: z.string().datetime().nullable(), completedAt: z.string().datetime().nullable(), checklist: z.array(taskChecklistItemResponseSchema), latestSubmission: taskSubmissionResponseSchema.nullable(), evidence: z.array(taskEvidenceResponseSchema)
});
export const taskListResponseSchema = z.object({ data: z.array(taskResponseSchema), pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }) });
export const taskTemplateResponseSchema = z.object({ id: z.string().uuid(), title: z.string(), description: z.string().nullable(), category: z.string(), defaultPriority: taskPrioritySchema, requiresReview: z.boolean(), requiresPhoto: z.boolean(), active: z.boolean(), version: z.number().int().positive(), checklist: z.array(z.object({ position: z.number().int().nonnegative(), label: z.string(), isRequired: z.boolean(), requiresEvidence: z.boolean() })), createdBy: z.string().uuid(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
export const taskTemplateListResponseSchema = z.object({ data: z.array(taskTemplateResponseSchema), pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }) });
export const taskReviewListResponseSchema = z.object({ data: z.array(taskResponseSchema), pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }) });
export const taskReviewHistoryResponseSchema = z.object({ data: z.array(z.object({ id: z.string().uuid(), taskId: z.string().uuid(), submissionId: z.string().uuid().nullable(), actorId: z.string().uuid(), action: taskReviewActionSchema, previousStatus: taskStatusSchema.nullable(), nextStatus: taskStatusSchema, comment: z.string().nullable(), createdAt: z.string().datetime() })) });
export const taskRecurrenceResponseSchema = z.object({ id: z.string().uuid(), templateId: z.string().uuid(), storeIds: z.array(z.string().uuid()), frequency: taskRecurrenceFrequencySchema, interval: z.number().int().positive(), weekday: z.number().int().nullable(), monthDay: z.number().int().nullable(), startsOn: taskDateSchema, endsOn: taskDateSchema.nullable(), timezone: z.string(), active: z.boolean(), createdAt: z.string().datetime() });
export const taskRecurrenceListResponseSchema = z.array(taskRecurrenceResponseSchema);

export type TaskTemplateCreate = z.infer<typeof taskTemplateCreateSchema>;
export type TaskTemplateUpdate = z.infer<typeof taskTemplateUpdateSchema>;
export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type TaskChecklistUpdate = z.infer<typeof taskChecklistUpdateSchema>;
export type TaskSubmit = z.infer<typeof taskSubmitSchema>;
export type TaskReview = z.infer<typeof taskReviewSchema>;
export type TaskRecurrenceCreate = z.infer<typeof taskRecurrenceCreateSchema>;
export type TaskRecurrenceGenerate = z.infer<typeof taskRecurrenceGenerateSchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type TaskTemplateResponse = z.infer<typeof taskTemplateResponseSchema>;
export type TaskSubmissionResponse = z.infer<typeof taskSubmissionResponseSchema>;

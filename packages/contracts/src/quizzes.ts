import { z } from "zod";

export const quizLifecycleSchema = z.enum(["draft", "published", "archived"]);
export const quizRevisionStatusSchema = z.enum(["draft", "published", "archived"]);
export const quizAssignmentModeSchema = z.enum(["all", "selected"]);
export const quizAttemptStatusSchema = z.enum(["in_progress", "submitted"]);

const uuidSchema = z.string().uuid();

export const quizOptionAuthoringSchema = z.object({
  id: uuidSchema.optional(),
  label: z.string().trim().min(1).max(500),
  position: z.number().int().min(0),
  isCorrect: z.boolean(),
});

export const quizQuestionAuthoringSchema = z.object({
  id: uuidSchema.optional(),
  prompt: z.string().trim().min(1).max(2000),
  position: z.number().int().min(0),
  options: z.array(quizOptionAuthoringSchema).max(6),
});

export const quizDraftInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullable().optional(),
    passingScore: z.number().int().min(0).max(100),
    assignmentMode: quizAssignmentModeSchema,
    storeIds: z.array(uuidSchema).max(500).default([]),
    questions: z.array(quizQuestionAuthoringSchema).max(500).default([]),
  })
  .superRefine((value, context) => {
    if (value.assignmentMode === "all" && value.storeIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storeIds"],
        message: "Global quizzes cannot include selected store IDs",
      });
    }
  });

export const quizCreateInputSchema = quizDraftInputSchema;

export const quizListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: quizLifecycleSchema.optional(),
  search: z.string().trim().max(100).optional(),
});

export const attemptListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  quizId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
  status: quizAttemptStatusSchema.optional(),
});

export const quizAnswerInputSchema = z.object({
  questionId: uuidSchema,
  optionId: uuidSchema.nullable(),
});

export const submitAttemptInputSchema = z.object({
  answers: z.array(quizAnswerInputSchema).max(500),
});

export const quizOptionAuthoringResponseSchema = quizOptionAuthoringSchema.extend({ id: uuidSchema });
export const quizQuestionAuthoringResponseSchema = quizQuestionAuthoringSchema.extend({
  id: uuidSchema,
  options: z.array(quizOptionAuthoringResponseSchema),
});

export const quizAuthoringResponseSchema = z.object({
  id: uuidSchema,
  revisionId: uuidSchema,
  revisionNumber: z.number().int().positive(),
  status: quizLifecycleSchema,
  revisionStatus: quizRevisionStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  passingScore: z.number().int().min(0).max(100),
  assignmentMode: quizAssignmentModeSchema,
  storeIds: z.array(uuidSchema),
  questions: z.array(quizQuestionAuthoringResponseSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const quizStaffResponseSchema = z.object({
  id: uuidSchema,
  revisionId: uuidSchema,
  revisionNumber: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  passingScore: z.number().int().min(0).max(100),
  questions: z.array(z.object({
    id: uuidSchema,
    prompt: z.string(),
    position: z.number().int().nonnegative(),
    options: z.array(z.object({
      id: uuidSchema,
      label: z.string(),
      position: z.number().int().nonnegative(),
    })),
  })),
});

export const quizListResponseSchema = z.object({
  data: z.array(quizAuthoringResponseSchema),
  pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
});

export const staffQuizListResponseSchema = z.object({
  data: z.array(quizStaffResponseSchema),
  pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
});

export const attemptResponseSchema = z.object({
  id: uuidSchema,
  quizId: uuidSchema,
  revisionId: uuidSchema,
  revisionNumber: z.number().int().positive(),
  status: quizAttemptStatusSchema,
  startedAt: z.string().datetime(),
  submittedAt: z.string().datetime().nullable(),
  scorePercent: z.number().int().min(0).max(100).nullable(),
  passed: z.boolean().nullable(),
  quiz: quizStaffResponseSchema.optional(),
});

export const attemptListResponseSchema = z.object({
  data: z.array(attemptResponseSchema),
  pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
});

export const resultResponseSchema = z.object({
  attemptId: uuidSchema,
  quizId: uuidSchema,
  revisionId: uuidSchema,
  revisionNumber: z.number().int().positive(),
  userId: uuidSchema,
  userName: z.string(),
  status: quizAttemptStatusSchema,
  scorePercent: z.number().int().min(0).max(100).nullable(),
  passed: z.boolean().nullable(),
  startedAt: z.string().datetime(),
  submittedAt: z.string().datetime().nullable(),
});

export const resultListResponseSchema = z.object({
  data: z.array(resultResponseSchema),
  pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
});

export type QuizCreateInput = z.input<typeof quizCreateInputSchema>;
export type QuizDraftInput = z.input<typeof quizDraftInputSchema>;
export type QuizListQuery = z.infer<typeof quizListQuerySchema>;
export type AttemptListQuery = z.infer<typeof attemptListQuerySchema>;
export type SubmitAttemptInput = z.infer<typeof submitAttemptInputSchema>;
export type QuizAuthoringResponse = z.infer<typeof quizAuthoringResponseSchema>;
export type QuizStaffResponse = z.infer<typeof quizStaffResponseSchema>;
export type AttemptResponse = z.infer<typeof attemptResponseSchema>;
export type ResultResponse = z.infer<typeof resultResponseSchema>;

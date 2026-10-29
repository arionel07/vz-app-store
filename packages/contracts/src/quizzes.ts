import { z } from "zod";

export const quizLifecycleSchema = z.enum(["draft", "published", "archived"]);
export type QuizLifecycle = z.infer<typeof quizLifecycleSchema>;
export const quizRevisionStatusSchema = z.enum(["draft", "published", "archived"]);
export const quizAssignmentModeSchema = z.enum(["all", "selected"]);
export const quizAttemptStatusSchema = z.enum(["in_progress", "submitted"]);
export const quizAssessmentModeSchema = z.enum(["exam", "practice", "survey"]);
export const quizQuestionTypeSchema = z.enum(["single_choice", "multiple_choice", "weighted_choice", "free_text", "opinion", "rating", "scenario", "photo_answer"]);
export const quizScoringPolicySchema = z.enum(["all_or_nothing", "partial_credit"]);
export const quizReviewStatusSchema = z.enum(["not_required", "pending", "completed"]);
export const quizAnswerReviewStatusSchema = z.enum(["not_required", "pending", "reviewed"]);
export const quizAssignmentTargetTypeSchema = z.enum(["store", "role", "user"]);

const uuidSchema = z.string().uuid();

export const quizOptionAuthoringSchema = z.object({
  id: uuidSchema.optional(),
  label: z.string().trim().min(1).max(500),
  position: z.number().int().min(0),
  isCorrect: z.boolean(),
	points: z.number().int().min(0).max(1000).default(0),
	explanation: z.string().trim().max(2000).nullable().optional().default(null),
});

export const quizQuestionAuthoringSchema = z.object({
  id: uuidSchema.optional(),
  prompt: z.string().trim().min(1).max(2000),
  position: z.number().int().min(0),
  options: z.array(quizOptionAuthoringSchema).max(6),
	type: quizQuestionTypeSchema.default("single_choice"),
	description: z.string().trim().max(2000).nullable().optional().default(null),
	maxPoints: z.number().int().min(0).max(1000).default(1),
	scoringPolicy: quizScoringPolicySchema.default("all_or_nothing"),
	config: z.record(z.unknown()).default({}),
});

export const quizAssignmentTargetSchema = z.object({
	type: quizAssignmentTargetTypeSchema,
	storeId: uuidSchema.optional(),
	role: z.enum(["admin", "manager", "staff"]).optional(),
	userId: uuidSchema.optional(),
}).superRefine((value, context) => {
	if (value.type === "store" && !value.storeId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["storeId"], message: "Store target is required" });
	if (value.type === "role" && !value.role) context.addIssue({ code: z.ZodIssueCode.custom, path: ["role"], message: "Role target is required" });
	if (value.type === "user" && !value.userId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["userId"], message: "User target is required" });
});

export const quizDraftInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullable().optional(),
    passingScore: z.number().int().min(0).max(100),
    assignmentMode: quizAssignmentModeSchema,
    storeIds: z.array(uuidSchema).max(500).default([]),
    questions: z.array(quizQuestionAuthoringSchema).max(500).default([]),
	assessmentMode: quizAssessmentModeSchema.default("exam"),
	maxAttempts: z.number().int().min(1).max(100).nullable().optional().default(null),
	availableFrom: z.string().datetime({ offset: true }).nullable().optional().default(null),
	deadline: z.string().datetime({ offset: true }).nullable().optional().default(null),
	timeLimitSeconds: z.number().int().min(30).max(86_400).nullable().optional().default(null),
	randomizeQuestions: z.boolean().default(false),
	randomizeOptions: z.boolean().default(false),
	showResults: z.boolean().default(true),
	showExplanations: z.boolean().default(false),
	assignmentTargets: z.array(quizAssignmentTargetSchema).max(500).default([]),
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
	optionId: uuidSchema.nullable().optional().default(null),
	optionIds: z.array(uuidSchema).max(100).optional().default([]),
	textAnswer: z.string().max(10_000).nullable().optional().default(null),
	rating: z.number().int().min(0).max(100).nullable().optional().default(null),
	photoId: uuidSchema.nullable().optional().default(null),
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
	assessmentMode: quizAssessmentModeSchema.default("exam"),
	maxAttempts: z.number().int().positive().nullable().default(null),
	availableFrom: z.string().datetime().nullable().default(null),
	deadline: z.string().datetime().nullable().default(null),
	timeLimitSeconds: z.number().int().positive().nullable().default(null),
	randomizeQuestions: z.boolean().default(false),
	randomizeOptions: z.boolean().default(false),
	showResults: z.boolean().default(true),
	showExplanations: z.boolean().default(false),
	assignmentTargets: z.array(quizAssignmentTargetSchema).default([]),
});

export const quizStaffResponseSchema = z.object({
  id: uuidSchema,
  revisionId: uuidSchema,
  revisionNumber: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  passingScore: z.number().int().min(0).max(100),
	assessmentMode: quizAssessmentModeSchema.optional(),
	maxAttempts: z.number().int().positive().nullable().optional(),
	deadline: z.string().datetime().nullable().optional(),
	timeLimitSeconds: z.number().int().positive().nullable().optional(),
	showResults: z.boolean().optional(),
	showExplanations: z.boolean().optional(),
  questions: z.array(z.object({
    id: uuidSchema,
    prompt: z.string(),
    position: z.number().int().nonnegative(),
		type: quizQuestionTypeSchema.optional(),
		description: z.string().nullable().optional(),
		maxPoints: z.number().int().nonnegative().optional(),
		scoringPolicy: quizScoringPolicySchema.optional(),
		config: z.record(z.unknown()).optional(),
    options: z.array(z.object({
      id: uuidSchema,
      label: z.string(),
      position: z.number().int().nonnegative(),
			explanation: z.string().nullable().optional(),
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
	reviewStatus: quizReviewStatusSchema.default("not_required"),
	expiresAt: z.string().datetime().nullable().default(null),
	finalizedAt: z.string().datetime().nullable().default(null),
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
	reviewStatus: quizReviewStatusSchema.default("not_required"),
});

export const resultListResponseSchema = z.object({
  data: z.array(resultResponseSchema),
  pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
});

export const quizArchiveResponseSchema = z.object({ success: z.literal(true) });

export const quizReviewListQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(20),
	status: quizAnswerReviewStatusSchema.optional(),
	quizId: uuidSchema.optional(),
	userId: uuidSchema.optional(),
});

export const quizReviewInputSchema = z.object({
	awardedPoints: z.number().int().min(0).max(1000),
	feedback: z.string().trim().max(4000).nullable().optional().default(null),
});

export const quizReviewResponseSchema = z.object({
	attemptId: uuidSchema,
	questionId: uuidSchema,
	status: quizAnswerReviewStatusSchema,
	awardedPoints: z.number().int().nonnegative().nullable(),
	maxPoints: z.number().int().nonnegative(),
	reviewerId: uuidSchema.nullable(),
	feedback: z.string().nullable(),
	reviewedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
	optionIds: z.array(uuidSchema).default([]),
	textAnswer: z.string().nullable().default(null),
	rating: z.number().int().nullable().default(null),
	photoId: uuidSchema.nullable().default(null),
});

export const quizReviewListResponseSchema = z.object({
	data: z.array(quizReviewResponseSchema.extend({
		userId: uuidSchema,
		userName: z.string(),
		quizId: uuidSchema,
		questionPrompt: z.string(),
	})),
	pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
});

export type QuizCreateInput = z.input<typeof quizCreateInputSchema>;
export type QuizDraftInput = z.input<typeof quizDraftInputSchema>;
export type QuizListQuery = z.infer<typeof quizListQuerySchema>;
export type AttemptListQuery = z.infer<typeof attemptListQuerySchema>;
export type SubmitAttemptInput = z.input<typeof submitAttemptInputSchema>;
export type SubmitAttemptData = z.output<typeof submitAttemptInputSchema>;
export type QuizAuthoringResponse = z.infer<typeof quizAuthoringResponseSchema>;
export type QuizStaffResponse = z.infer<typeof quizStaffResponseSchema>;
export type StaffQuizListResponse = z.infer<typeof staffQuizListResponseSchema>;
export type AttemptResponse = z.infer<typeof attemptResponseSchema>;
export type AttemptListResponse = z.infer<typeof attemptListResponseSchema>;
export type ResultResponse = z.infer<typeof resultResponseSchema>;
export type ResultListResponse = z.infer<typeof resultListResponseSchema>;
export type QuizAssessmentMode = z.infer<typeof quizAssessmentModeSchema>;
export type QuizQuestionType = z.infer<typeof quizQuestionTypeSchema>;
export type QuizScoringPolicy = z.infer<typeof quizScoringPolicySchema>;
export type QuizReviewStatus = z.infer<typeof quizReviewStatusSchema>;
export type QuizAnswerReviewStatus = z.infer<typeof quizAnswerReviewStatusSchema>;
export type QuizAssignmentTarget = z.infer<typeof quizAssignmentTargetSchema>;
export type QuizReviewListQuery = z.infer<typeof quizReviewListQuerySchema>;
export type QuizReviewInput = z.infer<typeof quizReviewInputSchema>;
export type QuizReviewResponse = z.infer<typeof quizReviewResponseSchema>;
export type QuizReviewListResponse = z.infer<typeof quizReviewListResponseSchema>;

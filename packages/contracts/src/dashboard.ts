import { z } from "zod";

const uuidSchema = z.string().uuid();
const dashboardDateSchema = z.string().datetime({ offset: true });

function validateDashboardDateRange(
  value: { startDate?: string; endDate?: string },
  context: z.RefinementCtx,
): void {
  if (!value.startDate || !value.endDate) return;

  const start = Date.parse(value.startDate);
  const end = Date.parse(value.endDate);
  if (start >= end) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "endDate must be later than startDate",
    });
  }
  if (end - start > 366 * 24 * 60 * 60 * 1000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "Reporting periods cannot exceed 366 days",
    });
  }
}

const dashboardFilterFields = {
  storeId: uuidSchema.optional(),
  startDate: dashboardDateSchema.optional(),
  endDate: dashboardDateSchema.optional(),
};

export const dashboardFiltersSchema = z.object(dashboardFilterFields).superRefine(validateDashboardDateRange);

export const dashboardQuizQuerySchema = z
  .object({
    ...dashboardFilterFields,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .superRefine(validateDashboardDateRange);

export const dashboardPeriodSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  endExclusive: z.literal(true),
  timezone: z.literal("UTC"),
});

export const dashboardOverviewResponseSchema = z.object({
  period: dashboardPeriodSchema,
  metrics: z.object({
    activeEmployeeCount: z.number().int().nonnegative(),
    publishedQuizCount: z.number().int().nonnegative(),
    completedAttemptCount: z.number().int().nonnegative(),
    completedEmployeeCount: z.number().int().nonnegative(),
    averageCompletedAttemptScore: z.number().min(0).max(100).nullable(),
    passRate: z.number().min(0).max(100).nullable(),
    uploadedPhotoCount: z.number().int().nonnegative(),
  }),
});

export const dashboardPhotoDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().nonnegative(),
});

export const dashboardPhotoStoreSchema = z.object({
  storeId: uuidSchema,
  storeName: z.string(),
  count: z.number().int().nonnegative(),
});

export const dashboardPhotosResponseSchema = z.object({
  period: dashboardPeriodSchema,
  totalPhotoCount: z.number().int().nonnegative(),
  dailyUploads: z.array(dashboardPhotoDaySchema),
  perStoreUploads: z.array(dashboardPhotoStoreSchema),
  distinctUploadingEmployeeCount: z.number().int().nonnegative(),
});

export const dashboardQuizSummarySchema = z.object({
  quizId: uuidSchema,
  title: z.string(),
  completedAttemptCount: z.number().int().nonnegative(),
  participatingEmployeeCount: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(100).nullable(),
  passRate: z.number().min(0).max(100).nullable(),
});

export const dashboardQuizzesResponseSchema = z.object({
  period: dashboardPeriodSchema,
  summary: z.object({
    completedAttemptCount: z.number().int().nonnegative(),
    participatingEmployeeCount: z.number().int().nonnegative(),
    averageScore: z.number().min(0).max(100).nullable(),
    passRate: z.number().min(0).max(100).nullable(),
  }),
  data: z.array(dashboardQuizSummarySchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;
export type DashboardQuizQuery = z.infer<typeof dashboardQuizQuerySchema>;
export type DashboardOverviewResponse = z.infer<typeof dashboardOverviewResponseSchema>;
export type DashboardPhotosResponse = z.infer<typeof dashboardPhotosResponseSchema>;
export type DashboardQuizzesResponse = z.infer<typeof dashboardQuizzesResponseSchema>;

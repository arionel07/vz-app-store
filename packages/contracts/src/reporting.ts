import { z } from "zod";

const uuid = z.string().uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}, "Date must be a real calendar date");

export const reportPeriodPresetSchema = z.enum([
  "today",
  "last_7_days",
  "last_30_days",
  "current_month",
  "previous_month",
  "custom",
]);

export const reportMetricKeySchema = z.enum([
  "activeStoreCount", "activeAssignedEmployeeCount", "participatingStoreCount", "assignedTaskCount", "checkedTaskCount", "outstandingReviewCount", "taskCompletionRate",
  "availableAssignmentCount", "completedCurrentAssignmentCount", "submittedAttemptCount", "averageExamScore", "averagePracticeScore", "knowledgeAcknowledgmentProgress",
  "submittedReportCount", "submittedVersionCount", "resubmissionCount", "photoCurrentStatus", "photoReviewTurnaroundHours",
  "taskStateCounts", "overdueTaskCount", "taskSubmissionEventCount", "publishedShiftCount", "plannedHours", "scheduledDayOffCount",
  "campaignCompletionRate", "targetedStoreCount", "targetedExecutionCount", "campaignSubmissionEventCount", "merchandisingReviewTurnaroundHours",
  "issueCurrentStatus", "issueResolutionEvents", "requestCurrentStatus", "requestDecisionHours", "requestCompletionHours",
  "storeAssignedEmployeeCount", "storeQuizAttemptCount", "employeeStoreCount", "employeeExamOutcomes", "quizAttemptModes", "quizExamOutcomes",
  "scheduleCoverageDates", "campaignLiveCount", "campaignExecutionStatus", "merchandisingCurrentStatus", "issueStatePriorityCounts", "requestStateCounts",
]);

const reportFiltersObjectSchema = z.object({
  period: reportPeriodPresetSchema.default("last_30_days"),
  startDate: localDate.optional(),
  endDate: localDate.optional(),
  timezone: z.string().min(1).max(100).default("Europe/Chisinau"),
  storeId: uuid.optional(),
});

function validatePeriodFilters(value: z.infer<typeof reportFiltersObjectSchema>, ctx: z.RefinementCtx): void {
  if (value.period === "custom") {
    if (!value.startDate || !value.endDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startDate"], message: "Custom periods require startDate and endDate" });
    } else if (value.startDate > value.endDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "endDate must not precede startDate" });
    }
  } else if (value.startDate || value.endDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["period"], message: "startDate/endDate are only valid for custom periods" });
  }
}

export const reportFiltersSchema = reportFiltersObjectSchema.superRefine(validatePeriodFilters);
export const reportDefinitionQuerySchema = z.object({});

export const reportPageFiltersSchema = reportFiltersObjectSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).superRefine(validatePeriodFilters);

export const reportEmployeeFiltersSchema = reportFiltersObjectSchema.extend({
  employeeId: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).superRefine(validatePeriodFilters);

export const reportPeriodResponseSchema = z.object({
  preset: reportPeriodPresetSchema,
  startDate: localDate,
  endDate: localDate,
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  endExclusive: z.literal(true),
  timezone: z.string(),
  snapshotAt: z.string().datetime(),
});

const nonnegative = z.number().int().nonnegative();
const rate = z.number().min(0).max(100).nullable();
const hours = z.number().nonnegative().nullable();
const paginationSchema = z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: nonnegative, totalPages: nonnegative });

export const reportOverviewResponseSchema = z.object({
  period: reportPeriodResponseSchema,
  metrics: z.object({
    activeStoreCount: nonnegative,
    activeAssignedEmployeeCount: nonnegative,
    participatingStoreCount: nonnegative,
    assignedTaskCount: nonnegative,
    checkedTaskCount: nonnegative,
    outstandingReviewCount: nonnegative,
    taskCompletionRate: rate,
  }),
});

export const reportStoreRowSchema = z.object({
  storeId: uuid,
  storeName: z.string(),
  activeAssignedEmployeeCount: nonnegative,
  assignedTaskCount: nonnegative,
  checkedTaskCount: nonnegative,
  photoReportCount: nonnegative,
  submittedQuizAttemptCount: nonnegative,
  participated: z.boolean(),
});
export const reportStoresResponseSchema = z.object({ period: reportPeriodResponseSchema, data: z.array(reportStoreRowSchema), pagination: paginationSchema });

export const reportEmployeeRowSchema = z.object({
  employeeId: uuid,
  displayName: z.string(),
  assignedStoreCount: nonnegative,
  submittedQuizAttemptCount: nonnegative,
  passedExamAttemptCount: nonnegative,
  failedExamAttemptCount: nonnegative,
  assignedTaskCount: nonnegative,
  checkedTaskCount: nonnegative,
  submittedPhotoReportCount: nonnegative,
});
export const reportEmployeesResponseSchema = z.object({ period: reportPeriodResponseSchema, data: z.array(reportEmployeeRowSchema), pagination: paginationSchema });

export const reportTrainingResponseSchema = z.object({
  period: reportPeriodResponseSchema,
  quizzes: z.object({
    availableAssignmentCount: nonnegative,
    completedCurrentAssignmentCount: nonnegative,
    completionRate: rate,
    submittedAttemptCount: nonnegative,
    examAttemptCount: nonnegative,
    practiceAttemptCount: nonnegative,
    surveyAttemptCount: nonnegative,
    passedExamAttemptCount: nonnegative,
    failedExamAttemptCount: nonnegative,
    averageExamScore: z.number().min(0).max(100).nullable(),
    averagePracticeScore: z.number().min(0).max(100).nullable(),
  }),
  knowledge: z.object({ requiredAcknowledgmentCount: nonnegative, acknowledgedCount: nonnegative, completionRate: rate }),
});

export const reportPhotosResponseSchema = z.object({
  period: reportPeriodResponseSchema,
  submittedReportCount: nonnegative,
  submittedVersionCount: nonnegative,
  resubmissionCount: nonnegative,
  currentStatus: z.object({ pending: nonnegative, checked: nonnegative, rejected: nonnegative }),
  reviewEventCount: nonnegative,
  averageReviewHours: hours,
});

export const reportTasksResponseSchema = z.object({
  period: reportPeriodResponseSchema,
  assignedTaskCount: nonnegative,
  inProgressTaskCount: nonnegative,
  submittedTaskCount: nonnegative,
  checkedTaskCount: nonnegative,
  rejectedTaskCount: nonnegative,
  overdueTaskCount: nonnegative,
  completionRate: rate,
  submissionEventCount: nonnegative,
});

export const reportSchedulesResponseSchema = z.object({
  period: reportPeriodResponseSchema,
  shiftCount: nonnegative,
  plannedHours: z.number().nonnegative(),
  scheduledDayOffCount: nonnegative,
  stores: z.array(z.object({ storeId: uuid, storeName: z.string(), shiftCount: nonnegative, plannedHours: z.number().nonnegative(), scheduledDayOffCount: nonnegative, coveredLocalDateCount: nonnegative })),
});

export const reportOperationsResponseSchema = z.object({
  period: reportPeriodResponseSchema,
  campaigns: z.object({ activeCampaignCount: nonnegative, targetedStoreCount: nonnegative, targetedExecutionCount: nonnegative, checkedExecutionCount: nonnegative, pendingExecutionCount: nonnegative, rejectedExecutionCount: nonnegative, completionRate: rate, submissionEventCount: nonnegative }),
  merchandising: z.object({ submittedInspectionCount: nonnegative, pendingInspectionCount: nonnegative, checkedInspectionCount: nonnegative, rejectedInspectionCount: nonnegative, resubmissionCount: nonnegative, averageReviewHours: hours }),
  issues: z.object({ openCount: nonnegative, inProgressCount: nonnegative, resolvedCount: nonnegative, closedCount: nonnegative, urgentCount: nonnegative, highPriorityCount: nonnegative, statusTransitionEventCount: nonnegative, resolutionEventCount: nonnegative }),
  requests: z.object({ submittedCount: nonnegative, approvedCount: nonnegative, rejectedCount: nonnegative, inProgressCount: nonnegative, completedCount: nonnegative, decisionEventCount: nonnegative, averageDecisionHours: hours, averageCompletionHours: hours }),
});

export const reportMetricDefinitionSchema = z.object({
  key: reportMetricKeySchema,
  domain: z.enum(["network", "training", "photos", "tasks", "schedules", "operations"]),
  definition: z.string(),
  source: z.array(z.string()).min(1),
  grain: z.string(),
  numerator: z.string().nullable(),
  denominator: z.string().nullable(),
  includedStatuses: z.array(z.string()),
  excludedRecords: z.array(z.string()),
  dateAttribution: z.string(),
  timezone: z.string(),
  storeAttribution: z.string(),
  employeeAttribution: z.string(),
  roleVisibility: z.string(),
  emptyBehavior: z.string(),
  historyBehavior: z.string(),
  reconciliation: z.string(),
});
export const reportMetricDefinitionsResponseSchema = z.object({ data: z.array(reportMetricDefinitionSchema) });

export const reportTimeSeriesPointSchema = z.object({
  localDate,
  taskOccurrencesCreated: nonnegative,
  photoVersionsSubmitted: nonnegative,
  quizAttemptsSubmitted: nonnegative,
  campaignSubmissions: nonnegative,
  merchandisingInspectionsSubmitted: nonnegative,
  issuesCreated: nonnegative,
  requestsCreated: nonnegative,
});
export const reportTimeSeriesResponseSchema = z.object({
  period: reportPeriodResponseSchema,
  interval: z.literal("day"),
  data: z.array(reportTimeSeriesPointSchema),
});

// These references carry only stable IDs and entity kinds; callers must use
// the corresponding scoped detail endpoint to retrieve any further data.
export const reportDrilldownReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("store"), id: uuid }),
  z.object({ kind: z.literal("employee"), id: uuid }),
]);

export type ReportFilters = z.infer<typeof reportFiltersSchema>;
export type ReportMetricKey = z.infer<typeof reportMetricKeySchema>;
export type ReportPeriodPreset = z.infer<typeof reportPeriodPresetSchema>;
export type ReportStoreRow = z.infer<typeof reportStoreRowSchema>;
export type ReportMetricDefinition = z.infer<typeof reportMetricDefinitionSchema>;
export type ReportPageFilters = z.infer<typeof reportPageFiltersSchema>;
export type ReportEmployeeFilters = z.infer<typeof reportEmployeeFiltersSchema>;
export type ReportPeriodResponse = z.infer<typeof reportPeriodResponseSchema>;
export type ReportOverviewResponse = z.infer<typeof reportOverviewResponseSchema>;
export type ReportStoresResponse = z.infer<typeof reportStoresResponseSchema>;
export type ReportEmployeesResponse = z.infer<typeof reportEmployeesResponseSchema>;
export type ReportTrainingResponse = z.infer<typeof reportTrainingResponseSchema>;
export type ReportPhotosResponse = z.infer<typeof reportPhotosResponseSchema>;
export type ReportTasksResponse = z.infer<typeof reportTasksResponseSchema>;
export type ReportSchedulesResponse = z.infer<typeof reportSchedulesResponseSchema>;
export type ReportOperationsResponse = z.infer<typeof reportOperationsResponseSchema>;
export type ReportTimeSeriesPoint = z.infer<typeof reportTimeSeriesPointSchema>;
export type ReportTimeSeriesResponse = z.infer<typeof reportTimeSeriesResponseSchema>;
export type ReportDrilldownReference = z.infer<typeof reportDrilldownReferenceSchema>;

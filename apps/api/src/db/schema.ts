import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "manager", "staff"]);
export const sessionTypeEnum = pgEnum("session_type", ["browser", "mobile"]);
export const quizLifecycleEnum = pgEnum("quiz_lifecycle", ["draft", "published", "archived"]);
export const quizRevisionStatusEnum = pgEnum("quiz_revision_status", ["draft", "published", "archived"]);
export const quizAssignmentModeEnum = pgEnum("quiz_assignment_mode", ["all", "selected"]);
export const quizAttemptStatusEnum = pgEnum("quiz_attempt_status", ["in_progress", "submitted"]);
export const quizAssessmentModeEnum = pgEnum("quiz_assessment_mode", ["exam", "practice", "survey"]);
export const quizQuestionTypeEnum = pgEnum("quiz_question_type", ["single_choice", "multiple_choice", "weighted_choice", "free_text", "opinion", "rating", "scenario", "photo_answer"]);
export const quizScoringPolicyEnum = pgEnum("quiz_scoring_policy", ["all_or_nothing", "partial_credit"]);
export const quizReviewStatusEnum = pgEnum("quiz_review_status", ["not_required", "pending", "completed"]);
export const quizAnswerReviewStatusEnum = pgEnum("quiz_answer_review_status", ["not_required", "pending", "reviewed"]);
export const quizAssignmentTargetTypeEnum = pgEnum("quiz_assignment_target_type", ["store", "role", "user"]);
export const photoReviewStatusEnum = pgEnum("photo_review_status", ["pending", "checked", "rejected"]);
export const scheduleStatusEnum = pgEnum("schedule_status", ["draft", "published"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    passwordHash: text("password_hash"),
    role: userRoleEnum("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_phone_unique").on(table.phone),
    uniqueIndex("users_email_ci_unique").on(sql`lower(${table.email})`),
    index("users_role_active_idx").on(table.role, table.isActive),
    index("users_name_idx").on(table.lastName, table.firstName),
    check("users_phone_e164_check", sql`${table.phone} is null or ${table.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stores_code_unique").on(table.code),
    index("stores_active_idx").on(table.isActive),
  ],
);

export const userStores = pgTable(
  "user_stores",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.storeId] }),
    index("user_stores_user_idx").on(table.userId),
    index("user_stores_store_idx").on(table.storeId),
  ],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  userStores: many(userStores),
  profile: one(employeeProfiles, { fields: [users.id], references: [employeeProfiles.userId] }),
}));

export const storesRelations = relations(stores, ({ many }) => ({
  userStores: many(userStores),
}));

export const userStoresRelations = relations(userStores, ({ one }) => ({
  user: one(users, { fields: [userStores.userId], references: [users.id] }),
  store: one(stores, { fields: [userStores.storeId], references: [stores.id] }),
}));

export const employeeProfiles = pgTable(
  "employee_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    jobTitle: text("job_title"),
    employmentStartedOn: date("employment_started_on", { mode: "string" }),
    birthDate: date("birth_date", { mode: "string" }),
    gender: text("gender"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const employeeProfilesRelations = relations(employeeProfiles, ({ one }) => ({
  user: one(users, { fields: [employeeProfiles.userId], references: [users.id] }),
}));

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    storageKey: text("storage_key").notNull(),
    idempotencyKey: text("idempotency_key"),
    idempotencyPayloadHash: text("idempotency_payload_hash"),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("photos_storage_key_unique").on(table.storageKey),
    uniqueIndex("photos_uploaded_by_idempotency_unique").on(table.uploadedBy, table.idempotencyKey),
    index("photos_created_idx").on(table.createdAt),
    index("photos_store_created_idx").on(table.storeId, table.createdAt),
    index("photos_uploaded_by_created_idx").on(table.uploadedBy, table.createdAt),
    check("photos_file_size_positive_check", sql`${table.fileSize} > 0`),
    check("photos_file_size_max_check", sql`${table.fileSize} <= 26214400`),
    check("photos_mime_type_check", sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`),
  ],
);

export const photoReports = pgTable(
  "photo_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("photo_reports_store_updated_idx").on(table.storeId, table.updatedAt),
    index("photo_reports_submitted_updated_idx").on(table.submittedBy, table.updatedAt),
  ],
);

export const photoReportVersions = pgTable(
  "photo_report_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => photoReports.id, { onDelete: "restrict" }),
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: photoReviewStatusEnum("status").notNull().default("pending"),
    rejectionComment: text("rejection_comment"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("photo_report_versions_report_number_unique").on(table.reportId, table.versionNumber),
    uniqueIndex("photo_report_versions_photo_unique").on(table.photoId),
    index("photo_report_versions_report_status_idx").on(table.reportId, table.status),
  ],
);

export const photoReviewHistory = pgTable(
  "photo_review_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => photoReports.id, { onDelete: "restrict" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => photoReportVersions.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    fromStatus: photoReviewStatusEnum("from_status"),
    toStatus: photoReviewStatusEnum("to_status").notNull(),
    comment: text("comment"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("photo_review_history_report_created_idx").on(table.reportId, table.createdAt),
    index("photo_review_history_version_created_idx").on(table.versionId, table.createdAt),
    uniqueIndex("photo_review_history_idempotency_unique").on(table.versionId, table.actorId, table.idempotencyKey),
  ],
);

export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("domain_events_type_aggregate_created_unique").on(table.eventType, table.aggregateId, table.createdAt),
    index("domain_events_aggregate_idx").on(table.aggregateType, table.aggregateId),
    index("domain_events_occurred_idx").on(table.occurredAt),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: sessionTypeEnum("type").notNull(),
    tokenHash: text("token_hash").notNull(),
    csrfTokenHash: text("csrf_token_hash"),
    deviceId: text("device_id"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    maxExpiresAt: timestamp("max_expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_active_idx").on(table.userId, table.revokedAt, table.expiresAt),
    index("sessions_device_idx").on(table.userId, table.deviceId),
  ],
);

export const activationTokens = pgTable(
  "activation_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    secretHash: text("secret_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("activation_tokens_secret_hash_unique").on(table.secretHash),
    index("activation_tokens_user_active_idx").on(table.userId, table.consumedAt, table.expiresAt),
    index("activation_tokens_requested_by_idx").on(table.requestedByUserId),
  ],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const activationTokensRelations = relations(activationTokens, ({ one }) => ({
  user: one(users, { fields: [activationTokens.userId], references: [users.id] }),
  store: one(stores, { fields: [activationTokens.storeId], references: [stores.id] }),
  requestedBy: one(users, { fields: [activationTokens.requestedByUserId], references: [users.id] }),
}));

export const quizzes = pgTable(
  "quizzes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: quizLifecycleEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("quizzes_status_idx").on(table.status)],
);

export const quizRevisions = pgTable(
  "quiz_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    status: quizRevisionStatusEnum("status").notNull().default("draft"),
    title: text("title").notNull(),
    description: text("description"),
    passingScore: integer("passing_score").notNull(),
    assignmentMode: quizAssignmentModeEnum("assignment_mode").notNull(),
    assessmentMode: quizAssessmentModeEnum("assessment_mode").notNull().default("exam"),
    maxAttempts: integer("max_attempts"),
    availableFrom: timestamp("available_from", { withTimezone: true }),
    deadline: timestamp("deadline", { withTimezone: true }),
    timeLimitSeconds: integer("time_limit_seconds"),
    randomizeQuestions: boolean("randomize_questions").notNull().default(false),
    randomizeOptions: boolean("randomize_options").notNull().default(false),
    showResults: boolean("show_results").notNull().default(true),
    showExplanations: boolean("show_explanations").notNull().default(false),
    scoringPolicyVersion: text("scoring_policy_version").notNull().default("v1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("quiz_revisions_quiz_number_unique").on(table.quizId, table.revisionNumber),
    index("quiz_revisions_status_idx").on(table.quizId, table.status, table.revisionNumber),
    check("quiz_revisions_passing_score_check", sql`${table.passingScore} between 0 and 100`),
  ],
);

export const quizQuestions = pgTable(
  "quiz_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => quizRevisions.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    questionType: quizQuestionTypeEnum("question_type").notNull().default("single_choice"),
    maxPoints: integer("max_points").notNull().default(1),
    scoringPolicy: quizScoringPolicyEnum("scoring_policy").notNull().default("all_or_nothing"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("quiz_questions_revision_position_unique").on(table.revisionId, table.position),
    index("quiz_questions_revision_idx").on(table.revisionId),
  ],
);

export const quizOptions = pgTable(
  "quiz_options",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => quizQuestions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    position: integer("position").notNull(),
    isCorrect: boolean("is_correct").notNull().default(false),
    points: integer("points").notNull().default(0),
    explanation: text("explanation"),
  },
  (table) => [
    uniqueIndex("quiz_options_question_position_unique").on(table.questionId, table.position),
    index("quiz_options_question_idx").on(table.questionId),
  ],
);

export const quizAssignments = pgTable(
  "quiz_assignments",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => quizRevisions.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.storeId] }),
    index("quiz_assignments_store_idx").on(table.storeId),
  ],
);

export const quizAssignmentTargets = pgTable(
  "quiz_assignment_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => quizRevisions.id, { onDelete: "cascade" }),
    targetType: quizAssignmentTargetTypeEnum("target_type").notNull(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "restrict" }),
    role: userRoleEnum("role"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quiz_assignment_targets_revision_target_unique").on(table.revisionId, table.targetType, table.storeId, table.role, table.userId),
    index("quiz_assignment_targets_revision_idx").on(table.revisionId),
    index("quiz_assignment_targets_user_idx").on(table.userId),
  ],
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "restrict" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => quizRevisions.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: quizAttemptStatusEnum("status").notNull().default("in_progress"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    scorePercent: integer("score_percent"),
    passed: boolean("passed"),
    reviewStatus: quizReviewStatusEnum("review_status").notNull().default("not_required"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    questionOrder: jsonb("question_order").$type<string[] | null>(),
    optionOrder: jsonb("option_order").$type<Record<string, string[]> | null>(),
    scoringPolicyVersion: text("scoring_policy_version").notNull().default("v1"),
  },
  (table) => [
    uniqueIndex("quiz_attempts_active_unique")
      .on(table.userId, table.revisionId)
      .where(sql`${table.status} = 'in_progress'`),
    index("quiz_attempts_user_idx").on(table.userId, table.startedAt),
    index("quiz_attempts_quiz_idx").on(table.quizId, table.revisionId, table.status),
    index("quiz_attempts_submitted_idx").on(table.status, table.submittedAt),
    check("quiz_attempts_score_check", sql`${table.scorePercent} is null or ${table.scorePercent} between 0 and 100`),
  ],
);

export const quizAttemptAnswers = pgTable(
  "quiz_attempt_answers",
  {
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => quizQuestions.id, { onDelete: "restrict" }),
    optionId: uuid("option_id").references(() => quizOptions.id, { onDelete: "restrict" }),
    optionIds: jsonb("option_ids").$type<string[]>().notNull().default([]),
    textAnswer: text("text_answer"),
    rating: integer("rating"),
    photoId: uuid("photo_id").references(() => photos.id, { onDelete: "restrict" }),
    answerPayload: jsonb("answer_payload").$type<Record<string, unknown> | null>(),
    earnedPoints: integer("earned_points"),
    maxPoints: integer("max_points"),
    reviewStatus: quizAnswerReviewStatusEnum("review_status").notNull().default("not_required"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.attemptId, table.questionId] }),
    index("quiz_attempt_answers_option_idx").on(table.optionId),
  ],
);

export const quizAnswerReviews = pgTable(
  "quiz_answer_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => quizQuestions.id, { onDelete: "restrict" }),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "restrict" }),
    status: quizAnswerReviewStatusEnum("status").notNull().default("pending"),
    awardedPoints: integer("awarded_points"),
    maxPoints: integer("max_points").notNull(),
    feedback: text("feedback"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quiz_answer_reviews_attempt_question_unique").on(table.attemptId, table.questionId),
    index("quiz_answer_reviews_status_idx").on(table.status, table.createdAt),
  ],
);

export const quizAnswerReviewHistory = pgTable(
  "quiz_answer_review_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => quizQuestions.id, { onDelete: "restrict" }),
    reviewerId: uuid("reviewer_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    previousPoints: integer("previous_points"),
    awardedPoints: integer("awarded_points").notNull(),
    feedback: text("feedback"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("quiz_answer_review_history_answer_idx").on(table.attemptId, table.questionId, table.createdAt),
  ],
);

export const quizAnswerPhotos = pgTable(
  "quiz_answer_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => quizQuestions.id, { onDelete: "restrict" }),
    photoId: uuid("photo_id").notNull().references(() => photos.id, { onDelete: "restrict" }),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quiz_answer_photos_attempt_question_unique").on(table.attemptId, table.questionId),
    uniqueIndex("quiz_answer_photos_photo_unique").on(table.photoId),
  ],
);

export const schedulePeriods = pgTable(
  "schedule_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    timezone: text("timezone").notNull().default("Europe/Chisinau"),
    status: scheduleStatusEnum("status").notNull().default("draft"),
    revision: integer("revision").notNull().default(1),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("schedule_periods_store_dates_idx").on(table.storeId, table.startDate, table.endDate),
    index("schedule_periods_status_idx").on(table.status, table.supersededAt),
    check("schedule_periods_date_order_check", sql`${table.startDate} <= ${table.endDate}`),
  ],
);

export const scheduleShifts = pgTable(
  "schedule_shifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodId: uuid("period_id").notNull().references(() => schedulePeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
    localDate: date("local_date", { mode: "string" }).notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("schedule_shifts_period_date_idx").on(table.periodId, table.localDate),
    index("schedule_shifts_employee_time_idx").on(table.employeeId, table.startAt, table.endAt),
    check("schedule_shifts_time_order_check", sql`${table.startAt} < ${table.endAt}`),
  ],
);

export const scheduleDaysOff = pgTable(
  "schedule_days_off",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodId: uuid("period_id").notNull().references(() => schedulePeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
    localDate: date("local_date", { mode: "string" }).notNull(),
    note: text("note"),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("schedule_days_off_employee_date_unique").on(table.periodId, table.employeeId, table.localDate),
    index("schedule_days_off_period_date_idx").on(table.periodId, table.localDate),
  ],
);

export const scheduleHistory = pgTable(
  "schedule_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scheduleId: uuid("schedule_id").notNull().references(() => schedulePeriods.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("schedule_history_schedule_created_idx").on(table.scheduleId, table.createdAt),
  ],
);

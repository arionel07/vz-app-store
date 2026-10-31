import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  type AnyPgColumn,
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
export const taskPriorityEnum = pgEnum("task_priority", ["low", "normal", "high", "urgent"]);
export const taskStatusEnum = pgEnum("task_status", ["assigned", "in_progress", "submitted", "checked", "rejected"]);
export const taskSubmissionStatusEnum = pgEnum("task_submission_status", ["submitted", "checked", "rejected"]);
export const taskRecurrenceFrequencyEnum = pgEnum("task_recurrence_frequency", ["daily", "weekly", "monthly"]);
export const notificationTargetKindEnum = pgEnum("notification_target_kind", ["task", "photo_report", "quiz", "attempt", "schedule", "announcement", "knowledge", "operation"]);
export const notificationOutboxStatusEnum = pgEnum("notification_outbox_status", ["pending", "claimed", "accepted", "retry", "permanent"]);
export const pushPlatformEnum = pgEnum("push_platform", ["ios", "android"]);
export const announcementStatusEnum = pgEnum("announcement_status", ["draft", "published", "archived"]);
export const knowledgeArticleStatusEnum = pgEnum("knowledge_article_status", ["draft", "published", "archived"]);
export const knowledgeRevisionStatusEnum = pgEnum("knowledge_revision_status", ["draft", "published", "archived"]);
export const knowledgeContentFormatEnum = pgEnum("knowledge_content_format", ["markdown"]);
export const knowledgeVisibilityKindEnum = pgEnum("knowledge_visibility_kind", ["all", "store", "role"]);
export const retailCampaignStatusEnum = pgEnum("retail_campaign_status", ["draft", "scheduled", "active", "completed", "archived", "cancelled"]);
export const retailExecutionStatusEnum = pgEnum("retail_execution_status", ["not_started", "in_progress", "submitted", "checked", "rejected"]);
export const merchandisingStatusEnum = pgEnum("merchandising_status", ["draft", "submitted", "checked", "rejected"]);
export const storeIssueStatusEnum = pgEnum("store_issue_status", ["open", "in_progress", "resolved", "closed"]);
export const operationalRequestStatusEnum = pgEnum("operational_request_status", ["submitted", "approved", "rejected", "in_progress", "completed"]);

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

export const retailCampaigns = pgTable("retail_campaigns", {
  id: uuid("id").defaultRandom().primaryKey(), title: text("title").notNull(), description: text("description").notNull().default(""),
  status: retailCampaignStatusEnum("status").notNull().default("draft"), startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(), timezone: text("timezone").notNull(),
  requiredActions: jsonb("required_actions").$type<string[]>().notNull().default([]), requiresPhoto: boolean("requires_photo").notNull().default(false),
  referencePhotoIds: uuid("reference_photo_ids").array().notNull().default([]), createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("retail_campaigns_status_dates_idx").on(table.status, table.startsAt, table.endsAt)]);

export const retailCampaignStores = pgTable("retail_campaign_stores", {
  campaignId: uuid("campaign_id").notNull().references(() => retailCampaigns.id, { onDelete: "restrict" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
}, (table) => [primaryKey({ columns: [table.campaignId, table.storeId] })]);

export const retailCampaignExecutions = pgTable("retail_campaign_executions", {
  id: uuid("id").defaultRandom().primaryKey(), campaignId: uuid("campaign_id").notNull().references(() => retailCampaigns.id, { onDelete: "restrict" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }), status: retailExecutionStatusEnum("status").notNull().default("not_started"),
  actionResults: jsonb("action_results").$type<boolean[]>().notNull().default([]), evidencePhotoIds: uuid("evidence_photo_ids").array().notNull().default([]),
  submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "restrict" }), submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "restrict" }), reviewComment: text("review_comment"),
  version: integer("version").notNull().default(0), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("retail_campaign_executions_campaign_store_unique").on(table.campaignId, table.storeId), index("retail_campaign_executions_store_status_idx").on(table.storeId, table.status, table.updatedAt)]);

export const retailCampaignSubmissions = pgTable("retail_campaign_submissions", {
  id: uuid("id").defaultRandom().primaryKey(), executionId: uuid("execution_id").notNull().references(() => retailCampaignExecutions.id, { onDelete: "restrict" }),
  version: integer("version").notNull(), submittedBy: uuid("submitted_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  actionResults: jsonb("action_results").$type<boolean[]>().notNull(), evidencePhotoIds: uuid("evidence_photo_ids").array().notNull().default([]),
  employeeNote: text("employee_note").notNull().default(""),
  idempotencyKey: text("idempotency_key").notNull(), submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("retail_campaign_submissions_execution_version_unique").on(table.executionId, table.version), uniqueIndex("retail_campaign_submissions_execution_idempotency_unique").on(table.executionId, table.idempotencyKey), index("retail_campaign_submissions_actor_idx").on(table.submittedBy, table.submittedAt)]);

export const retailCampaignReviews = pgTable("retail_campaign_reviews", {
  id: uuid("id").defaultRandom().primaryKey(), executionId: uuid("execution_id").notNull().references(() => retailCampaignExecutions.id, { onDelete: "restrict" }),
  submissionId: uuid("submission_id").references(() => retailCampaignSubmissions.id, { onDelete: "restrict" }),
  actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }), fromStatus: retailExecutionStatusEnum("from_status").notNull(),
  toStatus: retailExecutionStatusEnum("to_status").notNull(), comment: text("comment"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("retail_campaign_reviews_execution_idx").on(table.executionId, table.createdAt)]);

export const merchandisingDisplays = pgTable("merchandising_displays", {
  id: uuid("id").defaultRandom().primaryKey(), storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  name: text("name").notNull(), brand: text("brand").notNull().default(""), referencePhotoId: uuid("reference_photo_id").notNull().references(() => photos.id, { onDelete: "restrict" }),
  checklist: jsonb("checklist").$type<string[]>().notNull().default([]), campaignId: uuid("campaign_id").references(() => retailCampaigns.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true), createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("merchandising_displays_store_active_idx").on(table.storeId, table.active)]);

export const merchandisingInspections = pgTable("merchandising_inspections", {
  id: uuid("id").defaultRandom().primaryKey(), displayId: uuid("display_id").notNull().references(() => merchandisingDisplays.id, { onDelete: "restrict" }),
  displayNameSnapshot: text("display_name_snapshot").notNull(), brandSnapshot: text("brand_snapshot").notNull(), checklistSnapshot: jsonb("checklist_snapshot").$type<string[]>().notNull(),
  referencePhotoId: uuid("reference_photo_id").notNull().references(() => photos.id, { onDelete: "restrict" }),
  actualPhotoId: uuid("actual_photo_id").references(() => photos.id, { onDelete: "restrict" }), checklistResults: jsonb("checklist_results").$type<boolean[]>().notNull().default([]),
  status: merchandisingStatusEnum("status").notNull().default("draft"), submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "restrict" }),
  reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "restrict" }), comment: text("comment"), version: integer("version").notNull().default(1),
  employeeNote: text("employee_note").notNull().default(""),
  idempotencyKey: text("idempotency_key"), submittedAt: timestamp("submitted_at", { withTimezone: true }), reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("merchandising_inspections_submit_idempotency_unique").on(table.submittedBy, table.idempotencyKey), uniqueIndex("merchandising_inspections_display_version_unique").on(table.displayId, table.version), index("merchandising_inspections_status_idx").on(table.status, table.submittedAt)]);

export const merchandisingReviewHistory = pgTable("merchandising_review_history", {
  id: uuid("id").defaultRandom().primaryKey(), inspectionId: uuid("inspection_id").notNull().references(() => merchandisingInspections.id, { onDelete: "restrict" }),
  actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }), fromStatus: merchandisingStatusEnum("from_status").notNull(),
  toStatus: merchandisingStatusEnum("to_status").notNull(), comment: text("comment"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("merchandising_review_history_inspection_idx").on(table.inspectionId, table.createdAt)]);

export const storeIssues = pgTable("store_issues", {
  id: uuid("id").defaultRandom().primaryKey(), storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  category: text("category").notNull(), title: text("title").notNull(), description: text("description").notNull(), priority: text("priority").notNull().default("normal"),
  photoIds: uuid("photo_ids").array().notNull().default([]), reporterId: uuid("reporter_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createIdempotencyKey: text("create_idempotency_key"), createRequestHash: text("create_request_hash"),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }), status: storeIssueStatusEnum("status").notNull().default("open"),
  resolutionNotes: text("resolution_notes"), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("store_issues_store_status_idx").on(table.storeId, table.status, table.priority, table.createdAt), uniqueIndex("store_issues_reporter_idempotency_unique").on(table.reporterId, table.createIdempotencyKey)]);

export const storeIssueHistory = pgTable("store_issue_history", {
  id: uuid("id").defaultRandom().primaryKey(), issueId: uuid("issue_id").notNull().references(() => storeIssues.id, { onDelete: "restrict" }),
  actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }), action: text("action").notNull(),
  fromStatus: storeIssueStatusEnum("from_status"), toStatus: storeIssueStatusEnum("to_status"), reason: text("reason"),
  previousPriority: text("previous_priority"), newPriority: text("new_priority"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("store_issue_history_issue_idx").on(table.issueId, table.createdAt)]);

export const operationalRequests = pgTable("operational_requests", {
  id: uuid("id").defaultRandom().primaryKey(), storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  category: text("category").notNull(), description: text("description").notNull(), quantity: text("quantity"), attachmentPhotoIds: uuid("attachment_photo_ids").array().notNull().default([]),
  requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "restrict" }), createIdempotencyKey: text("create_idempotency_key"), createRequestHash: text("create_request_hash"), assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  status: operationalRequestStatusEnum("status").notNull().default("submitted"), decisionComment: text("decision_comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("operational_requests_store_status_idx").on(table.storeId, table.status, table.createdAt), uniqueIndex("operational_requests_requester_idempotency_unique").on(table.requesterId, table.createIdempotencyKey)]);

export const operationalRequestHistory = pgTable("operational_request_history", {
  id: uuid("id").defaultRandom().primaryKey(), requestId: uuid("request_id").notNull().references(() => operationalRequests.id, { onDelete: "restrict" }),
  actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }), fromStatus: operationalRequestStatusEnum("from_status"),
  toStatus: operationalRequestStatusEnum("to_status").notNull(), comment: text("comment"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("operational_request_history_request_idx").on(table.requestId, table.createdAt)]);

export const retailCampaignReferencePhotos = pgTable("retail_campaign_reference_photos", {
  campaignId: uuid("campaign_id").notNull().references(() => retailCampaigns.id, { onDelete: "restrict" }),
  photoId: uuid("photo_id").notNull().references(() => photos.id, { onDelete: "restrict" }),
}, (table) => [primaryKey({ columns: [table.campaignId, table.photoId] })]);
export const retailCampaignSubmissionPhotos = pgTable("retail_campaign_submission_photos", {
  submissionId: uuid("submission_id").notNull().references(() => retailCampaignSubmissions.id, { onDelete: "restrict" }),
  photoId: uuid("photo_id").notNull().references(() => photos.id, { onDelete: "restrict" }),
}, (table) => [primaryKey({ columns: [table.submissionId, table.photoId] })]);
export const storeIssuePhotos = pgTable("store_issue_photos", {
  issueId: uuid("issue_id").notNull().references(() => storeIssues.id, { onDelete: "restrict" }),
  photoId: uuid("photo_id").notNull().references(() => photos.id, { onDelete: "restrict" }),
}, (table) => [primaryKey({ columns: [table.issueId, table.photoId] })]);
export const operationalRequestPhotos = pgTable("operational_request_photos", {
  requestId: uuid("request_id").notNull().references(() => operationalRequests.id, { onDelete: "restrict" }),
  photoId: uuid("photo_id").notNull().references(() => photos.id, { onDelete: "restrict" }),
}, (table) => [primaryKey({ columns: [table.requestId, table.photoId] })]);

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

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientUserId: uuid("recipient_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceEventId: uuid("source_event_id").references(() => domainEvents.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    targetKind: notificationTargetKindEnum("target_kind"),
    targetId: uuid("target_id"),
    requiresAcknowledgement: boolean("requires_acknowledgement").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_event_recipient_unique").on(table.sourceEventId, table.recipientUserId),
    index("notifications_recipient_created_idx").on(table.recipientUserId, table.createdAt),
    index("notifications_recipient_read_idx").on(table.recipientUserId, table.readAt, table.createdAt),
    index("notifications_target_idx").on(table.targetKind, table.targetId),
  ],
);

export const pushDevices = pgTable(
  "push_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    platform: pushPlatformEnum("platform").notNull(),
    expoPushToken: text("expo_push_token").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("push_devices_user_device_unique").on(table.userId, table.deviceId),
    uniqueIndex("push_devices_token_unique").on(table.expoPushToken),
    index("push_devices_user_active_idx").on(table.userId, table.invalidatedAt),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    pushEnabled: boolean("push_enabled").notNull().default(true),
    taskNotifications: boolean("task_notifications").notNull().default(true),
    quizNotifications: boolean("quiz_notifications").notNull().default(true),
    scheduleNotifications: boolean("schedule_notifications").notNull().default(true),
    photoReviewNotifications: boolean("photo_review_notifications").notNull().default(true),
    announcementNotifications: boolean("announcement_notifications").notNull().default(true),
    operationsNotifications: boolean("operations_notifications").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const notificationEventConsumptions = pgTable(
  "notification_event_consumptions",
  {
    domainEventId: uuid("domain_event_id").primaryKey().references(() => domainEvents.id, { onDelete: "cascade" }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(1),
    lastError: text("last_error"),
  },
);

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notificationId: uuid("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull().references(() => pushDevices.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("push"),
    status: notificationOutboxStatusEnum("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    providerTicketId: text("provider_ticket_id"),
    providerReceiptId: text("provider_receipt_id"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_outbox_notification_device_unique").on(table.notificationId, table.deviceId),
    index("notification_outbox_claim_idx").on(table.status, table.nextAttemptAt, table.createdAt),
    index("notification_outbox_ticket_idx").on(table.providerTicketId),
  ],
);

export const notificationDeliveryAttempts = pgTable(
  "notification_delivery_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outboxId: uuid("outbox_id").notNull().references(() => notificationOutbox.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    providerTicketId: text("provider_ticket_id"),
    providerReceiptId: text("provider_receipt_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_delivery_attempts_number_unique").on(table.outboxId, table.attemptNumber),
    index("notification_delivery_attempts_outbox_created_idx").on(table.outboxId, table.createdAt),
  ],
);

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: announcementStatusEnum("status").notNull().default("draft"),
    requiresAcknowledgement: boolean("requires_acknowledgement").notNull().default(false),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("announcements_status_created_idx").on(table.status, table.createdAt)],
);

export const announcementStoreTargets = pgTable(
  "announcement_store_targets",
  {
    announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.announcementId, table.storeId] }), index("announcement_store_targets_store_idx").on(table.storeId)],
);

export const announcementRoleTargets = pgTable(
  "announcement_role_targets",
  {
    announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.announcementId, table.role] })],
);

export const announcementHistory = pgTable(
  "announcement_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("announcement_history_announcement_created_idx").on(table.announcementId, table.createdAt)],
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

export const taskTemplates = pgTable(
  "task_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    defaultPriority: taskPriorityEnum("default_priority").notNull().default("normal"),
    requiresReview: boolean("requires_review").notNull().default(true),
    requiresPhoto: boolean("requires_photo").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("task_templates_active_idx").on(table.active, table.updatedAt)],
);

export const taskTemplateVersions = pgTable(
  "task_template_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id").notNull().references(() => taskTemplates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    priority: taskPriorityEnum("priority").notNull(),
    requiresReview: boolean("requires_review").notNull(),
    requiresPhoto: boolean("requires_photo").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("task_template_versions_template_number_unique").on(table.templateId, table.version), index("task_template_versions_template_idx").on(table.templateId, table.version)],
);

export const taskTemplateChecklistItems = pgTable(
  "task_template_checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    versionId: uuid("version_id").notNull().references(() => taskTemplateVersions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    isRequired: boolean("is_required").notNull().default(true),
    requiresEvidence: boolean("requires_evidence").notNull().default(false),
  },
  (table) => [uniqueIndex("task_template_checklist_position_unique").on(table.versionId, table.position)],
);

export const taskRecurrences = pgTable(
  "task_recurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateVersionId: uuid("template_version_id").notNull().references(() => taskTemplateVersions.id, { onDelete: "restrict" }),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
    employeeIds: jsonb("employee_ids").$type<string[]>().notNull().default([]),
    roles: jsonb("roles").$type<string[]>().notNull().default([]),
    frequency: taskRecurrenceFrequencyEnum("frequency").notNull(),
    interval: integer("interval").notNull().default(1),
    weekday: integer("weekday"),
    monthDay: integer("month_day"),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }),
    timezone: text("timezone").notNull().default("Europe/Chisinau"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("task_recurrences_active_idx").on(table.active, table.startsOn, table.endsOn), index("task_recurrences_store_idx").on(table.storeId)],
);

export const taskOccurrences = pgTable(
  "task_occurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentGroupId: uuid("assignment_group_id").notNull(),
    recurrenceId: uuid("recurrence_id").references(() => taskRecurrences.id, { onDelete: "set null" }),
    recurrenceLocalDate: date("recurrence_local_date", { mode: "string" }),
    templateId: uuid("template_id").references(() => taskTemplates.id, { onDelete: "set null" }),
    templateVersionId: uuid("template_version_id").references(() => taskTemplateVersions.id, { onDelete: "set null" }),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
    assignedEmployeeId: uuid("assigned_employee_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    priority: taskPriorityEnum("priority").notNull().default("normal"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    timezone: text("timezone").notNull().default("Europe/Chisinau"),
    status: taskStatusEnum("status").notNull().default("assigned"),
    requiresReview: boolean("requires_review").notNull().default(true),
    requiresPhoto: boolean("requires_photo").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("task_occurrences_recurrence_employee_date_unique").on(table.recurrenceId, table.storeId, table.assignedEmployeeId, table.recurrenceLocalDate),
    index("task_occurrences_store_status_idx").on(table.storeId, table.status, table.dueAt),
    index("task_occurrences_employee_status_idx").on(table.assignedEmployeeId, table.status, table.dueAt),
  ],
);

export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id").notNull().references(() => taskOccurrences.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    isRequired: boolean("is_required").notNull().default(true),
    requiresEvidence: boolean("requires_evidence").notNull().default(false),
    completed: boolean("completed").notNull().default(false),
    note: text("note"),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("task_checklist_items_task_position_unique").on(table.taskId, table.position), index("task_checklist_items_task_idx").on(table.taskId)],
);

export const taskSubmissions = pgTable(
  "task_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id").notNull().references(() => taskOccurrences.id, { onDelete: "cascade" }),
    submittedBy: uuid("submitted_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    submissionVersion: integer("submission_version").notNull(),
    status: taskSubmissionStatusEnum("status").notNull().default("submitted"),
    answers: jsonb("answers").$type<Array<{ itemId: string; completed: boolean; note: string | null }>>().notNull().default([]),
    completionNote: text("completion_note"),
    reviewerComment: text("reviewer_comment"),
    idempotencyKey: text("idempotency_key"),
    idempotencyPayloadHash: text("idempotency_payload_hash"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [uniqueIndex("task_submissions_task_version_unique").on(table.taskId, table.submissionVersion), uniqueIndex("task_submissions_idempotency_unique").on(table.taskId, table.submittedBy, table.idempotencyKey), index("task_submissions_review_idx").on(table.status, table.submittedAt)],
);

export const taskEvidence = pgTable(
  "task_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id").notNull().references(() => taskOccurrences.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").references(() => taskSubmissions.id, { onDelete: "set null" }),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    storageKey: text("storage_key").notNull(),
    idempotencyKey: text("idempotency_key"),
    idempotencyPayloadHash: text("idempotency_payload_hash"),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("task_evidence_storage_key_unique").on(table.storageKey), uniqueIndex("task_evidence_uploader_idempotency_unique").on(table.taskId, table.uploadedBy, table.idempotencyKey), index("task_evidence_task_idx").on(table.taskId, table.createdAt), index("task_evidence_submission_idx").on(table.submissionId)],
);

export const taskReviewHistory = pgTable(
  "task_review_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id").notNull().references(() => taskOccurrences.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").references(() => taskSubmissions.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    previousStatus: taskStatusEnum("previous_status"),
    nextStatus: taskStatusEnum("next_status").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("task_review_history_task_idx").on(table.taskId, table.createdAt), index("task_review_history_submission_idx").on(table.submissionId, table.createdAt)],
);

export const knowledgeCategories = pgTable(
  "knowledge_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    parentId: uuid("parent_id").references((): AnyPgColumn => knowledgeCategories.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("knowledge_categories_slug_unique").on(table.slug), index("knowledge_categories_parent_idx").on(table.parentId, table.sortOrder)],
);

export const knowledgeArticles = pgTable(
  "knowledge_articles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id").notNull().references(() => knowledgeCategories.id, { onDelete: "restrict" }),
    status: knowledgeArticleStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    currentDraftRevisionId: uuid("current_draft_revision_id"),
    publishedRevisionId: uuid("published_revision_id"),
    requiresAcknowledgement: boolean("requires_acknowledgement").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [index("knowledge_articles_status_updated_idx").on(table.status, table.updatedAt), index("knowledge_articles_category_idx").on(table.categoryId, table.status)],
);

export const knowledgeArticleRevisions = pgTable(
  "knowledge_article_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    articleId: uuid("article_id").notNull().references(() => knowledgeArticles.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    status: knowledgeRevisionStatusEnum("status").notNull().default("draft"),
    title: text("title").notNull(),
    summary: text("summary"),
    body: text("body").notNull(),
    contentFormat: knowledgeContentFormatEnum("content_format").notNull().default("markdown"),
    contentVersion: integer("content_version").notNull().default(1),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("knowledge_revisions_article_number_unique").on(table.articleId, table.revisionNumber), index("knowledge_revisions_article_status_idx").on(table.articleId, table.status)],
);

export const knowledgeVisibilityTargets = pgTable(
  "knowledge_visibility_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    articleId: uuid("article_id").notNull().references(() => knowledgeArticles.id, { onDelete: "cascade" }),
    kind: knowledgeVisibilityKindEnum("kind").notNull(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "restrict" }),
    role: userRoleEnum("role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("knowledge_visibility_target_unique").on(table.articleId, table.kind, table.storeId, table.role), index("knowledge_visibility_target_store_idx").on(table.storeId, table.kind), check("knowledge_visibility_target_shape_check", sql`(${table.kind} = 'all' and ${table.storeId} is null and ${table.role} is null) or (${table.kind} = 'store' and ${table.storeId} is not null and ${table.role} is null) or (${table.kind} = 'role' and ${table.role} in ('staff', 'manager'))`)],
);

export const knowledgeAttachments = pgTable(
  "knowledge_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    revisionId: uuid("revision_id").notNull().references(() => knowledgeArticleRevisions.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("knowledge_attachments_storage_key_unique").on(table.storageKey), index("knowledge_attachments_revision_idx").on(table.revisionId, table.createdAt), check("knowledge_attachments_size_check", sql`${table.fileSize} > 0 and ${table.fileSize} <= 10485760`), check("knowledge_attachments_mime_check", sql`${table.mimeType} in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')`)],
);

export const knowledgeArticleQuizLinks = pgTable(
  "knowledge_article_quiz_links",
  {
    articleId: uuid("article_id").notNull().references(() => knowledgeArticles.id, { onDelete: "cascade" }),
    quizId: uuid("quiz_id").notNull().references(() => quizzes.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.articleId, table.quizId] }), index("knowledge_article_quiz_links_quiz_idx").on(table.quizId)],
);

export const knowledgeAcknowledgments = pgTable(
  "knowledge_acknowledgments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    articleId: uuid("article_id").notNull().references(() => knowledgeArticles.id, { onDelete: "restrict" }),
    revisionId: uuid("revision_id").notNull().references(() => knowledgeArticleRevisions.id, { onDelete: "restrict" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("knowledge_ack_employee_revision_unique").on(table.employeeId, table.revisionId), index("knowledge_ack_article_idx").on(table.articleId, table.acknowledgedAt), index("knowledge_ack_employee_idx").on(table.employeeId, table.acknowledgedAt)],
);

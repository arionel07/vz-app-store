import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  index,
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

export const usersRelations = relations(users, ({ many }) => ({
  userStores: many(userStores),
}));

export const storesRelations = relations(stores, ({ many }) => ({
  userStores: many(userStores),
}));

export const userStoresRelations = relations(userStores, ({ one }) => ({
  user: one(users, { fields: [userStores.userId], references: [users.id] }),
  store: one(stores, { fields: [userStores.storeId], references: [stores.id] }),
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
    position: integer("position").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.attemptId, table.questionId] }),
    index("quiz_attempt_answers_option_idx").on(table.optionId),
  ],
);

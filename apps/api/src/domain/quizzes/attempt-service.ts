import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type AttemptListQuery,
  attemptListQuerySchema,
  type AttemptResponse,
  type QuizReviewInput,
  quizReviewInputSchema,
  type QuizReviewListResponse,
  type ResultResponse,
  submitAttemptInputSchema,
  type SubmitAttemptData,
  type SubmitAttemptInput,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import {
  domainEvents,
  photos,
  quizAnswerPhotos,
  quizAnswerReviewHistory,
  quizAnswerReviews,
  quizAttemptAnswers,
  quizAttempts,
  quizQuestions,
  quizRevisions,
  userStores,
  users,
} from "../../db/schema";
import { assertActivePrincipal, type TrustedPrincipal } from "../authz";
import { DomainError, isUniqueViolation } from "../errors";
import { aggregateScores, scoreQuestion } from "./scoring";
import { QuizService } from "./service";

function assertStaff(principal: TrustedPrincipal): void {
  assertActivePrincipal(principal);
  if (principal.role !== "staff") throw new DomainError(403, "FORBIDDEN", "Only staff users can take quizzes");
}

function shuffle<T>(values: T[], seed: string): T[] {
  const result = [...values];
  let state = Array.from(seed).reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 7);
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function selectedIds(answer: SubmitAttemptData["answers"][number]): string[] {
  return [...new Set(answer.optionIds.length > 0 ? answer.optionIds : answer.optionId ? [answer.optionId] : [])];
}

function toAttemptResponse(attempt: typeof quizAttempts.$inferSelect, quiz?: AttemptResponse["quiz"]): AttemptResponse {
  const hideResult = Boolean(quiz && quiz.showResults === false && attempt.status === "submitted");
  return {
    id: attempt.id,
    quizId: attempt.quizId,
    revisionId: attempt.revisionId,
    revisionNumber: quiz?.revisionNumber ?? 1,
    status: attempt.status,
    startedAt: attempt.startedAt.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    scorePercent: hideResult ? null : attempt.scorePercent,
    passed: hideResult ? null : attempt.passed,
    reviewStatus: attempt.reviewStatus,
    expiresAt: attempt.expiresAt?.toISOString() ?? null,
    finalizedAt: attempt.finalizedAt?.toISOString() ?? null,
    ...(quiz ? { quiz } : {}),
  };
}

type RevisionGraph = Awaited<ReturnType<QuizService["getGraphForRevision"]>>;

export class QuizAttemptService {
  constructor(private readonly db: Database, private readonly quizzes: QuizService) {}

  private async activeParticipant(principal: TrustedPrincipal): Promise<void> {
    assertStaff(principal);
    const [user] = await this.db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, principal.userId)).limit(1);
    if (!user?.isActive) throw new DomainError(403, "INACTIVE_PRINCIPAL", "The authenticated user is inactive");
  }

  private async attemptForUser(principal: TrustedPrincipal, attemptId: string) {
    const [attempt] = await this.db.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
    if (!attempt) throw new DomainError(404, "ATTEMPT_NOT_FOUND", "Attempt not found");
    if (attempt.userId !== principal.userId) throw new DomainError(403, "FORBIDDEN", "The attempt is outside the principal scope");
    return attempt;
  }

  private attemptOrder(graph: RevisionGraph, attemptId: string) {
    const questionIds = graph.questions.map((question) => question.id);
    const questionOrder = graph.revision.randomizeQuestions ? shuffle(questionIds, attemptId) : questionIds;
    const optionOrder: Record<string, string[]> = {};
    for (const question of graph.questions) {
      const ids = question.options.map((option) => option.id);
      optionOrder[question.id] = graph.revision.randomizeOptions ? shuffle(ids, `${attemptId}:${question.id}`) : ids;
    }
    return { questionOrder, optionOrder };
  }

  private expiresAt(graph: RevisionGraph, startedAt: Date): Date | null {
    const candidates: Date[] = [];
    if (graph.revision.timeLimitSeconds) candidates.push(new Date(startedAt.getTime() + graph.revision.timeLimitSeconds * 1000));
    if (graph.revision.deadline) candidates.push(graph.revision.deadline);
    return candidates.length ? new Date(Math.min(...candidates.map((date) => date.getTime()))) : null;
  }

  async start(principal: TrustedPrincipal, quizId: string): Promise<AttemptResponse> {
    await this.activeParticipant(principal);
    const quiz = await this.quizzes.getAvailable(principal, quizId);
    const graph = await this.quizzes.getGraphForRevision(quiz.revisionId);
    const [existing] = await this.db.select().from(quizAttempts).where(and(eq(quizAttempts.userId, principal.userId), eq(quizAttempts.revisionId, quiz.revisionId), eq(quizAttempts.status, "in_progress"))).limit(1);
    if (existing) {
      const existingQuiz = await this.quizzes.getStaffForRevision(existing.revisionId, { questionOrder: existing.questionOrder, optionOrder: existing.optionOrder });
      return toAttemptResponse(existing, existingQuiz);
    }

    const attemptId = crypto.randomUUID();
    const startedAt = new Date();
    const order = this.attemptOrder(graph, attemptId);
    try {
      const attempt = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select ${quizRevisions.id} from ${quizRevisions} where ${quizRevisions.id} = ${quiz.revisionId} for update`);
        const [active] = await tx.select().from(quizAttempts).where(and(eq(quizAttempts.userId, principal.userId), eq(quizAttempts.revisionId, quiz.revisionId), eq(quizAttempts.status, "in_progress"))).limit(1);
        if (active) return active;
        if (graph.revision.maxAttempts !== null) {
          const [{ count }] = await tx.select({ count: sql<number>`count(*)` }).from(quizAttempts).where(and(eq(quizAttempts.userId, principal.userId), eq(quizAttempts.revisionId, quiz.revisionId), eq(quizAttempts.status, "submitted")));
          if (Number(count) >= graph.revision.maxAttempts) throw new DomainError(409, "ATTEMPT_LIMIT_REACHED", "The maximum number of attempts has been reached");
        }
        const [created] = await tx.insert(quizAttempts).values({
        id: attemptId,
        quizId,
        revisionId: quiz.revisionId,
        userId: principal.userId,
        status: "in_progress",
        startedAt,
        expiresAt: this.expiresAt(graph, startedAt),
        questionOrder: order.questionOrder,
        optionOrder: order.optionOrder,
        scoringPolicyVersion: graph.revision.scoringPolicyVersion,
        }).returning();
        await tx.insert(domainEvents).values({
        eventType: "quiz.assigned",
        aggregateType: "quiz_attempt",
        aggregateId: created.id,
        actorId: principal.userId,
        payload: { quizId, revisionId: quiz.revisionId, attemptId, userId: principal.userId },
        });
        await tx.insert(domainEvents).values({
        eventType: "quiz.started",
        aggregateType: "quiz_attempt",
        aggregateId: created.id,
        actorId: principal.userId,
        payload: { quizId, revisionId: quiz.revisionId, attemptId, userId: principal.userId },
        });
        return created;
      });
      const orderedQuiz = await this.quizzes.getStaffForRevision(quiz.revisionId, { questionOrder: attempt.questionOrder, optionOrder: attempt.optionOrder });
      return toAttemptResponse(attempt, orderedQuiz);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const [concurrent] = await this.db.select().from(quizAttempts).where(and(eq(quizAttempts.userId, principal.userId), eq(quizAttempts.revisionId, quiz.revisionId), eq(quizAttempts.status, "in_progress"))).limit(1);
        if (concurrent) {
          const concurrentQuiz = await this.quizzes.getStaffForRevision(concurrent.revisionId, { questionOrder: concurrent.questionOrder, optionOrder: concurrent.optionOrder });
          return toAttemptResponse(concurrent, concurrentQuiz);
        }
      }
      throw error;
    }
  }

  private async validateAnswers(principal: TrustedPrincipal, graph: RevisionGraph, answers: SubmitAttemptData["answers"]): Promise<void> {
    const questionById = new Map(graph.questions.map((question) => [question.id, question]));
    const answerIds = new Set<string>();
    for (const answer of answers) {
      if (answerIds.has(answer.questionId)) throw new DomainError(400, "INVALID_ANSWERS", "Each question may be answered only once");
      answerIds.add(answer.questionId);
      const question = questionById.get(answer.questionId);
      if (!question) throw new DomainError(400, "INVALID_ANSWERS", "Answer does not belong to the quiz revision");
      const selected = selectedIds(answer);
      const validOptionIds = new Set(question.options.map((option) => option.id));
      if (selected.some((optionId) => !validOptionIds.has(optionId))) throw new DomainError(400, "INVALID_ANSWERS", "Answer option does not belong to its question");
      if (["single_choice", "weighted_choice"].includes(question.questionType) && selected.length > 1) throw new DomainError(400, "INVALID_ANSWERS", "This question accepts one option");
      if (!["single_choice", "multiple_choice", "weighted_choice", "scenario", "opinion"].includes(question.questionType) && selected.length > 0) throw new DomainError(400, "INVALID_ANSWERS", "This question does not accept options");
      if (question.questionType === "rating" && answer.rating !== null) {
        const minimum = typeof question.config.minimum === "number" ? question.config.minimum : 1;
        const maximum = typeof question.config.maximum === "number" ? question.config.maximum : 5;
        if (answer.rating < minimum || answer.rating > maximum) throw new DomainError(400, "INVALID_RATING", "Rating is outside the allowed range");
      }
      if (question.questionType === "free_text" && answer.textAnswer && typeof question.config.maxLength === "number" && answer.textAnswer.length > question.config.maxLength) {
        throw new DomainError(400, "INVALID_TEXT_ANSWER", "Text answer is too long");
      }
      if (answer.photoId) {
        if (question.questionType !== "photo_answer") throw new DomainError(400, "INVALID_PHOTO_ANSWER", "Photo is allowed only for photo questions");
        const [photo] = await this.db.select({ id: photos.id, uploadedBy: photos.uploadedBy }).from(photos).where(eq(photos.id, answer.photoId)).limit(1);
        if (!photo || photo.uploadedBy !== principal.userId) throw new DomainError(403, "PHOTO_FORBIDDEN", "The photo is outside the principal scope");
      }
    }
  }

  async submit(principal: TrustedPrincipal, attemptId: string, input: SubmitAttemptInput): Promise<AttemptResponse> {
    await this.activeParticipant(principal);
    const data = submitAttemptInputSchema.parse(input);
    const initial = await this.attemptForUser(principal, attemptId);
    const graph = await this.quizzes.getGraphForRevision(initial.revisionId);
    const orderedQuiz = await this.quizzes.getStaffForRevision(initial.revisionId, { questionOrder: initial.questionOrder, optionOrder: initial.optionOrder });

    if (initial.status === "submitted") return toAttemptResponse(initial, orderedQuiz);
    if (initial.expiresAt && initial.expiresAt <= new Date()) throw new DomainError(409, "ATTEMPT_EXPIRED", "The quiz attempt has expired");
    await this.validateAnswers(principal, graph, data.answers);

    const answersByQuestion = new Map(data.answers.map((answer) => [answer.questionId, answer]));
    const scores = graph.questions.map((question) => {
      const answer = answersByQuestion.get(question.id) ?? { questionId: question.id, optionId: null, optionIds: [], textAnswer: null, rating: null, photoId: null };
      return scoreQuestion({ type: question.questionType, maxPoints: question.maxPoints, scoringPolicy: question.scoringPolicy, config: question.config }, question.options.map((option) => ({ id: option.id, isCorrect: option.isCorrect, points: option.points })), answer);
    });
    const aggregate = aggregateScores(scores);
    const reviewStatus = aggregate.requiresReview ? "pending" : "not_required";
    const now = new Date();

    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select ${quizAttempts.id} from ${quizAttempts} where ${quizAttempts.id} = ${attemptId} for update`);
      const [locked] = await tx.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
      if (!locked || locked.userId !== principal.userId) throw new DomainError(403, "FORBIDDEN", "The attempt is outside the principal scope");
      if (locked.status === "submitted") return locked;
      if (locked.expiresAt && locked.expiresAt <= now) throw new DomainError(409, "ATTEMPT_EXPIRED", "The quiz attempt has expired");

      await tx.insert(quizAttemptAnswers).values(graph.questions.map((question, index) => {
        const answer = answersByQuestion.get(question.id) ?? { questionId: question.id, optionId: null, optionIds: [], textAnswer: null, rating: null, photoId: null };
        const score = scores[index];
        const optionIds = selectedIds(answer);
        return {
          attemptId,
          questionId: question.id,
          optionId: optionIds[0] ?? null,
          optionIds,
          textAnswer: answer.textAnswer,
          rating: answer.rating,
          photoId: answer.photoId,
          answerPayload: null,
          earnedPoints: score.earnedPoints,
          maxPoints: score.maxPoints,
          reviewStatus: score.requiresReview ? "pending" as const : "not_required" as const,
        };
      }));
      if (reviewStatus === "pending") {
        await tx.insert(quizAnswerReviews).values(graph.questions.flatMap((question, index) => scores[index].requiresReview ? [{ attemptId, questionId: question.id, maxPoints: scores[index].maxPoints, status: "pending" as const }] : []));
      }
      const [submitted] = await tx.update(quizAttempts).set({
        status: "submitted",
        submittedAt: now,
        finalizedAt: reviewStatus === "not_required" ? now : null,
        reviewStatus,
        scorePercent: reviewStatus === "not_required" ? (graph.revision.assessmentMode === "survey" ? null : aggregate.scorePercent) : null,
        passed: reviewStatus === "not_required" && graph.revision.assessmentMode !== "survey" && aggregate.scorePercent !== null ? aggregate.scorePercent >= graph.revision.passingScore : null,
      }).where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.status, "in_progress"))).returning();
      await tx.insert(domainEvents).values({
        eventType: "quiz.submitted",
        aggregateType: "quiz_attempt",
        aggregateId: attemptId,
        actorId: principal.userId,
        payload: { attemptId, quizId: locked.quizId, revisionId: locked.revisionId, userId: principal.userId },
      });
      await tx.insert(domainEvents).values({
        eventType: reviewStatus === "pending" ? "quiz.review_required" : "quiz.completed",
        aggregateType: "quiz_attempt",
        aggregateId: attemptId,
        actorId: principal.userId,
        payload: { attemptId, quizId: locked.quizId, revisionId: locked.revisionId, reviewStatus },
      });
      return submitted;
    });
    return toAttemptResponse(result, orderedQuiz);
  }

  async listMine(principal: TrustedPrincipal, query: AttemptListQuery) {
    await this.activeParticipant(principal);
    const data = attemptListQuerySchema.parse(query);
    const filters = [eq(quizAttempts.userId, principal.userId)];
    if (data.quizId) filters.push(eq(quizAttempts.quizId, data.quizId));
    if (data.status) filters.push(eq(quizAttempts.status, data.status));
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)` }).from(quizAttempts).where(and(...filters));
    const rows = await this.db.select().from(quizAttempts).where(and(...filters)).orderBy(desc(quizAttempts.startedAt)).limit(data.pageSize).offset((data.page - 1) * data.pageSize);
    const responses: AttemptResponse[] = [];
    for (const row of rows) {
      const quiz = await this.quizzes.getStaffForRevision(row.revisionId, { questionOrder: row.questionOrder, optionOrder: row.optionOrder });
      responses.push(toAttemptResponse(row, quiz));
    }
    return { data: responses, pagination: { page: data.page, pageSize: data.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / data.pageSize) } };
  }

  async getMine(principal: TrustedPrincipal, attemptId: string): Promise<AttemptResponse> {
    await this.activeParticipant(principal);
    const attempt = await this.attemptForUser(principal, attemptId);
    const quiz = await this.quizzes.getStaffForRevision(attempt.revisionId, { questionOrder: attempt.questionOrder, optionOrder: attempt.optionOrder });
    return toAttemptResponse(attempt, quiz);
  }

  private async managerCanSeeAttempt(principal: TrustedPrincipal, userId: string, revisionId: string): Promise<boolean> {
    if (principal.role === "admin") return true;
    const [membership] = await this.db.select({ storeId: userStores.storeId }).from(userStores).where(and(eq(userStores.userId, userId), inArray(userStores.storeId, [...principal.storeIds]))).limit(1);
    if (!membership) return false;
    const graph = await this.quizzes.getGraphForRevision(revisionId);
    if (graph.targets.length > 0) return graph.targets.some((target) => target.targetType === "role" ? target.role === "staff" : target.targetType === "user" ? target.userId === userId : Boolean(target.storeId && principal.storeIds.includes(target.storeId)));
    return graph.revision.assignmentMode === "all" || graph.storeIds.includes(membership.storeId);
  }

  async listResults(principal: TrustedPrincipal, query: AttemptListQuery) {
    assertActivePrincipal(principal);
    if (principal.role !== "admin" && principal.role !== "manager") throw new DomainError(403, "FORBIDDEN", "Only administrators and managers can view quiz results");
    const data = attemptListQuerySchema.parse(query);
    const filters = [];
    if (data.quizId) filters.push(eq(quizAttempts.quizId, data.quizId));
    if (data.userId) filters.push(eq(quizAttempts.userId, data.userId));
    if (data.status) filters.push(eq(quizAttempts.status, data.status));
    const rows = await this.db.select({ attempt: quizAttempts, user: users, revision: quizRevisions }).from(quizAttempts).innerJoin(users, eq(users.id, quizAttempts.userId)).innerJoin(quizRevisions, eq(quizRevisions.id, quizAttempts.revisionId)).where(filters.length ? and(...filters) : undefined).orderBy(desc(quizAttempts.startedAt));
    const scoped: ResultResponse[] = [];
    for (const row of rows) {
      if (!(await this.managerCanSeeAttempt(principal, row.attempt.userId, row.attempt.revisionId))) continue;
      scoped.push({
        attemptId: row.attempt.id,
        quizId: row.attempt.quizId,
        revisionId: row.attempt.revisionId,
        revisionNumber: row.revision.revisionNumber,
        userId: row.attempt.userId,
        userName: `${row.user.firstName} ${row.user.lastName}`,
        status: row.attempt.status,
        scorePercent: row.attempt.scorePercent,
        passed: row.attempt.passed,
        startedAt: row.attempt.startedAt.toISOString(),
        submittedAt: row.attempt.submittedAt?.toISOString() ?? null,
        reviewStatus: row.attempt.reviewStatus,
      });
    }
    const start = (data.page - 1) * data.pageSize;
    return { data: scoped.slice(start, start + data.pageSize), pagination: { page: data.page, pageSize: data.pageSize, total: scoped.length, totalPages: Math.ceil(scoped.length / data.pageSize) } };
  }

  async listReviews(principal: TrustedPrincipal, query: { page: number; pageSize: number; status?: "not_required" | "pending" | "reviewed"; quizId?: string; userId?: string }): Promise<QuizReviewListResponse> {
    assertActivePrincipal(principal);
    if (principal.role !== "admin" && principal.role !== "manager") throw new DomainError(403, "FORBIDDEN", "Only administrators and managers can review quiz answers");
    const filters = [eq(quizAttemptAnswers.reviewStatus, query.status ?? "pending")];
    if (query.quizId) filters.push(eq(quizAttempts.quizId, query.quizId));
    if (query.userId) filters.push(eq(quizAttempts.userId, query.userId));
    const rows = await this.db.select({ answer: quizAttemptAnswers, attempt: quizAttempts, question: quizQuestions, user: users, revision: quizRevisions, review: quizAnswerReviews }).from(quizAttemptAnswers).innerJoin(quizAttempts, eq(quizAttempts.id, quizAttemptAnswers.attemptId)).innerJoin(quizQuestions, eq(quizQuestions.id, quizAttemptAnswers.questionId)).innerJoin(users, eq(users.id, quizAttempts.userId)).innerJoin(quizRevisions, eq(quizRevisions.id, quizAttempts.revisionId)).leftJoin(quizAnswerReviews, and(eq(quizAnswerReviews.attemptId, quizAttemptAnswers.attemptId), eq(quizAnswerReviews.questionId, quizAttemptAnswers.questionId))).where(and(...filters)).orderBy(asc(quizAttemptAnswers.createdAt));
    const data = [] as QuizReviewListResponse["data"];
    for (const row of rows) {
      if (!(await this.managerCanSeeAttempt(principal, row.attempt.userId, row.attempt.revisionId))) continue;
      data.push({
        attemptId: row.attempt.id,
        questionId: row.answer.questionId,
        status: row.answer.reviewStatus,
        awardedPoints: row.answer.earnedPoints,
        maxPoints: row.answer.maxPoints ?? row.question.maxPoints,
        reviewerId: row.review?.reviewerId ?? null,
        feedback: row.review?.feedback ?? null,
        reviewedAt: row.review?.reviewedAt?.toISOString() ?? null,
        createdAt: row.answer.createdAt.toISOString(),
        userId: row.attempt.userId,
        userName: `${row.user.firstName} ${row.user.lastName}`,
        quizId: row.attempt.quizId,
        questionPrompt: row.question.prompt,
        optionIds: row.answer.optionIds,
        textAnswer: row.answer.textAnswer,
        rating: row.answer.rating,
        photoId: row.answer.photoId,
      });
    }
    const start = (query.page - 1) * query.pageSize;
    return { data: data.slice(start, start + query.pageSize), pagination: { page: query.page, pageSize: query.pageSize, total: data.length, totalPages: Math.ceil(data.length / query.pageSize) } };
  }

  async review(principal: TrustedPrincipal, attemptId: string, questionId: string, input: QuizReviewInput) {
    assertActivePrincipal(principal);
    if (principal.role !== "admin" && principal.role !== "manager") throw new DomainError(403, "FORBIDDEN", "Only administrators and managers can review quiz answers");
    const data = quizReviewInputSchema.parse(input);
    const [context] = await this.db.select({ answer: quizAttemptAnswers, attempt: quizAttempts, question: quizQuestions, revision: quizRevisions }).from(quizAttemptAnswers).innerJoin(quizAttempts, eq(quizAttempts.id, quizAttemptAnswers.attemptId)).innerJoin(quizQuestions, eq(quizQuestions.id, quizAttemptAnswers.questionId)).innerJoin(quizRevisions, eq(quizRevisions.id, quizAttempts.revisionId)).where(and(eq(quizAttemptAnswers.attemptId, attemptId), eq(quizAttemptAnswers.questionId, questionId))).limit(1);
    if (!context) throw new DomainError(404, "QUIZ_ANSWER_NOT_FOUND", "Quiz answer not found");
    if (!(await this.managerCanSeeAttempt(principal, context.attempt.userId, context.attempt.revisionId))) throw new DomainError(403, "FORBIDDEN", "The quiz answer is outside the principal scope");
    if (context.answer.reviewStatus !== "pending") throw new DomainError(409, "QUIZ_ANSWER_REVIEWED", "The quiz answer has already been reviewed");
    const maxPoints = context.answer.maxPoints ?? context.question.maxPoints;
    if (data.awardedPoints > maxPoints) throw new DomainError(400, "INVALID_REVIEW_SCORE", "Awarded points exceed the question maximum");

    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select ${quizAttempts.id} from ${quizAttempts} where ${quizAttempts.id} = ${attemptId} for update`);
      const [answer] = await tx.select().from(quizAttemptAnswers).where(and(eq(quizAttemptAnswers.attemptId, attemptId), eq(quizAttemptAnswers.questionId, questionId))).limit(1);
      if (!answer || answer.reviewStatus !== "pending") throw new DomainError(409, "QUIZ_ANSWER_REVIEWED", "The quiz answer has already been reviewed");
      await tx.update(quizAttemptAnswers).set({ earnedPoints: data.awardedPoints, reviewStatus: "reviewed" }).where(and(eq(quizAttemptAnswers.attemptId, attemptId), eq(quizAttemptAnswers.questionId, questionId)));
      const [review] = await tx.insert(quizAnswerReviews).values({ attemptId, questionId, reviewerId: principal.userId, status: "reviewed", awardedPoints: data.awardedPoints, maxPoints, feedback: data.feedback, reviewedAt: new Date(), updatedAt: new Date() }).onConflictDoUpdate({ target: [quizAnswerReviews.attemptId, quizAnswerReviews.questionId], set: { reviewerId: principal.userId, status: "reviewed", awardedPoints: data.awardedPoints, feedback: data.feedback, reviewedAt: new Date(), updatedAt: new Date() } }).returning();
      await tx.insert(quizAnswerReviewHistory).values({ attemptId, questionId, reviewerId: principal.userId, previousPoints: answer.earnedPoints, awardedPoints: data.awardedPoints, feedback: data.feedback });
      await tx.insert(domainEvents).values({ eventType: "quiz.reviewed", aggregateType: "quiz_attempt", aggregateId: attemptId, actorId: principal.userId, payload: { attemptId, questionId, reviewerId: principal.userId, awardedPoints: data.awardedPoints } });
      const pending = await tx.select({ questionId: quizAttemptAnswers.questionId }).from(quizAttemptAnswers).where(and(eq(quizAttemptAnswers.attemptId, attemptId), eq(quizAttemptAnswers.reviewStatus, "pending")));
      if (pending.length === 0) {
        const allAnswers = await tx.select({ earnedPoints: quizAttemptAnswers.earnedPoints, maxPoints: quizAttemptAnswers.maxPoints }).from(quizAttemptAnswers).where(eq(quizAttemptAnswers.attemptId, attemptId));
        const earned = allAnswers.reduce((total, row) => total + (row.earnedPoints ?? 0), 0);
        const maximum = allAnswers.reduce((total, row) => total + (row.maxPoints ?? 0), 0);
        const scorePercent = maximum === 0 ? 0 : Math.floor((earned * 100) / maximum);
        await tx.update(quizAttempts).set({ reviewStatus: "completed", finalizedAt: new Date(), scorePercent: context.revision.assessmentMode === "survey" ? null : scorePercent, passed: context.revision.assessmentMode !== "survey" ? scorePercent >= context.revision.passingScore : null }).where(eq(quizAttempts.id, attemptId));
        await tx.insert(domainEvents).values({ eventType: "quiz.completed", aggregateType: "quiz_attempt", aggregateId: attemptId, actorId: principal.userId, payload: { attemptId, revisionId: context.attempt.revisionId, reviewStatus: "completed" } });
      }
      return review;
    });
    return { attemptId: result.attemptId, questionId: result.questionId, status: result.status, awardedPoints: result.awardedPoints, maxPoints: result.maxPoints, reviewerId: result.reviewerId, feedback: result.feedback, reviewedAt: result.reviewedAt?.toISOString() ?? null, createdAt: result.createdAt.toISOString() };
  }

  async attachPhoto(principal: TrustedPrincipal, attemptId: string, questionId: string, photoId: string): Promise<void> {
    await this.activeParticipant(principal);
    const attempt = await this.attemptForUser(principal, attemptId);
    if (attempt.status !== "in_progress") throw new DomainError(409, "ATTEMPT_NOT_IN_PROGRESS", "The quiz attempt is no longer accepting photos");
    if (attempt.expiresAt && attempt.expiresAt <= new Date()) throw new DomainError(409, "ATTEMPT_EXPIRED", "The quiz attempt has expired");
    const graph = await this.quizzes.getGraphForRevision(attempt.revisionId);
    const question = graph.questions.find((candidate) => candidate.id === questionId);
    if (!question || question.questionType !== "photo_answer") throw new DomainError(400, "INVALID_PHOTO_ANSWER", "The question does not accept photos");
    const [photo] = await this.db.select({ id: photos.id, uploadedBy: photos.uploadedBy }).from(photos).where(eq(photos.id, photoId)).limit(1);
    if (!photo || photo.uploadedBy !== principal.userId) throw new DomainError(403, "PHOTO_FORBIDDEN", "The photo is outside the principal scope");
    await this.db.insert(quizAnswerPhotos).values({ attemptId, questionId, photoId, uploadedBy: principal.userId }).onConflictDoUpdate({ target: [quizAnswerPhotos.attemptId, quizAnswerPhotos.questionId], set: { photoId, uploadedBy: principal.userId } });
  }

  async photoStoreId(principal: TrustedPrincipal, attemptId: string, questionId?: string): Promise<string> {
    await this.activeParticipant(principal);
    const attempt = await this.attemptForUser(principal, attemptId);
    if (attempt.status !== "in_progress") throw new DomainError(409, "ATTEMPT_NOT_IN_PROGRESS", "The quiz attempt is no longer accepting photos");
    if (questionId) {
      const graph = await this.quizzes.getGraphForRevision(attempt.revisionId);
      const question = graph.questions.find((candidate) => candidate.id === questionId);
      if (!question || question.questionType !== "photo_answer") throw new DomainError(400, "INVALID_PHOTO_ANSWER", "The question does not accept photos");
    }
    const [membership] = await this.db.select({ storeId: userStores.storeId }).from(userStores).where(eq(userStores.userId, principal.userId)).limit(1);
    if (!membership) throw new DomainError(409, "STORE_REQUIRED", "The employee has no assigned store");
    return membership.storeId;
  }
}

export function createQuizAttemptService(db: Database, quizzesService: QuizService): QuizAttemptService {
  return new QuizAttemptService(db, quizzesService);
}

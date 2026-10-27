import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type AttemptListQuery,
  attemptListQuerySchema,
  type AttemptResponse,
  type ResultResponse,
  submitAttemptInputSchema,
  type SubmitAttemptInput,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import { quizAssignments, quizAttemptAnswers, quizAttempts, quizOptions, quizQuestions, quizRevisions, userStores, users } from "../../db/schema";
import { assertActivePrincipal, type TrustedPrincipal } from "../authz";
import { DomainError, isUniqueViolation } from "../errors";
import { QuizService } from "./service";

function assertStaff(principal: TrustedPrincipal): void {
  assertActivePrincipal(principal);
  if (principal.role !== "staff") throw new DomainError(403, "FORBIDDEN", "Only staff users can take quizzes");
}

function toAttemptResponse(attempt: typeof quizAttempts.$inferSelect, quiz?: AttemptResponse["quiz"]): AttemptResponse {
  return {
    id: attempt.id,
    quizId: attempt.quizId,
    revisionId: attempt.revisionId,
    revisionNumber: 0,
    status: attempt.status,
    startedAt: attempt.startedAt.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    scorePercent: attempt.scorePercent,
    passed: attempt.passed,
    ...(quiz ? { quiz } : {}),
  };
}

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

  async start(principal: TrustedPrincipal, quizId: string): Promise<AttemptResponse> {
    await this.activeParticipant(principal);
    const quiz = await this.quizzes.getAvailable(principal, quizId);
    const [existing] = await this.db.select().from(quizAttempts).where(and(eq(quizAttempts.userId, principal.userId), eq(quizAttempts.revisionId, quiz.revisionId), eq(quizAttempts.status, "in_progress"))).limit(1);
    if (existing) return { ...toAttemptResponse(existing, quiz), revisionNumber: quiz.revisionNumber };

    try {
      const [attempt] = await this.db.insert(quizAttempts).values({ quizId, revisionId: quiz.revisionId, userId: principal.userId, status: "in_progress" }).returning();
      return { ...toAttemptResponse(attempt, quiz), revisionNumber: quiz.revisionNumber };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const [concurrent] = await this.db.select().from(quizAttempts).where(and(eq(quizAttempts.userId, principal.userId), eq(quizAttempts.revisionId, quiz.revisionId), eq(quizAttempts.status, "in_progress"))).limit(1);
        if (concurrent) return { ...toAttemptResponse(concurrent, quiz), revisionNumber: quiz.revisionNumber };
      }
      throw error;
    }
  }

  async submit(principal: TrustedPrincipal, attemptId: string, input: SubmitAttemptInput): Promise<AttemptResponse> {
    await this.activeParticipant(principal);
    const data = submitAttemptInputSchema.parse(input);
    const initial = await this.attemptForUser(principal, attemptId);
    const quiz = await this.quizzes.getAvailableForRevision(principal, initial.quizId, initial.revisionId, true);

    // A submitted attempt is immutable and its result is the idempotent response
    // for retries, even if a client retries with a different payload.
    if (initial.status === "submitted") {
      return { ...toAttemptResponse(initial, quiz), revisionNumber: quiz.revisionNumber };
    }

    const questionRows = await this.db.select().from(quizQuestions).where(eq(quizQuestions.revisionId, initial.revisionId)).orderBy(asc(quizQuestions.position));
    const optionRows = questionRows.length ? await this.db.select().from(quizOptions).where(inArray(quizOptions.questionId, questionRows.map((question) => question.id))) : [];
    const questionIds = new Set(questionRows.map((question) => question.id));
    const answerQuestionIds = new Set(data.answers.map((answer) => answer.questionId));
    if (answerQuestionIds.size !== data.answers.length || data.answers.some((answer) => !questionIds.has(answer.questionId))) {
      throw new DomainError(400, "INVALID_ANSWERS", "Answers must contain each question at most once and belong to the quiz revision");
    }

    const optionByQuestion = new Map<string, Set<string>>();
    const correctOptions = new Set<string>();
    for (const option of optionRows) {
      const options = optionByQuestion.get(option.questionId) ?? new Set<string>();
      options.add(option.id);
      optionByQuestion.set(option.questionId, options);
      if (option.isCorrect) correctOptions.add(option.id);
    }
    for (const answer of data.answers) {
      if (answer.optionId && !optionByQuestion.get(answer.questionId)?.has(answer.optionId)) {
        throw new DomainError(400, "INVALID_ANSWERS", "Answer option does not belong to its question");
      }
    }

    const selectedCorrect = data.answers.filter((answer) => answer.optionId && correctOptions.has(answer.optionId)).length;
    const scorePercent = questionRows.length === 0 ? 0 : Math.floor((selectedCorrect * 100) / questionRows.length);

    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select ${quizAttempts.id} from ${quizAttempts} where ${quizAttempts.id} = ${attemptId} for update`);
      const [locked] = await tx.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
      if (!locked || locked.userId !== principal.userId) throw new DomainError(403, "FORBIDDEN", "The attempt is outside the principal scope");
      if (locked.status === "submitted") return locked;

      const answerByQuestion = new Map(data.answers.map((answer) => [answer.questionId, answer.optionId]));
      await tx.insert(quizAttemptAnswers).values(questionRows.map((question) => ({
        attemptId,
        questionId: question.id,
        optionId: answerByQuestion.get(question.id) ?? null,
      })));
      const [submitted] = await tx.update(quizAttempts).set({
        status: "submitted",
        submittedAt: new Date(),
        scorePercent,
        passed: scorePercent >= quiz.passingScore,
      }).where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.status, "in_progress"))).returning();
      return submitted;
    });

    return { ...toAttemptResponse(result, quiz), revisionNumber: quiz.revisionNumber };
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
      const quiz = await this.quizzes.getAvailableForRevision(principal, row.quizId, row.revisionId, true);
      responses.push({ ...toAttemptResponse(row, quiz), revisionNumber: quiz.revisionNumber });
    }
    return { data: responses, pagination: { page: data.page, pageSize: data.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / data.pageSize) } };
  }

  async getMine(principal: TrustedPrincipal, attemptId: string): Promise<AttemptResponse> {
    await this.activeParticipant(principal);
    const attempt = await this.attemptForUser(principal, attemptId);
    const quiz = await this.quizzes.getAvailableForRevision(principal, attempt.quizId, attempt.revisionId, true);
    return { ...toAttemptResponse(attempt, quiz), revisionNumber: quiz.revisionNumber };
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
    const scoped = [] as ResultResponse[];
    for (const row of rows) {
      if (principal.role === "manager") {
        const membership = await this.db.select({ storeId: userStores.storeId }).from(userStores).where(and(eq(userStores.userId, row.attempt.userId), inArray(userStores.storeId, [...principal.storeIds]))).limit(1);
        if (!membership[0]) continue;
        if (row.revision.assignmentMode === "selected") {
          const assignment = await this.db.select({ storeId: quizAssignments.storeId }).from(quizAssignments).where(and(eq(quizAssignments.revisionId, row.revision.id), inArray(quizAssignments.storeId, [...principal.storeIds]))).limit(1);
          if (!assignment[0]) continue;
        }
      }
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
      });
    }
    const start = (data.page - 1) * data.pageSize;
    return { data: scoped.slice(start, start + data.pageSize), pagination: { page: data.page, pageSize: data.pageSize, total: scoped.length, totalPages: Math.ceil(scoped.length / data.pageSize) } };
  }
}

export function createQuizAttemptService(db: Database, quizzesService: QuizService): QuizAttemptService {
  return new QuizAttemptService(db, quizzesService);
}

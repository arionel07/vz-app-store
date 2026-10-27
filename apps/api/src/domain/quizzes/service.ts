import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  quizCreateInputSchema,
  quizDraftInputSchema,
  type QuizAuthoringResponse,
  type QuizCreateInput,
  type QuizDraftInput,
  type QuizListQuery,
  type QuizStaffResponse,
} from "@vizaje/contracts";
import type { z } from "zod";
import type { Database } from "../../db/client";
import {
  quizAssignments,
  quizOptions,
  quizQuestions,
  quizRevisions,
  quizzes,
  stores,
} from "../../db/schema";
import { assertActivePrincipal, type TrustedPrincipal } from "../authz";
import { DomainError } from "../errors";

type RevisionRow = typeof quizRevisions.$inferSelect;
type QuestionRow = typeof quizQuestions.$inferSelect;
type OptionRow = typeof quizOptions.$inferSelect;

interface RevisionGraph {
  revision: RevisionRow;
  storeIds: string[];
  questions: Array<QuestionRow & { options: OptionRow[] }>;
}

type QuizDraftData = z.output<typeof quizDraftInputSchema>;
type DatabaseExecutor = Pick<Database, "select" | "insert" | "update" | "delete">;

function assertAuthor(principal: TrustedPrincipal): void {
  assertActivePrincipal(principal);
  if (principal.role !== "admin" && principal.role !== "manager") {
    throw new DomainError(403, "FORBIDDEN", "Only administrators and managers can author quizzes");
  }
}

function assertStaff(principal: TrustedPrincipal): void {
  assertActivePrincipal(principal);
  if (principal.role !== "staff") throw new DomainError(403, "FORBIDDEN", "Only staff users can take quizzes");
}

function validateQuestionPositions(questions: QuizDraftData["questions"], publish: boolean): void {
  if (publish && questions.length === 0) throw new DomainError(400, "INVALID_QUIZ", "A published quiz must contain questions");

  const questionPositions = questions.map((question) => question.position);
  if (new Set(questionPositions).size !== questionPositions.length || !questionPositions.every((position, index) => position === index)) {
    throw new DomainError(400, "INVALID_QUIZ_ORDER", "Question positions must be contiguous and unique");
  }

  for (const question of questions) {
    if (publish && (question.options.length < 2 || question.options.length > 6)) {
      throw new DomainError(400, "INVALID_QUIZ_OPTIONS", "Each question must contain 2 to 6 options");
    }
    const optionPositions = question.options.map((option) => option.position);
    if (new Set(optionPositions).size !== optionPositions.length || !optionPositions.every((position, index) => position === index)) {
      throw new DomainError(400, "INVALID_OPTION_ORDER", "Option positions must be contiguous and unique");
    }
    if (publish && question.options.filter((option) => option.isCorrect).length !== 1) {
      throw new DomainError(400, "INVALID_CORRECT_OPTION", "Each question must contain exactly one correct option");
    }
  }
}

export class QuizService {
  constructor(private readonly db: Database) {}

  private async getQuiz(quizId: string) {
    const [quiz] = await this.db.select().from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
    if (!quiz) throw new DomainError(404, "QUIZ_NOT_FOUND", "Quiz not found");
    return quiz;
  }

  private async latestRevision(quizId: string, executor: DatabaseExecutor = this.db): Promise<RevisionRow | null> {
    const [revision] = await executor
      .select()
      .from(quizRevisions)
      .where(eq(quizRevisions.quizId, quizId))
      .orderBy(desc(quizRevisions.revisionNumber))
      .limit(1);
    return revision ?? null;
  }

  private async graph(revisionId: string, executor: DatabaseExecutor = this.db): Promise<RevisionGraph> {
    const [revision] = await executor.select().from(quizRevisions).where(eq(quizRevisions.id, revisionId)).limit(1);
    if (!revision) throw new DomainError(404, "QUIZ_REVISION_NOT_FOUND", "Quiz revision not found");
    const assignments = await executor.select({ storeId: quizAssignments.storeId }).from(quizAssignments).where(eq(quizAssignments.revisionId, revisionId));
    const questionRows = await executor.select().from(quizQuestions).where(eq(quizQuestions.revisionId, revisionId)).orderBy(asc(quizQuestions.position));
    const optionRows = questionRows.length
      ? await executor.select().from(quizOptions).where(inArray(quizOptions.questionId, questionRows.map((question) => question.id))).orderBy(asc(quizOptions.position))
      : [];

    return {
      revision,
      storeIds: assignments.map((assignment) => assignment.storeId),
      questions: questionRows.map((question) => ({
        ...question,
        options: optionRows.filter((option) => option.questionId === question.id),
      })),
    };
  }

  private async assertAssignmentScope(principal: TrustedPrincipal, mode: QuizDraftInput["assignmentMode"], storeIds: readonly string[]): Promise<void> {
    if (mode === "all") {
      if (principal.role !== "admin") throw new DomainError(403, "FORBIDDEN", "Managers cannot create global quiz assignments");
      return;
    }

    if (new Set(storeIds).size !== storeIds.length) throw new DomainError(409, "DUPLICATE_ASSIGNMENT", "Duplicate store assignment");
    if (principal.role === "manager" && storeIds.some((storeId) => !principal.storeIds.includes(storeId))) {
      throw new DomainError(403, "FORBIDDEN", "Quiz store assignment is outside the manager scope");
    }
    if (storeIds.length === 0) return;

    const activeStores = await this.db.select({ id: stores.id }).from(stores).where(and(inArray(stores.id, [...storeIds]), eq(stores.isActive, true)));
    if (activeStores.length !== storeIds.length) throw new DomainError(409, "STORE_UNAVAILABLE", "Quiz assignments must target active stores");
  }

  private async assertRevisionScope(principal: TrustedPrincipal, graph: RevisionGraph): Promise<void> {
    assertAuthor(principal);
    if (principal.role === "admin") return;
    if (graph.revision.assignmentMode === "all" || graph.storeIds.some((storeId) => !principal.storeIds.includes(storeId))) {
      throw new DomainError(403, "FORBIDDEN", "Quiz is outside the manager scope");
    }
  }

  private toAuthoring(quiz: typeof quizzes.$inferSelect, graph: RevisionGraph): QuizAuthoringResponse {
    return {
      id: quiz.id,
      revisionId: graph.revision.id,
      revisionNumber: graph.revision.revisionNumber,
      status: quiz.status,
      revisionStatus: graph.revision.status,
      title: graph.revision.title,
      description: graph.revision.description,
      passingScore: graph.revision.passingScore,
      assignmentMode: graph.revision.assignmentMode,
      storeIds: graph.storeIds,
      questions: graph.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        position: question.position,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          position: option.position,
          isCorrect: option.isCorrect,
        })),
      })),
      createdAt: graph.revision.createdAt.toISOString(),
      updatedAt: graph.revision.updatedAt.toISOString(),
    };
  }

  private toStaff(graph: RevisionGraph): QuizStaffResponse {
    return {
      id: graph.revision.quizId,
      revisionId: graph.revision.id,
      revisionNumber: graph.revision.revisionNumber,
      title: graph.revision.title,
      description: graph.revision.description,
      passingScore: graph.revision.passingScore,
      questions: graph.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        position: question.position,
        options: question.options.map((option) => ({ id: option.id, label: option.label, position: option.position })),
      })),
    };
  }

  private async writeRevision(executor: DatabaseExecutor, revisionId: string, input: QuizDraftData): Promise<void> {
    await executor
      .update(quizRevisions)
      .set({
        title: input.title,
        description: input.description ?? null,
        passingScore: input.passingScore,
        assignmentMode: input.assignmentMode,
        updatedAt: new Date(),
      })
      .where(eq(quizRevisions.id, revisionId));
    await executor.delete(quizAssignments).where(eq(quizAssignments.revisionId, revisionId));
    const oldQuestions = await executor.select({ id: quizQuestions.id }).from(quizQuestions).where(eq(quizQuestions.revisionId, revisionId));
    if (oldQuestions.length > 0) await executor.delete(quizQuestions).where(eq(quizQuestions.revisionId, revisionId));
    if (input.assignmentMode === "selected" && input.storeIds.length > 0) {
      await executor.insert(quizAssignments).values(input.storeIds.map((storeId) => ({ revisionId, storeId })));
    }
    for (const question of input.questions) {
      const [createdQuestion] = await executor.insert(quizQuestions).values({ revisionId, prompt: question.prompt, position: question.position }).returning({ id: quizQuestions.id });
      if (question.options.length > 0) {
        await executor.insert(quizOptions).values(question.options.map((option) => ({ questionId: createdQuestion.id, label: option.label, position: option.position, isCorrect: option.isCorrect })));
      }
    }
  }

  async createDraft(principal: TrustedPrincipal, input: QuizCreateInput): Promise<QuizAuthoringResponse> {
    assertAuthor(principal);
    const data = quizCreateInputSchema.parse(input);
    validateQuestionPositions(data.questions, false);
    await this.assertAssignmentScope(principal, data.assignmentMode, data.storeIds);
    const created = await this.db.transaction(async (tx) => {
      const [quiz] = await tx.insert(quizzes).values({ status: "draft" }).returning();
      const [revision] = await tx.insert(quizRevisions).values({
        quizId: quiz.id,
        revisionNumber: 1,
        status: "draft",
        title: data.title,
        description: data.description ?? null,
        passingScore: data.passingScore,
        assignmentMode: data.assignmentMode,
      }).returning();
      await this.writeRevision(tx, revision.id, data);
      return { quiz, revision };
    });
    return this.toAuthoring(created.quiz, await this.graph(created.revision.id));
  }

  async getAuthoring(principal: TrustedPrincipal, quizId: string): Promise<QuizAuthoringResponse> {
    const quiz = await this.getQuiz(quizId);
    const revision = await this.latestRevision(quizId);
    if (!revision) throw new DomainError(404, "QUIZ_REVISION_NOT_FOUND", "Quiz revision not found");
    const graph = await this.graph(revision.id);
    await this.assertRevisionScope(principal, graph);
    return this.toAuthoring(quiz, graph);
  }

  async saveDraft(principal: TrustedPrincipal, quizId: string, input: QuizDraftInput): Promise<QuizAuthoringResponse> {
    assertAuthor(principal);
    const data = quizDraftInputSchema.parse(input);
    validateQuestionPositions(data.questions, false);
    const quiz = await this.getQuiz(quizId);
    const latest = await this.latestRevision(quizId);
    if (!latest) throw new DomainError(404, "QUIZ_REVISION_NOT_FOUND", "Quiz revision not found");
    await this.assertRevisionScope(principal, await this.graph(latest.id));
    await this.assertAssignmentScope(principal, data.assignmentMode, data.storeIds);

    let revisionId = latest.id;
    await this.db.transaction(async (tx) => {
      if (latest.status !== "draft") {
        const [created] = await tx.insert(quizRevisions).values({
          quizId,
          revisionNumber: latest.revisionNumber + 1,
          status: "draft",
          title: data.title,
          description: data.description ?? null,
          passingScore: data.passingScore,
          assignmentMode: data.assignmentMode,
        }).returning({ id: quizRevisions.id });
        revisionId = created.id;
      }
      await tx.update(quizzes).set({ status: "draft", updatedAt: new Date() }).where(eq(quizzes.id, quizId));
      await this.writeRevision(tx, revisionId, data);
    });

    return this.toAuthoring({ ...quiz, status: "draft" }, await this.graph(revisionId));
  }

  async publish(principal: TrustedPrincipal, quizId: string): Promise<QuizAuthoringResponse> {
    assertAuthor(principal);
    const quiz = await this.getQuiz(quizId);
    const latest = await this.latestRevision(quizId);
    if (!latest || latest.status !== "draft") throw new DomainError(409, "NO_DRAFT_REVISION", "Quiz has no draft revision to publish");
    const graph = await this.graph(latest.id);
    await this.assertRevisionScope(principal, graph);
    await this.assertAssignmentScope(principal, graph.revision.assignmentMode, graph.storeIds);
    validateQuestionPositions(graph.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      position: question.position,
      options: question.options.map((option) => ({ id: option.id, label: option.label, position: option.position, isCorrect: option.isCorrect })),
    })), true);
    if (graph.revision.assignmentMode === "selected" && graph.storeIds.length === 0) throw new DomainError(400, "INVALID_ASSIGNMENT", "Published quiz needs at least one assigned store");
    if (graph.revision.assignmentMode === "all" && principal.role !== "admin") throw new DomainError(403, "FORBIDDEN", "Managers cannot publish global quizzes");

    await this.db.transaction(async (tx) => {
      await tx.update(quizRevisions).set({ status: "published", publishedAt: new Date(), updatedAt: new Date() }).where(eq(quizRevisions.id, latest.id));
      await tx.update(quizzes).set({ status: "published", updatedAt: new Date() }).where(eq(quizzes.id, quizId));
    });
    return this.toAuthoring({ ...quiz, status: "published" }, await this.graph(latest.id));
  }

  async archive(principal: TrustedPrincipal, quizId: string): Promise<void> {
    assertAuthor(principal);
    const quiz = await this.getQuiz(quizId);
    const revision = await this.latestRevision(quizId);
    if (revision) await this.assertRevisionScope(principal, await this.graph(revision.id));
    await this.db.update(quizzes).set({ status: "archived", updatedAt: new Date() }).where(eq(quizzes.id, quiz.id));
  }

  async listAuthoring(principal: TrustedPrincipal, query: QuizListQuery) {
    assertAuthor(principal);
    const filters = query.status ? [eq(quizzes.status, query.status)] : [];
    const rows = await this.db.select().from(quizzes).where(filters.length ? and(...filters) : undefined).orderBy(desc(quizzes.updatedAt));
    const data: QuizAuthoringResponse[] = [];
    for (const quiz of rows) {
      if (query.search) {
        const revision = await this.latestRevision(quiz.id);
        if (!revision || !revision.title.toLowerCase().includes(query.search.toLowerCase())) continue;
      }
      const revision = await this.latestRevision(quiz.id);
      if (!revision) continue;
      const graph = await this.graph(revision.id);
      try {
        await this.assertRevisionScope(principal, graph);
        data.push(this.toAuthoring(quiz, graph));
      } catch {
        // Managers only see quizzes within their current store scope.
      }
    }
    const start = (query.page - 1) * query.pageSize;
    const page = data.slice(start, start + query.pageSize);
    return { data: page, pagination: { page: query.page, pageSize: query.pageSize, total: data.length, totalPages: Math.ceil(data.length / query.pageSize) } };
  }

  private async publishedForStaff(principal: TrustedPrincipal, quizId?: string): Promise<QuizStaffResponse[]> {
    assertStaff(principal);
    const filters = [eq(quizzes.status, "published")];
    if (quizId) filters.push(eq(quizzes.id, quizId));
    const rows = await this.db.select().from(quizzes).where(and(...filters));
    const result: QuizStaffResponse[] = [];
    for (const quiz of rows) {
      const revisions = await this.db.select().from(quizRevisions).where(and(eq(quizRevisions.quizId, quiz.id), eq(quizRevisions.status, "published"))).orderBy(desc(quizRevisions.revisionNumber)).limit(1);
      const revision = revisions[0];
      if (!revision) continue;
      const graph = await this.graph(revision.id);
      if (revision.assignmentMode === "selected") {
        if (!graph.storeIds.some((storeId) => principal.storeIds.includes(storeId))) continue;
      } else if (principal.storeIds.length === 0) {
        continue;
      }
      result.push(this.toStaff(graph));
    }
    return result;
  }

  async listAvailable(principal: TrustedPrincipal, query: QuizListQuery) {
    const all = await this.publishedForStaff(principal);
    const filtered = query.search ? all.filter((quiz) => quiz.title.toLowerCase().includes(query.search!.toLowerCase())) : all;
    const start = (query.page - 1) * query.pageSize;
    const page = filtered.slice(start, start + query.pageSize);
    return { data: page, pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) } };
  }

  async getAvailable(principal: TrustedPrincipal, quizId: string): Promise<QuizStaffResponse> {
    const [quiz] = await this.publishedForStaff(principal, quizId);
    if (!quiz) throw new DomainError(404, "QUIZ_NOT_AVAILABLE", "Quiz is not available");
    return quiz;
  }

  async getAvailableForRevision(principal: TrustedPrincipal, quizId: string, revisionId: string, allowHistorical: boolean): Promise<QuizStaffResponse> {
    assertStaff(principal);
    const [quiz] = await this.db.select().from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
    const [revision] = await this.db.select().from(quizRevisions).where(and(eq(quizRevisions.id, revisionId), eq(quizRevisions.quizId, quizId))).limit(1);
    if (!quiz || !revision || (!allowHistorical && (quiz.status !== "published" || revision.status !== "published"))) {
      throw new DomainError(404, "QUIZ_NOT_AVAILABLE", "Quiz is not available");
    }
    const graph = await this.graph(revision.id);
    if (!allowHistorical) {
      if (revision.assignmentMode === "selected" && !graph.storeIds.some((storeId) => principal.storeIds.includes(storeId))) {
        throw new DomainError(404, "QUIZ_NOT_AVAILABLE", "Quiz is not available");
      }
      if (revision.assignmentMode === "all" && principal.storeIds.length === 0) {
        throw new DomainError(404, "QUIZ_NOT_AVAILABLE", "Quiz is not available");
      }
    }
    return this.toStaff(graph);
  }
}

export function createQuizService(db: Database): QuizService {
  return new QuizService(db);
}

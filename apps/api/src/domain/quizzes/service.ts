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
  quizAssignmentTargets,
  quizOptions,
  quizQuestions,
  quizRevisions,
  quizzes,
  stores,
  userStores,
  users,
} from "../../db/schema";
import { assertActivePrincipal, type TrustedPrincipal } from "../authz";
import { DomainError } from "../errors";

type RevisionRow = typeof quizRevisions.$inferSelect;
type QuestionRow = typeof quizQuestions.$inferSelect;
type OptionRow = typeof quizOptions.$inferSelect;

interface RevisionGraph {
  revision: RevisionRow;
  storeIds: string[];
  targets: Array<typeof quizAssignmentTargets.$inferSelect>;
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

function validateQuestionPositions(questions: QuizDraftData["questions"], publish: boolean, assessmentMode: QuizDraftData["assessmentMode"]): void {
  if (publish && questions.length === 0) throw new DomainError(400, "INVALID_QUIZ", "A published quiz must contain questions");

  const questionPositions = questions.map((question) => question.position);
  if (new Set(questionPositions).size !== questionPositions.length || !questionPositions.every((position, index) => position === index)) {
    throw new DomainError(400, "INVALID_QUIZ_ORDER", "Question positions must be contiguous and unique");
  }

  for (const question of questions) {
    const choiceType = ["single_choice", "multiple_choice", "weighted_choice", "scenario", "opinion"].includes(question.type);
    if (publish && choiceType && (question.options.length < 2 || question.options.length > 6)) {
      throw new DomainError(400, "INVALID_QUIZ_OPTIONS", "Each question must contain 2 to 6 options");
    }
    const optionPositions = question.options.map((option) => option.position);
    if (new Set(optionPositions).size !== optionPositions.length || !optionPositions.every((position, index) => position === index)) {
      throw new DomainError(400, "INVALID_OPTION_ORDER", "Option positions must be contiguous and unique");
    }
    if (publish && question.type === "multiple_choice" && question.options.filter((option) => option.isCorrect).length < 1) {
      throw new DomainError(400, "INVALID_CORRECT_OPTION", "Multiple-choice questions need at least one correct option");
    }
    if (publish && question.type === "single_choice" && question.options.filter((option) => option.isCorrect).length !== 1) {
      throw new DomainError(400, "INVALID_CORRECT_OPTION", "Each question must contain exactly one correct option");
    }
    if (publish && assessmentMode === "survey" && ["single_choice", "multiple_choice", "weighted_choice", "scenario", "opinion", "rating"].includes(question.type) && question.options.some((option) => option.isCorrect)) {
      throw new DomainError(400, "SURVEY_CANNOT_BE_SCORED", "Survey questions cannot contain correct answers");
    }
    if (publish && question.type === "rating") {
      const minimum = question.config.minimum;
      const maximum = question.config.maximum;
      if (typeof minimum !== "number" || typeof maximum !== "number" || minimum >= maximum || maximum - minimum > 100) throw new DomainError(400, "INVALID_RATING_SCALE", "Rating scale must define a valid minimum and maximum");
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
    const targets = await executor.select().from(quizAssignmentTargets).where(eq(quizAssignmentTargets.revisionId, revisionId));
    const questionRows = await executor.select().from(quizQuestions).where(eq(quizQuestions.revisionId, revisionId)).orderBy(asc(quizQuestions.position));
    const optionRows = questionRows.length
      ? await executor.select().from(quizOptions).where(inArray(quizOptions.questionId, questionRows.map((question) => question.id))).orderBy(asc(quizOptions.position))
      : [];

    return {
      revision,
      storeIds: assignments.map((assignment) => assignment.storeId),
      targets,
      questions: questionRows.map((question) => ({
        ...question,
        options: optionRows.filter((option) => option.questionId === question.id),
      })),
    };
  }

  private async assertAssignmentScope(principal: TrustedPrincipal, mode: QuizDraftInput["assignmentMode"], storeIds: readonly string[], targets: QuizDraftData["assignmentTargets"] = []): Promise<void> {
    if (mode === "all") {
      if (principal.role !== "admin") throw new DomainError(403, "FORBIDDEN", "Managers cannot create global quiz assignments");
    } else {
      if (new Set(storeIds).size !== storeIds.length) throw new DomainError(409, "DUPLICATE_ASSIGNMENT", "Duplicate store assignment");
      if (principal.role === "manager" && storeIds.some((storeId) => !principal.storeIds.includes(storeId))) throw new DomainError(403, "FORBIDDEN", "Quiz store assignment is outside the manager scope");
      if (storeIds.length > 0) {
        const activeStores = await this.db.select({ id: stores.id }).from(stores).where(and(inArray(stores.id, [...storeIds]), eq(stores.isActive, true)));
        if (activeStores.length !== storeIds.length) throw new DomainError(409, "STORE_UNAVAILABLE", "Quiz assignments must target active stores");
      }
    }
    const targetKeys = new Set<string>();
    for (const target of targets) {
      const key = `${target.type}:${target.storeId ?? target.role ?? target.userId}`;
      if (targetKeys.has(key)) throw new DomainError(409, "DUPLICATE_ASSIGNMENT", "Duplicate quiz assignment target");
      targetKeys.add(key);
      if (target.type === "store") {
        if (!target.storeId || (principal.role === "manager" && !principal.storeIds.includes(target.storeId))) throw new DomainError(403, "FORBIDDEN", "Quiz store assignment is outside the manager scope");
        const [store] = await this.db.select({ id: stores.id, isActive: stores.isActive }).from(stores).where(eq(stores.id, target.storeId)).limit(1);
        if (!store?.isActive) throw new DomainError(409, "STORE_UNAVAILABLE", "Quiz assignments must target active stores");
      }
      if (target.type === "role" && principal.role === "manager" && target.role !== "staff") throw new DomainError(403, "FORBIDDEN", "Managers can assign quizzes only to staff");
      if (target.type === "user") {
        const [user] = await this.db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, target.userId!)).limit(1);
        if (!user?.isActive) throw new DomainError(409, "USER_UNAVAILABLE", "Quiz assignment target is inactive");
        if (principal.role === "manager" && (user.role !== "staff" || !(await this.db.select({ storeId: userStores.storeId }).from(userStores).where(and(eq(userStores.userId, user.id), inArray(userStores.storeId, [...principal.storeIds]))).limit(1))[0])) throw new DomainError(403, "FORBIDDEN", "Quiz employee assignment is outside the manager scope");
      }
    }
  }

  private async assertRevisionScope(principal: TrustedPrincipal, graph: RevisionGraph): Promise<void> {
    assertAuthor(principal);
    if (principal.role === "admin") return;
    if (graph.revision.assignmentMode === "all" || graph.storeIds.some((storeId) => !principal.storeIds.includes(storeId)) || graph.targets.some((target) => target.targetType === "store" && target.storeId !== null && !principal.storeIds.includes(target.storeId))) {
      throw new DomainError(403, "FORBIDDEN", "Quiz is outside the manager scope");
    }
    if (graph.targets.some((target) => target.targetType === "role" && target.role !== "staff")) throw new DomainError(403, "FORBIDDEN", "Managers can only manage staff quiz targets");
    for (const target of graph.targets.filter((candidate) => candidate.targetType === "user" && candidate.userId)) {
      const [membership] = await this.db.select({ storeId: userStores.storeId }).from(userStores).where(and(eq(userStores.userId, target.userId!), inArray(userStores.storeId, [...principal.storeIds]))).limit(1);
      if (!membership) throw new DomainError(403, "FORBIDDEN", "Quiz employee target is outside the manager scope");
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
      assessmentMode: graph.revision.assessmentMode,
      maxAttempts: graph.revision.maxAttempts,
      availableFrom: graph.revision.availableFrom?.toISOString() ?? null,
      deadline: graph.revision.deadline?.toISOString() ?? null,
      timeLimitSeconds: graph.revision.timeLimitSeconds,
      randomizeQuestions: graph.revision.randomizeQuestions,
      randomizeOptions: graph.revision.randomizeOptions,
      showResults: graph.revision.showResults,
      showExplanations: graph.revision.showExplanations,
      assignmentTargets: graph.targets.map((target) => ({ type: target.targetType, ...(target.storeId ? { storeId: target.storeId } : {}), ...(target.role ? { role: target.role } : {}), ...(target.userId ? { userId: target.userId } : {}) })),
      questions: graph.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        description: question.description,
        position: question.position,
        type: question.questionType,
        maxPoints: question.maxPoints,
        scoringPolicy: question.scoringPolicy,
        config: question.config,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          position: option.position,
          isCorrect: option.isCorrect,
          points: option.points,
          explanation: option.explanation,
        })),
      })),
      createdAt: graph.revision.createdAt.toISOString(),
      updatedAt: graph.revision.updatedAt.toISOString(),
    };
  }

  private toStaff(graph: RevisionGraph, order?: { questionOrder?: string[] | null; optionOrder?: Record<string, string[]> | null }): QuizStaffResponse {
    const questionRows = order?.questionOrder?.length ? order.questionOrder.map((id) => graph.questions.find((question) => question.id === id)).filter((question): question is RevisionGraph["questions"][number] => Boolean(question)) : graph.questions;
    return {
      id: graph.revision.quizId,
      revisionId: graph.revision.id,
      revisionNumber: graph.revision.revisionNumber,
      title: graph.revision.title,
      description: graph.revision.description,
      passingScore: graph.revision.passingScore,
      assessmentMode: graph.revision.assessmentMode,
      maxAttempts: graph.revision.maxAttempts,
      deadline: graph.revision.deadline?.toISOString() ?? null,
      timeLimitSeconds: graph.revision.timeLimitSeconds,
      showResults: graph.revision.showResults,
      showExplanations: graph.revision.showExplanations,
      questions: questionRows.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        description: question.description,
        position: question.position,
        type: question.questionType,
        config: this.staffQuestionConfig(question),
        options: (order?.optionOrder?.[question.id]?.length ? order.optionOrder[question.id].map((id) => question.options.find((option) => option.id === id)).filter((option): option is OptionRow => Boolean(option)) : question.options).map((option) => ({ id: option.id, label: option.label, position: option.position, ...(graph.revision.showExplanations ? { explanation: option.explanation } : {}) })),
      })),
    };
  }

  private staffQuestionConfig(question: QuestionRow): Record<string, unknown> {
    if (question.questionType === "rating") {
      return {
        minimum: typeof question.config.minimum === "number" ? question.config.minimum : 1,
        maximum: typeof question.config.maximum === "number" ? question.config.maximum : 5,
      };
    }
    if (question.questionType === "scenario") return { selectionMode: question.config.selectionMode === "multiple" ? "multiple" : "single" };
    if (question.questionType === "free_text" && typeof question.config.maxLength === "number") return { maxLength: question.config.maxLength };
    return {};
  }

  private async writeRevision(executor: DatabaseExecutor, revisionId: string, input: QuizDraftData): Promise<void> {
    await executor
      .update(quizRevisions)
      .set({
        title: input.title,
        description: input.description ?? null,
        passingScore: input.passingScore,
        assignmentMode: input.assignmentMode,
        assessmentMode: input.assessmentMode,
        maxAttempts: input.maxAttempts,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
        deadline: input.deadline ? new Date(input.deadline) : null,
        timeLimitSeconds: input.timeLimitSeconds,
        randomizeQuestions: input.randomizeQuestions,
        randomizeOptions: input.randomizeOptions,
        showResults: input.showResults,
        showExplanations: input.showExplanations,
        updatedAt: new Date(),
      })
      .where(eq(quizRevisions.id, revisionId));
    await executor.delete(quizAssignments).where(eq(quizAssignments.revisionId, revisionId));
    await executor.delete(quizAssignmentTargets).where(eq(quizAssignmentTargets.revisionId, revisionId));
    const oldQuestions = await executor.select({ id: quizQuestions.id }).from(quizQuestions).where(eq(quizQuestions.revisionId, revisionId));
    if (oldQuestions.length > 0) await executor.delete(quizQuestions).where(eq(quizQuestions.revisionId, revisionId));
    if (input.assignmentMode === "selected" && input.storeIds.length > 0) {
      await executor.insert(quizAssignments).values(input.storeIds.map((storeId) => ({ revisionId, storeId })));
    }
    for (const question of input.questions) {
      const [createdQuestion] = await executor.insert(quizQuestions).values({ revisionId, prompt: question.prompt, description: question.description, position: question.position, questionType: question.type, maxPoints: question.maxPoints, scoringPolicy: question.scoringPolicy, config: question.config }).returning({ id: quizQuestions.id });
      if (question.options.length > 0) {
        await executor.insert(quizOptions).values(question.options.map((option) => ({ questionId: createdQuestion.id, label: option.label, position: option.position, isCorrect: option.isCorrect, points: option.points, explanation: option.explanation })));
      }
    }
    if (input.assignmentTargets.length > 0) await executor.insert(quizAssignmentTargets).values(input.assignmentTargets.map((target) => ({ revisionId, targetType: target.type, storeId: target.storeId ?? null, role: target.role ?? null, userId: target.userId ?? null })));
  }

  async createDraft(principal: TrustedPrincipal, input: QuizCreateInput): Promise<QuizAuthoringResponse> {
    assertAuthor(principal);
    const data = quizCreateInputSchema.parse(input);
    validateQuestionPositions(data.questions, false, data.assessmentMode);
    await this.assertAssignmentScope(principal, data.assignmentMode, data.storeIds, data.assignmentTargets);
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
        assessmentMode: data.assessmentMode,
        maxAttempts: data.maxAttempts,
        availableFrom: data.availableFrom ? new Date(data.availableFrom) : null,
        deadline: data.deadline ? new Date(data.deadline) : null,
        timeLimitSeconds: data.timeLimitSeconds,
        randomizeQuestions: data.randomizeQuestions,
        randomizeOptions: data.randomizeOptions,
        showResults: data.showResults,
        showExplanations: data.showExplanations,
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
    validateQuestionPositions(data.questions, false, data.assessmentMode);
    const quiz = await this.getQuiz(quizId);
    const latest = await this.latestRevision(quizId);
    if (!latest) throw new DomainError(404, "QUIZ_REVISION_NOT_FOUND", "Quiz revision not found");
    await this.assertRevisionScope(principal, await this.graph(latest.id));
    await this.assertAssignmentScope(principal, data.assignmentMode, data.storeIds, data.assignmentTargets);

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
          assessmentMode: data.assessmentMode,
          maxAttempts: data.maxAttempts,
          availableFrom: data.availableFrom ? new Date(data.availableFrom) : null,
          deadline: data.deadline ? new Date(data.deadline) : null,
          timeLimitSeconds: data.timeLimitSeconds,
          randomizeQuestions: data.randomizeQuestions,
          randomizeOptions: data.randomizeOptions,
          showResults: data.showResults,
          showExplanations: data.showExplanations,
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
    await this.assertAssignmentScope(principal, graph.revision.assignmentMode, graph.storeIds, graph.targets.map((target) => ({ type: target.targetType, ...(target.storeId ? { storeId: target.storeId } : {}), ...(target.role ? { role: target.role } : {}), ...(target.userId ? { userId: target.userId } : {}) })));
    validateQuestionPositions(graph.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      description: question.description,
      position: question.position,
      type: question.questionType,
      maxPoints: question.maxPoints,
      scoringPolicy: question.scoringPolicy,
      config: question.config,
      options: question.options.map((option) => ({ id: option.id, label: option.label, position: option.position, isCorrect: option.isCorrect, points: option.points, explanation: option.explanation })),
    })), true, graph.revision.assessmentMode);
    if (graph.revision.assignmentMode === "selected" && graph.storeIds.length === 0 && graph.targets.length === 0) throw new DomainError(400, "INVALID_ASSIGNMENT", "Published quiz needs at least one assigned target");
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
      if (!this.isEligibleForStaff(principal, graph) || !this.isOpenForStaff(graph)) continue;
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

  private isOpenForStaff(graph: RevisionGraph, now = new Date()): boolean {
    return (!graph.revision.availableFrom || graph.revision.availableFrom <= now) && (!graph.revision.deadline || graph.revision.deadline > now);
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
      if (!this.isEligibleForStaff(principal, graph) || !this.isOpenForStaff(graph)) throw new DomainError(404, "QUIZ_NOT_AVAILABLE", "Quiz is not available");
    }
    return this.toStaff(graph);
  }

  isEligibleForStaff(principal: TrustedPrincipal, graph: RevisionGraph): boolean {
    if (principal.role !== "staff" || principal.storeIds.length === 0) return false;
    if (graph.targets.length > 0) return graph.targets.some((target) => target.targetType === "user" ? target.userId === principal.userId : target.targetType === "role" ? target.role === principal.role : Boolean(target.storeId && principal.storeIds.includes(target.storeId)));
    return graph.revision.assignmentMode === "selected" ? graph.storeIds.some((storeId) => principal.storeIds.includes(storeId)) : true;
  }

  async getGraphForRevision(revisionId: string): Promise<RevisionGraph> { return this.graph(revisionId); }

  async getStaffForRevision(revisionId: string, order?: { questionOrder?: string[] | null; optionOrder?: Record<string, string[]> | null }): Promise<QuizStaffResponse> {
    return this.toStaff(await this.graph(revisionId), order);
  }
}

export function createQuizService(db: Database): QuizService {
  return new QuizService(db);
}

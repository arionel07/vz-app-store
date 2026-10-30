import { and, asc, desc, eq, gte, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  taskChecklistUpdateSchema, taskCreateSchema, taskListQuerySchema, taskRecurrenceCreateSchema, taskRecurrenceGenerateSchema, taskReviewSchema, taskSubmitSchema, taskTemplateCreateSchema, taskTemplateUpdateSchema, taskUpdateSchema,
  type TaskChecklistUpdate, type TaskCreate, type TaskListQuery, type TaskRecurrenceCreate, type TaskRecurrenceGenerate, type TaskReview, type TaskSubmit, type TaskTemplateCreate, type TaskTemplateUpdate, type TaskUpdate,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import { domainEvents, stores, taskChecklistItems, taskEvidence, taskOccurrences, taskRecurrences, taskReviewHistory, taskSubmissions, taskTemplateChecklistItems, taskTemplateVersions, taskTemplates, userStores, users } from "../../db/schema";
import { assertActivePrincipal, type TrustedPrincipal } from "../authz";
import { DomainError, isUniqueViolation } from "../errors";
import { assertTimezone, dateRange, localDateTimeToUtc } from "../schedules/timezone";
import { detectPhotoType, normalizePhotoImage, type PhotoProcessingLimits, PhotoImageError } from "../photos/image-processing";
import type { Logger } from "../../lib/logger";
import type { PhotoStorage } from "../../storage/photo-storage";

type Executor = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
type TaskRow = typeof taskOccurrences.$inferSelect;
type TemplateVersionRow = typeof taskTemplateVersions.$inferSelect;

function assertManagement(principal: TrustedPrincipal): void { assertActivePrincipal(principal); if (principal.role === "staff") throw new DomainError(403, "FORBIDDEN", "Сотрудники не могут управлять заданиями"); }
function assertDateOrder(from: string, to: string): void { dateRange(from, to); }
function now(): Date { return new Date(); }

async function lock(executor: Executor, key: string, scope: number): Promise<void> { await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, ${scope}))`); }

function evidenceResponse(row: typeof taskEvidence.$inferSelect) {
  return { id: row.id, taskId: row.taskId, submissionId: row.submissionId, uploadedBy: row.uploadedBy, originalFilename: row.originalFilename, mimeType: row.mimeType as "image/jpeg" | "image/png" | "image/webp", fileSize: row.fileSize, createdAt: row.createdAt.toISOString() };
}

export class TasksService {
  constructor(private readonly db: Database, private readonly storage: PhotoStorage, private readonly limits: PhotoProcessingLimits, private readonly logger?: Logger) {}

  private async requireStore(principal: TrustedPrincipal, storeId: string, executor: Executor = this.db) {
    const [store] = await executor.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!store) throw new DomainError(404, "STORE_NOT_FOUND", "Магазин не найден");
    if (!store.isActive || (principal.role === "manager" && !principal.storeIds.includes(storeId))) throw new DomainError(403, "STORE_FORBIDDEN", "Магазин находится вне зоны доступа");
    return store;
  }

  private async resolveEmployees(principal: TrustedPrincipal, storeId: string, employeeIds: readonly string[], roles: readonly string[], executor: Executor = this.db): Promise<string[]> {
    await this.requireStore(principal, storeId, executor);
    if (principal.role === "manager" && roles.some((role) => role !== "staff")) throw new DomainError(403, "FORBIDDEN", "Менеджер может назначать задания только сотрудникам");
    const candidates = await executor.select({ id: users.id, role: users.role }).from(users).innerJoin(userStores, eq(userStores.userId, users.id)).where(and(eq(userStores.storeId, storeId), eq(users.isActive, true), inArray(users.role, principal.role === "manager" ? ["staff"] as const : ["staff", "manager"] as const)));
    const candidateIds = new Set(candidates.filter((row) => roles.includes(row.role)).map((row) => row.id));
    for (const employeeId of employeeIds) {
      const match = candidates.find((row) => row.id === employeeId);
      if (!match || (principal.role === "manager" && match.role !== "staff")) throw new DomainError(403, "EMPLOYEE_FORBIDDEN", "Сотрудник находится вне зоны доступа");
      candidateIds.add(employeeId);
    }
    const result = [...candidateIds];
    if (!result.length) throw new DomainError(400, "ASSIGNMENT_REQUIRED", "Выберите сотрудников или роли для назначения задания");
    return result;
  }

  private async latestTemplate(templateId: string, executor: Executor = this.db): Promise<{ template: typeof taskTemplates.$inferSelect; version: TemplateVersionRow }> {
    const [template] = await executor.select().from(taskTemplates).where(eq(taskTemplates.id, templateId)).limit(1);
    if (!template || !template.active) throw new DomainError(404, "TASK_TEMPLATE_NOT_FOUND", "Шаблон задания не найден");
    const [version] = await executor.select().from(taskTemplateVersions).where(eq(taskTemplateVersions.templateId, templateId)).orderBy(desc(taskTemplateVersions.version)).limit(1);
    if (!version) throw new DomainError(409, "TASK_TEMPLATE_INVALID", "У шаблона нет версии");
    return { template, version };
  }

  private async templateChecklist(versionId: string, executor: Executor = this.db) { return executor.select().from(taskTemplateChecklistItems).where(eq(taskTemplateChecklistItems.versionId, versionId)).orderBy(asc(taskTemplateChecklistItems.position)); }

  private async createTemplateVersion(executor: Executor, templateId: string, input: { title: string; description?: string | null; category: string; priority: "low" | "normal" | "high" | "urgent"; requiresReview: boolean; requiresPhoto: boolean; checklist: Array<{ label: string; isRequired: boolean; requiresEvidence: boolean }> }, actorId: string): Promise<TemplateVersionRow> {
    const [last] = await executor.select({ version: taskTemplateVersions.version }).from(taskTemplateVersions).where(eq(taskTemplateVersions.templateId, templateId)).orderBy(desc(taskTemplateVersions.version)).limit(1);
    const [version] = await executor.insert(taskTemplateVersions).values({ templateId, version: (last?.version ?? 0) + 1, title: input.title, description: input.description ?? null, category: input.category, priority: input.priority, requiresReview: input.requiresReview, requiresPhoto: input.requiresPhoto, createdBy: actorId }).returning();
    if (input.checklist.length) await executor.insert(taskTemplateChecklistItems).values(input.checklist.map((item, position) => ({ versionId: version.id, position, label: item.label, isRequired: item.isRequired, requiresEvidence: item.requiresEvidence })));
    return version;
  }

  async createTemplate(principal: TrustedPrincipal, input: TaskTemplateCreate) {
    assertManagement(principal); const data = taskTemplateCreateSchema.parse(input);
    const id = await this.db.transaction(async (tx) => { const [template] = await tx.insert(taskTemplates).values({ title: data.title, description: data.description ?? null, category: data.category, defaultPriority: data.defaultPriority, requiresReview: data.requiresReview, requiresPhoto: data.requiresPhoto, active: data.active, createdBy: principal.userId }).returning({ id: taskTemplates.id }); await this.createTemplateVersion(tx, template.id, { ...data, priority: data.defaultPriority }, principal.userId); await tx.insert(domainEvents).values({ eventType: "task.updated", aggregateType: "task_template", aggregateId: template.id, actorId: principal.userId, payload: { templateId: template.id, action: "created" } }); return template.id; });
    return this.templateResponse(id);
  }

  async updateTemplate(principal: TrustedPrincipal, templateId: string, input: TaskTemplateUpdate) {
    assertManagement(principal); const data = taskTemplateUpdateSchema.parse(input); const current = await this.latestTemplate(templateId); const merged = { title: data.title ?? current.template.title, description: data.description === undefined ? current.template.description : data.description, category: data.category ?? current.template.category, priority: data.defaultPriority ?? current.template.defaultPriority, requiresReview: data.requiresReview ?? current.template.requiresReview, requiresPhoto: data.requiresPhoto ?? current.template.requiresPhoto, checklist: data.checklist ?? (await this.templateChecklist(current.version.id)).map((item) => ({ label: item.label, isRequired: item.isRequired, requiresEvidence: item.requiresEvidence })) };
    await this.db.transaction(async (tx) => { await tx.update(taskTemplates).set({ title: merged.title, description: merged.description, category: merged.category, defaultPriority: merged.priority, requiresReview: merged.requiresReview, requiresPhoto: merged.requiresPhoto, active: data.active ?? current.template.active, updatedAt: now() }).where(eq(taskTemplates.id, templateId)); await this.createTemplateVersion(tx, templateId, merged, principal.userId); await tx.insert(domainEvents).values({ eventType: "task.updated", aggregateType: "task_template", aggregateId: templateId, actorId: principal.userId, payload: { templateId, action: "updated" } }); });
    return this.templateResponse(templateId);
  }

  private async templateResponse(templateId: string) {
    const { template, version } = await this.latestTemplate(templateId); const checklist = await this.templateChecklist(version.id);
    return { id: template.id, title: template.title, description: template.description, category: template.category, defaultPriority: template.defaultPriority, requiresReview: template.requiresReview, requiresPhoto: template.requiresPhoto, active: template.active, version: version.version, checklist: checklist.map((item) => ({ position: item.position, label: item.label, isRequired: item.isRequired, requiresEvidence: item.requiresEvidence })), createdBy: template.createdBy, createdAt: template.createdAt.toISOString(), updatedAt: template.updatedAt.toISOString() };
  }

  async listTemplates(principal: TrustedPrincipal, input: { page: number; pageSize: number; active?: boolean }) { assertManagement(principal); const query = taskListQuerySchema.pick({ page: true, pageSize: true }).parse(input); const filters = [input.active === undefined ? sql`true` : eq(taskTemplates.active, input.active)]; const [{ total }] = await this.db.select({ total: sql<number>`count(*)` }).from(taskTemplates).where(and(...filters)); const rows = await this.db.select({ id: taskTemplates.id }).from(taskTemplates).where(and(...filters)).orderBy(desc(taskTemplates.updatedAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize); return { data: await Promise.all(rows.map((row) => this.templateResponse(row.id))), pagination: { page: query.page, pageSize: query.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / query.pageSize) } }; }

  private async taskRow(taskId: string, executor: Executor = this.db): Promise<TaskRow> { const [row] = await executor.select().from(taskOccurrences).where(eq(taskOccurrences.id, taskId)).limit(1); if (!row) throw new DomainError(404, "TASK_NOT_FOUND", "Задание не найдено"); return row; }

  private async assertTaskManagementScope(principal: TrustedPrincipal, task: TaskRow, executor: Executor = this.db): Promise<void> { assertManagement(principal); await this.requireStore(principal, task.storeId, executor); }
  private async assertStaffTask(principal: TrustedPrincipal, task: TaskRow, executor: Executor = this.db): Promise<void> { assertActivePrincipal(principal); if (principal.role !== "staff" || task.assignedEmployeeId !== principal.userId) throw new DomainError(403, "TASK_FORBIDDEN", "Задание находится вне зоны доступа"); await this.requireStore(principal, task.storeId, executor); }

  private async graph(taskId: string, executor: Executor = this.db) {
    const [row] = await executor.select({ task: taskOccurrences, storeName: stores.name, employee: users }).from(taskOccurrences).innerJoin(stores, eq(stores.id, taskOccurrences.storeId)).innerJoin(users, eq(users.id, taskOccurrences.assignedEmployeeId)).where(eq(taskOccurrences.id, taskId)).limit(1);
    if (!row) throw new DomainError(404, "TASK_NOT_FOUND", "Задание не найдено");
    const checklist = await executor.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, taskId)).orderBy(asc(taskChecklistItems.position));
    const evidenceRows = await executor.select().from(taskEvidence).where(eq(taskEvidence.taskId, taskId)).orderBy(desc(taskEvidence.createdAt));
    const [submission] = await executor.select().from(taskSubmissions).where(eq(taskSubmissions.taskId, taskId)).orderBy(desc(taskSubmissions.submissionVersion)).limit(1);
    const submissionEvidence = submission ? evidenceRows.filter((item) => item.submissionId === submission.id) : [];
    const submissionResponse = submission ? { id: submission.id, taskId: submission.taskId, submittedBy: submission.submittedBy, submissionVersion: submission.submissionVersion, status: submission.status, completionNote: submission.completionNote, reviewerComment: submission.reviewerComment, submittedAt: submission.submittedAt.toISOString(), reviewedAt: submission.reviewedAt?.toISOString() ?? null, reviewedBy: submission.reviewedBy, evidence: submissionEvidence.map(evidenceResponse) } : null;
    return { id: row.task.id, assignmentGroupId: row.task.assignmentGroupId, storeId: row.task.storeId, storeName: row.storeName, assignedEmployeeId: row.task.assignedEmployeeId, assignedEmployeeName: `${row.employee.firstName} ${row.employee.lastName}`, templateId: row.task.templateId, templateVersionId: row.task.templateVersionId, title: row.task.title, description: row.task.description, category: row.task.category, priority: row.task.priority, dueAt: row.task.dueAt?.toISOString() ?? null, timezone: row.task.timezone, status: row.task.status, requiresReview: row.task.requiresReview, requiresPhoto: row.task.requiresPhoto, version: row.task.version, overdue: Boolean(row.task.dueAt && row.task.dueAt < now() && row.task.status !== "checked"), createdBy: row.task.createdBy, createdAt: row.task.createdAt.toISOString(), updatedAt: row.task.updatedAt.toISOString(), startedAt: row.task.startedAt?.toISOString() ?? null, completedAt: row.task.completedAt?.toISOString() ?? null, checklist: checklist.map((item) => ({ id: item.id, position: item.position, label: item.label, isRequired: item.isRequired, requiresEvidence: item.requiresEvidence, completed: item.completed, note: item.note, completedAt: item.completedAt?.toISOString() ?? null })), latestSubmission: submissionResponse, evidence: evidenceRows.map(evidenceResponse) };
  }

  private async assignmentRows(principal: TrustedPrincipal, data: TaskCreate, executor: Executor): Promise<Array<{ storeId: string; employeeId: string }>> { const rows: Array<{ storeId: string; employeeId: string }> = []; const seen = new Set<string>(); for (const storeId of data.storeIds) { for (const employeeId of await this.resolveEmployees(principal, storeId, data.employeeIds, data.roles, executor)) { const key = `${storeId}:${employeeId}`; if (!seen.has(key)) { seen.add(key); rows.push({ storeId, employeeId }); } } } return rows; }

  async createTask(principal: TrustedPrincipal, input: TaskCreate) {
    assertManagement(principal); const data = taskCreateSchema.parse(input); if (data.recurrence) throw new DomainError(400, "RECURRENCE_USE_EXPLICIT_ENDPOINT", "Для повторяющегося задания используйте отдельное правило повторения"); assertTimezone(data.timezone); const assignments = await this.db.transaction(async (tx) => {
      let templateId = data.templateId ?? null; let versionId: string | null = null; let title = data.title; let description = data.description ?? null; let category = data.category; let priority = data.priority; let requiresReview = data.requiresReview; let requiresPhoto = data.requiresPhoto; let checklist = data.checklist;
      if (templateId) { const latest = await this.latestTemplate(templateId, tx); versionId = latest.version.id; title = latest.version.title; description = latest.version.description; category = latest.version.category; priority = latest.version.priority; requiresReview = latest.version.requiresReview; requiresPhoto = latest.version.requiresPhoto; if (!data.checklist.length) checklist = (await this.templateChecklist(versionId, tx)).map((item) => ({ label: item.label, isRequired: item.isRequired, requiresEvidence: item.requiresEvidence })); }
      const targets = await this.assignmentRows(principal, data, tx); const groupId = crypto.randomUUID(); const created: string[] = [];
      for (const target of targets) { const [task] = await tx.insert(taskOccurrences).values({ assignmentGroupId: groupId, templateId, templateVersionId: versionId, storeId: target.storeId, assignedEmployeeId: target.employeeId, title, description, category, priority, dueAt: data.dueAt ? new Date(data.dueAt) : null, timezone: data.timezone, requiresReview, requiresPhoto, createdBy: principal.userId }).returning({ id: taskOccurrences.id }); created.push(task.id); if (checklist.length) await tx.insert(taskChecklistItems).values(checklist.map((item, position) => ({ taskId: task.id, position, label: item.label, isRequired: item.isRequired, requiresEvidence: item.requiresEvidence }))); await tx.insert(domainEvents).values({ eventType: "task.assigned", aggregateType: "task", aggregateId: task.id, actorId: principal.userId, payload: { taskId: task.id, storeId: target.storeId, assignedEmployeeId: target.employeeId } }); }
      return created;
    });
    return this.graph(assignments[0]);
  }

  private async listWhere(principal: TrustedPrincipal, input: TaskListQuery, reviewOnly = false) {
    assertActivePrincipal(principal); const query = taskListQuerySchema.parse(input); const filters = [eq(stores.isActive, true)];
    if (principal.role === "staff") filters.push(eq(taskOccurrences.assignedEmployeeId, principal.userId)); else if (principal.role === "manager") filters.push(principal.storeIds.length ? inArray(taskOccurrences.storeId, [...principal.storeIds]) : sql`false`); else filters.push(sql`true`);
    if (query.storeId) { if (principal.role !== "admin" && !principal.storeIds.includes(query.storeId)) throw new DomainError(403, "STORE_FORBIDDEN", "Магазин находится вне зоны доступа"); filters.push(eq(taskOccurrences.storeId, query.storeId)); }
    if (query.assignedEmployeeId) filters.push(eq(taskOccurrences.assignedEmployeeId, query.assignedEmployeeId));
    if (query.status) filters.push(eq(taskOccurrences.status, query.status)); else if (reviewOnly) filters.push(eq(taskOccurrences.status, "submitted"));
    if (query.priority) filters.push(eq(taskOccurrences.priority, query.priority));
    if (query.overdue !== undefined) filters.push(query.overdue ? sql`${taskOccurrences.dueAt} is not null and ${taskOccurrences.dueAt} < now() and ${taskOccurrences.status} <> 'checked'` : sql`not (${taskOccurrences.dueAt} is not null and ${taskOccurrences.dueAt} < now() and ${taskOccurrences.status} <> 'checked')`);
    const where = and(...filters); const [{ total }] = await this.db.select({ total: sql<number>`count(*)` }).from(taskOccurrences).innerJoin(stores, eq(stores.id, taskOccurrences.storeId)).where(where); const rows = await this.db.select({ id: taskOccurrences.id }).from(taskOccurrences).innerJoin(stores, eq(stores.id, taskOccurrences.storeId)).where(where).orderBy(asc(taskOccurrences.status), asc(taskOccurrences.dueAt), desc(taskOccurrences.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize); return { rows, pagination: { page: query.page, pageSize: query.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / query.pageSize) } };
  }

  async list(principal: TrustedPrincipal, input: TaskListQuery) { const { rows, pagination } = await this.listWhere(principal, input); return { data: await Promise.all(rows.map((row) => this.graph(row.id))), pagination }; }
  async listReviews(principal: TrustedPrincipal, input: TaskListQuery) { assertManagement(principal); const { rows, pagination } = await this.listWhere(principal, { ...input, status: "submitted" }, true); return { data: await Promise.all(rows.map((row) => this.graph(row.id))), pagination }; }
  async get(principal: TrustedPrincipal, taskId: string) { const task = await this.taskRow(taskId); if (principal.role === "staff") await this.assertStaffTask(principal, task); else await this.assertTaskManagementScope(principal, task); return this.graph(taskId); }

  async update(principal: TrustedPrincipal, taskId: string, input: TaskUpdate) { assertManagement(principal); const data = taskUpdateSchema.parse(input); const task = await this.taskRow(taskId); await this.assertTaskManagementScope(principal, task); if (["submitted", "checked"].includes(task.status)) throw new DomainError(409, "TASK_IMMUTABLE", "Завершённое задание изменяется новой постановкой"); const [updated] = await this.db.update(taskOccurrences).set({ title: data.title ?? task.title, description: data.description === undefined ? task.description : data.description, category: data.category ?? task.category, priority: data.priority ?? task.priority, dueAt: data.dueAt === undefined ? task.dueAt : data.dueAt ? new Date(data.dueAt) : null, version: task.version + 1, updatedAt: now() }).where(and(eq(taskOccurrences.id, taskId), eq(taskOccurrences.version, data.expectedVersion))).returning({ id: taskOccurrences.id }); if (!updated) throw new DomainError(409, "TASK_VERSION_CONFLICT", "Задание уже изменено другим пользователем"); await this.db.insert(domainEvents).values({ eventType: "task.updated", aggregateType: "task", aggregateId: taskId, actorId: principal.userId, payload: { taskId } }); return this.graph(taskId); }

  async start(principal: TrustedPrincipal, taskId: string) { const task = await this.taskRow(taskId); await this.assertStaffTask(principal, task); if (task.status === "in_progress") return this.graph(taskId); if (!["assigned", "rejected"].includes(task.status)) throw new DomainError(409, "TASK_TRANSITION_INVALID", "Задание нельзя начать в текущем статусе"); const [updated] = await this.db.update(taskOccurrences).set({ status: "in_progress", startedAt: task.startedAt ?? now(), version: task.version + 1, updatedAt: now() }).where(and(eq(taskOccurrences.id, taskId), eq(taskOccurrences.version, task.version), inArray(taskOccurrences.status, ["assigned", "rejected"]))).returning({ id: taskOccurrences.id }); if (!updated) throw new DomainError(409, "TASK_VERSION_CONFLICT", "Задание уже изменено"); await this.db.insert(taskReviewHistory).values({ taskId, actorId: principal.userId, action: "started", previousStatus: task.status, nextStatus: "in_progress" }); await this.db.insert(domainEvents).values({ eventType: "task.started", aggregateType: "task", aggregateId: taskId, actorId: principal.userId, payload: { taskId } }); return this.graph(taskId); }

  async updateChecklist(principal: TrustedPrincipal, taskId: string, itemId: string, input: TaskChecklistUpdate) { const data = taskChecklistUpdateSchema.parse(input); const task = await this.taskRow(taskId); await this.assertStaffTask(principal, task); if (!["in_progress", "rejected"].includes(task.status)) throw new DomainError(409, "TASK_TRANSITION_INVALID", "Чеклист нельзя изменять в текущем статусе"); const [item] = await this.db.select().from(taskChecklistItems).where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, taskId))).limit(1); if (!item) throw new DomainError(404, "CHECKLIST_ITEM_NOT_FOUND", "Пункт чеклиста не найден"); const [updated] = await this.db.update(taskOccurrences).set({ version: task.version + 1, updatedAt: now() }).where(and(eq(taskOccurrences.id, taskId), eq(taskOccurrences.version, data.expectedVersion))).returning({ id: taskOccurrences.id }); if (!updated) throw new DomainError(409, "TASK_VERSION_CONFLICT", "Задание уже изменено"); await this.db.update(taskChecklistItems).set({ completed: data.completed, note: data.note ?? null, completedBy: data.completed ? principal.userId : null, completedAt: data.completed ? now() : null }).where(eq(taskChecklistItems.id, itemId)); return this.graph(taskId); }

  async submit(principal: TrustedPrincipal, taskId: string, input: TaskSubmit, idempotencyKey?: string) {
    const data = taskSubmitSchema.parse(input);
    const task = await this.taskRow(taskId);
    await this.assertStaffTask(principal, task);
    if (!["in_progress", "rejected"].includes(task.status)) throw new DomainError(409, "TASK_TRANSITION_INVALID", "Задание нельзя отправить в текущем статусе");
    const key = idempotencyKey?.trim() || undefined;
    const payloadHash = key ? await this.evidenceHash(taskId, "application/json", "submit", new TextEncoder().encode(JSON.stringify(data))) : null;
    if (key) {
      const [existing] = await this.db.select({ id: taskSubmissions.id, payloadHash: taskSubmissions.idempotencyPayloadHash }).from(taskSubmissions).where(and(eq(taskSubmissions.taskId, taskId), eq(taskSubmissions.submittedBy, principal.userId), eq(taskSubmissions.idempotencyKey, key))).limit(1);
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new DomainError(409, "IDEMPOTENCY_KEY_REUSED", "Ключ идемпотентности уже использован для другого запроса");
        return this.graph(taskId);
      }
    }
    await this.db.transaction(async (tx) => {
      const items = await tx.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, taskId)).orderBy(asc(taskChecklistItems.position));
      if (items.some((item) => item.isRequired && !item.completed)) throw new DomainError(400, "CHECKLIST_INCOMPLETE", "Заполните обязательные пункты чеклиста");
      const evidence = await tx.select().from(taskEvidence).where(and(eq(taskEvidence.taskId, taskId), isNull(taskEvidence.submissionId), eq(taskEvidence.uploadedBy, principal.userId)));
      if (task.requiresPhoto && evidence.length === 0) throw new DomainError(400, "EVIDENCE_REQUIRED", "Добавьте фотографию перед отправкой");
      if (items.some((item) => item.requiresEvidence && evidence.length === 0)) throw new DomainError(400, "EVIDENCE_REQUIRED", "Для чеклиста требуется фотография");
      const [last] = await tx.select({ version: taskSubmissions.submissionVersion }).from(taskSubmissions).where(eq(taskSubmissions.taskId, taskId)).orderBy(desc(taskSubmissions.submissionVersion)).limit(1);
      const submissionStatus = task.requiresReview ? "submitted" as const : "checked" as const;
      const [submission] = await tx.insert(taskSubmissions).values({ taskId, submittedBy: principal.userId, submissionVersion: (last?.version ?? 0) + 1, status: submissionStatus, answers: items.map((item) => ({ itemId: item.id, completed: item.completed, note: item.note })), completionNote: data.completionNote ?? null, idempotencyKey: key ?? null, idempotencyPayloadHash: payloadHash, reviewedAt: task.requiresReview ? null : now() }).returning({ id: taskSubmissions.id });
      const [updated] = await tx.update(taskOccurrences).set({ status: submissionStatus, completedAt: submissionStatus === "checked" ? now() : null, version: task.version + 1, updatedAt: now() }).where(and(eq(taskOccurrences.id, taskId), eq(taskOccurrences.version, data.expectedVersion))).returning({ id: taskOccurrences.id });
      if (!updated) throw new DomainError(409, "TASK_VERSION_CONFLICT", "Задание уже изменено");
      if (evidence.length) await tx.update(taskEvidence).set({ submissionId: submission.id }).where(and(eq(taskEvidence.taskId, taskId), isNull(taskEvidence.submissionId), eq(taskEvidence.uploadedBy, principal.userId)));
      const action = submissionStatus === "checked" ? "checked" as const : task.status === "rejected" ? "resubmitted" as const : "submitted" as const;
      await tx.insert(taskReviewHistory).values({ taskId, submissionId: submission.id, actorId: principal.userId, action, previousStatus: task.status, nextStatus: submissionStatus, comment: submissionStatus === "checked" ? "Автоматическая проверка по политике задания" : null });
      await tx.insert(domainEvents).values({ eventType: action === "resubmitted" ? "task.resubmitted" : "task.submitted", aggregateType: "task", aggregateId: taskId, actorId: principal.userId, payload: { taskId, submissionId: submission.id, submissionVersion: (last?.version ?? 0) + 1 } });
      if (submissionStatus === "checked") await tx.insert(domainEvents).values({ eventType: "task.checked", aggregateType: "task", aggregateId: taskId, actorId: principal.userId, payload: { taskId, submissionId: submission.id, automatic: true } });
    });
    return this.graph(taskId);
  }

  async review(principal: TrustedPrincipal, submissionId: string, approved: boolean, input: TaskReview) {
    assertManagement(principal);
    const data = taskReviewSchema.parse(input);
    const taskId = await this.db.transaction(async (tx) => {
      await lock(tx, submissionId, 12);
      const [row] = await tx.select({ submission: taskSubmissions, task: taskOccurrences }).from(taskSubmissions).innerJoin(taskOccurrences, eq(taskOccurrences.id, taskSubmissions.taskId)).where(eq(taskSubmissions.id, submissionId)).limit(1);
      if (!row) throw new DomainError(404, "SUBMISSION_NOT_FOUND", "Отправка задания не найдена");
      await this.assertTaskManagementScope(principal, row.task, tx);
      if (row.submission.submittedBy === principal.userId) throw new DomainError(403, "SELF_APPROVAL_FORBIDDEN", "Нельзя проверить собственную отправку");
      if (row.submission.status !== "submitted" || row.task.status !== "submitted") throw new DomainError(409, "REVIEW_TRANSITION_INVALID", "Отправка уже обработана");
      if (!approved && !data.comment?.trim()) throw new DomainError(400, "REVIEW_COMMENT_REQUIRED", "Для отклонения укажите причину");
      const next = approved ? "checked" as const : "rejected" as const;
      const action = approved ? "checked" as const : "rejected" as const;
      const [updated] = await tx.update(taskOccurrences).set({ status: next, completedAt: approved ? now() : null, version: row.task.version + 1, updatedAt: now() }).where(and(eq(taskOccurrences.id, row.task.id), eq(taskOccurrences.version, data.expectedVersion), eq(taskOccurrences.status, "submitted"))).returning({ id: taskOccurrences.id });
      if (!updated) throw new DomainError(409, "TASK_VERSION_CONFLICT", "Задание уже проверяется другим пользователем");
      await tx.update(taskSubmissions).set({ status: next, reviewerComment: data.comment ?? null, reviewedAt: now(), reviewedBy: principal.userId }).where(and(eq(taskSubmissions.id, submissionId), eq(taskSubmissions.status, "submitted")));
      await tx.insert(taskReviewHistory).values({ taskId: row.task.id, submissionId, actorId: principal.userId, action, previousStatus: "submitted", nextStatus: next, comment: data.comment ?? null });
      await tx.insert(domainEvents).values({ eventType: `task.${action}`, aggregateType: "task", aggregateId: row.task.id, actorId: principal.userId, payload: { taskId: row.task.id, submissionId } });
      return row.task.id;
    });
    return this.graph(taskId);
  }

  async listHistory(principal: TrustedPrincipal, taskId: string) { const task = await this.taskRow(taskId); if (principal.role === "staff") await this.assertStaffTask(principal, task); else await this.assertTaskManagementScope(principal, task); const rows = await this.db.select().from(taskReviewHistory).where(eq(taskReviewHistory.taskId, taskId)).orderBy(desc(taskReviewHistory.createdAt)); return { data: rows.map((row) => ({ id: row.id, taskId: row.taskId, submissionId: row.submissionId, actorId: row.actorId, action: row.action, previousStatus: row.previousStatus, nextStatus: row.nextStatus, comment: row.comment, createdAt: row.createdAt.toISOString() })) }; }

  private async evidenceHash(taskId: string, mimeType: string, filename: string, body: Uint8Array): Promise<string> { const prefix = new TextEncoder().encode(`${taskId}\u0000${mimeType}\u0000${filename}\u0000`); const payload = new Uint8Array(prefix.length + body.length); payload.set(prefix); payload.set(body, prefix.length); const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", payload)); return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
  async uploadEvidence(principal: TrustedPrincipal, taskId: string, file: File, idempotencyKey?: string) { const task = await this.taskRow(taskId); await this.assertStaffTask(principal, task); if (!["in_progress", "rejected"].includes(task.status)) throw new DomainError(409, "TASK_TRANSITION_INVALID", "Фото нельзя добавить в текущем статусе"); if (file.size <= 0 || file.size > this.limits.maxBytes) throw new DomainError(file.size > this.limits.maxBytes ? 413 : 400, "PHOTO_TOO_LARGE", "Фото имеет недопустимый размер"); const input = new Uint8Array(await file.arrayBuffer()); const signature = detectPhotoType(input); if (!signature || (file.type && file.type !== signature.mimeType)) throw new DomainError(415, "UNSUPPORTED_PHOTO", "Поддерживаются JPEG, PNG и WebP"); let body: Uint8Array; try { body = await normalizePhotoImage(input, signature, this.limits); } catch (error) { if (error instanceof PhotoImageError) throw new DomainError(error.code === "INVALID_IMAGE" ? 415 : 413, error.code, error.message); throw error; } const key = idempotencyKey?.trim() || undefined; if (key) { const [existing] = await this.db.select().from(taskEvidence).where(and(eq(taskEvidence.taskId, taskId), eq(taskEvidence.uploadedBy, principal.userId), eq(taskEvidence.idempotencyKey, key))).limit(1); if (existing) return evidenceResponse(existing); } const storageKey = `task-evidence/${crypto.randomUUID()}.${signature.extension}`; await this.storage.put(storageKey, body, signature.mimeType); try { const [created] = await this.db.insert(taskEvidence).values({ taskId, uploadedBy: principal.userId, storageKey, idempotencyKey: key ?? null, idempotencyPayloadHash: key ? await this.evidenceHash(taskId, signature.mimeType, file.name, input) : null, originalFilename: file.name.replace(/[\\/]/g, "_").slice(0, 255), mimeType: signature.mimeType, fileSize: body.byteLength }).returning(); return evidenceResponse(created); } catch (error) { await this.storage.delete(storageKey).catch((cleanupError) => this.logger?.error("Task evidence cleanup failed", { cleanupError })); if (isUniqueViolation(error) && key) { const [existing] = await this.db.select().from(taskEvidence).where(and(eq(taskEvidence.taskId, taskId), eq(taskEvidence.uploadedBy, principal.userId), eq(taskEvidence.idempotencyKey, key))).limit(1); if (existing) return evidenceResponse(existing); } throw error; } }
  async downloadEvidence(principal: TrustedPrincipal, evidenceId: string) { const [row] = await this.db.select({ evidence: taskEvidence, task: taskOccurrences }).from(taskEvidence).innerJoin(taskOccurrences, eq(taskOccurrences.id, taskEvidence.taskId)).where(eq(taskEvidence.id, evidenceId)).limit(1); if (!row) throw new DomainError(404, "EVIDENCE_NOT_FOUND", "Фото не найдено"); if (principal.role === "staff") await this.assertStaffTask(principal, row.task); else await this.assertTaskManagementScope(principal, row.task); const body = await this.storage.get(row.evidence.storageKey); if (!body) throw new DomainError(503, "PHOTO_STORAGE_UNAVAILABLE", "Хранилище фото недоступно"); return { evidence: evidenceResponse(row.evidence), body }; }

  private recurrenceDateMatches(date: string, recurrence: typeof taskRecurrences.$inferSelect): boolean {
    const start = new Date(`${recurrence.startsOn}T00:00:00Z`);
    const current = new Date(`${date}T00:00:00Z`);
    const diff = Math.floor((current.getTime() - start.getTime()) / 86400000);
    if (diff < 0) return false;
    if (recurrence.frequency === "daily") return diff % recurrence.interval === 0;
    if (recurrence.frequency === "weekly") {
      const weeks = Math.floor(diff / 7);
      return (recurrence.weekday ?? start.getUTCDay()) === current.getUTCDay() && weeks % recurrence.interval === 0;
    }
    const months = (current.getUTCFullYear() - start.getUTCFullYear()) * 12 + current.getUTCMonth() - start.getUTCMonth();
    return months >= 0 && months % recurrence.interval === 0 && current.getUTCDate() === (recurrence.monthDay ?? start.getUTCDate());
  }
  async createRecurrence(principal: TrustedPrincipal, input: TaskRecurrenceCreate) {
    assertManagement(principal);
    const data = taskRecurrenceCreateSchema.parse(input);
    assertTimezone(data.timezone);
    const created = await this.db.transaction(async (tx) => {
      const latest = await this.latestTemplate(data.templateId, tx);
      const rows = [];
      for (const storeId of data.storeIds) {
        await this.requireStore(principal, storeId, tx);
        await this.resolveEmployees(principal, storeId, data.employeeIds, data.roles, tx);
        const [row] = await tx.insert(taskRecurrences).values({ templateVersionId: latest.version.id, storeId, employeeIds: data.employeeIds, roles: data.roles, frequency: data.frequency, interval: data.interval, weekday: data.weekday ?? null, monthDay: data.monthDay ?? null, startsOn: data.startsOn, endsOn: data.endsOn ?? null, timezone: data.timezone, createdBy: principal.userId }).returning();
        rows.push(row);
      }
      return rows;
    });
    return created.map((row) => ({ id: row.id, templateId: data.templateId, storeIds: [row.storeId], frequency: row.frequency, interval: row.interval, weekday: row.weekday, monthDay: row.monthDay, startsOn: row.startsOn, endsOn: row.endsOn, timezone: row.timezone, active: row.active, createdAt: row.createdAt.toISOString() }));
  }
  async generateRecurrence(principal: TrustedPrincipal, recurrenceId: string, input: TaskRecurrenceGenerate) { assertManagement(principal); const data = taskRecurrenceGenerateSchema.parse(input); assertDateOrder(data.from, data.to); const recurrence = await this.db.select().from(taskRecurrences).where(eq(taskRecurrences.id, recurrenceId)).limit(1); if (!recurrence[0]) throw new DomainError(404, "RECURRENCE_NOT_FOUND", "Правило повторения не найдено"); const rule = recurrence[0]; await this.requireStore(principal, rule.storeId); const version = await this.db.select().from(taskTemplateVersions).where(eq(taskTemplateVersions.id, rule.templateVersionId)).limit(1); if (!version[0]) throw new DomainError(409, "TASK_TEMPLATE_INVALID", "Версия шаблона недоступна"); const checklist = await this.templateChecklist(rule.templateVersionId); const created: string[] = []; await this.db.transaction(async (tx) => { await lock(tx, rule.storeId, 11); for (const date of dateRange(data.from, data.to)) { if (!rule.active || (rule.endsOn && date > rule.endsOn) || !this.recurrenceDateMatches(date, rule)) continue; const employeeIds = await this.resolveEmployees(principal, rule.storeId, rule.employeeIds, rule.roles, tx); const dueAt = localDateTimeToUtc(date, "23:59", rule.timezone); for (const employeeId of employeeIds) { const [inserted] = await tx.insert(taskOccurrences).values({ assignmentGroupId: crypto.randomUUID(), recurrenceId, recurrenceLocalDate: date, templateId: version[0].templateId, templateVersionId: version[0].id, storeId: rule.storeId, assignedEmployeeId: employeeId, title: version[0].title, description: version[0].description, category: version[0].category, priority: version[0].priority, dueAt, timezone: rule.timezone, requiresReview: version[0].requiresReview, requiresPhoto: version[0].requiresPhoto, createdBy: principal.userId }).onConflictDoNothing({ target: [taskOccurrences.recurrenceId, taskOccurrences.storeId, taskOccurrences.assignedEmployeeId, taskOccurrences.recurrenceLocalDate] }).returning({ id: taskOccurrences.id }); if (!inserted) continue; created.push(inserted.id); if (checklist.length) await tx.insert(taskChecklistItems).values(checklist.map((item) => ({ taskId: inserted.id, position: item.position, label: item.label, isRequired: item.isRequired, requiresEvidence: item.requiresEvidence }))); await tx.insert(domainEvents).values({ eventType: "task.assigned", aggregateType: "task", aggregateId: inserted.id, actorId: principal.userId, payload: { taskId: inserted.id, recurrenceId, recurrenceLocalDate: date, assignedEmployeeId: employeeId } }); } } }); return { createdCount: created.length, taskIds: created }; }
}

export function createTasksService(db: Database, storage: PhotoStorage, limits: PhotoProcessingLimits, logger?: Logger): TasksService { return new TasksService(db, storage, limits, logger); }

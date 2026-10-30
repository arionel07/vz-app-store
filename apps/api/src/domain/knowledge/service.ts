import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  knowledgeAdminListQuerySchema,
  knowledgeArticleCreateSchema,
  knowledgeArticleUpdateSchema,
  knowledgeCategoryCreateSchema,
  knowledgeCategoryUpdateSchema,
  knowledgeStaffListQuerySchema,
  type KnowledgeAdminListQuery,
  type KnowledgeArticleCreate,
  type KnowledgeArticleUpdate,
  type KnowledgeStaffListQuery,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import {
  knowledgeAcknowledgments,
  knowledgeArticleQuizLinks,
  knowledgeArticleRevisions,
  knowledgeArticles,
  knowledgeAttachments,
  knowledgeCategories,
  knowledgeVisibilityTargets,
  domainEvents,
  quizAssignmentTargets,
  quizAssignments,
  quizRevisions,
  quizzes,
  stores,
  userStores,
  users,
} from "../../db/schema";
import type { TrustedPrincipal } from "../authz";
import { assertActivePrincipal } from "../authz";
import { DomainError } from "../errors";
import { prepareKnowledgeAttachment, safeKnowledgeFilename, validateKnowledgeMarkdown } from "./content";
import type { PhotoProcessingLimits } from "../photos/image-processing";
import type { PhotoStorage } from "../../storage/photo-storage";

type DbContext = any;

function dateValue(value: Date | null): string | null { return value?.toISOString() ?? null; }
function assertAuthor(principal: TrustedPrincipal): void { assertActivePrincipal(principal); if (principal.role === "staff") throw new DomainError(403, "FORBIDDEN", "Сотрудники не могут управлять базой знаний"); }
function assertStaff(principal: TrustedPrincipal): void { assertActivePrincipal(principal); if (principal.role !== "staff") throw new DomainError(403, "FORBIDDEN", "Материалы доступны сотрудникам приложения"); }
function unique(values: readonly string[]): string[] { return [...new Set(values)]; }

export class KnowledgeService {
  constructor(private readonly db: Database, private readonly storage?: PhotoStorage, private readonly imageLimits?: PhotoProcessingLimits) {}

  async listCategories(principal: TrustedPrincipal, includeInactive = false) {
    assertActivePrincipal(principal);
    const rows = await this.db.select().from(knowledgeCategories).where(includeInactive && principal.role !== "staff" ? undefined : eq(knowledgeCategories.isActive, true)).orderBy(asc(knowledgeCategories.sortOrder), asc(knowledgeCategories.name));
    return { data: rows.map((row: typeof knowledgeCategories.$inferSelect) => this.categoryDto(row)) };
  }

  async createCategory(principal: TrustedPrincipal, input: unknown) {
    assertActivePrincipal(principal);
    if (principal.role !== "admin") throw new DomainError(403, "FORBIDDEN", "Категории может изменять только администратор");
    const data = knowledgeCategoryCreateSchema.parse(input);
    await this.assertCategoryParent(data.parentId ?? null);
    const [row] = await this.db.insert(knowledgeCategories).values({ ...data, description: data.description ?? null, parentId: data.parentId ?? null }).returning();
    return this.categoryDto(row);
  }

  async updateCategory(principal: TrustedPrincipal, categoryId: string, input: unknown) {
    assertActivePrincipal(principal);
    if (principal.role !== "admin") throw new DomainError(403, "FORBIDDEN", "Категории может изменять только администратор");
    const data = knowledgeCategoryUpdateSchema.parse(input);
    const [current] = await this.db.select().from(knowledgeCategories).where(eq(knowledgeCategories.id, categoryId)).limit(1);
    if (!current) throw new DomainError(404, "KNOWLEDGE_CATEGORY_NOT_FOUND", "Категория не найдена");
    await this.assertCategoryParent(data.parentId === undefined ? current.parentId : data.parentId, categoryId);
    const [row] = await this.db.update(knowledgeCategories).set({ ...data, description: data.description === undefined ? current.description : data.description, parentId: data.parentId === undefined ? current.parentId : data.parentId, updatedAt: new Date() }).where(eq(knowledgeCategories.id, categoryId)).returning();
    return this.categoryDto(row);
  }

  async listManagement(principal: TrustedPrincipal, input: KnowledgeAdminListQuery) {
    assertAuthor(principal);
    const query = knowledgeAdminListQuerySchema.parse(input);
    const rows = await this.db.select().from(knowledgeArticles).where(and(query.status ? eq(knowledgeArticles.status, query.status) : undefined, query.categoryId ? eq(knowledgeArticles.categoryId, query.categoryId) : undefined)).orderBy(desc(knowledgeArticles.updatedAt));
    const visible: Array<{ article: typeof knowledgeArticles.$inferSelect; dto: any }> = [];
    for (const article of rows) {
      if (!(await this.isWithinAuthorScope(principal, article.id))) continue;
      const dto = await this.articleDto(article);
      const haystack = [dto.draft?.title, dto.draft?.summary, dto.draft?.body, dto.published?.title, dto.published?.summary, dto.published?.body].filter(Boolean).join(" ").toLocaleLowerCase();
      if (query.search && !haystack.includes(query.search.toLocaleLowerCase())) continue;
      visible.push({ article, dto });
    }
    const start = (query.page - 1) * query.pageSize;
    const data = visible.slice(start, start + query.pageSize).map((item) => item.dto);
    return { data, pagination: { page: query.page, pageSize: query.pageSize, total: visible.length, totalPages: Math.ceil(visible.length / query.pageSize) } };
  }

  async createArticle(principal: TrustedPrincipal, input: KnowledgeArticleCreate) {
    assertAuthor(principal);
    const data = knowledgeArticleCreateSchema.parse(input);
    validateKnowledgeMarkdown(data.body);
    await this.validateArticleInputs(principal, data, this.db);
    const id = await this.db.transaction(async (tx: DbContext) => {
      const [article] = await tx.insert(knowledgeArticles).values({ categoryId: data.categoryId, status: "draft", createdBy: principal.userId, requiresAcknowledgement: data.requiresAcknowledgement }).returning({ id: knowledgeArticles.id });
      const [revision] = await tx.insert(knowledgeArticleRevisions).values({ articleId: article.id, revisionNumber: 1, title: data.title, summary: data.summary ?? null, body: data.body, contentFormat: data.contentFormat, createdBy: principal.userId }).returning({ id: knowledgeArticleRevisions.id });
      await tx.update(knowledgeArticles).set({ currentDraftRevisionId: revision.id, updatedAt: new Date() }).where(eq(knowledgeArticles.id, article.id));
      await this.replaceTargets(tx, article.id, data.visibilityTargets);
      await this.replaceQuizLinks(tx, article.id, data.quizIds);
      return article.id;
    });
    return this.getManagement(principal, id);
  }

  async getManagement(principal: TrustedPrincipal, articleId: string) {
    assertAuthor(principal);
    const [article] = await this.db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, articleId)).limit(1);
    if (!article || !(await this.isWithinAuthorScope(principal, articleId))) throw new DomainError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Материал не найден");
    return this.articleDto(article);
  }

  async updateArticle(principal: TrustedPrincipal, articleId: string, input: KnowledgeArticleUpdate) {
    assertAuthor(principal);
    const data = knowledgeArticleUpdateSchema.parse(input);
    if (data.body !== undefined) validateKnowledgeMarkdown(data.body);
    const updatedId = await this.db.transaction(async (tx: DbContext) => {
      const [article] = await tx.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, articleId)).for("update").limit(1);
      if (!article || !(await this.isWithinAuthorScope(principal, articleId, tx))) throw new DomainError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Материал не найден");
      const currentTargets = await this.readTargets(tx, articleId);
      const base = await this.currentEditableRevision(tx, article);
      const merged = { categoryId: data.categoryId ?? article.categoryId, title: data.title ?? base.title, summary: data.summary === undefined ? base.summary : data.summary, body: data.body ?? base.body, contentFormat: data.contentFormat ?? base.contentFormat, visibilityTargets: data.visibilityTargets ?? currentTargets, requiresAcknowledgement: data.requiresAcknowledgement ?? article.requiresAcknowledgement, quizIds: data.quizIds ?? await this.readQuizIds(tx, articleId) };
      validateKnowledgeMarkdown(merged.body);
      await this.validateArticleInputs(principal, merged, tx);
      let draftId = article.currentDraftRevisionId;
      if (draftId) {
        await tx.update(knowledgeArticleRevisions).set({ title: merged.title, summary: merged.summary ?? null, body: merged.body, contentFormat: merged.contentFormat, createdBy: principal.userId }).where(eq(knowledgeArticleRevisions.id, draftId));
      } else {
        const [last] = await tx.select({ revisionNumber: knowledgeArticleRevisions.revisionNumber }).from(knowledgeArticleRevisions).where(eq(knowledgeArticleRevisions.articleId, articleId)).orderBy(desc(knowledgeArticleRevisions.revisionNumber)).limit(1);
        const [revision] = await tx.insert(knowledgeArticleRevisions).values({ articleId, revisionNumber: (last?.revisionNumber ?? 0) + 1, title: merged.title, summary: merged.summary ?? null, body: merged.body, contentFormat: merged.contentFormat, createdBy: principal.userId }).returning({ id: knowledgeArticleRevisions.id });
        draftId = revision.id;
      }
      await tx.update(knowledgeArticles).set({ categoryId: merged.categoryId, currentDraftRevisionId: draftId, status: "draft", archivedAt: null, requiresAcknowledgement: merged.requiresAcknowledgement, updatedAt: new Date() }).where(eq(knowledgeArticles.id, articleId));
      await this.replaceTargets(tx, articleId, merged.visibilityTargets);
      await this.replaceQuizLinks(tx, articleId, merged.quizIds);
      return articleId;
    });
    return this.getManagement(principal, updatedId);
  }

  async publish(principal: TrustedPrincipal, articleId: string) {
    assertAuthor(principal);
    await this.db.transaction(async (tx: DbContext) => {
      const [article] = await tx.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, articleId)).for("update").limit(1);
      if (!article || !(await this.isWithinAuthorScope(principal, articleId, tx))) throw new DomainError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Материал не найден");
      if (!article.currentDraftRevisionId) throw new DomainError(409, "KNOWLEDGE_DRAFT_REQUIRED", "Для публикации нужен черновик");
      const [draft] = await tx.select().from(knowledgeArticleRevisions).where(eq(knowledgeArticleRevisions.id, article.currentDraftRevisionId)).limit(1);
      if (!draft) throw new DomainError(409, "KNOWLEDGE_DRAFT_REQUIRED", "Черновик материала не найден");
      const targets = await this.readTargets(tx, articleId);
      const quizIds = await this.readQuizIds(tx, articleId);
      const category = { categoryId: article.categoryId, title: draft.title, summary: draft.summary, body: draft.body, contentFormat: draft.contentFormat, visibilityTargets: targets, requiresAcknowledgement: article.requiresAcknowledgement, quizIds };
      validateKnowledgeMarkdown(draft.body);
      await this.validateArticleInputs(principal, category, tx);
      if (article.publishedRevisionId) await tx.update(knowledgeArticleRevisions).set({ status: "archived" }).where(eq(knowledgeArticleRevisions.id, article.publishedRevisionId));
      await tx.update(knowledgeArticleRevisions).set({ status: "published", publishedBy: principal.userId, publishedAt: new Date() }).where(eq(knowledgeArticleRevisions.id, draft.id));
      await tx.update(knowledgeArticles).set({ status: "published", currentDraftRevisionId: null, publishedRevisionId: draft.id, publishedAt: new Date(), archivedAt: null, updatedAt: new Date() }).where(eq(knowledgeArticles.id, articleId));
      await tx.insert(domainEvents).values({ eventType: "knowledge.published", aggregateType: "knowledge_article", aggregateId: articleId, actorId: principal.userId, payload: { articleId, revisionId: draft.id, requiresAcknowledgement: article.requiresAcknowledgement } });
    });
    return this.getManagement(principal, articleId);
  }

  async archive(principal: TrustedPrincipal, articleId: string) {
    assertAuthor(principal);
    const [article] = await this.db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, articleId)).limit(1);
    if (!article || !(await this.isWithinAuthorScope(principal, articleId))) throw new DomainError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Материал не найден");
    await this.db.update(knowledgeArticles).set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() }).where(eq(knowledgeArticles.id, articleId));
    return this.getManagement(principal, articleId);
  }

  async listRevisions(principal: TrustedPrincipal, articleId: string) {
    assertAuthor(principal);
    const [article] = await this.db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, articleId)).limit(1);
    if (!article || !(await this.isWithinAuthorScope(principal, articleId))) throw new DomainError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Материал не найден");
    const rows = await this.db.select().from(knowledgeArticleRevisions).where(eq(knowledgeArticleRevisions.articleId, articleId)).orderBy(desc(knowledgeArticleRevisions.revisionNumber));
    return { data: await Promise.all(rows.map((row: typeof knowledgeArticleRevisions.$inferSelect) => this.revisionDto(this.db, row))) };
  }

  async listAcknowledgments(principal: TrustedPrincipal, articleId: string) {
    assertAuthor(principal);
    const [article] = await this.db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, articleId)).limit(1);
    if (!article || !(await this.isWithinAuthorScope(principal, articleId))) throw new DomainError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Материал не найден");
    const eligible = new Set(await this.eligibleUserIds(this.db, articleId));
    const rows = await this.db.select({ employeeId: knowledgeAcknowledgments.employeeId, revisionId: knowledgeAcknowledgments.revisionId, acknowledgedAt: knowledgeAcknowledgments.acknowledgedAt, firstName: users.firstName, lastName: users.lastName }).from(knowledgeAcknowledgments).innerJoin(users, eq(users.id, knowledgeAcknowledgments.employeeId)).where(eq(knowledgeAcknowledgments.articleId, articleId)).orderBy(desc(knowledgeAcknowledgments.acknowledgedAt));
    return { data: rows.filter((row: { employeeId: string }) => eligible.has(row.employeeId)).map((row: { employeeId: string; revisionId: string; acknowledgedAt: Date; firstName: string; lastName: string }) => ({ employeeId: row.employeeId, employeeName: `${row.firstName} ${row.lastName}`, revisionId: row.revisionId, acknowledgedAt: row.acknowledgedAt.toISOString() })) };
  }

  async listStaff(principal: TrustedPrincipal, input: KnowledgeStaffListQuery) {
    assertStaff(principal);
    const query = knowledgeStaffListQuerySchema.parse(input);
    const storeList = principal.storeIds.length
      ? sql.join(principal.storeIds.map((id) => sql`${id}::uuid`), sql`, `)
      : null;
    const storeScope = storeList ? sql`target.store_id in (${storeList})` : sql`false`;
    const visibility = sql`exists (select 1 from knowledge_visibility_targets target where target.article_id = ${knowledgeArticles.id} and (target.kind = 'all' or (target.kind = 'store' and ${storeScope}) or (target.kind = 'role' and target.role = 'staff' and (target.store_id is null or ${storeScope}))))`;
    const conditions = [eq(knowledgeArticles.status, "published"), eq(knowledgeArticleRevisions.status, "published"), eq(knowledgeArticleRevisions.id, knowledgeArticles.publishedRevisionId), visibility, query.categoryId ? eq(knowledgeArticles.categoryId, query.categoryId) : undefined].filter(Boolean) as any[];
    if (query.search) conditions.push(or(sql`to_tsvector('simple', coalesce(${knowledgeArticleRevisions.title}, '') || ' ' || coalesce(${knowledgeArticleRevisions.summary}, '') || ' ' || ${knowledgeArticleRevisions.body}) @@ plainto_tsquery('simple', ${query.search})`, ilike(knowledgeArticleRevisions.title, `%${query.search}%`), ilike(knowledgeArticleRevisions.summary, `%${query.search}%`), ilike(knowledgeArticleRevisions.body, `%${query.search}%`)));
    const rows = await this.db.select({ article: knowledgeArticles, revision: knowledgeArticleRevisions, category: knowledgeCategories, acknowledgedAt: knowledgeAcknowledgments.acknowledgedAt }).from(knowledgeArticles).innerJoin(knowledgeArticleRevisions, eq(knowledgeArticleRevisions.id, knowledgeArticles.publishedRevisionId)).innerJoin(knowledgeCategories, eq(knowledgeCategories.id, knowledgeArticles.categoryId)).leftJoin(knowledgeAcknowledgments, and(eq(knowledgeAcknowledgments.articleId, knowledgeArticles.id), eq(knowledgeAcknowledgments.revisionId, knowledgeArticleRevisions.id), eq(knowledgeAcknowledgments.employeeId, principal.userId))).where(and(...conditions)).orderBy(desc(knowledgeArticles.publishedAt), desc(knowledgeArticles.updatedAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const [{ total }] = await this.db.select({ total: count() }).from(knowledgeArticles).innerJoin(knowledgeArticleRevisions, eq(knowledgeArticleRevisions.id, knowledgeArticles.publishedRevisionId)).where(and(...conditions));
    return { data: rows.map((row: any) => this.staffSummary(row)), pagination: { page: query.page, pageSize: query.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / query.pageSize) } };
  }

  async getStaff(principal: TrustedPrincipal, articleId: string) {
    assertStaff(principal);
    const result = await this.staffRow(principal, articleId);
    if (!result) throw new DomainError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Материал не найден");
    const attachments = await this.db.select().from(knowledgeAttachments).where(eq(knowledgeAttachments.revisionId, result.revision.id)).orderBy(asc(knowledgeAttachments.createdAt));
    const quizzes = await this.authorizedQuizLinks(principal, articleId);
    return { ...this.staffSummary(result), body: result.revision.body, contentFormat: result.revision.contentFormat, revisionId: result.revision.id, revisionNumber: result.revision.revisionNumber, attachments: attachments.map((row: typeof knowledgeAttachments.$inferSelect) => this.attachmentDto(row)), quizzes };
  }

  async acknowledge(principal: TrustedPrincipal, articleId: string) {
    assertStaff(principal);
    const result = await this.staffRow(principal, articleId);
    if (!result) throw new DomainError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Материал не найден");
    const [row] = await this.db.insert(knowledgeAcknowledgments).values({ employeeId: principal.userId, articleId, revisionId: result.revision.id }).onConflictDoNothing({ target: [knowledgeAcknowledgments.employeeId, knowledgeAcknowledgments.revisionId] }).returning();
    if (row) return { articleId, revisionId: row.revisionId, acknowledgedAt: row.acknowledgedAt.toISOString() };
    const [existing] = await this.db.select().from(knowledgeAcknowledgments).where(and(eq(knowledgeAcknowledgments.employeeId, principal.userId), eq(knowledgeAcknowledgments.revisionId, result.revision.id))).limit(1);
    return { articleId, revisionId: result.revision.id, acknowledgedAt: existing.acknowledgedAt.toISOString() };
  }

  async uploadAttachment(principal: TrustedPrincipal, articleId: string, file: File) {
    assertAuthor(principal);
    if (!this.storage || !this.imageLimits) throw new DomainError(503, "KNOWLEDGE_STORAGE_UNAVAILABLE", "Хранилище материалов недоступно");
    const [article] = await this.db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, articleId)).limit(1);
    if (!article || !(await this.isWithinAuthorScope(principal, articleId))) throw new DomainError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Материал не найден");
    if (!article.currentDraftRevisionId) throw new DomainError(409, "KNOWLEDGE_DRAFT_REQUIRED", "Добавлять файл можно только в черновик");
    const prepared = await prepareKnowledgeAttachment(file, this.imageLimits);
    const storageKey = `knowledge/${articleId}/${article.currentDraftRevisionId}/${crypto.randomUUID()}.${prepared.extension}`;
    await this.storage.put(storageKey, prepared.body, prepared.mimeType);
    try {
      const [row] = await this.db.insert(knowledgeAttachments).values({ revisionId: article.currentDraftRevisionId, storageKey, originalFilename: safeKnowledgeFilename(file.name), mimeType: prepared.mimeType, fileSize: prepared.body.byteLength, uploadedBy: principal.userId }).returning();
      return this.attachmentDto(row);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async deleteAttachment(principal: TrustedPrincipal, articleId: string, attachmentId: string) {
    assertAuthor(principal);
    if (!this.storage) throw new DomainError(503, "KNOWLEDGE_STORAGE_UNAVAILABLE", "Хранилище материалов недоступно");
    const [row] = await this.db.select({ attachment: knowledgeAttachments, article: knowledgeArticles }).from(knowledgeAttachments).innerJoin(knowledgeArticleRevisions, eq(knowledgeArticleRevisions.id, knowledgeAttachments.revisionId)).innerJoin(knowledgeArticles, eq(knowledgeArticles.id, knowledgeArticleRevisions.articleId)).where(and(eq(knowledgeAttachments.id, attachmentId), eq(knowledgeArticles.id, articleId))).limit(1);
    if (!row || !(await this.isWithinAuthorScope(principal, articleId)) || row.article.currentDraftRevisionId !== row.attachment.revisionId) throw new DomainError(404, "KNOWLEDGE_ATTACHMENT_NOT_FOUND", "Файл не найден");
    await this.storage.delete(row.attachment.storageKey);
    await this.db.delete(knowledgeAttachments).where(eq(knowledgeAttachments.id, attachmentId));
    return { success: true as const };
  }

  async getAttachment(principal: TrustedPrincipal, articleId: string, attachmentId: string) {
    assertActivePrincipal(principal);
    const [row] = await this.db.select({ attachment: knowledgeAttachments, revision: knowledgeArticleRevisions, article: knowledgeArticles }).from(knowledgeAttachments).innerJoin(knowledgeArticleRevisions, eq(knowledgeArticleRevisions.id, knowledgeAttachments.revisionId)).innerJoin(knowledgeArticles, eq(knowledgeArticles.id, knowledgeArticleRevisions.articleId)).where(and(eq(knowledgeAttachments.id, attachmentId), eq(knowledgeArticles.id, articleId))).limit(1);
    if (!row) throw new DomainError(404, "KNOWLEDGE_ATTACHMENT_NOT_FOUND", "Файл не найден");
    if (principal.role === "staff") {
      if (row.article.status !== "published" || row.article.publishedRevisionId !== row.revision.id || !(await this.staffRow(principal, articleId))) throw new DomainError(404, "KNOWLEDGE_ATTACHMENT_NOT_FOUND", "Файл не найден");
    } else if (!(await this.isWithinAuthorScope(principal, articleId))) throw new DomainError(404, "KNOWLEDGE_ATTACHMENT_NOT_FOUND", "Файл не найден");
    if (!this.storage) throw new DomainError(503, "KNOWLEDGE_STORAGE_UNAVAILABLE", "Хранилище материалов недоступно");
    const body = await this.storage.get(row.attachment.storageKey);
    if (!body) throw new DomainError(404, "KNOWLEDGE_ATTACHMENT_NOT_FOUND", "Файл не найден");
    return { body, attachment: row.attachment };
  }

  private categoryDto(row: typeof knowledgeCategories.$inferSelect) { return { id: row.id, name: row.name, slug: row.slug, description: row.description, parentId: row.parentId, sortOrder: row.sortOrder, isActive: row.isActive, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
  private attachmentDto(row: typeof knowledgeAttachments.$inferSelect) { return { id: row.id, originalFilename: row.originalFilename, mimeType: row.mimeType as "application/pdf" | "image/jpeg" | "image/png" | "image/webp", fileSize: row.fileSize, createdAt: row.createdAt.toISOString() }; }
  private staffSummary(row: any) { return { id: row.article.id, category: this.categoryDto(row.category), title: row.revision.title, summary: row.revision.summary, requiresAcknowledgement: row.article.requiresAcknowledgement, acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null, publishedAt: row.revision.publishedAt?.toISOString() ?? row.article.publishedAt?.toISOString(), updatedAt: row.article.updatedAt.toISOString() }; }

  private async articleDto(article: typeof knowledgeArticles.$inferSelect) {
    const [category] = await this.db.select().from(knowledgeCategories).where(eq(knowledgeCategories.id, article.categoryId)).limit(1);
    const revisions = await this.db.select().from(knowledgeArticleRevisions).where(and(eq(knowledgeArticleRevisions.articleId, article.id), inArray(knowledgeArticleRevisions.id, [article.currentDraftRevisionId, article.publishedRevisionId].filter((id): id is string => Boolean(id)))));
    const draft = revisions.find((row: typeof knowledgeArticleRevisions.$inferSelect) => row.id === article.currentDraftRevisionId) ?? null;
    const published = revisions.find((row: typeof knowledgeArticleRevisions.$inferSelect) => row.id === article.publishedRevisionId) ?? null;
    const targets = await this.readTargets(this.db, article.id);
    const eligibleCount = published ? (await this.eligibleUserIds(this.db, article.id)).length : 0;
    const acknowledgedCount = published ? Number((await this.db.select({ count: count() }).from(knowledgeAcknowledgments).where(eq(knowledgeAcknowledgments.revisionId, published.id)))[0]?.count ?? 0) : 0;
    return { id: article.id, category: this.categoryDto(category), status: article.status, requiresAcknowledgement: article.requiresAcknowledgement, draft: draft ? await this.revisionDto(this.db, draft) : null, published: published ? await this.revisionDto(this.db, published) : null, visibilityTargets: targets, createdBy: article.createdBy, publishedAt: dateValue(article.publishedAt), createdAt: article.createdAt.toISOString(), updatedAt: article.updatedAt.toISOString(), metrics: { eligibleCount, acknowledgedCount } };
  }

  private async revisionDto(executor: DbContext, row: typeof knowledgeArticleRevisions.$inferSelect) {
    const attachments = await executor.select().from(knowledgeAttachments).where(eq(knowledgeAttachments.revisionId, row.id)).orderBy(asc(knowledgeAttachments.createdAt));
    const quizIds = await this.readQuizIds(executor, row.articleId);
    return { id: row.id, revisionNumber: row.revisionNumber, status: row.status, title: row.title, summary: row.summary, body: row.body, contentFormat: row.contentFormat, contentVersion: row.contentVersion, createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), publishedBy: row.publishedBy, publishedAt: dateValue(row.publishedAt), attachments: attachments.map((attachment: typeof knowledgeAttachments.$inferSelect) => this.attachmentDto(attachment)), quizIds };
  }

  private async currentEditableRevision(executor: DbContext, article: typeof knowledgeArticles.$inferSelect) {
    const revisionId = article.currentDraftRevisionId ?? article.publishedRevisionId;
    if (!revisionId) throw new DomainError(409, "KNOWLEDGE_REVISION_REQUIRED", "У статьи нет версии для редактирования");
    const [revision] = await executor.select().from(knowledgeArticleRevisions).where(eq(knowledgeArticleRevisions.id, revisionId)).limit(1);
    if (!revision) throw new DomainError(409, "KNOWLEDGE_REVISION_REQUIRED", "Версия статьи не найдена");
    return revision;
  }

  private async validateArticleInputs(principal: TrustedPrincipal, data: { categoryId: string; visibilityTargets: KnowledgeArticleCreate["visibilityTargets"]; quizIds: string[] }, executor: DbContext) {
    const [category] = await executor.select().from(knowledgeCategories).where(eq(knowledgeCategories.id, data.categoryId)).limit(1);
    if (!category?.isActive) throw new DomainError(400, "KNOWLEDGE_CATEGORY_INVALID", "Категория неактивна или не найдена");
    const targets = data.visibilityTargets;
    if (!targets.length) throw new DomainError(400, "KNOWLEDGE_TARGET_REQUIRED", "Укажите область видимости материала");
    const keys = targets.map((target) => JSON.stringify(target));
    if (new Set(keys).size !== keys.length) throw new DomainError(409, "KNOWLEDGE_TARGET_DUPLICATE", "Область видимости содержит дубликаты");
    if (targets.some((target) => target.kind === "all") && targets.length !== 1) throw new DomainError(400, "KNOWLEDGE_TARGET_INVALID", "Глобальная область видимости не сочетается с другими целями");
    for (const target of targets) {
      if (target.kind === "all" && principal.role !== "admin") throw new DomainError(403, "FORBIDDEN", "Менеджер не может публиковать глобальные материалы");
      if (target.kind === "store") {
        const [store] = await executor.select({ id: stores.id, isActive: stores.isActive }).from(stores).where(eq(stores.id, target.storeId)).limit(1);
        if (!store?.isActive) throw new DomainError(400, "KNOWLEDGE_STORE_INVALID", "Магазин неактивен или не найден");
        if (principal.role === "manager" && !principal.storeIds.includes(target.storeId)) throw new DomainError(403, "FORBIDDEN", "Магазин находится вне области менеджера");
      }
      if (target.kind === "role") {
        if (principal.role === "manager" && target.role !== "staff") throw new DomainError(403, "FORBIDDEN", "Менеджер может адресовать материалы только сотрудникам");
        if (principal.role === "manager" && (!target.storeId || !principal.storeIds.includes(target.storeId))) throw new DomainError(403, "FORBIDDEN", "Укажите магазин из области менеджера");
        if (target.storeId) {
          const [store] = await executor.select({ id: stores.id, isActive: stores.isActive }).from(stores).where(eq(stores.id, target.storeId)).limit(1);
          if (!store?.isActive) throw new DomainError(400, "KNOWLEDGE_STORE_INVALID", "Магазин неактивен или не найден");
        }
      }
    }
    await this.validateQuizLinks(principal, data.quizIds, executor);
  }

  private async validateQuizLinks(principal: TrustedPrincipal, quizIds: readonly string[], executor: DbContext) {
    for (const quizId of unique(quizIds)) {
      const [quiz] = await executor.select({ id: quizzes.id, status: quizzes.status }).from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
      const [revision] = await executor.select().from(quizRevisions).where(and(eq(quizRevisions.quizId, quizId), eq(quizRevisions.status, "published"))).orderBy(desc(quizRevisions.revisionNumber)).limit(1);
      if (!quiz || quiz.status !== "published" || !revision) throw new DomainError(400, "KNOWLEDGE_QUIZ_INVALID", "Можно связать только опубликованный тест");
      if (principal.role === "manager") {
        if (revision.assignmentMode === "all") throw new DomainError(403, "FORBIDDEN", "Менеджер не может связать глобальный тест");
        const assignedStores = await executor.select({ storeId: quizAssignments.storeId }).from(quizAssignments).where(eq(quizAssignments.revisionId, revision.id));
        if (assignedStores.some((row: { storeId: string }) => !principal.storeIds.includes(row.storeId))) throw new DomainError(403, "FORBIDDEN", "Тест находится вне области менеджера");
        const targets = await executor.select().from(quizAssignmentTargets).where(eq(quizAssignmentTargets.revisionId, revision.id));
        if (targets.some((row: typeof quizAssignmentTargets.$inferSelect) => row.targetType === "role" && row.role !== "staff" || row.storeId && !principal.storeIds.includes(row.storeId))) throw new DomainError(403, "FORBIDDEN", "Тест содержит недоступную область");
      }
    }
  }

  private async replaceTargets(executor: DbContext, articleId: string, targets: KnowledgeArticleCreate["visibilityTargets"]) {
    await executor.delete(knowledgeVisibilityTargets).where(eq(knowledgeVisibilityTargets.articleId, articleId));
    await executor.insert(knowledgeVisibilityTargets).values(targets.map((target) => ({ articleId, kind: target.kind, storeId: target.kind === "store" || target.kind === "role" ? target.storeId ?? null : null, role: target.kind === "role" ? target.role : null })));
  }

  private async replaceQuizLinks(executor: DbContext, articleId: string, quizIds: readonly string[]) {
    await executor.delete(knowledgeArticleQuizLinks).where(eq(knowledgeArticleQuizLinks.articleId, articleId));
    if (quizIds.length) await executor.insert(knowledgeArticleQuizLinks).values(unique(quizIds).map((quizId) => ({ articleId, quizId })));
  }

  private async readTargets(executor: DbContext, articleId: string) {
    const rows = await executor.select().from(knowledgeVisibilityTargets).where(eq(knowledgeVisibilityTargets.articleId, articleId));
    return rows.map((row: typeof knowledgeVisibilityTargets.$inferSelect) => row.kind === "all" ? { kind: "all" as const } : row.kind === "store" ? { kind: "store" as const, storeId: row.storeId! } : { kind: "role" as const, role: row.role as "staff" | "manager", ...(row.storeId ? { storeId: row.storeId } : {}) });
  }

  private async readQuizIds(executor: DbContext, articleId: string): Promise<string[]> {
    const rows = await executor.select({ quizId: knowledgeArticleQuizLinks.quizId }).from(knowledgeArticleQuizLinks).where(eq(knowledgeArticleQuizLinks.articleId, articleId));
    return rows.map((row: { quizId: string }) => row.quizId);
  }

  private async isWithinAuthorScope(principal: TrustedPrincipal, articleId: string, executor: DbContext = this.db): Promise<boolean> {
    if (principal.role === "admin") return true;
    const targets = await this.readTargets(executor, articleId);
    return targets.length > 0 && targets.every((target: { kind: string; role?: string; storeId?: string }) => target.kind !== "all" && target.role !== "manager" && ((target.kind === "store" && target.storeId !== undefined && principal.storeIds.includes(target.storeId)) || (target.kind === "role" && target.storeId !== undefined && principal.storeIds.includes(target.storeId))));
  }

  private async assertCategoryParent(parentId: string | null, categoryId?: string) {
    if (!parentId) return;
    const seen = new Set<string>();
    let current: string | null = parentId;
    while (current) {
      if (current === categoryId || seen.has(current)) throw new DomainError(400, "KNOWLEDGE_CATEGORY_CYCLE", "Категория не может быть родителем самой себя");
      seen.add(current);
      const [row] = await this.db.select({ id: knowledgeCategories.id, parentId: knowledgeCategories.parentId }).from(knowledgeCategories).where(eq(knowledgeCategories.id, current)).limit(1);
      if (!row) throw new DomainError(400, "KNOWLEDGE_CATEGORY_PARENT", "Родительская категория не найдена");
      current = row.parentId;
    }
  }

  private async staffRow(principal: TrustedPrincipal, articleId: string) {
    const storeList = principal.storeIds.length
      ? sql.join(principal.storeIds.map((id) => sql`${id}::uuid`), sql`, `)
      : null;
    const storeScope = storeList ? sql`target.store_id in (${storeList})` : sql`false`;
    const visibility = sql`exists (select 1 from knowledge_visibility_targets target where target.article_id = ${knowledgeArticles.id} and (target.kind = 'all' or (target.kind = 'store' and ${storeScope}) or (target.kind = 'role' and target.role = 'staff' and (target.store_id is null or ${storeScope}))))`;
    const [row] = await this.db.select({ article: knowledgeArticles, revision: knowledgeArticleRevisions, category: knowledgeCategories, acknowledgedAt: knowledgeAcknowledgments.acknowledgedAt }).from(knowledgeArticles).innerJoin(knowledgeArticleRevisions, eq(knowledgeArticleRevisions.id, knowledgeArticles.publishedRevisionId)).innerJoin(knowledgeCategories, eq(knowledgeCategories.id, knowledgeArticles.categoryId)).leftJoin(knowledgeAcknowledgments, and(eq(knowledgeAcknowledgments.articleId, knowledgeArticles.id), eq(knowledgeAcknowledgments.revisionId, knowledgeArticleRevisions.id), eq(knowledgeAcknowledgments.employeeId, principal.userId))).where(and(eq(knowledgeArticles.id, articleId), eq(knowledgeArticles.status, "published"), eq(knowledgeArticleRevisions.status, "published"))).limit(1);
    if (!row) return null;
    const [visible] = await this.db.select({ id: knowledgeArticles.id }).from(knowledgeArticles).where(and(eq(knowledgeArticles.id, articleId), visibility)).limit(1);
    return visible ? row : null;
  }

  private async eligibleUserIds(executor: DbContext, articleId: string): Promise<string[]> {
    const targets = await this.readTargets(executor, articleId);
    const ids: string[] = [];
    for (const target of targets) {
      if (target.kind === "all") {
        const rows = await executor.select({ id: users.id }).from(users).where(and(eq(users.role, "staff"), eq(users.isActive, true)));
        ids.push(...rows.map((row: { id: string }) => row.id));
      } else {
        const role = target.kind === "role" ? target.role : "staff";
        const conditions = [eq(users.role, role), eq(users.isActive, true)];
        if (target.kind === "store" || target.storeId) conditions.push(eq(userStores.storeId, target.kind === "store" ? target.storeId : target.storeId!));
        const rows = await executor.selectDistinct({ id: users.id }).from(users).innerJoin(userStores, eq(userStores.userId, users.id)).where(and(...conditions));
        ids.push(...rows.map((row: { id: string }) => row.id));
      }
    }
    return unique(ids);
  }

  private async authorizedQuizLinks(principal: TrustedPrincipal, articleId: string) {
    const ids = await this.readQuizIds(this.db, articleId);
    const result: Array<{ id: string; title: string }> = [];
    for (const quizId of ids) {
      const [quiz] = await this.db.select({ id: quizzes.id, status: quizzes.status }).from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
      const [revision] = await this.db.select().from(quizRevisions).where(and(eq(quizRevisions.quizId, quizId), eq(quizRevisions.status, "published"))).orderBy(desc(quizRevisions.revisionNumber)).limit(1);
      if (!quiz || quiz.status !== "published" || !revision) continue;
      if (principal.role === "staff") {
        const storesForQuiz = await this.db.select({ storeId: quizAssignments.storeId }).from(quizAssignments).where(eq(quizAssignments.revisionId, revision.id));
        const targets = await this.db.select().from(quizAssignmentTargets).where(eq(quizAssignmentTargets.revisionId, revision.id));
        const eligible = revision.assignmentMode === "all" || storesForQuiz.some((row: { storeId: string }) => principal.storeIds.includes(row.storeId)) || targets.some((row: typeof quizAssignmentTargets.$inferSelect) => row.targetType === "role" && row.role === "staff" && (!row.storeId || principal.storeIds.includes(row.storeId)) || row.targetType === "user" && row.userId === principal.userId || row.targetType === "store" && row.storeId !== null && principal.storeIds.includes(row.storeId));
        if (!eligible) continue;
      }
      result.push({ id: quizId, title: revision.title });
    }
    return result;
  }
}

export function createKnowledgeService(db: Database, storage?: PhotoStorage, imageLimits?: PhotoProcessingLimits): KnowledgeService { return new KnowledgeService(db, storage, imageLimits); }

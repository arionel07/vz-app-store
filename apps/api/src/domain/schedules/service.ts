import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  scheduleDayOffCreateSchema,
  scheduleDayOffUpdateSchema,
  scheduleListQuerySchema,
  schedulePeriodCreateSchema,
  schedulePeriodUpdateSchema,
  scheduleShiftCreateSchema,
  scheduleShiftUpdateSchema,
  staffScheduleQuerySchema,
  type ScheduleDayOffCreate,
  type ScheduleDayOffUpdate,
  type ScheduleListQuery,
  type SchedulePeriodCreate,
  type SchedulePeriodResponse,
  type SchedulePeriodUpdate,
  type ScheduleShiftCreate,
  type ScheduleShiftUpdate,
  type StaffScheduleResponse,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import { domainEvents, scheduleDaysOff, scheduleHistory, schedulePeriods, scheduleShifts, stores, userStores, users } from "../../db/schema";
import { assertActivePrincipal, type TrustedPrincipal } from "../authz";
import { DomainError } from "../errors";
import { assertDateInRange, assertTimezone, dateRange, shiftInstants } from "./timezone";

type Executor = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
type Actor = { id: string; firstName: string; lastName: string; role: "admin" | "manager" | "staff" };

function managementPrincipal(principal: TrustedPrincipal): void {
  assertActivePrincipal(principal);
  if (principal.role === "staff") throw new DomainError(403, "FORBIDDEN", "Сотрудники не могут управлять расписанием");
}

function dateOrder(startDate: string, endDate: string): void { dateRange(startDate, endDate); }

async function lock(executor: Executor, key: string, scope: number): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, ${scope}))`);
}

async function actor(executor: Executor, id: string | null): Promise<Actor | null> {
  if (!id) return null;
  const [row] = await executor.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

function serializeActor(value: Actor | null): Actor | null { return value; }

async function writeHistory(executor: Executor, values: {
  scheduleId: string; actorId: string; action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown;
}): Promise<void> {
  await executor.insert(scheduleHistory).values({ ...values, entityId: values.entityId ?? null, before: values.before ?? null, after: values.after ?? null });
}

function scheduleSnapshot(period: typeof schedulePeriods.$inferSelect): Record<string, unknown> {
  return { id: period.id, storeId: period.storeId, startDate: period.startDate, endDate: period.endDate, timezone: period.timezone, status: period.status, revision: period.revision, supersededAt: period.supersededAt?.toISOString() ?? null };
}

export class SchedulesService {
  constructor(private readonly db: Database) {}

  private async requireStore(storeId: string, principal: TrustedPrincipal, executor: Executor = this.db) {
    const [store] = await executor.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!store || (principal.role === "manager" && (!store.isActive || !principal.storeIds.includes(storeId)))) throw new DomainError(403, "STORE_FORBIDDEN", "Магазин находится вне зоны доступа");
    if (!store.isActive) throw new DomainError(409, "STORE_UNAVAILABLE", "Расписание можно вести только для активного магазина");
    return store;
  }

  private async requirePeriod(periodId: string, principal: TrustedPrincipal, executor: Executor = this.db) {
    const [row] = await executor.select({ period: schedulePeriods, store: stores }).from(schedulePeriods).innerJoin(stores, eq(stores.id, schedulePeriods.storeId)).where(eq(schedulePeriods.id, periodId)).limit(1);
    if (!row) throw new DomainError(404, "SCHEDULE_NOT_FOUND", "Расписание не найдено");
    await this.requireStore(row.period.storeId, principal, executor);
    return row;
  }

  private async requireDraft(periodId: string, principal: TrustedPrincipal, executor: Executor = this.db) {
    const row = await this.requirePeriod(periodId, principal, executor);
    if (row.period.status !== "draft") throw new DomainError(409, "SCHEDULE_REVISION_REQUIRED", "Опубликованное расписание нельзя изменять без новой ревизии");
    return row;
  }

  private async requireEmployee(employeeId: string, storeId: string, principal: TrustedPrincipal, executor: Executor): Promise<Actor> {
    const [row] = await executor.select({ user: users }).from(users).innerJoin(userStores, eq(userStores.userId, users.id)).where(and(eq(users.id, employeeId), eq(userStores.storeId, storeId), eq(users.role, "staff"), eq(users.isActive, true))).limit(1);
    if (!row) throw new DomainError(409, "EMPLOYEE_UNAVAILABLE", "Сотрудник не активен или не назначен в этот магазин");
    if (principal.role === "manager" && !principal.storeIds.includes(storeId)) throw new DomainError(403, "STORE_FORBIDDEN", "Магазин находится вне зоны доступа");
    return { id: row.user.id, firstName: row.user.firstName, lastName: row.user.lastName, role: row.user.role };
  }

  private async graph(periodId: string, executor: Executor = this.db): Promise<SchedulePeriodResponse> {
    const [row] = await executor.select({ period: schedulePeriods, storeName: stores.name }).from(schedulePeriods).innerJoin(stores, eq(stores.id, schedulePeriods.storeId)).where(eq(schedulePeriods.id, periodId)).limit(1);
    if (!row) throw new DomainError(404, "SCHEDULE_NOT_FOUND", "Расписание не найдено");
    const [createdBy, publishedBy] = await Promise.all([actor(executor, row.period.createdBy), actor(executor, row.period.publishedBy)]);
    const shiftRows = await executor.select({ shift: scheduleShifts, employee: users, storeName: stores.name }).from(scheduleShifts).innerJoin(users, eq(users.id, scheduleShifts.employeeId)).innerJoin(stores, eq(stores.id, scheduleShifts.storeId)).where(eq(scheduleShifts.periodId, periodId)).orderBy(asc(scheduleShifts.localDate), asc(scheduleShifts.startAt));
    const dayOffRows = await executor.select({ dayOff: scheduleDaysOff, employee: users, storeName: stores.name }).from(scheduleDaysOff).innerJoin(users, eq(users.id, scheduleDaysOff.employeeId)).innerJoin(stores, eq(stores.id, scheduleDaysOff.storeId)).where(eq(scheduleDaysOff.periodId, periodId)).orderBy(asc(scheduleDaysOff.localDate));
    return {
      id: row.period.id, storeId: row.period.storeId, storeName: row.storeName, startDate: row.period.startDate, endDate: row.period.endDate, timezone: row.period.timezone,
      status: row.period.status, revision: row.period.revision, supersededAt: row.period.supersededAt?.toISOString() ?? null, createdBy: serializeActor(createdBy), publishedBy: serializeActor(publishedBy),
      createdAt: row.period.createdAt.toISOString(), updatedAt: row.period.updatedAt.toISOString(), publishedAt: row.period.publishedAt?.toISOString() ?? null,
      shifts: shiftRows.map(({ shift, employee, storeName }) => ({ id: shift.id, periodId: shift.periodId, employeeId: shift.employeeId, employeeName: `${employee.firstName} ${employee.lastName}`, storeId: shift.storeId, storeName, localDate: shift.localDate, startTime: shift.startTime, endTime: shift.endTime, timezone: shift.timezone, startAt: shift.startAt.toISOString(), endAt: shift.endAt.toISOString(), note: shift.note })),
      daysOff: dayOffRows.map(({ dayOff, employee, storeName }) => ({ id: dayOff.id, periodId: dayOff.periodId, employeeId: dayOff.employeeId, employeeName: `${employee.firstName} ${employee.lastName}`, storeId: dayOff.storeId, storeName, localDate: dayOff.localDate, note: dayOff.note })),
    };
  }

  private async assertNoOverlap(executor: Executor, employeeId: string, startAt: Date, endAt: Date, exceptId?: string, ignorePublishedStoreId?: string): Promise<void> {
    const filters = [eq(scheduleShifts.employeeId, employeeId), lt(scheduleShifts.startAt, endAt), gt(scheduleShifts.endAt, startAt), isNull(schedulePeriods.supersededAt)];
    if (exceptId) filters.push(sql`${scheduleShifts.id} <> ${exceptId}::uuid` as never);
    if (ignorePublishedStoreId) filters.push(or(eq(schedulePeriods.status, "draft"), ne(schedulePeriods.storeId, ignorePublishedStoreId))!);
    const [overlap] = await executor.select({ id: scheduleShifts.id }).from(scheduleShifts).innerJoin(schedulePeriods, eq(schedulePeriods.id, scheduleShifts.periodId)).where(and(...filters)).limit(1);
    if (overlap) throw new DomainError(409, "SHIFT_OVERLAP", "Смена пересекается с другой сменой сотрудника");
  }

  private async assertNoDayOffConflict(executor: Executor, periodId: string, employeeId: string, localDate: string, exceptId?: string): Promise<void> {
    const filters = [eq(scheduleShifts.periodId, periodId), eq(scheduleShifts.employeeId, employeeId), eq(scheduleShifts.localDate, localDate)];
    if (exceptId) filters.push(sql`${scheduleShifts.id} <> ${exceptId}::uuid` as never);
    const [shift] = await executor.select({ id: scheduleShifts.id }).from(scheduleShifts).where(and(...filters)).limit(1);
    if (shift) throw new DomainError(409, "DAY_OFF_SHIFT_CONFLICT", "Нельзя назначить выходной в день смены");
  }

  async list(principal: TrustedPrincipal, input: ScheduleListQuery) {
    managementPrincipal(principal);
    const query = scheduleListQuerySchema.parse(input);
    const filters = [query.status ? eq(schedulePeriods.status, query.status) : sql`true`, isNull(schedulePeriods.supersededAt)];
    if (query.storeId) { await this.requireStore(query.storeId, principal); filters.push(eq(schedulePeriods.storeId, query.storeId)); }
    else if (principal.role === "manager") filters.push(principal.storeIds.length ? inArray(schedulePeriods.storeId, [...principal.storeIds]) : sql`false`);
    if (query.from) filters.push(gte(schedulePeriods.endDate, query.from));
    if (query.to) filters.push(sql`${schedulePeriods.startDate} <= ${query.to}`);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)` }).from(schedulePeriods).where(and(...filters));
    const rows = await this.db.select({ id: schedulePeriods.id }).from(schedulePeriods).where(and(...filters)).orderBy(desc(schedulePeriods.startDate), desc(schedulePeriods.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return { data: await Promise.all(rows.map((row) => this.graph(row.id))), pagination: { page: query.page, pageSize: query.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / query.pageSize) } };
  }

  async get(principal: TrustedPrincipal, periodId: string): Promise<SchedulePeriodResponse> { managementPrincipal(principal); await this.requirePeriod(periodId, principal); return this.graph(periodId); }

  async create(principal: TrustedPrincipal, input: SchedulePeriodCreate): Promise<SchedulePeriodResponse> {
    managementPrincipal(principal);
    const data = schedulePeriodCreateSchema.parse(input);
    dateOrder(data.startDate, data.endDate); assertTimezone(data.timezone); await this.requireStore(data.storeId, principal);
    const id = await this.db.transaction(async (tx) => {
      await lock(tx, data.storeId, 1);
      const [created] = await tx.insert(schedulePeriods).values({ ...data, createdBy: principal.userId }).returning({ id: schedulePeriods.id });
      await writeHistory(tx, { scheduleId: created.id, actorId: principal.userId, action: "created", entityType: "schedule", entityId: created.id, after: data });
      await tx.insert(domainEvents).values({ eventType: "schedule.updated", aggregateType: "schedule", aggregateId: created.id, actorId: principal.userId, payload: { scheduleId: created.id, action: "created" } });
      return created.id;
    });
    return this.graph(id);
  }

  async update(principal: TrustedPrincipal, periodId: string, input: SchedulePeriodUpdate): Promise<SchedulePeriodResponse> {
    managementPrincipal(principal); const data = schedulePeriodUpdateSchema.parse(input); const current = await this.requireDraft(periodId, principal); const next = { startDate: data.startDate ?? current.period.startDate, endDate: data.endDate ?? current.period.endDate, timezone: data.timezone ?? current.period.timezone };
    dateOrder(next.startDate, next.endDate); assertTimezone(next.timezone);
    const existingShifts = await this.db.select({ localDate: scheduleShifts.localDate }).from(scheduleShifts).where(eq(scheduleShifts.periodId, periodId));
    const existingDaysOff = await this.db.select({ localDate: scheduleDaysOff.localDate }).from(scheduleDaysOff).where(eq(scheduleDaysOff.periodId, periodId));
    for (const shift of existingShifts) assertDateInRange(shift.localDate, next.startDate, next.endDate);
    for (const dayOff of existingDaysOff) assertDateInRange(dayOff.localDate, next.startDate, next.endDate);
    await this.db.transaction(async (tx) => { await lock(tx, current.period.storeId, 1); await tx.update(schedulePeriods).set({ ...next, updatedAt: new Date() }).where(eq(schedulePeriods.id, periodId)); await writeHistory(tx, { scheduleId: periodId, actorId: principal.userId, action: "updated", entityType: "schedule", entityId: periodId, before: scheduleSnapshot(current.period), after: next }); await tx.insert(domainEvents).values({ eventType: "schedule.updated", aggregateType: "schedule", aggregateId: periodId, actorId: principal.userId, payload: { scheduleId: periodId, action: "updated" } }); });
    return this.graph(periodId);
  }

  async revise(principal: TrustedPrincipal, periodId: string): Promise<SchedulePeriodResponse> {
    managementPrincipal(principal); const current = await this.requirePeriod(periodId, principal); if (current.period.status !== "published" || current.period.supersededAt) throw new DomainError(409, "SCHEDULE_REVISION_NOT_ALLOWED", "Создать ревизию можно только для актуального опубликованного расписания");
    const id = await this.db.transaction(async (tx) => {
      await lock(tx, current.period.storeId, 1);
      const [created] = await tx.insert(schedulePeriods).values({ storeId: current.period.storeId, startDate: current.period.startDate, endDate: current.period.endDate, timezone: current.period.timezone, revision: current.period.revision + 1, createdBy: principal.userId }).returning({ id: schedulePeriods.id });
      const shifts = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.periodId, periodId));
      if (shifts.length) await tx.insert(scheduleShifts).values(shifts.map((shift) => ({ periodId: created.id, employeeId: shift.employeeId, storeId: shift.storeId, localDate: shift.localDate, startTime: shift.startTime, endTime: shift.endTime, startAt: shift.startAt, endAt: shift.endAt, timezone: shift.timezone, note: shift.note, createdBy: principal.userId, updatedBy: principal.userId })));
      const days = await tx.select().from(scheduleDaysOff).where(eq(scheduleDaysOff.periodId, periodId));
      if (days.length) await tx.insert(scheduleDaysOff).values(days.map((day) => ({ periodId: created.id, employeeId: day.employeeId, storeId: day.storeId, localDate: day.localDate, note: day.note, createdBy: principal.userId, updatedBy: principal.userId })));
      await writeHistory(tx, { scheduleId: created.id, actorId: principal.userId, action: "revised", entityType: "schedule", entityId: created.id, before: scheduleSnapshot(current.period), after: { revision: current.period.revision + 1 } });
      await tx.insert(domainEvents).values({ eventType: "schedule.updated", aggregateType: "schedule", aggregateId: created.id, actorId: principal.userId, payload: { scheduleId: created.id, sourceScheduleId: periodId, action: "revised" } });
      return created.id;
    });
    return this.graph(id);
  }

  async publish(principal: TrustedPrincipal, periodId: string): Promise<SchedulePeriodResponse> {
    managementPrincipal(principal); const current = await this.requirePeriod(periodId, principal);
    const id = await this.db.transaction(async (tx) => {
      await lock(tx, current.period.storeId, 1);
      const [period] = await tx.select().from(schedulePeriods).where(eq(schedulePeriods.id, periodId)).limit(1);
      if (!period) throw new DomainError(404, "SCHEDULE_NOT_FOUND", "Расписание не найдено");
      if (period.status === "published" && !period.supersededAt) return period.id;
      if (period.status !== "draft") throw new DomainError(409, "SCHEDULE_ALREADY_SUPERSEDED", "Эта ревизия уже заменена другой");
      const old = await tx.select().from(schedulePeriods).where(and(eq(schedulePeriods.storeId, period.storeId), eq(schedulePeriods.status, "published"), isNull(schedulePeriods.supersededAt), sql`${schedulePeriods.id} <> ${periodId}::uuid`, lte(schedulePeriods.startDate, period.endDate), gte(schedulePeriods.endDate, period.startDate)));
      for (const prior of old) { await tx.update(schedulePeriods).set({ supersededAt: new Date(), updatedAt: new Date() }).where(eq(schedulePeriods.id, prior.id)); await writeHistory(tx, { scheduleId: prior.id, actorId: principal.userId, action: "superseded", entityType: "schedule", entityId: prior.id, before: scheduleSnapshot(prior), after: { supersededBy: periodId } }); }
      const shifts = await tx.select().from(scheduleShifts).where(eq(scheduleShifts.periodId, periodId));
      const days = await tx.select().from(scheduleDaysOff).where(eq(scheduleDaysOff.periodId, periodId));
      for (const shift of shifts) { await this.requireEmployee(shift.employeeId, period.storeId, principal, tx); await this.assertNoOverlap(tx, shift.employeeId, shift.startAt, shift.endAt, shift.id); }
      for (const day of days) await this.assertNoDayOffConflict(tx, periodId, day.employeeId, day.localDate, undefined);
      await tx.update(schedulePeriods).set({ status: "published", publishedBy: principal.userId, publishedAt: new Date(), updatedAt: new Date() }).where(eq(schedulePeriods.id, periodId));
      await writeHistory(tx, { scheduleId: periodId, actorId: principal.userId, action: "published", entityType: "schedule", entityId: periodId, before: scheduleSnapshot(period), after: { status: "published" } });
      await tx.insert(domainEvents).values({ eventType: "schedule.published", aggregateType: "schedule", aggregateId: periodId, actorId: principal.userId, payload: { scheduleId: periodId, revision: period.revision } });
      return periodId;
    });
    return this.graph(id);
  }

  async addShift(principal: TrustedPrincipal, periodId: string, input: ScheduleShiftCreate): Promise<SchedulePeriodResponse> {
    managementPrincipal(principal); const data = scheduleShiftCreateSchema.parse(input); const current = await this.requireDraft(periodId, principal); assertDateInRange(data.localDate, current.period.startDate, current.period.endDate); const employee = await this.requireEmployee(data.employeeId, current.period.storeId, principal, this.db); const instants = shiftInstants(data.localDate, data.startTime, data.endTime, current.period.timezone);
    await this.db.transaction(async (tx) => { await lock(tx, current.period.storeId, 1); await lock(tx, data.employeeId, 2); await this.assertNoOverlap(tx, data.employeeId, instants.startAt, instants.endAt, undefined, current.period.storeId); const [created] = await tx.insert(scheduleShifts).values({ periodId, employeeId: data.employeeId, storeId: current.period.storeId, localDate: data.localDate, startTime: data.startTime, endTime: data.endTime, startAt: instants.startAt, endAt: instants.endAt, timezone: current.period.timezone, note: data.note ?? null, createdBy: principal.userId, updatedBy: principal.userId }).returning({ id: scheduleShifts.id }); await writeHistory(tx, { scheduleId: periodId, actorId: principal.userId, action: "shift_added", entityType: "shift", entityId: created.id, after: { ...data, employeeName: `${employee.firstName} ${employee.lastName}` } }); await tx.insert(domainEvents).values({ eventType: "schedule.updated", aggregateType: "schedule", aggregateId: periodId, actorId: principal.userId, payload: { scheduleId: periodId, shiftId: created.id, action: "shift_added" } }); });
    return this.graph(periodId);
  }

  async updateShift(principal: TrustedPrincipal, periodId: string, shiftId: string, input: ScheduleShiftUpdate): Promise<SchedulePeriodResponse> {
    managementPrincipal(principal); const data = scheduleShiftUpdateSchema.parse(input); const current = await this.requireDraft(periodId, principal); const [old] = await this.db.select().from(scheduleShifts).where(and(eq(scheduleShifts.id, shiftId), eq(scheduleShifts.periodId, periodId))).limit(1); if (!old) throw new DomainError(404, "SHIFT_NOT_FOUND", "Смена не найдена");
    const nextDate = data.localDate ?? old.localDate; const startTime = data.startTime ?? old.startTime; const endTime = data.endTime ?? old.endTime; assertDateInRange(nextDate, current.period.startDate, current.period.endDate); const instants = shiftInstants(nextDate, startTime, endTime, current.period.timezone);
    await this.db.transaction(async (tx) => { await lock(tx, current.period.storeId, 1); await lock(tx, old.employeeId, 2); await this.assertNoOverlap(tx, old.employeeId, instants.startAt, instants.endAt, shiftId, current.period.storeId); await tx.update(scheduleShifts).set({ localDate: nextDate, startTime, endTime, startAt: instants.startAt, endAt: instants.endAt, timezone: current.period.timezone, note: data.note === undefined ? old.note : data.note, updatedBy: principal.userId, updatedAt: new Date() }).where(eq(scheduleShifts.id, shiftId)); await writeHistory(tx, { scheduleId: periodId, actorId: principal.userId, action: "shift_updated", entityType: "shift", entityId: shiftId, before: { localDate: old.localDate, startTime: old.startTime, endTime: old.endTime, note: old.note }, after: { localDate: nextDate, startTime, endTime, note: data.note === undefined ? old.note : data.note } }); await tx.insert(domainEvents).values({ eventType: "schedule.updated", aggregateType: "schedule", aggregateId: periodId, actorId: principal.userId, payload: { scheduleId: periodId, shiftId, action: "shift_updated" } }); });
    return this.graph(periodId);
  }

  async removeShift(principal: TrustedPrincipal, periodId: string, shiftId: string): Promise<SchedulePeriodResponse> { managementPrincipal(principal); const current = await this.requireDraft(periodId, principal); await this.db.transaction(async (tx) => { await lock(tx, current.period.storeId, 1); const [old] = await tx.select().from(scheduleShifts).where(and(eq(scheduleShifts.id, shiftId), eq(scheduleShifts.periodId, periodId))).limit(1); if (!old) throw new DomainError(404, "SHIFT_NOT_FOUND", "Смена не найдена"); await tx.delete(scheduleShifts).where(eq(scheduleShifts.id, shiftId)); await writeHistory(tx, { scheduleId: periodId, actorId: principal.userId, action: "shift_removed", entityType: "shift", entityId: shiftId, before: { localDate: old.localDate, startTime: old.startTime, endTime: old.endTime } }); await tx.insert(domainEvents).values({ eventType: "schedule.updated", aggregateType: "schedule", aggregateId: periodId, actorId: principal.userId, payload: { scheduleId: periodId, shiftId, action: "shift_removed" } }); }); return this.graph(periodId); }

  async addDayOff(principal: TrustedPrincipal, periodId: string, input: ScheduleDayOffCreate): Promise<SchedulePeriodResponse> { managementPrincipal(principal); const data = scheduleDayOffCreateSchema.parse(input); const current = await this.requireDraft(periodId, principal); assertDateInRange(data.localDate, current.period.startDate, current.period.endDate); await this.requireEmployee(data.employeeId, current.period.storeId, principal, this.db); await this.db.transaction(async (tx) => { await lock(tx, current.period.storeId, 1); await lock(tx, data.employeeId, 2); await this.assertNoDayOffConflict(tx, periodId, data.employeeId, data.localDate); try { const [created] = await tx.insert(scheduleDaysOff).values({ periodId, employeeId: data.employeeId, storeId: current.period.storeId, localDate: data.localDate, note: data.note ?? null, createdBy: principal.userId, updatedBy: principal.userId }).returning({ id: scheduleDaysOff.id }); await writeHistory(tx, { scheduleId: periodId, actorId: principal.userId, action: "day_off_added", entityType: "day_off", entityId: created.id, after: data }); await tx.insert(domainEvents).values({ eventType: "schedule.updated", aggregateType: "schedule", aggregateId: periodId, actorId: principal.userId, payload: { scheduleId: periodId, dayOffId: created.id, action: "day_off_added" } }); } catch (error) { if ((error as { code?: string }).code === "23505") throw new DomainError(409, "DAY_OFF_EXISTS", "Выходной уже назначен"); throw error; } }); return this.graph(periodId); }

  async updateDayOff(principal: TrustedPrincipal, periodId: string, dayOffId: string, input: ScheduleDayOffUpdate): Promise<SchedulePeriodResponse> { managementPrincipal(principal); const data = scheduleDayOffUpdateSchema.parse(input); const current = await this.requireDraft(periodId, principal); const [old] = await this.db.select().from(scheduleDaysOff).where(and(eq(scheduleDaysOff.id, dayOffId), eq(scheduleDaysOff.periodId, periodId))).limit(1); if (!old) throw new DomainError(404, "DAY_OFF_NOT_FOUND", "Выходной не найден"); const localDate = data.localDate ?? old.localDate; assertDateInRange(localDate, current.period.startDate, current.period.endDate); await this.db.transaction(async (tx) => { await lock(tx, current.period.storeId, 1); await lock(tx, old.employeeId, 2); await this.assertNoDayOffConflict(tx, periodId, old.employeeId, localDate, dayOffId); await tx.update(scheduleDaysOff).set({ localDate, note: data.note === undefined ? old.note : data.note, updatedBy: principal.userId, updatedAt: new Date() }).where(eq(scheduleDaysOff.id, dayOffId)); await writeHistory(tx, { scheduleId: periodId, actorId: principal.userId, action: "day_off_updated", entityType: "day_off", entityId: dayOffId, before: { localDate: old.localDate, note: old.note }, after: { localDate, note: data.note === undefined ? old.note : data.note } }); await tx.insert(domainEvents).values({ eventType: "schedule.updated", aggregateType: "schedule", aggregateId: periodId, actorId: principal.userId, payload: { scheduleId: periodId, dayOffId, action: "day_off_updated" } }); }); return this.graph(periodId); }

  async removeDayOff(principal: TrustedPrincipal, periodId: string, dayOffId: string): Promise<SchedulePeriodResponse> { managementPrincipal(principal); const current = await this.requireDraft(periodId, principal); await this.db.transaction(async (tx) => { await lock(tx, current.period.storeId, 1); const [old] = await tx.select().from(scheduleDaysOff).where(and(eq(scheduleDaysOff.id, dayOffId), eq(scheduleDaysOff.periodId, periodId))).limit(1); if (!old) throw new DomainError(404, "DAY_OFF_NOT_FOUND", "Выходной не найден"); await tx.delete(scheduleDaysOff).where(eq(scheduleDaysOff.id, dayOffId)); await writeHistory(tx, { scheduleId: periodId, actorId: principal.userId, action: "day_off_removed", entityType: "day_off", entityId: dayOffId, before: { localDate: old.localDate, note: old.note } }); await tx.insert(domainEvents).values({ eventType: "schedule.updated", aggregateType: "schedule", aggregateId: periodId, actorId: principal.userId, payload: { scheduleId: periodId, dayOffId, action: "day_off_removed" } }); }); return this.graph(periodId); }

  async history(principal: TrustedPrincipal, periodId: string) { managementPrincipal(principal); await this.requirePeriod(periodId, principal); const rows = await this.db.select({ history: scheduleHistory, actor: users }).from(scheduleHistory).innerJoin(users, eq(users.id, scheduleHistory.actorId)).where(eq(scheduleHistory.scheduleId, periodId)).orderBy(desc(scheduleHistory.createdAt)); return { data: rows.map(({ history, actor: historyActor }) => ({ id: history.id, scheduleId: history.scheduleId, actor: { id: historyActor.id, firstName: historyActor.firstName, lastName: historyActor.lastName, role: historyActor.role }, action: history.action as never, entityType: history.entityType, entityId: history.entityId, before: history.before as Record<string, unknown> | null, after: history.after as Record<string, unknown> | null, createdAt: history.createdAt.toISOString() })) }; }

  async staffSchedule(principal: TrustedPrincipal, input: { from: string; to: string }): Promise<StaffScheduleResponse> {
    assertActivePrincipal(principal); if (principal.role !== "staff") throw new DomainError(403, "FORBIDDEN", "Только сотрудники могут просматривать своё расписание"); const query = staffScheduleQuerySchema.parse(input); const dates = dateRange(query.from, query.to); const memberships = await this.db.select({ storeId: userStores.storeId }).from(userStores).innerJoin(stores, eq(stores.id, userStores.storeId)).where(and(eq(userStores.userId, principal.userId), eq(stores.isActive, true))); const storeIds = memberships.map((row) => row.storeId); if (storeIds.length === 0) return { from: query.from, to: query.to, days: dates.map((date) => ({ date, status: "no_schedule", shifts: [], daysOff: [] })), nextShift: null };
    const periods = await this.db.select({ period: schedulePeriods, storeName: stores.name }).from(schedulePeriods).innerJoin(stores, eq(stores.id, schedulePeriods.storeId)).where(and(inArray(schedulePeriods.storeId, storeIds), eq(schedulePeriods.status, "published"), isNull(schedulePeriods.supersededAt), lte(schedulePeriods.startDate, query.to), gte(schedulePeriods.endDate, query.from)));
    const periodIds = periods.map((row) => row.period.id); if (!periodIds.length) return { from: query.from, to: query.to, days: dates.map((date) => ({ date, status: "no_schedule", shifts: [], daysOff: [] })), nextShift: null };
    const shiftRows = await this.db.select({ shift: scheduleShifts, employee: users, storeName: stores.name }).from(scheduleShifts).innerJoin(users, eq(users.id, scheduleShifts.employeeId)).innerJoin(stores, eq(stores.id, scheduleShifts.storeId)).where(and(eq(scheduleShifts.employeeId, principal.userId), inArray(scheduleShifts.periodId, periodIds), gte(scheduleShifts.localDate, query.from), lte(scheduleShifts.localDate, query.to))).orderBy(asc(scheduleShifts.startAt));
    const daysOffRows = await this.db.select({ dayOff: scheduleDaysOff, employee: users, storeName: stores.name }).from(scheduleDaysOff).innerJoin(users, eq(users.id, scheduleDaysOff.employeeId)).innerJoin(stores, eq(stores.id, scheduleDaysOff.storeId)).where(and(eq(scheduleDaysOff.employeeId, principal.userId), inArray(scheduleDaysOff.periodId, periodIds), gte(scheduleDaysOff.localDate, query.from), lte(scheduleDaysOff.localDate, query.to)));
    const toShift = ({ shift, employee, storeName }: typeof shiftRows[number]) => ({ id: shift.id, periodId: shift.periodId, employeeId: shift.employeeId, employeeName: `${employee.firstName} ${employee.lastName}`, storeId: shift.storeId, storeName, localDate: shift.localDate, startTime: shift.startTime, endTime: shift.endTime, timezone: shift.timezone, startAt: shift.startAt.toISOString(), endAt: shift.endAt.toISOString(), note: shift.note });
    const toDayOff = ({ dayOff, employee, storeName }: typeof daysOffRows[number]) => ({ id: dayOff.id, periodId: dayOff.periodId, employeeId: dayOff.employeeId, employeeName: `${employee.firstName} ${employee.lastName}`, storeId: dayOff.storeId, storeName, localDate: dayOff.localDate, note: dayOff.note });
    const shifts = shiftRows.map(toShift); const daysOff = daysOffRows.map(toDayOff); const days = dates.map((date) => { const dateShifts = shifts.filter((shift) => shift.localDate === date); const dateDaysOff = daysOff.filter((day) => day.localDate === date); const covered = periods.some(({ period }) => period.startDate <= date && period.endDate >= date); return { date, status: dateDaysOff.length ? "day_off" as const : dateShifts.length ? "scheduled" as const : covered ? "no_schedule" as const : "no_schedule" as const, shifts: dateShifts, daysOff: dateDaysOff }; });
    return { from: query.from, to: query.to, days, nextShift: shifts.find((shift) => new Date(shift.startAt) >= new Date()) ?? null };
  }
}

export function createSchedulesService(db: Database): SchedulesService { return new SchedulesService(db); }

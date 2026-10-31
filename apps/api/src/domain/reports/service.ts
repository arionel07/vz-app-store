import { and, eq, sql } from "drizzle-orm";
import {
  reportEmployeeFiltersSchema,
  reportFiltersSchema,
  reportPageFiltersSchema,
  type ReportTimeSeriesPoint,
  type ReportEmployeeFilters,
  type ReportFilters,
  type ReportPageFilters,
  type ReportPeriodResponse,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import { stores, userStores } from "../../db/schema";
import { assertActivePrincipal, type TrustedPrincipal } from "../authz";
import { DomainError } from "../errors";
import { dateRange, localDateTimeToUtc, assertTimezone } from "../schedules/timezone";

type Rows = Array<Record<string, unknown>>;
type Scope = { role: "admin" | "manager"; storeIds: string[] };
type Period = { preset: ReportFilters["period"]; startDate: string; endDate: string; startAt: Date; endAt: Date; timezone: string; snapshotAt: Date };

const dateString = (date: Date) => date.toISOString().slice(0, 10);
function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateString(date);
}
function localDateAt(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function resolveReportPeriod(input: ReportFilters, now = new Date()): Period {
  const timezone = assertTimezone(input.timezone);
  const today = localDateAt(now, timezone);
  let startDate: string;
  let endDate: string;
  switch (input.period) {
    case "today": startDate = today; endDate = today; break;
    case "last_7_days": startDate = addDays(today, -6); endDate = today; break;
    case "last_30_days": startDate = addDays(today, -29); endDate = today; break;
    case "current_month": startDate = `${today.slice(0, 7)}-01`; endDate = today; break;
    case "previous_month": {
      const currentMonthStart = `${today.slice(0, 7)}-01`;
      endDate = addDays(currentMonthStart, -1);
      startDate = `${endDate.slice(0, 7)}-01`;
      break;
    }
    case "custom": startDate = input.startDate!; endDate = input.endDate!; break;
  }
  if (dateRange(startDate, endDate).length > 366) throw new DomainError(400, "INVALID_REPORT_PERIOD", "Период отчёта не может превышать 366 дней");
  const endExclusiveDate = addDays(endDate, 1);
  return {
    preset: input.period, startDate, endDate,
    startAt: localDateTimeToUtc(startDate, "00:00", timezone),
    endAt: localDateTimeToUtc(endExclusiveDate, "00:00", timezone),
    timezone, snapshotAt: now,
  };
}
function periodDto(period: Period): ReportPeriodResponse {
  return { preset: period.preset, startDate: period.startDate, endDate: period.endDate, startAt: period.startAt.toISOString(), endAt: period.endAt.toISOString(), endExclusive: true, timezone: period.timezone, snapshotAt: period.snapshotAt.toISOString() };
}
function idsSql(ids: readonly string[]) { return ids.length ? sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `) : sql`NULL::uuid`; }
function storesWhere(alias: string, ids: readonly string[], column = "store_id") {
  if (!ids.length) return sql`false`;
  const field = sql.raw(`"${alias}"."${column}"`);
  return sql`${field} IN (${idsSql(ids)})`;
}
function ts(value: Date) { return sql`${value.toISOString()}::timestamptz`; }
function n(row: Record<string, unknown> | undefined, key: string): number { return Number(row?.[key] ?? 0); }
function nullable(row: Record<string, unknown> | undefined, key: string): number | null { const value = row?.[key]; return value === null || value === undefined ? null : Number(value); }
function percentage(numerator: number, denominator: number): number | null { return denominator ? Math.round((numerator * 10000) / denominator) / 100 : null; }
function pagination(page: number, pageSize: number, total: number) { return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }; }

export class ReportsService {
  constructor(private readonly db: Database) {}

  private async scope(principal: TrustedPrincipal, storeId?: string): Promise<Scope> {
    assertActivePrincipal(principal);
    if (principal.role !== "admin" && principal.role !== "manager") throw new DomainError(403, "FORBIDDEN", "Роль не имеет доступа к управленческой отчётности");
    let authorizedIds: string[];
    if (principal.role === "admin") {
      const rows = await this.db.select({ id: stores.id }).from(stores).where(eq(stores.isActive, true));
      authorizedIds = rows.map((row) => row.id);
    } else {
      const rows = await this.db.select({ id: userStores.storeId }).from(userStores).innerJoin(stores, and(eq(stores.id, userStores.storeId), eq(stores.isActive, true))).where(eq(userStores.userId, principal.userId));
      authorizedIds = [...new Set(rows.map((row) => row.id))];
    }
    if (storeId) {
      if (!authorizedIds.includes(storeId)) throw new DomainError(404, "REPORT_SCOPE_NOT_FOUND", "Объект отчёта не найден");
      return { role: principal.role, storeIds: [storeId] };
    }
    return { role: principal.role, storeIds: authorizedIds };
  }

  private filters(filters: ReportFilters) {
    const parsed = reportFiltersSchema.parse(filters);
    return { input: parsed, period: resolveReportPeriod(parsed) };
  }

  private async validateEmployee(employeeId: string | undefined, scope: Scope): Promise<void> {
    if (!employeeId) return;
    const [employee] = await this.db.execute(sql`
      SELECT "u"."id" FROM "users" AS "u"
      WHERE "u"."id" = ${employeeId}::uuid AND "u"."role" = 'staff' AND "u"."is_active" = true
        AND EXISTS (SELECT 1 FROM "user_stores" AS "us" INNER JOIN "stores" AS "s" ON "s"."id" = "us"."store_id"
          WHERE "us"."user_id" = "u"."id" AND "s"."is_active" = true AND ${storesWhere("s", scope.storeIds, "id")})
      LIMIT 1
    `) as Rows;
    if (!employee) throw new DomainError(404, "REPORT_EMPLOYEE_NOT_FOUND", "Сотрудник не найден");
  }

  async overview(principal: TrustedPrincipal, filters: ReportFilters) {
    const { input, period } = this.filters(filters);
    const scope = await this.scope(principal, input.storeId);
    const store = storesWhere("s", scope.storeIds, "id");
    const [rows] = await Promise.all([
      this.db.execute(sql`
        WITH participation AS (
          SELECT "t"."store_id" FROM "task_occurrences" AS "t" WHERE ${storesWhere("t", scope.storeIds)} AND "t"."created_at" >= ${ts(period.startAt)} AND "t"."created_at" < ${ts(period.endAt)}
          UNION SELECT "r"."store_id" FROM "photo_reports" AS "r" INNER JOIN "photo_report_versions" AS "v" ON "v"."report_id" = "r"."id" WHERE ${storesWhere("r", scope.storeIds)} AND "v"."submitted_at" >= ${ts(period.startAt)} AND "v"."submitted_at" < ${ts(period.endAt)}
          UNION SELECT "d"."store_id" FROM "merchandising_inspections" AS "m" INNER JOIN "merchandising_displays" AS "d" ON "d"."id" = "m"."display_id" WHERE ${storesWhere("d", scope.storeIds)} AND "m"."submitted_at" >= ${ts(period.startAt)} AND "m"."submitted_at" < ${ts(period.endAt)}
          UNION SELECT "e"."store_id" FROM "retail_campaign_submissions" AS "sub" INNER JOIN "retail_campaign_executions" AS "e" ON "e"."id" = "sub"."execution_id" WHERE ${storesWhere("e", scope.storeIds)} AND "sub"."submitted_at" >= ${ts(period.startAt)} AND "sub"."submitted_at" < ${ts(period.endAt)}
          UNION SELECT "i"."store_id" FROM "store_issues" AS "i" WHERE ${storesWhere("i", scope.storeIds)} AND "i"."created_at" >= ${ts(period.startAt)} AND "i"."created_at" < ${ts(period.endAt)}
          UNION SELECT "q"."store_id" FROM "operational_requests" AS "q" WHERE ${storesWhere("q", scope.storeIds)} AND "q"."created_at" >= ${ts(period.startAt)} AND "q"."created_at" < ${ts(period.endAt)}
        ), task_counts AS (
          SELECT COUNT(*)::int AS assigned, COUNT(*) FILTER (WHERE "t"."status" = 'checked')::int AS checked FROM "task_occurrences" AS "t"
          WHERE ${storesWhere("t", scope.storeIds)} AND "t"."created_at" >= ${ts(period.startAt)} AND "t"."created_at" < ${ts(period.endAt)}
        ), review_counts AS (
          SELECT (SELECT COUNT(*) FROM "task_occurrences" "t" WHERE ${storesWhere("t", scope.storeIds)} AND "t"."status" = 'submitted')
            + (SELECT COUNT(*) FROM "photo_report_versions" "v" INNER JOIN "photo_reports" "r" ON "r"."id" = "v"."report_id" WHERE ${storesWhere("r", scope.storeIds)} AND "v"."status" = 'pending')
            + (SELECT COUNT(*) FROM "retail_campaign_executions" "e" WHERE ${storesWhere("e", scope.storeIds)} AND "e"."status" = 'submitted')
            + (SELECT COUNT(*) FROM "merchandising_inspections" "m" INNER JOIN "merchandising_displays" "d" ON "d"."id" = "m"."display_id" WHERE ${storesWhere("d", scope.storeIds)} AND "m"."status" = 'submitted')
            + (SELECT COUNT(*) FROM "quiz_attempt_answers" "qa" INNER JOIN "quiz_attempts" "a" ON "a"."id" = "qa"."attempt_id" INNER JOIN "users" "u" ON "u"."id" = "a"."user_id"
              WHERE "qa"."review_status" = 'pending' AND "a"."status" = 'submitted' AND "u"."role" = 'staff' AND "u"."is_active" = true
                AND EXISTS (SELECT 1 FROM "user_stores" "us" INNER JOIN "stores" "s" ON "s"."id" = "us"."store_id" WHERE "us"."user_id" = "u"."id" AND "s"."is_active" = true AND ${storesWhere("s", scope.storeIds, "id")})) AS count
        )
        SELECT (SELECT COUNT(*)::int FROM "stores" "s" WHERE ${store}) AS active_stores,
          (SELECT COUNT(DISTINCT "u"."id")::int FROM "users" "u" INNER JOIN "user_stores" "us" ON "us"."user_id" = "u"."id" INNER JOIN "stores" "s" ON "s"."id" = "us"."store_id" WHERE "u"."role" = 'staff' AND "u"."is_active" AND "s"."is_active" AND ${storesWhere("s", scope.storeIds, "id")}) AS employees,
          (SELECT COUNT(DISTINCT "p"."store_id")::int FROM participation "p" INNER JOIN "stores" "s" ON "s"."id" = "p"."store_id" WHERE "s"."is_active" AND ${storesWhere("s", scope.storeIds, "id")}) AS participating,
          (SELECT assigned FROM task_counts) AS assigned_tasks, (SELECT checked FROM task_counts) AS checked_tasks, (SELECT count FROM review_counts)::int AS outstanding_reviews
      `) as unknown as Promise<Rows>,
    ]);
    const row = rows[0];
    const assigned = n(row, "assigned_tasks");
    const checked = n(row, "checked_tasks");
    return { period: periodDto(period), metrics: { activeStoreCount: n(row, "active_stores"), activeAssignedEmployeeCount: n(row, "employees"), participatingStoreCount: n(row, "participating"), assignedTaskCount: assigned, checkedTaskCount: checked, outstandingReviewCount: n(row, "outstanding_reviews"), taskCompletionRate: percentage(checked, assigned) } };
  }

  async timeSeries(principal: TrustedPrincipal, filters: ReportFilters) {
    const { input, period } = this.filters(filters);
    const scope = await this.scope(principal, input.storeId);
    const rows = await this.db.execute(sql`
      WITH dates AS (
        SELECT generate_series(${period.startDate}::date, ${period.endDate}::date, interval '1 day')::date AS local_date
      ), events AS (
        SELECT ("t"."created_at" AT TIME ZONE ${period.timezone})::date AS local_date, 'task'::text AS kind FROM "task_occurrences" "t"
        WHERE ${storesWhere("t", scope.storeIds)} AND "t"."created_at" >= ${ts(period.startAt)} AND "t"."created_at" < ${ts(period.endAt)}
        UNION ALL
        SELECT ("v"."submitted_at" AT TIME ZONE ${period.timezone})::date, 'photo'::text FROM "photo_report_versions" "v" INNER JOIN "photo_reports" "r" ON "r"."id" = "v"."report_id"
        WHERE ${storesWhere("r", scope.storeIds)} AND "v"."submitted_at" >= ${ts(period.startAt)} AND "v"."submitted_at" < ${ts(period.endAt)}
        UNION ALL
        SELECT ("a"."submitted_at" AT TIME ZONE ${period.timezone})::date, 'quiz'::text FROM "quiz_attempts" "a" INNER JOIN "users" "u" ON "u"."id" = "a"."user_id"
        WHERE "a"."status" = 'submitted' AND "a"."submitted_at" >= ${ts(period.startAt)} AND "a"."submitted_at" < ${ts(period.endAt)}
          AND "u"."role" = 'staff' AND "u"."is_active" = true
          AND EXISTS (SELECT 1 FROM "user_stores" "us" INNER JOIN "stores" "s" ON "s"."id" = "us"."store_id" WHERE "us"."user_id" = "u"."id" AND "s"."is_active" = true AND ${storesWhere("s", scope.storeIds, "id")})
        UNION ALL
        SELECT ("sub"."submitted_at" AT TIME ZONE ${period.timezone})::date, 'campaign'::text FROM "retail_campaign_submissions" "sub" INNER JOIN "retail_campaign_executions" "e" ON "e"."id" = "sub"."execution_id"
        WHERE ${storesWhere("e", scope.storeIds)} AND "sub"."submitted_at" >= ${ts(period.startAt)} AND "sub"."submitted_at" < ${ts(period.endAt)}
        UNION ALL
        SELECT ("m"."submitted_at" AT TIME ZONE ${period.timezone})::date, 'merchandising'::text FROM "merchandising_inspections" "m" INNER JOIN "merchandising_displays" "d" ON "d"."id" = "m"."display_id"
        WHERE ${storesWhere("d", scope.storeIds)} AND "m"."submitted_at" >= ${ts(period.startAt)} AND "m"."submitted_at" < ${ts(period.endAt)}
        UNION ALL
        SELECT ("i"."created_at" AT TIME ZONE ${period.timezone})::date, 'issue'::text FROM "store_issues" "i"
        WHERE ${storesWhere("i", scope.storeIds)} AND "i"."created_at" >= ${ts(period.startAt)} AND "i"."created_at" < ${ts(period.endAt)}
        UNION ALL
        SELECT ("r"."created_at" AT TIME ZONE ${period.timezone})::date, 'request'::text FROM "operational_requests" "r"
        WHERE ${storesWhere("r", scope.storeIds)} AND "r"."created_at" >= ${ts(period.startAt)} AND "r"."created_at" < ${ts(period.endAt)}
      )
      SELECT to_char("d"."local_date", 'YYYY-MM-DD') AS local_date,
        COUNT(*) FILTER (WHERE "e"."kind" = 'task')::int AS tasks,
        COUNT(*) FILTER (WHERE "e"."kind" = 'photo')::int AS photos,
        COUNT(*) FILTER (WHERE "e"."kind" = 'quiz')::int AS quizzes,
        COUNT(*) FILTER (WHERE "e"."kind" = 'campaign')::int AS campaigns,
        COUNT(*) FILTER (WHERE "e"."kind" = 'merchandising')::int AS merchandising,
        COUNT(*) FILTER (WHERE "e"."kind" = 'issue')::int AS issues,
        COUNT(*) FILTER (WHERE "e"."kind" = 'request')::int AS requests
      FROM dates "d" LEFT JOIN events "e" ON "e"."local_date" = "d"."local_date"
      GROUP BY "d"."local_date" ORDER BY "d"."local_date" ASC
    `) as Rows;
    const data: ReportTimeSeriesPoint[] = rows.map((row) => ({
      localDate: String(row.local_date), taskOccurrencesCreated: n(row, "tasks"), photoVersionsSubmitted: n(row, "photos"),
      quizAttemptsSubmitted: n(row, "quizzes"), campaignSubmissions: n(row, "campaigns"),
      merchandisingInspectionsSubmitted: n(row, "merchandising"), issuesCreated: n(row, "issues"), requestsCreated: n(row, "requests"),
    }));
    return { period: periodDto(period), interval: "day" as const, data };
  }

  async stores(principal: TrustedPrincipal, filters: ReportPageFilters) {
    const parsed = reportPageFiltersSchema.parse(filters);
    const { period } = this.filters(parsed);
    const scope = await this.scope(principal, parsed.storeId);
    const total = scope.storeIds.length;
    const offset = (parsed.page - 1) * parsed.pageSize;
    const rows = await this.db.execute(sql`
      SELECT "s"."id" AS store_id, "s"."name" AS store_name,
        (SELECT COUNT(DISTINCT "u"."id")::int FROM "users" "u" INNER JOIN "user_stores" "us" ON "us"."user_id" = "u"."id" WHERE "u"."is_active" AND "u"."role" = 'staff' AND "us"."store_id" = "s"."id") AS employees,
        (SELECT COUNT(*)::int FROM "task_occurrences" "t" WHERE "t"."store_id" = "s"."id" AND "t"."created_at" >= ${ts(period.startAt)} AND "t"."created_at" < ${ts(period.endAt)}) AS tasks,
        (SELECT COUNT(*)::int FROM "task_occurrences" "t" WHERE "t"."store_id" = "s"."id" AND "t"."status" = 'checked' AND "t"."created_at" >= ${ts(period.startAt)} AND "t"."created_at" < ${ts(period.endAt)}) AS checked_tasks,
        (SELECT COUNT(DISTINCT "r"."id")::int FROM "photo_reports" "r" INNER JOIN "photo_report_versions" "v" ON "v"."report_id" = "r"."id" WHERE "r"."store_id" = "s"."id" AND "v"."version_number" = 1 AND "v"."submitted_at" >= ${ts(period.startAt)} AND "v"."submitted_at" < ${ts(period.endAt)}) AS photo_reports,
        (SELECT COUNT(*)::int FROM "quiz_attempts" "a" INNER JOIN "users" "u" ON "u"."id" = "a"."user_id" AND "u"."role" = 'staff' AND "u"."is_active" = true INNER JOIN "user_stores" "us" ON "us"."user_id" = "a"."user_id" WHERE "us"."store_id" = "s"."id" AND "a"."status" = 'submitted' AND "a"."submitted_at" >= ${ts(period.startAt)} AND "a"."submitted_at" < ${ts(period.endAt)}) AS quiz_attempts,
        EXISTS (SELECT 1 FROM "task_occurrences" "t" WHERE "t"."store_id" = "s"."id" AND "t"."created_at" >= ${ts(period.startAt)} AND "t"."created_at" < ${ts(period.endAt)})
          OR EXISTS (SELECT 1 FROM "photo_reports" "r" INNER JOIN "photo_report_versions" "v" ON "v"."report_id" = "r"."id" WHERE "r"."store_id" = "s"."id" AND "v"."submitted_at" >= ${ts(period.startAt)} AND "v"."submitted_at" < ${ts(period.endAt)})
          OR EXISTS (SELECT 1 FROM "merchandising_inspections" "m" INNER JOIN "merchandising_displays" "d" ON "d"."id" = "m"."display_id" WHERE "d"."store_id" = "s"."id" AND "m"."submitted_at" >= ${ts(period.startAt)} AND "m"."submitted_at" < ${ts(period.endAt)})
          OR EXISTS (SELECT 1 FROM "retail_campaign_submissions" "sub" INNER JOIN "retail_campaign_executions" "e" ON "e"."id" = "sub"."execution_id" WHERE "e"."store_id" = "s"."id" AND "sub"."submitted_at" >= ${ts(period.startAt)} AND "sub"."submitted_at" < ${ts(period.endAt)})
          OR EXISTS (SELECT 1 FROM "store_issues" "i" WHERE "i"."store_id" = "s"."id" AND "i"."created_at" >= ${ts(period.startAt)} AND "i"."created_at" < ${ts(period.endAt)})
          OR EXISTS (SELECT 1 FROM "operational_requests" "r" WHERE "r"."store_id" = "s"."id" AND "r"."created_at" >= ${ts(period.startAt)} AND "r"."created_at" < ${ts(period.endAt)}) AS participated
      FROM "stores" "s" WHERE "s"."is_active" AND ${storesWhere("s", scope.storeIds, "id")} ORDER BY "s"."name" ASC, "s"."id" ASC LIMIT ${parsed.pageSize} OFFSET ${offset}
    `) as Rows;
    return { period: periodDto(period), data: rows.map((row) => ({ storeId: String(row.store_id), storeName: String(row.store_name), activeAssignedEmployeeCount: n(row, "employees"), assignedTaskCount: n(row, "tasks"), checkedTaskCount: n(row, "checked_tasks"), photoReportCount: n(row, "photo_reports"), submittedQuizAttemptCount: n(row, "quiz_attempts"), participated: row.participated === true })), pagination: pagination(parsed.page, parsed.pageSize, total) };
  }

  async employees(principal: TrustedPrincipal, filters: ReportEmployeeFilters) {
    const parsed = reportEmployeeFiltersSchema.parse(filters);
    const { period } = this.filters(parsed);
    const scope = await this.scope(principal, parsed.storeId);
    await this.validateEmployee(parsed.employeeId, scope);
    const employeeFilter = parsed.employeeId ? sql`AND "u"."id" = ${parsed.employeeId}::uuid` : sql``;
    const rows = await this.db.execute(sql`
      SELECT "u"."id" AS employee_id, CONCAT("u"."first_name", ' ', "u"."last_name") AS display_name,
        COUNT(DISTINCT "us"."store_id")::int AS store_count,
        (SELECT COUNT(*)::int FROM "quiz_attempts" "a" WHERE "a"."user_id" = "u"."id" AND "a"."status" = 'submitted' AND "a"."submitted_at" >= ${ts(period.startAt)} AND "a"."submitted_at" < ${ts(period.endAt)}) AS quiz_attempts,
        (SELECT COUNT(*)::int FROM "quiz_attempts" "a" INNER JOIN "quiz_revisions" "qr" ON "qr"."id" = "a"."revision_id" WHERE "a"."user_id" = "u"."id" AND "a"."status" = 'submitted' AND "qr"."assessment_mode" = 'exam' AND "a"."passed" IS TRUE AND "a"."submitted_at" >= ${ts(period.startAt)} AND "a"."submitted_at" < ${ts(period.endAt)}) AS passed,
        (SELECT COUNT(*)::int FROM "quiz_attempts" "a" INNER JOIN "quiz_revisions" "qr" ON "qr"."id" = "a"."revision_id" WHERE "a"."user_id" = "u"."id" AND "a"."status" = 'submitted' AND "qr"."assessment_mode" = 'exam' AND "a"."passed" IS FALSE AND "a"."submitted_at" >= ${ts(period.startAt)} AND "a"."submitted_at" < ${ts(period.endAt)}) AS failed,
        (SELECT COUNT(*)::int FROM "task_occurrences" "t" WHERE "t"."assigned_employee_id" = "u"."id" AND "t"."created_at" >= ${ts(period.startAt)} AND "t"."created_at" < ${ts(period.endAt)} AND ${storesWhere("t", scope.storeIds)}) AS assigned_tasks,
        (SELECT COUNT(*)::int FROM "task_occurrences" "t" WHERE "t"."assigned_employee_id" = "u"."id" AND "t"."status" = 'checked' AND "t"."created_at" >= ${ts(period.startAt)} AND "t"."created_at" < ${ts(period.endAt)} AND ${storesWhere("t", scope.storeIds)}) AS checked_tasks,
        (SELECT COUNT(DISTINCT "r"."id")::int FROM "photo_reports" "r" INNER JOIN "photo_report_versions" "v" ON "v"."report_id" = "r"."id" WHERE "r"."submitted_by" = "u"."id" AND "v"."version_number" = 1 AND "v"."submitted_at" >= ${ts(period.startAt)} AND "v"."submitted_at" < ${ts(period.endAt)} AND ${storesWhere("r", scope.storeIds)}) AS photo_reports
      FROM "users" "u" INNER JOIN "user_stores" "us" ON "us"."user_id" = "u"."id" INNER JOIN "stores" "s" ON "s"."id" = "us"."store_id"
      WHERE "u"."role" = 'staff' AND "u"."is_active" AND "s"."is_active" AND ${storesWhere("s", scope.storeIds, "id")} ${employeeFilter}
      GROUP BY "u"."id", "u"."first_name", "u"."last_name" ORDER BY "u"."last_name" ASC, "u"."first_name" ASC, "u"."id" ASC LIMIT ${parsed.pageSize} OFFSET ${(parsed.page - 1) * parsed.pageSize}
    `) as Rows;
    const [countRow] = await this.db.execute(sql`SELECT COUNT(DISTINCT "u"."id")::int AS total FROM "users" "u" INNER JOIN "user_stores" "us" ON "us"."user_id" = "u"."id" INNER JOIN "stores" "s" ON "s"."id" = "us"."store_id" WHERE "u"."role" = 'staff' AND "u"."is_active" AND "s"."is_active" AND ${storesWhere("s", scope.storeIds, "id")} ${employeeFilter}`) as Rows;
    return { period: periodDto(period), data: rows.map((row) => ({ employeeId: String(row.employee_id), displayName: String(row.display_name), assignedStoreCount: n(row, "store_count"), submittedQuizAttemptCount: n(row, "quiz_attempts"), passedExamAttemptCount: n(row, "passed"), failedExamAttemptCount: n(row, "failed"), assignedTaskCount: n(row, "assigned_tasks"), checkedTaskCount: n(row, "checked_tasks"), submittedPhotoReportCount: n(row, "photo_reports") })), pagination: pagination(parsed.page, parsed.pageSize, n(countRow, "total")) };
  }

  async training(principal: TrustedPrincipal, filters: ReportFilters) {
    const { input, period } = this.filters(filters);
    const scope = await this.scope(principal, input.storeId);
    const stores = storesWhere("s", scope.storeIds, "id");
    const quizQuery = sql`
        WITH scoped_staff AS (SELECT DISTINCT "u"."id" FROM "users" "u" INNER JOIN "user_stores" "us" ON "us"."user_id" = "u"."id" INNER JOIN "stores" "s" ON "s"."id" = "us"."store_id" WHERE "u"."role" = 'staff' AND "u"."is_active" AND "s"."is_active" AND ${stores}),
        latest AS (SELECT DISTINCT ON ("qr"."quiz_id") "qr"."id", "qr"."quiz_id", "qr"."assessment_mode", "qr"."assignment_mode" FROM "quiz_revisions" "qr" INNER JOIN "quizzes" "q" ON "q"."id" = "qr"."quiz_id" WHERE "q"."status" = 'published' AND "qr"."status" = 'published' ORDER BY "qr"."quiz_id", "qr"."revision_number" DESC),
        assignments AS (SELECT DISTINCT "ss"."id" AS employee_id, "l"."id" AS revision_id FROM scoped_staff "ss" CROSS JOIN latest "l" WHERE
          ("l"."assignment_mode" = 'all' AND EXISTS (SELECT 1 FROM "user_stores" "us" INNER JOIN "stores" "s" ON "s"."id" = "us"."store_id" WHERE "us"."user_id" = "ss"."id" AND "s"."is_active" AND ${stores}))
          OR EXISTS (SELECT 1 FROM "quiz_assignments" "qa" INNER JOIN "user_stores" "us" ON "us"."store_id" = "qa"."store_id" WHERE "qa"."revision_id" = "l"."id" AND "us"."user_id" = "ss"."id" AND ${storesWhere("us", scope.storeIds)})
          OR EXISTS (SELECT 1 FROM "quiz_assignment_targets" "qt" WHERE "qt"."revision_id" = "l"."id" AND (("qt"."target_type" = 'user' AND "qt"."user_id" = "ss"."id") OR ("qt"."target_type" = 'role' AND "qt"."role" = 'staff' AND ("qt"."store_id" IS NULL OR EXISTS (SELECT 1 FROM "user_stores" "us" WHERE "us"."user_id" = "ss"."id" AND "us"."store_id" = "qt"."store_id" AND ${storesWhere("us", scope.storeIds)}))) OR ("qt"."target_type" = 'store' AND EXISTS (SELECT 1 FROM "user_stores" "us" WHERE "us"."user_id" = "ss"."id" AND "us"."store_id" = "qt"."store_id" AND ${storesWhere("us", scope.storeIds)}))))
        ), attempts AS (SELECT "a"."id", "a"."user_id", "a"."revision_id", "a"."score_percent", "a"."passed", "qr"."assessment_mode" FROM "quiz_attempts" "a" INNER JOIN "quiz_revisions" "qr" ON "qr"."id" = "a"."revision_id" INNER JOIN scoped_staff "ss" ON "ss"."id" = "a"."user_id" WHERE "a"."status" = 'submitted' AND "a"."submitted_at" >= ${ts(period.startAt)} AND "a"."submitted_at" < ${ts(period.endAt)} AND "qr"."status" IN ('published', 'archived'))
        SELECT (SELECT COUNT(*)::int FROM assignments) AS available,
          (SELECT COUNT(DISTINCT ("asgn"."employee_id", "asgn"."revision_id"))::int FROM assignments "asgn" WHERE EXISTS (SELECT 1 FROM attempts "a" WHERE "a"."user_id" = "asgn"."employee_id" AND "a"."revision_id" = "asgn"."revision_id")) AS completed,
          (SELECT COUNT(*)::int FROM attempts) AS attempts,
          (SELECT COUNT(*)::int FROM attempts WHERE "assessment_mode" = 'exam') AS exam,
          (SELECT COUNT(*)::int FROM attempts WHERE "assessment_mode" = 'practice') AS practice,
          (SELECT COUNT(*)::int FROM attempts WHERE "assessment_mode" = 'survey') AS survey,
          (SELECT COUNT(*)::int FROM attempts WHERE "assessment_mode" = 'exam' AND "passed" IS TRUE) AS passed,
          (SELECT COUNT(*)::int FROM attempts WHERE "assessment_mode" = 'exam' AND "passed" IS FALSE) AS failed,
          (SELECT ROUND(AVG("score_percent")::numeric, 2) FROM attempts WHERE "assessment_mode" = 'exam') AS exam_avg,
          (SELECT ROUND(AVG("score_percent")::numeric, 2) FROM attempts WHERE "assessment_mode" = 'practice') AS practice_avg
      `;
    const knowledgeQuery = sql`
      WITH scoped_staff AS (SELECT DISTINCT "u"."id" FROM "users" "u" INNER JOIN "user_stores" "us" ON "us"."user_id" = "u"."id" INNER JOIN "stores" "s" ON "s"."id" = "us"."store_id" WHERE "u"."role" = 'staff' AND "u"."is_active" AND "s"."is_active" AND ${stores}), required AS (
          SELECT DISTINCT "ss"."id" AS employee_id, "ka"."id" AS article_id, "kr"."id" AS revision_id FROM scoped_staff "ss" CROSS JOIN "knowledge_articles" "ka" INNER JOIN "knowledge_article_revisions" "kr" ON "kr"."id" = "ka"."published_revision_id" AND "kr"."status" = 'published' WHERE "ka"."status" = 'published' AND "ka"."requires_acknowledgement" AND "ka"."published_revision_id" IS NOT NULL AND EXISTS (
            SELECT 1 FROM "knowledge_visibility_targets" "vt" WHERE "vt"."article_id" = "ka"."id" AND (("vt"."kind" = 'all') OR ("vt"."kind" = 'store' AND EXISTS (SELECT 1 FROM "user_stores" "us" WHERE "us"."user_id" = "ss"."id" AND "us"."store_id" = "vt"."store_id" AND ${storesWhere("us", scope.storeIds)})) OR ("vt"."kind" = 'role' AND "vt"."role" = 'staff' AND ("vt"."store_id" IS NULL OR EXISTS (SELECT 1 FROM "user_stores" "us" WHERE "us"."user_id" = "ss"."id" AND "us"."store_id" = "vt"."store_id" AND ${storesWhere("us", scope.storeIds)}))))
          )
        ) SELECT COUNT(*)::int AS required, COUNT(*) FILTER (WHERE "ack"."id" IS NOT NULL)::int AS acknowledged FROM required "r" LEFT JOIN "knowledge_acknowledgments" "ack" ON "ack"."employee_id" = "r"."employee_id" AND "ack"."revision_id" = "r"."revision_id"
      `;
    const [quizRows, knowledgeRows] = await Promise.all([
      this.db.execute(quizQuery) as unknown as Promise<Rows>,
      this.db.execute(knowledgeQuery) as unknown as Promise<Rows>,
    ]);
    const q = quizRows[0]; const k = knowledgeRows[0];
    const available = n(q, "available"); const completed = n(q, "completed"); const required = n(k, "required"); const acknowledged = n(k, "acknowledged");
    return { period: periodDto(period), quizzes: { availableAssignmentCount: available, completedCurrentAssignmentCount: completed, completionRate: percentage(completed, available), submittedAttemptCount: n(q, "attempts"), examAttemptCount: n(q, "exam"), practiceAttemptCount: n(q, "practice"), surveyAttemptCount: n(q, "survey"), passedExamAttemptCount: n(q, "passed"), failedExamAttemptCount: n(q, "failed"), averageExamScore: nullable(q, "exam_avg"), averagePracticeScore: nullable(q, "practice_avg") }, knowledge: { requiredAcknowledgmentCount: required, acknowledgedCount: acknowledged, completionRate: percentage(acknowledged, required) } };
  }

  async photos(principal: TrustedPrincipal, filters: ReportFilters) {
    const { input, period } = this.filters(filters); const scope = await this.scope(principal, input.storeId);
    const [row] = await this.db.execute(sql`
      WITH latest AS (SELECT DISTINCT ON ("v"."report_id") "v"."report_id", "v"."status" FROM "photo_report_versions" "v" INNER JOIN "photo_reports" "r" ON "r"."id" = "v"."report_id" WHERE ${storesWhere("r", scope.storeIds)} ORDER BY "v"."report_id", "v"."version_number" DESC),
      current_status AS (SELECT "l"."status", COUNT(*)::int AS total FROM latest "l" GROUP BY "l"."status")
      SELECT (SELECT COUNT(DISTINCT "v"."report_id")::int FROM "photo_report_versions" "v" INNER JOIN "photo_reports" "r" ON "r"."id" = "v"."report_id" WHERE ${storesWhere("r", scope.storeIds)} AND "v"."version_number" = 1 AND "v"."submitted_at" >= ${ts(period.startAt)} AND "v"."submitted_at" < ${ts(period.endAt)}) AS reports,
        (SELECT COUNT(*)::int FROM "photo_report_versions" "v" INNER JOIN "photo_reports" "r" ON "r"."id" = "v"."report_id" WHERE ${storesWhere("r", scope.storeIds)} AND "v"."submitted_at" >= ${ts(period.startAt)} AND "v"."submitted_at" < ${ts(period.endAt)}) AS versions,
        (SELECT COUNT(*)::int FROM "photo_report_versions" "v" INNER JOIN "photo_reports" "r" ON "r"."id" = "v"."report_id" WHERE ${storesWhere("r", scope.storeIds)} AND "v"."version_number" > 1 AND "v"."submitted_at" >= ${ts(period.startAt)} AND "v"."submitted_at" < ${ts(period.endAt)}) AS resubmissions,
        COALESCE((SELECT total FROM current_status WHERE "status" = 'pending'), 0)::int AS pending,
        COALESCE((SELECT total FROM current_status WHERE "status" = 'checked'), 0)::int AS checked,
        COALESCE((SELECT total FROM current_status WHERE "status" = 'rejected'), 0)::int AS rejected,
        (SELECT COUNT(*)::int FROM "photo_review_history" "h" INNER JOIN "photo_reports" "r" ON "r"."id" = "h"."report_id" WHERE ${storesWhere("r", scope.storeIds)} AND "h"."created_at" >= ${ts(period.startAt)} AND "h"."created_at" < ${ts(period.endAt)}) AS reviews,
        (SELECT ROUND(AVG(EXTRACT(EPOCH FROM ("v"."reviewed_at" - "v"."submitted_at")) / 3600)::numeric, 2) FROM "photo_report_versions" "v" INNER JOIN "photo_reports" "r" ON "r"."id" = "v"."report_id" WHERE ${storesWhere("r", scope.storeIds)} AND "v"."reviewed_at" >= ${ts(period.startAt)} AND "v"."reviewed_at" < ${ts(period.endAt)} AND "v"."reviewed_at" IS NOT NULL) AS avg_hours
    `) as Rows;
    return { period: periodDto(period), submittedReportCount: n(row, "reports"), submittedVersionCount: n(row, "versions"), resubmissionCount: n(row, "resubmissions"), currentStatus: { pending: n(row, "pending"), checked: n(row, "checked"), rejected: n(row, "rejected") }, reviewEventCount: n(row, "reviews"), averageReviewHours: nullable(row, "avg_hours") };
  }

  async tasks(principal: TrustedPrincipal, filters: ReportFilters) {
    const { input, period } = this.filters(filters); const scope = await this.scope(principal, input.storeId);
    const [row] = await this.db.execute(sql`
      SELECT COUNT(*)::int AS assigned, COUNT(*) FILTER (WHERE "t"."status" = 'in_progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE "t"."status" = 'submitted')::int AS submitted, COUNT(*) FILTER (WHERE "t"."status" = 'checked')::int AS checked,
        COUNT(*) FILTER (WHERE "t"."status" = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE "t"."due_at" < ${ts(period.snapshotAt)} AND "t"."status" <> 'checked')::int AS overdue,
        (SELECT COUNT(*)::int FROM "task_submissions" "sub" INNER JOIN "task_occurrences" "task" ON "task"."id" = "sub"."task_id" WHERE ${storesWhere("task", scope.storeIds)} AND "sub"."submitted_at" >= ${ts(period.startAt)} AND "sub"."submitted_at" < ${ts(period.endAt)}) AS submission_events
      FROM "task_occurrences" "t" WHERE ${storesWhere("t", scope.storeIds)} AND "t"."created_at" >= ${ts(period.startAt)} AND "t"."created_at" < ${ts(period.endAt)}
    `) as Rows;
    const assigned = n(row, "assigned"); const checked = n(row, "checked");
    return { period: periodDto(period), assignedTaskCount: assigned, inProgressTaskCount: n(row, "in_progress"), submittedTaskCount: n(row, "submitted"), checkedTaskCount: checked, rejectedTaskCount: n(row, "rejected"), overdueTaskCount: n(row, "overdue"), completionRate: percentage(checked, assigned), submissionEventCount: n(row, "submission_events") };
  }

  async schedules(principal: TrustedPrincipal, filters: ReportFilters) {
    const { input, period } = this.filters(filters); const scope = await this.scope(principal, input.storeId);
    const rows = await this.db.execute(sql`
      SELECT "s"."id" AS store_id, "s"."name" AS store_name,
        (SELECT COUNT(DISTINCT "sh"."id")::int FROM "schedule_periods" "sp" INNER JOIN "schedule_shifts" "sh" ON "sh"."period_id" = "sp"."id"
          WHERE "sp"."store_id" = "s"."id" AND "sp"."status" = 'published' AND "sp"."superseded_at" IS NULL AND "sp"."start_date" <= ${period.endDate}::date AND "sp"."end_date" >= ${period.startDate}::date AND "sh"."local_date" >= ${period.startDate}::date AND "sh"."local_date" <= ${period.endDate}::date) AS shifts,
        COALESCE((SELECT ROUND(SUM(EXTRACT(EPOCH FROM ("sh"."end_at" - "sh"."start_at")) / 3600)::numeric, 2) FROM "schedule_periods" "sp" INNER JOIN "schedule_shifts" "sh" ON "sh"."period_id" = "sp"."id"
          WHERE "sp"."store_id" = "s"."id" AND "sp"."status" = 'published' AND "sp"."superseded_at" IS NULL AND "sp"."start_date" <= ${period.endDate}::date AND "sp"."end_date" >= ${period.startDate}::date AND "sh"."local_date" >= ${period.startDate}::date AND "sh"."local_date" <= ${period.endDate}::date), 0) AS hours,
        (SELECT COUNT(DISTINCT "off"."id")::int FROM "schedule_periods" "sp" INNER JOIN "schedule_days_off" "off" ON "off"."period_id" = "sp"."id"
          WHERE "sp"."store_id" = "s"."id" AND "sp"."status" = 'published' AND "sp"."superseded_at" IS NULL AND "sp"."start_date" <= ${period.endDate}::date AND "sp"."end_date" >= ${period.startDate}::date AND "off"."local_date" >= ${period.startDate}::date AND "off"."local_date" <= ${period.endDate}::date) AS days_off,
        (SELECT COUNT(DISTINCT "sh"."local_date")::int FROM "schedule_periods" "sp" INNER JOIN "schedule_shifts" "sh" ON "sh"."period_id" = "sp"."id"
          WHERE "sp"."store_id" = "s"."id" AND "sp"."status" = 'published' AND "sp"."superseded_at" IS NULL AND "sp"."start_date" <= ${period.endDate}::date AND "sp"."end_date" >= ${period.startDate}::date AND "sh"."local_date" >= ${period.startDate}::date AND "sh"."local_date" <= ${period.endDate}::date) AS covered_days
      FROM "stores" "s" WHERE "s"."is_active" AND ${storesWhere("s", scope.storeIds, "id")} ORDER BY "s"."name", "s"."id"
    `) as Rows;
    const data = rows.map((row) => ({ storeId: String(row.store_id), storeName: String(row.store_name), shiftCount: n(row, "shifts"), plannedHours: Number(row.hours ?? 0), scheduledDayOffCount: n(row, "days_off"), coveredLocalDateCount: n(row, "covered_days") }));
    return { period: periodDto(period), shiftCount: data.reduce((sum, row) => sum + row.shiftCount, 0), plannedHours: data.reduce((sum, row) => sum + row.plannedHours, 0), scheduledDayOffCount: data.reduce((sum, row) => sum + row.scheduledDayOffCount, 0), stores: data };
  }

  async operations(principal: TrustedPrincipal, filters: ReportFilters) {
    const { input, period } = this.filters(filters); const scope = await this.scope(principal, input.storeId); const scopeIds = scope.storeIds;
    const [campaign, merchandising, issues, requests] = await Promise.all([
      this.db.execute(sql`
        WITH targets AS (SELECT "c"."id" campaign_id, "cs"."store_id" target_store_id, "e"."status" FROM "retail_campaigns" "c" INNER JOIN "retail_campaign_stores" "cs" ON "cs"."campaign_id" = "c"."id" LEFT JOIN "retail_campaign_executions" "e" ON "e"."campaign_id" = "c"."id" AND "e"."store_id" = "cs"."store_id" WHERE ${storesWhere("cs", scopeIds)} AND "c"."status" IN ('scheduled','active','completed','archived') AND "c"."starts_at" < ${ts(period.endAt)} AND "c"."ends_at" >= ${ts(period.startAt)})
        SELECT (SELECT COUNT(*)::int FROM "retail_campaigns" "c" WHERE "c"."status" = 'active' AND "c"."starts_at" <= ${ts(period.snapshotAt)} AND "c"."ends_at" > ${ts(period.snapshotAt)} AND EXISTS (SELECT 1 FROM "retail_campaign_stores" "cs" WHERE "cs"."campaign_id" = "c"."id" AND ${storesWhere("cs", scopeIds)})) AS active,
        (SELECT COUNT(DISTINCT "target_store_id")::int FROM targets) AS store_count, COUNT(*)::int AS target_count,
        COUNT(*) FILTER (WHERE "status" = 'checked')::int AS checked, COUNT(*) FILTER (WHERE "status" IN ('not_started','in_progress','submitted'))::int AS pending, COUNT(*) FILTER (WHERE "status" = 'rejected')::int AS rejected,
        (SELECT COUNT(*)::int FROM "retail_campaign_submissions" "sub" INNER JOIN "retail_campaign_executions" "e" ON "e"."id" = "sub"."execution_id" WHERE ${storesWhere("e", scopeIds)} AND "sub"."submitted_at" >= ${ts(period.startAt)} AND "sub"."submitted_at" < ${ts(period.endAt)}) AS submissions
        FROM targets
      `) as unknown as Promise<Rows>,
      this.db.execute(sql`
        SELECT (SELECT COUNT(*)::int FROM "merchandising_inspections" "m" INNER JOIN "merchandising_displays" "d" ON "d"."id" = "m"."display_id" WHERE ${storesWhere("d", scopeIds)} AND "m"."submitted_at" >= ${ts(period.startAt)} AND "m"."submitted_at" < ${ts(period.endAt)}) AS submitted,
          (SELECT COUNT(*)::int FROM "merchandising_inspections" "m" INNER JOIN "merchandising_displays" "d" ON "d"."id" = "m"."display_id" WHERE ${storesWhere("d", scopeIds)} AND "m"."status" = 'submitted') AS pending,
          (SELECT COUNT(*)::int FROM "merchandising_inspections" "m" INNER JOIN "merchandising_displays" "d" ON "d"."id" = "m"."display_id" WHERE ${storesWhere("d", scopeIds)} AND "m"."status" = 'checked') AS checked,
          (SELECT COUNT(*)::int FROM "merchandising_inspections" "m" INNER JOIN "merchandising_displays" "d" ON "d"."id" = "m"."display_id" WHERE ${storesWhere("d", scopeIds)} AND "m"."status" = 'rejected') AS rejected,
          (SELECT COUNT(*)::int FROM "merchandising_inspections" "m" INNER JOIN "merchandising_displays" "d" ON "d"."id" = "m"."display_id" WHERE ${storesWhere("d", scopeIds)} AND "m"."version" > 1 AND "m"."submitted_at" >= ${ts(period.startAt)} AND "m"."submitted_at" < ${ts(period.endAt)}) AS resubmissions,
          (SELECT ROUND(AVG(EXTRACT(EPOCH FROM ("m"."reviewed_at" - "m"."submitted_at")) / 3600)::numeric, 2) FROM "merchandising_inspections" "m" INNER JOIN "merchandising_displays" "d" ON "d"."id" = "m"."display_id" WHERE ${storesWhere("d", scopeIds)} AND "m"."reviewed_at" >= ${ts(period.startAt)} AND "m"."reviewed_at" < ${ts(period.endAt)} AND "m"."reviewed_at" IS NOT NULL) AS avg_hours
      `) as unknown as Promise<Rows>,
      this.db.execute(sql`
        SELECT COUNT(*) FILTER (WHERE "i"."status" = 'open')::int AS open, COUNT(*) FILTER (WHERE "i"."status" = 'in_progress')::int AS in_progress, COUNT(*) FILTER (WHERE "i"."status" = 'resolved')::int AS resolved, COUNT(*) FILTER (WHERE "i"."status" = 'closed')::int AS closed,
          COUNT(*) FILTER (WHERE "i"."priority" = 'urgent')::int AS urgent, COUNT(*) FILTER (WHERE "i"."priority" = 'high')::int AS high,
          (SELECT COUNT(*)::int FROM "store_issue_history" "h" WHERE "h"."issue_id" IN (SELECT "i2"."id" FROM "store_issues" "i2" WHERE ${storesWhere("i2", scopeIds)}) AND "h"."created_at" >= ${ts(period.startAt)} AND "h"."created_at" < ${ts(period.endAt)}) AS transitions,
          (SELECT COUNT(*)::int FROM "store_issue_history" "h" WHERE "h"."issue_id" IN (SELECT "i2"."id" FROM "store_issues" "i2" WHERE ${storesWhere("i2", scopeIds)}) AND "h"."to_status" IN ('resolved','closed') AND "h"."created_at" >= ${ts(period.startAt)} AND "h"."created_at" < ${ts(period.endAt)}) AS resolutions
        FROM "store_issues" "i" WHERE ${storesWhere("i", scopeIds)}
      `) as unknown as Promise<Rows>,
      this.db.execute(sql`
        SELECT COUNT(*) FILTER (WHERE "r"."status" = 'submitted')::int AS submitted, COUNT(*) FILTER (WHERE "r"."status" = 'approved')::int AS approved, COUNT(*) FILTER (WHERE "r"."status" = 'rejected')::int AS rejected,
          COUNT(*) FILTER (WHERE "r"."status" = 'in_progress')::int AS in_progress, COUNT(*) FILTER (WHERE "r"."status" = 'completed')::int AS completed,
          (SELECT COUNT(*)::int FROM "operational_request_history" "h" WHERE "h"."request_id" IN (SELECT "r2"."id" FROM "operational_requests" "r2" WHERE ${storesWhere("r2", scopeIds)}) AND "h"."to_status" IN ('approved','rejected') AND "h"."created_at" >= ${ts(period.startAt)} AND "h"."created_at" < ${ts(period.endAt)}) AS decisions,
          (SELECT ROUND(AVG(EXTRACT(EPOCH FROM ("h"."created_at" - "r2"."created_at")) / 3600)::numeric, 2) FROM "operational_request_history" "h" INNER JOIN "operational_requests" "r2" ON "r2"."id" = "h"."request_id" WHERE ${storesWhere("r2", scopeIds)} AND "h"."to_status" IN ('approved','rejected') AND "h"."created_at" >= ${ts(period.startAt)} AND "h"."created_at" < ${ts(period.endAt)}) AS decision_hours,
          (SELECT ROUND(AVG(EXTRACT(EPOCH FROM ("h"."created_at" - "r2"."created_at")) / 3600)::numeric, 2) FROM "operational_request_history" "h" INNER JOIN "operational_requests" "r2" ON "r2"."id" = "h"."request_id" WHERE ${storesWhere("r2", scopeIds)} AND "h"."to_status" = 'completed' AND "h"."created_at" >= ${ts(period.startAt)} AND "h"."created_at" < ${ts(period.endAt)}) AS completion_hours
        FROM "operational_requests" "r" WHERE ${storesWhere("r", scopeIds)}
      `) as unknown as Promise<Rows>,
    ]);
    const c = campaign[0]; const m = merchandising[0]; const i = issues[0]; const r = requests[0];
    const campaignTargets = n(c, "target_count");
    return { period: periodDto(period), campaigns: { activeCampaignCount: n(c, "active"), targetedStoreCount: n(c, "store_count"), targetedExecutionCount: campaignTargets, checkedExecutionCount: n(c, "checked"), pendingExecutionCount: n(c, "pending"), rejectedExecutionCount: n(c, "rejected"), completionRate: percentage(n(c, "checked"), campaignTargets), submissionEventCount: n(c, "submissions") }, merchandising: { submittedInspectionCount: n(m, "submitted"), pendingInspectionCount: n(m, "pending"), checkedInspectionCount: n(m, "checked"), rejectedInspectionCount: n(m, "rejected"), resubmissionCount: n(m, "resubmissions"), averageReviewHours: nullable(m, "avg_hours") }, issues: { openCount: n(i, "open"), inProgressCount: n(i, "in_progress"), resolvedCount: n(i, "resolved"), closedCount: n(i, "closed"), urgentCount: n(i, "urgent"), highPriorityCount: n(i, "high"), statusTransitionEventCount: n(i, "transitions"), resolutionEventCount: n(i, "resolutions") }, requests: { submittedCount: n(r, "submitted"), approvedCount: n(r, "approved"), rejectedCount: n(r, "rejected"), inProgressCount: n(r, "in_progress"), completedCount: n(r, "completed"), decisionEventCount: n(r, "decisions"), averageDecisionHours: nullable(r, "decision_hours"), averageCompletionHours: nullable(r, "completion_hours") } };
  }
}

export function createReportsService(db: Database): ReportsService { return new ReportsService(db); }

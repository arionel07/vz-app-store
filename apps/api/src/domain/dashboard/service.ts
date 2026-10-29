import { eq, sql, type SQL } from "drizzle-orm";
import {
  dashboardFiltersSchema,
  dashboardQuizQuerySchema,
  type DashboardFilters,
  type DashboardOverviewResponse,
  type DashboardPhotosResponse,
  type DashboardQuizQuery,
  type DashboardQuizzesResponse,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import { stores } from "../../db/schema";
import { assertActivePrincipal, type TrustedPrincipal } from "../authz";
import { DomainError } from "../errors";

const DEFAULT_REPORTING_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REPORTING_PERIOD_MS = 366 * 24 * 60 * 60 * 1000;

interface DashboardScope {
  role: "admin" | "manager";
  storeId?: string;
  storeIds: readonly string[];
}

interface ReportingPeriod {
  start: Date;
  end: Date;
}

type QueryRow = Record<string, unknown>;

function tableAlias(alias: string): SQL {
  return sql.raw(`"${alias}"`);
}

function uuidList(ids: readonly string[]): SQL {
  return sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
}

function timestampParam(value: Date): SQL {
  return sql`${value.toISOString()}::timestamptz`;
}

function scopedStorePredicate(alias: string, scope: DashboardScope): SQL {
  const table = tableAlias(alias);
  if (scope.storeId) {
    return sql`${table}."id" = ${scope.storeId}::uuid AND ${table}."is_active" = true`;
  }
  if (scope.role === "admin") return sql`${table}."is_active" = true`;
  if (scope.storeIds.length === 0) return sql`false`;
  return sql`${table}."is_active" = true AND ${table}."id" IN (${uuidList(scope.storeIds)})`;
}

function attemptScopePredicate(scope: DashboardScope): SQL {
  return sql`
    EXISTS (
      SELECT 1
      FROM "user_stores" AS "participant_us"
      INNER JOIN "stores" AS "participant_store"
        ON "participant_store"."id" = "participant_us"."store_id"
      WHERE "participant_us"."user_id" = "a"."user_id"
        AND ${scopedStorePredicate("participant_store", scope)}
        AND (
          "qr"."assignment_mode" = 'all'
          OR EXISTS (
            SELECT 1
            FROM "quiz_assignments" AS "participant_qa"
            WHERE "participant_qa"."revision_id" = "a"."revision_id"
              AND "participant_qa"."store_id" = "participant_us"."store_id"
          )
        )
    )
  `;
}

function completedAttemptsCte(scope: DashboardScope, period: ReportingPeriod): SQL {
  return sql`
    WITH scoped_completed_attempts AS (
      SELECT
        "a"."id",
        "a"."quiz_id",
        "a"."user_id",
        "a"."score_percent",
        "a"."passed"
      FROM "quiz_attempts" AS "a"
      INNER JOIN "users" AS "u" ON "u"."id" = "a"."user_id"
      INNER JOIN "quiz_revisions" AS "qr" ON "qr"."id" = "a"."revision_id"
      WHERE "a"."status" = 'submitted'
        AND "a"."submitted_at" IS NOT NULL
        AND "a"."submitted_at" >= ${timestampParam(period.start)}
        AND "a"."submitted_at" < ${timestampParam(period.end)}
        AND "u"."is_active" = true
        AND "qr"."status" IN ('published', 'archived')
        AND "qr"."assessment_mode" = 'exam'
        AND ${attemptScopePredicate(scope)}
    )
  `;
}

function numberValue(row: QueryRow | undefined, key: string): number {
  return Number(row?.[key] ?? 0);
}

function nullableNumberValue(row: QueryRow | undefined, key: string): number | null {
  const value = row?.[key];
  return value === null || value === undefined ? null : Number(value);
}

function periodResponse(period: ReportingPeriod): DashboardOverviewResponse["period"] {
  return {
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    endExclusive: true,
    timezone: "UTC",
  };
}

function startOfUtcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function dayString(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export class DashboardService {
  constructor(private readonly db: Database) {}

  private async scopeFor(principal: TrustedPrincipal, storeId?: string): Promise<DashboardScope> {
    assertActivePrincipal(principal);
    if (principal.role !== "admin" && principal.role !== "manager") {
      throw new DomainError(403, "FORBIDDEN", "Staff users cannot access the management dashboard");
    }

    if (storeId) {
      const [store] = await this.db
        .select({ id: stores.id, isActive: stores.isActive })
        .from(stores)
        .where(eq(stores.id, storeId))
        .limit(1);
      if (!store?.isActive || (principal.role === "manager" && !principal.storeIds.includes(storeId))) {
        throw new DomainError(403, "STORE_FORBIDDEN", "The store is outside the principal scope");
      }
      return { role: principal.role, storeId, storeIds: [storeId] };
    }

    return { role: principal.role, storeIds: principal.storeIds };
  }

  private resolvePeriod(filters: DashboardFilters): ReportingPeriod {
    const end = filters.endDate ? new Date(filters.endDate) : new Date();
    const start = filters.startDate ? new Date(filters.startDate) : new Date(end.getTime() - DEFAULT_REPORTING_PERIOD_MS);
    const duration = end.getTime() - start.getTime();
    if (duration <= 0) throw new DomainError(400, "INVALID_DATE_RANGE", "endDate must be later than startDate");
    if (duration > MAX_REPORTING_PERIOD_MS) throw new DomainError(400, "INVALID_DATE_RANGE", "Reporting periods cannot exceed 366 days");
    return { start, end };
  }

  async overview(principal: TrustedPrincipal, filters: DashboardFilters): Promise<DashboardOverviewResponse> {
    const data = dashboardFiltersSchema.parse(filters);
    const scope = await this.scopeFor(principal, data.storeId);
    const period = this.resolvePeriod(data);
    const [row] = (await this.db.execute(sql`
      ${completedAttemptsCte(scope, period)}
      SELECT
        (
          SELECT COUNT(DISTINCT "employee"."id")::int
          FROM "users" AS "employee"
          WHERE "employee"."is_active" = true
            AND "employee"."role" <> 'admin'
            AND EXISTS (
              SELECT 1
              FROM "user_stores" AS "employee_us"
              INNER JOIN "stores" AS "employee_store"
                ON "employee_store"."id" = "employee_us"."store_id"
              WHERE "employee_us"."user_id" = "employee"."id"
                AND ${scopedStorePredicate("employee_store", scope)}
            )
        ) AS "active_employee_count",
        (
          SELECT COUNT(*)::int
          FROM "quizzes" AS "published_quiz"
          INNER JOIN LATERAL (
            SELECT "published_revision"."id", "published_revision"."assignment_mode"
            FROM "quiz_revisions" AS "published_revision"
            WHERE "published_revision"."quiz_id" = "published_quiz"."id"
              AND "published_revision"."status" = 'published'
            ORDER BY "published_revision"."revision_number" DESC
            LIMIT 1
          ) AS "current_revision" ON true
          WHERE "published_quiz"."status" = 'published'
            AND (
              (
                "current_revision"."assignment_mode" = 'all'
                AND EXISTS (
                  SELECT 1 FROM "stores" AS "quiz_scope_store"
                  WHERE ${scopedStorePredicate("quiz_scope_store", scope)}
                )
              )
              OR (
                "current_revision"."assignment_mode" = 'selected'
                AND EXISTS (
                  SELECT 1
                  FROM "quiz_assignments" AS "quiz_scope_assignment"
                  INNER JOIN "stores" AS "quiz_scope_store"
                    ON "quiz_scope_store"."id" = "quiz_scope_assignment"."store_id"
                  WHERE "quiz_scope_assignment"."revision_id" = "current_revision"."id"
                    AND ${scopedStorePredicate("quiz_scope_store", scope)}
                )
              )
            )
        ) AS "published_quiz_count",
        (SELECT COUNT(*)::int FROM scoped_completed_attempts) AS "completed_attempt_count",
        (SELECT COUNT(DISTINCT "completed"."user_id")::int FROM scoped_completed_attempts AS "completed") AS "completed_employee_count",
        (SELECT ROUND(AVG("completed"."score_percent")::numeric, 2) FROM scoped_completed_attempts AS "completed") AS "average_completed_attempt_score",
        (
          SELECT ROUND(
            (100.0 * COUNT(*) FILTER (WHERE "completed"."passed" IS TRUE) / NULLIF(COUNT(*), 0))::numeric,
            2
          )
          FROM scoped_completed_attempts AS "completed"
        ) AS "pass_rate",
        (
          SELECT COUNT(*)::int
          FROM "photos" AS "photo"
          INNER JOIN "stores" AS "photo_store" ON "photo_store"."id" = "photo"."store_id"
          INNER JOIN "users" AS "photo_user" ON "photo_user"."id" = "photo"."uploaded_by"
          WHERE "photo"."created_at" >= ${timestampParam(period.start)}
            AND "photo"."created_at" < ${timestampParam(period.end)}
            AND "photo_user"."is_active" = true
            AND ${scopedStorePredicate("photo_store", scope)}
        ) AS "uploaded_photo_count"
    `)) as QueryRow[];

    return {
      period: periodResponse(period),
      metrics: {
        activeEmployeeCount: numberValue(row, "active_employee_count"),
        publishedQuizCount: numberValue(row, "published_quiz_count"),
        completedAttemptCount: numberValue(row, "completed_attempt_count"),
        completedEmployeeCount: numberValue(row, "completed_employee_count"),
        averageCompletedAttemptScore: nullableNumberValue(row, "average_completed_attempt_score"),
        passRate: nullableNumberValue(row, "pass_rate"),
        uploadedPhotoCount: numberValue(row, "uploaded_photo_count"),
      },
    };
  }

  async photos(principal: TrustedPrincipal, filters: DashboardFilters): Promise<DashboardPhotosResponse> {
    const data = dashboardFiltersSchema.parse(filters);
    const scope = await this.scopeFor(principal, data.storeId);
    const period = this.resolvePeriod(data);
    const photoWhere = sql`
      "photo"."created_at" >= ${timestampParam(period.start)}
      AND "photo"."created_at" < ${timestampParam(period.end)}
      AND "photo_user"."is_active" = true
      AND ${scopedStorePredicate("photo_store", scope)}
    `;

    const [aggregateRows, dailyRows, storeRows] = await Promise.all([
      this.db.execute(sql`
        SELECT
          COUNT(*)::int AS "total_photo_count",
          COUNT(DISTINCT "photo_user"."id")::int AS "distinct_uploading_employee_count"
        FROM "photos" AS "photo"
        INNER JOIN "stores" AS "photo_store" ON "photo_store"."id" = "photo"."store_id"
        INNER JOIN "users" AS "photo_user" ON "photo_user"."id" = "photo"."uploaded_by"
        WHERE ${photoWhere}
      `),
      this.db.execute(sql`
        SELECT
          TO_CHAR(("photo"."created_at" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS "date",
          COUNT(*)::int AS "count"
        FROM "photos" AS "photo"
        INNER JOIN "stores" AS "photo_store" ON "photo_store"."id" = "photo"."store_id"
        INNER JOIN "users" AS "photo_user" ON "photo_user"."id" = "photo"."uploaded_by"
        WHERE ${photoWhere}
        GROUP BY ("photo"."created_at" AT TIME ZONE 'UTC')::date
        ORDER BY ("photo"."created_at" AT TIME ZONE 'UTC')::date
      `),
      this.db.execute(sql`
        SELECT
          "photo_store"."id" AS "store_id",
          "photo_store"."name" AS "store_name",
          COUNT("photo_user"."id")::int AS "count"
        FROM "stores" AS "photo_store"
        LEFT JOIN "photos" AS "photo"
          ON "photo"."store_id" = "photo_store"."id"
          AND "photo"."created_at" >= ${timestampParam(period.start)}
          AND "photo"."created_at" < ${timestampParam(period.end)}
        LEFT JOIN "users" AS "photo_user"
          ON "photo_user"."id" = "photo"."uploaded_by"
          AND "photo_user"."is_active" = true
        WHERE ${scopedStorePredicate("photo_store", scope)}
        GROUP BY "photo_store"."id", "photo_store"."name"
        ORDER BY "photo_store"."name", "photo_store"."id"
      `),
    ]);

    const aggregate = (aggregateRows as QueryRow[])[0];
    const dailyByDate = new Map((dailyRows as QueryRow[]).map((row) => [String(row.date), numberValue(row, "count")]));
    const dailyUploads = [];
    for (let cursor = startOfUtcDay(period.start); cursor < period.end.getTime(); cursor += 24 * 60 * 60 * 1000) {
      const date = dayString(cursor);
      dailyUploads.push({ date, count: dailyByDate.get(date) ?? 0 });
    }

    return {
      period: periodResponse(period),
      totalPhotoCount: numberValue(aggregate, "total_photo_count"),
      dailyUploads,
      perStoreUploads: (storeRows as QueryRow[]).map((row) => ({
        storeId: String(row.store_id),
        storeName: String(row.store_name),
        count: numberValue(row, "count"),
      })),
      distinctUploadingEmployeeCount: numberValue(aggregate, "distinct_uploading_employee_count"),
    };
  }

  async quizzes(principal: TrustedPrincipal, filters: DashboardQuizQuery): Promise<DashboardQuizzesResponse> {
    const data = dashboardQuizQuerySchema.parse(filters);
    const scope = await this.scopeFor(principal, data.storeId);
    const period = this.resolvePeriod(data);
    const cte = completedAttemptsCte(scope, period);

    const [summaryRows, quizRows, totalRows] = await Promise.all([
      this.db.execute(sql`
        ${cte}
        SELECT
          COUNT(*)::int AS "completed_attempt_count",
          COUNT(DISTINCT "completed"."user_id")::int AS "participating_employee_count",
          ROUND(AVG("completed"."score_percent")::numeric, 2) AS "average_score",
          ROUND((100.0 * COUNT(*) FILTER (WHERE "completed"."passed" IS TRUE) / NULLIF(COUNT(*), 0))::numeric, 2) AS "pass_rate"
        FROM scoped_completed_attempts AS "completed"
      `),
      this.db.execute(sql`
        ${cte}
        SELECT
          "completed"."quiz_id" AS "quiz_id",
          "quiz_title"."title" AS "title",
          COUNT(*)::int AS "completed_attempt_count",
          COUNT(DISTINCT "completed"."user_id")::int AS "participating_employee_count",
          ROUND(AVG("completed"."score_percent")::numeric, 2) AS "average_score",
          ROUND((100.0 * COUNT(*) FILTER (WHERE "completed"."passed" IS TRUE) / NULLIF(COUNT(*), 0))::numeric, 2) AS "pass_rate"
        FROM scoped_completed_attempts AS "completed"
        INNER JOIN LATERAL (
          SELECT "historical_revision"."title"
          FROM "quiz_revisions" AS "historical_revision"
          WHERE "historical_revision"."quiz_id" = "completed"."quiz_id"
            AND "historical_revision"."status" IN ('published', 'archived')
          ORDER BY "historical_revision"."revision_number" DESC
          LIMIT 1
        ) AS "quiz_title" ON true
        GROUP BY "completed"."quiz_id", "quiz_title"."title"
        ORDER BY "quiz_title"."title", "completed"."quiz_id"
        LIMIT ${data.pageSize}
        OFFSET ${(data.page - 1) * data.pageSize}
      `),
      this.db.execute(sql`
        ${cte}
        SELECT COUNT(DISTINCT "completed"."quiz_id")::int AS "total_count"
        FROM scoped_completed_attempts AS "completed"
      `),
    ]);

    const summary = (summaryRows as QueryRow[])[0];
    const rows = quizRows as QueryRow[];
    const total = numberValue((totalRows as QueryRow[])[0], "total_count");
    return {
      period: periodResponse(period),
      summary: {
        completedAttemptCount: numberValue(summary, "completed_attempt_count"),
        participatingEmployeeCount: numberValue(summary, "participating_employee_count"),
        averageScore: nullableNumberValue(summary, "average_score"),
        passRate: nullableNumberValue(summary, "pass_rate"),
      },
      data: rows.map((row) => ({
        quizId: String(row.quiz_id),
        title: String(row.title),
        completedAttemptCount: numberValue(row, "completed_attempt_count"),
        participatingEmployeeCount: numberValue(row, "participating_employee_count"),
        averageScore: nullableNumberValue(row, "average_score"),
        passRate: nullableNumberValue(row, "pass_rate"),
      })),
      pagination: {
        page: data.page,
        pageSize: data.pageSize,
        total,
        totalPages: Math.ceil(total / data.pageSize),
      },
    };
  }
}

export function createDashboardService(db: Database): DashboardService {
  return new DashboardService(db);
}

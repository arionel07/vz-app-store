import { describe, expect, test } from "bun:test";
import { reportFiltersSchema } from "@vizaje/contracts";
import { resolveReportPeriod } from "../src/domain/reports/service";

describe("report period and shared contract semantics", () => {
  test("uses half-open Chisinau local days across both DST transitions", () => {
    const spring = resolveReportPeriod(reportFiltersSchema.parse({ period: "today", timezone: "Europe/Chisinau" }), new Date("2026-03-29T12:00:00.000Z"));
    expect(spring.startDate).toBe("2026-03-29");
    expect(spring.endDate).toBe("2026-03-29");
    expect(spring.endAt.getTime() - spring.startAt.getTime()).toBe(23 * 60 * 60 * 1000);

    const autumn = resolveReportPeriod(reportFiltersSchema.parse({ period: "today", timezone: "Europe/Chisinau" }), new Date("2026-10-25T12:00:00.000Z"));
    expect(autumn.startDate).toBe("2026-10-25");
    expect(autumn.endAt.getTime() - autumn.startAt.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  test("accepts only paired custom dates and bounds the requested range", () => {
    expect(reportFiltersSchema.safeParse({ period: "custom", startDate: "2026-01-01", endDate: "2026-01-31" }).success).toBe(true);
    expect(reportFiltersSchema.safeParse({ period: "custom", startDate: "2026-01-01" }).success).toBe(false);
    expect(reportFiltersSchema.safeParse({ period: "custom", startDate: "2026-02-30", endDate: "2026-03-02" }).success).toBe(false);
    expect(() => resolveReportPeriod(reportFiltersSchema.parse({ period: "custom", startDate: "2025-01-01", endDate: "2026-01-02" }))).toThrow();
  });

  test("supports month presets and rejects invalid IANA timezones", () => {
    const previous = resolveReportPeriod(reportFiltersSchema.parse({ period: "previous_month" }), new Date("2026-10-31T13:00:00.000Z"));
    expect(previous.startDate).toBe("2026-09-01");
    expect(previous.endDate).toBe("2026-09-30");
    expect(() => resolveReportPeriod(reportFiltersSchema.parse({ period: "today", timezone: "Mars/Olympus" }))).toThrow();
  });

  test("keeps named periods and local-midnight boundaries correct across leap dates", () => {
    const now = new Date("2024-03-01T12:00:00.000Z");
    const filters = (period: "today" | "last_7_days" | "last_30_days" | "current_month" | "previous_month") =>
      reportFiltersSchema.parse({ period, timezone: "Europe/Chisinau" });
    const today = resolveReportPeriod(filters("today"), now);
    expect(today).toMatchObject({ startDate: "2024-03-01", endDate: "2024-03-01" });
    expect(today.startAt.toISOString()).toBe("2024-02-29T22:00:00.000Z");
    expect(today.endAt.toISOString()).toBe("2024-03-01T22:00:00.000Z");

    expect(resolveReportPeriod(filters("last_7_days"), now)).toMatchObject({ startDate: "2024-02-24", endDate: "2024-03-01" });
    expect(resolveReportPeriod(filters("last_30_days"), now)).toMatchObject({ startDate: "2024-02-01", endDate: "2024-03-01" });
    expect(resolveReportPeriod(filters("current_month"), now)).toMatchObject({ startDate: "2024-03-01", endDate: "2024-03-01" });
    const leapMonth = resolveReportPeriod(filters("previous_month"), now);
    expect(leapMonth).toMatchObject({ startDate: "2024-02-01", endDate: "2024-02-29" });
    expect(leapMonth.endAt.getTime() - leapMonth.startAt.getTime()).toBe(29 * 24 * 60 * 60 * 1000);

    const leapDay = resolveReportPeriod(reportFiltersSchema.parse({ period: "custom", startDate: "2024-02-29", endDate: "2024-02-29", timezone: "Europe/Chisinau" }), now);
    expect(leapDay.startAt.toISOString()).toBe("2024-02-28T22:00:00.000Z");
    expect(leapDay.endAt.toISOString()).toBe("2024-02-29T22:00:00.000Z");
    expect(resolveReportPeriod(reportFiltersSchema.parse({ period: "custom", startDate: "2024-01-01", endDate: "2024-12-31" }), now).endDate).toBe("2024-12-31");
    expect(() => resolveReportPeriod(reportFiltersSchema.parse({ period: "custom", startDate: "2024-01-01", endDate: "2025-01-01" }), now)).toThrow();
  });
});

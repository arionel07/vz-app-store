import { describe, expect, test } from "bun:test";
import { localDateTimeToUtc, shiftInstants } from "../src/domain/schedules/timezone";

describe("schedule local time conversion", () => {
  test("keeps local business date and handles overnight shifts", () => {
    const result = shiftInstants("2026-03-28", "22:00", "06:00", "Europe/Chisinau");
    expect(result.endAt.getTime()).toBeGreaterThan(result.startAt.getTime());
    expect(result.endAt.getUTCDate()).toBe(29);
  });

  test("rejects a nonexistent daylight-saving local time", () => {
    expect(() => localDateTimeToUtc("2026-03-29", "02:30", "Europe/Chisinau")).toThrow("не существует");
  });

  test("rejects invalid IANA zones", () => {
    expect(() => localDateTimeToUtc("2026-04-01", "09:00", "Not/AZone")).toThrow("IANA");
  });
});

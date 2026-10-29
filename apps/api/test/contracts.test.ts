import { expect, test } from "bun:test";
import {
  dashboardFiltersSchema,
  dashboardOverviewResponseSchema,
  employeeProfileAdminResponseSchema,
  employeeProfileSafeResponseSchema,
  employeeProfileUpdateSchema,
  errorResponseSchema,
  photoResponseSchema,
  quizStaffResponseSchema,
} from "@vizaje/contracts";

const userId = "00000000-0000-0000-0000-000000000001";
const storeId = "00000000-0000-0000-0000-000000000002";
const quizId = "00000000-0000-0000-0000-000000000003";
const revisionId = "00000000-0000-0000-0000-000000000004";
const questionId = "00000000-0000-0000-0000-000000000005";
const optionId = "00000000-0000-0000-0000-000000000006";

test("shared contracts are client-safe and parse representative API payloads", () => {
  expect(dashboardFiltersSchema.parse({ startDate: "2026-01-01T00:00:00Z", endDate: "2026-01-02T00:00:00Z" })).toMatchObject({
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-01-02T00:00:00Z",
  });

  expect(errorResponseSchema.parse({ error: { code: "NOT_FOUND", message: "Resource not found" } })).toEqual({
    error: { code: "NOT_FOUND", message: "Resource not found" },
  });

  expect(photoResponseSchema.parse({
    id: optionId,
    storeId,
    uploadedBy: userId,
    originalFilename: "display.jpg",
    mimeType: "image/jpeg",
    fileSize: 128,
    createdAt: "2026-01-01T00:00:00.000Z",
  }).storeId).toBe(storeId);

  expect(quizStaffResponseSchema.parse({
    id: quizId,
    revisionId,
    revisionNumber: 1,
    title: "Safety",
    description: null,
    passingScore: 80,
    questions: [{
      id: questionId,
      prompt: "Choose one",
      position: 0,
      options: [{ id: optionId, label: "Safe", position: 0 }],
    }],
  }).questions[0].options[0]).not.toHaveProperty("isCorrect");

  expect(dashboardOverviewResponseSchema.parse({
    period: {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-02T00:00:00.000Z",
      endExclusive: true,
      timezone: "UTC",
    },
    metrics: {
      activeEmployeeCount: 0,
      publishedQuizCount: 0,
      completedAttemptCount: 0,
      completedEmployeeCount: 0,
      averageCompletedAttemptScore: null,
      passRate: null,
      uploadedPhotoCount: 0,
    },
  }).metrics.averageCompletedAttemptScore).toBeNull();

  expect(employeeProfileUpdateSchema.parse({
    jobTitle: "Консультант",
    employmentStartedOn: "2025-02-03",
    birthDate: "1995-04-05",
    gender: "Не указано",
  })).toMatchObject({ jobTitle: "Консультант", employmentStartedOn: "2025-02-03" });
  expect(() => employeeProfileUpdateSchema.parse({ employmentStartedOn: "2025-02-30" })).toThrow();
  expect(() => employeeProfileUpdateSchema.parse({ birthDate: "2099-01-01" })).toThrow();

  const safeProfile = employeeProfileSafeResponseSchema.parse({
    userId,
    jobTitle: "Консультант",
    employmentStartedOn: "2025-02-03",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  expect(safeProfile).not.toHaveProperty("birthDate");
  expect(employeeProfileAdminResponseSchema.parse({
    ...safeProfile,
    birthDate: "1995-04-05",
    gender: "Не указано",
  }).gender).toBe("Не указано");
});

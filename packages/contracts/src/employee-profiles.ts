import { z } from "zod";

const uuidSchema = z.string().uuid();
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export const dateOnlySchema = z
  .string()
  .regex(dateOnlyPattern, "Date must use YYYY-MM-DD format")
  .refine(isValidDateOnly, "Date is invalid");

const nullableDateOnlySchema = dateOnlySchema.nullable().optional();
const nullableTextSchema = z.string().trim().min(1).max(160).nullable().optional();

export const employeeProfileUpdateSchema = z
  .object({
    jobTitle: nullableTextSchema,
    employmentStartedOn: nullableDateOnlySchema,
    birthDate: nullableDateOnlySchema,
    gender: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "At least one profile field is required" });
    }

    const today = todayDateOnly();
    if (value.employmentStartedOn && value.employmentStartedOn > today) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["employmentStartedOn"], message: "Employment start date cannot be in the future" });
    }
    if (value.birthDate) {
      if (value.birthDate > today) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["birthDate"], message: "Birth date cannot be in the future" });
      }
      if (value.birthDate < "1900-01-01") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["birthDate"], message: "Birth date is outside the supported range" });
      }
    }
    if (value.birthDate && value.employmentStartedOn && value.birthDate > value.employmentStartedOn) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["birthDate"], message: "Birth date must precede employment start date" });
    }
  });

const employeeProfileSafeResponseFields = {
  userId: uuidSchema,
  jobTitle: z.string().nullable(),
  employmentStartedOn: dateOnlySchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const employeeProfileSafeResponseSchema = z.object(employeeProfileSafeResponseFields);

export const employeeProfileAdminResponseSchema = z.object({
  ...employeeProfileSafeResponseFields,
  birthDate: dateOnlySchema.nullable(),
  gender: z.string().nullable(),
});

export const employeeProfileResponseSchema = z.union([
  employeeProfileAdminResponseSchema,
  employeeProfileSafeResponseSchema,
]);

export type EmployeeProfileUpdateInput = z.infer<typeof employeeProfileUpdateSchema>;
export type EmployeeProfileSafeResponse = z.infer<typeof employeeProfileSafeResponseSchema>;
export type EmployeeProfileAdminResponse = z.infer<typeof employeeProfileAdminResponseSchema>;
export type EmployeeProfileResponse = z.infer<typeof employeeProfileResponseSchema>;

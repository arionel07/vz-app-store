import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "manager", "staff"]);
export type UserRole = z.infer<typeof userRoleSchema>;

const userNameSchema = z.string().trim().min(1).max(100);
const phoneSchema = z.string().trim().min(1).max(32).nullable().optional();
const emailSchema = z.string().trim().email().max(320).nullable().optional();

function validateRoleContacts(
  value: { role?: UserRole; phone?: string | null; email?: string | null },
  context: z.RefinementCtx,
) {
  if (!value.role) return;

  if (value.role !== "admin" && !value.phone) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "Phone is required for this role" });
  }

  if (value.role !== "staff" && !value.email) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Email is required for this role" });
  }
}

export const createUserSchema = z
  .object({
    firstName: userNameSchema,
    lastName: userNameSchema,
    phone: phoneSchema,
    email: emailSchema,
    role: userRoleSchema,
    isActive: z.boolean().default(true),
    storeIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .superRefine(validateRoleContacts);

export const updateUserSchema = z
  .object({
    firstName: userNameSchema.optional(),
    lastName: userNameSchema.optional(),
    phone: phoneSchema,
    email: emailSchema,
    role: userRoleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const booleanQuerySchema = z.enum(["true", "false"]).transform((value) => value === "true");

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  role: userRoleSchema.optional(),
  isActive: booleanQuerySchema.optional(),
  sortBy: z.enum(["firstName", "lastName", "createdAt", "updatedAt"]).default("createdAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  role: userRoleSchema,
  isActive: z.boolean(),
  storeIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const userListResponseSchema = z.object({
  data: z.array(userResponseSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type CreateUserInput = z.input<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;

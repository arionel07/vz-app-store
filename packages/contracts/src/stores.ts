import { z } from "zod";

export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(64),
  isActive: z.boolean().default(true),
});

export const updateStoreSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    code: z.string().trim().min(1).max(64).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const storeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  sortBy: z.enum(["name", "code", "createdAt", "updatedAt"]).default("name"),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
});

export const storeResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const storeListResponseSchema = z.object({
  data: z.array(storeResponseSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type CreateStoreInput = z.input<typeof createStoreSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
export type StoreListQuery = z.infer<typeof storeListQuerySchema>;
export type StoreResponse = z.infer<typeof storeResponseSchema>;

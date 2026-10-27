import { z } from "zod";

const timestamp = z.string().datetime();

export const livenessResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("api"),
  timestamp,
});

export const readinessResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("api"),
  database: z.literal("up"),
  timestamp,
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

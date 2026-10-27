import { z } from "zod";
import { userResponseSchema } from "./users";

export const adminLoginRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(256),
});

export const authSessionUserSchema = userResponseSchema;

export const browserLoginResponseSchema = z.object({
  user: authSessionUserSchema,
  expiresAt: z.string().datetime(),
});

export const activationRequestSchema = z.object({
  userId: z.string().uuid(),
  storeId: z.string().uuid(),
});

export const activationResponseSchema = z.object({
  activationId: z.string().uuid(),
  activationPayload: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const activationRedeemRequestSchema = z.object({
  secret: z.string().min(1).max(512),
  deviceId: z.string().trim().min(1).max(200),
});

export const mobileSessionResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  maxExpiresAt: z.string().datetime(),
  user: authSessionUserSchema,
});

export const sessionResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["browser", "mobile"]),
  deviceId: z.string().nullable(),
  userAgent: z.string().nullable(),
  expiresAt: z.string().datetime(),
  maxExpiresAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});

export const sessionListResponseSchema = z.object({
  data: z.array(sessionResponseSchema),
});

export const logoutResponseSchema = z.object({ success: z.literal(true) });

export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;
export type ActivationRequest = z.infer<typeof activationRequestSchema>;
export type ActivationRedeemRequest = z.infer<typeof activationRedeemRequestSchema>;
export type BrowserLoginResponse = z.infer<typeof browserLoginResponseSchema>;
export type MobileSessionResponse = z.infer<typeof mobileSessionResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

import type { Context, Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  activationRedeemRequestSchema,
  activationRequestSchema,
  adminLoginRequestSchema,
  logoutResponseSchema,
  sessionListResponseSchema,
} from "@vizaje/contracts";
import type { AuthService } from "../auth/service";
import { BROWSER_CSRF_COOKIE, BROWSER_SESSION_COOKIE } from "../auth/session-service";
import type { TrustedPrincipal } from "../domain/authz";
import { DomainError } from "../domain/errors";

export interface AuthRoutesOptions {
  auth: AuthService;
  secureCookies: boolean;
}

function parseInput<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

async function parseJson(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new DomainError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

async function requireSession(auth: AuthService, context: Context, requireCsrf: boolean) {
  const session = await auth.authenticateRequest(context, { requireCsrf });
  if (!session) throw new DomainError(401, "UNAUTHENTICATED", "Authentication is required");
  return session;
}

async function requirePrincipal(auth: AuthService, context: Context): Promise<TrustedPrincipal> {
  return (await requireSession(auth, context, true)).principal;
}

function targetUserId(context: Context, principal: TrustedPrincipal): string {
  const requested = context.req.query("userId");
  return requested ? parseInput(z.string().uuid(), requested) : principal.userId;
}

export function registerAuthRoutes(app: Hono, options: AuthRoutesOptions): void {
  const { auth, secureCookies } = options;

  app.post("/api/v1/auth/login", async (context) => {
    const input = parseInput(adminLoginRequestSchema, await parseJson(context));
    const result = await auth.login(input, { userAgent: context.req.header("User-Agent") });
    const maxAge = Math.max(1, Math.floor((result.session.expiresAt.getTime() - Date.now()) / 1000));

    setCookie(context, BROWSER_SESSION_COOKIE, result.session.token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "Lax",
      path: "/",
      maxAge,
    });
    setCookie(context, BROWSER_CSRF_COOKIE, result.session.csrfToken ?? "", {
      httpOnly: false,
      secure: secureCookies,
      sameSite: "Lax",
      path: "/",
      maxAge,
    });

    return context.json({ user: result.user, expiresAt: result.session.expiresAt.toISOString() }, 200);
  });

  app.post("/api/v1/auth/logout", async (context) => {
    const session = await requireSession(auth, context, true);
    await auth.logout(session);
    deleteCookie(context, BROWSER_SESSION_COOKIE, { path: "/", secure: secureCookies, sameSite: "Lax" });
    deleteCookie(context, BROWSER_CSRF_COOKIE, { path: "/", secure: secureCookies, sameSite: "Lax" });
    return context.json(logoutResponseSchema.parse({ success: true }), 200);
  });

  app.get("/api/v1/auth/me", async (context) => {
    const session = await requireSession(auth, context, false);
    return context.json(await auth.currentUser(session), 200);
  });

  app.post("/api/v1/auth/activation", async (context) => {
    const principal = await requirePrincipal(auth, context);
    const input = parseInput(activationRequestSchema, await parseJson(context));
    const result = await auth.requestActivation(principal, input.userId, input.storeId);
    return context.json({
      activationId: result.activationId,
      activationPayload: result.activationPayload,
      expiresAt: result.expiresAt.toISOString(),
    }, 201);
  });

  app.post("/api/v1/auth/activation/redeem", async (context) => {
    const input = parseInput(activationRedeemRequestSchema, await parseJson(context));
    return context.json(await auth.redeemActivation(input.secret, input.deviceId, context.req.header("User-Agent")), 201);
  });

  app.post("/api/v1/auth/mobile/renew", async (context) => {
    const session = await requireSession(auth, context, false);
    return context.json(await auth.renewMobileSession(session), 200);
  });

  app.get("/api/v1/auth/sessions", async (context) => {
    const session = await requireSession(auth, context, false);
    const result = await auth.listSessions(session.principal, targetUserId(context, session.principal));
    return context.json(sessionListResponseSchema.parse({ data: result }), 200);
  });

  app.post("/api/v1/auth/sessions/:id/revoke", async (context) => {
    const session = await requireSession(auth, context, true);
    const sessionId = parseInput(z.string().uuid(), context.req.param("id"));
    await auth.revokeSession(session.principal, targetUserId(context, session.principal), sessionId);
    return context.json(logoutResponseSchema.parse({ success: true }), 200);
  });

  app.post("/api/v1/auth/sessions/revoke-all", async (context) => {
    const session = await requireSession(auth, context, true);
    await auth.revokeAllSessions(session.principal, targetUserId(context, session.principal));
    return context.json(logoutResponseSchema.parse({ success: true }), 200);
  });
}

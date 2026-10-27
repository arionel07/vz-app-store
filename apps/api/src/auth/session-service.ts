import { and, desc, eq, isNull } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { Database } from "../db/client";
import { sessions, stores, userStores, users } from "../db/schema";
import type { TrustedPrincipal } from "../domain/authz";
import { DomainError } from "../domain/errors";
import { hashToken, randomToken } from "./crypto";

export const BROWSER_SESSION_COOKIE = "vizaje_session";
export const BROWSER_CSRF_COOKIE = "vizaje_csrf";

export type SessionType = "browser" | "mobile";

export interface AuthenticatedSession {
  id: string;
  userId: string;
  type: SessionType;
  token: string;
  csrfToken: string | null;
  csrfTokenHash: string | null;
  expiresAt: Date;
  maxExpiresAt: Date;
  deviceId: string | null;
  userAgent: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  principal: TrustedPrincipal;
}

export interface SessionServiceOptions {
  browserTtlMs?: number;
  mobileTtlMs?: number;
  mobileMaxLifetimeMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class SessionService {
  private readonly browserTtlMs: number;
  private readonly mobileTtlMs: number;
  private readonly mobileMaxLifetimeMs: number;

  constructor(private readonly db: Database, options: SessionServiceOptions = {}) {
    this.browserTtlMs = options.browserTtlMs ?? 8 * 60 * 60 * 1000;
    this.mobileTtlMs = options.mobileTtlMs ?? 30 * DAY_MS;
    this.mobileMaxLifetimeMs = options.mobileMaxLifetimeMs ?? 90 * DAY_MS;
  }

  private async principalForUser(userId: string): Promise<TrustedPrincipal | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.isActive) return null;

    const memberships = await this.db
      .select({ storeId: userStores.storeId })
      .from(userStores)
      .innerJoin(stores, eq(stores.id, userStores.storeId))
      .where(and(eq(userStores.userId, userId), eq(stores.isActive, true)));

    return {
      userId: user.id,
      role: user.role,
      storeIds: memberships.map(({ storeId }) => storeId),
      isActive: user.isActive,
    };
  }

  async create(
    userId: string,
    type: SessionType,
    metadata: { deviceId?: string; userAgent?: string },
    options: { maxExpiresAt?: Date } = {},
  ): Promise<AuthenticatedSession> {
    const principal = await this.principalForUser(userId);
    if (!principal) throw new DomainError(401, "INACTIVE_USER", "User is inactive or unavailable");

    const now = Date.now();
    const token = randomToken();
    const csrfToken = type === "browser" ? randomToken() : null;
    const maxExpiresAt = options.maxExpiresAt ?? new Date(now + (type === "browser" ? this.browserTtlMs : this.mobileMaxLifetimeMs));
    const expiresAt = new Date(Math.min(now + (type === "browser" ? this.browserTtlMs : this.mobileTtlMs), maxExpiresAt.getTime()));
    if (expiresAt.getTime() <= now) throw new DomainError(401, "SESSION_EXPIRED", "Session has expired");
    const [session] = await this.db
      .insert(sessions)
      .values({
        userId,
        type,
        tokenHash: await hashToken(token),
        csrfTokenHash: csrfToken ? await hashToken(csrfToken) : null,
        deviceId: metadata.deviceId ?? null,
        userAgent: metadata.userAgent ?? null,
        expiresAt,
        maxExpiresAt,
      })
      .returning();

    return { ...session, token, csrfToken, principal };
  }

  async authenticateToken(token: string): Promise<AuthenticatedSession | null> {
    const tokenHash = await hashToken(token);
    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    if (!row) return null;

    const now = new Date();
    if (row.session.revokedAt || row.session.expiresAt <= now || !row.user.isActive) {
      if (!row.session.revokedAt) {
        await this.db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.session.id));
      }
      return null;
    }

    const principal = await this.principalForUser(row.user.id);
    if (!principal) return null;

    await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
    return {
      ...row.session,
      token,
      csrfToken: null,
      principal,
    };
  }

  async authenticateRequest(context: Context, options: { requireCsrf?: boolean } = {}): Promise<AuthenticatedSession | null> {
    const authorization = context.req.header("Authorization");
    const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
    const cookieToken = getCookie(context, BROWSER_SESSION_COOKIE) ?? null;
    const token = bearer || cookieToken;
    if (!token) return null;

    const session = await this.authenticateToken(token);
    if (!session) return null;

    if (session.type === "browser" && options.requireCsrf && !["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
      const csrfToken = context.req.header("X-CSRF-Token");
      if (!csrfToken || !session.csrfTokenHash || (await hashToken(csrfToken)) !== session.csrfTokenHash) {
        throw new DomainError(403, "CSRF_FAILED", "CSRF validation failed");
      }
    }

    return session;
  }

  async revoke(sessionId: string, userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async renew(session: AuthenticatedSession): Promise<AuthenticatedSession> {
    if (session.type !== "mobile") throw new DomainError(400, "INVALID_SESSION_TYPE", "Only mobile sessions can be renewed");
    const now = Date.now();
    if (session.maxExpiresAt.getTime() <= now) {
      await this.revoke(session.id, session.userId);
      throw new DomainError(401, "SESSION_EXPIRED", "Session has expired");
    }

    await this.revoke(session.id, session.userId);
    return this.create(
      session.userId,
      "mobile",
      { deviceId: session.deviceId ?? undefined, userAgent: session.userAgent ?? undefined },
      { maxExpiresAt: session.maxExpiresAt },
    );
  }

  async listForUser(userId: string) {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt));
  }
}

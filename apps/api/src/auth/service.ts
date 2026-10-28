import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  adminLoginRequestSchema,
  mobileLoginRequestSchema,
  setUserPasswordRequestSchema,
  type AdminLoginRequest,
  type BrowserLoginResponse,
  type MobileLoginRequest,
  type MobileSessionResponse,
  type SessionResponse,
} from "@vizaje/contracts";
import type { Context } from "hono";
import type { Database } from "../db/client";
import { activationTokens, stores, userStores, users } from "../db/schema";
import {
  assertActivePrincipal,
  assertCanManageTargetUser,
  assertCanManageUsers,
  assertCanReadUser,
  type TrustedPrincipal,
} from "../domain/authz";
import { DomainError } from "../domain/errors";
import { normalizeEmail } from "../domain/normalize";
import { createUsersService, type UsersService } from "../domain/users/service";
import { hashToken, randomToken } from "./crypto";
import { defaultActivationRateLimiter, defaultLoginRateLimiter, defaultMobileLoginRateLimiter, InMemoryRateLimiter } from "./rate-limit";
import { SessionService, type AuthenticatedSession, type SessionServiceOptions } from "./session-service";

const ACTIVATION_TTL_MS = 5 * 60 * 1000;

export interface AuthServiceOptions extends SessionServiceOptions {
  loginRateLimiter?: InMemoryRateLimiter;
  mobileLoginRateLimiter?: InMemoryRateLimiter;
  activationRateLimiter?: InMemoryRateLimiter;
}

export interface LoginMetadata {
  userAgent?: string;
}

export class AuthService {
  readonly sessions: SessionService;
  private readonly users: UsersService;
  private readonly loginRateLimiter: InMemoryRateLimiter;
  private readonly mobileLoginRateLimiter: InMemoryRateLimiter;
  private readonly activationRateLimiter: InMemoryRateLimiter;
  private readonly dummyPasswordHash: Promise<string>;

  constructor(private readonly db: Database, options: AuthServiceOptions = {}) {
    this.sessions = new SessionService(db, options);
    this.users = createUsersService(db);
    this.loginRateLimiter = options.loginRateLimiter ?? defaultLoginRateLimiter;
    this.mobileLoginRateLimiter = options.mobileLoginRateLimiter ?? defaultMobileLoginRateLimiter;
    this.activationRateLimiter = options.activationRateLimiter ?? defaultActivationRateLimiter;
    this.dummyPasswordHash = Bun.password.hash(randomToken(), { algorithm: "argon2id" });
  }

  async login(input: AdminLoginRequest, metadata: LoginMetadata = {}): Promise<{ session: AuthenticatedSession; user: BrowserLoginResponse["user"] }> {
    const data = adminLoginRequestSchema.parse(input);
    const email = normalizeEmail(data.email)!;
    const rateKey = email;
    const allowed = this.loginRateLimiter.isAllowed(rateKey);
    if (!allowed) {
      throw new DomainError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const passwordHash = user?.passwordHash ?? (await this.dummyPasswordHash);
    const passwordMatches = await Bun.password.verify(data.password, passwordHash);
    const eligible = Boolean(user && user.isActive && (user.role === "admin" || user.role === "manager") && user.passwordHash && passwordMatches);

    if (!eligible) {
      this.loginRateLimiter.recordFailure(rateKey);
      throw new DomainError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    this.loginRateLimiter.recordSuccess(rateKey);
    const session = await this.sessions.create(user.id, "browser", { userAgent: metadata.userAgent });
    const responseUser = await this.users.getUserById(session.principal, user.id);
    return { session, user: responseUser };
  }

  async mobileLogin(input: MobileLoginRequest, metadata: LoginMetadata = {}): Promise<MobileSessionResponse> {
    const data = mobileLoginRequestSchema.parse(input);
    const email = normalizeEmail(data.email)!;
    const rateKey = `mobile:${email}`;
    if (!this.mobileLoginRateLimiter.isAllowed(rateKey)) {
      throw new DomainError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const passwordHash = user?.passwordHash ?? (await this.dummyPasswordHash);
    const passwordMatches = await Bun.password.verify(data.password, passwordHash);
    const eligible = Boolean(user && user.isActive && user.role === "staff" && user.passwordHash && passwordMatches);

    if (!eligible) {
      this.mobileLoginRateLimiter.recordFailure(rateKey);
      throw new DomainError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    this.mobileLoginRateLimiter.recordSuccess(rateKey);
    const session = await this.sessions.create(user.id, "mobile", {
      deviceId: data.deviceId,
      userAgent: metadata.userAgent,
    });
    return {
      accessToken: session.token,
      expiresAt: session.expiresAt.toISOString(),
      maxExpiresAt: session.maxExpiresAt.toISOString(),
      user: await this.users.getUserById(session.principal, user.id),
    };
  }

  async setStaffPassword(principal: TrustedPrincipal, userId: string, password: string): Promise<void> {
    assertCanManageUsers(principal);
    const data = setUserPasswordRequestSchema.parse({ password });
    const user = await this.users.getUserById(principal, userId);
    assertCanManageTargetUser(principal, user);
    if (user.role !== "staff") {
      throw new DomainError(403, "STAFF_PASSWORD_ONLY", "Only staff users can receive a mobile password");
    }
    if (!user.email) {
      throw new DomainError(409, "STAFF_EMAIL_REQUIRED", "A staff email is required before setting a mobile password");
    }

    const passwordHash = await Bun.password.hash(data.password, { algorithm: "argon2id" });
    await this.db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
    await this.sessions.revokeAll(userId);
  }

  async currentUser(session: AuthenticatedSession) {
    return this.users.getUserById(session.principal, session.userId);
  }

  async logout(session: AuthenticatedSession): Promise<void> {
    await this.sessions.revoke(session.id, session.userId);
  }

  async bootstrapAdmin(email: string, password: string): Promise<{ created: boolean; userId?: string }> {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || password.length < 12) {
      throw new DomainError(400, "INVALID_BOOTSTRAP_INPUT", "A valid email and a password of at least 12 characters are required");
    }

    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vizaje.bootstrap_admin'))`);

      const [existingAdmin] = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
      if (existingAdmin) return { created: false };

      const [existingUser] = await tx.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
      if (existingUser) throw new DomainError(409, "EMAIL_EXISTS", "Email already exists");

      const [created] = await tx
        .insert(users)
        .values({
          firstName: "Initial",
          lastName: "Administrator",
          email: normalizedEmail,
          phone: null,
          passwordHash,
          role: "admin",
          isActive: true,
        })
        .returning({ id: users.id });

      return { created: true, userId: created.id };
    });
  }

  async requestActivation(principal: TrustedPrincipal, userId: string, storeId: string): Promise<{ activationId: string; activationPayload: string; expiresAt: Date }> {
    assertActivePrincipal(principal);
    if (principal.role === "staff") throw new DomainError(403, "FORBIDDEN", "Staff users cannot request activation");
    const rateKey = `${principal.userId}:${userId}:${storeId}`;
    if (!this.activationRateLimiter.isAllowed(rateKey)) {
      throw new DomainError(429, "RATE_LIMITED", "Too many activation requests");
    }
    const [target] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const [store] = await this.db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    const [membership] = await this.db
      .select({ userId: userStores.userId })
      .from(userStores)
      .where(and(eq(userStores.userId, userId), eq(userStores.storeId, storeId)))
      .limit(1);

    if (!target || !store || !store.isActive || !membership || target.role !== "staff" || !target.isActive) {
      this.activationRateLimiter.recordFailure(rateKey);
      throw new DomainError(404, "ACTIVATION_UNAVAILABLE", "Activation is unavailable");
    }
    if (principal.role === "manager" && !principal.storeIds.includes(storeId)) {
      this.activationRateLimiter.recordFailure(rateKey);
      throw new DomainError(404, "ACTIVATION_UNAVAILABLE", "Activation is unavailable");
    }

    const secret = randomToken(32);
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);
    await this.db
      .update(activationTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(activationTokens.userId, userId), eq(activationTokens.storeId, storeId), isNull(activationTokens.consumedAt), gt(activationTokens.expiresAt, new Date())));
    const [activation] = await this.db
      .insert(activationTokens)
      .values({
        userId,
        storeId,
        requestedByUserId: principal.userId,
        secretHash: await hashToken(secret),
        expiresAt,
      })
      .returning({ id: activationTokens.id, expiresAt: activationTokens.expiresAt });

    this.activationRateLimiter.recordSuccess(rateKey);
    return {
      activationId: activation.id,
      activationPayload: `vizaje://activate?activationId=${activation.id}&secret=${encodeURIComponent(secret)}`,
      expiresAt: activation.expiresAt,
    };
  }

  async redeemActivation(secret: string, deviceId: string, userAgent?: string): Promise<MobileSessionResponse> {
    const rateKey = await hashToken(secret);
    if (!this.activationRateLimiter.isAllowed(rateKey)) throw new DomainError(429, "RATE_LIMITED", "Too many activation attempts");
    this.activationRateLimiter.recordFailure(rateKey);

    const secretHash = await hashToken(secret);
    const now = new Date();
    const [candidate] = await this.db
      .select()
      .from(activationTokens)
      .where(and(eq(activationTokens.secretHash, secretHash), isNull(activationTokens.consumedAt), gt(activationTokens.expiresAt, now)))
      .limit(1);
    if (!candidate) throw new DomainError(401, "INVALID_ACTIVATION", "Activation is invalid or expired");

    const [consumed] = await this.db
      .update(activationTokens)
      .set({ consumedAt: now })
      .where(and(eq(activationTokens.id, candidate.id), isNull(activationTokens.consumedAt), gt(activationTokens.expiresAt, now)))
      .returning({ id: activationTokens.id });
    if (!consumed) throw new DomainError(401, "INVALID_ACTIVATION", "Activation is invalid or expired");

    const [user] = await this.db.select().from(users).where(eq(users.id, candidate.userId)).limit(1);
    const [store] = await this.db.select().from(stores).where(eq(stores.id, candidate.storeId)).limit(1);
    if (!user || !store?.isActive || !user.isActive || user.role !== "staff") {
      throw new DomainError(401, "INVALID_ACTIVATION", "Activation is invalid or expired");
    }

    const session = await this.sessions.create(user.id, "mobile", { deviceId, userAgent });
    this.activationRateLimiter.recordSuccess(rateKey);
    return {
      accessToken: session.token,
      expiresAt: session.expiresAt.toISOString(),
      maxExpiresAt: session.maxExpiresAt.toISOString(),
      user: await this.users.getUserById(session.principal, user.id),
    };
  }

  async renewMobileSession(session: AuthenticatedSession): Promise<MobileSessionResponse> {
    const renewed = await this.sessions.renew(session);
    return {
      accessToken: renewed.token,
      expiresAt: renewed.expiresAt.toISOString(),
      maxExpiresAt: renewed.maxExpiresAt.toISOString(),
      user: await this.users.getUserById(renewed.principal, renewed.userId),
    };
  }

  async listSessions(principal: TrustedPrincipal, targetUserId: string): Promise<SessionResponse[]> {
    const user = await this.users.getUserById(principal, targetUserId);
    assertCanReadUser(principal, { id: user.id, role: user.role, storeIds: user.storeIds });
    const rows = await this.sessions.listForUser(targetUserId);
    return rows.map((session) => ({
      id: session.id,
      type: session.type,
      deviceId: session.deviceId,
      userAgent: session.userAgent,
      expiresAt: session.expiresAt.toISOString(),
      maxExpiresAt: session.maxExpiresAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString() ?? null,
    }));
  }

  async revokeSession(principal: TrustedPrincipal, targetUserId: string, sessionId: string): Promise<void> {
    const user = await this.users.getUserById(principal, targetUserId);
    assertCanReadUser(principal, { id: user.id, role: user.role, storeIds: user.storeIds });
    await this.sessions.revoke(sessionId, targetUserId);
  }

  async revokeAllSessions(principal: TrustedPrincipal, targetUserId: string): Promise<void> {
    const user = await this.users.getUserById(principal, targetUserId);
    assertCanReadUser(principal, { id: user.id, role: user.role, storeIds: user.storeIds });
    await this.sessions.revokeAll(targetUserId);
  }

  principalResolver() {
    return async (context: Context): Promise<TrustedPrincipal | null> => {
      const session = await this.sessions.authenticateRequest(context, { requireCsrf: true });
      return session?.principal ?? null;
    };
  }

  async authenticateRequest(context: Context, options: { requireCsrf?: boolean } = {}) {
    return this.sessions.authenticateRequest(context, options);
  }
}

export function createAuthService(db: Database, options: AuthServiceOptions = {}): AuthService {
  return new AuthService(db, options);
}

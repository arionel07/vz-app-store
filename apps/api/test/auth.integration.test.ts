import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../src/app";
import { createAuthService, type AuthService } from "../src/auth/service";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import { activationTokens, sessions, stores, users } from "../src/db/schema";
import { type TrustedPrincipal } from "../src/domain/authz";
import { createStoresService } from "../src/domain/stores/service";
import { createUsersService } from "../src/domain/users/service";
import { noopLogger } from "../src/lib/logger";

const integrationEnabled = Bun.env.RUN_INTEGRATION_TESTS === "1";
const suite = integrationEnabled ? describe : describe.skip;

function cookieValue(header: string | null, name: string): string {
  const match = header?.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`Missing cookie ${name}`);
  return match[1];
}

function secretFromPayload(payload: string): string {
  return new URL(payload.replace("vizaje://", "http://")).searchParams.get("secret")!;
}

suite("Authentication PostgreSQL integration", () => {
  const { db, client } = createDatabase(loadEnv());
  const usersService = createUsersService(db);
  const storesService = createStoresService(db);
  const auth: AuthService = createAuthService(db, {
    browserTtlMs: 60 * 60 * 1000,
    mobileTtlMs: 60 * 60 * 1000,
    mobileMaxLifetimeMs: 2 * 60 * 60 * 1000,
  });
  const adminPrincipal: TrustedPrincipal = {
    userId: "00000000-0000-0000-0000-000000000001",
    role: "admin",
    storeIds: [],
    isActive: true,
  };
  let adminId: string;
  let managerId: string;
  let inactiveManagerId: string;
  let staffAId: string;
  let staffBId: string;
  let storeAId: string;
  let storeBId: string;
  let adminEmail: string;
  let inactiveManagerEmail: string;
  const adminPassword = "integration-admin-password";

  beforeAll(async () => {
    const suffix = Date.now().toString();
    adminEmail = `auth-admin-${suffix}@example.com`;
    const [existingAdmin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
    if (existingAdmin) {
      const passwordHash = await Bun.password.hash(adminPassword, { algorithm: "argon2id" });
      const [testAdmin] = await db
        .insert(users)
        .values({
          firstName: "Auth",
          lastName: "Test Admin",
          email: adminEmail,
          phone: null,
          passwordHash,
          role: "admin",
          isActive: true,
        })
        .returning({ id: users.id });
      adminId = testAdmin.id;
      expect((await auth.bootstrapAdmin(adminEmail, "another-password")).created).toBe(false);
    } else {
      const bootstrap = await auth.bootstrapAdmin(adminEmail, adminPassword);
      expect(bootstrap.created).toBe(true);
      adminId = bootstrap.userId!;
    }
    adminPrincipal.userId = adminId;

    const storeA = await storesService.createStore(adminPrincipal, { name: `Auth Store A ${suffix}`, code: `AUTH-A-${suffix}` });
    const storeB = await storesService.createStore(adminPrincipal, { name: `Auth Store B ${suffix}`, code: `AUTH-B-${suffix}` });
    storeAId = storeA.id;
    storeBId = storeB.id;

    const manager = await usersService.createUser(adminPrincipal, {
      firstName: "Auth",
      lastName: "Manager",
      phone: `+37369${suffix.slice(-7)}`,
      email: `manager-${suffix}@example.com`,
      role: "manager",
      isActive: true,
      storeIds: [storeAId],
    });
    managerId = manager.id;
    await db.update(users).set({ passwordHash: await Bun.password.hash("manager-password", { algorithm: "argon2id" }) }).where(eq(users.id, managerId));

    inactiveManagerEmail = `inactive-manager-${suffix}@example.com`;
    const inactiveManager = await usersService.createUser(adminPrincipal, {
      firstName: "Inactive",
      lastName: "Manager",
      phone: `+37366${suffix.slice(-7)}`,
      email: inactiveManagerEmail,
      role: "manager",
      isActive: false,
      storeIds: [storeAId],
    });
    inactiveManagerId = inactiveManager.id;
    await db.update(users).set({ passwordHash: await Bun.password.hash("inactive-password", { algorithm: "argon2id" }) }).where(eq(users.id, inactiveManagerId));

    const staffA = await usersService.createUser(adminPrincipal, {
      firstName: "Auth",
      lastName: "Staff A",
      phone: `+37368${suffix.slice(-7)}`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeAId],
    });
    const staffB = await usersService.createUser(adminPrincipal, {
      firstName: "Auth",
      lastName: "Staff B",
      phone: `+37367${suffix.slice(-7)}`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeBId],
    });
    staffAId = staffA.id;
    staffBId = staffB.id;
  });

  afterAll(async () => {
    const userIds = [adminId, managerId, inactiveManagerId, staffAId, staffBId].filter(Boolean);
    const storeIds = [storeAId, storeBId].filter(Boolean);
    if (userIds.length > 0) await db.delete(activationTokens).where(inArray(activationTokens.userId, userIds));
    if (userIds.length > 0) await db.delete(sessions).where(inArray(sessions.userId, userIds));
    if (storeIds.length > 0) await db.delete(stores).where(inArray(stores.id, storeIds));
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    await client.end();
  });

  test("bootstraps idempotently and authenticates admin users with secure cookies", async () => {
    expect((await auth.bootstrapAdmin(adminEmail, "another-password" )).created).toBe(false);

    const app = createApp({
      db,
      allowedOrigins: ["http://localhost:3001"],
      managementServices: { users: usersService, stores: storesService },
      resolvePrincipal: auth.principalResolver(),
      authRoutes: { auth, secureCookies: false },
      logger: noopLogger,
    });
    const login = await app.request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail.toUpperCase(), password: adminPassword }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");

    const sessionToken = cookieValue(setCookie, "vizaje_session");
    const csrfToken = cookieValue(setCookie, "vizaje_csrf");
    const cookie = `vizaje_session=${sessionToken}; vizaje_csrf=${csrfToken}`;
    const me = await app.request("http://localhost/api/v1/auth/me", { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    expect((await me.json()).id).toBe(adminId);

    const csrfFailure = await app.request("http://localhost/api/v1/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    expect(csrfFailure.status).toBe(403);
    const logout = await app.request("http://localhost/api/v1/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
    });
    expect(logout.status).toBe(200);
    expect((await auth.sessions.authenticateToken(sessionToken))?.id).toBeUndefined();

    const wrongPassword = await app.request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: "wrong-password" }),
    });
    const unknownEmail = await app.request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unknown@example.com", password: "wrong-password" }),
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());

    await expect(auth.login({ email: inactiveManagerEmail, password: "inactive-password" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
    });

    const secureApp = createApp({
      db,
      allowedOrigins: ["http://localhost:3001"],
      managementServices: { users: usersService, stores: storesService },
      resolvePrincipal: auth.principalResolver(),
      authRoutes: { auth, secureCookies: true },
      logger: noopLogger,
    });
    const secureLogin = await secureApp.request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(secureLogin.headers.get("set-cookie")).toContain("Secure");
  });

  test("creates, expires, and atomically consumes staff activations", async () => {
    const managerPrincipal: TrustedPrincipal = { userId: managerId, role: "manager", storeIds: [storeAId], isActive: true };
    const activation = await auth.requestActivation(managerPrincipal, staffAId, storeAId);
    const secret = secretFromPayload(activation.activationPayload);
    const mobile = await auth.redeemActivation(secret, "device-a");
    expect(mobile.user.id).toBe(staffAId);
    expect((await auth.sessions.authenticateToken(mobile.accessToken))?.type).toBe("mobile");
    await expect(auth.redeemActivation(secret, "device-replay")).rejects.toMatchObject({ code: "INVALID_ACTIVATION" });

    const concurrentActivation = await auth.requestActivation(managerPrincipal, staffAId, storeAId);
    const concurrentSecret = secretFromPayload(concurrentActivation.activationPayload);
    const concurrent = await Promise.allSettled([
      auth.redeemActivation(concurrentSecret, "device-concurrent-a"),
      auth.redeemActivation(concurrentSecret, "device-concurrent-b"),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);

    const expired = await auth.requestActivation(managerPrincipal, staffAId, storeAId);
    await db.update(activationTokens).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(activationTokens.id, expired.activationId));
    await expect(auth.redeemActivation(secretFromPayload(expired.activationPayload), "device-expired")).rejects.toMatchObject({ code: "INVALID_ACTIVATION" });

    await expect(auth.requestActivation(managerPrincipal, staffBId, storeBId)).rejects.toMatchObject({ code: "ACTIVATION_UNAVAILABLE" });
  });

  test("renews mobile sessions within a bounded lifetime and rejects revoked devices", async () => {
    const managerPrincipal: TrustedPrincipal = { userId: managerId, role: "manager", storeIds: [storeAId], isActive: true };
    const activation = await auth.requestActivation(managerPrincipal, staffAId, storeAId);
    const session = await auth.redeemActivation(secretFromPayload(activation.activationPayload), "device-renew");
    const authenticated = await auth.sessions.authenticateToken(session.accessToken);
    expect(authenticated).not.toBeNull();
    const renewed = await auth.renewMobileSession(authenticated!);
    expect(renewed.maxExpiresAt).toBe(session.maxExpiresAt);
    expect(renewed.accessToken).not.toBe(session.accessToken);

    const renewedSession = await auth.sessions.authenticateToken(renewed.accessToken);
    await auth.sessions.revoke(renewedSession!.id, staffAId);
    expect(await auth.sessions.authenticateToken(renewed.accessToken)).toBeNull();
  });

  test("integrates authenticated principals with Users & Stores routes", async () => {
    const app = createApp({
      db,
      allowedOrigins: ["http://localhost:3001"],
      managementServices: { users: usersService, stores: storesService },
      resolvePrincipal: auth.principalResolver(),
      authRoutes: { auth, secureCookies: false },
      logger: noopLogger,
    });
    const managerLogin = await app.request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `manager-${adminEmail.split("-").at(-1)?.split("@")[0]}@example.com`, password: "manager-password" }),
    });
    expect(managerLogin.status).toBe(200);
    const cookieHeader = managerLogin.headers.get("set-cookie");
    const cookie = `vizaje_session=${cookieValue(cookieHeader, "vizaje_session")}; vizaje_csrf=${cookieValue(cookieHeader, "vizaje_csrf")}`;
    const usersResponse = await app.request("http://localhost/api/v1/users?page=1&pageSize=20", { headers: { Cookie: cookie } });
    expect(usersResponse.status).toBe(200);
    const listed = await usersResponse.json();
    expect(listed.data.some((user: { id: string }) => user.id === staffAId)).toBe(true);
    expect(listed.data.some((user: { id: string }) => user.id === staffBId)).toBe(false);
  });
});

test("authentication integration tests are explicitly opt-in", () => {
  expect(typeof integrationEnabled).toBe("boolean");
});

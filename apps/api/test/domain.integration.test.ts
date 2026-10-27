import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import { stores, userStores, users } from "../src/db/schema";
import { type TrustedPrincipal } from "../src/domain/authz";
import { createStoresService } from "../src/domain/stores/service";
import { createUsersService } from "../src/domain/users/service";

const integrationEnabled = Bun.env.RUN_INTEGRATION_TESTS === "1";
const suite = integrationEnabled ? describe : describe.skip;

suite("Users and Stores PostgreSQL integration", () => {
  const { db, client } = createDatabase(loadEnv());
  const storesService = createStoresService(db);
  const usersService = createUsersService(db);
  const admin: TrustedPrincipal = {
    userId: crypto.randomUUID(),
    role: "admin",
    storeIds: [],
    isActive: true,
  };
  const manager: TrustedPrincipal = {
    userId: crypto.randomUUID(),
    role: "manager",
    storeIds: [],
    isActive: true,
  };
  let storeA: string;
  let storeB: string;
  let storeACode: string;
  let staffA: string;
  let staffB: string;

  beforeAll(async () => {
    const suffix = Date.now().toString().slice(-4);
    const firstStore = await storesService.createStore(admin, {
      name: `Integration Store A ${suffix}`,
      code: `INT-A-${suffix}`,
    });
    const secondStore = await storesService.createStore(admin, {
      name: `Integration Store B ${suffix}`,
      code: `INT-B-${suffix}`,
    });
    storeA = firstStore.id;
    storeB = secondStore.id;
    storeACode = firstStore.code;
    manager.storeIds = [storeA];

    const firstStaff = await usersService.createUser(admin, {
      firstName: "Integration",
      lastName: "Alpha",
      phone: `+373691${suffix}01`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeA],
    });
    const secondStaff = await usersService.createUser(admin, {
      firstName: "Integration",
      lastName: "Beta",
      phone: `+373691${suffix}02`,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [storeB],
    });
    staffA = firstStaff.id;
    staffB = secondStaff.id;
  });

  afterAll(async () => {
    if (storeA && storeB) await db.delete(stores).where(inArray(stores.id, [storeA, storeB]));
    if (staffA && staffB) await db.delete(users).where(inArray(users.id, [staffA, staffB]));
    await client.end();
  });

  test("normalizes phone/email and enforces duplicate constraints", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    await expect(
      storesService.createStore(admin, {
        name: "Duplicate Store Code",
        code: storeACode,
      }),
    ).rejects.toMatchObject({ code: "STORE_CODE_EXISTS", status: 409 });

    const duplicatePhone = `+37369${Date.now().toString().slice(-7)}`;
    const phoneOwner = await usersService.createUser(admin, {
      firstName: "Phone",
      lastName: "Owner",
      phone: duplicatePhone,
      email: null,
      role: "staff",
      isActive: true,
      storeIds: [],
    });
    await expect(
      usersService.createUser(admin, {
        firstName: "Duplicate",
        lastName: "Phone",
        phone: duplicatePhone,
        email: null,
        role: "staff",
        isActive: true,
        storeIds: [],
      }),
    ).rejects.toMatchObject({ code: "USER_ALREADY_EXISTS", status: 409 });
    await db.delete(users).where(eq(users.id, phoneOwner.id));

    const created = await usersService.createUser(admin, {
      firstName: "Integration",
      lastName: "Admin",
      phone: null,
      email: `Admin.${suffix}@Example.COM`,
      role: "admin",
      isActive: true,
      storeIds: [],
    });

    expect(created.email).toBe(`admin.${suffix}@example.com`);
    expect(created.phone).toBeNull();

    await expect(
      usersService.createUser(admin, {
        firstName: "Duplicate",
        lastName: "Email",
        phone: null,
        email: `ADMIN.${suffix}@example.com`,
        role: "admin",
        isActive: true,
        storeIds: [],
      }),
    ).rejects.toMatchObject({ code: "USER_ALREADY_EXISTS", status: 409 });

    await expect(
      db.insert(users).values({
        firstName: "Invalid",
        lastName: "Phone",
        phone: "069123456",
        email: `invalid-${suffix}@example.com`,
        role: "staff",
      }).execute(),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      db.insert(userStores).values({ userId: crypto.randomUUID(), storeId: storeA }).execute(),
    ).rejects.toMatchObject({ code: "23503" });

    await db.delete(users).where(eq(users.id, created.id));
  });

  test("supports multiple memberships and prevents duplicates", async () => {
    const assigned = await usersService.assignStore(admin, staffA, storeB);
    expect(assigned.storeIds).toEqual(expect.arrayContaining([storeA, storeB]));

    await expect(usersService.assignStore(admin, staffA, storeB)).rejects.toMatchObject({
      code: "MEMBERSHIP_EXISTS",
      status: 409,
    });

    const removed = await usersService.removeStore(admin, staffA, storeB);
    expect(removed.storeIds).toEqual([storeA]);
  });

  test("enforces manager and staff store scope", async () => {
    const visible = await usersService.listUsers(manager, {
      page: 1,
      pageSize: 100,
      sortBy: "createdAt",
      sortDirection: "desc",
      isActive: true,
    });
    expect(visible.data.some((user) => user.id === staffA)).toBe(true);
    expect(visible.data.some((user) => user.id === staffB)).toBe(false);

    await expect(usersService.getUserById(manager, staffB)).rejects.toMatchObject({ status: 403 });
    await expect(usersService.assignStore(manager, staffB, storeB)).rejects.toMatchObject({ status: 403 });

    const staffPrincipal: TrustedPrincipal = {
      userId: staffA,
      role: "staff",
      storeIds: [storeA],
      isActive: true,
    };
    expect((await usersService.getUserById(staffPrincipal, staffA)).id).toBe(staffA);
    await expect(usersService.getUserById(staffPrincipal, staffB)).rejects.toMatchObject({ status: 403 });
  });

  test("handles inactive users/stores and pagination", async () => {
    const page = await usersService.listUsers(admin, {
      page: 1,
      pageSize: 1,
      sortBy: "lastName",
      sortDirection: "asc",
      isActive: true,
    });
    expect(page.data).toHaveLength(1);
    expect(page.pagination.totalPages).toBeGreaterThan(0);

    await usersService.setUserActive(admin, staffA, false);
    await expect(usersService.assignStore(admin, staffA, storeB)).rejects.toMatchObject({
      code: "INACTIVE_USER",
      status: 409,
    });

    await storesService.setStoreActive(admin, storeB, false);
    await expect(storesService.getStoreById(manager, storeB)).rejects.toMatchObject({ status: 404 });
    const activeStores = await storesService.listStores(manager, {
      page: 1,
      pageSize: 100,
      sortBy: "name",
      sortDirection: "asc",
      isActive: true,
    });
    expect(activeStores.data.some((store) => store.id === storeB)).toBe(false);
  });
});

test("domain integration tests are explicitly opt-in", () => {
  expect(typeof integrationEnabled).toBe("boolean");
});

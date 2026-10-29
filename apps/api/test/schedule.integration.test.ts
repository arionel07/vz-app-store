import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../src/app";
import { loadEnv } from "../src/config/env";
import { createDatabase } from "../src/db/client";
import { domainEvents, scheduleHistory, schedulePeriods, stores, users } from "../src/db/schema";
import type { TrustedPrincipal } from "../src/domain/authz";
import { createSchedulesService } from "../src/domain/schedules/service";
import { createStoresService } from "../src/domain/stores/service";
import { createUsersService } from "../src/domain/users/service";

const integrationEnabled = Bun.env.RUN_INTEGRATION_TESTS === "1";
const suite = integrationEnabled ? describe : describe.skip;

suite("Work schedules PostgreSQL integration", () => {
  const { db, client } = createDatabase(loadEnv());
  const storesService = createStoresService(db);
  const usersService = createUsersService(db);
  const schedulesService = createSchedulesService(db);
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
  let adminId = "";
  let managerId = "";
  let staffId = "";
  let otherStaffId = "";
  let storeId = "";
  let otherStoreId = "";
  let periodId = "";
  let revisionId = "";
  let manager: TrustedPrincipal;
  let staff: TrustedPrincipal;

  beforeAll(async () => {
    const [admin] = await db.insert(users).values({ firstName: "Schedule", lastName: "Admin", email: `schedule-admin-${suffix}@example.com`, role: "admin", isActive: true }).returning({ id: users.id });
    adminId = admin.id;
    const adminPrincipal: TrustedPrincipal = { userId: adminId, role: "admin", storeIds: [], isActive: true };
    const first = await storesService.createStore(adminPrincipal, { name: `Schedule Store ${suffix}`, code: `SCH-${suffix}` });
    const second = await storesService.createStore(adminPrincipal, { name: `Other Schedule Store ${suffix}`, code: `SCH-2-${suffix}` });
    storeId = first.id; otherStoreId = second.id;
    const managerUser = await usersService.createUser(adminPrincipal, { firstName: "Schedule", lastName: "Manager", phone: `+37369${suffix}1`, email: `schedule-manager-${suffix}@example.com`, role: "manager", isActive: true, storeIds: [storeId] });
    const staffUser = await usersService.createUser(adminPrincipal, { firstName: "Schedule", lastName: "Staff", phone: `+37369${suffix}2`, email: null, role: "staff", isActive: true, storeIds: [storeId] });
    const otherStaff = await usersService.createUser(adminPrincipal, { firstName: "Other", lastName: "Staff", phone: `+37369${suffix}3`, email: null, role: "staff", isActive: true, storeIds: [otherStoreId] });
    managerId = managerUser.id; staffId = staffUser.id; otherStaffId = otherStaff.id;
    manager = { userId: managerId, role: "manager", storeIds: [storeId], isActive: true };
    staff = { userId: staffId, role: "staff", storeIds: [storeId], isActive: true };
  });

  afterAll(async () => {
    for (const id of [periodId, revisionId].filter(Boolean)) { await db.delete(scheduleHistory).where(eq(scheduleHistory.scheduleId, id)); await db.delete(domainEvents).where(and(eq(domainEvents.aggregateType, "schedule"), eq(domainEvents.aggregateId, id))); await db.delete(schedulePeriods).where(eq(schedulePeriods.id, id)); }
    if (managerId && staffId && otherStaffId) await db.delete(users).where(inArray(users.id, [managerId, staffId, otherStaffId]));
    if (adminId) await db.delete(users).where(eq(users.id, adminId));
    if (storeId && otherStoreId) await db.delete(stores).where(inArray(stores.id, [storeId, otherStoreId]));
    await client.end();
  });

  test("scopes management, rejects overlaps, publishes atomically and exposes staff schedule", async () => {
    const period = await schedulesService.create(manager, { storeId, startDate: "2026-03-28", endDate: "2026-04-03", timezone: "Europe/Chisinau" });
    periodId = period.id;
    await expect(schedulesService.create(manager, { storeId: otherStoreId, startDate: "2026-03-28", endDate: "2026-04-03", timezone: "Europe/Chisinau" })).rejects.toMatchObject({ status: 403, code: "STORE_FORBIDDEN" });
    await schedulesService.addShift(manager, periodId, { employeeId: staffId, localDate: "2026-03-28", startTime: "22:00", endTime: "06:00", note: "Закрытие" });
    await expect(schedulesService.addShift(manager, periodId, { employeeId: staffId, localDate: "2026-03-29", startTime: "05:00", endTime: "07:00", note: null })).rejects.toMatchObject({ status: 409, code: "SHIFT_OVERLAP" });
    await expect(schedulesService.addDayOff(manager, periodId, { employeeId: staffId, localDate: "2026-03-28", note: null })).rejects.toMatchObject({ status: 409, code: "DAY_OFF_SHIFT_CONFLICT" });
    const published = await schedulesService.publish(manager, periodId);
    expect(published.status).toBe("published");
    expect((await schedulesService.history(manager, periodId)).data.map((item) => String(item.action))).toContain("published");
    const staffSchedule = await schedulesService.staffSchedule(staff, { from: "2026-03-28", to: "2026-04-03" });
    expect(staffSchedule.days.find((day) => day.date === "2026-03-28")?.shifts[0]).toMatchObject({ startTime: "22:00", endTime: "06:00", timezone: "Europe/Chisinau" });
    expect(staffSchedule.days.find((day) => day.date === "2026-03-29")?.status).toBe("no_schedule");
    await expect(schedulesService.get(staff, periodId)).rejects.toMatchObject({ status: 403 });

    const revision = await schedulesService.revise(manager, periodId);
    revisionId = revision.id;
    await schedulesService.updateShift(manager, revisionId, revision.shifts[0]!.id, { note: "Ревизия" });
    const republished = await schedulesService.publish(manager, revisionId);
    expect(republished.status).toBe("published");
    expect((await schedulesService.staffSchedule(staff, { from: "2026-03-28", to: "2026-04-03" })).days.find((day) => day.date === "2026-03-28")?.shifts[0]?.note).toBe("Ревизия");
  });

  test("HTTP staff endpoint denies management roles and keeps events transactional", async () => {
    const app = createApp({ db, allowedOrigins: [], managementServices: { users: usersService, stores: storesService, schedules: schedulesService }, resolvePrincipal: (context) => context.req.header("x-test-role") === "staff" ? staff : manager });
    const denied = await app.request("http://localhost/api/v1/me/schedule?from=2026-03-28&to=2026-04-03", { headers: { "x-test-role": "manager" } });
    expect(denied.status).toBe(403);
    const allowed = await app.request("http://localhost/api/v1/me/schedule?from=2026-03-28&to=2026-04-03", { headers: { "x-test-role": "staff" } });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).days).toHaveLength(7);
    const events = await db.select().from(domainEvents).where(and(eq(domainEvents.aggregateType, "schedule"), eq(domainEvents.aggregateId, periodId)));
    expect(events.some((event) => event.eventType === "schedule.updated")).toBe(true);
    expect(events.some((event) => event.eventType === "schedule.published")).toBe(true);
  });
});

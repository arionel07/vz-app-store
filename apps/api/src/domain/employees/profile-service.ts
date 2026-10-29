import { and, eq } from "drizzle-orm";
import {
  employeeProfileAdminResponseSchema,
  employeeProfileSafeResponseSchema,
  employeeProfileUpdateSchema,
  type EmployeeProfileResponse,
  type EmployeeProfileUpdateInput,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import { employeeProfiles, stores, userStores } from "../../db/schema";
import {
  assertActivePrincipal,
  assertCanManageTargetUser,
  type TrustedPrincipal,
} from "../authz";
import { DomainError } from "../errors";
import type { UsersService } from "../users/service";

type EmployeeProfileRow = typeof employeeProfiles.$inferSelect;

function toProfileResponse(row: EmployeeProfileRow, principal: TrustedPrincipal): EmployeeProfileResponse {
  const base = {
    userId: row.userId,
    jobTitle: row.jobTitle,
    employmentStartedOn: row.employmentStartedOn,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (principal.role === "admin") {
    return employeeProfileAdminResponseSchema.parse({
      ...base,
      birthDate: row.birthDate,
      gender: row.gender,
    });
  }

  return employeeProfileSafeResponseSchema.parse(base);
}

export class EmployeeProfileService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersService,
  ) {}

  private async ensureProfile(userId: string): Promise<EmployeeProfileRow> {
    const [existing] = await this.db
      .select()
      .from(employeeProfiles)
      .where(eq(employeeProfiles.userId, userId))
      .limit(1);
    if (existing) return existing;

    const [created] = await this.db
      .insert(employeeProfiles)
      .values({ userId })
      .onConflictDoNothing({ target: employeeProfiles.userId })
      .returning();
    if (created) return created;

    const [recovered] = await this.db
      .select()
      .from(employeeProfiles)
      .where(eq(employeeProfiles.userId, userId))
      .limit(1);
    if (!recovered) throw new DomainError(503, "PROFILE_UNAVAILABLE", "Employee profile is unavailable");
    return recovered;
  }

  async getProfile(principal: TrustedPrincipal, userId: string): Promise<EmployeeProfileResponse> {
    assertActivePrincipal(principal);
    await this.users.getUserById(principal, userId);
    return toProfileResponse(await this.ensureProfile(userId), principal);
  }

  async updateProfile(
    principal: TrustedPrincipal,
    userId: string,
    input: EmployeeProfileUpdateInput,
  ): Promise<EmployeeProfileResponse> {
    assertActivePrincipal(principal);
    const user = await this.users.getUserById(principal, userId);
    const activeStoreMemberships = principal.role === "admin"
      ? user.storeIds
      : (await this.db
        .select({ storeId: userStores.storeId })
        .from(userStores)
        .innerJoin(stores, eq(stores.id, userStores.storeId))
        .where(and(eq(userStores.userId, userId), eq(stores.isActive, true))))
        .map(({ storeId }) => storeId);
    assertCanManageTargetUser(principal, {
      id: user.id,
      role: user.role,
      storeIds: activeStoreMemberships,
    });

    const data = employeeProfileUpdateSchema.parse(input);
    if (principal.role !== "admin" && ("birthDate" in data || "gender" in data)) {
      throw new DomainError(403, "PROFILE_FIELD_FORBIDDEN", "Sensitive profile fields are restricted to administrators");
    }

    const current = await this.ensureProfile(userId);
    const next = {
      jobTitle: data.jobTitle !== undefined ? data.jobTitle : current.jobTitle,
      employmentStartedOn: data.employmentStartedOn !== undefined ? data.employmentStartedOn : current.employmentStartedOn,
      birthDate: data.birthDate !== undefined ? data.birthDate : current.birthDate,
      gender: data.gender !== undefined ? data.gender : current.gender,
      updatedAt: new Date(),
    };

    const [updated] = await this.db
      .update(employeeProfiles)
      .set(next)
      .where(eq(employeeProfiles.userId, userId))
      .returning();
    if (!updated) throw new DomainError(503, "PROFILE_UNAVAILABLE", "Employee profile is unavailable");
    return toProfileResponse(updated, principal);
  }
}

export function createEmployeeProfileService(db: Database, users: UsersService): EmployeeProfileService {
  return new EmployeeProfileService(db, users);
}

import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import {
  createUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
  type UserListQuery,
  updateUserSchema,
  type UserResponse,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import { stores, userStores, users } from "../../db/schema";
import {
  assertCanManageMembership,
  assertCanManageTargetUser,
  assertCanManageUsers,
  assertCanReadUser,
  type TrustedPrincipal,
} from "../authz";
import { DomainError, isForeignKeyViolation, isUniqueViolation } from "../errors";
import { normalizeEmail, normalizePhone } from "../normalize";

type UserRow = typeof users.$inferSelect;

interface UserWithStores {
  user: UserRow;
  storeIds: string[];
  activeStoreIds: string[];
}

function toUserResponse(record: UserWithStores): UserResponse {
  return {
    id: record.user.id,
    firstName: record.user.firstName,
    lastName: record.user.lastName,
    phone: record.user.phone,
    email: record.user.email,
    role: record.user.role,
    isActive: record.user.isActive,
    storeIds: record.storeIds,
    createdAt: record.user.createdAt.toISOString(),
    updatedAt: record.user.updatedAt.toISOString(),
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export class UsersService {
  constructor(private readonly db: Database) {}

  private async getWithStores(userId: string, executor: Database = this.db): Promise<UserWithStores | null> {
    const [user] = await executor.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return null;

    const memberships = await executor
      .select({ storeId: userStores.storeId, isActive: stores.isActive })
      .from(userStores)
      .innerJoin(stores, eq(stores.id, userStores.storeId))
      .where(eq(userStores.userId, userId));

    return {
      user,
      storeIds: memberships.map((membership) => membership.storeId),
      activeStoreIds: memberships.filter((membership) => membership.isActive).map((membership) => membership.storeId),
    };
  }

  private async requireUser(userId: string): Promise<UserWithStores> {
    const record = await this.getWithStores(userId);
    if (!record) throw new DomainError(404, "USER_NOT_FOUND", "User not found");
    return record;
  }

  private async assertAssignmentStores(storeIds: readonly string[], principal: TrustedPrincipal): Promise<void> {
    const ids = uniqueIds(storeIds);
    if (ids.length !== storeIds.length) {
      throw new DomainError(409, "DUPLICATE_STORE_ASSIGNMENT", "Duplicate store assignment");
    }

    if (principal.role === "manager" && ids.some((storeId) => !principal.storeIds.includes(storeId))) {
      throw new DomainError(403, "FORBIDDEN", "The store is outside the manager scope");
    }

    if (ids.length === 0) return;

    const activeStores = await this.db
      .select({ id: stores.id })
      .from(stores)
      .where(and(inArray(stores.id, ids), eq(stores.isActive, true)));

    if (activeStores.length !== ids.length) {
      throw new DomainError(409, "STORE_UNAVAILABLE", "All assigned stores must be active and exist");
    }
  }

  async createUser(principal: TrustedPrincipal, input: CreateUserInput): Promise<UserResponse> {
    assertCanManageUsers(principal);
    const data = createUserSchema.parse(input);

    if (principal.role === "manager" && data.role !== "staff") {
      throw new DomainError(403, "FORBIDDEN", "Managers can only create staff users");
    }

    const phone = normalizePhone(data.phone);
    const email = normalizeEmail(data.email);
    await this.assertAssignmentStores(data.storeIds, principal);

    try {
      const userId = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            firstName: data.firstName,
            lastName: data.lastName,
            phone,
            email,
            role: data.role,
            isActive: data.isActive,
          })
          .returning({ id: users.id });

        if (data.storeIds.length > 0) {
          await tx.insert(userStores).values(data.storeIds.map((storeId) => ({ userId: created.id, storeId })));
        }

        return created.id;
      });

      return toUserResponse(await this.requireUser(userId));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError(409, "USER_ALREADY_EXISTS", "Phone or email already exists");
      }
      if (isForeignKeyViolation(error)) {
        throw new DomainError(409, "STORE_UNAVAILABLE", "Assigned store does not exist");
      }
      throw error;
    }
  }

  async updateUser(principal: TrustedPrincipal, userId: string, input: UpdateUserInput): Promise<UserResponse> {
    assertCanManageUsers(principal);
    const data = updateUserSchema.parse(input);
    const current = await this.requireUser(userId);
    assertCanManageTargetUser(principal, {
      id: current.user.id,
      role: current.user.role,
      storeIds: current.activeStoreIds,
    });

    const role = data.role ?? current.user.role;
    if (principal.role === "manager" && role !== "staff") {
      throw new DomainError(403, "FORBIDDEN", "Managers can only manage staff users");
    }

    const phone = "phone" in data ? normalizePhone(data.phone) : current.user.phone;
    const email = "email" in data ? normalizeEmail(data.email) : current.user.email;
    const validation = createUserSchema.safeParse({
      firstName: data.firstName ?? current.user.firstName,
      lastName: data.lastName ?? current.user.lastName,
      phone,
      email,
      role,
      isActive: data.isActive ?? current.user.isActive,
      storeIds: current.storeIds,
    });

    if (!validation.success) {
      throw new DomainError(400, "INVALID_USER", validation.error.issues[0]?.message ?? "Invalid user");
    }

    try {
      await this.db
        .update(users)
        .set({
          firstName: validation.data.firstName,
          lastName: validation.data.lastName,
          phone,
          email,
          role,
          isActive: validation.data.isActive,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError(409, "USER_ALREADY_EXISTS", "Phone or email already exists");
      }
      throw error;
    }

    return toUserResponse(await this.requireUser(userId));
  }

  async getUserById(principal: TrustedPrincipal, userId: string): Promise<UserResponse> {
    const record = await this.requireUser(userId);
    assertCanReadUser(principal, {
      id: record.user.id,
      role: record.user.role,
      storeIds: record.activeStoreIds,
    });
    return toUserResponse(record);
  }

  async listUsers(principal: TrustedPrincipal, query: UserListQuery) {
    assertCanManageUsers(principal);
    const filters = [eq(users.isActive, query.isActive ?? true)];

    if (query.role) filters.push(eq(users.role, query.role));
    if (query.search) {
      const search = `%${query.search}%`;
      filters.push(or(ilike(users.firstName, search), ilike(users.lastName, search), ilike(users.email, search))!);
    }

    if (principal.role === "manager") {
      filters.push(eq(users.role, "staff"));
      if (principal.storeIds.length === 0) {
        return { data: [], pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 } };
      }

      filters.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(userStores)
            .innerJoin(stores, eq(stores.id, userStores.storeId))
            .where(
              and(
                eq(userStores.userId, users.id),
                inArray(userStores.storeId, [...principal.storeIds]),
                eq(stores.isActive, true),
              ),
            ),
        ),
      );
    }

    const where = and(...filters);
    const sortColumns = {
      firstName: users.firstName,
      lastName: users.lastName,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    } as const;
    const sortColumn = sortColumns[query.sortBy];
    const order = query.sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)` }).from(users).where(where);
    const rows = await this.db
      .select()
      .from(users)
      .where(where)
      .orderBy(order)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const records = await Promise.all(rows.map((row) => this.getWithStores(row.id)));

    return {
      data: records.filter((record): record is UserWithStores => record !== null).map(toUserResponse),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / query.pageSize),
      },
    };
  }

  async setUserActive(principal: TrustedPrincipal, userId: string, isActive: boolean): Promise<UserResponse> {
    return this.updateUser(principal, userId, { isActive });
  }

  async assignStore(principal: TrustedPrincipal, userId: string, storeId: string): Promise<UserResponse> {
    assertCanManageMembership(principal, storeId);
    const target = await this.requireUser(userId);

    if (principal.role === "manager" && target.user.role !== "staff") {
      throw new DomainError(403, "FORBIDDEN", "Managers can only manage staff users");
    }
    if (!target.user.isActive) throw new DomainError(409, "INACTIVE_USER", "Cannot assign a store to an inactive user");

    const [store] = await this.db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!store || !store.isActive) throw new DomainError(409, "STORE_UNAVAILABLE", "Store is inactive or does not exist");

    try {
      await this.db.insert(userStores).values({ userId, storeId });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError(409, "MEMBERSHIP_EXISTS", "User is already assigned to this store");
      throw error;
    }

    return toUserResponse(await this.requireUser(userId));
  }

  async removeStore(principal: TrustedPrincipal, userId: string, storeId: string): Promise<UserResponse> {
    assertCanManageMembership(principal, storeId);
    const target = await this.requireUser(userId);

    if (principal.role === "manager" && target.user.role !== "staff") {
      throw new DomainError(403, "FORBIDDEN", "Managers can only manage staff users");
    }

    const result = await this.db
      .delete(userStores)
      .where(and(eq(userStores.userId, userId), eq(userStores.storeId, storeId)))
      .returning({ userId: userStores.userId });
    if (result.length === 0) throw new DomainError(404, "MEMBERSHIP_NOT_FOUND", "Store membership not found");

    return toUserResponse(await this.requireUser(userId));
  }
}

export function createUsersService(db: Database): UsersService {
  return new UsersService(db);
}

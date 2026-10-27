import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import {
  createStoreSchema,
  type CreateStoreInput,
  type StoreListQuery,
  type StoreResponse,
  type UpdateStoreInput,
  updateStoreSchema,
} from "@vizaje/contracts";
import type { Database } from "../../db/client";
import { stores } from "../../db/schema";
import { assertCanAccessAssignedStore, assertCanManageStores, type TrustedPrincipal } from "../authz";
import { DomainError, isUniqueViolation } from "../errors";
import { normalizeStoreCode, normalizeStoreName } from "../normalize";

function toStoreResponse(store: typeof stores.$inferSelect): StoreResponse {
  return {
    id: store.id,
    name: store.name,
    code: store.code,
    isActive: store.isActive,
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  };
}

export class StoresService {
  constructor(private readonly db: Database) {}

  private async requireStore(storeId: string) {
    const [store] = await this.db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!store) throw new DomainError(404, "STORE_NOT_FOUND", "Store not found");
    return store;
  }

  async createStore(principal: TrustedPrincipal, input: CreateStoreInput): Promise<StoreResponse> {
    assertCanManageStores(principal);
    const data = createStoreSchema.parse(input);

    try {
      const [store] = await this.db
        .insert(stores)
        .values({
          name: normalizeStoreName(data.name),
          code: normalizeStoreCode(data.code),
          isActive: data.isActive,
        })
        .returning();
      return toStoreResponse(store);
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError(409, "STORE_CODE_EXISTS", "Store code already exists");
      throw error;
    }
  }

  async updateStore(principal: TrustedPrincipal, storeId: string, input: UpdateStoreInput): Promise<StoreResponse> {
    assertCanManageStores(principal);
    const data = updateStoreSchema.parse(input);
    await this.requireStore(storeId);

    try {
      const [store] = await this.db
        .update(stores)
        .set({
          ...(data.name !== undefined ? { name: normalizeStoreName(data.name) } : {}),
          ...(data.code !== undefined ? { code: normalizeStoreCode(data.code) } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(stores.id, storeId))
        .returning();
      return toStoreResponse(store);
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError(409, "STORE_CODE_EXISTS", "Store code already exists");
      throw error;
    }
  }

  async getStoreById(principal: TrustedPrincipal, storeId: string): Promise<StoreResponse> {
    const store = await this.requireStore(storeId);

    if (principal.role !== "admin") {
      if (!store.isActive) throw new DomainError(404, "STORE_NOT_FOUND", "Store not found");
      assertCanAccessAssignedStore(principal, storeId);
    }

    return toStoreResponse(store);
  }

  async listStores(principal: TrustedPrincipal, query: StoreListQuery) {
    if (principal.role === "admin") {
      if (!principal.isActive) throw new DomainError(403, "INACTIVE_PRINCIPAL", "The authenticated user is inactive");
    } else if (!principal.isActive) {
      throw new DomainError(403, "INACTIVE_PRINCIPAL", "The authenticated user is inactive");
    }

    const filters = [eq(stores.isActive, query.isActive ?? true)];
    if (query.search) {
      const search = `%${query.search}%`;
      filters.push(sql`(${ilike(stores.name, search)} or ${ilike(stores.code, search)})`);
    }
    if (principal.role !== "admin") {
      if (principal.storeIds.length === 0) {
        return { data: [], pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 } };
      }
      filters.push(inArray(stores.id, [...principal.storeIds]));
      filters.push(eq(stores.isActive, true));
    }

    const where = and(...filters);
    const sortColumns = {
      name: stores.name,
      code: stores.code,
      createdAt: stores.createdAt,
      updatedAt: stores.updatedAt,
    } as const;
    const sortColumn = sortColumns[query.sortBy];
    const order = query.sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)` }).from(stores).where(where);
    const rows = await this.db
      .select()
      .from(stores)
      .where(where)
      .orderBy(order)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      data: rows.map(toStoreResponse),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / query.pageSize),
      },
    };
  }

  async setStoreActive(principal: TrustedPrincipal, storeId: string, isActive: boolean): Promise<StoreResponse> {
    return this.updateStore(principal, storeId, { isActive });
  }
}

export function createStoresService(db: Database): StoresService {
  return new StoresService(db);
}

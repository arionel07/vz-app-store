import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  createStoreSchema,
  createUserSchema,
  storeListQuerySchema,
  updateStoreSchema,
  updateUserSchema,
  userListQuerySchema,
  employeeProfileUpdateSchema,
} from "@vizaje/contracts";
import type { EmployeeProfileService } from "../domain/employees/profile-service";
import type { StoresService } from "../domain/stores/service";
import type { TrustedPrincipal } from "../domain/authz";
import { DomainError } from "../domain/errors";
import type { UsersService } from "../domain/users/service";

export interface ManagementServices {
  users: UsersService;
  stores: StoresService;
  profiles?: EmployeeProfileService;
}

export type PrincipalResolver = (context: Context) => TrustedPrincipal | null | Promise<TrustedPrincipal | null>;

function parseInput<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request");
  }
  return parsed.data;
}

async function parseJson(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new DomainError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function parseId(value: string, resource: string): string {
  return parseInput(z.string().uuid(`${resource} ID must be a UUID`), value);
}

async function requirePrincipal(resolvePrincipal: PrincipalResolver, context: Context): Promise<TrustedPrincipal> {
  const principal = await resolvePrincipal(context);
  if (!principal) throw new DomainError(401, "UNAUTHENTICATED", "Authentication is required");
  return principal;
}

function requireServices(services: ManagementServices | undefined): ManagementServices {
  if (!services) throw new Error("Management services are not configured");
  return services;
}

function requireProfiles(services: ManagementServices | undefined): EmployeeProfileService {
  const profileService = requireServices(services).profiles;
  if (!profileService) throw new Error("Employee profile services are not configured");
  return profileService;
}

export function registerManagementRoutes(
  app: Hono,
  services: ManagementServices | undefined,
  resolvePrincipal: PrincipalResolver,
): void {
  app.post("/api/v1/users", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const body = parseInput(createUserSchema, await parseJson(context));
    const result = await requireServices(services).users.createUser(principal, body);
    return context.json(result, 201);
  });

  app.get("/api/v1/users", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const query = parseInput(userListQuerySchema, context.req.query());
    const result = await requireServices(services).users.listUsers(principal, query);
    return context.json(result, 200);
  });

  app.get("/api/v1/users/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await requireServices(services).users.getUserById(principal, parseId(context.req.param("id"), "User"));
    return context.json(result, 200);
  });

  app.get("/api/v1/me/profile", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await requireProfiles(services).getProfile(principal, principal.userId);
    return context.json(result, 200);
  });

  app.get("/api/v1/users/:id/profile", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await requireProfiles(services).getProfile(principal, parseId(context.req.param("id"), "User"));
    return context.json(result, 200);
  });

  app.patch("/api/v1/users/:id/profile", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const body = parseInput(employeeProfileUpdateSchema, await parseJson(context));
    const result = await requireProfiles(services).updateProfile(principal, parseId(context.req.param("id"), "User"), body);
    return context.json(result, 200);
  });

  app.patch("/api/v1/users/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const body = parseInput(updateUserSchema, await parseJson(context));
    const result = await requireServices(services).users.updateUser(principal, parseId(context.req.param("id"), "User"), body);
    return context.json(result, 200);
  });

  app.post("/api/v1/users/:id/activate", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await requireServices(services).users.setUserActive(principal, parseId(context.req.param("id"), "User"), true);
    return context.json(result, 200);
  });

  app.post("/api/v1/users/:id/deactivate", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await requireServices(services).users.setUserActive(principal, parseId(context.req.param("id"), "User"), false);
    return context.json(result, 200);
  });

  app.post("/api/v1/users/:id/stores/:storeId", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await requireServices(services).users.assignStore(
      principal,
      parseId(context.req.param("id"), "User"),
      parseId(context.req.param("storeId"), "Store"),
    );
    return context.json(result, 200);
  });

  app.delete("/api/v1/users/:id/stores/:storeId", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await requireServices(services).users.removeStore(
      principal,
      parseId(context.req.param("id"), "User"),
      parseId(context.req.param("storeId"), "Store"),
    );
    return context.json(result, 200);
  });

  app.post("/api/v1/stores", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const body = parseInput(createStoreSchema, await parseJson(context));
    const result = await requireServices(services).stores.createStore(principal, body);
    return context.json(result, 201);
  });

  app.get("/api/v1/stores", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const query = parseInput(storeListQuerySchema, context.req.query());
    const result = await requireServices(services).stores.listStores(principal, query);
    return context.json(result, 200);
  });

  app.get("/api/v1/stores/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await requireServices(services).stores.getStoreById(principal, parseId(context.req.param("id"), "Store"));
    return context.json(result, 200);
  });

  app.patch("/api/v1/stores/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const body = parseInput(updateStoreSchema, await parseJson(context));
    const result = await requireServices(services).stores.updateStore(principal, parseId(context.req.param("id"), "Store"), body);
    return context.json(result, 200);
  });

  app.post("/api/v1/stores/:id/activate", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await requireServices(services).stores.setStoreActive(principal, parseId(context.req.param("id"), "Store"), true);
    return context.json(result, 200);
  });

  app.post("/api/v1/stores/:id/deactivate", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await requireServices(services).stores.setStoreActive(principal, parseId(context.req.param("id"), "Store"), false);
    return context.json(result, 200);
  });
}

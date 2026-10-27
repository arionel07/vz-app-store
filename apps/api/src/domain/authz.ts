import type { UserRole } from "@vizaje/contracts";
import { DomainError } from "./errors";

export interface TrustedPrincipal {
  userId: string;
  role: UserRole;
  storeIds: readonly string[];
  isActive: boolean;
}

export function assertActivePrincipal(principal: TrustedPrincipal | null): asserts principal is TrustedPrincipal {
  if (!principal) {
    throw new DomainError(401, "UNAUTHENTICATED", "Authentication is required");
  }

  if (!principal.isActive) {
    throw new DomainError(403, "INACTIVE_PRINCIPAL", "The authenticated user is inactive");
  }
}

export function canAccessStore(principal: TrustedPrincipal, storeId: string): boolean {
  return principal.role === "admin" || principal.storeIds.includes(storeId);
}

export function assertCanManageUsers(principal: TrustedPrincipal): void {
  assertActivePrincipal(principal);

  if (principal.role !== "admin" && principal.role !== "manager") {
    throw new DomainError(403, "FORBIDDEN", "This role cannot manage users");
  }
}

export function assertCanManageStores(principal: TrustedPrincipal): void {
  assertActivePrincipal(principal);

  if (principal.role !== "admin") {
    throw new DomainError(403, "FORBIDDEN", "Only administrators can manage stores");
  }
}

export function assertCanManageTargetUser(
  principal: TrustedPrincipal,
  target: { id: string; role: UserRole; storeIds: readonly string[] },
): void {
  assertCanManageUsers(principal);

  if (principal.role === "admin") return;

  if (target.role !== "staff" || !target.storeIds.some((storeId) => principal.storeIds.includes(storeId))) {
    throw new DomainError(403, "FORBIDDEN", "The user is outside the manager store scope");
  }
}

export function assertCanReadUser(
  principal: TrustedPrincipal,
  target: { id: string; role: UserRole; storeIds: readonly string[] },
): void {
  assertActivePrincipal(principal);

  if (principal.role === "admin" || principal.userId === target.id) return;

  if (principal.role === "manager" && target.role === "staff" && target.storeIds.some((storeId) => principal.storeIds.includes(storeId))) {
    return;
  }

  throw new DomainError(403, "FORBIDDEN", "The user is outside the principal scope");
}

export function assertCanAccessAssignedStore(principal: TrustedPrincipal, storeId: string): void {
  assertActivePrincipal(principal);

  if (!canAccessStore(principal, storeId)) {
    throw new DomainError(403, "FORBIDDEN", "The store is outside the principal scope");
  }
}

export function assertCanManageMembership(principal: TrustedPrincipal, storeId: string): void {
  assertCanManageUsers(principal);

  if (principal.role === "manager" && !principal.storeIds.includes(storeId)) {
    throw new DomainError(403, "FORBIDDEN", "The store is outside the manager scope");
  }
}

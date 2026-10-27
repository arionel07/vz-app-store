import { DomainError } from "./errors";

export function normalizePhone(phone: string | null | undefined): string | null {
  if (phone == null || phone.trim() === "") return null;

  const compact = phone.trim().replace(/[\s().-]/g, "");
  const normalized = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;

  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
    throw new DomainError(400, "INVALID_PHONE", "Phone must be a valid E.164 number");
  }

  return normalized;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (email == null || email.trim() === "") return null;
  return email.trim().toLowerCase();
}

export function normalizeStoreCode(code: string): string {
  return code.trim();
}

export function normalizeStoreName(name: string): string {
  return name.trim();
}

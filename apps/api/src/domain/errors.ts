export type DomainErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 503;

export class DomainError extends Error {
  constructor(
    public readonly status: DomainErrorStatus,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23503";
}

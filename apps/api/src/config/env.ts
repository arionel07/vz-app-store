import { z } from "zod";

const DEFAULT_DATABASE_URL = "postgres://vizaje:vizaje@localhost:5432/vizaje_staff";
const DEFAULT_CORS_ALLOWED_ORIGINS = "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001";
const DEFAULT_PHOTO_STORAGE_PATH = "./.data/photos";
const DEFAULT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_PHOTO_MAX_DIMENSION = 8192;
const DEFAULT_PHOTO_MAX_PIXELS = 25_000_000;

function parseCorsOrigins(value: string, context: z.RefinementCtx): string[] {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => (origin.endsWith("/") ? origin.slice(0, -1) : origin));

  if (origins.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "At least one CORS origin is required" });
    return [];
  }

  for (const origin of origins) {
    if (origin === "*") continue;

    try {
      const url = new URL(origin);
      const isHttpOrigin = url.protocol === "http:" || url.protocol === "https:";
      const isOriginOnly = url.origin === origin && !url.username && !url.password;

      if (!isHttpOrigin || !isOriginOnly) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid CORS origin: ${origin}`,
        });
      }
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid CORS origin: ${origin}`,
      });
    }
  }

  return origins;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  DATABASE_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CORS_ALLOWED_ORIGINS: z.string().default(DEFAULT_CORS_ALLOWED_ORIGINS).transform(parseCorsOrigins),
  PHOTO_STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  PHOTO_STORAGE_PATH: z.string().min(1).default(DEFAULT_PHOTO_STORAGE_PATH),
  PHOTO_MAX_BYTES: z.coerce.number().int().positive().max(25 * 1024 * 1024).default(DEFAULT_PHOTO_MAX_BYTES),
  PHOTO_MAX_DIMENSION: z.coerce.number().int().positive().max(16384).default(DEFAULT_PHOTO_MAX_DIMENSION),
  PHOTO_MAX_PIXELS: z.coerce.number().int().positive().max(100_000_000).default(DEFAULT_PHOTO_MAX_PIXELS),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
});

type ParsedEnv = z.infer<typeof envSchema>;
export type Env = Omit<ParsedEnv, "DATABASE_URL"> & { DATABASE_URL: string };

const runtimeEnv: Record<string, string | undefined> =
  typeof Bun === "undefined" ? process.env : Bun.env;

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
}

export function loadEnv(source: Record<string, string | undefined> = runtimeEnv): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${formatIssues(parsed.error.issues)}`);
  }

  const issues: z.ZodIssue[] = [];

  if (parsed.data.NODE_ENV === "production" && !parsed.data.DATABASE_URL) {
    issues.push({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_URL"],
      message: "DATABASE_URL is required in production",
    });
  }

  if (parsed.data.NODE_ENV === "production" && parsed.data.CORS_ALLOWED_ORIGINS.includes("*")) {
    issues.push({
      code: z.ZodIssueCode.custom,
      path: ["CORS_ALLOWED_ORIGINS"],
      message: "Wildcard CORS origins are not allowed in production",
    });
  }

  if (parsed.data.NODE_ENV === "production" && parsed.data.PHOTO_STORAGE_DRIVER !== "s3") {
    issues.push({
      code: z.ZodIssueCode.custom,
      path: ["PHOTO_STORAGE_DRIVER"],
      message: "S3 photo storage is required in production",
    });
  }

  if (parsed.data.NODE_ENV === "production" && parsed.data.S3_ENDPOINT && new URL(parsed.data.S3_ENDPOINT).protocol !== "https:") {
    issues.push({
      code: z.ZodIssueCode.custom,
      path: ["S3_ENDPOINT"],
      message: "S3_ENDPOINT must use HTTPS in production",
    });
  }

  if (parsed.data.PHOTO_STORAGE_DRIVER === "s3") {
    for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (!parsed.data[key]) {
        issues.push({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when PHOTO_STORAGE_DRIVER=s3`,
        });
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(`Invalid environment configuration: ${formatIssues(issues)}`);
  }

  return {
    ...parsed.data,
    DATABASE_URL: parsed.data.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  };
}

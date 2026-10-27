import { expect, test } from "bun:test";
import { loadEnv } from "../src/config/env";

test("requires DATABASE_URL in production", () => {
  expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/DATABASE_URL is required in production/);
});

test("rejects wildcard CORS origins in production", () => {
  expect(() =>
    loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:password@example.com:5432/app",
      CORS_ALLOWED_ORIGINS: "*",
    }),
  ).toThrow(/Wildcard CORS origins are not allowed in production/);
});

test("keeps local defaults outside production", () => {
  const env = loadEnv({ NODE_ENV: "development" });

  expect(env.DATABASE_URL).toBe("postgres://vizaje:vizaje@localhost:5432/vizaje_staff");
  expect(env.CORS_ALLOWED_ORIGINS).toContain("http://localhost:3001");
  expect(env.PHOTO_STORAGE_DRIVER).toBe("local");
  expect(env.PHOTO_MAX_BYTES).toBe(10 * 1024 * 1024);
});

test("requires S3 photo storage configuration in production", () => {
  expect(() =>
    loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:password@example.com:5432/app",
      PHOTO_STORAGE_DRIVER: "local",
    }),
  ).toThrow(/S3 photo storage is required in production/);

  expect(() =>
    loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:password@example.com:5432/app",
      PHOTO_STORAGE_DRIVER: "s3",
    }),
  ).toThrow(/S3_BUCKET is required/);
});

test("rejects an insecure S3 endpoint in production", () => {
  expect(() =>
    loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:password@example.com:5432/app",
      PHOTO_STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "http://minio.example.com",
      S3_BUCKET: "photos",
      S3_ACCESS_KEY_ID: "access-key",
      S3_SECRET_ACCESS_KEY: "secret-key",
    }),
  ).toThrow(/S3_ENDPOINT must use HTTPS in production/);
});

import { describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";
import { createApp } from "../src/app";
import { noopLogger } from "../src/lib/logger";

function createTestApp(databaseResult: "success" | "failure" = "success") {
  const db = {
    execute: async () => {
      if (databaseResult === "failure") throw new Error("database down");
      return [{ ok: 1 }];
    },
  };

  return createApp({
    db,
    allowedOrigins: ["http://localhost:3001"],
    logger: noopLogger,
  });
}

describe("health endpoints", () => {
  test("returns liveness without requiring the database", async () => {
    const response = await createTestApp("failure").request("http://localhost/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      service: "api",
    });
  });

  test("returns readiness when the database responds", async () => {
    const response = await createTestApp().request("http://localhost/api/v1/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      database: "up",
    });
  });

  test("returns 503 when the database is unavailable", async () => {
    const response = await createTestApp("failure").request("http://localhost/api/v1/health");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Database is unavailable",
      },
    });
  });

  test("returns a consistent not-found error", async () => {
    const response = await createTestApp().request("http://localhost/missing");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });

  test("allows configured origins and handles preflight requests", async () => {
    const response = await createTestApp().request("http://localhost/health", {
      headers: {
        Origin: "http://localhost:3001",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-CSRF-Token",
      },
      method: "OPTIONS",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3001");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-headers")).toContain("X-CSRF-Token");
  });

  test("does not reflect disallowed origins", async () => {
    const response = await createTestApp().request("http://localhost/health", {
      headers: {
        Origin: "https://malicious.example",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("normalizes HTTP exceptions to the shared error contract", async () => {
    const app = createTestApp();
    app.get("/teapot", () => {
      throw new HTTPException(418, { message: "Teapot" });
    });

    const response = await app.request("http://localhost/teapot");

    expect(response.status).toBe(418);
    expect(await response.json()).toEqual({
      error: {
        code: "HTTP_ERROR",
        message: "Teapot",
      },
    });
  });

  test("does not expose unexpected internal error details", async () => {
    const app = createTestApp();
    app.get("/failure", () => {
      throw new Error("secret internal detail");
    });

    const response = await app.request("http://localhost/failure");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error",
      },
    });
  });

  test("blocks management HTTP requests without a trusted principal", async () => {
    const response = await createTestApp().request("http://localhost/api/v1/users", {
      headers: {
        "X-User-Id": "00000000-0000-0000-0000-000000000001",
        "X-Role": "admin",
      },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
      },
    });
  });
});

import { expect, test } from "bun:test";
import { createAuthService } from "../src/auth/service";
import { InMemoryRateLimiter } from "../src/auth/rate-limit";
import type { Database } from "../src/db/client";

test("login rate limiter blocks repeated failures and resets after success", () => {
  const limiter = new InMemoryRateLimiter({ maxAttempts: 2, windowMs: 1000, blockMs: 5000 });

  expect(limiter.isAllowed("email@example.com", 1000)).toBe(true);
  limiter.recordFailure("email@example.com", 1000);
  expect(limiter.isAllowed("email@example.com", 1001)).toBe(true);
  limiter.recordFailure("email@example.com", 1001);
  expect(limiter.isAllowed("email@example.com", 1002)).toBe(false);

  limiter.recordSuccess("email@example.com");
  expect(limiter.isAllowed("email@example.com", 1003)).toBe(true);
});

test("login rate limiter opens a new window after expiry", () => {
  const limiter = new InMemoryRateLimiter({ maxAttempts: 1, windowMs: 1000, blockMs: 1000 });

  limiter.recordFailure("email@example.com", 1000);
  expect(limiter.isAllowed("email@example.com", 2001)).toBe(true);
});

test("rate limiter bounds the number of retained keys", () => {
  const limiter = new InMemoryRateLimiter({ maxAttempts: 2, windowMs: 1000, blockMs: 1000, maxBuckets: 2 });

  limiter.recordFailure("first@example.com", 1000);
  limiter.recordFailure("second@example.com", 1000);
  limiter.recordFailure("third@example.com", 1000);

  const buckets = (limiter as unknown as { buckets: Map<string, unknown> }).buckets;
  expect(buckets.size).toBe(2);
});

test("blocked login keys fail before another database or password check", async () => {
  let selectCalls = 0;
  const db = {
    select: () => {
      selectCalls += 1;
      return {
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      };
    },
  } as unknown as Database;
  const auth = createAuthService(db, {
    loginRateLimiter: new InMemoryRateLimiter({ maxAttempts: 1, windowMs: 60_000, blockMs: 60_000 }),
  });

  await expect(auth.login({ email: "blocked@example.com", password: "wrong-password" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  await expect(auth.login({ email: "blocked@example.com", password: "wrong-password" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  expect(selectCalls).toBe(1);
});

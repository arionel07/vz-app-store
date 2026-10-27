import { expect, test } from "bun:test";
import { InMemoryRateLimiter } from "../src/auth/rate-limit";

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

interface RateLimitBucket {
  attempts: number;
  windowStartedAt: number;
  blockedUntil: number;
}

export interface RateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
  blockMs: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(private readonly options: RateLimiterOptions) {}

  isAllowed(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket) return true;
    if (bucket.blockedUntil > now) return false;
    if (now - bucket.windowStartedAt >= this.options.windowMs) {
      this.buckets.delete(key);
      return true;
    }
    return true;
  }

  recordFailure(key: string, now = Date.now()): void {
    const existing = this.buckets.get(key);
    const bucket =
      !existing || now - existing.windowStartedAt >= this.options.windowMs
        ? { attempts: 0, windowStartedAt: now, blockedUntil: 0 }
        : existing;

    bucket.attempts += 1;
    if (bucket.attempts >= this.options.maxAttempts) bucket.blockedUntil = now + this.options.blockMs;
    this.buckets.set(key, bucket);
  }

  recordSuccess(key: string): void {
    this.buckets.delete(key);
  }
}

export const defaultLoginRateLimiter = new InMemoryRateLimiter({
  maxAttempts: 5,
  windowMs: 60_000,
  blockMs: 5 * 60_000,
});

export const defaultActivationRateLimiter = new InMemoryRateLimiter({
  maxAttempts: 10,
  windowMs: 60_000,
  blockMs: 5 * 60_000,
});

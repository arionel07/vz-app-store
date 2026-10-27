interface RateLimitBucket {
  attempts: number;
  windowStartedAt: number;
  blockedUntil: number;
}

export interface RateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
  blockMs: number;
  maxBuckets?: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly maxBuckets: number;

  constructor(private readonly options: RateLimiterOptions) {
    this.maxBuckets = Math.max(1, options.maxBuckets ?? 10_000);
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.blockedUntil <= now && now - bucket.windowStartedAt >= this.options.windowMs) {
        this.buckets.delete(key);
      }
    }

    if (this.buckets.size < this.maxBuckets) return;

    let candidateKey: string | undefined;
    let candidatePriority = Number.POSITIVE_INFINITY;
    let candidateAge = Number.POSITIVE_INFINITY;

    for (const [key, bucket] of this.buckets) {
      const priority = bucket.blockedUntil > now ? 1 : 0;
      if (priority < candidatePriority || (priority === candidatePriority && bucket.windowStartedAt < candidateAge)) {
        candidateKey = key;
        candidatePriority = priority;
        candidateAge = bucket.windowStartedAt;
      }
    }

    if (candidateKey) this.buckets.delete(candidateKey);
  }

  isAllowed(key: string, now = Date.now()): boolean {
    this.prune(now);
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
    this.prune(now);
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

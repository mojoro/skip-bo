interface Bucket { tokens: number; lastRefill: number }

export interface RateLimitConfig { capacity: number; refillPerMs: number }

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly cfg: RateLimitConfig) {}

  take(key: string, now = Date.now()): boolean {
    const existing = this.buckets.get(key) ?? { tokens: this.cfg.capacity, lastRefill: now };
    const elapsed = now - existing.lastRefill;
    const refilled = Math.min(this.cfg.capacity, existing.tokens + elapsed * this.cfg.refillPerMs);
    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, lastRefill: now });
      return false;
    }
    this.buckets.set(key, { tokens: refilled - 1, lastRefill: now });
    return true;
  }
}

export const LIMITS = {
  createRoom: { capacity: 3, refillPerMs: 1 / 10_000 },
  join: { capacity: 5, refillPerMs: 5 / 10_000 },
  admin: { capacity: 10, refillPerMs: 10 / 10_000 },
  // Burst 10 and sustained 2/s per remote address for the WS upgrade path.
  // Rejected handshakes still cost a TCP + TLS + HTTP-upgrade round-trip;
  // absent this bucket a scripted attacker can force that work in a tight
  // loop to fish for a valid sessionId or just to burn CPU.
  gameUpgrade: { capacity: 10, refillPerMs: 2 / 1_000 },
} as const satisfies Record<string, RateLimitConfig>;

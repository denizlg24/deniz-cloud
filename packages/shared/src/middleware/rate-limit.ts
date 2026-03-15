import type { Context, MiddlewareHandler } from "hono";

interface RateLimitOptions {
  /** Time window in milliseconds */
  windowMs: number;
  /** Max requests per window per IP */
  max: number;
}

function getClientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

export function rateLimit({ windowMs, max }: RateLimitOptions): MiddlewareHandler {
  const hits = new Map<string, number[]>();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits) {
      const valid = timestamps.filter((t) => now - t < windowMs);
      if (valid.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, valid);
      }
    }
  }, windowMs);
  cleanup.unref();

  return async (c, next) => {
    const ip = getClientIp(c);
    const now = Date.now();
    const timestamps = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);

    if (timestamps.length >= max) {
      c.header("Retry-After", String(Math.ceil(windowMs / 1000)));
      return c.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests, try again later" } },
        429,
      );
    }

    timestamps.push(now);
    hits.set(ip, timestamps);

    await next();
  };
}

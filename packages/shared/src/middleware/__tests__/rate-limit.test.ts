import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { rateLimit } from "../rate-limit";

function createApp(opts: { windowMs: number; max: number }) {
  const app = new Hono();
  app.use("/*", rateLimit(opts));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

function withIp(ip: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: { ...init?.headers, "cf-connecting-ip": ip },
  };
}

describe("rateLimit", () => {
  test("allows requests under the limit", async () => {
    const app = createApp({ windowMs: 60_000, max: 3 });

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/test", withIp("1.2.3.4"));
      expect(res.status).toBe(200);
    }
  });

  test("blocks requests exceeding the limit", async () => {
    const app = createApp({ windowMs: 60_000, max: 2 });

    await app.request("/test", withIp("1.2.3.4"));
    await app.request("/test", withIp("1.2.3.4"));

    const blocked = await app.request("/test", withIp("1.2.3.4"));
    expect(blocked.status).toBe(429);

    const body = await blocked.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  test("sets Retry-After header on 429 response", async () => {
    const windowMs = 30_000;
    const app = createApp({ windowMs, max: 1 });

    await app.request("/test", withIp("1.2.3.4"));
    const blocked = await app.request("/test", withIp("1.2.3.4"));

    expect(blocked.headers.get("Retry-After")).toBe(String(Math.ceil(windowMs / 1000)));
  });

  test("tracks IPs independently", async () => {
    const app = createApp({ windowMs: 60_000, max: 1 });

    const res1 = await app.request("/test", withIp("10.0.0.1"));
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test", withIp("10.0.0.2"));
    expect(res2.status).toBe(200);

    const blocked = await app.request("/test", withIp("10.0.0.1"));
    expect(blocked.status).toBe(429);

    const stillAllowed = await app.request("/test", withIp("10.0.0.2"));
    expect(stillAllowed.status).toBe(429);
  });

  test("expires old requests outside the window", async () => {
    const app = createApp({ windowMs: 50, max: 1 });

    const res1 = await app.request("/test", withIp("1.1.1.1"));
    expect(res1.status).toBe(200);

    const blocked = await app.request("/test", withIp("1.1.1.1"));
    expect(blocked.status).toBe(429);

    await Bun.sleep(80);

    const res2 = await app.request("/test", withIp("1.1.1.1"));
    expect(res2.status).toBe(200);
  });

  test("concurrent requests from same IP respect the limit", async () => {
    const app = createApp({ windowMs: 60_000, max: 5 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => app.request("/test", withIp("5.5.5.5"))),
    );

    const ok = results.filter((r) => r.status === 200);
    const blocked = results.filter((r) => r.status === 429);

    expect(ok.length).toBe(5);
    expect(blocked.length).toBe(5);
  });
});

describe("IP extraction priority", () => {
  test("prefers cf-connecting-ip over other headers", async () => {
    const app = createApp({ windowMs: 60_000, max: 1 });

    const res = await app.request("/test", {
      headers: {
        "cf-connecting-ip": "1.1.1.1",
        "x-forwarded-for": "2.2.2.2, 3.3.3.3",
        "x-real-ip": "4.4.4.4",
      },
    });
    expect(res.status).toBe(200);

    // Same cf-connecting-ip should be blocked
    const blocked = await app.request("/test", {
      headers: {
        "cf-connecting-ip": "1.1.1.1",
        "x-forwarded-for": "9.9.9.9",
      },
    });
    expect(blocked.status).toBe(429);
  });

  test("falls back to x-forwarded-for first IP when no cf-connecting-ip", async () => {
    const app = createApp({ windowMs: 60_000, max: 1 });

    await app.request("/test", {
      headers: { "x-forwarded-for": "2.2.2.2, 3.3.3.3" },
    });

    const blocked = await app.request("/test", {
      headers: { "x-forwarded-for": "2.2.2.2, 8.8.8.8" },
    });
    expect(blocked.status).toBe(429);
  });

  test("falls back to x-real-ip when no cf-connecting-ip or x-forwarded-for", async () => {
    const app = createApp({ windowMs: 60_000, max: 1 });

    await app.request("/test", {
      headers: { "x-real-ip": "4.4.4.4" },
    });

    const blocked = await app.request("/test", {
      headers: { "x-real-ip": "4.4.4.4" },
    });
    expect(blocked.status).toBe(429);
  });

  test("uses 'unknown' when no IP headers are present", async () => {
    const app = createApp({ windowMs: 60_000, max: 1 });

    await app.request("/test");
    const blocked = await app.request("/test");
    expect(blocked.status).toBe(429);
  });
});

describe("rateLimit — sliding window behavior", () => {
  test("window slides correctly: old requests expire, new ones are counted", async () => {
    const app = createApp({ windowMs: 100, max: 2 });

    await app.request("/test", withIp("7.7.7.7"));
    await Bun.sleep(60);
    await app.request("/test", withIp("7.7.7.7"));

    // Both within window, at limit
    const blocked = await app.request("/test", withIp("7.7.7.7"));
    expect(blocked.status).toBe(429);

    // Wait for first request to expire
    await Bun.sleep(60);

    // First request expired, second still in window — count=1, under limit
    const allowed = await app.request("/test", withIp("7.7.7.7"));
    expect(allowed.status).toBe(200);
  });

  test("max=0 blocks all requests", async () => {
    const app = createApp({ windowMs: 60_000, max: 0 });
    const res = await app.request("/test", withIp("1.1.1.1"));
    expect(res.status).toBe(429);
  });
});

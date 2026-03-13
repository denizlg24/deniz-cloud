import { describe, expect, test } from "bun:test";
import { signSessionToken, verifySessionToken } from "../jwt";

const SECRET = "test-jwt-secret-at-least-32-chars-long";

describe("JWT — edge cases", () => {
  test("rejects completely garbage input", async () => {
    await expect(verifySessionToken("not.a.jwt", SECRET)).rejects.toThrow();
    await expect(verifySessionToken("", SECRET)).rejects.toThrow();
    await expect(verifySessionToken("aaa", SECRET)).rejects.toThrow();
  });

  test("rejects valid JWT with wrong algorithm", async () => {
    // Create a token with 'none' algorithm — this should be rejected
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "user-1",
        role: "user",
        sid: "sess-1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    const noneToken = `${header}.${payload}.`;
    await expect(verifySessionToken(noneToken, SECRET)).rejects.toThrow();
  });

  test("handles sub with special characters", async () => {
    const payload = {
      sub: "user-with-special-chars_123/abc",
      role: "user" as const,
      sid: "sess-1",
    };
    const token = await signSessionToken(payload, SECRET);
    const verified = await verifySessionToken(token, SECRET);
    expect(verified.sub).toBe(payload.sub);
  });

  test("preserves exact UUIDs through sign/verify cycle", async () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const sessionId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const token = await signSessionToken(
      { sub: userId, role: "superuser", sid: sessionId },
      SECRET,
    );
    const verified = await verifySessionToken(token, SECRET);
    expect(verified.sub).toBe(userId);
    expect(verified.sid).toBe(sessionId);
  });

  test("different secrets produce different tokens for same payload", async () => {
    const payload = { sub: "user-1", role: "user" as const, sid: "sess-1" };
    const token1 = await signSessionToken(payload, "secret-one-that-is-long-enough");
    const token2 = await signSessionToken(payload, "secret-two-that-is-long-enough");
    expect(token1).not.toBe(token2);
  });

  test("rejects token with valid structure but invalid role", async () => {
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(SECRET);
    const token = await new SignJWT({ role: "admin", sid: "sess-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime("1h")
      .sign(key);

    await expect(verifySessionToken(token, SECRET)).rejects.toThrow("Invalid token: invalid role");
  });

  test("rejects token without subject", async () => {
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(SECRET);
    const token = await new SignJWT({ role: "user", sid: "sess-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(key);

    await expect(verifySessionToken(token, SECRET)).rejects.toThrow("missing subject");
  });

  test("rejects token without session ID", async () => {
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(SECRET);
    const token = await new SignJWT({ role: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime("1h")
      .sign(key);

    await expect(verifySessionToken(token, SECRET)).rejects.toThrow("missing session ID");
  });

  test("expiration times work correctly", async () => {
    // 1 second expiry
    const payload = { sub: "user-1", role: "user" as const, sid: "sess-1" };
    const token = await signSessionToken(payload, SECRET, "1s");
    // Should verify immediately
    const verified = await verifySessionToken(token, SECRET);
    expect(verified.sub).toBe("user-1");

    // Wait for expiry
    await Bun.sleep(1100);
    await expect(verifySessionToken(token, SECRET)).rejects.toThrow();
  });

  test("various duration formats work", async () => {
    const payload = { sub: "user-1", role: "user" as const, sid: "sess-1" };

    // These should not throw — valid jose duration formats
    await signSessionToken(payload, SECRET, "30s");
    await signSessionToken(payload, SECRET, "5m");
    await signSessionToken(payload, SECRET, "2h");
    await signSessionToken(payload, SECRET, "7d");
  });

  test("concurrent sign operations are safe", async () => {
    const payloads = Array.from({ length: 50 }, (_, i) => ({
      sub: `user-${i}`,
      role: "user" as const,
      sid: `sess-${i}`,
    }));

    const tokens = await Promise.all(payloads.map((p) => signSessionToken(p, SECRET)));

    // All tokens should be unique
    const unique = new Set(tokens);
    expect(unique.size).toBe(50);

    // All should verify correctly with matching payloads
    const verified = await Promise.all(tokens.map((t) => verifySessionToken(t, SECRET)));
    for (let i = 0; i < 50; i++) {
      expect(verified[i]?.sub).toBe(`user-${i}`);
      expect(verified[i]?.sid).toBe(`sess-${i}`);
    }
  });

  test("token is a valid 3-part JWT structure", async () => {
    const payload = { sub: "user-1", role: "user" as const, sid: "sess-1" };
    const token = await signSessionToken(payload, SECRET);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    // Each part should be base64url encoded
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    // Header should decode to { alg: "HS256" }
    const headerPart = parts[0];
    if (!headerPart) throw new Error("Missing header part");
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
    expect(header.alg).toBe("HS256");
  });

  test("short secret still works (but is insecure)", async () => {
    const payload = { sub: "user-1", role: "user" as const, sid: "sess-1" };
    const shortSecret = "ab";
    const token = await signSessionToken(payload, shortSecret);
    const verified = await verifySessionToken(token, shortSecret);
    expect(verified.sub).toBe("user-1");
  });
});

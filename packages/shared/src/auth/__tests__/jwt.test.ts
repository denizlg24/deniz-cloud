import { describe, expect, test } from "bun:test";
import { signSessionToken, verifySessionToken } from "../jwt";

const SECRET = "test-jwt-secret-at-least-32-chars-long";

describe("JWT", () => {
  test("sign and verify round-trip", async () => {
    const payload = { sub: "user-123", role: "user" as const, sid: "session-456" };
    const token = await signSessionToken(payload, SECRET);

    expect(token).toBeString();
    expect(token.split(".")).toHaveLength(3);

    const verified = await verifySessionToken(token, SECRET);
    expect(verified.sub).toBe("user-123");
    expect(verified.role).toBe("user");
    expect(verified.sid).toBe("session-456");
  });

  test("works with superuser role", async () => {
    const payload = { sub: "admin-1", role: "superuser" as const, sid: "sess-1" };
    const token = await signSessionToken(payload, SECRET);
    const verified = await verifySessionToken(token, SECRET);
    expect(verified.role).toBe("superuser");
  });

  test("rejects token signed with different secret", async () => {
    const payload = { sub: "user-1", role: "user" as const, sid: "sess-1" };
    const token = await signSessionToken(payload, SECRET);
    await expect(verifySessionToken(token, "different-secret")).rejects.toThrow();
  });

  test("rejects expired token", async () => {
    const payload = { sub: "user-1", role: "user" as const, sid: "sess-1" };
    const token = await signSessionToken(payload, SECRET, "0s");
    // Token expires immediately
    await Bun.sleep(10);
    await expect(verifySessionToken(token, SECRET)).rejects.toThrow();
  });

  test("rejects tampered token", async () => {
    const payload = { sub: "user-1", role: "user" as const, sid: "sess-1" };
    const token = await signSessionToken(payload, SECRET);
    const tampered = `${token.slice(0, -5)}XXXXX`;
    await expect(verifySessionToken(tampered, SECRET)).rejects.toThrow();
  });

  test("rejects token with missing fields", async () => {
    // Manually create a JWT without the required fields via jose
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(SECRET);
    const badToken = await new SignJWT({ foo: "bar" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(key);

    await expect(verifySessionToken(badToken, SECRET)).rejects.toThrow("Invalid token");
  });
});

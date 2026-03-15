import { describe, expect, test } from "bun:test";
import { generateShareToken, isValidExpiresIn, verifyShareToken } from "../share";

const SECRET = "test-jwt-secret-key-for-share-tokens";

describe("generateShareToken", () => {
  test("produces a token with three dot-separated parts", () => {
    const token = generateShareToken("file-123", "30m", SECRET);
    const parts = token.split(".");
    expect(parts.length).toBe(3);
  });

  test("first part is the fileId", () => {
    const token = generateShareToken("abc-def", "1d", SECRET);
    expect(token.startsWith("abc-def.")).toBe(true);
  });

  test("second part is a numeric expiresAt timestamp for timed tokens", () => {
    const before = Date.now();
    const token = generateShareToken("file-1", "30m", SECRET);
    const after = Date.now();
    // biome-ignore lint/style/noNonNullAssertion: we know the format is correct from previous tests
    const expiresAt = parseInt(token.split(".")[1]!, 10);
    const expected30m = 30 * 60 * 1000;

    expect(expiresAt).toBeGreaterThanOrEqual(before + expected30m);
    expect(expiresAt).toBeLessThanOrEqual(after + expected30m);
  });

  test("expiresAt is 0 for 'never' expiration", () => {
    const token = generateShareToken("file-1", "never", SECRET);
    const expiresAt = token.split(".")[1];
    expect(expiresAt).toBe("0");
  });

  test("third part is a 64-char hex HMAC signature", () => {
    const token = generateShareToken("file-1", "1d", SECRET);
    // biome-ignore lint/style/noNonNullAssertion: we know the format is correct from previous tests
    const sig = token.split(".")[2]!;
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different secrets produce different signatures", () => {
    const t1 = generateShareToken("file-1", "1d", "secret-a");
    const t2 = generateShareToken("file-1", "1d", "secret-b");

    expect(t1.split(".")[2]).not.toBe(t2.split(".")[2]);
  });

  test("different fileIds produce different signatures", () => {
    const t1 = generateShareToken("file-1", "1d", SECRET);
    const t2 = generateShareToken("file-2", "1d", SECRET);

    expect(t1.split(".")[2]).not.toBe(t2.split(".")[2]);
  });
});

describe("verifyShareToken", () => {
  test("verifies a valid non-expired token", () => {
    const token = generateShareToken("file-abc", "7d", SECRET);
    const payload = verifyShareToken(token, SECRET);

    expect(payload).not.toBeNull();
    expect(payload?.fileId).toBe("file-abc");
    expect(payload?.expiresAt).toBeGreaterThan(Date.now());
  });

  test("verifies a 'never' expiring token", () => {
    const token = generateShareToken("file-xyz", "never", SECRET);
    const payload = verifyShareToken(token, SECRET);

    expect(payload).not.toBeNull();
    expect(payload?.fileId).toBe("file-xyz");
    expect(payload?.expiresAt).toBe(0);
  });

  test("rejects token with wrong secret", () => {
    const token = generateShareToken("file-1", "1d", "correct-secret");
    expect(verifyShareToken(token, "wrong-secret")).toBeNull();
  });

  test("rejects expired token", () => {
    const fileId = "file-1";
    const pastExpiry = Date.now() - 1000;
    const { createHmac } = require("node:crypto");
    const key = createHmac("sha256", SECRET).update("dc-share-link").digest("hex");
    const sig = createHmac("sha256", key).update(`${fileId}:${pastExpiry}`).digest("hex");
    const expiredToken = `${fileId}.${pastExpiry}.${sig}`;

    expect(verifyShareToken(expiredToken, SECRET)).toBeNull();
  });

  test("rejects token with tampered fileId", () => {
    const token = generateShareToken("file-1", "1d", SECRET);
    const parts = token.split(".");
    const tampered = `file-HACKED.${parts[1]}.${parts[2]}`;

    expect(verifyShareToken(tampered, SECRET)).toBeNull();
  });

  test("rejects token with tampered expiresAt", () => {
    const token = generateShareToken("file-1", "1d", SECRET);
    const parts = token.split(".");
    const futureExpiry = Date.now() + 999_999_999;
    const tampered = `${parts[0]}.${futureExpiry}.${parts[2]}`;

    expect(verifyShareToken(tampered, SECRET)).toBeNull();
  });

  test("rejects token with tampered signature", () => {
    const token = generateShareToken("file-1", "1d", SECRET);
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${"a".repeat(64)}`;

    expect(verifyShareToken(tampered, SECRET)).toBeNull();
  });

  test("rejects malformed tokens", () => {
    expect(verifyShareToken("", SECRET)).toBeNull();
    expect(verifyShareToken("single-part", SECRET)).toBeNull();
    expect(verifyShareToken("two.parts", SECRET)).toBeNull();
    expect(verifyShareToken("four.parts.are.invalid", SECRET)).toBeNull();
  });

  test("rejects token with non-numeric expiresAt", () => {
    expect(
      verifyShareToken(
        "file-1.notanumber.abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        SECRET,
      ),
    ).toBeNull();
  });

  test("rejects token with wrong-length signature", () => {
    const token = generateShareToken("file-1", "1d", SECRET);
    const parts = token.split(".");
    const shortSig = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, 10)}`;

    expect(verifyShareToken(shortSig, SECRET)).toBeNull();
  });

  test("constant-time comparison: token with correct length but wrong value is rejected", () => {
    const token = generateShareToken("file-1", "1d", SECRET);
    const parts = token.split(".");
    // biome-ignore lint/style/noNonNullAssertion: we know the format is correct from previous tests
    const sig = parts[2]!;
    // Flip one character in the signature
    const flipped = sig[0] === "a" ? `b${sig.slice(1)}` : `a${sig.slice(1)}`;
    const tampered = `${parts[0]}.${parts[1]}.${flipped}`;

    expect(verifyShareToken(tampered, SECRET)).toBeNull();
  });

  test("roundtrip: generate then verify for all expiration types", () => {
    const expirations = ["30m", "1d", "7d", "30d", "never"] as const;

    for (const exp of expirations) {
      const token = generateShareToken("roundtrip-file", exp, SECRET);
      const payload = verifyShareToken(token, SECRET);
      expect(payload).not.toBeNull();
      expect(payload?.fileId).toBe("roundtrip-file");
    }
  });
});

describe("isValidExpiresIn", () => {
  test("accepts valid expiration values", () => {
    expect(isValidExpiresIn("30m")).toBe(true);
    expect(isValidExpiresIn("1d")).toBe(true);
    expect(isValidExpiresIn("7d")).toBe(true);
    expect(isValidExpiresIn("30d")).toBe(true);
    expect(isValidExpiresIn("never")).toBe(true);
  });

  test("rejects invalid expiration values", () => {
    expect(isValidExpiresIn("1h")).toBe(false);
    expect(isValidExpiresIn("60s")).toBe(false);
    expect(isValidExpiresIn("")).toBe(false);
    expect(isValidExpiresIn("forever")).toBe(false);
    expect(isValidExpiresIn("2d")).toBe(false);
    expect(isValidExpiresIn("30M")).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { generateRecoveryCodes, hashRecoveryCode, verifyRecoveryCode } from "../recovery";

describe("recovery codes — edge cases", () => {
  test("generateRecoveryCodes(0) returns empty array", () => {
    const codes = generateRecoveryCodes(0);
    expect(codes).toHaveLength(0);
  });

  test("generateRecoveryCodes(1) returns single code", () => {
    const codes = generateRecoveryCodes(1);
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  test("large batch of codes are all unique", () => {
    // Generate a large set to test for collisions
    const codes = generateRecoveryCodes(1000);
    const unique = new Set(codes);
    expect(unique.size).toBe(1000);
  });

  test("codes are always exactly 9 characters (XXXX-XXXX)", () => {
    const codes = generateRecoveryCodes(100);
    for (const code of codes) {
      expect(code.length).toBe(9);
    }
  });

  test("hashRecoveryCode is deterministic", () => {
    const hash1 = hashRecoveryCode("ABCD-1234");
    const hash2 = hashRecoveryCode("ABCD-1234");
    expect(hash1).toBe(hash2);
  });

  test("hashRecoveryCode handles codes without hyphens", () => {
    const hashWithHyphen = hashRecoveryCode("ABCD-1234");
    const hashWithout = hashRecoveryCode("ABCD1234");
    expect(hashWithHyphen).toBe(hashWithout);
  });

  test("hashRecoveryCode handles lowercase input", () => {
    const upper = hashRecoveryCode("ABCD-1234");
    const lower = hashRecoveryCode("abcd-1234");
    const mixed = hashRecoveryCode("AbCd-1234");
    expect(upper).toBe(lower);
    expect(upper).toBe(mixed);
  });

  test("hashRecoveryCode handles extra hyphens", () => {
    // Multiple hyphens are stripped — but this creates a different normalized value
    const normal = hashRecoveryCode("ABCD-1234");
    const extraHyphen = hashRecoveryCode("AB-CD-12-34");
    // After stripping hyphens both normalize to ABCD1234
    expect(normal).toBe(extraHyphen);
  });

  test("hash output is always 64 hex characters (SHA-256)", () => {
    const codes = generateRecoveryCodes(50);
    for (const code of codes) {
      const hash = hashRecoveryCode(code);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("verifyRecoveryCode rejects similar but different code", () => {
    const hash = hashRecoveryCode("ABCD-1234");
    // Change one character
    expect(verifyRecoveryCode("ABCD-1235", hash)).toBe(false);
    expect(verifyRecoveryCode("ABCE-1234", hash)).toBe(false);
  });

  test("verifyRecoveryCode handles empty code", () => {
    const hash = hashRecoveryCode("ABCD-1234");
    expect(verifyRecoveryCode("", hash)).toBe(false);
  });

  test("each generated code verifies against its own hash", () => {
    const codes = generateRecoveryCodes(100);
    const hashes = codes.map(hashRecoveryCode);

    // Each code should only verify against its own hash
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      const hash = hashes[i];
      if (!code || !hash) throw new Error(`Missing code/hash at index ${i}`);
      expect(verifyRecoveryCode(code, hash)).toBe(true);
      // Check it doesn't match the next hash
      const nextHash = hashes[i + 1];
      if (i + 1 < codes.length && nextHash) {
        expect(verifyRecoveryCode(code, nextHash)).toBe(false);
      }
    }
  });

  test("concurrent code generation produces distinct sets", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => Promise.resolve(generateRecoveryCodes(10))),
    );

    // Flatten all codes
    const allCodes = results.flat();
    // All 100 codes should be unique (extremely high probability)
    const unique = new Set(allCodes);
    expect(unique.size).toBe(100);
  });
});

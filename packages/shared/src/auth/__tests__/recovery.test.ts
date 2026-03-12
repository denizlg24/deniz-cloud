import { describe, expect, test } from "bun:test";
import { generateRecoveryCodes, hashRecoveryCode, verifyRecoveryCode } from "../recovery";

describe("recovery codes", () => {
  describe("generateRecoveryCodes", () => {
    test("generates 10 codes by default", () => {
      const codes = generateRecoveryCodes();
      expect(codes).toHaveLength(10);
    });

    test("generates custom number of codes", () => {
      const codes = generateRecoveryCodes(5);
      expect(codes).toHaveLength(5);
    });

    test("codes follow XXXX-XXXX format", () => {
      const codes = generateRecoveryCodes();
      for (const code of codes) {
        expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
      }
    });

    test("codes are unique", () => {
      const codes = generateRecoveryCodes(100);
      const unique = new Set(codes);
      expect(unique.size).toBe(100);
    });
  });

  describe("hashRecoveryCode", () => {
    test("produces a hex hash", () => {
      const hash = hashRecoveryCode("ABCD-1234");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test("is case-insensitive", () => {
      const hash1 = hashRecoveryCode("abcd-1234");
      const hash2 = hashRecoveryCode("ABCD-1234");
      expect(hash1).toBe(hash2);
    });

    test("ignores hyphens", () => {
      const hash1 = hashRecoveryCode("ABCD-1234");
      const hash2 = hashRecoveryCode("ABCD1234");
      expect(hash1).toBe(hash2);
    });
  });

  describe("verifyRecoveryCode", () => {
    test("returns true for matching code", () => {
      const code = "ABCD-1234";
      const hash = hashRecoveryCode(code);
      expect(verifyRecoveryCode(code, hash)).toBe(true);
    });

    test("returns false for non-matching code", () => {
      const hash = hashRecoveryCode("ABCD-1234");
      expect(verifyRecoveryCode("XXXX-9999", hash)).toBe(false);
    });

    test("verifies generated codes", () => {
      const codes = generateRecoveryCodes();
      for (const code of codes) {
        const hash = hashRecoveryCode(code);
        expect(verifyRecoveryCode(code, hash)).toBe(true);
      }
    });
  });
});

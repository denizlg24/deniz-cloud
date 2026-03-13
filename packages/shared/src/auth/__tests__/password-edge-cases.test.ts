import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "../password";

describe("password — edge cases", () => {
  test("rejects empty string password", async () => {
    // Bun.password.hash throws for empty strings — this is desirable behavior
    await expect(hashPassword("")).rejects.toThrow();
  });

  test("handles very long password (10KB)", async () => {
    const longPassword = "a".repeat(10_000);
    const hash = await hashPassword(longPassword);
    expect(await verifyPassword(longPassword, hash)).toBe(true);
    expect(await verifyPassword(`${longPassword}x`, hash)).toBe(false);
  });

  test("handles unicode characters", async () => {
    const unicodePassword = "\u{1F4A9}\u{1F525}p\u00E4ssw\u00F6rd\u{1F600}";
    const hash = await hashPassword(unicodePassword);
    expect(await verifyPassword(unicodePassword, hash)).toBe(true);
    // Different unicode normalization should fail
    expect(await verifyPassword("p\u00E4ssw\u00F6rd", hash)).toBe(false);
  });

  test("handles password with null bytes", async () => {
    const nullPassword = "before\0after";
    const hash = await hashPassword(nullPassword);
    expect(await verifyPassword(nullPassword, hash)).toBe(true);
    // Truncation at null byte should fail
    expect(await verifyPassword("before", hash)).toBe(false);
  });

  test("handles password with only whitespace", async () => {
    const spacePassword = "   \t\n  ";
    const hash = await hashPassword(spacePassword);
    expect(await verifyPassword(spacePassword, hash)).toBe(true);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  test("verifyPassword rejects malformed hash", async () => {
    await expect(verifyPassword("password", "not-a-valid-hash")).rejects.toThrow();
  });

  test("verifyPassword returns false for empty hash", async () => {
    // Bun.password.verify returns false for invalid/empty hashes
    expect(await verifyPassword("password", "")).toBe(false);
  });

  test("concurrent hashing produces distinct results", async () => {
    const password = "concurrent-test";
    const results = await Promise.all(Array.from({ length: 10 }, () => hashPassword(password)));
    const unique = new Set(results);
    // All 10 hashes should be different (unique salts)
    expect(unique.size).toBe(10);
    // All should verify correctly
    for (const hash of results) {
      expect(await verifyPassword(password, hash)).toBe(true);
    }
  });

  test("hash output contains algorithm parameters", async () => {
    const hash = await hashPassword("test");
    // argon2id hash format: $argon2id$v=19$m=...,t=...,p=...$salt$hash
    expect(hash).toMatch(/\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$/);
  });

  test("timing: verification of wrong password takes similar time as correct", async () => {
    const hash = await hashPassword("correct-password");
    const iterations = 5;
    let correctTotal = 0;
    let wrongTotal = 0;

    for (let i = 0; i < iterations; i++) {
      const start1 = performance.now();
      await verifyPassword("correct-password", hash);
      correctTotal += performance.now() - start1;

      const start2 = performance.now();
      await verifyPassword("wrong-password-xxxxx", hash);
      wrongTotal += performance.now() - start2;
    }

    const avgCorrect = correctTotal / iterations;
    const avgWrong = wrongTotal / iterations;

    // Times should be within the same order of magnitude (constant-time comparison)
    // Allow generous margin since this is not a cryptographic timing test
    expect(avgWrong).toBeGreaterThan(avgCorrect * 0.2);
    expect(avgWrong).toBeLessThan(avgCorrect * 5);
  });
});

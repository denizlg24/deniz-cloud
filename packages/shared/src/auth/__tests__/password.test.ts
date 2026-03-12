import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "../password";

describe("password", () => {
  test("hashPassword returns an argon2id hash", async () => {
    const hash = await hashPassword("test-password-123");
    expect(hash).toStartWith("$argon2id$");
  });

  test("verifyPassword returns true for correct password", async () => {
    const hash = await hashPassword("correct-password");
    const result = await verifyPassword("correct-password", hash);
    expect(result).toBe(true);
  });

  test("verifyPassword returns false for wrong password", async () => {
    const hash = await hashPassword("correct-password");
    const result = await verifyPassword("wrong-password", hash);
    expect(result).toBe(false);
  });

  test("different passwords produce different hashes", async () => {
    const hash1 = await hashPassword("password-one");
    const hash2 = await hashPassword("password-two");
    expect(hash1).not.toBe(hash2);
  });

  test("same password produces different hashes (salted)", async () => {
    const hash1 = await hashPassword("same-password");
    const hash2 = await hashPassword("same-password");
    expect(hash1).not.toBe(hash2);
  });
});

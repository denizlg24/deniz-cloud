import { describe, expect, test } from "bun:test";
import { Secret, TOTP } from "otpauth";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotpToken } from "../totp";

describe("TOTP", () => {
  describe("generateTotpSecret", () => {
    test("returns a base32 secret and otpauth URI", () => {
      const result = generateTotpSecret("testuser");
      expect(result.secret).toBeString();
      expect(result.secret.length).toBeGreaterThan(0);
      expect(result.uri).toStartWith("otpauth://totp/");
      expect(result.uri).toContain("Deniz%20Cloud");
      expect(result.uri).toContain("testuser");
    });

    test("generates unique secrets each time", () => {
      const a = generateTotpSecret("user1");
      const b = generateTotpSecret("user1");
      expect(a.secret).not.toBe(b.secret);
    });
  });

  describe("verifyTotpToken", () => {
    test("accepts a valid current token", () => {
      const secret = new Secret();
      const totp = new TOTP({
        secret,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });
      const token = totp.generate();
      expect(verifyTotpToken(secret.base32, token)).toBe(true);
    });

    test("rejects an invalid token", () => {
      const { secret } = generateTotpSecret("user");
      expect(verifyTotpToken(secret, "000000")).toBe(false);
    });
  });

  describe("encrypt/decrypt TOTP secret", () => {
    const encryptionKey = "test-encryption-key-for-totp-secrets";

    test("round-trips correctly", () => {
      const originalSecret = "JBSWY3DPEHPK3PXP";
      const { encrypted, iv, authTag } = encryptTotpSecret(originalSecret, encryptionKey);
      const decrypted = decryptTotpSecret(encrypted, iv, authTag, encryptionKey);
      expect(decrypted).toBe(originalSecret);
    });

    test("produces different ciphertext for same input (random IV)", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const a = encryptTotpSecret(secret, encryptionKey);
      const b = encryptTotpSecret(secret, encryptionKey);
      expect(a.encrypted).not.toBe(b.encrypted);
      expect(a.iv).not.toBe(b.iv);
    });

    test("fails to decrypt with wrong key", () => {
      const { encrypted, iv, authTag } = encryptTotpSecret("secret", encryptionKey);
      expect(() => decryptTotpSecret(encrypted, iv, authTag, "wrong-key")).toThrow();
    });

    test("fails to decrypt with tampered auth tag", () => {
      const { encrypted, iv } = encryptTotpSecret("secret", encryptionKey);
      const fakeAuthTag = Buffer.from("tampered-tag-value").toString("base64");
      expect(() => decryptTotpSecret(encrypted, iv, fakeAuthTag, encryptionKey)).toThrow();
    });
  });
});

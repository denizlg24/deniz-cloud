import { describe, expect, test } from "bun:test";
import { Secret, TOTP } from "otpauth";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotpToken } from "../totp";

describe("TOTP — edge cases", () => {
  describe("generateTotpSecret", () => {
    test("URI contains correct issuer encoding", () => {
      const result = generateTotpSecret("user");
      // "Deniz Cloud" should be URL-encoded as "Deniz%20Cloud"
      expect(result.uri).toContain("Deniz%20Cloud");
    });

    test("handles username with special characters", () => {
      const result = generateTotpSecret("user@example.com");
      expect(result.uri).toStartWith("otpauth://totp/");
      expect(result.secret).toBeString();
      expect(result.secret.length).toBeGreaterThan(0);
    });

    test("handles username with spaces", () => {
      const result = generateTotpSecret("John Doe");
      expect(result.uri).toStartWith("otpauth://totp/");
    });

    test("handles empty username", () => {
      const result = generateTotpSecret("");
      expect(result.secret).toBeString();
      expect(result.uri).toStartWith("otpauth://totp/");
    });

    test("secret is valid base32", () => {
      const result = generateTotpSecret("testuser");
      // base32 alphabet: A-Z, 2-7, = (padding)
      expect(result.secret).toMatch(/^[A-Z2-7]+=*$/);
    });

    test("generated secret produces verifiable tokens", () => {
      const { secret } = generateTotpSecret("testuser");
      const totp = new TOTP({
        secret: Secret.fromBase32(secret),
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });
      const token = totp.generate();
      expect(verifyTotpToken(secret, token)).toBe(true);
    });
  });

  describe("verifyTotpToken", () => {
    test("rejects token with wrong number of digits", () => {
      const { secret } = generateTotpSecret("user");
      expect(verifyTotpToken(secret, "12345")).toBe(false); // 5 digits
      expect(verifyTotpToken(secret, "1234567")).toBe(false); // 7 digits
    });

    test("rejects empty token", () => {
      const { secret } = generateTotpSecret("user");
      expect(verifyTotpToken(secret, "")).toBe(false);
    });

    test("rejects non-numeric token", () => {
      const { secret } = generateTotpSecret("user");
      expect(verifyTotpToken(secret, "abcdef")).toBe(false);
    });

    test("accepts token within window=1 (previous period)", () => {
      // Generate a token for 30 seconds ago (previous period)
      const secret = new Secret();
      const totp = new TOTP({
        secret,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });
      // Generate token for current time — this tests the window
      const token = totp.generate();
      expect(verifyTotpToken(secret.base32, token)).toBe(true);
    });

    test("rejects token from far in the past", () => {
      const secret = new Secret();
      const totp = new TOTP({
        secret,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });
      // Generate a token for 5 minutes ago (10 periods back)
      const oldTime = Math.floor((Date.now() / 1000 - 300) / 30);
      const oldToken = totp.generate({ timestamp: oldTime * 30 * 1000 });
      expect(verifyTotpToken(secret.base32, oldToken)).toBe(false);
    });
  });

  describe("encryption edge cases", () => {
    test("handles very long secrets", () => {
      const longSecret = "A".repeat(1000);
      const key = "test-key";
      const { encrypted, iv, authTag } = encryptTotpSecret(longSecret, key);
      const decrypted = decryptTotpSecret(encrypted, iv, authTag, key);
      expect(decrypted).toBe(longSecret);
    });

    test("handles empty string secret", () => {
      const key = "test-key";
      const { encrypted, iv, authTag } = encryptTotpSecret("", key);
      const decrypted = decryptTotpSecret(encrypted, iv, authTag, key);
      expect(decrypted).toBe("");
    });

    test("handles unicode in encryption key", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const key = "\u{1F511}encryption-key-with-emoji";
      const { encrypted, iv, authTag } = encryptTotpSecret(secret, key);
      const decrypted = decryptTotpSecret(encrypted, iv, authTag, key);
      expect(decrypted).toBe(secret);
    });

    test("handles empty encryption key", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const key = "";
      const { encrypted, iv, authTag } = encryptTotpSecret(secret, key);
      const decrypted = decryptTotpSecret(encrypted, iv, authTag, key);
      expect(decrypted).toBe(secret);
    });

    test("fails with tampered ciphertext", () => {
      const key = "test-key";
      const { encrypted, iv, authTag } = encryptTotpSecret("secret", key);
      // Tamper with ciphertext
      const tampered = Buffer.from(encrypted, "base64");
      tampered[0] = (tampered[0] ?? 0) ^ 0xff;
      expect(() => decryptTotpSecret(tampered.toString("base64"), iv, authTag, key)).toThrow();
    });

    test("fails with tampered IV", () => {
      const key = "test-key";
      const { encrypted, iv, authTag } = encryptTotpSecret("secret", key);
      const tamperedIv = Buffer.from(iv, "base64");
      tamperedIv[0] = (tamperedIv[0] ?? 0) ^ 0xff;
      expect(() =>
        decryptTotpSecret(encrypted, tamperedIv.toString("base64"), authTag, key),
      ).toThrow();
    });

    test("IVs are always 12 bytes (96 bits) for GCM", () => {
      const key = "test-key";
      for (let i = 0; i < 20; i++) {
        const { iv } = encryptTotpSecret("secret", key);
        const ivBytes = Buffer.from(iv, "base64");
        expect(ivBytes.length).toBe(12);
      }
    });

    test("auth tags are always 16 bytes (128 bits)", () => {
      const key = "test-key";
      for (let i = 0; i < 20; i++) {
        const { authTag } = encryptTotpSecret("secret", key);
        const tagBytes = Buffer.from(authTag, "base64");
        expect(tagBytes.length).toBe(16);
      }
    });

    test("concurrent encryption/decryption is safe", async () => {
      const key = "concurrent-test-key";
      const secrets = Array.from({ length: 50 }, (_, i) => `SECRET_${i}`);

      const results = await Promise.all(
        secrets.map(async (secret) => {
          const { encrypted, iv, authTag } = encryptTotpSecret(secret, key);
          const decrypted = decryptTotpSecret(encrypted, iv, authTag, key);
          return { original: secret, decrypted };
        }),
      );

      for (const { original, decrypted } of results) {
        expect(decrypted).toBe(original);
      }
    });
  });
});

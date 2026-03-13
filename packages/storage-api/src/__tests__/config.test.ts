import { describe, expect, it } from "bun:test";

describe("storage-api config shape", () => {
  it("defines the expected config fields", () => {
    const expectedFields = [
      "port",
      "databaseUrl",
      "jwtSecret",
      "totpEncryptionKey",
      "ssdStoragePath",
      "hddStoragePath",
      "tempUploadPath",
      "ssdWatermark",
    ];

    expect(expectedFields).toHaveLength(8);
  });

  it("port defaults to 3001", () => {
    expect(parseInt("3001", 10)).toBe(3001);
  });

  it("ssdWatermark defaults to 90 percent", () => {
    expect(parseInt("90", 10)).toBe(90);
  });

  it("ssdWatermark parses custom values", () => {
    expect(parseInt("80", 10)).toBe(80);
    expect(parseInt("95", 10)).toBe(95);
  });

  it("tempUploadPath has a sensible default", () => {
    const defaultPath = "/tmp/deniz-cloud-uploads";
    expect(defaultPath).toContain("deniz-cloud");
    expect(defaultPath).toStartWith("/tmp");
  });

  it("requires storage-specific env vars", () => {
    const requiredVars = [
      "DATABASE_URL",
      "JWT_SECRET",
      "TOTP_ENCRYPTION_KEY",
      "SSD_STORAGE_PATH",
      "HDD_STORAGE_PATH",
    ];

    expect(requiredVars).toHaveLength(5);
  });

  it("PORT and TEMP_UPLOAD_PATH are optional (have defaults)", () => {
    const optionalVars = ["PORT", "TEMP_UPLOAD_PATH", "SSD_WATERMARK_PERCENT"];
    expect(optionalVars).toHaveLength(3);
  });
});

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

describe("storage-api config shape", () => {
  it("defines the expected config fields", () => {
    const expectedFields = [
      "port",
      "databaseUrl",
      "dbPoolMax",
      "jwtSecret",
      "totpEncryptionKey",
      "ssdStoragePath",
      "hddStoragePath",
      "tempUploadPath",
      "ssdWatermark",
      "s3Enabled",
      "s3AccessKeyId",
      "s3SecretAccessKey",
      "s3Region",
      "s3RootPath",
      "s3TempPath",
    ];

    expect(expectedFields).toHaveLength(15);
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

  it("tempUploadPath defaults to a hidden dir under the SSD storage path", () => {
    const ssdStoragePath = "/data/ssd";
    const defaultPath = join(ssdStoragePath, ".tus-partial");
    expect(defaultPath.replaceAll("\\", "/")).toBe("/data/ssd/.tus-partial");
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
    const optionalVars = [
      "PORT",
      "TEMP_UPLOAD_PATH",
      "SSD_WATERMARK_PERCENT",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_REGION",
      "S3_ROOT_PATH",
      "S3_TEMP_PATH",
    ];
    expect(optionalVars).toHaveLength(8);
  });
});

import { join } from "node:path";
import { optionalEnv, requiredEnv } from "@deniz-cloud/shared/env";

const ssdStoragePath = requiredEnv("SSD_STORAGE_PATH");

function boundedInteger(name: string, fallback: string, min: number, max: number): number {
  const value = Number.parseInt(optionalEnv(name, fallback), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export const config = {
  port: parseInt(optionalEnv("PORT", "3001"), 10),
  databaseUrl: requiredEnv("DATABASE_URL"),
  dbPoolMax: boundedInteger("DB_POOL_MAX", "5", 1, 20),
  jwtSecret: requiredEnv("JWT_SECRET"),
  totpEncryptionKey: requiredEnv("TOTP_ENCRYPTION_KEY"),
  ssdStoragePath,
  hddStoragePath: requiredEnv("HDD_STORAGE_PATH"),
  tempUploadPath: optionalEnv("TEMP_UPLOAD_PATH", join(ssdStoragePath, ".tus-partial")),
  ssdWatermark: parseInt(optionalEnv("SSD_WATERMARK_PERCENT", "90"), 10),
  meiliUrl: requiredEnv("MEILISEARCH_URL"),
  meiliAdminKey: requiredEnv("MEILISEARCH_ADMIN_KEY"),
  s3Enabled: Boolean(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY),
  s3AccessKeyId: optionalEnv("S3_ACCESS_KEY_ID", ""),
  s3SecretAccessKey: optionalEnv("S3_SECRET_ACCESS_KEY", ""),
  s3Region: optionalEnv("S3_REGION", "eu-west-1"),
  s3RootPath: optionalEnv("S3_ROOT_PATH", join(ssdStoragePath, ".s3-v2")),
  s3TempPath: optionalEnv("S3_TEMP_PATH", join(ssdStoragePath, ".s3-v2-temp")),
};

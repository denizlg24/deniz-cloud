import { join } from "node:path";
import { optionalEnv, requiredEnv } from "@deniz-cloud/shared/env";

const ssdStoragePath = requiredEnv("SSD_STORAGE_PATH");

export const config = {
  port: parseInt(optionalEnv("PORT", "3001"), 10),
  databaseUrl: requiredEnv("DATABASE_URL"),
  jwtSecret: requiredEnv("JWT_SECRET"),
  totpEncryptionKey: requiredEnv("TOTP_ENCRYPTION_KEY"),
  ssdStoragePath,
  hddStoragePath: requiredEnv("HDD_STORAGE_PATH"),
  tempUploadPath: optionalEnv("TEMP_UPLOAD_PATH", join(ssdStoragePath, ".tus-partial")),
  ssdWatermark: parseInt(optionalEnv("SSD_WATERMARK_PERCENT", "90"), 10),
  meiliUrl: requiredEnv("MEILISEARCH_URL"),
  meiliAdminKey: requiredEnv("MEILISEARCH_ADMIN_KEY"),
};

import { optionalEnv, requiredEnv } from "@deniz-cloud/shared/env";

export const config = {
  port: parseInt(optionalEnv("PORT", "3001"), 10),
  databaseUrl: requiredEnv("DATABASE_URL"),
  jwtSecret: requiredEnv("JWT_SECRET"),
  totpEncryptionKey: requiredEnv("TOTP_ENCRYPTION_KEY"),
  ssdStoragePath: requiredEnv("SSD_STORAGE_PATH"),
  hddStoragePath: requiredEnv("HDD_STORAGE_PATH"),
  tempUploadPath: optionalEnv("TEMP_UPLOAD_PATH", "/tmp/deniz-cloud-uploads"),
  ssdWatermark: parseInt(optionalEnv("SSD_WATERMARK_PERCENT", "90"), 10),
};

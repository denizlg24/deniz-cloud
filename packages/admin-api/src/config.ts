import { optionalEnv, requiredEnv } from "@deniz-cloud/shared/env";

export const config = {
  port: parseInt(optionalEnv("PORT", "3002"), 10),
  databaseUrl: requiredEnv("DATABASE_URL"),
  jwtSecret: requiredEnv("JWT_SECRET"),
  totpEncryptionKey: requiredEnv("TOTP_ENCRYPTION_KEY"),
  meiliUrl: requiredEnv("MEILI_URL"),
  meiliMasterKey: requiredEnv("MEILI_MASTER_KEY"),
  mongodbUri: requiredEnv("MONGODB_URI"),
  mongodbAdminUri: requiredEnv("MONGODB_ADMIN_URI"),
};

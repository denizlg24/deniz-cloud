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
  postgresInternalHost: optionalEnv("POSTGRES_INTERNAL_HOST", "postgres:5432"),
  postgresExternalHost: optionalEnv("POSTGRES_EXTERNAL_HOST", "postgres.denizlg24.com:5433"),
  mongodbInternalHost: optionalEnv("MONGODB_INTERNAL_HOST", "mongodb:27017"),
  mongodbExternalHost: optionalEnv("MONGODB_EXTERNAL_HOST", "mongodb.denizlg24.com:27018"),
  adminerUrl: optionalEnv("ADMINER_URL", "http://adminer:8080"),
  mongoExpressUrl: optionalEnv("MONGO_EXPRESS_URL", "http://mongo-express:8081"),
  terminalServerUrl: optionalEnv("TERMINAL_SERVER_URL", "ws://terminal-server:3003"),
  backupDir: optionalEnv("BACKUP_DIR", "/backups"),
  postgresContainer: optionalEnv("POSTGRES_CONTAINER", "postgres"),
  mongodbContainer: optionalEnv("MONGODB_CONTAINER", "mongodb"),
};

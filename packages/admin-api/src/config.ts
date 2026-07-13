import { optionalEnv, requiredEnv } from "@deniz-cloud/shared/env";

function boundedInteger(name: string, fallback: string, min: number, max: number): number {
  const value = Number.parseInt(optionalEnv(name, fallback), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export const config = {
  port: parseInt(optionalEnv("PORT", "3002"), 10),
  databaseUrl: requiredEnv("DATABASE_URL"),
  jwtSecret: requiredEnv("JWT_SECRET"),
  totpEncryptionKey: requiredEnv("TOTP_ENCRYPTION_KEY"),
  meiliUrl: requiredEnv("MEILI_URL"),
  meiliMasterKey: requiredEnv("MEILI_MASTER_KEY"),
  mongodbUri: requiredEnv("MONGODB_URI"),
  mongodbAdminUri: requiredEnv("MONGODB_ADMIN_URI"),
  mongotHealthUrl: optionalEnv("MONGOT_HEALTH_URL", "http://mongot:8080"),
  mongotMaxIndexesPerProject: boundedInteger("MONGOT_MAX_INDEXES_PER_PROJECT", "5", 1, 50),
  redisAdminUrl: requiredEnv("REDIS_ADMIN_URL"),
  postgresInternalHost: optionalEnv("POSTGRES_INTERNAL_HOST", "postgres:5432"),
  postgresExternalHost: optionalEnv("POSTGRES_EXTERNAL_HOST", "postgres.denizlg24.com:5433"),
  mongodbInternalHost: optionalEnv("MONGODB_INTERNAL_HOST", "mongodb:27017"),
  mongodbExternalHost: optionalEnv("MONGODB_EXTERNAL_HOST", "mongodb.denizlg24.com:27018"),
  redisInternalHost: optionalEnv("REDIS_INTERNAL_HOST", "redis:6379"),
  redisExternalHost: optionalEnv("REDIS_EXTERNAL_HOST", "redis.denizlg24.com:6380"),
  adminerUrl: optionalEnv("ADMINER_URL", "http://adminer:8080"),
  mongoExpressUrl: optionalEnv("MONGO_EXPRESS_URL", "http://mongo-express:8081"),
  terminalServerUrl: optionalEnv("TERMINAL_SERVER_URL", "ws://terminal-server:3003"),
  backupDir: optionalEnv("BACKUP_DIR", "/backups"),
  postgresUser: optionalEnv("POSTGRES_USER", "postgres"),
  postgresPassword: optionalEnv("POSTGRES_PASSWORD", ""),
  postgresContainer: optionalEnv("POSTGRES_CONTAINER", "postgres"),
  mongoUser: optionalEnv("MONGO_INITDB_ROOT_USERNAME", "admin"),
  mongoPassword: optionalEnv("MONGO_INITDB_ROOT_PASSWORD", ""),
  mongodbContainer: optionalEnv("MONGODB_CONTAINER", "mongodb"),
  ssdDevice: optionalEnv("SSD_DEVICE", ""),
  hddDevices: optionalEnv("HDD_DEVICES", ""),
  microsdDevice: optionalEnv("MICROSD_DEVICE", ""),
  s3Endpoint: optionalEnv("S3_ENDPOINT", "https://storage.denizlg24.com/v2"),
  s3AccessKeyId: optionalEnv("S3_ACCESS_KEY_ID", ""),
  s3SecretAccessKey: optionalEnv("S3_SECRET_ACCESS_KEY", ""),
  s3Region: optionalEnv("S3_REGION", "eu-west-1"),
};

import { type InferInsertModel, type InferSelectModel, relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["superuser", "user"]);

export type UserRole = (typeof userRoleEnum.enumValues)[number];

export const storageTierEnum = pgEnum("storage_tier", ["ssd", "hdd"]);
export type StorageTier = (typeof storageTierEnum.enumValues)[number];

export const uploadStatusEnum = pgEnum("upload_status", ["in_progress", "completed", "expired"]);
export type UploadStatus = (typeof uploadStatusEnum.enumValues)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("user"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const totpSecrets = pgTable("totp_secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  encryptedSecret: text("encrypted_secret").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    used: boolean("used").notNull().default(false),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("recovery_codes_user_id_idx").on(table.userId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("api_keys_user_id_idx").on(table.userId),
    index("api_keys_key_prefix_idx").on(table.keyPrefix),
  ],
);

export const searchProjects = pgTable(
  "search_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull().unique(),
    description: text("description"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    meiliApiKeyUid: text("meili_api_key_uid").notNull(),
    meiliApiKey: text("meili_api_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("search_projects_owner_id_idx").on(table.ownerId)],
);

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    path: text("path").notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("folders_owner_id_idx").on(table.ownerId),
    index("folders_parent_id_idx").on(table.parentId),
  ],
);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    path: text("path").notNull().unique(),
    mimeType: varchar("mime_type", { length: 255 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    tier: storageTierEnum("tier").notNull().default("ssd"),
    diskPath: text("disk_path").notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).notNull().defaultNow(),
    accessCount: integer("access_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("files_owner_id_idx").on(table.ownerId),
    index("files_folder_id_idx").on(table.folderId),
    index("files_tier_idx").on(table.tier),
    index("files_last_accessed_at_idx").on(table.lastAccessedAt),
  ],
);

export const tusUploads = pgTable(
  "tus_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    targetPath: text("target_path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    bytesReceived: bigint("bytes_received", { mode: "number" }).notNull().default(0),
    mimeType: varchar("mime_type", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    tempDiskPath: text("temp_disk_path").notNull(),
    status: uploadStatusEnum("status").notNull().default("in_progress"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tus_uploads_owner_id_idx").on(table.ownerId),
    index("tus_uploads_status_idx").on(table.status),
    index("tus_uploads_expires_at_idx").on(table.expiresAt),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  recoveryCodes: many(recoveryCodes),
  apiKeys: many(apiKeys),
  searchProjects: many(searchProjects),
  folders: many(folders),
  files: many(files),
  tusUploads: many(tusUploads),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const totpSecretsRelations = relations(totpSecrets, ({ one }) => ({
  user: one(users, { fields: [totpSecrets.userId], references: [users.id] }),
}));

export const recoveryCodesRelations = relations(recoveryCodes, ({ one }) => ({
  user: one(users, {
    fields: [recoveryCodes.userId],
    references: [users.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

export const searchProjectsRelations = relations(searchProjects, ({ one }) => ({
  owner: one(users, {
    fields: [searchProjects.ownerId],
    references: [users.id],
  }),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  owner: one(users, { fields: [folders.ownerId], references: [users.id] }),
  parent: one(folders, {
    fields: [folders.parentId],
    references: [folders.id],
    relationName: "parentChild",
  }),
  children: many(folders, { relationName: "parentChild" }),
  files: many(files),
}));

export const filesRelations = relations(files, ({ one }) => ({
  owner: one(users, { fields: [files.ownerId], references: [users.id] }),
  folder: one(folders, { fields: [files.folderId], references: [folders.id] }),
}));

export const tusUploadsRelations = relations(tusUploads, ({ one }) => ({
  owner: one(users, { fields: [tusUploads.ownerId], references: [users.id] }),
}));

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

export type TotpSecret = InferSelectModel<typeof totpSecrets>;
export type NewTotpSecret = InferInsertModel<typeof totpSecrets>;

export type RecoveryCode = InferSelectModel<typeof recoveryCodes>;
export type NewRecoveryCode = InferInsertModel<typeof recoveryCodes>;

export type ApiKey = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;

export type SearchProject = InferSelectModel<typeof searchProjects>;
export type NewSearchProject = InferInsertModel<typeof searchProjects>;

export type Folder = InferSelectModel<typeof folders>;
export type NewFolder = InferInsertModel<typeof folders>;

export type StorageFile = InferSelectModel<typeof files>;
export type NewStorageFile = InferInsertModel<typeof files>;

export type TusUpload = InferSelectModel<typeof tusUploads>;
export type NewTusUpload = InferInsertModel<typeof tusUploads>;

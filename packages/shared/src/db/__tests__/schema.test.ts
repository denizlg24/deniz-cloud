import { describe, expect, it } from "bun:test";
import type { Folder, NewUser, StorageFile, TusUpload, User, UserRole } from "../schema";
import {
  apiKeys,
  files,
  folders,
  recoveryCodes,
  searchProjects,
  sessions,
  storageTierEnum,
  totpSecrets,
  tusUploads,
  uploadStatusEnum,
  userRoleEnum,
  users,
} from "../schema";

describe("userRoleEnum", () => {
  it("has exactly superuser and user values", () => {
    expect(userRoleEnum.enumValues).toEqual(["superuser", "user"]);
  });

  it("UserRole type matches enum values", () => {
    const roles: UserRole[] = ["superuser", "user"];
    expect(roles).toHaveLength(2);
  });
});

describe("storageTierEnum", () => {
  it("has exactly ssd and hdd values", () => {
    expect(storageTierEnum.enumValues).toEqual(["ssd", "hdd"]);
  });
});

describe("uploadStatusEnum", () => {
  it("has in_progress, completed, and expired values", () => {
    expect(uploadStatusEnum.enumValues).toEqual(["in_progress", "completed", "expired"]);
  });
});

describe("users table", () => {
  it("has all expected columns", () => {
    const columns = Object.keys(users);
    expect(columns).toContain("id");
    expect(columns).toContain("username");
    expect(columns).toContain("email");
    expect(columns).toContain("passwordHash");
    expect(columns).toContain("role");
    expect(columns).toContain("status");
    expect(columns).toContain("totpEnabled");
    expect(columns).toContain("createdAt");
    expect(columns).toContain("updatedAt");
  });
});

describe("sessions table", () => {
  it("has all expected columns", () => {
    const columns = Object.keys(sessions);
    expect(columns).toContain("id");
    expect(columns).toContain("userId");
    expect(columns).toContain("tokenHash");
    expect(columns).toContain("expiresAt");
    expect(columns).toContain("createdAt");
  });
});

describe("totpSecrets table", () => {
  it("has encryption-related columns", () => {
    const columns = Object.keys(totpSecrets);
    expect(columns).toContain("encryptedSecret");
    expect(columns).toContain("iv");
    expect(columns).toContain("authTag");
    expect(columns).toContain("verified");
    expect(columns).toContain("userId");
  });
});

describe("recoveryCodes table", () => {
  it("has code hash and usage tracking", () => {
    const columns = Object.keys(recoveryCodes);
    expect(columns).toContain("codeHash");
    expect(columns).toContain("used");
    expect(columns).toContain("usedAt");
    expect(columns).toContain("userId");
  });
});

describe("apiKeys table", () => {
  it("has key hash and prefix for lookup", () => {
    const columns = Object.keys(apiKeys);
    expect(columns).toContain("keyHash");
    expect(columns).toContain("keyPrefix");
    expect(columns).toContain("name");
    expect(columns).toContain("userId");
    expect(columns).toContain("expiresAt");
    expect(columns).toContain("lastUsedAt");
  });
});

describe("searchProjects table", () => {
  it("has Meilisearch integration columns", () => {
    const columns = Object.keys(searchProjects);
    expect(columns).toContain("name");
    expect(columns).toContain("description");
    expect(columns).toContain("ownerId");
    expect(columns).toContain("meiliApiKeyUid");
    expect(columns).toContain("meiliApiKey");
  });
});

describe("folders table", () => {
  it("has hierarchical structure columns", () => {
    const columns = Object.keys(folders);
    expect(columns).toContain("ownerId");
    expect(columns).toContain("parentId");
    expect(columns).toContain("path");
    expect(columns).toContain("name");
  });

  it("ownerId is nullable (shared folder has no owner)", () => {
    // The folder type should allow null ownerId
    const folder: Partial<Folder> = { ownerId: null };
    expect(folder.ownerId).toBeNull();
  });
});

describe("files table", () => {
  it("has storage tier and access tracking columns", () => {
    const columns = Object.keys(files);
    expect(columns).toContain("ownerId");
    expect(columns).toContain("folderId");
    expect(columns).toContain("filename");
    expect(columns).toContain("path");
    expect(columns).toContain("mimeType");
    expect(columns).toContain("sizeBytes");
    expect(columns).toContain("checksum");
    expect(columns).toContain("tier");
    expect(columns).toContain("diskPath");
    expect(columns).toContain("lastAccessedAt");
    expect(columns).toContain("accessCount");
  });
});

describe("tusUploads table", () => {
  it("has TUS protocol-specific columns", () => {
    const columns = Object.keys(tusUploads);
    expect(columns).toContain("ownerId");
    expect(columns).toContain("filename");
    expect(columns).toContain("targetPath");
    expect(columns).toContain("sizeBytes");
    expect(columns).toContain("bytesReceived");
    expect(columns).toContain("mimeType");
    expect(columns).toContain("metadata");
    expect(columns).toContain("tempDiskPath");
    expect(columns).toContain("status");
    expect(columns).toContain("expiresAt");
  });
});

describe("Inferred types", () => {
  it("User has passwordHash as string or null", () => {
    // Type-level: passwordHash is now nullable for pending users
    type Check = User["passwordHash"] extends string | null ? true : false;
    const check: Check = true;
    expect(check).toBe(true);
  });

  it("NewUser does not require id (it has defaultRandom)", () => {
    // NewUser should allow creating without id
    const newUser: NewUser = {
      username: "test",
      passwordHash: "hash",
    };
    expect(newUser.username).toBe("test");
    // id should be optional
    expect(newUser.id).toBeUndefined();
  });

  it("StorageFile has sizeBytes as number", () => {
    type Check = StorageFile["sizeBytes"] extends number ? true : false;
    const check: Check = true;
    expect(check).toBe(true);
  });

  it("TusUpload metadata is a Record<string, string> or null", () => {
    // The jsonb column with $type should allow Record<string, string> | null
    type MetadataType = TusUpload["metadata"];
    const metadata: MetadataType = {
      filename: "test.pdf",
      mimetype: "application/pdf",
    };
    expect(metadata).not.toBeNull();

    const nullMetadata: MetadataType = null;
    expect(nullMetadata).toBeNull();
  });
});

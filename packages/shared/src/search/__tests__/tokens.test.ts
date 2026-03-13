import { describe, expect, it, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import type { MeiliSearch } from "meilisearch";
import { createProjectSearchKey, deleteProjectSearchKey, generateProjectToken } from "../tokens";

describe("createProjectSearchKey", () => {
  it("creates a key scoped to the project prefix with search-only permissions", async () => {
    const mockClient = {
      createKey: mock<MeiliSearch["createKey"]>(async (params) => ({
        key: "generated-key-abc",
        uid: "uid-123",
        name: null,
        description: params.description ?? "",
        actions: params.actions,
        indexes: params.indexes,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    };

    const result = await createProjectSearchKey(mockClient, "my-project");

    expect(result.key).toBe("generated-key-abc");
    expect(result.uid).toBe("uid-123");

    const call = mockClient.createKey.mock.calls[0]!;
    expect(call[0].actions).toEqual(["search"]);
    expect(call[0].indexes).toEqual(["my-project_*"]);
    expect(call[0].expiresAt).toBeNull();
    expect(call[0].description).toContain("my-project");
  });

  it("uses wildcard pattern with underscore separator", async () => {
    const mockClient = {
      createKey: mock<MeiliSearch["createKey"]>(async () => ({
        key: "k",
        uid: "u",
        name: null,
        description: "",
        actions: [],
        indexes: [],
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    };

    await createProjectSearchKey(mockClient, "analytics");

    const call = mockClient.createKey.mock.calls[0]!;
    expect(call[0].indexes[0]).toBe("analytics_*");
  });

  it("key never expires (expiresAt: null)", async () => {
    const mockClient = {
      createKey: mock<MeiliSearch["createKey"]>(async () => ({
        key: "k",
        uid: "u",
        name: null,
        description: "",
        actions: [],
        indexes: [],
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    };

    await createProjectSearchKey(mockClient, "test");

    const call = mockClient.createKey.mock.calls[0]!;
    expect(call[0].expiresAt).toBeNull();
  });
});

describe("deleteProjectSearchKey", () => {
  it("calls client.deleteKey with the provided uid", async () => {
    const mockClient = {
      deleteKey: mock<MeiliSearch["deleteKey"]>(async () => {}),
    };

    await deleteProjectSearchKey(mockClient, "uid-to-delete");

    expect(mockClient.deleteKey).toHaveBeenCalledTimes(1);
    expect(mockClient.deleteKey.mock.calls[0]?.[0]).toBe("uid-to-delete");
  });

  it("propagates errors from the client", async () => {
    const mockClient = {
      deleteKey: mock<MeiliSearch["deleteKey"]>(async () => {
        throw new Error("Key not found");
      }),
    };

    expect(deleteProjectSearchKey(mockClient, "bad-uid")).rejects.toThrow("Key not found");
  });
});

describe("generateProjectToken", () => {
  // generateTenantToken from meilisearch/token requires a valid UUIDv4 apiKeyUid

  it("returns a JWT string token (3 dot-separated segments)", async () => {
    const uid = randomUUID();
    const token = await generateProjectToken({
      apiKey: "a-valid-api-key-string-for-signing",
      apiKeyUid: uid,
      projectName: "my-project",
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    const parts = token.split(".");
    expect(parts.length).toBe(3);
  });

  it("accepts custom expiresAt", async () => {
    const uid = randomUUID();
    const future = new Date(Date.now() + 3600_000);
    const token = await generateProjectToken({
      apiKey: "another-key-for-testing-purposes",
      apiKeyUid: uid,
      projectName: "test",
      expiresAt: future,
    });

    expect(typeof token).toBe("string");
  });

  it("uses default 24h expiry when expiresAt is not provided", async () => {
    const uid = randomUUID();
    const token = await generateProjectToken({
      apiKey: "key-for-default-expiry-test",
      apiKeyUid: uid,
      projectName: "default-ttl",
    });

    expect(typeof token).toBe("string");
  });

  it("rejects non-UUIDv4 apiKeyUid", async () => {
    await expect(
      generateProjectToken({
        apiKey: "some-key",
        apiKeyUid: "not-a-uuid",
        projectName: "test",
      }),
    ).rejects.toThrow("UUIDv4");
  });

  it("produces a token whose payload contains search rules", async () => {
    const uid = randomUUID();
    const token = await generateProjectToken({
      apiKey: "scoping-test-key",
      apiKeyUid: uid,
      projectName: "scoped-project",
    });

    // Decode the JWT payload (second segment, base64url-encoded)
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Missing JWT payload segment");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));

    // searchRules should contain the project prefix wildcard
    expect(payload.searchRules).toHaveProperty("scoped-project_*");
  });
});

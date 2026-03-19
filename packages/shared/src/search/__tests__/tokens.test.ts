import { describe, expect, it, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import type { MeiliSearch } from "meilisearch";
import {
  createProjectSearchKey,
  deleteProjectSearchKey,
  generateProjectToken,
  validateSearchRules,
} from "../tokens";

describe("createProjectSearchKey", () => {
  it("creates a key scoped to the project prefix with full index/document actions", async () => {
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
    // biome-ignore lint/style/noNonNullAssertion: Testing description generation logic
    const call = mockClient.createKey.mock.calls[0]!;
    expect(call[0].actions).toContain("search");
    expect(call[0].actions).toContain("documents.add");
    expect(call[0].actions).toContain("documents.get");
    expect(call[0].actions).toContain("documents.delete");
    expect(call[0].actions).toContain("indexes.create");
    expect(call[0].actions).toContain("indexes.delete");
    expect(call[0].actions).toContain("settings.update");
    expect(call[0].actions).not.toContain("keys.create");
    expect(call[0].actions).not.toContain("keys.delete");
    expect(call[0].actions).not.toContain("dumps.create");
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
    // biome-ignore lint/style/noNonNullAssertion: Testing description generation logic
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
    // biome-ignore lint/style/noNonNullAssertion: Testing description generation logic
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

  it("embeds custom searchRules with filters into the token payload", async () => {
    const uid = randomUUID();
    const token = await generateProjectToken({
      apiKey: "filter-test-key",
      apiKeyUid: uid,
      projectName: "myapp",
      searchRules: {
        myapp_users: { filter: "tenant_id = 42" },
        myapp_orders: { filter: "tenant_id = 42" },
      },
    });

    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Missing JWT payload segment");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));

    expect(payload.searchRules).toEqual({
      myapp_users: { filter: "tenant_id = 42" },
      myapp_orders: { filter: "tenant_id = 42" },
    });
  });

  it("uses wildcard fallback when searchRules is omitted", async () => {
    const uid = randomUUID();
    const token = await generateProjectToken({
      apiKey: "fallback-key",
      apiKeyUid: uid,
      projectName: "proj",
    });

    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Missing JWT payload segment");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));

    expect(payload.searchRules).toHaveProperty("proj_*");
    expect(payload.searchRules["proj_*"]).toBeNull();
  });
});

describe("validateSearchRules", () => {
  it("returns null for rules within project scope", () => {
    expect(
      validateSearchRules(
        { myapp_users: { filter: "tenant_id = 1" }, myapp_orders: null },
        "myapp",
      ),
    ).toBeNull();
  });

  it("returns null for the project wildcard pattern", () => {
    expect(validateSearchRules({ "myapp_*": null }, "myapp")).toBeNull();
  });

  it("returns error for indexes outside project scope", () => {
    const result = validateSearchRules(
      { other_project_users: { filter: "id = 1" } },
      "myapp",
    );
    expect(result).toContain("outside project scope");
    expect(result).toContain("other_project_users");
  });

  it("returns error when mixing valid and invalid indexes", () => {
    const result = validateSearchRules(
      { myapp_users: null, foreign_index: null },
      "myapp",
    );
    expect(result).toContain("foreign_index");
  });

  it("accepts rules with filter strings", () => {
    expect(
      validateSearchRules(
        { myapp_products: { filter: "category = 'electronics' AND visible = true" } },
        "myapp",
      ),
    ).toBeNull();
  });
});

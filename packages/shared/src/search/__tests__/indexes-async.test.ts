import { describe, expect, mock, test } from "bun:test";
import type { Index, MeiliSearch } from "meilisearch";
import {
  createProjectIndex,
  deleteAllProjectIndexes,
  deleteProjectIndex,
  getProjectIndexes,
} from "../indexes";

function createMockIndex(uid: string): Pick<Index, "uid"> {
  return { uid };
}

// The meilisearch SDK's createIndex/deleteIndex return a TaskClient
// with a .waitTask() method for chaining.
function createMockTaskClient() {
  return {
    waitTask: mock(async () => ({ status: "succeeded" })),
  };
}

describe("getProjectIndexes", () => {
  test("returns only indexes matching the project prefix", async () => {
    const mockClient = {
      getIndexes: mock(async () => ({
        results: [
          createMockIndex("myapp_users"),
          createMockIndex("myapp_posts"),
          createMockIndex("other_items"),
          createMockIndex("myapp_comments"),
        ],
        offset: 0,
        limit: 1000,
        total: 4,
      })),
    };

    const results = await getProjectIndexes(mockClient as unknown as MeiliSearch, "myapp");

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.uid)).toEqual(["myapp_users", "myapp_posts", "myapp_comments"]);
  });

  test("returns empty array when no indexes match", async () => {
    const mockClient = {
      getIndexes: mock(async () => ({
        results: [createMockIndex("other_users"), createMockIndex("another_posts")],
        offset: 0,
        limit: 1000,
        total: 2,
      })),
    };

    const results = await getProjectIndexes(mockClient as unknown as MeiliSearch, "myapp");

    expect(results).toHaveLength(0);
  });

  test("returns empty array when there are no indexes", async () => {
    const mockClient = {
      getIndexes: mock(async () => ({
        results: [],
        offset: 0,
        limit: 1000,
        total: 0,
      })),
    };

    const results = await getProjectIndexes(mockClient as unknown as MeiliSearch, "myapp");

    expect(results).toHaveLength(0);
  });

  test("uses underscore as prefix separator", async () => {
    const mockClient = {
      getIndexes: mock(async () => ({
        results: [createMockIndex("myapp_users"), createMockIndex("myappextra_users")],
        offset: 0,
        limit: 1000,
        total: 2,
      })),
    };

    const results = await getProjectIndexes(mockClient as unknown as MeiliSearch, "myapp");

    // "myapp_" prefix matches "myapp_users" but NOT "myappextra_users"
    expect(results).toHaveLength(1);
    expect(results[0]?.uid).toBe("myapp_users");
  });

  test("requests up to 1000 indexes", async () => {
    const mockClient = {
      getIndexes: mock(async (opts: { limit: number }) => {
        expect(opts.limit).toBe(1000);
        return { results: [], offset: 0, limit: opts.limit, total: 0 };
      }),
    };

    await getProjectIndexes(mockClient as unknown as MeiliSearch, "test");
    expect(mockClient.getIndexes).toHaveBeenCalledTimes(1);
  });
});

describe("createProjectIndex", () => {
  test("creates index with scoped name and waits for task", async () => {
    const taskClient = createMockTaskClient();
    const mockClient = {
      createIndex: mock((_uid: string, _opts: { primaryKey: string }) => {
        return taskClient;
      }),
    };

    await createProjectIndex(mockClient as unknown as MeiliSearch, "myapp", "users");

    expect(mockClient.createIndex).toHaveBeenCalledTimes(1);
    const call = mockClient.createIndex.mock.calls[0];
    expect(call?.[0]).toBe("myapp_users");
    expect(call?.[1]).toEqual({ primaryKey: "id" });
    expect(taskClient.waitTask).toHaveBeenCalledTimes(1);
  });
});

describe("deleteProjectIndex", () => {
  test("deletes index with scoped name and waits for task", async () => {
    const taskClient = createMockTaskClient();
    const mockClient = {
      deleteIndex: mock((_uid: string) => taskClient),
    };

    await deleteProjectIndex(mockClient as unknown as MeiliSearch, "analytics", "events");

    expect(mockClient.deleteIndex).toHaveBeenCalledTimes(1);
    expect(mockClient.deleteIndex.mock.calls[0]?.[0]).toBe("analytics_events");
    expect(taskClient.waitTask).toHaveBeenCalledTimes(1);
  });
});

describe("deleteAllProjectIndexes", () => {
  test("deletes all indexes matching the project and waits for all tasks", async () => {
    const deletedUids: string[] = [];
    const taskClients: ReturnType<typeof createMockTaskClient>[] = [];

    const mockClient = {
      getIndexes: mock(async () => ({
        results: [
          createMockIndex("proj_users"),
          createMockIndex("proj_posts"),
          createMockIndex("proj_comments"),
          createMockIndex("other_data"),
        ],
        offset: 0,
        limit: 1000,
        total: 4,
      })),
      deleteIndex: mock((uid: string) => {
        deletedUids.push(uid);
        const tc = createMockTaskClient();
        taskClients.push(tc);
        return tc;
      }),
    };

    await deleteAllProjectIndexes(mockClient as unknown as MeiliSearch, "proj");

    // Should only delete the 3 matching indexes
    expect(deletedUids).toEqual(["proj_users", "proj_posts", "proj_comments"]);
    expect(taskClients).toHaveLength(3);
    for (const tc of taskClients) {
      expect(tc.waitTask).toHaveBeenCalledTimes(1);
    }
  });

  test("handles no matching indexes gracefully", async () => {
    const mockClient = {
      getIndexes: mock(async () => ({
        results: [createMockIndex("other_data")],
        offset: 0,
        limit: 1000,
        total: 1,
      })),
      deleteIndex: mock(() => createMockTaskClient()),
    };

    await deleteAllProjectIndexes(mockClient as unknown as MeiliSearch, "nonexistent");

    expect(mockClient.deleteIndex).toHaveBeenCalledTimes(0);
  });

  test("handles empty index list", async () => {
    const mockClient = {
      getIndexes: mock(async () => ({
        results: [],
        offset: 0,
        limit: 1000,
        total: 0,
      })),
      deleteIndex: mock(() => createMockTaskClient()),
    };

    await deleteAllProjectIndexes(mockClient as unknown as MeiliSearch, "proj");

    expect(mockClient.deleteIndex).toHaveBeenCalledTimes(0);
  });
});

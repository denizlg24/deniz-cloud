import { describe, expect, test } from "bun:test";
import { normalizeVectorIndex, parseVectorIndexInput } from "../project-vector-indexes";

describe("project vector index input", () => {
  test("accepts a bounded vector definition", () => {
    expect(
      parseVectorIndexInput({
        collection: "documents",
        name: "semantic_index",
        path: "content.embedding",
        numDimensions: 1536,
        similarity: "cosine",
        quantization: "scalar",
        filterPaths: ["tenantId", "metadata.category", "tenantId"],
      }),
    ).toEqual({
      collection: "documents",
      name: "semantic_index",
      path: "content.embedding",
      numDimensions: 1536,
      similarity: "cosine",
      quantization: "scalar",
      filterPaths: ["tenantId", "metadata.category"],
    });
  });

  test("rejects invalid dimensions and field injection", () => {
    expect(() =>
      parseVectorIndexInput({
        collection: "documents",
        name: "vector_index",
        path: "$embedding",
        numDimensions: 5000,
        similarity: "cosine",
      }),
    ).toThrow();
  });

  test("rejects more than five filter paths", () => {
    expect(() =>
      parseVectorIndexInput({
        collection: "documents",
        name: "vector_index",
        path: "embedding",
        numDimensions: 384,
        similarity: "dotProduct",
        filterPaths: ["a", "b", "c", "d", "e", "f"],
      }),
    ).toThrow("at most 5");
  });
});

describe("vector index normalization", () => {
  test("extracts vector and filter fields from mongot state", () => {
    expect(
      normalizeVectorIndex("documents", {
        name: "semantic_index",
        status: "READY",
        queryable: true,
        latestDefinition: {
          fields: [
            {
              type: "vector",
              path: "embedding",
              numDimensions: 768,
              similarity: "cosine",
            },
            { type: "filter", path: "tenantId" },
          ],
        },
      }),
    ).toEqual({
      collection: "documents",
      name: "semantic_index",
      status: "READY",
      queryable: true,
      path: "embedding",
      numDimensions: 768,
      similarity: "cosine",
      quantization: "none",
      filterPaths: ["tenantId"],
    });
  });

  test("ignores non-vector search indexes", () => {
    expect(
      normalizeVectorIndex("documents", {
        name: "text_index",
        latestDefinition: { mappings: { dynamic: true } },
      }),
    ).toBeNull();
  });
});

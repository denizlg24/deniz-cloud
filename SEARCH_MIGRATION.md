# Migrating from MongoDB Atlas Search to Meilisearch

This guide shows how to migrate apps that use Atlas Search (`$search` aggregation stage) to use a self-hosted Meilisearch instance as a search sidecar alongside MongoDB.

---

## Architecture Overview

```
Before (Atlas):
  App  ──►  MongoDB Atlas  ($search runs inside the DB)

After (Self-hosted):
  App  ──►  Meilisearch    (search queries)
  App  ──►  MongoDB        (data queries)
  Sync ──►  MongoDB change streams → Meilisearch index updates
```

The key difference: search and data are now separate systems. Your app queries Meilisearch for search, gets back document IDs, then fetches full documents from MongoDB.

---

## 1. Setup

### Install the Meilisearch client

```bash
bun add meilisearch
```

### Create a shared search client

```ts
// packages/shared/src/search/client.ts
import { MeiliSearch } from "meilisearch";

export const meili = new MeiliSearch({
  host: process.env.MEILISEARCH_URL || "http://meilisearch:7700",
  apiKey: process.env.MEILISEARCH_API_KEY || "your-master-key",
});
```

---

## 2. Syncing MongoDB Collections to Meilisearch

Use MongoDB change streams to keep Meilisearch indexes in sync.

```ts
// packages/shared/src/search/sync.ts
import { Collection, ChangeStream } from "mongodb";
import { MeiliSearch, Index } from "meilisearch";

interface SyncOptions {
  /** The MongoDB collection to watch */
  collection: Collection;
  /** The Meilisearch client instance */
  meili: MeiliSearch;
  /** The Meilisearch index name */
  indexName: string;
  /** Transform a MongoDB document into the shape to index in Meilisearch.
   *  Must include an `id` field (string). Only include fields you want to search on. */
  transform: (doc: any) => Record<string, any>;
  /** Meilisearch searchable attributes (fields that $search would have matched against) */
  searchableAttributes: string[];
  /** Optional: filterable attributes for faceted filtering */
  filterableAttributes?: string[];
  /** Optional: sortable attributes */
  sortableAttributes?: string[];
}

export async function syncCollectionToMeilisearch(opts: SyncOptions) {
  const {
    collection,
    meili,
    indexName,
    transform,
    searchableAttributes,
    filterableAttributes = [],
    sortableAttributes = [],
  } = opts;

  // Create or get the index
  await meili.createIndex(indexName, { primaryKey: "id" });
  const index = meili.index(indexName);

  // Configure index settings (equivalent to defining an Atlas Search index)
  await index.updateSettings({
    searchableAttributes,
    filterableAttributes,
    sortableAttributes,
  });

  // --- Initial sync: bulk load all existing documents ---
  const cursor = collection.find({});
  const batch: Record<string, any>[] = [];
  const BATCH_SIZE = 500;

  for await (const doc of cursor) {
    batch.push(transform(doc));
    if (batch.length >= BATCH_SIZE) {
      await index.addDocuments(batch);
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    await index.addDocuments(batch);
  }

  console.log(`[search-sync] Initial sync complete for "${indexName}"`);

  // --- Live sync: watch for changes ---
  const changeStream: ChangeStream = collection.watch([], {
    fullDocument: "updateLookup",
  });

  changeStream.on("change", async (change) => {
    switch (change.operationType) {
      case "insert":
      case "update":
      case "replace":
        if (change.fullDocument) {
          await index.addDocuments([transform(change.fullDocument)]);
        }
        break;
      case "delete":
        if (change.documentKey?._id) {
          await index.deleteDocument(change.documentKey._id.toString());
        }
        break;
    }
  });

  console.log(`[search-sync] Watching "${collection.collectionName}" for changes`);

  return changeStream;
}
```

---

## 3. Migration Examples

### Example: Product Search

#### Before — Atlas Search

```ts
// Atlas Search index definition (created in Atlas UI or via API):
// {
//   "mappings": {
//     "dynamic": false,
//     "fields": {
//       "name":        { "type": "string", "analyzer": "luceneStandard" },
//       "description": { "type": "string", "analyzer": "luceneStandard" },
//       "category":    { "type": "stringFacet" }
//     }
//   }
// }

const results = await db.collection("products").aggregate([
  {
    $search: {
      index: "products_search",
      compound: {
        must: [
          {
            text: {
              query: "wireless headphones",
              path: ["name", "description"],
              fuzzy: { maxEdits: 1 },
            },
          },
        ],
        filter: [
          {
            text: {
              query: "electronics",
              path: "category",
            },
          },
        ],
      },
    },
  },
  { $limit: 20 },
  {
    $project: {
      name: 1,
      description: 1,
      price: 1,
      score: { $meta: "searchScore" },
    },
  },
]).toArray();
```

#### After — Meilisearch

**Step 1: Set up the sync (run once at app startup)**

```ts
import { meili } from "@deniz-cloud/shared/search/client";
import { syncCollectionToMeilisearch } from "@deniz-cloud/shared/search/sync";

await syncCollectionToMeilisearch({
  collection: db.collection("products"),
  meili,
  indexName: "products",
  transform: (doc) => ({
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description,
    category: doc.category,
    price: doc.price,
  }),
  searchableAttributes: ["name", "description"],
  filterableAttributes: ["category", "price"],
  sortableAttributes: ["price"],
});
```

**Step 2: Replace the query**

```ts
import { meili } from "@deniz-cloud/shared/search/client";

// Meilisearch handles fuzzy/typo-tolerant search by default
const searchResults = await meili.index("products").search("wireless headphones", {
  filter: 'category = "electronics"',
  limit: 20,
});

// searchResults.hits contains the indexed fields + relevance
// Each hit has: { id, name, description, category, price }

// If you need the full MongoDB document (with fields not in the index):
const ids = searchResults.hits.map((hit) => new ObjectId(hit.id));
const fullDocs = await db
  .collection("products")
  .find({ _id: { $in: ids } })
  .toArray();

// Preserve Meilisearch's relevance ordering
const idOrder = new Map(ids.map((id, i) => [id.toString(), i]));
fullDocs.sort((a, b) => idOrder.get(a._id.toString())! - idOrder.get(b._id.toString())!);
```

---

### Example: Autocomplete

#### Before — Atlas Search

```ts
const suggestions = await db.collection("products").aggregate([
  {
    $search: {
      index: "products_autocomplete",
      autocomplete: {
        query: userInput,
        path: "name",
        tokenOrder: "sequential",
        fuzzy: { maxEdits: 1 },
      },
    },
  },
  { $limit: 5 },
  { $project: { name: 1 } },
]).toArray();
```

#### After — Meilisearch

```ts
// No special index needed — Meilisearch supports prefix search out of the box
const suggestions = await meili.index("products").search(userInput, {
  limit: 5,
  attributesToRetrieve: ["id", "name"],
});

// suggestions.hits = [{ id: "...", name: "..." }, ...]
```

---

### Example: Faceted Search

#### Before — Atlas Search

```ts
const results = await db.collection("products").aggregate([
  {
    $searchMeta: {
      index: "products_search",
      facet: {
        operator: {
          text: { query: "laptop", path: ["name", "description"] },
        },
        facets: {
          categoryFacet: { type: "string", path: "category" },
          priceFacet: {
            type: "number",
            path: "price",
            boundaries: [0, 500, 1000, 2000],
          },
        },
      },
    },
  },
]).toArray();
```

#### After — Meilisearch

```ts
// Make sure "category" and "price" are in filterableAttributes (done during sync setup)

const results = await meili.index("products").search("laptop", {
  facets: ["category", "price"],
});

// results.facetDistribution = {
//   category: { "electronics": 42, "accessories": 15 },
//   price: { ... }
// }
// results.hits = [...]

// Note: Meilisearch facets return value distributions, not range buckets.
// For price ranges, filter client-side or use Meilisearch filters:
const filtered = await meili.index("products").search("laptop", {
  filter: "price >= 500 AND price < 1000",
  facets: ["category"],
});
```

---

## 4. Quick Reference — Atlas Search to Meilisearch

| Atlas Search Feature | Meilisearch Equivalent |
|---|---|
| `$search` → `text` | `index.search("query")` |
| `fuzzy: { maxEdits: N }` | Built-in typo tolerance (configurable via `typoTolerance` settings) |
| `autocomplete` | Built-in prefix search (default behavior) |
| `compound.must` | Search query string (Meilisearch ranks by relevance automatically) |
| `compound.filter` | `filter` parameter: `'category = "electronics"'` |
| `$searchMeta` → `facet` | `facets` parameter: `["category", "price"]` |
| `{ $meta: "searchScore" }` | `hit._rankingScore` (enable with `showRankingScore: true`) |
| Search index definition | `index.updateSettings({ searchableAttributes, filterableAttributes })` |
| Dynamic field mappings | Meilisearch indexes all fields by default (`searchableAttributes: ["*"]`) |
| `near` (geo) | `_geoPoint` field + `_geoRadius` filter |
| `range` | `filter` with numeric comparisons: `'price >= 10 AND price <= 50'` |
| `regex` / `wildcard` | Not built-in; use standard MongoDB queries for regex patterns |

---

## 5. Gotchas and Tips

- **Meilisearch is eventually consistent.** After a write to MongoDB, there's a small delay (typically <100ms) before the change appears in search results via the change stream sync. For most apps this is fine.

- **Don't index everything.** Only sync the fields you actually search/filter on. This keeps the Meilisearch index small and fast. Fetch full documents from MongoDB using IDs.

- **Primary key must be a string.** MongoDB `_id` (ObjectId) must be converted to string in your `transform` function.

- **Meilisearch has a default 1GB index size limit** (configurable). This is plenty for most use cases on a Pi.

- **Change streams require a replica set.** If running MongoDB as a single node, start it with `--replSet rs0` and initialize the replica set. This is a one-time setup.

- **Restart resilience.** On app restart, the change stream sync restarts from the current point. If you need to catch up on missed changes, store a resume token in MongoDB and pass it to `collection.watch()`.

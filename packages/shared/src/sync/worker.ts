import type { MeiliSearch } from "meilisearch";
import type { ChangeStream, ChangeStreamDocument, Document, MongoClient } from "mongodb";
import type { Database } from "../db";
import type { ProjectCollection } from "../db/schema";
import { transformDocument } from "./transform";

interface SyncWorkerDeps {
  db: Database;
  mongo: MongoClient;
  meili: MeiliSearch;
  batchDelayMs?: number;
  batchSize?: number;
  indexingDelayMs?: number;
}

interface BatchBuffer {
  upserts: Record<string, unknown>[];
  deletes: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

export class SyncWorker {
  private streams = new Map<string, ChangeStream>();
  private buffers = new Map<string, BatchBuffer>();
  private abortControllers = new Map<string, AbortController>();
  private db: Database;
  private mongo: MongoClient;
  private meili: MeiliSearch;
  private batchDelayMs: number;
  private batchSize: number;
  private indexingDelayMs: number;
  private stopping = false;

  constructor(deps: SyncWorkerDeps) {
    this.db = deps.db;
    this.mongo = deps.mongo;
    this.meili = deps.meili;
    this.batchDelayMs = deps.batchDelayMs ?? 500;
    this.batchSize = deps.batchSize ?? 100;
    this.indexingDelayMs = deps.indexingDelayMs ?? 50;
  }

  async start(): Promise<void> {
    const { listEnabledCollections } = await import("../services/collections");
    const collections = await listEnabledCollections(this.db);

    const toStart = collections.filter((c) => c.syncStatus !== "error");

    console.log(`[SyncWorker] Starting with ${toStart.length} collection(s) to watch`);

    for (const collection of toStart) {
      try {
        await this.addCollection(collection);
      } catch (err) {
        console.error(`[SyncWorker] Failed to start watching ${collection.name}:`, err);
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    console.log("[SyncWorker] Stopping...");

    for (const [, ac] of this.abortControllers) {
      ac.abort();
    }

    for (const [collectionId, buffer] of this.buffers) {
      if (buffer.timer) clearTimeout(buffer.timer);
      const collection = await this.getCollectionById(collectionId);
      if (collection) {
        await this.flushBuffer(collectionId, collection.meiliIndexUid);
      }
    }

    for (const [, stream] of this.streams) {
      try {
        await stream.close();
      } catch {
        // stream may already be closed
      }
    }

    this.streams.clear();
    this.buffers.clear();
    this.abortControllers.clear();
    console.log("[SyncWorker] Stopped");
  }

  async addCollection(collection: ProjectCollection): Promise<void> {
    if (this.streams.has(collection.id)) return;

    if (!collection.resumeToken) {
      await this.initialSync(collection);
    }

    const mongoDb = this.mongo.db(collection.mongoDatabase);
    const mongoColl = mongoDb.collection(collection.mongoCollection);

    const streamOptions: Record<string, unknown> = { fullDocument: "updateLookup" };
    if (collection.resumeToken) {
      streamOptions.resumeAfter = collection.resumeToken;
    }

    const stream = mongoColl.watch([], streamOptions);

    this.buffers.set(collection.id, { upserts: [], deletes: [], timer: null });
    this.streams.set(collection.id, stream);

    const ac = new AbortController();
    this.abortControllers.set(collection.id, ac);

    this.consumeStream(collection, stream, ac.signal);

    console.log(
      `[SyncWorker] Watching ${collection.mongoDatabase}.${collection.mongoCollection} → ${collection.meiliIndexUid}`,
    );
  }

  private consumeStream(
    collection: ProjectCollection,
    stream: ChangeStream,
    signal: AbortSignal,
  ): void {
    (async () => {
      try {
        console.log(
          `[SyncWorker] Change stream opened for ${collection.name}, waiting for events...`,
        );
        for await (const event of stream) {
          if (signal.aborted) break;
          try {
            await this.handleChangeEvent(collection, event as ChangeStreamDocument);
          } catch (err) {
            console.error(`[SyncWorker] Error handling change for ${collection.name}:`, err);
          }
        }
        if (!signal.aborted) {
          console.log(`[SyncWorker] Change stream ended unexpectedly for ${collection.name}`);
        }
      } catch (err) {
        if (signal.aborted) return;
        console.error(`[SyncWorker] Change stream error for ${collection.name}:`, err);
        this.streams.delete(collection.id);
        this.abortControllers.delete(collection.id);

        const { updateSyncStatus } = await import("../services/collections");

        const isResumeTokenInvalid =
          err instanceof Error &&
          (err.message.includes("resume token") || err.message.includes("oplog"));

        if (isResumeTokenInvalid) {
          console.log(
            `[SyncWorker] Resume token invalid for ${collection.name}, triggering full resync`,
          );
          await this.resyncCollection(collection.id);
        } else {
          await updateSyncStatus(this.db, collection.id, {
            syncStatus: "error",
            lastError: err instanceof Error ? err.message : String(err),
          });

          if (!this.stopping) {
            setTimeout(() => {
              this.reconnect(collection.id).catch(console.error);
            }, 5000);
          }
        }
      }
    })();
  }

  async removeCollection(collectionId: string): Promise<void> {
    const ac = this.abortControllers.get(collectionId);
    if (ac) {
      ac.abort();
      this.abortControllers.delete(collectionId);
    }

    const stream = this.streams.get(collectionId);
    if (stream) {
      try {
        await stream.close();
      } catch {
        // stream may already be closed
      }
      this.streams.delete(collectionId);
    }

    const buffer = this.buffers.get(collectionId);
    if (buffer?.timer) clearTimeout(buffer.timer);
    this.buffers.delete(collectionId);
  }

  async resyncCollection(collectionId: string): Promise<void> {
    await this.removeCollection(collectionId);

    const { getCollection, updateSyncStatus } = await import("../services/collections");
    const collection = await getCollection(this.db, collectionId);

    await updateSyncStatus(this.db, collectionId, {
      syncStatus: "idle",
      resumeToken: null,
      lastError: null,
    });

    const fresh = { ...collection, resumeToken: null };
    await this.addCollection(fresh);
  }

  private async initialSync(collection: ProjectCollection): Promise<void> {
    const { updateSyncStatus } = await import("../services/collections");

    console.log(`[SyncWorker] Starting initial sync for ${collection.meiliIndexUid}`);
    await updateSyncStatus(this.db, collection.id, { syncStatus: "syncing" });

    try {
      const index = this.meili.index(collection.meiliIndexUid);

      try {
        await this.meili.createIndex(collection.meiliIndexUid, {
          primaryKey: "id",
        });
        await this.meili.index(collection.meiliIndexUid).updateSettings({
          searchableAttributes: collection.fieldMapping.searchableAttributes ?? ["*"],
          filterableAttributes: collection.fieldMapping.filterableAttributes ?? [],
          sortableAttributes: collection.fieldMapping.sortableAttributes ?? [],
        });
      } catch {
        // index may already exist
      }

      const mongoDb = this.mongo.db(collection.mongoDatabase);
      const mongoColl = mongoDb.collection(collection.mongoCollection);

      const cursor = mongoColl.find({}, { batchSize: 1000 });
      let batch: Record<string, unknown>[] = [];
      let totalDocs = 0;

      for await (const doc of cursor) {
        batch.push(transformDocument(doc, collection.fieldMapping));

        if (batch.length >= 1000) {
          await index.addDocuments(batch);
          totalDocs += batch.length;
          batch = [];

          if (this.indexingDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.indexingDelayMs));
          }
        }
      }

      if (batch.length > 0) {
        await index.addDocuments(batch);
        totalDocs += batch.length;
      }

      await updateSyncStatus(this.db, collection.id, {
        syncStatus: "idle",
        lastSyncedAt: new Date(),
        documentCount: totalDocs,
        lastError: null,
      });

      console.log(
        `[SyncWorker] Initial sync complete for ${collection.meiliIndexUid}: ${totalDocs} documents`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SyncWorker] Initial sync failed for ${collection.meiliIndexUid}:`, message);
      await updateSyncStatus(this.db, collection.id, {
        syncStatus: "error",
        lastError: message,
      });
      throw err;
    }
  }

  private async handleChangeEvent(
    collection: ProjectCollection,
    event: ChangeStreamDocument,
  ): Promise<void> {
    const buffer = this.buffers.get(collection.id);
    if (!buffer) return;

    console.log(`[SyncWorker] Change event: ${event.operationType} on ${collection.name}`);

    switch (event.operationType) {
      case "insert":
      case "replace":
      case "update": {
        const doc = (event as ChangeStreamDocument & { fullDocument?: Document }).fullDocument;
        if (doc) {
          buffer.upserts.push(transformDocument(doc, collection.fieldMapping));
        }
        break;
      }
      case "delete": {
        const docId = (event as ChangeStreamDocument & { documentKey?: { _id: unknown } })
          .documentKey?._id;
        if (docId) {
          buffer.deletes.push(docId.toString());
        }
        break;
      }
    }

    if (event._id) {
      const { updateSyncStatus } = await import("../services/collections");
      await updateSyncStatus(this.db, collection.id, {
        resumeToken: event._id as Record<string, unknown>,
      });
    }

    const totalBuffered = buffer.upserts.length + buffer.deletes.length;

    if (totalBuffered >= this.batchSize) {
      await this.flushBuffer(collection.id, collection.meiliIndexUid);
    } else if (!buffer.timer) {
      buffer.timer = setTimeout(async () => {
        await this.flushBuffer(collection.id, collection.meiliIndexUid);
      }, this.batchDelayMs);
    }
  }

  private async flushBuffer(collectionId: string, meiliIndexUid: string): Promise<void> {
    const buffer = this.buffers.get(collectionId);
    if (!buffer) return;

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    const upserts = buffer.upserts.splice(0);
    const deletes = buffer.deletes.splice(0);

    if (upserts.length === 0 && deletes.length === 0) return;

    console.log(
      `[SyncWorker] Flushing ${upserts.length} upserts, ${deletes.length} deletes to ${meiliIndexUid}`,
    );

    try {
      const index = this.meili.index(meiliIndexUid);

      if (upserts.length > 0) {
        await index.addDocuments(upserts);
      }

      if (deletes.length > 0) {
        await index.deleteDocuments(deletes);
      }

      const { updateSyncStatus } = await import("../services/collections");
      const delta = upserts.length - deletes.length;
      await updateSyncStatus(this.db, collectionId, {
        lastSyncedAt: new Date(),
        ...(delta !== 0 ? { documentCountDelta: delta } : {}),
      });

      if (this.indexingDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.indexingDelayMs));
      }
    } catch (err) {
      console.error(`[SyncWorker] Failed to flush buffer for ${meiliIndexUid}:`, err);
      buffer.upserts.unshift(...upserts);
      buffer.deletes.unshift(...deletes);
    }
  }

  private async reconnect(collectionId: string): Promise<void> {
    if (this.stopping) return;

    try {
      const { getCollection } = await import("../services/collections");
      const collection = await getCollection(this.db, collectionId);
      if (collection.syncEnabled && collection.syncStatus !== "error") {
        await this.addCollection(collection);
      }
    } catch (err) {
      console.error(`[SyncWorker] Reconnect failed for ${collectionId}:`, err);
    }
  }

  private async getCollectionById(collectionId: string): Promise<ProjectCollection | null> {
    try {
      const { getCollection } = await import("../services/collections");
      return await getCollection(this.db, collectionId);
    } catch {
      return null;
    }
  }

  isWatching(collectionId: string): boolean {
    return this.streams.has(collectionId);
  }

  get activeStreamCount(): number {
    return this.streams.size;
  }
}

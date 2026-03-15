import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import { type FieldMapping, projectCollections, projects } from "../db/schema";
import type { SafeProjectCollection } from "../types";
import { AuthError } from "./auth";

const MAX_SYNCED_COLLECTIONS = 20;

export async function createCollection(
  db: Database,
  input: {
    projectId: string;
    name: string;
    mongoDatabase: string;
    mongoCollection: string;
    meiliIndexUid: string;
    fieldMapping?: FieldMapping;
  },
): Promise<SafeProjectCollection> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, input.projectId),
  });
  if (!project) throw new AuthError("Project not found", "PROJECT_NOT_FOUND", 404);

  const [syncedCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectCollections)
    .where(
      and(
        eq(projectCollections.projectId, input.projectId),
        eq(projectCollections.syncEnabled, true),
      ),
    );

  if ((syncedCount?.count ?? 0) >= MAX_SYNCED_COLLECTIONS) {
    throw new AuthError(
      `Maximum of ${MAX_SYNCED_COLLECTIONS} synced collections per project reached`,
      "COLLECTION_LIMIT_REACHED",
      400,
    );
  }

  const [collection] = await db
    .insert(projectCollections)
    .values({
      projectId: input.projectId,
      name: input.name,
      mongoDatabase: input.mongoDatabase,
      mongoCollection: input.mongoCollection,
      meiliIndexUid: input.meiliIndexUid,
      fieldMapping: input.fieldMapping ?? {},
    })
    .returning();

  if (!collection) throw new Error("Failed to create collection");
  return collection;
}

export async function listCollections(
  db: Database,
  projectId: string,
): Promise<SafeProjectCollection[]> {
  return db
    .select()
    .from(projectCollections)
    .where(eq(projectCollections.projectId, projectId))
    .orderBy(projectCollections.createdAt);
}

export async function getCollection(
  db: Database,
  collectionId: string,
): Promise<SafeProjectCollection> {
  const collection = await db.query.projectCollections.findFirst({
    where: eq(projectCollections.id, collectionId),
  });

  if (!collection) throw new AuthError("Collection not found", "COLLECTION_NOT_FOUND", 404);
  return collection;
}

export async function updateCollection(
  db: Database,
  collectionId: string,
  input: {
    fieldMapping?: FieldMapping;
    syncEnabled?: boolean;
  },
): Promise<SafeProjectCollection> {
  const existing = await db.query.projectCollections.findFirst({
    where: eq(projectCollections.id, collectionId),
  });
  if (!existing) throw new AuthError("Collection not found", "COLLECTION_NOT_FOUND", 404);

  if (input.syncEnabled === true && !existing.syncEnabled) {
    const [syncedCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectCollections)
      .where(
        and(
          eq(projectCollections.projectId, existing.projectId),
          eq(projectCollections.syncEnabled, true),
        ),
      );

    if ((syncedCount?.count ?? 0) >= MAX_SYNCED_COLLECTIONS) {
      throw new AuthError(
        `Maximum of ${MAX_SYNCED_COLLECTIONS} synced collections reached`,
        "COLLECTION_LIMIT_REACHED",
        400,
      );
    }
  }

  const [updated] = await db
    .update(projectCollections)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(projectCollections.id, collectionId))
    .returning();

  if (!updated) throw new Error("Failed to update collection");
  return updated;
}

export async function deleteCollection(db: Database, collectionId: string): Promise<void> {
  const existing = await db.query.projectCollections.findFirst({
    where: eq(projectCollections.id, collectionId),
  });
  if (!existing) throw new AuthError("Collection not found", "COLLECTION_NOT_FOUND", 404);

  await db.delete(projectCollections).where(eq(projectCollections.id, collectionId));
}

export async function updateSyncStatus(
  db: Database,
  collectionId: string,
  status: {
    syncStatus?: "idle" | "syncing" | "error";
    lastError?: string | null;
    lastSyncedAt?: Date;
    resumeToken?: Record<string, unknown> | null;
    documentCount?: number;
    documentCountDelta?: number;
  },
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (status.syncStatus !== undefined) set.syncStatus = status.syncStatus;
  if (status.lastError !== undefined) set.lastError = status.lastError;
  if (status.lastSyncedAt !== undefined) set.lastSyncedAt = status.lastSyncedAt;
  if (status.resumeToken !== undefined) set.resumeToken = status.resumeToken;
  if (status.documentCount !== undefined) set.documentCount = status.documentCount;
  if (status.documentCountDelta !== undefined) {
    set.documentCount = sql`GREATEST(0, ${projectCollections.documentCount} + ${status.documentCountDelta})`;
  }

  await db.update(projectCollections).set(set).where(eq(projectCollections.id, collectionId));
}

export async function listEnabledCollections(db: Database): Promise<SafeProjectCollection[]> {
  return db.select().from(projectCollections).where(eq(projectCollections.syncEnabled, true));
}

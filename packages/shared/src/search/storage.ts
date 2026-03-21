import type { MeiliSearch } from "meilisearch";

export const STORAGE_INDEX_UID = "_storage_files";

export interface StorageSearchDocument {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  ownerId: string;
  scope: "user" | "shared";
  mimeType?: string | null;
  sizeBytes?: number;
  tier?: "ssd" | "hdd";
  folderId?: string | null;
  parentId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StorageSearchResult {
  hits: StorageSearchDocument[];
  totalHits: number;
  page: number;
  totalPages: number;
}

function deriveScope(path: string): "user" | "shared" {
  if (path.startsWith("/shared")) return "shared";
  return "user";
}

export async function ensureStorageSearchIndex(meili: MeiliSearch): Promise<void> {
  try {
    await meili.getIndex(STORAGE_INDEX_UID);
  } catch {
    await meili.createIndex(STORAGE_INDEX_UID, { primaryKey: "id" }).waitTask();
  }

  const index = meili.index(STORAGE_INDEX_UID);
  await index
    .updateSettings({
      searchableAttributes: ["name"],
      filterableAttributes: ["ownerId", "type", "scope"],
      sortableAttributes: ["createdAt", "sizeBytes", "name"],
    })
    .waitTask();
}

export function buildFileDocument(file: {
  id: string;
  filename: string;
  path: string;
  ownerId: string;
  folderId: string;
  mimeType: string | null;
  sizeBytes: number;
  tier: string;
  createdAt: Date;
  updatedAt: Date;
}): StorageSearchDocument {
  return {
    id: file.id,
    name: file.filename,
    path: file.path,
    type: "file",
    ownerId: file.ownerId,
    scope: deriveScope(file.path),
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    tier: file.tier as "ssd" | "hdd",
    folderId: file.folderId,
    createdAt: file.createdAt.getTime(),
    updatedAt: file.updatedAt.getTime(),
  };
}

export function buildFolderDocument(folder: {
  id: string;
  name: string;
  path: string;
  ownerId: string | null;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StorageSearchDocument | null {
  if (!folder.ownerId) return null;
  return {
    id: folder.id,
    name: folder.name,
    path: folder.path,
    type: "folder",
    ownerId: folder.ownerId,
    scope: deriveScope(folder.path),
    parentId: folder.parentId,
    createdAt: folder.createdAt.getTime(),
    updatedAt: folder.updatedAt.getTime(),
  };
}

export async function indexStorageDocuments(
  meili: MeiliSearch,
  documents: StorageSearchDocument[],
): Promise<void> {
  if (documents.length === 0) return;
  const index = meili.index(STORAGE_INDEX_UID);
  const BATCH_SIZE = 1000;
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    await index.addDocuments(batch);
  }
}

export async function removeStorageDocuments(meili: MeiliSearch, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const index = meili.index(STORAGE_INDEX_UID);
  await index.deleteDocuments(ids);
}

export async function searchStorageIndex(
  meili: MeiliSearch,
  query: string,
  options: {
    scope: "user" | "shared";
    ownerId?: string;
    type?: "file" | "folder";
    page?: number;
    hitsPerPage?: number;
  },
): Promise<StorageSearchResult> {
  const index = meili.index(STORAGE_INDEX_UID);

  const filterParts: string[] = [`scope = "${options.scope}"`];
  if (options.scope === "user" && options.ownerId) {
    filterParts.push(`ownerId = "${options.ownerId}"`);
  }
  if (options.type) {
    filterParts.push(`type = "${options.type}"`);
  }

  const page = options.page ?? 1;
  const hitsPerPage = options.hitsPerPage ?? 20;

  const result = await index.search<StorageSearchDocument>(query, {
    filter: filterParts.join(" AND "),
    page,
    hitsPerPage,
    sort: ["name:asc"],
  } as const);

  return {
    hits: result.hits,
    totalHits: "totalHits" in result ? (result.totalHits as number) : 0,
    page: "page" in result ? (result.page as number) : page,
    totalPages: "totalPages" in result ? (result.totalPages as number) : 1,
  };
}

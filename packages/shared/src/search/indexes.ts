import type { MeiliSearch } from "meilisearch";

export function scopedIndexName(projectName: string, collectionName: string): string {
  return `${projectName}_${collectionName}`;
}

export function parseScopedIndexName(
  indexUid: string,
): { project: string; collection: string } | null {
  const sep = indexUid.indexOf("_");
  if (sep === -1) return null;
  return {
    project: indexUid.slice(0, sep),
    collection: indexUid.slice(sep + 1),
  };
}

export async function getProjectIndexes(client: MeiliSearch, projectName: string) {
  const prefix = `${projectName}_`;
  const { results } = await client.getIndexes({ limit: 1000 });
  return results.filter((idx) => idx.uid.startsWith(prefix));
}

export async function createProjectIndex(
  client: MeiliSearch,
  projectName: string,
  collectionName: string,
  primaryKey: string = "id",
) {
  const uid = scopedIndexName(projectName, collectionName);
  return client.createIndex(uid, { primaryKey });
}

export async function deleteProjectIndex(
  client: MeiliSearch,
  projectName: string,
  collectionName: string,
) {
  const uid = scopedIndexName(projectName, collectionName);
  return client.deleteIndex(uid);
}

export async function deleteAllProjectIndexes(client: MeiliSearch, projectName: string) {
  const indexes = await getProjectIndexes(client, projectName);
  await Promise.all(indexes.map((idx) => client.deleteIndex(idx.uid)));
}

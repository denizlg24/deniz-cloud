import type { MeiliSearch } from "meilisearch";
import { generateTenantToken } from "meilisearch/token";

const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function createProjectSearchKey(
  client: Pick<MeiliSearch, "createKey">,
  projectName: string,
): Promise<{ key: string; uid: string }> {
  const result = await client.createKey({
    description: `Search key for project: ${projectName}`,
    actions: ["search"],
    indexes: [`${projectName}_*`],
    expiresAt: null,
  });
  return { key: result.key, uid: result.uid };
}

export async function deleteProjectSearchKey(
  client: Pick<MeiliSearch, "deleteKey">,
  apiKeyUid: string,
): Promise<void> {
  await client.deleteKey(apiKeyUid);
}

export async function generateProjectToken(config: {
  apiKey: string;
  apiKeyUid: string;
  projectName: string;
  expiresAt?: Date;
}): Promise<string> {
  return generateTenantToken({
    apiKey: config.apiKey,
    apiKeyUid: config.apiKeyUid,
    searchRules: { [`${config.projectName}_*`]: null },
    expiresAt: config.expiresAt ?? new Date(Date.now() + DEFAULT_TOKEN_TTL_MS),
  });
}

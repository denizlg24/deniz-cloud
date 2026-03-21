import { MeiliSearch } from "meilisearch";

export type { MeiliSearch };

export function createMeiliClient(url: string, apiKey: string): MeiliSearch {
  return new MeiliSearch({ host: url, apiKey });
}

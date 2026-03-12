import { MeiliSearch } from "meilisearch";

export function createMeiliClient(url: string, apiKey: string): MeiliSearch {
  return new MeiliSearch({ host: url, apiKey });
}

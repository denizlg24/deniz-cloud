import { createRawClient } from "@deniz-cloud/shared/db";
import type { ProjectCollection } from "@deniz-cloud/shared/db/schema";
import type { PgClientFactory } from "@deniz-cloud/shared/sync";
import type { Sql } from "postgres";

interface FactoryDeps {
  databaseUrl: string;
}

export function createProjectPgClientFactory({ databaseUrl }: FactoryDeps): PgClientFactory {
  return {
    async forCollection(collection: ProjectCollection) {
      if (!collection.pgDatabase) {
        throw new Error(`Collection ${collection.id} missing pgDatabase`);
      }

      const url = new URL(databaseUrl);
      url.pathname = `/${encodeURIComponent(collection.pgDatabase)}`;

      const sql: Sql = createRawClient(url.toString(), { max: 1 });
      return {
        sql,
        close: async () => {
          await sql.end();
        },
      };
    },
  };
}

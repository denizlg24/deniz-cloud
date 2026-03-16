import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type RawSqlClient = ReturnType<typeof postgres>;

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

export function createRawClient(
  connectionString: string,
  options?: { max?: number },
): RawSqlClient {
  return postgres(connectionString, { max: options?.max ?? 1 });
}

import type { Database } from "@deniz-cloud/shared/db";
import { createRawClient } from "@deniz-cloud/shared/db";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import { Hono } from "hono";
import type { Sql } from "postgres";

interface PostgresDbRouteDeps {
  db: Database;
  databaseUrl: string;
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

const ALLOWED_TYPES = new Set([
  "serial",
  "bigserial",
  "integer",
  "bigint",
  "smallint",
  "text",
  "varchar",
  "char",
  "boolean",
  "timestamp",
  "timestamptz",
  "date",
  "time",
  "numeric",
  "real",
  "double precision",
  "jsonb",
  "json",
  "uuid",
  "bytea",
  "inet",
  "cidr",
  "macaddr",
]);

function validateIdentifier(name: string, label: string): void {
  if (!IDENTIFIER_RE.test(name)) {
    throw Object.assign(new Error(`Invalid ${label}: must match ${IDENTIFIER_RE.source}`), {
      status: 400,
    });
  }
}

function parseDbName(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return decodeURIComponent(url.pathname.slice(1));
}

function buildConnectionString(databaseUrl: string, targetDb: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(targetDb)}`;
  return url.toString();
}

async function withDatabaseClient<T>(
  databaseUrl: string,
  targetDb: string,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  const connStr = buildConnectionString(databaseUrl, targetDb);
  const client = createRawClient(connStr, { max: 1 });
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function getProtectedDatabases(databaseUrl: string): Set<string> {
  return new Set(["postgres", "template0", "template1", parseDbName(databaseUrl)]);
}

export function postgresDbRoutes({ db, databaseUrl }: PostgresDbRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const protectedDbs = getProtectedDatabases(databaseUrl);

  app.get("/databases", async (c) => {
    const result = await db.$client`
      SELECT datname AS name,
             pg_database_size(datname)::bigint AS size_bytes
      FROM pg_database
      WHERE NOT datistemplate
      ORDER BY datname
    `;

    const databases = result.map((row) => ({
      name: row.name as string,
      sizeBytes: Number(row.size_bytes),
      isProtected: protectedDbs.has(row.name as string),
    }));

    return c.json({ data: databases });
  });

  app.post("/databases", async (c) => {
    const body = await c.req.json<{ name: string }>();
    validateIdentifier(body.name, "database name");

    await db.$client.unsafe(`CREATE DATABASE "${body.name}"`);
    return c.json({ data: { name: body.name } }, 201);
  });

  app.delete("/databases/:name", async (c) => {
    const name = c.req.param("name");
    validateIdentifier(name, "database name");

    if (protectedDbs.has(name)) {
      return c.json(
        { error: { code: "PROTECTED_DATABASE", message: `Database "${name}" cannot be dropped` } },
        403,
      );
    }

    await db.$client.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name.replace(/'/g, "''")}' AND pid <> pg_backend_pid()`,
    );
    await db.$client.unsafe(`DROP DATABASE "${name}"`);

    return c.json({ data: { dropped: name } });
  });

  app.get("/databases/:name/schemas", async (c) => {
    const name = c.req.param("name");
    validateIdentifier(name, "database name");

    const schemas = await withDatabaseClient(databaseUrl, name, async (sql) => {
      return sql`
        SELECT schema_name AS name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY schema_name
      `;
    });

    return c.json({
      data: schemas.map((s: Record<string, unknown>) => ({ name: s.name as string })),
    });
  });

  app.get("/databases/:name/tables", async (c) => {
    const name = c.req.param("name");
    const schema = c.req.query("schema") ?? "public";
    validateIdentifier(name, "database name");
    validateIdentifier(schema, "schema name");

    const tables = await withDatabaseClient(databaseUrl, name, async (sql) => {
      return sql`
        SELECT
          t.table_name AS name,
          t.table_schema AS schema,
          COALESCE(c.reltuples::bigint, 0) AS row_estimate,
          COALESCE(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::bigint, 0) AS size_bytes
        FROM information_schema.tables t
        LEFT JOIN pg_class c ON c.relname = t.table_name
        LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
        WHERE t.table_schema = ${schema}
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
      `;
    });

    return c.json({
      data: tables.map((t: Record<string, unknown>) => ({
        name: t.name as string,
        schema: t.schema as string,
        rowEstimate: Math.max(0, Number(t.row_estimate)),
        sizeBytes: Number(t.size_bytes),
      })),
    });
  });

  app.get("/databases/:name/tables/:table", async (c) => {
    const name = c.req.param("name");
    const table = c.req.param("table");
    const schema = c.req.query("schema") ?? "public";
    validateIdentifier(name, "database name");
    validateIdentifier(table, "table name");
    validateIdentifier(schema, "schema name");

    const detail = await withDatabaseClient(databaseUrl, name, async (sql) => {
      const [columns, indexes, constraints] = await Promise.all([
        sql`
          SELECT column_name, data_type, is_nullable, column_default, ordinal_position
          FROM information_schema.columns
          WHERE table_schema = ${schema} AND table_name = ${table}
          ORDER BY ordinal_position
        `,
        sql`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname = ${schema} AND tablename = ${table}
          ORDER BY indexname
        `,
        sql`
          SELECT tc.constraint_name, tc.constraint_type,
                 array_agg(ccu.column_name ORDER BY ccu.column_name) AS columns
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.table_schema = ${schema} AND tc.table_name = ${table}
          GROUP BY tc.constraint_name, tc.constraint_type
          ORDER BY tc.constraint_name
        `,
      ]);

      return { columns, indexes, constraints };
    });

    return c.json({
      data: {
        columns: detail.columns.map((col: Record<string, unknown>) => ({
          name: col.column_name as string,
          type: col.data_type as string,
          nullable: col.is_nullable === "YES",
          default: col.column_default as string | null,
          position: col.ordinal_position as number,
        })),
        indexes: detail.indexes.map((idx: Record<string, unknown>) => ({
          name: idx.indexname as string,
          definition: idx.indexdef as string,
        })),
        constraints: detail.constraints.map((con: Record<string, unknown>) => ({
          name: con.constraint_name as string,
          type: con.constraint_type as string,
          columns: con.columns as string[],
        })),
      },
    });
  });

  app.post("/databases/:name/tables", async (c) => {
    const name = c.req.param("name");
    const schema = c.req.query("schema") ?? "public";
    validateIdentifier(name, "database name");
    validateIdentifier(schema, "schema name");

    const body = await c.req.json<{
      name: string;
      columns: Array<{
        name: string;
        type: string;
        nullable?: boolean;
        default?: string;
        primaryKey?: boolean;
      }>;
    }>();

    validateIdentifier(body.name, "table name");

    if (!body.columns || body.columns.length === 0) {
      throw Object.assign(new Error("At least one column is required"), { status: 400 });
    }

    const columnDefs: string[] = [];
    const primaryKeys: string[] = [];

    for (const col of body.columns) {
      validateIdentifier(col.name, "column name");
      if (!ALLOWED_TYPES.has(col.type.toLowerCase())) {
        throw Object.assign(new Error(`Disallowed column type: ${col.type}`), { status: 400 });
      }

      let def = `"${col.name}" ${col.type}`;
      if (col.nullable === false) def += " NOT NULL";
      if (col.default !== undefined && col.default !== "") def += ` DEFAULT ${col.default}`;
      if (col.primaryKey) primaryKeys.push(`"${col.name}"`);

      columnDefs.push(def);
    }

    if (primaryKeys.length > 0) {
      columnDefs.push(`PRIMARY KEY (${primaryKeys.join(", ")})`);
    }

    const ddl = `CREATE TABLE "${schema}"."${body.name}" (\n  ${columnDefs.join(",\n  ")}\n)`;

    await withDatabaseClient(databaseUrl, name, async (sql) => {
      await sql.unsafe(ddl);
    });

    return c.json({ data: { name: body.name, schema } }, 201);
  });

  app.delete("/databases/:name/tables/:table", async (c) => {
    const name = c.req.param("name");
    const table = c.req.param("table");
    const schema = c.req.query("schema") ?? "public";
    validateIdentifier(name, "database name");
    validateIdentifier(table, "table name");
    validateIdentifier(schema, "schema name");

    const appDb = parseDbName(databaseUrl);
    if (name === appDb) {
      const drizzleTables = await withDatabaseClient(databaseUrl, name, async (sql) => {
        return sql`
          SELECT tablename FROM pg_tables
          WHERE schemaname = ${schema}
            AND tablename IN ('users', 'sessions', 'files', 'folders', 'api_keys', 'projects', 'project_collections')
        `;
      });
      const managed = new Set(
        drizzleTables.map((t: Record<string, unknown>) => t.tablename as string),
      );
      if (managed.has(table)) {
        return c.json(
          {
            error: {
              code: "PROTECTED_TABLE",
              message: `Table "${table}" is managed by the application and cannot be dropped`,
            },
          },
          403,
        );
      }
    }

    await withDatabaseClient(databaseUrl, name, async (sql) => {
      await sql.unsafe(`DROP TABLE "${schema}"."${table}"`);
    });

    return c.json({ data: { dropped: table } });
  });

  app.post("/databases/:name/query", async (c) => {
    const name = c.req.param("name");
    validateIdentifier(name, "database name");

    const body = await c.req.json<{ sql: string }>();
    const query = body.sql?.trim();
    if (!query) {
      throw Object.assign(new Error("SQL query is required"), { status: 400 });
    }

    if (query.length > 10000) {
      throw Object.assign(new Error("Query too long (max 10000 chars)"), { status: 400 });
    }

    const startTime = performance.now();

    try {
      const result = await withDatabaseClient(databaseUrl, name, async (sql) => {
        return sql.unsafe(query);
      });

      const durationMs = Math.round(performance.now() - startTime);
      const rows = Array.isArray(result) ? result : [];
      const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];

      return c.json({
        data: {
          columns,
          rows: rows.slice(0, 500) as Record<string, unknown>[],
          rowCount: result.count ?? rows.length,
          truncated: rows.length > 500,
          durationMs,
        },
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      const message = err instanceof Error ? err.message : "Query execution failed";
      return c.json(
        {
          error: { code: "QUERY_ERROR", message },
          data: { durationMs },
        },
        400,
      );
    }
  });

  return app;
}

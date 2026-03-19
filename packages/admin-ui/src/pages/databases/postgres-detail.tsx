import { Loader2, Play } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  executePgQuery,
  getPgDatabases,
  getPgSchemas,
  getPgTableDetail,
  type PgDatabase,
  type PgQueryResult,
  type PgSchema,
  type PgTableDetail,
} from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { PgSelection } from "./postgres-tab";

interface PostgresDetailProps {
  selection: PgSelection;
  onRefreshTables: (database: string) => void;
}

export function PostgresDetail({ selection }: PostgresDetailProps) {
  if (selection.type === "none") {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Select a database or table from the tree</p>
      </div>
    );
  }

  if (selection.type === "database") {
    return <DatabaseOverview database={selection.database} />;
  }

  return (
    <TableDescription
      database={selection.database}
      schema={selection.schema}
      table={selection.table}
    />
  );
}

function DatabaseOverview({ database }: { database: string }) {
  const [dbInfo, setDbInfo] = useState<PgDatabase | null>(null);
  const [schemas, setSchemas] = useState<PgSchema[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getPgDatabases(), getPgSchemas(database)])
      .then(([dbs, schemaList]) => {
        if (cancelled) return;
        setDbInfo(dbs.find((d) => d.name === database) ?? null);
        setSchemas(schemaList);
      })
      .catch((err) => {
        if (!cancelled)
          toast.error("Failed to load database info", {
            description: err instanceof Error ? err.message : undefined,
          });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [database]);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 min-w-0">
      <div>
        <h2 className="text-lg font-semibold">{database}</h2>
        <p className="text-sm text-muted-foreground">PostgreSQL Database</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Size</p>
          <p className="text-2xl font-semibold">{dbInfo ? formatBytes(dbInfo.sizeBytes) : "—"}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Schemas</p>
          <p className="text-2xl font-semibold">{schemas.length}</p>
        </div>
      </div>

      {dbInfo?.isProtected && <Badge variant="secondary">Protected — cannot be dropped</Badge>}

      <div>
        <h3 className="text-sm font-medium mb-2">Schemas</h3>
        <div className="flex flex-wrap gap-2">
          {schemas.map((s) => (
            <Badge key={s.name} variant="outline">
              {s.name}
            </Badge>
          ))}
        </div>
      </div>

      <SqlQueryPanel database={database} />
    </div>
  );
}

function SqlQueryPanel({ database }: { database: string }) {
  const [sql, setSql] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PgQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  const handleRun = async (e: FormEvent) => {
    e.preventDefault();
    if (!sql.trim() || running) return;

    setRunning(true);
    setError(null);
    setResult(null);
    setDurationMs(null);

    try {
      const data = await executePgQuery(database, sql);
      setResult(data);
      setDurationMs(data.durationMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Query failed";
      setError(message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3 min-w-0">
      <h3 className="text-sm font-medium">SQL Query</h3>
      <form onSubmit={handleRun}>
        <Textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="SELECT * FROM my_table LIMIT 10;"
          className="font-mono text-sm min-h-24 resize-y"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              handleRun(e);
            }
          }}
        />
        <div className="flex items-center gap-2 mt-2">
          <Button type="submit" size="sm" disabled={running || !sql.trim()}>
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            Run
          </Button>
          <span className="text-xs text-muted-foreground">Ctrl+Enter to execute</span>
          {durationMs !== null && (
            <span className="ml-auto text-xs text-muted-foreground">{durationMs}ms</span>
          )}
        </div>
      </form>

      {error && (
        <div className="border border-destructive/50 bg-destructive/10 rounded-lg p-3">
          <p className="text-sm text-destructive font-mono whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {result.rowCount} row{result.rowCount !== 1 ? "s" : ""}
            </span>
            {result.truncated && (
              <Badge variant="outline" className="text-xs">
                showing first 500
              </Badge>
            )}
          </div>
          {result.columns.length > 0 && (
            <div
              className="border rounded-lg max-h-96 overflow-auto"
              style={{ width: 0, minWidth: "100%" }}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    {result.columns.map((col) => (
                      <TableHead key={col} className="font-mono text-xs whitespace-nowrap">
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cant know unique id
                    <TableRow key={i}>
                      {result.columns.map((col) => (
                        <TableCell
                          key={col}
                          className="font-mono text-xs whitespace-nowrap max-w-64 truncate"
                        >
                          {formatCellValue(row[col])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function TableDescription({
  database,
  schema,
  table,
}: {
  database: string;
  schema: string;
  table: string;
}) {
  const [detail, setDetail] = useState<PgTableDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPgTableDetail(database, table, schema);
      setDetail(data);
    } catch (err) {
      toast.error("Failed to load table details", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [database, schema, table]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: This is just a skeleton loader
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Failed to load table details</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 min-w-0">
      <div>
        <h2 className="text-lg font-semibold">
          {schema}.{table}
        </h2>
        <p className="text-sm text-muted-foreground">
          {database} &middot; {detail.columns.length} columns &middot; {detail.indexes.length}{" "}
          indexes &middot; {detail.constraints.length} constraints
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Columns</h3>
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Nullable</TableHead>
                <TableHead>Default</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.columns.map((col) => (
                <TableRow key={col.name}>
                  <TableCell className="text-muted-foreground text-xs">{col.position}</TableCell>
                  <TableCell className="font-mono text-sm">{col.name}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {col.type}
                  </TableCell>
                  <TableCell>
                    {col.nullable ? (
                      <Badge variant="outline" className="text-xs">
                        NULL
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        NOT NULL
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground max-w-48 truncate">
                    {col.default ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {detail.indexes.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Indexes</h3>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Definition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.indexes.map((idx) => (
                  <TableRow key={idx.name}>
                    <TableCell className="font-mono text-sm max-w-[200px] truncate">
                      {idx.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground max-w-md truncate">
                      {idx.definition}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {detail.constraints.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Constraints</h3>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Columns</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.constraints.map((con) => (
                  <TableRow key={con.name}>
                    <TableCell className="font-mono text-sm max-w-[200px] truncate">
                      {con.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {con.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm max-w-[200px] truncate">
                      {con.columns.join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <SqlQueryPanel database={database} />
    </div>
  );
}

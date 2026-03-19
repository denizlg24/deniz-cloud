import { ChevronLeft, ChevronRight, Loader2, Play, Plus, Search, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  dropMongoIndex,
  findMongoDocuments,
  getMongoCollections,
  getMongoDatabases,
  getMongoIndexes,
  getMongoSample,
  type MongoCollection,
  type MongoDatabase,
  type MongoFindResult,
  type MongoIndex,
} from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { MongoSelection } from "./mongo-tab";

interface MongoDetailProps {
  selection: MongoSelection;
  onCreateIndex: (database: string, collection: string) => void;
  onRefreshCollections: (database: string) => void;
}

export function MongoDetail({ selection, onCreateIndex }: MongoDetailProps) {
  if (selection.type === "none") {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Select a database or collection from the tree</p>
      </div>
    );
  }

  if (selection.type === "database") {
    return <MongoDatabaseOverview database={selection.database} />;
  }

  return (
    <MongoCollectionDetail
      database={selection.database}
      collection={selection.collection}
      onCreateIndex={() => onCreateIndex(selection.database, selection.collection)}
    />
  );
}

function MongoDatabaseOverview({ database }: { database: string }) {
  const [dbInfo, setDbInfo] = useState<MongoDatabase | null>(null);
  const [collections, setCollections] = useState<MongoCollection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getMongoDatabases(), getMongoCollections(database)])
      .then(([dbs, cols]) => {
        if (cancelled) return;
        setDbInfo(dbs.find((d) => d.name === database) ?? null);
        setCollections(cols);
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
        <p className="text-sm text-muted-foreground">MongoDB Database</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Size</p>
          <p className="text-2xl font-semibold">{dbInfo ? formatBytes(dbInfo.sizeBytes) : "—"}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Collections</p>
          <p className="text-2xl font-semibold">{collections.length}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Total Documents</p>
          <p className="text-2xl font-semibold">
            {collections.reduce((sum, c) => sum + c.documentCount, 0).toLocaleString()}
          </p>
        </div>
      </div>

      {dbInfo?.isProtected && <Badge variant="secondary">Protected — cannot be dropped</Badge>}

      {collections.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Collections</h3>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Documents</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Indexes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.map((col) => (
                  <TableRow key={col.name}>
                    <TableCell className="font-mono text-sm max-w-[200px] truncate">
                      {col.name}
                    </TableCell>
                    <TableCell>{col.documentCount.toLocaleString()}</TableCell>
                    <TableCell>{formatBytes(col.sizeBytes)}</TableCell>
                    <TableCell>{col.indexCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function MongoCollectionDetail({
  database,
  collection,
  onCreateIndex,
}: {
  database: string;
  collection: string;
  onCreateIndex: () => void;
}) {
  const [indexes, setIndexes] = useState<MongoIndex[]>([]);
  const [sample, setSample] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [droppingIndex, setDroppingIndex] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [idx, docs] = await Promise.all([
        getMongoIndexes(database, collection),
        getMongoSample(database, collection),
      ]);
      setIndexes(idx);
      setSample(docs);
    } catch (err) {
      toast.error("Failed to load collection details", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [database, collection]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDropIndex = async (indexName: string) => {
    setDroppingIndex(indexName);
    try {
      await dropMongoIndex(database, collection, indexName);
      toast.success(`Index "${indexName}" dropped`);
      load();
    } catch (err) {
      toast.error("Failed to drop index", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDroppingIndex(null);
    }
  };

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

  return (
    <div className="p-6 space-y-6 min-w-0">
      <div>
        <h2 className="text-lg font-semibold">{collection}</h2>
        <p className="text-sm text-muted-foreground">
          {database} &middot; {indexes.length} indexes
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Indexes</h3>
          <Button variant="outline" size="sm" onClick={onCreateIndex}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Create Index
          </Button>
        </div>
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Keys</TableHead>
                <TableHead>Options</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {indexes.map((idx) => (
                <TableRow key={idx.name}>
                  <TableCell className="font-mono text-sm max-w-[200px] truncate">
                    {idx.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                    {Object.entries(idx.key)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ")}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {idx.unique && (
                        <Badge variant="outline" className="text-xs">
                          unique
                        </Badge>
                      )}
                      {idx.sparse && (
                        <Badge variant="outline" className="text-xs">
                          sparse
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {idx.name !== "_id_" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={droppingIndex === idx.name}
                        onClick={() => handleDropIndex(idx.name)}
                      >
                        {droppingIndex === idx.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <MongoFindPanel database={database} collection={collection} />

      {sample.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Sample Documents ({sample.length})</h3>
          <div className="space-y-2" style={{ width: 0, minWidth: "100%" }}>
            {sample.map((doc, i) => (
              <pre
                // biome-ignore lint/suspicious/noArrayIndexKey: can;t know unique id for sample documents
                key={i}
                className="border rounded-lg p-3 text-xs font-mono overflow-x-auto bg-muted/50 max-h-48"
              >
                {JSON.stringify(doc, null, 2)}
              </pre>
            ))}
          </div>
        </div>
      )}

      {sample.length === 0 && (
        <p className="text-sm text-muted-foreground">No documents in this collection</p>
      )}
    </div>
  );
}

function MongoFindPanel({ database, collection }: { database: string; collection: string }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("");
  const [limit, setLimit] = useState(20);
  const [skip, setSkip] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MongoFindResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    setSkip(0);
  }, []);

  const handleFind = async (e?: FormEvent) => {
    e?.preventDefault();
    if (running) return;

    setRunning(true);
    setError(null);

    try {
      const data = await findMongoDocuments(database, collection, {
        filter: filter.trim() || undefined,
        sort: sort.trim() || undefined,
        limit,
        skip,
      });
      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Query failed";
      setError(message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const handlePage = (direction: "prev" | "next") => {
    const newSkip = direction === "next" ? skip + limit : Math.max(0, skip - limit);
    setSkip(newSkip);
    setRunning(true);
    setError(null);

    findMongoDocuments(database, collection, {
      filter: filter.trim() || undefined,
      sort: sort.trim() || undefined,
      limit,
      skip: newSkip,
    })
      .then((data) => {
        setResult(data);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Query failed");
        setResult(null);
      })
      .finally(() => setRunning(false));
  };

  return (
    <div className="space-y-3 min-w-0">
      <h3 className="text-sm font-medium flex items-center gap-1.5">
        <Search className="h-3.5 w-3.5" />
        Find Documents
      </h3>
      <form onSubmit={handleFind} className="space-y-2">
        <div>
          <Label className="text-xs">Filter (JSON)</Label>
          <Textarea
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder='{ "status": "active" }'
            className="font-mono text-sm min-h-16 resize-y mt-1"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                handleFind();
              }
            }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Sort (JSON)</Label>
            <Input
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              placeholder='{ "createdAt": -1 }'
              className="font-mono text-sm mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Limit</Label>
            <Input
              type="number"
              value={limit}
              onChange={(e) =>
                setLimit(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 20)))
              }
              className="mt-1"
              min={1}
              max={100}
            />
          </div>
          <div>
            <Label className="text-xs">Skip</Label>
            <Input
              type="number"
              value={skip}
              onChange={(e) => setSkip(Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="mt-1"
              min={0}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={running}>
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            Find
          </Button>
          <span className="text-xs text-muted-foreground">Ctrl+Enter to execute</span>
          {result && (
            <span className="ml-auto text-xs text-muted-foreground">
              {result.totalCount} total &middot; {result.durationMs}ms
            </span>
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
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {skip + 1}–{Math.min(skip + result.documents.length, result.totalCount)} of{" "}
              {result.totalCount}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={skip === 0 || running}
                onClick={() => handlePage("prev")}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={skip + limit >= result.totalCount || running}
                onClick={() => handlePage("next")}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="space-y-2" style={{ width: 0, minWidth: "100%" }}>
            {result.documents.map((doc, i) => (
              <pre
                // biome-ignore lint/suspicious/noArrayIndexKey: can;t know unique id for sample documents
                key={i}
                className="border rounded-lg p-3 text-xs font-mono overflow-x-auto bg-muted/50 max-h-48"
              >
                {JSON.stringify(doc, null, 2)}
              </pre>
            ))}
          </div>
          {result.documents.length === 0 && (
            <p className="text-sm text-muted-foreground">No documents match the filter</p>
          )}
        </div>
      )}
    </div>
  );
}

import { ChevronRight, Loader2, Lock, PanelLeft, Plus, Table2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { getPgDatabases, getPgTables, type PgDatabase, type PgTable } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { PostgresDetail } from "./postgres-detail";
import { CreateDatabaseDialog, CreateTableDialog, DropConfirmDialog } from "./postgres-dialogs";

export type PgSelection =
  | { type: "none" }
  | { type: "database"; database: string }
  | { type: "table"; database: string; schema: string; table: string };

export function PostgresTab() {
  const [databases, setDatabases] = useState<PgDatabase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<PgSelection>({ type: "none" });
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);

  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [dbTables, setDbTables] = useState<Record<string, PgTable[]>>({});
  const [loadingTables, setLoadingTables] = useState<Set<string>>(new Set());

  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [createTableDb, setCreateTableDb] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<
    | { type: "database"; name: string }
    | { type: "table"; database: string; schema: string; table: string }
    | null
  >(null);

  const loadDatabases = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getPgDatabases();
      setDatabases(data);
    } catch (err) {
      toast.error("Failed to load PostgreSQL databases", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases]);

  const loadTables = useCallback(async (dbName: string) => {
    setLoadingTables((prev) => new Set(prev).add(dbName));
    try {
      const tables = await getPgTables(dbName);
      setDbTables((prev) => ({ ...prev, [dbName]: tables }));
    } catch (err) {
      toast.error(`Failed to load tables for ${dbName}`, {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoadingTables((prev) => {
        const next = new Set(prev);
        next.delete(dbName);
        return next;
      });
    }
  }, []);

  const toggleDb = useCallback(
    (dbName: string) => {
      setExpandedDbs((prev) => {
        const next = new Set(prev);
        if (next.has(dbName)) {
          next.delete(dbName);
        } else {
          next.add(dbName);
          if (!dbTables[dbName]) loadTables(dbName);
        }
        return next;
      });
    },
    [dbTables, loadTables],
  );

  const selectDatabase = useCallback(
    (dbName: string) => {
      setSelection({ type: "database", database: dbName });
      toggleDb(dbName);
      setMobileTreeOpen(false);
    },
    [toggleDb],
  );

  const selectTable = useCallback((dbName: string, schema: string, tableName: string) => {
    setSelection({ type: "table", database: dbName, schema, table: tableName });
    setMobileTreeOpen(false);
  }, []);

  const handleDropConfirm = useCallback(async () => {
    if (!dropTarget) return;
    try {
      if (dropTarget.type === "database") {
        const { dropPgDatabase } = await import("@/lib/api");
        await dropPgDatabase(dropTarget.name);
        toast.success(`Database "${dropTarget.name}" dropped`);
        setSelection({ type: "none" });
        setExpandedDbs((prev) => {
          const next = new Set(prev);
          next.delete(dropTarget.name);
          return next;
        });
      } else {
        const { dropPgTable } = await import("@/lib/api");
        await dropPgTable(dropTarget.database, dropTarget.table, dropTarget.schema);
        toast.success(`Table "${dropTarget.table}" dropped`);
        if (selection.type === "table" && selection.table === dropTarget.table) {
          setSelection({ type: "database", database: dropTarget.database });
        }
        loadTables(dropTarget.database);
      }
      loadDatabases();
    } catch (err) {
      toast.error("Drop failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDropTarget(null);
    }
  }, [dropTarget, selection, loadDatabases, loadTables]);

  const treeContent = (
    <>
      <div className="flex items-center justify-between p-3 border-b">
        <span className="text-sm font-medium">Databases</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setCreateDbOpen(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-1">
          {databases.map((db) => (
            <Collapsible key={db.name} open={expandedDbs.has(db.name)}>
              <div className="flex items-center group">
                <button
                  type="button"
                  className="flex items-center gap-1 p-1 hover:bg-muted rounded text-sm flex-1 text-left"
                  onClick={() => selectDatabase(db.name)}
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${expandedDbs.has(db.name) ? "rotate-90" : ""}`}
                  />
                  {db.isProtected && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  <span
                    className={`truncate ${selection.type !== "none" && "database" in selection && selection.database === db.name && selection.type === "database" ? "font-medium" : ""}`}
                  >
                    {db.name}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatBytes(db.sizeBytes)}
                  </span>
                </button>
                {!db.isProtected && (
                  <button
                    type="button"
                    className="p-1 opacity-0 group-hover:opacity-100 hover:text-destructive"
                    onClick={() => setDropTarget({ type: "database", name: db.name })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <CollapsibleContent>
                <div className="ml-4 border-l pl-2 space-y-0.5">
                  {loadingTables.has(db.name) ? (
                    <div className="flex items-center gap-2 p-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading tables...
                    </div>
                  ) : (
                    <>
                      {(dbTables[db.name] ?? []).map((table) => (
                        <div key={table.name} className="flex items-center group/table">
                          <button
                            type="button"
                            className={`flex items-center gap-1.5 p-1 hover:bg-muted rounded text-sm flex-1 text-left ${
                              selection.type === "table" &&
                              selection.database === db.name &&
                              selection.table === table.name
                                ? "bg-muted font-medium"
                                : ""
                            }`}
                            onClick={() => selectTable(db.name, table.schema, table.name)}
                          >
                            <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{table.name}</span>
                          </button>
                          <button
                            type="button"
                            className="p-1 opacity-0 group-hover/table:opacity-100 hover:text-destructive"
                            onClick={() =>
                              setDropTarget({
                                type: "table",
                                database: db.name,
                                schema: table.schema,
                                table: table.name,
                              })
                            }
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="flex items-center gap-1.5 p-1 hover:bg-muted rounded text-xs text-muted-foreground w-full text-left"
                        onClick={() => setCreateTableDb(db.name)}
                      >
                        <Plus className="h-3 w-3" />
                        New table
                      </button>
                    </>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}

          {databases.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No databases found</p>
          )}
        </div>
      </ScrollArea>
    </>
  );

  if (loading) {
    return (
      <div className="flex gap-4 h-[calc(100vh-16rem)]">
        <div className="hidden md:block w-72 border rounded-lg p-3 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: this is just a skeleton loader
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex-1 border rounded-lg p-6">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-4 h-[calc(100vh-16rem)] overflow-hidden">
        <div className="hidden md:flex w-72 shrink-0 border rounded-lg flex-col">{treeContent}</div>

        <Sheet open={mobileTreeOpen} onOpenChange={setMobileTreeOpen}>
          <SheetContent side="left" className="w-72 p-0 flex flex-col">
            <SheetHeader className="sr-only">
              <SheetTitle>Database Explorer</SheetTitle>
              <SheetDescription>Browse PostgreSQL databases and tables</SheetDescription>
            </SheetHeader>
            {treeContent}
          </SheetContent>
        </Sheet>

        <div className="flex-1 min-w-0 border rounded-lg overflow-hidden flex flex-col">
          <div className="md:hidden flex items-center gap-2 p-2 border-b">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setMobileTreeOpen(true)}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              {selection.type === "none"
                ? "Select a database"
                : selection.type === "database"
                  ? selection.database
                  : `${selection.database} / ${selection.table}`}
            </span>
          </div>
          <div className="flex-1 min-w-0 min-h-0 overflow-auto">
            <PostgresDetail selection={selection} onRefreshTables={(db) => loadTables(db)} />
          </div>
        </div>
      </div>

      <CreateDatabaseDialog
        open={createDbOpen}
        onOpenChange={setCreateDbOpen}
        onCreated={() => {
          loadDatabases();
          setCreateDbOpen(false);
        }}
      />

      <CreateTableDialog
        database={createTableDb}
        onOpenChange={(open) => {
          if (!open) setCreateTableDb(null);
        }}
        onCreated={(db) => {
          loadTables(db);
          setCreateTableDb(null);
        }}
      />

      <DropConfirmDialog
        target={dropTarget}
        onOpenChange={(open) => {
          if (!open) setDropTarget(null);
        }}
        onConfirm={handleDropConfirm}
      />
    </>
  );
}

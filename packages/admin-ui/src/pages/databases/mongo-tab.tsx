import { ChevronRight, Loader2, Lock, PanelLeft, Plus, Trash2 } from "lucide-react";
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
import {
  getMongoCollections,
  getMongoDatabases,
  type MongoCollection,
  type MongoDatabase,
} from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { MongoDetail } from "./mongo-detail";
import {
  CreateMongoCollectionDialog,
  CreateMongoDatabaseDialog,
  CreateMongoIndexDialog,
  DropMongoConfirmDialog,
} from "./mongo-dialogs";

export type MongoSelection =
  | { type: "none" }
  | { type: "database"; database: string }
  | { type: "collection"; database: string; collection: string };

export function MongoTab() {
  const [databases, setDatabases] = useState<MongoDatabase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<MongoSelection>({ type: "none" });
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);

  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [dbCollections, setDbCollections] = useState<Record<string, MongoCollection[]>>({});
  const [loadingCollections, setLoadingCollections] = useState<Set<string>>(new Set());

  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [createCollDb, setCreateCollDb] = useState<string | null>(null);
  const [createIndexTarget, setCreateIndexTarget] = useState<{
    database: string;
    collection: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<
    | { type: "database"; name: string }
    | { type: "collection"; database: string; collection: string }
    | null
  >(null);

  const loadDatabases = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMongoDatabases();
      setDatabases(data);
    } catch (err) {
      toast.error("Failed to load MongoDB databases", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases]);

  const loadCollections = useCallback(async (dbName: string) => {
    setLoadingCollections((prev) => new Set(prev).add(dbName));
    try {
      const cols = await getMongoCollections(dbName);
      setDbCollections((prev) => ({ ...prev, [dbName]: cols }));
    } catch (err) {
      toast.error(`Failed to load collections for ${dbName}`, {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoadingCollections((prev) => {
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
          if (!dbCollections[dbName]) loadCollections(dbName);
        }
        return next;
      });
    },
    [dbCollections, loadCollections],
  );

  const selectDatabase = useCallback(
    (dbName: string) => {
      setSelection({ type: "database", database: dbName });
      toggleDb(dbName);
      setMobileTreeOpen(false);
    },
    [toggleDb],
  );

  const selectCollection = useCallback((dbName: string, collName: string) => {
    setSelection({
      type: "collection",
      database: dbName,
      collection: collName,
    });
    setMobileTreeOpen(false);
  }, []);

  const handleDropConfirm = useCallback(async () => {
    if (!dropTarget) return;
    try {
      if (dropTarget.type === "database") {
        const { dropMongoDatabase } = await import("@/lib/api");
        await dropMongoDatabase(dropTarget.name);
        toast.success(`Database "${dropTarget.name}" dropped`);
        setSelection({ type: "none" });
        setExpandedDbs((prev) => {
          const next = new Set(prev);
          next.delete(dropTarget.name);
          return next;
        });
      } else {
        const { dropMongoCollection } = await import("@/lib/api");
        await dropMongoCollection(dropTarget.database, dropTarget.collection);
        toast.success(`Collection "${dropTarget.collection}" dropped`);
        if (selection.type === "collection" && selection.collection === dropTarget.collection) {
          setSelection({ type: "database", database: dropTarget.database });
        }
        loadCollections(dropTarget.database);
      }
      loadDatabases();
    } catch (err) {
      toast.error("Drop failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDropTarget(null);
    }
  }, [dropTarget, selection, loadDatabases, loadCollections]);

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

                  <span
                    className={`truncate ${selection.type !== "none" && selection.database === db.name && selection.type === "database" ? "font-medium" : ""}`}
                  >
                    {db.name}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatBytes(db.sizeBytes)}
                  </span>
                </button>
                {db.isProtected && (
                  <Lock className="m-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                {!db.isProtected && (
                  <button
                    type="button"
                    className="p-1 text-destructive"
                    onClick={() => setDropTarget({ type: "database", name: db.name })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <CollapsibleContent>
                <div className="ml-4 border-l pl-2 space-y-0.5">
                  {loadingCollections.has(db.name) ? (
                    <div className="flex items-center gap-2 p-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading collections...
                    </div>
                  ) : (
                    <>
                      {(dbCollections[db.name] ?? []).map((col) => (
                        <div key={col.name} className="flex items-center group/col">
                          <button
                            type="button"
                            className={`flex items-center gap-1.5 p-1 hover:bg-muted rounded text-sm flex-1 text-left ${
                              selection.type === "collection" &&
                              selection.database === db.name &&
                              selection.collection === col.name
                                ? "bg-muted font-medium"
                                : ""
                            }`}
                            onClick={() => selectCollection(db.name, col.name)}
                          >
                            <span className="truncate">{col.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {col.documentCount}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="p-1 opacity-0 group-hover/col:opacity-100 hover:text-destructive"
                            onClick={() =>
                              setDropTarget({
                                type: "collection",
                                database: db.name,
                                collection: col.name,
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
                        onClick={() => setCreateCollDb(db.name)}
                      >
                        <Plus className="h-3 w-3" />
                        New collection
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
              <SheetDescription>Browse MongoDB databases and collections</SheetDescription>
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
                  : `${selection.database} / ${selection.collection}`}
            </span>
          </div>
          <div className="flex-1 min-w-0 min-h-0 overflow-auto">
            <MongoDetail
              selection={selection}
              onCreateIndex={(database, collection) =>
                setCreateIndexTarget({ database, collection })
              }
              onRefreshCollections={(db) => loadCollections(db)}
            />
          </div>
        </div>
      </div>

      <CreateMongoDatabaseDialog
        open={createDbOpen}
        onOpenChange={setCreateDbOpen}
        onCreated={() => {
          loadDatabases();
          setCreateDbOpen(false);
        }}
      />

      <CreateMongoCollectionDialog
        database={createCollDb}
        onOpenChange={(open) => {
          if (!open) setCreateCollDb(null);
        }}
        onCreated={(db) => {
          loadCollections(db);
          setCreateCollDb(null);
        }}
      />

      <CreateMongoIndexDialog
        target={createIndexTarget}
        onOpenChange={(open) => {
          if (!open) setCreateIndexTarget(null);
        }}
        onCreated={() => {
          setCreateIndexTarget(null);
        }}
      />

      <DropMongoConfirmDialog
        target={dropTarget}
        onOpenChange={(open) => {
          if (!open) setDropTarget(null);
        }}
        onConfirm={handleDropConfirm}
      />
    </>
  );
}

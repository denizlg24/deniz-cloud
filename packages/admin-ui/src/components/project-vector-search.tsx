import { Braces, Copy, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createProjectVectorIndex,
  deleteProjectVectorIndex,
  getProjectVectorIndexes,
  type ProjectVectorIndex,
  type ProjectVectorSearchOverview,
  type VectorQuantization,
  type VectorSimilarity,
} from "@/lib/api";

interface ProjectVectorSearchProps {
  projectId: string;
  databaseName: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

export function ProjectVectorSearch({ projectId, databaseName }: ProjectVectorSearchProps) {
  const [overview, setOverview] = useState<ProjectVectorSearchOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectVectorIndex | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setOverview(await getProjectVectorIndexes(projectId));
    } catch (error) {
      toast.error(`Could not load vector indexes: ${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dropIndex = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProjectVectorIndex(projectId, deleteTarget.collection, deleteTarget.name);
      toast.success("Vector index removed");
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      toast.error(`Could not remove index: ${errorMessage(error)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="vector-search-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <h2 id="vector-search-heading" className="text-lg font-medium">
              MongoDB Vector Search
            </h2>
            {overview && (
              <Badge variant={overview.mongot.status === "ready" ? "secondary" : "destructive"}>
                mongot {overview.mongot.status}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Semantic indexes in <code>{databaseName}</code>. Meilisearch remains available for text
            search.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refresh()}
            aria-label="Refresh vector indexes"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={
              !overview ||
              overview.mongot.status !== "ready" ||
              overview.indexes.length >= overview.maxIndexes
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            New index
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-32" />
      ) : overview?.mongot.status === "unavailable" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">Vector index management is unavailable</p>
          <p className="mt-1 text-muted-foreground">
            {overview.mongot.message ?? "mongot is not ready"}
          </p>
        </div>
      ) : overview && overview.indexes.length > 0 ? (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Index</TableHead>
                <TableHead>Vector field</TableHead>
                <TableHead>Shape</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.indexes.map((index) => (
                <TableRow key={`${index.collection}:${index.name}`}>
                  <TableCell>
                    <div className="font-medium">{index.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {index.collection}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{index.path}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {index.numDimensions}d · {index.similarity} · {index.quantization}
                  </TableCell>
                  <TableCell>
                    <Badge variant={index.queryable ? "secondary" : "outline"}>
                      {index.queryable ? "READY" : index.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(index)}
                      aria-label={`Delete ${index.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-6 text-center">
          <Braces className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No vector indexes</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create one after storing embeddings in a collection.
          </p>
        </div>
      )}

      {overview && (
        <p className="text-xs text-muted-foreground">
          {overview.indexes.length} of {overview.maxIndexes} project indexes used
        </p>
      )}

      <CreateVectorIndexDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        collections={overview?.collections ?? []}
        projectId={projectId}
        onCreated={refresh}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete vector index?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <strong>{deleteTarget?.name}</strong>. Documents and their embedding
              fields are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void dropIndex()} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete index
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

interface CreateVectorIndexDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: string[];
  projectId: string;
  onCreated: () => Promise<void>;
}

function CreateVectorIndexDialog({
  open,
  onOpenChange,
  collections,
  projectId,
  onCreated,
}: CreateVectorIndexDialogProps) {
  const [collection, setCollection] = useState("");
  const [name, setName] = useState("vector_index");
  const [path, setPath] = useState("embedding");
  const [dimensions, setDimensions] = useState("1536");
  const [similarity, setSimilarity] = useState<VectorSimilarity>("cosine");
  const [quantization, setQuantization] = useState<VectorQuantization>("none");
  const [filters, setFilters] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && !collection && collections[0]) setCollection(collections[0]);
  }, [collection, collections, open]);

  const sample = useMemo(
    () =>
      `Model.aggregate([\n  { $vectorSearch: {\n    index: "${name || "vector_index"}",\n    path: "${path || "embedding"}",\n    queryVector: embedding,\n    numCandidates: 100,\n    limit: 10\n  } }\n])`,
    [name, path],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const numDimensions = Number(dimensions);
    if (
      !collection ||
      !Number.isInteger(numDimensions) ||
      numDimensions < 1 ||
      numDimensions > 4096
    ) {
      toast.error("Choose a collection and dimensions between 1 and 4096");
      return;
    }
    setSaving(true);
    try {
      await createProjectVectorIndex(projectId, {
        collection,
        name,
        path,
        numDimensions,
        similarity,
        quantization,
        filterPaths: filters
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      toast.success("Vector index build started");
      onOpenChange(false);
      await onCreated();
    } catch (error) {
      toast.error(`Could not create index: ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Create vector index</DialogTitle>
            <DialogDescription>
              The dimensions must exactly match the embedding model output.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vector-collection">Collection</Label>
              <Select value={collection} onValueChange={setCollection}>
                <SelectTrigger id="vector-collection">
                  <SelectValue placeholder="Select collection" />
                </SelectTrigger>
                <SelectContent>
                  {collections.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vector-index-name">Index name</Label>
              <Input
                id="vector-index-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                pattern="[A-Za-z_][A-Za-z0-9_.-]*"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vector-path">Embedding field</Label>
              <Input
                id="vector-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                required
                placeholder="embedding"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vector-dimensions">Dimensions</Label>
              <Input
                id="vector-dimensions"
                type="number"
                min={1}
                max={4096}
                value={dimensions}
                onChange={(e) => setDimensions(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vector-similarity">Similarity</Label>
              <Select
                value={similarity}
                onValueChange={(value) => setSimilarity(value as VectorSimilarity)}
              >
                <SelectTrigger id="vector-similarity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cosine">Cosine</SelectItem>
                  <SelectItem value="dotProduct">Dot product</SelectItem>
                  <SelectItem value="euclidean">Euclidean</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vector-quantization">Quantization</Label>
              <Select
                value={quantization}
                onValueChange={(value) => setQuantization(value as VectorQuantization)}
              >
                <SelectTrigger id="vector-quantization">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="scalar">Scalar</SelectItem>
                  <SelectItem value="binary">Binary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="vector-filters">Filter fields (optional, comma-separated)</Label>
              <Input
                id="vector-filters"
                value={filters}
                onChange={(e) => setFilters(e.target.value)}
                placeholder="tenantId, category"
              />
            </div>
          </div>
          <div className="relative rounded-md bg-muted p-3">
            <pre className="overflow-x-auto text-xs">
              <code>{sample}</code>
            </pre>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1"
              aria-label="Copy Mongoose example"
              onClick={() =>
                void navigator.clipboard
                  .writeText(sample)
                  .then(() => toast.success("Example copied"))
              }
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || collections.length === 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start build
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

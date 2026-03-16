import { Loader2, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { createMongoCollection, createMongoDatabase, createMongoIndex } from "@/lib/api";

interface CreateMongoDatabaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateMongoDatabaseDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateMongoDatabaseDialogProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await createMongoDatabase(name.trim());
      toast.success(`Database "${name}" created`);
      setName("");
      onCreated();
    } catch (err) {
      toast.error("Failed to create database", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setName("");
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create MongoDB Database</DialogTitle>
            <DialogDescription>
              A database will be created with an initial _init collection.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="mongo-db-name">Database name</Label>
            <Input
              id="mongo-db-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my_database"
              className="mt-1.5"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CreateMongoCollectionDialogProps {
  database: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (database: string) => void;
}

export function CreateMongoCollectionDialog({
  database,
  onOpenChange,
  onCreated,
}: CreateMongoCollectionDialogProps) {
  const [name, setName] = useState("");
  const [capped, setCapped] = useState(false);
  const [size, setSize] = useState("");
  const [max, setMax] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!database || !name.trim()) return;
    setSubmitting(true);
    try {
      await createMongoCollection(database, {
        name: name.trim(),
        capped: capped || undefined,
        size: capped && size ? parseInt(size, 10) : undefined,
        max: capped && max ? parseInt(max, 10) : undefined,
      });
      toast.success(`Collection "${name}" created in ${database}`);
      setName("");
      setCapped(false);
      setSize("");
      setMax("");
      onCreated(database);
    } catch (err) {
      toast.error("Failed to create collection", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={database !== null}
      onOpenChange={(v) => {
        if (!v) {
          setName("");
          setCapped(false);
          setSize("");
          setMax("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Collection in {database}</DialogTitle>
            <DialogDescription>
              Create a new collection. Optionally configure as capped.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div>
              <Label htmlFor="mongo-coll-name">Collection name</Label>
              <Input
                id="mongo-coll-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my_collection"
                className="mt-1.5"
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="capped"
                checked={capped}
                onCheckedChange={(v) => setCapped(v === true)}
              />
              <Label htmlFor="capped">Capped collection</Label>
            </div>

            {capped && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="capped-size" className="text-xs">
                    Max size (bytes)
                  </Label>
                  <Input
                    id="capped-size"
                    type="number"
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    placeholder="1048576"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="capped-max" className="text-xs">
                    Max documents
                  </Label>
                  <Input
                    id="capped-max"
                    type="number"
                    value={max}
                    onChange={(e) => setMax(e.target.value)}
                    placeholder="1000"
                    className="mt-1"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface IndexField {
  name: string;
  direction: "1" | "-1";
}

interface CreateMongoIndexDialogProps {
  target: { database: string; collection: string } | null;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateMongoIndexDialog({
  target,
  onOpenChange,
  onCreated,
}: CreateMongoIndexDialogProps) {
  const [fields, setFields] = useState<IndexField[]>([{ name: "", direction: "1" }]);
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [indexName, setIndexName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const updateField = (index: number, patch: Partial<IndexField>) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target || fields.length === 0 || !fields.every((f) => f.name.trim())) return;

    setSubmitting(true);
    try {
      await createMongoIndex(target.database, target.collection, {
        fields: fields.map((f) => ({
          name: f.name,
          direction: parseInt(f.direction, 10) as 1 | -1,
        })),
        unique: unique || undefined,
        sparse: sparse || undefined,
        name: indexName.trim() || undefined,
      });
      toast.success("Index created");
      setFields([{ name: "", direction: "1" }]);
      setUnique(false);
      setSparse(false);
      setIndexName("");
      onCreated();
    } catch (err) {
      toast.error("Failed to create index", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const valid = fields.length > 0 && fields.every((f) => f.name.trim());

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(v) => {
        if (!v) {
          setFields([{ name: "", direction: "1" }]);
          setUnique(false);
          setSparse(false);
          setIndexName("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Index</DialogTitle>
            <DialogDescription>
              {target
                ? `Create an index on ${target.database}.${target.collection}`
                : "Create an index"}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div>
              <Label htmlFor="idx-name">Index name (optional)</Label>
              <Input
                id="idx-name"
                value={indexName}
                onChange={(e) => setIndexName(e.target.value)}
                placeholder="Auto-generated if empty"
                className="mt-1.5"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Fields</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFields((prev) => [...prev, { name: "", direction: "1" }])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add field
                </Button>
              </div>

              <div className="space-y-2">
                {fields.map((field, i) => (
                  <div key={field.name} className="flex items-center gap-2">
                    <Input
                      value={field.name}
                      onChange={(e) => updateField(i, { name: e.target.value })}
                      placeholder="field_name"
                      className="flex-1 h-8 text-sm"
                      required
                    />
                    <Select
                      value={field.direction}
                      onValueChange={(v) => updateField(i, { direction: v as "1" | "-1" })}
                    >
                      <SelectTrigger className="w-24 h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Asc (1)</SelectItem>
                        <SelectItem value="-1">Desc (-1)</SelectItem>
                      </SelectContent>
                    </Select>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeField(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="idx-unique"
                  checked={unique}
                  onCheckedChange={(v) => setUnique(v === true)}
                />
                <Label htmlFor="idx-unique" className="text-sm">
                  Unique
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="idx-sparse"
                  checked={sparse}
                  onCheckedChange={(v) => setSparse(v === true)}
                />
                <Label htmlFor="idx-sparse" className="text-sm">
                  Sparse
                </Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting || !valid}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Index
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DropMongoConfirmDialogProps {
  target:
    | { type: "database"; name: string }
    | { type: "collection"; database: string; collection: string }
    | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DropMongoConfirmDialog({
  target,
  onOpenChange,
  onConfirm,
}: DropMongoConfirmDialogProps) {
  const label =
    target?.type === "database"
      ? `database "${target.name}"`
      : target?.type === "collection"
        ? `collection "${target.collection}" from ${target.database}`
        : "";

  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Drop {target?.type}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently drop {label}. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Drop
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
import { createPgDatabase, createPgTable, type PgColumnInput } from "@/lib/api";

const PG_TYPES = [
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
];

interface CreateDatabaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateDatabaseDialog({ open, onOpenChange, onCreated }: CreateDatabaseDialogProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await createPgDatabase(name.trim());
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
            <DialogTitle>Create PostgreSQL Database</DialogTitle>
            <DialogDescription>
              Name must start with a letter or underscore, alphanumeric and underscores only.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="pg-db-name">Database name</Label>
            <Input
              id="pg-db-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my_database"
              className="mt-1.5"
              pattern="^[a-zA-Z_][a-zA-Z0-9_]{0,62}$"
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

interface ColumnFormRow {
  name: string;
  type: string;
  nullable: boolean;
  default: string;
  primaryKey: boolean;
}

const emptyColumn = (): ColumnFormRow => ({
  name: "",
  type: "text",
  nullable: true,
  default: "",
  primaryKey: false,
});

interface CreateTableDialogProps {
  database: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (database: string) => void;
}

export function CreateTableDialog({ database, onOpenChange, onCreated }: CreateTableDialogProps) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnFormRow[]>([emptyColumn()]);
  const [submitting, setSubmitting] = useState(false);

  const updateColumn = (index: number, patch: Partial<ColumnFormRow>) => {
    setColumns((prev) => prev.map((col, i) => (i === index ? { ...col, ...patch } : col)));
  };

  const removeColumn = (index: number) => {
    setColumns((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!database || !tableName.trim() || columns.length === 0) return;

    const apiColumns: PgColumnInput[] = columns.map((col) => ({
      name: col.name,
      type: col.type,
      nullable: col.nullable,
      default: col.default || undefined,
      primaryKey: col.primaryKey,
    }));

    setSubmitting(true);
    try {
      await createPgTable(database, tableName.trim(), apiColumns);
      toast.success(`Table "${tableName}" created in ${database}`);
      setTableName("");
      setColumns([emptyColumn()]);
      onCreated(database);
    } catch (err) {
      toast.error("Failed to create table", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const valid = tableName.trim() && columns.length > 0 && columns.every((c) => c.name.trim());

  return (
    <Dialog
      open={database !== null}
      onOpenChange={(v) => {
        if (!v) {
          setTableName("");
          setColumns([emptyColumn()]);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Table in {database}</DialogTitle>
            <DialogDescription>Define the table name and columns.</DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div>
              <Label htmlFor="pg-table-name">Table name</Label>
              <Input
                id="pg-table-name"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="my_table"
                className="mt-1.5"
                pattern="^[a-zA-Z_][a-zA-Z0-9_]{0,62}$"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Columns</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setColumns((prev) => [...prev, emptyColumn()])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add column
                </Button>
              </div>

              <div className="space-y-3">
                {columns.map((col, i) => (
                  <div key={col.name} className="flex items-start gap-2 border rounded-lg p-3">
                    <div className="flex-1 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Name</Label>
                          <Input
                            value={col.name}
                            onChange={(e) => updateColumn(i, { name: e.target.value })}
                            placeholder="column_name"
                            className="mt-1 h-8 text-sm"
                            required
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Type</Label>
                          <Select
                            value={col.type}
                            onValueChange={(v) => updateColumn(i, { type: v })}
                          >
                            <SelectTrigger className="mt-1 h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PG_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <Checkbox
                            id={`pk-${i}`}
                            checked={col.primaryKey}
                            onCheckedChange={(v) => updateColumn(i, { primaryKey: v === true })}
                          />
                          <Label htmlFor={`pk-${i}`} className="text-xs">
                            Primary Key
                          </Label>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Checkbox
                            id={`nullable-${i}`}
                            checked={col.nullable}
                            onCheckedChange={(v) => updateColumn(i, { nullable: v === true })}
                          />
                          <Label htmlFor={`nullable-${i}`} className="text-xs">
                            Nullable
                          </Label>
                        </div>
                        <div className="flex-1">
                          <Input
                            value={col.default}
                            onChange={(e) => updateColumn(i, { default: e.target.value })}
                            placeholder="Default value"
                            className="h-7 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                    {columns.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 mt-5"
                        onClick={() => removeColumn(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting || !valid}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Table
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DropConfirmDialogProps {
  target:
    | { type: "database"; name: string }
    | { type: "table"; database: string; schema: string; table: string }
    | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DropConfirmDialog({ target, onOpenChange, onConfirm }: DropConfirmDialogProps) {
  const label =
    target?.type === "database"
      ? `database "${target.name}"`
      : target?.type === "table"
        ? `table "${target.table}" from ${target.database}`
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

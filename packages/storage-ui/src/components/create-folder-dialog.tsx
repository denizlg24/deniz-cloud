import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFolderCache } from "@/hooks/use-folder-cache";
import { createFolder } from "@/lib/api";

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string;
}

export function CreateFolderDialog({ open, onOpenChange, parentId }: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { invalidateFolder, updateCached } = useFolderCache();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setIsSubmitting(true);

    updateCached(parentId, (data) => ({
      ...data,
      subfolders: [
        ...data.subfolders,
        {
          id: crypto.randomUUID(),
          name: trimmedName,
          path: `${data.folder.path}/${trimmedName}`,
          parentId,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    setName("");
    onOpenChange(false);

    try {
      await createFolder(trimmedName, parentId);
      invalidateFolder(parentId);
      toast.success(`Created folder "${trimmedName}"`);
    } catch (err) {
      invalidateFolder(parentId);
      toast.error(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-2 py-2">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              autoFocus
              placeholder="Folder name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

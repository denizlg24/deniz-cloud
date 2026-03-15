import { type FormEvent, useEffect, useState } from "react";
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
import { renameFile, renameFolder } from "@/lib/api";

interface RenameTarget {
  id: string;
  name: string;
  type: "file" | "folder";
  parentFolderId: string;
}

interface RenameDialogProps {
  target: RenameTarget | null;
  onClose: () => void;
}

export function RenameDialog({ target, onClose }: RenameDialogProps) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { invalidateFolder } = useFolderCache();

  useEffect(() => {
    if (target) setName(target.name);
  }, [target]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target || !name.trim()) return;

    setIsSubmitting(true);
    try {
      if (target.type === "folder") {
        await renameFolder(target.id, name.trim());
      } else {
        await renameFile(target.id, name.trim());
      }
      invalidateFolder(target.parentFolderId);
      toast.success(`Renamed to "${name.trim()}"`);
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleClose() {
    setName("");
    onClose();
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename {target?.type}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-2 py-2">
            <Label htmlFor="rename-input">Name</Label>
            <Input
              id="rename-input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => {
                if (target?.type === "file") {
                  const dotIdx = e.target.value.lastIndexOf(".");
                  if (dotIdx > 0) {
                    e.target.setSelectionRange(0, dotIdx);
                  }
                }
              }}
            />
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || name === target?.name || isSubmitting}>
              {isSubmitting ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

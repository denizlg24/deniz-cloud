import { useState } from "react";
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
import { useFolderCache } from "@/hooks/use-folder-cache";
import { deleteFile, deleteFolder } from "@/lib/api";

interface DeleteTarget {
  id: string;
  name: string;
  type: "file" | "folder";
  parentFolderId: string;
}

interface DeleteDialogProps {
  target: DeleteTarget | null;
  onClose: () => void;
}

export function DeleteDialog({ target, onClose }: DeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const { invalidateFolder, updateCached } = useFolderCache();

  async function handleDelete() {
    if (!target) return;

    setIsDeleting(true);

    updateCached(target.parentFolderId, (data) => ({
      ...data,
      subfolders:
        target.type === "folder"
          ? data.subfolders.filter((f) => f.id !== target.id)
          : data.subfolders,
      files: target.type === "file" ? data.files.filter((f) => f.id !== target.id) : data.files,
    }));
    onClose();

    try {
      if (target.type === "folder") {
        await deleteFolder(target.id);
      } else {
        await deleteFile(target.id);
      }
      toast.success(`Deleted "${target.name}"`);
    } catch (err) {
      invalidateFolder(target.parentFolderId);
      const msg = err instanceof Error ? err.message : "Failed to delete";
      if (msg.includes("FOLDER_NOT_EMPTY")) {
        toast.error("Folder is not empty. Delete its contents first.");
      } else {
        toast.error(msg);
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <AlertDialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {target?.type}?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete &quot;{target?.name}&quot;? This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

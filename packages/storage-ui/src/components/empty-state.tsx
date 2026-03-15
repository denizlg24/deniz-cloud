import { FolderOpenIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  onUpload?: () => void;
  onCreateFolder?: () => void;
}

export function EmptyState({ onUpload, onCreateFolder }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="rounded-2xl bg-muted/50 p-4">
        <FolderOpenIcon className="size-10 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">This folder is empty</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload files or create a folder to get started
        </p>
      </div>
      <div className="flex gap-2">
        {onUpload && (
          <Button size="sm" onClick={onUpload}>
            <UploadIcon className="size-4" />
            Upload
          </Button>
        )}
        {onCreateFolder && (
          <Button size="sm" variant="outline" onClick={onCreateFolder}>
            New folder
          </Button>
        )}
      </div>
    </div>
  );
}

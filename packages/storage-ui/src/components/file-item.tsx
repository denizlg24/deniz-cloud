import { DownloadIcon, EyeIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { FileIconDisplay } from "@/components/file-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes, formatDate, isPreviewable } from "@/lib/format";
import type { StorageFile, ViewMode } from "@/lib/types";

interface FileItemProps {
  file: StorageFile;
  view: ViewMode;
  onPreview: (file: StorageFile) => void;
  onDownload: (file: StorageFile) => void;
  onRename: (file: StorageFile) => void;
  onDelete: (file: StorageFile) => void;
}

export function FileItem({ file, view, onPreview, onDownload, onRename, onDelete }: FileItemProps) {
  const canPreview = isPreviewable(file.mimeType);
  const isImage = file.mimeType?.startsWith("image/") ?? false;

  const handleClick = () => onPreview(file);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  if (view === "list") {
    return (
      /* biome-ignore lint/a11y/useSemanticElements: needed for non nested buttons */
      <div
        role="button"
        tabIndex={0}
        className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/50 cursor-pointer"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <FileIconDisplay mimeType={file.mimeType} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm">{file.filename}</span>
        <span className="hidden text-xs text-muted-foreground md:block">
          {formatBytes(file.sizeBytes)}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:block">
          {formatDate(file.updatedAt)}
        </span>
        <FileActions
          file={file}
          canPreview={canPreview}
          onPreview={onPreview}
          onDownload={onDownload}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>
    );
  }

  return (
    /* biome-ignore lint/a11y/useSemanticElements: needed for non nested buttons */
    <div
      role="button"
      tabIndex={0}
      className="group relative flex flex-col items-center gap-2 rounded-xl p-3 transition-colors hover:bg-accent/50 cursor-pointer"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute right-1 top-1 sm:opacity-0 transition-opacity sm:group-hover:opacity-100">
        <FileActions
          file={file}
          canPreview={canPreview}
          onPreview={onPreview}
          onDownload={onDownload}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>

      {isImage ? (
        <div className="flex size-10 items-center justify-center overflow-hidden rounded-lg">
          <FileIconDisplay mimeType={file.mimeType} className="size-10" />
        </div>
      ) : (
        <FileIconDisplay mimeType={file.mimeType} className="size-10" />
      )}

      <div className="w-full text-center">
        <p className="truncate text-xs font-medium">{file.filename}</p>
        <p className="text-[10px] text-muted-foreground">{formatBytes(file.sizeBytes)}</p>
      </div>
    </div>
  );
}

function FileActions({
  file,
  canPreview,
  onPreview,
  onDownload,
  onRename,
  onDelete,
}: {
  file: StorageFile;
  canPreview: boolean;
  onPreview: (file: StorageFile) => void;
  onDownload: (file: StorageFile) => void;
  onRename: (file: StorageFile) => void;
  onDelete: (file: StorageFile) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {canPreview && (
          <DropdownMenuItem onClick={() => onPreview(file)}>
            <EyeIcon className="size-4" />
            Preview
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onDownload(file)}>
          <DownloadIcon className="size-4" />
          Download
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onRename(file)}>
          <PencilIcon className="size-4" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDelete(file)}
        >
          <Trash2Icon className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

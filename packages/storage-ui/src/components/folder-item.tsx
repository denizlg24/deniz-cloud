import { FolderIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/format";
import type { StorageFolder, ViewMode } from "@/lib/types";

interface FolderItemProps {
  folder: StorageFolder;
  view: ViewMode;
  onOpen: (folder: StorageFolder) => void;
  onRename: (folder: StorageFolder) => void;
  onDelete: (folder: StorageFolder) => void;
  onHover?: (folder: StorageFolder) => void;
}

export function FolderItem({ folder, view, onOpen, onRename, onDelete, onHover }: FolderItemProps) {
  const handleOpen = () => onOpen(folder);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleOpen();
    }
  };

  if (view === "list") {
    return (
      /* biome-ignore lint/a11y/useSemanticElements: needed for non nested buttons */
      <div
        role="button"
        tabIndex={0}
        className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/50 cursor-pointer"
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => onHover?.(folder)}
      >
        <FolderIcon className="size-5 shrink-0 text-amber-500 fill-amber-500/20" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{folder.name}</span>
        <span className="hidden text-xs text-muted-foreground sm:block">
          {formatDate(folder.createdAt)}
        </span>
        <FolderActions folder={folder} onRename={onRename} onDelete={onDelete} />
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: needed to avoid nested buttons
    <div
      role="button"
      tabIndex={0}
      className="group relative flex flex-col items-center gap-2 rounded-xl p-3 transition-colors hover:bg-accent/50 cursor-pointer"
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => onHover?.(folder)}
    >
      <div className="absolute right-1 top-1 sm:opacity-0 transition-opacity sm:group-hover:opacity-100">
        <FolderActions folder={folder} onRename={onRename} onDelete={onDelete} />
      </div>
      <FolderIcon className="size-10 text-amber-500 fill-amber-500/20" />
      <span className="w-full truncate text-center text-xs font-medium">{folder.name}</span>
    </div>
  );
}

function FolderActions({
  folder,
  onRename,
  onDelete,
}: {
  folder: StorageFolder;
  onRename: (folder: StorageFolder) => void;
  onDelete: (folder: StorageFolder) => void;
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
        <DropdownMenuItem onClick={() => onRename(folder)}>
          <PencilIcon className="size-4" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDelete(folder)}
        >
          <Trash2Icon className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

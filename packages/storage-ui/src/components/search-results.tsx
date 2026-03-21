import { FolderIcon, FolderOpenIcon, SearchIcon } from "lucide-react";
import { FileIconDisplay } from "@/components/file-icon";
import { formatBytes, formatDate } from "@/lib/format";
import type { SearchHit } from "@/lib/types";

interface SearchResultsProps {
  hits: SearchHit[];
  isLoading: boolean;
  query: string;
  onClickFile: (hit: SearchHit) => void;
  onClickFolder: (hit: SearchHit) => void;
}

function parentPathDisplay(fullPath: string): string {
  const parts = fullPath.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  parts.pop();
  return parts
    .map((p) => {
      if (p.startsWith("user_root_")) return "My Files";
      if (p === "shared") return "Shared";
      return p;
    })
    .join(" / ");
}

export function SearchResults({
  hits,
  isLoading,
  query,
  onClickFile,
  onClickFolder,
}: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <SearchIcon className="size-8 animate-pulse" />
        <p className="text-sm">Searching...</p>
      </div>
    );
  }

  if (hits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <SearchIcon className="size-8" />
        <p className="text-sm">No results for "{query}"</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-muted-foreground mb-2">
        {hits.length} result{hits.length !== 1 ? "s" : ""} for "{query}"
      </p>
      {hits.map((hit) => (
        <button
          key={hit.id}
          type="button"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent transition-colors w-full"
          onClick={() => (hit.type === "folder" ? onClickFolder(hit) : onClickFile(hit))}
        >
          {hit.type === "folder" ? (
            <FolderIcon className="size-5 shrink-0 text-blue-500 fill-blue-500/20" />
          ) : (
            <FileIconDisplay mimeType={hit.mimeType ?? null} className="shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{hit.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {parentPathDisplay(hit.path)}
              {hit.type === "file" && hit.sizeBytes != null && (
                <span> · {formatBytes(hit.sizeBytes)}</span>
              )}
              <span> · {formatDate(new Date(hit.createdAt).toISOString())}</span>
            </p>
          </div>

          {hit.type === "folder" && (
            <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      ))}
    </div>
  );
}

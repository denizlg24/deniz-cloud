import { EmptyState } from "@/components/empty-state";
import { FileGridSkeleton } from "@/components/file-grid-skeleton";
import { FileItem } from "@/components/file-item";
import { FolderItem } from "@/components/folder-item";
import type {
  FolderContents,
  SortDirection,
  SortField,
  StorageFile,
  StorageFolder,
  ViewMode,
} from "@/lib/types";

interface FileGridProps {
  contents: FolderContents | null;
  isLoading: boolean;
  view: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  onOpenFolder: (folder: StorageFolder) => void;
  onPreviewFile: (file: StorageFile) => void;
  onDownloadFile: (file: StorageFile) => void;
  onRenameFolder: (folder: StorageFolder) => void;
  onDeleteFolder: (folder: StorageFolder) => void;
  onRenameFile: (file: StorageFile) => void;
  onDeleteFile: (file: StorageFile) => void;
  onUpload: () => void;
  onCreateFolder: () => void;
  onHoverFolder?: (folder: StorageFolder) => void;
}

function sortItems<T>(
  items: T[],
  field: SortField,
  direction: SortDirection,
  getName: (item: T) => string,
  getDate: (item: T) => string,
  getSize?: (item: T) => number,
): T[] {
  const sorted = [...items];
  const dir = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (field) {
      case "name":
        return dir * getName(a).localeCompare(getName(b), undefined, { sensitivity: "base" });
      case "date":
        return dir * (new Date(getDate(a)).getTime() - new Date(getDate(b)).getTime());
      case "size":
        return getSize
          ? dir * (getSize(a) - getSize(b))
          : dir * getName(a).localeCompare(getName(b));
      default:
        return 0;
    }
  });

  return sorted;
}

export function FileGrid({
  contents,
  isLoading,
  view,
  sortField,
  sortDirection,
  onOpenFolder,
  onPreviewFile,
  onDownloadFile,
  onRenameFolder,
  onDeleteFolder,
  onRenameFile,
  onDeleteFile,
  onUpload,
  onCreateFolder,
  onHoverFolder,
}: FileGridProps) {
  if (isLoading && !contents) {
    return <FileGridSkeleton view={view} />;
  }

  if (!contents) return null;

  const sortedFolders = sortItems(
    contents.subfolders,
    sortField,
    sortDirection,
    (f) => f.name,
    (f) => f.createdAt,
  );

  const sortedFiles = sortItems(
    contents.files,
    sortField,
    sortDirection,
    (f) => f.filename,
    (f) => f.updatedAt,
    (f) => f.sizeBytes,
  );

  const isEmpty = sortedFolders.length === 0 && sortedFiles.length === 0;

  if (isEmpty) {
    return <EmptyState onUpload={onUpload} onCreateFolder={onCreateFolder} />;
  }

  if (view === "list") {
    return (
      <div className="flex flex-col gap-0.5">
        {sortedFolders.map((folder) => (
          <FolderItem
            key={folder.id}
            folder={folder}
            view="list"
            onOpen={onOpenFolder}
            onRename={onRenameFolder}
            onDelete={onDeleteFolder}
            onHover={onHoverFolder}
          />
        ))}
        {sortedFolders.length > 0 && sortedFiles.length > 0 && <div className="my-1 border-t" />}
        {sortedFiles.map((file) => (
          <FileItem
            key={file.id}
            file={file}
            view="list"
            onPreview={onPreviewFile}
            onDownload={onDownloadFile}
            onRename={onRenameFile}
            onDelete={onDeleteFile}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      {sortedFolders.length > 0 && (
        <div className="mb-4">
          {sortedFiles.length > 0 && (
            <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Folders</p>
          )}
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {sortedFolders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                view="grid"
                onOpen={onOpenFolder}
                onRename={onRenameFolder}
                onDelete={onDeleteFolder}
                onHover={onHoverFolder}
              />
            ))}
          </div>
        </div>
      )}

      {sortedFiles.length > 0 && (
        <div>
          {sortedFolders.length > 0 && (
            <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Files</p>
          )}
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {sortedFiles.map((file) => (
              <FileItem
                key={file.id}
                file={file}
                view="grid"
                onPreview={onPreviewFile}
                onDownload={onDownloadFile}
                onRename={onRenameFile}
                onDelete={onDeleteFile}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

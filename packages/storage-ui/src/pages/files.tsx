import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BrowserToolbar } from "@/components/browser-toolbar";
import { CreateFolderDialog } from "@/components/create-folder-dialog";
import { DeleteDialog } from "@/components/delete-dialog";
import { FileGrid } from "@/components/file-grid";
import { FileGridSkeleton } from "@/components/file-grid-skeleton";
import { FilePreview } from "@/components/file-preview";
import { FolderBreadcrumbs } from "@/components/folder-breadcrumbs";
import { RenameDialog } from "@/components/rename-dialog";
import { UploadZone } from "@/components/upload-zone";
import { useActiveRoot } from "@/hooks/use-active-root";
import { useFolderCache, useFolderContents, useRoots } from "@/hooks/use-folder-cache";
import { fetchFolder, getDownloadUrl } from "@/lib/api";
import type { SortDirection, SortField, StorageFile, StorageFolder, ViewMode } from "@/lib/types";

interface BreadcrumbSegment {
  id: string;
  name: string;
}

export function FileBrowser() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { roots, isLoading: rootsLoading } = useRoots();
  const { prefetch } = useFolderCache();
  const { setActiveRoot } = useActiveRoot();

  const folderId = searchParams.get("folder") ?? roots?.userRoot.id ?? null;
  const { data: contents, isLoading, error } = useFolderContents(folderId);

  const [view, setView] = useState<ViewMode>("grid");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [search, setSearch] = useState("");

  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>([]);

  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    name: string;
    type: "file" | "folder";
    parentFolderId: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    type: "file" | "folder";
    parentFolderId: string;
  } | null>(null);
  const [previewFile, setPreviewFile] = useState<StorageFile | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    if (!contents || !roots) return;

    async function buildBreadcrumbs() {
      const segments: BreadcrumbSegment[] = [];
      const currentId: string | undefined = contents?.folder.id;

      const currentName = contents?.folder.name;
      if (!currentId || !currentName) return;
      let currentParentId = contents?.folder.parentId;

      const isUserRoot = currentId === roots?.userRoot.id;
      const isSharedRoot = currentId === roots?.sharedRoot.id;

      if (isUserRoot || isSharedRoot) {
        setActiveRoot(isUserRoot ? "user" : "shared");
        segments.push({
          id: currentId,
          name: isUserRoot ? "My Files" : "Shared",
        });
        setBreadcrumbs(segments);
        return;
      }

      segments.push({ id: currentId, name: currentName });

      while (currentParentId) {
        if (currentParentId === roots?.userRoot.id || currentParentId === roots?.sharedRoot.id) {
          setActiveRoot(currentParentId === roots?.userRoot.id ? "user" : "shared");
          segments.push({
            id: currentParentId,
            name: currentParentId === roots?.userRoot.id ? "My Files" : "Shared",
          });
          break;
        }

        try {
          const parent = await fetchFolder(currentParentId);
          segments.push({ id: parent.id, name: parent.name });
          currentParentId = parent.parentId;
        } catch {
          break;
        }
      }

      segments.reverse();
      setBreadcrumbs(segments);
    }

    buildBreadcrumbs();
  }, [contents, contents?.folder.id, roots, setActiveRoot]);

  const navigateToFolder = useCallback(
    (targetFolderId: string) => {
      setSearchParams({ folder: targetFolderId });
    },
    [setSearchParams],
  );

  const handleOpenFolder = useCallback(
    (folder: StorageFolder) => {
      navigateToFolder(folder.id);
    },
    [navigateToFolder],
  );

  const handleHoverFolder = useCallback(
    (folder: StorageFolder) => {
      prefetch(folder.id);
    },
    [prefetch],
  );

  const handleDownloadFile = useCallback((file: StorageFile) => {
    const url = getDownloadUrl(file.id, true);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.click();
  }, []);

  const handleRenameFolder = useCallback(
    (folder: StorageFolder) => {
      if (!folderId) return;
      setRenameTarget({
        id: folder.id,
        name: folder.name,
        type: "folder",
        parentFolderId: folderId,
      });
    },
    [folderId],
  );

  const handleDeleteFolder = useCallback(
    (folder: StorageFolder) => {
      if (!folderId) return;
      setDeleteTarget({
        id: folder.id,
        name: folder.name,
        type: "folder",
        parentFolderId: folderId,
      });
    },
    [folderId],
  );

  const handleRenameFile = useCallback(
    (file: StorageFile) => {
      if (!folderId) return;
      setRenameTarget({
        id: file.id,
        name: file.filename,
        type: "file",
        parentFolderId: folderId,
      });
    },
    [folderId],
  );

  const handleDeleteFile = useCallback(
    (file: StorageFile) => {
      if (!folderId) return;
      setDeleteTarget({
        id: file.id,
        name: file.filename,
        type: "file",
        parentFolderId: folderId,
      });
    },
    [folderId],
  );

  const handleUploadClick = useCallback(() => {
    setUploadOpen(true);
  }, []);

  const initializing = rootsLoading || !folderId;

  return (
    <div className="flex h-full flex-col gap-3 w-full">
      <FolderBreadcrumbs segments={breadcrumbs} onNavigate={navigateToFolder} />

      <BrowserToolbar
        search={search}
        onSearchChange={setSearch}
        view={view}
        onViewChange={setView}
        sortField={sortField}
        sortDirection={sortDirection}
        onSortFieldChange={setSortField}
        onSortDirectionChange={setSortDirection}
        onUpload={handleUploadClick}
        onCreateFolder={() => setCreateFolderOpen(true)}
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {initializing || (isLoading && !contents) ? (
          <FileGridSkeleton view={view} />
        ) : (
          <FileGrid
            contents={contents}
            isLoading={isLoading}
            view={view}
            sortField={sortField}
            sortDirection={sortDirection}
            onOpenFolder={handleOpenFolder}
            onPreviewFile={setPreviewFile}
            onDownloadFile={handleDownloadFile}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onRenameFile={handleRenameFile}
            onDeleteFile={handleDeleteFile}
            onUpload={handleUploadClick}
            onCreateFolder={() => setCreateFolderOpen(true)}
            onHoverFolder={handleHoverFolder}
          />
        )}
      </div>

      {folderId && (
        <>
          <CreateFolderDialog
            open={createFolderOpen}
            onOpenChange={setCreateFolderOpen}
            parentId={folderId}
          />
          <RenameDialog target={renameTarget} onClose={() => setRenameTarget(null)} />
          <DeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
          {contents && (
            <UploadZone
              open={uploadOpen}
              onOpenChange={setUploadOpen}
              folderId={folderId}
              folderPath={contents.folder.path}
            />
          )}
        </>
      )}

      <FilePreview
        file={previewFile}
        onClose={() => setPreviewFile(null)}
        onDownload={handleDownloadFile}
      />
    </div>
  );
}

import { CheckCircleIcon, FileIcon, UploadCloudIcon, XCircleIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFolderCache } from "@/hooks/use-folder-cache";
import { formatBytes } from "@/lib/format";
import { createTusUpload } from "@/lib/tus";
import { cn } from "@/lib/utils";

interface UploadEntry {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "completed" | "error";
  error: string | null;
  abortController: AbortController;
}

interface UploadZoneProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  folderPath: string;
}

export function UploadZone({ open, onOpenChange, folderId, folderPath }: UploadZoneProps) {
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { invalidateFolder } = useFolderCache();

  const startUpload = useCallback(
    (entry: UploadEntry) => {
      setUploads((prev) =>
        prev.map((u) => (u.id === entry.id ? { ...u, status: "uploading" as const } : u)),
      );

      createTusUpload(
        entry.file,
        folderPath,
        (uploaded, total) => {
          const progress = Math.round((uploaded / total) * 100);
          setUploads((prev) => prev.map((u) => (u.id === entry.id ? { ...u, progress } : u)));
        },
        entry.abortController.signal,
      )
        .then(() => {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === entry.id ? { ...u, status: "completed" as const, progress: 100 } : u,
            ),
          );
          invalidateFolder(folderId);
        })
        .catch((err: Error) => {
          if (err.name === "AbortError") return;
          setUploads((prev) =>
            prev.map((u) =>
              u.id === entry.id ? { ...u, status: "error" as const, error: err.message } : u,
            ),
          );
        });
    },
    [folderPath, folderId, invalidateFolder],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const newEntries: UploadEntry[] = Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: "pending" as const,
        error: null,
        abortController: new AbortController(),
      }));

      setUploads((prev) => [...prev, ...newEntries]);
      for (const entry of newEntries) {
        startUpload(entry);
      }
    },
    [startUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = "";
      }
    },
    [addFiles],
  );

  const cancelUpload = useCallback((id: string) => {
    setUploads((prev) => {
      const entry = prev.find((u) => u.id === id);
      entry?.abortController.abort();
      return prev.filter((u) => u.id !== id);
    });
  }, []);

  const clearCompleted = useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.status !== "completed"));
  }, []);

  const hasActive = uploads.some((u) => u.status === "uploading" || u.status === "pending");
  const hasCompleted = uploads.some((u) => u.status === "completed");
  const allSucceeded =
    uploads.length > 0 && !hasActive && uploads.every((u) => u.status === "completed");

  useEffect(() => {
    if (!allSucceeded) return;
    setUploads([]);
    onOpenChange(false);
  }, [allSucceeded, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && hasActive) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
        </DialogHeader>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: needed for drag and drop */}
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors",
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/40",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <UploadCloudIcon className="size-8 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium">Drop files here</p>
            <p className="text-xs text-muted-foreground">or</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            Browse files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {uploads.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {uploads.length} file{uploads.length !== 1 ? "s" : ""}
              </p>
              {hasCompleted && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={clearCompleted}
                >
                  Clear completed
                </button>
              )}
            </div>
            <ScrollArea className="max-h-48">
              <div className="space-y-2 pr-3">
                {uploads.map((upload) => (
                  <UploadRow key={upload.id} upload={upload} onCancel={cancelUpload} />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UploadRow({ upload, onCancel }: { upload: UploadEntry; onCancel: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0">
        {upload.status === "completed" ? (
          <CheckCircleIcon className="size-4 text-emerald-500" />
        ) : upload.status === "error" ? (
          <XCircleIcon className="size-4 text-destructive" />
        ) : (
          <FileIcon className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{upload.file.name}</p>
        <div className="flex items-center gap-2">
          {upload.status === "error" ? (
            <p className="truncate text-[10px] text-destructive">{upload.error}</p>
          ) : upload.status === "completed" ? (
            <p className="text-[10px] text-muted-foreground">{formatBytes(upload.file.size)}</p>
          ) : (
            <Progress value={upload.progress} className="h-1 flex-1" />
          )}
        </div>
      </div>
      {(upload.status === "uploading" || upload.status === "pending") && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          onClick={() => onCancel(upload.id)}
        >
          <XIcon className="size-3" />
        </Button>
      )}
    </div>
  );
}

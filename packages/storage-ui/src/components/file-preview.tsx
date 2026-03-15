import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { FileIconDisplay } from "@/components/file-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getDownloadUrl } from "@/lib/api";
import { formatBytes, getFileCategory } from "@/lib/format";
import type { StorageFile } from "@/lib/types";

interface FilePreviewProps {
  file: StorageFile | null;
  onClose: () => void;
  onDownload: (file: StorageFile) => void;
}

export function FilePreview({ file, onClose, onDownload }: FilePreviewProps) {
  if (!file) return null;

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl sm:h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogTitle className="sr-only">{file.filename}</DialogTitle>

        <div className="flex items-center gap-3 border-b px-4 py-3 pr-12">
          <FileIconDisplay mimeType={file.mimeType} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.filename}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</p>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-muted/30">
          <PreviewContent file={file} />
        </div>

        <div className="flex items-center justify-end border-t px-4 py-3">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onDownload(file)}>
            <DownloadIcon className="size-4" />
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewContent({ file }: { file: StorageFile }) {
  const category = getFileCategory(file.mimeType);
  const url = getDownloadUrl(file.id);

  switch (category) {
    case "image":
      return (
        <div className="flex h-full items-center justify-center p-4">
          <img
            src={url}
            alt={file.filename}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      );

    case "video":
      return (
        <div className="flex h-full items-center justify-center p-4">
          <video src={url} controls className="max-h-full max-w-full rounded-lg">
            <track kind="captions" />
          </video>
        </div>
      );

    case "audio":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
          <FileIconDisplay mimeType={file.mimeType} className="size-20" />
          <audio src={url} controls className="w-full max-w-md">
            <track kind="captions" />
          </audio>
        </div>
      );

    case "pdf":
      return <iframe src={url} title={file.filename} className="h-full w-full border-0" />;

    case "text":
    case "code":
      return <TextPreview file={file} />;

    default:
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <FileIconDisplay mimeType={file.mimeType} className="size-16" />
          <div>
            <p className="text-sm font-medium">{file.filename}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Preview not available for this file type
            </p>
            <p className="text-xs text-muted-foreground">
              {file.mimeType ?? "Unknown type"} &middot; {formatBytes(file.sizeBytes)}
            </p>
          </div>
        </div>
      );
  }
}

function TextPreview({ file }: { file: StorageFile }) {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    const url = getDownloadUrl(file.id);
    fetch(url, { credentials: "same-origin" })
      .then((res) => res.text())
      .then((text) => {
        // Limit preview to first 100KB
        setContent(text.slice(0, 100_000));
        setIsLoading(false);
      })
      .catch(() => {
        setContent("Failed to load file content");
        setIsLoading(false);
      });
  }, [file.id]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <pre className="h-full overflow-auto p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap wrap-break-word">
      {content}
    </pre>
  );
}

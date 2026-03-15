import { CheckIcon, CopyIcon, LinkIcon, LoaderIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createShareLink, type ShareExpiresIn } from "@/lib/api";
import type { StorageFile } from "@/lib/types";

const EXPIRY_OPTIONS: { value: ShareExpiresIn; label: string }[] = [
  { value: "30m", label: "30 min" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "1 week" },
  { value: "30d", label: "1 month" },
  { value: "never", label: "Never" },
];

interface ShareDialogProps {
  file: StorageFile | null;
  onClose: () => void;
}

export function ShareDialog({ file, onClose }: ShareDialogProps) {
  const [expiresIn, setExpiresIn] = useState<ShareExpiresIn>("7d");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!file) return;
    setIsLoading(true);
    setError(null);
    try {
      const url = await createShareLink(file.id, expiresIn);
      setShareUrl(url);
    } catch {
      setError("Failed to create share link");
    } finally {
      setIsLoading(false);
    }
  }, [file, expiresIn]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setShareUrl(null);
        setError(null);
        setCopied(false);
        setExpiresIn("7d");
        onClose();
      }
    },
    [onClose],
  );

  return (
    <Dialog open={file !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="size-4" />
            Share "{file?.filename}"
          </DialogTitle>
        </DialogHeader>

        {!shareUrl ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Link expires after</p>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={expiresIn}
                onValueChange={(v) => {
                  if (v) setExpiresIn(v as ShareExpiresIn);
                }}
                className="w-full"
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <ToggleGroupItem key={opt.value} value={opt.value} className="flex-1 text-xs">
                    {opt.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button onClick={handleCreate} disabled={isLoading} className="w-full">
              {isLoading ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : (
                <LinkIcon className="size-4" />
              )}
              Create link
            </Button>
          </div>
        ) : (
          <div className="space-y-3 truncate">
            {/* biome-ignore lint/a11y/useSemanticElements: div with role=button because nested button is invalid HTML */}
            <div
              className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/50 p-3 cursor-pointer"
              onClick={handleCopy}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCopy();
              }}
              role="button"
              tabIndex={0}
            >
              <p className="min-w-0 flex-1 truncate text-sm font-mono">{shareUrl}</p>
              <Button variant="ghost" size="icon" className="size-7 shrink-0">
                {copied ? (
                  <CheckIcon className="size-3.5 text-emerald-500" />
                ) : (
                  <CopyIcon className="size-3.5" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {expiresIn === "never"
                ? "This link never expires."
                : `This link expires in ${EXPIRY_OPTIONS.find((o) => o.value === expiresIn)?.label}.`}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

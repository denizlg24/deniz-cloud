import { HardDrive } from "lucide-react";

export function StoragePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
        <p className="text-sm text-muted-foreground mt-1">Tiering engine and storage management</p>
      </div>
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <HardDrive className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">Coming soon</p>
        <p className="text-sm">Storage tiering management will be available in a future update.</p>
      </div>
    </div>
  );
}

import { Search } from "lucide-react";

export function SearchPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search Projects</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage Meilisearch projects and tenant tokens
        </p>
      </div>
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Search className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">Coming soon</p>
        <p className="text-sm">Search project management will be available in a future update.</p>
      </div>
    </div>
  );
}

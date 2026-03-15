import {
  ArrowDownAZIcon,
  ArrowUpAZIcon,
  FolderPlusIcon,
  GridIcon,
  ListIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SortDirection, SortField, ViewMode } from "@/lib/types";

interface BrowserToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortFieldChange: (field: SortField) => void;
  onSortDirectionChange: (dir: SortDirection) => void;
  onUpload: () => void;
  onCreateFolder: () => void;
}

const SORT_LABELS: Record<SortField, string> = {
  name: "Name",
  date: "Date",
  size: "Size",
};

export function BrowserToolbar({
  search,
  onSearchChange,
  view,
  onViewChange,
  sortField,
  sortDirection,
  onSortFieldChange,
  onSortDirectionChange,
  onUpload,
  onCreateFolder,
}: BrowserToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-44 max-w-xs">
        <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search files..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 pl-8 text-sm"
        />
      </div>

      <div className="flex items-center gap-1 ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
              {sortDirection === "asc" ? (
                <ArrowDownAZIcon className="size-3.5" />
              ) : (
                <ArrowUpAZIcon className="size-3.5" />
              )}
              <span className="hidden sm:inline">{SORT_LABELS[sortField]}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sortField}
              onValueChange={(v) => onSortFieldChange(v as SortField)}
            >
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="date">Date</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={sortDirection}
              onValueChange={(v) => onSortDirectionChange(v as SortDirection)}
            >
              <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => {
            if (v) onViewChange(v as ViewMode);
          }}
          className="h-8"
        >
          <ToggleGroupItem value="grid" aria-label="Grid view" className="size-8 p-0">
            <GridIcon className="size-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view" className="size-8 p-0">
            <ListIcon className="size-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="mx-1 h-5 w-px bg-border" />

        <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={onCreateFolder}>
          <FolderPlusIcon className="size-3.5" />
          <span className="hidden sm:inline text-xs">Folder</span>
        </Button>

        <Button size="sm" className="h-8 gap-1" onClick={onUpload}>
          <UploadIcon className="size-3.5" />
          <span className="hidden sm:inline text-xs">Upload</span>
        </Button>
      </div>
    </div>
  );
}

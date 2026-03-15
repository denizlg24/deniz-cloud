import { ChevronRightIcon, HomeIcon } from "lucide-react";
import { Fragment } from "react";

interface BreadcrumbSegment {
  id: string;
  name: string;
}

interface FolderBreadcrumbsProps {
  segments: BreadcrumbSegment[];
  onNavigate: (folderId: string) => void;
}

export function FolderBreadcrumbs({ segments, onNavigate }: FolderBreadcrumbsProps) {
  if (segments.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <Fragment key={seg.id}>
            {i > 0 && <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
            {isLast ? (
              <span className="truncate font-medium max-w-32 sm:max-w-48">
                {i === 0 ? (
                  <span className="flex items-center gap-1.5">
                    <HomeIcon className="size-3.5" />
                    <span className="hidden sm:inline">{seg.name}</span>
                  </span>
                ) : (
                  seg.name
                )}
              </span>
            ) : (
              <button
                type="button"
                className="truncate text-muted-foreground transition-colors hover:text-foreground max-w-24 sm:max-w-36"
                onClick={() => onNavigate(seg.id)}
              >
                {i === 0 ? (
                  <span className="flex items-center gap-1.5">
                    <HomeIcon className="size-3.5" />
                    <span className="hidden sm:inline">{seg.name}</span>
                  </span>
                ) : (
                  seg.name
                )}
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

export interface StorageFile {
  id: string;
  filename: string;
  path: string;
  mimeType: string | null;
  sizeBytes: number;
  tier: "ssd" | "hdd";
  createdAt: string;
  updatedAt: string;
}

export interface StorageFileDetail extends StorageFile {
  checksum: string;
  lastAccessedAt: string | null;
  accessCount: number;
}

export interface StorageFolder {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  createdAt: string;
}

export interface StorageFolderDetail extends StorageFolder {
  ownerId: string;
  updatedAt: string;
}

export interface RootFolders {
  userRoot: { id: string; path: string; name: string };
  sharedRoot: { id: string; path: string; name: string };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface FolderContents {
  folder: {
    id: string;
    path: string;
    name: string;
    parentId: string | null;
  };
  subfolders: StorageFolder[];
  files: StorageFile[];
  pagination: Pagination;
}

export type SortField = "name" | "date" | "size";
export type SortDirection = "asc" | "desc";
export type ViewMode = "grid" | "list";

import { ApiRequestError, createFolder } from "./api";
import type { StorageFolder } from "./types";

export interface FileTreeEntry {
  file: File;
  relativePath: string;
}

export interface ResolvedTreeFile {
  file: File;
  displayPath: string;
  targetFolderPath: string;
}

interface UploadTarget {
  folderId: string;
  folderPath: string;
}

const MAX_DEDUPE_ATTEMPTS = 50;

export function collectFromFileList(files: FileList | File[]): FileTreeEntry[] {
  return Array.from(files).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}

export function dataTransferHasDirectory(items: DataTransferItemList): boolean {
  return Array.from(items).some((item) => item.webkitGetAsEntry()?.isDirectory ?? false);
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
        } else {
          all.push(...batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(
  entry: FileSystemEntry,
  pathPrefix: string,
  out: FileTreeEntry[],
): Promise<void> {
  if (entry.isFile) {
    const file = await entryToFile(entry as FileSystemFileEntry);
    out.push({ file, relativePath: `${pathPrefix}${entry.name}` });
  } else if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) {
      await walkEntry(child, `${pathPrefix}${entry.name}/`, out);
    }
  }
}

export async function collectFromDataTransfer(
  items: DataTransferItemList,
): Promise<FileTreeEntry[]> {
  const entries = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);

  const out: FileTreeEntry[] = [];
  for (const entry of entries) {
    await walkEntry(entry, "", out);
  }
  return out;
}

async function createFolderDeduped(name: string, parentId: string): Promise<StorageFolder> {
  for (let attempt = 0; attempt <= MAX_DEDUPE_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? name : `${name}_${attempt}`;
    try {
      return await createFolder(candidate, parentId);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "FOLDER_EXISTS") continue;
      throw err;
    }
  }
  throw new Error(`Could not find an available name for folder "${name}"`);
}

export async function buildFolderHierarchy(
  entries: FileTreeEntry[],
  target: UploadTarget,
): Promise<ResolvedTreeFile[]> {
  const dirPaths = new Set<string>();
  for (const entry of entries) {
    const segments = entry.relativePath.split("/");
    for (let i = 1; i < segments.length; i++) {
      dirPaths.add(segments.slice(0, i).join("/"));
    }
  }

  const ordered = [...dirPaths].sort((a, b) => a.split("/").length - b.split("/").length);
  const created = new Map<string, StorageFolder>();

  for (const dir of ordered) {
    const segments = dir.split("/");
    const name = segments[segments.length - 1];
    if (!name) continue;
    if (segments.length === 1) {
      created.set(dir, await createFolderDeduped(name, target.folderId));
    } else {
      const parent = created.get(segments.slice(0, -1).join("/"));
      if (!parent) throw new Error(`Parent folder was not created for "${dir}"`);
      created.set(dir, await createFolder(name, parent.id));
    }
  }

  return entries.map((entry) => {
    const segments = entry.relativePath.split("/");
    if (segments.length === 1) {
      return {
        file: entry.file,
        displayPath: entry.relativePath,
        targetFolderPath: target.folderPath,
      };
    }

    const folder = created.get(segments.slice(0, -1).join("/"));
    if (!folder) throw new Error(`Folder was not created for "${entry.relativePath}"`);

    const root = created.get(segments[0] ?? "");
    const displaySegments = [...segments];
    if (root) displaySegments[0] = root.name;

    return {
      file: entry.file,
      displayPath: displaySegments.join("/"),
      targetFolderPath: folder.path,
    };
  });
}

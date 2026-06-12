import { createContext } from "react";
import { fetchFolderContents } from "@/lib/api";
import type { FolderContents, RootFolders } from "@/lib/types";

interface CacheEntry {
  data: FolderContents;
  fetchedAt: number;
}

type CacheListener = () => void;

const CACHE_TTL = 5 * 60 * 1000;

export class FolderCacheStore {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<FolderContents>>();
  private listeners = new Set<CacheListener>();

  subscribe(listener: CacheListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  getCached(folderId: string): FolderContents | null {
    const entry = this.cache.get(folderId);
    if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) return entry.data;
    return null;
  }

  async fetch(folderId: string): Promise<FolderContents> {
    const cached = this.getCached(folderId);
    if (cached) return cached;

    const existing = this.inflight.get(folderId);
    if (existing) return existing;

    const promise = fetchFolderContents(folderId)
      .then((data) => {
        this.cache.set(folderId, { data, fetchedAt: Date.now() });
        this.inflight.delete(folderId);
        return data;
      })
      .catch((error: Error) => {
        this.inflight.delete(folderId);
        throw error;
      });

    this.inflight.set(folderId, promise);
    return promise;
  }

  invalidate(...folderIds: string[]) {
    for (const id of folderIds) {
      this.cache.delete(id);
    }
    this.emit();
  }

  invalidateAll() {
    this.cache.clear();
    this.emit();
  }

  updateCached(folderId: string, updater: (data: FolderContents) => FolderContents) {
    const entry = this.cache.get(folderId);
    if (!entry) return;
    this.cache.set(folderId, {
      data: updater(entry.data),
      fetchedAt: Date.now(),
    });
    this.emit();
  }

  prefetch(folderId: string) {
    if (this.getCached(folderId) || this.inflight.has(folderId)) return;
    this.fetch(folderId).catch(() => {});
  }
}

export interface CacheContextValue {
  store: FolderCacheStore;
  roots: RootFolders | null;
  rootsLoading: boolean;
}

export const FolderCacheContext = createContext<CacheContextValue | null>(null);

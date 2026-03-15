import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchFolderContents, fetchRoots } from "@/lib/api";
import type { FolderContents, RootFolders } from "@/lib/types";

interface CacheEntry {
  data: FolderContents;
  fetchedAt: number;
}

type CacheListener = () => void;

const CACHE_TTL = 5 * 60 * 1000;

class FolderCacheStore {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<FolderContents>>();
  private listeners = new Set<CacheListener>();

  subscribe(listener: CacheListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
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
      .catch((err: Error) => {
        this.inflight.delete(folderId);
        throw err;
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
      fetchedAt: entry.fetchedAt,
    });
    this.emit();
  }

  prefetch(folderId: string) {
    if (this.getCached(folderId) || this.inflight.has(folderId)) return;
    this.fetch(folderId).catch(() => {});
  }
}

interface CacheContextValue {
  store: FolderCacheStore;
  roots: RootFolders | null;
  rootsLoading: boolean;
}

const FolderCacheContext = createContext<CacheContextValue | null>(null);

export function FolderCacheProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<FolderCacheStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new FolderCacheStore();
  }

  const [roots, setRoots] = useState<RootFolders | null>(null);
  const [rootsLoading, setRootsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchRoots()
      .then((data) => {
        if (!cancelled) {
          setRoots(data);
          setRootsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setRootsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    // biome-ignore lint/style/noNonNullAssertion: ref is initialized synchronously above
    () => ({ store: storeRef.current!, roots, rootsLoading }),
    [roots, rootsLoading],
  );

  return <FolderCacheContext.Provider value={value}>{children}</FolderCacheContext.Provider>;
}

function useCacheContext(): CacheContextValue {
  const ctx = useContext(FolderCacheContext);
  if (!ctx) throw new Error("useFolderCache must be used within FolderCacheProvider");
  return ctx;
}

export function useRoots() {
  const { roots, rootsLoading } = useCacheContext();
  return { roots, isLoading: rootsLoading };
}

export function useFolderContents(folderId: string | null) {
  const { store } = useCacheContext();
  const [data, setData] = useState<FolderContents | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!folderId) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const cached = store.getCached(folderId);
    if (cached) {
      setData(cached);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    store
      .fetch(folderId)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setIsLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [folderId, store]);

  useEffect(() => {
    if (!folderId) return;

    const unsubscribe = store.subscribe(() => {
      const cached = store.getCached(folderId);
      if (cached) {
        setData(cached);
      } else {
        store
          .fetch(folderId)
          .then((result) => {
            setData(result);
            setIsLoading(false);
          })
          .catch((err: Error) => {
            setError(err.message);
            setIsLoading(false);
          });
      }
    });

    return unsubscribe;
  }, [folderId, store]);

  return { data, isLoading, error };
}

export function useFolderCache() {
  const { store } = useCacheContext();

  const invalidateFolder = useCallback(
    (...folderIds: string[]) => store.invalidate(...folderIds),
    [store],
  );

  const invalidateAll = useCallback(() => store.invalidateAll(), [store]);

  const prefetch = useCallback((folderId: string) => store.prefetch(folderId), [store]);

  const refetch = useCallback(
    (folderId: string) => {
      store.invalidate(folderId);
      return store.fetch(folderId);
    },
    [store],
  );

  const updateCached = useCallback(
    (folderId: string, updater: (data: FolderContents) => FolderContents) =>
      store.updateCached(folderId, updater),
    [store],
  );

  return useMemo(
    () => ({
      invalidateFolder,
      invalidateAll,
      prefetch,
      refetch,
      updateCached,
    }),
    [invalidateFolder, invalidateAll, prefetch, refetch, updateCached],
  );
}

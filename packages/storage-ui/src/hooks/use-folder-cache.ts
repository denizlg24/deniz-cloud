import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type CacheContextValue, FolderCacheContext } from "@/hooks/folder-cache-context";
import type { FolderContents } from "@/lib/types";

function useCacheContext(): CacheContextValue {
  const context = useContext(FolderCacheContext);
  if (!context) throw new Error("useFolderCache must be used within FolderCacheProvider");
  return context;
}

export function useRoots() {
  const { roots, rootsLoading } = useCacheContext();
  return { roots, isLoading: rootsLoading };
}

interface FolderResult {
  folderId: string;
  data: FolderContents | null;
  error: string | null;
}

export function useFolderContents(folderId: string | null) {
  const { store } = useCacheContext();
  const [result, setResult] = useState<FolderResult | null>(null);

  useEffect(() => {
    if (!folderId) return;

    let cancelled = false;
    store
      .fetch(folderId)
      .then((data) => {
        if (!cancelled) setResult({ folderId, data, error: null });
      })
      .catch((error: Error) => {
        if (!cancelled) setResult({ folderId, data: null, error: error.message });
      });

    return () => {
      cancelled = true;
    };
  }, [folderId, store]);

  useEffect(() => {
    if (!folderId) return;

    return store.subscribe(() => {
      const cached = store.getCached(folderId);
      if (cached) {
        setResult({ folderId, data: cached, error: null });
        return;
      }

      store
        .fetch(folderId)
        .then((data) => setResult({ folderId, data, error: null }))
        .catch((error: Error) => setResult({ folderId, data: null, error: error.message }));
    });
  }, [folderId, store]);

  if (!folderId) return { data: null, isLoading: false, error: null };
  if (result?.folderId !== folderId) return { data: null, isLoading: true, error: null };
  return { data: result.data, isLoading: false, error: result.error };
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
    () => ({ invalidateFolder, invalidateAll, prefetch, refetch, updateCached }),
    [invalidateFolder, invalidateAll, prefetch, refetch, updateCached],
  );
}

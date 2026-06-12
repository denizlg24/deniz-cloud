import { type ReactNode, useEffect, useMemo, useState } from "react";
import { FolderCacheContext, FolderCacheStore } from "@/hooks/folder-cache-context";
import { fetchRoots } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { RootFolders } from "@/lib/types";

interface RootsResult {
  userId: string;
  roots: RootFolders;
}

export function FolderCacheProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new FolderCacheStore());
  const { isAuthenticated, user } = useAuth();
  const [result, setResult] = useState<RootsResult | null>(null);
  const enabled = isAuthenticated && !!user?.totpEnabled;

  useEffect(() => {
    if (!enabled || !user) return;

    let cancelled = false;

    fetchRoots()
      .then((data) => {
        if (!cancelled) setResult({ userId: user.id, roots: data });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [enabled, user]);

  const roots = enabled && result?.userId === user?.id ? result.roots : null;
  const rootsLoading = enabled && result?.userId !== user?.id;
  const value = useMemo(() => ({ store, roots, rootsLoading }), [store, roots, rootsLoading]);

  return <FolderCacheContext.Provider value={value}>{children}</FolderCacheContext.Provider>;
}

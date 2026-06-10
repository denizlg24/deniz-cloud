import { Database, FolderOpen, HardDrive, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DriveBay, StatRow } from "@/components/stats/stat-widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DiskInfo, LargestFile, StorageStats, SystemStats, UserStorageStat } from "@/lib/api";
import { getLargestFiles, getStorageStats, getSystemStats, getUserStorageStats } from "@/lib/api";
import { formatBytes } from "@/lib/format";

export function StoragePage() {
  const [system, setSystem] = useState<SystemStats | null>(null);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [userStats, setUserStats] = useState<UserStorageStat[]>([]);
  const [largestFiles, setLargestFiles] = useState<LargestFile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [sys, stor, users, largest] = await Promise.all([
        getSystemStats(),
        getStorageStats(),
        getUserStorageStats(),
        getLargestFiles(20),
      ]);
      setSystem(sys);
      setStorage(stor);
      setUserStats(users);
      setLargestFiles(largest);
    } catch {
      toast.error("Failed to load storage stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
            <Skeleton key={`skeleton-${i}`} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Disk usage, tier breakdown, and per-user consumption
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {system && (
        <section>
          <h2 className="text-lg font-medium mb-3">Disks</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {(() => {
              const bays: Array<{ label: string; disk: DiskInfo }> = [];
              if (system.disk.ssd) bays.push({ label: "SSD", disk: system.disk.ssd });
              system.disk.hdd.forEach((d, i) => {
                bays.push({
                  label: system.disk.hdd.length > 1 ? `HDD ${i + 1}` : "HDD",
                  disk: d,
                });
              });
              if (system.disk.microsd) bays.push({ label: "microSD", disk: system.disk.microsd });
              return bays.map((bay, i) => (
                <DriveBay key={bay.disk.device} label={bay.label} disk={bay.disk} index={i} />
              ));
            })()}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium mb-3">Tiers</h2>
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
          <StatRow
            icon={Database}
            label="Total files"
            value={storage?.files.count ?? 0}
            sub={formatBytes(storage?.files.totalSizeBytes ?? 0)}
          />
          <StatRow
            icon={HardDrive}
            label="SSD tier"
            value={storage?.tiers.ssd.fileCount ?? 0}
            sub={formatBytes(storage?.tiers.ssd.totalSizeBytes ?? 0)}
          />
          <StatRow
            icon={HardDrive}
            label="HDD tier"
            value={storage?.tiers.hdd.fileCount ?? 0}
            sub={formatBytes(storage?.tiers.hdd.totalSizeBytes ?? 0)}
          />
          <StatRow icon={FolderOpen} label="Folders" value={storage?.folders.count ?? 0} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Usage by user</h2>
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="text-right">Files</TableHead>
                <TableHead className="text-right">Total size</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {userStats.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                userStats.map((row) => {
                  const total = storage?.files.totalSizeBytes ?? 0;
                  const share =
                    total > 0 ? Math.round((row.totalSizeBytes / total) * 1000) / 10 : 0;
                  return (
                    <TableRow key={row.userId}>
                      <TableCell className="font-medium">{row.username}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.fileCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBytes(row.totalSizeBytes)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-right tabular-nums">
                        {share}%
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Largest files</h2>
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="hidden md:table-cell">Path</TableHead>
                <TableHead className="hidden sm:table-cell">Owner</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {largestFiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No files found
                  </TableCell>
                </TableRow>
              ) : (
                largestFiles.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="max-w-48 truncate font-medium" title={file.filename}>
                      {file.filename}
                    </TableCell>
                    <TableCell
                      className="hidden md:table-cell max-w-64 truncate font-mono text-xs text-muted-foreground"
                      title={file.path}
                    >
                      {file.path}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{file.ownerUsername}</TableCell>
                    <TableCell>
                      <Badge variant={file.tier === "ssd" ? "default" : "secondary"}>
                        {file.tier.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBytes(file.sizeBytes)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Last updated: {storage ? new Date(storage.timestamp).toLocaleTimeString() : "—"} ·
        Auto-refreshes every 15s
      </p>
    </div>
  );
}

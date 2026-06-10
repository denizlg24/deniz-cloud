import {
  Activity,
  Database,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Thermometer,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DriveBay, GaugeChart, StatRow } from "@/components/stats/stat-widgets";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DiskInfo } from "@/lib/api";
import { getStorageStats, getSystemStats, type StorageStats, type SystemStats } from "@/lib/api";
import { formatBytes } from "@/lib/format";

export function DashboardPage() {
  const [system, setSystem] = useState<SystemStats | null>(null);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [sys, stor] = await Promise.all([getSystemStats(), getStorageStats()]);
      setSystem(sys);
      setStorage(stor);
    } catch {
      toast.error("Failed to load stats");
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
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
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
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">System overview and resource usage</p>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        {system && (
          <>
            <div className="space-y-1 text-center">
              <GaugeChart
                value={system.cpu.usagePercent}
                label="CPU"
                color="var(--color-chart-1)"
              />
              <p className="text-xs text-muted-foreground">
                {system.cpu.cores} cores
                {system.cpuTemp != null && (
                  <span className="inline-flex items-center gap-0.5 ml-2">
                    <Thermometer className="h-3 w-3" />
                    <span
                      className={
                        system.cpuTemp >= 80
                          ? "text-destructive font-medium"
                          : system.cpuTemp >= 65
                            ? "text-yellow-600"
                            : ""
                      }
                    >
                      {system.cpuTemp}°C
                    </span>
                  </span>
                )}
              </p>
            </div>
            <div className="space-y-1 text-center">
              <GaugeChart
                value={system.memory.usagePercent}
                label="RAM"
                color="var(--color-chart-2)"
              />
              <p className="text-xs text-muted-foreground">
                {formatBytes(system.memory.usedBytes)} / {formatBytes(system.memory.totalBytes)}
              </p>
            </div>
          </>
        )}
      </section>

      {system && (
        <section>
          <h2 className="text-lg font-medium mb-3">Drive Bays</h2>
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
        <h2 className="text-lg font-medium mb-3">Storage</h2>
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          <StatRow
            icon={Database}
            label="Total files"
            value={storage?.files.count ?? 0}
            sub={formatBytes(storage?.files.totalSizeBytes ?? 0)}
          />
          <StatRow
            icon={HardDrive}
            label="SSD files"
            value={storage?.tiers.ssd.fileCount ?? 0}
            sub={formatBytes(storage?.tiers.ssd.totalSizeBytes ?? 0)}
          />
          <StatRow
            icon={HardDrive}
            label="HDD files"
            value={storage?.tiers.hdd.fileCount ?? 0}
            sub={formatBytes(storage?.tiers.hdd.totalSizeBytes ?? 0)}
          />
          <StatRow icon={FolderOpen} label="Folders" value={storage?.folders.count ?? 0} />
          <StatRow icon={Users} label="Users" value={storage?.users.count ?? 0} />
          <StatRow
            icon={Activity}
            label="Active sessions"
            value={storage?.activeSessions.count ?? 0}
          />
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Last updated: {system ? new Date(system.timestamp).toLocaleTimeString() : "—"} ·
        Auto-refreshes every 15s
      </p>
    </div>
  );
}

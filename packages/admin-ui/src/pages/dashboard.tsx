import {
  Activity,
  type Cpu,
  Database,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Thermometer,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Label as ChartLabel, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChartContainer } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { DiskInfo } from "@/lib/api";
import { getStorageStats, getSystemStats, type StorageStats, type SystemStats } from "@/lib/api";
import { formatBytes } from "@/lib/format";

function GaugeChart({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <ChartContainer config={{ value: { label, color } }} className="mx-auto aspect-square h-32">
      <RadialBarChart
        data={[{ value, fill: color }]}
        startAngle={180}
        endAngle={0}
        innerRadius={45}
        outerRadius={65}
      >
        <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
          <ChartLabel
            content={({ viewBox }) => {
              if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) - 4}
                      className="fill-foreground text-xl font-bold"
                    >
                      {value}%
                    </tspan>
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) + 14}
                      className="fill-muted-foreground text-xs"
                    >
                      {label}
                    </tspan>
                  </text>
                );
              }
            }}
          />
        </PolarRadiusAxis>
        <RadialBar dataKey="value" cornerRadius={5} background maxBarSize={100} />
      </RadialBarChart>
    </ChartContainer>
  );
}

function StatRow({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Cpu;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
      </div>
      {sub && <span className="text-xs text-muted-foreground whitespace-nowrap">{sub}</span>}
    </div>
  );
}

function usageColor(percent: number): string {
  if (percent >= 90) return "bg-destructive";
  if (percent >= 70) return "bg-yellow-500";
  return "bg-emerald-500";
}

function DriveBay({ label, disk, index }: { label: string; disk: DiskInfo; index: number }) {
  return (
    <div
      className={`flex items-stretch gap-3 rounded-lg border p-3 ${disk.online ? "bg-card" : "bg-muted/30 opacity-60"}`}
    >
      <div className="flex flex-col items-center justify-center gap-1 px-2 border-r min-w-[52px]">
        <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
          Bay {index}
        </span>
        <div
          className={`h-2.5 w-2.5 rounded-full ${disk.online ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-muted-foreground/30"}`}
        />
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm">{label}</span>
          <span className="font-mono text-xs text-muted-foreground truncate">
            {disk.online ? disk.device : "offline"}
          </span>
        </div>

        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
          {disk.online && (
            <div
              className={`h-full rounded-full transition-all ${usageColor(disk.usagePercent)}`}
              style={{ width: `${Math.min(disk.usagePercent, 100)}%` }}
            />
          )}
        </div>

        <div className="flex justify-between text-xs text-muted-foreground">
          {disk.online ? (
            <>
              <span>
                {formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)}
              </span>
              <span className="tabular-nums">{disk.usagePercent}%</span>
            </>
          ) : (
            <span>No disk detected</span>
          )}
        </div>
      </div>
    </div>
  );
}

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

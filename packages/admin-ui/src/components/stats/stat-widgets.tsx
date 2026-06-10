import type { Cpu } from "lucide-react";
import { Label as ChartLabel, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import type { DiskInfo } from "@/lib/api";
import { formatBytes } from "@/lib/format";

export function GaugeChart({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
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

export function StatRow({
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

export function DriveBay({ label, disk, index }: { label: string; disk: DiskInfo; index: number }) {
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

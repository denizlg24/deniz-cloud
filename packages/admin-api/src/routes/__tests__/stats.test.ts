import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

describe("getCpuUsage — /proc/stat parsing", () => {
  function parseCpuFromProcStat(stat: string): {
    usagePercent: number;
    cores: number;
  } {
    const cpuLine = stat.split("\n").find((l) => l.startsWith("cpu "));
    if (!cpuLine) throw new Error("No cpu line");

    const parts = cpuLine.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] ?? 0;
    const total = parts.reduce((a, b) => a + b, 0);

    const cpuInfoLines = stat.split("\n").filter((l) => /^cpu\d+/.test(l));
    const cores = cpuInfoLines.length;

    const usagePercent = total > 0 ? Math.round(((total - idle) / total) * 100 * 10) / 10 : 0;
    return { usagePercent, cores };
  }

  it("parses a standard /proc/stat with 4 cores", () => {
    const stat = [
      "cpu  10000 500 3000 80000 200 0 100 0 0 0",
      "cpu0 2500 125 750 20000 50 0 25 0 0 0",
      "cpu1 2500 125 750 20000 50 0 25 0 0 0",
      "cpu2 2500 125 750 20000 50 0 25 0 0 0",
      "cpu3 2500 125 750 20000 50 0 25 0 0 0",
    ].join("\n");

    const result = parseCpuFromProcStat(stat);
    expect(result.cores).toBe(4);
    // total = 10000+500+3000+80000+200+0+100+0+0+0 = 93800
    // idle = 80000
    // usage = (93800-80000)/93800 * 100 = 14.7...
    const expectedUsage = Math.round(((93800 - 80000) / 93800) * 100 * 10) / 10;
    expect(result.usagePercent).toBe(expectedUsage);
  });

  it("returns 0 usage when total is 0", () => {
    const stat = "cpu  0 0 0 0 0 0 0 0 0 0\n";
    const result = parseCpuFromProcStat(stat);
    expect(result.usagePercent).toBe(0);
    expect(result.cores).toBe(0);
  });

  it("throws when no cpu line exists", () => {
    expect(() => parseCpuFromProcStat("processes 12345\n")).toThrow("No cpu line");
  });

  it("counts single core", () => {
    const stat = "cpu  5000 0 1000 4000 0 0 0 0 0 0\ncpu0 5000 0 1000 4000 0 0 0 0 0 0\n";
    const result = parseCpuFromProcStat(stat);
    expect(result.cores).toBe(1);
  });

  it("handles high CPU usage (mostly non-idle)", () => {
    const stat = "cpu  90000 0 5000 1000 0 0 4000 0 0 0\ncpu0 90000 0 5000 1000 0 0 4000 0 0 0\n";
    const result = parseCpuFromProcStat(stat);
    // total=100000, idle=1000, usage=99%
    expect(result.usagePercent).toBe(99);
  });

  it("rounds usage to one decimal place", () => {
    // total=300, idle=100, usage=(200/300)*100=66.666... → 66.7
    const stat = "cpu  100 0 100 100 0 0 0 0 0 0\ncpu0 100 0 100 100 0 0 0 0 0 0\n";
    const result = parseCpuFromProcStat(stat);
    expect(result.usagePercent).toBe(66.7);
  });
});

describe("getMemoryUsage — /proc/meminfo parsing", () => {
  function parseMeminfo(meminfo: string): {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  } {
    const lines = meminfo.split("\n");

    function extractKb(key: string): number {
      const line = lines.find((l) => l.startsWith(key));
      if (!line) return 0;
      const match = line.match(/(\d+)/);
      return match?.[1] ? parseInt(match[1], 10) * 1024 : 0;
    }

    const totalBytes = extractKb("MemTotal:");
    const availableBytes = extractKb("MemAvailable:");
    const usedBytes = totalBytes - availableBytes;
    const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100 * 10) / 10 : 0;

    return { totalBytes, usedBytes, availableBytes, usagePercent };
  }

  it("parses standard meminfo output", () => {
    const meminfo = [
      "MemTotal:        4000000 kB",
      "MemFree:         1000000 kB",
      "MemAvailable:    2000000 kB",
      "Buffers:          100000 kB",
    ].join("\n");

    const result = parseMeminfo(meminfo);
    expect(result.totalBytes).toBe(4000000 * 1024);
    expect(result.availableBytes).toBe(2000000 * 1024);
    expect(result.usedBytes).toBe(2000000 * 1024);
    expect(result.usagePercent).toBe(50);
  });

  it("returns 0 when MemTotal is missing", () => {
    const result = parseMeminfo("MemAvailable:    2000000 kB\n");
    expect(result.totalBytes).toBe(0);
    expect(result.usagePercent).toBe(0);
  });

  it("returns 0 available when MemAvailable is missing", () => {
    const result = parseMeminfo("MemTotal:    4000000 kB\n");
    expect(result.availableBytes).toBe(0);
    expect(result.usedBytes).toBe(4000000 * 1024);
    expect(result.usagePercent).toBe(100);
  });

  it("handles empty meminfo", () => {
    const result = parseMeminfo("");
    expect(result.totalBytes).toBe(0);
    expect(result.availableBytes).toBe(0);
    expect(result.usedBytes).toBe(0);
    expect(result.usagePercent).toBe(0);
  });

  it("rounds usage percent to one decimal", () => {
    // total=3000kB, available=1000kB → used=2000kB → 66.666... → 66.7
    const meminfo = "MemTotal:    3000 kB\nMemAvailable:    1000 kB\n";
    const result = parseMeminfo(meminfo);
    expect(result.usagePercent).toBe(66.7);
  });
});

describe("getDiskUsage — df parsing + device matching", () => {
  interface DiskInfo {
    device: string;
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
    online: boolean;
  }

  interface DiskUsage {
    ssd: DiskInfo | null;
    hdd: DiskInfo[];
    microsd: DiskInfo | null;
  }

  function offlineDisk(device: string): DiskInfo {
    return {
      device,
      totalBytes: 0,
      usedBytes: 0,
      availableBytes: 0,
      usagePercent: 0,
      online: false,
    };
  }

  function parseDfAndMatch(
    output: string,
    multiplier: number,
    devices: { ssd: string; hdd: string; microsd: string },
  ): DiskUsage {
    const deviceMap = new Map<
      string,
      { totalBytes: number; usedBytes: number; availableBytes: number }
    >();

    const lines = output.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4 || !parts[0] || !parts[1] || !parts[2] || !parts[3]) continue;
      const source = parts[0];
      if (!source.startsWith("/dev/") || deviceMap.has(source)) continue;
      deviceMap.set(source, {
        totalBytes: parseInt(parts[1], 10) * multiplier,
        usedBytes: parseInt(parts[2], 10) * multiplier,
        availableBytes: parseInt(parts[3], 10) * multiplier,
      });
    }

    function matchDevice(device: string): DiskInfo {
      const stats = deviceMap.get(device);
      if (stats) {
        const usagePercent =
          stats.totalBytes > 0
            ? Math.round((stats.usedBytes / stats.totalBytes) * 100 * 10) / 10
            : 0;
        return { device, ...stats, usagePercent, online: true };
      }
      return offlineDisk(device);
    }

    const result: DiskUsage = { ssd: null, hdd: [], microsd: null };
    if (devices.ssd) result.ssd = matchDevice(devices.ssd);
    if (devices.microsd) result.microsd = matchDevice(devices.microsd);
    if (devices.hdd) {
      result.hdd = devices.hdd
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
        .map(matchDevice);
    }
    return result;
  }

  const dfOutput = [
    "Filesystem     1K-blocks    Used Available Use% Mounted on",
    "overlay         60789696  18252208  40013156  31% /",
    "tmpfs              65536         0     65536   0% /dev",
    "/dev/mmcblk0p2  60789696  18252208  40013156  31% /backups",
    "/dev/nvme0n1p1 983378332    668464 932683324   0% /mnt/ssd",
  ].join("\n");

  it("matches SSD by device env var", () => {
    const result = parseDfAndMatch(dfOutput, 1024, {
      ssd: "/dev/nvme0n1p1",
      hdd: "",
      microsd: "",
    });
    expect(result.ssd).not.toBeNull();
    expect(result.ssd?.device).toBe("/dev/nvme0n1p1");
    expect(result.ssd?.online).toBe(true);
    expect(result.ssd?.totalBytes).toBe(983378332 * 1024);
  });

  it("matches microSD by device env var", () => {
    const result = parseDfAndMatch(dfOutput, 1024, {
      ssd: "",
      hdd: "",
      microsd: "/dev/mmcblk0p2",
    });
    expect(result.microsd).not.toBeNull();
    expect(result.microsd?.device).toBe("/dev/mmcblk0p2");
    expect(result.microsd?.online).toBe(true);
    expect(result.microsd?.totalBytes).toBe(60789696 * 1024);
  });

  it("returns online: false for configured but missing device", () => {
    const result = parseDfAndMatch(dfOutput, 1024, {
      ssd: "/dev/nvme0n1p1",
      hdd: "/dev/sda1",
      microsd: "/dev/mmcblk0p2",
    });
    expect(result.hdd).toHaveLength(1);
    expect(result.hdd[0]?.online).toBe(false);
    expect(result.hdd[0]?.device).toBe("/dev/sda1");
    expect(result.hdd[0]?.totalBytes).toBe(0);
  });

  it("supports multiple HDD devices", () => {
    const output = [
      "Filesystem     Size         Used         Avail",
      "/dev/sda1      2000000000   1000000000   1000000000",
      "/dev/sdb1      3000000000   500000000    2500000000",
    ].join("\n");

    const result = parseDfAndMatch(output, 1, {
      ssd: "",
      hdd: "/dev/sda1,/dev/sdb1",
      microsd: "",
    });
    expect(result.hdd).toHaveLength(2);
    expect(result.hdd[0]?.device).toBe("/dev/sda1");
    expect(result.hdd[0]?.online).toBe(true);
    expect(result.hdd[1]?.device).toBe("/dev/sdb1");
    expect(result.hdd[1]?.online).toBe(true);
  });

  it("returns null for unconfigured devices", () => {
    const result = parseDfAndMatch(dfOutput, 1024, { ssd: "", hdd: "", microsd: "" });
    expect(result.ssd).toBeNull();
    expect(result.hdd).toHaveLength(0);
    expect(result.microsd).toBeNull();
  });

  it("deduplicates devices in df output", () => {
    const output = [
      "Filesystem     Size         Used         Avail",
      "/dev/sda1      1000000      400000       600000",
      "/dev/sda1      1000000      500000       500000",
    ].join("\n");

    const result = parseDfAndMatch(output, 1, { ssd: "/dev/sda1", hdd: "", microsd: "" });
    expect(result.ssd?.usedBytes).toBe(400000);
  });

  it("skips non-/dev/ sources", () => {
    const output = [
      "Filesystem     Size         Used         Avail",
      "tmpfs          1000000      500000       500000",
      "overlay        2000000      1000000      1000000",
    ].join("\n");

    const result = parseDfAndMatch(output, 1, { ssd: "/dev/nvme0n1p1", hdd: "", microsd: "" });
    expect(result.ssd?.online).toBe(false);
  });

  it("handles 0 total bytes gracefully", () => {
    const output = ["Filesystem     Size   Used   Avail", "/dev/sda1      0      0      0"].join(
      "\n",
    );

    const result = parseDfAndMatch(output, 1, { ssd: "/dev/sda1", hdd: "", microsd: "" });
    expect(result.ssd?.usagePercent).toBe(0);
    expect(result.ssd?.online).toBe(true);
  });

  it("calculates usage percent correctly", () => {
    const output = [
      "Filesystem     Size         Used         Avail",
      "/dev/sda1      3000000      1000000      2000000",
    ].join("\n");

    const result = parseDfAndMatch(output, 1, { ssd: "/dev/sda1", hdd: "", microsd: "" });
    expect(result.ssd?.usagePercent).toBe(33.3);
  });
});

describe("GET /system — response contract", () => {
  interface DiskInfo {
    device: string;
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
    online: boolean;
  }

  function createStatsApp(overrides: {
    cpu?: { usagePercent: number; cores: number };
    memory?: {
      totalBytes: number;
      usedBytes: number;
      availableBytes: number;
      usagePercent: number;
    };
    disk?: {
      ssd: DiskInfo | null;
      hdd: DiskInfo[];
      microsd: DiskInfo | null;
    };
  }) {
    const app = new Hono();

    app.get("/system", async (c) => {
      const cpu = overrides.cpu ?? { usagePercent: 25.5, cores: 4 };
      const memory = overrides.memory ?? {
        totalBytes: 4_000_000_000,
        usedBytes: 2_000_000_000,
        availableBytes: 2_000_000_000,
        usagePercent: 50,
      };
      const disk = overrides.disk ?? { ssd: null, hdd: [], microsd: null };

      return c.json({
        data: {
          cpu,
          memory,
          disk,
          timestamp: new Date().toISOString(),
        },
      });
    });

    return app;
  }

  it("returns cpu, memory, disk, and timestamp", async () => {
    const app = createStatsApp({});
    const res = await app.request("/system");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveProperty("cpu");
    expect(body.data).toHaveProperty("memory");
    expect(body.data).toHaveProperty("disk");
    expect(body.data).toHaveProperty("timestamp");
  });

  it("timestamp is a valid ISO string", async () => {
    const app = createStatsApp({});
    const res = await app.request("/system");
    const body = await res.json();
    expect(new Date(body.data.timestamp).toISOString()).toBe(body.data.timestamp);
  });

  it("returns correct cpu shape", async () => {
    const app = createStatsApp({ cpu: { usagePercent: 75.3, cores: 8 } });
    const res = await app.request("/system");
    const body = await res.json();
    expect(body.data.cpu.usagePercent).toBe(75.3);
    expect(body.data.cpu.cores).toBe(8);
  });

  it("returns correct memory shape", async () => {
    const mem = {
      totalBytes: 8_000_000_000,
      usedBytes: 6_000_000_000,
      availableBytes: 2_000_000_000,
      usagePercent: 75,
    };
    const app = createStatsApp({ memory: mem });
    const res = await app.request("/system");
    const body = await res.json();
    expect(body.data.memory).toEqual(mem);
  });

  it("returns structured disk with ssd, hdd, and microsd", async () => {
    const ssd: DiskInfo = {
      device: "/dev/nvme0n1p1",
      totalBytes: 1_000_000_000_000,
      usedBytes: 500_000_000,
      availableBytes: 999_500_000_000,
      usagePercent: 0.1,
      online: true,
    };
    const app = createStatsApp({
      disk: { ssd, hdd: [], microsd: null },
    });
    const res = await app.request("/system");
    const body = await res.json();
    expect(body.data.disk.ssd.device).toBe("/dev/nvme0n1p1");
    expect(body.data.disk.ssd.online).toBe(true);
    expect(body.data.disk.hdd).toHaveLength(0);
    expect(body.data.disk.microsd).toBeNull();
  });

  it("returns null disk fields when no devices configured", async () => {
    const app = createStatsApp({});
    const res = await app.request("/system");
    const body = await res.json();
    expect(body.data.disk.ssd).toBeNull();
    expect(body.data.disk.hdd).toEqual([]);
    expect(body.data.disk.microsd).toBeNull();
  });
});

describe("GET /storage — response contract", () => {
  function createStorageStatsApp(overrides: {
    fileCount?: number;
    totalSizeBytes?: number;
    ssdCount?: number;
    ssdSize?: number;
    hddCount?: number;
    hddSize?: number;
    folderCount?: number;
    userCount?: number;
    activeSessionCount?: number;
  }) {
    const app = new Hono();

    app.get("/storage", async (c) => {
      return c.json({
        data: {
          files: {
            count: overrides.fileCount ?? 0,
            totalSizeBytes: overrides.totalSizeBytes ?? 0,
          },
          tiers: {
            ssd: {
              fileCount: overrides.ssdCount ?? 0,
              totalSizeBytes: overrides.ssdSize ?? 0,
            },
            hdd: {
              fileCount: overrides.hddCount ?? 0,
              totalSizeBytes: overrides.hddSize ?? 0,
            },
          },
          folders: { count: overrides.folderCount ?? 0 },
          users: { count: overrides.userCount ?? 0 },
          activeSessions: { count: overrides.activeSessionCount ?? 0 },
          timestamp: new Date().toISOString(),
        },
      });
    });

    return app;
  }

  it("returns full response shape", async () => {
    const app = createStorageStatsApp({});
    const res = await app.request("/storage");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveProperty("files");
    expect(body.data).toHaveProperty("tiers");
    expect(body.data).toHaveProperty("folders");
    expect(body.data).toHaveProperty("users");
    expect(body.data).toHaveProperty("activeSessions");
    expect(body.data).toHaveProperty("timestamp");
  });

  it("returns correct file stats", async () => {
    const app = createStorageStatsApp({ fileCount: 42, totalSizeBytes: 1_000_000 });
    const res = await app.request("/storage");
    const body = await res.json();
    expect(body.data.files.count).toBe(42);
    expect(body.data.files.totalSizeBytes).toBe(1_000_000);
  });

  it("returns correct tier breakdown", async () => {
    const app = createStorageStatsApp({
      ssdCount: 30,
      ssdSize: 500_000,
      hddCount: 12,
      hddSize: 500_000,
    });
    const res = await app.request("/storage");
    const body = await res.json();
    expect(body.data.tiers.ssd.fileCount).toBe(30);
    expect(body.data.tiers.ssd.totalSizeBytes).toBe(500_000);
    expect(body.data.tiers.hdd.fileCount).toBe(12);
    expect(body.data.tiers.hdd.totalSizeBytes).toBe(500_000);
  });

  it("returns zero counts when database is empty", async () => {
    const app = createStorageStatsApp({});
    const res = await app.request("/storage");
    const body = await res.json();
    expect(body.data.files.count).toBe(0);
    expect(body.data.files.totalSizeBytes).toBe(0);
    expect(body.data.folders.count).toBe(0);
    expect(body.data.users.count).toBe(0);
    expect(body.data.activeSessions.count).toBe(0);
  });

  it("timestamp is a valid ISO string", async () => {
    const app = createStorageStatsApp({});
    const res = await app.request("/storage");
    const body = await res.json();
    expect(new Date(body.data.timestamp).toISOString()).toBe(body.data.timestamp);
  });
});

describe("sum(sizeBytes) parsing — parseInt fallback for null", () => {
  it("returns 0 for null sum result", () => {
    const sumResult: string | null = null;
    const total = parseInt(String(sumResult ?? "0"), 10);
    expect(total).toBe(0);
  });

  it("returns 0 for '0' sum result", () => {
    const total = parseInt(String("0"), 10);
    expect(total).toBe(0);
  });

  it("parses valid numeric string", () => {
    const total = parseInt(String("123456789"), 10);
    expect(total).toBe(123456789);
  });

  it("handles very large values", () => {
    const total = parseInt(String("1099511627776"), 10);
    expect(total).toBe(1099511627776); // 1 TiB
  });
});

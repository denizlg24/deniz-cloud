import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  HardDrive,
  Loader2,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  createTask,
  deleteTaskApi,
  getTaskRuns,
  getTasks,
  runTaskNow,
  type ScheduledTask,
  type TaskRun,
  type TaskType,
  updateTaskApi,
} from "@/lib/api";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  backup_postgres: "Backup PostgreSQL",
  backup_mongodb: "Backup MongoDB",
  backup_files: "Backup Files",
  backup_all: "Backup All",
  restart_container: "Restart Container",
  reboot_server: "Reboot Server",
};

const TASK_TYPE_ICONS: Record<TaskType, typeof Database> = {
  backup_postgres: Database,
  backup_mongodb: Database,
  backup_files: HardDrive,
  backup_all: Server,
  restart_container: RotateCcw,
  reboot_server: Power,
};

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at 3 AM", value: "0 3 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Weekly (Sun 3 AM)", value: "0 3 * * 0" },
  { label: "Monthly (1st, 3 AM)", value: "0 3 1 * *" },
  { label: "Custom", value: "custom" },
];

function statusVariant(status: TaskRun["status"]) {
  switch (status) {
    case "completed":
      return "outline" as const;
    case "failed":
      return "destructive" as const;
    case "running":
      return "default" as const;
    default:
      return "secondary" as const;
  }
}

export function TasksPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getTasks();
      setTasks(res.data);
    } catch {
      toast.error("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteTaskApi(deleteTarget.id);
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      refresh();
    } catch {
      toast.error("Failed to delete task");
    }
  }

  async function handleToggle(task: ScheduledTask) {
    try {
      await updateTaskApi(task.id, { enabled: !task.enabled });
      toast.success(`${task.enabled ? "Disabled" : "Enabled"} "${task.name}"`);
      refresh();
    } catch {
      toast.error("Failed to update task");
    }
  }

  async function handleRunNow(task: ScheduledTask) {
    try {
      await runTaskNow(task.id);
      toast.success(`Started "${task.name}"`);
    } catch {
      toast.error("Failed to start task");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scheduled Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tasks.length} task{tasks.length !== 1 && "s"} configured
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                New task
              </Button>
            </DialogTrigger>
            {createOpen && (
              <CreateTaskDialog
                onCreated={() => {
                  setCreateOpen(false);
                  refresh();
                }}
              />
            )}
          </Dialog>
        </div>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden sm:table-cell">Schedule</TableHead>
              <TableHead className="hidden md:table-cell">Next Run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const Icon = TASK_TYPE_ICONS[task.type];
              const isExpanded = expandedTask === task.id;
              return (
                <TaskRowGroup
                  key={task.id}
                  task={task}
                  icon={Icon}
                  isExpanded={isExpanded}
                  onToggleExpand={() => setExpandedTask(isExpanded ? null : task.id)}
                  onToggleEnabled={() => handleToggle(task)}
                  onRunNow={() => handleRunNow(task)}
                  onDelete={() => setDeleteTarget(task)}
                />
              );
            })}
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No scheduled tasks yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all its run
              history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TaskRowGroup({
  task,
  icon: Icon,
  isExpanded,
  onToggleExpand,
  onToggleEnabled,
  onRunNow,
  onDelete,
}: {
  task: ScheduledTask;
  icon: typeof Database;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onRunNow: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggleExpand}>
        <TableCell className="w-8">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-medium">{task.name}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">{TASK_TYPE_LABELS[task.type]}</span>
          </div>
        </TableCell>
        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
          {task.cronExpression ? (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <code className="text-xs">{task.cronExpression}</code>
            </span>
          ) : task.scheduledAt ? (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatDateTime(task.scheduledAt)}
            </span>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
          {task.nextRunAt ? formatDateTime(task.nextRunAt) : "—"}
        </TableCell>
        <TableCell>
          <Badge variant={task.enabled ? "outline" : "secondary"}>
            {task.enabled ? "Active" : "Disabled"}
          </Badge>
        </TableCell>
        <TableCell>
          <TooltipProvider delayDuration={300}>
            {/*biome-ignore lint/a11y/useKeyWithClickEvents: honestly don't care about accessability*/}
            {/*biome-ignore lint/a11y/noStaticElementInteractions: honestly don't care about accessability*/}
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRunNow}>
                    <Play className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Run now</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleEnabled}>
                    {task.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{task.enabled ? "Disable" : "Enable"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={onDelete}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-0">
            <TaskRunHistory taskId={task.id} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TaskRunHistory({ taskId }: { taskId: string }) {
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTaskRuns(taskId)
      .then((res) => setRuns(res.data))
      .catch(() => toast.error("Failed to load run history"))
      .finally(() => setLoading(false));
  }, [taskId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (runs.length === 0) {
    return <div className="text-center py-6 text-sm text-muted-foreground">No runs yet</div>;
  }

  return (
    <div className="px-4 py-3">
      <h4 className="text-sm font-medium mb-2">Run History</h4>
      <div className="space-y-2">
        {runs.map((run) => (
          <div key={run.id} className="rounded border bg-background p-3 text-sm">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                {run.startedAt && (
                  <span className="text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                )}
              </div>
              {run.metadata?.durationMs != null && (
                <span className="text-muted-foreground">
                  {formatDuration(run.metadata.durationMs)}
                </span>
              )}
            </div>
            {run.metadata?.backupSizeBytes != null && (
              <p className="text-muted-foreground text-xs">
                Backup size: {formatBytes(run.metadata.backupSizeBytes)}
              </p>
            )}
            {run.output && (
              <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-40">
                {run.output}
              </pre>
            )}
            {run.error && (
              <pre className="mt-2 text-xs bg-destructive/10 text-destructive p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-40">
                {run.error}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateTaskDialog({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<TaskType>("backup_postgres");
  const [scheduleMode, setScheduleMode] = useState<"cron" | "once">("cron");
  const [cronPreset, setCronPreset] = useState("0 3 * * *");
  const [customCron, setCustomCron] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [retentionCount, setRetentionCount] = useState("7");
  const [containerNames, setContainerNames] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isBackupType = type.startsWith("backup_");
  const needsContainers = type === "restart_container";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    try {
      const cronExpression =
        scheduleMode === "cron" ? (cronPreset === "custom" ? customCron : cronPreset) : undefined;

      await createTask({
        name: name.trim(),
        type,
        cronExpression,
        scheduledAt: scheduleMode === "once" ? new Date(scheduledAt).toISOString() : undefined,
        config: {
          retentionCount: isBackupType ? parseInt(retentionCount, 10) : undefined,
          containerNames: needsContainers
            ? containerNames
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        },
      });
      toast.success(`Created task "${name}"`);
      onCreated();
    } catch {
      toast.error("Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent className="max-w-md">
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>Create scheduled task</DialogTitle>
          <DialogDescription>Configure a backup, restart, or reboot task.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="task-name">Name</Label>
            <Input
              id="task-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nightly Postgres backup"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
              <SelectTrigger id="task-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(TASK_TYPE_LABELS) as [TaskType, string][]).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Schedule</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={scheduleMode === "cron" ? "default" : "outline"}
                onClick={() => setScheduleMode("cron")}
              >
                Recurring
              </Button>
              <Button
                type="button"
                size="sm"
                variant={scheduleMode === "once" ? "default" : "outline"}
                onClick={() => setScheduleMode("once")}
              >
                One-time
              </Button>
            </div>
          </div>

          {scheduleMode === "cron" ? (
            <div className="space-y-2">
              <Label htmlFor="cron-preset">Frequency</Label>
              <Select value={cronPreset} onValueChange={setCronPreset}>
                <SelectTrigger id="cron-preset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                      {p.value !== "custom" && (
                        <span className="text-muted-foreground ml-2 text-xs">{p.value}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cronPreset === "custom" && (
                <Input
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="0 3 * * *"
                  required
                />
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="scheduled-at">Run at</Label>
              <Input
                id="scheduled-at"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
              />
            </div>
          )}

          {isBackupType && (
            <div className="space-y-2">
              <Label htmlFor="retention">Retention (keep last N)</Label>
              <Input
                id="retention"
                type="number"
                min="1"
                max="100"
                value={retentionCount}
                onChange={(e) => setRetentionCount(e.target.value)}
              />
            </div>
          )}

          {needsContainers && (
            <div className="space-y-2">
              <Label htmlFor="containers">Container names (comma-separated)</Label>
              <Input
                id="containers"
                value={containerNames}
                onChange={(e) => setContainerNames(e.target.value)}
                placeholder="postgres, mongodb"
                required
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create task"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

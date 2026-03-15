import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Database,
  FolderOpen,
  Key,
  Loader2,
  Plus,
  RefreshCw,
  Search,
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type ApiKey,
  createApiKey,
  createCollectionApi,
  createProject,
  type DiscoveredField,
  deleteCollectionApi,
  deleteProject,
  discoverFields,
  getApiKeys,
  getCollections,
  getProjects,
  type Project,
  type ProjectCollection,
  resyncCollection,
  revokeApiKey,
  updateCollectionApi,
} from "@/lib/api";
import { formatDate } from "@/lib/format";

const ALL_SCOPES = [
  { value: "storage:read", label: "Storage Read", group: "Storage" },
  { value: "storage:write", label: "Storage Write", group: "Storage" },
  { value: "storage:delete", label: "Storage Delete", group: "Storage" },
  { value: "search:read", label: "Search Read", group: "Search" },
  { value: "search:write", label: "Search Write", group: "Search" },
  { value: "search:manage", label: "Search Manage", group: "Search" },
] as const;

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getProjects();
      setProjects(res.data);
    } catch {
      toast.error("Failed to load projects");
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
      await deleteProject(deleteTarget.id);
      toast.success(`Deleted project "${deleteTarget.name}"`);
      setDeleteTarget(null);
      refresh();
    } catch {
      toast.error("Failed to delete project");
    }
  }

  if (selectedProject) {
    return (
      <ProjectDetailView
        project={selectedProject}
        onBack={() => {
          setSelectedProject(null);
          refresh();
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {projects.length} project{projects.length !== 1 && "s"}
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
                New project
              </Button>
            </DialogTrigger>
            <CreateProjectDialog
              onCreated={() => {
                setCreateOpen(false);
                refresh();
              }}
            />
          </Dialog>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Slug</TableHead>
              <TableHead className="hidden md:table-cell">Description</TableHead>
              <TableHead className="hidden lg:table-cell">Created</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow
                key={project.id}
                className="cursor-pointer"
                onClick={() => setSelectedProject(project)}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    {project.name}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{project.slug}</code>
                </TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground text-sm max-w-[200px] truncate">
                  {project.description ?? "\u2014"}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                  {formatDate(project.createdAt)}
                </TableCell>
                <TableCell>
                  <TooltipProvider delayDuration={300}>
                    <div className="flex gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedProject(project);
                            }}
                          >
                            <Key className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Manage API keys</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(project);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete project</TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </TableCell>
              </TableRow>
            ))}
            {projects.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No projects yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong>, its storage
              folder, and all API keys. This cannot be undone.
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

function SyncStatusBadge({ status, error }: { status: string; error: string | null }) {
  switch (status) {
    case "idle":
      return (
        <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-green-500/20">
          Idle
        </Badge>
      );
    case "syncing":
      return (
        <Badge
          variant="secondary"
          className="bg-blue-500/10 text-blue-600 border-blue-500/20 animate-pulse"
        >
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Syncing
        </Badge>
      );
    case "error":
      return (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="destructive" className="cursor-help">
                <AlertCircle className="h-3 w-3 mr-1" />
                Error
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px]">
              <p className="text-xs">{error ?? "Unknown error"}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function ProjectDetailView({ project, onBack }: { project: Project; onBack: () => void }) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [collections, setCollections] = useState<ProjectCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createCollOpen, setCreateCollOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [deleteCollTarget, setDeleteCollTarget] = useState<ProjectCollection | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const refreshKeys = useCallback(async () => {
    try {
      const keys = await getApiKeys(project.id);
      setApiKeys(keys);
    } catch {
      toast.error("Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  const refreshCollections = useCallback(async () => {
    try {
      const colls = await getCollections(project.id);
      setCollections(colls);
    } catch {
      toast.error("Failed to load collections");
    } finally {
      setCollectionsLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    refreshKeys();
    refreshCollections();
  }, [refreshKeys, refreshCollections]);

  async function handleRevoke() {
    if (!revokeTarget) return;
    try {
      await revokeApiKey(project.id, revokeTarget.id);
      toast.success(`Revoked key "${revokeTarget.name}"`);
      setRevokeTarget(null);
      refreshKeys();
    } catch {
      toast.error("Failed to revoke API key");
    }
  }

  async function handleDeleteCollection() {
    if (!deleteCollTarget) return;
    try {
      await deleteCollectionApi(project.id, deleteCollTarget.id);
      toast.success(`Deleted collection "${deleteCollTarget.name}"`);
      setDeleteCollTarget(null);
      refreshCollections();
    } catch {
      toast.error("Failed to delete collection");
    }
  }

  async function handleResync(coll: ProjectCollection) {
    try {
      await resyncCollection(project.id, coll.id);
      toast.success(`Resync started for "${coll.name}"`);
      refreshCollections();
    } catch {
      toast.error("Failed to trigger resync");
    }
  }

  async function handleToggleSync(coll: ProjectCollection) {
    try {
      await updateCollectionApi(project.id, coll.id, {
        syncEnabled: !coll.syncEnabled,
      });
      toast.success(
        coll.syncEnabled ? `Paused sync for "${coll.name}"` : `Resumed sync for "${coll.name}"`,
      );
      refreshCollections();
    } catch {
      toast.error("Failed to toggle sync");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{project.slug}</code>
            {project.description && <span className="ml-2">{project.description}</span>}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium flex items-center gap-2">
            <Key className="h-4 w-4" />
            API Keys
          </h2>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={refreshKeys}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Dialog
              open={createOpen}
              onOpenChange={(open) => {
                setCreateOpen(open);
                if (!open) setNewKey(null);
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  New key
                </Button>
              </DialogTrigger>
              <CreateApiKeyDialog
                projectId={project.id}
                onCreated={(key) => {
                  setNewKey(key);
                  refreshKeys();
                }}
                newKey={newKey}
              />
            </Dialog>
          </div>
        </div>

        {loading ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead className="hidden sm:table-cell">Scopes</TableHead>
                  <TableHead className="hidden md:table-cell">Expires</TableHead>
                  <TableHead className="hidden lg:table-cell">Last used</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="w-16">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => {
                  const isExpired = key.expiresAt && new Date(key.expiresAt) < new Date();
                  return (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {key.keyPrefix}...
                        </code>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {key.scopes.map((scope) => (
                            <Badge key={scope} variant="secondary" className="text-[10px]">
                              {scope}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">
                        {key.expiresAt ? (
                          <span
                            className={isExpired ? "text-destructive" : "text-muted-foreground"}
                          >
                            {isExpired ? "Expired" : formatDate(key.expiresAt)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                        {key.lastUsedAt ? formatDate(key.lastUsedAt) : "Never"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                        {formatDate(key.createdAt)}
                      </TableCell>
                      <TableCell>
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setRevokeTarget(key)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Revoke key</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {apiKeys.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No API keys yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium flex items-center gap-2">
            <Database className="h-4 w-4" />
            Collections
            <span className="text-sm font-normal text-muted-foreground">
              (MongoDB &rarr; Meilisearch)
            </span>
          </h2>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={refreshCollections}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Dialog open={createCollOpen} onOpenChange={setCreateCollOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  New collection
                </Button>
              </DialogTrigger>
              <CreateCollectionDialog
                projectId={project.id}
                onCreated={() => {
                  setCreateCollOpen(false);
                  refreshCollections();
                }}
              />
            </Dialog>
          </div>
        </div>

        {collectionsLoading ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Documents</TableHead>
                  <TableHead className="hidden lg:table-cell">Last synced</TableHead>
                  <TableHead className="w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.map((coll) => (
                  <TableRow key={coll.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        {coll.name}
                      </div>
                      <code className="text-[10px] text-muted-foreground">
                        {coll.meiliIndexUid}
                      </code>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {coll.mongoDatabase}.{coll.mongoCollection}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <SyncStatusBadge status={coll.syncStatus} error={coll.lastError} />
                        {!coll.syncEnabled && (
                          <Badge variant="outline" className="text-[10px]">
                            Paused
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {coll.documentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {coll.lastSyncedAt ? formatDate(coll.lastSyncedAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      <TooltipProvider delayDuration={300}>
                        <div className="flex gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleResync(coll)}
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Full resync</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleToggleSync(coll)}
                              >
                                {coll.syncEnabled ? (
                                  <span className="text-xs font-mono">||</span>
                                ) : (
                                  <span className="text-xs">&#9654;</span>
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {coll.syncEnabled ? "Pause sync" : "Resume sync"}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteCollTarget(coll)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete collection</TooltipContent>
                          </Tooltip>
                        </div>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
                {collections.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No collections yet. Create one to sync MongoDB data to Meilisearch.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke <strong>{revokeTarget?.name}</strong> (
              <code>{revokeTarget?.keyPrefix}...</code>). Any applications using this key will lose
              access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteCollTarget}
        onOpenChange={(open) => !open && setDeleteCollTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete collection</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteCollTarget?.name}</strong>, stop its sync,
              and remove the Meilisearch index. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCollection}
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

function CreateProjectDialog({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      );
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createProject({
        name: name.trim(),
        slug: slug.toLowerCase(),
        description: description.trim() || undefined,
      });
      toast.success(`Created project "${name}"`);
      onCreated();
    } catch {
      toast.error("Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Projects isolate storage and search resources. Each project gets a private folder and
            can have multiple API keys.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="proj-name">Name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My App"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proj-slug">Slug</Label>
            <Input
              id="proj-slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
              }}
              placeholder="my-app"
              pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]"
              title="3-64 chars: lowercase letters, numbers, hyphens"
              required
            />
            <p className="text-xs text-muted-foreground">
              Used for folder paths and API references. Cannot be changed.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="proj-desc">Description (optional)</Label>
            <Textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project for?"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create project"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function CreateApiKeyDialog({
  projectId,
  onCreated,
  newKey,
}: {
  projectId: string;
  onCreated: (key: string) => void;
  newKey: string | null;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresIn, setExpiresIn] = useState("never");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  function toggleScope(scope: string) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (scopes.length === 0) {
      toast.error("Select at least one scope");
      return;
    }
    setSubmitting(true);
    try {
      const result = await createApiKey(projectId, {
        name: name.trim(),
        scopes,
        expiresIn: expiresIn === "never" ? undefined : expiresIn,
      });
      onCreated(result.key);
    } catch {
      toast.error("Failed to create API key");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (newKey) {
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle>API key created</DialogTitle>
          <DialogDescription>Copy this key now. It will not be shown again.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted p-3 rounded text-sm font-mono break-all select-all">
              {newKey}
            </code>
            <Button variant="outline" size="icon" onClick={handleCopy} className="shrink-0">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <p className="text-xs text-muted-foreground flex-1">
            Use the <code className="bg-muted px-1 rounded">X-API-Key</code> header to authenticate.
          </p>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            Generate a scoped key for programmatic access to this project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="production-backend"
              required
              autoFocus
            />
          </div>

          <div className="space-y-3">
            <Label>Scopes</Label>
            {(["Storage", "Search"] as const).map((group) => (
              <div key={group} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{group}</p>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_SCOPES.filter((s) => s.group === group).map((scope) => (
                    // biome-ignore lint/a11y/noLabelWithoutControl: not needed
                    <label
                      key={scope.value}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={scopes.includes(scope.value)}
                        onCheckedChange={() => toggleScope(scope.value)}
                      />
                      {scope.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="key-expires">Expiration</Label>
            <Select value={expiresIn} onValueChange={setExpiresIn}>
              <SelectTrigger id="key-expires">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30d">30 days</SelectItem>
                <SelectItem value="90d">90 days</SelectItem>
                <SelectItem value="1y">1 year</SelectItem>
                <SelectItem value="never">Never</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={submitting || scopes.length === 0}>
            {submitting ? "Creating..." : "Create key"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function CreateCollectionDialog({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [mongoDatabase, setMongoDatabase] = useState("");
  const [mongoCollection, setMongoCollection] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [discoveredFields, setDiscoveredFields] = useState<DiscoveredField[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [searchableFields, setSearchableFields] = useState<string[]>([]);
  const [filterableFields, setFilterableFields] = useState<string[]>([]);
  const [sortableFields, setSortableFields] = useState<string[]>([]);

  async function handleDiscover() {
    if (!mongoDatabase.trim() || !mongoCollection.trim()) {
      toast.error("Enter MongoDB database and collection names first");
      return;
    }
    setDiscovering(true);
    try {
      const result = await discoverFields(projectId, mongoDatabase.trim(), mongoCollection.trim());
      setDiscoveredFields(result.fields);
      if (result.sampleCount === 0) {
        toast.info("Collection is empty - no fields discovered");
      } else {
        toast.success(
          `Discovered ${result.fields.length} fields from ${result.sampleCount} documents`,
        );
      }
    } catch {
      toast.error("Failed to discover fields. Check database/collection names.");
    } finally {
      setDiscovering(false);
    }
  }

  function toggleField(field: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(field) ? list.filter((f) => f !== field) : [...list, field]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createCollectionApi(projectId, {
        name: name.trim(),
        mongoDatabase: mongoDatabase.trim(),
        mongoCollection: mongoCollection.trim(),
        fieldMapping: {
          searchableAttributes: searchableFields.length > 0 ? searchableFields : undefined,
          filterableAttributes: filterableFields.length > 0 ? filterableFields : undefined,
          sortableAttributes: sortableFields.length > 0 ? sortableFields : undefined,
        },
      });
      toast.success(`Created collection "${name}"`);
      onCreated();
    } catch {
      toast.error("Failed to create collection");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>Create collection</DialogTitle>
          <DialogDescription>
            Sync a MongoDB collection to a Meilisearch index for full-text search.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="coll-name">Collection name</Label>
            <Input
              id="coll-name"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="products"
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              title="Lowercase alphanumeric with hyphens"
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Used as the Meilisearch index suffix.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="coll-db">MongoDB database</Label>
              <Input
                id="coll-db"
                value={mongoDatabase}
                onChange={(e) => setMongoDatabase(e.target.value)}
                placeholder="myapp"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coll-mongocoll">MongoDB collection</Label>
              <Input
                id="coll-mongocoll"
                value={mongoCollection}
                onChange={(e) => setMongoCollection(e.target.value)}
                placeholder="products"
                required
              />
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDiscover}
            disabled={discovering}
            className="w-full"
          >
            {discovering ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Discovering...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-1" />
                Discover fields
              </>
            )}
          </Button>

          {discoveredFields.length > 0 && (
            <div className="space-y-3 border rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground">Field mapping</p>

              <div className="space-y-2">
                <p className="text-xs font-medium">Searchable</p>
                <div className="flex flex-wrap gap-1.5">
                  {discoveredFields.map((f) => (
                    // biome-ignore lint/a11y/noLabelWithoutControl: not needed
                    <label
                      key={`s-${f.name}`}
                      className="flex items-center gap-1.5 text-xs cursor-pointer"
                    >
                      <Checkbox
                        checked={searchableFields.includes(f.name)}
                        onCheckedChange={() =>
                          toggleField(f.name, searchableFields, setSearchableFields)
                        }
                      />
                      {f.name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium">Filterable</p>
                <div className="flex flex-wrap gap-1.5">
                  {discoveredFields.map((f) => (
                    // biome-ignore lint/a11y/noLabelWithoutControl: not needed
                    <label
                      key={`f-${f.name}`}
                      className="flex items-center gap-1.5 text-xs cursor-pointer"
                    >
                      <Checkbox
                        checked={filterableFields.includes(f.name)}
                        onCheckedChange={() =>
                          toggleField(f.name, filterableFields, setFilterableFields)
                        }
                      />
                      {f.name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium">Sortable</p>
                <div className="flex flex-wrap gap-1.5">
                  {discoveredFields.map((f) => (
                    // biome-ignore lint/a11y/noLabelWithoutControl: not needed
                    <label
                      key={`so-${f.name}`}
                      className="flex items-center gap-1.5 text-xs cursor-pointer"
                    >
                      <Checkbox
                        checked={sortableFields.includes(f.name)}
                        onCheckedChange={() =>
                          toggleField(f.name, sortableFields, setSortableFields)
                        }
                      />
                      {f.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create collection"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

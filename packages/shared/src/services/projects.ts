import { eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import { folders, projects } from "../db/schema";
import type { SafeProject } from "../types";
import { AuthError } from "./auth";

export async function createProject(
  db: Database,
  input: {
    name: string;
    slug: string;
    description?: string;
    ownerId: string;
    storageRootPath: string;
  },
): Promise<SafeProject> {
  const folderPath = `/${input.slug}`;

  const [folder] = await db
    .insert(folders)
    .values({
      ownerId: input.ownerId,
      path: folderPath,
      name: input.slug,
    })
    .returning();

  if (!folder) throw new Error("Failed to create project storage folder");

  const [project] = await db
    .insert(projects)
    .values({
      name: input.name,
      slug: input.slug,
      description: input.description,
      ownerId: input.ownerId,
      storageFolderId: folder.id,
    })
    .returning();

  if (!project) throw new Error("Failed to create project");
  return project;
}

export async function listProjects(
  db: Database,
  opts: { page?: number; limit?: number } = {},
): Promise<{ projects: SafeProject[]; total: number }> {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 50;
  const offset = (page - 1) * limit;

  const [allProjects, countResult] = await Promise.all([
    db.select().from(projects).orderBy(projects.createdAt).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(projects),
  ]);

  return {
    projects: allProjects,
    total: countResult[0]?.count ?? 0,
  };
}

export async function getProject(db: Database, projectId: string): Promise<SafeProject> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) throw new AuthError("Project not found", "PROJECT_NOT_FOUND", 404);
  return project;
}

export async function getProjectBySlug(db: Database, slug: string): Promise<SafeProject> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, slug),
  });

  if (!project) throw new AuthError("Project not found", "PROJECT_NOT_FOUND", 404);
  return project;
}

export async function updateProject(
  db: Database,
  projectId: string,
  input: { name?: string; description?: string },
): Promise<SafeProject> {
  const existing = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!existing) throw new AuthError("Project not found", "PROJECT_NOT_FOUND", 404);

  const [updated] = await db
    .update(projects)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .returning();

  if (!updated) throw new Error("Failed to update project");
  return updated;
}

export async function deleteProject(db: Database, projectId: string): Promise<void> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) throw new AuthError("Project not found", "PROJECT_NOT_FOUND", 404);

  if (project.storageFolderId) {
    await db.delete(folders).where(eq(folders.id, project.storageFolderId));
  }

  await db.delete(projects).where(eq(projects.id, projectId));
}

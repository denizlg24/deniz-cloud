import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import type { Context } from "hono";
import { isProjectPath } from "./path";

type AuthContext = Context<{ Variables: AuthVariables }>;

/**
 * For API key auth: checks that the required scope is present and the resource
 * path falls within the project's folder.
 *
 * For session auth (project is undefined): returns null (pass-through to
 * existing ownership checks).
 *
 * Returns an error Response to short-circuit, or null to continue.
 */
export function checkProjectScope(
  c: AuthContext,
  resourcePath: string,
  requiredScope: string,
): Response | null {
  const project = c.get("project");
  const scopes = c.get("scopes");

  if (!project) return null;

  if (!scopes?.includes(requiredScope)) {
    return c.json(
      {
        error: {
          code: "INSUFFICIENT_SCOPE",
          message: `Required scope: ${requiredScope}`,
        },
      },
      403,
    );
  }

  if (!isProjectPath(resourcePath, project.slug)) {
    return c.json(
      {
        error: {
          code: "ACCESS_DENIED",
          message: "Resource is outside project scope",
        },
      },
      403,
    );
  }

  return null;
}

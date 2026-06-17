import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "../db/client";
import { workspaces } from "../db/schema";
import { getRequestUserIdFromCookies } from "./auth-service";

const defaultWorkspaceName = "Personal JobDesk";
type DbHandle = ReturnType<typeof getDb>;

export function getDefaultWorkspaceName() {
  return defaultWorkspaceName;
}

export async function getOrCreateDefaultWorkspace(
  db: Pick<DbHandle, "select" | "insert">,
) {
  const userId = await getRequestUserIdFromCookies();
  const whereClause = userId
    ? and(eq(workspaces.userId, userId), eq(workspaces.name, defaultWorkspaceName))
    : and(isNull(workspaces.userId), eq(workspaces.name, defaultWorkspaceName));
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(whereClause)
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(workspaces)
    .values({ name: defaultWorkspaceName, userId })
    .returning();
  if (!created) {
    throw new Error("Failed to create workspace.");
  }
  return created;
}

export async function getCurrentWorkspace(db: Pick<DbHandle, "select" | "insert">) {
  return getOrCreateDefaultWorkspace(db);
}

export async function claimDefaultUnownedWorkspaceForUser(
  db: Pick<DbHandle, "select" | "update">,
  userId: string,
) {
  const [existingUserWorkspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.userId, userId), eq(workspaces.name, defaultWorkspaceName)))
    .limit(1);
  if (existingUserWorkspace) {
    return { status: "already_owned" as const, workspace: existingUserWorkspace };
  }

  const [claimed] = await db
    .update(workspaces)
    .set({ userId, updatedAt: new Date() })
    .where(and(isNull(workspaces.userId), eq(workspaces.name, defaultWorkspaceName)))
    .returning();
  return claimed
    ? ({ status: "claimed" as const, workspace: claimed })
    : ({ status: "not_found" as const });
}

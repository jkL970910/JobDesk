import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "../db/client";
import { workspaces } from "../db/schema";
import { getRequestUserIdFromCookies } from "./auth-service";

const defaultWorkspaceName = "Personal JobDesk";
type DbHandle = ReturnType<typeof getDb>;

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

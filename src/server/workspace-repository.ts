import { eq } from "drizzle-orm";

import { getDb } from "../db/client";
import { workspaces } from "../db/schema";

const defaultWorkspaceName = "Personal JobDesk";
type DbHandle = ReturnType<typeof getDb>;

export async function getOrCreateDefaultWorkspace(
  db: Pick<DbHandle, "select" | "insert">,
) {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.name, defaultWorkspaceName))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(workspaces)
    .values({ name: defaultWorkspaceName })
    .returning();
  if (!created) {
    throw new Error("Failed to create workspace.");
  }
  return created;
}

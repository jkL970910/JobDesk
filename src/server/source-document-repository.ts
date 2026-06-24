import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import { sourceDocuments } from "../db/schema";
import type { ResumeSourceParseResult } from "./resume-source-parser";
import { deleteRebuildSourceChunksForSource, indexSourceChunks } from "./source-chunk-service";
import { getCurrentWorkspace } from "./workspace-repository";

export type PersistParsedSourceDocumentResult =
  | {
      status: "saved";
      sourceDocumentId: string;
    }
  | {
      status: "duplicate";
      duplicate: {
        sourceDocumentId: string;
        title: string;
        createdAt: Date;
      };
    }
  | {
      status: "skipped";
      reason: "missing_database_url";
    };

export async function persistParsedSourceDocument(args: {
  sourceType:
    | "project_note"
    | "work_summary"
    | "performance_review"
    | "jd_gap_note"
    | "generic_source";
  parsed: ResumeSourceParseResult;
}): Promise<PersistParsedSourceDocumentResult> {
  if (!hasDatabaseUrl()) {
    return { status: "skipped", reason: "missing_database_url" };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const contentHash = buildSourceContentHash(args.parsed.sourceText);
  const [existing] = await db
    .select()
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.workspaceId, workspace.id),
        eq(sourceDocuments.contentHash, contentHash),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      status: "duplicate",
      duplicate: {
        sourceDocumentId: existing.id,
        title: existing.title,
        createdAt: existing.createdAt,
      },
    };
  }

  const now = new Date();
  const [sourceDocument] = await db
    .insert(sourceDocuments)
    .values({
      workspaceId: workspace.id,
      sourceType: args.sourceType,
      title: args.parsed.sourceTitle,
      originalFilename: args.parsed.originalFilename,
      mimeType: args.parsed.mimeType,
      fileSizeBytes: args.parsed.fileSizeBytes,
      contentText: args.parsed.sourceText,
      contentHash,
      parserName: args.parsed.parserName,
      parserVersion: args.parsed.parserVersion,
      parseStatus: args.parsed.parseQuality.status,
      parseWarnings: args.parsed.parseQuality.warnings,
      pageCount: args.parsed.parseQuality.pageCount,
      charCount: args.parsed.parseQuality.charCount,
      wordCount: args.parsed.parseQuality.wordCount,
      lifecycleStatus:
        args.parsed.parseQuality.status === "needs_ocr" ? "needs_ocr" : "parsed",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: sourceDocuments.id });
  if (!sourceDocument) throw new Error("Failed to save source document.");

  await indexSourceChunks({
    workspaceId: workspace.id,
    sourceDocumentId: sourceDocument.id,
  });

  return {
    status: "saved",
    sourceDocumentId: sourceDocument.id,
  };
}

export async function claimSourceDocumentForExtraction(args: {
  sourceDocumentId: string;
  sourceText: string;
  sourceType?: string;
}): Promise<
  | {
      status: "claimed";
      sourceDocumentId: string;
    }
  | {
      status: "not_found";
    }
  | {
      status: "hash_mismatch";
    }
  | {
      status: "skipped";
      reason: "missing_database_url";
    }
> {
  if (!hasDatabaseUrl()) {
    return { status: "skipped", reason: "missing_database_url" };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const contentHash = buildSourceContentHash(args.sourceText);
  const [existing] = await db
    .select()
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.workspaceId, workspace.id),
        eq(sourceDocuments.id, args.sourceDocumentId),
      ),
    )
    .limit(1);
  if (!existing) return { status: "not_found" };
  if (existing.contentHash && existing.contentHash !== contentHash) {
    return { status: "hash_mismatch" };
  }

  await db
    .update(sourceDocuments)
    .set({
      sourceType: args.sourceType ?? existing.sourceType,
      lifecycleStatus: "extracted",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sourceDocuments.workspaceId, workspace.id),
        eq(sourceDocuments.id, args.sourceDocumentId),
      ),
    );
  await deleteRebuildSourceChunksForSource({
    sourceDocumentId: args.sourceDocumentId,
    workspaceId: workspace.id,
  });

  return {
    status: "claimed",
    sourceDocumentId: args.sourceDocumentId,
  };
}

export function buildSourceContentHash(sourceText: string) {
  return crypto.createHash("sha256").update(sourceText).digest("hex");
}

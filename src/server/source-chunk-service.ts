import crypto from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import { sourceChunks, sourceDocuments } from "../db/schema";
import { embedTextLocal, localEmbeddingModel } from "./embedding-service";
import { getCurrentWorkspace, getOrCreateDefaultWorkspace } from "./workspace-repository";

export const sourceChunkIndexType = "source_chunk_index" as const;
const maxChunkCharacters = 900;
const minChunkCharacters = 120;
const overlapSentences = 1;

export type SourceChunkRecord = typeof sourceChunks.$inferSelect;

export type SourceChunk = {
  id: string;
  chunkIndex: number;
  chunkText: string;
  contentHash: string;
  metadata: {
    source_document_id: string;
    source_type: string;
    chunk_index: number;
    lifecycle_status: string;
    parse_quality_status: string | null;
    parse_warnings: string[];
    sensitivity_hint: "unknown" | "possible_private";
    title: string;
  };
};

type ChunkableSourceDocument = Pick<
  typeof sourceDocuments.$inferSelect,
  | "id"
  | "workspaceId"
  | "sourceType"
  | "title"
  | "contentText"
  | "contentHash"
  | "parseStatus"
  | "parseWarnings"
  | "lifecycleStatus"
>;

export type SourceChunkGapResult = {
  source_document_id: string;
  source_type: string;
  title: string;
  chunk_index: number;
  chunk_text: string;
  retrieval_policy: "evidence_enrichment";
  retrieval_score: number;
  reason_for_selection: string[];
  parse_quality_status: string | null;
  lifecycle_status: string;
  sensitivity_hint: string;
  convert_to_evidence_first: true;
};

type DbHandle = ReturnType<typeof getDb>;
type SourceChunkDb = Pick<DbHandle, "select" | "insert" | "delete">;

export function buildSourceDocumentChunks(document: {
  id: string;
  sourceType: string;
  title: string;
  contentText: string;
  contentHash?: string | null;
  parseStatus: string | null;
  parseWarnings: string[];
  lifecycleStatus: string;
}): SourceChunk[] {
  const text = normalizeChunkText(document.contentText);
  if (text.length < minChunkCharacters) return [];

  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let current: string[] = [];

  for (const sentence of sentences) {
    const next = [...current, sentence].join(" ");
    if (next.length > maxChunkCharacters && current.join(" ").length >= minChunkCharacters) {
      chunks.push(current.join(" "));
      current = overlapSentences > 0 ? current.slice(-overlapSentences) : [];
    }
    current.push(sentence);
  }

  const finalChunk = current.join(" ").trim();
  if (finalChunk.length >= minChunkCharacters) chunks.push(finalChunk);
  if (chunks.length === 0 && text.length >= minChunkCharacters) {
    chunks.push(text.slice(0, maxChunkCharacters));
  }

  return chunks.map((chunkText, index) => ({
    id: buildSourceChunkId(document.id, index),
    chunkIndex: index,
    chunkText,
    contentHash: buildChunkContentHash(document.contentHash ?? document.id, chunkText),
    metadata: {
      source_document_id: document.id,
      source_type: document.sourceType,
      chunk_index: index,
      lifecycle_status: document.lifecycleStatus,
      parse_quality_status: document.parseStatus,
      parse_warnings: document.parseWarnings,
      sensitivity_hint: inferSensitivityHint(chunkText),
      title: document.title,
    },
  }));
}

export function buildSourceChunkId(sourceDocumentId: string, chunkIndex: number) {
  const hex = sourceDocumentId.replace(/-/g, "");
  const suffix = chunkIndex.toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${hex.slice(16, 20)}-${suffix}`;
}

export async function indexSourceChunks(args?: {
  db?: SourceChunkDb;
  sourceDocumentId?: string;
  workspaceId?: string;
  resumeSourceVersionId?: string | null;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = args?.db ?? getDb();
  const workspace = args?.workspaceId
    ? { id: args.workspaceId }
    : await getOrCreateDefaultWorkspace(db);
  const documents = await db
    .select()
    .from(sourceDocuments)
    .where(
      args?.sourceDocumentId
        ? and(
            eq(sourceDocuments.workspaceId, workspace.id),
            eq(sourceDocuments.id, args.sourceDocumentId),
          )
        : eq(sourceDocuments.workspaceId, workspace.id),
    )
    .orderBy(desc(sourceDocuments.updatedAt));

  let indexedCount = 0;
  let sourceDocumentCount = 0;
  for (const document of documents) {
    const rebuilt = await rebuildSourceChunksForDocument({
      db,
      document,
      resumeSourceVersionId: args?.resumeSourceVersionId ?? null,
    });
    indexedCount += rebuilt.count;
    sourceDocumentCount += 1;
  }

  return {
    status: "saved" as const,
    sourceDocumentCount,
    sourceChunkCount: indexedCount,
    embeddingModel: localEmbeddingModel,
  };
}

export async function deleteRebuildSourceChunksForSource(args: {
  db?: SourceChunkDb;
  sourceDocumentId: string;
  workspaceId?: string;
  resumeSourceVersionId?: string | null;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = args.db ?? getDb();
  const workspace = args.workspaceId
    ? { id: args.workspaceId }
    : await getCurrentWorkspace(db);
  const [document] = await db
    .select()
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.workspaceId, workspace.id),
        eq(sourceDocuments.id, args.sourceDocumentId),
      ),
    )
    .limit(1);
  if (!document) {
    return { status: "not_found" as const };
  }

  const deleted = await deleteSourceChunksForSourceDocument(
    db,
    workspace.id,
    args.sourceDocumentId,
  );
  const rebuilt = await rebuildSourceChunksForDocument({
    db,
    document,
    resumeSourceVersionId: args.resumeSourceVersionId ?? null,
  });

  return {
    status: "rebuilt" as const,
    deletedCount: deleted,
    sourceChunkCount: rebuilt.count,
  };
}

export const deleteSourceChunksForSource = deleteRebuildSourceChunksForSource;

export async function searchSourceChunksForGaps(
  query: string,
  options: { limit?: number } = {},
): Promise<SourceChunkGapResult[]> {
  if (!hasDatabaseUrl()) return [];

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const rows = await db
    .select()
    .from(sourceChunks)
    .where(
      and(
        eq(sourceChunks.workspaceId, workspace.id),
        inArray(sourceChunks.lifecycleStatus, [
          "parsed",
          "parsed_with_warnings",
          "reviewed",
          "extracted",
        ]),
      ),
    );
  const queryVector = embedTextLocal(query);
  return rows
    .map((row) => ({
      row,
      similarity: cosineSimilarity(queryVector, row.vectorJson),
    }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, options.limit ?? 8)
    .map(({ row, similarity }) => toSourceChunkGapResult(row, similarity));
}

async function rebuildSourceChunksForDocument(args: {
  db?: SourceChunkDb;
  document: ChunkableSourceDocument;
  resumeSourceVersionId?: string | null;
}) {
  const shouldIndex = shouldIndexSourceDocument(args.document.lifecycleStatus);
  const db = args.db ?? getDb();
  await deleteSourceChunksForSourceDocument(db, args.document.workspaceId, args.document.id);
  if (!shouldIndex) return { count: 0 };

  const builtChunks = buildSourceDocumentChunks(args.document);
  if (builtChunks.length === 0) return { count: 0 };

  const now = new Date();
  await db.insert(sourceChunks).values(
    builtChunks.map((chunk) => ({
      id: chunk.id,
      workspaceId: args.document.workspaceId,
      sourceDocumentId: args.document.id,
      resumeSourceVersionId: args.resumeSourceVersionId ?? null,
      sourceType: args.document.sourceType,
      chunkIndex: chunk.chunkIndex,
      chunkText: chunk.chunkText,
      contentHash: chunk.contentHash,
      parseQuality: args.document.parseStatus,
      lifecycleStatus: args.document.lifecycleStatus,
      metadataJson: chunk.metadata,
      embeddingModel: localEmbeddingModel,
      vectorJson: embedTextLocal(chunk.chunkText),
      createdAt: now,
      updatedAt: now,
    })),
  );

  return { count: builtChunks.length };
}

async function deleteSourceChunksForSourceDocument(
  db: SourceChunkDb,
  workspaceId: string,
  sourceDocumentId: string,
) {
  const existing = await db
    .select({ id: sourceChunks.id })
    .from(sourceChunks)
    .where(
      and(
        eq(sourceChunks.workspaceId, workspaceId),
        eq(sourceChunks.sourceDocumentId, sourceDocumentId),
      ),
    );
  if (existing.length === 0) return 0;
  await db
    .delete(sourceChunks)
    .where(
      and(
        eq(sourceChunks.workspaceId, workspaceId),
        eq(sourceChunks.sourceDocumentId, sourceDocumentId),
      ),
    );
  return existing.length;
}

function shouldIndexSourceDocument(lifecycleStatus: string) {
  return ["parsed", "parsed_with_warnings", "reviewed", "extracted"].includes(lifecycleStatus);
}

function toSourceChunkGapResult(
  row: SourceChunkRecord,
  similarity: number,
): SourceChunkGapResult {
  const metadata = row.metadataJson;
  return {
    source_document_id: row.sourceDocumentId,
    source_type: row.sourceType,
    title: String(metadata.title ?? "Source material"),
    chunk_index: row.chunkIndex,
    chunk_text: row.chunkText,
    retrieval_policy: "evidence_enrichment",
    retrieval_score: Number((Math.max(0, similarity) * 100).toFixed(3)),
    reason_for_selection: [
      "possible source material for evidence gap",
      "convert to evidence before resume use",
      `semantic match ${Math.round(Math.max(0, similarity) * 100)}%`,
    ],
    parse_quality_status:
      typeof metadata.parse_quality_status === "string"
        ? metadata.parse_quality_status
        : row.parseQuality,
    lifecycle_status: row.lifecycleStatus,
    sensitivity_hint: String(metadata.sensitivity_hint ?? "unknown"),
    convert_to_evidence_first: true,
  };
}

function buildChunkContentHash(seed: string, chunkText: string) {
  return crypto.createHash("sha256").update(`${seed}:${chunkText}`).digest("hex");
}

function normalizeChunkText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function splitSentences(text: string) {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [text];
}

function inferSensitivityHint(text: string): SourceChunk["metadata"]["sensitivity_hint"] {
  return /\b(confidential|internal[-\s]?only|client\s+[A-Z]|customer\s+[A-Z]|project\s+[A-Z])/i.test(text)
    ? "possible_private"
    : "unknown";
}

function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += left[index]! * right[index]!;
  }
  return Number(score.toFixed(6));
}

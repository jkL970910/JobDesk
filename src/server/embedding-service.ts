import crypto from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import {
  embeddings,
  evidenceItems,
  initiatives,
  portfolioProjects,
  projectCards,
  sourceChunks,
} from "../db/schema";
import { indexSourceChunks, sourceChunkIndexType } from "./source-chunk-service";
import { getOrCreateDefaultWorkspace } from "./workspace-repository";

export const localEmbeddingModel = "jobdesk-local-hash-v1";
const dimensions = 128;

export type EmbeddingIndexType =
  | "evidence_index"
  | "initiative_index"
  | "portfolio_project_index"
  | "project_index"
  | typeof sourceChunkIndexType
  | "star_story_index";

export type EmbeddingSearchResult = {
  source_entity_id: string;
  source_entity_type: string;
  index_type: string;
  chunk_text: string;
  similarity: number;
  metadata: Record<string, unknown>;
};

export function embedTextLocal(text: string) {
  const vector = new Array(dimensions).fill(0);
  for (const token of tokenize(text)) {
    const hash = crypto.createHash("sha256").update(token).digest();
    const index = hash.readUInt32BE(0) % dimensions;
    const sign = (hash[4] ?? 0) % 2 === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.min(token.length, 12) / 12);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += left[index]! * right[index]!;
  }
  return Number(score.toFixed(6));
}

export async function syncPersonalEmbeddings() {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getOrCreateDefaultWorkspace(db);
  const evidence = await db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.workspaceId, workspace.id))
    .orderBy(desc(evidenceItems.updatedAt))
    .limit(200);
  const initiativeRows = await db
    .select()
    .from(initiatives)
    .where(eq(initiatives.workspaceId, workspace.id))
    .orderBy(desc(initiatives.updatedAt))
    .limit(120);
  const portfolioProjectRows = await db
    .select()
    .from(portfolioProjects)
    .where(eq(portfolioProjects.workspaceId, workspace.id))
    .orderBy(desc(portfolioProjects.updatedAt))
    .limit(120);
  const legacyProjects = await db
    .select()
    .from(projectCards)
    .where(eq(projectCards.workspaceId, workspace.id))
    .orderBy(desc(projectCards.updatedAt))
    .limit(120);
  const sourceChunkSync = await indexSourceChunks({ workspaceId: workspace.id });
  const sourceChunkRows = await db
    .select()
    .from(sourceChunks)
    .where(eq(sourceChunks.workspaceId, workspace.id))
    .orderBy(desc(sourceChunks.updatedAt))
    .limit(240);

  const chunks = [
    ...evidence
      .filter((item) => item.status !== "rejected")
      .map((item) => ({
        workspaceId: workspace.id,
        indexType: "evidence_index" as const,
        sourceEntityType: "evidence",
        sourceEntityId: item.id,
        chunkText: [
          item.publicSafeSummary,
          item.text,
          item.sourceQuote,
          item.metrics.map((metric) => Object.values(metric).join(" ")).join(" "),
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          sensitivity_level: item.sensitivityLevel,
          allowed_usage: item.allowedUsage,
          status: item.status,
          related_project_id: item.relatedProjectId,
          related_work_experience_id: item.relatedWorkExperienceId,
          related_initiative_id: item.relatedInitiativeId,
          related_portfolio_project_id: item.relatedPortfolioProjectId,
        },
      })),
    ...initiativeRows
      .filter((initiative) => initiative.status !== "rejected")
      .map((initiative) => ({
        workspaceId: workspace.id,
        indexType: "initiative_index" as const,
        sourceEntityType: "initiative",
        sourceEntityId: initiative.id,
        chunkText: [
          initiative.externalSafeTitle,
          initiative.internalTitle,
          initiative.externalSafeSummary,
          initiative.context,
          initiative.problem,
          initiative.role,
          initiative.actions.join(" "),
          initiative.results.join(" "),
          initiative.metrics.map((metric) => Object.values(metric).join(" ")).join(" "),
          initiative.technologies.join(" "),
          initiative.stakeholders.join(" "),
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          sensitivity_level: initiative.sensitivityLevel,
          status: initiative.status,
          title: initiative.externalSafeTitle ?? initiative.internalTitle,
          internal_title: initiative.internalTitle,
          needs_redaction_review: initiative.needsRedactionReview === 1,
          work_experience_id: initiative.workExperienceId,
        },
      })),
    ...portfolioProjectRows
      .filter((project) => project.status !== "rejected")
      .map((project) => ({
        workspaceId: workspace.id,
        indexType: "portfolio_project_index" as const,
        sourceEntityType: "portfolio_project",
        sourceEntityId: project.id,
        chunkText: [
          project.externalSafeTitle,
          project.title,
          project.externalSafeSummary,
          project.context,
          project.problem,
          project.role,
          project.actions.join(" "),
          project.results.join(" "),
          project.metrics.map((metric) => Object.values(metric).join(" ")).join(" "),
          project.technologies.join(" "),
          project.stakeholders.join(" "),
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          sensitivity_level: project.sensitivityLevel,
          status: project.status,
          title: project.externalSafeTitle ?? project.title,
          internal_title: project.title,
          project_type: project.projectType,
          needs_redaction_review: project.needsRedactionReview === 1,
        },
      })),
    ...legacyProjects
      .filter((project) => project.status !== "rejected")
      .map((project) => ({
        workspaceId: workspace.id,
        indexType: "project_index" as const,
        sourceEntityType: "project",
        sourceEntityId: project.id,
        chunkText: [
          project.title,
          project.publicSafeSummary,
          project.context,
          project.problem,
          project.role,
          project.actions.join(" "),
          project.results.join(" "),
          project.metrics.map((metric) => Object.values(metric).join(" ")).join(" "),
          project.technologies.join(" "),
          project.stakeholders.join(" "),
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          sensitivity_level: project.sensitivityLevel,
          status: project.status,
          title: project.title,
        },
      })),
    ...sourceChunkRows.map((chunk) => ({
      workspaceId: workspace.id,
      indexType: sourceChunkIndexType,
      sourceEntityType: "source_document",
      sourceEntityId: chunk.id,
      chunkText: chunk.chunkText,
      metadata: chunk.metadataJson,
    })),
  ];

  await db
    .delete(embeddings)
    .where(eq(embeddings.workspaceId, workspace.id));

  for (const chunk of chunks) {
    const vector = embedTextLocal(chunk.chunkText);
    const [existing] = await db
      .select({ id: embeddings.id })
      .from(embeddings)
      .where(
        and(
          eq(embeddings.workspaceId, chunk.workspaceId),
          eq(embeddings.sourceEntityType, chunk.sourceEntityType),
          eq(embeddings.sourceEntityId, chunk.sourceEntityId),
          eq(embeddings.indexType, chunk.indexType),
        ),
      )
      .limit(1);
    const values = {
      workspaceId: chunk.workspaceId,
      indexType: chunk.indexType,
      sourceEntityType: chunk.sourceEntityType,
      sourceEntityId: chunk.sourceEntityId,
      chunkText: chunk.chunkText,
      embeddingModel: localEmbeddingModel,
      vectorDimensions: dimensions,
      vectorJson: vector,
      metadata: chunk.metadata,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(embeddings).set(values).where(eq(embeddings.id, existing.id));
    } else {
      await db.insert(embeddings).values(values);
    }
  }

  return {
    status: "saved" as const,
    indexedCount: chunks.length,
    evidenceCount: evidence.length,
    initiativeCount: initiativeRows.length,
    portfolioProjectCount: portfolioProjectRows.length,
    legacyProjectCount: legacyProjects.length,
    sourceDocumentCount:
      sourceChunkSync.status === "saved" ? sourceChunkSync.sourceDocumentCount : 0,
    sourceChunkCount: chunks.filter((chunk) => chunk.indexType === sourceChunkIndexType).length,
    model: localEmbeddingModel,
  };
}

export async function syncPersonalEmbeddingsBestEffort(args: {
  reason?: string;
  sync?: () => Promise<unknown>;
} = {}) {
  try {
    const result = await (args.sync ?? syncPersonalEmbeddings)();
    return { status: "completed" as const, reason: args.reason, result };
  } catch (error) {
    return {
      status: "failed" as const,
      reason: args.reason,
      error: error instanceof Error ? error.message : "Unknown embedding sync error.",
    };
  }
}

export function schedulePersonalEmbeddingsSync(reason: string) {
  void syncPersonalEmbeddingsBestEffort({ reason }).then((result) => {
    if (result.status === "failed") {
      console.warn("[retrieval] best-effort embedding sync failed", result);
    }
  });
}

export async function searchPersonalEmbeddings(args: {
  query: string;
  indexTypes?: EmbeddingIndexType[];
  limit?: number;
}) {
  if (!hasDatabaseUrl()) return [];
  const db = getDb();
  const workspace = await getOrCreateDefaultWorkspace(db);
  const rows = await db
    .select()
    .from(embeddings)
    .where(
      args.indexTypes && args.indexTypes.length > 0
        ? and(
            eq(embeddings.workspaceId, workspace.id),
            inArray(embeddings.indexType, args.indexTypes),
          )
        : eq(embeddings.workspaceId, workspace.id),
    );
  const queryVector = embedTextLocal(args.query);
  return rows
    .map((row) => ({
      source_entity_id: row.sourceEntityId,
      source_entity_type: row.sourceEntityType,
      index_type: row.indexType,
      chunk_text: row.chunkText,
      similarity: cosineSimilarity(queryVector, row.vectorJson),
      metadata: row.metadata,
    }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, args.limit ?? 8);
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.%]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopwords.has(token));
}

const stopwords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

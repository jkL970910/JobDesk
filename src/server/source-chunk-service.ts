import type { sourceDocuments } from "../db/schema";

export const sourceChunkIndexType = "source_chunk_index" as const;
const maxChunkCharacters = 900;
const minChunkCharacters = 120;
const overlapSentences = 1;

export type SourceChunk = {
  id: string;
  chunkIndex: number;
  chunkText: string;
  metadata: {
    source_document_id: string;
    source_type: string;
    lifecycle_status: string;
    parse_quality_status: string | null;
    parse_warnings: string[];
    sensitivity_hint: "unknown" | "possible_private";
    title: string;
  };
};

export function buildSourceDocumentChunks(
  document: Pick<
    typeof sourceDocuments.$inferSelect,
    | "id"
    | "sourceType"
    | "title"
    | "contentText"
    | "parseStatus"
    | "parseWarnings"
    | "lifecycleStatus"
  >,
): SourceChunk[] {
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
  if (chunks.length === 0 && text.length >= minChunkCharacters) chunks.push(text.slice(0, maxChunkCharacters));

  return chunks.map((chunkText, index) => ({
    id: buildSourceChunkId(document.id, index),
    chunkIndex: index,
    chunkText,
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

import { describe, expect, it } from "vitest";

import {
  buildSourceChunkId,
  buildSourceDocumentChunks,
  type SourceChunkGapResult,
} from "../src/server/source-chunk-service";

describe("source chunk service", () => {
  it("builds source-document chunks with provenance metadata", () => {
    const sourceDocumentId = "11111111-2222-4333-8444-555555555555";
    const chunks = buildSourceDocumentChunks({
      id: sourceDocumentId,
      sourceType: "work_summary",
      title: "Launch notes",
      contentText: [
        "Built analytics dashboards for launch instrumentation.",
        "Defined activation events and retention cohorts.",
        "Partnered with product and engineering on experiment readouts.",
        "Captured follow-up questions for missing impact metrics.",
      ].join(" "),
      parseStatus: "usable",
      parseWarnings: [],
      lifecycleStatus: "parsed",
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatchObject({
      id: buildSourceChunkId(sourceDocumentId, 0),
      chunkIndex: 0,
      metadata: {
        source_document_id: sourceDocumentId,
        source_type: "work_summary",
        chunk_index: 0,
        lifecycle_status: "parsed",
        parse_quality_status: "usable",
        sensitivity_hint: "unknown",
        title: "Launch notes",
      },
    });
  });

  it("marks possible-private chunks without making them resume evidence", () => {
    const chunks = buildSourceDocumentChunks({
      id: "22222222-3333-4444-8555-666666666666",
      sourceType: "project_note",
      title: "Internal project",
      contentText:
        "Project Falcon for Client A improved internal-only QA workflows and contains confidential rollout details. The note describes migration context, ownership, actions, and follow-up impact metrics that should become reviewable evidence only after user confirmation.",
      parseStatus: "usable",
      parseWarnings: [],
      lifecycleStatus: "parsed",
    });

    expect(chunks[0]?.metadata.sensitivity_hint).toBe("possible_private");
  });

  it("preserves convert-to-evidence-first semantics for source chunk results", () => {
    const result: SourceChunkGapResult = {
      source_document_id: "11111111-2222-4333-8444-555555555555",
      source_type: "work_summary",
      title: "Launch notes",
      chunk_index: 1,
      chunk_text: "Raw launch note about activation metrics and follow-up evidence gaps.",
      retrieval_policy: "evidence_enrichment",
      retrieval_score: 51.2,
      reason_for_selection: [
        "possible source material for evidence gap",
        "convert to evidence before resume use",
        "semantic match 51%",
      ],
      parse_quality_status: "usable",
      lifecycle_status: "parsed",
      sensitivity_hint: "unknown",
      convert_to_evidence_first: true,
    };

    expect(result.convert_to_evidence_first).toBe(true);
    expect(result.reason_for_selection.join(" ")).toContain("convert to evidence");
    expect(result.retrieval_policy).toBe("evidence_enrichment");
  });
});

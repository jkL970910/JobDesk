import { describe, expect, it } from "vitest";

import {
  cosineSimilarity,
  embedTextLocal,
} from "../src/server/embedding-service";

describe("embedding service", () => {
  it("creates deterministic local embeddings", () => {
    const left = embedTextLocal("SQL dashboard stakeholder reporting");
    const right = embedTextLocal("SQL dashboard stakeholder reporting");

    expect(left).toHaveLength(128);
    expect(right).toEqual(left);
  });

  it("scores related text above unrelated text", () => {
    const query = embedTextLocal("SQL analytics dashboard");
    const related = embedTextLocal("Built SQL dashboards for funnel analytics.");
    const unrelated = embedTextLocal("Managed contract renewals and travel planning.");

    expect(cosineSimilarity(query, related)).toBeGreaterThan(
      cosineSimilarity(query, unrelated),
    );
  });

  it("returns zero-vector similarity for empty input without throwing", () => {
    expect(cosineSimilarity(embedTextLocal(""), embedTextLocal("anything"))).toBe(0);
  });
});

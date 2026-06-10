/**
 * Contract tests that prove the schemas behave as the design intends.
 * These are learning/verification tests, not production coverage.
 * Run: npm test
 */
import { describe, it, expect } from "vitest";
import { ExtractedField, EvidenceType } from "../src/schemas/shared.js";
import { Profile } from "../src/schemas/profile.js";
import { EvidenceItem } from "../src/schemas/evidence.js";
import { GeneratedClaim } from "../src/schemas/tailored-resume.js";

describe("ExtractedField", () => {
  it("applies defaults (verified=false, confidence=0) when omitted", () => {
    const parsed = ExtractedField.parse({ value: "Acme", source_quote: "Acme Corp" });
    expect(parsed.verified).toBe(false);
    expect(parsed.confidence).toBe(0);
    expect(parsed.source_offset).toBeNull();
  });

  it("rejects a field with no source_quote", () => {
    const result = ExtractedField.safeParse({ value: "Acme" });
    expect(result.success).toBe(false);
  });
});

describe("controlled vocabularies", () => {
  it("rejects an unknown evidence_type", () => {
    expect(EvidenceType.safeParse("confirmed").success).toBe(false); // must be 'user_confirmed'
    expect(EvidenceType.safeParse("inferred").success).toBe(true);
  });
});

describe("Profile", () => {
  it("parses a minimal valid profile", () => {
    const result = Profile.safeParse({
      contact: { name: { value: "Jane Doe", source_quote: "Jane Doe" } },
    });
    expect(result.success).toBe(true);
  });
});

describe("EvidenceItem", () => {
  it("defaults status to pending and usage to empty", () => {
    const item = EvidenceItem.parse({
      id: "e1",
      workspace_id: "w1",
      text: "Led migration",
      source_quote: "Led the migration",
      source_document_id: "d1",
      evidence_type: "extracted",
    });
    expect(item.status).toBe("pending");
    expect(item.allowed_usage).toEqual([]);
    expect(item.sensitivity_level).toBe("private");
  });
});

describe("GeneratedClaim", () => {
  it("starts unvalidated (generator never self-certifies)", () => {
    const claim = GeneratedClaim.parse({
      id: "c1",
      claim_text: "Automated weekly reporting",
      section: "experience",
      evidence_ids: ["e1"],
    });
    expect(claim.support_status).toBe("unvalidated");
    expect(claim.claim_status).toBe("unvalidated");
  });
});

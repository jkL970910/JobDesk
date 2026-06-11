/**
 * Contract tests that prove the schemas behave as the design intends.
 * These are learning/verification tests, not production coverage.
 * Run: npm test
 */
import { describe, it, expect } from "vitest";
import { ExtractedField, EvidenceType } from "../src/schemas/shared";
import { Profile } from "../src/schemas/profile";
import { EvidenceItem } from "../src/schemas/evidence";
import { JDAnalysis } from "../src/schemas/jd-analysis";
import { GeneratedClaim, TailoredResumeDraft } from "../src/schemas/tailored-resume";

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

describe("JDAnalysis", () => {
  it("defaults structured job facts when omitted", () => {
    const analysis = JDAnalysis.parse({
      job_id: "j1",
      original_jd_text: "Requires SQL.",
    });
    expect(analysis.job_facts).toEqual({
      company: null,
      role_title: null,
      level: null,
      location: null,
      responsibilities: [],
      preferred_qualifications: [],
    });
    expect(analysis.role_archetype).toBe("unknown");
    expect(analysis.job_legitimacy).toEqual({
      tier: "proceed_with_caution",
      signals: [],
      context_notes: [],
    });
  });

  it("accepts legitimacy signals and role archetype", () => {
    const analysis = JDAnalysis.parse({
      job_id: "j1",
      original_jd_text: "Posted today. Apply now. Requires SQL.",
      role_archetype: "technical_ai_pm",
      job_legitimacy: {
        tier: "high_confidence",
        signals: [
          {
            signal: "Apply button active",
            finding: "JD states apply now.",
            weight: "positive",
            source: "jd_text",
          },
        ],
        context_notes: ["Only JD text was available."],
      },
    });
    expect(analysis.role_archetype).toBe("technical_ai_pm");
    expect(analysis.job_legitimacy.signals[0]?.weight).toBe("positive");
  });

  it("normalizes empty structured job facts", () => {
    const analysis = JDAnalysis.parse({
      job_id: "j1",
      original_jd_text: "Requires SQL.",
      job_facts: {
        company: "  ",
        role_title: "  Staff Engineer  ",
        level: "",
        location: " Remote ",
        responsibilities: [" Build APIs ", "", "  "],
        preferred_qualifications: [" OpenRouter ", ""],
      },
    });
    expect(analysis.job_facts).toEqual({
      company: null,
      role_title: "Staff Engineer",
      level: null,
      location: "Remote",
      responsibilities: ["Build APIs"],
      preferred_qualifications: ["OpenRouter"],
    });
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

describe("TailoredResumeDraft", () => {
  it("keeps generated claims unvalidated and normalizes duplicate evidence IDs", () => {
    const draft = TailoredResumeDraft.parse({
      title: "Product Analyst resume",
      resume_markdown: "- Built SQL dashboards",
      resume_json: { sections: [] },
      claims: [
        {
          claim_text: "Built SQL dashboards",
          section: "experience",
          evidence_ids: ["e1", "e1"],
          source_quotes: ["Built SQL dashboards", "Built SQL dashboards"],
        },
      ],
    });
    expect(draft.claims[0]?.evidence_ids).toEqual(["e1"]);
    expect(draft.claims[0]?.source_quotes).toEqual(["Built SQL dashboards"]);
    expect(draft.claims[0]?.risk_level).toBe("low");
    expect(draft.missing_evidence_questions).toEqual([]);
  });
});

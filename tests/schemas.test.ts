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
import { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";
import { ProfilePositioningReport } from "../src/schemas/profile-positioning";
import { ResumeReview } from "../src/schemas/resume-review";
import { GeneratedClaim, TailoredResumeDraft } from "../src/schemas/tailored-resume";
import { ExternalSafeSummarySuggestion } from "../src/schemas/external-safe-summary";
import { EvidenceUpdateProposalPatch } from "../src/schemas/enrichment-proposal-patches";
import { buildProfileFactPatchFromText, ProfileFactPatchRequest } from "../src/schemas/profile-facts";

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

describe("ExternalSafeSummarySuggestion", () => {
  it("parses an AI safe-wording suggestion for human review", () => {
    const parsed = ExternalSafeSummarySuggestion.parse({
      safe_summary: "Reduced operational reporting effort for a financial services team.",
      removed_or_generalized_terms: [
        {
          original_span: "Client A",
          replacement: "a financial services team",
          reason: "Named client should not appear in external-facing wording.",
        },
      ],
      confidence: "medium",
      needs_user_review: true,
    });

    expect(parsed.needs_user_review).toBe(true);
    expect(parsed.removed_or_generalized_terms[0]?.original_span).toBe("Client A");
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

describe("ProfileEvidenceExtraction", () => {
  it("drops null loose profile array entries from provider output", () => {
    const parsed = ProfileEvidenceExtraction.parse({
      profile: {
        name: { value: "Jane Doe", source_quote: "Jane Doe", confidence: 1 },
        certifications: [null],
        skills: ["SQL", null, ""],
      },
      evidence_items: [],
      project_cards: [],
    });

    expect(parsed.profile.certifications).toEqual([]);
    expect(parsed.profile.skills.map((skill) => skill.value)).toEqual(["SQL"]);
  });

  it("does not fail when provider returns loose string profile history arrays", () => {
    const parsed = ProfileEvidenceExtraction.parse({
      profile: {
        name: "Jane Doe",
        experience: [
          "Amazon SDE built resilient service workflows.",
          "RBC mobile engineering internship.",
          2024,
        ],
        education: ["University of Waterloo", "Computer Science", "GPA 3.8"],
        certifications: [],
        skills: ["TypeScript"],
      },
      work_experiences: [],
      initiatives: [],
      portfolio_projects: [],
      evidence_items: [],
      project_cards: [],
    });

    expect(parsed.profile.experience).toEqual([]);
    expect(parsed.profile.education).toEqual([]);
    expect(parsed.profile.skills.map((skill) => skill.value)).toEqual(["TypeScript"]);
  });

  it("normalizes string confidence values on extracted profile fields", () => {
    const parsed = ProfileEvidenceExtraction.parse({
      profile: {
        name: { value: "Jane Doe", source_quote: "Jane Doe", confidence: "0.92" },
        email: {
          value: "jane@example.com",
          source_quote: "jane@example.com",
          confidence: "88%",
        },
        phone: { value: "555-1234", source_quote: "555-1234", confidence: "75" },
      },
      work_experiences: [],
      initiatives: [],
      portfolio_projects: [],
      evidence_items: [],
      project_cards: [],
    });

    expect(parsed.profile.name.confidence).toBe(0.92);
    expect(parsed.profile.email?.confidence).toBe(0.88);
    expect(parsed.profile.phone?.confidence).toBe(0.75);
  });

  it("keeps education items returned with common provider field aliases", () => {
    const parsed = ProfileEvidenceExtraction.parse({
      profile: {
        name: "Jane Doe",
        education: [
          {
            school: "University of Ottawa",
            program: "Master of Engineering",
            field: "Computer Engineering",
            graduation_date: "May 2023",
          },
        ],
        skills: [],
      },
      work_experiences: [],
      initiatives: [],
      portfolio_projects: [],
      evidence_items: [],
      project_cards: [],
    });

    expect(parsed.profile.education).toHaveLength(1);
    expect(parsed.profile.education[0]).toMatchObject({
      institution: { value: "University of Ottawa" },
      degree: { value: "Master of Engineering" },
      field_of_study: { value: "Computer Engineering" },
      end_date: { value: "May 2023" },
    });
  });

  it("normalizes verbal confidence values from provider output", () => {
    const parsed = ProfileEvidenceExtraction.parse({
      profile: {
        name: { value: "Jane Doe", source_quote: "Jane Doe", confidence: "high" },
        email: {
          value: "jane@example.com",
          source_quote: "jane@example.com",
          confidence: "medium confidence",
        },
        phone: { value: "555-1234", source_quote: "555-1234", confidence: "low" },
      },
      work_experiences: [],
      initiatives: [],
      portfolio_projects: [],
      evidence_items: [],
      project_cards: [],
    });

    expect(parsed.profile.name.confidence).toBe(0.9);
    expect(parsed.profile.email?.confidence).toBe(0.6);
    expect(parsed.profile.phone?.confidence).toBe(0.3);
  });

  it("drops invalid top-level extraction entities and records repair notes", () => {
    const parsed = ProfileEvidenceExtraction.parse({
      profile: {
        name: { value: "Jane Doe", source_quote: "Jane Doe", confidence: 1 },
      },
      work_experiences: [
        null,
        123,
        {
          employer: "Acme",
          role_title: "Product Analyst",
          summary: "Worked on onboarding analytics.",
        },
      ],
      initiatives: ["bad initiative"],
      portfolio_projects: [],
      evidence_items: [],
      project_cards: [],
      extraction_notes: ["source parsed"],
    });

    expect(parsed.work_experiences).toHaveLength(1);
    expect(parsed.work_experiences[0]?.employer).toBe("Acme");
    expect(parsed.extraction_notes).toContain("source parsed");
    expect(parsed.extraction_notes).toContain("Dropped invalid work_experiences item at index 0.");
    expect(parsed.extraction_notes).toContain("Dropped invalid work_experiences item at index 1.");
    expect(parsed.extraction_notes).toContain("Dropped invalid initiatives item at index 0.");
  });

  it("normalizes object-valued profile review flags from provider output", () => {
    const parsed = ProfileEvidenceExtraction.parse({
      profile: {
        name: { value: "Jane Doe", source_quote: "Jane Doe", confidence: 1 },
        missing_fields: [{ field: "phone", reason: "not stated" }],
        low_confidence_fields: [{ path: "profile.location", confidence: "low" }],
        invented_field_flags: [
          { field: "title", reason: "tempting but not stated" },
          { value: "school", note: "needs verification" },
        ],
      },
      work_experiences: [],
      initiatives: [],
      portfolio_projects: [],
      evidence_items: [],
      project_cards: [],
    });

    expect(parsed.profile.missing_fields).toEqual(["phone: not stated"]);
    expect(parsed.profile.low_confidence_fields).toEqual(["profile.location: low"]);
    expect(parsed.profile.invented_field_flags).toEqual([
      "title: tempting but not stated",
      "school: needs verification",
    ]);
  });
});

describe("ResumeReview", () => {
  it("parses the HR reviewer output contract", () => {
    const parsed = ResumeReview.parse({
      score: {
        overall: "82",
        confidence: "0.74",
        scope_note: "General resume review without a JD.",
      },
      rubric: [
        {
          key: "scan",
          label: "10-second scan",
          score: 80,
          maxScore: 100,
          note: "Top evidence is visible.",
        },
      ],
      strengths: ["Clear analytics scope."],
      weaknesses: ["Some bullets need quantified outcomes."],
      suggested_edits: ["Move the strongest metric earlier."],
      ten_second_scan: "Recruiters see product analytics quickly.",
      ats_notes: ["Headings are parseable."],
      missing_evidence_questions: ["Which project had the strongest result?"],
      risk_flags: [],
      fairness_check: {
        applied: true,
        note: "No protected or proxy signals penalized.",
        signals_not_penalized: [],
      },
    });

    expect(parsed.score.overall).toBe(82);
    expect(parsed.score.confidence).toBe(0.74);
  });

  it("normalizes common provider naming variants", () => {
    const parsed = ResumeReview.parse({
      score: {
        overall: "86/100",
        confidence: "74%",
        scopeNote: "General resume review.",
      },
      rubric: [
        {
          key: "impact",
          label: "Impact",
          score: "82",
          max_score: "100",
          rationale: "Strong quantified outcomes.",
        },
      ],
      strengths: ["Strong impact."],
      weaknesses: [],
      suggestedEdits: ["Move top metric earlier."],
      tenSecondScan: {
        summary: "Software engineer with strong cloud scale.",
        concern: "Some details need public-safe wording.",
      },
      atsNotes: ["Readable headings."],
      missingEvidenceQuestions: ["Which metrics are public-safe?"],
      riskFlags: [],
      fairnessCheck: {
        applied: true,
        note: "No protected signals penalized.",
        signalsNotPenalized: ["career gap"],
      },
    });

    expect(parsed.score.overall).toBe(86);
    expect(parsed.score.confidence).toBe(0.74);
    expect(parsed.rubric[0]?.maxScore).toBe(100);
    expect(parsed.rubric[0]?.note).toBe("Strong quantified outcomes.");
    expect(parsed.suggested_edits).toEqual(["Move top metric earlier."]);
    expect(parsed.ten_second_scan).toBe("Software engineer with strong cloud scale.");
    expect(parsed.fairness_check.signals_not_penalized).toEqual(["career gap"]);
  });

  it("normalizes object list items into readable review bullets", () => {
    const parsed = ResumeReview.parse({
      score: {
        overall: 84,
        confidence: 0.8,
        scope_note: "General resume review.",
      },
      rubric: [],
      strengths: [
        {
          section: "Amazon SDE experience",
          note: "Strong quantified production impact.",
        },
      ],
      weaknesses: [
        {
          section: "Projects",
          note: "Project bullets need clearer architecture and outcomes.",
        },
      ],
      suggested_edits: [{ suggestion: "Move the strongest Amazon metric earlier." }],
      ten_second_scan: "Strong backend/cloud resume.",
      ats_notes: [{ note: "Headings are parseable." }],
      missing_evidence_questions: [{ question: "Which metrics are safe to disclose?" }],
      risk_flags: [{ risk: "Some internal Amazon language may need context." }],
      fairness_check: {
        applied: true,
        note: "No protected signals penalized.",
        signals_not_penalized: [],
      },
    });

    expect(parsed.strengths).toEqual([
      "Amazon SDE experience: Strong quantified production impact.",
    ]);
    expect(parsed.weaknesses).toEqual([
      "Projects: Project bullets need clearer architecture and outcomes.",
    ]);
    expect(parsed.suggested_edits).toEqual(["Move the strongest Amazon metric earlier."]);
    expect(parsed.ats_notes).toEqual(["Headings are parseable."]);
    expect(parsed.missing_evidence_questions).toEqual(["Which metrics are safe to disclose?"]);
    expect(parsed.risk_flags).toEqual(["Some internal Amazon language may need context."]);
  });
});

describe("ProfilePositioningReport", () => {
  it("parses an evidence-backed positioning report", () => {
    const parsed = ProfilePositioningReport.parse({
      summary: "Product/data directions are best supported by the current evidence.",
      generated_at: new Date().toISOString(),
      directions: [
        {
          id: "data-pm",
          target_role: "Data Product Manager",
          role_family: "data",
          fit_score: 76,
          confidence: "medium",
          support_level: "medium_fit",
          positioning_angle: "Lead with analytics automation and product execution.",
          supporting_evidence: [
            {
              evidence_id: "evidence-1",
              reason: "Shows analytics execution and measurable onboarding impact.",
              signal_tags: ["analytics", "activation"],
            },
          ],
          evidence_strength_explanation: "Strong analytics signal, thinner PM scope signal.",
          missing_evidence_questions: ["Which stakeholders used the dashboard?"],
          resume_emphasis: {
            summary_angle: "Analytics-driven product operator.",
            skills_to_emphasize: ["SQL", "experimentation"],
            project_ordering_guidance: ["Put onboarding analytics first."],
            keywords: ["activation", "dashboard"],
            deprioritize: ["generic coursework"],
          },
          risks: ["Needs stronger product strategy evidence."],
        },
      ],
      global_strengths: ["Analytics delivery"],
      global_gaps: ["Product strategy scope"],
    });

    expect(parsed.directions[0]?.target_role).toBe("Data Product Manager");
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

describe("Enrichment proposal patches", () => {
  it("does not allow evidence patches to change resume-safe usage", () => {
    const result = EvidenceUpdateProposalPatch.safeParse({
      patch_type: "update_evidence",
      evidence_id: "11111111-1111-4111-8111-111111111111",
      text_patch: "Updated evidence wording.",
      allowed_usage_patch: ["resume"],
      rationale: "User asked to improve wording.",
      confidence: "medium",
    });

    expect(result.success).toBe(false);
  });
});

describe("Profile fact patch request", () => {
  it("accepts typed profile fact updates", () => {
    expect(
      ProfileFactPatchRequest.parse({
        field: "contact",
        contact: {
          email: "candidate@example.com",
          links: ["https://github.com/candidate"],
          location: "Toronto, Canada",
        },
        taskId: "11111111-1111-4111-8111-111111111111",
      }).field,
    ).toBe("contact");
    expect(
      ProfileFactPatchRequest.parse({
        field: "certifications",
        certifications: ["AWS Certified Cloud Practitioner · Issuer: AWS"],
      }).field,
    ).toBe("certifications");
    expect(
      ProfileFactPatchRequest.parse({
        field: "location",
        location: "Toronto, Canada",
      }).field,
    ).toBe("location");
  });

  it("rejects mismatched profile fact payloads", () => {
    expect(
      ProfileFactPatchRequest.safeParse({
        field: "skills",
        certifications: ["AWS"],
      }).success,
    ).toBe(false);
  });

  it("builds typed profile fact patches from imported-note editor text", () => {
    expect(
      buildProfileFactPatchFromText(
        "certifications",
        "Certification name: AWS Certified Cloud Practitioner\nIssuer: AWS",
        { mode: "replace", taskId: "11111111-1111-4111-8111-111111111111" },
      ),
    ).toEqual({
      field: "certifications",
      mode: "replace",
      certifications: ["AWS Certified Cloud Practitioner · Issuer: AWS"],
      taskId: "11111111-1111-4111-8111-111111111111",
    });
    expect(
      buildProfileFactPatchFromText("location", "City / region: Toronto\nCountry: Canada"),
    ).toEqual({
      field: "location",
      location: "Toronto, Canada",
    });
    expect(buildProfileFactPatchFromText("skills", "AWS")).toEqual({
      field: "skills",
      skills: ["AWS"],
    });
    expect(buildProfileFactPatchFromText("certifications", "AWS")).toEqual({
      field: "certifications",
      certifications: ["AWS"],
    });
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
          primary_evidence_id: "e2",
          evidence_ids: ["e1", "e1"],
          source_quotes: ["Built SQL dashboards", "Built SQL dashboards"],
        },
      ],
    });
    expect(draft.claims[0]?.primary_evidence_id).toBe("e2");
    expect(draft.claims[0]?.evidence_ids).toEqual(["e2", "e1"]);
    expect(draft.claims[0]?.source_quotes).toEqual(["Built SQL dashboards"]);
    expect(draft.claims[0]?.risk_level).toBe("low");
    expect(draft.missing_evidence_questions).toEqual([]);
  });
});

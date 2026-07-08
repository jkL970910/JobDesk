import { describe, expect, it } from "vitest";

import { classifyExtractedAssetCandidate } from "../src/server/scope-classifier";

const amazonInternship = {
  employer: "Amazon",
  id: "amazon-internship",
  roleTitle: "Software Development Engineer Intern",
  sourceSection: "Amazon internship",
};

const amazonFullTime = {
  employer: "Amazon",
  id: "amazon-full-time",
  roleTitle: "Software Development Engineer",
  sourceSection: "Amazon full-time",
};

describe("scope classifier failure fixtures", () => {
  it("does not allow bullet-shaped action material to become a Work Experience", () => {
    const result = classifyExtractedAssetCandidate({
      content: "Migrated service to region X and reduced failover time by 35%",
      proposedScope: "work_experience",
      sourceSection: "Work Experience",
    });

    expect(result.decision).toMatchObject({
      acceptedScope: "unassigned",
      canonicalLinkPolicy: "reject_as_invalid_scope",
    });
    expect(result.signals).toContain("bullet");
  });

  it("does not bind Technical Skills profile material to a random project", () => {
    const result = classifyExtractedAssetCandidate({
      content: "Technical Skills: Java, Python, React, AWS, Redis",
      proposedScope: "work_initiative",
      sourceSection: "Technical Skills",
    }, {
      linkedWorkExperience: amazonFullTime,
    });

    expect(result.decision).toMatchObject({
      acceptedScope: "profile_context",
      canonicalLinkPolicy: "review_queue_only",
    });
    expect(result.signals).toContain("profile_context");
  });

  it("classifies AWS CDK/cache/latency fragments into the same initiative cluster", () => {
    const fragments = [
      "Session latency optimization with distributed caching",
      "AWS infrastructure provisioning with CDK",
      "Distributed cloud caching for high-scale delivery service",
    ].map((content) =>
      classifyExtractedAssetCandidate({
        content,
        proposedScope: "work_initiative",
        sourceSection: "Amazon full-time distributed cache project",
      }, {
        linkedWorkExperience: amazonFullTime,
      }),
    );

    expect(new Set(fragments.map((item) => item.initiativeClusterKey)).size).toBe(1);
    expect(fragments.map((item) => item.decision.acceptedScope)).toEqual([
      "work_initiative",
      "evidence_claim",
      "work_initiative",
    ]);
  });

  it("routes project-only material without employer to portfolio project or review", () => {
    const result = classifyExtractedAssetCandidate({
      content: "Open-source resume parser with section-level extraction and markdown cleanup",
      proposedScope: "portfolio_project",
      sourceSection: "Projects",
    });

    expect(result.decision).toMatchObject({
      acceptedScope: "portfolio_project",
      canonicalLinkPolicy: "can_persist_to_canonical_pending",
    });
  });

  it("does not cross-bind same-company multiple roles by employer token alone", () => {
    const internshipFragment = classifyExtractedAssetCandidate({
      content: "Amazon internship cache metrics dashboard",
      proposedScope: "work_initiative",
      sourceSection: "Amazon internship",
    }, {
      linkedWorkExperience: amazonInternship,
    });
    const fullTimeFragment = classifyExtractedAssetCandidate({
      content: "Amazon full-time cache metrics dashboard",
      proposedScope: "work_initiative",
      sourceSection: "Amazon full-time",
    }, {
      linkedWorkExperience: amazonFullTime,
    });

    expect(internshipFragment.initiativeClusterKey).not.toBe(fullTimeFragment.initiativeClusterKey);
  });

  it("keeps atomic metric material as Evidence Claim", () => {
    const result = classifyExtractedAssetCandidate({
      content: "Reduced API count from 20+ services to 10",
      proposedScope: "evidence_claim",
      sourceQuote: "Reduced API count from 20+ services to 10",
    });

    expect(result.decision).toMatchObject({
      acceptedScope: "evidence_claim",
      canonicalLinkPolicy: "can_persist_to_canonical_pending",
      confidence: "high",
    });
  });

  it("routes imported observations to imported note review instead of enrichment proposal", () => {
    const result = classifyExtractedAssetCandidate({
      content: "No certifications found in the uploaded resume.",
      proposedScope: "enrichment_question",
      sourceSection: "Extraction notes",
    });

    expect(result.decision).toMatchObject({
      acceptedScope: "imported_note",
      canonicalLinkPolicy: "review_queue_only",
    });
    expect(result.signals).toContain("imported_observation");
  });
});

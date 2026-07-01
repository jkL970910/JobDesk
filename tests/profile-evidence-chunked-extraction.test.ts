import { describe, expect, it } from "vitest";

import { JobDeskAiError } from "../src/ai/errors";
import {
  buildChunkedProfileEvidenceExtractionForTest,
  buildDeterministicProfileWorkHistoryForTest,
  extractProfileEvidenceChunked,
  segmentProfileEvidenceSource,
} from "../src/ai/profile-evidence-chunked-extraction";

describe("chunked profile evidence extraction", () => {
  it("segments noisy resume text into profile, work, education, skills, and portfolio sections", () => {
    const segments = segmentProfileEvidenceSource(`
      JANE DOE
      Toronto, ON  jane@example.com

      Experience
      AMAZON Toronto, Canada
      Software Engineer Jan 2022 - Present
      Built an event-driven platform with AWS Lambda and DynamoDB.

      SHOPIFY Remote
      Front-End Developer Intern May 2021 - Aug 2021
      Delivered reusable React components for merchant onboarding.

      Projects
      Portfolio Tracker
      Built a personal investing dashboard with TypeScript.

      Technical Skills
      TypeScript, React, AWS, SQL

      Education
      University of Ottawa, M.Eng Computer Engineering 2023
    `);

    expect(segments.map((segment) => segment.kind)).toEqual([
      "profile",
      "work_experience",
      "work_experience",
      "projects",
      "skills",
      "education",
    ]);
    expect(segments.every((segment) => segment.text.length <= 3600)).toBe(true);
    expect(segments.filter((segment) => segment.kind === "work_experience")).toHaveLength(2);
    expect(segments.find((segment) => segment.kind === "skills")?.text).toContain("TypeScript");
  });

  it("builds conservative profile and work history without a provider call", () => {
    const segments = segmentProfileEvidenceSource(`
      JANE DOE
      Toronto, ON • jane@example.com • GitHub

      Experience
      AMAZON Toronto, Canada
      Software Engineer Jan 2022 - Present
      Built an event-driven platform.

      Education
      University of Ottawa, M.Eng Computer Engineering 2023

      Technical Skills
      TypeScript, React, AWS
    `);

    const result = buildDeterministicProfileWorkHistoryForTest(segments);

    expect(result.profile.name.value).toBe("JANE DOE");
    expect(result.profile.email?.value).toBe("jane@example.com");
    expect(result.profile.skills.map((skill) => skill.value)).toEqual([
      "TypeScript",
      "React",
      "AWS",
    ]);
    expect(result.work_experiences[0]).toMatchObject({
      employer: "AMAZON",
      role_title: "Software Engineer",
      start_date: "Jan 2022",
      end_date: "Present",
    });
  });

  it("does not split action bullets into fake work experiences across multiple employers", () => {
    const segments = segmentProfileEvidenceSource(`
      JANE DOE

      EXPERIENCE
      AMAZON Toronto, Canada
      Software Dev Engineer Dec 2023 - Present
      Coordinated across multiple services to ship a station workflow.
      Drove mitigation plans that reduced recurring incidents.

      Shopify, Front-End Developer Intern, Remote, Canada Sep 2022 - Dec 2022
      Delivered reusable React components for merchant onboarding.
    `);
    const workSegments = segments.filter((segment) => segment.kind === "work_experience");
    const result = buildDeterministicProfileWorkHistoryForTest(segments);

    expect(workSegments).toHaveLength(2);
    expect(result.work_experiences).toHaveLength(2);
    expect(result.work_experiences.map((item) => item.employer)).toEqual(["AMAZON", "Shopify"]);
    expect(result.work_experiences[1]).toMatchObject({
      location: "Remote, Canada",
      role_title: "Front-End Developer Intern",
    });
  });

  it("does not promote long dated bullets into standalone work experience titles", () => {
    const segments = segmentProfileEvidenceSource(`
      JANE DOE

      Experience
      AMAZON Toronto, Canada
      Software Dev Engineer Dec 2023 - Present
      - In 2024, led a migration project across fulfillment services that improved operations workflows for station teams and required weekly coordination with product, data, and platform partners.
      - Built internal tools for launch readiness.
    `);
    const result = buildDeterministicProfileWorkHistoryForTest(segments);

    expect(segments.filter((segment) => segment.kind === "work_experience")).toHaveLength(1);
    expect(result.work_experiences).toHaveLength(1);
    expect(result.work_experiences[0]).toMatchObject({
      employer: "AMAZON",
      role_title: "Software Dev Engineer",
      start_date: "Dec 2023",
      end_date: "Present",
    });
    expect(result.work_experiences[0]?.role_title).not.toContain("migration project");
  });

  it("normalizes noisy PDF-style text and caps long work sections", () => {
    const longBullet = `Built resilient platform flows with TypeScript and AWS. `.repeat(140);
    const segments = segmentProfileEvidenceSource(`
      JANE DOE


      EXPERIENCE

      AMAZON      Toronto, Canada
      Software Engineer Jan 2022 - Present
      ${longBullet}

      Page 2 of 2

      PROJECTS
      Portfolio Tracker
      Built an investing dashboard with TypeScript.
    `);

    expect(segments.every((segment) => segment.text.length <= 3600)).toBe(true);
    expect(segments.filter((segment) => segment.kind === "work_experience").length).toBeGreaterThan(1);
    expect(segments.find((segment) => segment.kind === "projects")?.text).toContain("Portfolio Tracker");
  });

  it("keeps resumes without headings usable instead of inventing structured roles", () => {
    const segments = segmentProfileEvidenceSource(`
      Jane Doe
      jane@example.com
      Built onboarding analytics dashboards with SQL and React.
      Improved reporting workflows for internal stakeholders.
    `);
    const result = buildDeterministicProfileWorkHistoryForTest(segments);

    expect(segments.map((segment) => segment.kind)).toEqual(["profile"]);
    expect(result.profile.email?.value).toBe("jane@example.com");
    expect(result.work_experiences).toHaveLength(0);
  });

  it("treats skills and certifications-only resumes as reviewable profile material", () => {
    const segments = segmentProfileEvidenceSource(`
      Jane Doe

      Certifications
      AWS Certified Cloud Practitioner
      Certified ScrumMaster

      Skills
      TypeScript, React, SQL
    `);
    const result = buildDeterministicProfileWorkHistoryForTest(segments);

    expect(segments.map((segment) => segment.kind)).toEqual(["profile", "skills", "skills"]);
    expect(result.profile.skills.map((skill) => skill.value)).toEqual([
      "AWS Certified Cloud Practitioner",
      "Certified ScrumMaster",
      "TypeScript",
      "React",
      "SQL",
    ]);
    expect(result.work_experiences).toHaveLength(0);
  });

  it("consolidates chunk outputs into one schema-valid extraction with merged refs", () => {
    const extraction = buildChunkedProfileEvidenceExtractionForTest({
      profileResult: {
        profile: {
          name: { value: "Jane Doe", source_quote: "Jane Doe", confidence: 1 },
          email: null,
          phone: null,
          location: null,
          links: [],
          experience: [],
          education: [],
          skills: [],
          certifications: [],
          missing_fields: [],
          low_confidence_fields: [],
          invented_field_flags: [],
        },
        work_experiences: [
          {
            employer: "Amazon",
            role_title: "Software Engineer",
            team: null,
            location: "Toronto",
            start_date: "Jan 2022",
            end_date: "Present",
            summary: "Built platform systems.",
            status: "pending",
          },
          {
            employer: "Amazon",
            role_title: "Software Engineer",
            team: "Last Mile",
            location: null,
            start_date: "Jan 2022",
            end_date: "Present",
            summary: null,
            status: "pending",
          },
        ],
        extraction_notes: [],
      },
      evidenceResults: [
        {
          initiatives: [
            {
              internal_title: "Event-driven platform",
              work_experience_ref: "Amazon · Software Engineer",
              context: "Platform systems.",
              problem: null,
              role: null,
              actions: ["Built event-driven workflows."],
              results: [],
              metrics: [],
              technologies: ["AWS Lambda"],
              stakeholders: [],
              external_safe_title: null,
              external_safe_summary: null,
              sensitivity_level: "private",
              needs_redaction_review: true,
              status: "pending",
            },
            {
              internal_title: "Event driven platform",
              work_experience_ref: "Amazon · Software Engineer",
              context: null,
              problem: null,
              role: null,
              actions: ["Built event-driven workflows."],
              results: ["Improved platform reliability."],
              metrics: [],
              technologies: ["DynamoDB"],
              stakeholders: [],
              external_safe_title: null,
              external_safe_summary: null,
              sensitivity_level: "private",
              needs_redaction_review: true,
              status: "pending",
            },
          ],
          evidence_items: [
            {
              text: "Built event-driven platform workflows.",
              source_quote: "Built an event-driven platform",
              evidence_type: "extracted",
              metrics: [],
              sensitivity_level: "private",
              allowed_usage: [],
              public_safe_summary: null,
              status: "pending",
              related_project_id: null,
              related_work_experience_id: "Amazon · Software Engineer",
              related_initiative_id: "Event driven platform",
              related_portfolio_project_id: null,
              needs_user_confirmation: false,
            },
          ],
          extraction_notes: [],
        },
      ],
      projectResults: [
        {
          portfolio_projects: [
            {
              project_type: "personal_project",
              title: "Portfolio Tracker",
              external_safe_title: null,
              context: "Personal investing dashboard.",
              problem: null,
              role: null,
              actions: ["Built dashboard."],
              results: [],
              metrics: [],
              technologies: ["TypeScript"],
              stakeholders: [],
              external_safe_summary: null,
              sensitivity_level: "private",
              needs_redaction_review: false,
              status: "pending",
            },
          ],
          evidence_items: [],
          extraction_notes: [],
        },
      ],
    });

    expect(extraction.work_experiences).toHaveLength(1);
    expect(extraction.work_experiences[0]).toMatchObject({
      employer: "Amazon",
      role_title: "Software Engineer",
      team: "Last Mile",
      location: "Toronto",
    });
    expect(extraction.initiatives).toHaveLength(1);
    expect(extraction.initiatives[0]?.technologies).toEqual(
      expect.arrayContaining(["AWS Lambda", "DynamoDB"]),
    );
    expect(extraction.evidence_items[0]?.related_initiative_id).toBe(
      extraction.initiatives[0]?.internal_title,
    );
    expect(extraction.portfolio_projects).toHaveLength(1);
  });

  it("falls back to conservative source-grounded drafts when a chunk times out", async () => {
    const previousKey = process.env.JOBDESK_OPENROUTER_API_KEY;
    process.env.JOBDESK_OPENROUTER_API_KEY = "test-key";
    const result = await extractProfileEvidenceChunked({
      fetchFn: async () => {
        throw new JobDeskAiError("timed out", { kind: "timeout" });
      },
      sourceId: "source-1",
      sourceText: `
        JANE DOE
        jane@example.com

        Experience
        AMAZON Toronto, Canada
        Software Engineer Jan 2022 - Present
        Built an event-driven platform with AWS Lambda and DynamoDB.
        Delivered operations portal for station operators.
      `,
    });
    if (previousKey == null) {
      delete process.env.JOBDESK_OPENROUTER_API_KEY;
    } else {
      process.env.JOBDESK_OPENROUTER_API_KEY = previousKey;
    }

    expect(result.data.work_experiences).toHaveLength(1);
    expect(result.data.initiatives).toHaveLength(1);
    expect(result.data.evidence_items[0]).toMatchObject({
      allowed_usage: [],
      evidence_type: "extracted",
      public_safe_summary: null,
      sensitivity_level: "private",
      status: "pending",
    });
    expect(result.data.evidence_items[0]?.source_quote).toContain("Built an event-driven platform");
    expect(result.data.initiatives[0]).toMatchObject({
      external_safe_summary: null,
      external_safe_title: null,
      needs_redaction_review: true,
      sensitivity_level: "private",
      status: "pending",
    });
    expect(result.data.extraction_notes.join(" ")).toContain("timed out");
  });

  it("falls back to conservative drafts when a chunk returns invalid contract output", async () => {
    const previousKey = process.env.JOBDESK_OPENROUTER_API_KEY;
    process.env.JOBDESK_OPENROUTER_API_KEY = "test-key";
    const result = await extractProfileEvidenceChunked({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ evidence_items: [{ summary: "bad" }] }) } }],
          }),
          { status: 200 },
        ),
      sourceId: "source-1",
      sourceText: `
        JANE DOE

        Experience
        AMAZON Toronto, Canada
        Software Engineer Jan 2022 - Present
        Built an event-driven platform with AWS Lambda and DynamoDB.
      `,
    });
    if (previousKey == null) {
      delete process.env.JOBDESK_OPENROUTER_API_KEY;
    } else {
      process.env.JOBDESK_OPENROUTER_API_KEY = previousKey;
    }

    expect(result.data.initiatives).toHaveLength(1);
    expect(result.data.evidence_items[0]).toMatchObject({
      allowed_usage: [],
      public_safe_summary: null,
      sensitivity_level: "private",
      status: "pending",
    });
    expect(result.data.evidence_items[0]?.source_quote).toContain("Built an event-driven platform");
  });
});

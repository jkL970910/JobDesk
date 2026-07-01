import { z } from "zod";

import {
  EvidenceDraft,
  InitiativeDraft,
  PortfolioProjectDraft,
  ProfileEvidenceExtraction,
  SimpleProfile,
  WorkExperienceDraft,
} from "../schemas/profile-evidence-extraction";
import { JobDeskAiError } from "./errors";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { resolveJobDeskAiConfig } from "./config";
import { composeSkillPrompt } from "./skill-prompt-composer";
import { skillRegistry } from "./skills-registry";
import type { FetchLike, JobDeskAiUsage, StructuredJsonResult } from "./types";

type SegmentKind =
  | "profile"
  | "education"
  | "skills"
  | "work_experience"
  | "projects"
  | "uncategorized";

export type ProfileEvidenceSourceSegment = {
  id: string;
  kind: SegmentKind;
  title: string;
  text: string;
};

type ChunkedExtractionResult = {
  data: ProfileEvidenceExtraction;
  usage: JobDeskAiUsage;
  retryCount: number;
  skill: typeof skillRegistry.profileEvidenceExtractionResume;
  segmentCount: number;
};

const stepRunnerStateVersion = "profile-evidence-step-runner-v1";
const maxSegmentCharacters = 3600;
const minSegmentCharacters = 40;

const ProfileWorkHistoryExtraction = z.object({
  profile: SimpleProfile,
  work_experiences: z.array(WorkExperienceDraft).default([]),
  extraction_notes: z.array(z.string()).default([]),
});

const StoryEvidenceExtraction = z.object({
  initiatives: z.array(InitiativeDraft).default([]),
  evidence_items: z.array(EvidenceDraft).default([]),
  extraction_notes: z.array(z.string()).default([]),
});

const ProjectEvidenceExtraction = z.object({
  portfolio_projects: z.array(PortfolioProjectDraft).default([]),
  evidence_items: z.array(EvidenceDraft).default([]),
  extraction_notes: z.array(z.string()).default([]),
});

const StepRunnerSegment = z.object({
  id: z.string(),
  kind: z.enum(["work_experience", "projects"]),
  result: z.unknown().optional(),
  status: z.enum(["pending", "completed"]),
  text: z.string(),
  title: z.string(),
});

const ProfileEvidenceStepRunnerState = z.object({
  profileResult: ProfileWorkHistoryExtraction,
  retryCount: z.number().int().min(0).default(0),
  segmentCount: z.number().int().min(0),
  segments: z.array(StepRunnerSegment),
  sourceId: z.string(),
  usage: z.record(z.string(), z.number().nullable()).default({}),
  version: z.literal(stepRunnerStateVersion),
});

export type ProfileEvidenceStepRunnerState = z.infer<typeof ProfileEvidenceStepRunnerState>;

export async function extractProfileEvidenceChunked(params: {
  sourceId: string;
  sourceText: string;
  onStatus?: (status: "extracting_evidence" | "validating") => Promise<void>;
  fetchFn?: FetchLike;
}): Promise<ChunkedExtractionResult> {
  const segments = segmentProfileEvidenceSource(params.sourceText);
  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
    maxAttempts: 1,
  });

  const usage: JobDeskAiUsage = {};
  let retryCount = 0;

  const profileResult = buildDeterministicProfileWorkHistory(segments);

  const evidenceResults = [];
  if (segments.some((item) => item.kind === "work_experience")) {
    await params.onStatus?.("extracting_evidence");
  }
  for (const segment of segments.filter((item) => item.kind === "work_experience")) {
    try {
      const result = await callChunkWithTimeoutRetry({
        adapter,
        input: JSON.stringify({
          source_id: params.sourceId,
          section: toProviderSegment(segment),
          known_work_experiences: profileResult.work_experiences.map((experience) => ({
            ref: buildWorkExperienceRef(experience),
            employer: experience.employer,
            role_title: experience.role_title,
            start_date: experience.start_date,
            end_date: experience.end_date,
          })),
        }),
        instructions: buildStoryEvidenceInstructions(),
        maxOutputTokens: 700,
        schema: StoryEvidenceExtraction,
        task: "story-evidence-extraction",
      });
      mergeUsage(usage, result.usage);
      retryCount += result.retryCount;
      evidenceResults.push(result.data);
    } catch (error) {
      if (!isFallbackChunkFailure(error)) throw error;
      evidenceResults.push(buildDeterministicStoryEvidence(segment, profileResult.work_experiences));
      retryCount += error instanceof JobDeskAiError ? error.retryCount : 1;
    }
  }

  const projectResults = [];
  for (const segment of segments.filter((item) => item.kind === "projects")) {
    try {
      const result = await callChunkWithTimeoutRetry({
        adapter,
        input: JSON.stringify({
          source_id: params.sourceId,
          section: toProviderSegment(segment),
        }),
        instructions: buildProjectEvidenceInstructions(),
        maxOutputTokens: 650,
        schema: ProjectEvidenceExtraction,
        task: "project-evidence-extraction",
      });
      mergeUsage(usage, result.usage);
      retryCount += result.retryCount;
      projectResults.push(result.data);
    } catch (error) {
      if (!isFallbackChunkFailure(error)) throw error;
      projectResults.push(buildDeterministicProjectEvidence(segment));
      retryCount += error instanceof JobDeskAiError ? error.retryCount : 1;
    }
  }

  return {
    data: buildChunkedProfileEvidenceExtractionForTest({
      evidenceResults,
      profileResult,
      projectResults,
    }),
    retryCount,
    segmentCount: segments.length,
    skill: skillRegistry.profileEvidenceExtractionResume,
    usage,
  };
}

export function initializeProfileEvidenceStepRunnerState(params: {
  sourceId: string;
  sourceText: string;
}): ProfileEvidenceStepRunnerState {
  const segments = segmentProfileEvidenceSource(params.sourceText);
  return ProfileEvidenceStepRunnerState.parse({
    profileResult: buildDeterministicProfileWorkHistory(segments),
    retryCount: 0,
    segmentCount: segments.length,
    segments: segments
      .filter((segment) => segment.kind === "work_experience" || segment.kind === "projects")
      .map((segment) => ({
        id: segment.id,
        kind: segment.kind,
        status: "pending",
        text: segment.text,
        title: segment.title,
      })),
    sourceId: params.sourceId,
    usage: {},
    version: stepRunnerStateVersion,
  });
}

export function parseProfileEvidenceStepRunnerState(value: unknown) {
  const candidate = getProfileEvidenceStepRunnerCandidate(value);
  if (!candidate) return null;
  const parsed = ProfileEvidenceStepRunnerState.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function serializeProfileEvidenceStepRunnerState(state: ProfileEvidenceStepRunnerState) {
  return {
    profileEvidenceStepRunner: ProfileEvidenceStepRunnerState.parse(state),
  };
}

export function getProfileEvidenceStepRunnerProgress(state: ProfileEvidenceStepRunnerState) {
  const completedSegmentCount = state.segments.filter((segment) => segment.status === "completed").length;
  const nextSegment = state.segments.find((segment) => segment.status === "pending") ?? null;
  return {
    completedSegmentCount,
    currentSegmentTitle: nextSegment?.title ?? null,
    hasPendingSegments: Boolean(nextSegment),
    segmentCount: state.segmentCount,
    totalEvidenceSegmentCount: state.segments.length,
  };
}

export async function processNextProfileEvidenceStepRunnerSegment(params: {
  fetchFn?: FetchLike;
  state: ProfileEvidenceStepRunnerState;
}): Promise<{ processedSegment: boolean; state: ProfileEvidenceStepRunnerState }> {
  const pendingIndex = params.state.segments.findIndex((segment) => segment.status === "pending");
  if (pendingIndex < 0) {
    return { processedSegment: false, state: params.state };
  }

  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
    maxAttempts: 1,
  });
  const usage: JobDeskAiUsage = { ...params.state.usage };
  let retryCount = params.state.retryCount;
  const segment = params.state.segments[pendingIndex]!;
  const result = segment.kind === "work_experience"
    ? await extractStoryEvidenceForSegment({
        adapter,
        profileResult: params.state.profileResult,
        segment,
        sourceId: params.state.sourceId,
      }).catch((error) => {
        if (!isFallbackChunkFailure(error)) throw error;
        retryCount += error instanceof JobDeskAiError ? error.retryCount : 1;
        return {
          data: buildDeterministicStoryEvidence(segment, params.state.profileResult.work_experiences),
          retryCount: 0,
          usage: {},
        };
      })
    : await extractProjectEvidenceForSegment({
        adapter,
        segment,
        sourceId: params.state.sourceId,
      }).catch((error) => {
        if (!isFallbackChunkFailure(error)) throw error;
        retryCount += error instanceof JobDeskAiError ? error.retryCount : 1;
        return {
          data: buildDeterministicProjectEvidence(segment),
          retryCount: 0,
          usage: {},
        };
      });

  mergeUsage(usage, result.usage);
  retryCount += result.retryCount;
  const segments = params.state.segments.map((item, index) =>
    index === pendingIndex
      ? {
          ...item,
          result: result.data,
          status: "completed" as const,
        }
      : item,
  );
  return {
    processedSegment: true,
    state: ProfileEvidenceStepRunnerState.parse({
      ...params.state,
      retryCount,
      segments,
      usage,
    }),
  };
}

export function buildProfileEvidenceExtractionFromStepRunnerState(
  state: ProfileEvidenceStepRunnerState,
): ChunkedExtractionResult {
  const pending = state.segments.find((segment) => segment.status !== "completed");
  if (pending) {
    throw new JobDeskAiError(`Profile evidence extraction is waiting for ${pending.title}.`, {
      kind: "provider_error",
    });
  }
  const evidenceResults = state.segments
    .filter((segment) => segment.kind === "work_experience")
    .map((segment) => StoryEvidenceExtraction.parse(segment.result));
  const projectResults = state.segments
    .filter((segment) => segment.kind === "projects")
    .map((segment) => ProjectEvidenceExtraction.parse(segment.result));
  return {
    data: buildChunkedProfileEvidenceExtractionForTest({
      evidenceResults,
      profileResult: state.profileResult,
      projectResults,
    }),
    retryCount: state.retryCount,
    segmentCount: state.segmentCount,
    skill: skillRegistry.profileEvidenceExtractionResume,
    usage: state.usage,
  };
}

export function segmentProfileEvidenceSource(sourceText: string): ProfileEvidenceSourceSegment[] {
  const normalized = normalizeSourceText(sourceText);
  if (!normalized) return [];
  const blocks = splitBlocksWithHeadings(normalized);
  const segments: ProfileEvidenceSourceSegment[] = [];
  let currentSection: { heading: string; kind: SegmentKind; lines: string[] } | null = {
    heading: "Profile",
    kind: "profile",
    lines: [],
  };

  for (const block of blocks) {
    const headingKind = classifyHeading(block);
    if (headingKind) {
      if (currentSection) pushSectionSegments(segments, currentSection);
      currentSection = {
        heading: block,
        kind: headingKind,
        lines: [],
      };
      continue;
    }
    currentSection ??= { heading: "Notes", kind: "uncategorized", lines: [] };
    currentSection.lines.push(block);
  }
  if (currentSection) pushSectionSegments(segments, currentSection);

  return splitWorkExperienceSegments(segments).map((segment, index) => ({
    ...segment,
    id: `${segment.kind}-${index + 1}`,
  }));
}

async function extractStoryEvidenceForSegment(args: {
  adapter: OpenRouterResponsesAdapter;
  profileResult: z.infer<typeof ProfileWorkHistoryExtraction>;
  segment: ProfileEvidenceSourceSegment;
  sourceId: string;
}) {
  return callChunkWithTimeoutRetry({
    adapter: args.adapter,
    input: JSON.stringify({
      source_id: args.sourceId,
      section: toProviderSegment(args.segment),
      known_work_experiences: args.profileResult.work_experiences.map((experience) => ({
        ref: buildWorkExperienceRef(experience),
        employer: experience.employer,
        role_title: experience.role_title,
        start_date: experience.start_date,
        end_date: experience.end_date,
      })),
    }),
    instructions: buildStoryEvidenceInstructions(),
    maxOutputTokens: 700,
    schema: StoryEvidenceExtraction,
    task: "story-evidence-extraction",
  });
}

async function extractProjectEvidenceForSegment(args: {
  adapter: OpenRouterResponsesAdapter;
  segment: ProfileEvidenceSourceSegment;
  sourceId: string;
}) {
  return callChunkWithTimeoutRetry({
    adapter: args.adapter,
    input: JSON.stringify({
      source_id: args.sourceId,
      section: toProviderSegment(args.segment),
    }),
    instructions: buildProjectEvidenceInstructions(),
    maxOutputTokens: 650,
    schema: ProjectEvidenceExtraction,
    task: "project-evidence-extraction",
  });
}

function getProfileEvidenceStepRunnerCandidate(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return record.profileEvidenceStepRunner ?? null;
}

export function buildChunkedProfileEvidenceExtractionForTest(args: {
  profileResult: z.infer<typeof ProfileWorkHistoryExtraction>;
  evidenceResults: Array<z.infer<typeof StoryEvidenceExtraction>>;
  projectResults: Array<z.infer<typeof ProjectEvidenceExtraction>>;
}): ProfileEvidenceExtraction {
  const workExperienceConsolidation = mergeWorkExperiences(args.profileResult.work_experiences);
  const initiativeConsolidation = mergeInitiatives(
    args.evidenceResults.flatMap((result) => result.initiatives),
  );
  const initiativeRedirects = initiativeConsolidation.redirects;
  const evidenceItems = dedupeEvidenceItems(
    [
      ...args.evidenceResults.flatMap((result) => result.evidence_items),
      ...args.projectResults.flatMap((result) => result.evidence_items),
    ].map((item) => ({
      ...item,
      related_work_experience_id: item.related_work_experience_id
        ? workExperienceConsolidation.redirects.get(item.related_work_experience_id) ?? item.related_work_experience_id
        : item.related_work_experience_id,
      related_initiative_id: item.related_initiative_id
        ? initiativeRedirects.get(item.related_initiative_id) ?? item.related_initiative_id
        : item.related_initiative_id,
    })),
  );

  return ProfileEvidenceExtraction.parse({
    profile: args.profileResult.profile,
    work_experiences: workExperienceConsolidation.items,
    initiatives: initiativeConsolidation.items,
    portfolio_projects: mergePortfolioProjects(
      args.projectResults.flatMap((result) => result.portfolio_projects),
    ),
    evidence_items: evidenceItems,
    project_cards: [],
    extraction_notes: [
      ...args.profileResult.extraction_notes,
      ...args.evidenceResults.flatMap((result) => result.extraction_notes),
      ...args.projectResults.flatMap((result) => result.extraction_notes),
      ...workExperienceConsolidation.notes,
      ...initiativeConsolidation.notes,
    ],
  });
}

async function callChunkWithTimeoutRetry<TSchema extends z.ZodTypeAny>(args: {
  adapter: OpenRouterResponsesAdapter;
  task: string;
  schema: TSchema;
  instructions: string;
  input: string;
  maxOutputTokens: number;
}): Promise<StructuredJsonResult<z.infer<TSchema>>> {
  try {
    return await args.adapter.callStructuredJson({
      input: args.input,
      instructions: args.instructions,
      maxOutputTokens: args.maxOutputTokens,
      schema: args.schema,
      skill: skillRegistry.profileEvidenceExtractionResume,
      task: args.task,
      timeoutMs: 45_000,
    });
  } catch (error) {
    if (!isRetryableChunkTimeout(error)) throw error;
    await sleep(1200);
    try {
      const result = await args.adapter.callStructuredJson({
        input: args.input,
        instructions: args.instructions,
        maxOutputTokens: args.maxOutputTokens,
        schema: args.schema,
        skill: skillRegistry.profileEvidenceExtractionResume,
        task: args.task,
        timeoutMs: 45_000,
      });
      return { ...result, retryCount: result.retryCount + 1 };
    } catch (retryError) {
      if (isRetryableChunkTimeout(retryError)) {
        throw new JobDeskAiError(`Chunk extraction timed out during ${args.task}.`, {
          kind: "timeout",
          retryCount: 1,
          cause: retryError,
        });
      }
      throw retryError;
    }
  }
}

function buildStoryEvidenceInstructions() {
  return composeSkillPrompt(skillRegistry.profileEvidenceExtractionResume, [
    "Extract only work initiatives and evidence_items from one work experience section.",
    "Return only JSON with keys: initiatives, evidence_items, extraction_notes.",
    "Do not return profile, work_experiences, portfolio_projects, or project_cards in this call.",
    "Initiatives are coherent employer-internal project/story containers under a Work Experience.",
    "Keep Work Experience as a high-level employer/role container; do not move section bullets into Work Experience fields.",
    "Use work_experience_ref matching a known_work_experiences ref when possible.",
    "Evidence items must be atomic reusable facts and must quote the source verbatim.",
    "Any metric in evidence text or metrics must appear in source_quote.",
    "Use sensitivity_level=private unless clearly public-safe, status=pending, and needs_user_confirmation=true for inferred evidence.",
    "Return at most 1 initiative and 2 evidence_items for this section.",
  ]);
}

function buildProjectEvidenceInstructions() {
  return composeSkillPrompt(skillRegistry.profileEvidenceExtractionResume, [
    "Extract only non-employer portfolio projects and related evidence_items from the project section.",
    "Return only JSON with keys: portfolio_projects, evidence_items, extraction_notes.",
    "Do not put employer-internal work into portfolio_projects.",
    "Use project_type as personal_project, academic_project, open_source, freelance, hackathon, or general_project.",
    "Evidence items must be atomic reusable facts with verbatim source_quote.",
    "Use status=pending and sensitivity_level=private unless clearly public-safe.",
    "Return at most 2 portfolio_projects and 2 evidence_items.",
  ]);
}

function buildDeterministicStoryEvidence(
  segment: ProfileEvidenceSourceSegment,
  workExperiences: Array<z.infer<typeof WorkExperienceDraft>>,
): z.infer<typeof StoryEvidenceExtraction> {
  const workExperience = matchWorkExperienceForSegment(segment, workExperiences);
  const workRef = workExperience ? buildWorkExperienceRef(workExperience) : null;
  const lines = segment.text.split("\n").map((line) => line.trim()).filter(Boolean);
  const bodyLines = lines.slice(2).filter((line) => line.length >= 24);
  const title = inferInitiativeTitle(bodyLines[0] ?? lines[0] ?? "Imported work story");
  const quotes = bodyLines.slice(0, 2);
  return StoryEvidenceExtraction.parse({
    evidence_items: quotes.map((quote) => ({
      allowed_usage: [],
      evidence_type: "extracted",
      metrics: [],
      needs_user_confirmation: false,
      public_safe_summary: null,
      related_initiative_id: title,
      related_portfolio_project_id: null,
      related_project_id: null,
      related_work_experience_id: workRef,
      sensitivity_level: "private",
      source_quote: quote,
      status: "pending",
      text: quote.replace(/^[-•]\s*/, "").slice(0, 280),
    })),
    extraction_notes: [
      `AI evidence extraction timed out for ${segment.title}; JobDesk created conservative source-grounded drafts for review.`,
    ],
    initiatives: [
      {
        actions: quotes.map((quote) => quote.replace(/^[-•]\s*/, "").slice(0, 220)),
        context: workRef ? `Imported from ${workRef}.` : "Imported from a work experience section.",
        external_safe_summary: null,
        external_safe_title: null,
        internal_title: title,
        metrics: [],
        needs_redaction_review: true,
        problem: null,
        results: [],
        role: null,
        sensitivity_level: "private",
        stakeholders: [],
        status: "pending",
        technologies: extractTechnologyHints(segment.text),
        work_experience_ref: workRef,
      },
    ],
  });
}

function buildDeterministicProjectEvidence(
  segment: ProfileEvidenceSourceSegment,
): z.infer<typeof ProjectEvidenceExtraction> {
  const lines = segment.text.split("\n").map((line) => line.trim()).filter(Boolean);
  const title = lines[0] ?? "Imported portfolio project";
  const quotes = lines.slice(1).filter((line) => line.length >= 24).slice(0, 2);
  return ProjectEvidenceExtraction.parse({
    evidence_items: quotes.map((quote) => ({
      allowed_usage: [],
      evidence_type: "extracted",
      metrics: [],
      needs_user_confirmation: false,
      public_safe_summary: null,
      related_initiative_id: null,
      related_portfolio_project_id: title,
      related_project_id: null,
      related_work_experience_id: null,
      sensitivity_level: "private",
      source_quote: quote,
      status: "pending",
      text: quote.replace(/^[-•]\s*/, "").slice(0, 280),
    })),
    extraction_notes: [
      `AI project extraction timed out for ${segment.title}; JobDesk created conservative source-grounded drafts for review.`,
    ],
    portfolio_projects: [
      {
        actions: quotes.map((quote) => quote.replace(/^[-•]\s*/, "").slice(0, 220)),
        context: quotes.join(" ") || null,
        external_safe_summary: null,
        external_safe_title: null,
        metrics: [],
        needs_redaction_review: false,
        problem: null,
        project_type: "general_project",
        results: [],
        role: null,
        sensitivity_level: "private",
        stakeholders: [],
        status: "pending",
        technologies: extractTechnologyHints(segment.text),
        title,
      },
    ],
  });
}

function matchWorkExperienceForSegment(
  segment: ProfileEvidenceSourceSegment,
  workExperiences: Array<z.infer<typeof WorkExperienceDraft>>,
) {
  const textKey = normalizeKey(segment.text);
  return (
    workExperiences.find((experience) =>
      normalizeKey([experience.employer, experience.role_title].join(" ")).split(" ").some((token) => token.length > 3 && textKey.includes(token)),
    ) ?? workExperiences[0] ?? null
  );
}

function inferInitiativeTitle(text: string) {
  return text
    .replace(/^[-•]\s*/, "")
    .replace(/\([^)]*\)/g, "")
    .split(/[.;:]/)[0]!
    .trim()
    .slice(0, 120) || "Imported work story";
}

function extractTechnologyHints(text: string) {
  const known = [
    "AWS",
    "CDK",
    "DynamoDB",
    "ECS",
    "Lambda",
    "React",
    "SQL",
    "SNS",
    "SQS",
    "TypeScript",
    "Python",
    "Java",
    "Docker",
  ];
  const lower = text.toLowerCase();
  return known.filter((item) => lower.includes(item.toLowerCase()));
}

function buildDeterministicProfileWorkHistory(
  segments: ProfileEvidenceSourceSegment[],
): z.infer<typeof ProfileWorkHistoryExtraction> {
  const allText = segments.map((segment) => segment.text).join("\n");
  const firstLine =
    segments
      .find((segment) => segment.kind === "profile")
      ?.text.split("\n")
      .map((line) => line.trim())
      .find(Boolean) ??
    allText.split("\n").map((line) => line.trim()).find(Boolean) ??
    "Unknown candidate";
  const email = allText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone = allText.match(/(?:\+?\d[\d(). -]{7,}\d)/)?.[0]?.trim() ?? null;
  const location = extractLikelyLocation(segments.find((segment) => segment.kind === "profile")?.text ?? "");
  const education = segments
    .filter((segment) => segment.kind === "education")
    .flatMap((segment) => extractEducation(segment.text));
  const skills = segments
    .filter((segment) => segment.kind === "skills")
    .flatMap((segment) => splitSkillText(segment.text))
    .slice(0, 36)
    .map((skill) => ({ value: skill, source_quote: skill, confidence: 0.75 }));
  const workExperiences = segments
    .filter((segment) => segment.kind === "work_experience")
    .map((segment) => extractWorkExperience(segment.text))
    .filter((item): item is z.infer<typeof WorkExperienceDraft> => Boolean(item));

  return ProfileWorkHistoryExtraction.parse({
    extraction_notes: [
      "Profile and Work Experience headers were prepared deterministically before section evidence extraction.",
    ],
    profile: {
      name: { value: firstLine, source_quote: firstLine, confidence: 0.75 },
      email: email ? { value: email, source_quote: email, confidence: 0.95 } : null,
      phone: phone ? { value: phone, source_quote: phone, confidence: 0.85 } : null,
      location: location ? { value: location, source_quote: location, confidence: 0.65 } : null,
      links: extractLinks(allText).map((link) => ({ value: link, source_quote: link, confidence: 0.8 })),
      experience: [],
      education,
      skills,
      certifications: [],
      missing_fields: [],
      low_confidence_fields: [],
      invented_field_flags: [],
    },
    work_experiences: workExperiences,
  });
}

export const buildDeterministicProfileWorkHistoryForTest = buildDeterministicProfileWorkHistory;

function extractLikelyLocation(profileText: string) {
  const line = profileText
    .split("\n")
    .map((item) => item.trim())
    .find((item) => /\b[A-Z][a-z]+,\s*[A-Z]{2}\b/.test(item));
  return line?.match(/\b[A-Z][a-z]+,\s*[A-Z]{2}\b/)?.[0] ?? null;
}

function extractLinks(text: string) {
  const links = text.match(/https?:\/\/\S+|linkedin|github/gi) ?? [];
  return uniqueStrings(links.map((link) => link.replace(/[•,;]+$/, "")));
}

function extractEducation(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => {
      const parts = line.split(",").map((part) => part.trim()).filter(Boolean);
      const institution = parts[0] ?? line;
      const degree = parts.slice(1).join(", ") || line;
      return {
        degree: { value: degree, source_quote: line, confidence: parts.length > 1 ? 0.7 : 0.45 },
        end_date: extractDateRange(line).end
          ? { value: extractDateRange(line).end!, source_quote: line, confidence: 0.65 }
          : null,
        field_of_study: null,
        institution: { value: institution, source_quote: line, confidence: 0.8 },
        start_date: extractDateRange(line).start
          ? { value: extractDateRange(line).start!, source_quote: line, confidence: 0.65 }
          : null,
      };
    });
}

function splitSkillText(text: string) {
  return text
    .replace(/^technical skills?:?/i, "")
    .split(/[,;|]|\n/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 60);
}

function extractWorkExperience(text: string): z.infer<typeof WorkExperienceDraft> | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const datedLineIndex = lines.findIndex((line) => looksLikeDatedRoleLine(line));
  const employerLine = datedLineIndex > 0 ? lines[datedLineIndex - 1]! : lines[0]!;
  const roleLine = datedLineIndex >= 0 ? lines[datedLineIndex]! : lines[1] ?? lines[0]!;
  const singleLine = employerLine === roleLine ? parseSingleLineExperience(roleLine) : null;
  const dates = extractDateRange(roleLine);
  const employerParts = employerLine.split(/\s{2,}| - | — | – /).map((part) => part.trim()).filter(Boolean);
  const employer = singleLine?.employer ?? cleanupEmployer(employerParts[0] ?? employerLine);
  const location =
    singleLine?.location ??
    employerLine.match(/\b(Toronto|Remote|Canada|Shanghai|Ottawa|Vancouver|New York|USA|US)\b.*$/i)?.[0] ??
    null;
  const roleTitle = singleLine?.roleTitle ?? cleanupRoleTitle(roleLine);
  return {
    employer,
    end_date: dates.end,
    location,
    role_title: roleTitle || "Unknown role",
    start_date: dates.start,
    status: "pending",
    summary: buildWorkExperienceSummary(
      lines.slice(datedLineIndex >= 0 ? datedLineIndex + 1 : 2, datedLineIndex >= 0 ? datedLineIndex + 4 : 5),
    ),
    team: null,
  };
}

function parseSingleLineExperience(line: string) {
  if (!looksLikeDatedRoleLine(line) || !line.includes(",")) return null;
  const beforeDate = cleanupRoleTitle(line).trim();
  const parts = beforeDate.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const [employer, roleTitle, ...locationParts] = parts;
  if (!employer || !roleTitle) return null;
  const cleanedRoleTitle = cleanupRoleTitle(roleTitle);
  if (!cleanedRoleTitle) return null;
  return {
    employer: cleanupEmployer(employer),
    location: locationParts.join(", ") || null,
    roleTitle: cleanedRoleTitle,
  };
}

function extractDateRange(line: string) {
  const datePattern = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Spring|Summer|Fall|Winter)?\.?\s*(?:19|20)\d{2})\s*(?:-|–|—|to)\s*(Present|Current|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Spring|Summer|Fall|Winter)?\.?\s*(?:19|20)\d{2})/i;
  const match = line.match(datePattern);
  return {
    end: match?.[2]?.trim() ?? null,
    start: match?.[1]?.trim() ?? null,
  };
}

function cleanupEmployer(value: string) {
  return value.replace(/\b(Toronto|Remote|Canada|Shanghai|Ottawa|Vancouver|New York|USA|US)\b.*$/i, "").trim() || value.trim();
}

function cleanupRoleTitle(value: string) {
  const cleaned = value
    .replace(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Spring|Summer|Fall|Winter)?\.?\s*(?:19|20)\d{2})\s*(?:-|–|—|to)\s*(Present|Current|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Spring|Summer|Fall|Winter)?\.?\s*(?:19|20)\d{2})/i, "")
    .replace(/^[-*•]\s*/, "")
    .replace(/^[,;:|/\\-]+|[,;:|/\\-]+$/g, "")
    .trim();
  if (!isSafeRoleTitle(cleaned)) return "";
  return cleaned;
}

function buildWorkExperienceSummary(lines: string[]) {
  const summary = lines
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length >= 12)
    .slice(0, 2)
    .join(" ");
  if (!summary) return null;
  return summary.length > 280 ? `${summary.slice(0, 277).trimEnd()}...` : summary;
}

function normalizeSourceText(sourceText: string) {
  return sourceText
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .trim();
}

function splitBlocksWithHeadings(text: string) {
  return text
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length <= 1) return [block.trim()].filter(Boolean);
      return lines;
    })
    .map((block) => block.trim())
    .filter(Boolean);
}

function classifyHeading(text: string): SegmentKind | null {
  const normalized = text.toLowerCase().replace(/[^a-z&/ ]+/g, "").trim();
  if (!normalized || normalized.length > 48) return null;
  if (/^(experience|work experience|professional experience|employment|internships?)$/.test(normalized)) {
    return "work_experience";
  }
  if (/^(projects?|portfolio|portfolio projects?|selected projects?)$/.test(normalized)) return "projects";
  if (/^(education|academic background)$/.test(normalized)) return "education";
  if (/^(skills?|technical skills?|technologies|tools|certifications?|certificates?)$/.test(normalized)) return "skills";
  if (/^(summary|professional summary|profile|contact)$/.test(normalized)) return "profile";
  return null;
}

function pushSectionSegments(
  segments: ProfileEvidenceSourceSegment[],
  section: { heading: string; kind: SegmentKind; lines: string[] },
) {
  const text = section.lines.join("\n").trim();
  if (text.length < minSegmentCharacters && !["profile", "education", "skills"].includes(section.kind)) return;
  for (const chunk of splitByCharacterCap(text, maxSegmentCharacters)) {
    segments.push({
      id: "",
      kind: section.kind,
      text: chunk,
      title: section.heading,
    });
  }
}

function splitWorkExperienceSegments(segments: ProfileEvidenceSourceSegment[]) {
  const output: ProfileEvidenceSourceSegment[] = [];
  for (const segment of segments) {
    if (segment.kind !== "work_experience") {
      output.push(segment);
      continue;
    }
    const roleChunks = splitWorkExperienceText(segment.text);
    if (roleChunks.length <= 1) {
      output.push(segment);
      continue;
    }
    output.push(...roleChunks.map((text) => ({ ...segment, text })));
  }
  return output;
}

function splitWorkExperienceText(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const datedRoleIndexes = lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => looksLikeDatedRoleLine(line))
    .map(({ index, line }) =>
      parseSingleLineExperience(line) || index === 0 || looksLikeDatedRoleLine(lines[index - 1] ?? "")
        ? index
        : index - 1,
    );
  const startIndexes = (datedRoleIndexes.length > 1 ? datedRoleIndexes : lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => looksLikeRoleStart(line))
    .map(({ index }) => index));
  if (startIndexes.length <= 1) return splitByCharacterCap(text, maxSegmentCharacters);

  const chunks: string[] = [];
  for (let i = 0; i < startIndexes.length; i += 1) {
    const start = startIndexes[i]!;
    const end = startIndexes[i + 1] ?? lines.length;
    const previous = start > 0 && i === 0 ? lines.slice(0, start).join("\n") : "";
    const chunk = [previous, ...lines.slice(start, end)].filter(Boolean).join("\n");
    chunks.push(...splitByCharacterCap(chunk, maxSegmentCharacters));
  }
  return chunks.filter((chunk) => chunk.length >= minSegmentCharacters);
}

function looksLikeRoleStart(line: string) {
  if (line.length > 140) return false;
  if (/@/.test(line)) return false;
  if (/[.!?]$/.test(line)) return false;
  if (looksLikeDatedRoleLine(line)) {
    return true;
  }
  if (
    /^[A-Z][A-Z0-9&.,' -]{2,}(?:\s+(Toronto|Remote|Canada|USA|US|Shanghai|Ottawa|Vancouver|New York))?$/i.test(line) &&
    /\b(inc|corp|corporation|ltd|llc|amazon|shopify|nvidia|rbc|huawei|microsoft|google|meta|toronto|remote|canada|usa|shanghai|ottawa|vancouver)\b/i.test(line)
  ) {
    return true;
  }
  return false;
}

function looksLikeDatedRoleLine(line: string) {
  const normalized = line.trim();
  if (normalized.length > 150) return false;
  if (/^[-*•]/.test(normalized)) return false;
  if (!extractDateRange(normalized).start) return false;
  return /\b(19|20)\d{2}\b/.test(normalized) && /\b(present|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|spring|summer|fall|winter)\b/i.test(normalized);
}

function isSafeRoleTitle(value: string) {
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.length > 96) return false;
  if (normalized.split(/\s+/).length > 12) return false;
  if (/^[-*•]/.test(normalized)) return false;
  if (/[.!?]\s/.test(normalized)) return false;
  return true;
}

function splitByCharacterCap(text: string, cap: number) {
  if (text.length <= cap) return [text];
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current: string[] = [];
  for (const line of lines) {
    const next = [...current, line].join("\n");
    if (next.length > cap && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks.flatMap((chunk) => {
    if (chunk.length <= cap) return [chunk];
    const pieces: string[] = [];
    for (let index = 0; index < chunk.length; index += cap) {
      pieces.push(chunk.slice(index, index + cap));
    }
    return pieces;
  });
}

function toProviderSegment(segment: ProfileEvidenceSourceSegment) {
  return {
    id: segment.id,
    kind: segment.kind,
    title: segment.title,
    text: segment.text,
  };
}

function mergeUsage(target: JobDeskAiUsage, source: JobDeskAiUsage) {
  target.inputTokens = addNullable(target.inputTokens, source.inputTokens);
  target.outputTokens = addNullable(target.outputTokens, source.outputTokens);
  target.totalTokens = addNullable(target.totalTokens, source.totalTokens);
}

function addNullable(left?: number | null, right?: number | null) {
  if (left == null && right == null) return null;
  return (left ?? 0) + (right ?? 0);
}

function mergeWorkExperiences(items: Array<z.infer<typeof WorkExperienceDraft>>) {
  const byKey = new Map<string, z.infer<typeof WorkExperienceDraft>>();
  const redirects = new Map<string, string>();
  const notes: string[] = [];
  for (const item of items) {
    const key = normalizeKey([item.employer, item.role_title, item.start_date, item.end_date].join(" "));
    const ref = buildWorkExperienceRef(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      redirects.set(ref, ref);
      continue;
    }
    const merged = mergeWorkExperience(existing, item);
    byKey.set(key, merged);
    redirects.set(ref, buildWorkExperienceRef(merged));
    redirects.set(buildWorkExperienceRef(existing), buildWorkExperienceRef(merged));
    notes.push(`Merged duplicate Work Experience: ${ref}.`);
  }
  return { items: Array.from(byKey.values()), redirects, notes };
}

function mergeWorkExperience(
  left: z.infer<typeof WorkExperienceDraft>,
  right: z.infer<typeof WorkExperienceDraft>,
) {
  return {
    ...left,
    ...right,
    end_date: left.end_date ?? right.end_date,
    location: left.location ?? right.location,
    role_title: left.role_title || right.role_title,
    start_date: left.start_date ?? right.start_date,
    status: "pending" as const,
    summary: joinUnique([left.summary, right.summary], " "),
    team: left.team ?? right.team,
  };
}

function mergeInitiatives(items: Array<z.infer<typeof InitiativeDraft>>) {
  const byKey = new Map<string, z.infer<typeof InitiativeDraft>>();
  const redirects = new Map<string, string>();
  const notes: string[] = [];
  for (const item of items) {
    const key = normalizeKey([item.work_experience_ref ?? "", item.internal_title].join(" "));
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      redirects.set(item.internal_title, item.internal_title);
      continue;
    }
    const merged = mergeInitiative(existing, item);
    byKey.set(key, merged);
    redirects.set(item.internal_title, merged.internal_title);
    redirects.set(existing.internal_title, merged.internal_title);
    notes.push(`Merged duplicate Story Target: ${item.internal_title}.`);
  }
  return { items: Array.from(byKey.values()), redirects, notes };
}

function mergeInitiative(
  left: z.infer<typeof InitiativeDraft>,
  right: z.infer<typeof InitiativeDraft>,
) {
  const sensitivityLevel: z.infer<typeof InitiativeDraft>["sensitivity_level"] =
    left.sensitivity_level === "sensitive" || right.sensitivity_level === "sensitive"
      ? "sensitive"
      : "private";
  return {
    ...left,
    ...right,
    actions: uniqueStrings([...left.actions, ...right.actions]),
    context: joinUnique([left.context, right.context], " "),
    external_safe_summary: left.external_safe_summary ?? right.external_safe_summary,
    external_safe_title: left.external_safe_title ?? right.external_safe_title,
    internal_title: left.internal_title.length <= right.internal_title.length ? left.internal_title : right.internal_title,
    metrics: [...left.metrics, ...right.metrics],
    problem: joinUnique([left.problem, right.problem], " "),
    results: uniqueStrings([...left.results, ...right.results]),
    role: joinUnique([left.role, right.role], " "),
    sensitivity_level: sensitivityLevel,
    stakeholders: uniqueStrings([...left.stakeholders, ...right.stakeholders]),
    status: "pending" as const,
    technologies: uniqueStrings([...left.technologies, ...right.technologies]),
    work_experience_ref: left.work_experience_ref ?? right.work_experience_ref,
  };
}

function mergePortfolioProjects(items: Array<z.infer<typeof PortfolioProjectDraft>>) {
  const byKey = new Map<string, z.infer<typeof PortfolioProjectDraft>>();
  for (const item of items) {
    const key = normalizeKey(item.title);
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, ...item, actions: uniqueStrings([...existing.actions, ...item.actions]), results: uniqueStrings([...existing.results, ...item.results]), technologies: uniqueStrings([...existing.technologies, ...item.technologies]) } : item);
  }
  return Array.from(byKey.values());
}

function dedupeEvidenceItems(items: Array<z.infer<typeof EvidenceDraft>>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeKey([item.text, item.source_quote].join(" "));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildWorkExperienceRef(item: z.infer<typeof WorkExperienceDraft>) {
  return [item.employer, item.role_title].filter(Boolean).join(" · ");
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function joinUnique(values: Array<string | null | undefined>, separator: string) {
  return uniqueStrings(values.filter((value): value is string => Boolean(value?.trim()))).join(separator) || null;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeKey(trimmed);
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function isRetryableChunkTimeout(error: unknown) {
  return error instanceof JobDeskAiError && (error.kind === "timeout" || error.status === 524);
}

function isFallbackChunkFailure(error: unknown) {
  return (
    error instanceof JobDeskAiError &&
    (error.kind === "timeout" ||
      error.status === 524 ||
      error.kind === "contract_invalid" ||
      error.kind === "invalid_json" ||
      error.kind === "empty_output")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

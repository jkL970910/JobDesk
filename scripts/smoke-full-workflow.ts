import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

const defaultJd = [
  "Senior Product Data Analyst",
  "Company: JobDesk Workflow Smoke Test Co",
  "Location: Remote",
  "Responsibilities include building SQL dashboards, analyzing activation and retention funnels, measuring experiment performance, and presenting product recommendations to cross-functional stakeholders.",
  "Requirements: SQL, product analytics, dashboard development, stakeholder communication, experimentation, metric design, and clear written recommendations.",
].join("\n");

const baseUrl = readArgValue("--base-url") ?? process.env.JOBDESK_SMOKE_BASE_URL ?? "http://127.0.0.1:3030";
const resumePath = readArgValue("--resume-file") ?? readArgValue("--resume");
const jdFile = readArgValue("--jd-file");
const jdText = jdFile
  ? readFileSync(resolve(jdFile), "utf8")
  : readArgValue("--jd-text") ?? defaultJd;
const approveCount = Number(readArgValue("--approve-count") ?? "4");
const failOnUnvalidated = hasFlag("--fail-on-unvalidated");

if (!resumePath) {
  console.error(
    [
      "Missing --resume-file.",
      "Usage:",
      "  npm run smoke:full -- --resume-file /path/to/resume.pdf --base-url http://127.0.0.1:3030",
      "Optional:",
      "  --jd-file /path/to/jd.txt",
      "  --jd-text 'Senior Product Analyst ...'",
      "  --approve-count 4",
      "  --fail-on-unvalidated",
    ].join("\n"),
  );
  process.exit(2);
}

const resolvedResumePath = resolve(resumePath);

function readArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function readJson(response: Response) {
  const text = await response.text();
  let payload: JsonObject | null = null;
  try {
    payload = text ? (JSON.parse(text) as JsonObject) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error =
      typeof payload?.error === "string"
        ? payload.error
        : text.slice(0, 500) || response.statusText;
    throw new Error(`${response.status} ${response.statusText}: ${error}`);
  }
  return payload ?? {};
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson(response);
}

async function patchJson(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson(response);
}

async function getJson(path: string) {
  return readJson(await fetch(`${baseUrl}${path}`));
}

function logStep(step: string, details: JsonObject) {
  console.log(JSON.stringify({ step, ...details }, null, 2));
}

function dataOf<T>(payload: JsonObject): T {
  return payload.data as T;
}

const beforeLibrary = dataOf<{
  evidenceItems?: Array<{ id: string }>;
}>(await getJson("/api/profile-evidence/recent"));
const beforeEvidenceIds = new Set(
  (beforeLibrary.evidenceItems ?? []).map((item) => item.id),
);

const formData = new FormData();
formData.append(
  "file",
  new File([readFileSync(resolvedResumePath)], basename(resolvedResumePath), {
    type: inferMimeType(resolvedResumePath),
  }),
);
const parsePayload = await readJson(
  await fetch(`${baseUrl}/api/profile-evidence/parse-source`, {
    method: "POST",
    body: formData,
  }),
);
const parsedSource = dataOf<{
  sourceKind: string;
  sourceTitle: string;
  sourceText: string;
  warnings: string[];
}>(parsePayload);
logStep("resume_source_parse", {
  sourceKind: parsedSource.sourceKind,
  characterCount: parsedSource.sourceText.length,
  warningCount: parsedSource.warnings.length,
});

const extractionPayload = await postJson("/api/profile-evidence/extract", {
  sourceTitle: parsedSource.sourceTitle,
  sourceText: parsedSource.sourceText,
});
const extraction = dataOf<{
  profile?: { name?: { value?: string | null } };
  evidence_items?: unknown[];
  project_cards?: unknown[];
}>(extractionPayload);
const extractionMeta = extractionPayload.meta as
  | { persistence?: { status?: string } }
  | undefined;
logStep("profile_evidence_extraction", {
  profileNamePresent: Boolean(extraction.profile?.name?.value),
  extractedEvidenceCount: extraction.evidence_items?.length ?? 0,
  projectCardCount: extraction.project_cards?.length ?? 0,
  persistence: extractionMeta?.persistence?.status ?? "unknown",
});

const afterLibrary = dataOf<{
  evidenceItems?: Array<{
    id: string;
    status: string;
    allowed_usage: string[];
    needs_user_confirmation: boolean;
  }>;
}>(await getJson("/api/profile-evidence/recent"));
const newEvidence = (afterLibrary.evidenceItems ?? []).filter(
  (item) => !beforeEvidenceIds.has(item.id) && item.status !== "rejected",
);
const fallbackEvidence = (afterLibrary.evidenceItems ?? []).filter(
  (item) => item.status !== "rejected",
);
const evidenceToApprove = (newEvidence.length > 0 ? newEvidence : fallbackEvidence).slice(
  0,
  approveCount,
);
for (const item of evidenceToApprove) {
  await patchJson(`/api/evidence/${item.id}`, {
    action: "approve_for_resume",
    allowedUsage: Array.from(new Set([...(item.allowed_usage ?? []), "resume"])),
  });
}
logStep("approve_for_resume", {
  approvedCount: evidenceToApprove.length,
  newEvidenceCandidateCount: newEvidence.length,
});

const jdPayload = await postJson("/api/ai/jd-analysis", { jdText });
const jd = dataOf<{
  job_id?: string;
  job_facts?: { role_title?: string | null };
  requirements?: unknown[];
}>(jdPayload);
const jdMeta = jdPayload.meta as { persistence?: { status?: string; jobId?: string } } | undefined;
const jobId = jdMeta?.persistence?.jobId;
if (!jobId) {
  throw new Error("JD analysis did not persist a jobId. Check DATABASE_URL.");
}
logStep("jd_analysis", {
  jobId,
  roleTitle: jd.job_facts?.role_title ?? null,
  requirementCount: jd.requirements?.length ?? 0,
  persistence: jdMeta?.persistence?.status ?? "unknown",
});

const tailoredPayload = await postJson("/api/resumes/tailor", { jobId });
const tailoredMeta = tailoredPayload.meta as
  | {
      persistence?: {
        status?: string;
        resumeVersionId?: string;
        claimCount?: number;
      };
    }
  | undefined;
const tailored = dataOf<{
  title?: string;
  claims?: unknown[];
  missing_evidence_questions?: unknown[];
}>(tailoredPayload);
const resumeVersionId = tailoredMeta?.persistence?.resumeVersionId;
if (!resumeVersionId) {
  throw new Error("Tailored resume did not persist a resumeVersionId. Check DATABASE_URL.");
}
logStep("tailored_resume", {
  resumeVersionId,
  titlePresent: Boolean(tailored.title),
  claimCount: tailoredMeta?.persistence?.claimCount ?? tailored.claims?.length ?? 0,
  missingEvidenceQuestionCount: tailored.missing_evidence_questions?.length ?? 0,
  persistence: tailoredMeta?.persistence?.status ?? "unknown",
});

const factGuardPayload = await postJson(
  `/api/resumes/${resumeVersionId}/fact-guard`,
  {},
);
const factGuard = dataOf<{
  resumeStatus: string;
  supportedCount: number;
  claimCount: number;
  coveragePassed: boolean;
  coverageReason: string | null;
}>(factGuardPayload);
logStep("fact_guard", {
  resumeStatus: factGuard.resumeStatus,
  supportedCount: factGuard.supportedCount,
  claimCount: factGuard.claimCount,
  coveragePassed: factGuard.coveragePassed,
  coverageReason: factGuard.coverageReason,
});

if (failOnUnvalidated && factGuard.resumeStatus !== "validated") {
  throw new Error(
    `Fact Guard completed but resume remains ${factGuard.resumeStatus}. Review claim ledger in the app.`,
  );
}

console.log(
  JSON.stringify(
    {
      result: "passed",
      baseUrl,
      jobId,
      resumeVersionId,
      approvedEvidenceCount: evidenceToApprove.length,
    },
    null,
    2,
  ),
);

function inferMimeType(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  return "text/plain";
}

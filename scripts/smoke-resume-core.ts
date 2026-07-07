type JsonObject = Record<string, unknown>;

export {};

const baseUrl = readArgValue("--base-url") ?? process.env.JOBDESK_SMOKE_BASE_URL ?? "http://127.0.0.1:3030";
const email =
  readArgValue("--email") ??
  process.env.JOBDESK_SMOKE_EMAIL ??
  `jobdesk.qa.${Date.now()}@example.com`;
const password = readArgValue("--password") ?? process.env.JOBDESK_SMOKE_PASSWORD ?? "JobDeskQa12345!";
const cookieArg = readArgValue("--cookie") ?? process.env.JOBDESK_SMOKE_COOKIE;
const skipMainResume = hasFlag("--skip-main-resume");
const skipTailoredResume = hasFlag("--skip-tailored-resume");

const resumeText = [
  "# Jane Doe",
  "",
  "Senior Product Data Analyst",
  "Toronto, ON",
  "",
  "## Experience",
  "Product Data Analyst, Acme Analytics, 2021-2025",
  "- Built SQL dashboards for onboarding funnel analysis across activation, retention, and experiment cohorts.",
  "- Improved activation reporting cadence by 12% across three onboarding cohorts.",
  "- Presented metric design recommendations to product, engineering, and go-to-market leaders.",
  "",
  "Analytics Associate, Northwind Labs, 2018-2021",
  "- Designed stakeholder reporting workflows and QA checks for weekly product performance reviews.",
  "",
  "## Skills",
  "SQL, product analytics, dashboard development, experimentation, metric design, stakeholder communication.",
].join("\n");

const jdText = [
  "Senior Product Data Analyst",
  "Company: JobDesk Remote Smoke Test Co",
  "Location: Remote",
  "Responsibilities include building SQL dashboards, analyzing activation and retention funnels, measuring experiment performance, and presenting product recommendations to cross-functional stakeholders.",
  "Requirements: SQL, product analytics, dashboard development, stakeholder communication, experimentation, metric design, and clear written recommendations.",
].join("\n");

type RequestOptions = RequestInit & {
  expectOk?: boolean;
};

let cookie = cookieArg ?? "";

function readArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function logStep(step: string, details: JsonObject) {
  console.log(JSON.stringify({ step, ...details }, null, 2));
}

function captureCookie(response: Response) {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return;
  const session = setCookie.match(/jobdesk_session=([^;]+)/)?.[1];
  if (session) cookie = `jobdesk_session=${session}`;
}

async function request(path: string, options: RequestOptions = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  captureCookie(response);
  if (options.expectOk !== false && !response.ok) {
    const text = await response.text();
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${response.statusText}: ${text}`);
  }
  return response;
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? (JSON.parse(text) as JsonObject) : {};
  } catch {
    throw new Error(`Expected JSON response, got: ${text.slice(0, 500)}`);
  }
}

function dataOf<T>(payload: JsonObject): T {
  return payload.data as T;
}

async function postJson(path: string, body: unknown, options: RequestOptions = {}) {
  return request(path, {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(options.headers).entries()),
    },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown) {
  return request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function ensureSession() {
  if (cookie) {
    const response = await request("/api/auth/me", { expectOk: false });
    if (response.ok) {
      const payload = await readJson(response);
      logStep("auth_session", { mode: "provided_cookie", user: dataOf<{ user?: { email?: string } }>(payload).user?.email ?? null });
      return;
    }
    throw new Error(`Provided cookie was rejected: ${response.status}`);
  }

  const register = await postJson(
    "/api/auth/register",
    {
      displayName: "JobDesk QA",
      email,
      password,
    },
    { expectOk: false },
  );
  if (register.status === 409) {
    const login = await postJson("/api/auth/login", { email, password });
    const payload = await readJson(login);
    logStep("auth_session", { mode: "login", user: dataOf<{ user?: { email?: string } }>(payload).user?.email ?? email });
    return;
  }
  if (!register.ok) {
    throw new Error(`Registration failed: ${register.status} ${await register.text()}`);
  }
  const payload = await readJson(register);
  logStep("auth_session", { mode: "register", user: dataOf<{ user?: { email?: string } }>(payload).user?.email ?? email });
}

async function uploadResumeReview() {
  const formData = new FormData();
  formData.append(
    "file",
    new File([resumeText], "jobdesk-resume-core-smoke.md", {
      type: "text/markdown",
    }),
  );
  const response = await request("/api/resume-review", {
    method: "POST",
    body: formData,
  });
  const payload = await readJson(response);
  const data = dataOf<{
    resume?: { id: string; sourceDocumentId?: string | null; title?: string };
    run?: { id: string; status: string; stage: string };
    status: string;
  }>(payload);
  if (!data.resume?.id || !data.run?.id) {
    throw new Error("Resume Review upload did not return a resume and run.");
  }
  logStep("resume_review_upload", {
    resumeSourceVersionId: data.resume.id,
    runId: data.run.id,
    sourceDocumentId: data.resume.sourceDocumentId ?? null,
    status: data.status,
  });
  return {
    resumeSourceVersionId: data.resume.id,
    runId: data.run.id,
    sourceDocumentId: data.resume.sourceDocumentId ?? undefined,
    title: data.resume.title ?? "Smoke resume",
  };
}

async function processResumeReviewRun(runId: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await postJson(`/api/resume-review/runs/${runId}/process`, {});
    const payload = await readJson(response);
    const data = dataOf<{ run?: { id: string; stage: string; status: string }; status?: string }>(payload);
    if (data.run?.status === "succeeded" || data.status === "saved" || data.status === "ready") {
      logStep("resume_review_process", {
        runId,
        stage: data.run?.stage ?? null,
        status: data.run?.status ?? data.status ?? null,
      });
      return;
    }
    if (data.run?.status === "failed" || data.status === "failed") {
      throw new Error(`Resume Review run failed at ${data.run?.stage ?? "unknown stage"}.`);
    }
    await sleep(1500);
  }
  throw new Error("Resume Review run did not finish within the smoke timeout.");
}

async function createAndProcessExtractionRun(args: {
  resumeSourceVersionId: string;
  sourceDocumentId?: string;
  sourceTitle: string;
}) {
  const create = await postJson("/api/profile-evidence/extract/runs", {
    resumeSourceVersionId: args.resumeSourceVersionId,
    sourceDocumentId: args.sourceDocumentId,
    sourceText: resumeText,
    sourceTitle: args.sourceTitle,
  });
  const createPayload = await readJson(create);
  const run = dataOf<{ run?: { id: string; status: string } }>(createPayload).run;
  if (!run?.id) throw new Error("Extraction run was not created.");

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const processed = await postJson(`/api/profile-evidence/extract/runs/${run.id}/process`, {});
    const payload = await readJson(processed);
    const data = dataOf<{ run?: { id: string; status: string; result?: Record<string, unknown>; failureMessage?: string | null } }>(payload);
    if (data.run?.status === "completed") {
      logStep("profile_evidence_extraction_run", {
        runId: run.id,
        status: data.run.status,
        result: data.run.result ?? null,
      });
      return run.id;
    }
    if (data.run?.status === "failed") {
      throw new Error(`Extraction run failed: ${data.run.failureMessage ?? "unknown failure"}`);
    }
    await sleep(1500);
  }
  throw new Error("Extraction run did not finish within the smoke timeout.");
}

async function approveResumeEvidence(limit = 4) {
  const libraryResponse = await request("/api/profile-evidence/recent");
  const library = dataOf<{
    evidenceItems?: Array<{
      allowed_usage?: string[];
      id: string;
      public_safe_summary?: string | null;
      sensitivity_level?: string;
      status: string;
      text: string;
    }>;
  }>(await readJson(libraryResponse));
  const candidates = (library.evidenceItems ?? [])
    .filter((item) => item.status !== "rejected")
    .slice(0, limit);
  if (candidates.length === 0) {
    throw new Error("No evidence candidates were created.");
  }
  let approvedCount = 0;
  for (const item of candidates) {
    const publicSafeSummary =
      item.public_safe_summary ??
      item.text.replace(/\b(Acme|Northwind)\b/g, "a product analytics organization").slice(0, 240);
    await patchJson(`/api/evidence/${item.id}`, {
      action: "edit",
      allowedUsage: Array.from(new Set([...(item.allowed_usage ?? []), "resume", "interview"])),
      publicSafeSummary,
      sensitivityLevel: "public_safe",
    });
    const approve = await patchJson(`/api/evidence/${item.id}`, {
      action: "approve_for_resume",
      allowedUsage: ["resume", "interview"],
    });
    if (approve.ok) approvedCount += 1;
  }
  logStep("approve_resume_evidence", {
    approvedCount,
    candidateCount: candidates.length,
  });
  if (approvedCount === 0) throw new Error("No evidence item could be approved for resume use.");
}

async function generateMainResume() {
  if (skipMainResume) return null;
  const response = await postJson("/api/main-resume", {}, { expectOk: false });
  if (!response.ok) {
    const failure = await readJson(response);
    if (isExpectedAiSafeBlock(response.status, failure)) {
      logStep("main_resume_safe_block", {
        kind: failure.kind ?? null,
        status: response.status,
      });
      return null;
    }
    throw new Error(`Main Resume failed unexpectedly: ${response.status} ${JSON.stringify(failure)}`);
  }
  const payload = await readJson(response);
  const meta = payload.meta as
    | {
        factGuard?: { resumeStatus?: string; status?: string } | null;
        persistence?: { mainResumeVersionId?: string; status?: string };
      }
    | undefined;
  const mainResumeId = meta?.persistence?.mainResumeVersionId;
  if (!mainResumeId) throw new Error("Main Resume did not persist an id.");
  logStep("main_resume", {
    exportStatus: meta?.factGuard?.resumeStatus ?? null,
    factGuardStatus: meta?.factGuard?.status ?? null,
    mainResumeId,
    persistence: meta?.persistence?.status ?? null,
  });
  await checkExportGate(`/api/main-resume/${mainResumeId}/export`, meta?.factGuard?.resumeStatus === "validated");
  return mainResumeId;
}

async function generateTailoredResume() {
  if (skipTailoredResume) return null;
  const jdPayload = await readJson(await postJson("/api/ai/jd-analysis", { jdText }));
  const jdMeta = jdPayload.meta as { persistence?: { jobId?: string; status?: string } } | undefined;
  const jobId = jdMeta?.persistence?.jobId;
  if (!jobId) throw new Error("JD analysis did not persist a job id.");
  logStep("jd_analysis", { jobId, persistence: jdMeta?.persistence?.status ?? null });

  const tailoredResponse = await postJson("/api/resumes/tailor", { jobId }, { expectOk: false });
  if (!tailoredResponse.ok) {
    const failure = await readJson(tailoredResponse);
    if (isExpectedAiSafeBlock(tailoredResponse.status, failure)) {
      logStep("tailored_resume_safe_block", {
        jobId,
        kind: failure.kind ?? null,
        status: tailoredResponse.status,
      });
      return null;
    }
    throw new Error(`Tailored Resume failed unexpectedly: ${tailoredResponse.status} ${JSON.stringify(failure)}`);
  }
  const tailoredPayload = await readJson(tailoredResponse);
  const tailoredMeta = tailoredPayload.meta as
    | {
        factGuard?: { resumeStatus?: string; status?: string } | null;
        persistence?: { resumeVersionId?: string; status?: string };
      }
    | undefined;
  const resumeVersionId = tailoredMeta?.persistence?.resumeVersionId;
  if (!resumeVersionId) throw new Error("Tailored Resume did not persist an id.");
  logStep("tailored_resume", {
    exportStatus: tailoredMeta?.factGuard?.resumeStatus ?? null,
    factGuardStatus: tailoredMeta?.factGuard?.status ?? null,
    persistence: tailoredMeta?.persistence?.status ?? null,
    resumeVersionId,
  });
  await checkExportGate(`/api/resumes/${resumeVersionId}/export`, tailoredMeta?.factGuard?.resumeStatus === "validated");
  return resumeVersionId;
}

function isExpectedAiSafeBlock(status: number, payload: JsonObject) {
  return (
    status === 422 &&
    (payload.kind === "tailored_resume_guardrail_failed" ||
      payload.kind === "claim_coverage_failed" ||
      payload.kind === "invalid_claim_evidence")
  );
}

async function checkExportGate(path: string, validated: boolean) {
  const audit = await request(`${path}?format=json`, { expectOk: false });
  if (!audit.ok) {
    throw new Error(`JSON audit export should be available, got ${audit.status}`);
  }
  const markdown = await request(`${path}?format=markdown`, { expectOk: false });
  const html = await request(`${path}?format=html`, { expectOk: false });
  const docx = await request(`${path}?format=docx`, { expectOk: false });
  if (validated) {
    for (const [format, response] of [
      ["markdown", markdown],
      ["html", html],
      ["docx", docx],
    ] as const) {
      if (!response.ok) throw new Error(`${format} export should be available after validation, got ${response.status}`);
    }
  } else {
    for (const [format, response] of [
      ["markdown", markdown],
      ["html", html],
      ["docx", docx],
    ] as const) {
      if (response.status !== 409) {
        throw new Error(`${format} export should be blocked before validation, got ${response.status}`);
      }
    }
  }
  logStep("export_gate", {
    docxStatus: docx.status,
    htmlStatus: html.status,
    markdownStatus: markdown.status,
    path,
    validated,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await ensureSession();
const resume = await uploadResumeReview();
await processResumeReviewRun(resume.runId);
await createAndProcessExtractionRun({
  resumeSourceVersionId: resume.resumeSourceVersionId,
  sourceDocumentId: resume.sourceDocumentId,
  sourceTitle: resume.title,
});
await approveResumeEvidence();
const mainResumeId = await generateMainResume();
const tailoredResumeId = await generateTailoredResume();

console.log(
  JSON.stringify(
    {
      baseUrl,
      email,
      mainResumeId,
      result: "passed",
      tailoredResumeId,
    },
    null,
    2,
  ),
);

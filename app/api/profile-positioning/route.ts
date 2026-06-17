import { NextResponse } from "next/server";

import { resolveJobDeskAiConfig } from "../../../src/ai/config";
import { JobDeskAiError } from "../../../src/ai/errors";
import { generateProfilePositioningWithAi } from "../../../src/ai/profile-positioning";
import { skillRegistry } from "../../../src/ai/skills-registry";
import {
  getProfilePositioningContext,
  getRecentProfilePositioningReports,
  persistProfilePositioningFailure,
  persistProfilePositioningReport,
} from "../../../src/server/profile-positioning-repository";

export async function GET() {
  try {
    const reports = await getRecentProfilePositioningReports();
    return NextResponse.json({ data: { reports } });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load profile positioning reports.",
        kind: "database_error",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  const config = resolveJobDeskAiConfig();
  try {
    const context = await getProfilePositioningContext();
    if (!context.profile) {
      return NextResponse.json(
        {
          error: "Extract a profile before generating positioning recommendations.",
          kind: "missing_profile",
        },
        { status: 409 },
      );
    }
    if (context.evidenceItems.length === 0) {
      return NextResponse.json(
        {
          error:
            "Approve resume-safe evidence before generating positioning recommendations.",
          kind: "missing_approved_evidence",
        },
        { status: 409 },
      );
    }

    const result = await generateProfilePositioningWithAi({
      profile: context.profile.profile,
      evidenceItems: context.evidenceItems,
    });
    const persistence = await persistProfilePositioningReport({
      profileId: context.profile.id,
      report: result.data,
      evidenceSnapshotHash: context.evidenceSnapshotHash,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      usage: result.usage,
      retryCount: result.retryCount,
      skill: result.skill,
    });

    return NextResponse.json({
      data: result.data,
      meta: {
        usage: result.usage,
        retryCount: result.retryCount,
        skill: result.skill,
        evidenceCount: context.evidenceItems.length,
        persistence,
      },
    });
  } catch (error) {
    if (error instanceof JobDeskAiError) {
      await persistFailureRun({
        provider: `openrouter-compatible:${config.transport}`,
        model: config.model,
        errorKind: error.kind,
        errorMessage: error.message,
        retryCount: error.retryCount,
      });
      return NextResponse.json(
        {
          error: error.message,
          kind: error.kind,
          status: error.status,
          retryCount: error.retryCount,
        },
        { status: error.kind === "missing_api_key" ? 503 : 502 },
      );
    }

    await persistFailureRun({
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      errorKind: "unknown",
      errorMessage: error instanceof Error ? error.message : "Unknown error.",
      retryCount: 0,
    });
    return NextResponse.json(
      { error: "Profile positioning generation failed.", kind: "provider_error" },
      { status: 502 },
    );
  }
}

async function persistFailureRun(args: {
  provider: string;
  model: string;
  errorKind: Parameters<typeof persistProfilePositioningFailure>[0]["errorKind"];
  errorMessage: string;
  retryCount: number;
}) {
  try {
    await persistProfilePositioningFailure({
      ...args,
      skill: skillRegistry.profilePositioning,
    });
  } catch {
    // Provider/schema failures should remain visible even if audit persistence fails.
  }
}

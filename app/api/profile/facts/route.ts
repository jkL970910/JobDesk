import { NextResponse } from "next/server";

import { updateProfileFacts } from "../../../../src/server/profile-evidence-repository";
import { ProfileFactPatchRequest } from "../../../../src/schemas/profile-facts";

export async function PATCH(request: Request) {
  const body = ProfileFactPatchRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid profile fact update request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const result = await updateProfileFacts(body.data);
    if (result.status === "skipped") {
      return NextResponse.json(
        { error: "Storage is not configured.", kind: result.reason },
        { status: 503 },
      );
    }
    if (result.status === "not_found") {
      return NextResponse.json(
        {
          error: "No profile snapshot exists yet. Extract a resume or add profile source first.",
          kind: "profile_not_found",
        },
        { status: 404 },
      );
    }
    if (result.status === "invalid") {
      return NextResponse.json(
        { error: result.reason, kind: "invalid_profile_fact_update" },
        { status: 409 },
      );
    }
    return NextResponse.json({ data: result.profile });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to update profile facts.",
        kind: "database_error",
      },
      { status: 500 },
    );
  }
}

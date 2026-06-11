import { NextResponse } from "next/server";

import { getRecentEvidenceLibrary } from "../../../../src/server/profile-evidence-repository";

export async function GET() {
  try {
    const library = await getRecentEvidenceLibrary();
    return NextResponse.json({ data: library });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load profile evidence.",
        kind: "database_error",
      },
      { status: 500 },
    );
  }
}

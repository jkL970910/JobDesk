import { NextResponse } from "next/server";

import { getRecentProfilePositioningReports } from "../../../../src/server/profile-positioning-repository";

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

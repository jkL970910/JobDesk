import { NextResponse } from "next/server";

import { getRecentInterviewPrepPacks } from "../../../../src/server/interview-prep-service";

export async function GET() {
  const packs = await getRecentInterviewPrepPacks(5);
  return NextResponse.json({ data: packs });
}

import { NextResponse } from "next/server";

import { getStarStoryBank } from "../../../../src/server/profile-evidence-repository";

export async function GET() {
  const result = await getStarStoryBank(8);
  return NextResponse.json({ data: result });
}

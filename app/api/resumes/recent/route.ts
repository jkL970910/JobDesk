import { NextResponse } from "next/server";

import { getRecentTailoredResumes } from "../../../../src/server/resume-repository";

export async function GET() {
  const data = await getRecentTailoredResumes(5);
  return NextResponse.json({ data });
}

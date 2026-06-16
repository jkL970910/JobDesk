import { NextResponse } from "next/server";

import { getSystemDiagnostics } from "../../../../src/server/system-diagnostics";

export async function GET() {
  const diagnostics = await getSystemDiagnostics();
  return NextResponse.json({ data: diagnostics });
}

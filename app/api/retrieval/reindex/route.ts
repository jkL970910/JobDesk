import { NextResponse } from "next/server";

import { syncPersonalEmbeddings } from "../../../../src/server/embedding-service";

export async function POST() {
  const result = await syncPersonalEmbeddings();
  return NextResponse.json({ data: result });
}

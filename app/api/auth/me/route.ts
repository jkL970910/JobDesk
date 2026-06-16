import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "../../../../src/server/auth-service";

export async function GET(request: Request) {
  const session = await getAuthenticatedUser(request);
  return NextResponse.json({
    data: {
      status: session ? "authenticated" : "anonymous",
      user: session?.user ?? null,
    },
  });
}

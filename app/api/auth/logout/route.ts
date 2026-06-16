import { NextResponse } from "next/server";

import {
  logoutSession,
  serializeClearedSessionCookie,
} from "../../../../src/server/auth-service";

export async function POST(request: Request) {
  await logoutSession(request);
  return NextResponse.json(
    { data: { status: "signed_out" } },
    { headers: { "Set-Cookie": serializeClearedSessionCookie() } },
  );
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { loginUser, serializeSessionCookie } from "../../../../src/server/auth-service";

const requestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter your email and password.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const result = await loginUser(parsed.data);
    if (result.status === "invalid_credentials") {
      return NextResponse.json(
        { error: "Invalid email or password.", kind: "invalid_credentials" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { data: { status: "authenticated", user: result.user } },
      { headers: { "Set-Cookie": serializeSessionCookie(result.session) } },
    );
  } catch (error) {
    console.error("JobDesk account login failed", error);
    return NextResponse.json(
      {
        error: "Unable to sign in. Please try again or contact support.",
        kind: "login_failed",
      },
      { status: 500 },
    );
  }
}

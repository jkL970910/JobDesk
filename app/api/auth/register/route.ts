import { NextResponse } from "next/server";
import { z } from "zod";

import {
  registerUser,
  serializeSessionCookie,
} from "../../../../src/server/auth-service";

const requestSchema = z.object({
  displayName: z.string().max(160).optional(),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter an email and a password with at least 8 characters.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const result = await registerUser(parsed.data);
    if (result.status === "email_taken") {
      return NextResponse.json(
        { error: "An account already exists for this email.", kind: "email_taken" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { data: { status: "authenticated", user: result.user } },
      { headers: { "Set-Cookie": serializeSessionCookie(result.session) } },
    );
  } catch (error) {
    console.error("JobDesk account registration failed", error);
    return NextResponse.json(
      {
        error: "Unable to create account. Please try again or contact support.",
        kind: "registration_failed",
      },
      { status: 500 },
    );
  }
}

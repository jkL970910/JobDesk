import type { NextRequest } from "next/server";

import { validateRequestAccess } from "./src/server/access-guard";

export async function middleware(request: NextRequest) {
  const access = await validateRequestAccess(request);
  if (!access.ok) return access.response;
}

export const config = {
  matcher: "/api/:path*",
};

import type { NextRequest } from "next/server";

import { validateAccessToken } from "./src/server/access-guard";

export function middleware(request: NextRequest) {
  const access = validateAccessToken(request);
  if (!access.ok) return access.response;
}

export const config = {
  matcher: "/api/:path*",
};


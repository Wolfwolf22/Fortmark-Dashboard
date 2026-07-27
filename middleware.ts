import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// TODO: session check — when the auth provider lands, read the session cookie
// here and redirect unauthenticated requests to /login. Until then every
// request passes through so the app is browsable.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand|photos|api/chat).*)"],
};

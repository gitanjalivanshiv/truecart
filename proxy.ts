// Gives every visitor an anonymous id (cookie) so each judge gets their own demo workspace:
// their own mandate, ledger and approval inbox. No personal data; the id is random.

import { NextResponse, type NextRequest } from "next/server";

export const VISITOR_COOKIE = "tc_vid";
const VALID = /^[0-9a-f-]{36}$/;

export function proxy(request: NextRequest) {
  const existing = request.cookies.get(VISITOR_COOKIE)?.value;
  if (existing && VALID.test(existing)) return NextResponse.next();

  const id = crypto.randomUUID();
  // Forward the id on this request too, so the very first render can use it.
  const headers = new Headers(request.headers);
  headers.set("x-tc-visitor", id);
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set({
    name: VISITOR_COOKIE,
    value: id,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
  return response;
}

export const config = {
  // Everything except static assets and server-to-server routes (PayPal webhook, MCP with bearer tokens).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/health|mcp).*)"],
};

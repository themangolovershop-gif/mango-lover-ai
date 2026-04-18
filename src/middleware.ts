import { NextRequest, NextResponse } from "next/server";
import { getAdminPassword, verifySessionToken } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;

  // Protect /dashboard and /api (except public routes)
  const isDashboard = url.pathname.startsWith("/dashboard/");
  const isApi = url.pathname.startsWith("/api/");
  const isPublicApi = 
    url.pathname.startsWith("/api/webhook") || 
    url.pathname.startsWith("/api/login") ||
    url.pathname.startsWith("/api/logout") ||
    url.pathname.startsWith("/api/health");

  if (isDashboard || (isApi && !isPublicApi)) {
    const adminPassword = getAdminPassword();

    // Fail closed: if password is not set and we are not in dev, reject all access
    if (!adminPassword && process.env.NODE_ENV !== "development") {
      console.error("[AUTH-ERROR] Security Block: Access denied because ADMIN_PASSWORD is not configured in production.");
      return NextResponse.json(
        { error: "Internal Server Error: Authentication system misconfigured." },
        { status: 500 }
      );
    }

    // In local development with no password set, we can allow bypass (as per request)
    if (!adminPassword && process.env.NODE_ENV === "development") {
      return NextResponse.next();
    }

    // Check for session token in cookies
    const sessionToken = request.cookies.get("admin_session")?.value;

    if (!sessionToken || !(await verifySessionToken(sessionToken))) {
      // If it's a dashboard page, we could redirect to login, but for now we follow the existing 401 JSON pattern
      // or we can just return 401 for simplicity as requested.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};

import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl;

  // Protect /dashboard and /api (except webhook)
  if (
    url.pathname.startsWith("/dashboard/") ||
    (url.pathname.startsWith("/api") && 
     !url.pathname.startsWith("/api/webhook") && 
     !url.pathname.startsWith("/api/login") &&
     !url.pathname.startsWith("/api/logout"))
  ) {
    const adminPasswordRaw = process.env.ADMIN_PASSWORD;
    const adminPassword = (adminPasswordRaw || "mango123").trim();

    if (!adminPassword) {
      const message = "Unauthorized: ADMIN_PASSWORD is not configured.";
      return NextResponse.json({ error: message }, { status: 401 });
    }

    const queryPw = url.searchParams.get("pw");
    const cookiePw = request.cookies.get("admin_pw")?.value;

    if (queryPw === adminPassword) {
      const response = NextResponse.next();
      response.cookies.set("admin_pw", adminPassword, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      return response;
    }

    if (cookiePw !== adminPassword) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};

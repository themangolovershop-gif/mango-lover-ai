import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminPassword, safeEquals, signSessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { password } = await req.json();
    const adminPassword = getAdminPassword();

    // Check password using constant-time comparison
    if (adminPassword && password && safeEquals(password.trim(), adminPassword)) {
      const sessionToken = await signSessionToken(`session:${Date.now()}`);
      
      const cookieStore = await cookies();
      cookieStore.set("admin_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 1 week
        path: "/",
      });
      
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    console.error("[LOGIN-ERROR]", error);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

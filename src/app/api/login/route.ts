import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  try {
    const { password } = await req.json();
    const rawAdminPw = process.env.ADMIN_PASSWORD;
    const adminPassword = (rawAdminPw || "mango123").trim();

    console.log("[LOGIN-DEBUG] Admin PW source:", rawAdminPw ? "ENV" : "DEFAULT");
    console.log("[LOGIN-DEBUG] Password match check...");

    if (password && password.trim() === adminPassword) {
      const cookieStore = await cookies();
      cookieStore.set("admin_pw", adminPassword!, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 1 week
        path: "/",
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

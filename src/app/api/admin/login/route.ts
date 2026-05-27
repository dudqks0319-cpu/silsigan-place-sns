import { NextResponse } from "next/server";
import { adminCookieName, isAdminTokenValid } from "@/lib/admin-auth";
import { fail, ApiError } from "@/lib/api";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    assertRateLimit({ key: rateLimitKey(request, "admin-login"), limit: 5, windowMs: 60_000 });
    const contentType = request.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? ((await request.json()) as { token?: string })
      : { token: new URLSearchParams(await request.text()).get("token") ?? "" };

    if (!isAdminTokenValid(payload.token)) {
      throw new ApiError(401, "ADMIN_AUTH_FAILED", "관리자 토큰이 올바르지 않습니다.");
    }

    const response = contentType.includes("application/json")
      ? NextResponse.json({ success: true, data: { ok: true } })
      : NextResponse.redirect(new URL("/admin/moderation/posts", request.url));
    response.cookies.set(adminCookieName, payload.token ?? "dev-admin", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });

    return response;
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true, data: { ok: true } });
  response.cookies.set(adminCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}

import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.ts";

export const adminCookieName = "silsigan_admin";

export function isAdminTokenValid(candidate: string | null | undefined) {
  const expected = process.env.SILSIGAN_ADMIN_TOKEN;

  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }

  if (!candidate) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);

  return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
}

export function assertAdminRequest(request: Request) {
  const headerToken = request.headers.get("x-silsigan-admin-token");
  const cookieToken = parseCookie(request.headers.get("cookie") ?? "")[adminCookieName];

  if (!isAdminTokenValid(headerToken ?? cookieToken)) {
    throw new ApiError(401, "ADMIN_AUTH_REQUIRED", "관리자 인증이 필요합니다.");
  }
}

export function parseCookie(cookieHeader: string) {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...rest] = part.split("=");
        return [key, decodeURIComponent(rest.join("="))];
      }),
  );
}

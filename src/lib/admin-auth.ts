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

export function assertAdminMutationOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  const originHeader = request.headers.get("origin");

  if (fetchSite === "cross-site") {
    throw new ApiError(403, "ADMIN_CROSS_ORIGIN_FORBIDDEN", "교차 출처 관리자 변경 요청을 허용하지 않습니다.");
  }

  if (!originHeader) {
    return;
  }

  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    throw new ApiError(403, "ADMIN_CROSS_ORIGIN_FORBIDDEN", "교차 출처 관리자 변경 요청을 허용하지 않습니다.");
  }

  const requestUrl = new URL(request.url);
  const trustedOrigins = new Set([requestUrl.origin]);
  const host = request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  for (const protocol of [forwardedProtocol, requestUrl.protocol]) {
    const candidate = originFromProtocolAndHost(protocol, host);
    if (candidate) {
      trustedOrigins.add(candidate);
    }
  }

  if (!trustedOrigins.has(origin)) {
    throw new ApiError(403, "ADMIN_CROSS_ORIGIN_FORBIDDEN", "교차 출처 관리자 변경 요청을 허용하지 않습니다.");
  }
}

function originFromProtocolAndHost(protocol: string | null | undefined, host: string | null) {
  const normalizedProtocol = protocol?.replace(/:$/, "").toLowerCase();
  const normalizedHost = host?.trim();
  if (!normalizedHost || (normalizedProtocol !== "http" && normalizedProtocol !== "https")) {
    return null;
  }

  try {
    const candidate = new URL(`${normalizedProtocol}://${normalizedHost}`);
    if (candidate.username || candidate.password || candidate.pathname !== "/" || candidate.search || candidate.hash) {
      return null;
    }
    return candidate.origin;
  } catch {
    return null;
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

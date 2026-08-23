"use client";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
};

const anonymousIdKey = "silsigan.anonymousId.v1";
const anonymousSignatureKey = "silsigan.anonymousSignature.v1";

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const credentials = credentialsFor(input);
  const method = (init?.method ?? "GET").toUpperCase();
  const attachAnonymousIdentity = requestNeedsAnonymousIdentity(input, method);

  if (init?.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (attachAnonymousIdentity) {
    const anonymousId = getAnonymousId();
    if (anonymousId && !headers.has("x-silsigan-anon-id")) {
      headers.set("x-silsigan-anon-id", anonymousId);
    }
    const anonymousSignature = getAnonymousSignature();
    if (anonymousSignature && !headers.has("x-silsigan-anon-signature")) {
      headers.set("x-silsigan-anon-signature", anonymousSignature);
    }
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials,
  });
  if (attachAnonymousIdentity) {
    persistAnonymousId(response.headers.get("x-silsigan-anon-id"));
    persistAnonymousSignature(response.headers.get("x-silsigan-anon-signature"));
  }

  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "요청 처리 중 오류가 발생했습니다.");
  }

  return payload.data as T;
}

function requestNeedsAnonymousIdentity(input: RequestInfo | URL, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") {
    return true;
  }

  const pathname = requestUrl(input)?.pathname ?? "";
  return (
    pathname === "/api/posts" ||
    pathname === "/api/comments" ||
    pathname === "/api/photos" ||
    pathname === "/api/blocks" ||
    pathname.startsWith("/api/my-") ||
    /^\/api\/photos\/[^/]+\/file$/.test(pathname)
  );
}

export function cloudflareApiUrl(path: string): string {
  const baseUrl = cloudflareApiBaseUrl();

  if (!baseUrl) {
    return path;
  }

  return new URL(path, `${baseUrl}/`).toString();
}

export function isCloudflareApiConfigured() {
  return Boolean(cloudflareApiBaseUrl());
}

function cloudflareApiBaseUrl() {
  return process.env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
}

function credentialsFor(input: RequestInfo | URL): RequestCredentials {
  if (typeof window === "undefined") {
    return "include";
  }

  const url = requestUrl(input);
  if (!url) {
    return "include";
  }

  return url.origin === window.location.origin ? "include" : "omit";
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof URL) {
      return input;
    }

    if (typeof input === "string") {
      return new URL(input, window.location.href);
    }

    return new URL(input.url, window.location.href);
  } catch {
    return null;
  }
}

function getAnonymousId() {
  if (typeof window === "undefined") {
    return null;
  }

  const existing = window.localStorage.getItem(anonymousIdKey);
  if (existing && /^[a-zA-Z0-9_-]{12,80}$/.test(existing)) {
    return existing;
  }

  const created = `anon_${crypto.randomUUID()}`;
  window.localStorage.setItem(anonymousIdKey, created);

  return created;
}

function persistAnonymousId(value: string | null) {
  if (!value || typeof window === "undefined") {
    return;
  }

  if (/^[a-zA-Z0-9_-]{12,80}$/.test(value)) {
    window.localStorage.setItem(anonymousIdKey, value);
  }
}

function getAnonymousSignature() {
  if (typeof window === "undefined") {
    return null;
  }

  const existing = window.localStorage.getItem(anonymousSignatureKey);
  return existing && /^v1\.[a-f0-9]{64}$/.test(existing) ? existing : null;
}

function persistAnonymousSignature(value: string | null) {
  if (!value || typeof window === "undefined") {
    return;
  }

  if (/^v1\.[a-f0-9]{64}$/.test(value)) {
    window.localStorage.setItem(anonymousSignatureKey, value);
  }
}

"use client";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
};

const anonymousIdStorageName = "silsigan.anonymousId.v1";
const anonymousSessionStorageName = "silsigan.anonymousSession.v2";
const genericApiErrorMessage = "요청 처리 중 오류가 발생했습니다.";
const photoStabilityProtectionMessage = "서비스 안정성과 악용 방지를 위해 사진 기능을 잠시 제한했습니다. 상태 제보는 계속 이용할 수 있습니다.";
const publicApiErrorMessages: Readonly<Record<string, string>> = Object.freeze({
  ANONYMOUS_SESSION_EXPIRED: "보안 세션이 만료되었습니다. 다시 시도해 주세요.",
  ANONYMOUS_SESSION_PROOF_INVALID: "보안 세션을 다시 확인해야 합니다. 다시 시도해 주세요.",
  ANONYMOUS_SESSION_REVOKED: "종료된 보안 세션입니다. 다시 시도해 주세요.",
  ANONYMOUS_SESSION_REQUIRED: "보안 세션을 준비하지 못했습니다. 다시 시도해 주세요.",
  ACCOUNT_DELETION_CONFIRMATION_REQUIRED: "계정 삭제 확인을 다시 진행해 주세요.",
  ACCOUNT_DELETION_FAILED: "계정 삭제를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  COMMENT_BODY_REJECTED: "댓글에 개인정보나 스팸이 포함되어 있는지 확인해 주세요.",
  CREDIT_LEDGER_REQUIRED: "현재 질문 기능을 사용할 수 없습니다.",
  FEATURE_DISABLED: "현재 사용할 수 없는 기능입니다.",
  NAVER_SEARCH_FAILED: "장소 검색 연결이 원활하지 않습니다. 앱 안 장소를 확인해 주세요.",
  NAVER_SEARCH_NOT_CONFIGURED: "외부 장소 검색 설정 전에는 앱에 등록된 장소만 검색합니다.",
  PHOTO_COST_GUARD_80_PERCENT_STOP: photoStabilityProtectionMessage,
  PHOTO_DAILY_BYTES_LIMIT_EXHAUSTED: "오늘의 사진 업로드 안전 용량에 도달했습니다.",
  PHOTO_DAILY_IP_READ_LIMIT_EXHAUSTED: "비정상적으로 많은 사진 조회가 감지되어 오늘의 조회를 제한했습니다.",
  PHOTO_DAILY_UPLOAD_LIMIT_EXHAUSTED: "오늘의 사진 업로드 안전 횟수에 도달했습니다.",
  PHOTO_DIMENSION_LIMIT: "사진 가로·세로는 1280px 이하로 조정해 주세요.",
  PHOTO_DUPLICATE: "이미 등록된 사진과 동일한 이미지입니다.",
  PHOTO_MIME_TYPE: "JPEG 또는 WebP 사진만 올릴 수 있습니다.",
  PHOTO_MONTHLY_TRANSFORM_BUDGET_EXHAUSTED: photoStabilityProtectionMessage,
  PHOTO_MONTHLY_WRITE_BUDGET_EXHAUSTED: photoStabilityProtectionMessage,
  PHOTO_REQUEST_SIZE_LIMIT: "서버로 보내는 사진은 1MB 이하여야 합니다.",
  PHOTO_SIZE_LIMIT: "서버로 보내는 사진은 1MB 이하여야 합니다.",
  PHOTO_STORAGE_BUDGET_EXHAUSTED: photoStabilityProtectionMessage,
  PHOTO_TRANSFORM_COST_GUARD_80_PERCENT_STOP: photoStabilityProtectionMessage,
  PHOTO_TURNSTILE_CONFIGURATION_REQUIRED: "사진 업로드 보안 확인 설정이 완료되지 않았습니다.",
  PHOTO_TURNSTILE_HOST_POLICY_REQUIRED: "사진 업로드 보안 확인 도메인이 준비되지 않았습니다.",
  PHOTO_TURNSTILE_TOKEN_REQUIRED: "자동 요청 방지를 위한 보안 확인을 진행해 주세요.",
  PHOTO_TURNSTILE_UNAVAILABLE: "사진 업로드 보안 확인 연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.",
  PHOTO_TURNSTILE_VERIFICATION_FAILED: "보안 확인이 만료되었거나 실패했습니다. 다시 확인해 주세요.",
  PHOTO_UPLOAD_RATE_LIMITED: "사진 업로드 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
  PHOTO_UPLOAD_TICKET_EXPIRED: "사진 업로드 시간이 만료됐습니다. 사진을 다시 선택해 주세요.",
  PHOTO_UPLOADS_DISABLED: photoStabilityProtectionMessage,
  PLACE_REQUEST_DAILY_BUDGET_EXHAUSTED: "오늘 접수 가능한 장소 요청 수에 도달했습니다. 내일 다시 시도해 주세요.",
  PLACE_REQUEST_INPUT_REJECTED: "장소명과 주소에 개인정보나 부적절한 내용이 없는지 확인해 주세요.",
  PLACE_REQUEST_RATE_LIMITED: "장소 추가 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
  POST_CAPTION_REJECTED: "게시물에 개인정보나 스팸이 포함되어 있는지 확인해 주세요.",
  PUBLIC_API_RATE_LIMITED: "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
  QUERY_REQUIRED: "검색어를 입력해 주세요.",
  RATE_LIMIT_CAPACITY_REACHED: "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
  RATE_LIMITED: "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
  REPORT_OBSERVATION_REQUIRED: "실제로 확인한 현장 상태를 하나 이상 선택해 주세요.",
});

type AnonymousSessionCredential = {
  anonymousId: string;
  proof: string;
  expiresAt: string;
};

let pendingAnonymousSession: Promise<AnonymousSessionCredential> | null = null;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(apiClientErrorMessage(status, code));
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

export function userFacingApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) {
    return fallback;
  }

  return publicApiErrorMessages[error.code] ?? fallback;
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const credentials = credentialsFor(input);
  const cloudflareRequest = cloudflareApiRequestContext(input, init);
  const boundSessionBaseUrl = cloudflareRequest?.requiresSession ? cloudflareRequest.baseUrl : null;

  if (init?.body != null && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (boundSessionBaseUrl) {
    const session = await getOrIssueAnonymousSession(boundSessionBaseUrl, init?.signal);
    if (!headers.has("x-silsigan-anon-id")) {
      headers.set("x-silsigan-anon-id", session.anonymousId);
    }
    if (!headers.has("x-silsigan-anon-proof")) {
      headers.set("x-silsigan-anon-proof", session.proof);
    }
  } else if (!cloudflareRequest) {
    const anonymousId = getAnonymousId();
    if (anonymousId && !headers.has("x-silsigan-anon-id")) {
      headers.set("x-silsigan-anon-id", anonymousId);
    }
  }

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers,
      credentials,
    });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR");
  }
  if (!cloudflareRequest) {
    persistAnonymousId(response.headers.get("x-silsigan-anon-id"));
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError(response.status, "INVALID_API_RESPONSE");
  }

  if (!response.ok || !payload.success) {
    const code = normalizeApiErrorCode(payload.error?.code);
    if (boundSessionBaseUrl && invalidAnonymousSessionCodes.has(code)) {
      clearAnonymousSessionCredential();
    }
    throw new ApiClientError(response.status, code);
  }

  if (boundSessionBaseUrl && isAccountDeletionRequest(input, init)) {
    clearAnonymousSessionCredential();
  }

  return payload.data as T;
}

const invalidAnonymousSessionCodes = new Set([
  "ANONYMOUS_SESSION_EXPIRED",
  "ANONYMOUS_SESSION_PROOF_INVALID",
  "ANONYMOUS_SESSION_REVOKED",
]);

async function getOrIssueAnonymousSession(baseUrl: string, signal?: AbortSignal | null): Promise<AnonymousSessionCredential> {
  const existing = readAnonymousSessionCredential();
  if (existing) {
    return existing;
  }

  if (!pendingAnonymousSession) {
    pendingAnonymousSession = issueAnonymousSession(baseUrl, signal).finally(() => {
      pendingAnonymousSession = null;
    });
  }

  return pendingAnonymousSession;
}

async function issueAnonymousSession(baseUrl: string, signal?: AbortSignal | null): Promise<AnonymousSessionCredential> {
  let response: Response;
  try {
    response = await fetch(new URL("/api/session/anonymous", `${baseUrl}/`), {
      method: "POST",
      credentials: "omit",
      signal,
    });
  } catch {
    throw new ApiClientError(0, "ANONYMOUS_SESSION_REQUIRED");
  }

  let payload: ApiResponse<AnonymousSessionCredential>;
  try {
    payload = (await response.json()) as ApiResponse<AnonymousSessionCredential>;
  } catch {
    throw new ApiClientError(response.status, "INVALID_API_RESPONSE");
  }

  if (!response.ok || !payload.success || !isAnonymousSessionCredential(payload.data)) {
    throw new ApiClientError(response.status, normalizeApiErrorCode(payload.error?.code ?? "ANONYMOUS_SESSION_REQUIRED"));
  }

  window.localStorage.setItem(anonymousSessionStorageName, JSON.stringify(payload.data));
  window.localStorage.removeItem(anonymousIdStorageName);
  return payload.data;
}

function readAnonymousSessionCredential(): AnonymousSessionCredential | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(anonymousSessionStorageName);
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (isAnonymousSessionCredential(value)) {
      return value;
    }
  } catch {
  }

  window.localStorage.removeItem(anonymousSessionStorageName);
  return null;
}

function isAnonymousSessionCredential(value: unknown): value is AnonymousSessionCredential {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AnonymousSessionCredential>;
  return typeof candidate.anonymousId === "string"
    && /^[a-zA-Z0-9_-]{12,80}$/.test(candidate.anonymousId)
    && typeof candidate.proof === "string"
    && /^[a-zA-Z0-9_-]{43}$/.test(candidate.proof)
    && typeof candidate.expiresAt === "string"
    && Number.isFinite(Date.parse(candidate.expiresAt))
    && Date.parse(candidate.expiresAt) > Date.now();
}

export function clearAnonymousSessionCredential(): void {
  pendingAnonymousSession = null;
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(anonymousSessionStorageName);
  window.localStorage.removeItem(anonymousIdStorageName);
}

type CloudflareApiRequestContext = {
  baseUrl: string;
  requiresSession: boolean;
};

function cloudflareApiRequestContext(input: RequestInfo | URL, init?: RequestInit): CloudflareApiRequestContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const baseUrl = cloudflareApiBaseUrl();
  const target = requestUrl(input);
  if (!baseUrl || !target) {
    return null;
  }

  try {
    const apiUrl = new URL(`${baseUrl}/`);
    if (target.origin !== apiUrl.origin || !target.pathname.startsWith("/api/") || target.pathname === "/api/session/anonymous") {
      return null;
    }
    return {
      baseUrl,
      requiresSession: requiresVerifiedAnonymousSession(target, requestMethod(input, init)),
    };
  } catch {
    return null;
  }
}

function requiresVerifiedAnonymousSession(target: URL, method: string): boolean {
  if (target.pathname.startsWith("/api/admin/")) {
    return false;
  }

  if (method !== "GET" && method !== "HEAD") {
    return true;
  }

  if (
    target.pathname === "/api/preferences"
    || target.pathname === "/api/my-questions"
    || target.pathname === "/api/blocks"
    || (target.pathname === "/api/place-requests" && target.searchParams.get("mine") === "1")
  ) {
    return true;
  }

  return target.pathname === "/api/reports" && target.searchParams.get("mine") === "1";
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }

  return "GET";
}

function isAccountDeletionRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  return init?.method?.toUpperCase() === "POST" && requestUrl(input)?.pathname === "/api/account/deletion";
}

function normalizeApiErrorCode(value: string | undefined): string {
  return value && /^[A-Z][A-Z0-9_]{1,80}$/.test(value) ? value : "UNKNOWN_API_ERROR";
}

function apiClientErrorMessage(status: number, code: string): string {
  const knownMessage = publicApiErrorMessages[code];
  if (knownMessage) {
    return knownMessage;
  }
  if (status === 0) {
    return "네트워크 연결을 확인하고 다시 시도해 주세요.";
  }
  if (status === 401 || status === 403) {
    return "이 요청을 처리할 수 없습니다.";
  }
  if (status === 404) {
    return "요청한 정보를 찾을 수 없습니다.";
  }
  if (status === 409) {
    return "이미 처리되었거나 현재 상태에서는 요청할 수 없습니다.";
  }
  if (status === 429) {
    return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (status >= 500) {
    return "서비스 연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (status >= 400) {
    return "입력 내용을 확인해 주세요.";
  }

  return genericApiErrorMessage;
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

  const existing = window.localStorage.getItem(anonymousIdStorageName);
  if (existing && /^[a-zA-Z0-9_-]{12,80}$/.test(existing)) {
    return existing;
  }

  const created = `anon_${crypto.randomUUID()}`;
  window.localStorage.setItem(anonymousIdStorageName, created);

  return created;
}

function persistAnonymousId(value: string | null) {
  if (!value || typeof window === "undefined") {
    return;
  }

  if (/^[a-zA-Z0-9_-]{12,80}$/.test(value)) {
    window.localStorage.setItem(anonymousIdStorageName, value);
  }
}

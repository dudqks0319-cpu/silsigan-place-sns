export const webViewBridgeCommands = [
  "requestLocation",
  "takePhoto",
  "selectPhoto",
  "share",
  "openSettings",
  "getAppVersion",
  "registerPushToken",
] as const;

export type WebViewBridgeRequest =
  | { requestId: string; command: "requestLocation"; payload: { purpose: "field_report" | "nearby" } }
  | { requestId: string; command: "takePhoto"; payload: { purpose: "field_report"; maxBytes: number } }
  | { requestId: string; command: "selectPhoto"; payload: { purpose: "field_report"; maxBytes: number } }
  | { requestId: string; command: "share"; payload: { url: string; text?: string } }
  | { requestId: string; command: "openSettings"; payload: { section: "app" | "location" | "camera" | "notifications" } }
  | { requestId: string; command: "getAppVersion"; payload: Record<string, never> }
  | { requestId: string; command: "registerPushToken"; payload: { platform: "ios" | "android"; token: string } };

export type WebViewNavigationDecision = "internal" | "external" | "blocked";

export type SilsiganDeepLink =
  | { target: "place"; id: string }
  | { target: "report"; id: string }
  | { target: "home" };

export function classifyWebViewNavigation(
  rawUrl: string,
  allowedOrigins: readonly string[],
  options: { allowLocalDevelopment?: boolean } = {},
): WebViewNavigationDecision {
  const url = safeUrl(rawUrl);
  if (!url) return "blocked";

  if (url.protocol === "https:") {
    return normalizeAllowedOrigins(allowedOrigins, options).has(url.origin) ? "internal" : "external";
  }
  if (options.allowLocalDevelopment && url.protocol === "http:" && isLoopbackHost(url.hostname)) {
    return normalizeAllowedOrigins(allowedOrigins, options).has(url.origin) ? "internal" : "blocked";
  }
  if (url.protocol === "mailto:" || url.protocol === "tel:") return "external";
  return "blocked";
}

export function parseWebViewBridgeRequest(input: unknown): WebViewBridgeRequest {
  if (!isRecord(input)) throw new Error("Bridge request must be an object");
  requireOnlyKeys(input, ["requestId", "command", "payload"]);
  const requestId = requireRequestId(input.requestId);
  const command = input.command;
  const payload = input.payload;
  if (typeof command !== "string" || !isRecord(payload)) throw new Error("Invalid bridge request");

  if (command === "requestLocation") {
    requireOnlyKeys(payload, ["purpose"]);
    return { requestId, command, payload: { purpose: requireEnum(payload.purpose, ["field_report", "nearby"]) } };
  }
  if (command === "takePhoto" || command === "selectPhoto") {
    requireOnlyKeys(payload, ["purpose", "maxBytes"]);
    if (payload.purpose !== "field_report") throw new Error("Invalid photo purpose");
    const maxBytes = requireInteger(payload.maxBytes, 100_000, 10_000_000);
    return { requestId, command, payload: { purpose: "field_report", maxBytes } };
  }
  if (command === "share") {
    requireOnlyKeys(payload, ["url", "text"]);
    const url = requireHttpsUrl(payload.url);
    const text = optionalText(payload.text, 500);
    return { requestId, command, payload: { url, ...(text ? { text } : {}) } };
  }
  if (command === "openSettings") {
    requireOnlyKeys(payload, ["section"]);
    return { requestId, command, payload: { section: requireEnum(payload.section, ["app", "location", "camera", "notifications"]) } };
  }
  if (command === "getAppVersion") {
    requireOnlyKeys(payload, []);
    return { requestId, command, payload: {} };
  }
  if (command === "registerPushToken") {
    requireOnlyKeys(payload, ["platform", "token"]);
    const platform = requireEnum(payload.platform, ["ios", "android"]);
    const token = requireToken(payload.token);
    return { requestId, command, payload: { platform, token } };
  }

  throw new Error("Unsupported bridge command");
}

export function parseSilsiganDeepLink(rawUrl: string): SilsiganDeepLink | null {
  if (rawUrl.includes("\\") || /(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i.test(rawUrl)) return null;
  const url = safeUrl(rawUrl);
  if (!url || url.protocol !== "silsigan:" || url.username || url.password || url.port || url.search || url.hash) {
    return null;
  }
  if (url.hostname === "home" && (url.pathname === "" || url.pathname === "/")) return { target: "home" };
  const id = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,99}$/.test(id)) return null;
  if (url.hostname === "place") return { target: "place", id };
  if (url.hostname === "report") return { target: "report", id };
  return null;
}

function normalizeAllowedOrigins(
  origins: readonly string[],
  options: { allowLocalDevelopment?: boolean },
): Set<string> {
  const normalized = new Set<string>();
  for (const origin of origins) {
    const url = safeUrl(origin);
    if (!url || url.origin !== origin.replace(/\/$/, "")) continue;
    if (url.protocol === "https:" || (options.allowLocalDevelopment && url.protocol === "http:" && isLoopbackHost(url.hostname))) {
      normalized.add(url.origin);
    }
  }
  return normalized;
}

function requireRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/.test(value)) {
    throw new Error("Invalid bridge requestId");
  }
  return value;
}

function requireHttpsUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) throw new Error("Invalid share URL");
  const url = safeUrl(value);
  if (!url || url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid share URL");
  return url.toString();
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) throw new Error("Invalid bridge text");
  return value;
}

function requireToken(value: unknown): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 512 || !/^[a-zA-Z0-9:_-]+$/.test(value)) {
    throw new Error("Invalid push token");
  }
  return value;
}

function requireInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error("Invalid bridge number");
  }
  return value;
}

function requireEnum<const TValue extends string>(value: unknown, values: readonly TValue[]): TValue {
  if (typeof value !== "string" || !values.includes(value as TValue)) throw new Error("Invalid bridge enum");
  return value as TValue;
}

function requireOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) throw new Error("Unexpected bridge field");
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

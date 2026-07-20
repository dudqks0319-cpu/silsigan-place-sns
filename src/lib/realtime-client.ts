import type { CloudflareRealtimeEvent } from "./cloudflare-api.ts";

export const REALTIME_POLL_INTERVAL_MS = 30_000;
export const REALTIME_CONNECT_TIMEOUT_MS = 8_000;
export const REALTIME_MESSAGE_MAX_CHARS = 16_384;

const realtimeEventTypes = new Set<CloudflareRealtimeEvent["type"]>([
  "place.liked",
  "comment.created",
  "photo.ready",
  "report.created",
  "heartbeat",
]);

export function realtimeWebSocketUrl(httpUrl: string): string | null {
  try {
    const url = new URL(httpUrl);
    if (url.username || url.password) {
      return null;
    }
    if (url.protocol === "https:") {
      url.protocol = "wss:";
    } else if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function parseRealtimeEventMessage(
  message: unknown,
  expectedPlaceId: string,
): CloudflareRealtimeEvent | null {
  if (typeof message !== "string" || message.length === 0 || message.length > REALTIME_MESSAGE_MAX_CHARS) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }

  return normalizeRealtimeEvent(value, expectedPlaceId);
}

export function normalizeRealtimeEvent(
  value: unknown,
  expectedPlaceId: string,
): CloudflareRealtimeEvent | null {

  if (!isRecord(value)) {
    return null;
  }

  const { type, scope, roomId, payload, createdAt } = value;
  if (
    typeof type !== "string" ||
    !realtimeEventTypes.has(type as CloudflareRealtimeEvent["type"]) ||
    scope !== "place" ||
    roomId !== expectedPlaceId ||
    !isRecord(payload) ||
    typeof createdAt !== "string" ||
    !Number.isFinite(Date.parse(createdAt))
  ) {
    return null;
  }

  return {
    type: type as CloudflareRealtimeEvent["type"],
    scope: "place",
    roomId,
    payload,
    createdAt,
  };
}

export function mergeRealtimeEvents(
  current: readonly unknown[],
  incoming: readonly unknown[],
  expectedPlaceId: string,
  limit = 50,
): CloudflareRealtimeEvent[] {
  const unique = new Map<string, CloudflareRealtimeEvent>();
  for (const candidate of [...incoming, ...current]) {
    const event = normalizeRealtimeEvent(candidate, expectedPlaceId);
    if (!event) {
      continue;
    }
    const key = realtimeEventKey(event);
    if (!unique.has(key)) {
      unique.set(key, event);
    }
  }

  return [...unique.values()]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, Math.max(1, Math.min(50, Math.trunc(limit))));
}

export function realtimeReconnectDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.trunc(attempt)) : 0;
  return Math.min(30_000, 1_000 * 2 ** Math.min(5, safeAttempt));
}

function realtimeEventKey(event: CloudflareRealtimeEvent): string {
  return [event.type, event.scope, event.roomId, event.createdAt, stablePayloadId(event.payload)].join(":");
}

function stablePayloadId(payload: Record<string, unknown>): string {
  for (const key of ["id", "commentId", "photoId", "reportId", "placeId"]) {
    const value = payload[key];
    if (typeof value === "string" || typeof value === "number") {
      return `${key}=${String(value)}`;
    }
  }
  return "no-id";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

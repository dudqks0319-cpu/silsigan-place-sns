import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  REALTIME_MESSAGE_MAX_CHARS,
  mergeRealtimeEvents,
  parseRealtimeEventMessage,
  realtimeReconnectDelayMs,
  realtimeWebSocketUrl,
} from "../src/lib/realtime-client.ts";
import type { CloudflareRealtimeEvent } from "../src/lib/cloudflare-api.ts";

test("realtime WebSocket URLs preserve the exact API route and reject unsafe schemes or credentials", () => {
  assert.equal(
    realtimeWebSocketUrl("https://api.example.test/api/realtime/place/busan-gwangalli"),
    "wss://api.example.test/api/realtime/place/busan-gwangalli",
  );
  assert.equal(
    realtimeWebSocketUrl("http://127.0.0.1:8787/api/realtime/place/busan-gwangalli?room=1"),
    "ws://127.0.0.1:8787/api/realtime/place/busan-gwangalli?room=1",
  );
  assert.equal(realtimeWebSocketUrl("javascript:alert(1)"), null);
  assert.equal(realtimeWebSocketUrl("https://user:secret@api.example.test/realtime"), null);
});

test("realtime messages are bounded and scoped to the selected place", () => {
  const valid = JSON.stringify({
    type: "photo.ready",
    scope: "place",
    roomId: "busan-gwangalli",
    payload: { id: "photo-1", placeId: "busan-gwangalli" },
    createdAt: "2026-07-19T00:00:00.000Z",
  });
  assert.deepEqual(parseRealtimeEventMessage(valid, "busan-gwangalli"), JSON.parse(valid));
  assert.equal(parseRealtimeEventMessage(valid, "gyeongju-hwangridan"), null);
  assert.equal(parseRealtimeEventMessage(valid.replace('"place"', '"global"'), "busan-gwangalli"), null);
  assert.equal(parseRealtimeEventMessage(valid.replace("photo.ready", "unknown.event"), "busan-gwangalli"), null);
  assert.equal(parseRealtimeEventMessage("{".repeat(REALTIME_MESSAGE_MAX_CHARS + 1), "busan-gwangalli"), null);
});

test("realtime snapshots and WebSocket events merge deterministically without duplicates", () => {
  const older = realtimeEvent("comment.created", "comment-1", "2026-07-19T00:00:00.000Z");
  const newer = realtimeEvent("photo.ready", "photo-1", "2026-07-19T00:01:00.000Z");
  const wrongRoom = { ...newer, roomId: "gyeongju-hwangridan" };

  assert.deepEqual(
    mergeRealtimeEvents([older], [newer, newer, wrongRoom], "busan-gwangalli"),
    [newer, older],
  );
});

test("realtime reconnect backoff is deterministic and capped", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 20].map(realtimeReconnectDelayMs),
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000],
  );
});

test("place realtime UI uses WebSocket first with visibility cleanup and bounded polling fallback", () => {
  const source = readFileSync(new URL("../src/components/silsigan/SilsiganRedesign.tsx", import.meta.url), "utf8");

  assert.match(source, /new window\.WebSocket\(roomWebSocketUrl\)/);
  assert.match(source, /parseRealtimeEventMessage\(event\.data, realtimePlaceId\)/);
  assert.match(source, /realtimeReconnectDelayMs\(reconnectAttempt\)/);
  assert.match(source, /REALTIME_POLL_INTERVAL_MS/);
  assert.match(source, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.doesNotMatch(source, /setInterval\(\(\) => void loadRealtimeRoom\(\), 10_000\)/);
});

function realtimeEvent(
  type: CloudflareRealtimeEvent["type"],
  id: string,
  createdAt: string,
): CloudflareRealtimeEvent {
  return {
    type,
    scope: "place",
    roomId: "busan-gwangalli",
    payload: { id, placeId: "busan-gwangalli" },
    createdAt,
  };
}

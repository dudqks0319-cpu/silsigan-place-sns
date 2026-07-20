import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  listWorkerPlaceAdditionRequests,
  reviewWorkerPlaceAdditionRequest,
} = await import(new URL("../src/lib/worker-admin-api.ts", import.meta.url).href);
const {
  handleAdminPlaceRequestsGet,
  handleAdminPlaceRequestsPost,
} = await import(new URL("../src/lib/worker-admin-route.ts", import.meta.url).href);

const workerEnv = {
  SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
  SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
};

const placeRequest = {
  id: "place_request_12345678",
  clientRequestId: "place-request-client-12345678",
  name: "새 장소",
  address: "부산광역시 수영구",
  category: "관광지",
  status: "needs_verification",
  reviewReason: null,
  matchedPlaceId: null,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  reviewedAt: null,
};

test("place request admin helper returns only the review queue contract", async () => {
  const requests: Request[] = [];
  const result = await listWorkerPlaceAdditionRequests(
    { limit: 99 },
    {
      env: workerEnv,
      fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(input instanceof Request ? input : new Request(input, init));
        return Response.json({
          success: true,
          data: [{ ...placeRequest, anonymousUserId: "must-not-leak", sourceQuery: "private query" }],
        });
      },
    },
  );

  assert.equal(requests[0]?.url, "https://worker.example.test/api/admin/place-requests?limit=50");
  assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
  assert.deepEqual(result, [placeRequest]);
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(result).includes("private query"), false);
});

test("place request review helper sends classification only and enforces review context", async () => {
  const requests: Request[] = [];
  const result = await reviewWorkerPlaceAdditionRequest(
    {
      requestId: placeRequest.id,
      status: "duplicate",
      reason: "기존 장소와 일치함",
      matchedPlaceId: "busan-existing-place",
    },
    {
      env: workerEnv,
      fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push(request);
        return Response.json({
          success: true,
          data: {
            ...placeRequest,
            status: "duplicate",
            reviewReason: "기존 장소와 일치함",
            matchedPlaceId: "busan-existing-place",
            reviewedAt: "2026-07-20T01:00:00.000Z",
          },
        });
      },
    },
  );

  assert.equal(result.status, "duplicate");
  assert.equal(requests[0]?.url, "https://worker.example.test/api/admin/place-requests/place_request_12345678/action");
  assert.deepEqual(await requests[0]?.json(), {
    status: "duplicate",
    reason: "기존 장소와 일치함",
    matchedPlaceId: "busan-existing-place",
  });
  await assert.rejects(
    () => reviewWorkerPlaceAdditionRequest({ requestId: placeRequest.id, status: "duplicate", reason: "중복 장소 확인" }, { env: workerEnv }),
    /일치 장소 ID가 필요합니다/,
  );
  await assert.rejects(
    () => reviewWorkerPlaceAdditionRequest({ requestId: placeRequest.id, status: "rejected", reason: "요청 정보 부족", matchedPlaceId: "not-allowed" }, { env: workerEnv }),
    /기존 장소 판정에서만/,
  );
  await assert.rejects(
    () => reviewWorkerPlaceAdditionRequest({ requestId: placeRequest.id, status: "needs_verification", reason: "짧음" }, { env: workerEnv }),
    /5자 이상 300자 이하/,
  );
});

test("Next place request proxy authenticates and blocks cross-origin mutations before Worker access", async () => {
  const previous = {
    admin: process.env.SILSIGAN_ADMIN_TOKEN,
    baseUrl: process.env.SILSIGAN_WORKER_API_BASE_URL,
    workerToken: process.env.SILSIGAN_WORKER_ADMIN_TOKEN,
  };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  process.env.SILSIGAN_ADMIN_TOKEN = "next-admin-token";
  process.env.SILSIGAN_WORKER_API_BASE_URL = workerEnv.SILSIGAN_WORKER_API_BASE_URL;
  process.env.SILSIGAN_WORKER_ADMIN_TOKEN = workerEnv.SILSIGAN_WORKER_ADMIN_TOKEN;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({ success: true, data: [] });
  };

  try {
    await assert.rejects(
      () => handleAdminPlaceRequestsGet(new Request("http://localhost/api/admin/place-requests")),
      /관리자 인증이 필요합니다/,
    );
    await assert.rejects(
      () => handleAdminPlaceRequestsPost(new Request("http://localhost/api/admin/place-requests", {
        method: "POST",
        headers: {
          cookie: "silsigan_admin=next-admin-token",
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ requestId: placeRequest.id, status: "rejected", reason: "요청 정보 부족" }),
      })),
      /교차 출처 관리자 변경 요청을 허용하지 않습니다/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previous.admin);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previous.baseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previous.workerToken);
    globalThis.fetch = originalFetch;
  }
});

test("place request UI exposes classification labels without place mutation actions", () => {
  const source = readFileSync(new URL("../src/app/admin/moderation/posts/ModerationQueueClient.tsx", import.meta.url), "utf8");
  const start = source.indexOf('aria-labelledby="place-request-queue-heading"');
  const end = source.indexOf('aria-label="데모 게시물 신고 큐"', start);
  const section = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(source, /status: "needs_verification", label: "추가 확인"/);
  assert.match(source, /status: "duplicate", label: "기존 장소"/);
  assert.match(source, /status: "ready_for_manual_import", label: "등록 준비"/);
  assert.match(source, /status: "rejected", label: "거절"/);
  assert.doesNotMatch(section, /승인|공개/);
  assert.doesNotMatch(section, /api\/places|createPlace|등록 완료/);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

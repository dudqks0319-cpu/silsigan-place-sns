import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  ApiClientError,
  clearAnonymousSessionCredential,
  fetchJson,
  userFacingApiErrorMessage,
} from "../src/lib/api-client.ts";

async function withJsonResponse<T>(
  status: number,
  payload: unknown,
  assertion: (url: string) => Promise<T>,
): Promise<T> {
  const server = createServer((_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    return await assertion(`http://127.0.0.1:${address.port}/api/test`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("API client never exposes backend diagnostic text to user-visible errors", async () => {
  await withJsonResponse(
    400,
    {
      success: false,
      error: {
        code: "PHOTO_MIME_TYPE",
        message: "photos/private-place/secret-object.webp 내부 저장 키 오류",
      },
    },
    async (url) => {
      await assert.rejects(fetchJson(url), (error: unknown) => {
        assert.ok(error instanceof ApiClientError);
        assert.equal(error.status, 400);
        assert.equal(error.code, "PHOTO_MIME_TYPE");
        assert.equal(error.message, "JPEG 또는 WebP 사진만 올릴 수 있습니다.");
        assert.doesNotMatch(String(error), /photos\/|secret-object|내부 저장 키/);
        return true;
      });
    },
  );
});

test("API client keeps a contextual fallback for unknown backend failures", async () => {
  const unknownError = new ApiClientError(500, "UNEXPECTED_INTERNAL_DIAGNOSTIC");

  assert.equal(
    userFacingApiErrorMessage(unknownError, "댓글을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요."),
    "댓글을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  );
  assert.doesNotMatch(unknownError.message, /UNEXPECTED_INTERNAL_DIAGNOSTIC/);
});

test("API client preserves actionable stability protection and success behavior", async () => {
  const guardError = new ApiClientError(429, "PHOTO_COST_GUARD_80_PERCENT_STOP");
  assert.equal(
    userFacingApiErrorMessage(guardError, "사진을 올리지 못했습니다."),
    "서비스 안정성과 악용 방지를 위해 사진 기능을 잠시 제한했습니다. 상태 제보는 계속 이용할 수 있습니다.",
  );
  assert.equal(
    userFacingApiErrorMessage(new ApiClientError(403, "PHOTO_TURNSTILE_VERIFICATION_FAILED"), "사진을 올리지 못했습니다."),
    "보안 확인이 만료되었거나 실패했습니다. 다시 확인해 주세요.",
  );
  assert.equal(
    userFacingApiErrorMessage(new ApiClientError(503, "PHOTO_TURNSTILE_UNAVAILABLE"), "사진을 올리지 못했습니다."),
    "사진 업로드 보안 확인 연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.",
  );
  assert.equal(
    userFacingApiErrorMessage(new ApiClientError(429, "PHOTO_DAILY_IP_READ_LIMIT_EXHAUSTED"), "사진을 불러오지 못했습니다."),
    "비정상적으로 많은 사진 조회가 감지되어 오늘의 조회를 제한했습니다.",
  );
  assert.equal(
    userFacingApiErrorMessage(new ApiClientError(429, "RATE_LIMITED"), "댓글을 등록하지 못했습니다."),
    "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
  );
  assert.equal(
    userFacingApiErrorMessage(new ApiClientError(429, "RATE_LIMIT_CAPACITY_REACHED"), "댓글을 등록하지 못했습니다."),
    "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
  );

  await withJsonResponse(200, { success: true, data: { id: "place-safe" } }, async (url) => {
    assert.deepEqual(await fetchJson<{ id: string }>(url), { id: "place-safe" });
  });
});

test("API client keeps public reads available without issuing a session and binds protected requests to proof", async () => {
  const requests: Array<{ path: string; anonymousId: string | undefined; proof: string | undefined }> = [];
  const proof = "A".repeat(43);
  let blockSessionIssuance = true;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname;
    requests.push({
      path,
      anonymousId: typeof request.headers["x-silsigan-anon-id"] === "string" ? request.headers["x-silsigan-anon-id"] : undefined,
      proof: typeof request.headers["x-silsigan-anon-proof"] === "string" ? request.headers["x-silsigan-anon-proof"] : undefined,
    });
    if (path === "/api/session/anonymous" && blockSessionIssuance) {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: false, error: { code: "ANONYMOUS_SESSION_DAILY_LIMIT_EXHAUSTED" } }));
      return;
    }
    response.writeHead(path === "/api/session/anonymous" ? 201 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify(path === "/api/session/anonymous"
      ? {
          success: true,
          data: {
            anonymousId: "anon_server_bound_client",
            proof,
            expiresAt: "2099-12-31T23:59:59.999Z",
          },
        }
      : { success: true, data: { ok: true } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const previousBaseUrl = process.env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: new URL("https://app.test/"),
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });
  process.env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL = baseUrl;

  try {
    await fetchJson(`${baseUrl}/api/places`);
    assert.deepEqual(requests, [
      { path: "/api/places", anonymousId: undefined, proof: undefined },
    ]);
    assert.equal(values.has("silsigan.anonymousSession.v2"), false);
    assert.equal(values.has("silsigan.anonymousId.v1"), false);

    blockSessionIssuance = false;
    await fetchJson(`${baseUrl}/api/preferences`);
    await fetchJson(`${baseUrl}/api/place-requests?mine=1`);
    await fetchJson(`${baseUrl}/api/comments`, { method: "POST", body: JSON.stringify({}) });
    await fetchJson(`${baseUrl}/api/place-requests`, { method: "POST", body: JSON.stringify({}) });
    assert.deepEqual(requests, [
      { path: "/api/places", anonymousId: undefined, proof: undefined },
      { path: "/api/session/anonymous", anonymousId: undefined, proof: undefined },
      { path: "/api/preferences", anonymousId: "anon_server_bound_client", proof },
      { path: "/api/place-requests", anonymousId: "anon_server_bound_client", proof },
      { path: "/api/comments", anonymousId: "anon_server_bound_client", proof },
      { path: "/api/place-requests", anonymousId: "anon_server_bound_client", proof },
    ]);
    assert.match(values.get("silsigan.anonymousSession.v2") ?? "", /anon_server_bound_client/);
    assert.equal(values.has("silsigan.anonymousId.v1"), false);

    await fetchJson(`${baseUrl}/api/account/deletion`, {
      method: "POST",
      body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }),
    });
    assert.deepEqual(requests.at(-1), {
      path: "/api/account/deletion",
      anonymousId: "anon_server_bound_client",
      proof,
    });
    assert.equal(values.has("silsigan.anonymousSession.v2"), false);
  } finally {
    clearAnonymousSessionCredential();
    if (previousBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL = previousBaseUrl;
    }
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

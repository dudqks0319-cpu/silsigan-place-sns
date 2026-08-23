import assert from "node:assert/strict";
import test from "node:test";
import { getSilsiganApiFetcher } from "../src/lib/cloudflare-service-fetch.ts";
import { findSharedPlace, sharedPlaceFallbackImagePath } from "../src/lib/shared-place.ts";

test("Cloudflare API fetcher prefers the internal service binding", async () => {
  let serviceCalls = 0;
  let fallbackCalls = 0;
  const serviceFetch = async (): Promise<Response> => {
    serviceCalls += 1;
    return Response.json({ source: "service" });
  };
  const fallbackFetch = async (): Promise<Response> => {
    fallbackCalls += 1;
    return Response.json({ source: "fallback" });
  };

  const fetcher = getSilsiganApiFetcher({
    fallback: fallbackFetch,
    getContext: () => ({ env: { SILSIGAN_API: { fetch: serviceFetch } } }),
  });
  const response = await fetcher("https://api.example.test/health");

  assert.deepEqual(await response.json(), { source: "service" });
  assert.equal(serviceCalls, 1);
  assert.equal(fallbackCalls, 0);
});

test("Cloudflare API fetcher falls back outside a Worker request context", async () => {
  let fallbackCalls = 0;
  const fallbackFetch = async (): Promise<Response> => {
    fallbackCalls += 1;
    return Response.json({ source: "fallback" });
  };

  const fetcher = getSilsiganApiFetcher({
    fallback: fallbackFetch,
    getContext: () => {
      throw new Error("no Cloudflare context");
    },
  });
  const response = await fetcher("https://api.example.test/health");

  assert.deepEqual(await response.json(), { source: "fallback" });
  assert.equal(fallbackCalls, 1);
});

test("shared place lookup reads a validated place from the Worker", async () => {
  let requestedUrl = "";
  let forwardedClientIp = "";
  const place = await findSharedPlace("busan-gwangalli", {
    env: {
      NODE_ENV: "production",
      SILSIGAN_WORKER_API_BASE_URL: "https://api.example.test/",
    },
    clientIp: "2001:db8::1",
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      forwardedClientIp = new Headers(init?.headers).get("cf-connecting-ip") ?? "";
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: "busan-gwangalli",
            name: "광안리해수욕장",
            categoryId: "tourism",
            areaId: "busan-suyeong",
            regionId: "busan",
            latitude: 35.1532,
            longitude: 129.1186,
            score: 0,
            status: "active",
            coordinateStatus: "verified",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(requestedUrl, "https://api.example.test/api/places/busan-gwangalli");
  assert.equal(forwardedClientIp, "2001:db8::1");
  assert.equal(place?.name, "광안리해수욕장");
  assert.equal(place?.coordinateStatus, "verified");
});

test("shared place lookup fails closed for invalid or malformed Worker data", async () => {
  let requestCount = 0;
  const invalidId = await findSharedPlace("../secret", {
    env: { NODE_ENV: "production", SILSIGAN_WORKER_API_BASE_URL: "https://api.example.test" },
    fetcher: async () => {
      requestCount += 1;
      return new Response("{}", { status: 200 });
    },
  });
  const malformed = await findSharedPlace("busan-gwangalli", {
    env: { NODE_ENV: "production", SILSIGAN_WORKER_API_BASE_URL: "https://api.example.test" },
    fetcher: async () => new Response(JSON.stringify({ success: true, data: { id: "busan-gwangalli" } }), { status: 200 }),
  });

  assert.equal(invalidId, null);
  assert.equal(requestCount, 0);
  assert.equal(malformed, null);
});

test("shared place lookup never forwards an invalid client IP value", async () => {
  let forwardedClientIp = "unexpected";
  await findSharedPlace("busan-gwangalli", {
    env: { NODE_ENV: "production", SILSIGAN_WORKER_API_BASE_URL: "https://api.example.test" },
    clientIp: "not-an-ip",
    fetcher: async (_input, init) => {
      forwardedClientIp = new Headers(init?.headers).get("cf-connecting-ip") ?? "";
      return Response.json({ success: false, error: { code: "PUBLIC_API_CLIENT_IP_REQUIRED" } }, { status: 403 });
    },
  });

  assert.equal(forwardedClientIp, "");
});

test("production shared place lookup never falls back to demo places", async () => {
  const place = await findSharedPlace("busan-gwangalli", { env: { NODE_ENV: "production" } });
  assert.equal(place, null);
});

test("local shared place lookup uses an explicit preview place only without a Worker URL", async () => {
  const place = await findSharedPlace("busan-gwangalli", { env: { NODE_ENV: "development" } });

  assert.equal(place?.id, "busan-gwangalli");
  assert.equal(place?.name, "광안리해수욕장");
  assert.equal(place?.coordinateStatus, "TODO_COORDINATE_VERIFY");
});

test("shared place Open Graph fallback uses bundled photo assets", () => {
  assert.equal(sharedPlaceFallbackImagePath("busan-gwangalli"), "/silsigan/fallback/gwangalli.png");
  assert.equal(sharedPlaceFallbackImagePath("gyeongju-hwangridan"), "/silsigan/fallback/hwangridan.png");
  assert.equal(sharedPlaceFallbackImagePath("ulsan-taehwagang"), "/silsigan/fallback/taehwagang.png");
  assert.equal(sharedPlaceFallbackImagePath("unknown-place"), null);
});

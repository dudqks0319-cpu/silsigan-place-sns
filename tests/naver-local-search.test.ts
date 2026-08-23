import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/lib/errors.ts";
import {
  clearNaverLocalSearchCacheForTests,
  fetchCachedNaverLocalSearch,
  fetchNaverLocalSearch,
  normalizeNaverLocalSearchPayload,
} from "../src/lib/naver-local-search.ts";

test("Naver local search normalizes provider text and drops unsafe links", () => {
  const result = normalizeNaverLocalSearchPayload({
    items: [
      {
        title: "<b>광안리 해수욕장</b>",
        category: "관광지<em>해변</em>",
        roadAddress: "부산 수영구 광안해변로",
        address: "부산 수영구",
        mapx: 129.1185,
        mapy: "35.1531",
        link: "javascript:alert(1)",
      },
      { title: "<b></b>" },
    ],
  });

  assert.deepEqual(result.items, [
    {
      title: "광안리 해수욕장",
      category: "관광지해변",
      roadAddress: "부산 수영구 광안해변로",
      address: "부산 수영구",
      mapx: "129.1185",
      mapy: "35.1531",
      link: "",
    },
  ]);
  assert.match(result.coordinateNote, /좌표계/);
});

test("Naver local search rejects malformed provider payloads", () => {
  assert.throws(
    () => normalizeNaverLocalSearchPayload({ items: "not-an-array" }),
    (error) => error instanceof ApiError && error.code === "NAVER_SEARCH_SHAPE_INVALID" && error.status === 502,
  );
  assert.throws(
    () => normalizeNaverLocalSearchPayload({}),
    (error) => error instanceof ApiError && error.code === "NAVER_SEARCH_SHAPE_INVALID" && error.status === 502,
  );
});

test("Naver local search maps provider network failures to a redacted 502", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new TypeError("provider socket failed"));

  try {
    await assert.rejects(
      fetchNaverLocalSearch("광안리", { clientId: "test-client", clientSecret: "test-secret" }),
      (error) => error instanceof ApiError && error.code === "NAVER_SEARCH_FAILED" && error.status === 502,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Naver local search aborts a slow provider request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });

  try {
    await assert.rejects(
      fetchNaverLocalSearch("광안리", { clientId: "test-client", clientSecret: "test-secret" }, 5),
      (error) => error instanceof ApiError && error.code === "NAVER_SEARCH_TIMEOUT" && error.status === 504,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Naver local search deduplicates equivalent queries before a metered provider call", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  clearNaverLocalSearchCacheForTests();
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(
      JSON.stringify({
        items: [
          {
            title: "광안리 해수욕장",
            category: "관광지",
            roadAddress: "부산 수영구 광안해변로",
            address: "부산 수영구",
            mapx: "1291185",
            mapy: "351531",
            link: "https://example.com/place",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const credentials = { clientId: "test-client", clientSecret: "test-secret" };
    const [first, second] = await Promise.all([
      fetchCachedNaverLocalSearch("광안리  해수욕장", credentials),
      fetchCachedNaverLocalSearch(" 광안리 해수욕장 ", credentials),
    ]);

    assert.equal(providerCalls, 1);
    assert.deepEqual(first, second);
  } finally {
    clearNaverLocalSearchCacheForTests();
    globalThis.fetch = originalFetch;
  }
});

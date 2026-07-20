import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("public source fallback evidence proves six redacted fail-closed source scenarios", () => {
  const scriptPath = fileURLToPath(new URL("../scripts/public-source-fallback-evidence.mjs", import.meta.url));
  const output = execFileSync(process.execPath, ["--experimental-strip-types", scriptPath], {
    encoding: "utf8",
  });
  const payload = JSON.parse(output) as {
    schemaVersion: string;
    ok: boolean;
    passedSources: number;
    failedSources: number;
    sensitiveHits: string[];
    sources: Array<{
      sourceKey: string;
      sourceKind: "live" | "static";
      cacheSequence: string[];
      outageHealth: string;
      expiredDecision: string;
      terminalErrorCode: string;
      timestampContract: string;
      passed: boolean;
    }>;
  };

  assert.equal(payload.schemaVersion, "silsigan-public-source-fallback-evidence/v1");
  assert.equal(payload.ok, true);
  assert.equal(payload.passedSources, 6);
  assert.equal(payload.failedSources, 0);
  assert.deepEqual(payload.sensitiveHits, []);
  assert.deepEqual(
    payload.sources.map((source) => source.sourceKey).sort(),
    ["kma_weather", "national_cctv", "national_parking", "national_traffic", "seoul_realtime_city", "tour_api"],
  );

  for (const source of payload.sources) {
    assert.deepEqual(source.cacheSequence, ["network", "fresh", "stale", "insufficient"]);
    assert.equal(source.outageHealth, "degraded");
    assert.equal(source.expiredDecision, "insufficient");
    assert.equal(source.terminalErrorCode, "SOURCE_HTTP_ERROR");
    assert.equal(source.timestampContract, source.sourceKind === "live" ? "bounded-live" : "static-only");
    assert.equal(source.passed, true);
  }

  assert.equal(
    /fixture-service-key|provider-secret|ServiceKey|apiKey|https?:\/\/|cctvUrl|streamUrl|m3u8|129\.1|35\.1/i.test(output),
    false,
  );
});

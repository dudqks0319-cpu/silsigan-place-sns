import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { createCloudflareApiClient } from "../src/lib/cloudflare-api.ts";
import * as worker from "../workers/api/src/index.ts";
import * as policies from "../workers/api/src/policies.ts";

const pagesSmoke = await import(new URL("../scripts/cloudflare-pages-smoke.mjs", import.meta.url).href);
const pagesLocalReportSmoke = await import(new URL("../scripts/cloudflare-pages-local-report-smoke.mjs", import.meta.url).href);
const stagingSmoke = await import(new URL("../scripts/cloudflare-staging-smoke.mjs", import.meta.url).href);
const releaseGate = await import(new URL("../scripts/cloudflare-release-gate.mjs", import.meta.url).href);
const externalState = await import(new URL("../scripts/cloudflare-external-state-check.mjs", import.meta.url).href);
const d1ReleaseEvidence = await import(new URL("../scripts/cloudflare-d1-release-evidence.mjs", import.meta.url).href);
const r2ReleaseEvidence = await import(new URL("../scripts/cloudflare-r2-release-evidence.mjs", import.meta.url).href);
const buildSecretScan = await import(new URL("../scripts/scan-build-env-secrets.mjs", import.meta.url).href);
const buildEnvPolicy = await import(new URL("../scripts/build-env-policy.mjs", import.meta.url).href);
const cloudflareWebBuild = await import(new URL("../scripts/cloudflare-web-build.mjs", import.meta.url).href);
const cloudflareWebDeploy = await import(new URL("../scripts/cloudflare-web-deploy.mjs", import.meta.url).href);
const require = createRequire(import.meta.url);

type SuccessPayload<TData> = {
  success: true;
  data: TData;
  meta?: Record<string, unknown>;
};

type FailurePayload = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type Place = {
  id: string;
  regionId: string;
  latitude: number;
  longitude: number;
  score: number;
  coordinateStatus: "verified" | "TODO_COORDINATE_VERIFY" | "rejected";
};

type Ranking = {
  placeId: string;
  name: string;
  regionId: string;
  regionCode: string;
  areaCode: string;
  category: string;
  score: number;
  rank: number;
  windowHours: number;
  clickCount: number;
  likeCount: number;
  commentCount: number;
  photoCount: number;
  reportCount: number;
  uniqueUserCount: number;
  trend: "up" | "down" | "same";
  summary: string;
};

type Comment = {
  id: string;
  placeId: string;
  body: string;
  likeCount: number;
  ownedByCurrentSession: boolean;
};

type PhotoCompleteData = {
  photo: {
    id: string;
    clickCount: number;
    status: "pending" | "ready" | "rejected";
  };
  storageKey: string;
};

type FieldReportData = {
  report: {
    id: string;
    placeId: string;
    category: string;
    crowdLevel?: string;
    lineStatus?: string;
    parkingStatus?: string;
    weatherFeel?: string;
    localConditions: string[];
    observations: Array<{ dimension: string; valueCode: string; expiresAt: string }>;
    verifiedRadiusM: number | null;
    photoId?: string;
    createdAt: string;
    expiresAt: string;
    moderationStatus: "pending" | "approved" | "rejected";
  };
  credits: Array<{ type: "verified_report" | "photo_report"; amount: number }>;
  safetyWarning: string | null;
  privacyNotice: string;
};

type SmokeFixtureRequest = AsyncIterable<Uint8Array> & {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
};

type SmokeFixtureResponse = {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: BodyInit | null) => void;
};

type FeedPost = {
  id: string;
  userId: string;
  placeId: string;
  caption: string | null;
  locationVerified: boolean;
  verifiedRadiusM: number | null;
  helpfulCount: number;
  hashtagNames: string[];
  hashtags: Array<{ name: string; tagType: string; postCount: number }>;
  shareCard: { headline: string; body: string; url: string; hashtags: string[] };
  judgement: "가도 좋음" | "주의" | "지금은 비추";
  safetyWarning: string | null;
  hiddenAt: string | null;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
};

type QuestionData = {
  id: string;
  placeId: string;
  questionType: string;
  body: string;
  creditCost: number;
  answeredReportId: string | null;
  createdAt: string;
  status?: string;
};

type ModerationAlertPayload = {
  type: "moderation.report.created";
  reportId: string;
  targetType: "place" | "post" | "comment" | "photo";
  targetId: string;
  reason: "false_content" | "spam" | "privacy_face" | "privacy_plate" | "sensitive_info" | "other";
  priority: "normal" | "high" | "urgent";
  queuePath: string;
  environment: string;
  createdAt: string;
};

type ReleaseGateStep = {
  name: string;
  args: string[];
  envKeys: string[];
};

type D1TestPlaceRow = {
  id: string;
  name: string;
  categoryId: string;
  areaId: string;
  regionId: string;
  latitude: number;
  longitude: number;
  score: number;
  status: "seed" | "beta" | "active" | "paused";
  coordinateStatus: "verified" | "TODO_COORDINATE_VERIFY" | "rejected";
};

const testAdminTokens = JSON.stringify({
  operator: "test-operator-token",
  moderator: "test-moderator-token",
  admin: "test-admin-token",
});
const testCostGuardSecret = "test-cost-guard-secret-that-is-long-enough";

function signedPhotoRequestHeaders(anonymousId: string, idempotencyKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    "x-silsigan-anon-id": anonymousId,
    "x-silsigan-anon-signature": `v1.${createHmac("sha256", testCostGuardSecret)
      .update(`photo-session:v1:${anonymousId}`)
      .digest("hex")}`,
  };
}

function persistentPhotoBindings(db: SqliteD1Database, r2: FakeR2Bucket) {
  return {
    DB: db,
    PHOTOS: r2,
    CACHE: new FakeKVNamespace(),
    PLACE_ROOM: new FakeDurableObjectNamespace(() => new worker.PlaceRoom()),
    REGION_ROOM: new FakeDurableObjectNamespace(() => new worker.RegionRoom()),
    GLOBAL_ROOM: new FakeDurableObjectNamespace(() => new worker.GlobalRoom()),
    ENVIRONMENT: "staging",
    PHOTO_UPLOADS_ENABLED: "true",
    COST_GUARD_HASH_SECRET: testCostGuardSecret,
    PHOTO_GLOBAL_DAILY_LIMIT: "150",
    PHOTO_GLOBAL_MONTHLY_LIMIT: "4500",
    PHOTO_GLOBAL_STORED_LIMIT: "9000",
  } as const;
}
const tinyJpegBase64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z";

test("Cloudflare resource preflight accepts concrete staging and production bindings", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-ready-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" })), "utf8");

    const output = execFileSync(process.execPath, [new URL("../scripts/cloudflare-resource-preflight.mjs", import.meta.url).pathname, "--config", configPath], {
      encoding: "utf8",
      env: createReadyPreflightProcessEnv(),
    });
    const payload = JSON.parse(output) as { ok: boolean; checks: Array<{ status: string }> };

    assert.equal(payload.ok, true);
    assert.equal(payload.checks.every((check) => check.status === "pass"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare frontend staging config pins the selected public API and site origins", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")) as {
    env?: { staging?: { vars?: Record<string, string>; services?: Array<{ binding?: string; service?: string }> } };
  };
  const vars = config.env?.staging?.vars;
  const services = config.env?.staging?.services;

  assert.equal(vars?.SILSIGAN_STAGING_API_BASE_URL, "https://silsigan-api-staging.dudqks0319.workers.dev");
  assert.equal(vars?.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL, "https://silsigan-api-staging.dudqks0319.workers.dev");
  assert.equal(vars?.NEXT_PUBLIC_SITE_URL, "https://silsigan-web-staging.dudqks0319.workers.dev");
  assert.deepEqual(services, [{ binding: "SILSIGAN_API", service: "silsigan-api-staging" }]);
  assert.equal(Object.keys(vars ?? {}).some((key) => /token|secret|password|api[_-]?key/i.test(key)), false);
});

test("build secret scan reports only key names and fails when a local secret is bundled", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-build-secret-scan-"));
  const envPath = join(tempDir, ".env.local");
  const buildDir = join(tempDir, "build");
  const secretValue = "test-secret-value-that-must-not-be-reported";

  try {
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(envPath, `SERVICE_API_KEY=${secretValue}\nNEXT_PUBLIC_SITE_URL=https://example.test\n`, "utf8");
    writeFileSync(join(buildDir, "safe.js"), "export const safe = true;", "utf8");

    const safeResult = await buildSecretScan.scanBuildForEnvValues(envPath, buildDir);
    assert.equal(safeResult.ok, true);
    assert.deepEqual(safeResult.matchedSecretKeys, []);

    writeFileSync(join(buildDir, "leaked.js"), `export const leaked = ${JSON.stringify(secretValue)};`, "utf8");
    const leakedResult = await buildSecretScan.scanBuildForEnvValues(envPath, buildDir);
    assert.equal(leakedResult.ok, false);
    assert.deepEqual(leakedResult.matchedSecretKeys, ["SERVICE_API_KEY"]);
    assert.equal(JSON.stringify(leakedResult).includes(secretValue), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Next build policy strips server secrets before bundling and preserves public origins", () => {
  const secretValue = "test-runtime-secret-that-must-not-be-reported";
  const env: Record<string, string> = {
    PATH: "/usr/bin",
    NEXT_PUBLIC_SITE_URL: "https://example.test",
    NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "public-client-id",
    KOREA_DATA_API_KEY: secretValue,
    VERCEL_OIDC_TOKEN: secretValue,
    SUPABASE_SERVICE_ROLE_KEY: secretValue,
  };

  const removedKeys = buildEnvPolicy.stripServerSecretsFromBuildEnv(env);
  assert.deepEqual(removedKeys, ["KOREA_DATA_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL_OIDC_TOKEN"]);
  assert.deepEqual(env, {
    PATH: "/usr/bin",
    NEXT_PUBLIC_SITE_URL: "https://example.test",
    NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "public-client-id",
  });
  assert.equal(JSON.stringify(removedKeys).includes(secretValue), false);
  const nextConfigSource = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(nextConfigSource, /stripServerSecretsFromBuildEnv\(process\.env\)/);
  assert.match(nextConfigSource, /images:\s*\{[\s\S]*?unoptimized:\s*true/);

  const sharpShim = require(new URL("../packages/sharp-disabled/index.cjs", import.meta.url).pathname);
  assert.throws(() => sharpShim(), /Native sharp image optimization is disabled/);
});

test("Cloudflare web build isolates dotenv files and requires exact public staging origins", () => {
  const root = "/tmp/silsigan-source";
  const config = JSON.stringify({
    env: {
      staging: {
        vars: {
          SILSIGAN_STAGING_API_BASE_URL: "https://api.example.test",
          NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL: "https://api.example.test",
          NEXT_PUBLIC_SITE_URL: "https://web.example.test",
        },
      },
    },
  });

  assert.deepEqual(cloudflareWebBuild.parseBuildEnv(config, "staging"), {
    SILSIGAN_STAGING_API_BASE_URL: "https://api.example.test",
    NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL: "https://api.example.test",
    NEXT_PUBLIC_SITE_URL: "https://web.example.test",
  });
  assert.equal(cloudflareWebBuild.parseEnvironmentArgument([]), "staging");
  assert.equal(cloudflareWebBuild.shouldCopyBuildSource(join(root, "src", "app.ts"), root), true);
  assert.equal(cloudflareWebBuild.shouldCopyBuildSource(join(root, ".env.local"), root), false);
  assert.equal(cloudflareWebBuild.shouldCopyBuildSource(join(root, ".open-next", "worker.js"), root), false);
  assert.equal(cloudflareWebBuild.shouldCopyBuildSource(join(root, ".open-next.safe-build-123", "worker.js"), root), false);
  assert.equal(cloudflareWebBuild.shouldCopyBuildSource(join(root, "artifacts", "packet.json"), root), false);
  assert.equal(cloudflareWebBuild.shouldCopyBuildSource(join(root, "apps", "webview", "ios", "App.xcodeproj"), root), false);
});

test("Cloudflare web build fails closed for production without public origins", () => {
  assert.throws(
    () => cloudflareWebBuild.parseBuildEnv(JSON.stringify({ env: { production: { name: "web-production" } } }), "production"),
    /production public build vars are not configured/,
  );
  assert.throws(
    () =>
      cloudflareWebBuild.parseBuildEnv(
        JSON.stringify({
          env: {
            staging: {
              vars: {
                SILSIGAN_STAGING_API_BASE_URL: "https://api.example.test",
                NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL: "https://other.example.test",
                NEXT_PUBLIC_SITE_URL: "https://web.example.test",
              },
            },
          },
        }),
        "staging",
      ),
    /same exact origin/,
  );
  assert.throws(
    () =>
      cloudflareWebBuild.parseBuildEnv(
        JSON.stringify({
          env: {
            production: {
              vars: {
                NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL: "https://api.example.test/private",
                NEXT_PUBLIC_SITE_URL: "https://web.example.test",
              },
            },
          },
        }),
        "production",
      ),
    /credential-free HTTPS origin/,
  );
});

test("Cloudflare web build removes OpenNext's unsupported dynamic middleware manifest require", () => {
  const unsafe = "before;getMiddlewareManifest(){return this.minimalMode?null:require(this.middlewareManifestPath)};after";
  const patched = cloudflareWebBuild.patchOpenNextMiddlewareManifestSource(unsafe);

  assert.equal(patched.status, "patched");
  assert.equal(patched.source, "before;getMiddlewareManifest(){return null};after");
  assert.equal(patched.source.includes("require(this.middlewareManifestPath)"), false);

  const alreadySafe = cloudflareWebBuild.patchOpenNextMiddlewareManifestSource(patched.source);
  assert.equal(alreadySafe.status, "already-safe");
  assert.equal(alreadySafe.source, patched.source);

  assert.throws(
    () => cloudflareWebBuild.patchOpenNextMiddlewareManifestSource("getMiddlewareManifest(){return this.minimalMode}"),
    /expected one unsafe runtime implementation/,
  );
});

test("Cloudflare web deploy requires explicit staging approval and an exact candidate digest", () => {
  const digest = "a".repeat(64);
  assert.deepEqual(
    cloudflareWebDeploy.validateWebDeployAuthorization({
      apply: false,
      confirmStagingDeploy: false,
      providedDigest: "",
      recordedDigest: digest,
      currentDigest: digest,
    }),
    { ok: true, mode: "plan-only", errors: [] },
  );

  const unconfirmed = cloudflareWebDeploy.validateWebDeployAuthorization({
    apply: true,
    confirmStagingDeploy: false,
    providedDigest: "",
    recordedDigest: digest,
    currentDigest: digest,
  });
  assert.equal(unconfirmed.ok, false);
  assert.ok(unconfirmed.errors.some((error: { code: string }) => error.code === "STAGING_DEPLOY_CONFIRMATION_REQUIRED"));
  assert.ok(unconfirmed.errors.some((error: { code: string }) => error.code === "CANDIDATE_DIGEST_REQUIRED"));

  const drifted = cloudflareWebDeploy.validateWebDeployAuthorization({
    apply: true,
    confirmStagingDeploy: true,
    providedDigest: digest,
    recordedDigest: digest,
    currentDigest: "b".repeat(64),
  });
  assert.equal(drifted.ok, false);
  assert.ok(drifted.errors.some((error: { code: string }) => error.code === "CANDIDATE_SOURCE_DRIFT"));

  const wrongConfirmation = cloudflareWebDeploy.validateWebDeployAuthorization({
    apply: true,
    confirmStagingDeploy: true,
    providedDigest: "c".repeat(64),
    recordedDigest: digest,
    currentDigest: digest,
  });
  assert.equal(wrongConfirmation.ok, false);
  assert.ok(wrongConfirmation.errors.some((error: { code: string }) => error.code === "CANDIDATE_DIGEST_CONFIRMATION_MISMATCH"));

  assert.deepEqual(
    cloudflareWebDeploy.validateWebDeployAuthorization({
      apply: true,
      confirmStagingDeploy: true,
      providedDigest: digest,
      recordedDigest: digest,
      currentDigest: digest,
    }),
    { ok: true, mode: "apply", errors: [] },
  );
});

test("Cloudflare resource preflight rejects a missing native photo rate limiter", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-rate-limit-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    const config = createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" });
    config.env.staging.ratelimits = config.env.staging.ratelimits.filter((binding) => binding.name !== "PHOTO_WRITE_RATE_LIMITER");
    writeFileSync(configPath, JSON.stringify(config), "utf8");

    try {
      execFileSync(process.execPath, [new URL("../scripts/cloudflare-resource-preflight.mjs", import.meta.url).pathname, "--config", configPath, "--env", "staging"], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("preflight should reject a missing native photo write limiter");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      assert.match(stdout, /PHOTO_WRITE_RATE_LIMITER binding is missing/);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare resource preflight rejects a hidden Images binding while transforms are disabled", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-images-cost-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    const config = createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" });
    Object.assign(config.env.staging, { images: { binding: "IMAGES" } });
    writeFileSync(configPath, JSON.stringify(config), "utf8");

    try {
      execFileSync(process.execPath, [new URL("../scripts/cloudflare-resource-preflight.mjs", import.meta.url).pathname, "--config", configPath, "--env", "staging"], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("preflight should reject a hidden metered Images binding");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      assert.match(stdout, /Remove the Cloudflare Images binding/);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare resource preflight rejects enabled photo uploads without server pixel reencoding", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-photo-processing-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    const config = createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" });
    config.env.staging.vars.PHOTO_UPLOADS_ENABLED = "true";
    writeFileSync(configPath, JSON.stringify(config), "utf8");

    try {
      execFileSync(process.execPath, [new URL("../scripts/cloudflare-resource-preflight.mjs", import.meta.url).pathname, "--config", configPath, "--env", "staging"], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("preflight should reject photo writes without server pixel reencoding");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      assert.match(stdout, /Enabled photo uploads require the approved server pixel-reencode path/);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare resource preflight rejects photo ceilings above the free-plan envelope", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-photo-free-envelope-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    const config = createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" });
    config.env.staging.vars.PHOTO_GLOBAL_DAILY_LIMIT = "151";
    config.env.staging.vars.PHOTO_GLOBAL_MONTHLY_LIMIT = "4501";
    config.env.staging.vars.PHOTO_GLOBAL_STORED_LIMIT = "9001";
    writeFileSync(configPath, JSON.stringify(config), "utf8");

    try {
      execFileSync(process.execPath, [new URL("../scripts/cloudflare-resource-preflight.mjs", import.meta.url).pathname, "--config", configPath, "--env", "staging"], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("preflight should reject photo ceilings above the approved free envelope");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      assert.match(stdout, /PHOTO_GLOBAL_DAILY_LIMIT must be an integer string between 1 and 150/);
      assert.match(stdout, /PHOTO_GLOBAL_MONTHLY_LIMIT must be an integer string between 1 and 4500/);
      assert.match(stdout, /PHOTO_GLOBAL_STORED_LIMIT must be an integer string between 1 and 9000/);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare resource preflight rejects placeholder staging resource ids", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-placeholder-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "TODO_STAGING_D1_DATABASE_ID", stagingKvId: "TODO_STAGING_KV_NAMESPACE_ID" })), "utf8");

    try {
      execFileSync(process.execPath, [new URL("../scripts/cloudflare-resource-preflight.mjs", import.meta.url).pathname, "--config", configPath, "--env", "staging"], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("preflight should reject placeholder resource ids");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      assert.match(stdout, /TODO_STAGING_D1_DATABASE_ID/);
      assert.match(stdout, /TODO_STAGING_KV_NAMESPACE_ID/);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare resource preflight rejects missing or unsafe deployment URLs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-url-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" })), "utf8");

    try {
      execFileSync(process.execPath, [new URL("../scripts/cloudflare-resource-preflight.mjs", import.meta.url).pathname, "--config", configPath, "--env", "staging"], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv({
          SILSIGAN_STAGING_PAGES_URL: "http://user:pass@localhost:3000?token=leak#debug",
          SILSIGAN_STAGING_API_BASE_URL: "",
        }),
        stdio: "pipe",
      });
      assert.fail("preflight should reject missing or unsafe deployment URLs");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as { ok: boolean; checks: Array<{ name: string; status: string; message: string }> };

      assert.equal(payload.ok, false);
      assert.ok(payload.checks.some((check) => check.name === "staging.pages.url" && check.status === "fail" && check.message.includes("https")));
      assert.ok(payload.checks.some((check) => check.name === "staging.pages.url" && check.status === "fail" && check.message.includes("credentials")));
      assert.ok(payload.checks.some((check) => check.name === "staging.pages.url" && check.status === "fail" && check.message.includes("query")));
      assert.ok(payload.checks.some((check) => check.name === "staging.pages.url" && check.status === "fail" && check.message.includes("localhost")));
      assert.ok(payload.checks.some((check) => check.name === "staging.worker_api.url" && check.status === "fail" && check.message.includes("non-empty")));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare resource preflight rejects identical staging and production deployment URLs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-duplicate-url-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" })), "utf8");

    try {
      execFileSync(process.execPath, [new URL("../scripts/cloudflare-resource-preflight.mjs", import.meta.url).pathname, "--config", configPath], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv({
          SILSIGAN_PRODUCTION_PAGES_URL: "https://silsigan-staging.pages.dev",
          SILSIGAN_PRODUCTION_API_BASE_URL: "https://silsigan-api-staging.workers.dev",
        }),
        stdio: "pipe",
      });
      assert.fail("preflight should reject identical staging and production deployment URLs");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as { ok: boolean; checks: Array<{ name: string; status: string; message: string }> };

      assert.equal(payload.ok, false);
      assert.ok(payload.checks.some((check) => check.name === "deployment_urls.staging.pages.production.pages" && check.status === "fail"));
      assert.ok(payload.checks.some((check) => check.name === "deployment_urls.staging.worker_api.production.worker_api" && check.status === "fail"));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check separates ready fixtures from external release blockers", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-release-state-"));
  try {
    const readyConfigPath = join(tempDir, "ready-wrangler.jsonc");
    const blockedConfigPath = join(tempDir, "blocked-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const externalStateReportPath = join(tempDir, "cloudflare-external-state.json");
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    const realDeviceQaPath = join(tempDir, "real-device-qa.md");
    const privacyPagePath = join(tempDir, "privacy-page.tsx");
    const supportPagePath = join(tempDir, "support-page.tsx");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    writeFileSync(
      readyConfigPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeFileSync(
      blockedConfigPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "TODO_STAGING_D1_DATABASE_ID",
          stagingKvId: "TODO_STAGING_KV_NAMESPACE_ID",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);
    writeRealDeviceQaLedger(realDeviceQaPath);
    writePublicPolicySupportPages(privacyPagePath, supportPagePath);
    writeFileSync(
      externalStateReportPath,
      [
        JSON.stringify(
          {
            ok: false,
            checks: [
              {
                name: "cloudflare.r2.enabled",
                status: "fail",
                code: "R2_NOT_ENABLED",
                message: "Cloudflare account R2 is not enabled. Enable R2 in the Cloudflare Dashboard before Worker deploy and staging photo smoke.",
              },
              {
                name: "deployment_url.production.pages",
                status: "fail",
                code: "DEPLOYMENT_URL_REQUIRED",
                message: "SILSIGAN_PRODUCTION_PAGES_URL is required.",
              },
              {
                name: "cloudflare.d1.production.migration_0012",
                status: "fail",
                code: "D1_0012_NOT_APPLIED",
                message: "Remote production D1 is missing the V2 cost-abuse guard and nationwide-region migrations.",
              },
            ],
                blockers: ["R2_NOT_ENABLED", "deployment_url.production.pages", "D1_0012_NOT_APPLIED"],
          },
          null,
          2,
        ),
        "pnpm failure footer should be ignored after JSON",
      ].join("\n"),
      "utf8",
    );

    const releaseStateScript = new URL("../scripts/release-state-check.mjs", import.meta.url).pathname;
    const readyOutput = execFileSync(process.execPath, [
      releaseStateScript,
      `--config=${readyConfigPath}`,
      `--ledger=${ledgerPath}`,
      `--release-ledger=${releaseLedgerPath}`,
      `--release-status=${releaseStatusPath}`,
      `--ugc-runbook=${ugcRunbookPath}`,
      `--cost-usage-runbook=${costUsageRunbookPath}`,
      `--review-notes=${testFlightReviewNotesPath}`,
      `--real-device-qa=${realDeviceQaPath}`,
      `--privacy-page=${privacyPagePath}`,
      `--support-page=${supportPagePath}`,
    ], {
      encoding: "utf8",
      env: createReadyPreflightProcessEnv(),
    });
    const readyPayload = JSON.parse(readyOutput) as {
      ok: boolean;
      state: string;
      blockers: string[];
      checks: Array<{ name: string; status: string }>;
    };
    assert.equal(readyPayload.ok, true);
    assert.equal(readyPayload.state, "ready-for-staging-evidence");
    assert.deepEqual(readyPayload.blockers, []);
    assert.ok(readyPayload.checks.some((check) => check.name === "legacy.supabase_artifacts" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "legacy.vercel_config" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "legacy.supabase_dependencies" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "legacy.vercel_public_urls" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "release_harness.ledger" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "release_harness.status" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "release_harness.ledger.source_of_truth" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "release_harness.status.source_of_truth" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "ugc_moderation.runbook" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "ugc_moderation.runbook.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "cloudflare_cost_usage.runbook" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "cloudflare_cost_usage.runbook.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "cloudflare_operator_packet.doc" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "cloudflare_operator_packet.doc.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "testflight_review_notes.doc" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "testflight_review_notes.doc.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "real_device_qa.ledger" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "real_device_qa.ledger.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "v2_legal_operations_gate.doc" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "v2_legal_operations_gate.doc.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "public_policy_page.privacy" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "public_policy_page.privacy.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "public_policy_page.support" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "public_policy_page.support.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "policy_url.privacy_policy" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "policy_url.support" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "policy_url.privacy_policy.support" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "deployment_url.staging.pages.public_site_url_origin" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "deployment_url.production.pages.public_site_url_origin" && check.status === "pass"));

    try {
      execFileSync(process.execPath, [
        releaseStateScript,
        `--config=${blockedConfigPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        `--real-device-qa=${realDeviceQaPath}`,
        `--privacy-page=${privacyPagePath}`,
        `--support-page=${supportPagePath}`,
        `--cloudflare-external-state-report=${externalStateReportPath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv({
          SILSIGAN_STAGING_API_BASE_URL: "",
        }),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when external blockers remain");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const blockedPayload = JSON.parse(stdout) as { ok: boolean; state: string; blockers: string[] };
      assert.equal(blockedPayload.ok, false);
      assert.equal(blockedPayload.state, "blocked-external");
      assert.ok(blockedPayload.blockers.includes("staging.d1.DB.database_id"));
      assert.ok(blockedPayload.blockers.includes("staging.kv.CACHE.id"));
      assert.ok(blockedPayload.blockers.includes("deployment_url.staging.worker_api"));
      assert.ok(blockedPayload.blockers.includes("R2_NOT_ENABLED"));
      assert.ok(blockedPayload.blockers.includes("deployment_url.production.pages"));
      assert.ok(blockedPayload.blockers.includes("D1_0012_NOT_APPLIED"));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check blocks missing or mismatched Worker CORS and share origins", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-release-cors-state-"));
  try {
    const configPath = join(tempDir, "cors-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    const realDeviceQaPath = join(tempDir, "real-device-qa.md");
    const privacyPagePath = join(tempDir, "privacy-page.tsx");
    const supportPagePath = join(tempDir, "support-page.tsx");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    const config = createPreflightConfig({
      stagingD1Id: "d1-staging-ready-id",
      stagingKvId: "kv-staging-ready-id",
    });
    config.env.staging.vars.CORS_ALLOWED_ORIGINS = "";
    config.env.staging.vars.PUBLIC_SITE_URL = "";
    config.env.production.vars.CORS_ALLOWED_ORIGINS = "https://wrong-origin.example";
    config.env.production.vars.PUBLIC_SITE_URL = "https://wrong-origin.example";
    writeFileSync(configPath, JSON.stringify(config), "utf8");
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);
    writeRealDeviceQaLedger(realDeviceQaPath);
    writePublicPolicySupportPages(privacyPagePath, supportPagePath);

    const releaseStateScript = new URL("../scripts/release-state-check.mjs", import.meta.url).pathname;
    try {
      execFileSync(
        process.execPath,
        [
          releaseStateScript,
          `--config=${configPath}`,
          `--ledger=${ledgerPath}`,
          `--release-ledger=${releaseLedgerPath}`,
          `--release-status=${releaseStatusPath}`,
          `--ugc-runbook=${ugcRunbookPath}`,
          `--cost-usage-runbook=${costUsageRunbookPath}`,
          `--review-notes=${testFlightReviewNotesPath}`,
          `--real-device-qa=${realDeviceQaPath}`,
          `--privacy-page=${privacyPagePath}`,
          `--support-page=${supportPagePath}`,
          "--strict",
        ],
        { encoding: "utf8", env: createReadyPreflightProcessEnv(), stdio: "pipe" },
      );
      assert.fail("strict release state should fail when Worker CORS origins are unsafe");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as { ok: boolean; state: string; blockers: string[] };
      assert.equal(payload.ok, false);
      assert.equal(payload.state, "blocked-external");
      assert.ok(payload.blockers.includes("wrangler.staging.vars.CORS_ALLOWED_ORIGINS"));
      assert.ok(payload.blockers.includes("wrangler.staging.vars.PUBLIC_SITE_URL"));
      assert.ok(payload.blockers.includes("deployment_url.production.pages.public_site_url_origin"));
      assert.ok(payload.blockers.includes("deployment_url.staging.pages.cors_origin"));
      assert.ok(payload.blockers.includes("deployment_url.production.pages.cors_origin"));
      assert.equal(stdout.includes("user:secret"), false);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check requires an operable UGC moderation runbook", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-ugc-runbook-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    const incompleteRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);
    writeFileSync(incompleteRunbookPath, "# #실시간 UGC moderation runbook\n\n## SLA\n\n12h only\n", "utf8");

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${incompleteRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when the UGC moderation runbook is incomplete");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; missingTokens?: string[] }>;
      };
      const tokenCheck = payload.checks.find((check) => check.name === "ugc_moderation.runbook.required_tokens");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("ugc_moderation.runbook.ownership"));
      assert.ok(payload.blockers.includes("ugc_moderation.runbook.required_tokens"));
      assert.equal(tokenCheck?.status, "fail");
      assert.ok(tokenCheck?.missingTokens?.includes("MODERATION_ALERT_WEBHOOK_URL"));
      assert.ok(tokenCheck?.missingTokens?.includes("photo"));
      assert.ok(tokenCheck?.missingTokens?.includes("restrict"));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check requires an operable Cloudflare cost and usage runbook", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-cost-usage-runbook-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const incompleteRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);
    writeFileSync(incompleteRunbookPath, "# #실시간 Cloudflare cost and usage runbook\n\n## Dashboard Checks\n\nR2 only\n", "utf8");

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${incompleteRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when the Cloudflare cost and usage runbook is incomplete");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; missingTokens?: string[] }>;
      };
      const tokenCheck = payload.checks.find((check) => check.name === "cloudflare_cost_usage.runbook.required_tokens");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("cloudflare_cost_usage.runbook.ownership"));
      assert.ok(payload.blockers.includes("cloudflare_cost_usage.runbook.required_tokens"));
      assert.equal(tokenCheck?.status, "fail");
      assert.ok(tokenCheck?.missingTokens?.includes("Usage & billing"));
      assert.ok(tokenCheck?.missingTokens?.includes("Billing alerts"));
      assert.ok(tokenCheck?.missingTokens?.includes("TestFlight"));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check requires operable TestFlight review notes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-testflight-review-notes-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const incompleteNotesPath = join(tempDir, "testflight-review-notes.md");
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeFileSync(incompleteNotesPath, "# #실시간 TestFlight review notes\n\n## Permissions\n\nTestFlight only\n", "utf8");

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${incompleteNotesPath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when the TestFlight review notes are incomplete");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; missingTokens?: string[] }>;
      };
      const tokenCheck = payload.checks.find((check) => check.name === "testflight_review_notes.doc.required_tokens");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("testflight_review_notes.doc.beta_app_description"));
      assert.ok(payload.blockers.includes("testflight_review_notes.doc.required_tokens"));
      assert.equal(tokenCheck?.status, "fail");
      assert.ok(tokenCheck?.missingTokens?.includes("SILSIGAN_STAGING_PAGES_URL"));
      assert.ok(tokenCheck?.missingTokens?.includes("privacy policy URL"));
      assert.ok(tokenCheck?.missingTokens?.includes("UGC moderation"));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check requires an operable real-device QA ledger", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-real-device-qa-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    const incompleteRealDeviceQaPath = join(tempDir, "real-device-qa.md");
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);
    writeFileSync(incompleteRealDeviceQaPath, "# #실시간 real-device QA ledger\n\n## Scope\n\niPhone only\n", "utf8");

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        `--real-device-qa=${incompleteRealDeviceQaPath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when the real-device QA ledger is incomplete");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; missingTokens?: string[] }>;
      };
      const tokenCheck = payload.checks.find((check) => check.name === "real_device_qa.ledger.required_tokens");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("real_device_qa.ledger.environment"));
      assert.ok(payload.blockers.includes("real_device_qa.ledger.required_tokens"));
      assert.equal(tokenCheck?.status, "fail");
      assert.ok(tokenCheck?.missingTokens?.includes("Staging Pages URL"));
      assert.ok(tokenCheck?.missingTokens?.includes("Android internal/debug build"));
      assert.ok(tokenCheck?.missingTokens?.includes("Photo upload/preview"));
      assert.ok(tokenCheck?.missingTokens?.includes("network-redacted.json"));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check requires public privacy and support pages", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-public-policy-pages-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    const realDeviceQaPath = join(tempDir, "real-device-qa.md");
    const incompletePrivacyPagePath = join(tempDir, "privacy-page.tsx");
    const incompleteSupportPagePath = join(tempDir, "support-page.tsx");
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);
    writeRealDeviceQaLedger(realDeviceQaPath);
    writeFileSync(incompletePrivacyPagePath, "export default function Privacy(){return <main>개인정보 처리방침</main>;}", "utf8");
    writeFileSync(incompleteSupportPagePath, "export default function Support(){return <main>지원 및 신고 안내</main>;}", "utf8");

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        `--real-device-qa=${realDeviceQaPath}`,
        `--privacy-page=${incompletePrivacyPagePath}`,
        `--support-page=${incompleteSupportPagePath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when public privacy/support pages are incomplete");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; missingTokens?: string[] }>;
      };
      const privacyTokenCheck = payload.checks.find((check) => check.name === "public_policy_page.privacy.required_tokens");
      const supportTokenCheck = payload.checks.find((check) => check.name === "public_policy_page.support.required_tokens");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("public_policy_page.privacy.required_tokens"));
      assert.ok(payload.blockers.includes("public_policy_page.support.required_tokens"));
      assert.equal(privacyTokenCheck?.status, "fail");
      assert.equal(supportTokenCheck?.status, "fail");
      assert.ok(privacyTokenCheck?.missingTokens?.includes("raw coordinate"));
      assert.ok(privacyTokenCheck?.missingTokens?.includes("Cloudflare D1"));
      assert.ok(supportTokenCheck?.missingTokens?.includes("TestFlight"));
      assert.ok(supportTokenCheck?.missingTokens?.includes("privacy_face"));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check requires final privacy and support URLs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-policy-support-urls-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv({
          SILSIGAN_PRIVACY_POLICY_URL: "",
          SILSIGAN_SUPPORT_URL: "http://localhost:3000/support?debug=1",
        }),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when privacy/support URLs are missing or unsafe");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; message: string }>;
      };
      const supportChecks = payload.checks.filter((check) => check.name === "policy_url.support");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("policy_url.privacy_policy"));
      assert.ok(payload.blockers.includes("policy_url.support"));
      assert.ok(payload.checks.some((check) => check.name === "policy_url.privacy_policy" && check.status === "fail" && check.message.includes("SILSIGAN_PRIVACY_POLICY_URL")));
      assert.ok(supportChecks.some((check) => check.status === "fail" && check.message.includes("https")));
      assert.ok(supportChecks.some((check) => check.status === "fail" && check.message.includes("query")));
      assert.ok(supportChecks.some((check) => check.status === "fail" && check.message.includes("localhost")));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check requires release harness ledger and status docs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-release-harness-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${join(tempDir, "missing-release-ledger.yaml")}`,
        `--release-status=${join(tempDir, "missing-RELEASE_STATUS.md")}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when release harness docs are missing");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as { ok: boolean; blockers: string[] };

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("release_harness.ledger"));
      assert.ok(payload.blockers.includes("release_harness.status"));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check blocks on open release harness blockers", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-release-harness-open-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath, { openBlocker: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail while the release harness has open blockers");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; blockers?: string[] }>;
      };
      const openBlockerCheck = payload.checks.find((check) => check.name === "release_harness.ledger.open_blockers");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("release_harness.ledger.open_blockers"));
      assert.equal(openBlockerCheck?.status, "fail");
      assert.deepEqual(openBlockerCheck?.blockers, ["P0-SILSIGAN-R2-DASHBOARD"]);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check rejects release status missing open blocker evidence", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-release-harness-evidence-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath, {
      omitOpenBlockerEvidenceFromStatus: true,
      openBlocker: true,
    });
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when release status omits open blocker evidence");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; missingEvidence?: string[] }>;
      };
      const evidenceCheck = payload.checks.find((check) => check.name === "release_harness.status.open_blocker_evidence");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("release_harness.status.open_blocker_evidence"));
      assert.equal(evidenceCheck?.status, "fail");
      assert.deepEqual(evidenceCheck?.missingEvidence, ["R2_NOT_ENABLED"]);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check rejects duplicated next action runbook lines", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-release-next-actions-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath, { duplicateNextActionLine: true });
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when next actions repeat an operator instruction");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; duplicates?: string[] }>;
      };
      const duplicateCheck = payload.checks.find((check) => check.name === "ledger.next_actions.duplicate_lines");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("ledger.next_actions.duplicate_lines"));
      assert.equal(duplicateCheck?.status, "fail");
      assert.deepEqual(duplicateCheck?.duplicates, ["R2 check passes before staging Worker/Pages URL smoke can begin."]);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check rejects legacy Supabase and Vercel artifacts", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-release-state-legacy-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    const ledgerPath = join(tempDir, "release.md");
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    writeFileSync(
      configPath,
      JSON.stringify(
        createPreflightConfig({
          stagingD1Id: "d1-staging-ready-id",
          stagingKvId: "kv-staging-ready-id",
        }),
      ),
      "utf8",
    );
    writeReleaseStateLedger(ledgerPath);
    writeUgcModerationRunbook(ugcRunbookPath);
    writeCloudflareCostUsageRunbook(costUsageRunbookPath);
    writeTestFlightReviewNotes(testFlightReviewNotesPath);
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { "@supabase/supabase-js": "2.0.0" } }), "utf8");
    mkdirSync(join(tempDir, "supabase"));
    mkdirSync(join(tempDir, "src/lib"), { recursive: true });
    writeFileSync(join(tempDir, "vercel.json"), "{}", "utf8");
    writeFileSync(join(tempDir, ".env.local"), 'NEXT_PUBLIC_SITE_URL="https://silsigan.vercel.app"', "utf8");
    writeFileSync(join(tempDir, "src/lib/site-url.ts"), "export const site = 'https://silsigan.vercel.app';", "utf8");

    try {
      execFileSync(process.execPath, [
        new URL("../scripts/release-state-check.mjs", import.meta.url).pathname,
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        "--strict",
      ], {
        cwd: tempDir,
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when legacy artifacts are present");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as { ok: boolean; blockers: string[] };

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("legacy.supabase_artifacts"));
      assert.ok(payload.blockers.includes("legacy.vercel_config"));
      assert.ok(payload.blockers.includes("legacy.supabase_dependencies"));
      assert.ok(payload.blockers.includes("legacy.vercel_public_urls"));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare tail redaction smoke accepts redacted captured logs", () => {
  const output = execFileSync(process.execPath, [new URL("../scripts/cloudflare-staging-smoke.mjs", import.meta.url).pathname, "--tail-only", "--tail-file=tests/fixtures/redacted-worker-tail.log"], {
    encoding: "utf8",
  });
  const payload = JSON.parse(output) as { baseUrl: string | null; ok: boolean; checks: Array<{ name: string; status: string }> };

  assert.equal(payload.ok, true);
  assert.equal(payload.baseUrl, null);
  assert.deepEqual(payload.checks, [
    {
      name: "tail.redaction",
      status: "pass",
      message: "captured tail log에서 raw token/coordinate/anon id/original filename 패턴이 발견되지 않았습니다.",
      file: "tests/fixtures/redacted-worker-tail.log",
    },
  ]);
});

test("Cloudflare staging smoke requires API base URL unless running tail-only", () => {
  try {
    execFileSync(process.execPath, [new URL("../scripts/cloudflare-staging-smoke.mjs", import.meta.url).pathname], {
      encoding: "utf8",
      env: {
        ...process.env,
        NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL: "",
        SILSIGAN_STAGING_API_BASE_URL: "",
        SILSIGAN_STAGING_TAIL_LOG_FILE: "",
      },
      stdio: "pipe",
    });
    assert.fail("staging smoke should fail without a Worker API base URL");
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
    const payload = JSON.parse(stdout) as { baseUrl: string | null; ok: boolean; checks: Array<{ name: string; status: string; message: string }> };

    assert.equal(payload.ok, false);
    assert.equal(payload.baseUrl, null);
    assert.ok(payload.checks.some((check) => check.name === "tail.redaction" && check.status === "skip"));
    assert.ok(
      payload.checks.some(
        (check) =>
          check.name === "harness" &&
          check.status === "fail" &&
          check.message.includes("SILSIGAN_STAGING_API_BASE_URL 또는 NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL"),
      ),
    );
  }
});

test("Cloudflare staging smoke can require admin evidence before mutating checks", () => {
  try {
    execFileSync(process.execPath, [new URL("../scripts/cloudflare-staging-smoke.mjs", import.meta.url).pathname, "--mutating", "--require-admin"], {
      encoding: "utf8",
      env: {
        ...process.env,
        NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL: "",
        SILSIGAN_STAGING_ADMIN_TOKEN: "",
        SILSIGAN_STAGING_API_BASE_URL: "",
        SILSIGAN_STAGING_TAIL_LOG_FILE: "",
      },
      stdio: "pipe",
    });
    assert.fail("staging mutation smoke should fail when admin evidence is required without an admin token");
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
    const payload = JSON.parse(stdout) as { ok: boolean; checks: Array<{ name: string; status: string; message: string }> };

    assert.equal(payload.ok, false);
    assert.ok(
      payload.checks.some(
        (check) =>
          check.name === "harness" &&
          check.status === "fail" &&
          check.message.includes("ADMIN_TOKEN_REQUIRED"),
      ),
    );
  }
});

test("Cloudflare tail redaction smoke rejects raw secrets coordinates anonymous ids and filenames", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-tail-redaction-"));
  try {
    const logPath = join(tempDir, "leaky-tail.log");
    writeFileSync(
      logPath,
      JSON.stringify({
        message: "leaky staging request",
        authorization: "Bearer raw-token-value-forbidden",
        admin: "x-silsigan-admin-token: raw-admin-token",
        anonymousId: "anon_leaky_user_12345",
        email: "leaky@example.com",
        latitude: 35.15321,
        longitude: 129.11861,
        originalFilename: "real-camera-name.jpg",
      }),
      "utf8",
    );

    try {
      execFileSync(process.execPath, [new URL("../scripts/cloudflare-staging-smoke.mjs", import.meta.url).pathname, "--tail-only", `--tail-file=${logPath}`], {
        encoding: "utf8",
        stdio: "pipe",
      });
      assert.fail("tail redaction smoke should reject raw sensitive log values");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as { ok: boolean; checks: Array<{ details?: unknown; findings?: string[]; status: string }> };

      assert.equal(payload.ok, false);
      assert.equal(payload.checks.some((check) => check.status === "fail"), true);
      assert.deepEqual(new Set(payload.checks.flatMap((check) => check.findings ?? [])), new Set(["admin_token_header", "bearer_token", "anonymous_id", "email", "raw_latitude", "raw_longitude", "original_filename"]));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare Pages browser smoke helpers parse args and redact URLs", () => {
  const parsed = pagesSmoke.parseArgs([
    "--pages-url=https://user:pass@silsigan-staging.pages.dev?token=secret#debug",
    "--api-base-url=https://api.example.test",
    "--field-report-photo-file=/tmp/synthetic-field-report.jpg",
    "--mutating",
  ]);

  assert.equal(parsed.flags.has("mutating"), true);
  assert.equal(parsed.options.get("api-base-url"), "https://api.example.test");
  assert.equal(parsed.options.get("field-report-photo-file"), "/tmp/synthetic-field-report.jpg");
  assert.equal(pagesSmoke.sanitizeUrl(parsed.options.get("pages-url")), "https://silsigan-staging.pages.dev/");
});

test("Cloudflare Pages browser smoke retries a hit-test until the transitioned button is clickable", async () => {
  let runtimeEvaluateCalls = 0;
  const mouseEvents: string[] = [];
  const client = {
    async send(method: string) {
      if (method === "Runtime.evaluate") {
        runtimeEvaluateCalls += 1;
        return {
          result: {
            value: runtimeEvaluateCalls === 1 ? null : { x: 339, y: 796 },
          },
        };
      }
      if (method === "Input.dispatchMouseEvent") {
        mouseEvents.push(method);
      }
      return {};
    },
  };

  await pagesSmoke.clickHitTestedTextButton(client, "마이", { exact: true, timeoutMs: 500 });

  assert.equal(runtimeEvaluateCalls, 2);
  assert.deepEqual(mouseEvents, ["Input.dispatchMouseEvent", "Input.dispatchMouseEvent"]);
});

test("Cloudflare Pages browser smoke accepts current and deployed map search labels", async () => {
  let evaluatedExpression = "";
  const client = {
    async send(method: string, params: { expression?: string }) {
      if (method === "Runtime.evaluate") {
        evaluatedExpression = params.expression ?? "";
        return { result: { value: true } };
      }
      return {};
    },
  };

  await pagesSmoke.fillSearchInput(client, ["사진 올라온 장소 검색", "지도 장소 검색"], "광안리");

  assert.match(evaluatedExpression, /사진 올라온 장소 검색/);
  assert.match(evaluatedExpression, /지도 장소 검색/);
});

test("Cloudflare Pages browser smoke maps configured region IDs to visible tabs", () => {
  assert.equal(pagesSmoke.regionLabelForId("busan"), "부산");
  assert.equal(pagesSmoke.regionLabelForId("nationwide"), "전국");
  assert.equal(pagesSmoke.regionLabelForId("unknown-region"), null);
});

test("Cloudflare Pages browser smoke matches Worker API requests by parsed path and query", () => {
  const events = [
    { type: "request", method: "GET", url: "https://api.example.test/api/places?regionId=busan&limit=100" },
    { type: "request", method: "GET", url: "https://api.example.test/api/places?q=%EA%B4%91%EC%95%88%EB%A6%AC&limit=100" },
    { type: "request", method: "GET", url: "https://api.example.test/api/photos?placeId=busan-gwangalli&limit=6" },
    { type: "request", method: "GET", url: "https://api.example.test/api/realtime/place/busan-gwangalli" },
    { type: "request", method: "GET", url: "https://api.example.test/api/realtime/region/busan" },
    { type: "request", method: "GET", url: "https://api.example.test/api/realtime/global" },
    { type: "request", method: "POST", url: "https://api.example.test/api/places/busan-gwangalli/click" },
    { type: "request", method: "POST", url: "https://api.example.test/api/moderation/reports", reportTargetType: "comment" },
    { type: "request", method: "GET", url: "https://other.example.test/api/places?regionId=busan" },
  ];

  assert.equal(pagesSmoke.hasApiRequest(events, "https://api.example.test", "/api/places"), true);
  assert.equal(pagesSmoke.hasApiRequest(events, "https://api.example.test", "/api/places/busan-gwangalli"), false);
  assert.equal(pagesSmoke.hasApiRequest(events, "https://api.example.test", "/api/places/busan-gwangalli/click", "POST"), true);
  assert.equal(pagesSmoke.hasApiRequestWithSearchParam(events, "https://api.example.test", "/api/places", "GET", "q", "광안리"), true);
  assert.equal(pagesSmoke.hasApiRequestWithSearchParam(events, "https://api.example.test", "/api/photos", "GET", "placeId", "busan-gwangalli"), true);
  assert.equal(pagesSmoke.hasApiRequestWithSearchParam(events, "https://api.example.test", "/api/photos", "GET", "placeId", "seoul-yeouido"), false);
  assert.equal(pagesSmoke.hasApiRequest(events, "https://api.example.test", "/api/realtime/place/busan-gwangalli"), true);
  assert.equal(pagesSmoke.hasApiRequest(events, "https://api.example.test", "/api/realtime/region/busan"), true);
  assert.equal(pagesSmoke.hasApiRequest(events, "https://api.example.test", "/api/realtime/global"), true);
  assert.equal(pagesSmoke.hasApiReportRequest(events, "https://api.example.test", "comment"), true);
  assert.equal(pagesSmoke.hasApiReportRequest(events, "https://api.example.test", "photo"), false);
});

test("local Pages report smoke validates redacted network artifacts and required UI checks", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-pages-artifact-"));
  try {
    const safePath = join(tempDir, "safe-network.json");
    writeFileSync(
      safePath,
      JSON.stringify([
        { type: "request", method: "POST", url: "https://api.example.test/api/moderation/reports", reportTargetType: "place" },
        { type: "request", method: "POST", url: "https://api.example.test/api/moderation/reports", reportTargetType: "comment" },
        { type: "request", method: "POST", url: "https://api.example.test/api/moderation/reports", reportTargetType: "photo" },
      ]),
      "utf8",
    );
    const safe = await pagesLocalReportSmoke.validateNetworkArtifactRedaction(safePath, {
      requiredReportTargetTypes: ["place", "comment", "photo"],
    });

    assert.deepEqual(safe, {
      eventCount: 3,
      reportTargetTypes: ["comment", "photo", "place"],
      storesPostData: false,
      sensitiveHits: [],
      notFoundCount: 0,
    });

    assert.deepEqual(pagesLocalReportSmoke.validateConsoleMessages(["console.info: smoke ok"]), { errorWarnCount: 0 });
    assert.throws(
      () => pagesLocalReportSmoke.validateConsoleMessages(["log.error: Failed to load resource"]),
      /console error\/warning/,
    );

    const unsafePostDataPath = join(tempDir, "unsafe-post-data.json");
    writeFileSync(
      unsafePostDataPath,
      JSON.stringify([{ type: "request", method: "POST", url: "https://api.example.test/api/moderation/reports", postData: "{\"note\":\"browser smoke comment\"}" }]),
      "utf8",
    );
    await assert.rejects(
      () => pagesLocalReportSmoke.validateNetworkArtifactRedaction(unsafePostDataPath),
      /postData/,
    );

    const unsafeSensitivePath = join(tempDir, "unsafe-sensitive.json");
    writeFileSync(
      unsafeSensitivePath,
      JSON.stringify([{ type: "request", method: "POST", url: "https://api.example.test/api/moderation/reports", note: "사진 신고: 1KB 현장 사진" }]),
      "utf8",
    );
    await assert.rejects(
      () => pagesLocalReportSmoke.validateNetworkArtifactRedaction(unsafeSensitivePath),
      /sensitive values/,
    );

    const unsafeNotFoundPath = join(tempDir, "unsafe-not-found.json");
    writeFileSync(
      unsafeNotFoundPath,
      JSON.stringify([{ type: "response", status: 404, url: "https://api.example.test/api/blocks" }]),
      "utf8",
    );
    await assert.rejects(
      () => pagesLocalReportSmoke.validateNetworkArtifactRedaction(unsafeNotFoundPath),
      /HTTP 404/,
    );

    await assert.rejects(
      () => pagesLocalReportSmoke.validateNetworkArtifactRedaction(safePath, { requiredReportTargetTypes: ["place", "comment", "photo", "video"] }),
      /missing report target types: video/,
    );

    const requiredCheckNames = ["map.controlsUncovered", "layout.bottomNavOpaque", "map.trafficButton", "onboarding.dismiss", "reports.photoCreate"];
    const safeChecks = [
      { name: "map.controlsUncovered", status: "pass" },
      { name: "layout.bottomNavOpaque", status: "pass" },
      { name: "map.trafficButton", status: "pass" },
      { name: "onboarding.dismiss", status: "pass" },
      { name: "reports.photoCreate", status: "pass" },
      { name: "browser.mutation", status: "skip" },
    ];
    assert.deepEqual(
      pagesLocalReportSmoke.validateSmokeCheckIntegrity(safeChecks, { requiredCheckNames }),
      {
        passedRequiredChecks: requiredCheckNames,
        failedChecks: [],
      },
    );
    assert.throws(
      () => pagesLocalReportSmoke.validateSmokeCheckIntegrity(safeChecks.slice(1), { requiredCheckNames }),
      /map.controlsUncovered/,
    );
    assert.throws(
      () => pagesLocalReportSmoke.validateSmokeCheckIntegrity(safeChecks.filter((check) => check.name !== "onboarding.dismiss"), { requiredCheckNames }),
      /onboarding.dismiss/,
    );
    assert.throws(
      () => pagesLocalReportSmoke.validateSmokeCheckIntegrity([...safeChecks, { name: "map.requeryButton", status: "fail" }], { requiredCheckNames }),
      /map.requeryButton/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare release gate plan orders strict staging and browser evidence without leaking secret values", () => {
  const parsed = releaseGate.parseArgs(["--mutating", "--browser-report", "--require-photo", "--tail-file", "artifacts/cloudflare-tail/staging-tail.log"]);
  const plan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {
      SILSIGAN_STAGING_ADMIN_TOKEN: "super-secret-admin-token",
      SILSIGAN_WORKER_ADMIN_TOKEN: "super-secret-worker-token",
    },
  });

  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.steps.map((step: ReleaseGateStep) => step.name),
    [
      "verify.local",
      "workers.tail.redaction",
      "release.status.strict",
      "audit.critical",
      "frontend.typegen",
      "api.typegen",
      "frontend.openNextBuild",
      "frontend.wranglerDryRun.development",
      "frontend.wranglerDryRun.staging",
      "frontend.wranglerDryRun.production",
      "cloudflare.preflight",
      "cloudflare.r2Evidence.staging",
      "cloudflare.d1Evidence.staging",
      "cloudflare.r2Evidence.production",
      "cloudflare.d1Evidence.production",
      "cloudflare.externalState",
      "wrangler.dryRun.staging",
      "wrangler.dryRun.production",
      "staging.api.smoke",
      "pages.browser.smoke",
    ],
  );
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "cloudflare.r2Evidence.staging")?.args, [
    "cf:r2:evidence",
    "--",
    "--env=staging",
    "--check",
  ]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "cloudflare.d1Evidence.production")?.args, [
    "cf:d1:evidence",
    "--",
    "--env=production",
    "--check",
  ]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "staging.api.smoke")?.args, ["smoke:staging", "--", "--mutating", "--require-admin"]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "pages.browser.smoke")?.args, [
    "smoke:pages",
    "--",
    "--mutating",
    "--report",
    "--require-photo",
  ]);
  assert.equal(JSON.stringify(plan).includes("super-secret"), false);
});

test("Cloudflare release gate can run local Pages report baseline before external staging checks", () => {
  const parsed = releaseGate.parseArgs(["--local-pages-report", "--tail-file", "artifacts/cloudflare-tail/staging-tail.log"]);
  const plan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {
      SILSIGAN_WORKER_ADMIN_TOKEN: "super-secret-worker-token",
    },
  });

  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.steps.slice(0, 4).map((step: ReleaseGateStep) => step.name),
    ["verify.local", "pages.browser.localReportSmoke", "workers.tail.redaction", "release.status.strict"],
  );
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "pages.browser.localReportSmoke")?.args, [
    "smoke:pages:local-report",
    "--",
    "--timeout-ms=45000",
  ]);
  assert.equal(plan.steps.some((step: ReleaseGateStep) => step.name === "pages.browser.smoke"), true);
  assert.equal(plan.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_ADMIN_TOKEN_REQUIRED"), false);
  assert.equal(JSON.stringify(plan).includes("super-secret"), false);
});

test("Cloudflare release gate can collect non-mutating external blockers without enabling write smoke", () => {
  const collectPlan = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--collect-blockers", "--tail-file", "tests/fixtures/redacted-worker-tail.log"]).flags,
    options: releaseGate.parseArgs(["--collect-blockers", "--tail-file", "tests/fixtures/redacted-worker-tail.log"]).options,
    env: {},
  });

  assert.equal(collectPlan.ok, true);
  assert.equal(collectPlan.collectBlockers, true);
  assert.equal(collectPlan.mutating, false);
  assert.equal(collectPlan.steps.some((step: ReleaseGateStep) => step.name === "staging.api.smoke"), true);
  assert.deepEqual(collectPlan.steps.find((step: ReleaseGateStep) => step.name === "staging.api.smoke")?.args, ["smoke:staging"]);
  assert.deepEqual(collectPlan.steps.find((step: ReleaseGateStep) => step.name === "staging.api.smoke")?.envKeys, [
    "SILSIGAN_STAGING_API_BASE_URL",
  ]);
  assert.deepEqual(collectPlan.steps.find((step: ReleaseGateStep) => step.name === "pages.browser.smoke")?.envKeys, [
    "SILSIGAN_STAGING_PAGES_URL",
    "SILSIGAN_STAGING_API_BASE_URL",
  ]);

  const mutatingCollectPlan = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--collect-blockers", "--mutating"]).flags,
    env: {
      SILSIGAN_STAGING_ADMIN_TOKEN: "super-secret-admin-token",
    },
  });

  assert.equal(mutatingCollectPlan.ok, false);
  assert.ok(mutatingCollectPlan.errors.some((error: { code: string }) => error.code === "COLLECT_BLOCKERS_REQUIRES_NON_MUTATING"));
  assert.equal(JSON.stringify(mutatingCollectPlan).includes("super-secret"), false);
});

test("Cloudflare release gate release-candidate mode requires final staging evidence", () => {
  const parsed = releaseGate.parseArgs(["--release-candidate", "--tail-file", "tests/fixtures/redacted-worker-tail.log"]);
  const plan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {
      SILSIGAN_STAGING_ADMIN_TOKEN: "super-secret-admin-token",
      SILSIGAN_STAGING_PAGES_URL: "https://silsigan-staging.pages.dev",
      SILSIGAN_STAGING_API_BASE_URL: "https://silsigan-api-staging.workers.dev",
      NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "fixture-map-client-id",
      SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS: "https://silsigan-staging.pages.dev",
    },
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.releaseCandidate, true);
  assert.equal(plan.mutating, true);
  assert.equal(plan.browserReport, true);
  assert.equal(plan.requirePhoto, true);
  assert.equal(plan.tailRequired, true);
  assert.equal(plan.coordinateStatus, false);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "staging.api.smoke")?.args, [
    "smoke:staging",
    "--",
    "--mutating",
    "--require-admin",
  ]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "staging.api.smoke")?.envKeys, [
    "SILSIGAN_STAGING_API_BASE_URL",
    "SILSIGAN_STAGING_ADMIN_TOKEN",
  ]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "pages.browser.smoke")?.args, [
    "smoke:pages",
    "--",
    "--mutating",
    "--report",
    "--require-photo",
  ]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "pages.browser.smoke")?.envKeys, [
    "SILSIGAN_STAGING_PAGES_URL",
    "SILSIGAN_STAGING_API_BASE_URL",
  ]);
  assert.equal(JSON.stringify(plan).includes("super-secret"), false);

  const missingEvidencePlan = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--release-candidate"]).flags,
    env: {},
  });

  assert.equal(missingEvidencePlan.ok, false);
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "TAIL_FILE_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_ADMIN_TOKEN_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_PAGES_URL_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_API_BASE_URL_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "NEXT_PUBLIC_NAVER_MAP_CLIENT_ID_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS_REQUIRED"));

  const unsafeUrlPlan = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--release-candidate", "--tail-file", "tests/fixtures/redacted-worker-tail.log"]).flags,
    options: releaseGate.parseArgs(["--release-candidate", "--tail-file", "tests/fixtures/redacted-worker-tail.log"]).options,
    env: {
      SILSIGAN_STAGING_ADMIN_TOKEN: "super-secret-admin-token",
      SILSIGAN_STAGING_PAGES_URL: "http://localhost:3000",
      SILSIGAN_STAGING_API_BASE_URL: "not-a-url",
    },
  });

  assert.equal(unsafeUrlPlan.ok, false);
  assert.ok(unsafeUrlPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_PAGES_URL_INVALID"));
  assert.ok(unsafeUrlPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_API_BASE_URL_INVALID"));
  assert.equal(JSON.stringify(unsafeUrlPlan).includes("super-secret"), false);
  assert.equal(JSON.stringify(unsafeUrlPlan).includes("localhost:3000"), false);
});

test("Cloudflare release gate production-candidate mode requires production HTTPS URLs without write smoke", () => {
  const parsed = releaseGate.parseArgs(["--production-candidate"]);
  const plan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {
      SILSIGAN_PRODUCTION_PAGES_URL: "https://silsigan.pages.dev",
      SILSIGAN_PRODUCTION_API_BASE_URL: "https://silsigan-api.workers.dev",
      NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "fixture-map-client-id",
      SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS: "https://silsigan.pages.dev",
    },
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.productionCandidate, true);
  assert.equal(plan.releaseCandidate, false);
  assert.equal(plan.mutating, false);
  assert.equal(plan.browserReport, false);
  assert.equal(plan.requirePhoto, false);
  assert.equal(plan.tailRequired, false);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "staging.api.smoke")?.args, ["smoke:staging"]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "staging.api.smoke")?.envKeys, [
    "SILSIGAN_STAGING_API_BASE_URL",
  ]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "pages.browser.smoke")?.args, ["smoke:pages"]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "pages.browser.smoke")?.envKeys, [
    "SILSIGAN_STAGING_PAGES_URL",
    "SILSIGAN_STAGING_API_BASE_URL",
  ]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "production.api.smoke")?.args, ["smoke:staging"]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "production.api.smoke")?.envKeys, [
    "SILSIGAN_PRODUCTION_API_BASE_URL",
  ]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "production.pages.smoke")?.args, ["smoke:pages"]);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "production.pages.smoke")?.envKeys, [
    "SILSIGAN_PRODUCTION_PAGES_URL",
    "SILSIGAN_PRODUCTION_API_BASE_URL",
  ]);
  assert.equal(JSON.stringify(plan).includes("https://silsigan.pages.dev"), false);
  assert.equal(JSON.stringify(plan).includes("https://silsigan-api.workers.dev"), false);

  const missingUrlsPlan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {},
  });

  assert.equal(missingUrlsPlan.ok, false);
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_PRODUCTION_PAGES_URL_REQUIRED"));
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_PRODUCTION_API_BASE_URL_REQUIRED"));
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "NEXT_PUBLIC_NAVER_MAP_CLIENT_ID_REQUIRED"));
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED_REQUIRED"));
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS_REQUIRED"));
  assert.equal(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "TAIL_FILE_REQUIRED"), false);
  assert.equal(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_ADMIN_TOKEN_REQUIRED"), false);

  const originMismatchPlan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {
      SILSIGAN_PRODUCTION_PAGES_URL: "https://silsigan.pages.dev",
      SILSIGAN_PRODUCTION_API_BASE_URL: "https://silsigan-api.workers.dev",
      NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "fixture-map-client-id",
      SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS: "https://other.pages.dev",
    },
  });
  assert.equal(originMismatchPlan.ok, false);
  assert.ok(originMismatchPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS_MISSING_SILSIGAN_PRODUCTION_PAGES_URL"));

  const unsafeUrlPlan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {
      SILSIGAN_PRODUCTION_PAGES_URL: "http://localhost:3000",
      SILSIGAN_PRODUCTION_API_BASE_URL: "not-a-url",
      SILSIGAN_WORKER_ADMIN_TOKEN: "super-secret-worker-token",
    },
  });

  assert.equal(unsafeUrlPlan.ok, false);
  assert.ok(unsafeUrlPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_PRODUCTION_PAGES_URL_INVALID"));
  assert.ok(unsafeUrlPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_PRODUCTION_API_BASE_URL_INVALID"));
  assert.equal(JSON.stringify(unsafeUrlPlan).includes("localhost:3000"), false);
  assert.equal(JSON.stringify(unsafeUrlPlan).includes("not-a-url"), false);
  assert.equal(JSON.stringify(unsafeUrlPlan).includes("super-secret"), false);
});

test("Cloudflare release gate summarizes failed collect-blockers steps without secret values", () => {
  const summary = releaseGate.summarizeResults([
    { name: "workers.tail.redaction", status: "pass" },
    {
      name: "release.status.strict",
      status: "fail",
      blockers: ["release_harness.ledger.open_blockers"],
      outputTail: JSON.stringify({
        blockers: ["deployment_url.staging.pages", "deployment_url.staging.worker_api", "https://should-not-be-a-blocker.example"],
      }),
    },
    {
      name: "cloudflare.preflight",
      status: "fail",
      outputTail: `> silsigan@0.1.0 cf:preflight\n${JSON.stringify({
        checks: [
          { name: "deployment_url.staging.pages", status: "fail", message: "SILSIGAN_STAGING_PAGES_URL is missing." },
          { name: "deployment_url.production.worker_api", status: "fail", message: "SILSIGAN_PRODUCTION_API_BASE_URL is missing." },
        ],
      })}`,
    },
    {
      name: "cloudflare.externalState",
      status: "fail",
      outputTail: JSON.stringify({
        blockers: ["cloudflare.r2.enabled", "deployment_url.staging.pages"],
      }),
      errorTail: "SILSIGAN_STAGING_ADMIN_TOKEN=super-secret-admin-token",
    },
    {
      name: "pages.browser.smoke",
      status: "fail",
      outputTail: JSON.stringify({
        checks: [{ name: "harness", status: "fail", message: "SILSIGAN_STAGING_PAGES_URL 또는 --pages-url 이 필요합니다." }],
      }),
    },
  ]);

  assert.deepEqual(summary, {
    resultCounts: {
      pass: 1,
      fail: 4,
    },
    failedSteps: ["release.status.strict", "cloudflare.preflight", "cloudflare.externalState", "pages.browser.smoke"],
    blockers: [
      "release_harness.ledger.open_blockers",
      "deployment_url.staging.pages",
      "deployment_url.staging.worker_api",
      "deployment_url.production.worker_api",
      "R2_NOT_ENABLED",
    ],
  });
  assert.equal(JSON.stringify(summary).includes("super-secret"), false);
  assert.equal(JSON.stringify(summary).includes("https://should-not-be-a-blocker.example"), false);
  assert.equal(summary.blockers.includes("harness"), false);
});

test("Cloudflare external state check classifies disabled R2 without leaking account details", () => {
  const check = externalState.classifyR2BucketListResult(
    {
      exitCode: 1,
      stdout: "",
      stderr:
        "A request to the Cloudflare API (/accounts/2a0a85b82393ae6cfb2dea0b41853458/r2/buckets) failed. Please enable R2 through the Cloudflare Dashboard. [code: 10042] user@example.com",
    },
    ["silsigan-photos-staging"],
  );

  assert.equal(check.name, "cloudflare.r2.enabled");
  assert.equal(check.status, "fail");
  assert.equal(check.code, "R2_NOT_ENABLED");
  assert.equal(JSON.stringify(check).includes("user@example.com"), false);
  assert.equal(JSON.stringify(check).includes("2a0a85b82393ae6cfb2dea0b41853458"), false);
});

test("Cloudflare external state check requires configured R2 buckets when R2 is enabled", () => {
  const check = externalState.classifyR2BucketListResult(
    {
      exitCode: 0,
      stdout: "silsigan-photos-staging\n",
      stderr: "",
    },
    ["silsigan-photos-staging", "silsigan-photos-production"],
  );

  assert.equal(check.name, "cloudflare.r2.buckets");
  assert.equal(check.status, "fail");
  assert.equal(check.code, "R2_BUCKETS_MISSING");
  assert.deepEqual(check.missingBuckets, ["silsigan-photos-production"]);
});

test("Cloudflare external state check canonicalizes missing auth before remote checks", () => {
  const authCheck = externalState.classifyCloudflareAuthResult({
    exitCode: 1,
    stdout: "",
    stderr:
      "In a non-interactive environment, set CLOUDFLARE_API_TOKEN. Account user@example.com /accounts/2a0a85b82393ae6cfb2dea0b41853458 failed.",
  });
  const r2Check = externalState.classifyAuthBlockedRemoteCheck("cloudflare.r2.enabled", "R2 bucket visibility check");
  const d1Check = externalState.classifyAuthBlockedRemoteCheck("cloudflare.d1.staging.migration_0014", "Remote staging D1 migration evidence check");

  assert.equal(authCheck.name, "cloudflare.auth");
  assert.equal(authCheck.status, "fail");
  assert.equal(authCheck.code, "CLOUDFLARE_AUTH_REQUIRED");
  assert.equal(JSON.stringify(authCheck).includes("user@example.com"), false);
  assert.equal(JSON.stringify(authCheck).includes("2a0a85b82393ae6cfb2dea0b41853458"), false);
  assert.deepEqual(externalState.summarizeExternalStateBlockers([authCheck, r2Check, d1Check]), ["CLOUDFLARE_AUTH_REQUIRED"]);
});

test("Cloudflare external state check classifies missing Worker deployments without leaking account details", () => {
  const check = externalState.classifyWorkerDeploymentResult(
    {
      exitCode: 1,
      stdout: "",
      stderr:
        "A request to the Cloudflare API (/accounts/2a0a85b82393ae6cfb2dea0b41853458/workers/scripts/silsigan-api-staging/deployments) failed. This Worker does not exist on your account. [code: 10007] user@example.com",
    },
    {
      envName: "staging",
      kind: "api",
      workerName: "silsigan-api-staging",
      configPath: "workers/api/wrangler.jsonc",
    },
  );

  assert.equal(check.name, "worker_deployment.staging.api");
  assert.equal(check.status, "fail");
  assert.equal(check.code, "WORKER_DEPLOYMENT_MISSING");
  assert.equal(check.workerName, "silsigan-api-staging");
  assert.equal(JSON.stringify(check).includes("user@example.com"), false);
  assert.equal(JSON.stringify(check).includes("2a0a85b82393ae6cfb2dea0b41853458"), false);
  assert.deepEqual(externalState.summarizeExternalStateBlockers([check]), ["worker_deployment.staging.api"]);
});

test("Cloudflare external state check classifies remote D1 migration and seed evidence", () => {
  const missingMigration = externalState.classifyD1MigrationResult(
    {
      exitCode: 1,
      stdout: "",
      stderr: "SQLITE_ERROR: no such table: posts",
    },
    "staging",
  );
  assert.equal(missingMigration.name, "cloudflare.d1.staging.migration_0012");
  assert.equal(missingMigration.status, "fail");
  assert.equal(missingMigration.code, "D1_0012_NOT_APPLIED");
  assert.equal(JSON.stringify(missingMigration).includes("no such table"), false);

  const currentBaseCounters =
    "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nv2_tables=6\nv2_flags=7\nv2_settings=12\nsource_registry=8\ntrust_safety_tables=7\nfield_report_moderation_table=1\nfield_report_photos_table=1\nfield_report_photos_indexes=2\ncost_guard_tables=2\ncost_guard_indexes=4\nphoto_size_triggers=2\nkorea_sido_regions=17\nposts=4\nquestions=3\n";
  const missingPhotoIdempotency = externalState.classifyD1MigrationResult(
    {
      exitCode: 0,
      stdout: `${currentBaseCounters}photo_idempotency_table=0\nphoto_idempotency_indexes=0\ningestion_target_table=0\ningestion_target_indexes=0\n`,
      stderr: "",
    },
    "staging",
  );
  assert.equal(missingPhotoIdempotency.name, "cloudflare.d1.staging.migration_0013");
  assert.equal(missingPhotoIdempotency.code, "D1_0013_NOT_APPLIED");

  const missingOfficialIngestion = externalState.classifyD1MigrationResult(
    {
      exitCode: 0,
      stdout: `${currentBaseCounters}photo_idempotency_table=1\nphoto_idempotency_indexes=1\ningestion_target_table=0\ningestion_target_indexes=0\n`,
      stderr: "",
    },
    "staging",
  );
  assert.equal(missingOfficialIngestion.name, "cloudflare.d1.staging.migration_0014");
  assert.equal(missingOfficialIngestion.code, "D1_0014_NOT_APPLIED");

  const incompleteSeed = externalState.classifyD1MigrationResult(
    {
      exitCode: 0,
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nv2_tables=6\nv2_flags=7\nv2_settings=12\nsource_registry=8\ntrust_safety_tables=7\nfield_report_moderation_table=1\nfield_report_photos_table=1\nfield_report_photos_indexes=2\nphoto_idempotency_table=1\nphoto_idempotency_indexes=1\ningestion_target_table=1\ningestion_target_indexes=2\ncost_guard_tables=2\ncost_guard_indexes=4\nphoto_size_triggers=2\nkorea_sido_regions=17\nposts=3\nquestions=2\n",
      stderr: "",
    },
    "production",
  );
  assert.equal(incompleteSeed.name, "cloudflare.d1.production.seed_posts_questions");
  assert.equal(incompleteSeed.status, "fail");
  assert.equal(incompleteSeed.code, "D1_SEED_INCOMPLETE");
  assert.deepEqual(incompleteSeed.missingSeed, ["posts", "questions"]);

  const ready = externalState.classifyD1MigrationResult(
    {
      exitCode: 0,
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nv2_tables=6\nv2_flags=7\nv2_settings=12\nsource_registry=8\ntrust_safety_tables=7\nfield_report_moderation_table=1\nfield_report_photos_table=1\nfield_report_photos_indexes=2\nphoto_idempotency_table=1\nphoto_idempotency_indexes=1\ningestion_target_table=1\ningestion_target_indexes=2\ncost_guard_tables=2\ncost_guard_indexes=4\nphoto_size_triggers=2\nkorea_sido_regions=17\nposts=4\nquestions=3\n",
      stderr: "",
    },
    "staging",
  );
  assert.equal(ready.name, "cloudflare.d1.staging.migration_0014");
  assert.equal(ready.status, "pass");
  assert.deepEqual(ready.counts, { posts: 4, questions: 3 });
});

test("Cloudflare D1 release evidence planner defaults to non-mutating steps", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-release-plan-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" })), "utf8");
    const parsed = d1ReleaseEvidence.parseArgs(["--env=staging", "--config", configPath]);
    const plan = (await d1ReleaseEvidence.resolveD1ReleaseEvidencePlan({
      flags: parsed.flags,
      options: parsed.options,
      env: {},
    })) as {
      ok: boolean;
      mode: string;
      targets: Array<{ envName: string; databaseName: string; steps: Array<{ name: string; applyOnly?: boolean }> }>;
    };

    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "plan-only");
    assert.equal(plan.targets[0]?.envName, "staging");
    assert.equal(plan.targets[0]?.databaseName, "silsigan-staging");
    assert.deepEqual(
      plan.targets[0]?.steps.map((step) => step.name),
      ["d1.migrations.list", "d1.posts_questions.evidence"],
    );
    assert.equal(plan.targets[0]?.steps.some((step) => step.applyOnly), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare D1 release evidence planner gates mutating production apply", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-release-production-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" })), "utf8");
    const blockedArgs = d1ReleaseEvidence.parseArgs(["--env=production", "--config", configPath, "--apply"]);
    const blocked = (await d1ReleaseEvidence.resolveD1ReleaseEvidencePlan({
      flags: blockedArgs.flags,
      options: blockedArgs.options,
      env: {},
    })) as { ok: boolean; errors: Array<{ code: string }> };
    assert.equal(blocked.ok, false);
    assert.ok(blocked.errors.some((error) => error.code === "PRODUCTION_CONFIRMATION_REQUIRED"));
    assert.ok(blocked.errors.some((error) => error.code === "ROLLBACK_STRATEGY_REQUIRED"));

    const confirmedArgs = d1ReleaseEvidence.parseArgs([
      "--env=production",
      "--config",
      configPath,
      "--apply",
      "--confirm-production",
      "--accept-time-travel-only",
    ]);
    const confirmed = (await d1ReleaseEvidence.resolveD1ReleaseEvidencePlan({
      flags: confirmedArgs.flags,
      options: confirmedArgs.options,
      env: {},
    })) as {
      ok: boolean;
      mode: string;
      targets: Array<{ steps: Array<{ name: string; applyOnly?: boolean }> }>;
    };
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.mode, "apply");
    assert.deepEqual(
      confirmed.targets[0]?.steps.map((step) => [step.name, Boolean(step.applyOnly)]),
      [
        ["d1.migrations.list", false],
        ["d1.migrations.apply", true],
        ["d1.seed.apply", true],
        ["d1.posts_questions.evidence", false],
      ],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare D1 release evidence planner requires staging approval and one rollback strategy", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-release-staging-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" })), "utf8");

    const blockedArgs = d1ReleaseEvidence.parseArgs(["--env=staging", "--config", configPath, "--apply"]);
    const blocked = (await d1ReleaseEvidence.resolveD1ReleaseEvidencePlan({
      flags: blockedArgs.flags,
      options: blockedArgs.options,
      env: {},
    })) as { ok: boolean; errors: Array<{ code: string }> };
    assert.equal(blocked.ok, false);
    assert.ok(blocked.errors.some((error) => error.code === "STAGING_CONFIRMATION_REQUIRED"));
    assert.ok(blocked.errors.some((error) => error.code === "ROLLBACK_STRATEGY_REQUIRED"));

    const conflictArgs = d1ReleaseEvidence.parseArgs([
      "--env=staging",
      "--config",
      configPath,
      "--apply",
      "--confirm-staging",
      "--accept-time-travel-only",
      "--full-backup-sha256",
      "a".repeat(64),
    ]);
    const conflict = (await d1ReleaseEvidence.resolveD1ReleaseEvidencePlan({
      flags: conflictArgs.flags,
      options: conflictArgs.options,
      env: {},
    })) as { ok: boolean; errors: Array<{ code: string }> };
    assert.equal(conflict.ok, false);
    assert.ok(conflict.errors.some((error) => error.code === "ROLLBACK_STRATEGY_CONFLICT"));

    const approvedArgs = d1ReleaseEvidence.parseArgs([
      "--env=staging",
      "--config",
      configPath,
      "--apply",
      "--confirm-staging",
      "--full-backup-sha256",
      "b".repeat(64),
    ]);
    const approved = (await d1ReleaseEvidence.resolveD1ReleaseEvidencePlan({
      flags: approvedArgs.flags,
      options: approvedArgs.options,
      env: {},
    })) as { ok: boolean; rollbackStrategy: string; fullBackupSha256?: string };
    assert.equal(approved.ok, true);
    assert.equal(approved.rollbackStrategy, "full-data-backup");
    assert.equal(approved.fullBackupSha256, "b".repeat(64));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare R2 release evidence planner defaults to non-mutating steps", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-r2-release-plan-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" })), "utf8");
    const parsed = r2ReleaseEvidence.parseArgs(["--env=staging", "--config", configPath]);
    const plan = (await r2ReleaseEvidence.resolveR2ReleaseEvidencePlan({
      flags: parsed.flags,
      options: parsed.options,
      env: {},
    })) as {
      ok: boolean;
      mode: string;
      targets: Array<{ envName: string; bucketNames: string[]; steps: Array<{ name: string; applyOnly?: boolean }> }>;
    };

    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "plan-only");
    assert.equal(plan.targets[0]?.envName, "staging");
    assert.deepEqual(plan.targets[0]?.bucketNames, ["silsigan-photos-staging"]);
    assert.deepEqual(
      plan.targets[0]?.steps.map((step) => step.name),
      ["r2.buckets.list"],
    );
    assert.equal(plan.targets[0]?.steps.some((step) => step.applyOnly), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare R2 release evidence planner gates mutating production apply", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-r2-release-production-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" })), "utf8");
    const blockedArgs = r2ReleaseEvidence.parseArgs(["--env=production", "--config", configPath, "--apply"]);
    const blocked = (await r2ReleaseEvidence.resolveR2ReleaseEvidencePlan({
      flags: blockedArgs.flags,
      options: blockedArgs.options,
      env: {},
    })) as { ok: boolean; errors: Array<{ code: string }> };
    assert.equal(blocked.ok, false);
    assert.ok(blocked.errors.some((error) => error.code === "PRODUCTION_CONFIRMATION_REQUIRED"));

    const confirmedArgs = r2ReleaseEvidence.parseArgs(["--env=production", "--config", configPath, "--apply", "--confirm-production"]);
    const confirmed = (await r2ReleaseEvidence.resolveR2ReleaseEvidencePlan({
      flags: confirmedArgs.flags,
      options: confirmedArgs.options,
      env: {},
    })) as {
      ok: boolean;
      mode: string;
      targets: Array<{ steps: Array<{ name: string; bucketName?: string; applyOnly?: boolean }> }>;
    };
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.mode, "apply");
    assert.deepEqual(
      confirmed.targets[0]?.steps.map((step) => [step.name, step.bucketName ?? null, Boolean(step.applyOnly)]),
      [
        ["r2.buckets.list", null, false],
        ["r2.bucket.create", "silsigan-photos-production", true],
      ],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare external state check classifies deployment URL blockers without leaking raw URL values", () => {
  const missingChecks = externalState.classifyDeploymentUrlState({}, ["staging"]);
  assert.deepEqual(
    missingChecks.map((check: { name: string; status: string; code?: string }) => ({ name: check.name, status: check.status, code: check.code })),
    [
      { name: "deployment_url.staging.pages", status: "fail", code: "DEPLOYMENT_URL_REQUIRED" },
      { name: "deployment_url.staging.worker_api", status: "fail", code: "DEPLOYMENT_URL_REQUIRED" },
    ],
  );

  const unsafeChecks = externalState.classifyDeploymentUrlState(
    {
      SILSIGAN_STAGING_PAGES_URL: "http://user:secret@localhost:3000?token=super-secret#debug",
      SILSIGAN_STAGING_API_BASE_URL: "https://silsigan-api-staging.workers.dev",
    },
    ["staging"],
  );
  const unsafeOutput = JSON.stringify(unsafeChecks);
  assert.ok(unsafeChecks.some((check: { name: string; status: string; code?: string }) => check.name === "deployment_url.staging.pages" && check.status === "fail"));
  assert.equal(unsafeOutput.includes("super-secret"), false);
  assert.equal(unsafeOutput.includes("user:secret"), false);
  assert.equal(unsafeOutput.includes("localhost:3000"), false);

  const duplicateChecks = externalState.classifyDeploymentUrlState({
    SILSIGAN_STAGING_PAGES_URL: "https://silsigan.pages.dev",
    SILSIGAN_STAGING_API_BASE_URL: "https://silsigan-api.workers.dev",
    SILSIGAN_PRODUCTION_PAGES_URL: "https://silsigan.pages.dev",
    SILSIGAN_PRODUCTION_API_BASE_URL: "https://silsigan-api.workers.dev",
  });
  assert.ok(duplicateChecks.some((check: { name: string; status: string; code?: string }) => check.name === "deployment_urls.staging.pages.production.pages" && check.status === "fail" && check.code === "DEPLOYMENT_URL_DUPLICATE"));
  assert.ok(duplicateChecks.some((check: { name: string; status: string; code?: string }) => check.name === "deployment_urls.staging.worker_api.production.worker_api" && check.status === "fail" && check.code === "DEPLOYMENT_URL_DUPLICATE"));
});

test("Cloudflare external state check summarizes canonical release blockers", () => {
  const blockers = externalState.summarizeExternalStateBlockers([
    { name: "cloudflare.r2.enabled", status: "fail", code: "R2_NOT_ENABLED" },
    { name: "deployment_url.staging.pages", status: "fail", code: "DEPLOYMENT_URL_REQUIRED" },
    { name: "deployment_url.staging.worker_api", status: "fail", code: "DEPLOYMENT_URL_REQUIRED" },
    { name: "deployment_url.production.pages", status: "fail", code: "DEPLOYMENT_URL_REQUIRED" },
    { name: "deployment_url.production.worker_api", status: "fail", code: "DEPLOYMENT_URL_REQUIRED" },
    { name: "cloudflare.d1.production.migration_0012", status: "fail", code: "D1_0012_NOT_APPLIED" },
    { name: "cloudflare.d1.production.migration_0012", status: "fail", code: "D1_0012_NOT_APPLIED" },
  ]);

  assert.deepEqual(blockers, [
    "R2_NOT_ENABLED",
    "deployment_url.staging.pages",
    "deployment_url.staging.worker_api",
    "deployment_url.production.pages",
    "deployment_url.production.worker_api",
    "D1_0012_NOT_APPLIED",
  ]);
});

test("Cloudflare release gate requires a tail file when tail evidence is mandatory", () => {
  const parsed = releaseGate.parseArgs(["--tail-required"]);
  const plan = releaseGate.resolveReleaseGatePlan({ flags: parsed.flags, options: parsed.options, env: {} });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.errors, [
    {
      code: "TAIL_FILE_REQUIRED",
      message: "SILSIGAN_STAGING_TAIL_LOG_FILE 또는 --tail-file 이 필요합니다.",
    },
  ]);
  assert.equal(plan.steps.some((step: ReleaseGateStep) => step.name === "workers.tail.redaction"), false);
});

test("Cloudflare release gate requires admin token and mutating mode for write browser options", () => {
  const missingAdmin = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--mutating"]).flags,
    env: {},
  });
  assert.equal(missingAdmin.ok, false);
  assert.ok(missingAdmin.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_ADMIN_TOKEN_REQUIRED"));

  const browserReportWithoutMutation = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--browser-report"]).flags,
    env: {},
  });
  assert.equal(browserReportWithoutMutation.ok, false);
  assert.ok(browserReportWithoutMutation.errors.some((error: { code: string }) => error.code === "BROWSER_REPORT_REQUIRES_MUTATING"));

  const requirePhotoWithoutMutation = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--require-photo"]).flags,
    env: {},
  });
  assert.equal(requirePhotoWithoutMutation.ok, false);
  assert.ok(requirePhotoWithoutMutation.errors.some((error: { code: string }) => error.code === "REQUIRE_PHOTO_REQUIRES_MUTATING"));
});

test("Cloudflare release gate validates coordinate status opt-in before staging mutation smoke", () => {
  const missingMutation = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--coordinate-status"]).flags,
    env: {},
  });
  assert.equal(missingMutation.ok, false);
  assert.ok(missingMutation.errors.some((error: { code: string }) => error.code === "COORDINATE_STATUS_REQUIRES_MUTATING"));

  const missingCoordinateEnv = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--mutating", "--coordinate-status"]).flags,
    env: {
      SILSIGAN_STAGING_ADMIN_TOKEN: "staging-admin-token",
      SILSIGAN_STAGING_COORDINATE_SMOKE_PLACE_ID: "jeju-coordinate-review",
      SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE: "not-a-number",
    },
  });
  assert.equal(missingCoordinateEnv.ok, false);
  assert.ok(missingCoordinateEnv.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_COORDINATE_SMOKE_LONGITUDE_REQUIRED"));
  assert.ok(missingCoordinateEnv.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE_INVALID"));

  const parsed = releaseGate.parseArgs(["--mutating", "--coordinate-status"]);
  const plan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {
      SILSIGAN_STAGING_ADMIN_TOKEN: "super-secret-admin-token",
      SILSIGAN_STAGING_COORDINATE_SMOKE_PLACE_ID: "jeju-coordinate-review",
      SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE: "33.4996",
      SILSIGAN_STAGING_COORDINATE_SMOKE_LONGITUDE: "126.5312",
    },
  });
  const stagingSmoke = plan.steps.find((step: ReleaseGateStep) => step.name === "staging.api.smoke");

  assert.equal(plan.ok, true);
  assert.deepEqual(stagingSmoke?.args, ["smoke:staging", "--", "--mutating", "--require-admin", "--coordinate-status"]);
  assert.deepEqual(stagingSmoke?.envKeys, [
    "SILSIGAN_STAGING_API_BASE_URL",
    "SILSIGAN_STAGING_ADMIN_TOKEN",
    "SILSIGAN_STAGING_COORDINATE_SMOKE_PLACE_ID",
    "SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE",
    "SILSIGAN_STAGING_COORDINATE_SMOKE_LONGITUDE",
  ]);
  assert.equal(JSON.stringify(plan).includes("super-secret"), false);
});

test("staging mutation smoke verifies cleanup for photos comments likes admin restrictions and coordinate status", async () => {
  const placeId = "busan-gwangalli";
  const regionId = "busan";
  const photoId = "photo_staging_smoke_fixture";
  const photoPreviewPath = `/api/photos/${photoId}/file`;
  const commentId = "comment_staging_smoke_fixture";
  const restrictionSeedCommentId = "comment_staging_restriction_seed";
  const restrictionRestoredCommentId = "comment_staging_restriction_restored";
  const restrictionAnonymousUserId = `anon_${"a".repeat(48)}`;
  const reportId = "report_staging_smoke_fixture";
  const adminToken = "test-admin-token";
  let photoDeleted = false;
  let commentCreated = false;
  let commentDeleted = false;
  let restrictionSeedCreated = false;
  let restrictionSeedDeleted = false;
  let userRestricted = false;
  let placeLiked = false;
  let reportOpen = false;
  let reportTargetType = "place";
  let liveRequestUsedSessionProof = false;
  const smokeSessionProof = "staging-smoke-session-proof";
  const fixtureHandler = async (request: SmokeFixtureRequest, response: SmokeFixtureResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestAnonId = String(request.headers["x-silsigan-anon-id"] ?? "");
    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(payload));
    };
    const success = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta });
    const readJsonBody = async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      if (chunks.length === 0) {
        return {} as Record<string, unknown>;
      }

      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    };

    if (request.method === "GET" && url.pathname === "/api/health") {
      send(200, success({ ok: true, service: "fixture-worker", storage: "fixture" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/places") {
      send(
        200,
        success([{ id: placeId, regionId, latitude: 35.1532, longitude: 129.1186, coordinateStatus: "verified" }]),
        { "x-silsigan-anon-id": requestAnonId, "x-silsigan-anon-proof": smokeSessionProof },
      );
      return;
    }

    if (request.method === "GET" && url.pathname === `/api/places/${placeId}`) {
      send(200, success({ id: placeId, regionId, latitude: 35.1532, longitude: 129.1186, coordinateStatus: "verified" }));
      return;
    }

    if (request.method === "GET" && url.pathname === `/api/places/${placeId}/live`) {
      liveRequestUsedSessionProof = request.headers["x-silsigan-anon-proof"] === smokeSessionProof;
      if (!liveRequestUsedSessionProof) {
        send(401, { success: false, error: { code: "ANONYMOUS_SESSION_PROOF_REQUIRED", message: "proof required" } });
        return;
      }
      send(200, success({ commentCount: commentCreated && !commentDeleted ? 1 : 0, photoCount: photoDeleted ? 0 : 1, likeCount: placeLiked ? 1 : 0 }));
      return;
    }

    if (request.method === "GET" && url.pathname === `/api/realtime/place/${placeId}`) {
      send(200, success({ mode: "durable-object-polling", scope: "place", roomId: placeId, events: [] }));
      return;
    }

    if (request.method === "GET" && url.pathname === `/api/realtime/region/${regionId}`) {
      send(200, success({ mode: "durable-object-polling", scope: "region", roomId: regionId, events: [] }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/realtime/global") {
      send(200, success({ mode: "durable-object-polling", scope: "global", roomId: "global", events: [] }));
      return;
    }

    if (request.method === "GET" && (url.pathname === "/api/rankings/global" || url.pathname === "/api/rankings")) {
      send(200, success([]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/comments") {
      send(
        200,
        success(
          commentCreated && !commentDeleted
            ? [
                {
                  id: commentId,
                  placeId,
                  body: "staging smoke comment fixture",
                  likeCount: 0,
                },
              ]
            : [],
        ),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/comments") {
      if (requestAnonId.includes("restrict")) {
        if (userRestricted) {
          send(403, { success: false, error: { code: "USER_RESTRICTED", message: "restricted" } });
          return;
        }

        if (!restrictionSeedCreated || restrictionSeedDeleted) {
          restrictionSeedCreated = true;
          restrictionSeedDeleted = false;
          send(201, success({ id: restrictionSeedCommentId, placeId, anonymousUserId: restrictionAnonymousUserId, body: "restriction seed", likeCount: 0 }));
          return;
        }

        send(201, success({ id: restrictionRestoredCommentId, placeId, anonymousUserId: restrictionAnonymousUserId, body: "restriction restored", likeCount: 0 }));
        return;
      }

      commentCreated = true;
      commentDeleted = false;
      send(201, success({ id: commentId, placeId, anonymousUserId: `anon_${"b".repeat(48)}`, body: "staging smoke comment fixture", likeCount: 0 }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === `/api/comments/${commentId}`) {
      commentDeleted = true;
      send(200, success({ commentId, deleted: true }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === `/api/comments/${restrictionSeedCommentId}`) {
      restrictionSeedDeleted = true;
      send(200, success({ commentId: restrictionSeedCommentId, deleted: true }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === `/api/comments/${restrictionRestoredCommentId}`) {
      send(200, success({ commentId: restrictionRestoredCommentId, deleted: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === `/api/places/${placeId}/like`) {
      const created = !placeLiked;
      placeLiked = true;
      send(200, success({ placeId, likeCount: 1, created }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === `/api/places/${placeId}/like`) {
      const deleted = placeLiked;
      placeLiked = false;
      send(200, success({ placeId, likeCount: 0, deleted }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/moderation/reports") {
      const body = await readJsonBody();
      reportTargetType = String(body.targetType ?? "place");
      reportOpen = true;
      send(201, success({ id: reportId, targetType: reportTargetType, targetId: body.targetId ?? placeId, reason: body.reason ?? "other", status: "open" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/moderation/reports") {
      if (request.headers["x-silsigan-admin-token"] !== adminToken) {
        send(403, { success: false, error: { code: "FORBIDDEN", message: "forbidden" } });
        return;
      }

      send(200, success(reportOpen ? [{ id: reportId, targetType: reportTargetType, targetId: placeId, reason: "other", status: "open" }] : []));
      return;
    }

    if (request.method === "POST" && url.pathname === `/api/moderation/reports/${reportId}/action`) {
      if (request.headers["x-silsigan-admin-token"] !== adminToken) {
        send(403, { success: false, error: { code: "FORBIDDEN", message: "forbidden" } });
        return;
      }

      reportOpen = false;
      send(200, success({ id: reportId, targetType: reportTargetType, targetId: placeId, reason: "other", status: "rejected" }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/users/restrict") {
      if (request.headers["x-silsigan-admin-token"] !== adminToken) {
        send(403, { success: false, error: { code: "FORBIDDEN", message: "forbidden" } });
        return;
      }

      userRestricted = true;
      const body = await readJsonBody();
      send(200, success({ anonymousUserId: restrictionAnonymousUserId, restricted: true, blockedUntil: body.blockedUntil }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/users/unrestrict") {
      if (request.headers["x-silsigan-admin-token"] !== adminToken) {
        send(403, { success: false, error: { code: "FORBIDDEN", message: "forbidden" } });
        return;
      }

      userRestricted = false;
      send(200, success({ anonymousUserId: restrictionAnonymousUserId, restricted: false }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/places/coordinate-status") {
      if (request.headers["x-silsigan-admin-token"] !== adminToken) {
        send(403, { success: false, error: { code: "FORBIDDEN", message: "forbidden" } });
        return;
      }

      send(200, success({ placeId, coordinateStatus: "verified", latitude: 35.1532, longitude: 129.1186 }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/photos") {
      send(
        200,
        success(
          photoDeleted
            ? []
            : [
                {
                  id: photoId,
                  placeId,
                  previewUrl: new URL(photoPreviewPath, `http://${request.headers.host}`).toString(),
                  mimeType: "image/jpeg",
                  byteSize: Buffer.from(tinyJpegBase64, "base64").byteLength,
                  width: 1,
                  height: 1,
                  clickCount: 0,
                  status: "ready",
                  createdAt: "2026-06-19T00:00:00.000Z",
                },
              ],
        ),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === photoPreviewPath) {
      response.writeHead(200, { "content-type": "image/jpeg" });
      response.end(Buffer.from(tinyJpegBase64, "base64"));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/moderation/hide") {
      send(403, { success: false, error: { code: "ADMIN_FORBIDDEN", message: "forbidden" } });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/photos/complete") {
      photoDeleted = false;
      send(201, success({ photo: { id: photoId, placeId }, storageKey: `photos/busan/${placeId}/fixture.webp` }, { photoSanitization: { pixelsReencoded: true } }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === `/api/photos/${photoId}`) {
      photoDeleted = true;
      send(200, success({ deleted: true }));
      return;
    }

    send(404, { success: false, error: { code: "NOT_FOUND", message: url.pathname } });
  };

  const fixtureFetch = async (input: URL | string, init: RequestInit = {}) => {
    const requestUrl = new URL(String(input));
    const requestHeaders = new Headers(init.headers ?? {});
    let responseStatus = 200;
    let responseHeaders: Record<string, string> = {};
    let responseBody: BodyInit | null = null;
    const request = {
      method: init.method ?? "GET",
      url: `${requestUrl.pathname}${requestUrl.search}`,
      headers: Object.fromEntries(requestHeaders.entries()),
      async *[Symbol.asyncIterator]() {
        if (typeof init.body === "string") {
          yield Buffer.from(init.body);
        }
      },
    };
    const response = {
      writeHead(status: number, headers: Record<string, string> = {}) {
        responseStatus = status;
        responseHeaders = headers;
      },
      end(body?: BodyInit | null) {
        responseBody = body ?? null;
      },
    };

    await fixtureHandler(request, response);
    return new Response(responseBody, { status: responseStatus, headers: responseHeaders });
  };

  const payload = (await stagingSmoke.runSmoke({
    rawArgs: [
      "--base-url=http://fixture.local",
      "--mutating",
      "--coordinate-status",
      `--coordinate-place-id=${placeId}`,
      "--coordinate-latitude=35.1532",
      "--coordinate-longitude=129.1186",
    ],
    env: { ...process.env, SILSIGAN_STAGING_ADMIN_TOKEN: adminToken },
    fetchImpl: fixtureFetch,
  })) as { ok: boolean; checks: Array<{ name: string; status: string }> };

  assert.equal(payload.ok, true);
  assert.equal(liveRequestUsedSessionProof, true);
  assert.ok(payload.checks.some((check) => check.name === "admin.denyByDefault" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "realtime.place" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "realtime.region" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "realtime.global" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "photos.previewList" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "photos.previewFile" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "photos.deleteNotPublic" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "places.like" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "places.unlike" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "comments.create" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "comments.deleteOwn" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "comments.deleteNotPublic" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "moderation.queueAuth" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "moderation.reportCreate" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "moderation.queueVisible" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "moderation.reportReject" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "moderation.queueClean" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "users.restrict" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "users.restrictBlocksWrites" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "users.unrestrict" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "users.unrestrictRestoresWrites" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "users.restrictionCleanup" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "coordinateStatus.verify" && check.status === "pass"));
  assert.ok(payload.checks.some((check) => check.name === "coordinateStatus.publicDetail" && check.status === "pass"));
});

test("Cloudflare API clamps generic list and ranking limits", () => {
  assert.equal(policies.clampLimit("500"), 50);
  assert.equal(policies.clampLimit("0"), 1);
  assert.equal(policies.clampLimit("bad"), 20);

  const ranked = policies.rankRegionPlaces(
    Array.from({ length: 60 }, (_, index) => ({
      regionId: "busan",
      score: index,
    })),
    "busan",
    "99",
  );

  assert.equal(ranked.length, 50);
  assert.equal(ranked[0]?.score, 59);
});

test("Cloudflare API bbox parser and filter keep only places inside bounds", () => {
  const bbox = policies.parseBBox("129.0,35.0,129.2,35.2");
  assert.deepEqual(bbox, {
    minLat: 35,
    minLng: 129,
    maxLat: 35.2,
    maxLng: 129.2,
  });

  const places = policies.filterPlacesByBBox(
    [
      { id: "inside", latitude: 35.15, longitude: 129.11 },
      { id: "outside", latitude: 35.55, longitude: 129.3 },
    ],
    bbox,
  );

  assert.deepEqual(
    places.map((place) => place.id),
    ["inside"],
  );
});

test("Cloudflare API radius parser clamps range and filters by meter distance", () => {
  const radius = policies.parseRadiusSearch("35.1532", "129.1186", "800");
  assert.equal(radius?.radiusMeters, 800);
  assert.ok((radius?.bbox.minLat ?? 0) < 35.1532);
  assert.ok((radius?.bbox.maxLng ?? 0) > 129.1186);

  const clamped = policies.parseRadiusSearch("35.1532", "129.1186", "999999");
  assert.equal(clamped?.radiusMeters, policies.MAX_PLACE_RADIUS_M);
  assert.equal(policies.parseRadiusSearch("999", "129.1186", "800"), null);

  const places = policies.filterPlacesByRadius(
    [
      { id: "inside", latitude: 35.1531, longitude: 129.1185 },
      { id: "outside", latitude: 35.5486, longitude: 129.3005 },
    ],
    radius,
  );

  assert.deepEqual(
    places.map((place) => place.id),
    ["inside"],
  );
});

test("GET /api/places applies bbox and limit query policy", async () => {
  const response = await worker.handleRequest(new Request("https://api.test/api/places?bbox=129.0,35.0,129.2,35.2&limit=1"));
  const payload = (await response.json()) as SuccessPayload<Place[]>;

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0]?.id, "busan-gwangalli");
  assert.equal(payload.meta?.bboxApplied, true);
});

test("GET /api/places applies search query policy", async () => {
  const response = await worker.handleRequest(new Request("https://api.test/api/places?q=%EA%B4%91%EC%95%88%EB%A6%AC&limit=10"));
  const payload = (await response.json()) as SuccessPayload<Place[]>;

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.deepEqual(
    payload.data.map((place) => place.id),
    ["busan-gwangalli"],
  );
});

test("GET /api/places applies radius query without echoing client coordinates", async () => {
  const response = await worker.handleRequest(new Request("https://api.test/api/places?lat=35.1532&lng=129.1186&radius=800&limit=10"));
  const payload = (await response.json()) as SuccessPayload<Place[]>;

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.deepEqual(
    payload.data.map((place) => place.id),
    ["busan-gwangalli"],
  );
  assert.equal(payload.meta?.radiusApplied, true);
  assert.equal(payload.meta?.radiusMeters, 800);
  assert.equal("lat" in (payload.meta ?? {}), false);
  assert.equal("lng" in (payload.meta ?? {}), false);
  assert.equal("center" in (payload.meta ?? {}), false);
});

test("GET /api/places returns empty results for disjoint bbox and radius scopes", async () => {
  const response = await worker.handleRequest(
    new Request("https://api.test/api/places?bbox=126.9,37.5,127.0,37.6&lat=35.1532&lng=129.1186&radius=800&limit=10"),
  );
  const payload = (await response.json()) as SuccessPayload<Place[]>;

  assert.equal(response.status, 200);
  assert.deepEqual(payload.data, []);
  assert.equal(payload.meta?.bboxApplied, true);
  assert.equal(payload.meta?.radiusApplied, true);
});

function createPreflightConfig(ids: { stagingD1Id: string; stagingKvId: string }) {
  return {
    observability: {
      enabled: true,
    },
    env: {
      staging: createPreflightEnv({
        envName: "staging",
        d1Id: ids.stagingD1Id,
        kvId: ids.stagingKvId,
      }),
      production: createPreflightEnv({
        envName: "production",
        d1Id: "d1-production-ready-id",
        kvId: "kv-production-ready-id",
      }),
    },
  };
}

function writeReleaseStateLedger(path: string, options: { duplicateNextActionLine?: boolean } = {}) {
  const nextActions = ["## Next Actions"];
  if (options.duplicateNextActionLine) {
    nextActions.push(
      "R2 check passes before staging Worker/Pages URL smoke can begin.",
      "R2 check passes before staging Worker/Pages URL smoke can begin.",
    );
  }

  writeFileSync(
    path,
    ["## Objective", "## Local Code State", "## Latest Local Verification", "## Cloudflare External State", "## Release Decision", ...nextActions].join("\n\n"),
    "utf8",
  );
}

function writeUgcModerationRunbook(path: string) {
  writeFileSync(
    path,
    [
      "# #실시간 UGC moderation runbook",
      "",
      "## Ownership",
      "",
      "Moderation operator owns report triage and release owner owns TestFlight expansion.",
      "",
      "## Intake Queue",
      "",
      "`MODERATION_ALERT_WEBHOOK_URL` receives redacted report alerts for `privacy_face`, `privacy_plate`, `sensitive_info`, `comment`, and `photo` targets.",
      "",
      "## SLA",
      "",
      "Sensitive queues use 12h, 24h, and 72h decision windows.",
      "",
      "## Operator Actions",
      "",
      "Operators can `hide`, `restore`, `delete`, and `restrict` through the admin API.",
      "",
      "## Evidence And Audit",
      "",
      "Record report ID, action, target type, target ID, operator role, cache result, and R2 result without raw coordinates or tokens.",
      "",
      "## Escalation",
      "",
      "Pause expansion if webhook, queue access, R2 cleanup, or redaction evidence fails.",
      "",
      "## Stop Conditions",
      "",
      "Stop when no operator is available, staging admin token is missing, comment/photo smoke fails, or R2 delete evidence is missing.",
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeCloudflareCostUsageRunbook(path: string) {
  writeFileSync(
    path,
    [
      "# #실시간 Cloudflare cost and usage runbook",
      "",
      "## Ownership",
      "",
      "Release owner reviews budget decisions and Cloudflare operator reviews product dashboards.",
      "",
      "## Dashboard Checks",
      "",
      "Use Usage & billing for R2, D1, Workers, Durable Objects, and Cloudflare Images in staging and production.",
      "Verify PHOTO_WRITE_RATE_LIMITER, PHOTO_READ_RATE_LIMITER, PHOTO_GLOBAL_DAILY_LIMIT, PHOTO_GLOBAL_MONTHLY_LIMIT, and PHOTO_GLOBAL_STORED_LIMIT before enabling photo traffic.",
      "",
      "## Baseline Thresholds",
      "",
      "Track requests, storage, egress, transformations, reads, writes, and errors against daily and weekly baselines.",
      "",
      "## Alert Rules",
      "",
      "Configure Billing alerts at 50% and 80% of the MVP budget before TestFlight expansion.",
      "",
      "## Evidence And Cadence",
      "",
      "Record daily staging evidence and weekly production evidence with owner decisions.",
      "",
      "## Stop Conditions",
      "",
      "Stop TestFlight expansion when budget evidence is missing or usage cannot be explained.",
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeTestFlightReviewNotes(path: string) {
  writeFileSync(
    path,
    [
      "# #실시간 TestFlight review notes",
      "",
      "## Beta App Description",
      "",
      "#실시간 is a TestFlight beta that uses Cloudflare staging to verify nearby place comments, photos, likes, rankings, and reports before App Store production submission.",
      "",
      "## Reviewer Instructions",
      "",
      "Use `SILSIGAN_STAGING_PAGES_URL` for the beta frontend and `SILSIGAN_STAGING_API_BASE_URL` for the Worker API. Production submission stays blocked until staging evidence is clean.",
      "",
      "## Permissions",
      "",
      "The app asks for location permission to show nearby places, camera permission for a fresh field photo, and photo library permission for selecting an existing field photo.",
      "",
      "## UGC Moderation",
      "",
      "UGC moderation covers comment and photo report intake, operator hide, restore, delete, and user restriction actions.",
      "",
      "## Privacy And Support URLs",
      "",
      "The privacy policy URL and support URL must be final HTTPS URLs before external TestFlight review notes are submitted.",
      "",
      "## Staging Evidence",
      "",
      "Required evidence includes Cloudflare R2 object proof, D1 row proof, Worker API smoke, Pages smoke, UGC moderation report proof, and no raw filename exposure.",
      "",
      "## Stop Conditions",
      "",
      "Stop TestFlight expansion if R2, D1, Cloudflare staging, report handling, hide/delete moderation, privacy/support URLs, or real-device smoke evidence is missing.",
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeRealDeviceQaLedger(path: string) {
  writeFileSync(
    path,
    [
      "# #실시간 real-device QA ledger",
      "",
      "## Scope",
      "",
      "This ledger records iPhone and Android real-device evidence required before TestFlight internal testing.",
      "",
      "## Environment",
      "",
      "| Item | Current state |",
      "| --- | --- |",
      "| Staging Pages URL | ready |",
      "| Staging Worker API URL | ready |",
      "| R2 staging bucket visibility | visible; writes guarded by PHOTO_UPLOADS_ENABLED=false |",
      "| TestFlight build | selected |",
      "| Android internal/debug build | selected |",
      "",
      "## iPhone QA Matrix",
      "",
      "| Flow | Required evidence | Result |",
      "| --- | --- | --- |",
      "| Naver map display | Map or fallback marker hit-test works | pass |",
      "| Location allow | Permission prompt, current marker, no raw coordinates | pass |",
      "| Location deny | Region selection remains usable | pass |",
      "| Camera and photo library | Camera permission and photo library permission are captured | pass |",
      "| Photo upload/preview | Upload succeeds and preview loads | pass |",
      "| Like/unlike | State changes are bounded | pass |",
      "| Ranking refresh | TOP 10 refresh is recorded | pass |",
      "| Report/moderation | Report and hide/delete moderation are recorded | pass |",
      "| Crash check | No crash during the full script | pass |",
      "",
      "## Android QA Matrix",
      "",
      "| Flow | Required evidence | Result |",
      "| --- | --- | --- |",
      "| Naver map display | Map or fallback marker hit-test works | pass |",
      "| Location allow | Permission prompt, current marker, no raw coordinates | pass |",
      "| Location deny | Region selection remains usable | pass |",
      "| Camera and photo library | Camera permission and photo library permission are captured | pass |",
      "| Photo upload/preview | Upload succeeds and preview loads | pass |",
      "| Like/unlike | State changes are bounded | pass |",
      "| Ranking refresh | TOP 10 refresh is recorded | pass |",
      "| Report/moderation | Report and hide/delete moderation are recorded | pass |",
      "| Crash check | No crash during the full script | pass |",
      "",
      "## Evidence Naming",
      "",
      "Use `network-redacted.json`, `known-issues.md`, screenshots, and console logs. Do not store raw coordinates, original filenames, tokens, or anonymous IDs.",
      "",
    ].join("\n"),
    "utf8",
  );
}

function writePublicPolicySupportPages(privacyPagePath: string, supportPagePath: string) {
  writeFileSync(
    privacyPagePath,
    [
      "export default function PrivacyPage() {",
      "  return <main>",
      "    <h1>개인정보 처리방침</h1>",
      "    <p>위치정보 raw coordinate Cloudflare D1 R2 EXIF/GPS 원본 파일명 신고 delete support URL privacy policy URL</p>",
      "  </main>;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    supportPagePath,
    [
      "export default function SupportPage() {",
      "  return <main>",
      "    <h1>지원 및 신고 안내</h1>",
      "    <p>TestFlight iPhone Android 지도 위치 권한 privacy_face privacy_plate sensitive_info 삭제 요청 support URL privacy policy URL</p>",
      "  </main>;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeReleaseHarnessFiles(
  rootDir: string,
  sourceLedgerPath: string,
  options: { omitOpenBlockerEvidenceFromStatus?: boolean; openBlocker?: boolean } = {},
) {
  const releaseLedgerPath = join(rootDir, "release-ledger.yaml");
  const releaseStatusPath = join(rootDir, "RELEASE_STATUS.md");
  writeFileSync(
    releaseLedgerPath,
    [
      "schema_version: 1",
      "project:",
      '  name: "silsigan"',
      "candidate:",
      '  version: "0.1.0"',
      '  git_sha: "test-sha"',
      '  branch: "test-branch"',
      `  source_of_truth: "${sourceLedgerPath}"`,
      "local_checks: []",
      "runtime_checks: []",
      "external_checks: []",
      "security: {}",
      ...(options.openBlocker
        ? [
            "blockers:",
            "  - id: \"P0-SILSIGAN-R2-DASHBOARD\"",
            "    severity: \"P0\"",
            "    status: \"open\"",
            "    title: \"Cloudflare R2 account is not enabled.\"",
            "    evidence: \"R2_NOT_ENABLED\"",
          ]
        : ["blockers: []"]),
      "next_action:",
      '  command: "pnpm release:status"',
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    releaseStatusPath,
    [
      "# Release Status",
      "",
      "## 한 줄 상태",
      "",
      `상세 source of truth는 ${sourceLedgerPath} 이다.`,
      "",
      "## 현재 후보",
      "",
      "- Version: `0.1.0`",
      "",
      "## 막힌 항목",
      "",
      ...(options.openBlocker
        ? [options.omitOpenBlockerEvidenceFromStatus ? "- P0: Cloudflare R2 account is not enabled." : "- P0: Cloudflare R2 account is not enabled: `R2_NOT_ENABLED`"]
        : ["- none"]),
      "",
      "## 다음 행동",
      "",
      "```bash",
      "pnpm release:status",
      "```",
      "",
    ].join("\n"),
    "utf8",
  );

  return { releaseLedgerPath, releaseStatusPath };
}

function createPreflightEnv(input: { envName: "staging" | "production"; d1Id: string; kvId: string }) {
  const pagesOrigin = input.envName === "production" ? "https://silsigan.kr" : "https://silsigan-staging.pages.dev";

  return {
    vars: {
      ENVIRONMENT: input.envName,
      CORS_ALLOWED_ORIGINS: pagesOrigin,
      PUBLIC_SITE_URL: pagesOrigin,
      PHOTO_UPLOADS_ENABLED: "false",
      IMAGE_TRANSFORMS_ENABLED: "false",
      PHOTO_GLOBAL_DAILY_LIMIT: "150",
      PHOTO_GLOBAL_MONTHLY_LIMIT: "4500",
      PHOTO_GLOBAL_STORED_LIMIT: "9000",
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: `silsigan-${input.envName}`,
        database_id: input.d1Id,
      },
    ],
    kv_namespaces: [
      {
        binding: "CACHE",
        id: input.kvId,
      },
    ],
    r2_buckets: [
      {
        binding: "PHOTOS",
        bucket_name: `silsigan-photos-${input.envName}`,
      },
    ],
    ratelimits: [
      {
        name: "PHOTO_WRITE_RATE_LIMITER",
        namespace_id: input.envName === "production" ? "9317301" : "9317201",
        simple: { limit: 60, period: 60 },
      },
      {
        name: "PHOTO_READ_RATE_LIMITER",
        namespace_id: input.envName === "production" ? "9317302" : "9317202",
        simple: { limit: 200, period: 60 },
      },
    ],
    durable_objects: {
      bindings: [
        { name: "PLACE_ROOM", class_name: "PlaceRoom" },
        { name: "REGION_ROOM", class_name: "RegionRoom" },
        { name: "GLOBAL_ROOM", class_name: "GlobalRoom" },
      ],
    },
  };
}

function createReadyPreflightProcessEnv(overrides: Record<string, string> = {}) {
  return {
    ...process.env,
    SILSIGAN_STAGING_PAGES_URL: "https://silsigan-staging.pages.dev",
    SILSIGAN_STAGING_API_BASE_URL: "https://silsigan-api-staging.workers.dev",
    SILSIGAN_PRODUCTION_PAGES_URL: "https://silsigan.kr",
    SILSIGAN_PRODUCTION_API_BASE_URL: "https://api.silsigan.kr",
    SILSIGAN_PRIVACY_POLICY_URL: "https://silsigan.kr/privacy",
    SILSIGAN_SUPPORT_URL: "https://silsigan.kr/support",
    ...overrides,
  };
}

test("GET /api/rankings clamps region limit to requested MVP max", async () => {
  const response = await worker.handleRequest(new Request("https://api.test/api/rankings?regionId=busan&limit=99"));
  const payload = (await response.json()) as SuccessPayload<Array<{ regionId: string; rank: number }>>;

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.ok(payload.data.length <= 50);
  assert.ok(payload.data.every((ranking) => ranking.regionId === "busan"));
});

test("GET /api/rankings uses CACHE KV read-through cache with bounded TTL", async () => {
  const cache = new FakeKVNamespace();
  const url = "https://api.test/api/rankings/regions/busan?limit=10";
  const firstResponse = await worker.handleRequest(new Request(url), { CACHE: cache });
  const firstPayload = (await firstResponse.json()) as SuccessPayload<Ranking[]>;

  assert.equal(firstResponse.status, 200);
  assert.equal(firstPayload.meta?.cacheStatus, "miss");
  assert.equal(firstPayload.meta?.cacheTtlSeconds, 60);
  assert.equal(cache.puts.length, 1);
  assert.equal(cache.puts[0]?.options?.expirationTtl, 60);
  assert.equal(firstPayload.data[0]?.name, "광안리해수욕장");
  assert.equal(typeof firstPayload.data[0]?.summary, "string");

  const secondResponse = await worker.handleRequest(new Request(url), { CACHE: cache });
  const secondPayload = (await secondResponse.json()) as SuccessPayload<Ranking[]>;

  assert.equal(secondPayload.meta?.cacheStatus, "hit");
  assert.deepEqual(secondPayload.data, firstPayload.data);
  assert.equal(cache.puts.length, 1);

  cache.values.set(cache.puts[0]?.key ?? "", "{not valid json");
  const recoveredResponse = await worker.handleRequest(new Request(url), { CACHE: cache });
  const recoveredPayload = (await recoveredResponse.json()) as SuccessPayload<Ranking[]>;

  assert.equal(recoveredPayload.meta?.cacheStatus, "miss");
  assert.equal(cache.puts.length, 2);
});

test("Cloudflare API supports required place and ranking route aliases", async () => {
  const anonymousId = "anon_place_alias_test";
  const place = await get<SuccessPayload<Place>>("https://api.test/api/places/busan-gwangalli", anonymousId);
  assert.equal(place.data.id, "busan-gwangalli");

  const firstClick = await post<SuccessPayload<{ clickCount: number; created: boolean }>>(
    "https://api.test/api/places/busan-gwangalli/click",
    anonymousId,
    { source: "ranking" },
  );
  const secondClick = await post<SuccessPayload<{ clickCount: number; created: boolean }>>(
    "https://api.test/api/places/busan-gwangalli/click",
    anonymousId,
    {},
  );
  assert.equal(firstClick.data.created, true);
  assert.equal(secondClick.data.created, false);
  assert.equal(firstClick.meta?.source, "ranking");

  const liked = await post<SuccessPayload<{ likeCount: number; created: boolean }>>(
    "https://api.test/api/places/busan-gwangalli/like",
    anonymousId,
    {},
  );
  const unliked = await del<SuccessPayload<{ likeCount: number; deleted: boolean }>>(
    "https://api.test/api/places/busan-gwangalli/like",
    anonymousId,
  );
  assert.equal(liked.data.created, true);
  assert.equal(unliked.data.deleted, true);

  const live = await get<SuccessPayload<{ statusSummary: string }>>("https://api.test/api/places/busan-gwangalli/live", anonymousId);
  assert.ok(live.data.statusSummary.length > 0);

  const globalRanking = await get<SuccessPayload<Ranking[]>>("https://api.test/api/rankings/global?limit=10", anonymousId);
  const regionRanking = await get<SuccessPayload<Ranking[]>>("https://api.test/api/rankings/regions/busan?limit=10", anonymousId);
  const areaRanking = await get<SuccessPayload<Ranking[]>>(
    "https://api.test/api/rankings/regions/busan/areas/busan-suyeong?limit=10",
    anonymousId,
  );

  assert.equal(globalRanking.data[0]?.rank, 1);
  assert.equal(globalRanking.data[0]?.name, "광안리해수욕장");
  assert.equal(globalRanking.data[0]?.regionCode, "busan");
  assert.equal(globalRanking.data[0]?.areaCode, "busan-suyeong");
  assert.equal(globalRanking.data[0]?.category, "tourism");
  assert.ok((globalRanking.data[0]?.clickCount ?? 0) >= 1);
  assert.equal(globalRanking.data[0]?.trend, "same");
  assert.equal(typeof globalRanking.data[0]?.summary, "string");
  assert.ok(regionRanking.data.every((ranking) => ranking.regionId === "busan"));
  assert.ok(areaRanking.data.every((ranking) => ranking.regionId === "busan"));
});

test("Worker runtime config defaults launch flags to false in explicit demo storage", async () => {
  const response = await worker.handleRequest(new Request("https://api.test/api/config"), {
    ENVIRONMENT: "development",
    PHOTOS: new FakeR2Bucket(),
  });
  assert.equal(response.status, 200);

  const payload = (await response.json()) as SuccessPayload<{
    contractVersion: number;
    dataMode: string;
    featureFlags: Record<string, boolean>;
    costControls: {
      photoUploadsEnabled: boolean;
      photoMaxBytes: number;
      photoDailyLimit: number;
      enforcement: string;
    };
    dimensionSettings: Array<{ settingKey: string; defaultTtlSeconds: number }>;
  }>;
  assert.equal(payload.data.contractVersion, 2);
  assert.equal(payload.data.dataMode, "demo");
  assert.deepEqual(payload.data.featureFlags, {
    QNA_ENABLED: false,
    REWARDS_ENABLED: false,
    ADS_ENABLED: false,
    LIVE_STREAMS_ENABLED: false,
    DEMO_DATA_ENABLED: false,
    SEOUL_REALTIME_ENABLED: false,
    SOCIAL_FEED_ENABLED: false,
  });
  assert.equal(payload.data.costControls.photoUploadsEnabled, false);
  assert.equal(payload.data.costControls.photoMaxBytes, 1_048_576);
  assert.equal(payload.data.costControls.photoDailyLimit, 12);
  assert.equal(payload.data.costControls.enforcement, "worker-session-plus-ip");
  assert.equal(payload.data.dimensionSettings.find((setting) => setting.settingKey === "parking")?.defaultTtlSeconds, 900);
  assert.equal(payload.meta?.storage, "memory");
});

test("Worker province scope includes existing city-level places and keeps empty regions empty", async () => {
  const anonymousId = "anon_nationwide_region_scope_test";
  const gyeongbuk = await get<SuccessPayload<Place[]>>("https://api.test/api/places?regionId=gyeongbuk&limit=100", anonymousId);
  const gyeongnam = await get<SuccessPayload<Place[]>>("https://api.test/api/places?regionId=gyeongnam&limit=100", anonymousId);
  const nationwide = await get<SuccessPayload<Place[]>>("https://api.test/api/places?regionId=nationwide&limit=100", anonymousId);

  assert.deepEqual(gyeongbuk.data.map((place) => place.id), ["gyeongju-hwangridan"]);
  assert.deepEqual(gyeongnam.data, []);
  assert.ok(nationwide.data.length >= gyeongbuk.data.length);
});

test("D1 province scope uses the same city-to-province mapping", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/places?regionId=gyeongbuk&limit=100", {
        headers: { "x-silsigan-anon-id": "anon_d1_nationwide_region_scope" },
      }),
      { DB: db },
    );
    const payload = (await response.json()) as SuccessPayload<Place[]>;

    assert.equal(response.status, 200);
    assert.deepEqual(payload.data.map((place) => place.id), ["gyeongju-hwangridan"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Worker runtime config applies a D1 region feature override", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    await db
      .prepare("INSERT INTO feature_flags (scope_type, scope_key, flag_key, enabled) VALUES ('region', ?, 'QNA_ENABLED', 1)")
      .bind("busan")
      .run();
    const response = await worker.handleRequest(new Request("https://api.test/api/config?regionCode=busan"), {
      DB: db,
      ENVIRONMENT: "staging",
    });
    assert.equal(response.status, 200);

    const payload = (await response.json()) as SuccessPayload<{
      dataMode: string;
      featureFlags: Record<string, boolean>;
    }>;
    assert.equal(payload.data.dataMode, "live");
    assert.equal(payload.data.featureFlags.QNA_ENABLED, true);
    assert.equal(payload.data.featureFlags.REWARDS_ENABLED, false);
    assert.equal(payload.meta?.storage, "d1");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("public source registry is redacted and fail-closed until rights and health are approved", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const response = await worker.handleRequest(new Request("https://api.test/api/sources"), {
      DB: db,
      ENVIRONMENT: "staging",
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as SuccessPayload<Array<{
      sourceKey: string;
      activationStatus: string;
      commercialUseStatus: string;
      enabled: boolean;
      healthStatus: string;
    }>>;
    const userReport = payload.data.find((source) => source.sourceKey === "user_report");
    const kma = payload.data.find((source) => source.sourceKey === "kma_weather");
    const tour = payload.data.find((source) => source.sourceKey === "tour_api");

    assert.equal(userReport?.activationStatus, "active");
    assert.equal(kma?.commercialUseStatus, "allowed_with_attribution");
    assert.equal(kma?.enabled, false);
    assert.equal(kma?.activationStatus, "inactive");
    assert.equal(tour?.commercialUseStatus, "pending");
    assert.equal(tour?.activationStatus, "awaiting_rights");
    assert.equal(JSON.stringify(payload).includes("ownerContact"), false);
    assert.equal(JSON.stringify(payload).includes("internalNote"), false);
    assert.equal(JSON.stringify(payload).includes("baseUrl"), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("source health updates require an operator and immediately affect public activation", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const unauthorized = await rawD1AdminPost(db, "https://api.test/api/admin/sources/user_report/health", {
      status: "down",
      message: "fixture outage",
      responseTimeMs: 900,
    });
    assert.equal(unauthorized.status, 403);

    const updated = await d1AdminPost<SuccessPayload<{
      sourceKey: string;
      status: string;
      responseTimeMs: number;
    }>>(
      db,
      "https://api.test/api/admin/sources/user_report/health",
      { status: "down", message: "fixture outage", responseTimeMs: 900 },
      {},
      "test-operator-token",
    );
    assert.equal(updated.data.sourceKey, "user_report");
    assert.equal(updated.data.status, "down");

    const health = await d1AdminGet<SuccessPayload<Array<{ sourceKey: string; status: string; message: string | null }>>>(
      db,
      "https://api.test/api/admin/sources/health?limit=10",
    );
    assert.equal(health.data[0]?.sourceKey, "user_report");
    assert.equal(health.data[0]?.status, "down");
    assert.equal(health.data[0]?.message, "fixture outage");

    const sources = await d1Get<SuccessPayload<Array<{ sourceKey: string; activationStatus: string; healthStatus: string }>>>(
      db,
      "https://api.test/api/sources",
      "anon_source_health_test",
    );
    const userReport = sources.data.find((source) => source.sourceKey === "user_report");
    assert.equal(userReport?.healthStatus, "down");
    assert.equal(userReport?.activationStatus, "unhealthy");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("source policy activation requires admin rights review health region and audit evidence", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const reviewedAt = "2026-07-10T00:00:00.000Z";
  const kmaPolicy = {
    commercialUseStatus: "allowed_with_attribution",
    enabled: true,
    agreementRequired: false,
    imageUseAllowed: false,
    videoUseAllowed: false,
    enabledRegions: ["*"],
    attributionText: "기상청",
    ownerContact: "data-operations",
    internalNote: "official data portal terms reviewed",
    rightsReviewedAt: reviewedAt,
    defaultTtlSeconds: 1_800,
  };

  try {
    const operatorDenied = await worker.handleRequest(
      new Request("https://api.test/api/admin/sources/kma_weather", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-operator-token",
        },
        body: JSON.stringify(kmaPolicy),
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens },
    );
    assert.equal(operatorDenied.status, 403);

    const pendingActivation = await worker.handleRequest(
      new Request("https://api.test/api/admin/sources/tour_api", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-admin-token",
        },
        body: JSON.stringify({
          ...kmaPolicy,
          commercialUseStatus: "pending",
          attributionText: "한국관광공사",
          defaultTtlSeconds: null,
        }),
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens },
    );
    const pendingPayload = (await pendingActivation.json()) as FailurePayload;
    assert.equal(pendingActivation.status, 409);
    assert.equal(pendingPayload.error.code, "SOURCE_RIGHTS_REQUIRED");

    await db.prepare("UPDATE data_sources SET health_status = 'healthy' WHERE source_key = 'kma_weather'").run();
    const activated = await worker.handleRequest(
      new Request("https://api.test/api/admin/sources/kma_weather", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-admin-token",
          "x-silsigan-admin-subject": "source-owner@example.test",
        },
        body: JSON.stringify(kmaPolicy),
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens },
    );
    assert.equal(activated.status, 200);
    const activatedPayload = (await activated.json()) as SuccessPayload<{
      sourceKey: string;
      enabled: boolean;
      enabledRegions: string[];
      rightsReviewedAt: string;
    }>;
    assert.equal(activatedPayload.data.sourceKey, "kma_weather");
    assert.equal(activatedPayload.data.enabled, true);
    assert.deepEqual(activatedPayload.data.enabledRegions, ["*"]);
    assert.equal(activatedPayload.data.rightsReviewedAt, reviewedAt);

    const sources = await d1Get<SuccessPayload<Array<{ sourceKey: string; activationStatus: string }>>>(
      db,
      "https://api.test/api/sources",
      "anon_source_policy_test",
    );
    assert.equal(sources.data.find((source) => source.sourceKey === "kma_weather")?.activationStatus, "active");

    const audit = await db.prepare(`
      SELECT action_type AS actionType, target_type AS targetType, target_id AS targetId
      FROM admin_actions
      WHERE action_type = 'source_policy_updated'
    `).first<{ actionType: string; targetType: string; targetId: string }>();
    assert.equal(audit?.targetType, "data_source");
    assert.equal(audit?.targetId, "source-kma-weather");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("KMA ingestion stays disabled until approved and then persists hashed official evidence", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  const serviceKey = "kma-fixture-secret-key";
  let fetchCount = 0;

  try {
    const providerKst = new Date(Date.now() + 9 * 60 * 60 * 1_000 - 5 * 60 * 1_000);
    const baseDate = `${providerKst.getUTCFullYear()}${String(providerKst.getUTCMonth() + 1).padStart(2, "0")}${String(providerKst.getUTCDate()).padStart(2, "0")}`;
    const baseTime = `${String(providerKst.getUTCHours()).padStart(2, "0")}${String(providerKst.getUTCMinutes()).padStart(2, "0")}`;
    const expectedObservedAt = new Date(
      `${baseDate.slice(0, 4)}-${baseDate.slice(4, 6)}-${baseDate.slice(6, 8)}T${baseTime.slice(0, 2)}:${baseTime.slice(2, 4)}:00+09:00`,
    ).toISOString();
    const requestBody = {
      placeId: "busan-gwangalli",
      nx: 98,
      ny: 76,
      baseDate,
      baseTime,
    };
    const disabled = await worker.handleRequest(
      new Request("https://api.test/api/admin/sources/kma_weather/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-operator-token",
        },
        body: JSON.stringify(requestBody),
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens, KMA_SERVICE_KEY: serviceKey },
    );
    const disabledPayload = (await disabled.json()) as FailurePayload;
    assert.equal(disabled.status, 409);
    assert.equal(disabledPayload.error.code, "SOURCE_NOT_ACTIVE");

    await db.prepare("UPDATE data_sources SET enabled = 1, health_status = 'healthy' WHERE source_key = 'kma_weather'").run();
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      fetchCount += 1;
      const requestedUrl = String(input);
      assert.equal(requestedUrl.includes(serviceKey), true);
      return Response.json({
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
          body: {
            totalCount: 4,
            items: {
              item: [
                { baseDate, baseTime, category: "T1H", nx: 98, ny: 76, obsrValue: "26.4" },
                { baseDate, baseTime, category: "RN1", nx: 98, ny: 76, obsrValue: "0" },
                { baseDate, baseTime, category: "WSD", nx: 98, ny: 76, obsrValue: "2.1" },
                { baseDate, baseTime, category: "PTY", nx: 98, ny: 76, obsrValue: "0" },
              ],
            },
          },
        },
      });
    };

    const ingest = (dailyLimit?: string) => worker.handleRequest(
      new Request("https://api.test/api/admin/sources/kma_weather/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-operator-token",
        },
        body: JSON.stringify(requestBody),
      }),
      {
        DB: db,
        ADMIN_TOKENS: testAdminTokens,
        KMA_SERVICE_KEY: serviceKey,
        ...(dailyLimit ? { KMA_GLOBAL_DAILY_CALL_LIMIT: dailyLimit } : {}),
      },
    );
    const first = await ingest();
    const firstPayload = (await first.json()) as SuccessPayload<{
      sourceKey: string;
      placeId: string;
      normalizedCount: number;
      observedAt: string;
      status: { currentSignals: Array<{ sourceName: string; observedAt: string }> };
    }>;
    assert.equal(first.status, 201);
    assert.equal(firstPayload.data.sourceKey, "kma_weather");
    assert.equal(firstPayload.data.normalizedCount, 1);
    assert.equal(firstPayload.data.observedAt, expectedObservedAt);
    assert.equal(firstPayload.data.status.currentSignals.some((signal) => signal.sourceName.includes("기상청")), true);

    const signal = await db.prepare(`
      SELECT source_id AS sourceId, source_type AS sourceType, observed_at AS observedAt, fetched_at AS fetchedAt,
             expires_at AS expiresAt, idempotency_key AS idempotencyKey
      FROM live_signals
      WHERE source_id = 'source-kma-weather'
    `).first<{
      sourceId: string;
      sourceType: string;
      observedAt: string;
      fetchedAt: string;
      expiresAt: string;
      idempotencyKey: string;
    }>();
    assert.equal(signal?.sourceType, "official_periodic");
    assert.equal(signal?.observedAt, expectedObservedAt);
    assert.notEqual(signal?.observedAt, signal?.fetchedAt);
    assert.equal(Date.parse(signal?.expiresAt ?? "") - Date.parse(signal?.observedAt ?? ""), 1_800_000);
    assert.equal(signal?.idempotencyKey.includes(serviceKey), false);

    const evidence = await db.prepare(`
      SELECT raw_payload_hash AS rawPayloadHash, provider_observed_at AS providerObservedAt
      FROM official_observations
      WHERE source_id = 'source-kma-weather'
    `).first<{ rawPayloadHash: string; providerObservedAt: string }>();
    assert.match(evidence?.rawPayloadHash ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.equal(evidence?.providerObservedAt, expectedObservedAt);
    assert.equal(JSON.stringify(firstPayload).includes(serviceKey), false);

    const second = await ingest();
    assert.equal(second.status, 201);
    const signalCount = await db.prepare("SELECT COUNT(*) AS count FROM live_signals WHERE source_id = 'source-kma-weather'").first<{ count: number }>();
    assert.equal(signalCount?.count, 1);
    assert.equal(fetchCount, 2);

    const quotaBlocked = await ingest("2");
    const quotaBlockedPayload = (await quotaBlocked.json()) as FailurePayload;
    assert.equal(quotaBlocked.status, 429);
    assert.equal(quotaBlockedPayload.error.code, "KMA_DAILY_QUOTA_EXCEEDED");
    assert.equal(fetchCount, 2);

    const quotaRun = await db.prepare(`
      SELECT status, error_code AS errorCode
      FROM api_ingestion_runs
      WHERE status = 'quota_exceeded'
      ORDER BY started_at DESC
      LIMIT 1
    `).first<{ status: string; errorCode: string }>();
    assert.equal(quotaRun?.errorCode, "KMA_DAILY_QUOTA_EXCEEDED");
    const providerUsage = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM metered_usage_events
      WHERE scope = 'provider:kma:ultra-nowcast'
    `).first<{ count: number }>();
    assert.equal(providerUsage?.count, 2);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("official ingestion targets are admin-managed and scheduled execution stays fail-closed", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  const serviceKey = "kma-scheduler-fixture-key";
  let fetchCount = 0;

  try {
    await db.prepare(`
      UPDATE data_sources
      SET commercial_use_status = 'allowed_with_attribution', attribution_text = '기상청',
          enabled = 1, enabled_regions_json = '["*"]', health_status = 'healthy', default_ttl_seconds = 1_800,
          refresh_interval_seconds = 1_800
      WHERE source_key = 'kma_weather'
    `).run();

    const targetResponse = await worker.handleRequest(
      new Request("https://api.test/api/admin/sources/kma_weather/ingestion-targets/busan-weather", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-admin-token",
          "x-silsigan-admin-subject": "data-operator@example.test",
        },
        body: JSON.stringify({
          placeId: "busan-gwangalli",
          query: { nx: 98, ny: 76, useLatestKmaNowcast: true },
          nextRunAt: "2026-07-13T00:00:00.000Z",
        }),
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens },
    );
    assert.equal(targetResponse.status, 201);

    const listed = await d1AdminGet<SuccessPayload<{
      sourceKey: string;
      targets: Array<{ targetKey: string; placeId: string; query: { nx: number; ny: number; useLatestKmaNowcast: boolean } }>;
    }>>(db, "https://api.test/api/admin/sources/kma_weather/ingestion-targets");
    assert.equal(listed.data.sourceKey, "kma_weather");
    assert.deepEqual(listed.data.targets[0]?.query, { nx: 98, ny: 76, useLatestKmaNowcast: true });

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      fetchCount += 1;
      const requestedUrl = new URL(String(input));
      assert.equal(requestedUrl.searchParams.get("ServiceKey"), serviceKey);
      return Response.json({
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
          body: {
            totalCount: 4,
            items: {
              item: [
                { baseDate: "20260713", baseTime: "0850", category: "T1H", nx: 98, ny: 76, obsrValue: "26.4" },
                { baseDate: "20260713", baseTime: "0850", category: "RN1", nx: 98, ny: 76, obsrValue: "0" },
                { baseDate: "20260713", baseTime: "0850", category: "WSD", nx: 98, ny: 76, obsrValue: "2.1" },
                { baseDate: "20260713", baseTime: "0850", category: "PTY", nx: 98, ny: 76, obsrValue: "0" },
              ],
            },
          },
        },
      });
    };

    await worker.default.scheduled(
      { cron: "*/5 * * * *", type: "scheduled", scheduledTime: Date.parse("2026-07-13T00:03:00.000Z") },
      { DB: db, KMA_SERVICE_KEY: serviceKey, OFFICIAL_INGESTION_SCHEDULER_ENABLED: "false" },
    );
    assert.equal(fetchCount, 0);

    await worker.default.scheduled(
      { cron: "*/5 * * * *", type: "scheduled", scheduledTime: Date.parse("2026-07-13T00:03:00.000Z") },
      { DB: db, KMA_SERVICE_KEY: serviceKey, OFFICIAL_INGESTION_SCHEDULER_ENABLED: "true" },
    );
    assert.equal(fetchCount, 1);

    const target = await db.prepare(`
      SELECT last_status AS lastStatus, last_error_code AS lastErrorCode, next_run_at AS nextRunAt, lease_token AS leaseToken
      FROM official_ingestion_targets
      WHERE target_key = 'busan-weather'
    `).first<{ lastStatus: string; lastErrorCode: string | null; nextRunAt: string; leaseToken: string | null }>();
    assert.equal(target?.lastStatus, "succeeded");
    assert.equal(target?.lastErrorCode, null);
    assert.equal(target?.leaseToken, null);
    assert.equal(Date.parse(target?.nextRunAt ?? "") > Date.parse("2026-07-13T00:03:00.000Z"), true);

    await worker.default.scheduled(
      { cron: "*/5 * * * *", type: "scheduled", scheduledTime: Date.parse("2026-07-13T00:03:00.000Z") },
      { DB: db, KMA_SERVICE_KEY: serviceKey, OFFICIAL_INGESTION_SCHEDULER_ENABLED: "true" },
    );
    assert.equal(fetchCount, 1);

    const deleted = await worker.handleRequest(
      new Request("https://api.test/api/admin/sources/kma_weather/ingestion-targets/busan-weather", {
        method: "DELETE",
        headers: { "x-silsigan-admin-token": "test-admin-token" },
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens },
    );
    assert.equal(deleted.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("official static ingestion creates a source mapping without creating a current signal", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  const serviceKey = "tour-fixture-secret-key";

  try {
    await db.prepare(`
      UPDATE data_sources
      SET commercial_use_status = 'allowed_with_attribution', attribution_text = '한국관광공사',
          enabled = 1, enabled_regions_json = '["*"]', health_status = 'healthy'
      WHERE source_key = 'tour_api'
    `).run();
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      assert.equal(String(input).includes(serviceKey), true);
      return Response.json({
        response: {
          header: { resultCode: "0000", resultMsg: "OK" },
          body: {
            totalCount: 1,
            items: { item: [{
              contentid: "126508",
              title: "광안리해수욕장",
              addr1: "부산광역시 수영구 광안해변로 219",
              mapx: "129.1185509",
              mapy: "35.1531696",
              modifiedtime: "20260710083000",
            }] },
          },
        },
      });
    };

    const response = await worker.handleRequest(
      new Request("https://api.test/api/admin/sources/tour_api/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-operator-token",
        },
        body: JSON.stringify({
          placeId: "busan-gwangalli",
          externalId: "126508",
          matchMethod: "manual",
          manuallyVerified: true,
          areaCode: "6",
          contentTypeId: "12",
          pageNo: 1,
          numOfRows: 10,
        }),
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens, TOUR_API_SERVICE_KEY: serviceKey },
    );
    assert.equal(response.status, 201);
    const payload = (await response.json()) as SuccessPayload<{
      sourceKey: string;
      placeId: string;
      externalId: string;
      metadataOnly: boolean;
      currentSignalCreated: boolean;
    }>;
    assert.equal(payload.data.sourceKey, "tour_api");
    assert.equal(payload.data.metadataOnly, true);
    assert.equal(payload.data.currentSignalCreated, false);

    const mapping = await db.prepare(`
      SELECT place_id AS placeId, external_name AS externalName, manually_verified AS manuallyVerified
      FROM place_source_mappings
      WHERE source_id = 'source-tour-api' AND external_place_id = '126508'
    `).first<{ placeId: string; externalName: string; manuallyVerified: number }>();
    assert.equal(mapping?.placeId, "busan-gwangalli");
    assert.equal(mapping?.externalName, "광안리해수욕장");
    assert.equal(mapping?.manuallyVerified, 1);
    const liveCount = await db.prepare("SELECT COUNT(*) AS count FROM live_signals WHERE source_id = 'source-tour-api'").first<{ count: number }>();
    assert.equal(liveCount?.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("national traffic ingestion persists one estimated speed signal with provider time and idempotency", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  const serviceKey = "its-fixture-secret-key";
  let fetchCount = 0;

  try {
    await db.prepare(`
      UPDATE data_sources
      SET commercial_use_status = 'allowed_with_attribution', attribution_text = '국토교통부',
          enabled = 1, enabled_regions_json = '["*"]', health_status = 'healthy', default_ttl_seconds = 600
      WHERE source_key = 'national_traffic'
    `).run();
    const providerKst = new Date(Date.now() + 9 * 60 * 60 * 1_000 - 5 * 60 * 1_000);
    const createdDate = [
      providerKst.getUTCFullYear(),
      String(providerKst.getUTCMonth() + 1).padStart(2, "0"),
      String(providerKst.getUTCDate()).padStart(2, "0"),
      String(providerKst.getUTCHours()).padStart(2, "0"),
      String(providerKst.getUTCMinutes()).padStart(2, "0"),
      String(providerKst.getUTCSeconds()).padStart(2, "0"),
    ].join("");
    const expectedObservedAt = new Date(
      `${createdDate.slice(0, 4)}-${createdDate.slice(4, 6)}-${createdDate.slice(6, 8)}T${createdDate.slice(8, 10)}:${createdDate.slice(10, 12)}:${createdDate.slice(12, 14)}+09:00`,
    ).toISOString();
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      fetchCount += 1;
      const requestedUrl = new URL(String(input));
      assert.equal(requestedUrl.searchParams.get("apiKey"), serviceKey);
      assert.equal(requestedUrl.searchParams.get("type"), "all");
      return Response.json({
        response: {
          header: { resultCode: "0", resultMsg: "SUCCESS" },
          body: {
            totalCount: "2",
            items: { item: [
              { roadName: "광안대로", linkId: "2600012400", speed: "42", travelTime: "88.1", createdDate },
              { roadName: "다른 도로", linkId: "2600099999", speed: "12", travelTime: "120", createdDate },
            ] },
          },
        },
      });
    };
    const requestBody = {
      placeId: "busan-gwangalli",
      linkId: "2600012400",
      roadType: "all",
      minLng: 129.1,
      maxLng: 129.14,
      minLat: 35.14,
      maxLat: 35.17,
    };
    const ingest = () => worker.handleRequest(
      new Request("https://api.test/api/admin/sources/national_traffic/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-operator-token",
        },
        body: JSON.stringify(requestBody),
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens, ITS_SERVICE_KEY: serviceKey },
    );

    const first = await ingest();
    assert.equal(first.status, 201);
    const firstPayload = (await first.json()) as SuccessPayload<{
      sourceKey: string;
      linkId: string;
      observedAt: string;
      isEstimated: boolean;
    }>;
    assert.equal(firstPayload.data.sourceKey, "national_traffic");
    assert.equal(firstPayload.data.linkId, "2600012400");
    assert.equal(firstPayload.data.observedAt, expectedObservedAt);
    assert.equal(firstPayload.data.isEstimated, true);

    const signal = await db.prepare(`
      SELECT value_code AS valueCode, value_number AS valueNumber, unit, is_estimated AS isEstimated,
             observed_at AS observedAt, expires_at AS expiresAt, idempotency_key AS idempotencyKey
      FROM live_signals
      WHERE source_id = 'source-national-traffic'
    `).first<{
      valueCode: string;
      valueNumber: number;
      unit: string;
      isEstimated: number;
      observedAt: string;
      expiresAt: string;
      idempotencyKey: string;
    }>();
    assert.equal(signal?.valueCode, "slow");
    assert.equal(signal?.valueNumber, 42);
    assert.equal(signal?.unit, "km/h");
    assert.equal(signal?.isEstimated, 1);
    assert.equal(signal?.observedAt, expectedObservedAt);
    assert.equal(Date.parse(signal?.expiresAt ?? "") - Date.parse(signal?.observedAt ?? ""), 600_000);
    assert.equal(signal?.idempotencyKey.includes(serviceKey), false);

    const second = await ingest();
    assert.equal(second.status, 201);
    const count = await db.prepare("SELECT COUNT(*) AS count FROM live_signals WHERE source_id = 'source-national-traffic'").first<{ count: number }>();
    assert.equal(count?.count, 1);
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging and production reject memory fallback when D1 is unavailable", async () => {
  for (const environment of ["staging", "production"]) {
    const response = await worker.handleRequest(new Request("https://api.test/api/places"), { ENVIRONMENT: environment });
    assert.equal(response.status, 503);
    const payload = (await response.json()) as FailurePayload;
    assert.equal(payload.error.code, "PERSISTENT_STORE_REQUIRED");
    assert.equal(JSON.stringify(payload).includes(environment), false);
  }
});

test("Cloudflare Worker serves posts and hashtags without Next.js mock APIs", async () => {
  const anonymousId = "anon_posts_questions_test";
  const postsPayload = await get<SuccessPayload<FeedPost[]>>("https://api.test/api/posts?regionId=seoul&limit=10", anonymousId);
  assert.equal(postsPayload.meta?.storage, "memory-fallback");
  assert.equal(postsPayload.data.length >= 1, true);
  assert.equal(postsPayload.data.every((postItem) => postItem.placeId === "seoul-yeouido"), true);
  assert.equal(postsPayload.data.every((postItem) => !postItem.userId.startsWith("anon_")), true);
  assert.equal(postsPayload.data[0]?.hashtags.some((tag) => tag.name === "서울"), true);
  assert.match(postsPayload.data[0]?.shareCard.headline ?? "", /여의도 한강공원/);

  const configuredShareResponse = await worker.handleRequest(
    new Request("https://api.test/api/posts?regionId=seoul&limit=10"),
    { ENVIRONMENT: "development", PUBLIC_SITE_URL: "https://staging.example" },
  );
  const configuredSharePayload = (await configuredShareResponse.json()) as SuccessPayload<FeedPost[]>;
  assert.equal(configuredShareResponse.status, 200);
  assert.match(configuredSharePayload.data[0]?.shareCard.url ?? "", /^https:\/\/staging\.example\/place\//);

  const hashtagsPayload = await get<SuccessPayload<Array<{ name: string; postCount: number }>>>("https://api.test/api/hashtags", anonymousId);
  assert.equal(hashtagsPayload.data.some((tag) => tag.name === "서울" && tag.postCount >= 1), true);

  const filteredPayload = await get<SuccessPayload<FeedPost[]>>(
    "https://api.test/api/posts?hashtagName=%EC%84%9C%EC%9A%B8&limit=10",
    anonymousId,
  );
  assert.equal(filteredPayload.data.every((postItem) => postItem.hashtagNames.includes("서울")), true);

});

test("QNA routes fail closed while the launch feature flag is disabled", async () => {
  for (const request of [
    new Request("https://api.test/api/questions?regionId=seoul"),
    new Request("https://api.test/api/my-questions"),
    new Request("https://api.test/api/questions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        placeId: "seoul-yeouido",
        questionType: "crowd",
        body: "지금 잔디밭 자리 여유 있나요?",
        availableCredits: 3,
      }),
    }),
  ]) {
    const response = await worker.handleRequest(request, {});
    const payload = (await response.json()) as FailurePayload;
    assert.equal(response.status, 404);
    assert.equal(payload.error.code, "FEATURE_DISABLED");
  }
});

test("Cloudflare Worker reads places and rankings from D1 when DB binding is present", async () => {
  const db = new FakeD1Database([
    {
      id: "d1-place",
      name: "D1 현장",
      categoryId: "tourism",
      areaId: "busan-suyeong",
      regionId: "busan",
      latitude: 35.1,
      longitude: 129.1,
      score: 101,
      status: "active",
      coordinateStatus: "verified",
    },
    {
      id: "d1-other",
      name: "다른 현장",
      categoryId: "tourism",
      areaId: "seoul-yeongdeungpo",
      regionId: "seoul",
      latitude: 37.5,
      longitude: 126.9,
      score: 30,
      status: "beta",
      coordinateStatus: "verified",
    },
  ]);

  const placesResponse = await worker.handleRequest(new Request("https://api.test/api/places?regionId=busan&limit=10"), { DB: db });
  const placesPayload = (await placesResponse.json()) as SuccessPayload<Place[]>;
  assert.equal(placesResponse.status, 200);
  assert.equal(placesPayload.meta?.storage, "d1");
  assert.deepEqual(
    placesPayload.data.map((place) => place.id),
    ["d1-place"],
  );

  const radiusResponse = await worker.handleRequest(new Request("https://api.test/api/places?lat=35.1&lng=129.1&radius=1000&limit=10"), { DB: db });
  const radiusPayload = (await radiusResponse.json()) as SuccessPayload<Place[]>;
  assert.equal(radiusPayload.meta?.storage, "d1");
  assert.equal(radiusPayload.meta?.radiusApplied, true);
  assert.deepEqual(
    radiusPayload.data.map((place) => place.id),
    ["d1-place"],
  );

  const placeResponse = await worker.handleRequest(new Request("https://api.test/api/places/d1-place"), { DB: db });
  const placePayload = (await placeResponse.json()) as SuccessPayload<Place>;
  assert.equal(placePayload.meta?.source, "d1");
  assert.equal(placePayload.data.score, 101);

  const rankingsResponse = await worker.handleRequest(new Request("https://api.test/api/rankings/regions/busan?limit=10"), { DB: db });
  const rankingsPayload = (await rankingsResponse.json()) as SuccessPayload<Ranking[]>;
  assert.equal(rankingsPayload.meta?.storage, "d1");
  assert.deepEqual(rankingsPayload.data, [
    {
      placeId: "d1-place",
      name: "D1 현장",
      regionId: "busan",
      regionCode: "busan",
      areaCode: "busan-suyeong",
      category: "tourism",
      score: 101,
      rank: 1,
      windowHours: 24,
      clickCount: 0,
      likeCount: 0,
      commentCount: 0,
      photoCount: 0,
      reportCount: 0,
      uniqueUserCount: 0,
      trend: "same",
      summary: "정보 없음",
    },
  ]);
});

test("D1 core seed SQL is idempotent", { skip: !sqlite3Available() }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-seed-"));
  const dbPath = join(tempDir, "seed.db");
  const schema = readFileSync(new URL("../workers/api/src/db/schema.sql", import.meta.url), "utf8");
  const seed = readFileSync(new URL("../workers/api/seeds/001_core_seed.sql", import.meta.url), "utf8");

  try {
    const output = execFileSync("sqlite3", [dbPath], {
      encoding: "utf8",
      input: `
        ${schema}
        ${seed}
        ${seed}
        SELECT 'places=' || COUNT(*) FROM places;
        SELECT 'rankings=' || COUNT(*) FROM place_rankings;
        SELECT 'posts=' || COUNT(*) FROM posts;
        SELECT 'questions=' || COUNT(*) FROM questions;
        SELECT 'profile_assignments=' || COUNT(*) FROM place_decision_profiles;
        SELECT 'todo=' || COUNT(*) FROM places WHERE coordinate_status = 'TODO_COORDINATE_VERIFY' AND latitude IS NULL AND longitude IS NULL;
      `,
    });

    assert.match(output, /places=6/);
    assert.match(output, /rankings=6/);
    assert.match(output, /posts=4/);
    assert.match(output, /questions=3/);
    assert.match(output, /profile_assignments=4/);
    assert.match(output, /todo=1/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 migration 0014 creates an isolated official-ingestion table idempotently", { skip: !sqlite3Available() }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-official-ingestion-"));
  const dbPath = join(tempDir, "official-ingestion.db");
  const migration = readFileSync(
    new URL("../workers/api/migrations/0014_official_ingestion_targets.sql", import.meta.url),
    "utf8",
  );

  try {
    const output = execFileSync("sqlite3", [dbPath], {
      encoding: "utf8",
      input: `
        PRAGMA foreign_keys = ON;
        ${migration}
        ${migration}
        SELECT 'official_ingestion_target_table=' || COUNT(*)
        FROM sqlite_schema
        WHERE type = 'table' AND name = 'official_ingestion_targets';
        SELECT 'official_ingestion_target_indexes=' || COUNT(*)
        FROM sqlite_schema
        WHERE type = 'index'
          AND name IN ('idx_official_ingestion_targets_due', 'idx_official_ingestion_targets_source_place');
      `,
    });

    assert.match(output, /official_ingestion_target_table=1/);
    assert.match(output, /official_ingestion_target_indexes=2/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 migration chain and core seed are release-order idempotent", { skip: !sqlite3Available() }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-migrations-"));
  const dbPath = join(tempDir, "migrations.db");
  const migrations = [
    "0001_initial.sql",
    "0002_posts_questions.sql",
    "0003_post_moderation_targets.sql",
    "0004_v2_foundation.sql",
    "0005_v2_signals.sql",
    "0006_trust_safety_identity.sql",
    "0007_field_report_moderation.sql",
    "0008_source_ingestion_targets.sql",
    "0009_field_report_photos.sql",
    "0010_cost_abuse_guard.sql",
    "0011_korea_sido_regions.sql",
    "0012_photo_cost_ceiling.sql",
    "0013_photo_upload_idempotency.sql",
    "0014_official_ingestion_targets.sql",
  ]
    .map((fileName) => readFileSync(new URL(`../workers/api/migrations/${fileName}`, import.meta.url), "utf8"))
    .join("\n");
  const seed = readFileSync(new URL("../workers/api/seeds/001_core_seed.sql", import.meta.url), "utf8");

  try {
    const output = execFileSync("sqlite3", [dbPath], {
      encoding: "utf8",
      input: `
        ${migrations}
        ${migrations}
        ${seed}
        ${seed}
        SELECT 'tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('regions', 'areas', 'places', 'place_rankings', 'posts', 'questions');
        SELECT 'post_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_posts_place_created', 'idx_posts_status_created');
        SELECT 'question_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_questions_place_created', 'idx_questions_anon_created');
        SELECT 'v2_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('profiles', 'identity_links', 'data_sources', 'place_source_mappings', 'dimension_settings', 'feature_flags', 'decision_profiles', 'decision_profile_dimensions', 'place_decision_profiles', 'live_signals', 'official_observations', 'aggregated_place_status');
        SELECT 'official_ingestion_target_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'official_ingestion_targets';
        SELECT 'official_ingestion_target_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_official_ingestion_targets_due', 'idx_official_ingestion_targets_source_place');
        SELECT 'trust_safety_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_moderation_states', 'report_votes', 'user_blocks', 'consents', 'terms_acceptances', 'account_deletion_requests', 'identity_link_events');
        SELECT 'field_report_moderation_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'field_report_moderation';
        SELECT 'field_report_photos_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'field_report_photos';
        SELECT 'field_report_photos_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_field_report_photos_photo', 'idx_field_report_photos_report');
        SELECT 'cost_guard_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('metered_usage_events', 'photo_upload_sessions');
        SELECT 'cost_guard_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_metered_usage_actor', 'idx_metered_usage_ip', 'idx_metered_usage_expiry', 'idx_photo_upload_sessions_expiry');
        SELECT 'photo_size_triggers=' || COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name IN ('trg_photos_max_byte_size_insert', 'trg_photos_max_byte_size_update');
        SELECT 'korea_sido_regions=' || COUNT(*) FROM regions WHERE parent_region_id IS NULL AND id IN ('seoul', 'busan', 'daegu', 'incheon', 'gwangju', 'daejeon', 'ulsan', 'sejong', 'gyeonggi', 'gangwon', 'chungbuk', 'chungnam', 'jeonbuk', 'jeonnam', 'gyeongbuk', 'gyeongnam', 'jeju');
        SELECT 'v2_flags=' || COUNT(*) FROM feature_flags WHERE scope_type = 'global' AND scope_key = '*' AND enabled = 0;
        SELECT 'parking_ttl=' || default_ttl_seconds FROM dimension_settings WHERE setting_key = 'parking';
        SELECT 'queue_ttl=' || default_ttl_seconds FROM dimension_settings WHERE setting_key = 'queue';
        SELECT 'photo_current_ttl=' || default_ttl_seconds FROM dimension_settings WHERE setting_key = 'photo_current';
        SELECT 'enabled_external_sources=' || COUNT(*) FROM data_sources WHERE enabled = 1 AND source_key != 'user_report';
        SELECT 'cctv_metadata_policy=' || source_type || ':' || video_use_allowed || ':' || agreement_required FROM data_sources WHERE source_key = 'national_cctv';
        SELECT 'tour_image_policy=' || image_use_allowed FROM data_sources WHERE source_key = 'tour_api';
        SELECT 'rights_owners=' || COUNT(*) FROM data_sources WHERE source_key != 'user_report' AND owner_contact IN ('data-operations', 'legal-safety');
        SELECT 'places=' || COUNT(*) FROM places;
        SELECT 'rankings=' || COUNT(*) FROM place_rankings;
        SELECT 'posts=' || COUNT(*) FROM posts;
        SELECT 'questions=' || COUNT(*) FROM questions;
      `,
    });

    assert.match(output, /tables=6/);
    assert.match(output, /post_indexes=2/);
    assert.match(output, /question_indexes=2/);
    assert.match(output, /v2_tables=12/);
    assert.match(output, /official_ingestion_target_table=1/);
    assert.match(output, /official_ingestion_target_indexes=2/);
    assert.match(output, /trust_safety_tables=7/);
    assert.match(output, /field_report_photos_table=1/);
    assert.match(output, /field_report_photos_indexes=2/);
    assert.match(output, /cost_guard_tables=2/);
    assert.match(output, /cost_guard_indexes=4/);
    assert.match(output, /photo_size_triggers=2/);
    assert.match(output, /korea_sido_regions=17/);
    assert.match(output, /v2_flags=7/);
    assert.match(output, /parking_ttl=900/);
    assert.match(output, /queue_ttl=1200/);
    assert.match(output, /photo_current_ttl=7200/);
    assert.match(output, /enabled_external_sources=0/);
    assert.match(output, /cctv_metadata_policy=official_static:0:1/);
    assert.match(output, /tour_image_policy=0/);
    assert.match(output, /rights_owners=7/);
    assert.match(output, /places=6/);
    assert.match(output, /rankings=6/);
    assert.match(output, /posts=4/);
    assert.match(output, /questions=3/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 field report migration backfills legacy reports as pending and hides their signals", { skip: !sqlite3Available() }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-field-report-migration-"));
  const dbPath = join(tempDir, "migration.db");
  const initialMigrations = [
    "0001_initial.sql",
    "0002_posts_questions.sql",
    "0003_post_moderation_targets.sql",
    "0004_v2_foundation.sql",
    "0005_v2_signals.sql",
    "0006_trust_safety_identity.sql",
  ]
    .map((fileName) => readFileSync(new URL(`../workers/api/migrations/${fileName}`, import.meta.url), "utf8"))
    .join("\n");
  const moderationMigration = readFileSync(new URL("../workers/api/migrations/0007_field_report_moderation.sql", import.meta.url), "utf8");
  const seed = readFileSync(new URL("../workers/api/seeds/001_core_seed.sql", import.meta.url), "utf8");

  try {
    const output = execFileSync("sqlite3", [dbPath], {
      encoding: "utf8",
      input: `
        ${initialMigrations}
        ${seed}
        INSERT INTO place_events (
          id, place_id, anonymous_user_id, event_type, source, region_code, area_code, category,
          crowd_level, created_at, expires_at
        ) VALUES (
          'field_report_legacy_no_moderation', 'busan-gwangalli', 'anon_seed_public', 'report',
          'field_report', 'busan', 'busan-suyeong', 'tourism', 'busy',
          '2026-07-13T00:00:00.000Z', '2026-07-13T01:00:00.000Z'
        );
        INSERT INTO live_signals (
          id, place_id, dimension, value_code, source_id, source_type, source_name,
          observed_at, fetched_at, expires_at, confidence_score, is_publicly_visible,
          evidence_type, evidence_id, actor_type, actor_id
        ) VALUES (
          'signal_legacy_field_report', 'busan-gwangalli', 'crowd', 'busy', 'source-user-report',
          'ugc', 'User field report', '2026-07-13T00:00:00.000Z', '2026-07-13T00:01:00.000Z',
          '2026-07-13T01:00:00.000Z', 0.5, 1, 'user_report',
          'field_report_legacy_no_moderation', 'anonymous', 'anon_seed_public'
        );
        ${moderationMigration}
        SELECT 'legacy_status=' || status FROM field_report_moderation WHERE report_id = 'field_report_legacy_no_moderation';
        SELECT 'legacy_signal_visibility=' || is_publicly_visible FROM live_signals WHERE evidence_id = 'field_report_legacy_no_moderation';
        ${moderationMigration}
        SELECT 'legacy_status_after_repeat=' || status FROM field_report_moderation WHERE report_id = 'field_report_legacy_no_moderation';
      `,
    });

    assert.match(output, /legacy_status=pending/);
    assert.match(output, /legacy_signal_visibility=0/);
    assert.match(output, /legacy_status_after_repeat=pending/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 field reports fail closed when the moderation row is missing", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const reportId = "field_report_legacy_runtime";
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
    await db
      .prepare(
        `INSERT INTO place_events (
          id, place_id, anonymous_user_id, event_type, source, region_code, area_code, category,
          crowd_level, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        reportId,
        "busan-gwangalli",
        "anon_seed_public",
        "report",
        "field_report",
        "busan",
        "busan-suyeong",
        "tourism",
        "busy",
        createdAt,
        expiresAt,
      )
      .run();

    const publicReports = await d1Get<SuccessPayload<Array<{ id: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&limit=10",
      "anon_d1_legacy_reader",
    );
    assert.equal(publicReports.data.some((report) => report.id === reportId), false);

    const pendingQueue = await d1AdminGet<SuccessPayload<Array<{ id: string; moderationStatus: string }>>>(
      db,
      "https://api.test/api/admin/field-reports?status=pending&limit=10",
    );
    const queuedReport = pendingQueue.data.find((report) => report.id === reportId);
    assert.equal(queuedReport?.id, reportId);
    assert.equal(queuedReport?.moderationStatus, "pending");

    const ranking = await d1Get<SuccessPayload<Ranking[]>>(
      db,
      "https://api.test/api/rankings/regions/busan?limit=10",
      "anon_d1_legacy_reader",
    );
    assert.equal(ranking.data.find((item) => item.placeId === "busan-gwangalli")?.reportCount, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 live signal schema rejects invalid expiry and accepts a valid current observation", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const insert = `
      INSERT INTO live_signals (
        id,
        place_id,
        dimension,
        value_code,
        source_id,
        source_type,
        source_name,
        observed_at,
        fetched_at,
        expires_at,
        confidence_score,
        is_publicly_visible
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await assert.rejects(
      db
        .prepare(insert)
        .bind(
          "signal-invalid-expiry",
          "busan-gwangalli",
          "crowd",
          "busy",
          "source-user-report",
          "ugc",
          "User field report",
          "2026-07-10T00:20:00.000Z",
          "2026-07-10T00:21:00.000Z",
          "2026-07-10T00:19:59.000Z",
          0.7,
          1,
        )
        .run(),
      /CHECK constraint failed/,
    );

    await db
      .prepare(insert)
      .bind(
        "signal-valid",
        "busan-gwangalli",
        "parking",
        "available",
        "source-user-report",
        "verified_ugc",
        "Verified field report",
        "2026-07-10T00:20:00.000Z",
        "2026-07-10T00:21:00.000Z",
        "2026-07-10T00:35:00.000Z",
        0.85,
        1,
      )
      .run();

    const row = await db
      .prepare("SELECT dimension, value_code AS valueCode, observed_at AS observedAt FROM live_signals WHERE id = ?")
      .bind("signal-valid")
      .first<{ dimension: string; valueCode: string; observedAt: string }>();
    assert.deepEqual(row, {
      dimension: "parking",
      valueCode: "available",
      observedAt: "2026-07-10T00:20:00.000Z",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 posts hashtags and questions use Cloudflare schema", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const anonymousId = "anon_d1_posts_questions";
    const postsPayload = await d1Get<SuccessPayload<FeedPost[]>>(db, "https://api.test/api/posts?regionId=seoul&limit=10", anonymousId);
    assert.equal(postsPayload.meta?.storage, "d1");
    assert.equal(postsPayload.data.some((postItem) => postItem.placeId === "seoul-yeouido"), true);
    assert.equal(postsPayload.data.every((postItem) => postItem.hiddenAt === null), true);

    const createdPost = await d1Post<SuccessPayload<{ post: FeedPost; credits: Array<{ amount: number }>; privacyNotice: string }>>(
      db,
      "https://api.test/api/posts",
      anonymousId,
      {
        placeId: "seoul-yeouido",
        crowdLevel: "normal",
        lineStatus: "short",
        parkingStatus: "limited",
        weatherFeel: "good",
        caption: "편의점 줄은 짧고 잔디밭은 아직 여유 있습니다.",
        photoCount: 1,
        hashtagNames: ["서울", "<script>bad</script>", "지금"],
      },
    );
    assert.equal(createdPost.meta?.storage, "d1");
    assert.equal(createdPost.data.post.placeId, "seoul-yeouido");
    assert.equal(createdPost.data.post.userId.startsWith("anon_"), false);
    assert.equal(createdPost.data.post.locationVerified, false);
    assert.equal(createdPost.data.post.isExpired, false);
    assert.equal(Date.parse(createdPost.data.post.expiresAt) - Date.parse(createdPost.data.post.createdAt), 3 * 60 * 60 * 1000);
    assert.match(createdPost.data.post.shareCard.body, /상태 제보/);
    assert.doesNotMatch(createdPost.data.post.shareCard.body, /현장 인증 제보/);
    assert.equal(createdPost.data.post.hashtagNames.includes("scriptbadscript"), true);
    assert.equal(createdPost.data.privacyNotice.includes("정확한 좌표"), true);
    assert.deepEqual(createdPost.data.credits, []);

    await db
      .prepare("UPDATE posts SET created_at = ?, updated_at = ? WHERE id = ?")
      .bind("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", createdPost.data.post.id)
      .run();
    const expiredPosts = await d1Get<SuccessPayload<FeedPost[]>>(
      db,
      "https://api.test/api/posts?placeId=seoul-yeouido&limit=20",
      anonymousId,
    );
    const expiredPost = expiredPosts.data.find((postItem) => postItem.id === createdPost.data.post.id);
    assert.equal(expiredPost?.isExpired, true);
    assert.equal(expiredPost?.expiresAt, "2026-01-01T03:00:00.000Z");

    const hashtagsPayload = await d1Get<SuccessPayload<Array<{ name: string; postCount: number }>>>(db, "https://api.test/api/hashtags", anonymousId);
    assert.equal(hashtagsPayload.meta?.storage, "d1");
    assert.equal(hashtagsPayload.data.some((tag) => tag.name === "서울" && tag.postCount >= 2), true);

    const postReport = await d1Post<SuccessPayload<{ id: string; targetType: string; targetId: string; status: string }>>(
      db,
      "https://api.test/api/moderation/reports",
      "anon_d1_post_reporter",
      {
        targetType: "post",
        targetId: createdPost.data.post.id,
        reason: "privacy_face",
      },
    );
    assert.equal(postReport.meta?.storage, "d1");
    assert.equal(postReport.data.targetType, "post");
    assert.equal(postReport.data.targetId, createdPost.data.post.id);
    assert.equal(postReport.data.status, "open");

    const postsAfterPostReport = await d1Get<SuccessPayload<FeedPost[]>>(
      db,
      "https://api.test/api/posts?placeId=seoul-yeouido&limit=20",
      anonymousId,
    );
    assert.equal(postsAfterPostReport.data.some((postItem) => postItem.id === createdPost.data.post.id), false);

    await db
      .prepare("UPDATE feature_flags SET enabled = 1 WHERE scope_type = 'global' AND scope_key = '*' AND flag_key = 'QNA_ENABLED'")
      .run();

    const createdQuestion = await d1Post<SuccessPayload<{ question: QuestionData; balance: number }>>(
      db,
      "https://api.test/api/questions",
      anonymousId,
      {
        placeId: "seoul-yeouido",
        questionType: "photo_request",
        body: "지금 한강 사진 요청 가능할까요?",
        availableCredits: 3,
      },
    );
    assert.equal(createdQuestion.meta?.storage, "d1");
    assert.equal(createdQuestion.data.question.creditCost, 2);
    assert.equal(createdQuestion.data.balance, 1);

    const mine = await d1Get<SuccessPayload<QuestionData[]>>(db, "https://api.test/api/my-questions", anonymousId);
    assert.equal(mine.data.some((question) => question.id === createdQuestion.data.question.id && question.status === "pending"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 public posts ignore includeHidden query parameter", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const anonymousId = "anon_d1_public_posts_hidden_guard";
    const createdPost = await d1Post<SuccessPayload<{ post: FeedPost; credits: Array<{ amount: number }>; privacyNotice: string }>>(
      db,
      "https://api.test/api/posts",
      anonymousId,
      {
        placeId: "seoul-yeouido",
        crowdLevel: "normal",
        lineStatus: "short",
        parkingStatus: "limited",
        weatherFeel: "good",
        caption: "숨김 공개 조회 방지 테스트입니다.",
        photoCount: 1,
        hashtagNames: ["서울", "숨김방지"],
      },
    );
    await db
      .prepare("UPDATE posts SET status = 'hidden', hidden_at = ?, updated_at = ? WHERE id = ?")
      .bind("2026-07-02T00:00:00.000Z", "2026-07-02T00:00:00.000Z", createdPost.data.post.id)
      .run();

    const visibleOnly = await d1Get<SuccessPayload<FeedPost[]>>(
      db,
      "https://api.test/api/posts?placeId=seoul-yeouido&includeHidden=true&limit=20",
      anonymousId,
    );

    assert.equal(visibleOnly.meta?.storage, "d1");
    assert.equal(visibleOnly.data.some((postItem) => postItem.id === createdPost.data.post.id), false);
    assert.equal(visibleOnly.data.every((postItem) => postItem.hiddenAt === null), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 public places and rankings exclude TODO_COORDINATE_VERIFY seed rows", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const direct = await db
      .prepare("SELECT coordinate_status AS coordinateStatus, latitude, longitude FROM places WHERE id = 'jeju-coordinate-review'")
      .first<{ coordinateStatus: string; latitude: number | null; longitude: number | null }>();
    assert.deepEqual(direct, {
      coordinateStatus: "TODO_COORDINATE_VERIFY",
      latitude: null,
      longitude: null,
    });

    const places = await d1Get<SuccessPayload<Place[]>>(db, "https://api.test/api/places?regionId=jeju&limit=10", "anon_d1_coordinate_test");
    assert.equal(places.meta?.storage, "d1");
    assert.equal(places.data.some((place) => place.id === "jeju-coordinate-review"), false);

    const rankings = await d1Get<SuccessPayload<Array<{ placeId: string }>>>(
      db,
      "https://api.test/api/rankings/regions/jeju?limit=10",
      "anon_d1_coordinate_test",
    );
    assert.equal(rankings.meta?.storage, "d1");
    assert.equal(rankings.data.some((ranking) => ranking.placeId === "jeju-coordinate-review"), false);

    const detail = await worker.handleRequest(new Request("https://api.test/api/places/jeju-coordinate-review"), { DB: db });
    assert.equal(detail.status, 404);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("operator coordinate status update controls public D1 place and ranking exposure", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const cache = new FakeKVNamespace();

  try {
    const anonymousId = "anon_d1_coordinate_admin";
    const placeId = "jeju-coordinate-review";

    const forbidden = await rawD1AdminPost(db, "https://api.test/api/admin/places/coordinate-status", {
      placeId,
      coordinateStatus: "verified",
      latitude: 33.4996,
      longitude: 126.5312,
      source: "manual source",
      reason: "권한 실패 테스트",
    });
    assert.equal(forbidden.status, 403);

    const invalidLatitude = await rawD1AdminPostWithToken(
      db,
      "https://api.test/api/admin/places/coordinate-status",
      {
        placeId,
        coordinateStatus: "verified",
        latitude: 123,
        longitude: 126.5312,
        source: "coordinate QA",
        reason: "범위 실패 테스트",
      },
      "test-operator-token",
    );
    const invalidPayload = (await invalidLatitude.json()) as FailurePayload;
    assert.equal(invalidLatitude.status, 400);
    assert.equal(invalidPayload.error.code, "VALIDATION_ERROR");

    const verified = await d1AdminPost<
      SuccessPayload<{
        placeId: string;
        coordinateStatus: string;
        latitude: number;
        longitude: number;
      }>
    >(
      db,
      "https://api.test/api/admin/places/coordinate-status",
      {
        placeId,
        coordinateStatus: "verified",
        latitude: 33.4996,
        longitude: 126.5312,
        source: "coordinate QA",
        reason: "제주 seed 좌표 검증",
      },
      { CACHE: cache },
      "test-operator-token",
    );
    assert.deepEqual(verified.data, {
      placeId,
      coordinateStatus: "verified",
      latitude: 33.4996,
      longitude: 126.5312,
    });
    assert.equal(cache.deletedKeys.includes("rankings:region:jeju"), true);
    assert.equal(cache.deletedKeys.includes(`places:${placeId}`), true);
    assert.equal(cache.deletedKeys.includes(`rankings:place:${placeId}`), true);

    const placesAfterVerify = await d1Get<SuccessPayload<Place[]>>(db, "https://api.test/api/places?regionId=jeju&limit=10", anonymousId);
    assert.equal(placesAfterVerify.data.some((place) => place.id === placeId && place.coordinateStatus === "verified"), true);

    const rankingsAfterVerify = await d1Get<SuccessPayload<Array<{ placeId: string }>>>(
      db,
      "https://api.test/api/rankings/regions/jeju?limit=10",
      anonymousId,
    );
    assert.equal(rankingsAfterVerify.data.some((ranking) => ranking.placeId === placeId), true);

    await d1AdminPost<SuccessPayload<{ coordinateStatus: string; latitude: null; longitude: null }>>(
      db,
      "https://api.test/api/admin/places/coordinate-status",
      {
        placeId,
        coordinateStatus: "rejected",
        source: "coordinate QA",
        reason: "검증 출처 불충분",
      },
      { CACHE: cache },
      "test-operator-token",
    );

    const rejectedRow = await db
      .prepare("SELECT coordinate_status AS coordinateStatus, latitude, longitude, is_active AS isActive FROM places WHERE id = ?")
      .bind(placeId)
      .first<{ coordinateStatus: string; latitude: number | null; longitude: number | null; isActive: number }>();
    assert.deepEqual(rejectedRow, {
      coordinateStatus: "rejected",
      latitude: null,
      longitude: null,
      isActive: 0,
    });

    const placesAfterReject = await d1Get<SuccessPayload<Place[]>>(db, "https://api.test/api/places?regionId=jeju&limit=10", anonymousId);
    assert.equal(placesAfterReject.data.some((place) => place.id === placeId), false);

    const actions = await db
      .prepare("SELECT action_type AS actionType, target_type AS targetType, target_id AS targetId, reason FROM admin_actions WHERE target_id = ? ORDER BY created_at ASC")
      .bind(placeId)
      .all<{ actionType: string; targetType: string; targetId: string; reason: string }>();
    assert.deepEqual(
      actions.results?.map((action) => ({
        actionType: action.actionType,
        targetType: action.targetType,
        targetId: action.targetId,
      })),
      [
        {
          actionType: "place_coordinate_status",
          targetType: "place",
          targetId: placeId,
        },
        {
          actionType: "place_coordinate_status",
          targetType: "place",
          targetId: placeId,
        },
      ],
    );
    assert.equal(actions.results?.every((action) => !action.reason.includes("33.4996") && !action.reason.includes("126.5312")), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare Worker persists user actions and moderation state to D1", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const anonymousId = "anon_d1_write_test";
    const comment = await d1Post<SuccessPayload<Comment>>(db, "https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: "D1 댓글 저장 테스트입니다.",
    });
    assert.equal(comment.meta?.storage, "d1");
    assert.equal(comment.data.ownedByCurrentSession, true);
    assert.equal("anonymousUserId" in comment.data, false);

    const comments = await d1Get<SuccessPayload<Comment[]>>(db, "https://api.test/api/comments?placeId=busan-gwangalli", anonymousId);
    assert.equal(comments.meta?.storage, "d1");
    assert.deepEqual(
      comments.data.map((item) => item.id),
      [comment.data.id],
    );

    const firstCommentLike = await d1Post<SuccessPayload<{ likeCount: number; created: boolean }>>(
      db,
      `https://api.test/api/comments/${comment.data.id}/like`,
      anonymousId,
      {},
    );
    const secondCommentLike = await d1Post<SuccessPayload<{ likeCount: number; created: boolean }>>(
      db,
      `https://api.test/api/comments/${comment.data.id}/like`,
      anonymousId,
      {},
    );
    assert.equal(firstCommentLike.data.created, true);
    assert.equal(secondCommentLike.data.created, false);
    assert.equal(secondCommentLike.data.likeCount, 1);

    const forbiddenCommentDelete = await rawD1Delete(db, `https://api.test/api/comments/${comment.data.id}`, "anon_d1_other_user");
    assert.equal(forbiddenCommentDelete.status, 403);

    const photo = await d1Post<SuccessPayload<PhotoCompleteData>>(db, "https://api.test/api/photos/complete", anonymousId, {
      uploadId: "upload_d1",
      placeId: "busan-gwangalli",
      byteSize: 100_000,
      mimeType: "image/webp",
      width: 800,
      height: 600,
      clientReencoded: true,
    });
    assert.equal(photo.meta?.storage, "d1");
    assert.equal(photo.data.photo.status, "pending");
    await d1AdminPost<SuccessPayload<{ decision: string }>>(
      db,
      `https://api.test/api/admin/photos/${photo.data.photo.id}/moderation`,
      { decision: "approved", reason: "D1 클릭 회귀 테스트 검수 승인" },
      {},
      "test-moderator-token",
    );

    const firstPhotoClick = await d1Post<SuccessPayload<{ clickCount: number; created: boolean }>>(
      db,
      `https://api.test/api/photos/${photo.data.photo.id}/click`,
      anonymousId,
      {},
    );
    const secondPhotoClick = await d1Post<SuccessPayload<{ clickCount: number; created: boolean }>>(
      db,
      `https://api.test/api/photos/${photo.data.photo.id}/click`,
      anonymousId,
      {},
    );
    assert.equal(firstPhotoClick.data.created, true);
    assert.equal(secondPhotoClick.data.created, false);
    assert.equal(secondPhotoClick.data.clickCount, 1);

    const placeLike = await d1Post<SuccessPayload<{ likeCount: number; created: boolean }>>(
      db,
      "https://api.test/api/places/busan-gwangalli/like",
      anonymousId,
      {},
    );
    const live = await d1Get<SuccessPayload<{ commentCount: number; photoCount: number; likeCount: number }>>(
      db,
      "https://api.test/api/places/busan-gwangalli/live",
      anonymousId,
    );
    assert.equal(placeLike.data.created, true);
    assert.equal(live.data.commentCount, 1);
    assert.equal(live.data.photoCount, 1);
    assert.equal(live.data.likeCount, 1);

    for (const reporter of ["anon_d1_reporter_a", "anon_d1_reporter_b", "anon_d1_reporter_c"]) {
      const thresholdReport = await d1Post<SuccessPayload<{ status: string }>>(db, "https://api.test/api/reports", reporter, {
        targetType: "comment",
        targetId: comment.data.id,
        reason: "false_content",
      });
      assert.equal(thresholdReport.data.status, "open");
    }

    const commentsAfterThreshold = await d1Get<SuccessPayload<Comment[]>>(
      db,
      "https://api.test/api/comments?placeId=busan-gwangalli",
      anonymousId,
    );
    assert.equal(commentsAfterThreshold.data.some((item) => item.id === comment.data.id), false);

    const report = await d1Post<SuccessPayload<{ id: string; status: string }>>(
      db,
      "https://api.test/api/moderation/reports",
      anonymousId,
      {
        targetType: "photo",
        targetId: photo.data.photo.id,
        reason: "privacy_face",
      },
    );
    assert.equal(report.meta?.storage, "d1");
    assert.equal(report.data.status, "open");

    const duplicateReport = await d1Post<SuccessPayload<{ id: string }>>(db, "https://api.test/api/reports", anonymousId, {
      targetType: "photo",
      targetId: photo.data.photo.id,
      reason: "privacy_face",
    });
    assert.equal(duplicateReport.data.id, report.data.id);

    const hiddenPhotos = await d1Get<SuccessPayload<Array<{ id: string }>>>(db, "https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
    assert.equal(hiddenPhotos.data.some((item) => item.id === photo.data.photo.id), false);

    const queue = await d1AdminGet<SuccessPayload<Array<{ id: string }>>>(db, "https://api.test/api/moderation/reports?status=open");
    assert.ok(queue.data.some((item) => item.id === report.data.id));

    const moderated = await d1AdminPost<SuccessPayload<{ id: string; status: string }>>(
      db,
      `https://api.test/api/moderation/reports/${report.data.id}/action`,
      {
        status: "accepted",
        reason: "얼굴 노출 신고 승인",
      },
    );
    assert.equal(moderated.data.status, "accepted");

    const adminActions = await db
      .prepare("SELECT action_type AS actionType FROM admin_actions WHERE target_id = ? ORDER BY created_at ASC")
      .bind(photo.data.photo.id)
      .all<{ actionType: string }>();
    assert.deepEqual(adminActions.results?.map((action) => action.actionType), ["photo_approved", "report_accepted"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 report creation sends a redacted moderation alert webhook", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  const sentRequests: Request[] = [];
  const waitUntilPromises: Array<Promise<unknown>> = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>): void {
      waitUntilPromises.push(promise);
    },
  };

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sentRequests.push(input instanceof Request ? input : new Request(input, init));
    return new Response(JSON.stringify({ ok: true }), { status: 202 });
  };

  try {
    const anonymousId = "anon_d1_alert_reporter";
    const comment = await d1Post<SuccessPayload<Comment>>(db, "https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: "알림 채널 테스트 댓글입니다.",
    });

    const response = await worker.handleRequest(
      new Request("https://api.test/api/moderation/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": anonymousId,
        },
        body: JSON.stringify({
          targetType: "comment",
          targetId: comment.data.id,
          reason: "sensitive_info",
          note: "연락처 010-1234-5678, reporter@example.com, real-camera-name.jpg",
        }),
      }),
      {
        DB: db,
        ENVIRONMENT: "staging",
        MODERATION_ALERT_WEBHOOK_URL: "https://alerts.example.test/silsigan/moderation",
        MODERATION_ALERT_WEBHOOK_TOKEN: "alert-token-fixture",
      },
      ctx,
    );
    const report = (await response.json()) as SuccessPayload<{ id: string }>;
    await Promise.all(waitUntilPromises);

    assert.equal(response.status, 201);
    assert.equal(report.meta?.alertChannel, "webhook");
    assert.equal(sentRequests.length, 1);
    assert.equal(sentRequests[0]?.url, "https://alerts.example.test/silsigan/moderation");
    assert.equal(sentRequests[0]?.headers.get("authorization"), "Bearer alert-token-fixture");

    const payload = (await sentRequests[0]?.json()) as ModerationAlertPayload;
    assert.deepEqual(payload, {
      type: "moderation.report.created",
      reportId: report.data.id,
      targetType: "comment",
      targetId: comment.data.id,
      reason: "sensitive_info",
      priority: "urgent",
      queuePath: "/api/moderation/reports?status=open",
      environment: "staging",
      createdAt: payload.createdAt,
    });

    const serializedPayload = JSON.stringify(payload);
    assert.equal(serializedPayload.includes(anonymousId), false);
    assert.equal(serializedPayload.includes("010-1234-5678"), false);
    assert.equal(serializedPayload.includes("reporter@example.com"), false);
    assert.equal(serializedPayload.includes("real-camera-name.jpg"), false);
    assert.equal("note" in payload, false);
    assert.equal("anonymousUserId" in payload, false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 field reports store coarse realtime status without client coordinates", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const anonymousId = "anon_d1_field_reporter";
    const legacyPhotoUrlResponse = await rawD1Post(db, "https://api.test/api/reports", anonymousId, {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      photoUrl: "https://images.example.test/gwangalli-status.webp",
    });
    const legacyPhotoUrlPayload = (await legacyPhotoUrlResponse.json()) as FailurePayload;
    assert.equal(legacyPhotoUrlResponse.status, 400);
    assert.equal(legacyPhotoUrlPayload.error.code, "PHOTO_ATTACHMENT_REQUIRED");

    const response = await rawD1Post(db, "https://api.test/api/reports", anonymousId, {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      lineStatus: "short",
      parkingStatus: "limited",
      weatherFeel: "windy",
      comment: "바람이 강하고 사람이 조금 많습니다.",
      clientLocation: {
        latitude: 35.1532,
        longitude: 129.1186,
      },
    });
    const payload = (await response.json()) as SuccessPayload<FieldReportData>;
    const serializedPayload = JSON.stringify(payload);

    assert.equal(response.status, 201);
    assert.equal(payload.meta?.storage, "d1");
    assert.equal(payload.meta?.locationPolicy, "clientLocation-used-only-for-distance-and-not-stored");
    assert.equal(payload.data.report.placeId, "busan-gwangalli");
    assert.equal(payload.data.report.verifiedRadiusM, 50);
    assert.equal(payload.data.report.moderationStatus, "pending");
    assert.deepEqual(
      payload.data.report.observations.map((observation) => [observation.dimension, observation.valueCode]),
      [
        ["crowd", "busy"],
        ["queue", "under_10"],
        ["parking", "limited"],
        ["local_condition", "strong_wind"],
      ],
    );
    assert.deepEqual(payload.data.credits, []);
    assert.equal(serializedPayload.includes("35.1532"), false);
    assert.equal(serializedPayload.includes("129.1186"), false);
    assert.equal(serializedPayload.includes("images.example.test"), false);
    assert.equal("clientLocation" in payload.data.report, false);
    assert.equal("anonymousUserId" in payload.data.report, false);

    const signalRows = await db
      .prepare(
        `SELECT
          dimension,
          value_code AS valueCode,
          source_type AS sourceType,
          observed_at AS observedAt,
          expires_at AS expiresAt,
          actor_type AS actorType,
          is_publicly_visible AS isPubliclyVisible
        FROM live_signals
        WHERE evidence_id = ?
        ORDER BY dimension`,
      )
      .bind(payload.data.report.id)
      .all<{
        dimension: string;
        valueCode: string;
        sourceType: string;
        observedAt: string;
        expiresAt: string;
        actorType: string;
        isPubliclyVisible: number;
      }>();
    assert.equal(signalRows.results?.length, 4);
    assert.equal(signalRows.results?.every((signal) => signal.sourceType === "verified_ugc" && signal.actorType === "anonymous"), true);
    assert.equal(signalRows.results?.every((signal) => signal.isPubliclyVisible === 0), true);
    assert.deepEqual(
      Object.fromEntries(
        (signalRows.results ?? []).map((signal) => [
          signal.dimension,
          (new Date(signal.expiresAt).getTime() - new Date(signal.observedAt).getTime()) / 1_000,
        ]),
      ),
      {
        crowd: 1800,
        local_condition: 3600,
        parking: 900,
        queue: 1200,
      },
    );

    const event = await db
      .prepare(
        `SELECT
          id,
          event_type AS eventType,
          source,
          crowd_level AS crowdLevel,
          line_status AS lineStatus,
          parking_status AS parkingStatus,
          verified_radius_m AS verifiedRadiusM,
          created_at AS createdAt,
          expires_at AS expiresAt
        FROM place_events
        WHERE id = ?`,
      )
      .bind(payload.data.report.id)
      .first<{
        id: string;
        eventType: string;
        source: string;
        crowdLevel: string;
        lineStatus: string;
        parkingStatus: string;
        verifiedRadiusM: number;
        createdAt: string;
        expiresAt: string;
      }>();
    assert.ok(event);
    assert.deepEqual(event, {
      id: payload.data.report.id,
      eventType: "report",
      source: "field_report",
      crowdLevel: "busy",
      lineStatus: "short",
      parkingStatus: "limited",
      verifiedRadiusM: 50,
      createdAt: event.createdAt,
      expiresAt: event.expiresAt,
    });
    const moderationState = await db
      .prepare("SELECT status FROM field_report_moderation WHERE report_id = ?")
      .bind(payload.data.report.id)
      .first<{ status: string }>();
    assert.deepEqual(moderationState, { status: "pending" });
    assert.equal(new Date(event.expiresAt).getTime() - new Date(event.createdAt).getTime(), 3 * 60 * 60 * 1000);

    const hourlyAggregate = await db
      .prepare(
        `SELECT
          report_count AS reportCount,
          unique_user_count AS uniqueUserCount
        FROM place_event_hourly
        WHERE place_id = ?
        ORDER BY hour_bucket DESC
        LIMIT 1`,
      )
      .bind("busan-gwangalli")
      .first<{ reportCount: number; uniqueUserCount: number }>();
    assert.deepEqual(hourlyAggregate, { reportCount: 1, uniqueUserCount: 1 });

    const privateList = await d1Get<SuccessPayload<Array<{ id: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&limit=5",
      anonymousId,
    );
    assert.deepEqual(privateList.data, []);

    const operatorQueueResponse = await worker.handleRequest(
      new Request("https://api.test/api/admin/field-reports?status=pending&limit=5", {
        headers: { "x-silsigan-admin-token": "test-operator-token" },
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens },
    );
    const operatorQueuePayload = (await operatorQueueResponse.json()) as FailurePayload;
    assert.equal(operatorQueueResponse.status, 403);
    assert.equal(operatorQueuePayload.error.code, "INSUFFICIENT_ADMIN_ROLE");

    const pendingQueue = await d1AdminGet<SuccessPayload<Array<{
      id: string;
      placeName: string;
      moderationStatus: string;
      observedDimensions: string[];
      isExpired: boolean;
    }>>>(db, "https://api.test/api/admin/field-reports?status=pending&limit=5");
    const queuedReport = pendingQueue.data.find((item) => item.id === payload.data.report.id);
    assert.equal(queuedReport?.placeName, "광안리해수욕장");
    assert.equal(queuedReport?.moderationStatus, "pending");
    assert.deepEqual(new Set(queuedReport?.observedDimensions), new Set(["crowd", "queue", "parking", "local_condition"]));
    assert.equal(queuedReport?.isExpired, false);
    const serializedQueue = JSON.stringify(pendingQueue);
    assert.equal(serializedQueue.includes(anonymousId), false);
    assert.equal(serializedQueue.includes("35.1532"), false);
    assert.equal(serializedQueue.includes("images.example.test"), false);

    const pendingVote = await rawD1Post(db, `https://api.test/api/reports/${payload.data.report.id}/votes`, "anon_pending_vote", { voteType: "agree" });
    const pendingVotePayload = (await pendingVote.json()) as FailurePayload;
    assert.equal(pendingVote.status, 409);
    assert.equal(pendingVotePayload.error.code, "FIELD_REPORT_NOT_PUBLIC");

    const forbiddenModeration = await rawD1AdminPost(db, `https://api.test/api/admin/field-reports/${payload.data.report.id}/moderation`, {
      decision: "approved",
      reason: "권한 없는 승인 시도",
    });
    const forbiddenModerationPayload = (await forbiddenModeration.json()) as FailurePayload;
    assert.equal(forbiddenModeration.status, 403);
    assert.equal(forbiddenModerationPayload.error.code, "FORBIDDEN");

    const approval = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/field-reports/${payload.data.report.id}/moderation`,
      { decision: "approved", reason: "현장 제보 검수 통과" },
      "test-moderator-token",
    );
    const approvalPayload = (await approval.json()) as SuccessPayload<{
      reportId: string;
      decision: string;
      public: boolean;
      previousStatus: string;
    }>;
    assert.equal(approval.status, 200);
    assert.deepEqual(approvalPayload.data, {
      reportId: payload.data.report.id,
      decision: "approved",
      public: true,
      previousStatus: "pending",
    });

    const pendingQueueAfterApproval = await d1AdminGet<SuccessPayload<Array<{ id: string }>>>(
      db,
      "https://api.test/api/admin/field-reports?status=pending&limit=5",
    );
    assert.equal(pendingQueueAfterApproval.data.some((item) => item.id === payload.data.report.id), false);
    const approvedQueue = await d1AdminGet<SuccessPayload<Array<{ id: string; moderationStatus: string }>>>(
      db,
      "https://api.test/api/admin/field-reports?status=approved&limit=5",
    );
    assert.equal(approvedQueue.data.find((item) => item.id === payload.data.report.id)?.moderationStatus, "approved");

    const approvedSignalRows = await db
      .prepare("SELECT is_publicly_visible AS isPubliclyVisible FROM live_signals WHERE evidence_id = ?")
      .bind(payload.data.report.id)
      .all<{ isPubliclyVisible: number }>();
    assert.equal(approvedSignalRows.results?.every((signal) => signal.isPubliclyVisible === 1), true);

    const ranking = await d1Get<SuccessPayload<Ranking[]>>(db, "https://api.test/api/rankings/regions/busan?limit=10", anonymousId);
    const gwangalli = ranking.data.find((item) => item.placeId === "busan-gwangalli");
    assert.equal(gwangalli?.score, 104);

    const list = await d1Get<SuccessPayload<Array<{ id: string; placeId: string; weatherFeel?: string; moderationStatus?: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&limit=5",
      anonymousId,
    );
    const serializedList = JSON.stringify(list);
    assert.equal(list.meta?.storage, "d1");
    assert.equal(list.data[0]?.id, payload.data.report.id);
    assert.equal(list.data[0]?.placeId, "busan-gwangalli");
    assert.equal(list.data[0]?.moderationStatus, "approved");
    assert.equal("weatherFeel" in (list.data[0] ?? {}), false);
    assert.equal(serializedList.includes("35.1532"), false);
    assert.equal(serializedList.includes("129.1186"), false);
    assert.equal(serializedList.includes("images.example.test"), false);
    assert.equal(serializedList.includes(anonymousId), false);

    await db.prepare("UPDATE place_events SET expires_at = ? WHERE id = ?").bind("2026-01-01T00:00:00.000Z", payload.data.report.id).run();
    const expiredList = await d1Get<SuccessPayload<Array<{ id: string; placeId: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&includeExpired=true&limit=5",
      anonymousId,
    );
    assert.equal(expiredList.meta?.storage, "d1");
    assert.equal(expiredList.meta?.includeExpired, false);
    assert.equal(expiredList.data.some((report) => report.id === payload.data.report.id), false);

    const rejected = await rawD1Post(db, "https://api.test/api/reports", "anon_d1_field_far", {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "normal",
      lineStatus: "none",
      parkingStatus: "available",
      weatherFeel: "good",
      clientLocation: {
        latitude: 37.5665,
        longitude: 126.978,
      },
    });
    const rejectedPayload = (await rejected.json()) as FailurePayload;
    const rejectedSerialized = JSON.stringify(rejectedPayload);

    assert.equal(rejected.status, 400);
    assert.equal(rejectedPayload.error.code, "LOCATION_NOT_VERIFIED");
    assert.equal(rejectedSerialized.includes("37.5665"), false);
    assert.equal(rejectedSerialized.includes("126.978"), false);

    const eventCount = await db.prepare("SELECT COUNT(*) AS count FROM place_events WHERE place_id = ?").bind("busan-gwangalli").first<{ count: number }>();
    assert.equal(eventCount?.count, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 field report photos stay owner-scoped and publish only after both approvals", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const ownerId = "anon_field_report_photo_owner";
    const photoResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": ownerId,
        },
        body: JSON.stringify({
          uploadId: "upload_field_report_photo",
          placeId: "busan-gwangalli",
          byteSize: 120_000,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
        }),
      }),
      { DB: db, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const photoPayload = (await photoResponse.json()) as SuccessPayload<PhotoCompleteData>;
    assert.equal(photoResponse.status, 201);
    assert.equal(photoPayload.data.photo.status, "pending");

    const photoId = photoPayload.data.photo.id;
    const reportResponse = await rawD1Post(db, "https://api.test/api/reports", ownerId, {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      photoId,
    });
    const reportPayload = (await reportResponse.json()) as SuccessPayload<FieldReportData>;
    assert.equal(reportResponse.status, 201);
    assert.equal("photoId" in reportPayload.data.report, false);

    const relation = await db
      .prepare("SELECT report_id AS reportId, photo_id AS photoId FROM field_report_photos WHERE report_id = ?")
      .bind(reportPayload.data.report.id)
      .first<{ reportId: string; photoId: string }>();
    assert.deepEqual(relation, { reportId: reportPayload.data.report.id, photoId });

    const otherOwner = await rawD1Post(db, "https://api.test/api/reports", "anon_field_report_photo_other", {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      photoId,
    });
    const otherOwnerPayload = (await otherOwner.json()) as FailurePayload;
    assert.equal(otherOwner.status, 403);
    assert.equal(otherOwnerPayload.error.code, "PHOTO_ATTACHMENT_FORBIDDEN");

    const otherPlace = await rawD1Post(db, "https://api.test/api/reports", ownerId, {
      placeId: "ulsan-taehwagang",
      category: "tourism",
      crowdLevel: "busy",
      photoId,
    });
    const otherPlacePayload = (await otherPlace.json()) as FailurePayload;
    assert.equal(otherPlace.status, 403);
    assert.equal(otherPlacePayload.error.code, "PHOTO_ATTACHMENT_FORBIDDEN");

    const pendingPublic = await d1Get<SuccessPayload<Array<{ id: string; photoId?: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&limit=10",
      ownerId,
    );
    assert.deepEqual(pendingPublic.data, []);

    const reportApproval = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/field-reports/${reportPayload.data.report.id}/moderation`,
      { decision: "approved", reason: "사진 연결 제보 검수" },
      "test-moderator-token",
    );
    assert.equal(reportApproval.status, 200);

    const reportApprovedPhotoPending = await d1Get<SuccessPayload<Array<{ id: string; photoId?: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&limit=10",
      ownerId,
    );
    assert.equal(reportApprovedPhotoPending.data[0]?.id, reportPayload.data.report.id);
    assert.equal("photoId" in (reportApprovedPhotoPending.data[0] ?? {}), false);

    const photoApproval = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/photos/${photoId}/moderation`,
      { decision: "approved", reason: "파생 이미지 검수" },
      "test-moderator-token",
    );
    assert.equal(photoApproval.status, 200);

    const fullyApproved = await d1Get<SuccessPayload<Array<{ id: string; photoId?: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&limit=10",
      ownerId,
    );
    assert.equal(fullyApproved.data[0]?.id, reportPayload.data.report.id);
    assert.equal(fullyApproved.data[0]?.photoId, photoId);
    assert.equal(JSON.stringify(fullyApproved).includes("storageKey"), false);
    assert.equal(JSON.stringify(fullyApproved).includes("anonymousUserId"), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("disabled rewards stay hidden until the scoped feature flag is enabled", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const reportBody = {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      clientLocation: {
        latitude: 35.1532,
        longitude: 129.1186,
      },
    };

    const disabledResponse = await rawD1Post(db, "https://api.test/api/reports", "anon_rewards_disabled", reportBody);
    const disabledPayload = (await disabledResponse.json()) as SuccessPayload<FieldReportData>;
    assert.equal(disabledResponse.status, 201);
    assert.deepEqual(disabledPayload.data.credits, []);

    await db
      .prepare(
        "UPDATE feature_flags SET enabled = 1 WHERE scope_type = 'global' AND scope_key = '*' AND flag_key = 'REWARDS_ENABLED'",
      )
      .run();

    const enabledResponse = await rawD1Post(db, "https://api.test/api/reports", "anon_rewards_enabled", reportBody);
    const enabledPayload = (await enabledResponse.json()) as SuccessPayload<FieldReportData>;
    assert.equal(enabledResponse.status, 201);
    assert.deepEqual(enabledPayload.data.credits, [{ type: "verified_report", amount: 1 }]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("my field reports are scoped to the current anonymous session and retain lifecycle status", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const ownerId = "anon_d1_my_reports_owner";
    const otherId = "anon_d1_my_reports_other";
    const created = await rawD1Post(db, "https://api.test/api/reports", ownerId, {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
    });
    const createdPayload = (await created.json()) as SuccessPayload<FieldReportData>;
    assert.equal(created.status, 201);
    assert.equal(createdPayload.data.report.moderationStatus, "pending");

    const own = await d1Get<SuccessPayload<Array<{ id: string; placeId: string; status: string; verifiedRadiusM: number | null }>>>(
      db,
      "https://api.test/api/my-reports?limit=10",
      ownerId,
    );
    assert.equal(own.meta?.ownerScope, "current-anonymous-session-only");
    assert.equal(own.meta?.includeExpired, true);
    assert.deepEqual(own.data.map((report) => report.id), [createdPayload.data.report.id]);
    assert.equal(own.data[0]?.placeId, "busan-gwangalli");
    assert.equal(own.data[0]?.status, "pending");
    assert.equal(JSON.stringify(own).includes(ownerId), false);

    const approval = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/field-reports/${createdPayload.data.report.id}/moderation`,
      { decision: "approved", reason: "소유자 흐름 승인 테스트" },
      "test-moderator-token",
    );
    assert.equal(approval.status, 200);

    const published = await d1Get<SuccessPayload<Array<{ id: string; status: string }>>>(db, "https://api.test/api/my-reports?limit=10", ownerId);
    assert.equal(published.data[0]?.status, "published");

    const other = await d1Get<SuccessPayload<Array<{ id: string }>>>(db, "https://api.test/api/my-reports?limit=10", otherId);
    assert.deepEqual(other.data, []);

    await db
      .prepare("UPDATE place_events SET expires_at = ? WHERE id = ?")
      .bind("2026-01-01T00:00:00.000Z", createdPayload.data.report.id)
      .run();
    const expired = await d1Get<SuccessPayload<Array<{
      id: string;
      placeId: string;
      category: string;
      verifiedRadiusM: number | null;
      createdAt: string;
      expiresAt: string;
      status: string;
    }>>>(
      db,
      "https://api.test/api/my-reports?limit=10",
      ownerId,
    );
    assert.equal(expired.data.length, 1);
    assert.equal(expired.data[0]?.id, createdPayload.data.report.id);
    assert.equal(expired.data[0]?.placeId, "busan-gwangalli");
    assert.equal(expired.data[0]?.category, "tourism");
    assert.equal(expired.data[0]?.verifiedRadiusM, null);
    assert.equal(expired.data[0]?.createdAt, createdPayload.data.report.createdAt);
    assert.equal(expired.data[0]?.expiresAt, "2026-01-01T00:00:00.000Z");
    assert.equal(expired.data[0]?.status, "expired");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rejected field reports stay private while the owner sees the rejection lifecycle", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const ownerId = "anon_rejected_report_owner";
    const created = await rawD1Post(db, "https://api.test/api/reports", ownerId, {
      placeId: "busan-gwangalli",
      category: "tourism",
      parkingStatus: "full",
    });
    const createdPayload = (await created.json()) as SuccessPayload<FieldReportData>;
    assert.equal(created.status, 201);

    const rejection = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/field-reports/${createdPayload.data.report.id}/moderation`,
      { decision: "rejected", reason: "민감정보 검수 반려" },
      "test-moderator-token",
    );
    const rejectionPayload = (await rejection.json()) as SuccessPayload<{
      reportId: string;
      decision: string;
      public: boolean;
      previousStatus: string;
    }>;
    assert.equal(rejection.status, 200);
    assert.deepEqual(rejectionPayload.data, {
      reportId: createdPayload.data.report.id,
      decision: "rejected",
      public: false,
      previousStatus: "pending",
    });

    const publicReports = await d1Get<SuccessPayload<Array<{ id: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&limit=10",
      ownerId,
    );
    assert.deepEqual(publicReports.data, []);

    const ownReports = await d1Get<SuccessPayload<Array<{ id: string; status: string }>>>(db, "https://api.test/api/my-reports?limit=10", ownerId);
    assert.deepEqual(ownReports.data, [{
      id: createdPayload.data.report.id,
      placeId: "busan-gwangalli",
      category: "tourism",
      parkingStatus: "full",
      localConditions: [],
      observations: [],
      verifiedRadiusM: null,
      createdAt: createdPayload.data.report.createdAt,
      expiresAt: createdPayload.data.report.expiresAt,
      moderationStatus: "rejected",
      status: "rejected",
    }]);

    const visibleSignals = await db
      .prepare("SELECT COUNT(*) AS count FROM live_signals WHERE evidence_id = ? AND is_publicly_visible = 1")
      .bind(createdPayload.data.report.id)
      .first<{ count: number }>();
    assert.equal(visibleSignals?.count, 0);
    const adminAction = await db
      .prepare("SELECT action_type AS actionType, target_type AS targetType, target_id AS targetId FROM admin_actions WHERE target_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(createdPayload.data.report.id)
      .first<{ actionType: string; targetType: string; targetId: string }>();
    assert.deepEqual(adminAction, {
      actionType: "field_report_rejected",
      targetType: "field_report",
      targetId: createdPayload.data.report.id,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("field report accepts only observed dimensions and rejects an empty observation", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const response = await rawD1Post(db, "https://api.test/api/reports", "anon_d1_optional_report", {
      placeId: "busan-gwangalli",
      category: "tourism",
      queueStatus: "10_to_30",
      comment: "대기 시간만 확인했습니다.",
    });
    const payload = (await response.json()) as SuccessPayload<FieldReportData>;
    assert.equal(response.status, 201);
    assert.equal("crowdLevel" in payload.data.report, false);
    assert.equal("parkingStatus" in payload.data.report, false);
    assert.equal("weatherFeel" in payload.data.report, false);
    assert.deepEqual(payload.data.report.observations.map((observation) => [observation.dimension, observation.valueCode]), [
      ["queue", "10_to_30"],
    ]);

    const event = await db
      .prepare("SELECT crowd_level AS crowdLevel, line_status AS lineStatus, parking_status AS parkingStatus FROM place_events WHERE id = ?")
      .bind(payload.data.report.id)
      .first<{ crowdLevel: string | null; lineStatus: string | null; parkingStatus: string | null }>();
    assert.deepEqual(event, { crowdLevel: null, lineStatus: "medium", parkingStatus: null });
    const signal = await db
      .prepare("SELECT dimension, value_code AS valueCode FROM live_signals WHERE evidence_id = ?")
      .bind(payload.data.report.id)
      .first<{ dimension: string; valueCode: string }>();
    assert.deepEqual(signal, { dimension: "queue", valueCode: "10_to_30" });

    const rejected = await rawD1Post(db, "https://api.test/api/reports", "anon_d1_empty_report", {
      placeId: "busan-gwangalli",
      category: "tourism",
      parkingStatus: "unknown",
    });
    const rejectedPayload = (await rejected.json()) as FailurePayload;
    assert.equal(rejected.status, 400);
    assert.equal(rejectedPayload.error.code, "REPORT_OBSERVATION_REQUIRED");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("field report votes reject self and duplicates, then invalidate stale consensus safely", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const ownerId = "anon_vote_report_owner";
    const reportResponse = await rawD1Post(db, "https://api.test/api/reports", ownerId, {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
    });
    const reportPayload = (await reportResponse.json()) as SuccessPayload<FieldReportData>;
    const voteUrl = `https://api.test/api/reports/${reportPayload.data.report.id}/votes`;

    const approval = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/field-reports/${reportPayload.data.report.id}/moderation`,
      { decision: "approved", reason: "투표 흐름 승인 테스트" },
      "test-moderator-token",
    );
    assert.equal(approval.status, 200);

    const selfVote = await rawD1Post(db, voteUrl, ownerId, { voteType: "agree" });
    const selfVotePayload = (await selfVote.json()) as FailurePayload;
    assert.equal(selfVote.status, 403);
    assert.equal(selfVotePayload.error.code, "SELF_REPORT_VOTE_FORBIDDEN");

    const agree = await rawD1Post(db, voteUrl, "anon_vote_agree", { voteType: "agree" });
    const agreePayload = (await agree.json()) as SuccessPayload<{ agreeCount: number; changedCount: number; invalidated: boolean }>;
    assert.equal(agree.status, 201);
    assert.deepEqual(agreePayload.data, {
      reportId: reportPayload.data.report.id,
      voteType: "agree",
      agreeCount: 1,
      changedCount: 0,
      invalidated: false,
    });
    const duplicate = await rawD1Post(db, voteUrl, "anon_vote_agree", { voteType: "changed" });
    const duplicatePayload = (await duplicate.json()) as FailurePayload;
    assert.equal(duplicate.status, 409);
    assert.equal(duplicatePayload.error.code, "REPORT_VOTE_ALREADY_EXISTS");

    const changedOne = await rawD1Post(db, voteUrl, "anon_vote_changed_one", { voteType: "changed" });
    const changedTwo = await rawD1Post(db, voteUrl, "anon_vote_changed_two", { voteType: "changed" });
    const changedThree = await rawD1Post(db, voteUrl, "anon_vote_changed_three", {
      voteType: "changed",
      clientLocation: { latitude: 35.1532, longitude: 129.1186 },
    });
    const changedOnePayload = (await changedOne.json()) as SuccessPayload<{ invalidated: boolean }>;
    const changedTwoPayload = (await changedTwo.json()) as SuccessPayload<{ invalidated: boolean }>;
    const changedThreePayload = (await changedThree.json()) as SuccessPayload<{ changedCount: number; invalidated: boolean }>;
    assert.equal(changedOnePayload.data.invalidated, false);
    assert.equal(changedTwoPayload.data.invalidated, false);
    assert.equal(changedThreePayload.data.changedCount, 3);
    assert.equal(changedThreePayload.data.invalidated, true);

    const event = await db
      .prepare("SELECT expires_at AS expiresAt FROM place_events WHERE id = ?")
      .bind(reportPayload.data.report.id)
      .first<{ expiresAt: string }>();
    assert.ok(Date.parse(event?.expiresAt ?? "") <= Date.now());
    const signals = await db
      .prepare("SELECT COUNT(*) AS count FROM live_signals WHERE evidence_id = ? AND is_publicly_visible = 1")
      .bind(reportPayload.data.report.id)
      .first<{ count: number }>();
    assert.equal(signals?.count, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("user blocks use content ids, hide the creator across feeds, and never expose identity ids", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const creatorSession = "anon_block_target_creator";
    const viewerSession = "anon_block_viewer";
    const comment = await d1Post<SuccessPayload<Comment>>(db, "https://api.test/api/comments", creatorSession, {
      placeId: "busan-gwangalli",
      body: "차단 테스트 댓글입니다.",
    });
    const postResponse = await rawD1Post(db, "https://api.test/api/posts", creatorSession, {
      placeId: "busan-gwangalli",
      crowdLevel: "normal",
      lineStatus: "none",
      parkingStatus: "available",
      weatherFeel: "good",
      caption: "차단 테스트 게시물입니다.",
      photoCount: 0,
      hashtagNames: [],
    });
    const postPayload = (await postResponse.json()) as SuccessPayload<{ post: FeedPost }>;
    assert.equal(postResponse.status, 201);
    assert.equal("anonymousUserId" in comment.data, false);

    const selfBlock = await rawD1Post(db, "https://api.test/api/blocks", creatorSession, {
      targetType: "comment",
      targetId: comment.data.id,
    });
    const selfBlockPayload = (await selfBlock.json()) as FailurePayload;
    assert.equal(selfBlock.status, 400);
    assert.equal(selfBlockPayload.error.code, "SELF_BLOCK_FORBIDDEN");

    const blockResponse = await rawD1Post(db, "https://api.test/api/blocks", viewerSession, {
      targetType: "comment",
      targetId: comment.data.id,
    });
    const blockPayload = (await blockResponse.json()) as SuccessPayload<{ id: string; blocked: boolean }>;
    assert.equal(blockResponse.status, 201);
    assert.equal(blockPayload.data.blocked, true);
    const serializedBlock = JSON.stringify(blockPayload);
    assert.equal(serializedBlock.includes("anonymousUserId"), false);
    assert.equal(serializedBlock.includes("anon_"), false);

    const commentsAfterBlock = await d1Get<SuccessPayload<Comment[]>>(
      db,
      "https://api.test/api/comments?placeId=busan-gwangalli",
      viewerSession,
    );
    const postsAfterBlock = await d1Get<SuccessPayload<FeedPost[]>>(
      db,
      "https://api.test/api/posts?placeId=busan-gwangalli",
      viewerSession,
    );
    assert.equal(commentsAfterBlock.data.some((item) => item.id === comment.data.id), false);
    assert.equal(postsAfterBlock.data.some((item) => item.id === postPayload.data.post.id), false);

    const blockList = await d1Get<SuccessPayload<Array<{ id: string; createdAt: string; label: string }>>>(
      db,
      "https://api.test/api/blocks",
      viewerSession,
    );
    assert.equal(blockList.data.length, 1);
    assert.equal(blockList.data[0]?.id, blockPayload.data.id);
    assert.equal(blockList.data[0]?.label, "차단한 사용자");
    assert.equal(JSON.stringify(blockList).includes("anon_"), false);

    const unblock = await rawD1Delete(db, `https://api.test/api/blocks/${blockPayload.data.id}`, viewerSession);
    const unblockPayload = (await unblock.json()) as SuccessPayload<{ blocked: boolean }>;
    assert.equal(unblock.status, 200);
    assert.equal(unblockPayload.data.blocked, false);
    const commentsAfterUnblock = await d1Get<SuccessPayload<Comment[]>>(
      db,
      "https://api.test/api/comments?placeId=busan-gwangalli",
      viewerSession,
    );
    assert.equal(commentsAfterUnblock.data.some((item) => item.id === comment.data.id), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("anonymous account deletion purges owned content and rejects future writes", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const anonymousId = "anon_account_delete";

  try {
    const comment = await d1Post<SuccessPayload<Comment>>(db, "https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: "삭제될 댓글입니다.",
    });
    const storedUser = await db
      .prepare("SELECT anonymous_user_id AS anonymousUserId FROM comments WHERE id = ?")
      .bind(comment.data.id)
      .first<{ anonymousUserId: string }>();
    const fieldReport = await rawD1Post(db, "https://api.test/api/reports", anonymousId, {
      placeId: "busan-gwangalli",
      category: "tourism",
      queueStatus: "under_10",
    });
    assert.equal(fieldReport.status, 201);
    const source = jpegWithGpsExifSample();
    const photoResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": anonymousId },
        body: JSON.stringify({
          uploadId: "upload_account_delete",
          placeId: "busan-gwangalli",
          byteSize: source.byteLength,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
          imageBase64: bytesToBase64(source),
        }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const photoPayload = (await photoResponse.json()) as SuccessPayload<PhotoCompleteData>;
    assert.equal(photoResponse.status, 201);

    const deletionResponse = await worker.handleRequest(
      new Request("https://api.test/api/account/deletion", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": anonymousId },
        body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }),
      }),
      { DB: db, PHOTOS: r2 },
    );
    const deletionPayload = (await deletionResponse.json()) as SuccessPayload<{
      deleted: boolean;
      actorType: string;
      removedPhotoCount: number;
    }>;
    assert.equal(deletionResponse.status, 200);
    assert.deepEqual(deletionPayload.data, {
      deleted: true,
      actorType: "anonymous",
      removedPhotoCount: 1,
      alreadyCompleted: false,
    });
    assert.equal(r2.deletedKeys.includes(photoPayload.data.storageKey), true);

    for (const table of ["comments", "photos", "place_events", "live_signals"]) {
      const column = table === "live_signals" ? "actor_id" : "anonymous_user_id";
      const count = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).bind(storedUser?.anonymousUserId ?? "").first<{ count: number }>();
      assert.equal(count?.count, 0, table);
    }
    const requestRow = await db
      .prepare("SELECT status FROM account_deletion_requests WHERE anonymous_user_id = ? ORDER BY requested_at DESC LIMIT 1")
      .bind(storedUser?.anonymousUserId ?? "")
      .first<{ status: string }>();
    assert.equal(requestRow?.status, "completed");

    const blockedWrite = await rawD1Post(db, "https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: "삭제 후 작성 시도입니다.",
    });
    const blockedWritePayload = (await blockedWrite.json()) as FailurePayload;
    assert.equal(blockedWrite.status, 403);
    assert.equal(blockedWritePayload.error.code, "ACCOUNT_DELETED");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("member identity linking requires action-scoped HMAC and member deletion marks the profile deleted", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const anonymousId = "anon_member_link";
  const memberSubject = "member-fixture-123";
  const secret = "test-member-link-secret-at-least-32-bytes";

  try {
    const timestamp = String(Date.now());
    const linkSignature = createHmac("sha256", secret)
      .update(`identity-link.${timestamp}.${anonymousId}.${memberSubject}`)
      .digest("hex");
    const linkResponse = await worker.handleRequest(
      new Request("https://api.test/api/identity/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": anonymousId,
          "x-silsigan-link-timestamp": timestamp,
          "x-silsigan-link-signature": linkSignature,
        },
        body: JSON.stringify({ memberSubject }),
      }),
      { DB: db, MEMBER_LINK_HMAC_SECRET: secret },
    );
    const linkPayload = (await linkResponse.json()) as SuccessPayload<{ linked: boolean; alreadyLinked: boolean }>;
    assert.equal(linkResponse.status, 201);
    assert.deepEqual(linkPayload.data, { linked: true, alreadyLinked: false });
    assert.equal(JSON.stringify(linkPayload).includes(memberSubject), false);

    const profile = await db
      .prepare(
        `SELECT p.id, p.auth_subject AS authSubject, p.status
         FROM profiles p
         JOIN identity_links il ON il.profile_id = p.id
         LIMIT 1`,
      )
      .first<{ id: string; authSubject: string; status: string }>();
    assert.match(profile?.authSubject ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.equal(profile?.status, "active");

    const reusedSignatureDeletion = await worker.handleRequest(
      new Request("https://api.test/api/account/deletion", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": anonymousId,
          "x-silsigan-link-timestamp": timestamp,
          "x-silsigan-link-signature": linkSignature,
        },
        body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT", memberSubject }),
      }),
      { DB: db, MEMBER_LINK_HMAC_SECRET: secret },
    );
    const reusedPayload = (await reusedSignatureDeletion.json()) as FailurePayload;
    assert.equal(reusedSignatureDeletion.status, 403);
    assert.equal(reusedPayload.error.code, "MEMBER_LINK_SIGNATURE_INVALID");

    const deletionTimestamp = String(Date.now());
    const deletionSignature = createHmac("sha256", secret)
      .update(`account-deletion.${deletionTimestamp}.${anonymousId}.${memberSubject}`)
      .digest("hex");
    const deletionResponse = await worker.handleRequest(
      new Request("https://api.test/api/account/deletion", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": anonymousId,
          "x-silsigan-link-timestamp": deletionTimestamp,
          "x-silsigan-link-signature": deletionSignature,
        },
        body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT", memberSubject }),
      }),
      { DB: db, MEMBER_LINK_HMAC_SECRET: secret },
    );
    const deletionPayload = (await deletionResponse.json()) as SuccessPayload<{ deleted: boolean; actorType: string }>;
    assert.equal(deletionResponse.status, 200);
    assert.equal(deletionPayload.data.deleted, true);
    assert.equal(deletionPayload.data.actorType, "member");
    const deletedProfile = await db.prepare("SELECT status, deleted_at AS deletedAt FROM profiles WHERE id = ?").bind(profile?.id ?? "").first<{ status: string; deletedAt: string | null }>();
    assert.equal(deletedProfile?.status, "deleted");
    assert.ok(deletedProfile?.deletedAt);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 place status uses enabled current sources and preserves provider observation time", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const reportResponse = await rawD1Post(db, "https://api.test/api/reports", "anon_d1_status_report", {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "quiet",
    });
    const reportPayload = (await reportResponse.json()) as SuccessPayload<FieldReportData>;
    assert.equal(reportResponse.status, 201);

    const approval = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/field-reports/${reportPayload.data.report.id}/moderation`,
      { decision: "approved", reason: "현재 상태 계산 테스트 승인" },
      "test-moderator-token",
    );
    assert.equal(approval.status, 200);

    await db
      .prepare("UPDATE data_sources SET commercial_use_status = 'allowed_with_attribution', enabled = 1, health_status = 'healthy' WHERE id = 'source-kma-weather'")
      .run();
    await db
      .prepare(
        `INSERT INTO live_signals (
          id,
          place_id,
          dimension,
          value_code,
          source_id,
          source_type,
          source_name,
          observed_at,
          fetched_at,
          expires_at,
          confidence_score,
          is_publicly_visible
        ) VALUES ('signal-kma-without-expiry', 'busan-gwangalli', 'weather', 'clear', 'source-kma-weather', 'official_periodic', 'KMA', ?, ?, NULL, 0.9, 1)`,
      )
      .bind(reportPayload.data.report.createdAt, reportPayload.data.report.createdAt)
      .run();

    const insufficientResponse = await worker.handleRequest(
      new Request("https://api.test/api/places/busan-gwangalli/status"),
      { DB: db, ENVIRONMENT: "staging" },
    );
    const insufficient = (await insufficientResponse.json()) as SuccessPayload<{
      status: string;
      observedAt: string | null;
      currentSignals: Array<Record<string, unknown>>;
      missingRequiredDimensions: string[];
    }>;
    assert.equal(insufficientResponse.status, 200);
    assert.equal(insufficient.data.status, "insufficient");
    assert.deepEqual(insufficient.data.missingRequiredDimensions, ["weather"]);
    assert.equal(insufficient.data.observedAt, reportPayload.data.report.createdAt);
    assert.equal(insufficient.data.currentSignals.length, 1);
    assert.equal(insufficient.data.currentSignals.some((signal) => signal.sourceName === "KMA"), false);
    assert.equal(JSON.stringify(insufficient).includes("actorId"), false);
    assert.equal(JSON.stringify(insufficient).includes("actorKey"), false);

    const observedAt = reportPayload.data.report.createdAt;
    const expiresAt = new Date(new Date(observedAt).getTime() + 30 * 60 * 1_000).toISOString();
    await db
      .prepare(
        `INSERT INTO live_signals (
          id,
          place_id,
          dimension,
          value_code,
          source_id,
          source_type,
          source_name,
          observed_at,
          fetched_at,
          expires_at,
          confidence_score,
          is_publicly_visible
        ) VALUES (?, 'busan-gwangalli', 'weather', 'clear', 'source-kma-weather', 'official_periodic', 'KMA', ?, ?, ?, 0.9, 1)`,
      )
      .bind("signal-kma-status", observedAt, observedAt, expiresAt)
      .run();

    const currentResponse = await worker.handleRequest(
      new Request("https://api.test/api/places/busan-gwangalli/status"),
      { DB: db, ENVIRONMENT: "staging" },
    );
    const current = (await currentResponse.json()) as SuccessPayload<{
      status: string;
      observedAt: string | null;
      currentSignals: Array<{ sourceName: string; observedAt: string }>;
      independentSourceCount: number;
    }>;
    assert.equal(current.data.status, "likely_good");
    assert.equal(current.data.observedAt, observedAt);
    assert.equal(current.data.independentSourceCount, 2);
    assert.equal(current.data.currentSignals.some((signal) => signal.sourceName === "KMA" && signal.observedAt === observedAt), true);
    assert.equal(current.meta?.storage, "d1");

    await db.prepare("UPDATE data_sources SET health_status = 'unknown' WHERE id = 'source-kma-weather'").run();
    const unknownHealthResponse = await worker.handleRequest(
      new Request("https://api.test/api/places/busan-gwangalli/status"),
      { DB: db, ENVIRONMENT: "staging" },
    );
    const unknownHealth = (await unknownHealthResponse.json()) as SuccessPayload<{
      status: string;
      currentSignals: Array<{ sourceName: string }>;
      missingRequiredDimensions: string[];
    }>;
    assert.equal(unknownHealth.data.status, "insufficient");
    assert.deepEqual(unknownHealth.data.missingRequiredDimensions, ["weather"]);
    assert.equal(unknownHealth.data.currentSignals.some((signal) => signal.sourceName === "KMA"), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("public place status GET computes without writing an aggregate row", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const before = await db
      .prepare("SELECT COUNT(*) AS count FROM aggregated_place_status WHERE place_id = ?")
      .bind("ulsan-taehwagang")
      .first<{ count: number }>();
    const response = await worker.handleRequest(
      new Request("https://api.test/api/places/ulsan-taehwagang/status"),
      { DB: db, ENVIRONMENT: "staging" },
    );
    const after = await db
      .prepare("SELECT COUNT(*) AS count FROM aggregated_place_status WHERE place_id = ?")
      .bind("ulsan-taehwagang")
      .first<{ count: number }>();

    assert.equal(response.status, 200);
    assert.equal(before?.count, 0);
    assert.equal(after?.count, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("memory fallback field reports can be listed without raw location data", async () => {
  const anonymousId = "anon_memory_field_report";
  const created = await post<SuccessPayload<FieldReportData>>("https://api.test/api/reports", anonymousId, {
    placeId: "ulsan-taehwagang",
    category: "tourism",
    crowdLevel: "normal",
    lineStatus: "short",
    parkingStatus: "limited",
    weatherFeel: "windy",
    clientLocation: {
      latitude: 35.5486,
      longitude: 129.3005,
    },
  });
  const list = await get<SuccessPayload<Array<{ id: string; placeId: string; weatherFeel?: string }>>>(
    "https://api.test/api/reports?placeId=ulsan-taehwagang&limit=5",
    anonymousId,
  );
  const serializedList = JSON.stringify(list);

  assert.equal(list.meta?.storage, "memory-fallback");
  assert.equal(list.data.some((report) => report.id === created.data.report.id), false);

  const approval = await rawMemoryAdminPostWithToken(
    `https://api.test/api/admin/field-reports/${created.data.report.id}/moderation`,
    { decision: "approved", reason: "memory fallback 승인 테스트" },
    "test-moderator-token",
  );
  assert.equal(approval.status, 200);

  const publishedList = await get<SuccessPayload<Array<{ id: string; placeId: string; weatherFeel?: string }>>>(
    "https://api.test/api/reports?placeId=ulsan-taehwagang&limit=5",
    anonymousId,
  );
  const publishedSerializedList = JSON.stringify(publishedList);
  assert.equal(publishedList.data.some((report) => report.id === created.data.report.id), true);
  assert.equal(publishedList.data.find((report) => report.id === created.data.report.id)?.weatherFeel, "windy");
  assert.equal(serializedList.includes("35.5486"), false);
  assert.equal(serializedList.includes("129.3005"), false);
  assert.equal(serializedList.includes("images.example.test"), false);
  assert.equal(serializedList.includes(anonymousId), false);
  assert.equal(publishedSerializedList.includes("35.5486"), false);
  assert.equal(publishedSerializedList.includes("129.3005"), false);
  assert.equal(publishedSerializedList.includes("images.example.test"), false);
  assert.equal(publishedSerializedList.includes(anonymousId), false);
});

test("memory fallback my field reports never use another session's public reports", async () => {
  const ownerId = "anon_memory_my_reports_owner";
  const otherId = "anon_memory_my_reports_other";
  const created = await post<SuccessPayload<FieldReportData>>("https://api.test/api/reports", ownerId, {
    placeId: "ulsan-taehwagang",
    category: "tourism",
    crowdLevel: "quiet",
  });

  const own = await get<SuccessPayload<Array<{ id: string; status: string }>>>("https://api.test/api/my-reports?limit=10", ownerId);
  const other = await get<SuccessPayload<Array<{ id: string }>>>("https://api.test/api/my-reports?limit=10", otherId);

  assert.deepEqual(own.data.map((report) => report.id), [created.data.report.id]);
  assert.equal(own.data[0]?.status, "pending");
  assert.deepEqual(other.data, []);
  assert.equal(JSON.stringify(own).includes(ownerId), false);
});

test("D1 public live surfaces ignore expired three-hour place signals", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const anonymousId = "anon_d1_expiry_test";
    await db
      .prepare(
        `INSERT INTO places (id, area_id, region_id, category_id, name, address, latitude, longitude, coordinate_status, launch_stage, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind("busan-live-sort-control", "busan-suyeong", "busan", "tourism", "부산 정렬 기준점", "부산 수영구 정렬로", 35.16, 129.12, "verified", "active", 1)
      .run();
    await db
      .prepare("INSERT INTO place_rankings (id, place_id, region_id, score, rank, window_hours) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("rank_24_busan-live-sort-control", "busan-live-sort-control", "busan", 105, 2, 24)
      .run();

    const comment = await d1Post<SuccessPayload<Comment>>(db, "https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: "곧 만료될 현장 댓글입니다.",
    });
    const photo = await d1Post<SuccessPayload<PhotoCompleteData>>(db, "https://api.test/api/photos/complete", anonymousId, {
      uploadId: "upload_expiry_d1",
      placeId: "busan-gwangalli",
      byteSize: 100_000,
      mimeType: "image/webp",
      width: 800,
      height: 600,
      clientReencoded: true,
    });
    await d1AdminPost<SuccessPayload<{ decision: string; public: boolean }>>(
      db,
      `https://api.test/api/admin/photos/${photo.data.photo.id}/moderation`,
      { decision: "approved", reason: "expiry fixture review passed" },
      {},
      "test-moderator-token",
    );
    await d1Post<SuccessPayload<{ clickCount: number; created: boolean }>>(
      db,
      "https://api.test/api/places/busan-gwangalli/click",
      anonymousId,
      { source: "detail" },
    );

    const eventWindow = await db
      .prepare(
        `SELECT
          created_at AS createdAt,
          expires_at AS expiresAt,
          source
        FROM place_events
        WHERE place_id = 'busan-gwangalli'
        ORDER BY created_at DESC
        LIMIT 1`,
      )
      .first<{ createdAt: string; expiresAt: string; source: string }>();
    assert.ok(eventWindow);
    assert.equal(eventWindow.source, "detail");
    assert.equal(new Date(eventWindow.expiresAt).getTime() - new Date(eventWindow.createdAt).getTime(), 3 * 60 * 60 * 1000);

    const activeLive = await d1Get<SuccessPayload<{ clickCount: number; commentCount: number; photoCount: number }>>(
      db,
      "https://api.test/api/places/busan-gwangalli/live",
      anonymousId,
    );
    assert.equal(activeLive.data.clickCount, 1);
    assert.equal(activeLive.data.commentCount, 1);
    assert.equal(activeLive.data.photoCount, 1);

    const hourlyAggregate = await db
      .prepare(
        `SELECT
          click_count AS clickCount,
          comment_count AS commentCount,
          photo_count AS photoCount,
          unique_user_count AS uniqueUserCount
        FROM place_event_hourly
        WHERE place_id = ?
        ORDER BY hour_bucket DESC
        LIMIT 1`,
      )
      .bind("busan-gwangalli")
      .first<{ clickCount: number; commentCount: number; photoCount: number; uniqueUserCount: number }>();
    assert.deepEqual(hourlyAggregate, {
      clickCount: 1,
      commentCount: 1,
      photoCount: 1,
      uniqueUserCount: 1,
    });

    const activeRanking = await d1Get<SuccessPayload<Ranking[]>>(
      db,
      "https://api.test/api/rankings/regions/busan?limit=10",
      anonymousId,
    );
    const activeGwangalli = activeRanking.data.find((ranking) => ranking.placeId === "busan-gwangalli");
    assert.equal(activeRanking.data[0]?.placeId, "busan-gwangalli");
    assert.equal(activeGwangalli?.score, 111);
    assert.equal(activeGwangalli?.clickCount, 1);
    assert.equal(activeGwangalli?.commentCount, 1);
    assert.equal(activeGwangalli?.photoCount, 1);
    assert.equal(activeGwangalli?.uniqueUserCount, 1);
    assert.equal(activeGwangalli?.summary, "댓글 1개 · 사진 1장 · 실시간 사용자 제보 기반");

    await db.prepare("UPDATE place_events SET expires_at = '2026-01-01T00:00:00.000Z' WHERE place_id = ?").bind("busan-gwangalli").run();
    await db
      .prepare("UPDATE comments SET created_at = '2026-01-01T00:00:00.000Z', updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(comment.data.id)
      .run();
    await db.prepare("UPDATE photos SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").bind(photo.data.photo.id).run();

    const expiredComments = await d1Get<SuccessPayload<Comment[]>>(db, "https://api.test/api/comments?placeId=busan-gwangalli", anonymousId);
    assert.equal(expiredComments.data.some((item) => item.id === comment.data.id), false);

    const expiredPhotos = await d1Get<SuccessPayload<Array<{ id: string }>>>(db, "https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
    assert.equal(expiredPhotos.data.some((item) => item.id === photo.data.photo.id), false);

    const expiredLive = await d1Get<SuccessPayload<{ clickCount: number; commentCount: number; photoCount: number }>>(
      db,
      "https://api.test/api/places/busan-gwangalli/live",
      anonymousId,
    );
    assert.equal(expiredLive.data.clickCount, 0);
    assert.equal(expiredLive.data.commentCount, 0);
    assert.equal(expiredLive.data.photoCount, 0);

    const expiredRanking = await d1Get<SuccessPayload<Ranking[]>>(
      db,
      "https://api.test/api/rankings/regions/busan?limit=10",
      anonymousId,
    );
    assert.equal(expiredRanking.data[0]?.placeId, "busan-live-sort-control");
    assert.equal(expiredRanking.data.find((ranking) => ranking.placeId === "busan-gwangalli")?.score, 98);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 ranking smoke counts repeated click and like signals once per anonymous user", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const anonymousId = "anon_d1_ranking_abuse_smoke";
    const firstClick = await d1Post<SuccessPayload<{ clickCount: number; created: boolean }>>(
      db,
      "https://api.test/api/places/busan-gwangalli/click",
      anonymousId,
      { source: "detail" },
    );
    const secondClick = await d1Post<SuccessPayload<{ clickCount: number; created: boolean }>>(
      db,
      "https://api.test/api/places/busan-gwangalli/click",
      anonymousId,
      { source: "detail" },
    );
    const firstLike = await d1Post<SuccessPayload<{ likeCount: number; created: boolean }>>(
      db,
      "https://api.test/api/places/busan-gwangalli/like",
      anonymousId,
      {},
    );
    const secondLike = await d1Post<SuccessPayload<{ likeCount: number; created: boolean }>>(
      db,
      "https://api.test/api/places/busan-gwangalli/like",
      anonymousId,
      {},
    );

    assert.equal(firstClick.data.created, true);
    assert.equal(secondClick.data.created, false);
    assert.equal(secondClick.data.clickCount, 1);
    assert.equal(firstLike.data.created, true);
    assert.equal(secondLike.data.created, false);
    assert.equal(secondLike.data.likeCount, 1);

    const storedSignals = await db
      .prepare(
        `SELECT
          SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clickEvents,
          SUM(CASE WHEN event_type = 'like' THEN 1 ELSE 0 END) AS likeEvents,
          COUNT(DISTINCT anonymous_user_id) AS uniqueUsers
        FROM place_events
        WHERE place_id = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind("busan-gwangalli")
      .first<{ clickEvents: number; likeEvents: number; uniqueUsers: number }>();
    assert.deepEqual(storedSignals, {
      clickEvents: 1,
      likeEvents: 1,
      uniqueUsers: 1,
    });

    const ranking = await d1Get<SuccessPayload<Ranking[]>>(db, "https://api.test/api/rankings/regions/busan?limit=10", anonymousId);
    const gwangalli = ranking.data.find((item) => item.placeId === "busan-gwangalli");
    assert.equal(gwangalli?.clickCount, 1);
    assert.equal(gwangalli?.likeCount, 1);
    assert.equal(gwangalli?.uniqueUserCount, 1);
    assert.equal(gwangalli?.score, 101);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("admin moderation role gates update D1 R2 and CACHE invalidation", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const cache = new FakeKVNamespace();

  try {
    const anonymousId = "anon_d1_admin_target";
    const comment = await d1Post<SuccessPayload<Comment>>(db, "https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: "운영자 숨김 복구 테스트입니다.",
    });
    const photo = await d1Post<SuccessPayload<PhotoCompleteData>>(db, "https://api.test/api/photos/complete", anonymousId, {
      uploadId: "upload_admin_d1",
      placeId: "busan-gwangalli",
      byteSize: 100_000,
      mimeType: "image/webp",
      width: 800,
      height: 600,
      clientReencoded: true,
    });
    await d1AdminPost<SuccessPayload<{ decision: string; public: boolean }>>(
      db,
      `https://api.test/api/admin/photos/${photo.data.photo.id}/moderation`,
      { decision: "approved", reason: "moderation fixture review passed" },
      {},
      "test-moderator-token",
    );

    const forbidden = await rawD1AdminPost(db, "https://api.test/api/admin/moderation/hide", {
      targetType: "comment",
      targetId: comment.data.id,
      reason: "권한 실패 테스트",
    });
    assert.equal(forbidden.status, 403);

    const hiddenComment = await d1AdminPost<SuccessPayload<{ action: string }>>(db, "https://api.test/api/admin/moderation/hide", {
      targetType: "comment",
      targetId: comment.data.id,
      reason: "운영자 숨김 테스트",
    });
    assert.equal(hiddenComment.data.action, "hide");

    const commentsAfterHide = await d1Get<SuccessPayload<Comment[]>>(db, "https://api.test/api/comments?placeId=busan-gwangalli", anonymousId);
    assert.equal(commentsAfterHide.data.some((item) => item.id === comment.data.id), false);

    const restoredComment = await d1AdminPost<SuccessPayload<{ action: string }>>(db, "https://api.test/api/admin/moderation/restore", {
      targetType: "comment",
      targetId: comment.data.id,
      reason: "운영자 복구 테스트",
    });
    assert.equal(restoredComment.data.action, "restore");

    const commentsAfterRestore = await d1Get<SuccessPayload<Comment[]>>(db, "https://api.test/api/comments?placeId=busan-gwangalli", anonymousId);
    assert.equal(commentsAfterRestore.data.some((item) => item.id === comment.data.id), true);

    const hiddenPhoto = await d1AdminPost<SuccessPayload<{ action: string }>>(db, "https://api.test/api/admin/moderation/hide", {
      targetType: "photo",
      targetId: photo.data.photo.id,
      reason: "사진 임시 숨김",
    });
    assert.equal(hiddenPhoto.data.action, "hide");

    const photosAfterHide = await d1Get<SuccessPayload<Array<{ id: string }>>>(db, "https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
    assert.equal(photosAfterHide.data.some((item) => item.id === photo.data.photo.id), false);

    await d1AdminPost<SuccessPayload<{ action: string }>>(db, "https://api.test/api/admin/moderation/restore", {
      targetType: "photo",
      targetId: photo.data.photo.id,
      reason: "사진 복구",
    });

    const photosAfterRestore = await d1Get<SuccessPayload<Array<{ id: string }>>>(db, "https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
    assert.equal(photosAfterRestore.data.some((item) => item.id === photo.data.photo.id), true);

    const moderatorDelete = await rawD1AdminPostWithToken(
      db,
      "https://api.test/api/admin/moderation/delete",
      {
        targetType: "photo",
        targetId: photo.data.photo.id,
        reason: "moderator는 최종 삭제 불가",
      },
      "test-moderator-token",
    );
    const moderatorDeletePayload = (await moderatorDelete.json()) as FailurePayload;
    assert.equal(moderatorDelete.status, 403);
    assert.equal(moderatorDeletePayload.error.code, "INSUFFICIENT_ADMIN_ROLE");

    const deletedPhoto = await d1AdminPost<SuccessPayload<{ action: string; r2Deleted: boolean }>>(
      db,
      "https://api.test/api/admin/moderation/delete",
      {
        targetType: "photo",
        targetId: photo.data.photo.id,
        reason: "개인정보 노출 최종 삭제",
      },
      { PHOTOS: r2, CACHE: cache },
    );
    assert.equal(deletedPhoto.data.action, "delete");
    assert.equal(deletedPhoto.data.r2Deleted, true);
    assert.deepEqual(r2.deletedKeys, [photo.data.storageKey]);
    assert.deepEqual(cache.deletedKeys, [
      "rankings:nationwide",
      "rankings:map-bounds",
      "rankings:region:busan",
      "rankings:area:busan",
      "rankings:category:busan",
      "places:busan-gwangalli",
      "place-live:busan-gwangalli",
      "rankings:place:busan-gwangalli",
      "photos:busan-gwangalli",
    ]);
    assert.deepEqual(deletedPhoto.meta?.cacheInvalidation, {
      binding: "CACHE",
      keys: cache.deletedKeys,
      deletedKeys: cache.deletedKeys,
    });

    const photosAfterDelete = await d1Get<SuccessPayload<Array<{ id: string }>>>(db, "https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
    assert.equal(photosAfterDelete.data.some((item) => item.id === photo.data.photo.id), false);

    await d1AdminPost<SuccessPayload<{ action: string }>>(db, "https://api.test/api/admin/moderation/hide", {
      targetType: "place",
      targetId: "busan-gwangalli",
      reason: "장소 임시 제외",
    });
    const placesAfterHide = await d1Get<SuccessPayload<Place[]>>(db, "https://api.test/api/places?regionId=busan", anonymousId);
    assert.equal(placesAfterHide.data.some((place) => place.id === "busan-gwangalli"), false);
    const rankingUrlsAfterHide = [
      "https://api.test/api/rankings/global?limit=10",
      "https://api.test/api/rankings/regions/busan?limit=10",
      "https://api.test/api/rankings/regions/busan/areas/busan-suyeong?limit=10",
      "https://api.test/api/rankings/regions/busan/categories/tourism?limit=10",
      "https://api.test/api/rankings?bbox=129.0,35.0,129.2,35.2&limit=10",
    ];

    for (const rankingUrl of rankingUrlsAfterHide) {
      const rankingsAfterHide = await d1Get<SuccessPayload<Array<{ placeId: string }>>>(db, rankingUrl, anonymousId);
      assert.equal(rankingsAfterHide.data.some((ranking) => ranking.placeId === "busan-gwangalli"), false, rankingUrl);
    }

    await d1AdminPost<SuccessPayload<{ action: string }>>(db, "https://api.test/api/admin/moderation/restore", {
      targetType: "place",
      targetId: "busan-gwangalli",
      reason: "장소 복구",
    });
    const placesAfterRestore = await d1Get<SuccessPayload<Place[]>>(db, "https://api.test/api/places?regionId=busan", anonymousId);
    assert.equal(placesAfterRestore.data.some((place) => place.id === "busan-gwangalli"), true);
    const rankingsAfterRestore = await d1Get<SuccessPayload<Array<{ placeId: string }>>>(
      db,
      "https://api.test/api/rankings/regions/busan?limit=10",
      anonymousId,
    );
    assert.equal(rankingsAfterRestore.data.some((ranking) => ranking.placeId === "busan-gwangalli"), true);

    const actions = await db.prepare("SELECT COUNT(*) AS count FROM admin_actions").first<{ count: number }>();
    assert.equal(actions?.count, 8);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("admin user restrictions block public D1 writes until unrestricted", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const anonymousId = "anon_d1_restricted_user";
    const existingComment = await d1Post<SuccessPayload<Comment>>(db, "https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: "제한 전 작성한 댓글입니다.",
    });
    const storedUser = await db
      .prepare("SELECT anonymous_user_id AS anonymousUserId FROM comments WHERE id = ?")
      .bind(existingComment.data.id)
      .first<{ anonymousUserId: string }>();
    const anonymousUserId = storedUser?.anonymousUserId ?? "";
    assert.match(anonymousUserId, /^anon_[a-f0-9]{48}$/);
    const blockedUntil = "2099-01-01T00:00:00.000Z";

    const moderatorRestrict = await rawD1AdminPostWithToken(
      db,
      "https://api.test/api/admin/users/restrict",
      {
        anonymousUserId,
        reason: "반복 스팸 테스트",
        blockedUntil,
      },
      "test-moderator-token",
    );
    const moderatorPayload = (await moderatorRestrict.json()) as FailurePayload;
    assert.equal(moderatorRestrict.status, 403);
    assert.equal(moderatorPayload.error.code, "INSUFFICIENT_ADMIN_ROLE");

    const restricted = await d1AdminPost<
      SuccessPayload<{
        anonymousUserId: string;
        restricted: boolean;
        blockedUntil: string | null;
      }>
    >(db, "https://api.test/api/admin/users/restrict", {
      anonymousUserId,
      reason: "반복 스팸 테스트",
      blockedUntil,
    });
    assert.equal(restricted.data.anonymousUserId, anonymousUserId);
    assert.equal(restricted.data.restricted, true);
    assert.equal(restricted.data.blockedUntil, blockedUntil);

    const blockedRequests = await Promise.all([
      rawD1Post(db, "https://api.test/api/comments", anonymousId, {
        placeId: "busan-gwangalli",
        body: "제한 중 댓글입니다.",
      }),
      rawD1Post(db, "https://api.test/api/photos/upload-url", anonymousId, {
        placeId: "busan-gwangalli",
        mimeType: "image/webp",
      }),
      rawD1Post(db, "https://api.test/api/photos/complete", anonymousId, {
        uploadId: "upload_restricted",
        placeId: "busan-gwangalli",
        byteSize: 100_000,
        mimeType: "image/webp",
        width: 800,
        height: 600,
        clientReencoded: true,
      }),
      rawD1Post(db, "https://api.test/api/places/busan-gwangalli/like", anonymousId, {}),
      rawD1Post(db, "https://api.test/api/moderation/reports", anonymousId, {
        targetType: "place",
        targetId: "busan-gwangalli",
        reason: "spam",
      }),
    ]);

    for (const response of blockedRequests) {
      const payload = (await response.json()) as FailurePayload;
      assert.equal(response.status, 403);
      assert.equal(payload.error.code, "USER_RESTRICTED");
      assert.equal(String(JSON.stringify(payload)).includes(anonymousId), false);
      assert.equal(String(JSON.stringify(payload)).includes("반복 스팸 테스트"), false);
    }

    const commentCount = await db.prepare("SELECT COUNT(*) AS count FROM comments WHERE anonymous_user_id = ?").bind(anonymousUserId).first<{ count: number }>();
    assert.equal(commentCount?.count, 1);
    const photoCount = await db.prepare("SELECT COUNT(*) AS count FROM photos WHERE anonymous_user_id = ?").bind(anonymousUserId).first<{ count: number }>();
    assert.equal(photoCount?.count, 0);
    const blockCount = await db.prepare("SELECT COUNT(*) AS count FROM blocked_users WHERE anonymous_user_id = ?").bind(anonymousUserId).first<{ count: number }>();
    assert.equal(blockCount?.count, 1);

    const unrestricted = await d1AdminPost<SuccessPayload<{ anonymousUserId: string; restricted: boolean }>>(
      db,
      "https://api.test/api/admin/users/unrestrict",
      {
        anonymousUserId,
        reason: "테스트 제한 해제",
      },
    );
    assert.equal(unrestricted.data.anonymousUserId, anonymousUserId);
    assert.equal(unrestricted.data.restricted, false);

    const allowedComment = await d1Post<SuccessPayload<Comment>>(db, "https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: "제한 해제 후 댓글입니다.",
    });
    assert.equal(allowedComment.meta?.storage, "d1");

    const finalBlockCount = await db.prepare("SELECT COUNT(*) AS count FROM blocked_users WHERE anonymous_user_id = ?").bind(anonymousUserId).first<{ count: number }>();
    assert.equal(finalBlockCount?.count, 0);
    const userActions = await db
      .prepare("SELECT action_type AS actionType, target_type AS targetType, target_id AS targetId FROM admin_actions WHERE target_id = ? ORDER BY created_at ASC")
      .bind(anonymousUserId)
      .all<{ actionType: string; targetType: string; targetId: string }>();
    assert.deepEqual(userActions.results, [
      {
        actionType: "user_restrict",
        targetType: "anonymous_user",
        targetId: anonymousUserId,
      },
      {
        actionType: "user_unrestrict",
        targetType: "anonymous_user",
        targetId: anonymousUserId,
      },
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("admin bulk moderation hides and restores D1 targets with partial results and audit records", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const hideCache = new FakeKVNamespace();
  const restoreCache = new FakeKVNamespace();

  type BulkModerationPayload = SuccessPayload<{
    action: "hide" | "restore";
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
      targetType: "place" | "post" | "comment" | "photo";
      targetId: string;
      status: "ok" | "not_found";
    }>;
  }>;

  try {
    const anonymousId = "anon_d1_admin_bulk_target";
    const comment = await d1Post<SuccessPayload<Comment>>(db, "https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: "일괄 운영 숨김 테스트입니다.",
    });
    const photo = await d1Post<SuccessPayload<PhotoCompleteData>>(db, "https://api.test/api/photos/complete", anonymousId, {
      uploadId: "upload_admin_bulk_d1",
      placeId: "busan-gwangalli",
      byteSize: 100_000,
      mimeType: "image/webp",
      width: 800,
      height: 600,
      clientReencoded: true,
    });
    await d1AdminPost<SuccessPayload<{ decision: string; public: boolean }>>(
      db,
      `https://api.test/api/admin/photos/${photo.data.photo.id}/moderation`,
      { decision: "approved", reason: "bulk moderation fixture review passed" },
      {},
      "test-moderator-token",
    );

    const forbidden = await rawD1AdminPostWithToken(
      db,
      "https://api.test/api/admin/moderation/bulk",
      {
        action: "hide",
        reason: "operator 권한 실패",
        targets: [{ targetType: "comment", targetId: comment.data.id }],
      },
      "test-operator-token",
    );
    const forbiddenPayload = (await forbidden.json()) as FailurePayload;
    assert.equal(forbidden.status, 403);
    assert.equal(forbiddenPayload.error.code, "INSUFFICIENT_ADMIN_ROLE");

    const rejectedDelete = await rawD1AdminPostWithToken(
      db,
      "https://api.test/api/admin/moderation/bulk",
      {
        action: "delete",
        reason: "bulk delete는 허용하지 않음",
        targets: [{ targetType: "photo", targetId: photo.data.photo.id }],
      },
      "test-moderator-token",
    );
    const rejectedDeletePayload = (await rejectedDelete.json()) as FailurePayload;
    assert.equal(rejectedDelete.status, 400);
    assert.equal(rejectedDeletePayload.error.code, "VALIDATION_ERROR");

    const hidden = await d1AdminPost<BulkModerationPayload>(
      db,
      "https://api.test/api/admin/moderation/bulk",
      {
        action: "hide",
        reason: "일괄 임시 숨김",
        targets: [
          { targetType: "comment", targetId: comment.data.id },
          { targetType: "photo", targetId: photo.data.photo.id },
          { targetType: "comment", targetId: "missing-comment-id" },
        ],
      },
      { CACHE: hideCache },
      "test-moderator-token",
    );
    assert.equal(hidden.data.action, "hide");
    assert.equal(hidden.data.total, 3);
    assert.equal(hidden.data.succeeded, 2);
    assert.equal(hidden.data.failed, 1);
    assert.deepEqual(
      hidden.data.results.map((result) => result.status),
      ["ok", "ok", "not_found"],
    );
    assert.deepEqual((hidden.meta?.cacheInvalidation as { binding?: string; deletedKeys?: string[] }).binding, "CACHE");
    assert.ok(hideCache.deletedKeys.includes("comments:busan-gwangalli"));
    assert.ok(hideCache.deletedKeys.includes("photos:busan-gwangalli"));

    const commentsAfterHide = await d1Get<SuccessPayload<Comment[]>>(db, "https://api.test/api/comments?placeId=busan-gwangalli", anonymousId);
    assert.equal(commentsAfterHide.data.some((item) => item.id === comment.data.id), false);

    const photosAfterHide = await d1Get<SuccessPayload<Array<{ id: string }>>>(db, "https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
    assert.equal(photosAfterHide.data.some((item) => item.id === photo.data.photo.id), false);

    const bulkHideActions = await db.prepare("SELECT COUNT(*) AS count FROM admin_actions WHERE action_type = 'bulk_hide'").first<{ count: number }>();
    assert.equal(bulkHideActions?.count, 2);

    const restored = await d1AdminPost<BulkModerationPayload>(
      db,
      "https://api.test/api/admin/moderation/bulk",
      {
        action: "restore",
        targets: [
          { targetType: "comment", targetId: comment.data.id },
          { targetType: "photo", targetId: photo.data.photo.id },
        ],
      },
      { CACHE: restoreCache },
      "test-moderator-token",
    );
    assert.equal(restored.data.action, "restore");
    assert.equal(restored.data.total, 2);
    assert.equal(restored.data.succeeded, 2);
    assert.equal(restored.data.failed, 0);
    assert.ok(restoreCache.deletedKeys.includes("comments:busan-gwangalli"));
    assert.ok(restoreCache.deletedKeys.includes("photos:busan-gwangalli"));

    const commentsAfterRestore = await d1Get<SuccessPayload<Comment[]>>(db, "https://api.test/api/comments?placeId=busan-gwangalli", anonymousId);
    assert.equal(commentsAfterRestore.data.some((item) => item.id === comment.data.id), true);

    const photosAfterRestore = await d1Get<SuccessPayload<Array<{ id: string }>>>(db, "https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
    assert.equal(photosAfterRestore.data.some((item) => item.id === photo.data.photo.id), true);

    const bulkRestoreActions = await db.prepare("SELECT COUNT(*) AS count FROM admin_actions WHERE action_type = 'bulk_restore'").first<{ count: number }>();
    assert.equal(bulkRestoreActions?.count, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("duplicate comment likes count once per anonymous user", async () => {
  const anonymousId = "anon_duplicate_like_test";
  const created = await post<SuccessPayload<Comment>>("https://api.test/api/comments", anonymousId, {
    placeId: "busan-gwangalli",
    body: "지금은 주차장이 거의 찼어요.",
  });

  const first = await post<SuccessPayload<{ likeCount: number; created: boolean }>>(
    `https://api.test/api/comments/${created.data.id}/like`,
    anonymousId,
    {},
  );
  const second = await post<SuccessPayload<{ likeCount: number; created: boolean }>>(
    `https://api.test/api/comments/${created.data.id}/like`,
    anonymousId,
    {},
  );

  assert.equal(first.data.created, true);
  assert.equal(second.data.created, false);
  assert.equal(second.data.likeCount, 1);
});

test("duplicate photo clicks count once and photo complete rejects original filenames", async () => {
  const anonymousId = "anon_duplicate_photo_test";
  const complete = await post<SuccessPayload<PhotoCompleteData>>("https://api.test/api/photos/complete", anonymousId, {
    uploadId: "upload_1",
    placeId: "busan-gwangalli",
    byteSize: 120_000,
    mimeType: "image/webp",
    width: 1280,
    height: 720,
    clientReencoded: true,
  });

  assert.match(complete.data.storageKey, /^photos\/.+\.webp$/);

  const first = await post<SuccessPayload<{ clickCount: number; created: boolean }>>(
    `https://api.test/api/photos/${complete.data.photo.id}/click`,
    anonymousId,
    {},
  );
  const second = await post<SuccessPayload<{ clickCount: number; created: boolean }>>(
    `https://api.test/api/photos/${complete.data.photo.id}/click`,
    anonymousId,
    {},
  );

  assert.equal(first.data.created, true);
  assert.equal(second.data.created, false);
  assert.equal(second.data.clickCount, 1);

  const rejected = await rawPost("https://api.test/api/photos/complete", "anon_original_name_test", {
    uploadId: "upload_2",
    placeId: "busan-gwangalli",
    byteSize: 120_000,
    mimeType: "image/jpeg",
    width: 1024,
    height: 768,
    clientReencoded: true,
    originalFilename: "real-camera-name.jpg",
  });
  const rejectedPayload = (await rejected.json()) as FailurePayload;

  assert.equal(rejected.status, 400);
  assert.equal(rejectedPayload.success, false);
  assert.equal(rejectedPayload.error.code, "PHOTO_ORIGINAL_FILENAME_FORBIDDEN");
});

test("photo policy caps every transmitted and stored image at one MiB", () => {
  assert.equal(policies.PHOTO_MAX_BYTES, 1_048_576);
  assert.equal(policies.PHOTO_MAX_DIMENSION, 1280);
  assert.throws(
    () =>
      policies.validatePhotoComplete({
        uploadId: "upload_one_mib_policy",
        placeId: "busan-gwangalli",
        regionCode: "busan",
        byteSize: 1_048_577,
        mimeType: "image/jpeg",
        width: 1280,
        height: 960,
        clientReencoded: true,
      }),
    /PHOTO_SIZE_LIMIT/,
  );
});

test("photo upload ticket publishes one MiB policy and rejects oversized bytes before an R2 staging write", async () => {
  const anonymousId = "anon_photo_one_mib_test";
  const r2 = new FakeR2Bucket();
  const ticketResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json", "x-silsigan-anon-id": anonymousId },
      body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
    }),
    { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
  );
  const ticket = (await ticketResponse.json()) as SuccessPayload<{ uploadId: string }>;

  assert.equal(ticketResponse.status, 201);
  assert.deepEqual(ticket.meta?.r2Policy, {
    maxBytes: 1_048_576,
    maxDimension: 1280,
    originalFilenameStored: false,
    gpsExifStripped: true,
    processing: "worker-strips-metadata-before-r2-put",
  });

  const oversized = new Uint8Array(1_048_577);
  oversized[0] = 0xff;
  oversized[1] = 0xd8;
  const uploadResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload", {
      method: "PUT",
      headers: {
        "content-type": "image/jpeg",
        "x-silsigan-anon-id": anonymousId,
        "x-silsigan-place-id": "busan-gwangalli",
        "x-silsigan-upload-id": ticket.data.uploadId,
      },
      body: oversized,
    }),
    { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
  );
  const uploadPayload = (await uploadResponse.json()) as FailurePayload;

  assert.equal(uploadResponse.status, 413);
  assert.equal(uploadPayload.error.code, "PHOTO_SIZE_LIMIT");
  assert.equal(r2.putObjects.some((object) => object.key.startsWith("photos/_uploads/")), false);
});

test("photo upload cost switch blocks metered R2 work before a ticket write", async () => {
  const r2 = new FakeR2Bucket();
  const response = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_cost_switch" },
      body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
    }),
    { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "false" },
  );
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, "PHOTO_UPLOADS_PAUSED");
  assert.equal(r2.putObjects.length, 0);
});

test("photo writes require an explicit true kill-switch value before D1 or R2 work", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();

  try {
    for (const [index, flag] of [undefined, "false", "enabled", "TRUE", " true "].entries()) {
      const response = await worker.handleRequest(
        new Request("https://api.test/api/photos/upload-url", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-silsigan-anon-id": `anon_photo_default_off_${index}`,
          },
          body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
        }),
        {
          DB: db,
          PHOTOS: r2,
          ...(flag === undefined ? {} : { PHOTO_UPLOADS_ENABLED: flag }),
        },
      );
      const payload = (await response.json()) as FailurePayload;

      assert.equal(response.status, 503);
      assert.equal(payload.error.code, "PHOTO_UPLOADS_PAUSED");
    }

    const sessionCount = await db.prepare("SELECT COUNT(*) AS count FROM photo_upload_sessions").first<{ count: number }>();
    const eventCount = await db.prepare("SELECT COUNT(*) AS count FROM metered_usage_events").first<{ count: number }>();
    assert.equal(sessionCount?.count, 0);
    assert.equal(eventCount?.count, 0);
    assert.equal(r2.putObjects.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo writes fail closed when the Cloudflare rate-limit binding is missing", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();

  try {
    const anonymousId = "anon_photo_missing_native_limit";
    const response = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: signedPhotoRequestHeaders(anonymousId, "photo-missing-native-limit"),
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      persistentPhotoBindings(db, r2),
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "COST_GUARD_UNAVAILABLE");
    assert.equal(r2.putObjects.length, 0);
    const eventCount = await db.prepare("SELECT COUNT(*) AS count FROM metered_usage_events").first<{ count: number }>();
    assert.equal(eventCount?.count, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare photo rate-limit binding rejects writes before R2 or D1 work", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const limiter = new FakeRateLimitBinding(false);

  try {
    const anonymousId = "anon_photo_native_limited";
    const response = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: signedPhotoRequestHeaders(anonymousId, "photo-native-limited-key"),
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { ...persistentPhotoBindings(db, r2), PHOTO_WRITE_RATE_LIMITER: limiter },
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 429);
    assert.equal(payload.error.code, "RATE_LIMITED");
    assert.deepEqual(limiter.keys, ["photo-write:global"]);
    assert.equal(r2.putObjects.length, 0);
    const eventCount = await db.prepare("SELECT COUNT(*) AS count FROM metered_usage_events").first<{ count: number }>();
    assert.equal(eventCount?.count, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo writes fail closed without the approved server pixel-reencode path", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const limiter = new FakeRateLimitBinding(true);

  try {
    const anonymousId = "anon_photo_processing_unavailable";
    const response = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: signedPhotoRequestHeaders(anonymousId, "photo-processing-unavailable"),
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { ...persistentPhotoBindings(db, r2), PHOTO_WRITE_RATE_LIMITER: limiter },
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "PHOTO_PROCESSING_UNAVAILABLE");
    assert.deepEqual(limiter.keys, ["photo-write:global"]);
    assert.equal(r2.putObjects.length, 0);
    const eventCount = await db.prepare("SELECT COUNT(*) AS count FROM metered_usage_events").first<{ count: number }>();
    assert.equal(eventCount?.count, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo writes require D1, R2, KV, and Durable Object readiness before metered work", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const images = new FakeImagesBinding(jpegServerReencodedSample());
  const anonymousId = "anon_photo_binding_readiness";
  const baseEnv = {
    ...persistentPhotoBindings(db, r2),
    IMAGES: images,
    IMAGE_TRANSFORMS_ENABLED: "true",
    PHOTO_WRITE_RATE_LIMITER: new FakeRateLimitBinding(true),
  };

  try {
    for (const missingBinding of ["PHOTOS", "CACHE", "PLACE_ROOM"] as const) {
      const response = await worker.handleRequest(
        new Request("https://api.test/api/photos/upload-url", {
          method: "POST",
          headers: signedPhotoRequestHeaders(anonymousId, `photo-binding-${missingBinding.toLowerCase()}`),
          body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
        }),
        { ...baseEnv, [missingBinding]: undefined },
      );
      const payload = (await response.json()) as FailurePayload;
      assert.equal(response.status, 503);
      assert.equal(payload.error.code, "COST_GUARD_UNAVAILABLE");
    }

    await db.prepare("DROP TABLE photo_upload_idempotency_keys").run();
    const missingSchema = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: signedPhotoRequestHeaders(anonymousId, "photo-missing-idempotency-schema"),
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      baseEnv,
    );
    const missingSchemaPayload = (await missingSchema.json()) as FailurePayload;
    assert.equal(missingSchema.status, 503);
    assert.equal(missingSchemaPayload.error.code, "COST_GUARD_UNAVAILABLE");

    const sessions = await db.prepare("SELECT COUNT(*) AS count FROM photo_upload_sessions").first<{ count: number }>();
    const events = await db.prepare("SELECT COUNT(*) AS count FROM metered_usage_events").first<{ count: number }>();
    assert.equal(sessions?.count, 0);
    assert.equal(events?.count, 0);
    assert.equal(r2.putObjects.length, 0);
    assert.equal(images.inputs.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo writes require a valid idempotency key and signed anonymous session", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const limiter = new FakeRateLimitBinding(true);
  const anonymousId = "anon_photo_signed_session";
  const env = {
    ...persistentPhotoBindings(db, r2),
    IMAGES: new FakeImagesBinding(jpegServerReencodedSample()),
    IMAGE_TRANSFORMS_ENABLED: "true",
    PHOTO_WRITE_RATE_LIMITER: limiter,
  };

  try {
    const missingKey = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          ...signedPhotoRequestHeaders(anonymousId, "placeholder-idempotency"),
          "idempotency-key": "",
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      env,
    );
    const missingKeyPayload = (await missingKey.json()) as FailurePayload;
    assert.equal(missingKey.status, 400);
    assert.equal(missingKeyPayload.error.code, "PHOTO_IDEMPOTENCY_KEY_REQUIRED");

    const invalidKey = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: signedPhotoRequestHeaders(anonymousId, "short"),
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      env,
    );
    const invalidKeyPayload = (await invalidKey.json()) as FailurePayload;
    assert.equal(invalidKey.status, 400);
    assert.equal(invalidKeyPayload.error.code, "PHOTO_IDEMPOTENCY_KEY_INVALID");

    const missingSignature = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-missing-session-signature",
          "x-silsigan-anon-id": anonymousId,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      env,
    );
    const missingSignaturePayload = (await missingSignature.json()) as FailurePayload;
    assert.equal(missingSignature.status, 403);
    assert.equal(missingSignaturePayload.error.code, "PHOTO_SESSION_SIGNATURE_INVALID");

    const invalidSignature = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          ...signedPhotoRequestHeaders(anonymousId, "photo-signed-session-key"),
          "x-silsigan-anon-signature": `v1.${"0".repeat(64)}`,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      env,
    );
    const invalidSignaturePayload = (await invalidSignature.json()) as FailurePayload;
    assert.equal(invalidSignature.status, 403);
    assert.equal(invalidSignaturePayload.error.code, "PHOTO_SESSION_SIGNATURE_INVALID");

    const accepted = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: signedPhotoRequestHeaders(anonymousId, "photo-signed-session-key"),
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      env,
    );
    assert.equal(accepted.status, 201);
    assert.match(accepted.headers.get("x-silsigan-anon-signature") ?? "", /^v1\.[a-f0-9]{64}$/);
    assert.deepEqual(limiter.keys, ["photo-write:global"]);
    assert.equal(r2.putObjects.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 photo upload ticket retries are idempotent and reject request collisions", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const anonymousId = "anon_photo_idempotency_retry";
  const idempotencyKey = "photo-ticket-retry-key-0001";
  const requestTicket = (mimeType: "image/jpeg" | "image/webp") =>
    worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-silsigan-anon-id": anonymousId,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );

  try {
    const first = await requestTicket("image/jpeg");
    const firstPayload = (await first.json()) as SuccessPayload<{ uploadId: string }>;
    const retry = await requestTicket("image/jpeg");
    const retryPayload = (await retry.json()) as SuccessPayload<{ uploadId: string }>;
    const collision = await requestTicket("image/webp");
    const collisionPayload = (await collision.json()) as FailurePayload;

    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retryPayload.data.uploadId, firstPayload.data.uploadId);
    assert.equal(retryPayload.meta?.idempotentReplay, true);
    assert.equal(collision.status, 409);
    assert.equal(collisionPayload.error.code, "PHOTO_IDEMPOTENCY_CONFLICT");

    const sessions = await db.prepare("SELECT COUNT(*) AS count FROM photo_upload_sessions").first<{ count: number }>();
    const keys = await db
      .prepare("SELECT idempotency_key_hash AS keyHash FROM photo_upload_idempotency_keys")
      .all<{ keyHash: string }>();
    const events = await db.prepare("SELECT COUNT(*) AS count FROM metered_usage_events").first<{ count: number }>();
    assert.equal(sessions?.count, 1);
    assert.equal(keys.results?.length, 1);
    assert.match(keys.results?.[0]?.keyHash ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(keys.results).includes(idempotencyKey), false);
    assert.equal(events?.count, 1);
    assert.equal(r2.putObjects.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 photo idempotency keys remain actor-scoped under identifier rotation", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const sharedKey = "photo-shared-actor-key-0001";

  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await worker.handleRequest(
        new Request("https://api.test/api/photos/upload-url", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": `203.0.113.${210 + index}`,
            "idempotency-key": sharedKey,
            "x-silsigan-anon-id": `anon_photo_shared_key_${index}`,
          },
          body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
        }),
        { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
      );
      assert.equal(response.status, 201);
    }

    const sessions = await db.prepare("SELECT COUNT(*) AS count FROM photo_upload_sessions").first<{ count: number }>();
    const keys = await db.prepare("SELECT COUNT(*) AS count FROM photo_upload_idempotency_keys").first<{ count: number }>();
    const events = await db
      .prepare("SELECT COUNT(*) AS count FROM metered_usage_events WHERE scope = 'photo:upload-url:daily'")
      .first<{ count: number }>();
    assert.equal(sessions?.count, 2);
    assert.equal(keys?.count, 2);
    assert.equal(events?.count, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 photo idempotency expiry and outstanding queue fail closed", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const expiryActor = "anon_photo_idempotency_expiry";

  try {
    const first = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-expiry-key-0001",
          "x-silsigan-anon-id": expiryActor,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const firstPayload = (await first.json()) as SuccessPayload<{ uploadId: string }>;
    await db
      .prepare("UPDATE photo_upload_sessions SET expires_at = ? WHERE upload_id = ?")
      .bind("2020-01-01T00:00:00.000Z", firstPayload.data.uploadId)
      .run();
    const expired = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-expiry-key-0001",
          "x-silsigan-anon-id": expiryActor,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const expiredPayload = (await expired.json()) as FailurePayload;
    assert.equal(expired.status, 410);
    assert.equal(expiredPayload.error.code, "PHOTO_UPLOAD_EXPIRED");

    const queueActor = "anon_photo_queue_ceiling";
    const queueTicket = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-queue-key-0001",
          "x-silsigan-anon-id": queueActor,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const queueTicketPayload = (await queueTicket.json()) as SuccessPayload<{ uploadId: string }>;
    const actorRow = await db
      .prepare("SELECT anonymous_user_id AS anonymousUserId FROM photo_upload_sessions WHERE upload_id = ?")
      .bind(queueTicketPayload.data.uploadId)
      .first<{ anonymousUserId: string }>();
    assert.ok(actorRow?.anonymousUserId);
    const future = new Date(Date.now() + 600_000).toISOString();
    for (let index = 2; index <= 3; index += 1) {
      await db
        .prepare(
          `INSERT INTO photo_upload_sessions
            (upload_id, anonymous_user_id, place_id, mime_type, storage_key, staging_key, status, expires_at)
           VALUES (?, ?, 'busan-gwangalli', 'image/jpeg', ?, ?, 'ticketed', ?)`,
        )
        .bind(
          `upload_queue_fixture_${index}`,
          actorRow?.anonymousUserId ?? "",
          `photos/queue_fixture_${index}.jpg`,
          `photos/_uploads/upload_queue_fixture_${index}`,
          future,
        )
        .run();
    }
    const queueFull = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-queue-key-0004",
          "x-silsigan-anon-id": queueActor,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const queueFullPayload = (await queueFull.json()) as FailurePayload;
    assert.equal(queueFull.status, 429);
    assert.equal(queueFullPayload.error.code, "PHOTO_UPLOAD_QUEUE_FULL");
    assert.equal(r2.putObjects.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 photo ticket retry storm creates one ticket and one persistent cost event", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const anonymousId = "anon_photo_retry_storm";
  const request = () =>
    worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-retry-storm-key-0001",
          "x-silsigan-anon-id": anonymousId,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );

  try {
    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      statuses.push((await request()).status);
    }
    assert.deepEqual(statuses, [201, 200, 200, 429, 429]);
    const sessions = await db.prepare("SELECT COUNT(*) AS count FROM photo_upload_sessions").first<{ count: number }>();
    const events = await db.prepare("SELECT COUNT(*) AS count FROM metered_usage_events").first<{ count: number }>();
    assert.equal(sessions?.count, 1);
    assert.equal(events?.count, 1);
    assert.equal(r2.putObjects.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo reads fail closed before R2 when the Cloudflare rate-limit binding is missing", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/photos/photo_missing_native_limit/file", {
        headers: { "x-silsigan-anon-id": "anon_photo_read_missing_native_limit" },
      }),
      { DB: db, PHOTOS: r2, ENVIRONMENT: "staging" },
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "COST_GUARD_UNAVAILABLE");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("photo upload cost guard resists anonymous ID rotation from one client IP", async () => {
  const r2 = new FakeR2Bucket();
  const clientIp = "198.51.100.72";

  for (let index = 0; index < 20; index += 1) {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": clientIp,
          "x-silsigan-anon-id": `anon_photo_rotating_${index}`,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    assert.equal(response.status, 201);
  }

  const limited = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": clientIp,
        "x-silsigan-anon-id": "anon_photo_rotating_final",
      },
      body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
    }),
    { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
  );
  const payload = (await limited.json()) as FailurePayload;

  assert.equal(limited.status, 429);
  assert.equal(payload.error.code, "RATE_LIMITED");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal(r2.putObjects.length, 20);
});

test("D1 photo cost events retain only short-lived hashed actor and IP fingerprints", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const anonymousId = "anon_photo_cost_hash_test";
  const clientIp = "203.0.113.91";

  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": clientIp,
          "x-silsigan-anon-id": anonymousId,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    assert.equal(response.status, 201);

    const event = await db
      .prepare(
        "SELECT scope, actor_fingerprint AS actorFingerprint, ip_fingerprint AS ipFingerprint, expires_at AS expiresAt FROM metered_usage_events LIMIT 1",
      )
      .first<{ scope: string; actorFingerprint: string; ipFingerprint: string; expiresAt: string }>();

    assert.equal(event?.scope, "photo:upload-url:daily");
    assert.match(event?.actorFingerprint ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.match(event?.ipFingerprint ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(event).includes(anonymousId), false);
    assert.equal(JSON.stringify(event).includes(clientIp), false);
    assert.ok(Date.parse(event?.expiresAt ?? "") > Date.now());
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 photo cost guard enforces a global daily ceiling across rotating actors and IPs", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();

  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await worker.handleRequest(
        new Request("https://api.test/api/photos/upload-url", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": `203.0.113.${120 + index}`,
            "x-silsigan-anon-id": `anon_photo_global_${index}`,
          },
          body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
        }),
        { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true", PHOTO_GLOBAL_DAILY_LIMIT: "2" },
      );
      assert.equal(response.status, 201);
    }

    const limited = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.122",
          "x-silsigan-anon-id": "anon_photo_global_final",
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true", PHOTO_GLOBAL_DAILY_LIMIT: "2" },
    );
    const payload = (await limited.json()) as FailurePayload;

    assert.equal(limited.status, 429);
    assert.equal(payload.error.code, "RATE_LIMITED");
    const eventCount = await db
      .prepare("SELECT COUNT(*) AS count FROM metered_usage_events WHERE scope = 'photo:upload-url:daily'")
      .first<{ count: number }>();
    assert.equal(eventCount?.count, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 photo transform guard enforces the free rolling-month ceiling before another R2 write", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const source = jpegWithGpsExifSample();

  try {
    for (let index = 0; index < 2; index += 1) {
      const uniqueSource = new Uint8Array(source.byteLength + 1);
      uniqueSource.set(source);
      uniqueSource[uniqueSource.byteLength - 1] = index + 1;
      const response = await worker.handleRequest(
        new Request("https://api.test/api/photos/complete", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": `203.0.113.${140 + index}`,
            "x-silsigan-anon-id": `anon_photo_monthly_${index}`,
          },
          body: JSON.stringify({
            uploadId: `upload_monthly_${index}`,
            placeId: "busan-gwangalli",
            byteSize: uniqueSource.byteLength,
            mimeType: "image/jpeg",
            width: 1280,
            height: 960,
            clientReencoded: true,
            imageBase64: bytesToBase64(uniqueSource),
          }),
        }),
        { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true", PHOTO_GLOBAL_MONTHLY_LIMIT: "2" },
      );
      assert.equal(response.status, 201);
    }

    const blockedSource = new Uint8Array(source.byteLength + 1);
    blockedSource.set(source);
    blockedSource[blockedSource.byteLength - 1] = 3;
    const limited = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.142",
          "x-silsigan-anon-id": "anon_photo_monthly_final",
        },
        body: JSON.stringify({
          uploadId: "upload_monthly_final",
          placeId: "busan-gwangalli",
          byteSize: blockedSource.byteLength,
          mimeType: "image/jpeg",
          width: 1280,
          height: 960,
          clientReencoded: true,
          imageBase64: bytesToBase64(blockedSource),
        }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true", PHOTO_GLOBAL_MONTHLY_LIMIT: "2" },
    );
    const payload = (await limited.json()) as FailurePayload;

    assert.equal(limited.status, 429);
    assert.equal(payload.error.code, "RATE_LIMITED");
    assert.equal(r2.putObjects.filter((object) => !object.key.startsWith("photos/_")).length, 2);
    const eventCount = await db
      .prepare("SELECT COUNT(*) AS count FROM metered_usage_events WHERE scope = 'photo:transform:rolling-31d'")
      .first<{ count: number }>();
    assert.equal(eventCount?.count, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 photo storage budget rejects new tickets before the active-object ceiling is exceeded", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();

  try {
    const first = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_storage_first" },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true", PHOTO_GLOBAL_STORED_LIMIT: "1" },
    );
    assert.equal(first.status, 201);

    const limited = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_storage_second" },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true", PHOTO_GLOBAL_STORED_LIMIT: "1" },
    );
    const payload = (await limited.json()) as FailurePayload;

    assert.equal(limited.status, 429);
    assert.equal(payload.error.code, "PHOTO_STORAGE_BUDGET_EXHAUSTED");
    const sessionCount = await db.prepare("SELECT COUNT(*) AS count FROM photo_upload_sessions").first<{ count: number }>();
    assert.equal(sessionCount?.count, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo completion fails closed when monthly or stored cost ceilings are invalid", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const images = new FakeImagesBinding(jpegServerReencodedSample());
  const limiter = new FakeRateLimitBinding(true);
  const source = jpegWithGpsExifSample();

  try {
    const monthlyResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_invalid_monthly" },
        body: JSON.stringify({
          uploadId: "upload_invalid_monthly",
          placeId: "busan-gwangalli",
          byteSize: source.byteLength,
          mimeType: "image/jpeg",
          width: 1280,
          height: 960,
          clientReencoded: true,
          imageBase64: bytesToBase64(source),
        }),
      }),
      {
        DB: db,
        PHOTOS: r2,
        IMAGES: images,
        ENVIRONMENT: "staging",
        PHOTO_UPLOADS_ENABLED: "true",
        IMAGE_TRANSFORMS_ENABLED: "true",
        COST_GUARD_HASH_SECRET: "test-cost-guard-secret-that-is-long-enough",
        PHOTO_GLOBAL_DAILY_LIMIT: "150",
        PHOTO_GLOBAL_MONTHLY_LIMIT: "0",
        PHOTO_GLOBAL_STORED_LIMIT: "9000",
        PHOTO_WRITE_RATE_LIMITER: limiter,
      },
    );
    const monthlyPayload = (await monthlyResponse.json()) as FailurePayload;
    assert.equal(monthlyResponse.status, 503);
    assert.equal(monthlyPayload.error.code, "COST_GUARD_UNAVAILABLE");
    assert.equal(r2.putObjects.length, 0);

    const storedResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_invalid_stored" },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      {
        DB: db,
        PHOTOS: r2,
        IMAGES: images,
        ENVIRONMENT: "staging",
        PHOTO_UPLOADS_ENABLED: "true",
        IMAGE_TRANSFORMS_ENABLED: "true",
        COST_GUARD_HASH_SECRET: "test-cost-guard-secret-that-is-long-enough",
        PHOTO_GLOBAL_DAILY_LIMIT: "150",
        PHOTO_GLOBAL_MONTHLY_LIMIT: "4500",
        PHOTO_GLOBAL_STORED_LIMIT: "0",
        PHOTO_WRITE_RATE_LIMITER: limiter,
      },
    );
    const storedPayload = (await storedResponse.json()) as FailurePayload;
    assert.equal(storedResponse.status, 503);
    assert.equal(storedPayload.error.code, "COST_GUARD_UNAVAILABLE");
    assert.equal(r2.putObjects.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo writes fail closed when the global cost ceiling is invalid", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();

  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_invalid_global_limit" },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      {
        DB: db,
        PHOTOS: r2,
        ENVIRONMENT: "staging",
        PHOTO_UPLOADS_ENABLED: "true",
        COST_GUARD_HASH_SECRET: "test-cost-guard-secret-that-is-long-enough",
        PHOTO_GLOBAL_DAILY_LIMIT: "0",
      },
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "COST_GUARD_UNAVAILABLE");
    assert.equal(r2.putObjects.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 photo rows reject payload metadata above one MiB even when the API is bypassed", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    await db
      .prepare("INSERT INTO anonymous_users (id, session_hash) VALUES (?, ?)")
      .bind("anon_photo_db_limit", "sha256:photo-db-limit-session")
      .run();
    await assert.rejects(
      () =>
        db
          .prepare(
            `INSERT INTO photos
              (id, place_id, anonymous_user_id, r2_key, mime_type, byte_size, width, height)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            "photo_db_limit",
            "busan-gwangalli",
            "anon_photo_db_limit",
            "photos/photo_db_limit.webp",
            "image/webp",
            1_048_577,
            1280,
            960,
          )
          .run(),
      /PHOTO_MAX_BYTES_EXCEEDED/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo writes fail closed when the persistent cost-guard secret is missing", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();

  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_missing_cost_secret" },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, ENVIRONMENT: "staging", PHOTO_UPLOADS_ENABLED: "true" },
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "COST_GUARD_UNAVAILABLE");
    assert.equal(r2.putObjects.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("photo complete strips GPS EXIF sample before writing to R2", async () => {
  const anonymousId = "anon_photo_exif_strip_test";
  const r2 = new FakeR2Bucket();
  const source = jpegWithGpsExifSample();
  assert.equal(containsAscii(source, "Exif"), true);
  assert.equal(containsAscii(source, "GPSLatitude"), true);
  assert.equal(containsAscii(source, "Camera"), true);

  const response = await worker.handleRequest(
    new Request("https://api.test/api/photos/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify({
        uploadId: "upload_exif_strip",
        placeId: "busan-gwangalli",
        byteSize: source.byteLength,
        mimeType: "image/jpeg",
        width: 1,
        height: 1,
        clientReencoded: true,
        imageBase64: bytesToBase64(source),
      }),
    }),
    { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
  );
  const payload = (await response.json()) as SuccessPayload<PhotoCompleteData>;

  assert.equal(response.status, 201);
  assert.equal(r2.putObjects.length, 1);
  assert.equal(r2.putObjects[0]?.contentType, "image/jpeg");
  assert.equal(r2.putObjects[0]?.customMetadata?.gpsExifStripped, "true");
  assert.equal(r2.putObjects[0]?.customMetadata?.metadataRemoved, "true");
  assert.equal(payload.meta?.photoSanitization && typeof payload.meta.photoSanitization === "object", true);

  const stored = r2.putObjects[0]?.bytes ?? new Uint8Array();
  assert.equal(stored[0], 0xff);
  assert.equal(stored[1], 0xd8);
  assert.equal(containsAscii(stored, "Exif"), false);
  assert.equal(containsAscii(stored, "GPSLatitude"), false);
  assert.equal(containsAscii(stored, "Camera"), false);
  assert.ok(stored.byteLength < source.byteLength);

  const photosResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos?placeId=busan-gwangalli", {
      headers: {
        "x-silsigan-anon-id": anonymousId,
      },
    }),
    { PHOTOS: r2 },
  );
  const photosPayload = (await photosResponse.json()) as SuccessPayload<Array<{ id: string; ownedByCurrentSession: boolean; previewUrl: string | null }>>;
  const listedPhoto = photosPayload.data.find((photo) => photo.id === payload.data.photo.id);
  assert.equal(listedPhoto?.previewUrl, `https://api.test/api/photos/${payload.data.photo.id}/file`);
  assert.equal(listedPhoto?.ownedByCurrentSession, true);
  assert.equal(JSON.stringify(listedPhoto).includes("anonymousUserId"), false);
  assert.equal(JSON.stringify(listedPhoto).includes("storageKey"), false);
  assert.equal(JSON.stringify(listedPhoto).includes("deletedAt"), false);
  assert.equal(JSON.stringify(listedPhoto).includes("imageHash"), false);
  assert.equal(JSON.stringify(listedPhoto).includes("originalFilename"), false);

  const otherSessionPhotosResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos?placeId=busan-gwangalli", {
      headers: {
        "x-silsigan-anon-id": "anon_photo_exif_strip_other",
      },
    }),
    { PHOTOS: r2 },
  );
  const otherSessionPhotosPayload = (await otherSessionPhotosResponse.json()) as SuccessPayload<
    Array<{ id: string; ownedByCurrentSession: boolean }>
  >;
  const otherSessionPhoto = otherSessionPhotosPayload.data.find((photo) => photo.id === payload.data.photo.id);
  assert.equal(otherSessionPhoto?.ownedByCurrentSession, false);

  const fileResponse = await worker.handleRequest(new Request(listedPhoto?.previewUrl ?? ""), { PHOTOS: r2 });
  const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());
  assert.equal(fileResponse.status, 200);
  assert.equal(fileResponse.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(fileBytes, stored);
});

test("photo complete reencodes pixels with Cloudflare Images binding before writing to R2", async () => {
  const anonymousId = "anon_photo_images_reencode_test";
  const r2 = new FakeR2Bucket();
  const reencoded = jpegServerReencodedSample();
  const images = new FakeImagesBinding(reencoded);
  const source = jpegWithGpsExifSample();

  const response = await worker.handleRequest(
    new Request("https://api.test/api/photos/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify({
        uploadId: "upload_images_reencode",
        placeId: "busan-gwangalli",
        byteSize: source.byteLength,
        mimeType: "image/jpeg",
        width: 1280,
        height: 960,
        clientReencoded: true,
        imageBase64: bytesToBase64(source),
      }),
    }),
    { PHOTOS: r2, IMAGES: images, PHOTO_UPLOADS_ENABLED: "true", IMAGE_TRANSFORMS_ENABLED: "true" },
  );
  const payload = (await response.json()) as SuccessPayload<PhotoCompleteData>;
  const sanitization = payload.meta?.photoSanitization as { pixelsReencoded?: unknown; processing?: unknown } | undefined;

  assert.equal(response.status, 201);
  assert.equal(images.inputs.length, 1);
  assert.equal(containsAscii(images.inputs[0] ?? new Uint8Array(), "GPSLatitude"), false);
  assert.deepEqual(images.transforms, [{ width: 1280, height: 960, fit: "scale-down" }]);
  assert.deepEqual(images.outputs, [{ format: "image/jpeg", quality: 78, anim: false }]);
  assert.equal(r2.putObjects.length, 1);
  assert.equal(containsAscii(r2.putObjects[0]?.bytes ?? new Uint8Array(), "SERVER_REENCODED"), true);
  assert.equal(containsAscii(r2.putObjects[0]?.bytes ?? new Uint8Array(), "GPSLatitude"), false);
  assert.equal(r2.putObjects[0]?.customMetadata?.serverPixelReencoded, "true");
  assert.equal(r2.putObjects[0]?.customMetadata?.processing, "cloudflare-images-reencoded");
  assert.equal(sanitization?.pixelsReencoded, true);
  assert.equal(sanitization?.processing, "cloudflare-images-reencoded");
});

test("D1 photo complete rejects duplicate sanitized image content before a second R2 write", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const source = jpegWithGpsExifSample();

  try {
    const first = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": "anon_photo_duplicate_source",
        },
        body: JSON.stringify({
          uploadId: "upload_duplicate_source",
          placeId: "busan-gwangalli",
          byteSize: source.byteLength,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
          imageBase64: bytesToBase64(source),
        }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const firstPayload = (await first.json()) as SuccessPayload<PhotoCompleteData>;
    assert.equal(first.status, 201);
    assert.equal(firstPayload.data.photo.status, "pending");
    assert.equal(firstPayload.meta?.moderation, "pending_moderation");
    assert.equal(firstPayload.meta?.duplicatePolicy, "exact-sanitized-content-sha256-blocks-active-duplicates");
    assert.equal(r2.putObjects.length, 1);

    const stored = await db
      .prepare("SELECT image_hash AS imageHash, duplicate_status AS duplicateStatus, status FROM photos WHERE id = ?")
      .bind(firstPayload.data.photo.id)
      .first<{ imageHash: string; duplicateStatus: string; status: string }>();
    assert.match(stored?.imageHash ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.equal(stored?.duplicateStatus, "unique");
    assert.equal(stored?.status, "pending");
    const moderationState = await db
      .prepare("SELECT status, risk_flags_json AS riskFlagsJson FROM photo_moderation_states WHERE photo_id = ?")
      .bind(firstPayload.data.photo.id)
      .first<{ status: string; riskFlagsJson: string }>();
    assert.equal(moderationState?.status, "pending_moderation");
    assert.deepEqual(JSON.parse(moderationState?.riskFlagsJson ?? "[]"), [
      "face_review_required",
      "plate_review_required",
      "content_safety_review_required",
    ]);

    const pendingList = await d1Get<SuccessPayload<Array<{ id: string }>>>(
      db,
      "https://api.test/api/photos?placeId=busan-gwangalli",
      "anon_photo_duplicate_source",
    );
    assert.equal(pendingList.data.some((photo) => photo.id === firstPayload.data.photo.id), false);
    const pendingFile = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${firstPayload.data.photo.id}/file`),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    assert.equal(pendingFile.status, 404);

    const approved = await d1AdminPost<SuccessPayload<{ photoId: string; decision: string; public: boolean }>>(
      db,
      `https://api.test/api/admin/photos/${firstPayload.data.photo.id}/moderation`,
      { decision: "approved", reason: "fixture privacy and content review passed" },
      { PHOTOS: r2 },
      "test-moderator-token",
    );
    assert.equal(approved.data.decision, "approved");
    assert.equal(approved.data.public, true);
    const approvedListResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos?placeId=busan-gwangalli", {
        headers: { "x-silsigan-anon-id": "anon_photo_duplicate_source" },
      }),
      { DB: db, PHOTOS: r2 },
    );
    assert.equal(approvedListResponse.status, 200);
    const approvedList = (await approvedListResponse.json()) as SuccessPayload<Array<{ id: string; previewUrl: string }>>;
    const approvedPhoto = approvedList.data.find((photo) => photo.id === firstPayload.data.photo.id);
    assert.ok(approvedPhoto);
    const approvedFile = await worker.handleRequest(new Request(approvedPhoto?.previewUrl ?? ""), { DB: db, PHOTOS: r2 });
    assert.equal(approvedFile.status, 200);
    const photoEventCount = await db
      .prepare("SELECT COUNT(*) AS count FROM place_events WHERE event_type = 'photo' AND place_id = ?")
      .bind("busan-gwangalli")
      .first<{ count: number }>();
    assert.equal(photoEventCount?.count, 1);

    const duplicate = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": "anon_photo_duplicate_reuse",
        },
        body: JSON.stringify({
          uploadId: "upload_duplicate_reuse",
          placeId: "ulsan-taehwagang",
          byteSize: source.byteLength,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
          imageBase64: bytesToBase64(source),
        }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const duplicatePayload = (await duplicate.json()) as FailurePayload;
    assert.equal(duplicate.status, 409);
    assert.equal(duplicatePayload.error.code, "PHOTO_DUPLICATE");
    assert.deepEqual(duplicatePayload.error.details, {
      duplicateOfPhotoId: firstPayload.data.photo.id,
      duplicatePlaceId: "busan-gwangalli",
      policy: "exact-sanitized-content-sha256",
    });
    assert.equal(r2.putObjects.length, 1);

    const rowCount = await db.prepare("SELECT COUNT(*) AS count FROM photos").first<{ count: number }>();
    assert.equal(rowCount?.count, 1);

    const rejectedModeration = await d1AdminPost<SuccessPayload<{ decision: string; public: boolean; r2Deleted: boolean }>>(
      db,
      `https://api.test/api/admin/photos/${firstPayload.data.photo.id}/moderation`,
      { decision: "rejected", reason: "fixture privacy review failed" },
      { PHOTOS: r2 },
      "test-moderator-token",
    );
    assert.equal(rejectedModeration.data.decision, "rejected");
    assert.equal(rejectedModeration.data.public, false);
    assert.equal(rejectedModeration.data.r2Deleted, true);
    assert.equal(r2.deletedKeys.includes(firstPayload.data.storageKey), true);
    const rejectedFile = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${firstPayload.data.photo.id}/file`),
      { DB: db, PHOTOS: r2 },
    );
    assert.equal(rejectedFile.status, 404);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("worker generic errors do not echo secrets or raw sensitive values", async () => {
  const leakText = "fixture-token-leakySecretForTestOnly anon_sensitive_test real-camera-name.jpg 35.1532,129.1186";
  const response = await worker.handleRequest(
    new Request("https://api.test/api/photos/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": "anon_error_redaction_test",
      },
      body: JSON.stringify({
        uploadId: "upload_error_redaction",
        placeId: "busan-gwangalli",
        byteSize: 100_000,
        mimeType: "image/jpeg",
        width: 1,
        height: 1,
        clientReencoded: true,
        imageBase64: bytesToBase64(jpegWithGpsExifSample()),
      }),
    }),
    {
      PHOTOS: new FakeR2Bucket(),
      IMAGES: new ThrowingImagesBinding(leakText),
      PHOTO_UPLOADS_ENABLED: "true",
      IMAGE_TRANSFORMS_ENABLED: "true",
    },
  );
  const payload = (await response.json()) as FailurePayload;
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "POLICY_ERROR");
  assert.equal(serialized.includes("fixture-token-leakySecretForTestOnly"), false);
  assert.equal(serialized.includes("anon_sensitive_test"), false);
  assert.equal(serialized.includes("real-camera-name.jpg"), false);
  assert.equal(serialized.includes("35.1532"), false);
});

test("photo upload-url, list, and delete routes enforce anonymous ownership", async () => {
  const anonymousId = "anon_photo_routes_test";
  const upload = await post<SuccessPayload<{ uploadId: string; storageKey: string }>>("https://api.test/api/photos/upload-url", anonymousId, {
    placeId: "busan-gwangalli",
    mimeType: "image/webp",
  });
  assert.match(upload.data.storageKey, /^photos\/busan\/busan-gwangalli\/\d{4}\/\d{2}\/.+\.webp$/);

  const complete = await post<SuccessPayload<PhotoCompleteData>>("https://api.test/api/photos/complete", anonymousId, {
    uploadId: upload.data.uploadId,
    placeId: "busan-gwangalli",
    byteSize: 100_000,
    mimeType: "image/webp",
    width: 800,
    height: 600,
    clientReencoded: true,
  });
  const photos = await get<SuccessPayload<Array<{ id: string }>>>("https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
  assert.ok(photos.data.some((photo) => photo.id === complete.data.photo.id));

  const forbidden = await rawDelete(`https://api.test/api/photos/${complete.data.photo.id}`, "anon_other_photo_owner");
  assert.equal(forbidden.status, 403);

  const deleted = await del<SuccessPayload<{ deleted: boolean }>>(`https://api.test/api/photos/${complete.data.photo.id}`, anonymousId);
  assert.equal(deleted.data.deleted, true);

  const photosAfterDelete = await get<SuccessPayload<Array<{ id: string }>>>("https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
  assert.equal(photosAfterDelete.data.some((photo) => photo.id === complete.data.photo.id), false);
});

test("photo binary upload CORS preflight allows PUT ticket headers", async () => {
  const response = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload", {
      method: "OPTIONS",
      headers: {
        origin: "https://silsigan.example",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type,idempotency-key,x-silsigan-anon-signature,x-silsigan-upload-id,x-silsigan-place-id",
      },
    }),
    { CORS_ALLOWED_ORIGINS: "https://silsigan.example" },
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://silsigan.example");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /(?:^|,)PUT(?:,|$)/);
  const allowedHeaders = response.headers.get("access-control-allow-headers") ?? "";
  assert.match(allowedHeaders, /(?:^|,)idempotency-key(?:,|$)/);
  assert.match(allowedHeaders, /(?:^|,)x-silsigan-anon-signature(?:,|$)/);
  assert.match(allowedHeaders, /(?:^|,)x-silsigan-upload-id(?:,|$)/);
  assert.match(allowedHeaders, /(?:^|,)x-silsigan-place-id(?:,|$)/);
  assert.match(response.headers.get("access-control-expose-headers") ?? "", /(?:^|,)x-silsigan-anon-signature(?:,|$)/);
});

test("Worker CORS allows only configured exact origins and never returns wildcard credentials", async () => {
  const env = { CORS_ALLOWED_ORIGINS: "https://silsigan.example,http://localhost:3201" };
  const allowed = await worker.handleRequest(
    new Request("https://api.test/api/health", { headers: { origin: "https://silsigan.example" } }),
    env,
  );
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://silsigan.example");
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  assert.equal(allowed.headers.get("vary"), "Origin");

  const denied = await worker.handleRequest(
    new Request("https://api.test/api/health", { headers: { origin: "https://evil.example" } }),
    env,
  );
  assert.equal(denied.status, 200);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal(denied.headers.get("access-control-allow-credentials"), null);
  assert.notEqual(denied.headers.get("access-control-allow-origin"), "*");

  const noOrigin = await worker.handleRequest(new Request("https://api.test/api/health"), env);
  assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);
  assert.equal(noOrigin.headers.get("access-control-allow-credentials"), null);
});

test("binary photo upload uses a private one-time staging object before completion", async () => {
  const anonymousId = "anon_binary_photo_upload_test";
  const r2 = new FakeR2Bucket();
  const baseSource = jpegServerReencodedSample();
  const source = concatBytes([baseSource.slice(0, -2), asciiBytes("BINARY_UPLOAD_TEST"), baseSource.slice(-2)]);
  const ticketResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
    }),
    { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
  );
  const ticketPayload = (await ticketResponse.json()) as SuccessPayload<{
    uploadId: string;
    method: string;
    uploadUrl: string;
    storageKey: string;
    expiresAt: string;
  }>;

  assert.equal(ticketResponse.status, 201);
  assert.equal(ticketPayload.data.method, "PUT");
  assert.equal(ticketPayload.data.uploadUrl, "/api/photos/upload");

  const crossOwnerUploadResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload", {
      method: "PUT",
      headers: {
        "content-type": "image/jpeg",
        "x-silsigan-anon-id": "anon_binary_photo_upload_attacker",
        "x-silsigan-place-id": "busan-gwangalli",
        "x-silsigan-upload-id": ticketPayload.data.uploadId,
      },
      body: source,
    }),
    { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
  );
  assert.equal(crossOwnerUploadResponse.status, 403);

  const uploadResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload", {
      method: "PUT",
      headers: {
        "content-type": "image/jpeg",
        "x-silsigan-anon-id": anonymousId,
        "x-silsigan-place-id": "busan-gwangalli",
        "x-silsigan-upload-id": ticketPayload.data.uploadId,
      },
      body: source,
    }),
    { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
  );

  assert.equal(uploadResponse.status, 201);
  assert.equal(r2.putObjects.some((object) => object.key.startsWith("photos/_uploads/")), true);
  assert.equal(r2.deletedKeys.includes(`photos/_tickets/${ticketPayload.data.uploadId}`), true);

  const completeResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify({
        uploadId: ticketPayload.data.uploadId,
        placeId: "busan-gwangalli",
        byteSize: source.byteLength,
        mimeType: "image/jpeg",
        width: 1,
        height: 1,
        clientReencoded: true,
      }),
    }),
    { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
  );
  const completePayload = (await completeResponse.json()) as SuccessPayload<PhotoCompleteData>;

  assert.equal(completeResponse.status, 201);
  assert.equal(completePayload.data.storageKey, ticketPayload.data.storageKey);
  assert.equal(r2.deletedKeys.includes(`photos/_uploads/${ticketPayload.data.uploadId}`), true);
  assert.equal(r2.putObjects.some((object) => object.key === ticketPayload.data.storageKey), true);

  const replayResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify({
        uploadId: ticketPayload.data.uploadId,
        placeId: "busan-gwangalli",
        byteSize: source.byteLength,
        mimeType: "image/jpeg",
        width: 1,
        height: 1,
        clientReencoded: true,
      }),
    }),
    { PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
  );
  assert.equal(replayResponse.status, 404);
});

test("D1 photo upload sessions avoid R2 ticket objects and retain a replay tombstone until expiry", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const anonymousId = "anon_d1_photo_session_test";
  const source = jpegServerReencodedSample();

  try {
    const ticketResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-d1-tombstone-key",
          "x-silsigan-anon-id": anonymousId,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const ticket = (await ticketResponse.json()) as SuccessPayload<{ uploadId: string }>;
    assert.equal(ticketResponse.status, 201);
    assert.equal(r2.putObjects.some((object) => object.key.startsWith("photos/_tickets/")), false);

    const ticketed = await db
      .prepare("SELECT status FROM photo_upload_sessions WHERE upload_id = ?")
      .bind(ticket.data.uploadId)
      .first<{ status: string }>();
    assert.equal(ticketed?.status, "ticketed");

    const uploadResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload", {
        method: "PUT",
        headers: {
          "content-type": "image/jpeg",
          "x-silsigan-anon-id": anonymousId,
          "x-silsigan-place-id": "busan-gwangalli",
          "x-silsigan-upload-id": ticket.data.uploadId,
        },
        body: source,
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    assert.equal(uploadResponse.status, 201);

    const uploaded = await db
      .prepare("SELECT status FROM photo_upload_sessions WHERE upload_id = ?")
      .bind(ticket.data.uploadId)
      .first<{ status: string }>();
    assert.equal(uploaded?.status, "uploaded");

    const completeResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-d1-tombstone-key",
          "x-silsigan-anon-id": anonymousId,
        },
        body: JSON.stringify({
          uploadId: ticket.data.uploadId,
          placeId: "busan-gwangalli",
          byteSize: source.byteLength,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
        }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    assert.equal(completeResponse.status, 201);

    const closed = await db
      .prepare("SELECT COUNT(*) AS count FROM photo_upload_sessions WHERE upload_id = ? AND status = 'uploaded'")
      .bind(ticket.data.uploadId)
      .first<{ count: number }>();
    assert.equal(closed?.count, 1);
    assert.equal(r2.putObjects.some((object) => object.key.startsWith("photos/_uploads/")), false);

    const replayTicket = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-d1-tombstone-key",
          "x-silsigan-anon-id": anonymousId,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const replayTicketPayload = (await replayTicket.json()) as FailurePayload;
    assert.equal(replayTicket.status, 409);
    assert.equal(replayTicketPayload.error.code, "PHOTO_UPLOAD_REPLAYED");
    const mappingCount = await db
      .prepare("SELECT COUNT(*) AS count FROM photo_upload_idempotency_keys WHERE upload_id = ?")
      .bind(ticket.data.uploadId)
      .first<{ count: number }>();
    assert.equal(mappingCount?.count, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 photo upload ticket allows only one concurrent binary claim and one R2 staging write", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const anonymousId = "anon_photo_concurrent_claim";
  const source = jpegServerReencodedSample();

  try {
    const ticketResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-concurrent-claim-key",
          "x-silsigan-anon-id": anonymousId,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const ticket = (await ticketResponse.json()) as SuccessPayload<{ uploadId: string }>;
    const upload = () =>
      worker.handleRequest(
        new Request("https://api.test/api/photos/upload", {
          method: "PUT",
          headers: {
            "content-type": "image/jpeg",
            "x-silsigan-anon-id": anonymousId,
            "x-silsigan-place-id": "busan-gwangalli",
            "x-silsigan-upload-id": ticket.data.uploadId,
          },
          body: source,
        }),
        { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
      );
    const responses = await Promise.all([upload(), upload()]);
    const statuses = responses.map((response) => response.status).sort((left, right) => left - right);
    assert.deepEqual(statuses, [201, 409]);
    const replay = responses.find((response) => response.status === 409);
    const replayPayload = (await replay?.json()) as FailurePayload;
    assert.equal(replayPayload.error.code, "PHOTO_UPLOAD_REPLAYED");
    assert.equal(r2.putObjects.filter((object) => object.key.startsWith("photos/_uploads/")).length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("photo completion rejects oversized dimensions before Images or R2 writes", async () => {
  const r2 = new FakeR2Bucket();
  const images = new FakeImagesBinding(jpegServerReencodedSample());
  const response = await worker.handleRequest(
    new Request("https://api.test/api/photos/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "photo-oversized-dimension-key",
        "x-silsigan-anon-id": "anon_photo_oversized_dimension",
      },
      body: JSON.stringify({
        uploadId: "upload_oversized_dimension",
        placeId: "busan-gwangalli",
        byteSize: jpegServerReencodedSample().byteLength,
        mimeType: "image/jpeg",
        width: 1281,
        height: 960,
        clientReencoded: true,
        imageBase64: bytesToBase64(jpegServerReencodedSample()),
      }),
    }),
    {
      PHOTOS: r2,
      IMAGES: images,
      PHOTO_UPLOADS_ENABLED: "true",
      IMAGE_TRANSFORMS_ENABLED: "true",
    },
  );
  const payload = (await response.json()) as FailurePayload;
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "PHOTO_DIMENSION_LIMIT");
  assert.equal(images.inputs.length, 0);
  assert.equal(r2.putObjects.length, 0);
});

test("scheduled cleanup removes expired D1 photo staging objects", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const anonymousId = "anon_photo_orphan_cleanup";

  try {
    const ticketResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "photo-orphan-cleanup-key",
          "x-silsigan-anon-id": anonymousId,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", mimeType: "image/jpeg" }),
      }),
      { DB: db, PHOTOS: r2, PHOTO_UPLOADS_ENABLED: "true" },
    );
    const ticket = (await ticketResponse.json()) as SuccessPayload<{ uploadId: string }>;
    const stagingKey = `photos/_uploads/${ticket.data.uploadId}`;
    await r2.put(stagingKey, jpegServerReencodedSample());
    await db
      .prepare("UPDATE photo_upload_sessions SET status = 'uploaded', expires_at = ? WHERE upload_id = ?")
      .bind("2020-01-01T00:00:00.000Z", ticket.data.uploadId)
      .run();

    await worker.default.scheduled(
      { cron: "*/5 * * * *", type: "scheduled", scheduledTime: Date.now() },
      { DB: db, PHOTOS: r2, OFFICIAL_INGESTION_SCHEDULER_ENABLED: "false" },
    );

    const remaining = await db
      .prepare("SELECT COUNT(*) AS count FROM photo_upload_sessions WHERE upload_id = ?")
      .bind(ticket.data.uploadId)
      .first<{ count: number }>();
    assert.equal(remaining?.count, 0);
    const remainingIdempotency = await db
      .prepare("SELECT COUNT(*) AS count FROM photo_upload_idempotency_keys WHERE upload_id = ?")
      .bind(ticket.data.uploadId)
      .first<{ count: number }>();
    assert.equal(remainingIdempotency?.count, 0);
    assert.equal(r2.deletedKeys.includes(stagingKey), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("comment delete and realtime path aliases are available", async () => {
  const anonymousId = "anon_comment_delete_test";
  const created = await post<SuccessPayload<Comment>>("https://api.test/api/comments", anonymousId, {
    placeId: "busan-gwangalli",
    body: "삭제 테스트 댓글입니다.",
  });

  const forbidden = await rawDelete(`https://api.test/api/comments/${created.data.id}`, "anon_other_comment_owner");
  assert.equal(forbidden.status, 403);

  const deleted = await del<SuccessPayload<{ deleted: boolean }>>(`https://api.test/api/comments/${created.data.id}`, anonymousId);
  assert.equal(deleted.data.deleted, true);

  const realtime = await get<SuccessPayload<{ mode: string; roomId: string }>>(
    "https://api.test/api/realtime/place/busan-gwangalli",
    anonymousId,
  );
  assert.equal(realtime.data.mode, "polling");
  assert.equal(realtime.data.roomId, "busan-gwangalli");
});

test("Durable Object realtime rooms receive place region and global fanout events", async () => {
  const anonymousId = "anon_realtime_do_fanout";
  const waitUntilPromises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>): void {
      waitUntilPromises.push(promise);
    },
  };
  const env = {
    PLACE_ROOM: new FakeDurableObjectNamespace(() => new worker.PlaceRoom()),
    REGION_ROOM: new FakeDurableObjectNamespace(() => new worker.RegionRoom()),
    GLOBAL_ROOM: new FakeDurableObjectNamespace(() => new worker.GlobalRoom()),
  };

  const created = await worker.handleRequest(
    new Request("https://api.test/api/comments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify({
        placeId: "busan-gwangalli",
        body: "DO fanout smoke",
      }),
    }),
    env,
    ctx,
  );
  const createdPayload = (await created.json()) as SuccessPayload<Comment>;
  assert.equal(created.status, 201);
  await Promise.all(waitUntilPromises);

  const placeRoom = await getRealtimeRoom<{
    mode: string;
    scope: string;
    roomId: string;
    events: Array<{ type: string; scope: string; roomId: string; payload: { id?: string; placeId?: string; regionId?: string } }>;
  }>(env, "/api/realtime/place/busan-gwangalli", anonymousId);
  const regionRoom = await getRealtimeRoom<typeof placeRoom>(env, "/api/realtime/region/busan", anonymousId);
  const globalRoom = await getRealtimeRoom<typeof placeRoom>(env, "/api/realtime/global", anonymousId);

  assert.equal(placeRoom.mode, "durable-object-polling");
  assert.equal(placeRoom.scope, "place");
  assert.equal(placeRoom.roomId, "busan-gwangalli");
  assert.equal(placeRoom.events[0]?.type, "comment.created");
  assert.equal(placeRoom.events[0]?.payload.id, createdPayload.data.id);

  assert.equal(regionRoom.scope, "region");
  assert.equal(regionRoom.roomId, "busan");
  assert.equal(regionRoom.events[0]?.payload.placeId, "busan-gwangalli");
  assert.equal(regionRoom.events[0]?.payload.regionId, "busan");

  assert.equal(globalRoom.scope, "global");
  assert.equal(globalRoom.roomId, "global");
  assert.equal(globalRoom.events[0]?.payload.placeId, "busan-gwangalli");
});

test("Durable Object realtime WebSocket connections receive broadcast events", async () => {
  const previousWebSocketPair = Reflect.get(globalThis, "WebSocketPair");
  const hadWebSocketPair = Object.prototype.hasOwnProperty.call(globalThis, "WebSocketPair");
  const pairs: FakeWebSocketPair[] = [];
  class TestWebSocketPair extends FakeWebSocketPair {
    constructor() {
      super();
      pairs.push(this);
    }
  }

  Object.defineProperty(globalThis, "WebSocketPair", {
    configurable: true,
    value: TestWebSocketPair,
  });

  try {
    const room = new worker.PlaceRoom();
    const response = await room.fetch(
      new Request("https://api.test/api/realtime/place/busan-gwangalli?roomId=busan-gwangalli", {
        headers: { Upgrade: "websocket" },
      }),
    );
    const websocketResponse = response as Response & { webSocket?: FakeWorkerWebSocket };
    assert.equal(response.status, 101);
    assert.equal(websocketResponse.webSocket, pairs[0]?.client);

    const broadcast = await room.fetch(
      new Request("https://api.test/api/realtime/broadcast?roomId=busan-gwangalli", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "comment.created",
          scope: "place",
          roomId: "busan-gwangalli",
          payload: { id: "comment_ws_1", placeId: "busan-gwangalli" },
          createdAt: "2026-06-24T00:00:00.000Z",
        }),
      }),
    );
    const payload = (await broadcast.json()) as SuccessPayload<{ delivered: number; mode: string }>;

    assert.equal(payload.data.mode, "durable-object");
    assert.equal(payload.data.delivered, 1);
    assert.equal(pairs[0]?.client.receivedMessages.length, 1);
    assert.deepEqual(JSON.parse(pairs[0]?.client.receivedMessages[0] ?? "{}"), {
      type: "comment.created",
      scope: "place",
      roomId: "busan-gwangalli",
      payload: { id: "comment_ws_1", placeId: "busan-gwangalli" },
      createdAt: "2026-06-24T00:00:00.000Z",
    });
  } finally {
    if (hadWebSocketPair) {
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: previousWebSocketPair,
      });
    } else {
      Reflect.deleteProperty(globalThis, "WebSocketPair");
    }
  }
});

test("place like broadcasts a realtime room event", async () => {
  const anonymousId = "anon_realtime_like_fanout";
  const waitUntilPromises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>): void {
      waitUntilPromises.push(promise);
    },
  };
  const env = {
    PLACE_ROOM: new FakeDurableObjectNamespace(() => new worker.PlaceRoom()),
    REGION_ROOM: new FakeDurableObjectNamespace(() => new worker.RegionRoom()),
    GLOBAL_ROOM: new FakeDurableObjectNamespace(() => new worker.GlobalRoom()),
  };

  const liked = await worker.handleRequest(
    new Request("https://api.test/api/places/busan-gwangalli/like", {
      method: "POST",
      headers: {
        "x-silsigan-anon-id": anonymousId,
      },
    }),
    env,
    ctx,
  );
  const likedPayload = (await liked.json()) as SuccessPayload<{ placeId: string; likeCount: number; created: boolean }>;
  assert.equal(liked.status, 200);
  assert.equal(likedPayload.data.created, true);
  await Promise.all(waitUntilPromises);

  const placeRoom = await getRealtimeRoom<{
    events: Array<{ type: string; payload: { placeId?: string; likeCount?: number } }>;
  }>(env, "/api/realtime/place/busan-gwangalli", anonymousId);

  assert.equal(placeRoom.events[0]?.type, "place.liked");
  assert.equal(placeRoom.events[0]?.payload.placeId, "busan-gwangalli");
  assert.equal(placeRoom.events[0]?.payload.likeCount, likedPayload.data.likeCount);
});

test("comment create rate limit blocks burst traffic per anonymous user", async () => {
  const anonymousId = "anon_rate_limit_test";

  for (let index = 0; index < 5; index += 1) {
    const response = await rawPost("https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: `혼잡도 테스트 ${index}`,
    });
    assert.equal(response.status, 201);
  }

  const limited = await rawPost("https://api.test/api/comments", anonymousId, {
    placeId: "busan-gwangalli",
    body: "이 요청은 막혀야 합니다.",
  });
  const payload = (await limited.json()) as FailurePayload;

  assert.equal(limited.status, 429);
  assert.equal(payload.error.code, "RATE_LIMITED");
});

test("comment create rate limit blocks slow daily spam per anonymous user", async () => {
  const anonymousId = "anon_daily_rate_limit_test";
  const originalNow = Date.now;
  const startedAt = Date.UTC(2026, 0, 1, 0, 0, 0);
  let tick = 0;
  Date.now = () => startedAt + tick * 61_000;

  try {
    for (let index = 0; index < 100; index += 1) {
      const response = await rawPost("https://api.test/api/comments", anonymousId, {
        placeId: "busan-gwangalli",
        body: `일일 도배 제한 테스트 ${index}`,
      });
      assert.equal(response.status, 201);
      tick += 1;
    }

    const limited = await rawPost("https://api.test/api/comments", anonymousId, {
      placeId: "busan-gwangalli",
      body: "하루 101번째 댓글은 막혀야 합니다.",
    });
    const payload = (await limited.json()) as FailurePayload;

    assert.equal(limited.status, 429);
    assert.equal(payload.error.code, "RATE_LIMITED");
  } finally {
    Date.now = originalNow;
  }
});

test("comment create rate limit resists anonymous ID rotation from one client IP", async () => {
  const clientIp = "203.0.113.24";

  for (let index = 0; index < 20; index += 1) {
    const response = await rawPostWithClientIp(
      "https://api.test/api/comments",
      `anon_rotating_rate_${index}`,
      { placeId: "busan-gwangalli", body: `익명 ID 교체 테스트 ${index}` },
      clientIp,
    );
    assert.equal(response.status, 201);
  }

  const limited = await rawPostWithClientIp(
    "https://api.test/api/comments",
    "anon_rotating_rate_final",
    { placeId: "busan-gwangalli", body: "IP 기준 제한에 걸려야 합니다." },
    clientIp,
  );
  const payload = (await limited.json()) as FailurePayload;

  assert.equal(limited.status, 429);
  assert.equal(payload.error.code, "RATE_LIMITED");
});

test("comment create rejects privacy script and URL spam patterns", async () => {
  const blockedBodies = [
    "연락처 010-1234-5678로 홍보합니다.",
    "주민번호 900101-1234567 메모입니다.",
    "<script>alert('xss')</script>",
    "https://spam.example",
  ];

  for (const [index, body] of blockedBodies.entries()) {
    const response = await rawPost("https://api.test/api/comments", `anon_comment_policy_${index}`, {
      placeId: "busan-gwangalli",
      body,
    });
    const payload = (await response.json()) as FailurePayload;
    const serializedPayload = JSON.stringify(payload);

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, "COMMENT_BODY_REJECTED");
    assert.equal(serializedPayload.includes(body), false);
  }
});

test("Cloudflare API client sends moderation reports to the Worker moderation endpoint", async () => {
  const requestedUrls: string[] = [];
  const requestCredentials: Array<RequestCredentials | undefined> = [];
  const client = createCloudflareApiClient({
    baseUrl: "https://api.test",
    anonymousId: "anon_client_report_test",
    fetcher: async (input, init) => {
      requestedUrls.push(input.toString());
      requestCredentials.push(init?.credentials);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: "report_client",
            targetType: "photo",
            targetId: "photo_1",
            reason: "privacy_face",
            anonymousUserId: "anon_client_report_test",
            note: null,
            status: "open",
            createdAt: "2026-06-18T00:00:00.000Z",
          },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  await client.createReport({
    targetType: "photo",
    targetId: "photo_1",
    reason: "privacy_face",
  });

  assert.deepEqual(requestedUrls, ["https://api.test/api/moderation/reports"]);
  assert.deepEqual(requestCredentials, ["omit"]);
});

test("Cloudflare API client supports scoped ranking query params", async () => {
  const requestedUrls: string[] = [];
  const client = createCloudflareApiClient({
    baseUrl: "https://api.test",
    fetcher: async (input) => {
      requestedUrls.push(input.toString());
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });

  await client.listRankings({
    limit: 10,
    regionId: "busan",
    areaId: "busan-suyeong",
    categoryId: "tourism",
    bbox: "129.0,35.0,129.2,35.2",
  });

  assert.equal(requestedUrls.length, 1);
  const requestedUrl = new URL(requestedUrls[0] ?? "");
  assert.equal(requestedUrl.pathname, "/api/rankings");
  assert.equal(requestedUrl.searchParams.get("limit"), "10");
  assert.equal(requestedUrl.searchParams.get("regionId"), "busan");
  assert.equal(requestedUrl.searchParams.get("areaId"), "busan-suyeong");
  assert.equal(requestedUrl.searchParams.get("categoryId"), "tourism");
  assert.equal(requestedUrl.searchParams.get("bbox"), "129.0,35.0,129.2,35.2");
});

test("Cloudflare API client supports place like and realtime room endpoints", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const client = createCloudflareApiClient({
    baseUrl: "https://api.test",
    anonymousId: "anon_client_realtime_test",
    fetcher: async (input, init) => {
      requests.push({ method: init?.method ?? "GET", url: input.toString() });

      if (input.toString().endsWith("/api/realtime/place/busan-gwangalli")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              mode: "durable-object-polling",
              scope: "place",
              roomId: "busan-gwangalli",
              events: [
                {
                  type: "comment.created",
                  scope: "place",
                  roomId: "busan-gwangalli",
                  payload: { placeId: "busan-gwangalli" },
                  createdAt: "2026-06-18T00:00:00.000Z",
                },
              ],
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            placeId: "busan-gwangalli",
            likeCount: init?.method === "DELETE" ? 0 : 1,
            created: init?.method !== "DELETE",
            deleted: init?.method === "DELETE",
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });

  const liked = await client.likePlace("busan-gwangalli");
  const room = await client.getRealtimeRoom("place", "busan-gwangalli");
  const unliked = await client.unlikePlace("busan-gwangalli");

  assert.equal(liked.data.likeCount, 1);
  assert.equal(room.data.events[0]?.type, "comment.created");
  assert.equal(unliked.data.deleted, true);
  assert.deepEqual(requests, [
    { method: "POST", url: "https://api.test/api/places/busan-gwangalli/like" },
    { method: "GET", url: "https://api.test/api/realtime/place/busan-gwangalli" },
    { method: "DELETE", url: "https://api.test/api/places/busan-gwangalli/like" },
  ]);
});

async function post<TPayload>(url: string, anonymousId: string, body: Record<string, unknown>): Promise<TPayload> {
  const response = await rawPost(url, anonymousId, body);
  assert.ok(response.status >= 200 && response.status < 300);

  return (await response.json()) as TPayload;
}

async function get<TPayload>(url: string, anonymousId: string): Promise<TPayload> {
  const response = await worker.handleRequest(
    new Request(url, {
      headers: {
        "x-silsigan-anon-id": anonymousId,
      },
    }),
  );
  assert.ok(response.status >= 200 && response.status < 300);

  return (await response.json()) as TPayload;
}

async function del<TPayload>(url: string, anonymousId: string): Promise<TPayload> {
  const response = await rawDelete(url, anonymousId);
  assert.ok(response.status >= 200 && response.status < 300);

  return (await response.json()) as TPayload;
}

async function getRealtimeRoom<TPayload>(
  env: {
    PLACE_ROOM: FakeDurableObjectNamespace;
    REGION_ROOM: FakeDurableObjectNamespace;
    GLOBAL_ROOM: FakeDurableObjectNamespace;
  },
  path: string,
  anonymousId: string,
): Promise<TPayload> {
  const response = await worker.handleRequest(
    new Request(`https://api.test${path}`, {
      headers: {
        "x-silsigan-anon-id": anonymousId,
      },
    }),
    env,
  );
  assert.ok(response.status >= 200 && response.status < 300);

  const payload = (await response.json()) as SuccessPayload<TPayload>;
  return payload.data;
}

function rawDelete(url: string, anonymousId: string): Promise<Response> {
  return worker.handleRequest(
    new Request(url, {
      method: "DELETE",
      headers: {
        "x-silsigan-anon-id": anonymousId,
      },
    }),
  );
}

function rawPost(url: string, anonymousId: string, body: Record<string, unknown>): Promise<Response> {
  return worker.handleRequest(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify(body),
    }),
    { PHOTO_UPLOADS_ENABLED: "true" },
  );
}

function rawPostWithClientIp(url: string, anonymousId: string, body: Record<string, unknown>, clientIp: string): Promise<Response> {
  return worker.handleRequest(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": clientIp,
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify(body),
    }),
    { PHOTO_UPLOADS_ENABLED: "true" },
  );
}

function createSeededSqliteD1(): { db: SqliteD1Database; tempDir: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-worker-"));
  const dbPath = join(tempDir, "worker.db");
  const schema = readFileSync(new URL("../workers/api/src/db/schema.sql", import.meta.url), "utf8");
  const seed = readFileSync(new URL("../workers/api/seeds/001_core_seed.sql", import.meta.url), "utf8");
  execFileSync("sqlite3", [dbPath], {
    encoding: "utf8",
    input: `${schema}\n${seed}`,
  });

  return { db: new SqliteD1Database(dbPath), tempDir };
}

async function d1Post<TPayload>(
  db: SqliteD1Database,
  url: string,
  anonymousId: string,
  body: Record<string, unknown>,
): Promise<TPayload> {
  const response = await worker.handleRequest(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify(body),
    }),
    { DB: db, PHOTO_UPLOADS_ENABLED: "true" },
  );
  assert.ok(response.status >= 200 && response.status < 300);

  return (await response.json()) as TPayload;
}

function rawD1Post(db: SqliteD1Database, url: string, anonymousId: string, body: Record<string, unknown>): Promise<Response> {
  return worker.handleRequest(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify(body),
    }),
    { DB: db, PHOTO_UPLOADS_ENABLED: "true" },
  );
}

async function d1Get<TPayload>(db: SqliteD1Database, url: string, anonymousId: string): Promise<TPayload> {
  const response = await worker.handleRequest(
    new Request(url, {
      headers: {
        "x-silsigan-anon-id": anonymousId,
      },
    }),
    { DB: db },
  );
  assert.ok(response.status >= 200 && response.status < 300);

  return (await response.json()) as TPayload;
}

function rawD1Delete(db: SqliteD1Database, url: string, anonymousId: string): Promise<Response> {
  return worker.handleRequest(
    new Request(url, {
      method: "DELETE",
      headers: {
        "x-silsigan-anon-id": anonymousId,
      },
    }),
    { DB: db },
  );
}

async function d1AdminGet<TPayload>(db: SqliteD1Database, url: string): Promise<TPayload> {
  const response = await worker.handleRequest(
    new Request(url, {
      headers: {
        "x-silsigan-admin-token": "test-moderator-token",
      },
    }),
    { DB: db, ADMIN_TOKENS: testAdminTokens },
  );
  assert.ok(response.status >= 200 && response.status < 300);

  return (await response.json()) as TPayload;
}

function rawD1AdminPost(db: SqliteD1Database, url: string, body: Record<string, unknown>): Promise<Response> {
  return worker.handleRequest(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { DB: db, ADMIN_TOKENS: testAdminTokens },
  );
}

function rawD1AdminPostWithToken(db: SqliteD1Database, url: string, body: Record<string, unknown>, token: string): Promise<Response> {
  return worker.handleRequest(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-admin-token": token,
      },
      body: JSON.stringify(body),
    }),
    { DB: db, ADMIN_TOKENS: testAdminTokens },
  );
}

function rawMemoryAdminPostWithToken(url: string, body: Record<string, unknown>, token: string): Promise<Response> {
  return worker.handleRequest(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-admin-token": token,
      },
      body: JSON.stringify(body),
    }),
    { ADMIN_TOKENS: testAdminTokens },
  );
}

async function d1AdminPost<TPayload>(
  db: SqliteD1Database,
  url: string,
  body: Record<string, unknown>,
  extraEnv: { PHOTOS?: FakeR2Bucket; CACHE?: FakeKVNamespace; ADMIN_TOKENS?: string; ADMIN_TOKEN?: string } = {},
  token = "test-admin-token",
): Promise<TPayload> {
  const response = await worker.handleRequest(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-admin-token": token,
        "x-silsigan-admin-subject": "moderator@example.test",
      },
      body: JSON.stringify(body),
    }),
    { DB: db, ADMIN_TOKENS: testAdminTokens, ...extraEnv },
  );
  assert.ok(response.status >= 200 && response.status < 300);

  return (await response.json()) as TPayload;
}

class FakeR2Bucket {
  readonly deletedKeys: string[] = [];
  readonly putObjects: Array<{
    key: string;
    bytes: Uint8Array;
    contentType?: string;
    customMetadata?: Record<string, string>;
  }> = [];

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown> {
    let bytes: Uint8Array;
    if (typeof value === "string") {
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else {
      bytes = new Uint8Array(await new Response(value).arrayBuffer());
    }

    this.putObjects.push({
      key,
      bytes,
      contentType: options?.httpMetadata?.contentType,
      customMetadata: options?.customMetadata,
    });

    return { success: true };
  }

  async delete(key: string | string[]): Promise<void> {
    if (Array.isArray(key)) {
      this.deletedKeys.push(...key);
      for (const deletedKey of key) {
        const index = this.putObjects.findIndex((candidate) => candidate.key === deletedKey);
        if (index >= 0) {
          this.putObjects.splice(index, 1);
        }
      }
      return;
    }

    this.deletedKeys.push(key);
    const index = this.putObjects.findIndex((candidate) => candidate.key === key);
    if (index >= 0) {
      this.putObjects.splice(index, 1);
    }
  }

  async get(key: string) {
    const object = this.putObjects.find((candidate) => candidate.key === key);
    if (!object) {
      return null;
    }

    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(object.bytes);
          controller.close();
        },
      }),
      httpMetadata: {
        contentType: object.contentType,
      },
      customMetadata: object.customMetadata,
    };
  }
}

class FakeRateLimitBinding {
  readonly keys: string[] = [];
  readonly success: boolean;

  constructor(success = true) {
    this.success = success;
  }

  async limit(options: { key: string }): Promise<{ success: boolean }> {
    this.keys.push(options.key);
    return { success: this.success };
  }
}

class FakeImagesBinding {
  readonly inputs: Uint8Array[] = [];
  readonly transforms: Array<{ width: number; height: number; fit: string }> = [];
  readonly outputs: Array<{ format: string; quality: number; anim: boolean }> = [];
  private readonly outputBytes: Uint8Array;

  constructor(outputBytes: Uint8Array) {
    this.outputBytes = outputBytes;
  }

  input(source: ReadableStream | ArrayBuffer): FakeImagesPipeline {
    if (source instanceof ReadableStream) {
      throw new Error("FakeImagesBinding expects buffered image bytes in these tests.");
    }

    const bytes = new Uint8Array(source);
    this.inputs.push(bytes);

    return new FakeImagesPipeline(this, this.outputBytes);
  }

  recordTransform(options: { width: number; height: number; fit: string }): void {
    this.transforms.push(options);
  }

  recordOutput(options: { format: string; quality: number; anim: boolean }): void {
    this.outputs.push(options);
  }
}

class FakeImagesPipeline {
  private readonly binding: FakeImagesBinding;
  private readonly outputBytes: Uint8Array;

  constructor(binding: FakeImagesBinding, outputBytes: Uint8Array) {
    this.binding = binding;
    this.outputBytes = outputBytes;
  }

  transform(options: { width: number; height: number; fit: string }): FakeImagesPipeline {
    this.binding.recordTransform(options);
    return this;
  }

  output(options: { format: string; quality: number; anim: boolean }): { response: () => Response } {
    this.binding.recordOutput(options);
    return {
      response: () =>
        new Response(arrayBufferForTestBytes(this.outputBytes), {
          status: 200,
          headers: { "content-type": options.format },
        }),
    };
  }
}

class ThrowingImagesBinding {
  private readonly message: string;

  constructor(message: string) {
    this.message = message;
  }

  input(): never {
    throw new Error(this.message);
  }
}

function arrayBufferForTestBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function jpegWithGpsExifSample(): Uint8Array {
  return concatBytes([
    Uint8Array.of(0xff, 0xd8),
    jpegSegment(0xe0, asciiBytes("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")),
    jpegSegment(0xe1, asciiBytes("Exif\0\0GPSLatitude=35.1532;GPSLongitude=129.1186;Camera=SampleCam;DateTime=2026:06:18")),
    jpegSegment(0xdb, Uint8Array.of(0, ...Array.from({ length: 64 }, () => 1))),
    jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 1, 1, 1, 0)),
    jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)),
    Uint8Array.of(0, 63, 0xff, 0xd9),
  ]);
}

function jpegServerReencodedSample(): Uint8Array {
  return concatBytes([
    Uint8Array.of(0xff, 0xd8),
    jpegSegment(0xe0, asciiBytes("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")),
    jpegSegment(0xdb, Uint8Array.of(0, ...Array.from({ length: 64 }, () => 2))),
    jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 1, 1, 1, 0)),
    jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)),
    asciiBytes("SERVER_REENCODED"),
    Uint8Array.of(0xff, 0xd9),
  ]);
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.byteLength + 2;
  const segment = new Uint8Array(payload.byteLength + 4);
  segment[0] = 0xff;
  segment[1] = marker;
  segment[2] = (length >> 8) & 0xff;
  segment[3] = length & 0xff;
  segment.set(payload, 4);
  return segment;
}

function containsAscii(bytes: Uint8Array, value: string): boolean {
  const needle = asciiBytes(value);
  for (let offset = 0; offset <= bytes.byteLength - needle.byteLength; offset += 1) {
    let matched = true;
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (bytes[offset + index] !== needle[index]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }

  return false;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

interface FakeDurableRoom {
  fetch(request: Request): Promise<Response>;
}

class FakeDurableObjectId {
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  toString(): string {
    return this.name;
  }
}

class FakeDurableObjectStub {
  private readonly room: FakeDurableRoom;

  constructor(room: FakeDurableRoom) {
    this.room = room;
  }

  fetch(request: Request): Promise<Response> {
    return this.room.fetch(request);
  }
}

class FakeDurableObjectNamespace {
  private readonly rooms = new Map<string, FakeDurableRoom>();
  private readonly roomFactory: () => FakeDurableRoom;

  constructor(roomFactory: () => FakeDurableRoom) {
    this.roomFactory = roomFactory;
  }

  idFromName(name: string): FakeDurableObjectId {
    return new FakeDurableObjectId(name);
  }

  get(id: { toString: () => string }): FakeDurableObjectStub {
    const name = id.toString();
    const existing = this.rooms.get(name);
    if (existing) {
      return new FakeDurableObjectStub(existing);
    }

    const room = this.roomFactory();
    this.rooms.set(name, room);
    return new FakeDurableObjectStub(room);
  }
}

type FakeWebSocketListener = (event: { data: string | ArrayBuffer }) => void;

class FakeWorkerWebSocket {
  readonly receivedMessages: string[] = [];
  readyState = 1;
  peer: FakeWorkerWebSocket | null = null;
  private readonly listeners = new Map<"message" | "close" | "error", FakeWebSocketListener>();

  accept(): void {}

  send(message: string): void {
    this.peer?.receivedMessages.push(message);
  }

  close(): void {
    this.readyState = 3;
    this.listeners.get("close")?.({ data: "" });
  }

  addEventListener(type: "message" | "close" | "error", listener: FakeWebSocketListener): void {
    this.listeners.set(type, listener);
  }

  emitMessage(data: string): void {
    this.listeners.get("message")?.({ data });
  }
}

class FakeWebSocketPair {
  readonly 0: FakeWorkerWebSocket;
  readonly 1: FakeWorkerWebSocket;
  readonly client: FakeWorkerWebSocket;
  readonly server: FakeWorkerWebSocket;

  constructor() {
    this.client = new FakeWorkerWebSocket();
    this.server = new FakeWorkerWebSocket();
    this.client.peer = this.server;
    this.server.peer = this.client;
    this[0] = this.client;
    this[1] = this.server;
  }
}

class FakeKVNamespace {
  readonly values = new Map<string, string>();
  readonly puts: Array<{ key: string; value: string; options?: { expirationTtl?: number } }> = [];
  readonly deletedKeys: string[] = [];

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.values.set(key, value);
    this.puts.push({ key, value, options });
  }

  async delete(key: string): Promise<void> {
    this.deletedKeys.push(key);
    this.values.delete(key);
  }
}

class SqliteD1Database {
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  prepare(query: string): SqliteD1PreparedStatement {
    return new SqliteD1PreparedStatement(this.dbPath, query);
  }
}

class SqliteD1PreparedStatement {
  private readonly dbPath: string;
  private readonly query: string;
  private readonly values: Array<string | number | null>;

  constructor(dbPath: string, query: string, values: Array<string | number | null> = []) {
    this.dbPath = dbPath;
    this.query = query;
    this.values = values;
  }

  bind(...values: Array<string | number | null>): SqliteD1PreparedStatement {
    return new SqliteD1PreparedStatement(this.dbPath, this.query, values);
  }

  async all<TRecord>(): Promise<{ results?: TRecord[] }> {
    const sql = substituteSqliteParams(this.query, this.values);
    const output = execFileSync("sqlite3", ["-json", this.dbPath, sql], { encoding: "utf8" }).trim();
    return { results: output ? (JSON.parse(output) as TRecord[]) : [] };
  }

  async first<TRecord>(): Promise<TRecord | null> {
    return ((await this.all<TRecord>()).results ?? [])[0] ?? null;
  }

  async run(): Promise<unknown> {
    execFileSync("sqlite3", [this.dbPath, substituteSqliteParams(this.query, this.values)], { encoding: "utf8" });
    return { success: true };
  }
}

function substituteSqliteParams(query: string, values: Array<string | number | null>): string {
  let index = 0;
  return query.replace(/\?/g, () => sqliteLiteral(values[index++]));
}

function sqliteLiteral(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  return `'${value.replace(/'/g, "''")}'`;
}

class FakeD1Database {
  private readonly rows: D1TestPlaceRow[];

  constructor(rows: D1TestPlaceRow[]) {
    this.rows = rows;
  }

  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(query, this.rows);
  }
}

class FakeD1PreparedStatement {
  private readonly query: string;
  private readonly rows: D1TestPlaceRow[];
  private readonly values: Array<string | number | null>;

  constructor(query: string, rows: D1TestPlaceRow[], values: Array<string | number | null> = []) {
    this.query = query;
    this.rows = rows;
    this.values = values;
  }

  bind(...values: Array<string | number | null>): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.query, this.rows, values);
  }

  async all<TRecord>(): Promise<{ results?: TRecord[] }> {
    return { results: this.queryRows() as TRecord[] };
  }

  async first<TRecord>(): Promise<TRecord | null> {
    return ((await this.all<TRecord>()).results ?? [])[0] ?? null;
  }

  async run(): Promise<unknown> {
    return { success: true };
  }

  private queryRows(): D1TestPlaceRow[] {
    let rows = [...this.rows].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "ko"));

    if (this.query.includes("p.id = ?")) {
      const id = this.values.find((value): value is string => typeof value === "string");
      rows = rows.filter((row) => row.id === id);
    }

    if (this.query.includes("p.region_id = ?")) {
      const region = this.values.find((value): value is string => typeof value === "string" && rows.some((row) => row.regionId === value));
      rows = region ? rows.filter((row) => row.regionId === region) : [];
    }

    const limit = [...this.values].reverse().find((value): value is number => typeof value === "number") ?? rows.length;
    return rows.slice(0, limit);
  }
}

function sqlite3Available(): boolean {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PHOTO_RIGHTS_TERMS_VERSION } from "../packages/contracts/src/index.ts";
import { createCloudflareApiClient } from "../src/lib/cloudflare-api.ts";
import * as worker from "../workers/api/src/index.ts";
import * as policies from "../workers/api/src/policies.ts";

const execFileAsync = promisify(execFile);
const scriptPath = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));
const pagesSmoke = await import(new URL("../scripts/cloudflare-pages-smoke.mjs", import.meta.url).href);
const pagesLocalReportSmoke = await import(new URL("../scripts/cloudflare-pages-local-report-smoke.mjs", import.meta.url).href);
const releaseGate = await import(new URL("../scripts/cloudflare-release-gate.mjs", import.meta.url).href);
const externalState = await import(new URL("../scripts/cloudflare-external-state-check.mjs", import.meta.url).href);
const d1ReleaseEvidence = await import(new URL("../scripts/cloudflare-d1-release-evidence.mjs", import.meta.url).href);
const r2ReleaseEvidence = await import(new URL("../scripts/cloudflare-r2-release-evidence.mjs", import.meta.url).href);

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
    mimeType: "image/jpeg" | "image/webp";
    byteSize: number;
    status: "pending" | "ready" | "rejected";
  };
  storageKey: string;
};

type PhotoUploadTicketData = {
  uploadId: string;
  ticket: string;
  expiresAt: string;
};

type PhotoCostGuardData = {
  uploadsEnabled: boolean;
  readsEnabled: boolean;
  reason: string | null;
  activeBytes: number;
  storageStopBytes: number;
  writesInPeriod: number;
  monthlyWriteStopLimit: number;
  transformPeriodUtc: string;
  transformsInPeriod: number;
  monthlyTransformStopLimit: number;
  readsInPeriod: number;
  monthlyReadStopLimit: number;
  dayUtc: string;
  readsInDay: number;
  dailyReadStopLimit: number;
};

type BetaKpiData = {
  windowDays: 7 | 30;
  generatedAt: string;
  privacy: "aggregate-only";
  audience: {
    activeUsers: number;
    appOpens: number;
  };
  reportFunnel: {
    started: number;
    submitted: number;
    conversionPercent: number | null;
    medianCompletionSeconds: number | null;
  };
  mapReliability: {
    succeeded: number;
    failed: number;
    successPercent: number | null;
  };
  moderation: {
    submitted: number;
    pending: number;
    approved: number;
    rejected: number;
    hidden: number;
    approvalPercent: number | null;
    reviewedWithin24HoursPercent: number | null;
  };
  retention: {
    d1: { cohortUsers: number; retainedUsers: number; percent: number | null };
    d7: { cohortUsers: number; retainedUsers: number; percent: number | null };
  };
  freshCoverage: {
    eligiblePlaces: number;
    coveredPlaces: number;
    percent: number | null;
    tierA: { eligiblePlaces: number; coveredPlaces: number; percent: number | null };
    tierB: { eligiblePlaces: number; coveredPlaces: number; percent: number | null };
  };
  runtimeReliability: {
    appOpenUsers: number;
    errorUsers: number;
    errorFreePercent: number | null;
  };
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
    verificationMethod: "none" | "radius" | "polygon";
    accuracyBucket: "high" | "medium" | "low" | "unknown";
    moderationStatus: "pending" | "approved" | "rejected" | "hidden";
    createdAt: string;
    expiresAt: string;
  };
  credits: Array<{ type: "verified_report" | "photo_report"; amount: number }>;
  safetyWarning: string | null;
  privacyNotice: string;
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
  shareCard: { headline: string; body: string; hashtags: string[]; url: string };
  safetyWarning: string | null;
  hiddenAt: string | null;
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

type PhotoCostAlertPayload = {
  type: "cost.photo-uploads.stopped" | "cost.photo-reads.stopped";
  reason: string;
  environment: string;
  stopPercent: number;
  activeBytes: number | null;
  storageStopBytes: number | null;
  writesInPeriod: number | null;
  monthlyWriteStopLimit: number | null;
  transformsInPeriod: number | null;
  monthlyTransformStopLimit: number | null;
  readsInPeriod: number | null;
  monthlyReadStopLimit: number | null;
  readsInDay: number | null;
  dailyReadStopLimit: number | null;
  guardPath: string;
  createdAt: string;
};

type ApiCostGuardAlertPayload = {
  type: "cost.api-guard.warning" | "cost.api-guard.changed";
  mode: "running" | "degraded" | "stopped";
  reason: string;
  metric: "workers_requests" | "d1_rows_read" | "d1_rows_written" | "manual" | null;
  thresholdPercent: number;
  generation: number;
  environment: string;
  guardPath: string;
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

function classifyD1MigrationFixture(
  result: { exitCode: number; stdout: string; stderr: string },
  envName: string,
) {
  let stdout =
    result.stdout.includes("photo_read_control_rows=1\n") && !result.stdout.includes("photo_transform_budget_rows=")
      ? result.stdout.replace("photo_read_control_rows=1\n", "photo_read_control_rows=1\nphoto_transform_budget_rows=1\n")
      : result.stdout;
  if (stdout.includes("photo_transform_budget_rows=1\n") && !stdout.includes("photo_read_abuse_tables=")) {
    stdout = stdout.replace("photo_transform_budget_rows=1\n", "photo_transform_budget_rows=1\nphoto_read_abuse_tables=1\n");
  }
  if (stdout.includes("photo_read_abuse_tables=1\n") && !stdout.includes("photo_storage_release_tables=")) {
    stdout = stdout.replace(
      "photo_read_abuse_tables=1\n",
      "photo_read_abuse_tables=1\nphoto_storage_release_tables=1\nphoto_storage_release_indexes=1\n",
    );
  }
  if (stdout.includes("photo_storage_release_indexes=1\n") && !stdout.includes("anonymous_session_tables=")) {
    stdout = stdout.replace(
      "photo_storage_release_indexes=1\n",
      "photo_storage_release_indexes=1\nanonymous_session_tables=1\nanonymous_session_indexes=1\n",
    );
  }
  if (stdout.includes("anonymous_session_indexes=1\n") && !stdout.includes("anonymous_session_budget_tables=")) {
    stdout = stdout.replace(
      "anonymous_session_indexes=1\n",
      "anonymous_session_indexes=1\nanonymous_session_budget_tables=1\n",
    );
  }
  if (stdout.includes("anonymous_session_budget_tables=1\n") && !stdout.includes("place_request_tables=")) {
    stdout = stdout.replace(
      "anonymous_session_budget_tables=1\n",
      "anonymous_session_budget_tables=1\nplace_request_tables=2\nplace_request_indexes=2\nplace_request_triggers=1\n",
    );
  }
  if (stdout.includes("place_request_triggers=1\n") && !stdout.includes("api_cost_guard_tables=")) {
    stdout = stdout.replace(
      "place_request_triggers=1\n",
      "place_request_triggers=1\napi_cost_guard_tables=3\napi_cost_guard_indexes=1\napi_cost_guard_control_rows=1\napi_cost_guard_warning_columns=2\n",
    );
  }
  if (stdout.includes("api_cost_guard_control_rows=1\n") && !stdout.includes("api_cost_guard_warning_columns=")) {
    stdout = stdout.replace(
      "api_cost_guard_control_rows=1\n",
      "api_cost_guard_control_rows=1\napi_cost_guard_warning_columns=2\n",
    );
  }
  return externalState.classifyD1MigrationResult({ ...result, stdout }, envName);
}

const testAdminTokens = JSON.stringify({
  operator: "test-operator-token",
  moderator: "test-moderator-token",
  admin: "test-admin-token",
});
const testPhotoUploadSecret = "test-photo-upload-secret-at-least-32-characters";
const testTurnstileSecret = "t".repeat(32);
const testPhotoClientIp = "198.51.100.10";
const tinyJpegBase64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z";

test("Cloudflare API environments pin browser writes to their deployed web origins", () => {
  const config = JSON.parse(readFileSync(scriptPath("../workers/api/wrangler.jsonc"), "utf8")) as {
    vars?: Record<string, string>;
    ratelimits?: Array<{ name?: string; namespace_id?: string; simple?: { limit?: number; period?: number } }>;
    env?: Record<
      string,
      {
        vars?: Record<string, string>;
        ratelimits?: Array<{ name?: string; namespace_id?: string; simple?: { limit?: number; period?: number } }>;
      }
    >;
  };
  const stagingOrigin = config.env?.staging?.vars?.SILSIGAN_API_ALLOWED_ORIGINS;
  const productionOrigin = config.env?.production?.vars?.SILSIGAN_API_ALLOWED_ORIGINS;
  const environments = [config, config.env?.staging, config.env?.production];
  const publicLimiterNamespaces = environments.map(
    (environment) => environment?.ratelimits?.find((binding) => binding.name === "PUBLIC_API_RATE_LIMITER")?.namespace_id,
  );
  const anonymousSessionLimiterNamespaces = environments.map(
    (environment) => environment?.ratelimits?.find((binding) => binding.name === "ANONYMOUS_SESSION_RATE_LIMITER")?.namespace_id,
  );

  assert.equal(stagingOrigin, "https://silsigan-web-staging.dudqks0319.workers.dev");
  assert.equal(productionOrigin, "https://silsigan-web-production.dudqks0319.workers.dev");
  assert.notEqual(stagingOrigin, productionOrigin);
  assert.equal(environments.every((environment) => environment?.vars?.SILSIGAN_PUBLIC_RATE_LIMIT_REQUIRED === "1"), true);
  assert.equal(config.vars?.SILSIGAN_ANON_SESSION_REQUIRED, "0");
  assert.equal(config.env?.staging?.vars?.SILSIGAN_ANON_SESSION_REQUIRED, "1");
  assert.equal(config.env?.production?.vars?.SILSIGAN_ANON_SESSION_REQUIRED, "1");
  assert.equal(environments.every((environment) => environment?.vars?.SILSIGAN_ANON_SESSION_DAILY_LIMIT === "5000"), true);
  assert.equal(config.vars?.SILSIGAN_PHOTO_TURNSTILE_REQUIRED, "0");
  assert.equal(config.env?.staging?.vars?.SILSIGAN_PHOTO_TURNSTILE_REQUIRED, "1");
  assert.equal(config.env?.production?.vars?.SILSIGAN_PHOTO_TURNSTILE_REQUIRED, "1");
  assert.equal(environments.every((environment) => environment?.vars?.SILSIGAN_PHOTO_MONTHLY_TRANSFORM_LIMIT === "5000"), true);
  assert.equal(environments.every((environment) => environment?.vars?.SILSIGAN_PHOTO_DAILY_IP_READ_LIMIT === "1000"), true);
  assert.equal(environments.every((environment) => environment?.vars?.SILSIGAN_PHOTO_DAILY_BYTES_LIMIT === "20971520"), true);
  assert.equal(environments.every((environment) => environment?.vars?.SILSIGAN_KMA_DAILY_PROVIDER_REQUEST_LIMIT === "5000"), true);
  assert.equal(environments.every((environment) => environment?.vars?.SILSIGAN_TOUR_API_DAILY_PROVIDER_REQUEST_LIMIT === "500"), true);
  assert.equal(environments.every((environment) => environment?.vars?.SILSIGAN_NATIONAL_PARKING_DAILY_PROVIDER_REQUEST_LIMIT === "100"), true);
  assert.equal(environments.every((environment) => environment?.vars?.SILSIGAN_ITS_DAILY_PROVIDER_REQUEST_LIMIT === "500"), true);
  assert.equal(environments.every((environment) => environment?.vars?.SILSIGAN_SEOUL_REALTIME_DAILY_PROVIDER_REQUEST_LIMIT === "500"), true);
  assert.equal(
    environments.every((environment) => {
      const binding = environment?.ratelimits?.find((candidate) => candidate.name === "PUBLIC_API_RATE_LIMITER");
      return binding?.simple?.limit === 120 && binding.simple.period === 60;
    }),
    true,
  );
  assert.equal(new Set(publicLimiterNamespaces).size, 3);
  assert.equal(publicLimiterNamespaces.every(Boolean), true);
  assert.equal(
    environments.every((environment) => {
      const binding = environment?.ratelimits?.find((candidate) => candidate.name === "ANONYMOUS_SESSION_RATE_LIMITER");
      return binding?.simple?.limit === 3 && binding.simple.period === 60;
    }),
    true,
  );
  assert.equal(new Set(anonymousSessionLimiterNamespaces).size, 3);
  assert.equal(anonymousSessionLimiterNamespaces.every(Boolean), true);
});

test("Cloudflare background Cron runs in staging and production while source ingestion remains staging-only", () => {
  const config = JSON.parse(readFileSync(scriptPath("../workers/api/wrangler.jsonc"), "utf8")) as {
    triggers?: { crons?: string[] };
    vars?: Record<string, string>;
    env?: Record<string, { triggers?: { crons?: string[] }; vars?: Record<string, string> }>;
  };

  assert.deepEqual(config.triggers?.crons, []);
  assert.deepEqual(config.env?.staging?.triggers?.crons, ["*/5 * * * *"]);
  assert.deepEqual(config.env?.production?.triggers?.crons, ["*/5 * * * *"]);
  assert.equal(config.vars?.SILSIGAN_SOURCE_INGESTION_SCHEDULED, "0");
  assert.equal(config.env?.staging?.vars?.SILSIGAN_SOURCE_INGESTION_SCHEDULED, "1");
  assert.equal(config.env?.production?.vars?.SILSIGAN_SOURCE_INGESTION_SCHEDULED, "0");
});

test("Cloudflare realtime rooms use the SQLite Durable Object backend required by free accounts", () => {
  const config = JSON.parse(readFileSync(scriptPath("../workers/api/wrangler.jsonc"), "utf8")) as {
    migrations?: Array<{ tag?: string; new_classes?: string[]; new_sqlite_classes?: string[] }>;
  };

  assert.equal(config.migrations?.some((migration) => (migration.new_classes?.length ?? 0) > 0), false);
  assert.deepEqual(config.migrations, [
    {
      tag: "v1",
      new_sqlite_classes: ["PlaceRoom", "RegionRoom", "GlobalRoom"],
    },
  ]);
});

test("Cloudflare resource preflight accepts concrete staging and production bindings", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-ready-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" })), "utf8");

    const output = execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-resource-preflight.mjs"), "--config", configPath], {
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

test("Cloudflare resource preflight rejects placeholder staging resource ids", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-placeholder-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "TODO_STAGING_D1_DATABASE_ID", stagingKvId: "TODO_STAGING_KV_NAMESPACE_ID" })), "utf8");

    try {
      execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-resource-preflight.mjs"), "--config", configPath, "--env", "staging"], {
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

test("Cloudflare resource preflight blocks staging without a public Turnstile site key", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-turnstile-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    const config = createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" });
    config.env.staging.vars.SILSIGAN_TURNSTILE_SITE_KEY = "";
    writeFileSync(configPath, JSON.stringify(config), "utf8");

    try {
      execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-resource-preflight.mjs"), "--config", configPath, "--env", "staging"], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("preflight should reject a missing Turnstile site key");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      assert.match(stdout, /staging\.vars\.SILSIGAN_TURNSTILE_SITE_KEY/);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare resource preflight rejects an unsafe provider request budget", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-provider-budget-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    const config = createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" });
    config.env.staging.vars.SILSIGAN_TOUR_API_DAILY_PROVIDER_REQUEST_LIMIT = "501";
    writeFileSync(configPath, JSON.stringify(config), "utf8");

    try {
      execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-resource-preflight.mjs"), "--config", configPath, "--env", "staging"], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("preflight should reject a provider request budget above its ceiling");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      assert.match(stdout, /SILSIGAN_TOUR_API_DAILY_PROVIDER_REQUEST_LIMIT/);
      assert.match(stdout, /0 \(kill switch\) through 500/);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare resource preflight rejects a blank provider request budget instead of reviving the runtime default", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-preflight-provider-budget-blank-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    const config = createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" });
    config.env.staging.vars.SILSIGAN_TOUR_API_DAILY_PROVIDER_REQUEST_LIMIT = "   ";
    writeFileSync(configPath, JSON.stringify(config), "utf8");

    try {
      execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-resource-preflight.mjs"), "--config", configPath, "--env", "staging"], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("preflight should reject a blank provider request budget");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      assert.match(stdout, /SILSIGAN_TOUR_API_DAILY_PROVIDER_REQUEST_LIMIT/);
      assert.match(stdout, /0 \(kill switch\) through 500/);
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
      execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-resource-preflight.mjs"), "--config", configPath, "--env", "staging"], {
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
      execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-resource-preflight.mjs"), "--config", configPath], {
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
                name: "cloudflare.d1.production.migration_0006",
                status: "fail",
                code: "D1_0006_NOT_APPLIED",
                message: "Remote production D1 is missing the V2 data-truth migrations.",
              },
            ],
            blockers: ["R2_NOT_ENABLED", "deployment_url.production.pages", "D1_0006_NOT_APPLIED"],
          },
          null,
          2,
        ),
        "pnpm failure footer should be ignored after JSON",
      ].join("\n"),
      "utf8",
    );

    const releaseStateScript = scriptPath("../scripts/release-state-check.mjs");
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
      assert.ok(blockedPayload.blockers.includes("D1_0006_NOT_APPLIED"));
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
        scriptPath("../scripts/release-state-check.mjs"),
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
        scriptPath("../scripts/release-state-check.mjs"),
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
        scriptPath("../scripts/release-state-check.mjs"),
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

test("release state check requires an operable store privacy disclosure draft", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-store-privacy-disclosure-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    const incompleteDisclosurePath = join(tempDir, "store-privacy-disclosure-draft.md");
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
    writeFileSync(incompleteDisclosurePath, "# #실시간 App Privacy and Data Safety draft\n\n## Status And Scope\n\ndraft\n", "utf8");

    try {
      execFileSync(process.execPath, [
        scriptPath("../scripts/release-state-check.mjs"),
        `--config=${configPath}`,
        `--ledger=${ledgerPath}`,
        `--release-ledger=${releaseLedgerPath}`,
        `--release-status=${releaseStatusPath}`,
        `--ugc-runbook=${ugcRunbookPath}`,
        `--cost-usage-runbook=${costUsageRunbookPath}`,
        `--review-notes=${testFlightReviewNotesPath}`,
        `--store-privacy=${incompleteDisclosurePath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when the store privacy disclosure draft is incomplete");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; missingTokens?: string[] }>;
      };
      const tokenCheck = payload.checks.find((check) => check.name === "store_privacy_disclosure.doc.required_tokens");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("store_privacy_disclosure.doc.apple_app_privacy"));
      assert.ok(payload.blockers.includes("store_privacy_disclosure.doc.required_tokens"));
      assert.equal(tokenCheck?.status, "fail");
      assert.ok(tokenCheck?.missingTokens?.includes("PrivacyInfo.xcprivacy"));
      assert.ok(tokenCheck?.missingTokens?.includes("Google Play Console"));
      assert.ok(tokenCheck?.missingTokens?.includes("allowBackup=false"));
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
        scriptPath("../scripts/release-state-check.mjs"),
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
        scriptPath("../scripts/release-state-check.mjs"),
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

test("public legal surfaces keep unresolved external inputs release-blocking", () => {
  const privacyPage = readFileSync(scriptPath("../src/app/privacy/page.tsx"), "utf8");
  const supportPage = readFileSync(scriptPath("../src/app/support/page.tsx"), "utf8");
  const termsPage = readFileSync(scriptPath("../src/app/terms/page.tsx"), "utf8");
  const legalGate = readFileSync(scriptPath("../docs/v2-legal-operations-gate.md"), "utf8");
  const storeDisclosure = readFileSync(scriptPath("../docs/store-privacy-disclosure-draft.md"), "utf8");

  for (const token of [
    "운영자의 법적 명칭",
    "개인정보 보호책임자",
    "보유 기간",
    "국외 이전",
    "위치정보법",
    "만 14세 미만",
    "외부 TestFlight",
    "production",
    "named reviewer",
  ]) {
    assert.ok(privacyPage.includes(token), `privacy page must preserve the unresolved ${token} gate`);
  }

  for (const token of [
    "검증된 운영자 이름",
    "지원 이메일·전화번호",
    "개인정보 권리",
    "운영 조치 이의제기",
    "저작권·초상권",
    "trust-safety 담당자",
    "응답 SLA",
    "외부 TestFlight",
  ]) {
    assert.ok(supportPage.includes(token), `support page must preserve the unresolved ${token} gate`);
  }

  for (const token of [
    "이용약관",
    "서비스 제공자의 법적 명칭",
    "사용자 콘텐츠와 권리",
    "신고, 운영 조치와 이의제기",
    "위치정보법",
    "만 14세 미만",
    "책임·분쟁 조항",
    "production",
  ]) {
    assert.ok(termsPage.includes(token), `terms page must preserve the unresolved ${token} gate`);
  }

  for (const policyPage of [privacyPage, supportPage, termsPage]) {
    assert.equal(policyPage.includes("mailto:"), false, "policy pages must not invent an unverified email channel");
    assert.equal(/01[016789]-\d{3,4}-\d{4}/.test(policyPage), false, "policy pages must not invent a phone number");
  }

  assert.ok(legalGate.includes("State: `blocked-external`"));
  assert.ok(legalGate.includes("missing; blocked"));
  assert.ok(legalGate.includes("classification pending; blocked"));
  assert.ok(legalGate.includes("exact schedule pending; blocked"));
  assert.ok(legalGate.includes("`/privacy`, `/support`, `/terms`"));
  assert.ok(storeDisclosure.includes("외부 공개 효력 발생일이 아닙니다"));
  assert.ok(storeDisclosure.includes("임의 값을 만들지 않으며"));
  assert.ok(storeDisclosure.includes("Cloudflare 처리가 개인정보 보호법상 위탁 또는 국외 이전에 해당하는지"));
});

test("release state check requires final privacy, support, and terms URLs", () => {
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
        scriptPath("../scripts/release-state-check.mjs"),
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
          SILSIGAN_PRIVACY_POLICY_URL: "https://silsigan.kr/privacy",
          SILSIGAN_SUPPORT_URL: "http://localhost:3000/support?debug=1",
          SILSIGAN_TERMS_URL: "https://silsigan.kr/privacy",
        }),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when privacy/support/terms URLs are missing, unsafe, or duplicated");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{ name: string; status: string; message: string }>;
      };
      const supportChecks = payload.checks.filter((check) => check.name === "policy_url.support");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("policy_url.support"));
      assert.ok(payload.blockers.includes("policy_url.privacy_policy.terms"));
      assert.ok(payload.checks.some((check) => check.name === "policy_url.terms" && check.status === "pass"));
      assert.ok(supportChecks.some((check) => check.status === "fail" && check.message.includes("https")));
      assert.ok(supportChecks.some((check) => check.status === "fail" && check.message.includes("query")));
      assert.ok(supportChecks.some((check) => check.status === "fail" && check.message.includes("localhost")));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release state check uses allowlisted public URL defaults when process env is absent", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-public-release-env-"));
  try {
    const publicEnvPath = join(tempDir, "public-release.env");
    writeFileSync(
      publicEnvPath,
      [
        "# Only public release URLs may be consumed from this file.",
        'SILSIGAN_STAGING_PAGES_URL="https://silsigan-staging.pages.dev"',
        "SILSIGAN_STAGING_API_BASE_URL=https://silsigan-api-staging.workers.dev",
        "SILSIGAN_PRODUCTION_PAGES_URL=https://silsigan.kr",
        "SILSIGAN_PRODUCTION_API_BASE_URL=https://api.silsigan.kr",
        "SILSIGAN_PRIVACY_POLICY_URL=https://silsigan.kr/privacy",
        "SILSIGAN_SUPPORT_URL=https://silsigan.kr/support",
        "SILSIGAN_TERMS_URL=https://silsigan.kr/terms",
        "SILSIGAN_ADMIN_TOKEN=must-not-be-loaded",
        "",
      ].join("\n"),
      "utf8",
    );

    const env = { ...process.env };
    for (const envVarName of [
      "SILSIGAN_STAGING_PAGES_URL",
      "SILSIGAN_STAGING_API_BASE_URL",
      "SILSIGAN_PRODUCTION_PAGES_URL",
      "SILSIGAN_PRODUCTION_API_BASE_URL",
      "SILSIGAN_PRIVACY_POLICY_URL",
      "SILSIGAN_SUPPORT_URL",
      "SILSIGAN_TERMS_URL",
    ]) {
      delete env[envVarName];
    }

    const output = execFileSync(
      process.execPath,
      [scriptPath("../scripts/release-state-check.mjs"), `--public-env-file=${publicEnvPath}`],
      { encoding: "utf8", env },
    );
    const payload = JSON.parse(output) as {
      publicEnvPath: string;
      publicEnvUrlNames: string[];
      checks: Array<{ name: string; status: string }>;
    };

    assert.equal(payload.publicEnvPath, publicEnvPath);
    assert.equal(payload.publicEnvUrlNames.includes("SILSIGAN_ADMIN_TOKEN"), false);
    for (const checkName of [
      "policy_url.privacy_policy",
      "policy_url.support",
      "policy_url.terms",
      "deployment_url.staging.pages",
      "deployment_url.staging.worker_api",
      "deployment_url.production.pages",
      "deployment_url.production.worker_api",
    ]) {
      assert.ok(
        payload.checks.some((check) => check.name === checkName && check.status === "pass"),
        `${checkName} should use its public env-file fallback`,
      );
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
        scriptPath("../scripts/release-state-check.mjs"),
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
        scriptPath("../scripts/release-state-check.mjs"),
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

test("release state check fails closed when a release blocker status is missing", () => {
  const payload = inspectReleaseHarnessBlockerSchema({ blockerStatus: null });
  const schemaCheck = payload.checks.find((check) => check.name === "release_harness.ledger.blocker_schema");

  assert.equal(schemaCheck?.status, "fail");
  assert.ok(schemaCheck?.errors?.includes("blockers[0].status is required."));
  assert.ok(payload.blockers.includes("release_harness.ledger.blocker_schema"));
});

test("release state check fails closed when a release blocker status is unknown", () => {
  const payload = inspectReleaseHarnessBlockerSchema({ blockerStatus: "paused" });
  const schemaCheck = payload.checks.find((check) => check.name === "release_harness.ledger.blocker_schema");

  assert.equal(schemaCheck?.status, "fail");
  assert.ok(schemaCheck?.errors?.includes('blockers[0].status must be one of "open" or "closed".'));
  assert.ok(payload.blockers.includes("release_harness.ledger.blocker_schema"));
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
        scriptPath("../scripts/release-state-check.mjs"),
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
        scriptPath("../scripts/release-state-check.mjs"),
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
        scriptPath("../scripts/release-state-check.mjs"),
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
  const output = execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-staging-smoke.mjs"), "--tail-only", "--tail-file=tests/fixtures/redacted-worker-tail.log"], {
    encoding: "utf8",
  });
  const payload = JSON.parse(output) as { baseUrl: string | null; ok: boolean; checks: Array<{ name: string; status: string }> };

  assert.equal(payload.ok, true);
  assert.equal(payload.baseUrl, null);
  assert.deepEqual(payload.checks, [
    {
      name: "tail.redaction",
      status: "pass",
      message: "captured tail log에서 raw token/anonymous proof/coordinate/anon id/original filename 패턴이 발견되지 않았습니다.",
      file: "tests/fixtures/redacted-worker-tail.log",
    },
  ]);
});

test("Cloudflare staging smoke requires API base URL unless running tail-only", () => {
  try {
    execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-staging-smoke.mjs")], {
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
    execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-staging-smoke.mjs"), "--mutating", "--require-admin"], {
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
        anonymousProof: `x-silsigan-anon-proof: ${"P".repeat(43)}`,
        proof: "Q".repeat(43),
        anonymousId: "anon_leaky_user_12345",
        email: "leaky@example.com",
        latitude: 35.15321,
        longitude: 129.11861,
        originalFilename: "real-camera-name.jpg",
      }),
      "utf8",
    );

    try {
      execFileSync(process.execPath, [scriptPath("../scripts/cloudflare-staging-smoke.mjs"), "--tail-only", `--tail-file=${logPath}`], {
        encoding: "utf8",
        stdio: "pipe",
      });
      assert.fail("tail redaction smoke should reject raw sensitive log values");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as { ok: boolean; checks: Array<{ details?: unknown; findings?: string[]; status: string }> };

      assert.equal(payload.ok, false);
      assert.equal(payload.checks.some((check) => check.status === "fail"), true);
      assert.deepEqual(new Set(payload.checks.flatMap((check) => check.findings ?? [])), new Set(["admin_token_header", "bearer_token", "anonymous_session_proof", "anonymous_id", "email", "raw_latitude", "raw_longitude", "original_filename"]));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare Pages browser smoke helpers parse args and redact URLs", () => {
  const parsed = pagesSmoke.parseArgs([
    "--pages-url=https://user:pass@silsigan-staging.pages.dev?token=secret#debug",
    "--api-base-url=https://api.example.test",
    "--mutating",
    "--local-admin-cost-guard",
    "--account-deletion",
    "--mock-external-search",
  ]);

  assert.equal(parsed.flags.has("mutating"), true);
  assert.equal(parsed.flags.has("local-admin-cost-guard"), true);
  assert.equal(parsed.flags.has("account-deletion"), true);
  assert.equal(parsed.flags.has("mock-external-search"), true);
  assert.equal(parsed.options.get("api-base-url"), "https://api.example.test");
  assert.equal(pagesSmoke.sanitizeUrl(parsed.options.get("pages-url")), "https://silsigan-staging.pages.dev/");
  assert.equal(pagesSmoke.validateLocalAdminCostGuardTarget(new URL("http://127.0.0.1:3000"), "runtime-test-token"), true);
  assert.throws(
    () => pagesSmoke.validateLocalAdminCostGuardTarget(new URL("https://silsigan-staging.example.test"), "runtime-test-token"),
    /loopback/,
  );
  assert.throws(
    () => pagesSmoke.validateLocalAdminCostGuardTarget(new URL("http://127.0.0.1:3000"), ""),
    /임시 관리자 토큰/,
  );
  assert.equal(pagesSmoke.validateLocalAccountDeletionTarget(new URL("http://127.0.0.1:3000"), true), true);
  assert.throws(
    () => pagesSmoke.validateLocalAccountDeletionTarget(new URL("http://127.0.0.1:3000"), false),
    /mutating/,
  );
  assert.throws(
    () => pagesSmoke.validateLocalAccountDeletionTarget(new URL("https://silsigan-staging.example.test"), true),
    /loopback/,
  );
  assert.throws(
    () => pagesSmoke.validateLocalAccountDeletionTarget(
      new URL("http://127.0.0.1:3000"),
      true,
      new URL("https://api.example.test"),
    ),
    /API.*loopback/,
  );
  assert.equal(pagesSmoke.validateMockExternalSearchTarget(new URL("http://127.0.0.1:3000")), true);
  assert.throws(
    () => pagesSmoke.validateMockExternalSearchTarget(new URL("https://silsigan-staging.example.test")),
    /loopback/,
  );
});

test("Cloudflare Pages browser smoke accepts only an unexpired server-bound anonymous session", () => {
  const now = Date.parse("2026-07-20T00:00:00.000Z");
  const credential = {
    anonymousId: "anon_browser_smoke_session",
    proof: "P".repeat(43),
    expiresAt: "2026-07-21T00:00:00.000Z",
  };

  assert.deepEqual(pagesSmoke.parseAnonymousSessionCredential(JSON.stringify(credential), now), credential);
  assert.equal(
    pagesSmoke.parseAnonymousSessionCredential(JSON.stringify({ ...credential, proof: "short" }), now),
    null,
  );
  assert.equal(
    pagesSmoke.parseAnonymousSessionCredential(JSON.stringify({ ...credential, expiresAt: "2026-07-19T00:00:00.000Z" }), now),
    null,
  );
  assert.equal(pagesSmoke.parseAnonymousSessionCredential("not-json", now), null);
});

test("Cloudflare Pages browser smoke accepts an honest actionable no-data map only without an API", () => {
  const visibleMap = {
    width: 320,
    height: 220,
    hasInteractiveMarker: true,
    hasEmptyState: false,
    hasRetryAction: false,
  };
  const honestEmptyMap = {
    width: 320,
    height: 220,
    hasInteractiveMarker: false,
    hasEmptyState: true,
    hasRetryAction: true,
  };

  assert.equal(pagesSmoke.classifyMapSurfaceObservation(visibleMap, false), "places");
  assert.equal(pagesSmoke.classifyMapSurfaceObservation(honestEmptyMap, true), "empty");
  assert.equal(pagesSmoke.classifyMapSurfaceObservation(honestEmptyMap, false), null);
  assert.equal(pagesSmoke.classifyMapSurfaceObservation({ ...honestEmptyMap, width: 200 }, true), null);
});

test("Cloudflare Pages browser smoke accepts a truthful empty live ranking without inventing buttons", () => {
  const emptyLiveRanking = {
    found: true,
    text: "전국 최신 근거 TOP 10\n아직 순위를 만들 현장 정보가 없어요\n정보 없는 장소는 순위에 넣지 않습니다.",
    buttons: [],
  };
  const populatedRanking = {
    found: true,
    text: "전국 최신 근거 TOP 10",
    buttons: ["광안리해수욕장 최신 근거 보기"],
  };

  assert.equal(pagesSmoke.classifyRankingPanelObservation(emptyLiveRanking, { placeName: "광안리해수욕장" }), "empty");
  assert.equal(pagesSmoke.classifyRankingPanelObservation(populatedRanking, { placeName: "광안리해수욕장" }), "populated");
  assert.equal(
    pagesSmoke.classifyRankingPanelObservation({ ...emptyLiveRanking, text: "전국 TOP 10" }, { placeName: "광안리해수욕장" }),
    null,
  );
});

test("Cloudflare Pages browser smoke preserves diagnostics when a browser assertion fails", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-pages-failure-artifact-"));
  try {
    const artifacts: Record<string, string> = {};
    const screenshotBytes = Buffer.from("failure-screenshot");
    await pagesSmoke.writeFailureArtifacts(
      tempDir,
      {
        client: {
          send: async () => ({ data: screenshotBytes.toString("base64") }),
        },
        networkEvents: [{ type: "request", method: "GET", url: "https://staging.example.test/" }],
        consoleMessages: ["console.error: staging assertion failed"],
      },
      artifacts,
      1234,
    );

    assert.equal(readFileSync(artifacts.failureScreenshot).equals(screenshotBytes), true);
    assert.deepEqual(JSON.parse(readFileSync(artifacts.failureNetwork, "utf8")), [
      { type: "request", method: "GET", url: "https://staging.example.test/" },
    ]);
    assert.equal(readFileSync(artifacts.failureConsole, "utf8"), "console.error: staging assertion failed");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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

test("Cloudflare Pages browser smoke fails when read-only exploration exceeds its API request budget", () => {
  const safeEvents = Array.from({ length: 61 }, (_, index) => ({
    type: "request",
    method: "GET",
    url: `https://api.example.test/api/places?request=${index}`,
  }));
  const noisyEvents = Array.from({ length: 81 }, (_, index) => ({
    type: "request",
    method: "GET",
    url: `https://api.example.test/api/places?request=${index}`,
  }));
  noisyEvents.push({
    type: "request",
    method: "GET",
    url: "https://unrelated.example.test/api/places",
  });

  assert.deepEqual(
    pagesSmoke.classifyNonMutatingApiRequestBudget(safeEvents, "https://api.example.test"),
    { ok: true, requestCount: 61, limit: 80 },
  );
  assert.deepEqual(
    pagesSmoke.classifyNonMutatingApiRequestBudget(noisyEvents, "https://api.example.test"),
    { ok: false, requestCount: 81, limit: 80 },
  );
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
    });

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

    assert.deepEqual(
      pagesLocalReportSmoke.validateFieldReportPublicationContract({
        clientRequestId: "report-browser-smoke-1234",
        photoIds: ["photo-field-report-smoke"],
        hashtagNames: ["광안리", "지금"],
      }),
      {
        validClientRequestId: true,
        photoIdsArray: true,
        hashtagNamesArray: true,
        uploadedPhotoLinked: true,
        photoCount: 1,
        hashtagCount: 2,
        valid: true,
      },
    );
    assert.equal(
      pagesLocalReportSmoke.validateFieldReportPublicationContract({
        clientRequestId: "report-browser-smoke-1234",
        photoIds: [],
        hashtagNames: ["광안리"],
      }).valid,
      false,
    );

    assert.deepEqual(
      pagesLocalReportSmoke.validatePlaceAdditionRequestContract({
        clientRequestId: "place-request-browser-smoke-1234",
        name: "성수 새 장소",
        address: "서울특별시 성동구 테스트로 1",
        category: "기타",
      }),
      {
        exactFields: true,
        validClientRequestId: true,
        validName: true,
        validAddress: true,
        validCategory: true,
        valid: true,
      },
    );
    assert.equal(
      pagesLocalReportSmoke.validatePlaceAdditionRequestContract({
        clientRequestId: "place-request-browser-smoke-1234",
        name: "성수 새 장소",
        address: "서울특별시 성동구 테스트로 1",
        category: "기타",
        mapx: "1270000000",
      }).valid,
      false,
    );

    assert.deepEqual(
      pagesLocalReportSmoke.validateAccountDeletionEvidence({
        accountDeletionCount: 1,
        sessionIssueCount: 2,
        initialSessionId: "anon_local_report_smoke_1",
        currentSessionId: "anon_local_report_smoke_2",
        remainingOwnedContentCount: 0,
      }),
      {
        accountDeletionCount: 1,
        sessionIssueCount: 2,
        sessionRotated: true,
        remainingOwnedContentCount: 0,
      },
    );
    assert.throws(
      () => pagesLocalReportSmoke.validateAccountDeletionEvidence({
        accountDeletionCount: 1,
        sessionIssueCount: 1,
        initialSessionId: "anon_local_report_smoke_1",
        currentSessionId: "anon_local_report_smoke_1",
        remainingOwnedContentCount: 0,
      }),
      /rotate/,
    );
    assert.throws(
      () => pagesLocalReportSmoke.validateAccountDeletionEvidence({
        accountDeletionCount: 1,
        sessionIssueCount: 2,
        initialSessionId: "anon_local_report_smoke_1",
        currentSessionId: "anon_local_report_smoke_2",
        remainingOwnedContentCount: 1,
      }),
      /owned content/i,
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
      SILSIGAN_STAGING_PAGES_URL: "https://staging.silsigan.kr",
      SILSIGAN_STAGING_API_BASE_URL: "https://api-staging.silsigan.kr",
      NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "fixture-map-client-id",
      SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN: "silsigan.kr",
      SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS: "https://staging.silsigan.kr",
      SILSIGAN_NAVER_MAP_REPRESENTATIVE_ACCOUNT_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_MONTHLY_HARD_LIMIT: "4800000",
      SILSIGAN_NAVER_MAP_DAILY_HARD_LIMIT: "160000",
      SILSIGAN_NAVER_MAP_ALERT_THRESHOLD_PERCENT: "70",
      SILSIGAN_NAVER_MAP_ALERT_RECIPIENT_CONFIRMED: "1",
    },
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.releaseCandidate, true);
  assert.equal(plan.mutating, true);
  assert.equal(plan.browserReport, true);
  assert.equal(plan.requirePhoto, true);
  assert.equal(plan.tailRequired, true);
  assert.equal(plan.coordinateStatus, false);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "release.provenance")?.args, ["release:provenance"]);
  assert.ok(
    plan.steps.findIndex((step: ReleaseGateStep) => step.name === "release.provenance")
      < plan.steps.findIndex((step: ReleaseGateStep) => step.name === "release.status.strict"),
  );
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
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_REPRESENTATIVE_ACCOUNT_CONFIRMED_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_MONTHLY_HARD_LIMIT_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_DAILY_HARD_LIMIT_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALERT_THRESHOLD_PERCENT_REQUIRED"));
  assert.ok(missingEvidencePlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALERT_RECIPIENT_CONFIRMED_REQUIRED"));

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

  const unsafeCostProtectionPlan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {
      SILSIGAN_STAGING_ADMIN_TOKEN: "super-secret-admin-token",
      SILSIGAN_STAGING_PAGES_URL: "https://staging.silsigan.kr",
      SILSIGAN_STAGING_API_BASE_URL: "https://api-staging.silsigan.kr",
      NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "fixture-map-client-id",
      SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN: "silsigan.kr",
      SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS: "https://staging.silsigan.kr",
      SILSIGAN_NAVER_MAP_REPRESENTATIVE_ACCOUNT_CONFIRMED: "0",
      SILSIGAN_NAVER_MAP_MONTHLY_HARD_LIMIT: "4800001",
      SILSIGAN_NAVER_MAP_DAILY_HARD_LIMIT: "160001",
      SILSIGAN_NAVER_MAP_ALERT_THRESHOLD_PERCENT: "71",
      SILSIGAN_NAVER_MAP_ALERT_RECIPIENT_CONFIRMED: "0",
    },
  });

  assert.equal(unsafeCostProtectionPlan.ok, false);
  assert.ok(unsafeCostProtectionPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_REPRESENTATIVE_ACCOUNT_CONFIRMED_REQUIRED"));
  assert.ok(unsafeCostProtectionPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_MONTHLY_HARD_LIMIT_ABOVE_SAFE_MAXIMUM"));
  assert.ok(unsafeCostProtectionPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_DAILY_HARD_LIMIT_ABOVE_SAFE_MAXIMUM"));
  assert.ok(unsafeCostProtectionPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALERT_THRESHOLD_PERCENT_ABOVE_SAFE_MAXIMUM"));
  assert.ok(unsafeCostProtectionPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALERT_RECIPIENT_CONFIRMED_REQUIRED"));
  assert.equal(JSON.stringify(unsafeCostProtectionPlan).includes("super-secret"), false);
});

test("Cloudflare release gate production-candidate mode requires production HTTPS URLs without write smoke", () => {
  const parsed = releaseGate.parseArgs(["--production-candidate"]);
  const plan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {
      SILSIGAN_PRODUCTION_PAGES_URL: "https://silsigan.kr",
      SILSIGAN_PRODUCTION_API_BASE_URL: "https://api.silsigan.kr",
      NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "fixture-map-client-id",
      SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN: "silsigan.kr",
      SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS: "https://silsigan.kr",
      SILSIGAN_NAVER_MAP_REPRESENTATIVE_ACCOUNT_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_MONTHLY_HARD_LIMIT: "4800000",
      SILSIGAN_NAVER_MAP_DAILY_HARD_LIMIT: "160000",
      SILSIGAN_NAVER_MAP_ALERT_THRESHOLD_PERCENT: "70",
      SILSIGAN_NAVER_MAP_ALERT_RECIPIENT_CONFIRMED: "1",
    },
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.productionCandidate, true);
  assert.equal(plan.releaseCandidate, false);
  assert.equal(plan.mutating, false);
  assert.equal(plan.browserReport, false);
  assert.equal(plan.requirePhoto, false);
  assert.equal(plan.tailRequired, false);
  assert.deepEqual(plan.steps.find((step: ReleaseGateStep) => step.name === "release.provenance")?.args, ["release:provenance"]);
  assert.ok(
    plan.steps.findIndex((step: ReleaseGateStep) => step.name === "release.provenance")
      < plan.steps.findIndex((step: ReleaseGateStep) => step.name === "release.status.strict"),
  );
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
  assert.equal(JSON.stringify(plan).includes("https://silsigan.kr"), false);
  assert.equal(JSON.stringify(plan).includes("https://api.silsigan.kr"), false);

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
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN_REQUIRED"));
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS_REQUIRED"));
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_REPRESENTATIVE_ACCOUNT_CONFIRMED_REQUIRED"));
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_MONTHLY_HARD_LIMIT_REQUIRED"));
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_DAILY_HARD_LIMIT_REQUIRED"));
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALERT_THRESHOLD_PERCENT_REQUIRED"));
  assert.ok(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_ALERT_RECIPIENT_CONFIRMED_REQUIRED"));
  assert.equal(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "TAIL_FILE_REQUIRED"), false);
  assert.equal(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_ADMIN_TOKEN_REQUIRED"), false);

  const originMismatchPlan = releaseGate.resolveReleaseGatePlan({
    flags: parsed.flags,
    options: parsed.options,
    env: {
      SILSIGAN_PRODUCTION_PAGES_URL: "https://silsigan.kr",
      SILSIGAN_PRODUCTION_API_BASE_URL: "https://api.silsigan.kr",
      NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "fixture-map-client-id",
      SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN: "silsigan.kr",
      SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS: "https://other.silsigan.kr",
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

test("Cloudflare release gate refuses Naver Maps activation on shared hosting domains", () => {
  const sharedHostingPlan = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--release-candidate", "--tail-file", "tests/fixtures/redacted-worker-tail.log"]).flags,
    options: releaseGate.parseArgs(["--release-candidate", "--tail-file", "tests/fixtures/redacted-worker-tail.log"]).options,
    env: {
      SILSIGAN_STAGING_ADMIN_TOKEN: "super-secret-admin-token",
      SILSIGAN_STAGING_PAGES_URL: "https://silsigan-web-staging.dudqks0319.workers.dev",
      SILSIGAN_STAGING_API_BASE_URL: "https://silsigan-api-staging.dudqks0319.workers.dev",
      NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "fixture-map-client-id",
      SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN: "workers.dev",
      SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS: "https://silsigan-web-staging.dudqks0319.workers.dev",
    },
  });

  assert.equal(sharedHostingPlan.ok, false);
  assert.ok(
    sharedHostingPlan.errors.some(
      (error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN_SHARED_HOSTING",
    ),
  );
  assert.equal(JSON.stringify(sharedHostingPlan).includes("dudqks0319"), false);

  const mismatchedDomainPlan = releaseGate.resolveReleaseGatePlan({
    flags: releaseGate.parseArgs(["--production-candidate"]).flags,
    env: {
      SILSIGAN_PRODUCTION_PAGES_URL: "https://silsigan.kr",
      SILSIGAN_PRODUCTION_API_BASE_URL: "https://api.silsigan.kr",
      NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "fixture-map-client-id",
      SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED: "1",
      SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN: "example.com",
      SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS: "https://silsigan.kr",
    },
  });

  assert.equal(mismatchedDomainPlan.ok, false);
  assert.ok(
    mismatchedDomainPlan.errors.some(
      (error: { code: string }) => error.code === "SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN_MISSING_SILSIGAN_PRODUCTION_PAGES_URL",
    ),
  );
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
      name: "cloudflare.d1Evidence.staging",
      status: "fail",
      outputTail: JSON.stringify({
        ok: false,
        results: [
          {
            name: "staging.d1.migration_registry",
            status: "fail",
            check: {
              name: "cloudflare.d1.staging.migration_registry",
              status: "fail",
              code: "D1_MIGRATION_REGISTRY_DRIFT",
              message: "Remote staging D1 migration registry disagrees with verified schema; mutating apply is blocked.",
            },
          },
        ],
      }),
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
      fail: 5,
    },
    failedSteps: [
      "release.status.strict",
      "cloudflare.preflight",
      "cloudflare.d1Evidence.staging",
      "cloudflare.externalState",
      "pages.browser.smoke",
    ],
    blockers: [
      "release_harness.ledger.open_blockers",
      "deployment_url.staging.pages",
      "deployment_url.staging.worker_api",
      "deployment_url.production.worker_api",
      "D1_MIGRATION_REGISTRY_DRIFT",
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

test("Cloudflare R2 privacy classifiers require disabled r2.dev access and no custom domains", () => {
  const privateDevUrl = externalState.classifyR2DevUrlResult(
    {
      exitCode: 0,
      stdout: "Public access via the r2.dev URL is disabled.\n",
      stderr: "",
    },
    "silsigan-photos-staging",
  );
  const noCustomDomains = externalState.classifyR2CustomDomainListResult(
    {
      exitCode: 0,
      stdout: "Listing custom domains connected to bucket 'silsigan-photos-staging'...\nThere are no custom domains connected to this bucket.\n",
      stderr: "",
    },
    "silsigan-photos-staging",
  );

  assert.equal(privateDevUrl.status, "pass");
  assert.equal(noCustomDomains.status, "pass");

  const publicDevUrl = externalState.classifyR2DevUrlResult(
    {
      exitCode: 0,
      stdout: "Public access is enabled at 'https://redacted-account-id.r2.dev'.\n",
      stderr: "",
    },
    "silsigan-photos-staging",
  );
  const publicCustomDomain = externalState.classifyR2CustomDomainListResult(
    {
      exitCode: 0,
      stdout: "Listing custom domains connected to bucket 'silsigan-photos-staging'...\nDomain: private-user-domain.example\nEnabled: Yes\n",
      stderr: "",
    },
    "silsigan-photos-staging",
  );

  assert.equal(publicDevUrl.status, "fail");
  assert.equal(publicDevUrl.code, "R2_PUBLIC_DEV_URL_ENABLED");
  assert.equal(publicCustomDomain.status, "fail");
  assert.equal(publicCustomDomain.code, "R2_PUBLIC_CUSTOM_DOMAIN_CONFIGURED");
  assert.equal(JSON.stringify(publicDevUrl).includes("redacted-account-id"), false);
  assert.equal(JSON.stringify(publicCustomDomain).includes("private-user-domain.example"), false);
});

test("Cloudflare R2 privacy classifiers fail closed when Wrangler cannot prove privacy", () => {
  const devUrl = externalState.classifyR2DevUrlResult(
    {
      exitCode: 1,
      stdout: "",
      stderr: "provider error for account user@example.com /accounts/secret-account-id",
    },
    "silsigan-photos-staging",
  );
  const domains = externalState.classifyR2CustomDomainListResult(
    {
      exitCode: 0,
      stdout: "unexpected output",
      stderr: "",
    },
    "silsigan-photos-staging",
  );

  assert.equal(devUrl.status, "fail");
  assert.equal(devUrl.code, "R2_DEV_URL_CHECK_FAILED");
  assert.equal(domains.status, "fail");
  assert.equal(domains.code, "R2_CUSTOM_DOMAIN_CHECK_FAILED");
  assert.equal(JSON.stringify([devUrl, domains]).includes("user@example.com"), false);
  assert.equal(JSON.stringify([devUrl, domains]).includes("secret-account-id"), false);
});

test("Cloudflare external state check canonicalizes missing auth before remote checks", () => {
  const authCheck = externalState.classifyCloudflareAuthResult({
    exitCode: 1,
    stdout: "",
    stderr:
      "In a non-interactive environment, set CLOUDFLARE_API_TOKEN. Account user@example.com /accounts/2a0a85b82393ae6cfb2dea0b41853458 failed.",
  });
  const r2Check = externalState.classifyAuthBlockedRemoteCheck("cloudflare.r2.enabled", "R2 bucket visibility check");
  const d1Check = externalState.classifyAuthBlockedRemoteCheck("cloudflare.d1.staging.migration_0006", "Remote staging D1 migration evidence check");

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
  const missingMigration = classifyD1MigrationFixture(
    {
      exitCode: 1,
      stdout: "",
      stderr: "SQLITE_ERROR: no such table: posts",
    },
    "staging",
  );
  assert.equal(missingMigration.name, "cloudflare.d1.staging.migration_0006");
  assert.equal(missingMigration.status, "fail");
  assert.equal(missingMigration.code, "D1_0006_NOT_APPLIED");
  assert.equal(JSON.stringify(missingMigration).includes("no such table"), false);

  const incompleteSeed = classifyD1MigrationFixture(
    {
      exitCode: 0,
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nv2_tables=6\nv2_flags=7\nv2_settings=12\nsource_registry=8\ntrust_safety_tables=7\nlive_signal_expiry_required=1\nlive_signals_missing_expiry=0\nplace_event_accuracy_required=1\nplace_event_accuracy_invalid=0\npreference_tables=4\nanalytics_tables=1\nphoto_cleanup_tables=1\nphoto_cleanup_delivery_columns=6\nphoto_cleanup_delivery_indexes=1\nphoto_cleanup_dead_letters=0\nphoto_budget_tables=1\nphoto_budget_rows=1\nphoto_abuse_tables=3\nphoto_upload_control_rows=1\nphoto_read_tables=2\nphoto_read_budget_rows=1\nphoto_read_control_rows=1\nsource_scheduler_tables=1\nsource_scheduler_indexes=2\nsource_scheduler_targets=0\nsource_scheduler_enabled_targets=0\nsource_scheduler_invalid_active=0\nplace_event_moderation_required=1\npublication_tables=5\npublication_delivery_columns=5\npublication_delivery_indexes=1\npublication_dead_letters=0\nposts=3\nquestions=2\n",
      stderr: "",
    },
    "production",
  );
  assert.equal(incompleteSeed.name, "cloudflare.d1.production.seed_posts_questions");
  assert.equal(incompleteSeed.status, "fail");
  assert.equal(incompleteSeed.code, "D1_SEED_INCOMPLETE");
  assert.deepEqual(incompleteSeed.missingSeed, ["posts", "questions"]);

  const ready = classifyD1MigrationFixture(
    {
      exitCode: 0,
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nv2_tables=6\nv2_flags=7\nv2_settings=12\nsource_registry=8\ntrust_safety_tables=7\nlive_signal_expiry_required=1\nlive_signals_missing_expiry=0\nplace_event_accuracy_required=1\nplace_event_accuracy_invalid=0\npreference_tables=4\nanalytics_tables=1\nphoto_cleanup_tables=1\nphoto_cleanup_delivery_columns=6\nphoto_cleanup_delivery_indexes=1\nphoto_cleanup_dead_letters=0\nphoto_budget_tables=1\nphoto_budget_rows=1\nphoto_abuse_tables=3\nphoto_upload_control_rows=1\nphoto_read_tables=2\nphoto_read_budget_rows=1\nphoto_read_control_rows=1\nsource_scheduler_tables=1\nsource_scheduler_indexes=2\nsource_scheduler_targets=0\nsource_scheduler_enabled_targets=0\nsource_scheduler_invalid_active=0\nplace_event_moderation_required=1\npublication_tables=5\npublication_delivery_columns=5\npublication_delivery_indexes=1\npublication_dead_letters=0\nposts=4\nquestions=3\n",
      stderr: "",
    },
    "staging",
  );
  assert.equal(ready.name, "cloudflare.d1.staging.migration_0006");
  assert.equal(ready.status, "pass");
  assert.deepEqual(ready.counts, { posts: 4, questions: 3 });

  const missingModeration = classifyD1MigrationFixture(
    {
      exitCode: 0,
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nv2_tables=6\nv2_flags=7\nv2_settings=12\nsource_registry=8\ntrust_safety_tables=7\nlive_signal_expiry_required=1\nlive_signals_missing_expiry=0\nplace_event_accuracy_required=1\nplace_event_accuracy_invalid=0\npreference_tables=4\nanalytics_tables=1\nphoto_cleanup_tables=1\nphoto_budget_tables=1\nphoto_budget_rows=1\nphoto_abuse_tables=3\nphoto_upload_control_rows=1\nphoto_read_tables=2\nphoto_read_budget_rows=1\nphoto_read_control_rows=1\nsource_scheduler_tables=1\nsource_scheduler_indexes=2\nsource_scheduler_targets=0\nsource_scheduler_enabled_targets=0\nsource_scheduler_invalid_active=0\nposts=4\nquestions=3\n",
      stderr: "",
    },
    "staging",
  );
  assert.equal(missingModeration.status, "fail");
  assert.equal(missingModeration.code, "D1_0006_NOT_APPLIED");
  assert.match(missingModeration.message, /moderation/);

  const missingCurrentChain = classifyD1MigrationFixture(
    {
      exitCode: 0,
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nv2_tables=6\nv2_flags=7\nv2_settings=12\nsource_registry=8\ntrust_safety_tables=7\nposts=4\nquestions=3\n",
      stderr: "",
    },
    "staging",
  );
  assert.equal(missingCurrentChain.status, "fail");
  assert.equal(missingCurrentChain.code, "D1_0006_NOT_APPLIED");
  assert.match(missingCurrentChain.message, /expiry|accuracy|preference|analytics|cleanup/);
});

test("Cloudflare external state check requires source scheduler migration evidence", () => {
  const missingSchedulerTable = classifyD1MigrationFixture(
    {
      exitCode: 1,
      stdout: "",
      stderr: "SQLITE_ERROR: no such table: source_ingestion_targets",
    },
    "staging",
  );

  assert.equal(missingSchedulerTable.status, "fail");
  assert.equal(missingSchedulerTable.code, "D1_0006_NOT_APPLIED");
  assert.equal(JSON.stringify(missingSchedulerTable).includes("no such table"), false);

  const missingScheduler = classifyD1MigrationFixture(
    {
      exitCode: 0,
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nv2_tables=6\nv2_flags=7\nv2_settings=12\nsource_registry=8\ntrust_safety_tables=7\nlive_signal_expiry_required=1\nlive_signals_missing_expiry=0\nplace_event_accuracy_required=1\nplace_event_accuracy_invalid=0\npreference_tables=4\nanalytics_tables=1\nphoto_cleanup_tables=1\nphoto_budget_tables=1\nphoto_budget_rows=1\nphoto_abuse_tables=3\nphoto_upload_control_rows=1\nphoto_read_tables=2\nphoto_read_budget_rows=1\nphoto_read_control_rows=1\nplace_event_moderation_required=1\npublication_tables=5\nposts=4\nquestions=3\n",
      stderr: "",
    },
    "staging",
  );

  assert.equal(missingScheduler.status, "fail");
  assert.equal(missingScheduler.code, "D1_0006_NOT_APPLIED");
  assert.match(missingScheduler.message, /source ingestion scheduler/);

  const unsafeScheduler = classifyD1MigrationFixture(
    {
      exitCode: 0,
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nv2_tables=6\nv2_flags=7\nv2_settings=12\nsource_registry=8\ntrust_safety_tables=7\nlive_signal_expiry_required=1\nlive_signals_missing_expiry=0\nplace_event_accuracy_required=1\nplace_event_accuracy_invalid=0\npreference_tables=4\nanalytics_tables=1\nphoto_cleanup_tables=1\nphoto_budget_tables=1\nphoto_budget_rows=1\nphoto_abuse_tables=3\nphoto_upload_control_rows=1\nphoto_read_tables=2\nphoto_read_budget_rows=1\nphoto_read_control_rows=1\nsource_scheduler_tables=1\nsource_scheduler_indexes=2\nsource_scheduler_targets=1\nsource_scheduler_enabled_targets=1\nsource_scheduler_invalid_active=1\nplace_event_moderation_required=1\npublication_tables=5\nposts=4\nquestions=3\n",
      stderr: "",
    },
    "staging",
  );

  assert.equal(unsafeScheduler.status, "fail");
  assert.equal(unsafeScheduler.code, "D1_0006_NOT_APPLIED");
  assert.match(unsafeScheduler.message, /unsafe source ingestion scheduler targets/);
});

test("Cloudflare external state check requires the Images transformation budget ledger", () => {
  const missingTransformBudget = externalState.classifyD1MigrationResult(
    { exitCode: 1, stdout: "", stderr: "SQLITE_ERROR: no such table: photo_transform_budget" },
    "staging",
  );

  assert.equal(missingTransformBudget.name, "cloudflare.d1.staging.migration_0020");
  assert.equal(missingTransformBudget.status, "fail");
  assert.equal(missingTransformBudget.code, "D1_0020_NOT_APPLIED");
  assert.match(missingTransformBudget.message, /Cloudflare Images transformation budget ledger/);
  assert.equal(JSON.stringify(missingTransformBudget).includes("no such table"), false);
});

test("Cloudflare external state check requires the per-IP photo read abuse ledger", () => {
  const missingReadAbuseBudget = externalState.classifyD1MigrationResult(
    { exitCode: 1, stdout: "", stderr: "SQLITE_ERROR: no such table: photo_read_abuse_budget" },
    "staging",
  );

  assert.equal(missingReadAbuseBudget.name, "cloudflare.d1.staging.migration_0021");
  assert.equal(missingReadAbuseBudget.status, "fail");
  assert.equal(missingReadAbuseBudget.code, "D1_0021_NOT_APPLIED");
  assert.match(missingReadAbuseBudget.message, /per-IP photo read abuse ledger/);
  assert.equal(JSON.stringify(missingReadAbuseBudget).includes("no such table"), false);
});

test("Cloudflare external state check requires the idempotent photo storage-release ledger", () => {
  const missingStorageReleaseLedger = externalState.classifyD1MigrationResult(
    { exitCode: 1, stdout: "", stderr: "SQLITE_ERROR: no such table: photo_storage_releases" },
    "staging",
  );

  assert.equal(missingStorageReleaseLedger.name, "cloudflare.d1.staging.migration_0022");
  assert.equal(missingStorageReleaseLedger.status, "fail");
  assert.equal(missingStorageReleaseLedger.code, "D1_0022_NOT_APPLIED");
  assert.match(missingStorageReleaseLedger.message, /idempotent photo storage-release ledger/);
  assert.equal(JSON.stringify(missingStorageReleaseLedger).includes("no such table"), false);
});

test("Cloudflare external state check requires the server-bound anonymous session ledger", () => {
  const missingAnonymousSessionLedger = externalState.classifyD1MigrationResult(
    { exitCode: 1, stdout: "", stderr: "SQLITE_ERROR: no such table: anonymous_sessions" },
    "staging",
  );

  assert.equal(missingAnonymousSessionLedger.name, "cloudflare.d1.staging.migration_0023");
  assert.equal(missingAnonymousSessionLedger.status, "fail");
  assert.equal(missingAnonymousSessionLedger.code, "D1_0023_NOT_APPLIED");
  assert.match(missingAnonymousSessionLedger.message, /server-bound anonymous session ledger/);
  assert.equal(JSON.stringify(missingAnonymousSessionLedger).includes("no such table"), false);
});

test("Cloudflare external state check requires the exact anonymous session issuance budget", () => {
  const missingAnonymousSessionBudget = externalState.classifyD1MigrationResult(
    { exitCode: 1, stdout: "", stderr: "SQLITE_ERROR: no such table: anonymous_session_issuance_budget" },
    "staging",
  );

  assert.equal(missingAnonymousSessionBudget.name, "cloudflare.d1.staging.migration_0024");
  assert.equal(missingAnonymousSessionBudget.status, "fail");
  assert.equal(missingAnonymousSessionBudget.code, "D1_0024_NOT_APPLIED");
  assert.match(missingAnonymousSessionBudget.message, /anonymous session issuance budget/);
  assert.equal(JSON.stringify(missingAnonymousSessionBudget).includes("no such table"), false);
});

test("Cloudflare external state check requires the private place addition request queue", () => {
  const missingPlaceRequestQueue = externalState.classifyD1MigrationResult(
    { exitCode: 1, stdout: "", stderr: "SQLITE_ERROR: no such table: place_addition_requests" },
    "staging",
  );

  assert.equal(missingPlaceRequestQueue.name, "cloudflare.d1.staging.migration_0025");
  assert.equal(missingPlaceRequestQueue.status, "fail");
  assert.equal(missingPlaceRequestQueue.code, "D1_0025_NOT_APPLIED");
  assert.match(missingPlaceRequestQueue.message, /private place addition request queue/);
  assert.equal(JSON.stringify(missingPlaceRequestQueue).includes("no such table"), false);
});

test("Cloudflare external state check requires the global API cost guard ledger", () => {
  const missingApiCostGuard = externalState.classifyD1MigrationResult(
    { exitCode: 1, stdout: "", stderr: "SQLITE_ERROR: no such table: api_cost_guard_control" },
    "staging",
  );

  assert.equal(missingApiCostGuard.name, "cloudflare.d1.staging.migration_0026");
  assert.equal(missingApiCostGuard.status, "fail");
  assert.equal(missingApiCostGuard.code, "D1_0026_NOT_APPLIED");
  assert.match(missingApiCostGuard.message, /global Workers and D1 cost guard/);
  assert.equal(JSON.stringify(missingApiCostGuard).includes("no such table"), false);
});

test("Cloudflare external state check blocks a remote D1 chain without accuracy buckets", () => {
  const missingAccuracy = classifyD1MigrationFixture(
    {
      exitCode: 0,
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nv2_tables=6\nv2_flags=7\nv2_settings=12\nsource_registry=8\ntrust_safety_tables=7\nlive_signal_expiry_required=1\nlive_signals_missing_expiry=0\npreference_tables=4\nanalytics_tables=1\nphoto_cleanup_tables=1\nphoto_budget_tables=1\nphoto_budget_rows=1\nphoto_abuse_tables=3\nphoto_upload_control_rows=1\nphoto_read_tables=2\nphoto_read_budget_rows=1\nphoto_read_control_rows=1\nsource_scheduler_tables=1\nsource_scheduler_indexes=2\nsource_scheduler_targets=0\nsource_scheduler_enabled_targets=0\nsource_scheduler_invalid_active=0\nplace_event_moderation_required=1\nposts=4\nquestions=3\n",
      stderr: "",
    },
    "staging",
  );

  assert.equal(missingAccuracy.status, "fail");
  assert.equal(missingAccuracy.code, "D1_0006_NOT_APPLIED");
  assert.match(missingAccuracy.message, /accuracy bucket/);
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
      targets: Array<{ envName: string; databaseName: string; steps: Array<{ name: string; args: string[]; applyOnly?: boolean }> }>;
    };

    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "plan-only");
    assert.equal(plan.targets[0]?.envName, "staging");
    assert.equal(plan.targets[0]?.databaseName, "silsigan-staging");
    assert.deepEqual(
      plan.targets[0]?.steps.map((step) => step.name),
      ["d1.migrations.list", "d1.migration.boundary", "d1.posts_questions.evidence"],
    );
    assert.equal(plan.targets[0]?.steps.some((step) => step.applyOnly), false);
    const evidenceCommand = plan.targets[0]?.steps.find((step) => step.name === "d1.posts_questions.evidence")?.args.at(-1) ?? "";
    assert.match(evidenceCommand, /source_scheduler_tables/);
    assert.match(evidenceCommand, /source_scheduler_indexes/);
    assert.match(evidenceCommand, /source_scheduler_invalid_active/);
    assert.match(evidenceCommand, /photo_cleanup_delivery_columns/);
    assert.match(evidenceCommand, /photo_cleanup_dead_letters/);
    assert.match(evidenceCommand, /publication_delivery_columns/);
    assert.match(evidenceCommand, /publication_dead_letters/);
    assert.match(evidenceCommand, /place_request_tables/);
    assert.match(evidenceCommand, /place_request_indexes/);
    assert.match(evidenceCommand, /place_request_triggers/);
    assert.match(evidenceCommand, /api_cost_guard_tables/);
    assert.match(evidenceCommand, /api_cost_guard_indexes/);
    assert.match(evidenceCommand, /api_cost_guard_control_rows/);
    assert.match(evidenceCommand, /api_cost_guard_warning_columns/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare D1 release evidence detects migration registry drift before apply", () => {
  const pendingMigrations = d1ReleaseEvidence.parsePendingD1Migrations({
    exitCode: 0,
    stdout: [
      "Migrations to be applied:",
      "0018_photo_read_budget.sql",
      "0019_background_job_delivery.sql",
      "0026_global_api_cost_guard.sql",
      "0018_photo_read_budget.sql",
    ].join("\n"),
    stderr: "",
  });

  assert.deepEqual(pendingMigrations, [
    "0018_photo_read_budget.sql",
    "0019_background_job_delivery.sql",
    "0026_global_api_cost_guard.sql",
  ]);

  const registryCheck = d1ReleaseEvidence.classifyD1MigrationRegistry({
    envName: "staging",
    pendingMigrations,
    schemaCheck: {
      name: "cloudflare.d1.staging.migration_0026",
      status: "fail",
      code: "D1_0026_NOT_APPLIED",
      message: "Remote staging D1 is missing the global Workers and D1 cost guard.",
    },
  });

  assert.equal(registryCheck.status, "fail");
  assert.equal(registryCheck.code, "D1_MIGRATION_REGISTRY_DRIFT");
  assert.equal(registryCheck.firstSchemaMissing, "0026");
  assert.deepEqual(registryCheck.unregisteredSchemaMigrations, [
    "0018_photo_read_budget.sql",
    "0019_background_job_delivery.sql",
  ]);
  assert.match(registryCheck.message, /apply is blocked/i);
});

test("Cloudflare D1 release evidence accepts the exact pending suffix and rejects missing registry rows", () => {
  const schemaCheck = {
    name: "cloudflare.d1.staging.migration_0026",
    status: "fail",
    code: "D1_0026_NOT_APPLIED",
    message: "Remote staging D1 is missing the global Workers and D1 cost guard.",
  };
  const exactSuffix = d1ReleaseEvidence.classifyD1MigrationRegistry({
    envName: "staging",
    pendingMigrations: ["0026_global_api_cost_guard.sql"],
    schemaCheck,
  });
  const missingRegistryRow = d1ReleaseEvidence.classifyD1MigrationRegistry({
    envName: "staging",
    pendingMigrations: [],
    schemaCheck,
  });

  assert.equal(exactSuffix.status, "pass");
  assert.equal(exactSuffix.firstSchemaMissing, "0026");
  assert.equal(missingRegistryRow.status, "fail");
  assert.equal(missingRegistryRow.code, "D1_MIGRATION_REGISTRY_DRIFT");
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

    const confirmedArgs = d1ReleaseEvidence.parseArgs(["--env=production", "--config", configPath, "--apply", "--confirm-production"]);
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
        ["d1.migration.boundary", false],
        ["d1.migrations.apply", true],
        ["d1.seed.apply", true],
        ["d1.migrations.list.postapply", true],
        ["d1.posts_questions.evidence", false],
      ],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare D1 release evidence never runs migrations apply when registry drift is detected", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-release-drift-"));
  try {
    const configPath = join(tempDir, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify(createPreflightConfig({ stagingD1Id: "d1-staging-ready-id", stagingKvId: "kv-staging-ready-id" })), "utf8");
    const parsed = d1ReleaseEvidence.parseArgs(["--env=staging", "--config", configPath, "--apply"]);
    const plan = await d1ReleaseEvidence.resolveD1ReleaseEvidencePlan({
      flags: parsed.flags,
      options: parsed.options,
      env: {},
    });
    const calls: string[][] = [];
    const boundaryThrough0019 = [
      "m0006_core_tables=2",
      "m0006_core_indexes=4",
      "m0006_v2_tables=6",
      "m0006_trust_safety_tables=7",
      "m0006_preference_tables=4",
      "m0006_analytics_tables=1",
      "m0006_photo_cleanup_tables=1",
      "m0006_photo_budget_tables=1",
      "m0006_photo_abuse_tables=3",
      "m0006_photo_read_tables=2",
      "m0006_publication_tables=5",
      "m0006_live_signal_expiry=1",
      "m0006_place_accuracy=1",
      "m0006_place_moderation=1",
      "m0018_tables=1",
      "m0018_indexes=2",
      "m0019_cleanup_columns=6",
      "m0019_cleanup_indexes=1",
      "m0019_publication_columns=5",
      "m0019_publication_indexes=1",
      "m0020_tables=0",
    ].join("\n");

    const execution = await d1ReleaseEvidence.executeD1ReleaseEvidencePlan(plan, {
      commandRunner: async (_command: string, args: string[]) => {
        calls.push(args);
        if (args.includes("migrations") && args.includes("list")) {
          return {
            exitCode: 0,
            stdout: "0018_photo_read_budget.sql\n0019_background_job_delivery.sql\n0026_global_api_cost_guard.sql\n",
            stderr: "",
          };
        }
        if (args.includes("--command")) {
          if (args.at(-1)?.includes("m0018_tables")) {
            return {
              exitCode: 0,
              stdout: boundaryThrough0019,
              stderr: "",
            };
          }
          return {
            exitCode: 1,
            stdout: "",
            stderr: "SQLITE_ERROR: no such table: api_cost_guard_control",
          };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    assert.equal(execution.ok, false);
    assert.ok(execution.results.some((result: { check?: { code?: string } }) => result.check?.code === "D1_MIGRATION_REGISTRY_DRIFT"));
    assert.equal(calls.some((args) => args.includes("migrations") && args.includes("apply")), false);
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
      ["r2.buckets.list", "r2.bucket.dev-url.get", "r2.bucket.domain.list"],
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
        ["r2.bucket.dev-url.get", "silsigan-photos-production", false],
        ["r2.bucket.domain.list", "silsigan-photos-production", false],
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

test("Cloudflare external state check requires exact API origins for each Pages deployment", () => {
  const missing = externalState.classifyApiAllowedOriginsState({}, ["staging"]);
  assert.equal(missing[0]?.code, "API_ALLOWED_ORIGINS_REQUIRED");

  const configured = externalState.classifyApiAllowedOriginsState(
    {
      SILSIGAN_STAGING_PAGES_URL: "https://silsigan-staging.pages.dev/app",
      SILSIGAN_STAGING_API_ALLOWED_ORIGINS: "https://silsigan-staging.pages.dev",
    },
    ["staging"],
  );
  assert.equal(configured[0]?.status, "pass");

  const unsafe = externalState.classifyApiAllowedOriginsState(
    {
      SILSIGAN_STAGING_PAGES_URL: "https://silsigan-staging.pages.dev",
      SILSIGAN_STAGING_API_ALLOWED_ORIGINS: "* , https://attacker.example/path?token=secret",
    },
    ["staging"],
  );
  assert.equal(unsafe[0]?.code, "API_ALLOWED_ORIGINS_INVALID");
  assert.equal(JSON.stringify(unsafe).includes("attacker.example"), false);
  assert.equal(JSON.stringify(unsafe).includes("secret"), false);
});

test("Cloudflare external state check summarizes canonical release blockers", () => {
  const blockers = externalState.summarizeExternalStateBlockers([
    { name: "cloudflare.r2.enabled", status: "fail", code: "R2_NOT_ENABLED" },
    { name: "deployment_url.staging.pages", status: "fail", code: "DEPLOYMENT_URL_REQUIRED" },
    { name: "deployment_url.staging.worker_api", status: "fail", code: "DEPLOYMENT_URL_REQUIRED" },
    { name: "deployment_url.production.pages", status: "fail", code: "DEPLOYMENT_URL_REQUIRED" },
    { name: "deployment_url.production.worker_api", status: "fail", code: "DEPLOYMENT_URL_REQUIRED" },
    { name: "cloudflare.d1.production.migration_0006", status: "fail", code: "D1_0006_NOT_APPLIED" },
    { name: "cloudflare.d1.production.migration_0006", status: "fail", code: "D1_0006_NOT_APPLIED" },
  ]);

  assert.deepEqual(blockers, [
    "R2_NOT_ENABLED",
    "deployment_url.staging.pages",
    "deployment_url.staging.worker_api",
    "deployment_url.production.pages",
    "deployment_url.production.worker_api",
    "D1_0006_NOT_APPLIED",
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
  const issuedSessionIds = [
    "anon_fixture_primary_session",
    "anon_fixture_restrict_session",
    "anon_fixture_lifecycle_session",
  ];
  const sessionProofs = new Map<string, string>();
  const revokedSessions = new Set<string>();
  let sessionIssueCount = 0;
  let invalidProofRejections = 0;
  let revokedProofRejections = 0;
  let photoDeleted = false;
  let commentCreated = false;
  let commentDeleted = false;
  let restrictionSeedCreated = false;
  let restrictionSeedDeleted = false;
  let userRestricted = false;
  let placeLiked = false;
  let reportOpen = false;
  let reportTargetType = "place";
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestAnonId = String(request.headers["x-silsigan-anon-id"] ?? "");
    const requestProof = String(request.headers["x-silsigan-anon-proof"] ?? "");
    const send = (status: number, payload: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
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

    if (request.method === "POST" && url.pathname === "/api/session/anonymous") {
      const anonymousId = issuedSessionIds[sessionIssueCount];
      const proof = String.fromCharCode(65 + sessionIssueCount).repeat(43);
      sessionIssueCount += 1;
      if (!anonymousId) {
        send(429, { success: false, error: { code: "RATE_LIMITED", message: "too many fixture sessions" } });
        return;
      }
      sessionProofs.set(anonymousId, proof);
      send(201, success({ anonymousId, proof, expiresAt: "2099-12-31T23:59:59.999Z" }));
      return;
    }

    const publicRead = (request.method === "GET" || request.method === "HEAD")
      && url.pathname !== "/api/preferences";
    if (publicRead && requestAnonId && !requestProof) {
      send(401, { success: false, error: { code: "ANONYMOUS_SESSION_PROOF_REQUIRED", message: "proof required" } });
      return;
    }

    const proofRequired =
      ((request.method !== "GET" && request.method !== "HEAD") && !url.pathname.startsWith("/api/admin/"))
      || (request.method === "GET" && url.pathname === "/api/preferences");
    if (proofRequired) {
      if (revokedSessions.has(requestAnonId)) {
        revokedProofRejections += 1;
        send(403, { success: false, error: { code: "ANONYMOUS_SESSION_REVOKED", message: "revoked" } });
        return;
      }
      if (!sessionProofs.has(requestAnonId) || sessionProofs.get(requestAnonId) !== requestProof) {
        invalidProofRejections += 1;
        send(403, { success: false, error: { code: "ANONYMOUS_SESSION_PROOF_INVALID", message: "invalid proof" } });
        return;
      }
    }

    if (request.method === "POST" && url.pathname === "/api/session/anonymous/rotate") {
      const proof = "R".repeat(43);
      sessionProofs.set(requestAnonId, proof);
      send(200, success({ anonymousId: requestAnonId, proof, expiresAt: "2099-12-31T23:59:59.999Z" }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/api/session/anonymous") {
      revokedSessions.add(requestAnonId);
      send(200, success({ revoked: true, revokedAt: "2026-07-20T00:00:00.000Z" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/preferences") {
      send(200, success({ categories: [], savedPlaces: [], followedTopics: [], notificationSubscriptions: [] }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      send(200, success({ ok: true, service: "fixture-worker", storage: "fixture" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/places") {
      send(200, success([{ id: placeId, regionId, latitude: 35.1532, longitude: 129.1186, coordinateStatus: "verified" }]));
      return;
    }

    if (request.method === "GET" && url.pathname === `/api/places/${placeId}`) {
      send(200, success({ id: placeId, regionId, latitude: 35.1532, longitude: 129.1186, coordinateStatus: "verified" }));
      return;
    }

    if (request.method === "GET" && url.pathname === `/api/places/${placeId}/live`) {
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
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        scriptPath("../scripts/cloudflare-staging-smoke.mjs"),
        `--base-url=http://127.0.0.1:${address.port}`,
        "--mutating",
        "--coordinate-status",
        `--coordinate-place-id=${placeId}`,
        "--coordinate-latitude=35.1532",
        "--coordinate-longitude=129.1186",
      ],
      { encoding: "utf8", env: { ...process.env, SILSIGAN_STAGING_ADMIN_TOKEN: adminToken } },
    );
    const payload = JSON.parse(stdout) as { ok: boolean; checks: Array<{ name: string; status: string }> };

    assert.equal(payload.ok, true);
    assert.ok(payload.checks.some((check) => check.name === "realtime.place" && check.status === "pass"));
    assert.ok(payload.checks.some((check) => check.name === "anonymousSession.forgedProof" && check.status === "pass"));
    assert.ok(payload.checks.some((check) => check.name === "anonymousSession.lifecycle" && check.status === "pass"));
    assert.ok(payload.checks.some((check) => check.name === "anonymousSession.cleanup" && check.status === "pass"));
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
    assert.equal(sessionIssueCount, 3);
    assert.equal(invalidProofRejections, 2);
    assert.equal(revokedProofRejections, 1);
    assert.deepEqual(new Set(revokedSessions), new Set(issuedSessionIds));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
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

test("photo policy accepts at most one MiB after client re-encoding", () => {
  const base = {
    uploadId: "upload_photo_policy",
    placeId: "busan-gwangalli",
    byteSize: policies.PHOTO_MAX_BYTES,
    mimeType: "image/jpeg",
    width: 1280,
    height: 720,
    clientReencoded: true,
  };

  assert.equal(policies.PHOTO_MAX_BYTES, 1024 * 1024);
  assert.equal(policies.validatePhotoComplete(base).policy.maxBytes, 1024 * 1024);
  assert.throws(
    () => policies.validatePhotoComplete({ ...base, byteSize: policies.PHOTO_MAX_BYTES + 1 }),
    /PHOTO_SIZE_LIMIT/,
  );
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
      "",
      "## Baseline Thresholds",
      "",
      "Track requests, storage, egress, transformations, reads, writes, and errors against daily and weekly baselines.",
      "",
      "## Alert Rules",
      "",
      "Configure Billing alerts and the dedicated COST_GUARD_STATE mirror before TestFlight expansion. The /api/admin/api-cost-guard control uses a 60% warning, 70% degradation, and 80% stop, then requires Cloudflare reconciliation before resume. WAF remains required because a request is counted before Worker code runs.",
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
      "| R2 staging bucket visibility | guarded against R2_NOT_ENABLED |",
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
  options: {
    blockerStatus?: "open" | "closed" | "paused" | null;
    omitOpenBlockerEvidenceFromStatus?: boolean;
    openBlocker?: boolean;
  } = {},
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
            ...(options.blockerStatus === null ? [] : [`    status: \"${options.blockerStatus ?? "open"}\"`]),
            "    title: \"Cloudflare R2 account is not enabled.\"",
            "    owner: \"release-operator\"",
            "    evidence: \"R2_NOT_ENABLED\"",
            "    due: \"before_staging_release_candidate\"",
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

function inspectReleaseHarnessBlockerSchema(options: { blockerStatus: "open" | "closed" | "paused" | null }) {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-release-blocker-schema-"));
  try {
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(
      tempDir,
      "docs/current-release-state.md",
      { openBlocker: true, ...options },
    );
    const output = execFileSync(process.execPath, [
      scriptPath("../scripts/release-state-check.mjs"),
      `--release-ledger=${releaseLedgerPath}`,
      `--release-status=${releaseStatusPath}`,
    ], {
      encoding: "utf8",
      env: createReadyPreflightProcessEnv(),
      stdio: "pipe",
    });

    return JSON.parse(output) as {
      blockers: string[];
      checks: Array<{ name: string; status: string; errors?: string[] }>;
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function createPreflightEnv(input: { envName: "staging" | "production"; d1Id: string; kvId: string }) {
  return {
    vars: {
      ENVIRONMENT: input.envName,
      SILSIGAN_PHOTO_TURNSTILE_REQUIRED: "1",
      SILSIGAN_TURNSTILE_SITE_KEY: `public-turnstile-${input.envName}`,
      SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
      SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT: "100000",
      SILSIGAN_D1_DAILY_READ_LIMIT: "5000000",
      SILSIGAN_D1_DAILY_WRITE_LIMIT: "100000",
      SILSIGAN_KMA_DAILY_PROVIDER_REQUEST_LIMIT: "5000",
      SILSIGAN_TOUR_API_DAILY_PROVIDER_REQUEST_LIMIT: "500",
      SILSIGAN_NATIONAL_PARKING_DAILY_PROVIDER_REQUEST_LIMIT: "100",
      SILSIGAN_ITS_DAILY_PROVIDER_REQUEST_LIMIT: "500",
      SILSIGAN_SEOUL_REALTIME_DAILY_PROVIDER_REQUEST_LIMIT: "500",
      SILSIGAN_COST_GUARD_WARN_PERCENT: "60",
      SILSIGAN_COST_GUARD_DEGRADE_PERCENT: "70",
      SILSIGAN_COST_GUARD_STOP_PERCENT: "80",
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
      {
        binding: "COST_GUARD_STATE",
        id: `cost-guard-${input.kvId}`,
      },
    ],
    ratelimits: [
      { name: "PUBLIC_API_RATE_LIMITER" },
      { name: "ADMIN_API_RATE_LIMITER" },
      { name: "HIGH_COST_API_RATE_LIMITER" },
    ],
    r2_buckets: [
      {
        binding: "PHOTOS",
        bucket_name: `silsigan-photos-${input.envName}`,
      },
    ],
    images: {
      binding: "IMAGES",
    },
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
    SILSIGAN_TERMS_URL: "https://silsigan.kr/terms",
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
  const response = await worker.handleRequest(new Request("https://api.test/api/config"), { ENVIRONMENT: "development" });
  assert.equal(response.status, 200);

  const payload = (await response.json()) as SuccessPayload<{
    contractVersion: number;
    dataMode: string;
    featureFlags: Record<string, boolean>;
    dimensionSettings: Array<{ settingKey: string; defaultTtlSeconds: number }>;
    photoUploadProtection: { turnstileRequired: boolean; turnstileSiteKey: string | null };
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
  assert.equal(payload.data.dimensionSettings.find((setting) => setting.settingKey === "parking")?.defaultTtlSeconds, 900);
  assert.deepEqual(payload.data.photoUploadProtection, { turnstileRequired: false, turnstileSiteKey: null });
  assert.equal(payload.meta?.storage, "memory");
});

test("Worker runtime config exposes only the public Turnstile site key", async () => {
  const secret = "must-never-appear-in-runtime-config";
  const response = await worker.handleRequest(new Request("https://api.test/api/config"), {
    ENVIRONMENT: "development",
    SILSIGAN_PHOTO_TURNSTILE_REQUIRED: "1",
    SILSIGAN_TURNSTILE_SITE_KEY: "public-turnstile-site-key",
    SILSIGAN_TURNSTILE_SECRET_KEY: secret,
  });
  const raw = await response.text();
  const payload = JSON.parse(raw) as SuccessPayload<{
    photoUploadProtection: { turnstileRequired: boolean; turnstileSiteKey: string | null };
  }>;

  assert.equal(response.status, 200);
  assert.deepEqual(payload.data.photoUploadProtection, {
    turnstileRequired: true,
    turnstileSiteKey: "public-turnstile-site-key",
  });
  assert.equal(raw.includes(secret), false);
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

    const ingest = () => worker.handleRequest(
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
    assert.equal(Date.parse(signal?.expiresAt ?? "") - Date.parse(signal?.observedAt ?? ""), 7_200_000);
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
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("official source daily request budget blocks provider calls before the free quota is exhausted", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  const serviceKey = "kma-budget-fixture-secret-key";
  let fetchCount = 0;

  try {
    await db.prepare(`
      UPDATE data_sources
      SET enabled = 1, health_status = 'healthy', default_ttl_seconds = 7200
      WHERE source_key = 'kma_weather'
    `).run();
    const providerKst = new Date(Date.now() + 9 * 60 * 60 * 1_000 - 5 * 60 * 1_000);
    const baseDate = `${providerKst.getUTCFullYear()}${String(providerKst.getUTCMonth() + 1).padStart(2, "0")}${String(providerKst.getUTCDate()).padStart(2, "0")}`;
    const baseTime = `${String(providerKst.getUTCHours()).padStart(2, "0")}${String(providerKst.getUTCMinutes()).padStart(2, "0")}`;
    const requestBody = { placeId: "busan-gwangalli", nx: 98, ny: 76, baseDate, baseTime };
    globalThis.fetch = async (): Promise<Response> => {
      fetchCount += 1;
      return Response.json({
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
          body: {
            totalCount: 4,
            items: {
              item: [
                { baseDate, baseTime, category: "T1H", nx: 98, ny: 76, obsrValue: "24.1" },
                { baseDate, baseTime, category: "RN1", nx: 98, ny: 76, obsrValue: "0" },
                { baseDate, baseTime, category: "WSD", nx: 98, ny: 76, obsrValue: "1.8" },
                { baseDate, baseTime, category: "PTY", nx: 98, ny: 76, obsrValue: "0" },
              ],
            },
          },
        },
      });
    };
    const ingest = () => worker.handleRequest(
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
        SILSIGAN_KMA_DAILY_PROVIDER_REQUEST_LIMIT: "2",
      },
    );

    const first = await ingest();
    const second = await ingest();
    const blocked = (await second.json()) as FailurePayload;
    const runStatuses = await db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM api_ingestion_runs
      WHERE source_id = 'source-kma-weather'
      GROUP BY status
      ORDER BY status
    `).all<{ status: string; count: number }>();

    assert.equal(first.status, 201);
    assert.equal(second.status, 429);
    assert.equal(blocked.error.code, "SOURCE_DAILY_REQUEST_BUDGET_EXHAUSTED");
    assert.equal(fetchCount, 1, "budget rejection must happen before a second provider request");
    assert.deepEqual(runStatuses.results, [
      { status: "quota_exceeded", count: 1 },
      { status: "succeeded", count: 1 },
    ]);
    assert.equal(JSON.stringify(blocked).includes(serviceKey), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("provider quota responses still consume the local daily request budget", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  try {
    const startedAt = new Date().toISOString();
    await db.prepare(`
      UPDATE data_sources
      SET enabled = 1, health_status = 'healthy', default_ttl_seconds = 7200
      WHERE source_key = 'kma_weather'
    `).run();
    await db.prepare(`
      INSERT INTO api_ingestion_runs (
        id, source_id, region_code, status, error_code, started_at, finished_at
      ) VALUES (
        'provider-quota-budget-reservation', 'source-kma-weather', 'busan',
        'quota_exceeded', 'SOURCE_QUOTA_EXCEEDED', ?, ?
      )
    `).bind(startedAt, startedAt).run();
    globalThis.fetch = async (): Promise<Response> => {
      fetchCount += 1;
      return Response.json({ unexpected: true });
    };

    const providerKst = new Date(Date.now() + 9 * 60 * 60 * 1_000 - 5 * 60 * 1_000);
    const baseDate = `${providerKst.getUTCFullYear()}${String(providerKst.getUTCMonth() + 1).padStart(2, "0")}${String(providerKst.getUTCDate()).padStart(2, "0")}`;
    const baseTime = `${String(providerKst.getUTCHours()).padStart(2, "0")}${String(providerKst.getUTCMinutes()).padStart(2, "0")}`;
    const response = await worker.handleRequest(
      new Request("https://api.test/api/admin/sources/kma_weather/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-operator-token",
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", nx: 98, ny: 76, baseDate, baseTime }),
      }),
      {
        DB: db,
        ADMIN_TOKENS: testAdminTokens,
        KMA_SERVICE_KEY: "kma-provider-quota-fixture-key",
        SILSIGAN_KMA_DAILY_PROVIDER_REQUEST_LIMIT: "2",
      },
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 429);
    assert.equal(payload.error.code, "SOURCE_DAILY_REQUEST_BUDGET_EXHAUSTED");
    assert.equal(fetchCount, 0, "a provider quota response must remain a counted network attempt");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ITS traffic and CCTV share one conservative daily provider budget", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  try {
    const startedAt = new Date().toISOString();
    await db.prepare(`
      UPDATE data_sources
      SET commercial_use_status = 'allowed_with_attribution', enabled = 1,
          health_status = 'healthy', default_ttl_seconds = 600
      WHERE source_key = 'national_traffic'
    `).run();
    await db.prepare(`
      INSERT INTO api_ingestion_runs (id, source_id, region_code, status, started_at, finished_at)
      VALUES ('cctv-shared-budget-reservation', 'source-national-cctv', 'busan', 'succeeded', ?, ?)
    `).bind(startedAt, startedAt).run();
    globalThis.fetch = async (): Promise<Response> => {
      fetchCount += 1;
      return Response.json({ unexpected: true });
    };

    const response = await worker.handleRequest(
      new Request("https://api.test/api/admin/sources/national_traffic/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-operator-token",
        },
        body: JSON.stringify({
          placeId: "busan-gwangalli",
          linkId: "2600012400",
          roadType: "all",
          minLng: 129.1,
          maxLng: 129.14,
          minLat: 35.14,
          maxLat: 35.17,
        }),
      }),
      {
        DB: db,
        ADMIN_TOKENS: testAdminTokens,
        ITS_SERVICE_KEY: "its-shared-budget-fixture-key",
        SILSIGAN_ITS_DAILY_PROVIDER_REQUEST_LIMIT: "2",
      },
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 429);
    assert.equal(payload.error.code, "SOURCE_DAILY_REQUEST_BUDGET_EXHAUSTED");
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("official source daily request budgets reset at Korea Standard Time midnight", () => {
  assert.deepEqual(worker.resolveOfficialSourceQuotaWindow("2026-07-20T14:59:59.000Z"), {
    dayStart: "2026-07-19T15:00:00.000Z",
    dayEnd: "2026-07-20T15:00:00.000Z",
  });
  assert.deepEqual(worker.resolveOfficialSourceQuotaWindow("2026-07-20T15:00:00.000Z"), {
    dayStart: "2026-07-20T15:00:00.000Z",
    dayEnd: "2026-07-21T15:00:00.000Z",
  });
  assert.throws(
    () => worker.resolveOfficialSourceQuotaWindow("not-a-provider-timestamp"),
    (error: unknown) => error instanceof Error && "code" in error
      && error.code === "SOURCE_DAILY_REQUEST_BUDGET_UNAVAILABLE",
  );
});

test("scheduled KMA requests use the latest safely published Korea Standard Time hour", () => {
  assert.deepEqual(worker.resolveScheduledKmaBaseTime(new Date("2026-07-19T15:39:00.000Z")), {
    baseDate: "20260719",
    baseTime: "2300",
  });
  assert.deepEqual(worker.resolveScheduledKmaBaseTime(new Date("2026-07-19T15:45:00.000Z")), {
    baseDate: "20260720",
    baseTime: "0000",
  });
});

test("scheduled handler disables platform retries and logs aggregate data only", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalLog = console.log;
  const logs: string[] = [];
  let noRetryCount = 0;

  try {
    console.log = (...values: unknown[]): void => {
      logs.push(values.map(String).join(" "));
    };

    await worker.default.scheduled(
      {
        scheduledTime: Date.parse("2026-07-19T00:00:00.000Z"),
        cron: "*/5 * * * *",
        noRetry: () => {
          noRetryCount += 1;
        },
      },
      { DB: db, SILSIGAN_SOURCE_INGESTION_SCHEDULED: "1" },
    );

    assert.equal(noRetryCount, 1);
    assert.equal(logs.length, 1);
    assert.deepEqual(JSON.parse(logs[0] ?? "{}"), {
      event: "background.schedule.completed",
      cron: "*/5 * * * *",
      scheduledAt: "2026-07-19T00:00:00.000Z",
      sourceIngestion: {
        ok: true,
        summary: {
          scheduledAt: "2026-07-19T00:00:00.000Z",
          examinedCount: 0,
          claimedCount: 0,
          succeededCount: 0,
          failedCount: 0,
          skippedCount: 0,
          errorCodes: {},
        },
      },
      photoCleanup: {
        ok: true,
        summary: {
          scheduledAt: "2026-07-19T00:00:00.000Z",
          examinedCount: 0,
          claimedCount: 0,
          succeededCount: 0,
          retriedCount: 0,
          deadLetteredCount: 0,
          skippedCount: 0,
          errorCodes: {},
        },
      },
      publicationOutbox: {
        ok: true,
        summary: {
          scheduledAt: "2026-07-19T00:00:00.000Z",
          examinedCount: 0,
          claimedCount: 0,
          succeededCount: 0,
          retriedCount: 0,
          deadLetteredCount: 0,
          skippedCount: 0,
          errorCodes: {},
        },
      },
    });
    assert.equal(logs.join("\n").includes("adapterConfigJson"), false);
    assert.equal(logs.join("\n").includes("serviceKey"), false);
  } finally {
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scheduled handler skips unapproved source ingestion but still runs cleanup and publication consumers", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalLog = console.log;
  const logs: string[] = [];

  try {
    console.log = (...values: unknown[]): void => {
      logs.push(values.map(String).join(" "));
    };

    await worker.default.scheduled(
      {
        scheduledTime: Date.parse("2026-07-19T00:00:00.000Z"),
        cron: "*/5 * * * *",
        noRetry: () => undefined,
      },
      { DB: db, SILSIGAN_SOURCE_INGESTION_SCHEDULED: "0" },
    );

    const payload = JSON.parse(logs[0] ?? "{}") as {
      sourceIngestion?: unknown;
      photoCleanup?: { ok?: boolean };
      publicationOutbox?: { ok?: boolean };
    };
    assert.deepEqual(payload.sourceIngestion, {
      ok: true,
      skipped: true,
      reason: "disabled-by-environment",
    });
    assert.equal(payload.photoCleanup?.ok, true);
    assert.equal(payload.publicationOutbox?.ok, true);
  } finally {
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scheduled consumer failures are isolated so cleanup and publication still complete", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalLog = console.log;
  const logs: string[] = [];

  try {
    await db.prepare("DROP TABLE source_ingestion_targets").run();
    console.log = (...values: unknown[]): void => {
      logs.push(values.map(String).join(" "));
    };

    await worker.default.scheduled(
      {
        scheduledTime: Date.parse("2026-07-19T00:00:00.000Z"),
        cron: "*/5 * * * *",
        noRetry: () => undefined,
      },
      { DB: db, SILSIGAN_SOURCE_INGESTION_SCHEDULED: "1" },
    );

    const payload = JSON.parse(logs[0] ?? "{}") as {
      sourceIngestion?: { ok?: boolean; errorCode?: string };
      photoCleanup?: { ok?: boolean };
      publicationOutbox?: { ok?: boolean };
    };
    assert.equal(payload.sourceIngestion?.ok, false);
    assert.equal(payload.sourceIngestion?.errorCode, "SOURCE_SCHEDULER_UNAVAILABLE");
    assert.equal(payload.photoCleanup?.ok, true);
    assert.equal(payload.publicationOutbox?.ok, true);
  } finally {
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scheduled photo cleanup deletes R2 objects and releases the storage ledger exactly once", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const scheduledAt = new Date("2026-07-19T00:00:00.000Z");

  try {
    await r2.put("pending/cleanup-once.webp", "fixture");
    await db.prepare("UPDATE photo_storage_budget SET active_bytes = 512 WHERE id = 1").run();
    await db.prepare(`
      INSERT INTO photo_cleanup_jobs (
        id, photo_id, storage_key, byte_size, reason, status, attempts,
        next_attempt_at, last_error_code, created_at, updated_at
      ) VALUES (
        'cleanup-once', NULL, 'pending/cleanup-once.webp', 512, 'test_cleanup',
        'pending', 0, '2026-07-18T23:59:00.000Z', 'R2_DELETE_FAILED',
        '2026-07-18T23:59:00.000Z', '2026-07-18T23:59:00.000Z'
      )
    `).run();

    const first = await worker.runScheduledPhotoCleanup({ DB: db, PHOTOS: r2 }, scheduledAt);
    const second = await worker.runScheduledPhotoCleanup({ DB: db, PHOTOS: r2 }, scheduledAt);
    const job = await db.prepare(`
      SELECT status, attempts, budget_released_at AS budgetReleasedAt,
             completed_at AS completedAt, lease_token AS leaseToken
      FROM photo_cleanup_jobs WHERE id = 'cleanup-once'
    `).first<{
      status: string;
      attempts: number;
      budgetReleasedAt: string | null;
      completedAt: string | null;
      leaseToken: string | null;
    }>();
    const budget = await db.prepare("SELECT active_bytes AS activeBytes FROM photo_storage_budget WHERE id = 1")
      .first<{ activeBytes: number }>();

    assert.deepEqual(first, {
      scheduledAt: scheduledAt.toISOString(),
      examinedCount: 1,
      claimedCount: 1,
      succeededCount: 1,
      retriedCount: 0,
      deadLetteredCount: 0,
      skippedCount: 0,
      errorCodes: {},
    });
    assert.equal(second.examinedCount, 0);
    assert.deepEqual(r2.deletedKeys, ["pending/cleanup-once.webp"]);
    assert.equal(job?.status, "completed");
    assert.equal(job?.attempts, 1);
    assert.equal(job?.budgetReleasedAt, scheduledAt.toISOString());
    assert.equal(job?.completedAt, scheduledAt.toISOString());
    assert.equal(job?.leaseToken, null);
    assert.equal(budget?.activeBytes, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scheduled photo cleanup prunes expired upload and per-IP abuse ledgers", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const scheduledAt = new Date("2026-07-19T00:00:00.000Z");

  try {
    await db.prepare(`
      INSERT INTO photo_upload_claims (upload_id, anonymous_user_id, expires_at, consumed_at)
      VALUES
        ('old-claim', 'anon_old', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'),
        ('current-claim', 'anon_current', '2026-07-19T00:05:00.000Z', '2026-07-19T00:00:00.000Z')
    `).run();
    await db.prepare(`
      INSERT INTO photo_abuse_budget (principal_hash, day_utc, upload_count, bytes_in_period, updated_at)
      VALUES
        ('hmac-sha256:old-upload', '2026-07-15', 1, 10, '2026-07-15T00:00:00.000Z'),
        ('hmac-sha256:current-upload', '2026-07-19', 1, 10, '2026-07-19T00:00:00.000Z')
    `).run();
    await db.prepare(`
      INSERT INTO photo_read_abuse_budget (principal_hash, day_utc, read_count, updated_at)
      VALUES
        ('hmac-sha256:old-read', '2026-07-15', 1, '2026-07-15T00:00:00.000Z'),
        ('hmac-sha256:current-read', '2026-07-19', 1, '2026-07-19T00:00:00.000Z')
    `).run();
    await db.prepare(`
      INSERT INTO anonymous_sessions (
        session_hash, proof_hash, status, expires_at, created_at, last_seen_at, rotated_at, revoked_at
      ) VALUES
        ('expired-session', 'sha256:expired', 'active', '2026-07-18T23:59:59.000Z', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL, NULL),
        ('old-revoked-session', 'sha256:old-revoked', 'revoked', '2027-07-19T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-07-15T00:00:00.000Z', NULL, '2026-07-15T00:00:00.000Z'),
        ('recent-revoked-session', 'sha256:recent-revoked', 'revoked', '2027-07-19T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-07-18T00:00:00.000Z', NULL, '2026-07-18T00:00:00.000Z'),
        ('current-session', 'sha256:current', 'active', '2027-07-19T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-07-19T00:00:00.000Z', NULL, NULL)
    `).run();
    await db.prepare(`
      INSERT INTO anonymous_session_issuance_budget (day_utc, issue_count, updated_at)
      VALUES
        ('2026-07-15', 10, '2026-07-15T00:00:00.000Z'),
        ('2026-07-19', 2, '2026-07-19T00:00:00.000Z')
    `).run();

    const summary = await worker.runScheduledPhotoCleanup({ DB: db }, scheduledAt);
    const claims = await db.prepare("SELECT upload_id AS uploadId FROM photo_upload_claims ORDER BY upload_id").all<{ uploadId: string }>();
    const uploads = await db.prepare("SELECT principal_hash AS principalHash FROM photo_abuse_budget ORDER BY principal_hash").all<{ principalHash: string }>();
    const reads = await db.prepare("SELECT principal_hash AS principalHash FROM photo_read_abuse_budget ORDER BY principal_hash").all<{ principalHash: string }>();
    const sessions = await db.prepare("SELECT session_hash AS sessionHash FROM anonymous_sessions ORDER BY session_hash").all<{ sessionHash: string }>();
    const sessionBudgets = await db.prepare("SELECT day_utc AS dayUtc FROM anonymous_session_issuance_budget ORDER BY day_utc").all<{ dayUtc: string }>();

    assert.equal(summary.examinedCount, 0);
    assert.deepEqual(claims.results, [{ uploadId: "current-claim" }]);
    assert.deepEqual(uploads.results, [{ principalHash: "hmac-sha256:current-upload" }]);
    assert.deepEqual(reads.results, [{ principalHash: "hmac-sha256:current-read" }]);
    assert.deepEqual(sessions.results, [
      { sessionHash: "current-session" },
      { sessionHash: "recent-revoked-session" },
    ]);
    assert.deepEqual(sessionBudgets.results, [{ dayUtc: "2026-07-19" }]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scheduled photo cleanup dead-letters bounded failures without leaking storage keys", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const scheduledAt = new Date("2026-07-19T00:00:00.000Z");
  class FailingDeleteR2Bucket extends FakeR2Bucket {
    override async delete(): Promise<void> {
      throw new Error("provider failure with private key pending/secret-user-file.webp");
    }
  }

  try {
    await db.prepare("UPDATE photo_storage_budget SET active_bytes = 256 WHERE id = 1").run();
    await db.prepare(`
      INSERT INTO photo_cleanup_jobs (
        id, photo_id, storage_key, byte_size, reason, status, attempts,
        next_attempt_at, last_error_code, created_at, updated_at
      ) VALUES (
        'cleanup-dead-letter', NULL, 'pending/secret-user-file.webp', 256, 'test_failure',
        'pending', 4, '2026-07-18T23:59:00.000Z', 'R2_DELETE_FAILED',
        '2026-07-18T23:59:00.000Z', '2026-07-18T23:59:00.000Z'
      )
    `).run();

    const summary = await worker.runScheduledPhotoCleanup(
      { DB: db, PHOTOS: new FailingDeleteR2Bucket() },
      scheduledAt,
    );
    const job = await db.prepare(`
      SELECT status, attempts, last_error_code AS lastErrorCode,
             dead_lettered_at AS deadLetteredAt, lease_token AS leaseToken
      FROM photo_cleanup_jobs WHERE id = 'cleanup-dead-letter'
    `).first<{
      status: string;
      attempts: number;
      lastErrorCode: string;
      deadLetteredAt: string | null;
      leaseToken: string | null;
    }>();
    const budget = await db.prepare("SELECT active_bytes AS activeBytes FROM photo_storage_budget WHERE id = 1")
      .first<{ activeBytes: number }>();

    assert.equal(summary.deadLetteredCount, 1);
    assert.deepEqual(summary.errorCodes, { BACKGROUND_JOB_FAILED: 1 });
    assert.equal(JSON.stringify(summary).includes("secret-user-file"), false);
    assert.equal(job?.status, "failed");
    assert.equal(job?.attempts, 5);
    assert.equal(job?.lastErrorCode, "BACKGROUND_JOB_FAILED");
    assert.equal(job?.deadLetteredAt, scheduledAt.toISOString());
    assert.equal(job?.leaseToken, null);
    assert.equal(budget?.activeBytes, 256);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scheduled publication outbox emits a safe event only after field report approval", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const anonymousId = "anon_scheduled_outbox";
  const scheduledAt = new Date("2030-07-19T00:05:00.000Z");
  const env = {
    DB: db,
    PLACE_ROOM: new FakeDurableObjectNamespace(() => new worker.PlaceRoom()),
    REGION_ROOM: new FakeDurableObjectNamespace(() => new worker.RegionRoom()),
    GLOBAL_ROOM: new FakeDurableObjectNamespace(() => new worker.GlobalRoom()),
  };

  try {
    const response = await rawD1Post(db, "https://api.test/api/reports", anonymousId, {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      hashtagNames: ["#광안리지금"],
      clientRequestId: "scheduled-outbox-001",
    });
    const payload = (await response.json()) as SuccessPayload<FieldReportData>;
    assert.equal(response.status, 201);

    const pendingOutbox = await db.prepare("SELECT COUNT(*) AS count FROM publication_outbox WHERE aggregate_id = ?").bind(payload.data.report.id).first<{ count: number }>();
    const pendingSummary = await worker.runScheduledPublicationOutbox(env, scheduledAt);
    const pendingPlaceRoom = await getRealtimeRoom<{
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    }>(env, "/api/realtime/place/busan-gwangalli", anonymousId);
    assert.equal(pendingOutbox?.count, 0);
    assert.equal(pendingSummary.succeededCount, 0);
    assert.equal(pendingPlaceRoom.events.length, 0);

    await d1AdminPost<SuccessPayload<{ moderationStatus: string }>>(
      db,
      `https://api.test/api/admin/field-reports/${payload.data.report.id}/action`,
      { status: "approved", reason: "실시간 발행 전 개인정보 검수 완료" },
      {},
      "test-moderator-token",
    );

    const summary = await worker.runScheduledPublicationOutbox(env, scheduledAt);
    const outbox = await db.prepare(`
      SELECT status, attempts, published_at AS publishedAt,
             last_error_code AS lastErrorCode, lease_token AS leaseToken
      FROM publication_outbox WHERE aggregate_id = ?
    `).bind(payload.data.report.id).first<{
      status: string;
      attempts: number;
      publishedAt: string | null;
      lastErrorCode: string | null;
      leaseToken: string | null;
    }>();
    const placeRoom = await getRealtimeRoom<{
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    }>(env, "/api/realtime/place/busan-gwangalli", anonymousId);

    assert.equal(summary.succeededCount, 1);
    assert.equal(summary.retriedCount, 0);
    assert.equal(outbox?.status, "published");
    assert.equal(outbox?.attempts, 1);
    assert.equal(outbox?.publishedAt, scheduledAt.toISOString());
    assert.equal(outbox?.lastErrorCode, null);
    assert.equal(outbox?.leaseToken, null);
    assert.equal(placeRoom.events[0]?.type, "report.created");
    assert.deepEqual(placeRoom.events[0]?.payload, {
      reportId: payload.data.report.id,
      placeId: "busan-gwangalli",
      regionId: "busan",
      areaId: "busan-suyeong",
    });
    assert.equal(JSON.stringify(placeRoom.events[0]).includes(anonymousId), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("source ingestion targets reject embedded provider secrets", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    await assert.rejects(
      db.prepare(`
        INSERT INTO source_ingestion_targets (
          id, source_id, place_id, adapter_config_json,
          refresh_interval_seconds, next_run_at
        ) VALUES (?, 'source-kma-weather', 'busan-gwangalli', ?, 3600, ?)
      `).bind(
        "scheduled-secret-rejected",
        JSON.stringify({ nx: 98, ny: 76, serviceKey: "must-not-be-stored" }),
        "2026-07-19T00:00:00.000Z",
      ).run(),
      /CHECK constraint failed/,
    );

    const count = await db.prepare("SELECT COUNT(*) AS count FROM source_ingestion_targets").first<{ count: number }>();
    assert.equal(count?.count, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scheduled ingestion skips an active lease and never calls an unapproved provider", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  const scheduledAt = new Date();
  let fetchCount = 0;

  try {
    await db.prepare(`
      INSERT INTO source_ingestion_targets (
        id, source_id, place_id, adapter_config_json, enabled,
        refresh_interval_seconds, next_run_at
      ) VALUES (?, 'source-kma-weather', 'busan-gwangalli', ?, 1, 3600, ?)
    `).bind(
      "scheduled-kma-unapproved",
      JSON.stringify({ nx: 98, ny: 76 }),
      new Date(scheduledAt.getTime() - 60_000).toISOString(),
    ).run();
    await db.prepare(`
      INSERT INTO source_ingestion_targets (
        id, source_id, place_id, adapter_config_json, enabled,
        refresh_interval_seconds, next_run_at, lease_token, lease_until
      ) VALUES (?, 'source-kma-weather', 'ulsan-taehwagang', ?, 1, 3600, ?, ?, ?)
    `).bind(
      "scheduled-kma-leased",
      JSON.stringify({ nx: 102, ny: 83 }),
      new Date(scheduledAt.getTime() - 60_000).toISOString(),
      "existing-lease-token",
      new Date(scheduledAt.getTime() + 5 * 60_000).toISOString(),
    ).run();
    globalThis.fetch = async (): Promise<Response> => {
      fetchCount += 1;
      return Response.json({ unexpected: true });
    };

    const summary = await worker.runScheduledSourceIngestion(
      { DB: db, KMA_SERVICE_KEY: "must-not-be-used" },
      scheduledAt,
    );
    const failed = await db.prepare(`
      SELECT consecutive_failures AS consecutiveFailures, last_error_code AS lastErrorCode,
             lease_token AS leaseToken, lease_until AS leaseUntil, next_run_at AS nextRunAt
      FROM source_ingestion_targets
      WHERE id = 'scheduled-kma-unapproved'
    `).first<{
      consecutiveFailures: number;
      lastErrorCode: string;
      leaseToken: string | null;
      leaseUntil: string | null;
      nextRunAt: string;
    }>();
    const leased = await db.prepare(`
      SELECT lease_token AS leaseToken, lease_until AS leaseUntil
      FROM source_ingestion_targets
      WHERE id = 'scheduled-kma-leased'
    `).first<{ leaseToken: string; leaseUntil: string }>();

    assert.equal(summary.examinedCount, 1);
    assert.equal(summary.claimedCount, 1);
    assert.equal(summary.succeededCount, 0);
    assert.equal(summary.failedCount, 1);
    assert.deepEqual(summary.errorCodes, { SOURCE_NOT_ACTIVE: 1 });
    assert.equal(fetchCount, 0);
    assert.equal(failed?.consecutiveFailures, 1);
    assert.equal(failed?.lastErrorCode, "SOURCE_NOT_ACTIVE");
    assert.equal(failed?.leaseToken, null);
    assert.equal(failed?.leaseUntil, null);
    assert.ok(Date.parse(failed?.nextRunAt ?? "") > scheduledAt.getTime());
    assert.equal(leased?.leaseToken, "existing-lease-token");
    assert.ok(Date.parse(leased?.leaseUntil ?? "") > scheduledAt.getTime());
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scheduled ingestion isolates a credential failure and refreshes another due target", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  const scheduledAt = new Date();
  const expectedBase = worker.resolveScheduledKmaBaseTime(scheduledAt);
  const serviceKey = "scheduled-kma-fixture-key";
  let fetchCount = 0;

  try {
    await db.prepare(`
      UPDATE data_sources
      SET enabled = 1, health_status = 'healthy', default_ttl_seconds = 7200
      WHERE source_key = 'kma_weather'
    `).run();
    await db.prepare(`
      UPDATE data_sources
      SET commercial_use_status = 'allowed_with_attribution', enabled = 1,
          health_status = 'healthy', default_ttl_seconds = 600
      WHERE source_key = 'national_traffic'
    `).run();
    await db.prepare(`
      INSERT INTO source_ingestion_targets (
        id, source_id, place_id, adapter_config_json, enabled,
        refresh_interval_seconds, next_run_at
      ) VALUES (?, 'source-national-traffic', 'busan-gwangalli', ?, 1, 600, ?)
    `).bind(
      "a-scheduled-traffic-missing-credential",
      JSON.stringify({
        linkId: "2600012400",
        roadType: "all",
        minLng: 129.1,
        maxLng: 129.14,
        minLat: 35.14,
        maxLat: 35.17,
      }),
      new Date(scheduledAt.getTime() - 60_000).toISOString(),
    ).run();
    await db.prepare(`
      INSERT INTO source_ingestion_targets (
        id, source_id, place_id, adapter_config_json, enabled,
        refresh_interval_seconds, next_run_at
      ) VALUES (?, 'source-kma-weather', 'busan-gwangalli', ?, 1, 300, ?)
    `).bind(
      "b-scheduled-kma-success",
      JSON.stringify({ nx: 98, ny: 76, baseDate: "19990101", baseTime: "0000" }),
      new Date(scheduledAt.getTime() - 60_000).toISOString(),
    ).run();
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      fetchCount += 1;
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("ServiceKey"), serviceKey);
      assert.equal(url.searchParams.get("base_date"), expectedBase.baseDate);
      assert.equal(url.searchParams.get("base_time"), expectedBase.baseTime);
      assert.notEqual(url.searchParams.get("base_date"), "19990101", "stored baseDate must be ignored");
      return Response.json({
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
          body: {
            totalCount: 4,
            items: {
              item: [
                { ...expectedBase, category: "T1H", nx: 98, ny: 76, obsrValue: "24.1" },
                { ...expectedBase, category: "RN1", nx: 98, ny: 76, obsrValue: "0" },
                { ...expectedBase, category: "WSD", nx: 98, ny: 76, obsrValue: "1.8" },
                { ...expectedBase, category: "PTY", nx: 98, ny: 76, obsrValue: "0" },
              ],
            },
          },
        },
      });
    };

    const summary = await worker.runScheduledSourceIngestion(
      { DB: db, KMA_SERVICE_KEY: serviceKey },
      scheduledAt,
    );
    const trafficTarget = await db.prepare(`
      SELECT consecutive_failures AS consecutiveFailures, last_error_code AS lastErrorCode,
             lease_token AS leaseToken, next_run_at AS nextRunAt
      FROM source_ingestion_targets
      WHERE id = 'a-scheduled-traffic-missing-credential'
    `).first<{
      consecutiveFailures: number;
      lastErrorCode: string;
      leaseToken: string | null;
      nextRunAt: string;
    }>();
    const kmaTarget = await db.prepare(`
      SELECT consecutive_failures AS consecutiveFailures, last_error_code AS lastErrorCode,
             lease_token AS leaseToken, last_succeeded_at AS lastSucceededAt, next_run_at AS nextRunAt
      FROM source_ingestion_targets
      WHERE id = 'b-scheduled-kma-success'
    `).first<{
      consecutiveFailures: number;
      lastErrorCode: string | null;
      leaseToken: string | null;
      lastSucceededAt: string;
      nextRunAt: string;
    }>();
    const signalCount = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM live_signals
      WHERE source_id = 'source-kma-weather' AND place_id = 'busan-gwangalli'
    `).first<{ count: number }>();

    assert.equal(summary.examinedCount, 2);
    assert.equal(summary.claimedCount, 2);
    assert.equal(summary.succeededCount, 1);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.skippedCount, 0);
    assert.deepEqual(summary.errorCodes, { SOURCE_CREDENTIAL_REQUIRED: 1 });
    assert.equal(fetchCount, 1);
    assert.equal(trafficTarget?.consecutiveFailures, 1);
    assert.equal(trafficTarget?.lastErrorCode, "SOURCE_CREDENTIAL_REQUIRED");
    assert.equal(trafficTarget?.leaseToken, null);
    assert.ok(Date.parse(trafficTarget?.nextRunAt ?? "") > scheduledAt.getTime());
    assert.equal(kmaTarget?.consecutiveFailures, 0);
    assert.equal(kmaTarget?.lastErrorCode, null);
    assert.equal(kmaTarget?.leaseToken, null);
    assert.equal(kmaTarget?.lastSucceededAt, scheduledAt.toISOString());
    assert.equal(
      Date.parse(kmaTarget?.nextRunAt ?? "") - scheduledAt.getTime(),
      3_600_000,
      "source refresh interval must prevent a target from over-polling KMA",
    );
    assert.equal(signalCount?.count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scheduled ingestion cannot overwrite a newer target lease", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  const scheduledAt = new Date();
  const expectedBase = worker.resolveScheduledKmaBaseTime(scheduledAt);

  try {
    await db.prepare(`
      UPDATE data_sources
      SET enabled = 1, health_status = 'healthy', default_ttl_seconds = 7200
      WHERE source_key = 'kma_weather'
    `).run();
    await db.prepare(`
      INSERT INTO source_ingestion_targets (
        id, source_id, place_id, adapter_config_json, enabled,
        refresh_interval_seconds, next_run_at
      ) VALUES (?, 'source-kma-weather', 'busan-gwangalli', ?, 1, 3600, ?)
    `).bind(
      "scheduled-kma-lease-fencing",
      JSON.stringify({ nx: 98, ny: 76 }),
      new Date(scheduledAt.getTime() - 60_000).toISOString(),
    ).run();

    globalThis.fetch = async (): Promise<Response> => {
      await db.prepare(`
        UPDATE source_ingestion_targets
        SET lease_token = 'newer-lease-token', lease_until = ?, updated_at = ?
        WHERE id = 'scheduled-kma-lease-fencing'
      `).bind(
        new Date(scheduledAt.getTime() + 10 * 60_000).toISOString(),
        new Date(scheduledAt.getTime() + 1_000).toISOString(),
      ).run();
      return Response.json({
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
          body: {
            totalCount: 4,
            items: {
              item: [
                { ...expectedBase, category: "T1H", nx: 98, ny: 76, obsrValue: "24.1" },
                { ...expectedBase, category: "RN1", nx: 98, ny: 76, obsrValue: "0" },
                { ...expectedBase, category: "WSD", nx: 98, ny: 76, obsrValue: "1.8" },
                { ...expectedBase, category: "PTY", nx: 98, ny: 76, obsrValue: "0" },
              ],
            },
          },
        },
      });
    };

    await assert.rejects(
      worker.runScheduledSourceIngestion(
        { DB: db, KMA_SERVICE_KEY: "scheduled-kma-fencing-key" },
        scheduledAt,
      ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "SOURCE_SCHEDULER_LEASE_LOST");
        return true;
      },
    );

    const target = await db.prepare(`
      SELECT lease_token AS leaseToken, last_succeeded_at AS lastSucceededAt,
             last_failed_at AS lastFailedAt, consecutive_failures AS consecutiveFailures
      FROM source_ingestion_targets
      WHERE id = 'scheduled-kma-lease-fencing'
    `).first<{
      leaseToken: string;
      lastSucceededAt: string | null;
      lastFailedAt: string | null;
      consecutiveFailures: number;
    }>();
    assert.equal(target?.leaseToken, "newer-lease-token");
    assert.equal(target?.lastSucceededAt, null);
    assert.equal(target?.lastFailedAt, null);
    assert.equal(target?.consecutiveFailures, 0);
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
      const providerUrl = new URL(String(input));
      assert.equal(providerUrl.pathname.endsWith("/locationBasedList2"), true);
      assert.equal(providerUrl.searchParams.get("mapX"), "129.1186");
      assert.equal(providerUrl.searchParams.get("mapY"), "35.1532");
      assert.equal(providerUrl.searchParams.get("radius"), "5000");
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
          searchMode: "location",
          radiusM: 5_000,
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

    const statusResponse = await worker.handleRequest(
      new Request("https://api.test/api/places/busan-gwangalli/status"),
      { DB: db, ENVIRONMENT: "staging" },
    );
    const statusPayload = (await statusResponse.json()) as SuccessPayload<{
      officialTourismPlace: {
        contentId: string;
        name: string;
        sourceName: string;
        attributionText: string;
        verifiedAt: string;
      } | null;
    }>;
    assert.equal(statusResponse.status, 200);
    assert.equal(statusPayload.data.officialTourismPlace?.contentId, "126508");
    assert.equal(statusPayload.data.officialTourismPlace?.name, "광안리해수욕장");
    assert.equal(statusPayload.data.officialTourismPlace?.sourceName, "한국관광공사 TourAPI");
    assert.equal(statusPayload.data.officialTourismPlace?.attributionText, "한국관광공사");
    assert.ok(statusPayload.data.officialTourismPlace?.verifiedAt);
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

test("production browser mutations require an exact configured API origin", async () => {
  const allowedOrigin = "https://silsigan.pages.dev";
  const productionEnv = {
    ENVIRONMENT: "production",
    SILSIGAN_API_ALLOWED_ORIGINS: allowedOrigin,
  };

  const allowedPreflight = await worker.handleRequest(
    new Request("https://api.test/api/reports", {
      method: "OPTIONS",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "POST",
      },
    }),
    productionEnv,
  );
  assert.equal(allowedPreflight.status, 204);
  assert.equal(allowedPreflight.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(allowedPreflight.headers.get("vary"), "Origin");

  const disallowed = await worker.handleRequest(
    new Request("https://api.test/api/reports", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    }),
    productionEnv,
  );
  const disallowedPayload = (await disallowed.json()) as FailurePayload;
  assert.equal(disallowed.status, 403);
  assert.equal(disallowedPayload.error.code, "ORIGIN_NOT_ALLOWED");

  const missingPolicy = await worker.handleRequest(
    new Request("https://api.test/api/reports", {
      method: "OPTIONS",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "POST",
      },
    }),
    { ENVIRONMENT: "production" },
  );
  const missingPolicyPayload = (await missingPolicy.json()) as FailurePayload;
  assert.equal(missingPolicy.status, 503);
  assert.equal(missingPolicyPayload.error.code, "ORIGIN_POLICY_REQUIRED");

  const developmentRequest = await worker.handleRequest(
    new Request("https://api.test/api/reports", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: "{}",
    }),
  );
  const developmentPayload = (await developmentRequest.json()) as FailurePayload;
  assert.notEqual(developmentPayload.error.code, "ORIGIN_NOT_ALLOWED");
});

test("staging public API fails closed when the global Cloudflare rate limiter is required but unavailable", async () => {
  const response = await worker.handleRequest(
    new Request("https://api.test/api/places", {
      headers: { "cf-connecting-ip": "203.0.113.170" },
    }),
    {
      ENVIRONMENT: "staging",
      SILSIGAN_PUBLIC_RATE_LIMIT_REQUIRED: "1",
    },
  );
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, "PUBLIC_API_RATE_LIMITER_UNAVAILABLE");
});

test("global Cloudflare rate limiter blocks public API traffic before D1 and hashes the client IP", async () => {
  const clientIp = "203.0.113.171";
  const limiter = new FakeRateLimitBinding(false);
  const response = await worker.handleRequest(
    new Request("https://api.test/api/places", {
      headers: { "cf-connecting-ip": clientIp },
    }),
    {
      ENVIRONMENT: "staging",
      SILSIGAN_PUBLIC_RATE_LIMIT_REQUIRED: "1",
      PUBLIC_API_RATE_LIMITER: limiter,
    },
  );
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 429);
  assert.equal(payload.error.code, "PUBLIC_API_RATE_LIMITED");
  assert.equal(limiter.calls.length, 1);
  assert.equal(limiter.calls[0]?.includes(clientIp), false);
});

test("global Cloudflare rate limiter also protects CORS preflight traffic", async () => {
  const limiter = new FakeRateLimitBinding(false);
  const response = await worker.handleRequest(
    new Request("https://api.test/api/comments", {
      method: "OPTIONS",
      headers: {
        origin: "https://staging.example.com",
        "cf-connecting-ip": "203.0.113.172",
      },
    }),
    {
      ENVIRONMENT: "staging",
      SILSIGAN_API_ALLOWED_ORIGINS: "https://staging.example.com",
      SILSIGAN_PUBLIC_RATE_LIMIT_REQUIRED: "1",
      PUBLIC_API_RATE_LIMITER: limiter,
    },
  );
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 429);
  assert.equal(payload.error.code, "PUBLIC_API_RATE_LIMITED");
  assert.equal(limiter.calls.length, 1);
});

test("health checks use the public edge limiter and global Workers request ledger", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const limiter = new FakeRateLimitBinding();

  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/health", {
        headers: { "cf-connecting-ip": "203.0.113.173" },
      }),
      {
        DB: db,
        ENVIRONMENT: "staging",
        SILSIGAN_PUBLIC_RATE_LIMIT_REQUIRED: "1",
        SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
        PUBLIC_API_RATE_LIMITER: limiter,
      },
    );
    const daily = await db
      .prepare(
        `SELECT reserved_workers_requests AS reservedWorkersRequests,
                reserved_rows_read AS reservedRowsRead,
                reserved_rows_written AS reservedRowsWritten
         FROM api_cost_guard_daily`,
      )
      .first<{ reservedWorkersRequests: number; reservedRowsRead: number; reservedRowsWritten: number }>();

    assert.equal(response.status, 200);
    assert.equal(limiter.calls.length, 1);
    assert.deepEqual(daily, {
      reservedWorkersRequests: 1,
      reservedRowsRead: 100,
      reservedRowsWritten: 2,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("high-cost reads reserve a calibrated D1 ceiling before the query", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/rankings?limit=1"),
      {
        DB: db,
        SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
        HIGH_COST_API_RATE_LIMITER: new FakeRateLimitBinding(),
      },
    );
    const daily = await db
      .prepare(
        `SELECT reserved_rows_read AS reservedRowsRead,
                reserved_rows_written AS reservedRowsWritten,
                high_cost_requests AS highCostRequests
         FROM api_cost_guard_daily`,
      )
      .first<{ reservedRowsRead: number; reservedRowsWritten: number; highCostRequests: number }>();

    assert.equal(response.status, 200);
    assert.deepEqual(daily, {
      reservedRowsRead: 500,
      reservedRowsWritten: 2,
      highCostRequests: 1,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging anonymous session issuance fails closed without its dedicated edge limiter", async () => {
  const response = await worker.handleRequest(
    new Request("https://api.test/api/session/anonymous", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.201" },
    }),
    { ENVIRONMENT: "staging" },
  );
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, "ANONYMOUS_SESSION_RATE_LIMITER_UNAVAILABLE");
});

test("anonymous session edge limiter blocks issuance before D1 and hashes the client IP", async () => {
  const clientIp = "203.0.113.202";
  const limiter = new FakeRateLimitBinding(false);
  const response = await worker.handleRequest(
    new Request("https://api.test/api/session/anonymous", {
      method: "POST",
      headers: { "cf-connecting-ip": clientIp },
    }),
    {
      ENVIRONMENT: "staging",
      ANONYMOUS_SESSION_RATE_LIMITER: limiter,
    },
  );
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 429);
  assert.equal(payload.error.code, "ANONYMOUS_SESSION_RATE_LIMITED");
  assert.equal(limiter.calls.length, 1);
  assert.equal(limiter.calls[0]?.includes(clientIp), false);
});

test("anonymous session daily D1 guard caps distributed issuance before session insert", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const env = {
    DB: db,
    SILSIGAN_ANON_SESSION_REQUIRED: "1",
    SILSIGAN_ANON_SESSION_DAILY_LIMIT: "2",
  };

  try {
    const emergencyStopResponse = await worker.handleRequest(
      new Request("https://api.test/api/session/anonymous", { method: "POST" }),
      { ...env, SILSIGAN_ANON_SESSION_DAILY_LIMIT: "0" },
    );
    const emergencyStopPayload = (await emergencyStopResponse.json()) as FailurePayload;
    assert.equal(emergencyStopResponse.status, 429);
    assert.equal(emergencyStopPayload.error.code, "ANONYMOUS_SESSION_DAILY_LIMIT_EXHAUSTED");

    const responses = [];
    for (const clientIp of ["203.0.113.211", "198.51.100.212", "192.0.2.213"]) {
      responses.push(
        await worker.handleRequest(
          new Request("https://api.test/api/session/anonymous", {
            method: "POST",
            headers: { "cf-connecting-ip": clientIp },
          }),
          env,
        ),
      );
    }

    const blockedPayload = (await responses[2]?.json()) as FailurePayload;
    const sessions = await db.prepare("SELECT COUNT(*) AS count FROM anonymous_sessions").first<{ count: number }>();
    const budget = await db
      .prepare("SELECT issue_count AS issueCount FROM anonymous_session_issuance_budget")
      .first<{ issueCount: number }>();

    assert.deepEqual(responses.map((response) => response.status), [201, 201, 429]);
    assert.equal(blockedPayload.error.code, "ANONYMOUS_SESSION_DAILY_LIMIT_EXHAUSTED");
    assert.equal(sessions?.count, 2);
    assert.equal(budget?.issueCount, 2);

    const publicReadAfterExhaustion = await worker.handleRequest(
      new Request("https://api.test/api/places?limit=1"),
      env,
    );
    const publicReadPayload = (await publicReadAfterExhaustion.json()) as SuccessPayload<unknown[]>;
    assert.equal(publicReadAfterExhaustion.status, 200);
    assert.equal(publicReadPayload.success, true);
    assert.equal(Array.isArray(publicReadPayload.data), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("place addition requests require verified proof, normalize fields, replay idempotently, and remain owner-only", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const env = { DB: db, SILSIGAN_ANON_SESSION_REQUIRED: "1" };

  try {
    const session = await issueVerifiedAnonymousSession(db);
    const body = {
      clientRequestId: "place-request-client-0001",
      name: "  Ｃａｆｅ   온  ",
      address: " 부산광역시   수영구 광안해변로  ",
      category: "  카페  ",
    };
    const missingProof = await worker.handleRequest(
      new Request("https://api.test/api/place-requests", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": session.anonymousId },
        body: JSON.stringify(body),
      }),
      env,
    );
    assert.equal(missingProof.status, 401);

    const rejectedProviderFields = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, {
        ...body,
        clientRequestId: "place-request-client-provider-fields",
        mapx: "1290000000",
        mapy: "350000000",
        link: "https://map.naver.com/fixture",
        query: "fixture query",
        userAgent: "fixture UA",
      }),
      env,
    );
    const rejectedProviderPayload = (await rejectedProviderFields.json()) as FailurePayload;
    assert.equal(rejectedProviderFields.status, 400);
    assert.equal(rejectedProviderPayload.error.code, "UNSUPPORTED_FIELD");

    const createdResponse = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, body),
      env,
    );
    const created = (await createdResponse.json()) as SuccessPayload<{
      id: string;
      name: string;
      address: string;
      category: string;
      status: string;
    }>;
    assert.equal(createdResponse.status, 201);
    assert.equal(created.data.name, "Cafe 온");
    assert.equal(created.data.address, "부산광역시 수영구 광안해변로");
    assert.equal(created.data.category, "카페");
    assert.equal(created.data.status, "needs_verification");
    await db
      .prepare("UPDATE anonymous_users SET last_seen_at = ? WHERE id = (SELECT anonymous_user_id FROM place_addition_requests WHERE id = ?)")
      .bind("2000-01-01T00:00:00.000Z", created.data.id)
      .run();

    const replayResponse = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, {
        ...body,
        name: "Cafe 온",
        address: "부산광역시 수영구 광안해변로",
        category: "카페",
      }),
      env,
    );
    const replay = (await replayResponse.json()) as SuccessPayload<{ id: string }>;
    assert.equal(replayResponse.status, 200);
    assert.equal(replay.data.id, created.data.id);
    assert.equal(replay.meta?.idempotentReplay, true);
    const replayOwner = await db
      .prepare(
        "SELECT last_seen_at AS lastSeenAt FROM anonymous_users WHERE id = (SELECT anonymous_user_id FROM place_addition_requests WHERE id = ?)",
      )
      .bind(created.data.id)
      .first<{ lastSeenAt: string }>();
    assert.equal(replayOwner?.lastSeenAt, "2000-01-01T00:00:00.000Z");

    const reusedKey = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, { ...body, name: "다른 장소" }),
      env,
    );
    const reusedKeyPayload = (await reusedKey.json()) as FailurePayload;
    assert.equal(reusedKey.status, 409);
    assert.equal(reusedKeyPayload.error.code, "IDEMPOTENCY_KEY_REUSED");

    const mineResponse = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests?mine=1", "GET", session),
      env,
    );
    const mine = (await mineResponse.json()) as SuccessPayload<Array<{ id: string }>>;
    assert.equal(mineResponse.status, 200);
    assert.deepEqual(mine.data.map((item) => item.id), [created.data.id]);

    const otherSession = await issueVerifiedAnonymousSession(db);
    const otherMineResponse = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests?mine=1", "GET", otherSession),
      env,
    );
    const otherMine = (await otherMineResponse.json()) as SuccessPayload<Array<{ id: string }>>;
    assert.deepEqual(otherMine.data, []);

    const budget = await db
      .prepare("SELECT request_count AS requestCount FROM place_addition_request_daily_budget")
      .first<{ requestCount: number }>();
    assert.equal(budget?.requestCount, 1);
    const columns = await db.prepare("SELECT name FROM pragma_table_info('place_addition_requests')").all<{ name: string }>();
    assert.equal(
      (columns.results ?? []).some((column) => /mapx|mapy|link|query|ip|user.?agent/i.test(column.name)),
      false,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("place addition request D1 guards enforce per-session and exact global 80 percent stops", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const env = { DB: db, SILSIGAN_ANON_SESSION_REQUIRED: "1" };

  try {
    const session = await issueVerifiedAnonymousSession(db);
    for (let index = 0; index < 3; index += 1) {
      const response = await worker.handleRequest(
        anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, {
          clientRequestId: `place-session-limit-${index}`,
          name: `테스트 장소 ${index}`,
          address: `서울시 테스트로 ${index}`,
          category: "카페",
        }),
        env,
      );
      assert.equal(response.status, 201);
    }
    await db.prepare("UPDATE anonymous_users SET last_seen_at = '2000-01-01T00:00:00.000Z'").run();
    const sessionBlocked = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, {
        clientRequestId: "place-session-limit-3",
        name: "네 번째 장소",
        address: "서울시 테스트로 4",
        category: "카페",
      }),
      env,
    );
    const sessionBlockedPayload = (await sessionBlocked.json()) as FailurePayload;
    assert.equal(sessionBlocked.status, 429);
    assert.equal(sessionBlockedPayload.error.code, "PLACE_REQUEST_SESSION_DAILY_LIMIT");
    const blockedOwner = await db
      .prepare("SELECT last_seen_at AS lastSeenAt FROM anonymous_users LIMIT 1")
      .first<{ lastSeenAt: string }>();
    assert.equal(blockedOwner?.lastSeenAt, "2000-01-01T00:00:00.000Z");

    await db.prepare("DELETE FROM place_addition_requests").run();
    await db.prepare("UPDATE place_addition_request_daily_budget SET request_count = 1599").run();
    const firstGlobalSession = await issueVerifiedAnonymousSession(db);
    const reachesStop = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", firstGlobalSession, {
        clientRequestId: "place-global-budget-1599",
        name: "안전 한도 마지막 장소",
        address: "부산시 테스트로 1",
        category: "공원",
      }),
      env,
    );
    assert.equal(reachesStop.status, 201);
    const ownersBeforeGlobalBlock = await db.prepare("SELECT COUNT(*) AS count FROM anonymous_users").first<{ count: number }>();

    const secondGlobalSession = await issueVerifiedAnonymousSession(db);
    const globalBlocked = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", secondGlobalSession, {
        clientRequestId: "place-global-budget-1600",
        name: "차단되어야 하는 장소",
        address: "부산시 테스트로 2",
        category: "공원",
      }),
      env,
    );
    const globalBlockedPayload = (await globalBlocked.json()) as FailurePayload;
    const budget = await db
      .prepare("SELECT request_count AS requestCount FROM place_addition_request_daily_budget")
      .first<{ requestCount: number }>();
    const stored = await db.prepare("SELECT COUNT(*) AS count FROM place_addition_requests").first<{ count: number }>();
    const ownersAfterGlobalBlock = await db.prepare("SELECT COUNT(*) AS count FROM anonymous_users").first<{ count: number }>();
    assert.equal(globalBlocked.status, 429);
    assert.equal(globalBlockedPayload.error.code, "PLACE_REQUEST_DAILY_BUDGET_80_PERCENT_STOP");
    assert.equal(budget?.requestCount, 1600);
    assert.equal(stored?.count, 1);
    assert.equal(ownersAfterGlobalBlock?.count, ownersBeforeGlobalBlock?.count);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("place addition replay and blocked attempts reserve only low global guard cost", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const env = {
    DB: db,
    SILSIGAN_ANON_SESSION_REQUIRED: "1",
    SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
    SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT: "100000",
    SILSIGAN_D1_DAILY_READ_LIMIT: "10000",
    SILSIGAN_D1_DAILY_WRITE_LIMIT: "100000",
  };

  const readGuardUsage = () => db
    .prepare(
      `SELECT reserved_rows_read AS reservedRowsRead,
              reserved_rows_written AS reservedRowsWritten,
              mutation_requests AS mutationRequests
       FROM api_cost_guard_daily
       WHERE day_utc = strftime('%Y-%m-%d', 'now')`,
    )
    .first<{ reservedRowsRead: number; reservedRowsWritten: number; mutationRequests: number }>();

  try {
    const session = await issueVerifiedAnonymousSession(db);
    const baseBody = {
      clientRequestId: "place-guard-amplification-0001",
      name: "비용 보호 재시도 장소",
      address: "서울특별시 테스트로 101",
      category: "카페",
    };
    const created = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, baseBody),
      env,
    );
    assert.equal(created.status, 201);
    const afterCreate = await readGuardUsage();
    assert.ok(afterCreate);
    assert.equal(afterCreate.mutationRequests, 1);

    for (let index = 0; index < 3; index += 1) {
      const replay = await worker.handleRequest(
        anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, baseBody),
        env,
      );
      assert.equal(replay.status, 200);
      const replayPayload = (await replay.json()) as SuccessPayload<{ id: string }>;
      assert.equal(replayPayload.meta?.idempotentReplay, true);
    }

    const afterReplay = await readGuardUsage();
    const controlAfterReplay = await db
      .prepare("SELECT mode FROM api_cost_guard_control WHERE id = 1")
      .first<{ mode: string }>();
    assert.ok(afterReplay);
    assert.equal(controlAfterReplay?.mode, "running");
    assert.equal(afterReplay.mutationRequests, afterCreate.mutationRequests);
    assert.ok(afterReplay.reservedRowsRead - afterCreate.reservedRowsRead <= 30);
    assert.ok(afterReplay.reservedRowsWritten - afterCreate.reservedRowsWritten <= 6);

    for (let index = 2; index <= 3; index += 1) {
      const accepted = await worker.handleRequest(
        anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, {
          ...baseBody,
          clientRequestId: `place-guard-amplification-000${index}`,
          name: `비용 보호 신규 장소 ${index}`,
          address: `서울특별시 테스트로 ${100 + index}`,
        }),
        env,
      );
      assert.equal(accepted.status, 201);
    }

    const beforeBlocked = await readGuardUsage();
    assert.ok(beforeBlocked);
    assert.equal(beforeBlocked.mutationRequests, 3);
    const blocked = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, {
        ...baseBody,
        clientRequestId: "place-guard-amplification-0004",
        name: "비용 보호 한도 초과 장소",
        address: "서울특별시 테스트로 104",
      }),
      env,
    );
    const blockedPayload = (await blocked.json()) as FailurePayload;
    const afterBlocked = await readGuardUsage();
    const controlAfterBlocked = await db
      .prepare("SELECT mode FROM api_cost_guard_control WHERE id = 1")
      .first<{ mode: string }>();

    assert.equal(blocked.status, 429);
    assert.equal(blockedPayload.error.code, "PLACE_REQUEST_SESSION_DAILY_LIMIT");
    assert.ok(afterBlocked);
    assert.equal(controlAfterBlocked?.mode, "running");
    assert.equal(afterBlocked.mutationRequests, beforeBlocked.mutationRequests);
    assert.ok(afterBlocked.reservedRowsRead - beforeBlocked.reservedRowsRead <= 10);
    assert.ok(afterBlocked.reservedRowsWritten - beforeBlocked.reservedRowsWritten <= 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("admin place request review is anonymous-header-free, audited, duplicate-safe, and never imports places", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const env = { DB: db, SILSIGAN_ANON_SESSION_REQUIRED: "1", ADMIN_TOKENS: testAdminTokens };

  try {
    const session = await issueVerifiedAnonymousSession(db);
    const createdResponse = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, {
        clientRequestId: "place-admin-review-0001",
        name: "광안리 새 장소",
        address: "부산광역시 수영구 테스트로 1",
        category: "카페",
      }),
      env,
    );
    const created = (await createdResponse.json()) as SuccessPayload<{ id: string }>;
    const placesBefore = await db.prepare("SELECT * FROM places ORDER BY id").all<Record<string, unknown>>();

    const queueResponse = await worker.handleRequest(
      new Request("https://api.test/api/admin/place-requests", {
        headers: { "x-silsigan-admin-token": "test-moderator-token" },
      }),
      env,
    );
    const queue = (await queueResponse.json()) as SuccessPayload<Array<{ id: string }>>;
    assert.equal(queueResponse.status, 200);
    assert.equal(queueResponse.headers.has("x-silsigan-anon-id"), false);
    assert.deepEqual(queue.data.map((item) => item.id), [created.data.id]);

    const missingMatch = await worker.handleRequest(
      new Request(`https://api.test/api/admin/place-requests/${created.data.id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-admin-token": "test-moderator-token" },
        body: JSON.stringify({ status: "duplicate", reason: "기존 장소와 중복입니다." }),
      }),
      env,
    );
    assert.equal(missingMatch.status, 400);

    const unverifiedMatch = await worker.handleRequest(
      new Request(`https://api.test/api/admin/place-requests/${created.data.id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-admin-token": "test-moderator-token" },
        body: JSON.stringify({ status: "duplicate", reason: "좌표 검증 전 장소입니다.", matchedPlaceId: "jeju-coordinate-review" }),
      }),
      env,
    );
    assert.equal(unverifiedMatch.status, 400);

    const reviewedResponse = await worker.handleRequest(
      new Request(`https://api.test/api/admin/place-requests/${created.data.id}/action`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-moderator-token",
          "x-silsigan-admin-subject": "reviewer@example.test",
        },
        body: JSON.stringify({ status: "duplicate", reason: "검증된 기존 장소와 중복입니다.", matchedPlaceId: "busan-gwangalli" }),
      }),
      env,
    );
    const reviewed = (await reviewedResponse.json()) as SuccessPayload<{ status: string; matchedPlaceId: string }>;
    assert.equal(reviewedResponse.status, 200);
    assert.equal(reviewed.data.status, "duplicate");
    assert.equal(reviewed.data.matchedPlaceId, "busan-gwangalli");
    const audit = await db
      .prepare("SELECT admin_subject AS adminSubject, action_type AS actionType, target_type AS targetType, reason FROM admin_actions WHERE target_id = ?")
      .bind(created.data.id)
      .first<{ adminSubject: string; actionType: string; targetType: string; reason: string }>();
    assert.deepEqual(audit, {
      adminSubject: "reviewer@example.test",
      actionType: "place_request_duplicate",
      targetType: "place_request",
      reason: "검증된 기존 장소와 중복입니다.",
    });
    const placesAfter = await db.prepare("SELECT * FROM places ORDER BY id").all<Record<string, unknown>>();
    assert.deepEqual(placesAfter.results, placesBefore.results);

    const reviewedMineResponse = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests?mine=1", "GET", session),
      env,
    );
    const reviewedMine = (await reviewedMineResponse.json()) as SuccessPayload<Array<Record<string, unknown>>>;
    assert.equal(reviewedMineResponse.status, 200);
    assert.equal(reviewedMine.data[0]?.status, "duplicate");
    assert.equal(reviewedMine.data[0]?.matchedPlaceId, "busan-gwangalli");
    assert.equal(Object.hasOwn(reviewedMine.data[0] ?? {}, "reviewReason"), false);

    const auditBeforeTerminalRetry = await db
      .prepare("SELECT COUNT(*) AS count FROM admin_actions WHERE target_id = ?")
      .bind(created.data.id)
      .first<{ count: number }>();
    const terminalRetry = await worker.handleRequest(
      new Request(`https://api.test/api/admin/place-requests/${created.data.id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-admin-token": "test-moderator-token" },
        body: JSON.stringify({ status: "rejected", reason: "이미 완료된 중복 판정을 변경합니다." }),
      }),
      env,
    );
    const terminalRetryPayload = (await terminalRetry.json()) as FailurePayload;
    const auditAfterTerminalRetry = await db
      .prepare("SELECT COUNT(*) AS count FROM admin_actions WHERE target_id = ?")
      .bind(created.data.id)
      .first<{ count: number }>();
    assert.equal(terminalRetry.status, 409);
    assert.equal(terminalRetryPayload.error.code, "PLACE_REQUEST_TERMINAL_STATUS");
    assert.equal(auditAfterTerminalRetry?.count, auditBeforeTerminalRetry?.count);

    const deletionResponse = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/account/deletion", "POST", session, { confirmation: "DELETE_MY_ACCOUNT" }),
      env,
    );
    assert.equal(deletionResponse.status, 200);
    const remainingRequests = await db
      .prepare("SELECT COUNT(*) AS count FROM place_addition_requests WHERE id = ?")
      .bind(created.data.id)
      .first<{ count: number }>();
    assert.equal(remainingRequests?.count, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("concurrent place request review rejects a stale decision without writing a false audit", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const baseEnv = { DB: db, SILSIGAN_ANON_SESSION_REQUIRED: "1", ADMIN_TOKENS: testAdminTokens };

  try {
    const session = await issueVerifiedAnonymousSession(db);
    const createdResponse = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/place-requests", "POST", session, {
        clientRequestId: "place-admin-race-0001",
        name: "동시 검토 장소",
        address: "서울특별시 테스트로 10",
        category: "공원",
      }),
      baseEnv,
    );
    const created = (await createdResponse.json()) as SuccessPayload<{ id: string }>;
    let injectedConcurrentReview = false;
    const racingDb = {
      prepare: (query: string) => db.prepare(query),
      batch: async (statements: worker.D1PreparedStatement[]) => {
        if (!injectedConcurrentReview) {
          injectedConcurrentReview = true;
          const concurrentAt = "2026-07-20T00:00:00.000Z";
          await db
            .prepare(
              `UPDATE place_addition_requests
               SET status = 'rejected', review_reason = ?, reviewed_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .bind("다른 운영자가 먼저 거절했습니다.", concurrentAt, concurrentAt, created.data.id)
            .run();
        }
        return db.batch(statements);
      },
    };

    const response = await worker.handleRequest(
      new Request(`https://api.test/api/admin/place-requests/${created.data.id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-admin-token": "test-moderator-token" },
        body: JSON.stringify({ status: "ready_for_manual_import", reason: "주소 검증을 완료했습니다." }),
      }),
      { ...baseEnv, DB: racingDb },
    );
    const payload = (await response.json()) as FailurePayload;
    const stored = await db
      .prepare("SELECT status, review_reason AS reviewReason FROM place_addition_requests WHERE id = ?")
      .bind(created.data.id)
      .first<{ status: string; reviewReason: string }>();
    const audit = await db
      .prepare("SELECT COUNT(*) AS count FROM admin_actions WHERE target_id = ?")
      .bind(created.data.id)
      .first<{ count: number }>();

    assert.equal(response.status, 409);
    assert.equal(payload.error.code, "PLACE_REQUEST_REVIEW_CONFLICT");
    assert.deepEqual(stored, { status: "rejected", reviewReason: "다른 운영자가 먼저 거절했습니다." });
    assert.equal(audit?.count, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("anonymous session issuance fails closed before insert when its exact cost ledger is unavailable", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    await db.prepare("DROP TABLE anonymous_session_issuance_budget").run();
    const response = await worker.handleRequest(
      new Request("https://api.test/api/session/anonymous", { method: "POST" }),
      { DB: db, SILSIGAN_ANON_SESSION_REQUIRED: "1" },
    );
    const payload = (await response.json()) as FailurePayload;
    const sessions = await db.prepare("SELECT COUNT(*) AS count FROM anonymous_sessions").first<{ count: number }>();

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "ANONYMOUS_SESSION_COST_GUARD_UNAVAILABLE");
    assert.equal(sessions?.count, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("JSON request reader rejects an oversized streamed body before field validation", async () => {
  const request = new Request("https://api.test/api/comments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-silsigan-anon-id": "anon_json_body_limit_test",
    },
    body: JSON.stringify({
      placeId: "busan-gwangalli",
      body: "a".repeat(70 * 1024),
    }),
  });
  assert.equal(request.headers.has("content-length"), false);

  const response = await worker.handleRequest(request);
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 413);
  assert.equal(payload.error.code, "JSON_BODY_TOO_LARGE");
});

test("JSON request reader returns a stable invalid-json error without leaking parser details", async () => {
  const response = await worker.handleRequest(
    new Request("https://api.test/api/comments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": "anon_invalid_json_test",
      },
      body: "{",
    }),
  );
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_JSON");
  assert.equal(JSON.stringify(payload).includes("SyntaxError"), false);
});

test("multipart photo reader rejects an oversized streamed request before form-data field validation", async () => {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(4 * 1024 * 1024)], { type: "image/jpeg" }), "oversized.jpg");
  const request = new Request("https://api.test/api/photos/upload", {
    method: "POST",
    headers: { "x-silsigan-anon-id": "anon_multipart_body_limit" },
    body: form,
  });
  assert.equal(request.headers.has("content-length"), false);

  const response = await worker.handleRequest(request);
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 413);
  assert.equal(payload.error.code, "PHOTO_REQUEST_SIZE_LIMIT");
});

test("Cloudflare Worker rejects direct access to disabled feature APIs", async () => {
  const requests: Array<{ method: "GET" | "POST"; url: string; body?: Record<string, unknown> }> = [
    { method: "GET", url: "https://api.test/api/posts?regionId=seoul" },
    { method: "POST", url: "https://api.test/api/posts", body: { placeId: "seoul-yeouido" } },
    { method: "GET", url: "https://api.test/api/questions?regionId=seoul" },
    {
      method: "POST",
      url: "https://api.test/api/questions",
      body: {
        placeId: "seoul-yeouido",
        questionType: "crowd",
        body: "지금 잔디밭 자리 여유 있나요?",
        availableCredits: 999,
      },
    },
    { method: "GET", url: "https://api.test/api/my-questions" },
    { method: "GET", url: "https://api.test/api/live-streams" },
    { method: "GET", url: "https://api.test/api/ads" },
  ];

  for (const request of requests) {
    const response = await worker.handleRequest(
      new Request(request.url, {
        method: request.method,
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": "anon_disabled_feature_test",
        },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      }),
    );
    const payload = (await response.json()) as FailurePayload;
    assert.equal(response.status, 404, request.url);
    assert.equal(payload.error.code, "FEATURE_DISABLED", request.url);
  }

  const hashtagsResponse = await worker.handleRequest(new Request("https://api.test/api/hashtags"));
  const hashtagsPayload = (await hashtagsResponse.json()) as SuccessPayload<Array<{ name: string }>>;
  assert.equal(hashtagsResponse.status, 200);
  assert.equal(Array.isArray(hashtagsPayload.data), true);
});

test("Worker feature gates honor region overrides at the API boundary", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    await enableD1FeatureFlags(db, ["SOCIAL_FEED_ENABLED"], "region", "busan");
    const busanPosts = await worker.handleRequest(new Request("https://api.test/api/posts?regionId=busan"), { DB: db });
    assert.equal(busanPosts.status, 200);

    const seoulPosts = await worker.handleRequest(new Request("https://api.test/api/posts?regionId=seoul"), { DB: db });
    const seoulFailure = (await seoulPosts.json()) as FailurePayload;
    assert.equal(seoulPosts.status, 404);
    assert.equal(seoulFailure.error.code, "FEATURE_DISABLED");

    await enableD1FeatureFlags(db, ["QNA_ENABLED", "REWARDS_ENABLED"], "region", "busan");
    const busanQuestions = await worker.handleRequest(new Request("https://api.test/api/questions?regionId=busan"), { DB: db });
    assert.equal(busanQuestions.status, 200);

    const questionResponse = await rawD1Post(db, "https://api.test/api/questions", "anon_region_question", {
      placeId: "busan-gwangalli",
      questionType: "crowd",
      body: "지금 사람이 많이 붐비나요?",
      availableCredits: 999,
    });
    const questionFailure = (await questionResponse.json()) as FailurePayload;
    assert.equal(questionResponse.status, 503);
    assert.equal(questionFailure.error.code, "CREDIT_LEDGER_REQUIRED");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
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

test("D1 migration chain and core seed are release-order idempotent", { skip: !sqlite3Available() }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-migrations-"));
  const dbPath = join(tempDir, "migrations.db");
  const idempotentMigrations = [
    "0001_initial.sql",
    "0002_posts_questions.sql",
    "0003_post_moderation_targets.sql",
    "0004_v2_foundation.sql",
    "0005_v2_signals.sql",
    "0006_trust_safety_identity.sql",
    "0007_enforce_live_signal_expiry.sql",
    "0008_persistent_preferences.sql",
    "0009_analytics_events.sql",
    "0010_photo_cleanup_jobs.sql",
    "0014_field_report_publications.sql",
    "0015_photo_storage_budget.sql",
    "0016_photo_abuse_protection.sql",
    "0017_photo_read_budget.sql",
    "0018_source_ingestion_scheduler.sql",
  ]
    .map((fileName) => readFileSync(new URL(`../workers/api/migrations/${fileName}`, import.meta.url), "utf8"))
    .join("\n");
  const locationAccuracyMigration = readFileSync(new URL("../workers/api/migrations/0011_location_accuracy_buckets.sql", import.meta.url), "utf8");
  const verificationMethodMigration = readFileSync(new URL("../workers/api/migrations/0012_field_verification_method.sql", import.meta.url), "utf8");
  const moderationMigration = readFileSync(new URL("../workers/api/migrations/0013_field_report_moderation.sql", import.meta.url), "utf8");
  const backgroundDeliveryMigration = readFileSync(new URL("../workers/api/migrations/0019_background_job_delivery.sql", import.meta.url), "utf8");
  const transformBudgetMigration = readFileSync(new URL("../workers/api/migrations/0020_photo_transform_budget.sql", import.meta.url), "utf8");
  const readAbuseBudgetMigration = readFileSync(new URL("../workers/api/migrations/0021_photo_read_abuse_budget.sql", import.meta.url), "utf8");
  const storageReleaseMigration = readFileSync(new URL("../workers/api/migrations/0022_photo_storage_release_ledger.sql", import.meta.url), "utf8");
  const anonymousSessionMigration = readFileSync(new URL("../workers/api/migrations/0023_anonymous_session_proofs.sql", import.meta.url), "utf8");
  const anonymousSessionBudgetMigration = readFileSync(new URL("../workers/api/migrations/0024_anonymous_session_cost_guard.sql", import.meta.url), "utf8");
  const placeAdditionRequestMigration = readFileSync(new URL("../workers/api/migrations/0025_place_addition_requests.sql", import.meta.url), "utf8");
  const globalApiCostGuardMigration = readFileSync(new URL("../workers/api/migrations/0026_global_api_cost_guard.sql", import.meta.url), "utf8");
  const seed = readFileSync(new URL("../workers/api/seeds/001_core_seed.sql", import.meta.url), "utf8");

  try {
    const output = execFileSync("sqlite3", [dbPath], {
      encoding: "utf8",
      input: `
        ${idempotentMigrations}
        ${idempotentMigrations}
        ${locationAccuracyMigration}
        ${verificationMethodMigration}
        ${moderationMigration}
        ${backgroundDeliveryMigration}
        ${transformBudgetMigration}
        ${readAbuseBudgetMigration}
        ${storageReleaseMigration}
        ${anonymousSessionMigration}
        ${anonymousSessionBudgetMigration}
        ${placeAdditionRequestMigration}
        ${globalApiCostGuardMigration}
        ${seed}
        ${seed}
        SELECT 'tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('regions', 'areas', 'places', 'place_rankings', 'posts', 'questions');
        SELECT 'post_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_posts_place_created', 'idx_posts_status_created');
        SELECT 'question_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_questions_place_created', 'idx_questions_anon_created');
        SELECT 'v2_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('profiles', 'identity_links', 'data_sources', 'place_source_mappings', 'dimension_settings', 'feature_flags', 'decision_profiles', 'decision_profile_dimensions', 'place_decision_profiles', 'live_signals', 'official_observations', 'aggregated_place_status');
        SELECT 'trust_safety_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_moderation_states', 'report_votes', 'user_blocks', 'consents', 'terms_acceptances', 'account_deletion_requests', 'identity_link_events');
        SELECT 'preference_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('saved_places', 'saved_posts', 'followed_topics', 'notification_subscriptions');
        SELECT 'analytics_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'analytics_events';
        SELECT 'photo_cleanup_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_cleanup_jobs';
        SELECT 'photo_cleanup_delivery_columns=' || COUNT(*) FROM pragma_table_info('photo_cleanup_jobs') WHERE name IN ('byte_size', 'lease_token', 'lease_expires_at', 'budget_released_at', 'dead_lettered_at', 'updated_at');
        SELECT 'photo_budget_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_storage_budget';
        SELECT 'photo_release_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_storage_releases';
        SELECT 'anonymous_session_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'anonymous_sessions';
        SELECT 'anonymous_session_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_anonymous_sessions_status_expiry';
        SELECT 'anonymous_session_budget_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'anonymous_session_issuance_budget';
        SELECT 'place_request_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('place_addition_requests', 'place_addition_request_daily_budget');
        SELECT 'place_request_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_place_addition_requests_owner_created', 'idx_place_addition_requests_queue');
        SELECT 'place_request_triggers=' || COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name = 'trg_place_addition_requests_daily_guard';
        SELECT 'api_cost_guard_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('api_cost_guard_control', 'api_cost_guard_daily', 'api_cost_guard_reconciliations');
        SELECT 'api_cost_guard_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_api_cost_guard_reconcile_day';
        SELECT 'api_cost_guard_control_rows=' || COUNT(*) FROM api_cost_guard_control WHERE id = 1 AND mode = 'running' AND generation = 1;
        SELECT 'api_cost_guard_warning_columns=' || COUNT(*) FROM pragma_table_info('api_cost_guard_daily') WHERE name IN ('warned_percent', 'warned_metric');
        SELECT 'photo_budget_rows=' || COUNT(*) FROM photo_storage_budget WHERE id = 1 AND active_bytes = 0 AND writes_in_period = 0;
        SELECT 'photo_abuse_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_upload_claims', 'photo_abuse_budget', 'photo_upload_control');
        SELECT 'photo_upload_control_rows=' || COUNT(*) FROM photo_upload_control WHERE id = 1 AND uploads_enabled = 0 AND reason = 'storage-release-ledger-migration-reconciliation-required';
        SELECT 'photo_read_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_read_budget', 'photo_read_control');
        SELECT 'photo_read_budget_rows=' || COUNT(*) FROM photo_read_budget WHERE id = 1 AND reads_in_period = 0 AND reads_in_day = 0;
        SELECT 'photo_read_control_rows=' || COUNT(*) FROM photo_read_control WHERE id = 1 AND reads_enabled = 1;
        SELECT 'photo_transform_budget_rows=' || COUNT(*) FROM photo_transform_budget WHERE id = 1 AND transforms_in_period = 0;
        SELECT 'photo_read_abuse_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_read_abuse_budget';
        SELECT 'source_scheduler_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'source_ingestion_targets';
        SELECT 'source_scheduler_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_source_ingestion_targets_due', 'idx_source_ingestion_targets_lease');
        SELECT 'source_scheduler_targets=' || COUNT(*) FROM source_ingestion_targets;
        SELECT 'kma_scheduler_ttl=' || default_ttl_seconds FROM data_sources WHERE source_key = 'kma_weather';
        SELECT 'publication_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('field_report_publications', 'field_report_media', 'hashtags', 'field_report_hashtags', 'publication_outbox');
        SELECT 'publication_delivery_columns=' || COUNT(*) FROM pragma_table_info('publication_outbox') WHERE name IN ('lease_token', 'lease_expires_at', 'last_error_code', 'dead_lettered_at', 'updated_at');
        SELECT 'v2_flags=' || COUNT(*) FROM feature_flags WHERE scope_type = 'global' AND scope_key = '*' AND enabled = 0;
        SELECT 'live_signal_expiry_notnull=' || "notnull" FROM pragma_table_info('live_signals') WHERE name = 'expires_at';
        SELECT 'place_event_accuracy_notnull=' || "notnull" FROM pragma_table_info('place_events') WHERE name = 'accuracy_bucket';
        SELECT 'place_event_accuracy_default=' || dflt_value FROM pragma_table_info('place_events') WHERE name = 'accuracy_bucket';
        SELECT 'place_event_verification_notnull=' || "notnull" FROM pragma_table_info('place_events') WHERE name = 'verification_method';
        SELECT 'place_event_verification_default=' || dflt_value FROM pragma_table_info('place_events') WHERE name = 'verification_method';
        SELECT 'place_event_moderation_notnull=' || "notnull" FROM pragma_table_info('place_events') WHERE name = 'moderation_status';
        SELECT 'place_event_moderation_default=' || dflt_value FROM pragma_table_info('place_events') WHERE name = 'moderation_status';
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
    assert.match(output, /trust_safety_tables=7/);
    assert.match(output, /preference_tables=4/);
    assert.match(output, /analytics_tables=1/);
    assert.match(output, /photo_cleanup_tables=1/);
    assert.match(output, /photo_cleanup_delivery_columns=6/);
    assert.match(output, /photo_budget_tables=1/);
    assert.match(output, /photo_release_tables=1/);
    assert.match(output, /anonymous_session_tables=1/);
    assert.match(output, /anonymous_session_indexes=1/);
    assert.match(output, /anonymous_session_budget_tables=1/);
    assert.match(output, /place_request_tables=2/);
    assert.match(output, /place_request_indexes=2/);
    assert.match(output, /place_request_triggers=1/);
    assert.match(output, /api_cost_guard_tables=3/);
    assert.match(output, /api_cost_guard_indexes=1/);
    assert.match(output, /api_cost_guard_control_rows=1/);
    assert.match(output, /api_cost_guard_warning_columns=2/);
    assert.match(output, /photo_budget_rows=1/);
    assert.match(output, /photo_abuse_tables=3/);
    assert.match(output, /photo_upload_control_rows=1/);
    assert.match(output, /photo_read_tables=2/);
    assert.match(output, /photo_read_budget_rows=1/);
    assert.match(output, /photo_read_control_rows=1/);
    assert.match(output, /photo_transform_budget_rows=1/);
    assert.match(output, /photo_read_abuse_tables=1/);
    assert.match(output, /source_scheduler_tables=1/);
    assert.match(output, /source_scheduler_indexes=2/);
    assert.match(output, /source_scheduler_targets=0/);
    assert.match(output, /kma_scheduler_ttl=7200/);
    assert.match(output, /publication_tables=5/);
    assert.match(output, /publication_delivery_columns=5/);
    assert.match(output, /place_event_moderation_notnull=1/);
    assert.match(output, /v2_flags=7/);
    assert.match(output, /live_signal_expiry_notnull=1/);
    assert.match(output, /place_event_accuracy_notnull=1/);
    assert.match(output, /place_event_accuracy_default='unknown'/);
    assert.match(output, /place_event_verification_notnull=1/);
    assert.match(output, /place_event_verification_default='none'/);
    assert.match(output, /place_event_moderation_notnull=1/);
    assert.match(output, /place_event_moderation_default='approved'/);
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

test("storage release migration preserves active objects while legacy cleanup is pending", { skip: !sqlite3Available() }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-storage-release-migration-"));
  const dbPath = join(tempDir, "migration.db");
  const migrationSql = (fileNames: string[]) =>
    fileNames.map((fileName) => readFileSync(new URL(`../workers/api/migrations/${fileName}`, import.meta.url), "utf8")).join("\n");
  const beforeBudget = migrationSql([
    "0001_initial.sql",
    "0002_posts_questions.sql",
    "0003_post_moderation_targets.sql",
    "0004_v2_foundation.sql",
    "0005_v2_signals.sql",
    "0006_trust_safety_identity.sql",
    "0007_enforce_live_signal_expiry.sql",
    "0008_persistent_preferences.sql",
    "0009_analytics_events.sql",
    "0010_photo_cleanup_jobs.sql",
    "0011_location_accuracy_buckets.sql",
    "0012_field_verification_method.sql",
    "0013_field_report_moderation.sql",
    "0014_field_report_publications.sql",
  ]);
  const afterBudget = migrationSql([
    "0015_photo_storage_budget.sql",
    "0016_photo_abuse_protection.sql",
    "0017_photo_read_budget.sql",
    "0018_source_ingestion_scheduler.sql",
    "0019_background_job_delivery.sql",
    "0020_photo_transform_budget.sql",
    "0021_photo_read_abuse_budget.sql",
    "0022_photo_storage_release_ledger.sql",
    "0023_anonymous_session_proofs.sql",
    "0024_anonymous_session_cost_guard.sql",
  ]);

  try {
    execFileSync("sqlite3", [dbPath], {
      encoding: "utf8",
      input: `
        ${beforeBudget}
        INSERT INTO regions (id, name, level, launch_stage, is_active) VALUES ('busan', '부산', 'city', 'active', 1);
        INSERT INTO areas (id, region_id, name) VALUES ('busan-suyeong', 'busan', '수영구');
        INSERT INTO categories (id, name, is_sensitive) VALUES ('tourism', '관광', 0);
        INSERT INTO places (
          id, area_id, region_id, category_id, name, address,
          latitude, longitude, coordinate_status, launch_stage, is_active
        ) VALUES (
          'busan-gwangalli', 'busan-suyeong', 'busan', 'tourism', '광안리해수욕장', '부산',
          35.1532, 129.1186, 'verified', 'active', 1
        );
        INSERT INTO anonymous_users (id, session_hash) VALUES ('anon_migration_fixture', 'migration-session-fixture');
        INSERT INTO photos (
          id, place_id, anonymous_user_id, r2_key, mime_type, byte_size,
          width, height, status, deleted_at, hidden_at, created_at
        ) VALUES
          ('photo_active_fixture', 'busan-gwangalli', 'anon_migration_fixture', 'photos/active-fixture.webp', 'image/webp', 200, 1, 1, 'ready', NULL, NULL, '2026-07-01T00:00:00.000Z'),
          ('photo_cleanup_fixture', 'busan-gwangalli', 'anon_migration_fixture', 'photos/cleanup-fixture.webp', 'image/webp', 100, 1, 1, 'rejected', '2026-07-02T00:00:00.000Z', '2026-07-02T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
        INSERT INTO photo_cleanup_jobs (
          id, photo_id, storage_key, reason, status, attempts,
          next_attempt_at, last_error_code, completed_at, created_at
        ) VALUES (
          'cleanup_legacy_fixture', 'photo_cleanup_fixture', 'photos/cleanup-fixture.webp',
          'legacy_pending_cleanup', 'pending', 0, '2026-07-02T00:00:00.000Z',
          'R2_DELETE_FAILED', NULL, '2026-07-02T00:00:00.000Z'
        );
        ${afterBudget}
      `,
    });
    const db = new SqliteD1Database(dbPath);
    const beforeCleanup = await db.prepare("SELECT active_bytes AS activeBytes FROM photo_storage_budget WHERE id = 1").first<{ activeBytes: number }>();
    const control = await db.prepare("SELECT uploads_enabled AS uploadsEnabled, reason FROM photo_upload_control WHERE id = 1").first<{ uploadsEnabled: number; reason: string }>();

    assert.equal(beforeCleanup?.activeBytes, 300);
    assert.deepEqual(control, {
      uploadsEnabled: 0,
      reason: "storage-release-ledger-migration-reconciliation-required",
    });

    const summary = await worker.runScheduledPhotoCleanup(
      { DB: db, PHOTOS: new FakeR2Bucket() },
      new Date("2030-07-19T00:00:00.000Z"),
    );
    const afterCleanup = await db.prepare("SELECT active_bytes AS activeBytes FROM photo_storage_budget WHERE id = 1").first<{ activeBytes: number }>();
    const release = await db.prepare("SELECT byte_size AS byteSize FROM photo_storage_releases WHERE storage_key = 'photos/cleanup-fixture.webp'").first<{ byteSize: number }>();

    assert.equal(summary.succeededCount, 1);
    assert.equal(afterCleanup?.activeBytes, 200);
    assert.equal(release?.byteSize, 100);
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

    await assert.rejects(
      db
        .prepare(insert)
        .bind(
          "signal-missing-expiry",
          "busan-gwangalli",
          "crowd",
          "busy",
          "source-user-report",
          "ugc",
          "User field report",
          "2026-07-10T00:20:00.000Z",
          "2026-07-10T00:21:00.000Z",
          null,
          0.7,
          1,
        )
        .run(),
      /NOT NULL constraint failed/,
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

test("0007 backfills legacy signal expiry and rejects new nullable signals", { skip: !sqlite3Available() }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-expiry-migration-"));
  const dbPath = join(tempDir, "expiry-migration.db");
  const baseMigrations = [
    "0001_initial.sql",
    "0002_posts_questions.sql",
    "0003_post_moderation_targets.sql",
    "0004_v2_foundation.sql",
    "0005_v2_signals.sql",
    "0006_trust_safety_identity.sql",
  ]
    .map((fileName) => readFileSync(new URL(`../workers/api/migrations/${fileName}`, import.meta.url), "utf8"))
    .join("\n");
  const seed = readFileSync(new URL("../workers/api/seeds/001_core_seed.sql", import.meta.url), "utf8");
  const enforceExpiry = readFileSync(new URL("../workers/api/migrations/0007_enforce_live_signal_expiry.sql", import.meta.url), "utf8");

  try {
    execFileSync("sqlite3", [dbPath], {
      encoding: "utf8",
      input: `
        ${baseMigrations}
        ${seed}
        INSERT INTO live_signals (
          id, place_id, dimension, value_code, source_id, source_type, source_name,
          observed_at, fetched_at, expires_at, confidence_score, is_publicly_visible
        ) VALUES (
          'legacy-null-expiry', 'busan-gwangalli', 'crowd', 'busy', 'source-user-report',
          'ugc', 'Legacy field report', '2026-07-10T00:20:00.000Z',
          '2026-07-10T00:21:00.000Z', NULL, 0.7, 1
        );
      `,
    });

    const output = execFileSync("sqlite3", [dbPath], {
      encoding: "utf8",
      input: `${enforceExpiry}
        SELECT 'expiry=' || expires_at FROM live_signals WHERE id = 'legacy-null-expiry';
        SELECT 'notnull=' || "notnull" FROM pragma_table_info('live_signals') WHERE name = 'expires_at';
      `,
    });
    assert.match(output, /expiry=2026-07-10T00:50:00\.000Z/);
    assert.match(output, /notnull=1/);

    assert.throws(
      () =>
        execFileSync("sqlite3", [dbPath], {
          encoding: "utf8",
          input: `
            INSERT INTO live_signals (
              id, place_id, dimension, value_code, source_id, source_type, source_name,
              observed_at, fetched_at, expires_at, confidence_score, is_publicly_visible
            ) VALUES (
              'new-null-expiry', 'busan-gwangalli', 'crowd', 'busy', 'source-user-report',
              'ugc', 'New field report', '2026-07-10T00:20:00.000Z',
              '2026-07-10T00:21:00.000Z', NULL, 0.7, 1
            );
          `,
          stdio: "pipe",
        }),
      /NOT NULL constraint failed/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 posts hashtags and questions use Cloudflare schema", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    await enableD1FeatureFlags(db, ["SOCIAL_FEED_ENABLED", "QNA_ENABLED", "REWARDS_ENABLED"]);
    const anonymousId = "anon_d1_posts_questions";
    const postsPayload = await d1Get<SuccessPayload<FeedPost[]>>(db, "https://api.test/api/posts?regionId=seoul&limit=10", anonymousId);
    assert.equal(postsPayload.meta?.storage, "d1");
    assert.equal(postsPayload.data.some((postItem) => postItem.placeId === "seoul-yeouido"), true);
    assert.equal(postsPayload.data.every((postItem) => postItem.hiddenAt === null), true);

    const configuredUrlResponse = await worker.handleRequest(
      new Request("https://api.test/api/posts?regionId=seoul&limit=10"),
      { DB: db, SILSIGAN_PUBLIC_SITE_URL: "https://staging.example.test/" },
    );
    const configuredUrlPayload = (await configuredUrlResponse.json()) as SuccessPayload<FeedPost[]>;
    assert.equal(configuredUrlResponse.status, 200);
    assert.equal(configuredUrlPayload.data[0]?.shareCard.url.startsWith("https://staging.example.test/place/"), true);

    const sharedPostId = configuredUrlPayload.data[0]?.id;
    assert.ok(sharedPostId);
    const sharedPostResponse = await worker.handleRequest(
      new Request(`https://api.test/api/share/posts/${encodeURIComponent(sharedPostId)}`),
      { DB: db, SILSIGAN_PUBLIC_SITE_URL: "https://staging.example.test/" },
    );
    const sharedPostPayload = (await sharedPostResponse.json()) as SuccessPayload<{
      shareCard: { headline: string; body: string; variant: string };
      status: { status: string; dataMode: string; currentSignals: unknown[] };
    }>;
    assert.equal(sharedPostResponse.status, 200);
    assert.equal(sharedPostPayload.data.status.dataMode, "live");
    assert.equal(sharedPostPayload.data.status.status, "insufficient");
    assert.equal(sharedPostPayload.data.status.currentSignals.length, 0);
    assert.match(sharedPostPayload.data.shareCard.headline, /현재 정보 부족/);
    assert.match(sharedPostPayload.data.shareCard.body, /현재 판단: 현재 정보 부족/);
    assert.equal(sharedPostPayload.data.shareCard.variant, "neutral");

    const unsafeUrlResponse = await worker.handleRequest(
      new Request("https://api.test/api/posts?regionId=seoul&limit=10"),
      { DB: db, SILSIGAN_PUBLIC_SITE_URL: "http://localhost:3000/?token=unsafe" },
    );
    const unsafeUrlPayload = (await unsafeUrlResponse.json()) as SuccessPayload<FeedPost[]>;
    assert.equal(unsafeUrlResponse.status, 200);
    assert.equal(unsafeUrlPayload.data[0]?.shareCard.url.startsWith("https://silsigan.pages.dev/place/"), true);

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
    assert.equal(createdPost.data.post.hashtagNames.includes("scriptbadscript"), true);
    assert.equal(createdPost.data.privacyNotice.includes("정확한 좌표"), true);

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

    const questionResponse = await rawD1Post(db, "https://api.test/api/questions", anonymousId, {
      placeId: "seoul-yeouido",
      questionType: "photo_request",
      body: "지금 한강 사진 요청 가능할까요?",
      availableCredits: 999,
    });
    const questionFailure = (await questionResponse.json()) as FailurePayload;
    assert.equal(questionResponse.status, 503);
    assert.equal(questionFailure.error.code, "CREDIT_LEDGER_REQUIRED");
    const questionCount = await db
      .prepare("SELECT COUNT(*) AS count FROM questions WHERE anonymous_user_id = ?")
      .bind(anonymousId)
      .first<{ count: number }>();
    assert.equal(questionCount?.count, 0);

    const mine = await d1Get<SuccessPayload<QuestionData[]>>(db, "https://api.test/api/my-questions", anonymousId);
    assert.equal(mine.data.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 field report publication links owned photos and hashtags idempotently", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const anonymousId = "anon_field_report_publication";

  try {
    const photo = await d1Post<SuccessPayload<PhotoCompleteData>>(db, "https://api.test/api/photos/complete", anonymousId, {
      uploadId: "upload_field_report_publication",
      placeId: "busan-gwangalli",
      byteSize: 100_000,
      mimeType: "image/webp",
      width: 800,
      height: 600,
      clientReencoded: true,
    });
    await d1AdminPost<SuccessPayload<{ decision: string }>>(
      db,
      `https://api.test/api/admin/photos/${photo.data.photo.id}/moderation`,
      { decision: "approved", reason: "현장 제보 연결 사진 공개 검수" },
      {},
      "test-moderator-token",
    );
    const requestBody = {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      comment: "해변 중앙 쪽에 사람이 많습니다.",
      photoIds: [photo.data.photo.id],
      hashtagNames: ["#광안리지금", "#사람많음", "#발행검수태그"],
      clientRequestId: "field-report-publication-001",
    };

    const first = await rawD1Post(db, "https://api.test/api/reports", anonymousId, requestBody);
    const firstPayload = (await first.json()) as SuccessPayload<FieldReportData & {
      publication: { clientRequestId: string; photoIds: string[]; hashtagNames: string[] };
    }>;
    assert.equal(first.status, 201);
    assert.equal(firstPayload.data.publication.clientRequestId, requestBody.clientRequestId);
    assert.deepEqual(firstPayload.data.publication.photoIds, [photo.data.photo.id]);
    assert.deepEqual(firstPayload.data.publication.hashtagNames, ["광안리지금", "사람많음", "발행검수태그"]);

    const second = await rawD1Post(db, "https://api.test/api/reports", anonymousId, requestBody);
    const secondPayload = (await second.json()) as SuccessPayload<FieldReportData & {
      publication: { clientRequestId: string; photoIds: string[]; hashtagNames: string[] };
    }>;
    assert.equal(second.status, 200);
    assert.equal(secondPayload.data.report.id, firstPayload.data.report.id);
    assert.deepEqual(secondPayload.data.publication, firstPayload.data.publication);

    const publicationCount = await db
      .prepare("SELECT COUNT(*) AS count FROM field_report_publications WHERE client_request_id = ?")
      .bind(requestBody.clientRequestId)
      .first<{ count: number }>();
    const mediaCount = await db
      .prepare("SELECT COUNT(*) AS count FROM field_report_media WHERE report_id = ? AND photo_id = ?")
      .bind(firstPayload.data.report.id, photo.data.photo.id)
      .first<{ count: number }>();
    const hashtagCount = await db
      .prepare("SELECT COUNT(*) AS count FROM field_report_hashtags WHERE report_id = ?")
      .bind(firstPayload.data.report.id)
      .first<{ count: number }>();
    assert.equal(publicationCount?.count, 1);
    assert.equal(mediaCount?.count, 1);
    assert.equal(hashtagCount?.count, 3);

    const eventCountBeforeFailedBatch = await db
      .prepare("SELECT COUNT(*) AS count FROM place_events WHERE anonymous_user_id = ? AND source = 'field_report'")
      .bind(anonymousId)
      .first<{ count: number }>();
    const reusedPhotoResponse = await rawD1Post(db, "https://api.test/api/reports", anonymousId, {
      ...requestBody,
      clientRequestId: "field-report-publication-reused-photo",
    });
    const reusedPhotoPayload = (await reusedPhotoResponse.json()) as FailurePayload;
    assert.equal(reusedPhotoResponse.status, 409);
    assert.equal(reusedPhotoPayload.error.code, "PUBLICATION_PHOTO_ALREADY_LINKED");
    const eventCountAfterFailedBatch = await db
      .prepare("SELECT COUNT(*) AS count FROM place_events WHERE anonymous_user_id = ? AND source = 'field_report'")
      .bind(anonymousId)
      .first<{ count: number }>();
    assert.equal(eventCountAfterFailedBatch?.count, eventCountBeforeFailedBatch?.count);

    const foreignPhotoResponse = await rawD1Post(db, "https://api.test/api/reports", "anon_other_publication_user", {
      ...requestBody,
      clientRequestId: "field-report-publication-foreign-photo",
    });
    const foreignPhotoPayload = (await foreignPhotoResponse.json()) as FailurePayload;
    assert.equal(foreignPhotoResponse.status, 400);
    assert.equal(foreignPhotoPayload.error.code, "PUBLICATION_PHOTO_INVALID");

    const pendingHashtags = await d1Get<SuccessPayload<Array<{ name: string }>>>(db, "https://api.test/api/hashtags", anonymousId);
    assert.equal(pendingHashtags.data.some((hashtag) => hashtag.name === "발행검수태그"), false);
    await d1AdminPost(
      db,
      `https://api.test/api/admin/field-reports/${firstPayload.data.report.id}/action`,
      { status: "approved", reason: "발행 묶음 공개 검수" },
      {},
      "test-moderator-token",
    );
    const approvedHashtags = await d1Get<SuccessPayload<Array<{ name: string }>>>(db, "https://api.test/api/hashtags", anonymousId);
    assert.equal(approvedHashtags.data.some((hashtag) => hashtag.name === "발행검수태그"), true);
    const approvedReports = await d1Get<SuccessPayload<Array<{ id: string; photoIds: string[]; hashtagNames: string[] }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli",
      anonymousId,
    );
    const approvedReport = approvedReports.data.find((report) => report.id === firstPayload.data.report.id);
    assert.deepEqual(approvedReport?.photoIds, [photo.data.photo.id]);
    assert.deepEqual(approvedReport?.hashtagNames, ["광안리지금", "사람많음", "발행검수태그"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 hashtag media paginates beyond 100 and excludes cross-region or non-public photos", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const tagName = "회귀사진태그";
  const anonymousId = "anon_hashtag_media_contract";

  try {
    await db.prepare(
      "INSERT INTO anonymous_users (id, session_hash) VALUES (?, ?)",
    ).bind(anonymousId, "hash_hashtag_media_contract").run();
    await db.prepare(
      "INSERT INTO hashtags (name, tag_type, moderation_status, post_count, last_post_at) VALUES (?, 'purpose', 'approved', 0, ?)",
    ).bind(tagName, "2026-07-19T12:00:00.000Z").run();

    const statements: worker.D1PreparedStatement[] = [];
    const addPublication = (input: {
      id: string;
      placeId: string;
      createdAt: string;
      expiresAt?: string;
      publicationStatus?: "approved" | "hidden";
      eventStatus?: "approved" | "hidden";
      photoDeletedAt?: string | null;
      photoHiddenAt?: string | null;
    }) => {
      const photoId = `photo_${input.id}`;
      statements.push(
        db.prepare(
          `INSERT INTO place_events
            (id, place_id, anonymous_user_id, event_type, source, region_code, area_code, category, moderation_status, created_at, expires_at)
           VALUES (?, ?, ?, 'report', 'field_report', ?, 'test-area', 'tourism', ?, ?, ?)`,
        ).bind(
          input.id,
          input.placeId,
          anonymousId,
          input.placeId.startsWith("busan-") ? "busan" : "seoul",
          input.eventStatus ?? "approved",
          input.createdAt,
          input.expiresAt ?? "2099-01-01T00:00:00.000Z",
        ),
        db.prepare(
          `INSERT INTO field_report_publications
            (report_id, place_id, anonymous_user_id, response_json, moderation_status, created_at, updated_at)
           VALUES (?, ?, ?, '{}', ?, ?, ?)`,
        ).bind(input.id, input.placeId, anonymousId, input.publicationStatus ?? "approved", input.createdAt, input.createdAt),
        db.prepare(
          `INSERT INTO photos
            (id, place_id, anonymous_user_id, r2_key, mime_type, byte_size, width, height, status, deleted_at, hidden_at, created_at)
           VALUES (?, ?, ?, ?, 'image/webp', 1000, 800, 600, 'ready', ?, ?, ?)`,
        ).bind(photoId, input.placeId, anonymousId, `photos/${photoId}`, input.photoDeletedAt ?? null, input.photoHiddenAt ?? null, input.createdAt),
        db.prepare("INSERT INTO field_report_media (report_id, photo_id, position, created_at) VALUES (?, ?, 0, ?)")
          .bind(input.id, photoId, input.createdAt),
        db.prepare("INSERT INTO field_report_hashtags (report_id, hashtag_name, position, created_at) VALUES (?, ?, 0, ?)")
          .bind(input.id, tagName, input.createdAt),
      );
    };

    for (let index = 0; index < 102; index += 1) {
      addPublication({
        id: `field_report_page_${String(index).padStart(3, "0")}`,
        placeId: "busan-gwangalli",
        createdAt: new Date(Date.UTC(2026, 6, 19, 12, 0, index)).toISOString(),
      });
    }
    addPublication({ id: "field_report_cross_region", placeId: "seoul-yeouido", createdAt: "2026-07-19T13:00:00.000Z" });
    addPublication({ id: "field_report_expired", placeId: "busan-gwangalli", createdAt: "2026-07-19T13:01:00.000Z", expiresAt: "2020-01-01T00:00:00.000Z" });
    addPublication({ id: "field_report_hidden", placeId: "busan-gwangalli", createdAt: "2026-07-19T13:02:00.000Z", publicationStatus: "hidden" });
    addPublication({ id: "field_report_deleted_photo", placeId: "busan-gwangalli", createdAt: "2026-07-19T13:03:00.000Z", photoDeletedAt: "2026-07-19T13:04:00.000Z" });
    addPublication({ id: "field_report_hidden_photo", placeId: "busan-gwangalli", createdAt: "2026-07-19T13:05:00.000Z", photoHiddenAt: "2026-07-19T13:06:00.000Z" });
    await db.batch(statements);
    await db.prepare(
      `INSERT INTO posts
        (id, place_id, anonymous_user_id, creator_name, creator_badge, crowd_level, parking_status, line_status, weather_feel, photo_count, photo_label, hashtag_names)
       VALUES ('post_legacy_hashtag_media', 'busan-gwangalli', ?, 'legacy', 'legacy', 'normal', 'unknown', 'none', 'good', 1, 'legacy photo', ?)`,
    ).bind(anonymousId, JSON.stringify([tagName])).run();

    const first = await d1Get<SuccessPayload<Array<{
      name: string;
      latestObservedAt: string;
      activePlaceCount: number;
      recentPhotoCount: number;
      recentMedia: Array<{ id: string; placeId: string; photoIds: string[] }>;
      nextCursor: string | null;
    }>>>(db, `https://api.test/api/hashtags?name=${encodeURIComponent(tagName)}&regionId=busan&hasPhoto=true&activeOnly=true&sort=recent&limit=100`, anonymousId);
    const tag = first.data[0];
    assert.equal(first.meta?.socialFeedEnabled, false);
    assert.equal(tag?.recentPhotoCount, 102);
    assert.equal(tag?.activePlaceCount, 1);
    assert.equal(tag?.recentMedia.length, 100);
    assert.equal(tag?.recentMedia.every((media) => media.placeId === "busan-gwangalli" && media.photoIds.length === 1), true);
    assert.ok(tag?.nextCursor);
    assert.equal(tag?.recentMedia.some((media) => media.id.includes("expired") || media.id.includes("hidden") || media.id.includes("deleted")), false);

    const second = await d1Get<SuccessPayload<Array<{ recentMedia: Array<{ id: string }>; nextCursor: string | null }>>>(
      db,
      `https://api.test/api/hashtags?name=${encodeURIComponent(tagName)}&regionId=busan&hasPhoto=true&activeOnly=true&sort=recent&limit=100&cursor=${encodeURIComponent(tag?.nextCursor ?? "")}`,
      anonymousId,
    );
    assert.equal(second.data[0]?.recentMedia.length, 2);
    assert.equal(second.data[0]?.nextCursor, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 anonymous preferences sync saves, follows, and stores only notification hashes", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const anonymousId = "anon_preferences_sync";

  try {
    const initial = await d1Get<SuccessPayload<{
      savedPlaceIds: string[];
      savedPostIds: string[];
      followedTopicNames: string[];
      notificationEnabled: boolean;
    }>>(db, "https://api.test/api/preferences", anonymousId);
    assert.deepEqual(initial.data, {
      savedPlaceIds: [],
      savedPostIds: [],
      followedTopicNames: [],
      notificationEnabled: false,
      notificationPlatform: "webview",
    });

    await d1Post(db, "https://api.test/api/preferences", anonymousId, {
      kind: "saved_place",
      key: "busan-gwangalli",
      enabled: true,
    });
    await d1Post(db, "https://api.test/api/preferences", anonymousId, {
      kind: "saved_post",
      key: "post_seed_gwangalli_parking",
      enabled: true,
    });
    await d1Post(db, "https://api.test/api/preferences", anonymousId, {
      kind: "followed_topic",
      key: "광안리주차",
      enabled: true,
    });
    await d1Post(db, "https://api.test/api/preferences", anonymousId, {
      kind: "notifications",
      enabled: true,
      platform: "webview",
      pushTokenHash: `sha256:${"a".repeat(64)}`,
    });

    const synced = await d1Get<SuccessPayload<{
      savedPlaceIds: string[];
      savedPostIds: string[];
      followedTopicNames: string[];
      notificationEnabled: boolean;
      notificationPlatform: string;
    }>>(db, "https://api.test/api/preferences", anonymousId);
    assert.deepEqual(synced.data, {
      savedPlaceIds: ["busan-gwangalli"],
      savedPostIds: ["post_seed_gwangalli_parking"],
      followedTopicNames: ["광안리주차"],
      notificationEnabled: true,
      notificationPlatform: "webview",
    });

    const rawToken = await rawD1Post(db, "https://api.test/api/preferences", anonymousId, {
      kind: "notifications",
      enabled: true,
      pushTokenHash: "raw-push-token",
    });
    const rawTokenPayload = (await rawToken.json()) as FailurePayload;
    assert.equal(rawToken.status, 400);
    assert.equal(rawTokenPayload.error.code, "VALIDATION_ERROR");

    const storedToken = await db
      .prepare("SELECT push_token_hash AS pushTokenHash FROM notification_subscriptions LIMIT 1")
      .first<{ pushTokenHash: string | null }>();
    assert.match(storedToken?.pushTokenHash ?? "", /^sha256:[a-f0-9]{64}$/);

    await d1Post(db, "https://api.test/api/preferences", anonymousId, {
      kind: "notifications",
      enabled: false,
      platform: "webview",
      pushTokenHash: null,
    });
    const clearedToken = await db
      .prepare("SELECT push_token_hash AS pushTokenHash FROM notification_subscriptions WHERE platform = 'webview' LIMIT 1")
      .first<{ pushTokenHash: string | null }>();
    assert.equal(clearedToken?.pushTokenHash, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("analytics events use a server sink and never store private properties", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const anonymousId = "anon_analytics_sink_test";

  try {
    const response = await d1Post<SuccessPayload<{ accepted: boolean; eventName: string }>>(
      db,
      "https://api.test/api/analytics/events",
      anonymousId,
      {
        eventName: "nearby_loaded",
        properties: {
          placeId: "busan-gwangalli",
          resultCount: 5,
          latitude: 35.1532,
          memo: "private operator note",
          email: "person@example.com",
          token: "secret-token",
        },
      },
    );

    assert.equal(response.meta?.storage, "d1");
    assert.equal(response.data.accepted, true);
    assert.equal(response.data.eventName, "nearby_loaded");

    const stored = await db
      .prepare("SELECT actor_identity_key AS actorIdentityKey, properties_json AS propertiesJson FROM analytics_events LIMIT 1")
      .first<{ actorIdentityKey: string; propertiesJson: string }>();
    assert.match(stored?.actorIdentityKey ?? "", /^analytics:[a-f0-9]{64}$/);
    assert.equal(stored?.actorIdentityKey.includes(anonymousId), false);
    assert.deepEqual(JSON.parse(stored?.propertiesJson ?? "{}"), {
      placeId: "busan-gwangalli",
      resultCount: 5,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("beta KPI success and runtime error events pass the analytics allowlist without raw error details", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const mapSuccess = await d1Post<SuccessPayload<{ accepted: boolean; eventName: string }>>(
      db,
      "https://api.test/api/analytics/events",
      "anon_kpi_event_allowlist",
      { eventName: "map_load_succeeded" },
    );
    const runtimeError = await d1Post<SuccessPayload<{ accepted: boolean; eventName: string }>>(
      db,
      "https://api.test/api/analytics/events",
      "anon_kpi_event_allowlist",
      {
        eventName: "app_runtime_error",
        properties: {
          surface: "app_route",
          errorMessage: "private stack content",
          digest: "private-digest",
        },
      },
    );
    const stored = await db
      .prepare("SELECT event_name AS eventName, properties_json AS propertiesJson FROM analytics_events ORDER BY created_at ASC")
      .all<{ eventName: string; propertiesJson: string }>();

    assert.equal(mapSuccess.data.eventName, "map_load_succeeded");
    assert.equal(runtimeError.data.eventName, "app_runtime_error");
    assert.deepEqual(stored.results?.map((row) => row.eventName), ["map_load_succeeded", "app_runtime_error"]);
    assert.deepEqual(JSON.parse(stored.results?.[1]?.propertiesJson ?? "{}"), { surface: "app_route" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("operator beta KPI endpoint returns aggregate-only retention funnel reliability and moderation evidence", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const atUtcDay = (daysAgo: number, hour = 12) => {
    const date = new Date();
    date.setUTCHours(hour, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    return date.toISOString();
  };
  const insertEvent = async (
    id: string,
    eventName: string,
    actor: string,
    daysAgo: number,
    properties: Record<string, unknown> = {},
  ) => {
    await db
      .prepare(
        `INSERT INTO analytics_events (id, event_name, actor_identity_key, properties_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, eventName, `analytics:${actor}`, JSON.stringify(properties), atUtcDay(daysAgo))
      .run();
  };

  try {
    await insertEvent("kpi-a-open", "app_opened", "actor-a", 8);
    await insertEvent("kpi-a-d1", "view_home", "actor-a", 7);
    await insertEvent("kpi-a-d7", "map_load_succeeded", "actor-a", 1);
    await insertEvent("kpi-a-start", "report_started", "actor-a", 1);
    await insertEvent("kpi-a-submit", "report_submitted", "actor-a", 1, { completionMs: 12_000 });
    await insertEvent("kpi-b-open", "app_opened", "actor-b", 2);
    await insertEvent("kpi-b-d1", "map_load_failed", "actor-b", 1);
    await insertEvent("kpi-b-start", "report_started", "actor-b", 1);
    await insertEvent("kpi-b-runtime-error", "app_runtime_error", "actor-b", 1, { surface: "app" });

    const approvedResponse = await rawD1Post(db, "https://api.test/api/reports", "anon_kpi_approved", {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      clientRequestId: "kpi-approved-report",
    });
    const approvedPayload = (await approvedResponse.json()) as SuccessPayload<FieldReportData>;
    await d1AdminPost(
      db,
      `https://api.test/api/admin/field-reports/${approvedPayload.data.report.id}/action`,
      { status: "approved", reason: "KPI 승인 fixture" },
      {},
      "test-moderator-token",
    );
    await db
      .prepare(
        `UPDATE field_report_publications
         SET created_at = ?, updated_at = ?, moderation_status = 'approved'
         WHERE report_id = ?`,
      )
      .bind(atUtcDay(1, 10), atUtcDay(1, 11), approvedPayload.data.report.id)
      .run();
    await db.prepare("UPDATE places SET launch_stage = 'seed'").run();
    await db.prepare("UPDATE places SET launch_stage = 'active' WHERE id = 'busan-gwangalli'").run();
    await db.prepare("UPDATE places SET launch_stage = 'beta' WHERE id = 'seoul-yeouido'").run();

    const pendingResponse = await rawD1Post(db, "https://api.test/api/reports", "anon_kpi_pending", {
      placeId: "seoul-yeouido",
      category: "tourism",
      parkingStatus: "limited",
      clientRequestId: "kpi-pending-report",
    });
    const pendingPayload = (await pendingResponse.json()) as SuccessPayload<FieldReportData>;
    await db
      .prepare("UPDATE field_report_publications SET created_at = ?, updated_at = ? WHERE report_id = ?")
      .bind(atUtcDay(1, 10), atUtcDay(1, 10), pendingPayload.data.report.id)
      .run();

    const unauthorized = await worker.handleRequest(
      new Request("https://api.test/api/admin/beta-kpis?days=30"),
      { DB: db, ADMIN_TOKENS: testAdminTokens },
    );
    const response = await worker.handleRequest(
      new Request("https://api.test/api/admin/beta-kpis?days=30", {
        headers: { "x-silsigan-admin-token": "test-operator-token" },
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens },
    );
    const payload = (await response.json()) as SuccessPayload<BetaKpiData>;
    const serialized = JSON.stringify(payload);

    assert.equal(unauthorized.status, 403);
    assert.equal(response.status, 200);
    assert.equal(payload.data.windowDays, 30);
    assert.equal(payload.data.privacy, "aggregate-only");
    assert.equal(payload.data.audience.activeUsers, 2);
    assert.equal(payload.data.audience.appOpens, 2);
    assert.equal(payload.data.reportFunnel.started, 2);
    assert.equal(payload.data.reportFunnel.submitted, 1);
    assert.equal(payload.data.reportFunnel.conversionPercent, 50);
    assert.equal(payload.data.reportFunnel.medianCompletionSeconds, 12);
    assert.equal(payload.data.mapReliability.succeeded, 1);
    assert.equal(payload.data.mapReliability.failed, 1);
    assert.equal(payload.data.mapReliability.successPercent, 50);
    assert.equal(payload.data.moderation.submitted, 2);
    assert.equal(payload.data.moderation.approved, 1);
    assert.equal(payload.data.moderation.pending, 1);
    assert.equal(payload.data.moderation.approvalPercent, 100);
    assert.equal(payload.data.moderation.reviewedWithin24HoursPercent, 100);
    assert.deepEqual(payload.data.retention.d1, { cohortUsers: 2, retainedUsers: 2, percent: 100 });
    assert.deepEqual(payload.data.retention.d7, { cohortUsers: 1, retainedUsers: 1, percent: 100 });
    assert.deepEqual(payload.data.freshCoverage, {
      eligiblePlaces: 2,
      coveredPlaces: 1,
      percent: 50,
      tierA: { eligiblePlaces: 1, coveredPlaces: 1, percent: 100 },
      tierB: { eligiblePlaces: 1, coveredPlaces: 0, percent: 0 },
    });
    assert.deepEqual(payload.data.runtimeReliability, { appOpenUsers: 2, errorUsers: 1, errorFreePercent: 50 });
    assert.equal(serialized.includes("actor-a"), false);
    assert.equal(serialized.includes("actor-b"), false);
    assert.equal(serialized.includes("properties_json"), false);
    assert.equal(serialized.includes("anonymousUserId"), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 public posts ignore includeHidden query parameter", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    await enableD1FeatureFlags(db, ["SOCIAL_FEED_ENABLED"]);
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
        SILSIGAN_ANON_SESSION_REQUIRED: "0",
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
    const response = await rawD1Post(db, "https://api.test/api/reports", anonymousId, {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      lineStatus: "short",
      parkingStatus: "limited",
      weatherFeel: "windy",
      comment: "바람이 강하고 사람이 조금 많습니다.",
      photoUrl: "https://images.example.test/gwangalli-status.webp",
      clientLocation: {
        latitude: 35.1532,
        longitude: 129.1186,
        accuracyM: 18,
      },
    });
    const payload = (await response.json()) as SuccessPayload<FieldReportData>;
    const serializedPayload = JSON.stringify(payload);

    assert.equal(response.status, 201);
    assert.equal(payload.meta?.storage, "d1");
    assert.equal(payload.meta?.locationPolicy, "clientLocation-used-only-for-distance-and-not-stored");
    assert.equal(payload.data.report.placeId, "busan-gwangalli");
    assert.equal(payload.data.report.verifiedRadiusM, 50);
    assert.equal(payload.data.report.verificationMethod, "radius");
    assert.equal(payload.data.report.accuracyBucket, "high");
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
    assert.deepEqual(payload.data.credits, [
      { type: "verified_report", amount: 1 },
      { type: "photo_report", amount: 1 },
    ]);
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
          actor_type AS actorType
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
      }>();
    assert.equal(signalRows.results?.length, 4);
    assert.equal(signalRows.results?.every((signal) => signal.sourceType === "verified_ugc" && signal.actorType === "anonymous"), true);
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
          accuracy_bucket AS accuracyBucket,
          moderation_status AS moderationStatus,
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
        moderationStatus: string;
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
      accuracyBucket: "high",
      moderationStatus: "pending",
      createdAt: event.createdAt,
      expiresAt: event.expiresAt,
    });
    assert.equal(new Date(event.expiresAt).getTime() - new Date(event.createdAt).getTime(), 3 * 60 * 60 * 1000);

    const pendingPublic = await d1Get<SuccessPayload<Array<{ id: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&limit=5",
      anonymousId,
    );
    assert.equal(pendingPublic.data.some((report) => report.id === payload.data.report.id), false);
    const pendingMine = await d1Get<SuccessPayload<Array<{ id: string; moderationStatus: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&mine=1&limit=5",
      anonymousId,
    );
    assert.equal(pendingMine.data.find((report) => report.id === payload.data.report.id)?.moderationStatus, "pending");
    const pendingQueue = await d1AdminGet<SuccessPayload<Array<{ id: string; moderationStatus: string }>>>(
      db,
      "https://api.test/api/admin/field-reports?status=pending&limit=5",
    );
    assert.equal(pendingQueue.data.find((report) => report.id === payload.data.report.id)?.moderationStatus, "pending");
    const pendingRanking = await d1Get<SuccessPayload<Ranking[]>>(db, "https://api.test/api/rankings/regions/busan?limit=10", anonymousId);
    const pendingGwangalli = pendingRanking.data.find((item) => item.placeId === "busan-gwangalli");
    assert.equal(pendingGwangalli?.reportCount, 0);
    const pendingVote = await rawD1Post(
      db,
      `https://api.test/api/reports/${payload.data.report.id}/votes`,
      "anon_pending_vote",
      { voteType: "agree" },
    );
    const pendingVotePayload = (await pendingVote.json()) as FailurePayload;
    assert.equal(pendingVote.status, 409);
    assert.equal(pendingVotePayload.error.code, "FIELD_REPORT_NOT_PUBLIC");
    const approvalResponse = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/field-reports/${payload.data.report.id}/action`,
      { status: "approved", reason: "정상 현장 제보 fixture" },
      "test-moderator-token",
    );
    const approvalPayload = (await approvalResponse.json()) as SuccessPayload<{ moderationStatus: string }>;
    assert.equal(approvalResponse.status, 200);
    assert.equal(approvalPayload.data.moderationStatus, "approved");

    const visibleSignalCount = await db
      .prepare("SELECT COUNT(*) AS count FROM live_signals WHERE evidence_id = ? AND is_publicly_visible = 1")
      .bind(payload.data.report.id)
      .first<{ count: number }>();
    assert.equal(visibleSignalCount?.count, 4);
    const approvedEvent = await db
      .prepare("SELECT moderation_status AS moderationStatus, expires_at AS expiresAt FROM place_events WHERE id = ?")
      .bind(payload.data.report.id)
      .first<{ moderationStatus: string; expiresAt: string }>();
    assert.equal(approvedEvent?.moderationStatus, "approved");
    const approvedReportCount = await db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM place_events
         WHERE place_id = ?
           AND event_type = 'report'
           AND source = 'field_report'
           AND moderation_status = 'approved'
           AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind("busan-gwangalli")
      .first<{ count: number }>();
    assert.equal(approvedReportCount?.count, 1);

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

    const ranking = await d1Get<SuccessPayload<Ranking[]>>(db, "https://api.test/api/rankings/regions/busan?limit=10", anonymousId);
    const gwangalli = ranking.data.find((item) => item.placeId === "busan-gwangalli");
    assert.equal(gwangalli?.score, 104);

    const list = await d1Get<SuccessPayload<Array<{ id: string; placeId: string; weatherFeel?: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&limit=5",
      anonymousId,
    );
    const serializedList = JSON.stringify(list);
    assert.equal(list.meta?.storage, "d1");
    assert.equal(list.data[0]?.id, payload.data.report.id);
    assert.equal(list.data[0]?.placeId, "busan-gwangalli");
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

    const secondReportResponse = await rawD1Post(db, "https://api.test/api/reports", "anon_d1_field_reporter_two", {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "normal",
      lineStatus: "none",
      parkingStatus: "available",
      comment: "두 번째 제보는 검수 거절 경로를 확인합니다.",
      clientLocation: {
        latitude: 35.1532,
        longitude: 129.1186,
        accuracyM: 18,
      },
    });
    const secondReportPayload = (await secondReportResponse.json()) as SuccessPayload<FieldReportData>;
    assert.equal(secondReportResponse.status, 201);
    assert.equal(secondReportPayload.data.report.moderationStatus, "pending");
    const rejectionResponse = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/field-reports/${secondReportPayload.data.report.id}/action`,
      { status: "rejected", reason: "검수 fixture 거절" },
      "test-moderator-token",
    );
    const rejectionPayload = (await rejectionResponse.json()) as SuccessPayload<{ moderationStatus: string }>;
    assert.equal(rejectionResponse.status, 200);
    assert.equal(rejectionPayload.data.moderationStatus, "rejected");
    const rejectedPublic = await d1Get<SuccessPayload<Array<{ id: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&limit=10",
      "anon_d1_field_reporter_two",
    );
    assert.equal(rejectedPublic.data.some((report) => report.id === secondReportPayload.data.report.id), false);
    const rejectedMine = await d1Get<SuccessPayload<Array<{ id: string; moderationStatus: string }>>>(
      db,
      "https://api.test/api/reports?placeId=busan-gwangalli&mine=1&limit=10",
      "anon_d1_field_reporter_two",
    );
    assert.equal(rejectedMine.data.find((report) => report.id === secondReportPayload.data.report.id)?.moderationStatus, "rejected");
    const rejectedSignalCount = await db
      .prepare("SELECT COUNT(*) AS count FROM live_signals WHERE evidence_id = ? AND is_publicly_visible = 1")
      .bind(secondReportPayload.data.report.id)
      .first<{ count: number }>();
    assert.equal(rejectedSignalCount?.count, 0);
    const rejectionAudit = await db
      .prepare("SELECT action_type AS actionType, target_type AS targetType, target_id AS targetId FROM admin_actions WHERE target_id = ?")
      .bind(secondReportPayload.data.report.id)
      .first<{ actionType: string; targetType: string; targetId: string }>();
    assert.deepEqual(rejectionAudit, {
      actionType: "field_report_rejected",
      targetType: "field_report",
      targetId: secondReportPayload.data.report.id,
    });

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
        accuracyM: 18,
      },
    });
    const rejectedPayload = (await rejected.json()) as FailurePayload;
    const rejectedSerialized = JSON.stringify(rejectedPayload);

    assert.equal(rejected.status, 400);
    assert.equal(rejectedPayload.error.code, "LOCATION_NOT_VERIFIED");
    assert.equal(rejectedSerialized.includes("37.5665"), false);
    assert.equal(rejectedSerialized.includes("126.978"), false);

    const eventCount = await db.prepare("SELECT COUNT(*) AS count FROM place_events WHERE place_id = ?").bind("busan-gwangalli").first<{ count: number }>();
    assert.equal(eventCount?.count, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 field reports with low or missing accuracy fall back to unverified without blocking the report", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const lowAccuracy = await rawD1Post(db, "https://api.test/api/reports", "anon_low_accuracy_report", {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      clientLocation: {
        latitude: 35.1532,
        longitude: 129.1186,
        accuracyM: 250,
      },
    });
    const lowPayload = (await lowAccuracy.json()) as SuccessPayload<FieldReportData>;
    assert.equal(lowAccuracy.status, 201);
    assert.equal(lowPayload.data.report.verifiedRadiusM, null);
    assert.equal(lowPayload.data.report.accuracyBucket, "low");
    assert.deepEqual(lowPayload.data.credits, []);

    const lowRow = await db
      .prepare("SELECT verified_radius_m AS verifiedRadiusM, accuracy_bucket AS accuracyBucket FROM place_events WHERE id = ?")
      .bind(lowPayload.data.report.id)
      .first<{ verifiedRadiusM: number | null; accuracyBucket: string }>();
    assert.deepEqual(lowRow, { verifiedRadiusM: null, accuracyBucket: "low" });

    const missingAccuracy = await rawD1Post(db, "https://api.test/api/reports", "anon_missing_accuracy_report", {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "normal",
      clientLocation: {
        latitude: 35.1532,
        longitude: 129.1186,
      },
    });
    const missingPayload = (await missingAccuracy.json()) as SuccessPayload<FieldReportData>;
    assert.equal(missingAccuracy.status, 201);
    assert.equal(missingPayload.data.report.verifiedRadiusM, null);
    assert.equal(missingPayload.data.report.accuracyBucket, "unknown");

    const invalidAccuracy = await rawD1Post(db, "https://api.test/api/reports", "anon_invalid_accuracy_report", {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "normal",
      clientLocation: {
        latitude: 35.1532,
        longitude: 129.1186,
        accuracyM: -1,
      },
    });
    const invalidPayload = (await invalidAccuracy.json()) as FailurePayload;
    assert.equal(invalidAccuracy.status, 400);
    assert.equal(invalidPayload.error.code, "VALIDATION_ERROR");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 area field reports use polygon verification without persisting raw coordinates", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [
      [
        [129.1176, 35.1522],
        [129.1196, 35.1522],
        [129.1196, 35.1542],
        [129.1176, 35.1542],
        [129.1176, 35.1522],
      ],
    ],
  });

  try {
    await db
      .prepare(
        `INSERT INTO place_metadata (place_id, normalized_name, place_kind, geometry_json, verification_radius_m)
         VALUES (?, ?, 'AREA', ?, NULL)`,
      )
      .bind("busan-gwangalli", "광안리해수욕장", polygon)
      .run();

    const inside = await rawD1Post(db, "https://api.test/api/reports", "anon_polygon_inside", {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "normal",
      clientLocation: {
        latitude: 35.1532,
        longitude: 129.1186,
        accuracyM: 18,
      },
    });
    const insidePayload = (await inside.json()) as SuccessPayload<FieldReportData>;
    assert.equal(inside.status, 201);
    assert.equal(insidePayload.data.report.verificationMethod, "polygon");
    assert.equal(insidePayload.data.report.verifiedRadiusM, null);
    assert.deepEqual(insidePayload.data.credits, [{ type: "verified_report", amount: 1 }]);

    const event = await db
      .prepare("SELECT verification_method AS verificationMethod FROM place_events WHERE id = ?")
      .bind(insidePayload.data.report.id)
      .first<{ verificationMethod: string }>();
    assert.deepEqual(event, { verificationMethod: "polygon" });

    const outside = await rawD1Post(db, "https://api.test/api/reports", "anon_polygon_outside", {
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "busy",
      clientLocation: {
        latitude: 35.155,
        longitude: 129.1186,
        accuracyM: 18,
      },
    });
    const outsidePayload = (await outside.json()) as FailurePayload;
    assert.equal(outside.status, 400);
    assert.equal(outsidePayload.error.code, "LOCATION_NOT_VERIFIED");
    assert.equal(JSON.stringify(outsidePayload).includes("35.155"), false);
    assert.equal(JSON.stringify(outsidePayload).includes("129.1186"), false);
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
    const approvalResponse = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/field-reports/${reportPayload.data.report.id}/action`,
      { status: "approved", reason: "투표 fixture 승인" },
      "test-moderator-token",
    );
    assert.equal(approvalResponse.status, 200);
    const voteUrl = `https://api.test/api/reports/${reportPayload.data.report.id}/votes`;

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
      clientLocation: { latitude: 35.1532, longitude: 129.1186, accuracyM: 18 },
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
    await enableD1FeatureFlags(db, ["SOCIAL_FEED_ENABLED"]);
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
      { DB: db, PHOTOS: r2 },
    );
    const photoPayload = (await photoResponse.json()) as SuccessPayload<PhotoCompleteData>;
    assert.equal(photoResponse.status, 201);

    await d1Post(db, "https://api.test/api/preferences", anonymousId, {
      kind: "saved_place",
      key: "busan-gwangalli",
      enabled: true,
    });
    await d1Post(db, "https://api.test/api/preferences", anonymousId, {
      kind: "followed_topic",
      key: "삭제 테스트",
      enabled: true,
    });

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
    for (const table of ["saved_places", "saved_posts", "followed_topics", "notification_subscriptions"]) {
      const count = await db
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE actor_identity_key = ?`)
        .bind(`anonymous:${storedUser?.anonymousUserId ?? ""}`)
        .first<{ count: number }>();
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

test("server-bound anonymous sessions reject stolen ids and revoked or rotated proofs", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const env = { DB: db, SILSIGAN_ANON_SESSION_REQUIRED: "1" };

  try {
    const missingProductionBinding = await worker.handleRequest(
      new Request("https://api.test/api/comments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": "anon_unbound_staging_client",
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", body: "설정 누락 환경의 요청입니다." }),
      }),
      { DB: db, ENVIRONMENT: "staging" },
    );
    const missingProductionBindingPayload = (await missingProductionBinding.json()) as FailurePayload;
    assert.equal(missingProductionBinding.status, 401);
    assert.equal(missingProductionBindingPayload.error.code, "ANONYMOUS_SESSION_PROOF_REQUIRED");

    const issueResponse = await worker.handleRequest(
      new Request("https://api.test/api/session/anonymous", { method: "POST" }),
      env,
    );
    const issued = (await issueResponse.json()) as SuccessPayload<{
      anonymousId: string;
      proof: string;
      expiresAt: string;
    }>;
    assert.equal(issueResponse.status, 201);
    assert.match(issued.data.anonymousId, /^anon_[0-9a-f-]{36}$/i);
    assert.match(issued.data.proof, /^[a-zA-Z0-9_-]{43}$/);
    assert.ok(Date.parse(issued.data.expiresAt) > Date.now());
    const sessionHash = sha256HexForTest(`silsigan-anon:${issued.data.anonymousId}`);
    const issuedSession = await db
      .prepare("SELECT last_seen_at AS lastSeenAt FROM anonymous_sessions WHERE session_hash = ?")
      .bind(sessionHash)
      .first<{ lastSeenAt: string }>();

    const legitimateWrite = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/comments", "POST", issued.data, {
        placeId: "busan-gwangalli",
        body: "증명된 익명 세션의 댓글입니다.",
      }),
      env,
    );
    assert.equal(legitimateWrite.status, 201);
    const recentlyUsedSession = await db
      .prepare("SELECT last_seen_at AS lastSeenAt FROM anonymous_sessions WHERE session_hash = ?")
      .bind(sessionHash)
      .first<{ lastSeenAt: string }>();
    assert.equal(recentlyUsedSession?.lastSeenAt, issuedSession?.lastSeenAt);

    await db.prepare("UPDATE anonymous_sessions SET last_seen_at = ? WHERE session_hash = ?").bind("2000-01-01T00:00:00.000Z", sessionHash).run();
    const staleSessionRead = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/preferences", "GET", issued.data),
      env,
    );
    assert.equal(staleSessionRead.status, 200);
    const refreshedSession = await db
      .prepare("SELECT last_seen_at AS lastSeenAt FROM anonymous_sessions WHERE session_hash = ?")
      .bind(sessionHash)
      .first<{ lastSeenAt: string }>();
    assert.ok(Date.parse(refreshedSession?.lastSeenAt ?? "") > Date.parse("2000-01-01T00:00:00.000Z"));

    const stolenIdWrite = await worker.handleRequest(
      new Request("https://api.test/api/comments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": issued.data.anonymousId,
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", body: "훔친 ID만 사용한 요청입니다." }),
      }),
      env,
    );
    const stolenIdPayload = (await stolenIdWrite.json()) as FailurePayload;
    assert.equal(stolenIdWrite.status, 401);
    assert.equal(stolenIdPayload.error.code, "ANONYMOUS_SESSION_PROOF_REQUIRED");

    const wrongProofWrite = await worker.handleRequest(
      anonymousSessionRequest(
        "https://api.test/api/comments",
        "POST",
        { anonymousId: issued.data.anonymousId, proof: "A".repeat(43) },
        { placeId: "busan-gwangalli", body: "틀린 증명값을 사용한 요청입니다." },
      ),
      env,
    );
    const wrongProofPayload = (await wrongProofWrite.json()) as FailurePayload;
    assert.equal(wrongProofWrite.status, 403);
    assert.equal(wrongProofPayload.error.code, "ANONYMOUS_SESSION_PROOF_INVALID");

    const rotateResponse = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/session/anonymous/rotate", "POST", issued.data),
      env,
    );
    const rotated = (await rotateResponse.json()) as SuccessPayload<{ anonymousId: string; proof: string; expiresAt: string }>;
    assert.equal(rotateResponse.status, 200);
    assert.equal(rotated.data.anonymousId, issued.data.anonymousId);
    assert.notEqual(rotated.data.proof, issued.data.proof);

    const oldProofWrite = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/comments", "POST", issued.data, {
        placeId: "busan-gwangalli",
        body: "회전 전 증명값을 사용한 요청입니다.",
      }),
      env,
    );
    const oldProofPayload = (await oldProofWrite.json()) as FailurePayload;
    assert.equal(oldProofWrite.status, 403);
    assert.equal(oldProofPayload.error.code, "ANONYMOUS_SESSION_PROOF_INVALID");

    const rotatedWrite = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/comments", "POST", rotated.data, {
        placeId: "busan-gwangalli",
        body: "회전된 증명값을 사용한 요청입니다.",
      }),
      env,
    );
    assert.equal(rotatedWrite.status, 201);

    const revokeResponse = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/session/anonymous", "DELETE", rotated.data),
      env,
    );
    assert.equal(revokeResponse.status, 200);

    const revokedWrite = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/comments", "POST", rotated.data, {
        placeId: "busan-gwangalli",
        body: "폐기된 세션의 요청입니다.",
      }),
      env,
    );
    const revokedPayload = (await revokedWrite.json()) as FailurePayload;
    assert.equal(revokedWrite.status, 403);
    assert.equal(revokedPayload.error.code, "ANONYMOUS_SESSION_REVOKED");

    const storedSession = await db
      .prepare("SELECT proof_hash AS proofHash FROM anonymous_sessions WHERE session_hash = ?")
      .bind(sessionHash)
      .first<{ proofHash: string }>();
    assert.match(storedSession?.proofHash ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.equal(storedSession?.proofHash.includes(rotated.data.proof), false);
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

    const approvalResponse = await rawD1AdminPostWithToken(
      db,
      `https://api.test/api/admin/field-reports/${reportPayload.data.report.id}/action`,
      { status: "approved", reason: "상태 집계 fixture 승인" },
      "test-moderator-token",
    );
    assert.equal(approvalResponse.status, 200);

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
    assert.equal(JSON.stringify(insufficient).includes("actorId"), false);
    assert.equal(JSON.stringify(insufficient).includes("actorKey"), false);

    const observedAt = reportPayload.data.report.createdAt;
    const expiresAt = new Date(new Date(observedAt).getTime() + 30 * 60 * 1_000).toISOString();
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

test("memory fallback field reports can be listed without raw location data", async () => {
  const anonymousId = "anon_memory_field_report";
  const created = await post<SuccessPayload<FieldReportData>>("https://api.test/api/reports", anonymousId, {
    placeId: "ulsan-taehwagang",
    category: "tourism",
    crowdLevel: "normal",
    lineStatus: "short",
    parkingStatus: "limited",
    weatherFeel: "windy",
    photoUrl: "https://images.example.test/taehwa-status.webp",
    clientLocation: {
      latitude: 35.5486,
      longitude: 129.3005,
      accuracyM: 18,
    },
  });
  const list = await get<SuccessPayload<Array<{ id: string; placeId: string; weatherFeel?: string; moderationStatus: string }>>>(
    "https://api.test/api/reports?placeId=ulsan-taehwagang&mine=1&limit=5",
    anonymousId,
  );
  const serializedList = JSON.stringify(list);

  assert.equal(list.meta?.storage, "memory-fallback");
  assert.equal(list.data.some((report) => report.id === created.data.report.id), true);
  assert.equal(list.data.find((report) => report.id === created.data.report.id)?.moderationStatus, "pending");
  assert.equal(list.data.find((report) => report.id === created.data.report.id)?.weatherFeel, "windy");
  assert.equal(serializedList.includes("35.5486"), false);
  assert.equal(serializedList.includes("129.3005"), false);
  assert.equal(serializedList.includes("images.example.test"), false);
  assert.equal(serializedList.includes(anonymousId), false);
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

    await db.prepare("UPDATE photo_storage_budget SET active_bytes = 200000 WHERE id = 1").run();

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
    const budgetAfterDelete = await db.prepare("SELECT active_bytes AS activeBytes FROM photo_storage_budget WHERE id = 1").first<{ activeBytes: number }>();
    assert.equal(budgetAfterDelete?.activeBytes, 100_000);
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

    const repeatedDelete = await worker.handleRequest(
      new Request("https://api.test/api/admin/moderation/delete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-admin-token",
        },
        body: JSON.stringify({
          targetType: "photo",
          targetId: photo.data.photo.id,
          reason: "동일 사진 삭제 재시도",
        }),
      }),
      { DB: db, ADMIN_TOKENS: testAdminTokens, PHOTOS: r2, CACHE: cache },
    );
    const repeatedDeletePayload = (await repeatedDelete.json()) as FailurePayload;
    assert.equal(repeatedDelete.status, 404);
    assert.equal(repeatedDeletePayload.error.code, "MODERATION_TARGET_NOT_FOUND");
    const budgetAfterRepeatedDelete = await db.prepare("SELECT active_bytes AS activeBytes FROM photo_storage_budget WHERE id = 1").first<{ activeBytes: number }>();
    assert.equal(budgetAfterRepeatedDelete?.activeBytes, 100_000);
    assert.deepEqual(r2.deletedKeys, [photo.data.storageKey]);

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
        byteSize: 100_000,
        width: 800,
        height: 600,
        rightsAttested: true,
        rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
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
    { PHOTOS: r2 },
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

test("photo upload-ticket accepts multipart binary and sanitizes before R2", async () => {
  const anonymousId = "anon_photo_multipart_test";
  const r2 = new FakeR2Bucket();
  const source = new Uint8Array([...jpegWithGpsExifSample(), 0]);

  const ticketResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload-ticket", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
      },
      body: JSON.stringify({
        placeId: "busan-gwangalli",
        mimeType: "image/jpeg",
        byteSize: source.byteLength,
        width: 1,
        height: 1,
        rightsAttested: true,
        rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
      }),
    }),
    { PHOTOS: r2 },
  );
  const ticketPayload = (await ticketResponse.json()) as SuccessPayload<{
    uploadId: string;
    method: string;
    uploadUrl: string;
    storageKey: string;
  }>;

  assert.equal(ticketResponse.status, 201);
  assert.equal(ticketPayload.data.method, "POST");
  assert.equal(ticketPayload.data.uploadUrl, "/api/photos/upload");

  const formData = new FormData();
  formData.set("uploadId", ticketPayload.data.uploadId);
  formData.set("placeId", "busan-gwangalli");
  formData.set("byteSize", String(source.byteLength));
  formData.set("mimeType", "image/jpeg");
  formData.set("width", "1");
  formData.set("height", "1");
  formData.set("clientReencoded", "true");
  formData.set("file", new Blob([source], { type: "image/jpeg" }), "camera-name.jpg");

  const uploadResponse = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload", {
      method: "POST",
      headers: { "x-silsigan-anon-id": anonymousId },
      body: formData,
    }),
    { PHOTOS: r2 },
  );
  const uploadPayload = (await uploadResponse.json()) as SuccessPayload<PhotoCompleteData>;

  assert.equal(uploadResponse.status, 201);
  assert.equal(r2.putObjects.length, 1);
  assert.equal(r2.putObjects[0]?.contentType, "image/jpeg");
  assert.equal(r2.putObjects[0]?.customMetadata?.gpsExifStripped, "true");
  assert.equal(containsAscii(r2.putObjects[0]?.bytes ?? new Uint8Array(), "GPSLatitude"), false);
  assert.equal(uploadPayload.data.photo.mimeType, "image/jpeg");
  assert.equal(uploadPayload.data.photo.byteSize, r2.putObjects[0]?.bytes.byteLength);
});

test("staging photo upload rejects a forged ticket before R2", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const limiter = new FakeRateLimitBinding();
  const env = securedPhotoEnv(db, r2, limiter);
  const source = new Uint8Array([...jpegWithGpsExifSample(), 31]);

  try {
    const response = await completeSecuredPhoto(env, "anon_photo_forged_ticket", source, {
      uploadId: "upload_00000000-0000-4000-8000-000000000001",
      ticket: "0".repeat(64),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "PHOTO_UPLOAD_TICKET_INVALID");
    assert.equal(r2.putObjects.length, 0);
    assert.equal(limiter.calls.length, 1);
    assert.equal(limiter.calls[0]?.includes(testPhotoClientIp), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("photo upload ticket requires the current per-photo rights attestation before abuse controls", async () => {
  let dbTouched = false;
  const db = {
    prepare() {
      dbTouched = true;
      throw new Error("D1 must not be reached before rights validation");
    },
  };
  const response = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload-ticket", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": "anon_photo_rights_missing",
      },
      body: JSON.stringify({
        placeId: "busan-gwangalli",
        mimeType: "image/jpeg",
        byteSize: 256,
        width: 1,
        height: 1,
        rightsAttested: false,
        rightsPolicyVersion: "outdated-photo-rights-policy",
      }),
    }),
    {
      DB: db as never,
      SILSIGAN_PHOTO_TURNSTILE_REQUIRED: "1",
    },
  );
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "PHOTO_RIGHTS_ATTESTATION_REQUIRED");
  assert.equal(dbTouched, false);
});

test("photo upload ticket records one idempotent versioned community acceptance", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const anonymousId = "anon_photo_rights_recorded";
  const request = () => new Request("https://api.test/api/photos/upload-ticket", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-silsigan-anon-id": anonymousId,
    },
    body: JSON.stringify({
      placeId: "busan-gwangalli",
      mimeType: "image/jpeg",
      byteSize: 256,
      width: 1,
      height: 1,
      rightsAttested: true,
      rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
    }),
  });

  try {
    const firstResponse = await worker.handleRequest(request(), { DB: db });
    const firstPayload = (await firstResponse.json()) as SuccessPayload<{ rightsPolicyVersion: string }>;
    const secondResponse = await worker.handleRequest(request(), { DB: db });
    const acceptances = await db
      .prepare(
        `SELECT actor_identity_key AS actorIdentityKey, terms_type AS termsType, version, accepted_at AS acceptedAt, withdrawn_at AS withdrawnAt
         FROM terms_acceptances`,
      )
      .all<{
        actorIdentityKey: string;
        termsType: string;
        version: string;
        acceptedAt: string;
        withdrawnAt: string | null;
      }>();

    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 201);
    assert.equal(firstPayload.data.rightsPolicyVersion, PHOTO_RIGHTS_TERMS_VERSION);
    assert.equal(acceptances.results?.length, 1);
    assert.match(acceptances.results?.[0]?.actorIdentityKey ?? "", /^anonymous:anon_[0-9a-f]{48}$/);
    assert.equal(acceptances.results?.[0]?.termsType, "community");
    assert.equal(acceptances.results?.[0]?.version, PHOTO_RIGHTS_TERMS_VERSION);
    assert.ok(Date.parse(acceptances.results?.[0]?.acceptedAt ?? "") > 0);
    assert.equal(acceptances.results?.[0]?.withdrawnAt, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo ticket rejects a missing Turnstile proof before D1", async () => {
  let dbTouched = false;
  const db = {
    prepare() {
      dbTouched = true;
      throw new Error("D1 must not be reached before Turnstile validation");
    },
  };
  const response = await worker.handleRequest(
    photoTicketRequest("anon_turnstile_missing", undefined, "https://web.example.test"),
    {
      DB: db as never,
      ENVIRONMENT: "staging",
      SILSIGAN_ANON_SESSION_REQUIRED: "0",
      SILSIGAN_API_ALLOWED_ORIGINS: "https://web.example.test",
      SILSIGAN_PHOTO_TURNSTILE_REQUIRED: "1",
      SILSIGAN_TURNSTILE_SITE_KEY: "turnstile-public-site-key",
      SILSIGAN_TURNSTILE_SECRET_KEY: testTurnstileSecret,
      PHOTO_UPLOAD_RATE_LIMITER: new FakeRateLimitBinding(),
    },
  );
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, "PHOTO_TURNSTILE_TOKEN_REQUIRED");
  assert.equal(dbTouched, false);
});

test("staging photo ticket validates Turnstile action, hostname, client IP, and one-use token before D1", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  const siteverifyRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    siteverifyRequests.push({ url, body });
    return Response.json({
      success: true,
      hostname: "web.example.test",
      action: "photo_upload",
      "error-codes": [],
    });
  };

  try {
    const env = {
      DB: db,
      ENVIRONMENT: "staging",
      SILSIGAN_ANON_SESSION_REQUIRED: "0",
      SILSIGAN_API_ALLOWED_ORIGINS: "https://web.example.test",
      SILSIGAN_PHOTO_TURNSTILE_REQUIRED: "1",
      SILSIGAN_TURNSTILE_SITE_KEY: "turnstile-public-site-key",
      SILSIGAN_TURNSTILE_SECRET_KEY: testTurnstileSecret,
      SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET: testPhotoUploadSecret,
      PHOTO_UPLOAD_RATE_LIMITER: new FakeRateLimitBinding(),
    };
    const response = await worker.handleRequest(
      photoTicketRequest("anon_turnstile_valid", "turnstile-one-use-token", "https://web.example.test"),
      env,
    );
    const payload = (await response.json()) as SuccessPayload<PhotoUploadTicketData>;

    assert.equal(response.status, 201);
    assert.match(payload.data.ticket, /^[0-9a-f]{64}$/i);
    assert.equal(siteverifyRequests.length, 1);
    assert.equal(siteverifyRequests[0]?.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(siteverifyRequests[0]?.body.response, "turnstile-one-use-token");
    assert.equal(siteverifyRequests[0]?.body.remoteip, testPhotoClientIp);
    assert.equal(siteverifyRequests[0]?.body.secret, testTurnstileSecret);
    assert.match(String(siteverifyRequests[0]?.body.idempotency_key), /^[0-9a-f-]{36}$/i);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo ticket fails closed when Turnstile returns a mismatched action or hostname", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => Response.json({
    success: true,
    hostname: "attacker.example.test",
    action: "different_action",
    "error-codes": [],
  });

  try {
    const response = await worker.handleRequest(
      photoTicketRequest("anon_turnstile_mismatch", "turnstile-mismatched-token", "https://web.example.test"),
      {
        DB: db,
        ENVIRONMENT: "staging",
        SILSIGAN_ANON_SESSION_REQUIRED: "0",
        SILSIGAN_API_ALLOWED_ORIGINS: "https://web.example.test",
        SILSIGAN_PHOTO_TURNSTILE_REQUIRED: "1",
        SILSIGAN_TURNSTILE_SITE_KEY: "turnstile-public-site-key",
        SILSIGAN_TURNSTILE_SECRET_KEY: testTurnstileSecret,
        SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET: testPhotoUploadSecret,
        PHOTO_UPLOAD_RATE_LIMITER: new FakeRateLimitBinding(),
      },
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "PHOTO_TURNSTILE_VERIFICATION_FAILED");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo ticket fails closed before D1 when Turnstile is unavailable", async () => {
  let dbTouched = false;
  const db = {
    prepare() {
      dbTouched = true;
      throw new Error("D1 must not be reached when Turnstile is unavailable");
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    throw new Error("provider unavailable");
  };

  try {
    const response = await worker.handleRequest(
      photoTicketRequest("anon_turnstile_unavailable", "turnstile-provider-down-token", "https://web.example.test"),
      {
        DB: db as never,
        ENVIRONMENT: "staging",
        SILSIGAN_ANON_SESSION_REQUIRED: "0",
        SILSIGAN_API_ALLOWED_ORIGINS: "https://web.example.test",
        SILSIGAN_PHOTO_TURNSTILE_REQUIRED: "1",
        SILSIGAN_TURNSTILE_SITE_KEY: "turnstile-public-site-key",
        SILSIGAN_TURNSTILE_SECRET_KEY: testTurnstileSecret,
        PHOTO_UPLOAD_RATE_LIMITER: new FakeRateLimitBinding(),
      },
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "PHOTO_TURNSTILE_UNAVAILABLE");
    assert.equal(dbTouched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("staging photo upload accepts one signed ticket and rejects its replay", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const limiter = new FakeRateLimitBinding();
  const env = securedPhotoEnv(db, r2, limiter);
  const source = new Uint8Array([...jpegWithGpsExifSample(), 32]);

  try {
    const ticket = await issueSecuredPhotoTicket(env, "anon_photo_ticket_replay", source);
    const first = await completeSecuredPhoto(env, "anon_photo_ticket_replay", source, ticket);
    const replay = await completeSecuredPhoto(env, "anon_photo_ticket_replay", source, ticket);
    const replayPayload = (await replay.json()) as FailurePayload;
    const claims = await db.prepare("SELECT COUNT(*) AS count FROM photo_upload_claims WHERE upload_id = ?").bind(ticket.uploadId).first<{ count: number }>();

    assert.equal(first.status, 201);
    assert.equal(replay.status, 409);
    assert.equal(replayPayload.error.code, "PHOTO_UPLOAD_TICKET_REPLAYED");
    assert.equal(r2.putObjects.length, 1);
    assert.equal(claims?.count, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cloudflare photo rate limiter blocks a write before ticket claim and R2", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const limiter = new FakeRateLimitBinding([true, false]);
  const env = securedPhotoEnv(db, r2, limiter);
  const source = new Uint8Array([...jpegWithGpsExifSample(), 33]);

  try {
    const ticket = await issueSecuredPhotoTicket(env, "anon_photo_edge_rate_limit", source);
    const response = await completeSecuredPhoto(env, "anon_photo_edge_rate_limit", source, ticket);
    const payload = (await response.json()) as FailurePayload;
    const claims = await db.prepare("SELECT COUNT(*) AS count FROM photo_upload_claims WHERE upload_id = ?").bind(ticket.uploadId).first<{ count: number }>();

    assert.equal(response.status, 429);
    assert.equal(payload.error.code, "PHOTO_UPLOAD_RATE_LIMITED");
    assert.equal(claims?.count, 0);
    assert.equal(r2.putObjects.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily per-IP photo budget blocks a second upload before image processing and R2", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const limiter = new FakeRateLimitBinding();
  const env = securedPhotoEnv(db, r2, limiter, { SILSIGAN_PHOTO_DAILY_UPLOAD_LIMIT: "1" });
  const firstSource = new Uint8Array([...jpegWithGpsExifSample(), 34]);
  const secondSource = new Uint8Array([...jpegWithGpsExifSample(), 35]);

  try {
    const firstTicket = await issueSecuredPhotoTicket(env, "anon_photo_daily_budget", firstSource);
    const first = await completeSecuredPhoto(env, "anon_photo_daily_budget", firstSource, firstTicket);
    const secondTicket = await issueSecuredPhotoTicket(env, "anon_photo_daily_budget", secondSource);
    const second = await completeSecuredPhoto(env, "anon_photo_daily_budget", secondSource, secondTicket);
    const payload = (await second.json()) as FailurePayload;

    assert.equal(first.status, 201);
    assert.equal(second.status, 429);
    assert.equal(payload.error.code, "PHOTO_DAILY_UPLOAD_LIMIT_EXHAUSTED");
    assert.equal(r2.putObjects.length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("photo read rate limiter blocks an R2 Class B read", async () => {
  const anonymousId = "anon_photo_read_rate_limit";
  const r2 = new FakeR2Bucket();
  const source = new Uint8Array([...jpegWithGpsExifSample(), 36]);
  const complete = await worker.handleRequest(
    new Request("https://api.test/api/photos/complete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-silsigan-anon-id": anonymousId },
      body: JSON.stringify({
        uploadId: "upload_read_rate_limit",
        placeId: "busan-gwangalli",
        byteSize: source.byteLength,
        mimeType: "image/jpeg",
        width: 1,
        height: 1,
        clientReencoded: true,
        imageBase64: bytesToBase64(source),
      }),
    }),
    { PHOTOS: r2 },
  );
  const completePayload = (await complete.json()) as SuccessPayload<PhotoCompleteData>;
  const readLimiter = new FakeRateLimitBinding(false);
  const read = await worker.handleRequest(
    new Request(`https://api.test/api/photos/${completePayload.data.photo.id}/file`, {
      headers: { "cf-connecting-ip": testPhotoClientIp },
    }),
    { PHOTOS: r2, PHOTO_READ_RATE_LIMITER: readLimiter },
  );
  const readPayload = (await read.json()) as FailurePayload;

  assert.equal(complete.status, 201);
  assert.equal(read.status, 429);
  assert.equal(readPayload.error.code, "PHOTO_READ_RATE_LIMITED");
  assert.equal(r2.getKeys.length, 0);
});

test("canonical photo cache prevents repeated R2 reads and cannot bypass the emergency stop", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const cache = new FakeWorkerCache();
  const previousCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { default: cache },
  });
  const env = {
    ...securedPhotoEnv(db, r2, new FakeRateLimitBinding(), { SILSIGAN_PHOTO_DAILY_IP_READ_LIMIT: "5" }),
    PHOTO_READ_RATE_LIMITER: new FakeRateLimitBinding(),
  };
  const source = new Uint8Array([...jpegWithGpsExifSample(), 73]);
  const waitUntilPromises: Array<Promise<unknown>> = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>): void {
      waitUntilPromises.push(promise);
    },
  };

  try {
    const ticket = await issueSecuredPhotoTicket(env, "anon_photo_cache", source);
    const complete = await completeSecuredPhoto(env, "anon_photo_cache", source, ticket);
    const completePayload = (await complete.json()) as SuccessPayload<PhotoCompleteData>;
    await d1AdminPost(
      db,
      `https://api.test/api/admin/photos/${completePayload.data.photo.id}/moderation`,
      { decision: "approved", reason: "cache safety fixture approved" },
      { PHOTOS: r2 },
      "test-moderator-token",
    );

    const first = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${completePayload.data.photo.id}/file?tracking=first`, {
        headers: { "cf-connecting-ip": "203.0.113.70" },
      }),
      env,
      ctx,
    );
    assert.equal(first.status, 200);
    await first.arrayBuffer();
    await Promise.all(waitUntilPromises.splice(0));

    const second = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${completePayload.data.photo.id}/file?tracking=second`, {
        headers: { "cf-connecting-ip": "203.0.113.70" },
      }),
      env,
      ctx,
    );
    assert.equal(second.status, 200);
    await second.arrayBuffer();

    const budget = await db
      .prepare("SELECT reads_in_day AS readsInDay FROM photo_read_budget WHERE id = 1")
      .first<{ readsInDay: number }>();
    const abuse = await db
      .prepare("SELECT read_count AS readCount FROM photo_read_abuse_budget")
      .first<{ readCount: number }>();
    assert.equal(r2.getKeys.length, 1);
    assert.equal(budget?.readsInDay, 1);
    assert.equal(abuse?.readCount, 1);
    assert.deepEqual(cache.putUrls, [`https://silsigan-photo-cache.invalid/v1/${completePayload.data.photo.id}`]);

    const stop = await worker.handleRequest(
      new Request("https://api.test/api/admin/photo-cost-guard", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-admin-token",
          "x-silsigan-admin-subject": "cost-owner@example.test",
        },
        body: JSON.stringify({ uploadsEnabled: false, readsEnabled: false, reason: "cache bypass emergency stop" }),
      }),
      { ...env, ADMIN_TOKENS: testAdminTokens },
    );
    assert.equal(stop.status, 200);

    const blocked = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${completePayload.data.photo.id}/file`, {
        headers: { "cf-connecting-ip": "203.0.113.70" },
      }),
      env,
      ctx,
    );
    const blockedPayload = (await blocked.json()) as FailurePayload;
    assert.equal(blocked.status, 503);
    assert.equal(blockedPayload.error.code, "PHOTO_READS_DISABLED");
    assert.equal(r2.getKeys.length, 1);
  } finally {
    if (previousCaches) {
      Object.defineProperty(globalThis, "caches", previousCaches);
    } else {
      Reflect.deleteProperty(globalThis, "caches");
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("per-IP daily photo read guard stops one attacker before the global R2 budget", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const env = {
    ...securedPhotoEnv(db, r2, new FakeRateLimitBinding(), {
      SILSIGAN_PHOTO_DAILY_IP_READ_LIMIT: "1",
      SILSIGAN_PHOTO_MONTHLY_READ_LIMIT: "100",
      SILSIGAN_PHOTO_DAILY_READ_LIMIT: "100",
    }),
    PHOTO_READ_RATE_LIMITER: new FakeRateLimitBinding(),
  };

  try {
    const photoIds: string[] = [];
    for (const [index, suffix] of [74, 75].entries()) {
      const source = new Uint8Array([...jpegWithGpsExifSample(), suffix]);
      const ticket = await issueSecuredPhotoTicket(env, `anon_photo_ip_limit_${index}`, source);
      const complete = await completeSecuredPhoto(env, `anon_photo_ip_limit_${index}`, source, ticket);
      const payload = (await complete.json()) as SuccessPayload<PhotoCompleteData>;
      photoIds.push(payload.data.photo.id);
      await d1AdminPost(
        db,
        `https://api.test/api/admin/photos/${payload.data.photo.id}/moderation`,
        { decision: "approved", reason: `IP budget fixture ${index} approved` },
        { PHOTOS: r2 },
        "test-moderator-token",
      );
    }

    const first = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${photoIds[0]}/file`, {
        headers: { "cf-connecting-ip": "203.0.113.71" },
      }),
      env,
    );
    const blocked = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${photoIds[1]}/file`, {
        headers: { "cf-connecting-ip": "203.0.113.71" },
      }),
      env,
    );
    const blockedPayload = (await blocked.json()) as FailurePayload;
    const budget = await db
      .prepare("SELECT reads_in_day AS readsInDay FROM photo_read_budget WHERE id = 1")
      .first<{ readsInDay: number }>();
    const abuse = await db
      .prepare("SELECT principal_hash AS principalHash, read_count AS readCount FROM photo_read_abuse_budget")
      .first<{ principalHash: string; readCount: number }>();
    const control = await db
      .prepare("SELECT reads_enabled AS readsEnabled FROM photo_read_control WHERE id = 1")
      .first<{ readsEnabled: number }>();

    assert.equal(first.status, 200);
    assert.equal(blocked.status, 429);
    assert.equal(blockedPayload.error.code, "PHOTO_DAILY_IP_READ_LIMIT_EXHAUSTED");
    assert.equal(r2.getKeys.length, 1);
    assert.equal(budget?.readsInDay, 1);
    assert.equal(abuse?.readCount, 1);
    assert.match(abuse?.principalHash ?? "", /^hmac-sha256:[a-f0-9]{64}$/);
    assert.equal(abuse?.principalHash.includes("203.0.113.71"), false);
    assert.equal(control?.readsEnabled, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging photo read fails closed before R2 when the per-IP ledger is missing", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const env = {
    ...securedPhotoEnv(db, r2, new FakeRateLimitBinding()),
    PHOTO_READ_RATE_LIMITER: new FakeRateLimitBinding(),
  };
  const source = new Uint8Array([...jpegWithGpsExifSample(), 76]);

  try {
    const ticket = await issueSecuredPhotoTicket(env, "anon_photo_missing_read_ledger", source);
    const complete = await completeSecuredPhoto(env, "anon_photo_missing_read_ledger", source, ticket);
    const payload = (await complete.json()) as SuccessPayload<PhotoCompleteData>;
    await d1AdminPost(
      db,
      `https://api.test/api/admin/photos/${payload.data.photo.id}/moderation`,
      { decision: "approved", reason: "missing read ledger fixture approved" },
      { PHOTOS: r2 },
      "test-moderator-token",
    );
    await db.prepare("DROP TABLE photo_read_abuse_budget").run();

    const response = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${payload.data.photo.id}/file`, {
        headers: { "cf-connecting-ip": "203.0.113.72" },
      }),
      env,
    );
    const responsePayload = (await response.json()) as FailurePayload;
    const budget = await db
      .prepare("SELECT reads_in_day AS readsInDay FROM photo_read_budget WHERE id = 1")
      .first<{ readsInDay: number }>();

    assert.equal(response.status, 503);
    assert.equal(responsePayload.error.code, "PHOTO_READ_ABUSE_GUARD_UNAVAILABLE");
    assert.equal(r2.getKeys.length, 0);
    assert.equal(budget?.readsInDay, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global monthly Class B budget stops distributed photo reads at the conservative 80 percent threshold", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const limiter = new FakeRateLimitBinding();
  const env = securedPhotoEnv(db, r2, limiter, {
    SILSIGAN_PHOTO_MONTHLY_READ_LIMIT: "5",
    COST_ALERT_WEBHOOK_URL: "https://alerts.example.test/silsigan/cost",
  });
  const source = new Uint8Array([...jpegWithGpsExifSample(), 61]);
  const waitUntilPromises: Array<Promise<unknown>> = [];
  const sentRequests: Request[] = [];
  const originalFetch = globalThis.fetch;
  const ctx = {
    waitUntil(promise: Promise<unknown>): void {
      waitUntilPromises.push(promise);
    },
  };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sentRequests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({ ok: true }, { status: 202 });
  };

  try {
    const ticket = await issueSecuredPhotoTicket(env, "anon_photo_global_read_budget", source);
    const complete = await completeSecuredPhoto(env, "anon_photo_global_read_budget", source, ticket);
    const completePayload = (await complete.json()) as SuccessPayload<PhotoCompleteData>;
    await d1AdminPost(
      db,
      `https://api.test/api/admin/photos/${completePayload.data.photo.id}/moderation`,
      { decision: "approved", reason: "read budget fixture approved" },
      { PHOTOS: r2 },
      "test-moderator-token",
    );

    const readEnv = { ...env, PHOTO_READ_RATE_LIMITER: new FakeRateLimitBinding() };
    for (let index = 0; index < 4; index += 1) {
      const response = await worker.handleRequest(
        new Request(`https://api.test/api/photos/${completePayload.data.photo.id}/file`, {
          headers: { "cf-connecting-ip": `203.0.113.${index + 10}` },
        }),
        readEnv,
        ctx,
      );
      assert.equal(response.status, 200);
    }

    const blocked = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${completePayload.data.photo.id}/file`, {
        headers: { "cf-connecting-ip": "198.51.100.50" },
      }),
      readEnv,
      ctx,
    );
    const blockedPayload = (await blocked.json()) as FailurePayload;
    await Promise.all(waitUntilPromises);
    const guard = await worker.handleRequest(
      new Request("https://api.test/api/admin/photo-cost-guard", {
        headers: { "x-silsigan-admin-token": "test-admin-token" },
      }),
      { ...env, ADMIN_TOKENS: testAdminTokens },
    );
    const guardPayload = (await guard.json()) as SuccessPayload<PhotoCostGuardData>;

    assert.equal(blocked.status, 503);
    assert.equal(blockedPayload.error.code, "PHOTO_READS_DISABLED");
    assert.equal(r2.getKeys.length, 4);
    assert.equal(guardPayload.data.readsEnabled, false);
    assert.equal(guardPayload.data.readsInPeriod, 4);
    assert.equal(guardPayload.data.monthlyReadStopLimit, 4);
    assert.equal(sentRequests.length, 1);
    const alert = (await sentRequests[0]?.json()) as PhotoCostAlertPayload;
    assert.equal(alert.type, "cost.photo-reads.stopped");
    assert.equal(alert.reason, "automatic-80-percent-monthly-read-cost-guard");
    assert.equal(alert.readsInPeriod, 4);
    assert.equal(alert.monthlyReadStopLimit, 4);
    assert.equal(JSON.stringify(alert).includes("203.0.113"), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily D1 write budget stops distributed photo reads before the free daily write allowance", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const limiter = new FakeRateLimitBinding();
  const env = securedPhotoEnv(db, r2, limiter, {
    SILSIGAN_PHOTO_MONTHLY_READ_LIMIT: "100",
    SILSIGAN_PHOTO_DAILY_READ_LIMIT: "5",
    COST_ALERT_WEBHOOK_URL: "https://alerts.example.test/silsigan/cost",
  });
  const source = new Uint8Array([...jpegWithGpsExifSample(), 62]);
  const waitUntilPromises: Array<Promise<unknown>> = [];
  const sentRequests: Request[] = [];
  const originalFetch = globalThis.fetch;
  const ctx = {
    waitUntil(promise: Promise<unknown>): void {
      waitUntilPromises.push(promise);
    },
  };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sentRequests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({ ok: true }, { status: 202 });
  };

  try {
    const ticket = await issueSecuredPhotoTicket(env, "anon_photo_daily_read_budget", source);
    const complete = await completeSecuredPhoto(env, "anon_photo_daily_read_budget", source, ticket);
    const completePayload = (await complete.json()) as SuccessPayload<PhotoCompleteData>;
    await d1AdminPost(
      db,
      `https://api.test/api/admin/photos/${completePayload.data.photo.id}/moderation`,
      { decision: "approved", reason: "daily read budget fixture approved" },
      { PHOTOS: r2 },
      "test-moderator-token",
    );

    const readEnv = { ...env, PHOTO_READ_RATE_LIMITER: new FakeRateLimitBinding() };
    for (let index = 0; index < 4; index += 1) {
      const response = await worker.handleRequest(
        new Request(`https://api.test/api/photos/${completePayload.data.photo.id}/file`, {
          headers: { "cf-connecting-ip": `192.0.2.${index + 20}` },
        }),
        readEnv,
        ctx,
      );
      assert.equal(response.status, 200);
    }

    const blocked = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${completePayload.data.photo.id}/file`, {
        headers: { "cf-connecting-ip": "198.51.100.60" },
      }),
      readEnv,
      ctx,
    );
    const blockedPayload = (await blocked.json()) as FailurePayload;
    await Promise.all(waitUntilPromises);
    const guard = await worker.handleRequest(
      new Request("https://api.test/api/admin/photo-cost-guard", {
        headers: { "x-silsigan-admin-token": "test-admin-token" },
      }),
      { ...env, ADMIN_TOKENS: testAdminTokens },
    );
    const guardPayload = (await guard.json()) as SuccessPayload<PhotoCostGuardData>;

    assert.equal(blocked.status, 503);
    assert.equal(blockedPayload.error.code, "PHOTO_READS_DISABLED");
    assert.equal(r2.getKeys.length, 4);
    assert.equal(guardPayload.data.readsEnabled, false);
    assert.equal(guardPayload.data.readsInDay, 4);
    assert.equal(guardPayload.data.dailyReadStopLimit, 4);
    assert.equal(sentRequests.length, 1);
    const alert = (await sentRequests[0]?.json()) as PhotoCostAlertPayload;
    assert.equal(alert.type, "cost.photo-reads.stopped");
    assert.equal(alert.reason, "automatic-80-percent-daily-read-cost-guard");
    assert.equal(alert.readsInDay, 4);
    assert.equal(alert.dailyReadStopLimit, 4);
    assert.equal(JSON.stringify(alert).includes("192.0.2"), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global API guard degrades at 70 percent and keeps essential reads on a write-free snapshot", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const env = {
    DB: db,
    SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
    SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT: "100",
    SILSIGAN_D1_DAILY_READ_LIMIT: "1000",
    SILSIGAN_D1_DAILY_WRITE_LIMIT: "1000",
  };

  try {
    for (let index = 0; index < 7; index += 1) {
      const response = await worker.handleRequest(new Request("https://api.test/api/places?limit=1"), env);
      assert.equal(response.status, 200);
    }
    const control = await db
      .prepare("SELECT mode, automatic_metric AS automaticMetric FROM api_cost_guard_control WHERE id = 1")
      .first<{ mode: string; automaticMetric: string }>();
    assert.deepEqual(control, { mode: "degraded", automaticMetric: "d1_rows_read" });

    const fallbackResponse = await worker.handleRequest(
      new Request("https://api.test/api/places?limit=1", {
        headers: {
          "x-silsigan-anon-id": "anon_invalid_public_header",
          "x-silsigan-anon-proof": "invalid-proof",
        },
      }),
      env,
    );
    const fallbackPayload = (await fallbackResponse.json()) as SuccessPayload<unknown[]>;
    const dailyAfterFallback = await db
      .prepare("SELECT reserved_rows_read AS reservedRowsRead FROM api_cost_guard_daily")
      .first<{ reservedRowsRead: number }>();
    assert.equal(fallbackResponse.status, 200);
    assert.equal(fallbackPayload.meta?.storage, "memory-fallback");
    assert.equal(dailyAfterFallback?.reservedRowsRead, 700);

    const nonessential = await worker.handleRequest(new Request("https://api.test/api/hashtags"), env);
    const nonessentialPayload = (await nonessential.json()) as FailurePayload;
    assert.equal(nonessential.status, 429);
    assert.equal(nonessentialPayload.error.code, "API_COST_GUARD_DEGRADED");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global API guard reads its KV mirror only once for a public reservation", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const costGuardState = new FakeKVNamespace();
  costGuardState.values.set("api-cost-guard:global:v1", JSON.stringify({
    mode: "running",
    reason: "fixture-running",
    generation: 1,
    automaticMetric: null,
    updatedBy: "system:fixture",
    updatedAt: new Date().toISOString(),
  }));

  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/places?limit=1"),
      {
        DB: db,
        COST_GUARD_STATE: costGuardState,
        SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
        SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT: "1000",
        SILSIGAN_D1_DAILY_READ_LIMIT: "10000",
        SILSIGAN_D1_DAILY_WRITE_LIMIT: "10000",
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(costGuardState.getKeys, ["api-cost-guard:global:v1"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global API guard emits one redacted warning when usage first reaches 60 percent", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const warningWebhookUrl = "https://alerts.example.test/silsigan/api-cost-warning-fixture";
  const sentRequests: Request[] = [];
  const waitUntilPromises: Array<Promise<unknown>> = [];
  const originalFetch = globalThis.fetch;
  const ctx = {
    waitUntil(promise: Promise<unknown>): void {
      waitUntilPromises.push(promise);
    },
  };
  const env = {
    DB: db,
    SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
    SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT: "100",
    SILSIGAN_D1_DAILY_READ_LIMIT: "1000",
    SILSIGAN_D1_DAILY_WRITE_LIMIT: "1000",
    COST_ALERT_WEBHOOK_URL: warningWebhookUrl,
    COST_ALERT_WEBHOOK_TOKEN: "api-cost-alert-token-fixture",
    ENVIRONMENT: "staging",
  };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sentRequests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({ ok: true }, { status: 202 });
  };

  try {
    for (let index = 0; index < 6; index += 1) {
      const response = await worker.handleRequest(
        new Request("https://api.test/api/places?limit=1", {
          headers: { "cf-connecting-ip": `198.51.100.${index + 1}` },
        }),
        env,
        ctx,
      );
      assert.equal(response.status, 200);
    }
    await Promise.all(waitUntilPromises);

    const control = await db
      .prepare("SELECT mode, generation FROM api_cost_guard_control WHERE id = 1")
      .first<{ mode: string; generation: number }>();
    assert.deepEqual(control, { mode: "running", generation: 1 });
    const warningRequests = sentRequests.filter((request) => request.url === warningWebhookUrl);
    const warningPayloads = await Promise.all(warningRequests.map((request) => request.clone().json()));
    assert.equal(warningRequests.length, 1, JSON.stringify(warningPayloads));
    assert.equal(warningRequests[0]?.headers.get("authorization"), "Bearer api-cost-alert-token-fixture");
    const alert = (await warningRequests[0]?.json()) as ApiCostGuardAlertPayload;
    assert.equal(alert.type, "cost.api-guard.warning");
    assert.equal(alert.mode, "running");
    assert.equal(alert.metric, "d1_rows_read");
    assert.equal(alert.thresholdPercent, 60);
    assert.equal(alert.generation, 1);
    assert.equal(alert.environment, "staging");
    assert.equal(alert.guardPath, "/api/admin/api-cost-guard");
    assert.equal(JSON.stringify(alert).includes("198.51.100"), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global API guard preserves the final reserve for privacy deletion and stops at 80 percent", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const stopWebhookUrl = "https://alerts.example.test/silsigan/api-cost-stop-fixture";
  const sentRequests: Request[] = [];
  const waitUntilPromises: Array<Promise<unknown>> = [];
  const originalFetch = globalThis.fetch;
  const ctx = {
    waitUntil(promise: Promise<unknown>): void {
      waitUntilPromises.push(promise);
    },
  };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sentRequests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({ ok: true }, { status: 202 });
  };

  try {
    const session = await issueVerifiedAnonymousSession(db);
    const dayUtc = new Date().toISOString().slice(0, 10);
    await db
      .prepare(
        `INSERT INTO api_cost_guard_daily (
           day_utc, observed_workers_requests, observed_rows_read, observed_rows_written, updated_at
         ) VALUES (?, 0, 7900, 0, ?)`,
      )
      .bind(dayUtc, new Date().toISOString())
      .run();
    await db
      .prepare("UPDATE api_cost_guard_control SET mode = 'degraded', reason = 'test-70-percent', generation = 2 WHERE id = 1")
      .run();
    const env = {
      DB: db,
      SILSIGAN_ANON_SESSION_REQUIRED: "1",
      SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
      SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT: "100",
      SILSIGAN_D1_DAILY_READ_LIMIT: "10000",
      SILSIGAN_D1_DAILY_WRITE_LIMIT: "1000",
      COST_ALERT_WEBHOOK_URL: stopWebhookUrl,
      ENVIRONMENT: "staging",
    };
    const response = await worker.handleRequest(
      anonymousSessionRequest("https://api.test/api/account/deletion", "POST", session, { confirmation: "DELETE_MY_ACCOUNT" }),
      env,
      ctx,
    );
    const payload = (await response.json()) as FailurePayload;
    await Promise.all(waitUntilPromises);
    const control = await db
      .prepare("SELECT mode, automatic_metric AS automaticMetric FROM api_cost_guard_control WHERE id = 1")
      .first<{ mode: string; automaticMetric: string }>();
    const deletion = await db.prepare("SELECT COUNT(*) AS count FROM account_deletion_requests").first<{ count: number }>();

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "API_COST_GUARD_80_PERCENT_STOP");
    assert.deepEqual(control, { mode: "stopped", automaticMetric: "d1_rows_read" });
    assert.equal(deletion?.count, 0);
    const stopRequests = sentRequests.filter((request) => request.url === stopWebhookUrl);
    const stopPayloads = await Promise.all(stopRequests.map((request) => request.clone().json()));
    assert.equal(stopRequests.length, 1, JSON.stringify(stopPayloads));
    const alert = (await stopRequests[0]?.json()) as ApiCostGuardAlertPayload;
    assert.equal(alert.type, "cost.api-guard.changed");
    assert.equal(alert.mode, "stopped");
    assert.equal(alert.metric, "d1_rows_read");
    assert.equal(alert.thresholdPercent, 80);
    assert.equal(alert.environment, "staging");
    assert.equal(JSON.stringify(alert).includes(session.anonymousId), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global API guard manual stop is audited and resume requires a fresh low-usage reconciliation", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const env = {
    DB: db,
    ADMIN_TOKENS: testAdminTokens,
    SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
    SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT: "100",
    SILSIGAN_D1_DAILY_READ_LIMIT: "10000",
    SILSIGAN_D1_DAILY_WRITE_LIMIT: "1000",
    ADMIN_API_RATE_LIMITER: new FakeRateLimitBinding(),
  };
  const adminHeaders = {
    "content-type": "application/json",
    "cf-connecting-ip": "203.0.113.250",
    "x-silsigan-admin-token": "test-admin-token",
    "x-silsigan-admin-subject": "cost-owner@example.test",
  };
  const patchGuard = (body: Record<string, unknown>) => worker.handleRequest(
    new Request("https://api.test/api/admin/api-cost-guard", {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify(body),
    }),
    env,
  );

  try {
    const stopped = await patchGuard({ mode: "stopped", reason: "운영자 긴급 중단 테스트", expectedGeneration: 1 });
    const stoppedPayload = (await stopped.json()) as SuccessPayload<{ control: { mode: string; generation: number } }>;
    assert.equal(stopped.status, 200);
    assert.deepEqual(stoppedPayload.data.control, {
      ...stoppedPayload.data.control,
      mode: "stopped",
      generation: 2,
    });

    const prematureResume = await patchGuard({ mode: "running", reason: "사용량 확인 후 재개", expectedGeneration: 2 });
    const prematurePayload = (await prematureResume.json()) as FailurePayload;
    assert.equal(prematureResume.status, 409);
    assert.equal(prematurePayload.error.code, "API_COST_GUARD_RECONCILIATION_REQUIRED");

    const reconciled = await worker.handleRequest(
      new Request("https://api.test/api/admin/api-cost-guard/reconciliations", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          observedWorkersRequests: 10,
          observedD1RowsRead: 1000,
          observedD1RowsWritten: 100,
          observedAt: new Date().toISOString(),
          source: "cloudflare-dashboard",
          note: "Cloudflare 대시보드 직접 대조",
        }),
      }),
      env,
    );
    assert.equal(reconciled.status, 200);

    const resumed = await patchGuard({ mode: "running", reason: "대조 완료 후 안전 재개", expectedGeneration: 2 });
    const resumedPayload = (await resumed.json()) as SuccessPayload<{ control: { mode: string; generation: number } }>;
    const audits = await db
      .prepare("SELECT COUNT(*) AS count FROM admin_actions WHERE action_type = 'api_cost_guard' AND target_id = 'global'")
      .first<{ count: number }>();
    assert.equal(resumed.status, 200);
    assert.equal(resumedPayload.data.control.mode, "running");
    assert.equal(resumedPayload.data.control.generation, 3);
    assert.equal(audits?.count, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global API guard can audit and rebase an overestimated reservation only while degraded", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const env = {
    DB: db,
    ADMIN_TOKENS: testAdminTokens,
    SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
    SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT: "100",
    SILSIGAN_D1_DAILY_READ_LIMIT: "1000",
    SILSIGAN_D1_DAILY_WRITE_LIMIT: "1000",
    ADMIN_API_RATE_LIMITER: new FakeRateLimitBinding(),
  };
  const headers = {
    "content-type": "application/json",
    "cf-connecting-ip": "203.0.113.254",
    "x-silsigan-admin-token": "test-admin-token",
    "x-silsigan-admin-subject": "cost-reconciler@example.test",
  };
  const patchGuard = (body: Record<string, unknown>) => worker.handleRequest(
    new Request("https://api.test/api/admin/api-cost-guard", {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    }),
    env,
  );
  const reconcile = (body: Record<string, unknown>) => worker.handleRequest(
    new Request("https://api.test/api/admin/api-cost-guard/reconciliations", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    env,
  );

  try {
    const runningRebase = await reconcile({
      observedWorkersRequests: 10,
      observedD1RowsRead: 100,
      observedD1RowsWritten: 10,
      observedAt: new Date().toISOString(),
      source: "cloudflare-dashboard",
      note: "running 상태 재기준화 거부 검증",
      rebaseReservedEstimates: true,
      expectedGeneration: 1,
    });
    assert.equal(runningRebase.status, 409);
    assert.equal(((await runningRebase.json()) as FailurePayload).error.code, "API_COST_GUARD_REBASE_NOT_ALLOWED");

    assert.equal(
      (await patchGuard({ mode: "degraded", reason: "과대 예약 재기준화 준비", expectedGeneration: 1 })).status,
      200,
    );
    const staleRebase = await reconcile({
      observedWorkersRequests: 10,
      observedD1RowsRead: 100,
      observedD1RowsWritten: 10,
      observedAt: new Date(Date.now() - 20 * 60 * 1_000).toISOString(),
      source: "cloudflare-dashboard",
      note: "오래된 관측값 재기준화 거부 검증",
      rebaseReservedEstimates: true,
      expectedGeneration: 2,
    });
    assert.equal(staleRebase.status, 400);
    assert.equal(((await staleRebase.json()) as FailurePayload).error.code, "API_COST_GUARD_REBASE_OBSERVATION_STALE");

    const dayUtc = new Date().toISOString().slice(0, 10);
    await db.prepare(`
      INSERT INTO api_cost_guard_daily (
        day_utc, admitted_requests, reserved_workers_requests,
        reserved_rows_read, reserved_rows_written, updated_at
      ) VALUES (?, 70, 70, 700, 70, ?)
      ON CONFLICT(day_utc) DO UPDATE SET
        admitted_requests = 70,
        reserved_workers_requests = 70,
        reserved_rows_read = 700,
        reserved_rows_written = 70,
        updated_at = excluded.updated_at
    `).bind(dayUtc, new Date().toISOString()).run();

    assert.equal((await reconcile({
      observedWorkersRequests: 10,
      observedD1RowsRead: 100,
      observedD1RowsWritten: 10,
      observedAt: new Date().toISOString(),
      source: "cloudflare-dashboard",
      note: "과대 예약 전 실제 사용량 대조",
    })).status, 200);
    const blockedResume = await patchGuard({ mode: "running", reason: "재기준화 전 재개 거부", expectedGeneration: 2 });
    assert.equal(blockedResume.status, 409);
    assert.equal(((await blockedResume.json()) as FailurePayload).error.code, "API_COST_GUARD_RECONCILIATION_FAILED");

    const rebased = await reconcile({
      observedWorkersRequests: 12,
      observedD1RowsRead: 120,
      observedD1RowsWritten: 12,
      observedAt: new Date().toISOString(),
      source: "cloudflare-dashboard",
      note: "Cloudflare 실제 사용량으로 예약 원장 재기준화",
      rebaseReservedEstimates: true,
      expectedGeneration: 2,
    });
    assert.equal(rebased.status, 200);

    const daily = await db.prepare(`
      SELECT reserved_workers_requests AS reservedWorkersRequests,
             reserved_rows_read AS reservedRowsRead,
             reserved_rows_written AS reservedRowsWritten
      FROM api_cost_guard_daily WHERE day_utc = ?
    `).bind(dayUtc).first<{
      reservedWorkersRequests: number;
      reservedRowsRead: number;
      reservedRowsWritten: number;
    }>();
    const audit = await db.prepare(`
      SELECT reason FROM admin_actions
      WHERE action_type = 'api_cost_guard_reconciliation'
      ORDER BY created_at DESC LIMIT 1
    `).first<{ reason: string }>();
    assert.deepEqual(daily, {
      reservedWorkersRequests: 12,
      reservedRowsRead: 120,
      reservedRowsWritten: 12,
    });
    assert.match(audit?.reason ?? "", /reserved_rows_read_before=700/);

    const resumed = await patchGuard({ mode: "running", reason: "감사 재기준화 후 안전 재개", expectedGeneration: 2 });
    assert.equal(resumed.status, 200);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global API guard rechecks reconciliation and usage atomically when resuming", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const racingDb = new RaceInjectingSqliteD1Database(db);
  const env = {
    DB: racingDb,
    ADMIN_TOKENS: testAdminTokens,
    SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
    SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT: "100",
    SILSIGAN_D1_DAILY_READ_LIMIT: "10000",
    SILSIGAN_D1_DAILY_WRITE_LIMIT: "1000",
    ADMIN_API_RATE_LIMITER: new FakeRateLimitBinding(),
  };
  const headers = {
    "content-type": "application/json",
    "cf-connecting-ip": "203.0.113.253",
    "x-silsigan-admin-token": "test-admin-token",
  };
  const patchGuard = (body: Record<string, unknown>) => worker.handleRequest(
    new Request("https://api.test/api/admin/api-cost-guard", {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    }),
    env,
  );

  try {
    assert.equal(
      (await patchGuard({ mode: "stopped", reason: "경쟁 조건 재현용 중단", expectedGeneration: 1 })).status,
      200,
    );
    assert.equal(
      (await worker.handleRequest(
        new Request("https://api.test/api/admin/api-cost-guard/reconciliations", {
          method: "POST",
          headers,
          body: JSON.stringify({
            observedWorkersRequests: 10,
            observedD1RowsRead: 1000,
            observedD1RowsWritten: 100,
            observedAt: new Date().toISOString(),
            source: "cloudflare-dashboard",
            note: "재개 직전 저사용량 대조",
          }),
        }),
        env,
      )).status,
      200,
    );

    racingDb.beforeNextBatch(async () => {
      await db
        .prepare(
          `UPDATE api_cost_guard_daily
           SET reserved_workers_requests = 70, updated_at = ?
           WHERE day_utc = ?`,
        )
        .bind(new Date().toISOString(), new Date().toISOString().slice(0, 10))
        .run();
    });
    const response = await patchGuard({ mode: "running", reason: "경쟁 조건 안전 재개", expectedGeneration: 2 });
    const payload = (await response.json()) as FailurePayload;
    const control = await db
      .prepare("SELECT mode, generation FROM api_cost_guard_control WHERE id = 1")
      .first<{ mode: string; generation: number }>();

    assert.equal(response.status, 409);
    assert.equal(payload.error.code, "API_COST_GUARD_RECONCILIATION_FAILED");
    assert.deepEqual(control, { mode: "stopped", generation: 2 });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global API guard requires a dedicated edge limiter for high-cost reads", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/rankings/global", { headers: { "cf-connecting-ip": "198.51.100.250" } }),
      { DB: db, SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1" },
    );
    const payload = (await response.json()) as FailurePayload;
    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "HIGH_COST_API_RATE_LIMITER_UNAVAILABLE");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global API guard does not let an operator reserve admin-only critical capacity", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/admin/users/restrict", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.251",
          "x-silsigan-admin-token": "test-operator-token",
        },
        body: JSON.stringify({ anonymousId: "anon_admin_reserve_fixture", reason: "권한 없는 예약 차단 검증" }),
      }),
      {
        DB: db,
        ADMIN_TOKENS: testAdminTokens,
        SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
        ADMIN_API_RATE_LIMITER: new FakeRateLimitBinding(),
      },
    );
    const payload = (await response.json()) as FailurePayload;
    const daily = await db.prepare("SELECT COUNT(*) AS count FROM api_cost_guard_daily").first<{ count: number }>();

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "INSUFFICIENT_ADMIN_ROLE");
    assert.equal(daily?.count, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global API guard accounts for a forged anonymous proof before the D1 lookup fails", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/comments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.252",
          "x-silsigan-anon-id": "anon_forged_cost_fixture",
          "x-silsigan-anon-proof": "a".repeat(43),
        },
        body: JSON.stringify({ placeId: "busan-gwangalli", body: "위조 증명 비용 검증" }),
      }),
      {
        DB: db,
        SILSIGAN_ANON_SESSION_REQUIRED: "1",
        SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED: "1",
      },
    );
    const payload = (await response.json()) as FailurePayload;
    const daily = await db
      .prepare(
        `SELECT reserved_workers_requests AS reservedWorkersRequests,
                reserved_rows_read AS reservedRowsRead,
                reserved_rows_written AS reservedRowsWritten
         FROM api_cost_guard_daily`,
      )
      .first<{ reservedWorkersRequests: number; reservedRowsRead: number; reservedRowsWritten: number }>();

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "ANONYMOUS_SESSION_PROOF_INVALID");
    assert.equal(daily?.reservedWorkersRequests, 1);
    assert.ok((daily?.reservedRowsRead ?? 0) >= 1);
    assert.ok((daily?.reservedRowsWritten ?? 0) >= 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("admin emergency stop blocks signed uploads before R2 and remains auditable", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const env = securedPhotoEnv(db, r2, new FakeRateLimitBinding());
  const source = new Uint8Array([...jpegWithGpsExifSample(), 37]);

  try {
    const ticket = await issueSecuredPhotoTicket(env, "anon_photo_manual_stop", source);
    const stop = await worker.handleRequest(
      new Request("https://api.test/api/admin/photo-cost-guard", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-silsigan-admin-token": "test-admin-token",
          "x-silsigan-admin-subject": "cost-owner@example.test",
        },
        body: JSON.stringify({ uploadsEnabled: false, reason: "operator emergency stop test" }),
      }),
      { ...env, ADMIN_TOKENS: testAdminTokens },
    );
    const stopPayload = (await stop.json()) as SuccessPayload<PhotoCostGuardData>;
    const blocked = await completeSecuredPhoto(env, "anon_photo_manual_stop", source, ticket);
    const blockedPayload = (await blocked.json()) as FailurePayload;
    const audit = await db
      .prepare("SELECT action_type AS actionType, target_id AS targetId FROM admin_actions WHERE action_type = 'photo_cost_guard' ORDER BY created_at DESC LIMIT 1")
      .first<{ actionType: string; targetId: string }>();

    assert.equal(stop.status, 200);
    assert.equal(stopPayload.data.uploadsEnabled, false);
    assert.equal(stopPayload.data.readsEnabled, false);
    assert.equal(blocked.status, 503);
    assert.equal(blockedPayload.error.code, "PHOTO_UPLOADS_DISABLED");
    assert.equal(r2.putObjects.length, 0);
    assert.deepEqual(audit, { actionType: "photo_cost_guard", targetId: "global" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("admin cost guard resume requires reconciliation and refuses counters at the 80 percent stop", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const env = securedPhotoEnv(db, r2, new FakeRateLimitBinding(), {
    SILSIGAN_PHOTO_STORAGE_MAX_BYTES: "100",
  });
  const adminEnv = { ...env, ADMIN_TOKENS: testAdminTokens };
  const adminHeaders = {
    "content-type": "application/json",
    "x-silsigan-admin-token": "test-admin-token",
    "x-silsigan-admin-subject": "cost-owner@example.test",
  };

  try {
    const patchGuard = (body: Record<string, unknown>) => worker.handleRequest(
      new Request("https://api.test/api/admin/photo-cost-guard", {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify(body),
      }),
      adminEnv,
    );

    const stop = await patchGuard({ uploadsEnabled: false, readsEnabled: false, reason: "reconciliation test stop" });
    assert.equal(stop.status, 200);

    const missingAcknowledgement = await patchGuard({
      uploadsEnabled: true,
      readsEnabled: true,
      reason: "resume without reconciliation",
    });
    const missingPayload = (await missingAcknowledgement.json()) as FailurePayload;
    assert.equal(missingAcknowledgement.status, 400);
    assert.equal(missingPayload.error.code, "PHOTO_COST_GUARD_RECONCILIATION_REQUIRED");

    const resumed = await patchGuard({
      uploadsEnabled: true,
      readsEnabled: true,
      reconciliationAcknowledged: true,
      reason: "reconciled Cloudflare and D1 ledgers",
    });
    const resumedPayload = (await resumed.json()) as SuccessPayload<PhotoCostGuardData>;
    assert.equal(resumed.status, 200);
    assert.equal(resumedPayload.data.uploadsEnabled, true);
    assert.equal(resumedPayload.data.readsEnabled, true);
    const resumeAudit = await db
      .prepare("SELECT reason FROM admin_actions WHERE action_type = 'photo_cost_guard' ORDER BY created_at DESC LIMIT 1")
      .first<{ reason: string }>();
    assert.match(resumeAudit?.reason ?? "", /reconciliation_acknowledged=1/);

    const stoppedAgain = await patchGuard({ uploadsEnabled: false, readsEnabled: false, reason: "threshold refusal fixture stop" });
    assert.equal(stoppedAgain.status, 200);
    await db.prepare("UPDATE photo_storage_budget SET active_bytes = 80 WHERE id = 1").run();

    const unsafeResume = await patchGuard({
      uploadsEnabled: true,
      readsEnabled: true,
      reconciliationAcknowledged: true,
      reason: "attempt resume at safety threshold",
    });
    const unsafePayload = (await unsafeResume.json()) as FailurePayload;
    assert.equal(unsafeResume.status, 409);
    assert.equal(unsafePayload.error.code, "PHOTO_COST_GUARD_RECONCILIATION_FAILED");
    assert.deepEqual(unsafePayload.error.details, { blockedDimensions: ["storage"] });

    const state = await worker.handleRequest(
      new Request("https://api.test/api/admin/photo-cost-guard", {
        headers: { "x-silsigan-admin-token": "test-admin-token" },
      }),
      adminEnv,
    );
    const statePayload = (await state.json()) as SuccessPayload<PhotoCostGuardData>;
    assert.equal(statePayload.data.uploadsEnabled, false);
    assert.equal(statePayload.data.readsEnabled, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("80 percent cost guard stops uploads and sends one redacted webhook", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const limiter = new FakeRateLimitBinding();
  const env = securedPhotoEnv(db, r2, limiter, {
    SILSIGAN_PHOTO_MONTHLY_WRITE_LIMIT: "5",
    COST_ALERT_WEBHOOK_URL: "https://alerts.example.test/silsigan/cost",
    COST_ALERT_WEBHOOK_TOKEN: "cost-alert-token-fixture",
  });
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
    for (let index = 0; index < 4; index += 1) {
      const source = new Uint8Array([...jpegWithGpsExifSample(), 40 + index]);
      const ticket = await issueSecuredPhotoTicket(env, "anon_photo_cost_threshold", source);
      const response = await completeSecuredPhoto(env, "anon_photo_cost_threshold", source, ticket, ctx);
      assert.equal(response.status, 201);
    }
    await Promise.all(waitUntilPromises);

    const statusResponse = await worker.handleRequest(
      new Request("https://api.test/api/admin/photo-cost-guard", {
        headers: { "x-silsigan-admin-token": "test-admin-token" },
      }),
      { ...env, ADMIN_TOKENS: testAdminTokens },
    );
    const statusPayload = (await statusResponse.json()) as SuccessPayload<PhotoCostGuardData>;
    const blockedTicketResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/upload-ticket", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-silsigan-anon-id": "anon_photo_cost_threshold",
          "cf-connecting-ip": testPhotoClientIp,
        },
        body: JSON.stringify({
          placeId: "busan-gwangalli",
          mimeType: "image/jpeg",
          byteSize: 100,
          width: 1,
          height: 1,
          rightsAttested: true,
          rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
        }),
      }),
      env,
    );
    const blockedTicketPayload = (await blockedTicketResponse.json()) as FailurePayload;

    assert.equal(statusPayload.data.uploadsEnabled, false);
    assert.equal(statusPayload.data.reason, "automatic-80-percent-cost-guard");
    assert.equal(statusPayload.data.writesInPeriod, 4);
    assert.equal(statusPayload.data.monthlyWriteStopLimit, 4);
    assert.equal(blockedTicketResponse.status, 503);
    assert.equal(blockedTicketPayload.error.code, "PHOTO_UPLOADS_DISABLED");
    assert.equal(r2.putObjects.length, 4);
    assert.equal(sentRequests.length, 1);
    assert.equal(sentRequests[0]?.url, "https://alerts.example.test/silsigan/cost");
    assert.equal(sentRequests[0]?.headers.get("authorization"), "Bearer cost-alert-token-fixture");

    const alert = (await sentRequests[0]?.json()) as PhotoCostAlertPayload;
    assert.equal(alert.type, "cost.photo-uploads.stopped");
    assert.equal(alert.reason, "automatic-80-percent-cost-guard");
    assert.equal(alert.environment, "staging");
    assert.equal(alert.stopPercent, 80);
    assert.equal(alert.writesInPeriod, 4);
    assert.equal(alert.monthlyWriteStopLimit, 4);
    assert.equal(alert.guardPath, "/api/admin/photo-cost-guard");
    assert.equal(JSON.stringify(alert).includes("anon_photo_cost_threshold"), false);
    assert.equal(JSON.stringify(alert).includes(testPhotoClientIp), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global Images transform budget blocks a pre-issued distributed upload before transformation", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const images = new FakeImagesBinding(jpegServerReencodedSample());
  const env = {
    ...securedPhotoEnv(db, r2, new FakeRateLimitBinding(), {
      SILSIGAN_PHOTO_MONTHLY_TRANSFORM_LIMIT: "1",
    }),
    IMAGES: images,
  };
  const firstSource = new Uint8Array([...jpegWithGpsExifSample(), 70]);
  const secondSource = new Uint8Array([...jpegWithGpsExifSample(), 71]);

  try {
    const firstTicket = await issueSecuredPhotoTicket(env, "anon_photo_transform_budget_a", firstSource);
    const secondTicket = await issueSecuredPhotoTicket(env, "anon_photo_transform_budget_b", secondSource);
    const first = await completeSecuredPhoto(env, "anon_photo_transform_budget_a", firstSource, firstTicket);
    const second = await completeSecuredPhoto(env, "anon_photo_transform_budget_b", secondSource, secondTicket);
    const secondPayload = (await second.json()) as FailurePayload;
    const guard = await worker.handleRequest(
      new Request("https://api.test/api/admin/photo-cost-guard", {
        headers: { "x-silsigan-admin-token": "test-admin-token" },
      }),
      { ...env, ADMIN_TOKENS: testAdminTokens },
    );
    const guardPayload = (await guard.json()) as SuccessPayload<PhotoCostGuardData>;

    assert.equal(first.status, 201);
    assert.equal(second.status, 503);
    assert.equal(secondPayload.error.code, "PHOTO_UPLOADS_DISABLED");
    assert.equal(images.inputs.length, 1);
    assert.equal(r2.putObjects.length, 1);
    assert.equal(guardPayload.data.uploadsEnabled, false);
    assert.equal(guardPayload.data.transformsInPeriod, 1);
    assert.equal(guardPayload.data.monthlyTransformStopLimit, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging upload fails closed before Images when the transform ledger is missing", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const images = new FakeImagesBinding(jpegServerReencodedSample());
  const env = { ...securedPhotoEnv(db, r2, new FakeRateLimitBinding()), IMAGES: images };
  const source = new Uint8Array([...jpegWithGpsExifSample(), 72]);

  try {
    const ticket = await issueSecuredPhotoTicket(env, "anon_photo_transform_ledger_missing", source);
    await db.prepare("DROP TABLE photo_transform_budget").run();
    const response = await completeSecuredPhoto(env, "anon_photo_transform_ledger_missing", source, ticket);
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "PHOTO_TRANSFORM_COST_GUARD_UNAVAILABLE");
    assert.equal(images.inputs.length, 0);
    assert.equal(r2.putObjects.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
    { PHOTOS: r2, IMAGES: images },
  );
  const payload = (await response.json()) as SuccessPayload<PhotoCompleteData>;
  const sanitization = payload.meta?.photoSanitization as { pixelsReencoded?: unknown; processing?: unknown } | undefined;

  assert.equal(response.status, 201);
  assert.equal(images.inputs.length, 1);
  assert.equal(containsAscii(images.inputs[0] ?? new Uint8Array(), "GPSLatitude"), false);
  assert.deepEqual(images.transforms, [{ width: 1280, height: 960, fit: "scale-down" }]);
  assert.deepEqual(images.outputs, [{ format: "image/jpeg", quality: 82, anim: false }]);
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
      { DB: db, PHOTOS: r2 },
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
      { DB: db, PHOTOS: r2 },
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
      { DB: db, PHOTOS: r2 },
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

test("D1 photo storage budget increments atomically, blocks before R2 writes, and releases bytes on delete", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const firstSource = new Uint8Array([...jpegWithGpsExifSample(), 11]);

  try {
    const firstResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_budget_first" },
        body: JSON.stringify({
          uploadId: "upload_budget_first",
          placeId: "busan-gwangalli",
          byteSize: firstSource.byteLength,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
          imageBase64: bytesToBase64(firstSource),
        }),
      }),
      {
        DB: db,
        PHOTOS: r2,
        SILSIGAN_PHOTO_STORAGE_MAX_BYTES: "1000000",
        SILSIGAN_PHOTO_MONTHLY_WRITE_LIMIT: "1",
      },
    );
    const firstPayload = (await firstResponse.json()) as SuccessPayload<PhotoCompleteData>;
    const firstGuard = firstPayload.meta?.photoCostGuard as
      | { mode?: string; activeBytes?: number; storageMaxBytes?: number; writesInPeriod?: number; monthlyWriteLimit?: number }
      | undefined;

    assert.equal(firstResponse.status, 201);
    assert.equal(r2.putObjects.length, 1);
    assert.equal(firstGuard?.mode, "d1-atomic-free-tier-safety-ceiling");
    assert.equal(firstGuard?.activeBytes, firstPayload.data.photo.byteSize);
    assert.equal(firstGuard?.storageMaxBytes, 1_000_000);
    assert.equal(firstGuard?.writesInPeriod, 1);
    assert.equal(firstGuard?.monthlyWriteLimit, 1);

    const afterCreate = await db
      .prepare("SELECT active_bytes AS activeBytes, writes_in_period AS writesInPeriod FROM photo_storage_budget WHERE id = 1")
      .first<{ activeBytes: number; writesInPeriod: number }>();
    assert.equal(afterCreate?.activeBytes, firstPayload.data.photo.byteSize);
    assert.equal(afterCreate?.writesInPeriod, 1);
    await db
      .prepare("UPDATE photo_upload_control SET uploads_enabled = 1, reason = 'test-monthly-hard-cap', updated_by = 'test' WHERE id = 1")
      .run();

    const secondSource = new Uint8Array([...jpegWithGpsExifSample(), 12]);
    const monthlyBlocked = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_budget_second" },
        body: JSON.stringify({
          uploadId: "upload_budget_second",
          placeId: "ulsan-taehwagang",
          byteSize: secondSource.byteLength,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
          imageBase64: bytesToBase64(secondSource),
        }),
      }),
      {
        DB: db,
        PHOTOS: r2,
        SILSIGAN_PHOTO_STORAGE_MAX_BYTES: "1000000",
        SILSIGAN_PHOTO_MONTHLY_WRITE_LIMIT: "1",
      },
    );
    const monthlyPayload = (await monthlyBlocked.json()) as FailurePayload;
    assert.equal(monthlyBlocked.status, 429);
    assert.equal(monthlyPayload.error.code, "PHOTO_MONTHLY_WRITE_BUDGET_EXHAUSTED");
    assert.equal(r2.putObjects.length, 1);

    const deleteResponse = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${firstPayload.data.photo.id}`, {
        method: "DELETE",
        headers: { "x-silsigan-anon-id": "anon_photo_budget_first" },
      }),
      { DB: db, PHOTOS: r2 },
    );
    assert.equal(deleteResponse.status, 200);
    const afterDelete = await db
      .prepare("SELECT active_bytes AS activeBytes, writes_in_period AS writesInPeriod FROM photo_storage_budget WHERE id = 1")
      .first<{ activeBytes: number; writesInPeriod: number }>();
    assert.equal(afterDelete?.activeBytes, 0);
    assert.equal(afterDelete?.writesInPeriod, 1);
    await db
      .prepare("UPDATE photo_upload_control SET uploads_enabled = 1, reason = 'test-storage-hard-cap', updated_by = 'test' WHERE id = 1")
      .run();

    const storageBlockedSource = new Uint8Array([...jpegWithGpsExifSample(), 13]);
    const storageBlocked = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_budget_storage" },
        body: JSON.stringify({
          uploadId: "upload_budget_storage",
          placeId: "busan-gwangalli",
          byteSize: storageBlockedSource.byteLength,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
          imageBase64: bytesToBase64(storageBlockedSource),
        }),
      }),
      {
        DB: db,
        PHOTOS: r2,
        SILSIGAN_PHOTO_STORAGE_MAX_BYTES: "0",
        SILSIGAN_PHOTO_MONTHLY_WRITE_LIMIT: "20000",
      },
    );
    const storagePayload = (await storageBlocked.json()) as FailurePayload;
    assert.equal(storageBlocked.status, 429);
    assert.equal(storagePayload.error.code, "PHOTO_STORAGE_BUDGET_EXHAUSTED");
    assert.equal(r2.putObjects.length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 photo upload fails closed before R2 when the cost ledger migration is missing", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const source = new Uint8Array([...jpegWithGpsExifSample(), 21]);

  try {
    await db.prepare("DROP TABLE photo_storage_budget").run();
    const response = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": "anon_photo_budget_missing" },
        body: JSON.stringify({
          uploadId: "upload_budget_missing",
          placeId: "busan-gwangalli",
          byteSize: source.byteLength,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
          imageBase64: bytesToBase64(source),
        }),
      }),
      { DB: db, PHOTOS: r2 },
    );
    const payload = (await response.json()) as FailurePayload;

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "PHOTO_COST_GUARD_UNAVAILABLE");
    assert.equal(r2.putObjects.length, 0);
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
    { PHOTOS: new FakeR2Bucket(), IMAGES: new ThrowingImagesBinding(leakText) },
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
  const uploadResponse = await rawPost("https://api.test/api/photos/upload-url", anonymousId, {
    placeId: "busan-gwangalli",
    mimeType: "image/webp",
    byteSize: 100_000,
    width: 800,
    height: 600,
    rightsAttested: true,
    rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
  });
  assert.equal(uploadResponse.headers.get("deprecation"), "true");
  assert.equal(uploadResponse.headers.get("x-silsigan-photo-contract"), "legacy");
  assert.equal(uploadResponse.headers.get("link"), '</api/photos/upload-ticket>; rel="successor-version"');
  const upload = (await uploadResponse.json()) as SuccessPayload<{ uploadId: string; storageKey: string }>;
  assert.match(upload.data.storageKey, /^photos\/busan\/busan-gwangalli\/\d{4}\/\d{2}\/.+\.webp$/);

  const completeResponse = await rawPost("https://api.test/api/photos/complete", anonymousId, {
    uploadId: upload.data.uploadId,
    placeId: "busan-gwangalli",
    byteSize: 100_000,
    mimeType: "image/webp",
    width: 800,
    height: 600,
    clientReencoded: true,
  });
  assert.equal(completeResponse.headers.get("deprecation"), "true");
  assert.equal(completeResponse.headers.get("x-silsigan-photo-contract"), "legacy");
  assert.equal(completeResponse.headers.get("link"), '</api/photos/upload>; rel="successor-version"');
  const complete = (await completeResponse.json()) as SuccessPayload<PhotoCompleteData>;
  const photos = await get<SuccessPayload<Array<{ id: string }>>>("https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
  assert.ok(photos.data.some((photo) => photo.id === complete.data.photo.id));

  const forbidden = await rawDelete(`https://api.test/api/photos/${complete.data.photo.id}`, "anon_other_photo_owner");
  assert.equal(forbidden.status, 403);

  const deleted = await del<SuccessPayload<{ deleted: boolean }>>(`https://api.test/api/photos/${complete.data.photo.id}`, anonymousId);
  assert.equal(deleted.data.deleted, true);

  const photosAfterDelete = await get<SuccessPayload<Array<{ id: string }>>>("https://api.test/api/photos?placeId=busan-gwangalli", anonymousId);
  assert.equal(photosAfterDelete.data.some((photo) => photo.id === complete.data.photo.id), false);
});

test("D1 photo deletion hides the row and deletes its R2 object", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const anonymousId = "anon_photo_delete_r2_test";
  const source = new Uint8Array([...jpegWithGpsExifSample(), 1]);

  try {
    const createResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": anonymousId },
        body: JSON.stringify({
          uploadId: "upload_delete_r2",
          placeId: "busan-gwangalli",
          byteSize: source.byteLength,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
          imageBase64: bytesToBase64(source),
        }),
      }),
      { DB: db, PHOTOS: r2 },
    );
    const created = (await createResponse.json()) as SuccessPayload<PhotoCompleteData>;
    const deleteResponse = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${created.data.photo.id}`, {
        method: "DELETE",
        headers: { "x-silsigan-anon-id": anonymousId },
      }),
      { DB: db, PHOTOS: r2 },
    );
    const deletePayload = (await deleteResponse.json()) as SuccessPayload<{ deleted: boolean; storageDeleted: boolean; cleanupQueued: boolean }>;

    assert.equal(deleteResponse.status, 200);
    assert.equal(deletePayload.data.deleted, true);
    assert.equal(deletePayload.data.storageDeleted, true);
    assert.equal(deletePayload.data.cleanupQueued, false);
    assert.ok(r2.deletedKeys.includes(created.data.storageKey));

    const fileResponse = await worker.handleRequest(
      new Request(`https://api.test/api/photos/${created.data.photo.id}/file`),
      { DB: db, PHOTOS: r2 },
    );
    assert.equal(fileResponse.status, 404);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("concurrent owner photo deletes release one R2 object and one storage budget entry", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();
  const r2 = new FakeR2Bucket();
  const anonymousId = "anon_concurrent_photo_delete";
  const source = new Uint8Array([...jpegWithGpsExifSample(), 2]);

  try {
    const createResponse = await worker.handleRequest(
      new Request("https://api.test/api/photos/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-silsigan-anon-id": anonymousId },
        body: JSON.stringify({
          uploadId: "upload_concurrent_delete",
          placeId: "busan-gwangalli",
          byteSize: source.byteLength,
          mimeType: "image/jpeg",
          width: 1,
          height: 1,
          clientReencoded: true,
          imageBase64: bytesToBase64(source),
        }),
      }),
      { DB: db, PHOTOS: r2 },
    );
    const created = (await createResponse.json()) as SuccessPayload<PhotoCompleteData>;
    const storedByteSize = created.data.photo.byteSize;
    await db.prepare("UPDATE photo_storage_budget SET active_bytes = ? WHERE id = 1").bind(storedByteSize * 2).run();

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        worker.handleRequest(
          new Request(`https://api.test/api/photos/${created.data.photo.id}`, {
            method: "DELETE",
            headers: { "x-silsigan-anon-id": anonymousId },
          }),
          { DB: db, PHOTOS: r2 },
        )),
    );
    const statuses = responses.map((response) => response.status);
    const budget = await db.prepare("SELECT active_bytes AS activeBytes FROM photo_storage_budget WHERE id = 1").first<{ activeBytes: number }>();
    const releases = await db
      .prepare("SELECT storage_key AS storageKey, byte_size AS byteSize FROM photo_storage_releases WHERE storage_key = ?")
      .bind(created.data.storageKey)
      .all<{ storageKey: string; byteSize: number }>();

    assert.equal(statuses.filter((status) => status === 200).length, 1);
    assert.equal(statuses.filter((status) => status === 404).length, 19);
    assert.deepEqual(r2.deletedKeys, [created.data.storageKey]);
    assert.equal(budget?.activeBytes, storedByteSize);
    assert.deepEqual(releases.results, [{ storageKey: created.data.storageKey, byteSize: storedByteSize }]);
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

    const namespace = new FakeDurableObjectNamespace(() => new worker.PlaceRoom());
    const routedResponse = await worker.handleRequest(
      new Request("https://api.test/api/realtime/place/busan-gwangalli", {
        headers: { Upgrade: "websocket" },
      }),
      { PLACE_ROOM: namespace },
    );
    const routedWebSocketResponse = routedResponse as Response & { webSocket?: FakeWorkerWebSocket };
    assert.equal(routedResponse.status, 101);
    assert.equal(routedWebSocketResponse.webSocket, pairs[1]?.client);
    assert.match(routedResponse.headers.get("x-silsigan-anon-id") ?? "", /^anon_[a-f0-9-]{36}$/);

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
    pairs[0]?.server.emitMessage("attacker-broadcast-attempt");
    assert.equal(pairs[0]?.server.readyState, 3);
    assert.equal(pairs[0]?.client.receivedMessages.length, 1);
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

test("Durable Object realtime WebSockets use hibernation state and reject client frames", async () => {
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
    const state = new FakeDurableObjectState();
    const room = new worker.PlaceRoom(state);
    const response = await room.fetch(
      new Request("https://api.test/api/realtime/place/busan-gwangalli?roomId=busan-gwangalli", {
        headers: { Upgrade: "websocket" },
      }),
    );

    assert.equal(response.status, 101);
    assert.equal(state.acceptedSockets.length, 1);
    assert.equal(state.acceptedSockets[0], pairs[0]?.server);

    const broadcast = await room.fetch(
      new Request("https://api.test/api/realtime/broadcast?roomId=busan-gwangalli", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "photo.ready",
          scope: "place",
          roomId: "busan-gwangalli",
          payload: { id: "photo_hibernation_1", placeId: "busan-gwangalli" },
          createdAt: "2026-07-19T00:00:00.000Z",
        }),
      }),
    );
    const payload = (await broadcast.json()) as SuccessPayload<{ delivered: number }>;

    assert.equal(payload.data.delivered, 1);
    assert.equal(pairs[0]?.client.receivedMessages.length, 1);

    room.webSocketMessage(pairs[0]!.server);
    assert.deepEqual(pairs[0]?.server.closeCalls, [{ code: 1008, reason: "read-only-channel" }]);
    assert.equal(state.getWebSockets().length, 0);
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

test("Durable Object realtime polling survives hibernation reinitialization", async () => {
  const storage = new FakeDurableObjectStorage();
  const writer = new worker.PlaceRoom(new FakeDurableObjectState(storage));
  const createdAt = new Date().toISOString();
  const broadcast = await writer.fetch(
    new Request("https://api.test/api/realtime/broadcast?roomId=busan-gwangalli", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "report.created",
        scope: "place",
        roomId: "busan-gwangalli",
        payload: { reportId: "report_hibernation_1", placeId: "busan-gwangalli" },
        createdAt,
      }),
    }),
  );
  assert.equal(broadcast.status, 200);
  assert.deepEqual(storage.putKeys, ["recent-events:v1"]);
  assert.ok(storage.alarmAt && storage.alarmAt > Date.now());

  const rehydrated = new worker.PlaceRoom(new FakeDurableObjectState(storage));
  const polling = await rehydrated.fetch(
    new Request("https://api.test/api/realtime/place/busan-gwangalli?roomId=busan-gwangalli"),
  );
  const payload = (await polling.json()) as SuccessPayload<{
    mode: string;
    events: Array<{ type: string; payload: { reportId?: string } }>;
  }>;

  assert.equal(payload.data.mode, "durable-object-polling");
  assert.equal(payload.data.events.length, 1);
  assert.equal(payload.data.events[0]?.type, "report.created");
  assert.equal(payload.data.events[0]?.payload.reportId, "report_hibernation_1");
});

test("Durable Object realtime alarm removes retained polling events", async () => {
  const storage = new FakeDurableObjectStorage();
  const writer = new worker.PlaceRoom(new FakeDurableObjectState(storage));
  const broadcast = await writer.fetch(
    new Request("https://api.test/api/realtime/broadcast?roomId=busan-gwangalli", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "heartbeat",
        scope: "place",
        roomId: "busan-gwangalli",
        payload: { placeId: "busan-gwangalli" },
        createdAt: new Date().toISOString(),
      }),
    }),
  );
  assert.equal(broadcast.status, 200);

  await writer.alarm();
  assert.deepEqual(storage.deleteKeys, ["recent-events:v1"]);

  const rehydrated = new worker.PlaceRoom(new FakeDurableObjectState(storage));
  const polling = await rehydrated.fetch(
    new Request("https://api.test/api/realtime/place/busan-gwangalli?roomId=busan-gwangalli"),
  );
  const payload = (await polling.json()) as SuccessPayload<{ events: unknown[] }>;
  assert.deepEqual(payload.data.events, []);
});

test("Durable Object realtime persistence rejects oversized events before storage", async () => {
  const storage = new FakeDurableObjectStorage();
  const room = new worker.PlaceRoom(new FakeDurableObjectState(storage));

  await assert.rejects(
    () => room.fetch(
      new Request("https://api.test/api/realtime/broadcast?roomId=busan-gwangalli", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "heartbeat",
          scope: "place",
          roomId: "busan-gwangalli",
          payload: { padding: "x".repeat(17 * 1024) },
          createdAt: "2026-07-19T00:00:00.000Z",
        }),
      }),
    ),
    /실시간 이벤트 크기가 허용 범위를 초과했습니다/,
  );
  assert.deepEqual(storage.putKeys, []);
});

test("Durable Object realtime rooms cap concurrent sockets before allocating another connection", async () => {
  const previousWebSocketPair = Reflect.get(globalThis, "WebSocketPair");
  const hadWebSocketPair = Object.prototype.hasOwnProperty.call(globalThis, "WebSocketPair");
  Object.defineProperty(globalThis, "WebSocketPair", {
    configurable: true,
    value: FakeWebSocketPair,
  });

  try {
    const room = new worker.PlaceRoom();
    for (let index = 0; index < 100; index += 1) {
      const response = await room.fetch(
        new Request("https://api.test/api/realtime/place/busan-gwangalli?roomId=busan-gwangalli", {
          headers: { Upgrade: "websocket" },
        }),
      );
      assert.equal(response.status, 101);
    }

    const rejected = await room.fetch(
      new Request("https://api.test/api/realtime/place/busan-gwangalli?roomId=busan-gwangalli", {
        headers: { Upgrade: "websocket" },
      }),
    );
    const payload = (await rejected.json()) as FailurePayload;
    assert.equal(rejected.status, 429);
    assert.equal(payload.error.code, "REALTIME_ROOM_CAPACITY_REACHED");
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

test("realtime routing rejects unregistered room ids before allocating Durable Objects", async () => {
  const namespace = new FakeDurableObjectNamespace(() => new worker.PlaceRoom());
  const response = await worker.handleRequest(
    new Request("https://api.test/api/realtime/place/attacker-created-room"),
    { PLACE_ROOM: namespace },
  );
  const payload = (await response.json()) as FailurePayload;

  assert.equal(response.status, 404);
  assert.equal(payload.error.code, "PLACE_NOT_FOUND");
  assert.equal(namespace.roomCount, 0);

  const malformedGlobal = await worker.handleRequest(
    new Request("https://api.test/api/realtime/global/attacker-created-room"),
    { GLOBAL_ROOM: namespace },
  );
  const malformedGlobalPayload = (await malformedGlobal.json()) as FailurePayload;
  assert.equal(malformedGlobal.status, 404);
  assert.equal(malformedGlobalPayload.error.code, "ROOM_NOT_FOUND");
  assert.equal(namespace.roomCount, 0);
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
  const client = createCloudflareApiClient({
    baseUrl: "https://api.test",
    anonymousId: "anon_client_report_test",
    fetcher: async (input) => {
      requestedUrls.push(input.toString());
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
});

test("Cloudflare API client uses the binary upload-ticket contract", async () => {
  const requests: Array<{ path: string; method: string; contentType: string | null; isFormData: boolean }> = [];
  const client = createCloudflareApiClient({
    baseUrl: "https://api.test",
    anonymousId: "anon_client_photo_test",
    fetcher: async (input, init) => {
      const url = new URL(input.toString());
      requests.push({
        path: url.pathname,
        method: init?.method ?? "GET",
        contentType: new Headers(init?.headers).get("content-type"),
        isFormData: init?.body instanceof FormData,
      });

      if (url.pathname === "/api/photos/upload-ticket") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              uploadId: "upload_client_photo",
              method: "POST",
              uploadUrl: "/api/photos/upload",
              storageKey: "photos/opaque-key",
              rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            photo: {
              id: "photo_client_binary",
              placeId: "busan-gwangalli",
              previewUrl: null,
              mimeType: "image/jpeg",
              byteSize: 3,
              width: 1,
              height: 1,
              clickCount: 0,
              status: "pending",
              createdAt: "2026-07-14T00:00:00.000Z",
            },
            storageKey: "photos/opaque-key",
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
  });

  const result = await client.uploadPhoto({
    placeId: "busan-gwangalli",
    byteSize: 3,
    mimeType: "image/jpeg",
    width: 1,
    height: 1,
    clientReencoded: true,
    rightsAttested: true,
    rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
  });

  assert.equal(result.data.photo.id, "photo_client_binary");
  assert.deepEqual(requests, [
    { path: "/api/photos/upload-ticket", method: "POST", contentType: "application/json", isFormData: false },
    { path: "/api/photos/upload", method: "POST", contentType: null, isFormData: true },
  ]);
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

test("Cloudflare API client supports scoped hashtag photo media pagination", async () => {
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

  await client.listHashtags({
    name: "광안리지금",
    regionId: "busan",
    placeId: "busan-gwangalli",
    hasPhoto: true,
    activeOnly: true,
    sort: "recent",
    cursor: "2026-07-19T00:00:00.000Z|field_report_100",
    limit: 100,
  });

  const requestedUrl = new URL(requestedUrls[0] ?? "");
  assert.equal(requestedUrl.pathname, "/api/hashtags");
  assert.equal(requestedUrl.searchParams.get("name"), "광안리지금");
  assert.equal(requestedUrl.searchParams.get("regionId"), "busan");
  assert.equal(requestedUrl.searchParams.get("placeId"), "busan-gwangalli");
  assert.equal(requestedUrl.searchParams.get("hasPhoto"), "true");
  assert.equal(requestedUrl.searchParams.get("activeOnly"), "true");
  assert.equal(requestedUrl.searchParams.get("sort"), "recent");
  assert.equal(requestedUrl.searchParams.get("cursor"), "2026-07-19T00:00:00.000Z|field_report_100");
  assert.equal(requestedUrl.searchParams.get("limit"), "100");
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
  );
}

function photoTicketRequest(anonymousId: string, turnstileToken?: string, origin?: string): Request {
  return new Request("https://api.test/api/photos/upload-ticket", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-silsigan-anon-id": anonymousId,
      "cf-connecting-ip": testPhotoClientIp,
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({
      placeId: "busan-gwangalli",
      mimeType: "image/jpeg",
      byteSize: 256,
      width: 1,
      height: 1,
      rightsAttested: true,
      rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
      ...(turnstileToken ? { turnstileToken } : {}),
    }),
  });
}

function securedPhotoEnv(
  db: SqliteD1Database,
  r2: FakeR2Bucket,
  limiter: FakeRateLimitBinding,
  overrides: Partial<{
    SILSIGAN_PHOTO_DAILY_UPLOAD_LIMIT: string;
    SILSIGAN_PHOTO_DAILY_BYTES_LIMIT: string;
    SILSIGAN_PHOTO_STORAGE_MAX_BYTES: string;
    SILSIGAN_PHOTO_MONTHLY_WRITE_LIMIT: string;
    SILSIGAN_PHOTO_MONTHLY_TRANSFORM_LIMIT: string;
    SILSIGAN_PHOTO_MONTHLY_READ_LIMIT: string;
    SILSIGAN_PHOTO_DAILY_READ_LIMIT: string;
    SILSIGAN_PHOTO_DAILY_IP_READ_LIMIT: string;
    COST_ALERT_WEBHOOK_URL: string;
    COST_ALERT_WEBHOOK_TOKEN: string;
  }> = {},
) {
  return {
    DB: db,
    PHOTOS: r2,
    ENVIRONMENT: "staging",
    SILSIGAN_ANON_SESSION_REQUIRED: "0",
    SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET: testPhotoUploadSecret,
    PHOTO_UPLOAD_RATE_LIMITER: limiter,
    ...overrides,
  };
}

async function issueSecuredPhotoTicket(
  env: ReturnType<typeof securedPhotoEnv>,
  anonymousId: string,
  source: Uint8Array,
): Promise<PhotoUploadTicketData> {
  const response = await worker.handleRequest(
    new Request("https://api.test/api/photos/upload-ticket", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
        "cf-connecting-ip": testPhotoClientIp,
      },
      body: JSON.stringify({
        placeId: "busan-gwangalli",
        mimeType: "image/jpeg",
        byteSize: source.byteLength,
        width: 1,
        height: 1,
        rightsAttested: true,
        rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
      }),
    }),
    env,
  );
  assert.equal(response.status, 201);
  const payload = (await response.json()) as SuccessPayload<PhotoUploadTicketData>;
  assert.match(payload.data.uploadId, /^upload_[0-9a-f-]{36}$/i);
  assert.match(payload.data.ticket, /^[0-9a-f]{64}$/i);
  assert.ok(Date.parse(payload.data.expiresAt) > Date.now());
  return payload.data;
}

function completeSecuredPhoto(
  env: ReturnType<typeof securedPhotoEnv>,
  anonymousId: string,
  source: Uint8Array,
  ticket: PhotoUploadTicketData,
  ctx?: { waitUntil: (promise: Promise<unknown>) => void },
): Promise<Response> {
  return worker.handleRequest(
    new Request("https://api.test/api/photos/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-silsigan-anon-id": anonymousId,
        "cf-connecting-ip": testPhotoClientIp,
      },
      body: JSON.stringify({
        uploadId: ticket.uploadId,
        ticket: ticket.ticket,
        ticketExpiresAt: ticket.expiresAt,
        placeId: "busan-gwangalli",
        byteSize: source.byteLength,
        mimeType: "image/jpeg",
        width: 1,
        height: 1,
        clientReencoded: true,
        imageBase64: bytesToBase64(source),
      }),
    }),
    env,
    ctx,
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

async function enableD1FeatureFlags(
  db: SqliteD1Database,
  flags: readonly string[],
  scopeType: "global" | "region" = "global",
  scopeKey = "*",
): Promise<void> {
  for (const flag of flags) {
    await db
      .prepare(
        `INSERT INTO feature_flags (scope_type, scope_key, flag_key, enabled)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(scope_type, scope_key, flag_key) DO UPDATE SET enabled = 1`,
      )
      .bind(scopeType, scopeKey, flag)
      .run();
  }
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
    { DB: db },
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
    { DB: db },
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

function anonymousSessionRequest(
  url: string,
  method: "GET" | "POST" | "DELETE",
  session: { anonymousId: string; proof: string },
  body?: Record<string, unknown>,
): Request {
  return new Request(url, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      "x-silsigan-anon-id": session.anonymousId,
      "x-silsigan-anon-proof": session.proof,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

let verifiedSessionTestClientSequence = 0;

async function issueVerifiedAnonymousSession(db: SqliteD1Database): Promise<{ anonymousId: string; proof: string }> {
  verifiedSessionTestClientSequence += 1;
  const response = await worker.handleRequest(
    new Request("https://api.test/api/session/anonymous", {
      method: "POST",
      headers: { "cf-connecting-ip": `2001:db8::${verifiedSessionTestClientSequence}` },
    }),
    { DB: db, SILSIGAN_ANON_SESSION_REQUIRED: "1" },
  );
  assert.equal(response.status, 201);
  const payload = (await response.json()) as SuccessPayload<{ anonymousId: string; proof: string }>;
  return payload.data;
}

function sha256HexForTest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
  readonly getKeys: string[] = [];
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
      return;
    }

    this.deletedKeys.push(key);
  }

  async get(key: string) {
    this.getKeys.push(key);
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
    };
  }
}

class FakeWorkerCache {
  readonly matchedUrls: string[] = [];
  readonly putUrls: string[] = [];
  private readonly entries = new Map<
    string,
    { body: Uint8Array; headers: Array<[string, string]>; status: number; statusText: string }
  >();

  async match(request: Request): Promise<Response | undefined> {
    this.matchedUrls.push(request.url);
    const entry = this.entries.get(request.url);
    if (!entry) {
      return undefined;
    }
    return new Response(entry.body.slice(), {
      status: entry.status,
      statusText: entry.statusText,
      headers: entry.headers,
    });
  }

  async put(request: Request, response: Response): Promise<void> {
    this.putUrls.push(request.url);
    this.entries.set(request.url, {
      body: new Uint8Array(await response.arrayBuffer()),
      headers: Array.from(response.headers.entries()),
      status: response.status,
      statusText: response.statusText,
    });
  }
}

class FakeRateLimitBinding {
  readonly calls: string[] = [];
  private readonly results: boolean[];

  constructor(results: boolean | boolean[] = true) {
    this.results = Array.isArray(results) ? [...results] : [results];
  }

  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    this.calls.push(key);
    const success = this.results.length > 1 ? this.results.shift() : this.results[0];
    return { success: success ?? true };
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

  get roomCount(): number {
    return this.rooms.size;
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

class FakeDurableObjectStorage {
  readonly values = new Map<string, unknown>();
  readonly putKeys: string[] = [];
  readonly deleteKeys: string[] = [];
  alarmAt: number | null = null;

  async get<TValue = unknown>(key: string): Promise<TValue | undefined> {
    return this.values.get(key) as TValue | undefined;
  }

  async put<TValue>(key: string, value: TValue): Promise<void> {
    this.values.set(key, value);
    this.putKeys.push(key);
  }

  async delete(key: string): Promise<boolean> {
    this.deleteKeys.push(key);
    return this.values.delete(key);
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarmAt = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
  }
}

class FakeDurableObjectState {
  readonly acceptedSockets: FakeWorkerWebSocket[] = [];
  readonly storage: FakeDurableObjectStorage;

  constructor(storage = new FakeDurableObjectStorage()) {
    this.storage = storage;
  }

  acceptWebSocket(socket: { readyState: number }): void {
    this.acceptedSockets.push(socket as FakeWorkerWebSocket);
  }

  getWebSockets(): FakeWorkerWebSocket[] {
    return this.acceptedSockets.filter((socket) => socket.readyState !== 3);
  }
}

class FakeWorkerWebSocket {
  readonly receivedMessages: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  readyState = 1;
  peer: FakeWorkerWebSocket | null = null;
  private readonly listeners = new Map<"message" | "close" | "error", FakeWebSocketListener>();

  accept(): void {}

  send(message: string): void {
    this.peer?.receivedMessages.push(message);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
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
  readonly getKeys: string[] = [];
  readonly puts: Array<{ key: string; value: string; options?: { expirationTtl?: number } }> = [];
  readonly deletedKeys: string[] = [];

  async get(key: string): Promise<string | null> {
    this.getKeys.push(key);
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

  async batch(statements: worker.D1PreparedStatement[]): Promise<unknown[]> {
    const sqlStatements = statements.map((statement) => {
      if (!statement.toSql) {
        throw new Error("SQLite D1 batch requires serializable prepared statements.");
      }
      return `${statement.toSql()};`;
    });
    execFileSync("sqlite3", [this.dbPath], {
      encoding: "utf8",
      input: `.bail on\nBEGIN IMMEDIATE;\n${sqlStatements.join("\n")}\nCOMMIT;`,
    });
    return statements.map(() => ({ success: true }));
  }
}

class RaceInjectingSqliteD1Database {
  private readonly inner: SqliteD1Database;
  private pendingInjection: (() => Promise<void>) | null = null;

  constructor(inner: SqliteD1Database) {
    this.inner = inner;
  }

  prepare(query: string): SqliteD1PreparedStatement {
    return this.inner.prepare(query);
  }

  beforeNextBatch(injection: () => Promise<void>): void {
    this.pendingInjection = injection;
  }

  async batch(statements: worker.D1PreparedStatement[]): Promise<unknown[]> {
    const injection = this.pendingInjection;
    this.pendingInjection = null;
    if (injection) {
      await injection();
    }
    return this.inner.batch(statements);
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
    execFileSync("sqlite3", [this.dbPath, this.toSql()], { encoding: "utf8" });
    return { success: true };
  }

  toSql(): string {
    return substituteSqliteParams(this.query, this.values);
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
    if (process.env.SILSIGAN_REQUIRE_SQLITE_TESTS === "1") {
      throw new Error("SQLite is required for D1 coverage in this verification environment.");
    }
    return false;
  }
}

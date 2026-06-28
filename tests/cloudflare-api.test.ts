import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createCloudflareApiClient } from "../src/lib/cloudflare-api.ts";
import * as worker from "../workers/api/src/index.ts";
import * as policies from "../workers/api/src/policies.ts";

const execFileAsync = promisify(execFile);
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
  name?: string;
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
  anonymousUserId: string;
  likeCount: number;
};

type PhotoCompleteData = {
  photo: {
    id: string;
    clickCount: number;
  };
  storageKey: string;
};

type FieldReportData = {
  report: {
    id: string;
    placeId: string;
    category: string;
    crowdLevel: string;
    lineStatus: string;
    parkingStatus: string;
    weatherFeel: string;
    verifiedRadiusM: number | null;
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
  shareCard: { headline: string; body: string; hashtags: string[] };
  judgement: "가도 좋음" | "주의" | "지금은 비추";
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
  targetType: "place" | "comment" | "photo";
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
    const mobileAppPath = join(tempDir, "mobile-App.tsx");
    const mobileAppConfigPath = join(tempDir, "mobile-app.json");
    const mobileExperiencePath = join(tempDir, "mobile-silsiganExperience.ts");
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
    writeMobileTestFlightShell(mobileAppPath, mobileAppConfigPath, mobileExperiencePath);
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
                name: "cloudflare.d1.production.migration_0002",
                status: "fail",
                code: "D1_0002_NOT_APPLIED",
                message: "Remote production D1 is missing the posts/questions migration.",
              },
            ],
            blockers: ["R2_NOT_ENABLED", "deployment_url.production.pages", "D1_0002_NOT_APPLIED"],
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
      `--mobile-app=${mobileAppPath}`,
      `--mobile-app-config=${mobileAppConfigPath}`,
      `--mobile-experience=${mobileExperiencePath}`,
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
    assert.ok(readyPayload.checks.some((check) => check.name === "public_policy_page.privacy" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "public_policy_page.privacy.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "public_policy_page.support" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "public_policy_page.support.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "policy_url.privacy_policy" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "policy_url.support" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "policy_url.privacy_policy.support" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "mobile_testflight.app.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "mobile_testflight.experience.required_tokens" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "mobile_testflight.app_config.ios_permissions" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "mobile_testflight.app_config.android_permissions" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "mobile_testflight.app_config.urls.staging_web" && check.status === "pass"));
    assert.ok(readyPayload.checks.some((check) => check.name === "mobile_testflight.experience.url_values" && check.status === "pass"));

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
        `--mobile-app=${mobileAppPath}`,
        `--mobile-app-config=${mobileAppConfigPath}`,
        `--mobile-experience=${mobileExperiencePath}`,
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
      assert.ok(blockedPayload.blockers.includes("D1_0002_NOT_APPLIED"));
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

test("release state check requires mobile TestFlight shell public links and permissions", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-mobile-testflight-shell-"));
  try {
    const configPath = join(tempDir, "ready-wrangler.jsonc");
    const ledgerPath = join(tempDir, "current-release-state.md");
    const { releaseLedgerPath, releaseStatusPath } = writeReleaseHarnessFiles(tempDir, ledgerPath);
    const ugcRunbookPath = join(tempDir, "ugc-moderation-runbook.md");
    const costUsageRunbookPath = join(tempDir, "cloudflare-cost-usage-runbook.md");
    const testFlightReviewNotesPath = join(tempDir, "testflight-review-notes.md");
    const realDeviceQaPath = join(tempDir, "real-device-qa.md");
    const privacyPagePath = join(tempDir, "privacy-page.tsx");
    const supportPagePath = join(tempDir, "support-page.tsx");
    const mobileAppPath = join(tempDir, "mobile-App.tsx");
    const mobileAppConfigPath = join(tempDir, "mobile-app.json");
    const mobileExperiencePath = join(tempDir, "mobile-silsiganExperience.ts");
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
    writePublicPolicySupportPages(privacyPagePath, supportPagePath);
    writeFileSync(mobileAppPath, "export default function App(){ return null; }\n", "utf8");
    writeFileSync(mobileExperiencePath, "export const serviceLinks = {};\n", "utf8");
    writeFileSync(
      mobileAppConfigPath,
      JSON.stringify(
        {
          expo: {
            ios: {
              infoPlist: {
                NSCameraUsageDescription: "camera",
                NSLocationWhenInUseUsageDescription: "location",
              },
            },
            android: {
              permissions: ["CAMERA"],
            },
            extra: {
              silsigan: {
                stagingWebUrl: "http://localhost:3000?debug=1",
                privacyPolicyUrl: "https://silsigan.kr/privacy",
                supportUrl: "https://silsigan.kr/privacy",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

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
        `--privacy-page=${privacyPagePath}`,
        `--support-page=${supportPagePath}`,
        `--mobile-app=${mobileAppPath}`,
        `--mobile-app-config=${mobileAppConfigPath}`,
        `--mobile-experience=${mobileExperiencePath}`,
        "--strict",
      ], {
        encoding: "utf8",
        env: createReadyPreflightProcessEnv(),
        stdio: "pipe",
      });
      assert.fail("strict release state should fail when the mobile TestFlight shell is incomplete");
    } catch (error) {
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
      const payload = JSON.parse(stdout) as {
        ok: boolean;
        blockers: string[];
        checks: Array<{
          name: string;
          status: string;
          message?: string;
          missingTokens?: string[];
          missingPermissionKeys?: string[];
          missingPermissions?: string[];
          missingUrlValues?: string[];
        }>;
      };
      const appTokenCheck = payload.checks.find((check) => check.name === "mobile_testflight.app.required_tokens");
      const experienceTokenCheck = payload.checks.find((check) => check.name === "mobile_testflight.experience.required_tokens");
      const iosPermissionCheck = payload.checks.find((check) => check.name === "mobile_testflight.app_config.ios_permissions");
      const androidPermissionCheck = payload.checks.find((check) => check.name === "mobile_testflight.app_config.android_permissions");
      const stagingUrlChecks = payload.checks.filter((check) => check.name === "mobile_testflight.app_config.urls.staging_web");

      assert.equal(payload.ok, false);
      assert.ok(payload.blockers.includes("mobile_testflight.app.required_tokens"));
      assert.ok(payload.blockers.includes("mobile_testflight.experience.required_tokens"));
      assert.ok(payload.blockers.includes("mobile_testflight.app_config.ios_permissions"));
      assert.ok(payload.blockers.includes("mobile_testflight.app_config.android_permissions"));
      assert.ok(payload.blockers.includes("mobile_testflight.app_config.urls.staging_web"));
      assert.ok(payload.blockers.includes("mobile_testflight.app_config.urls.privacy_policy.support"));
      assert.equal(appTokenCheck?.status, "fail");
      assert.ok(appTokenCheck?.missingTokens?.includes("Linking.openURL"));
      assert.equal(experienceTokenCheck?.status, "fail");
      assert.ok(experienceTokenCheck?.missingTokens?.includes("getServiceLinkReadiness"));
      assert.ok(iosPermissionCheck?.missingPermissionKeys?.includes("NSPhotoLibraryUsageDescription"));
      assert.ok(androidPermissionCheck?.missingPermissions?.includes("ACCESS_FINE_LOCATION"));
      assert.ok(stagingUrlChecks.some((check) => check.message?.includes("https")));
      assert.ok(stagingUrlChecks.some((check) => check.message?.includes("query")));
      assert.ok(stagingUrlChecks.some((check) => check.message?.includes("localhost")));
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
    "--mutating",
  ]);

  assert.equal(parsed.flags.has("mutating"), true);
  assert.equal(parsed.options.get("api-base-url"), "https://api.example.test");
  assert.equal(pagesSmoke.sanitizeUrl(parsed.options.get("pages-url")), "https://silsigan-staging.pages.dev/");
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
      SILSIGAN_STAGING_PAGES_URL: "https://silsigan-staging.pages.dev",
      SILSIGAN_STAGING_API_BASE_URL: "https://silsigan-api-staging.workers.dev",
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
  assert.equal(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "TAIL_FILE_REQUIRED"), false);
  assert.equal(missingUrlsPlan.errors.some((error: { code: string }) => error.code === "SILSIGAN_STAGING_ADMIN_TOKEN_REQUIRED"), false);

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
  const d1Check = externalState.classifyAuthBlockedRemoteCheck("cloudflare.d1.staging.migration_0002", "Remote staging D1 migration evidence check");

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
  assert.equal(missingMigration.name, "cloudflare.d1.staging.migration_0002");
  assert.equal(missingMigration.status, "fail");
  assert.equal(missingMigration.code, "D1_0002_NOT_APPLIED");
  assert.equal(JSON.stringify(missingMigration).includes("no such table"), false);

  const incompleteSeed = externalState.classifyD1MigrationResult(
    {
      exitCode: 0,
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nposts=3\nquestions=2\n",
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
      stdout: "posts_table=1\nquestions_table=1\npost_indexes=2\nquestion_indexes=2\nposts=4\nquestions=3\n",
      stderr: "",
    },
    "staging",
  );
  assert.equal(ready.name, "cloudflare.d1.staging.migration_0002");
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
        ["d1.migrations.apply", true],
        ["d1.seed.apply", true],
        ["d1.posts_questions.evidence", false],
      ],
    );
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
    { name: "cloudflare.d1.production.migration_0002", status: "fail", code: "D1_0002_NOT_APPLIED" },
    { name: "cloudflare.d1.production.migration_0002", status: "fail", code: "D1_0002_NOT_APPLIED" },
  ]);

  assert.deepEqual(blockers, [
    "R2_NOT_ENABLED",
    "deployment_url.staging.pages",
    "deployment_url.staging.worker_api",
    "deployment_url.production.pages",
    "deployment_url.production.worker_api",
    "D1_0002_NOT_APPLIED",
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
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestAnonId = String(request.headers["x-silsigan-anon-id"] ?? "");
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
        new URL("../scripts/cloudflare-staging-smoke.mjs", import.meta.url).pathname,
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

test("GET /api/tourism/attractions falls back to seed tourism places without a service key", async () => {
  const response = await worker.handleRequest(new Request("https://api.test/api/tourism/attractions?regionId=busan&limit=5"));
  const payload = (await response.json()) as SuccessPayload<Array<Place & { source?: string }>>;

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.meta?.provider, "tourapi-fallback");
  assert.equal(payload.meta?.configured, false);
  assert.deepEqual(
    payload.data.map((place) => place.id),
    ["busan-gwangalli", "busan-haeundae", "busan-songjeong"],
  );
});

test("GET /api/tourism/attractions maps TourAPI results to public map places", async () => {
  const originalFetch = globalThis.fetch;
  const mockFetch: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

    assert.equal(url.pathname, "/B551011/KorService2/areaBasedList2");
    assert.equal(url.searchParams.get("areaCode"), "6");
    assert.equal(url.searchParams.get("MobileApp"), "Silsigan");
    assert.equal(url.searchParams.get("_type"), "json");

    return new Response(
      JSON.stringify({
        response: {
          header: { resultCode: "0000", resultMsg: "OK" },
          body: {
            totalCount: 1,
            items: {
              item: [
                {
                  contentid: "999",
                  title: "해운대해수욕장",
                  addr1: "부산 해운대구 우동",
                  mapx: "129.1603",
                  mapy: "35.1587",
                  contenttypeid: "12",
                  areacode: "6",
                },
              ],
            },
          },
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  globalThis.fetch = mockFetch;

  try {
    const response = await worker.handleRequest(
      new Request("https://api.test/api/tourism/attractions?regionId=busan&limit=5"),
      { TOUR_API_SERVICE_KEY: "encoded%2Bkey" },
    );
    const payload = (await response.json()) as SuccessPayload<Array<Place & { address?: string; source?: string }>>;

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.meta?.provider, "tourapi");
    assert.equal(payload.data[0]?.id, "tourapi-999");
    assert.equal(payload.data[0]?.name, "해운대해수욕장");
    assert.equal(payload.data[0]?.regionId, "busan");
    assert.equal(payload.data[0]?.address, "부산 해운대구 우동");
    assert.equal(payload.data[0]?.source, "tourapi");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

function writeMobileTestFlightShell(mobileAppPath: string, mobileAppConfigPath: string, mobileExperiencePath: string) {
  const stagingWebUrl = "https://silsigan-web-staging.dudqks0319.workers.dev";
  const privacyPolicyUrl = "https://silsigan-web-staging.dudqks0319.workers.dev/privacy";
  const supportUrl = "https://silsigan-web-staging.dudqks0319.workers.dev/support";

  writeFileSync(
    mobileAppPath,
    [
      'import { Linking, Pressable, Text } from "react-native";',
      'import { serviceLinks } from "./src/silsiganExperience";',
      "",
      "export default function App() {",
      "  return <>",
      "    <Text>베타 지원</Text>",
      "    <ExternalLinkButton label=\"개인정보\" url={serviceLinks.privacyPolicyUrl} />",
      "    <ExternalLinkButton label=\"지원 문의\" url={serviceLinks.supportUrl} />",
      "    <ExternalLinkButton label=\"staging web\" url={serviceLinks.stagingWebUrl} />",
      "  </>;",
      "}",
      "",
      "function ExternalLinkButton({ label, url }: { label: string; url: string }) {",
      "  return <Pressable accessibilityRole=\"button\" onPress={() => void Linking.openURL(url)}><Text>{label}</Text></Pressable>;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    mobileExperiencePath,
    [
      "export type ServiceLinks = {",
      "  stagingWebUrl: string;",
      "  privacyPolicyUrl: string;",
      "  supportUrl: string;",
      "};",
      "",
      "export const serviceLinks: ServiceLinks = {",
      `  stagingWebUrl: "${stagingWebUrl}",`,
      `  privacyPolicyUrl: "${privacyPolicyUrl}",`,
      `  supportUrl: "${supportUrl}",`,
      "};",
      "",
      "export function getServiceLinkReadiness() {",
      "  return { stagingWebUrl: true, privacyPolicyUrl: true, supportUrl: true };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    mobileAppConfigPath,
    JSON.stringify(
      {
        expo: {
          ios: {
            infoPlist: {
              NSCameraUsageDescription: "camera",
              NSLocationWhenInUseUsageDescription: "location",
              NSPhotoLibraryUsageDescription: "photo library",
            },
          },
          android: {
            permissions: ["CAMERA", "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
          },
          extra: {
            silsigan: {
              stagingWebUrl,
              privacyPolicyUrl,
              supportUrl,
            },
          },
        },
      },
      null,
      2,
    ),
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
  return {
    vars: {
      ENVIRONMENT: input.envName,
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

test("Cloudflare Worker serves posts hashtags and questions without Next.js mock APIs", async () => {
  const anonymousId = "anon_posts_questions_test";
  const postsPayload = await get<SuccessPayload<FeedPost[]>>("https://api.test/api/posts?regionId=seoul&limit=10", anonymousId);
  assert.equal(postsPayload.meta?.storage, "memory-fallback");
  assert.equal(postsPayload.data.length >= 1, true);
  assert.equal(postsPayload.data.every((postItem) => postItem.placeId === "seoul-yeouido"), true);
  assert.equal(postsPayload.data.every((postItem) => !postItem.userId.startsWith("anon_")), true);
  assert.equal(postsPayload.data[0]?.hashtags.some((tag) => tag.name === "서울"), true);
  assert.match(postsPayload.data[0]?.shareCard.headline ?? "", /여의도 한강공원/);

  const hashtagsPayload = await get<SuccessPayload<Array<{ name: string; postCount: number }>>>("https://api.test/api/hashtags", anonymousId);
  assert.equal(hashtagsPayload.data.some((tag) => tag.name === "서울" && tag.postCount >= 1), true);

  const filteredPayload = await get<SuccessPayload<FeedPost[]>>(
    "https://api.test/api/posts?hashtagName=%EC%84%9C%EC%9A%B8&limit=10",
    anonymousId,
  );
  assert.equal(filteredPayload.data.every((postItem) => postItem.hashtagNames.includes("서울")), true);

  const questionsPayload = await get<SuccessPayload<QuestionData[]>>("https://api.test/api/questions?regionId=seoul&limit=10", anonymousId);
  assert.equal(questionsPayload.data.some((question) => question.placeId === "seoul-yeouido"), true);

  const created = await post<SuccessPayload<{ question: QuestionData; balance: number; creditEvent: { amount: number } }>>(
    "https://api.test/api/questions",
    anonymousId,
    {
      placeId: "seoul-yeouido",
      questionType: "crowd",
      body: "지금 잔디밭 자리 여유 있나요?",
      availableCredits: 3,
    },
  );
  assert.equal(created.data.question.placeId, "seoul-yeouido");
  assert.equal(created.data.balance, 2);
  assert.equal(created.data.creditEvent.amount, -1);

  const mine = await get<SuccessPayload<QuestionData[]>>("https://api.test/api/my-questions", anonymousId);
  assert.equal(mine.data.some((question) => question.id === created.data.question.id && question.status === "pending"), true);
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
        SELECT 'todo=' || COUNT(*) FROM places WHERE coordinate_status = 'TODO_COORDINATE_VERIFY' AND latitude IS NULL AND longitude IS NULL;
      `,
    });

    assert.match(output, /places=15/);
    assert.match(output, /rankings=15/);
    assert.match(output, /posts=4/);
    assert.match(output, /questions=3/);
    assert.match(output, /todo=1/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("D1 migration chain and core seed are release-order idempotent", { skip: !sqlite3Available() }, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "silsigan-d1-migrations-"));
  const dbPath = join(tempDir, "migrations.db");
  const migrations = ["0001_initial.sql", "0002_posts_questions.sql"]
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
        SELECT 'places=' || COUNT(*) FROM places;
        SELECT 'rankings=' || COUNT(*) FROM place_rankings;
        SELECT 'posts=' || COUNT(*) FROM posts;
        SELECT 'questions=' || COUNT(*) FROM questions;
      `,
    });

    assert.match(output, /tables=6/);
    assert.match(output, /post_indexes=2/);
    assert.match(output, /question_indexes=2/);
    assert.match(output, /places=15/);
    assert.match(output, /rankings=15/);
    assert.match(output, /posts=4/);
    assert.match(output, /questions=3/);
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
    assert.equal(createdPost.data.post.hashtagNames.includes("scriptbadscript"), true);
    assert.equal(createdPost.data.privacyNotice.includes("정확한 좌표"), true);

    const hashtagsPayload = await d1Get<SuccessPayload<Array<{ name: string; postCount: number }>>>(db, "https://api.test/api/hashtags", anonymousId);
    assert.equal(hashtagsPayload.meta?.storage, "d1");
    assert.equal(hashtagsPayload.data.some((tag) => tag.name === "서울" && tag.postCount >= 2), true);

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
    assert.notEqual(comment.data.anonymousUserId, anonymousId);

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

    const adminAction = await db.prepare("SELECT COUNT(*) AS count FROM admin_actions WHERE target_id = ?").bind(photo.data.photo.id).first<{ count: number }>();
    assert.equal(adminAction?.count, 1);
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
      },
    });
    const payload = (await response.json()) as SuccessPayload<FieldReportData>;
    const serializedPayload = JSON.stringify(payload);

    assert.equal(response.status, 201);
    assert.equal(payload.meta?.storage, "d1");
    assert.equal(payload.meta?.locationPolicy, "clientLocation-used-only-for-distance-and-not-stored");
    assert.equal(payload.data.report.placeId, "busan-gwangalli");
    assert.equal(payload.data.report.verifiedRadiusM, 50);
    assert.deepEqual(payload.data.credits, [
      { type: "verified_report", amount: 1 },
      { type: "photo_report", amount: 1 },
    ]);
    assert.equal(serializedPayload.includes("35.1532"), false);
    assert.equal(serializedPayload.includes("129.1186"), false);
    assert.equal(serializedPayload.includes("images.example.test"), false);
    assert.equal("clientLocation" in payload.data.report, false);
    assert.equal("anonymousUserId" in payload.data.report, false);

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
    },
  });
  const list = await get<SuccessPayload<Array<{ id: string; placeId: string; weatherFeel?: string }>>>(
    "https://api.test/api/reports?placeId=ulsan-taehwagang&limit=5",
    anonymousId,
  );
  const serializedList = JSON.stringify(list);

  assert.equal(list.meta?.storage, "memory-fallback");
  assert.equal(list.data.some((report) => report.id === created.data.report.id), true);
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

test("D1 place click upserts TourAPI places before recording events", { skip: !sqlite3Available() }, async () => {
  const { db, tempDir } = createSeededSqliteD1();

  try {
    const anonymousId = "anon_d1_tourapi_click";
    const firstClick = await d1Post<SuccessPayload<{ placeId: string; clickCount: number; created: boolean }>>(
      db,
      "https://api.test/api/places/tourapi-999/click",
      anonymousId,
      {
        source: "map_marker",
        place: {
          id: "tourapi-999",
          name: "테스트 관광지",
          categoryId: "tourism",
          regionId: "busan",
          latitude: 35.17,
          longitude: 129.13,
          address: "부산광역시 테스트로 1",
          score: 77,
        },
      },
    );
    const secondClick = await d1Post<SuccessPayload<{ placeId: string; clickCount: number; created: boolean }>>(
      db,
      "https://api.test/api/places/tourapi-999/click",
      anonymousId,
      {
        source: "map_marker",
        place: {
          id: "tourapi-999",
          name: "테스트 관광지",
          categoryId: "tourism",
          regionId: "busan",
          latitude: 35.17,
          longitude: 129.13,
          address: "부산광역시 테스트로 1",
        },
      },
    );

    assert.equal(firstClick.data.placeId, "tourapi-999");
    assert.equal(firstClick.data.created, true);
    assert.equal(secondClick.data.created, false);
    assert.equal(secondClick.data.clickCount, 1);

    const storedPlace = await db
      .prepare("SELECT id, area_id AS areaId, region_id AS regionId, name FROM places WHERE id = ?")
      .bind("tourapi-999")
      .first<{ id: string; areaId: string; regionId: string; name: string }>();
    assert.deepEqual(storedPlace, {
      id: "tourapi-999",
      areaId: "busan-tourapi",
      regionId: "busan",
      name: "테스트 관광지",
    });

    const storedSignals = await db
      .prepare("SELECT COUNT(*) AS count FROM place_events WHERE place_id = ? AND event_type = 'click'")
      .bind("tourapi-999")
      .first<{ count: number }>();
    assert.equal(storedSignals?.count, 1);
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
    assert.equal(actions?.count, 7);
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
    const anonymousUserId = existingComment.data.anonymousUserId;
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
      targetType: "place" | "comment" | "photo";
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
    assert.equal(firstPayload.meta?.duplicatePolicy, "exact-sanitized-content-sha256-blocks-active-duplicates");
    assert.equal(r2.putObjects.length, 1);

    const stored = await db
      .prepare("SELECT image_hash AS imageHash, duplicate_status AS duplicateStatus FROM photos WHERE id = ?")
      .bind(firstPayload.data.photo.id)
      .first<{ imageHash: string; duplicateStatus: string }>();
    assert.match(stored?.imageHash ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.equal(stored?.duplicateStatus, "unique");

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

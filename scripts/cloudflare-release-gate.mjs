#!/usr/bin/env node

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const LOCAL_PAGES_REPORT_TIMEOUT_MS = 45_000;
const MUTATING_REQUIRED_ENV_KEYS = ["SILSIGAN_STAGING_ADMIN_TOKEN"];
const RELEASE_CANDIDATE_REQUIRED_URL_ENV_KEYS = ["SILSIGAN_STAGING_PAGES_URL", "SILSIGAN_STAGING_API_BASE_URL"];
const PRODUCTION_CANDIDATE_REQUIRED_URL_ENV_KEYS = ["SILSIGAN_PRODUCTION_PAGES_URL", "SILSIGAN_PRODUCTION_API_BASE_URL"];
const COORDINATE_STATUS_REQUIRED_ENV_KEYS = [
  "SILSIGAN_STAGING_COORDINATE_SMOKE_PLACE_ID",
  "SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE",
  "SILSIGAN_STAGING_COORDINATE_SMOKE_LONGITUDE",
];
const CANONICAL_BLOCKER_ALIASES = new Map([
  ["PAGES_URL_REQUIRED", "deployment_url.staging.pages"],
  ["BASE_URL_REQUIRED", "deployment_url.staging.worker_api"],
  ["staging.pages.url", "deployment_url.staging.pages"],
  ["staging.worker_api.url", "deployment_url.staging.worker_api"],
  ["production.pages.url", "deployment_url.production.pages"],
  ["production.worker_api.url", "deployment_url.production.worker_api"],
  ["cloudflare.r2.enabled", "R2_NOT_ENABLED"],
  ["cloudflare.d1.production.migration_0002", "D1_0002_NOT_APPLIED"],
  ["DEPLOYMENT_URL_REQUIRED", null],
]);

if (isCliEntryPoint()) {
  await main();
}

export function parseArgs(rawArgs) {
  const flags = new Set();
  const options = new Map();

  for (let index = 0; index < rawArgs.length; index += 1) {
    const rawArg = rawArgs[index];
    if (!rawArg.startsWith("--")) {
      continue;
    }

    const arg = rawArg.slice(2);
    const separatorIndex = arg.indexOf("=");
    if (separatorIndex !== -1) {
      options.set(arg.slice(0, separatorIndex), arg.slice(separatorIndex + 1));
      continue;
    }

    const nextArg = rawArgs[index + 1];
    if (nextArg && !nextArg.startsWith("--")) {
      options.set(arg, nextArg);
      index += 1;
      continue;
    }

    flags.add(arg);
  }

  return { flags, options };
}

export function resolveReleaseGatePlan({ flags = new Set(), options = new Map(), env = process.env } = {}) {
  const releaseCandidate = flags.has("release-candidate") || env.SILSIGAN_RELEASE_GATE_RELEASE_CANDIDATE === "1";
  const productionCandidate = flags.has("production-candidate") || env.SILSIGAN_RELEASE_GATE_PRODUCTION_CANDIDATE === "1";
  const mutating = releaseCandidate || flags.has("mutating") || env.SILSIGAN_RELEASE_GATE_MUTATION === "1";
  const coordinateStatus = flags.has("coordinate-status") || env.SILSIGAN_RELEASE_GATE_COORDINATE_STATUS === "1";
  const browserReport = releaseCandidate || flags.has("browser-report") || env.SILSIGAN_RELEASE_GATE_BROWSER_REPORT === "1";
  const requirePhoto = releaseCandidate || flags.has("require-photo") || env.SILSIGAN_RELEASE_GATE_REQUIRE_PHOTO === "1";
  const localPagesReport = flags.has("local-pages-report") || env.SILSIGAN_RELEASE_GATE_LOCAL_PAGES_REPORT === "1";
  const tailRequired = releaseCandidate || flags.has("tail-required") || env.SILSIGAN_RELEASE_GATE_TAIL_REQUIRED === "1";
  const collectBlockers = flags.has("collect-blockers") || env.SILSIGAN_RELEASE_GATE_COLLECT_BLOCKERS === "1";
  const tailFile = options.get("tail-file") ?? env.SILSIGAN_STAGING_TAIL_LOG_FILE ?? "";
  const timeoutMs = numberOption(options.get("timeout-ms") ?? env.SILSIGAN_RELEASE_GATE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const steps = [];
  const errors = [];

  if (collectBlockers && mutating) {
    errors.push({
      code: "COLLECT_BLOCKERS_REQUIRES_NON_MUTATING",
      message: "--collect-blockers 는 실제 쓰기 smoke 없이 non-mutating release evidence에서만 사용할 수 있습니다.",
    });
  }

  if (tailRequired && !tailFile) {
    errors.push({
      code: "TAIL_FILE_REQUIRED",
      message: "SILSIGAN_STAGING_TAIL_LOG_FILE 또는 --tail-file 이 필요합니다.",
    });
  }

  if (releaseCandidate) {
    collectHttpsUrlErrors(errors, RELEASE_CANDIDATE_REQUIRED_URL_ENV_KEYS, env);
  }

  if (productionCandidate) {
    collectHttpsUrlErrors(errors, PRODUCTION_CANDIDATE_REQUIRED_URL_ENV_KEYS, env);
  }

  if (requirePhoto && !mutating) {
    errors.push({
      code: "REQUIRE_PHOTO_REQUIRES_MUTATING",
      message: "--require-photo 는 --mutating 또는 SILSIGAN_RELEASE_GATE_MUTATION=1 과 함께 실행해야 합니다.",
    });
  }

  if (browserReport && !mutating) {
    errors.push({
      code: "BROWSER_REPORT_REQUIRES_MUTATING",
      message: "--browser-report 는 --mutating 또는 SILSIGAN_RELEASE_GATE_MUTATION=1 과 함께 실행해야 합니다.",
    });
  }

  if (mutating) {
    for (const key of MUTATING_REQUIRED_ENV_KEYS) {
      if (!env[key]?.trim()) {
        errors.push({
          code: `${key}_REQUIRED`,
          message: `${key} 이 필요합니다.`,
        });
      }
    }
  }

  if (coordinateStatus && !mutating) {
    errors.push({
      code: "COORDINATE_STATUS_REQUIRES_MUTATING",
      message: "--coordinate-status 는 --mutating 또는 SILSIGAN_RELEASE_GATE_MUTATION=1 과 함께 실행해야 합니다.",
    });
  }

  if (coordinateStatus) {
    for (const key of COORDINATE_STATUS_REQUIRED_ENV_KEYS) {
      if (!env[key]?.trim()) {
        errors.push({
          code: `${key}_REQUIRED`,
          message: `${key} 이 필요합니다.`,
        });
      }
    }

    for (const key of ["SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE", "SILSIGAN_STAGING_COORDINATE_SMOKE_LONGITUDE"]) {
      if (env[key]?.trim() && !Number.isFinite(Number(env[key]))) {
        errors.push({
          code: `${key}_INVALID`,
          message: `${key} 은 숫자여야 합니다.`,
        });
      }
    }
  }

  if (!flags.has("skip-verify")) {
    steps.push(step("verify.local", ["verify"]));
  }

  if (localPagesReport) {
    steps.push(step("pages.browser.localReportSmoke", ["smoke:pages:local-report", "--", `--timeout-ms=${LOCAL_PAGES_REPORT_TIMEOUT_MS}`]));
  }

  if (tailFile) {
    steps.push(step("workers.tail.redaction", ["smoke:tail-redaction", "--", `--tail-file=${tailFile}`], ["SILSIGAN_STAGING_TAIL_LOG_FILE"]));
  }

  steps.push(step("release.status.strict", ["release:status", "--", "--strict"]));
  steps.push(step("audit.critical", ["audit", "--audit-level", "critical"]));
  steps.push(step("frontend.typegen", ["cf:typegen"]));
  steps.push(step("frontend.openNextBuild", ["cf:build"]));
  steps.push(step("frontend.wranglerDryRun.development", ["cf:web:dry-run"]));
  steps.push(step("frontend.wranglerDryRun.staging", ["cf:web:dry-run:staging"]));
  steps.push(step("frontend.wranglerDryRun.production", ["cf:web:dry-run:production"]));
  steps.push(step("cloudflare.preflight", ["cf:preflight"]));
  steps.push(step("cloudflare.r2Evidence.staging", ["cf:r2:evidence", "--", "--env=staging", "--check"]));
  steps.push(step("cloudflare.d1Evidence.staging", ["cf:d1:evidence", "--", "--env=staging", "--check"]));
  steps.push(step("cloudflare.r2Evidence.production", ["cf:r2:evidence", "--", "--env=production", "--check"]));
  steps.push(step("cloudflare.d1Evidence.production", ["cf:d1:evidence", "--", "--env=production", "--check"]));
  steps.push(step("cloudflare.externalState", ["cf:external-state"]));

  if (!flags.has("skip-dry-run")) {
    steps.push(step("wrangler.dryRun.staging", ["cf:dry-run:staging"]));
    steps.push(step("wrangler.dryRun.production", ["cf:dry-run:production"]));
  }

  const stagingSmokeArgs = ["smoke:staging"];
  const stagingSmokeEnvKeys = ["SILSIGAN_STAGING_API_BASE_URL"];
  if (mutating) {
    stagingSmokeArgs.push("--", "--mutating", "--require-admin");
    stagingSmokeEnvKeys.push(...MUTATING_REQUIRED_ENV_KEYS);
    if (coordinateStatus) {
      stagingSmokeArgs.push("--coordinate-status");
      stagingSmokeEnvKeys.push(...COORDINATE_STATUS_REQUIRED_ENV_KEYS);
    }
  }
  steps.push(step("staging.api.smoke", stagingSmokeArgs, stagingSmokeEnvKeys));

  const pagesSmokeArgs = ["smoke:pages"];
  const pagesSmokeFlags = [];
  if (mutating) pagesSmokeFlags.push("--mutating");
  if (browserReport) pagesSmokeFlags.push("--report");
  if (requirePhoto) pagesSmokeFlags.push("--require-photo");
  if (pagesSmokeFlags.length > 0) {
    pagesSmokeArgs.push("--", ...pagesSmokeFlags);
  }
  steps.push(step("pages.browser.smoke", pagesSmokeArgs, RELEASE_CANDIDATE_REQUIRED_URL_ENV_KEYS));

  if (productionCandidate) {
    steps.push(
      step(
        "production.api.smoke",
        ["smoke:staging"],
        ["SILSIGAN_PRODUCTION_API_BASE_URL"],
        { SILSIGAN_STAGING_API_BASE_URL: "SILSIGAN_PRODUCTION_API_BASE_URL" },
      ),
    );
    steps.push(
      step(
        "production.pages.smoke",
        ["smoke:pages"],
        PRODUCTION_CANDIDATE_REQUIRED_URL_ENV_KEYS,
        {
          SILSIGAN_STAGING_PAGES_URL: "SILSIGAN_PRODUCTION_PAGES_URL",
          SILSIGAN_STAGING_API_BASE_URL: "SILSIGAN_PRODUCTION_API_BASE_URL",
        },
      ),
    );
  }

  return {
    ok: errors.length === 0,
    timeoutMs,
    releaseCandidate,
    productionCandidate,
    mutating,
    coordinateStatus,
    browserReport,
    requirePhoto,
    localPagesReport,
    tailRequired,
    collectBlockers,
    errors,
    steps,
  };
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    printHelp();
    return;
  }

  const plan = resolveReleaseGatePlan({ flags, options, env: process.env });
  if (flags.has("plan-only")) {
    printSummary({
      ok: plan.ok,
      mode: "plan-only",
      ...plan,
    });
    process.exitCode = plan.ok ? 0 : 1;
    return;
  }

  if (!plan.ok) {
    printSummary({
      ok: false,
      mode: "run",
      ...plan,
      results: [],
    });
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const plannedStep of plan.steps) {
    const result = await runStep(plannedStep, plan.timeoutMs);
    results.push(result);
    if (result.status === "fail" && !plan.collectBlockers) {
      break;
    }
  }

  const ok = results.length === plan.steps.length && results.every((result) => result.status === "pass");
  const resultSummary = summarizeResults(results);
  printSummary({
    ...plan,
    ...resultSummary,
    ok,
    mode: "run",
    results,
  });

  if (!ok) {
    process.exitCode = 1;
  }
}

function step(name, args, envKeys = [], envFromKeys = {}) {
  return {
    name,
    command: "pnpm",
    args,
    envKeys,
    envFromKeys,
    label: ["pnpm", ...args].join(" "),
  };
}

async function runStep(plannedStep, timeoutMs) {
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(plannedStep.command, plannedStep.args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 12,
      env: resolveStepEnv(plannedStep),
    });

    return {
      name: plannedStep.name,
      status: "pass",
      durationMs: Date.now() - startedAt,
      outputTail: redactOutput(tail(stdout, 2_000)),
      errorTail: redactOutput(tail(stderr, 2_000)),
    };
  } catch (error) {
    const stdout = String(error?.stdout ?? "");
    const stderr = String(error?.stderr ?? error?.message ?? "");
    return {
      name: plannedStep.name,
      status: "fail",
      durationMs: Date.now() - startedAt,
      exitCode: typeof error?.code === "number" ? error.code : null,
      signal: typeof error?.signal === "string" ? error.signal : null,
      blockers: extractTextBlockers(stdout, stderr),
      outputTail: redactOutput(tail(stdout, 4_000)),
      errorTail: redactOutput(tail(stderr, 4_000)),
    };
  }
}

function resolveStepEnv(plannedStep) {
  const env = { ...process.env };
  for (const [targetKey, sourceKey] of Object.entries(plannedStep.envFromKeys ?? {})) {
    env[targetKey] = process.env[sourceKey] ?? "";
  }
  return env;
}

export function summarizeResults(results) {
  const resultCounts = {};
  const failedSteps = [];
  const blockers = [];
  const seenBlockers = new Set();

  for (const result of results) {
    resultCounts[result.status] = (resultCounts[result.status] ?? 0) + 1;
    if (result.status === "fail") {
      failedSteps.push(result.name);
    }

    for (const blocker of extractResultBlockers(result)) {
      if (!seenBlockers.has(blocker)) {
        seenBlockers.add(blocker);
        blockers.push(blocker);
      }
    }
  }

  return { resultCounts, failedSteps, blockers };
}

function extractResultBlockers(result) {
  const blockers = [];
  if (Array.isArray(result.blockers)) {
    for (const blocker of result.blockers) {
      collectBlockerCode(blockers, blocker);
    }
  }

  for (const value of [result.outputTail, result.errorTail]) {
    for (const payload of parseJsonPayloads(value)) {
      collectPayloadBlockers(payload, blockers);
    }
  }
  return blockers;
}

function extractTextBlockers(...values) {
  const blockers = [];
  for (const value of values) {
    for (const payload of parseJsonPayloads(value)) {
      collectPayloadBlockers(payload, blockers);
    }
  }
  return blockers;
}

function collectPayloadBlockers(payload, blockers) {
  if (!isRecord(payload)) {
    return;
  }

  if (payload.status === "fail") {
    const messageCode = extractMessageCode(payload.message);
    collectBlockerCode(blockers, messageCode ?? payload.code ?? blockerNameFromCheck(payload));
  }

  if (Array.isArray(payload.blockers)) {
    for (const blocker of payload.blockers) {
      collectBlockerCode(blockers, blocker);
    }
  }

  if (Array.isArray(payload.checks)) {
    for (const check of payload.checks) {
      if (!isRecord(check) || check.status !== "fail") {
        continue;
      }

      const messageCode = extractMessageCode(check.message);
      collectBlockerCode(blockers, messageCode ?? check.code ?? blockerNameFromCheck(check));
    }
  }
}

function blockerNameFromCheck(check) {
  return check.name === "harness" ? null : check.name;
}

function extractMessageCode(message) {
  if (typeof message !== "string") {
    return null;
  }

  const explicitCode = message.match(/^([A-Z0-9_]{3,80}):/)?.[1];
  if (explicitCode) {
    return explicitCode;
  }

  if (message.includes("SILSIGAN_STAGING_PAGES_URL")) {
    return "PAGES_URL_REQUIRED";
  }

  if (message.includes("SILSIGAN_STAGING_API_BASE_URL") || message.includes("NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL")) {
    return "BASE_URL_REQUIRED";
  }

  return null;
}

function collectBlockerCode(blockers, value) {
  if (typeof value !== "string") {
    return;
  }

  const blocker = value.trim();
  if (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(blocker)) {
    const canonicalBlocker = CANONICAL_BLOCKER_ALIASES.has(blocker) ? CANONICAL_BLOCKER_ALIASES.get(blocker) : blocker;
    if (canonicalBlocker) {
      blockers.push(canonicalBlocker);
    }
  }
}

function parseJsonPayloads(value) {
  const text = String(value ?? "");
  const payloads = [];
  let start = text.indexOf("{");

  while (start !== -1) {
    const end = findJsonObjectEnd(text, start);
    if (end === -1) {
      break;
    }

    try {
      payloads.push(JSON.parse(text.slice(start, end + 1)));
      start = text.indexOf("{", end + 1);
    } catch {
      start = text.indexOf("{", start + 1);
    }
  }

  return payloads;
}

function findJsonObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function tail(value, limit) {
  if (value.length <= limit) {
    return value;
  }

  return value.slice(value.length - limit);
}

function redactOutput(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, "Bearer [redacted]")
    .replace(/(x-silsigan-admin-token\\s*[:=]\\s*)[^\\s"']+/gi, "$1[redacted]")
    .replace(/(SILSIGAN_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\\s*=\\s*)[^\\s"']+/g, "$1[redacted]");
}

function numberOption(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function collectHttpsUrlErrors(errors, keys, env) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (!value) {
      errors.push({
        code: `${key}_REQUIRED`,
        message: `${key} 이 필요합니다.`,
      });
      continue;
    }

    if (!isHttpsUrl(value)) {
      errors.push({
        code: `${key}_INVALID`,
        message: `${key} 은 HTTPS 배포 URL이어야 합니다.`,
      });
    }
  }
}

function printSummary(summary) {
  console.log(
    JSON.stringify(
      {
        ...summary,
        steps: summary.steps.map((plannedStep) => ({
          name: plannedStep.name,
          label: plannedStep.label,
          envKeys: plannedStep.envKeys,
        })),
      },
      null,
      2,
    ),
  );
}

function printHelp() {
  console.log(`Usage: node scripts/cloudflare-release-gate.mjs [--plan-only] [--local-pages-report] [--collect-blockers] [--release-candidate] [--production-candidate] [--mutating] [--coordinate-status] [--require-photo] [--browser-report] [--tail-required --tail-file=<path>]

Runs the release evidence chain:
  pnpm verify
  pnpm release:status -- --strict
  pnpm audit --audit-level critical
  pnpm cf:preflight
  pnpm cf:r2:evidence -- --env=staging --check
  pnpm cf:d1:evidence -- --env=staging --check
  pnpm cf:r2:evidence -- --env=production --check
  pnpm cf:d1:evidence -- --env=production --check
  pnpm cf:dry-run:staging / cf:dry-run:production
  pnpm smoke:staging
  pnpm smoke:pages
  optional pnpm smoke:tail-redaction

Options:
  --plan-only       Print the ordered gate plan without executing commands.
  --local-pages-report
                    Run local mock Worker + Next browser report smoke before strict
                    external staging checks. This is a local baseline only and does not
                    replace staging Pages/Worker evidence.
  --collect-blockers
                    Continue non-mutating evidence collection after a failed step so
                    external blockers such as missing URLs and R2 disabled state are
                    reported in one run. Not allowed with --mutating.
  --release-candidate
                    Enable final staging candidate evidence: --mutating,
                    --browser-report, --require-photo, and --tail-required.
                    Coordinate status smoke remains explicit opt-in.
  --production-candidate
                    Require HTTPS production Pages/API URLs and add read-only
                    production API/Pages smoke. Does not imply staging writes,
                    browser reports, photo requirements, or tail requirements.
  --mutating        Include staging/API and browser mutation smoke flags. Requires
                    SILSIGAN_STAGING_ADMIN_TOKEN.
  --coordinate-status
                    Include opt-in coordinate verification smoke. Requires --mutating and
                    SILSIGAN_STAGING_ADMIN_TOKEN, SILSIGAN_STAGING_COORDINATE_SMOKE_PLACE_ID,
                    SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE, and
                    SILSIGAN_STAGING_COORDINATE_SMOKE_LONGITUDE.
  --require-photo   Require a clickable public Worker photo in Pages smoke. Requires --mutating.
  --browser-report  Include actual browser report creation in Pages smoke. Requires --mutating.
  --tail-required   Fail unless --tail-file or SILSIGAN_STAGING_TAIL_LOG_FILE is set.
  --tail-file PATH  Captured Workers tail log used for redaction verification.
  --skip-verify     Skip pnpm verify.
  --skip-dry-run    Skip Wrangler dry-run commands.
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

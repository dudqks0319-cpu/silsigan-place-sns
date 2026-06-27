#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG_PATH = "workers/api/wrangler.jsonc";
const DEFAULT_ENVS = ["staging", "production"];
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const D1_RELEASE_EVIDENCE_QUERY = [
  "SELECT 'posts_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'posts'",
  "SELECT 'questions_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'questions'",
  "SELECT 'post_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_posts_place_created', 'idx_posts_status_created')",
  "SELECT 'question_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_questions_place_created', 'idx_questions_anon_created')",
  "SELECT 'posts=' || COUNT(*) FROM posts",
  "SELECT 'questions=' || COUNT(*) FROM questions",
].join("; ");
const DEPLOYMENT_URL_ENV_BY_ENV = {
  staging: {
    pages: "SILSIGAN_STAGING_PAGES_URL",
    worker_api: "SILSIGAN_STAGING_API_BASE_URL",
  },
  production: {
    pages: "SILSIGAN_PRODUCTION_PAGES_URL",
    worker_api: "SILSIGAN_PRODUCTION_API_BASE_URL",
  },
};
const FIELD_SPECIFIC_BLOCKER_CODES = new Set([
  "DEPLOYMENT_URL_REQUIRED",
  "DEPLOYMENT_URL_PLACEHOLDER",
  "DEPLOYMENT_URL_INVALID",
  "DEPLOYMENT_URL_UNSAFE",
  "DEPLOYMENT_URL_DUPLICATE",
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

export async function readExpectedR2BucketNames(configPath = DEFAULT_CONFIG_PATH, targetEnvs = DEFAULT_ENVS) {
  const config = JSON.parse(stripJsonComments(await readFile(configPath, "utf8")));
  const expected = [];

  for (const envName of targetEnvs) {
    const envConfig = envName === "" ? config : config.env?.[envName];
    const bucketNames = Array.isArray(envConfig?.r2_buckets)
      ? envConfig.r2_buckets.map((bucket) => bucket?.bucket_name).filter((bucketName) => typeof bucketName === "string" && bucketName.length > 0)
      : [];

    expected.push(...bucketNames);
  }

  return [...new Set(expected)];
}

export async function readExpectedD1Databases(configPath = DEFAULT_CONFIG_PATH, targetEnvs = DEFAULT_ENVS) {
  const config = JSON.parse(stripJsonComments(await readFile(configPath, "utf8")));
  const expected = [];

  for (const envName of targetEnvs) {
    const envConfig = envName === "" ? config : config.env?.[envName];
    const databases = Array.isArray(envConfig?.d1_databases) ? envConfig.d1_databases : [];
    const db = databases.find((database) => database?.binding === "DB") ?? databases[0];
    if (typeof db?.database_name !== "string" || db.database_name.length === 0) {
      expected.push({ envName, databaseName: null, binding: typeof db?.binding === "string" ? db.binding : null });
      continue;
    }

    expected.push({ envName, databaseName: db.database_name, binding: typeof db?.binding === "string" ? db.binding : null });
  }

  return expected;
}

export function classifyR2BucketListResult(result, expectedBucketNames = []) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.exitCode !== 0) {
    if (/code:\s*10042|enable R2/i.test(output)) {
      return {
        name: "cloudflare.r2.enabled",
        status: "fail",
        code: "R2_NOT_ENABLED",
        message: "Cloudflare account R2 is not enabled. Enable R2 in the Cloudflare Dashboard before Worker deploy and staging photo smoke.",
      };
    }

    return {
      name: "cloudflare.r2.enabled",
      status: "fail",
      code: "R2_BUCKET_LIST_FAILED",
      message: "Could not list Cloudflare R2 buckets with Wrangler.",
    };
  }

  const missingBuckets = expectedBucketNames.filter((bucketName) => !output.includes(bucketName));
  if (missingBuckets.length > 0) {
    return {
      name: "cloudflare.r2.buckets",
      status: "fail",
      code: "R2_BUCKETS_MISSING",
      message: "Cloudflare R2 is enabled, but required project buckets are missing.",
      missingBuckets,
    };
  }

  return {
    name: "cloudflare.r2.buckets",
    status: "pass",
    message: "Cloudflare R2 is enabled and required project buckets are visible to Wrangler.",
    bucketCount: expectedBucketNames.length,
  };
}

export function classifyD1MigrationResult(result, envName) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const name = `cloudflare.d1.${envName}.migration_0002`;

  if (result.exitCode !== 0) {
    if (/no such table:\s*(posts|questions)|SQLITE_ERROR/i.test(output)) {
      return {
        name,
        status: "fail",
        code: "D1_0002_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the posts/questions migration.`,
      };
    }

    return {
      name,
      status: "fail",
      code: "D1_REMOTE_CHECK_FAILED",
      message: `Could not read remote ${envName} D1 migration state with Wrangler.`,
      outputTail: sanitizeWranglerOutput(tail(output, 1_500)),
    };
  }

  const counters = parseD1Counters(output);
  const missingSchema = [];
  if ((counters.posts_table ?? 0) < 1) missingSchema.push("posts");
  if ((counters.questions_table ?? 0) < 1) missingSchema.push("questions");
  if ((counters.post_indexes ?? 0) < 2) missingSchema.push("posts indexes");
  if ((counters.question_indexes ?? 0) < 2) missingSchema.push("questions indexes");

  if (missingSchema.length > 0) {
    return {
      name,
      status: "fail",
      code: "D1_0002_NOT_APPLIED",
      message: `Remote ${envName} D1 is missing ${missingSchema.join(", ")} from 0002_posts_questions.sql.`,
      missingSchema,
    };
  }

  const missingSeed = [];
  if ((counters.posts ?? 0) < 4) missingSeed.push("posts");
  if ((counters.questions ?? 0) < 3) missingSeed.push("questions");

  if (missingSeed.length > 0) {
    return {
      name: `cloudflare.d1.${envName}.seed_posts_questions`,
      status: "fail",
      code: "D1_SEED_INCOMPLETE",
      message: `Remote ${envName} D1 posts/questions seed evidence is incomplete.`,
      missingSeed,
      counts: counters,
    };
  }

  return {
    name,
    status: "pass",
    message: `Remote ${envName} D1 has posts/questions schema and seed evidence.`,
    counts: {
      posts: counters.posts,
      questions: counters.questions,
    },
  };
}

export function classifyCloudflareAuthResult(result) {
  return {
    name: "cloudflare.auth",
    status: result.exitCode === 0 ? "pass" : "fail",
    ...(result.exitCode === 0 ? {} : { code: "CLOUDFLARE_AUTH_REQUIRED" }),
    message:
      result.exitCode === 0
        ? "Wrangler OAuth or API token is available."
        : "Wrangler cannot read the Cloudflare account. Set CLOUDFLARE_API_TOKEN or complete Wrangler login before remote R2/D1 evidence checks.",
  };
}

export function classifyAuthBlockedRemoteCheck(name, subject) {
  return {
    name,
    status: "fail",
    code: "CLOUDFLARE_AUTH_REQUIRED",
    message: `${subject} was skipped because Wrangler Cloudflare auth is not available.`,
  };
}

export function sanitizeWranglerOutput(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[a-f0-9]{32}\b/gi, "[redacted-account-id]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/g, "Bearer [redacted]")
    .replace(/(CLOUDFLARE_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s"']+/g, "$1[redacted]");
}

export function classifyDeploymentUrlState(env = process.env, targetEnvs = DEFAULT_ENVS) {
  const checks = [];
  const parsedUrls = new Map();

  for (const envName of targetEnvs) {
    const requirements = DEPLOYMENT_URL_ENV_BY_ENV[envName];
    if (!requirements) {
      continue;
    }

    for (const [kind, envVarName] of Object.entries(requirements)) {
      const check = classifyDeploymentUrl(env[envVarName], `deployment_url.${envName}.${kind}`, envVarName);
      checks.push(check);
      if (check.status === "pass") {
        parsedUrls.set(`${envName}.${kind}`, check.href);
        delete check.href;
      }
    }
  }

  checks.push(...classifySeparatedDeploymentUrls(parsedUrls));
  return checks;
}

export function summarizeExternalStateBlockers(failedChecks) {
  const blockers = [];
  const seen = new Set();

  for (const check of failedChecks) {
    const blocker = externalStateBlockerForCheck(check);
    if (blocker && !seen.has(blocker)) {
      seen.add(blocker);
      blockers.push(blocker);
    }
  }

  return blockers;
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    printHelp();
    return;
  }

  const configPath = options.get("config") ?? DEFAULT_CONFIG_PATH;
  const targetEnvs = options.get("env") ? options.get("env").split(",").map((envName) => envName.trim()).filter(Boolean) : DEFAULT_ENVS;
  const timeoutMs = numberOption(options.get("timeout-ms") ?? process.env.SILSIGAN_CLOUDFLARE_EXTERNAL_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const checks = [];

  let expectedBucketNames = [];
  let expectedD1Databases = [];
  try {
    expectedBucketNames = await readExpectedR2BucketNames(configPath, targetEnvs);
    record(checks, "wrangler.config.r2Buckets", "pass", "Expected R2 bucket names were read from wrangler config.", {
      bucketCount: expectedBucketNames.length,
    });
  } catch (error) {
    record(checks, "wrangler.config.r2Buckets", "fail", publicErrorMessage(error));
  }

  try {
    expectedD1Databases = await readExpectedD1Databases(configPath, targetEnvs);
    record(checks, "wrangler.config.d1Databases", "pass", "Expected D1 database names were read from wrangler config.", {
      databaseCount: expectedD1Databases.filter((database) => database.databaseName).length,
    });
  } catch (error) {
    record(checks, "wrangler.config.d1Databases", "fail", publicErrorMessage(error));
  }

  let cloudflareAuthBlocked = false;
  if (!flags.has("skip-whoami")) {
    const whoami = await runCommand("npx", ["--yes", "wrangler", "whoami"], timeoutMs);
    const authCheck = classifyCloudflareAuthResult(whoami);
    checks.push(authCheck);
    cloudflareAuthBlocked = authCheck.status === "fail";
  }

  if (!flags.has("skip-r2")) {
    checks.push(
      cloudflareAuthBlocked
        ? classifyAuthBlockedRemoteCheck("cloudflare.r2.enabled", "R2 bucket visibility check")
        : classifyR2BucketListResult(await runCommand("npx", ["--yes", "wrangler", "r2", "bucket", "list"], timeoutMs), expectedBucketNames),
    );
  }

  if (!flags.has("skip-deployment-urls")) {
    checks.push(...classifyDeploymentUrlState(process.env, targetEnvs));
  }

  if (!flags.has("skip-d1")) {
    for (const database of expectedD1Databases) {
      if (!database.databaseName) {
        record(
          checks,
          `cloudflare.d1.${database.envName}.database_name`,
          "fail",
          `workers/api wrangler config must define a D1 database_name for ${database.envName}.`,
          { code: "D1_DATABASE_NAME_REQUIRED" },
        );
        continue;
      }

      if (cloudflareAuthBlocked) {
        checks.push(classifyAuthBlockedRemoteCheck(`cloudflare.d1.${database.envName}.migration_0002`, `Remote ${database.envName} D1 migration evidence check`));
        continue;
      }

      const d1Result = await runCommand(
        "npx",
        [
          "--yes",
          "wrangler",
          "d1",
          "execute",
          database.databaseName,
          "--remote",
          "--env",
          database.envName,
          "--config",
          configPath,
          "--command",
          D1_RELEASE_EVIDENCE_QUERY,
        ],
        timeoutMs,
      );
      checks.push(classifyD1MigrationResult(d1Result, database.envName));
    }
  }

  if (!flags.has("skip-dry-run")) {
    for (const envName of targetEnvs) {
      const dryRun = await runCommand("npx", ["--yes", "wrangler", "deploy", "--dry-run", "--env", envName, "--config", configPath], timeoutMs);
      record(
        checks,
        `wrangler.dryRun.${envName}`,
        dryRun.exitCode === 0 ? "pass" : "fail",
        dryRun.exitCode === 0
          ? `Wrangler ${envName} dry-run completed with configured bindings.`
          : `Wrangler ${envName} dry-run failed.`,
        dryRun.exitCode === 0 ? {} : { code: "WRANGLER_DRY_RUN_FAILED", outputTail: sanitizeWranglerOutput(tail(`${dryRun.stdout}\n${dryRun.stderr}`, 1_500)) },
      );
    }
  }

  const failed = checks.filter((check) => check.status === "fail");
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        configPath,
        envs: targetEnvs,
        checks,
        blockers: summarizeExternalStateBlockers(failed),
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4, env: process.env }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

function classifyDeploymentUrl(value, name, envVarName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      name,
      status: "fail",
      code: "DEPLOYMENT_URL_REQUIRED",
      message: `${envVarName} is required.`,
    };
  }

  if (hasPlaceholder(value)) {
    return {
      name,
      status: "fail",
      code: "DEPLOYMENT_URL_PLACEHOLDER",
      message: `${envVarName} still contains a placeholder.`,
    };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return {
      name,
      status: "fail",
      code: "DEPLOYMENT_URL_INVALID",
      message: `${envVarName} must be a valid absolute URL.`,
    };
  }

  const reasons = [];
  if (url.protocol !== "https:") reasons.push("https_required");
  if (url.username || url.password) reasons.push("credentials_forbidden");
  if (url.search || url.hash) reasons.push("query_or_fragment_forbidden");
  if (isLocalhost(url.hostname)) reasons.push("localhost_forbidden");

  if (reasons.length > 0) {
    return {
      name,
      status: "fail",
      code: "DEPLOYMENT_URL_UNSAFE",
      message: `${envVarName} must be a deployed HTTPS URL without credentials, query params, fragments, or localhost hosts.`,
      reasons,
    };
  }

  return {
    name,
    status: "pass",
    message: `${envVarName} is present and deployment-shaped.`,
    host: url.host,
    href: url.href,
  };
}

function classifySeparatedDeploymentUrls(parsedUrls) {
  return [
    classifyUrlSeparation(parsedUrls, "staging.pages", "production.pages", "staging and production Pages URLs must not be identical."),
    classifyUrlSeparation(parsedUrls, "staging.worker_api", "production.worker_api", "staging and production Worker API URLs must not be identical."),
  ].filter(Boolean);
}

function classifyUrlSeparation(parsedUrls, leftKey, rightKey, message) {
  const left = parsedUrls.get(leftKey);
  const right = parsedUrls.get(rightKey);
  if (!left || !right) {
    return null;
  }

  return {
    name: `deployment_urls.${leftKey}.${rightKey}`,
    status: left !== right ? "pass" : "fail",
    ...(left === right ? { code: "DEPLOYMENT_URL_DUPLICATE" } : {}),
    message,
  };
}

function externalStateBlockerForCheck(check) {
  if (!isRecord(check)) {
    return null;
  }

  if (FIELD_SPECIFIC_BLOCKER_CODES.has(check.code)) {
    return typeof check.name === "string" ? check.name : check.code;
  }

  if (typeof check.code === "string" && check.code.length > 0) {
    return check.code;
  }

  return typeof check.name === "string" ? check.name : null;
}

function hasPlaceholder(value) {
  return /TODO|^<.*>$|REPLACE_ME|CHANGE_ME/i.test(String(value));
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || /^127\./.test(hostname) || hostname.endsWith(".local");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        inString = false;
      }
      continue;
    }

    if (current === "\"" || current === "'") {
      inString = true;
      quote = current;
      output += current;
      continue;
    }

    if (current === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (current === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += current;
  }

  return output;
}

function parseD1Counters(output) {
  const counters = {};
  const matcher = /\b(posts_table|questions_table|post_indexes|question_indexes|posts|questions)=(\d+)\b/g;
  let match = matcher.exec(output);
  while (match) {
    counters[match[1]] = Number(match[2]);
    match = matcher.exec(output);
  }
  return counters;
}

function record(checks, name, status, message, details = {}) {
  checks.push({ name, status, message, ...details });
}

function tail(value, limit) {
  return value.length <= limit ? value : value.slice(value.length - limit);
}

function numberOption(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function publicErrorMessage(error) {
  return error instanceof Error ? error.message : "Unknown Cloudflare external state error.";
}

function printHelp() {
  console.log(`Usage: node scripts/cloudflare-external-state-check.mjs [--env=staging,production] [--config=workers/api/wrangler.jsonc]

Checks non-mutating Cloudflare account state needed before staging release evidence:
  wrangler whoami
  wrangler r2 bucket list
  remote D1 posts/questions migration and seed read check
  staging/production deployment URL shape
  wrangler deploy --dry-run --env <env>

Options:
  --skip-whoami           Skip Wrangler OAuth/account read check.
  --skip-r2               Skip R2 account and bucket visibility check.
  --skip-d1               Skip remote D1 migration and seed evidence check.
  --skip-deployment-urls  Skip staging/production deployment URL shape checks.
  --skip-dry-run          Skip Worker dry-run checks.
  --timeout-ms N          Per-command timeout.
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

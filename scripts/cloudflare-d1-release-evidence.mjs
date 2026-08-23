#!/usr/bin/env node

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  classifyD1MigrationResult,
  readExpectedD1Databases,
  sanitizeWranglerOutput,
} from "./cloudflare-external-state-check.mjs";

const DEFAULT_CONFIG_PATH = "workers/api/wrangler.jsonc";
const DEFAULT_SEED_PATH = "workers/api/seeds/001_core_seed.sql";
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const ALLOWED_ENVS = ["staging", "production"];
const D1_RELEASE_EVIDENCE_QUERY = [
  "SELECT 'posts_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'posts'",
  "SELECT 'questions_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'questions'",
  "SELECT 'post_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_posts_place_created', 'idx_posts_status_created')",
  "SELECT 'question_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_questions_place_created', 'idx_questions_anon_created')",
  "SELECT 'v2_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('data_sources', 'dimension_settings', 'feature_flags', 'decision_profiles', 'live_signals', 'aggregated_place_status')",
  "SELECT 'v2_flags=' || COUNT(*) FROM feature_flags WHERE scope_type = 'global' AND scope_key = '*'",
  "SELECT 'v2_settings=' || COUNT(*) FROM dimension_settings",
  "SELECT 'source_registry=' || COUNT(*) FROM data_sources",
  "SELECT 'trust_safety_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_moderation_states', 'report_votes', 'user_blocks', 'consents', 'terms_acceptances', 'account_deletion_requests', 'identity_link_events')",
  "SELECT 'field_report_moderation_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'field_report_moderation'",
  "SELECT 'field_report_photos_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'field_report_photos'",
  "SELECT 'field_report_photos_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_field_report_photos_photo', 'idx_field_report_photos_report')",
  "SELECT 'photo_idempotency_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_upload_idempotency_keys'",
  "SELECT 'photo_idempotency_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_photo_upload_idempotency_upload'",
  "SELECT 'ingestion_target_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'official_ingestion_targets'",
  "SELECT 'ingestion_target_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_official_ingestion_targets_due', 'idx_official_ingestion_targets_source_place')",
  "SELECT 'cost_guard_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('metered_usage_events', 'photo_upload_sessions')",
  "SELECT 'cost_guard_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_metered_usage_actor', 'idx_metered_usage_ip', 'idx_metered_usage_expiry', 'idx_photo_upload_sessions_expiry')",
  "SELECT 'photo_size_triggers=' || COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name IN ('trg_photos_max_byte_size_insert', 'trg_photos_max_byte_size_update')",
  "SELECT 'korea_sido_regions=' || COUNT(*) FROM regions WHERE parent_region_id IS NULL AND id IN ('seoul', 'busan', 'daegu', 'incheon', 'gwangju', 'daejeon', 'ulsan', 'sejong', 'gyeonggi', 'gangwon', 'chungbuk', 'chungnam', 'jeonbuk', 'jeonnam', 'gyeongbuk', 'gyeongnam', 'jeju')",
  "SELECT 'posts=' || COUNT(*) FROM posts",
  "SELECT 'questions=' || COUNT(*) FROM questions",
].join("; ");

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

export async function resolveD1ReleaseEvidencePlan({ flags = new Set(), options = new Map(), env = process.env } = {}) {
  const configPath = options.get("config") ?? DEFAULT_CONFIG_PATH;
  const seedPath = options.get("seed") ?? DEFAULT_SEED_PATH;
  const apply = flags.has("apply") || env.SILSIGAN_D1_RELEASE_APPLY === "1";
  const check = flags.has("check") || env.SILSIGAN_D1_RELEASE_CHECK === "1";
  const confirmStaging = flags.has("confirm-staging") || env.SILSIGAN_D1_CONFIRM_STAGING === "1";
  const confirmProduction = flags.has("confirm-production") || env.SILSIGAN_D1_CONFIRM_PRODUCTION === "1";
  const acceptTimeTravelOnly = flags.has("accept-time-travel-only") || env.SILSIGAN_D1_ACCEPT_TIME_TRAVEL_ONLY === "1";
  const fullBackupSha256 = options.get("full-backup-sha256") ?? env.SILSIGAN_D1_FULL_BACKUP_SHA256;
  const hasFullBackup = typeof fullBackupSha256 === "string" && fullBackupSha256.length > 0;
  const rollbackStrategy = acceptTimeTravelOnly ? "time-travel-only" : hasFullBackup ? "full-data-backup" : null;
  const timeoutMs = numberOption(options.get("timeout-ms") ?? env.SILSIGAN_D1_RELEASE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const requestedEnvs = parseEnvOption(options.get("env") ?? env.SILSIGAN_D1_RELEASE_ENV);
  const errors = [];

  if (requestedEnvs.length === 0) {
    errors.push({
      code: "ENV_REQUIRED",
      message: "--env=staging 또는 --env=production 중 하나가 필요합니다.",
    });
  }

  for (const envName of requestedEnvs) {
    if (!ALLOWED_ENVS.includes(envName)) {
      errors.push({
        code: "ENV_INVALID",
        message: "--env 는 staging 또는 production 만 허용합니다.",
      });
    }
  }

  if (apply && requestedEnvs.length !== 1) {
    errors.push({
      code: "APPLY_REQUIRES_SINGLE_ENV",
      message: "--apply 는 한 번에 하나의 --env 에만 실행할 수 있습니다.",
    });
  }

  if (apply && requestedEnvs.includes("production") && !confirmProduction) {
    errors.push({
      code: "PRODUCTION_CONFIRMATION_REQUIRED",
      message: "production D1 적용에는 --confirm-production 이 필요합니다.",
    });
  }

  if (apply && requestedEnvs.includes("staging") && !confirmStaging) {
    errors.push({
      code: "STAGING_CONFIRMATION_REQUIRED",
      message: "staging D1 적용에는 --confirm-staging 이 필요합니다.",
    });
  }

  if (apply && acceptTimeTravelOnly && hasFullBackup) {
    errors.push({
      code: "ROLLBACK_STRATEGY_CONFLICT",
      message: "--accept-time-travel-only 와 --full-backup-sha256 는 동시에 사용할 수 없습니다.",
    });
  } else if (apply && !rollbackStrategy) {
    errors.push({
      code: "ROLLBACK_STRATEGY_REQUIRED",
      message: "D1 적용에는 --accept-time-travel-only 또는 --full-backup-sha256=<sha256> 롤백 기록이 필요합니다.",
    });
  }

  if (apply && hasFullBackup && !/^[a-f0-9]{64}$/i.test(fullBackupSha256)) {
    errors.push({
      code: "FULL_BACKUP_SHA256_INVALID",
      message: "--full-backup-sha256 는 64자리 SHA-256 이어야 합니다.",
    });
  }

  const uniqueEnvs = [...new Set(requestedEnvs.filter((envName) => ALLOWED_ENVS.includes(envName)))];
  const databases = uniqueEnvs.length > 0 ? await readExpectedD1Databases(configPath, uniqueEnvs) : [];
  const targets = databases.map((database) => ({
    envName: database.envName,
    databaseName: database.databaseName,
    steps: buildTargetSteps(database, configPath, seedPath, apply),
  }));

  return {
    ok: errors.length === 0 && targets.every((target) => target.databaseName),
    mode: apply ? "apply" : check ? "check" : "plan-only",
    apply,
    check,
    confirmStaging,
    confirmProduction,
    rollbackStrategy,
    ...(rollbackStrategy === "full-data-backup" ? { fullBackupSha256 } : {}),
    configPath,
    seedPath,
    timeoutMs,
    errors: [
      ...errors,
      ...targets
        .filter((target) => !target.databaseName)
        .map((target) => ({
          code: "D1_DATABASE_NAME_REQUIRED",
          message: `workers/api wrangler config must define a D1 database_name for ${target.envName}.`,
        })),
    ],
    targets,
  };
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    printHelp();
    return;
  }

  const plan = await resolveD1ReleaseEvidencePlan({ flags, options, env: process.env });
  if (!plan.ok) {
    printSummary({ ...plan, ok: false, results: [] });
    process.exitCode = 1;
    return;
  }

  if (plan.mode === "plan-only") {
    printSummary({ ...plan, ok: true, results: [] });
    return;
  }

  const results = [];
  for (const target of plan.targets) {
    for (const targetStep of target.steps) {
      if (targetStep.applyOnly && !plan.apply) {
        continue;
      }

      const result = await runStep(target.envName, targetStep, plan.timeoutMs);
      results.push(result);
      if (result.status === "fail") {
        break;
      }
    }
  }

  const ok = results.length > 0 && results.every((result) => result.status === "pass");
  printSummary({ ...plan, ok, results });
  if (!ok) {
    process.exitCode = 1;
  }
}

function buildTargetSteps(database, configPath, seedPath, apply) {
  if (!database.databaseName) {
    return [];
  }

  const baseArgs = ["--remote", "--env", database.envName, "--config", configPath];
  const steps = [
    {
      name: "d1.migrations.list",
      command: "npx",
      args: ["--yes", "wrangler", "d1", "migrations", "list", database.databaseName, ...baseArgs],
    },
    {
      name: "d1.migrations.apply",
      command: "npx",
      args: ["--yes", "wrangler", "d1", "migrations", "apply", database.databaseName, ...baseArgs],
      applyOnly: true,
    },
    {
      name: "d1.seed.apply",
      command: "npx",
      args: ["--yes", "wrangler", "d1", "execute", database.databaseName, ...baseArgs, "--file", seedPath],
      applyOnly: true,
    },
    {
      name: "d1.posts_questions.evidence",
      command: "npx",
      args: ["--yes", "wrangler", "d1", "execute", database.databaseName, ...baseArgs, "--command", D1_RELEASE_EVIDENCE_QUERY],
      classify: true,
    },
  ];

  return apply ? steps : steps.filter((step) => !step.applyOnly);
}

async function runStep(envName, targetStep, timeoutMs) {
  const startedAt = Date.now();
  const commandResult = await runCommand(targetStep.command, targetStep.args, timeoutMs);
  if (targetStep.classify) {
    const check = classifyD1MigrationResult(commandResult, envName);
    return {
      name: `${envName}.${targetStep.name}`,
      status: check.status,
      durationMs: Date.now() - startedAt,
      check,
    };
  }

  return {
    name: `${envName}.${targetStep.name}`,
    status: commandResult.exitCode === 0 ? "pass" : "fail",
    durationMs: Date.now() - startedAt,
    ...(commandResult.exitCode === 0
      ? { outputTail: sanitizeWranglerOutput(tail(commandResult.stdout, 1_500)) }
      : { errorTail: sanitizeWranglerOutput(tail(`${commandResult.stdout}\n${commandResult.stderr}`, 2_000)) }),
  };
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

function parseEnvOption(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  return value
    .split(",")
    .map((envName) => envName.trim())
    .filter(Boolean);
}

function numberOption(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tail(value, limit) {
  return value.length <= limit ? value : value.slice(value.length - limit);
}

function printSummary(summary) {
  console.log(
    JSON.stringify(
      {
        ...summary,
        targets: summary.targets.map((target) => ({
          envName: target.envName,
          databaseName: target.databaseName,
          steps: target.steps.map((targetStep) => ({
            name: targetStep.name,
            label: [targetStep.command, ...targetStep.args].join(" "),
            applyOnly: Boolean(targetStep.applyOnly),
          })),
        })),
      },
      null,
      2,
    ),
  );
}

function printHelp() {
  console.log(`Usage: node scripts/cloudflare-d1-release-evidence.mjs --env=staging [--check|--apply] [confirmation and rollback options]

Plans, checks, or explicitly applies the Cloudflare D1 release migration evidence path:
  wrangler d1 migrations list <database> --remote --env <env>
  wrangler d1 migrations apply <database> --remote --env <env>       only with --apply
  wrangler d1 execute <database> --remote --env <env> --file seed    only with --apply
  wrangler d1 execute <database> --remote --env <env> --command evidence query

Options:
  --env=staging|production     Required target environment. --apply allows exactly one env.
  --check                      Run read-only list and evidence checks.
  --apply                      Apply pending migrations, apply idempotent seed, then verify evidence.
  --confirm-staging            Required with --apply --env=staging.
  --confirm-production         Required with --apply --env=production.
  --accept-time-travel-only    Explicitly accept D1 Time Travel as the only data rollback path.
  --full-backup-sha256 SHA256  Record the approved full-data backup digest instead of Time Travel-only rollback.
  --config PATH                Wrangler API config. Default: workers/api/wrangler.jsonc
  --seed PATH                  Seed SQL file. Default: workers/api/seeds/001_core_seed.sql
  --timeout-ms N               Per-command timeout.
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

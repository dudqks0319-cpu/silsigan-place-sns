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
  "SELECT 'live_signal_expiry_required=' || COUNT(*) FROM pragma_table_info('live_signals') WHERE name = 'expires_at' AND \"notnull\" = 1",
  "SELECT 'live_signals_missing_expiry=' || COUNT(*) FROM live_signals WHERE expires_at IS NULL",
  "SELECT 'place_event_accuracy_required=' || COUNT(*) FROM pragma_table_info('place_events') WHERE name = 'accuracy_bucket' AND \"notnull\" = 1",
  "SELECT 'place_event_accuracy_invalid=' || COUNT(*) FROM place_events WHERE accuracy_bucket IS NULL OR accuracy_bucket NOT IN ('high', 'medium', 'low', 'unknown')",
  "SELECT 'preference_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('saved_places', 'saved_posts', 'followed_topics', 'notification_subscriptions')",
  "SELECT 'analytics_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'analytics_events'",
  "SELECT 'photo_cleanup_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_cleanup_jobs'",
  "SELECT 'photo_cleanup_delivery_columns=' || COUNT(*) FROM pragma_table_info('photo_cleanup_jobs') WHERE name IN ('byte_size', 'lease_token', 'lease_expires_at', 'budget_released_at', 'dead_lettered_at', 'updated_at')",
  "SELECT 'photo_cleanup_delivery_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_photo_cleanup_jobs_pending'",
  "SELECT 'photo_cleanup_dead_letters=' || COUNT(*) FROM photo_cleanup_jobs WHERE status = 'failed'",
  "SELECT 'photo_budget_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_storage_budget'",
  "SELECT 'photo_budget_rows=' || COUNT(*) FROM photo_storage_budget WHERE id = 1",
  "SELECT 'photo_storage_release_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_storage_releases'",
  "SELECT 'photo_storage_release_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_photo_storage_releases_released'",
  "SELECT 'anonymous_session_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'anonymous_sessions'",
  "SELECT 'anonymous_session_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_anonymous_sessions_status_expiry'",
  "SELECT 'anonymous_session_budget_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'anonymous_session_issuance_budget'",
  "SELECT 'place_request_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('place_addition_requests', 'place_addition_request_daily_budget')",
  "SELECT 'place_request_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_place_addition_requests_owner_created', 'idx_place_addition_requests_queue')",
  "SELECT 'place_request_triggers=' || COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name = 'trg_place_addition_requests_daily_guard'",
  "SELECT 'api_cost_guard_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('api_cost_guard_control', 'api_cost_guard_daily', 'api_cost_guard_reconciliations')",
  "SELECT 'api_cost_guard_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_api_cost_guard_reconcile_day'",
  "SELECT 'api_cost_guard_control_rows=' || COUNT(*) FROM api_cost_guard_control WHERE id = 1 AND mode IN ('running', 'degraded', 'stopped') AND generation >= 1",
  "SELECT 'api_cost_guard_warning_columns=' || COUNT(*) FROM pragma_table_info('api_cost_guard_daily') WHERE name IN ('warned_percent', 'warned_metric')",
  "SELECT 'photo_abuse_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_upload_claims', 'photo_abuse_budget', 'photo_upload_control')",
  "SELECT 'photo_upload_control_rows=' || COUNT(*) FROM photo_upload_control WHERE id = 1",
  "SELECT 'photo_read_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_read_budget', 'photo_read_control')",
  "SELECT 'photo_read_budget_rows=' || COUNT(*) FROM photo_read_budget WHERE id = 1 AND length(day_utc) = 10 AND reads_in_day >= 0",
  "SELECT 'photo_read_control_rows=' || COUNT(*) FROM photo_read_control WHERE id = 1",
  "SELECT 'photo_read_abuse_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_read_abuse_budget'",
  "SELECT 'photo_transform_budget_rows=' || COUNT(*) FROM photo_transform_budget WHERE id = 1 AND length(period_utc) = 7 AND transforms_in_period >= 0",
  "SELECT 'source_scheduler_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'source_ingestion_targets'",
  "SELECT 'source_scheduler_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_source_ingestion_targets_due', 'idx_source_ingestion_targets_lease')",
  "SELECT 'source_scheduler_targets=' || COUNT(*) FROM source_ingestion_targets",
  "SELECT 'source_scheduler_enabled_targets=' || COUNT(*) FROM source_ingestion_targets WHERE enabled = 1",
  "SELECT 'source_scheduler_invalid_active=' || COUNT(*) FROM source_ingestion_targets target JOIN data_sources source ON source.id = target.source_id WHERE target.enabled = 1 AND (source.enabled != 1 OR source.commercial_use_status NOT IN ('allowed', 'allowed_with_attribution') OR source.health_status NOT IN ('healthy', 'degraded'))",
  "SELECT 'place_event_moderation_required=' || COUNT(*) FROM pragma_table_info('place_events') WHERE name = 'moderation_status' AND \"notnull\" = 1",
  "SELECT 'publication_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('field_report_publications', 'field_report_media', 'hashtags', 'field_report_hashtags', 'publication_outbox')",
  "SELECT 'publication_delivery_columns=' || COUNT(*) FROM pragma_table_info('publication_outbox') WHERE name IN ('lease_token', 'lease_expires_at', 'last_error_code', 'dead_lettered_at', 'updated_at')",
  "SELECT 'publication_delivery_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_publication_outbox_delivery'",
  "SELECT 'publication_dead_letters=' || COUNT(*) FROM publication_outbox WHERE status = 'failed'",
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
  const confirmProduction = flags.has("confirm-production") || env.SILSIGAN_D1_CONFIRM_PRODUCTION === "1";
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
    confirmProduction,
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

  const execution = await executeD1ReleaseEvidencePlan(plan);
  printSummary({ ...plan, ...execution });
  if (!execution.ok) {
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
      collectMigrations: true,
    },
    {
      name: "d1.preapply.evidence",
      command: "npx",
      args: ["--yes", "wrangler", "d1", "execute", database.databaseName, ...baseArgs, "--command", D1_RELEASE_EVIDENCE_QUERY],
      applyOnly: true,
      classify: true,
      registryPreflight: true,
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
      name: "d1.migrations.list.postapply",
      command: "npx",
      args: ["--yes", "wrangler", "d1", "migrations", "list", database.databaseName, ...baseArgs],
      applyOnly: true,
      collectMigrations: true,
      postApply: true,
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

export function parsePendingD1Migrations(commandResult) {
  if (commandResult?.exitCode !== 0) {
    return [];
  }

  return normalizePendingMigrations(
    [...String(commandResult.stdout ?? "").matchAll(/\b(\d{4}_[a-z0-9][a-z0-9_-]*\.sql)\b/gi)].map((match) => match[1]),
  );
}

export function classifyD1MigrationRegistry({ envName, pendingMigrations, schemaCheck }) {
  const name = `cloudflare.d1.${envName}.migration_registry`;
  const normalizedPending = normalizePendingMigrations(pendingMigrations);
  const schemaCode = typeof schemaCheck?.code === "string" ? schemaCheck.code : null;
  const firstSchemaMissing = schemaCode?.match(/^D1_(\d{4})_NOT_APPLIED$/)?.[1] ?? null;
  const schemaIsComplete = schemaCheck?.status === "pass" || schemaCode === "D1_SEED_INCOMPLETE";

  if (schemaIsComplete) {
    if (normalizedPending.length === 0) {
      return {
        name,
        status: "pass",
        message: `Remote ${envName} D1 migration registry agrees with the verified schema.`,
        pendingMigrations: normalizedPending,
        ...(schemaCode === "D1_SEED_INCOMPLETE" ? { seedIncomplete: true } : {}),
      };
    }

    return migrationRegistryDrift({
      name,
      envName,
      pendingMigrations: normalizedPending,
      schemaCode,
      unexpectedPendingMigrations: normalizedPending,
    });
  }

  if (!firstSchemaMissing) {
    return {
      name,
      status: "fail",
      code: "D1_MIGRATION_REGISTRY_UNVERIFIED",
      message: `Remote ${envName} D1 schema evidence is not a recognized migration boundary; mutating apply is blocked.`,
      pendingMigrations: normalizedPending,
      ...(schemaCode ? { schemaCode } : {}),
    };
  }

  const firstMissingNumber = Number(firstSchemaMissing);
  const unregisteredSchemaMigrations = normalizedPending.filter(
    (migration) => migrationNumber(migration) < firstMissingNumber,
  );
  const firstPendingNumber = normalizedPending.length > 0 ? migrationNumber(normalizedPending[0]) : null;

  if (firstPendingNumber !== firstMissingNumber || unregisteredSchemaMigrations.length > 0) {
    return migrationRegistryDrift({
      name,
      envName,
      pendingMigrations: normalizedPending,
      schemaCode,
      firstSchemaMissing,
      unregisteredSchemaMigrations,
    });
  }

  return {
    name,
    status: "pass",
    message: `Remote ${envName} D1 migration registry starts at the first verified schema gap.`,
    pendingMigrations: normalizedPending,
    firstSchemaMissing,
    expectedMissingCode: schemaCode,
  };
}

export async function executeD1ReleaseEvidencePlan(plan, { commandRunner = runCommand } = {}) {
  const results = [];

  for (const target of plan.targets) {
    let pendingMigrations = [];

    for (const targetStep of target.steps) {
      if (targetStep.applyOnly && !plan.apply) {
        continue;
      }

      const { commandResult, durationMs, result } = await runStep(
        target.envName,
        targetStep,
        plan.timeoutMs,
        commandRunner,
      );

      if (targetStep.collectMigrations) {
        results.push(result);
        if (result.status === "fail") {
          break;
        }
        pendingMigrations = parsePendingD1Migrations(commandResult);
        continue;
      }

      if (!targetStep.classify) {
        results.push(result);
        if (result.status === "fail") {
          break;
        }
        continue;
      }

      const schemaCheck = classifyD1MigrationResult(commandResult, target.envName);
      const registryCheck = classifyD1MigrationRegistry({
        envName: target.envName,
        pendingMigrations,
        schemaCheck,
      });

      if (targetStep.registryPreflight) {
        const preflightResult = {
          name: `${target.envName}.${targetStep.name}`,
          status: registryCheck.status,
          durationMs,
          check: registryCheck,
          schemaCheck,
        };
        results.push(preflightResult);
        if (preflightResult.status === "fail") {
          break;
        }
        continue;
      }

      const schemaResult = {
        name: `${target.envName}.${targetStep.name}`,
        status: schemaCheck.status,
        durationMs,
        check: schemaCheck,
      };
      const registryResult = {
        name: `${target.envName}.d1.migration_registry`,
        status: registryCheck.status,
        durationMs: 0,
        check: registryCheck,
      };
      results.push(schemaResult, registryResult);
      if (schemaResult.status === "fail" || registryResult.status === "fail") {
        break;
      }
    }
  }

  return {
    ok: results.length > 0 && results.every((result) => result.status === "pass"),
    results,
  };
}

async function runStep(envName, targetStep, timeoutMs, commandRunner) {
  const startedAt = Date.now();
  const commandResult = await commandRunner(targetStep.command, targetStep.args, timeoutMs);
  const durationMs = Date.now() - startedAt;

  return {
    commandResult,
    durationMs,
    result: {
      name: `${envName}.${targetStep.name}`,
      status: commandResult.exitCode === 0 ? "pass" : "fail",
      durationMs,
      ...(commandResult.exitCode === 0
        ? { outputTail: sanitizeWranglerOutput(tail(commandResult.stdout, 1_500)) }
        : { errorTail: sanitizeWranglerOutput(tail(`${commandResult.stdout}\n${commandResult.stderr}`, 2_000)) }),
    },
  };
}

function normalizePendingMigrations(pendingMigrations) {
  const safeMigrations = Array.isArray(pendingMigrations)
    ? pendingMigrations.filter((migration) => /^\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/i.test(String(migration)))
    : [];

  return [...new Set(safeMigrations.map(String))].sort(
    (left, right) => migrationNumber(left) - migrationNumber(right) || left.localeCompare(right),
  );
}

function migrationNumber(migration) {
  return Number(String(migration).slice(0, 4));
}

function migrationRegistryDrift({ name, envName, pendingMigrations, schemaCode, ...details }) {
  return {
    name,
    status: "fail",
    code: "D1_MIGRATION_REGISTRY_DRIFT",
    message: `Remote ${envName} D1 migration registry disagrees with verified schema; mutating apply is blocked.`,
    pendingMigrations,
    ...(schemaCode ? { schemaCode } : {}),
    ...details,
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
  console.log(`Usage: node scripts/cloudflare-d1-release-evidence.mjs --env=staging [--check|--apply] [--confirm-production]

Plans, checks, or explicitly applies the Cloudflare D1 release migration evidence path:
  wrangler d1 migrations list <database> --remote --env <env>
  verify migration registry against deterministic schema evidence           before --apply
  wrangler d1 migrations apply <database> --remote --env <env>       only with --apply
  wrangler d1 execute <database> --remote --env <env> --file seed    only with --apply
  wrangler d1 execute <database> --remote --env <env> --command evidence query

Options:
  --env=staging|production     Required target environment. --apply allows exactly one env.
  --check                      Run read-only list and evidence checks.
  --apply                      Apply only when registry and schema evidence agree, then verify again.
  --confirm-production         Required with --apply --env=production.
  --config PATH                Wrangler API config. Default: workers/api/wrangler.jsonc
  --seed PATH                  Seed SQL file. Default: workers/api/seeds/001_core_seed.sql
  --timeout-ms N               Per-command timeout.
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

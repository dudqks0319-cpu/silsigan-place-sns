#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readExpectedD1Databases,
  sanitizeWranglerOutput,
} from "./cloudflare-external-state-check.mjs";
import { parsePendingD1Migrations } from "./cloudflare-d1-release-evidence.mjs";
import {
  D1_MIGRATION_BOUNDARY_QUERY,
  classifyD1MigrationBoundary,
} from "./cloudflare-d1-migration-boundary.mjs";

const DEFAULT_CONFIG_PATH = "workers/api/wrangler.jsonc";
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const LEGACY_TABLE_NAME = "source_ingestion_targets_legacy_20260720";

export const STAGING_SCHEMA_RECOVERY_CONFIRMATION = "RECOVER_STAGING_D1_LEGACY_0018_0026";
export const EXPECTED_STAGING_PENDING_MIGRATIONS = Object.freeze([
  "0018_source_ingestion_scheduler.sql",
  "0019_background_job_delivery.sql",
  "0020_photo_transform_budget.sql",
  "0021_photo_read_abuse_budget.sql",
  "0022_photo_storage_release_ledger.sql",
  "0023_anonymous_session_proofs.sql",
  "0024_anonymous_session_cost_guard.sql",
  "0025_place_addition_requests.sql",
  "0026_global_api_cost_guard.sql",
]);

export const STAGING_LEGACY_PREFLIGHT_QUERY = [
  "SELECT 'source_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'source_ingestion_targets'",
  `SELECT 'source_archive_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = '${LEGACY_TABLE_NAME}'`,
  "SELECT 'source_rows=' || COUNT(*) FROM source_ingestion_targets",
  "SELECT 'source_total_columns=' || COUNT(*) FROM pragma_table_info('source_ingestion_targets')",
  "SELECT 'source_old_columns=' || COUNT(*) FROM pragma_table_info('source_ingestion_targets') WHERE name IN ('target_key', 'query_json', 'lease_expires_at')",
  "SELECT 'source_new_columns=' || COUNT(*) FROM pragma_table_info('source_ingestion_targets') WHERE name IN ('adapter_config_json', 'refresh_interval_seconds', 'lease_until')",
  "SELECT 'source_named_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_source_ingestion_targets_due', 'idx_source_ingestion_targets_source_place')",
  "SELECT 'source_foreign_key_references=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name <> 'source_ingestion_targets' AND lower(COALESCE(sql, '')) LIKE '%references source_ingestion_targets%'",
  "SELECT 'cleanup_rows=' || COUNT(*) FROM photo_cleanup_jobs",
  "SELECT 'cleanup_total_columns=' || COUNT(*) FROM pragma_table_info('photo_cleanup_jobs')",
  "SELECT 'cleanup_new_columns=' || COUNT(*) FROM pragma_table_info('photo_cleanup_jobs') WHERE name IN ('byte_size', 'lease_token', 'lease_expires_at', 'budget_released_at', 'dead_lettered_at', 'updated_at')",
  "SELECT 'outbox_rows=' || COUNT(*) FROM publication_outbox",
  "SELECT 'outbox_total_columns=' || COUNT(*) FROM pragma_table_info('publication_outbox')",
  "SELECT 'outbox_new_columns=' || COUNT(*) FROM pragma_table_info('publication_outbox') WHERE name IN ('lease_token', 'lease_expires_at', 'last_error_code', 'dead_lettered_at', 'updated_at')",
  "SELECT 'later_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_transform_budget', 'photo_read_abuse_budget', 'photo_storage_releases', 'anonymous_sessions', 'anonymous_session_issuance_budget', 'place_addition_requests', 'place_addition_request_daily_budget', 'api_cost_guard_control', 'api_cost_guard_daily', 'api_cost_guard_reconciliations')",
  "SELECT 'recovery_registry_rows=' || COUNT(*) FROM d1_migrations WHERE name IN ('0018_source_ingestion_scheduler.sql', '0019_background_job_delivery.sql', '0020_photo_transform_budget.sql', '0021_photo_read_abuse_budget.sql', '0022_photo_storage_release_ledger.sql', '0023_anonymous_session_proofs.sql', '0024_anonymous_session_cost_guard.sql', '0025_place_addition_requests.sql', '0026_global_api_cost_guard.sql')",
].join("; ");

if (isCliEntryPoint()) {
  await main();
}

export function parseArgs(rawArgs) {
  const flags = new Set();
  const options = new Map();
  for (let index = 0; index < rawArgs.length; index += 1) {
    const rawArg = rawArgs[index];
    if (!rawArg.startsWith("--")) continue;
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

export async function resolveStagingSchemaRecoveryPlan({ flags = new Set(), options = new Map() } = {}) {
  const configPath = options.get("config") ?? DEFAULT_CONFIG_PATH;
  const envName = options.get("env") ?? "";
  const apply = flags.has("apply");
  const check = flags.has("check");
  const timeoutMs = numberOption(options.get("timeout-ms"), DEFAULT_TIMEOUT_MS);
  const errors = [];

  if (envName !== "staging") {
    errors.push({ code: "STAGING_ONLY", message: "Legacy schema recovery is allowed only for --env=staging." });
  }
  if (apply && options.get("confirmation") !== STAGING_SCHEMA_RECOVERY_CONFIRMATION) {
    errors.push({
      code: "SCHEMA_RECOVERY_CONFIRMATION_REQUIRED",
      message: `--confirmation=${STAGING_SCHEMA_RECOVERY_CONFIRMATION} is required for --apply.`,
    });
  }
  if (apply && (!options.get("backup-path") || !options.get("backup-sha256"))) {
    errors.push({
      code: "BACKUP_EVIDENCE_REQUIRED",
      message: "--backup-path and --backup-sha256 are required for --apply.",
    });
  }

  const [database] = envName === "staging" ? await readExpectedD1Databases(configPath, [envName]) : [];
  if (envName === "staging" && !database?.databaseName) {
    errors.push({ code: "D1_DATABASE_NAME_REQUIRED", message: "The staging D1 database name is missing." });
  }

  return {
    ok: errors.length === 0,
    mode: apply ? "apply" : check ? "check" : "plan-only",
    apply,
    configPath,
    envName,
    databaseName: database?.databaseName ?? null,
    timeoutMs,
    backupPath: options.get("backup-path") ?? null,
    backupSha256: options.get("backup-sha256") ?? null,
    errors,
  };
}

export function buildLegacySchemaPreparationSql() {
  return [
    `ALTER TABLE source_ingestion_targets RENAME TO ${LEGACY_TABLE_NAME}`,
    "DROP INDEX IF EXISTS idx_source_ingestion_targets_due",
    "DROP INDEX IF EXISTS idx_source_ingestion_targets_source_place",
  ].join("; ") + ";";
}

export function parseRecoveryCounters(output) {
  const counters = {};
  const matcher = /\b([a-z][a-z0-9_]+)=(\d+)\b/g;
  let match = matcher.exec(String(output ?? ""));
  while (match) {
    counters[match[1]] = Number(match[2]);
    match = matcher.exec(String(output ?? ""));
  }
  return counters;
}

export function classifyLegacySchemaPreflight({ pendingMigrations, boundaryCheck, counters }) {
  if (boundaryCheck?.code !== "D1_0018_NOT_APPLIED") {
    return failure(
      "LEGACY_SCHEMA_BOUNDARY_MISMATCH",
      "Staging must first become incomplete at migration 0018 before this recovery is allowed.",
    );
  }
  if (!sameList(pendingMigrations, EXPECTED_STAGING_PENDING_MIGRATIONS)) {
    return failure(
      "LEGACY_SCHEMA_PENDING_SET_MISMATCH",
      "Pending migrations must be exactly 0018 through 0026.",
    );
  }

  const expected = {
    source_tables: 1,
    source_archive_tables: 0,
    source_rows: 0,
    source_total_columns: 15,
    source_old_columns: 3,
    source_new_columns: 0,
    source_named_indexes: 2,
    source_foreign_key_references: 0,
    cleanup_rows: 0,
    cleanup_total_columns: 10,
    cleanup_new_columns: 0,
    outbox_rows: 0,
    outbox_total_columns: 10,
    outbox_new_columns: 0,
    later_tables: 0,
    recovery_registry_rows: 0,
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => counters?.[key] !== value)
    .map(([key]) => key);
  if (mismatches.length > 0) {
    return {
      ...failure(
        "LEGACY_SCHEMA_SHAPE_MISMATCH",
        "Remote staging does not match the exact empty legacy schema recovery contract.",
      ),
      mismatches,
    };
  }
  return {
    name: "cloudflare.d1.staging.legacy_schema_recovery_preflight",
    status: "pass",
    message: "The empty legacy table may be preserved under a new name before normal Wrangler migrations run.",
  };
}

export async function verifyBackupFile({ backupPath, expectedSha256, workspacePath = process.cwd() }) {
  if (!backupPath || !isAbsolute(backupPath)) {
    return failure("BACKUP_PATH_INVALID", "The backup path must be absolute and outside the repository.");
  }
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256 ?? "")) {
    return failure("BACKUP_SHA256_INVALID", "The backup SHA-256 must contain 64 hexadecimal characters.");
  }
  try {
    const [resolvedBackup, resolvedWorkspace] = await Promise.all([realpath(backupPath), realpath(workspacePath)]);
    const relation = relative(resolvedWorkspace, resolvedBackup);
    if (relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))) {
      return failure("BACKUP_PATH_IN_REPOSITORY", "The D1 backup must be outside the repository.");
    }
    const info = await stat(resolvedBackup);
    if (!info.isFile() || info.size <= 0) {
      return failure("BACKUP_FILE_EMPTY", "The D1 backup must be a non-empty file.");
    }
    const digest = createHash("sha256").update(await readFile(resolvedBackup)).digest("hex");
    if (digest.toLowerCase() !== expectedSha256.toLowerCase()) {
      return failure("BACKUP_SHA256_MISMATCH", "The D1 backup SHA-256 does not match.");
    }
    return {
      name: "cloudflare.d1.staging.legacy_schema_recovery_backup",
      status: "pass",
      message: "The external D1 backup exists and its SHA-256 matches.",
      fileName: basename(resolvedBackup),
      bytes: info.size,
    };
  } catch {
    return failure("BACKUP_FILE_UNAVAILABLE", "The D1 backup could not be read.");
  }
}

export async function executeStagingSchemaRecovery(plan, { commandRunner = runCommand } = {}) {
  const results = [];
  if (!plan.ok || !plan.databaseName) return { ok: false, results };
  if (plan.mode === "plan-only") return { ok: true, results };

  if (plan.apply) {
    const backupCheck = await verifyBackupFile({
      backupPath: plan.backupPath,
      expectedSha256: plan.backupSha256,
    });
    results.push(backupCheck);
    if (backupCheck.status !== "pass") return { ok: false, results };
  }

  const baseArgs = [
    plan.databaseName,
    "--remote",
    "--env",
    "staging",
    "--config",
    plan.configPath,
  ];
  const preflight = await readPreflight({ baseArgs, timeoutMs: plan.timeoutMs, commandRunner });
  results.push(...preflight.results);
  if (preflight.check.status !== "pass") return { ok: false, results };
  if (!plan.apply) return { ok: true, results };

  const prepareResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", ...baseArgs, "--yes", "--command", buildLegacySchemaPreparationSql()],
    plan.timeoutMs,
  );
  results.push(commandResultSummary("staging.d1.legacy_schema_recovery.prepare", prepareResult));
  if (prepareResult.exitCode !== 0) return { ok: false, results };

  const applyResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", ...baseArgs],
    plan.timeoutMs,
  );
  results.push(commandResultSummary("staging.d1.legacy_schema_recovery.migrations", applyResult));
  if (applyResult.exitCode !== 0) return { ok: false, results };

  const postflight = await readPostflight({ baseArgs, timeoutMs: plan.timeoutMs, commandRunner });
  results.push(...postflight.results);
  return { ok: postflight.check.status === "pass", results };
}

async function readPreflight({ baseArgs, timeoutMs, commandRunner }) {
  const migrationsResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "list", ...baseArgs],
    timeoutMs,
  );
  const boundaryResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", ...baseArgs, "--command", D1_MIGRATION_BOUNDARY_QUERY],
    timeoutMs,
  );
  const shapeResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", ...baseArgs, "--command", STAGING_LEGACY_PREFLIGHT_QUERY],
    timeoutMs,
  );
  const boundaryCheck = classifyD1MigrationBoundary(boundaryResult, "staging");
  const check = migrationsResult.exitCode === 0 && boundaryResult.exitCode === 0 && shapeResult.exitCode === 0
    ? classifyLegacySchemaPreflight({
        pendingMigrations: parsePendingD1Migrations(migrationsResult),
        boundaryCheck,
        counters: parseRecoveryCounters(shapeResult.stdout),
      })
    : failure("LEGACY_SCHEMA_REMOTE_READ_FAILED", "Could not complete the read-only staging preflight.");
  return {
    check,
    results: [
      commandResultSummary("staging.d1.legacy_schema_recovery.migrations", migrationsResult),
      { name: "staging.d1.legacy_schema_recovery.boundary", status: boundaryCheck.status, check: boundaryCheck },
      commandResultSummary("staging.d1.legacy_schema_recovery.shape", shapeResult),
      check,
    ],
  };
}

async function readPostflight({ baseArgs, timeoutMs, commandRunner }) {
  const migrationsResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "list", ...baseArgs],
    timeoutMs,
  );
  const boundaryResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", ...baseArgs, "--command", D1_MIGRATION_BOUNDARY_QUERY],
    timeoutMs,
  );
  const pendingMigrations = parsePendingD1Migrations(migrationsResult);
  const boundaryCheck = classifyD1MigrationBoundary(boundaryResult, "staging");
  const check = migrationsResult.exitCode === 0
    && boundaryResult.exitCode === 0
    && pendingMigrations.length === 0
    && boundaryCheck.status === "pass"
      ? {
          name: "cloudflare.d1.staging.legacy_schema_recovery_postflight",
          status: "pass",
          message: "Wrangler reports no pending migrations and independent schema boundaries pass through 0026.",
        }
      : failure(
          "LEGACY_SCHEMA_RECOVERY_POSTFLIGHT_FAILED",
          "Staging did not converge to no pending migrations with schema boundaries through 0026.",
        );
  return {
    check,
    results: [
      commandResultSummary("staging.d1.legacy_schema_recovery.migrations.postflight", migrationsResult),
      { name: "staging.d1.legacy_schema_recovery.boundary.postflight", status: boundaryCheck.status, check: boundaryCheck },
      check,
    ],
  };
}

function commandResultSummary(name, commandResult) {
  return {
    name,
    status: commandResult.exitCode === 0 ? "pass" : "fail",
    ...(commandResult.exitCode === 0
      ? {}
      : { errorTail: sanitizeWranglerOutput(tail(`${commandResult.stdout}\n${commandResult.stderr}`, 1_500)) }),
  };
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolveResult) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      resolveResult({
        exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

function failure(code, message) {
  return { name: "cloudflare.d1.staging.legacy_schema_recovery", status: "fail", code, message };
}

function sameList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function numberOption(value, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tail(value, limit) {
  return value.length <= limit ? value : value.slice(value.length - limit);
}

function printSummary(plan, execution) {
  console.log(JSON.stringify({
    ok: plan.ok && execution.ok,
    mode: plan.mode,
    envName: plan.envName,
    databaseName: plan.databaseName,
    backupRequired: plan.apply,
    errors: plan.errors,
    results: execution.results,
  }, null, 2));
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    console.log(`Usage: node scripts/cloudflare-d1-staging-schema-recovery.mjs --env=staging [--check|--apply]\n\nApply additionally requires:\n  --confirmation=${STAGING_SCHEMA_RECOVERY_CONFIRMATION}\n  --backup-path=/absolute/path/to/export.sql\n  --backup-sha256=<64 hex characters>`);
    return;
  }
  const plan = await resolveStagingSchemaRecoveryPlan({ flags, options });
  const execution = plan.ok ? await executeStagingSchemaRecovery(plan) : { ok: false, results: [] };
  printSummary(plan, execution);
  if (!plan.ok || !execution.ok) process.exitCode = 1;
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

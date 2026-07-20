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
import {
  classifyD1MigrationRegistry,
  parsePendingD1Migrations,
} from "./cloudflare-d1-release-evidence.mjs";
import {
  D1_MIGRATION_BOUNDARY_QUERY,
  classifyD1MigrationBoundary,
} from "./cloudflare-d1-migration-boundary.mjs";

const DEFAULT_CONFIG_PATH = "workers/api/wrangler.jsonc";
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
export const STAGING_REGISTRY_REPAIR_CONFIRMATION = "REPAIR_STAGING_D1_REGISTRY_0018_0025";
export const REGISTRY_REPAIR_MIGRATIONS = Object.freeze([
  "0018_source_ingestion_scheduler.sql",
  "0019_background_job_delivery.sql",
  "0020_photo_transform_budget.sql",
  "0021_photo_read_abuse_budget.sql",
  "0022_photo_storage_release_ledger.sql",
  "0023_anonymous_session_proofs.sql",
  "0024_anonymous_session_cost_guard.sql",
  "0025_place_addition_requests.sql",
]);
export const EXPECTED_STAGING_PENDING_MIGRATIONS = Object.freeze([
  ...REGISTRY_REPAIR_MIGRATIONS,
  "0026_global_api_cost_guard.sql",
]);
export const D1_REGISTRY_SHAPE_QUERY = [
  "SELECT 'd1_registry_shape=' || CASE WHEN",
  "(SELECT COUNT(*) FROM pragma_table_info('d1_migrations')) = 3",
  "AND EXISTS (SELECT 1 FROM pragma_table_info('d1_migrations') WHERE name = 'id' AND upper(type) = 'INTEGER' AND pk = 1)",
  "AND EXISTS (SELECT 1 FROM pragma_table_info('d1_migrations') WHERE name = 'name' AND upper(type) = 'TEXT')",
  "AND EXISTS (SELECT 1 FROM pragma_table_info('d1_migrations') WHERE name = 'applied_at' AND upper(type) = 'TIMESTAMP' AND \"notnull\" = 1 AND upper(dflt_value) = 'CURRENT_TIMESTAMP')",
  "THEN 1 ELSE 0 END",
].join(" ");

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

export async function resolveRegistryRepairPlan({ flags = new Set(), options = new Map() } = {}) {
  const configPath = options.get("config") ?? DEFAULT_CONFIG_PATH;
  const envName = options.get("env") ?? "";
  const apply = flags.has("apply");
  const check = flags.has("check");
  const timeoutMs = numberOption(options.get("timeout-ms"), DEFAULT_TIMEOUT_MS);
  const errors = [];

  if (envName !== "staging") {
    errors.push({
      code: "STAGING_ONLY",
      message: "Migration registry repair is allowed only for --env=staging.",
    });
  }
  if (apply && options.get("confirmation") !== STAGING_REGISTRY_REPAIR_CONFIRMATION) {
    errors.push({
      code: "REGISTRY_REPAIR_CONFIRMATION_REQUIRED",
      message: `--confirmation=${STAGING_REGISTRY_REPAIR_CONFIRMATION} is required for --apply.`,
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
    errors.push({
      code: "D1_DATABASE_NAME_REQUIRED",
      message: "The staging D1 database name is missing from Wrangler config.",
    });
  }

  return {
    ok: errors.length === 0,
    mode: apply ? "apply" : check ? "check" : "plan-only",
    apply,
    check,
    configPath,
    envName,
    databaseName: database?.databaseName ?? null,
    timeoutMs,
    backupPath: options.get("backup-path") ?? null,
    backupSha256: options.get("backup-sha256") ?? null,
    errors,
  };
}

export function buildRegistryRepairSql(migrations = REGISTRY_REPAIR_MIGRATIONS) {
  if (
    migrations.length !== REGISTRY_REPAIR_MIGRATIONS.length
    || migrations.some((migration, index) => migration !== REGISTRY_REPAIR_MIGRATIONS[index])
  ) {
    throw new Error("Registry repair migration allowlist mismatch.");
  }

  return migrations
    .map(
      (migration) =>
        `INSERT INTO d1_migrations (name) SELECT '${migration}' WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '${migration}')`,
    )
    .join("; ") + ";";
}

export function parseRegisteredRepairMigrations(output) {
  const matches = [...String(output ?? "").matchAll(/\"name\"\s*:\s*\"(\d{4}_[a-z0-9][a-z0-9_-]*\.sql)\"/gi)]
    .map((match) => match[1]);
  return REGISTRY_REPAIR_MIGRATIONS.filter((migration) => matches.includes(migration));
}

export function parseRegistryShape(output) {
  return /d1_registry_shape=1\b/.test(String(output ?? ""));
}

export function classifyRegistryRepairPreflight({
  envName,
  pendingMigrations,
  schemaCheck,
  registeredRepairMigrations,
  registryShapeValid,
}) {
  if (envName !== "staging") {
    return failure("STAGING_ONLY", "Registry repair is allowed only for staging.");
  }
  if (schemaCheck?.code !== "D1_0026_NOT_APPLIED") {
    return failure(
      "REGISTRY_REPAIR_SCHEMA_BOUNDARY_MISMATCH",
      "Staging schema must be verified through 0025 with 0026 as the first missing migration.",
    );
  }
  if (!registryShapeValid) {
    return failure(
      "REGISTRY_REPAIR_TABLE_SHAPE_MISMATCH",
      "The remote d1_migrations table shape does not match the verified Wrangler registry contract.",
    );
  }
  const readyToRepair =
    sameList(pendingMigrations, EXPECTED_STAGING_PENDING_MIGRATIONS)
    && registeredRepairMigrations.length === 0;
  if (readyToRepair) {
    return {
      name: "cloudflare.d1.staging.registry_repair_preflight",
      status: "pass",
      repairRequired: true,
      message: "Backup-gated registry repair may record exactly 0018 through 0025 without replaying schema SQL.",
    };
  }
  const alreadyReconciled =
    sameList(pendingMigrations, ["0026_global_api_cost_guard.sql"])
    && sameList(registeredRepairMigrations, REGISTRY_REPAIR_MIGRATIONS);
  if (alreadyReconciled) {
    return {
      name: "cloudflare.d1.staging.registry_repair_preflight",
      status: "pass",
      repairRequired: false,
      message: "Wrangler migration history already converges at the verified 0026 schema gap; no registry write is required.",
    };
  }
  if (registeredRepairMigrations.length > 0) {
    return failure(
      "REGISTRY_REPAIR_PARTIAL_STATE",
      "One or more repair rows already exist; stop for a fresh read-only audit.",
    );
  }
  return failure(
    "REGISTRY_REPAIR_PENDING_SET_MISMATCH",
    "Wrangler pending migrations must be exactly 0018 through 0026 before repair or only 0026 after reconciliation.",
  );
}

export async function verifyBackupFile({ backupPath, expectedSha256, workspacePath = process.cwd() }) {
  if (!backupPath || !isAbsolute(backupPath)) {
    return failure("BACKUP_PATH_INVALID", "The backup path must be absolute and outside the repository.");
  }
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256 ?? "")) {
    return failure("BACKUP_SHA256_INVALID", "The backup SHA-256 must contain exactly 64 hexadecimal characters.");
  }

  try {
    const [resolvedBackup, resolvedWorkspace] = await Promise.all([realpath(backupPath), realpath(workspacePath)]);
    const relation = relative(resolvedWorkspace, resolvedBackup);
    if (relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))) {
      return failure("BACKUP_PATH_IN_REPOSITORY", "The D1 backup must not be stored inside the repository.");
    }
    const info = await stat(resolvedBackup);
    if (!info.isFile() || info.size <= 0) {
      return failure("BACKUP_FILE_EMPTY", "The D1 backup must be a non-empty file.");
    }
    const digest = createHash("sha256").update(await readFile(resolvedBackup)).digest("hex");
    if (digest.toLowerCase() !== expectedSha256.toLowerCase()) {
      return failure("BACKUP_SHA256_MISMATCH", "The D1 backup SHA-256 does not match the approved evidence.");
    }
    return {
      name: "cloudflare.d1.staging.registry_repair_backup",
      status: "pass",
      message: "The external D1 backup exists and its SHA-256 matches.",
      fileName: basename(resolvedBackup),
      bytes: info.size,
    };
  } catch {
    return failure("BACKUP_FILE_UNAVAILABLE", "The D1 backup could not be read.");
  }
}

export async function executeRegistryRepairPlan(plan, { commandRunner = runCommand } = {}) {
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
  const preflight = await readRemoteRepairState({ baseArgs, timeoutMs: plan.timeoutMs, commandRunner });
  results.push(...preflight.results);
  if (preflight.check.status !== "pass") return { ok: false, results };
  if (!plan.apply) return { ok: true, results };
  if (preflight.check.repairRequired === false) return { ok: true, results };

  const repairResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", ...baseArgs, "--command", buildRegistryRepairSql()],
    plan.timeoutMs,
  );
  results.push(commandResultSummary("staging.d1.registry_repair.apply", repairResult));
  if (repairResult.exitCode !== 0) return { ok: false, results };

  const postflight = await readRemoteRepairState({ baseArgs, timeoutMs: plan.timeoutMs, commandRunner });
  const registryCheck = classifyD1MigrationRegistry({
    envName: "staging",
    pendingMigrations: postflight.pendingMigrations,
    schemaCheck: postflight.schemaCheck,
  });
  const postRegistered = postflight.registeredRepairMigrations;
  const postflightCheck =
    sameList(postflight.pendingMigrations, ["0026_global_api_cost_guard.sql"])
    && sameList(postRegistered, REGISTRY_REPAIR_MIGRATIONS)
    && registryCheck.status === "pass"
      ? {
          name: "cloudflare.d1.staging.registry_repair_postflight",
          status: "pass",
          message: "Registry now starts at the verified 0026 schema gap.",
        }
      : failure(
          "REGISTRY_REPAIR_POSTFLIGHT_FAILED",
          "Registry repair did not converge to the single verified 0026 gap.",
        );
  results.push(...postflight.results, postflightCheck);
  return { ok: postflightCheck.status === "pass", results };
}

async function readRemoteRepairState({ baseArgs, timeoutMs, commandRunner }) {
  const migrationsResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "list", ...baseArgs],
    timeoutMs,
  );
  const evidenceResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", ...baseArgs, "--command", D1_MIGRATION_BOUNDARY_QUERY],
    timeoutMs,
  );
  const registryResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", ...baseArgs, "--command", "SELECT name FROM d1_migrations ORDER BY id"],
    timeoutMs,
  );
  const registryShapeResult = await commandRunner(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", ...baseArgs, "--command", D1_REGISTRY_SHAPE_QUERY],
    timeoutMs,
  );
  const pendingMigrations = parsePendingD1Migrations(migrationsResult);
  const schemaCheck = classifyD1MigrationBoundary(evidenceResult, "staging");
  const registeredRepairMigrations = parseRegisteredRepairMigrations(registryResult.stdout);
  const registryShapeValid = parseRegistryShape(registryShapeResult.stdout);
  const registryShapeCheck = registryShapeResult.exitCode !== 0
    ? commandResultSummary("staging.d1.registry_repair.registry_shape", registryShapeResult)
    : registryShapeValid
      ? {
          name: "staging.d1.registry_repair.registry_shape",
          status: "pass",
          message: "Remote d1_migrations columns and CURRENT_TIMESTAMP default match the expected registry contract.",
        }
      : failure(
          "REGISTRY_REPAIR_TABLE_SHAPE_MISMATCH",
          "The remote d1_migrations table shape does not match the verified Wrangler registry contract.",
        );
  const check =
    migrationsResult.exitCode === 0 && registryResult.exitCode === 0 && registryShapeResult.exitCode === 0
      ? classifyRegistryRepairPreflight({
          envName: "staging",
          pendingMigrations,
          schemaCheck,
          registeredRepairMigrations,
          registryShapeValid,
        })
      : failure("REGISTRY_REPAIR_REMOTE_READ_FAILED", "Could not complete the read-only registry preflight.");

  return {
    pendingMigrations,
    schemaCheck,
    registeredRepairMigrations,
    check,
    results: [
      commandResultSummary("staging.d1.registry_repair.migrations", migrationsResult),
      {
        name: "staging.d1.registry_repair.schema",
        status: schemaCheck.code === "D1_0026_NOT_APPLIED" ? "pass" : "fail",
        check: schemaCheck,
      },
      commandResultSummary("staging.d1.registry_repair.registry", registryResult),
      registryShapeCheck,
      check,
    ],
  };
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    printHelp();
    return;
  }
  const plan = await resolveRegistryRepairPlan({ flags, options });
  const execution = plan.ok ? await executeRegistryRepairPlan(plan) : { ok: false, results: [] };
  printSummary(plan, execution);
  if (!plan.ok || !execution.ok) process.exitCode = 1;
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
  return {
    name: "cloudflare.d1.staging.registry_repair",
    status: "fail",
    code,
    message,
  };
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

function printHelp() {
  console.log(`Usage: node scripts/cloudflare-d1-registry-reconcile.mjs --env=staging [--check|--apply]

Safely repairs the staging-only Wrangler registry after schema evidence proves
0018 through 0025 already exist and 0026 is the first real gap.

Read-only preflight:
  --env=staging --check

Apply requires all of the following:
  --env=staging --apply
  --confirmation=${STAGING_REGISTRY_REPAIR_CONFIRMATION}
  --backup-path=/absolute/path/to/export.sql
  --backup-sha256=<64 hex characters>
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

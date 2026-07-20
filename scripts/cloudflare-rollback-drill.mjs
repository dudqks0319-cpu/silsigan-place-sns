#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = "silsigan-cloudflare-rollback-drill/v1";
const ALLOWED_ENVS = new Set(["staging", "production"]);
const ALLOWED_KINDS = new Set(["web", "api"]);
const DEFAULT_CONFIGS = {
  web: "wrangler.jsonc",
  api: "workers/api/wrangler.jsonc",
};
const BOOLEAN_FLAGS = new Set(["check", "help"]);
const VALUE_OPTIONS = new Set(["config", "env", "history-file", "kind", "out", "timeout-ms"]);
const MUTATING_FLAGS = new Set([
  "apply",
  "confirm-production",
  "execute",
  "mutating",
  "rollback",
  "yes",
  "y",
]);
const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

if (isCliEntryPoint()) {
  await main();
}

export function parseRollbackDrillArgs(rawArgs = []) {
  const flags = new Set();
  const options = new Map();
  const errors = [];
  const mutatingRequests = new Set();

  for (let index = 0; index < rawArgs.length; index += 1) {
    const rawArg = rawArgs[index];
    if (rawArg === "--") {
      continue;
    }
    if (typeof rawArg !== "string" || !rawArg.startsWith("--")) {
      errors.push(error("ARGUMENT_UNSUPPORTED", "Only named --options are supported."));
      continue;
    }

    const body = rawArg.slice(2);
    const separatorIndex = body.indexOf("=");
    const key = separatorIndex === -1 ? body : body.slice(0, separatorIndex);
    const inlineValue = separatorIndex === -1 ? undefined : body.slice(separatorIndex + 1);

    if (MUTATING_FLAGS.has(key)) {
      mutatingRequests.add(key);
      continue;
    }

    if (BOOLEAN_FLAGS.has(key)) {
      if (inlineValue !== undefined) {
        errors.push(error("ARGUMENT_INVALID", "Boolean flags do not accept values."));
      } else {
        flags.add(key);
      }
      continue;
    }

    if (!VALUE_OPTIONS.has(key)) {
      errors.push(error("ARGUMENT_UNSUPPORTED", "An unsupported option was provided."));
      continue;
    }

    let value = inlineValue;
    if (value === undefined) {
      const nextArg = rawArgs[index + 1];
      if (typeof nextArg === "string" && !nextArg.startsWith("--")) {
        value = nextArg;
        index += 1;
      }
    }

    if (typeof value !== "string" || value.length === 0) {
      errors.push(error("ARGUMENT_VALUE_REQUIRED", "A named option is missing its value."));
      continue;
    }

    if (options.has(key)) {
      errors.push(error("ARGUMENT_DUPLICATE", "Each named option may be provided only once."));
      continue;
    }
    options.set(key, value);
  }

  if (mutatingRequests.size > 0) {
    errors.unshift(error(
      "MUTATING_MODE_UNSUPPORTED",
      "This harness never executes rollback, deploy, migration, storage, or traffic mutations.",
    ));
  }

  return { flags, options, errors };
}

export async function createCloudflareRollbackDrill({
  args = [],
  cwd = process.cwd(),
  runReadOnlyCommand = defaultRunReadOnlyCommand,
} = {}) {
  const parsed = parseRollbackDrillArgs(args);
  const errors = [...parsed.errors];
  const envName = parsed.options.get("env") ?? "";
  const kind = parsed.options.get("kind") ?? "";
  const check = parsed.flags.has("check");
  const historyOption = parsed.options.get("history-file");
  const mode = check ? "read-only-check" : historyOption ? "fixture" : "plan-only";
  const timeoutMs = parseTimeout(parsed.options.get("timeout-ms"), errors);

  if (!ALLOWED_ENVS.has(envName)) {
    errors.push(error("ENV_INVALID", "--env must be staging or production."));
  }
  if (!ALLOWED_KINDS.has(kind)) {
    errors.push(error("WORKER_KIND_INVALID", "--kind must be web or api."));
  }
  if (check && historyOption) {
    errors.push(error("DISCOVERY_MODE_CONFLICT", "--check and --history-file cannot be combined."));
  }

  const defaultConfig = ALLOWED_KINDS.has(kind) ? DEFAULT_CONFIGS[kind] : "";
  const configDisplayPath = parsed.options.get("config") ?? defaultConfig;
  let configAbsolutePath = "";
  let workerName = "";

  if (configDisplayPath) {
    try {
      configAbsolutePath = resolveProjectInputPath(configDisplayPath, cwd, "Wrangler config");
      const config = JSON.parse(await readFile(configAbsolutePath, "utf8"));
      workerName = config?.env?.[envName]?.name ?? "";
      if (!WORKER_NAME_PATTERN.test(workerName)) {
        errors.push(error("WORKER_NAME_INVALID", "The selected Wrangler environment must define a safe Worker name."));
      }
    } catch {
      errors.push(error("WRANGLER_CONFIG_INVALID", "The selected Wrangler config is missing, outside the project, or invalid JSON."));
    }
  }

  const target = ALLOWED_ENVS.has(envName) && ALLOWED_KINDS.has(kind) && workerName
    ? { env: envName, kind, workerName, configPath: configDisplayPath }
    : null;
  const commands = {
    discovery: target ? buildDiscoveryCommand(target) : null,
    rollback: null,
    restore: null,
  };

  if (errors.length > 0 || !target) {
    return resultPayload({ ok: false, mode, status: "blocked", target, commands, errors, envName });
  }

  if (mode === "plan-only") {
    return resultPayload({ ok: true, mode, status: "plan-only", target, commands, errors: [], envName });
  }

  let history;
  if (mode === "fixture") {
    try {
      const historyPath = resolveProjectInputPath(historyOption, cwd, "Deployment history fixture");
      history = JSON.parse(await readFile(historyPath, "utf8"));
    } catch {
      errors.push(error("DEPLOYMENT_HISTORY_INVALID", "Deployment history fixture is missing, outside the project, or invalid JSON."));
    }
  } else {
    try {
      const [command, ...commandArgs] = commands.discovery;
      const commandResult = await runReadOnlyCommand(command, commandArgs, {
        cwd,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: timeoutMs,
      });
      history = JSON.parse(commandResult.stdout);
    } catch {
      errors.push(error(
        "DEPLOYMENT_HISTORY_READ_FAILED",
        "Read-only Wrangler deployment discovery failed; raw command output was intentionally suppressed.",
      ));
    }
  }

  if (errors.length > 0) {
    return resultPayload({ ok: false, mode, status: "blocked", target, commands, errors, envName });
  }

  const selection = selectRollbackCandidate(history);
  if (!selection.ok) {
    return resultPayload({
      ok: false,
      mode,
      status: "blocked",
      target,
      commands,
      errors: selection.errors,
      envName,
    });
  }

  commands.rollback = buildRollbackCommand(target, selection.candidate.rollbackVersionId, "Approved rollback drill");
  commands.restore = buildRollbackCommand(target, selection.candidate.currentVersionId, "Approved forward restoration");
  return resultPayload({
    ok: true,
    mode,
    status: "candidate-ready",
    target,
    commands,
    candidate: selection.candidate,
    errors: [],
    envName,
  });
}

export function selectRollbackCandidate(deployments) {
  if (!Array.isArray(deployments)) {
    return failedSelection("DEPLOYMENT_HISTORY_INVALID", "Wrangler deployment history must be a JSON array.");
  }

  const normalized = [];
  for (let index = 0; index < deployments.length; index += 1) {
    const deployment = deployments[index];
    const timestamp = Date.parse(deployment?.created_on);
    const versions = Array.isArray(deployment?.versions) ? deployment.versions : [];
    if (!Number.isFinite(timestamp) || versions.length === 0) {
      return failedSelection("DEPLOYMENT_HISTORY_INVALID", "Deployment history contains an invalid timestamp or version set.");
    }

    const normalizedVersions = [];
    for (const version of versions) {
      if (!VERSION_ID_PATTERN.test(version?.version_id ?? "") || !Number.isFinite(version?.percentage)) {
        return failedSelection("DEPLOYMENT_HISTORY_INVALID", "Deployment history contains an invalid version identifier or traffic percentage.");
      }
      normalizedVersions.push({
        versionId: version.version_id,
        percentage: version.percentage,
      });
    }
    normalized.push({ timestamp, createdAt: new Date(timestamp).toISOString(), versions: normalizedVersions, index });
  }

  if (normalized.length < 2) {
    return failedSelection("ROLLBACK_CANDIDATE_UNAVAILABLE", "At least two deployments are required for a rollback drill.");
  }

  normalized.sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);
  const current = normalized.at(-1);
  const currentVersionId = stableVersionId(current);
  if (!currentVersionId) {
    return failedSelection("CURRENT_DEPLOYMENT_NOT_STABLE", "The current deployment must contain exactly one version at 100% traffic.");
  }

  let previous = null;
  let rollbackVersionId = "";
  for (let index = normalized.length - 2; index >= 0; index -= 1) {
    const candidateVersionId = stableVersionId(normalized[index]);
    if (candidateVersionId && candidateVersionId !== currentVersionId) {
      previous = normalized[index];
      rollbackVersionId = candidateVersionId;
      break;
    }
  }

  if (!previous || !rollbackVersionId) {
    return failedSelection(
      "ROLLBACK_CANDIDATE_UNAVAILABLE",
      "No distinct previous single-version deployment at 100% traffic is available.",
    );
  }

  return {
    ok: true,
    errors: [],
    candidate: {
      currentVersionId,
      currentCreatedAt: current.createdAt,
      rollbackVersionId,
      rollbackCreatedAt: previous.createdAt,
    },
  };
}

export function resolveArtifactOutputPath(outputPath, cwd = process.cwd()) {
  if (typeof outputPath !== "string" || outputPath.length === 0 || isAbsolute(outputPath)) {
    throw new Error("Evidence output must be a project-relative JSON path under artifacts/.");
  }
  const absoluteRoot = resolve(cwd);
  const absoluteOutput = resolve(absoluteRoot, outputPath);
  const relativeOutput = relative(absoluteRoot, absoluteOutput);
  const artifactsPrefix = `artifacts${sep}`;
  if (
    relativeOutput.length === 0
    || relativeOutput.startsWith("..")
    || !relativeOutput.startsWith(artifactsPrefix)
    || !relativeOutput.endsWith(".json")
  ) {
    throw new Error("Evidence output must be a project-relative JSON path under artifacts/.");
  }
  return absoluteOutput;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const parsed = parseRollbackDrillArgs(rawArgs);
  if (parsed.flags.has("help")) {
    printHelp();
    return;
  }

  let result = await createCloudflareRollbackDrill({ args: rawArgs, cwd: process.cwd() });
  const outputOption = parsed.options.get("out");
  if (outputOption) {
    try {
      const outputPath = resolveArtifactOutputPath(outputOption, process.cwd());
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    } catch {
      result = {
        ...result,
        ok: false,
        status: "blocked",
        errors: [
          ...result.errors,
          error("ARTIFACT_OUTPUT_INVALID", "Evidence output must be a project-relative JSON path under artifacts/."),
        ],
      };
    }
  }

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function resultPayload({ ok, mode, status, target, commands, candidate = null, errors, envName }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok,
    mode,
    status,
    mutationsPerformed: false,
    rollbackExecutionSupported: false,
    target,
    candidate,
    commands,
    guards: {
      planOnlyDefault: true,
      cloudflareMutationDisabled: true,
      explicitExecutionApprovalRequired: true,
      productionApprovalRequired: envName === "production",
      workerOnlyRollback: true,
      resourcesNotRolledBack: ["D1", "R2", "KV", "Durable Objects", "migrations", "secrets"],
    },
    operatorChecklist: [
      "Capture a healthy baseline and current version before approval.",
      "Confirm D1, R2, KV, Durable Objects, migrations, and secrets are independently compatible.",
      "Obtain explicit rollback execution approval outside this harness.",
      "Run health, read-path, security-header, and redaction smoke checks after rollback.",
      "Restore the recorded current version and repeat the same smoke checks.",
    ],
    errors,
  };
}

function buildDiscoveryCommand(target) {
  return [
    "pnpm",
    "exec",
    "wrangler",
    "deployments",
    "list",
    "--json",
    "--env",
    target.env,
    "--config",
    target.configPath,
    "--name",
    target.workerName,
  ];
}

function buildRollbackCommand(target, versionId, message) {
  return [
    "pnpm",
    "exec",
    "wrangler",
    "rollback",
    versionId,
    "--env",
    target.env,
    "--config",
    target.configPath,
    "--name",
    target.workerName,
    "--message",
    message,
  ];
}

function stableVersionId(deployment) {
  if (!deployment || deployment.versions.length !== 1 || deployment.versions[0].percentage !== 100) {
    return "";
  }
  return deployment.versions[0].versionId;
}

function failedSelection(code, message) {
  return { ok: false, candidate: null, errors: [error(code, message)] };
}

function resolveProjectInputPath(inputPath, cwd, label) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new Error(`${label} is required.`);
  }
  const root = resolve(cwd);
  const absolutePath = resolve(root, inputPath);
  const relativePath = relative(root, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label} must remain inside the project.`);
  }
  return absolutePath;
}

function parseTimeout(rawValue, errors) {
  if (rawValue === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    errors.push(error("TIMEOUT_INVALID", `--timeout-ms must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`));
    return DEFAULT_TIMEOUT_MS;
  }
  return value;
}

async function defaultRunReadOnlyCommand(command, args, options) {
  return execFileAsync(command, args, options);
}

function error(code, message) {
  return { code, message };
}

function printHelp() {
  console.log(`Cloudflare Worker rollback drill (non-mutating)

Usage:
  node scripts/cloudflare-rollback-drill.mjs --env=staging --kind=web
  node scripts/cloudflare-rollback-drill.mjs --env=staging --kind=web --check
  node scripts/cloudflare-rollback-drill.mjs --env=staging --kind=web --history-file=tests/fixtures/deployments.json

Options:
  --env staging|production      Required target environment
  --kind web|api                Required Worker kind
  --config PATH                 Override the matching Wrangler config
  --check                       Run read-only deployments list discovery
  --history-file PATH           Use a deterministic local history fixture
  --out artifacts/...json      Write redacted evidence below artifacts/
  --timeout-ms NUMBER           Read-only discovery timeout (1000-120000)

This command never executes wrangler rollback, deploy, migration, bucket, or traffic mutations.
`);
}

function isCliEntryPoint() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

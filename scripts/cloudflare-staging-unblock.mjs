#!/usr/bin/env node

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const PUBLIC_URL_ENV_KEYS = [
  "SILSIGAN_STAGING_API_BASE_URL",
  "SILSIGAN_STAGING_PAGES_URL",
  "SILSIGAN_PRODUCTION_API_BASE_URL",
  "SILSIGAN_PRODUCTION_PAGES_URL",
  "SILSIGAN_PRIVACY_POLICY_URL",
  "SILSIGAN_SUPPORT_URL",
];
const MUTATING_REQUIRED_ENV_KEYS = ["SILSIGAN_STAGING_ADMIN_TOKEN"];

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

export function resolveStagingUnblockPlan({ flags = new Set(), options = new Map(), env = process.env } = {}) {
  const applyR2 = flags.has("apply-r2") || env.SILSIGAN_STAGING_UNBLOCK_APPLY_R2 === "1";
  const deployApi = flags.has("deploy-api") || env.SILSIGAN_STAGING_UNBLOCK_DEPLOY_API === "1";
  const smoke = flags.has("smoke") || env.SILSIGAN_STAGING_UNBLOCK_SMOKE === "1";
  const mutating = flags.has("mutating") || env.SILSIGAN_STAGING_UNBLOCK_MUTATING === "1";
  const continueOnFailure = flags.has("continue-on-failure") || env.SILSIGAN_STAGING_UNBLOCK_CONTINUE_ON_FAILURE === "1";
  const timeoutMs = numberOption(options.get("timeout-ms") ?? env.SILSIGAN_STAGING_UNBLOCK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const errors = [];
  const steps = [
    step("cloudflare.preflight.staging", ["cf:preflight:staging"]),
    step(
      applyR2 ? "cloudflare.r2.ensureStagingBucket" : "cloudflare.r2.checkStagingBucket",
      ["cf:r2:evidence", "--", "--env=staging", applyR2 ? "--apply" : "--check", `--timeout-ms=${timeoutMs}`],
    ),
    step("cloudflare.d1.checkStaging", ["cf:d1:evidence", "--", "--env=staging", "--check", `--timeout-ms=${timeoutMs}`]),
    step("cloudflare.externalState", ["cf:external-state"], PUBLIC_URL_ENV_KEYS),
  ];

  if (deployApi) {
    steps.push(step("worker.api.deploy.staging", ["cf:api:deploy:staging"]));
  }

  if (mutating && !smoke) {
    errors.push({
      code: "MUTATING_REQUIRES_SMOKE",
      message: "--mutating must be used with --smoke.",
    });
  }

  if (mutating) {
    for (const key of MUTATING_REQUIRED_ENV_KEYS) {
      if (!env[key]?.trim()) {
        errors.push({
          code: `${key}_REQUIRED`,
          message: `${key} is required for mutating staging smoke.`,
        });
      }
    }
  }

  if (smoke) {
    const smokeArgs = ["smoke:staging"];
    const smokeEnvKeys = ["SILSIGAN_STAGING_API_BASE_URL"];
    if (mutating) {
      smokeArgs.push("--", "--mutating", "--require-admin");
      smokeEnvKeys.push(...MUTATING_REQUIRED_ENV_KEYS);
    }
    steps.push(step(mutating ? "staging.api.smoke.mutating" : "staging.api.smoke.readOnly", smokeArgs, smokeEnvKeys));
  }

  return {
    ok: errors.length === 0,
    timeoutMs,
    applyR2,
    deployApi,
    smoke,
    mutating,
    continueOnFailure,
    errors,
    steps,
  };
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help") || flags.has("h")) {
    printHelp();
    return;
  }

  const plan = resolveStagingUnblockPlan({ flags, options, env: process.env });
  if (flags.has("plan-only")) {
    printSummary({ ...plan, mode: "plan-only", results: [], blockers: [] });
    process.exitCode = plan.ok ? 0 : 1;
    return;
  }

  if (!plan.ok) {
    printSummary({ ...plan, mode: "run", results: [], blockers: [] });
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const plannedStep of plan.steps) {
    const result = await runStep(plannedStep, plan.timeoutMs);
    results.push(result);
    if (result.status === "fail" && !plan.continueOnFailure) {
      break;
    }
  }

  const ok = results.length === plan.steps.length && results.every((result) => result.status === "pass");
  printSummary({
    ...plan,
    mode: "run",
    ok,
    results,
    blockers: summarizeBlockers(results),
  });
  process.exitCode = ok ? 0 : 1;
}

function step(name, args, envKeys = []) {
  return {
    name,
    command: "pnpm",
    args,
    envKeys,
    label: ["pnpm", ...args].join(" "),
  };
}

function runStep(plannedStep, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    execFile(commandName(plannedStep.command), plannedStep.args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
      env: process.env,
    }, (error, stdout, stderr) => {
      const output = `${stdout ?? ""}\n${stderr ?? ""}`;
      const status = error ? "fail" : "pass";
      resolve({
        name: plannedStep.name,
        status,
        durationMs: Date.now() - startedAt,
        exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        blockers: status === "fail" ? extractBlockers(output) : [],
        outputTail: redactOutput(tail(stdout ?? "", status === "fail" ? 4_000 : 2_000)),
        errorTail: redactOutput(tail(stderr ?? "", status === "fail" ? 4_000 : 2_000)),
      });
    });
  });
}

function summarizeBlockers(results) {
  return [...new Set(results.flatMap((result) => result.blockers ?? []))];
}

function extractBlockers(output) {
  const blockers = [];
  for (const payload of parseJsonPayloads(output)) {
    collectPayloadBlockers(payload, blockers);
  }
  return [...new Set(blockers)];
}

function collectPayloadBlockers(payload, blockers) {
  if (!isRecord(payload)) {
    return;
  }

  if (Array.isArray(payload.blockers)) {
    for (const blocker of payload.blockers) {
      collectBlocker(blockers, blocker);
    }
  }

  if (Array.isArray(payload.checks)) {
    for (const check of payload.checks) {
      if (isRecord(check) && check.status === "fail") {
        collectBlocker(blockers, check.code ?? check.name);
      }
    }
  }

  if (Array.isArray(payload.results)) {
    for (const result of payload.results) {
      if (!isRecord(result) || result.status !== "fail") {
        continue;
      }
      collectBlocker(blockers, result.check?.code ?? result.check?.name ?? result.name);
    }
  }
}

function collectBlocker(blockers, value) {
  if (typeof value !== "string") {
    return;
  }

  const blocker = value.trim();
  if (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(blocker)) {
    blockers.push(blocker);
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
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberOption(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function commandName(command) {
  return process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
}

function tail(value, limit) {
  const text = String(value ?? "");
  return text.length <= limit ? text : text.slice(text.length - limit);
}

function redactOutput(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, "Bearer [redacted]")
    .replace(/(x-silsigan-admin-token\s*[:=]\s*)[^\s"']+/gi, "$1[redacted]")
    .replace(/(SILSIGAN_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s"']+/g, "$1[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
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
  console.log(`Usage: pnpm cf:staging:unblock -- [options]

Runs the safe staging unblock lane after Cloudflare R2 checkout.

Default run:
  - staging resource preflight
  - staging R2 bucket check
  - staging D1 evidence check
  - Cloudflare external-state check

Options:
  --plan-only              Print the ordered lane without running commands.
  --apply-r2               Create the configured staging R2 bucket if R2 is enabled and the bucket is missing.
  --deploy-api             Deploy the configured staging API Worker after R2/D1/external checks.
  --smoke                  Run read-only staging API smoke.
  --mutating               Run mutation/admin staging smoke. Requires --smoke and SILSIGAN_STAGING_ADMIN_TOKEN.
  --continue-on-failure    Continue collecting later step blockers after a failure.
  --timeout-ms N           Per-step timeout. Default: 120000.
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

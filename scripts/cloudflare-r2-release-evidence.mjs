#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  classifyR2BucketListResult,
  sanitizeWranglerOutput,
} from "./cloudflare-external-state-check.mjs";
import { createWranglerCommandEnv } from "./wrangler-command-env.mjs";

const DEFAULT_CONFIG_PATH = "workers/api/wrangler.jsonc";
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const ALLOWED_ENVS = ["staging", "production"];

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

export async function resolveR2ReleaseEvidencePlan({ flags = new Set(), options = new Map(), env = process.env } = {}) {
  const configPath = options.get("config") ?? DEFAULT_CONFIG_PATH;
  const apply = flags.has("apply") || env.SILSIGAN_R2_RELEASE_APPLY === "1";
  const check = flags.has("check") || env.SILSIGAN_R2_RELEASE_CHECK === "1";
  const confirmProduction = flags.has("confirm-production") || env.SILSIGAN_R2_CONFIRM_PRODUCTION === "1";
  const timeoutMs = numberOption(options.get("timeout-ms") ?? env.SILSIGAN_R2_RELEASE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const requestedEnvs = parseEnvOption(options.get("env") ?? env.SILSIGAN_R2_RELEASE_ENV);
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
      message: "production R2 버킷 생성에는 --confirm-production 이 필요합니다.",
    });
  }

  const uniqueEnvs = [...new Set(requestedEnvs.filter((envName) => ALLOWED_ENVS.includes(envName)))];
  const targets = uniqueEnvs.length > 0 ? await readExpectedR2Buckets(configPath, uniqueEnvs) : [];
  const missingConfigErrors = targets
    .filter((target) => target.buckets.length === 0)
    .map((target) => ({
      code: "R2_BUCKET_CONFIG_REQUIRED",
      message: `workers/api wrangler config must define r2_buckets for ${target.envName}.`,
    }));

  return {
    ok: errors.length === 0 && missingConfigErrors.length === 0,
    mode: apply ? "apply" : check ? "check" : "plan-only",
    apply,
    check,
    confirmProduction,
    configPath,
    timeoutMs,
    errors: [...errors, ...missingConfigErrors],
    targets: targets.map((target) => ({
      ...target,
      bucketNames: target.buckets.map((bucket) => bucket.bucketName),
      steps: buildTargetSteps(target, configPath, apply),
    })),
  };
}

export async function readExpectedR2Buckets(configPath = DEFAULT_CONFIG_PATH, targetEnvs = ALLOWED_ENVS) {
  const config = JSON.parse(stripJsonComments(await readFile(configPath, "utf8")));

  return targetEnvs.map((envName) => {
    const envConfig = envName === "" ? config : config.env?.[envName];
    const buckets = Array.isArray(envConfig?.r2_buckets)
      ? envConfig.r2_buckets
          .map((bucket) => ({
            binding: typeof bucket?.binding === "string" ? bucket.binding : null,
            bucketName: typeof bucket?.bucket_name === "string" ? bucket.bucket_name : null,
          }))
          .filter((bucket) => typeof bucket.bucketName === "string" && bucket.bucketName.length > 0)
      : [];

    return { envName, buckets };
  });
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    printHelp();
    return;
  }

  const plan = await resolveR2ReleaseEvidencePlan({ flags, options, env: process.env });
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
    const listStep = target.steps.find((step) => step.name === "r2.buckets.list");
    const listResult = await runListStep(target, listStep, plan.timeoutMs, plan.apply);
    results.push(listResult);

    if (listResult.status === "fail") {
      break;
    }

    if (!plan.apply || listResult.missingBuckets.length === 0) {
      continue;
    }

    for (const missingBucketName of listResult.missingBuckets) {
      const createStep = target.steps.find((step) => step.name === "r2.bucket.create" && step.bucketName === missingBucketName);
      const createResult = await runStep(target.envName, createStep, plan.timeoutMs);
      results.push(createResult);
      if (createResult.status === "fail") {
        break;
      }
    }

    if (results.at(-1)?.status === "fail") {
      break;
    }

    results.push(await runListStep(target, listStep, plan.timeoutMs, false, "r2.buckets.verify"));
  }

  const ok = results.length > 0 && results.every((result) => result.status === "pass");
  printSummary({ ...plan, ok, results });
  if (!ok) {
    process.exitCode = 1;
  }
}

function buildTargetSteps(target, configPath, apply) {
  const steps = [
    {
      name: "r2.buckets.list",
      command: "npx",
      args: ["--yes", "wrangler", "r2", "bucket", "list", "--env", target.envName, "--config", configPath],
    },
  ];

  for (const bucket of target.buckets) {
    steps.push({
      name: "r2.bucket.create",
      bucketName: bucket.bucketName,
      binding: bucket.binding,
      command: "npx",
      args: ["--yes", "wrangler", "r2", "bucket", "create", bucket.bucketName, "--env", target.envName, "--config", configPath],
      applyOnly: true,
    });
  }

  return apply ? steps : steps.filter((step) => !step.applyOnly);
}

async function runListStep(target, targetStep, timeoutMs, allowMissingBuckets, resultName = targetStep?.name) {
  const startedAt = Date.now();
  const commandResult = await runCommand(targetStep.command, targetStep.args, timeoutMs);
  const check = classifyR2BucketListResult(commandResult, target.bucketNames);
  const missingBuckets = Array.isArray(check.missingBuckets) ? check.missingBuckets : [];
  const missingBucketsCanBeApplied = allowMissingBuckets && check.code === "R2_BUCKETS_MISSING";

  return {
    name: `${target.envName}.${resultName}`,
    status: check.status === "pass" || missingBucketsCanBeApplied ? "pass" : "fail",
    durationMs: Date.now() - startedAt,
    check,
    missingBuckets,
  };
}

async function runStep(envName, targetStep, timeoutMs) {
  const startedAt = Date.now();
  const commandResult = await runCommand(targetStep.command, targetStep.args, timeoutMs);
  return {
    name: `${envName}.${targetStep.name}.${targetStep.bucketName}`,
    status: commandResult.exitCode === 0 ? "pass" : "fail",
    durationMs: Date.now() - startedAt,
    ...(commandResult.exitCode === 0
      ? { outputTail: sanitizeWranglerOutput(tail(commandResult.stdout, 1_500)) }
      : { errorTail: sanitizeWranglerOutput(tail(`${commandResult.stdout}\n${commandResult.stderr}`, 2_000)) }),
  };
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4, env: createWranglerCommandEnv() }, (error, stdout, stderr) => {
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

function printSummary(summary) {
  console.log(
    JSON.stringify(
      {
        ...summary,
        targets: summary.targets.map((target) => ({
          envName: target.envName,
          bucketNames: target.bucketNames,
          steps: target.steps.map((targetStep) => ({
            name: targetStep.name,
            label: [targetStep.command, ...targetStep.args].join(" "),
            bucketName: targetStep.bucketName,
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
  console.log(`Usage: node scripts/cloudflare-r2-release-evidence.mjs --env=staging [--check|--apply] [--confirm-production]

Plans, checks, or explicitly creates Cloudflare R2 release buckets:
  wrangler r2 bucket list --env <env>
  wrangler r2 bucket create <bucket> --env <env>       only with --apply and only for missing buckets

Options:
  --env=staging|production     Required target environment. --apply allows exactly one env.
  --check                      Run read-only bucket visibility checks.
  --apply                      Create missing configured R2 buckets, then verify visibility.
  --confirm-production         Required with --apply --env=production.
  --config PATH                Wrangler API config. Default: workers/api/wrangler.jsonc
  --timeout-ms N               Per-command timeout.
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

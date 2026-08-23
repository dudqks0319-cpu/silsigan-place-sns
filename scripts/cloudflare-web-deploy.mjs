#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCloudflareWeb, computeWebBuildInputDigest } from "./cloudflare-web-build.mjs";
import { scanBuildForEnvValues } from "./scan-build-env-secrets.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const CANDIDATE_DOCUMENT = "docs/staging-deploy-candidate.md";

if (isCliEntryPoint()) {
  try {
    const result = await runWebDeploy({ args: process.argv.slice(2) });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: publicErrorMessage(error) }, null, 2));
    process.exitCode = 1;
  }
}

export async function runWebDeploy({ args = [], root = projectRoot } = {}) {
  const options = parseWebDeployArguments(args);
  if (options.environment !== "staging") {
    return blockedResult(options.apply ? "apply" : "plan-only", "PRODUCTION_DEPLOY_UNSUPPORTED", "Production web deploy is not enabled by this staging-only guard.");
  }

  const recordedDigest = parseRecordedCandidateDigest(await readFile(join(root, CANDIDATE_DOCUMENT), "utf8"));
  const currentDigest = await computeWebBuildInputDigest(root);
  const authorization = validateWebDeployAuthorization({
    apply: options.apply,
    confirmStagingDeploy: options.confirmStagingDeploy,
    providedDigest: options.candidateDigest,
    recordedDigest,
    currentDigest,
  });

  const plan = {
    environment: "staging",
    candidateDocument: CANDIDATE_DOCUMENT,
    recordedDigest,
    currentDigest,
    commands: options.apply
      ? ["isolated OpenNext build", "Wrangler staging dry-run", "final bundle secret scan", "Wrangler staging deploy"]
      : [],
    applyCommand: `pnpm cf:deploy -- --apply --confirm-staging-deploy --candidate-digest=${recordedDigest}`,
  };

  if (!authorization.ok || !options.apply) {
    return { ...authorization, ...plan, remoteMutationPerformed: false };
  }

  await buildCloudflareWeb({ environment: "staging", root });
  const dryRunDirectory = await mkdtemp(join(tmpdir(), "silsigan-web-deploy-dry-run-"));
  try {
    await runCommand("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--env", "staging", "--config", "wrangler.jsonc", "--outdir", dryRunDirectory], { cwd: root });

    const envLocalPath = join(root, ".env.local");
    let finalBundleSecretScan = {
      ok: true,
      scannedFiles: 0,
      checkedSecretKeys: [],
      matchedSecretKeys: [],
      skipped: "no .env.local file",
    };
    if (await pathExists(envLocalPath)) {
      finalBundleSecretScan = await scanBuildForEnvValues(envLocalPath, dryRunDirectory);
      if (!finalBundleSecretScan.ok) {
        throw new Error(`Wrangler dry-run bundle contains local secret values for keys: ${finalBundleSecretScan.matchedSecretKeys.join(", ")}`);
      }
    }

    const finalSourceDigest = await computeWebBuildInputDigest(root);
    if (finalSourceDigest !== recordedDigest) {
      throw new Error("Cloudflare web build inputs changed after authorization; staging deploy is cancelled.");
    }

    await runCommand("pnpm", ["exec", "wrangler", "deploy", "--env", "staging", "--config", "wrangler.jsonc"], { cwd: root });
    return { ...authorization, ...plan, finalSourceDigest, finalBundleSecretScan, remoteMutationPerformed: true };
  } finally {
    await rm(dryRunDirectory, { recursive: true, force: true });
  }
}

export function validateWebDeployAuthorization({ apply, confirmStagingDeploy, providedDigest, recordedDigest, currentDigest }) {
  const errors = [];
  if (!isSha256(recordedDigest)) {
    errors.push({ code: "CANDIDATE_RECORD_INVALID", message: "The recorded staging candidate digest is missing or invalid." });
  }
  if (!isSha256(currentDigest) || currentDigest !== recordedDigest) {
    errors.push({ code: "CANDIDATE_SOURCE_DRIFT", message: "Current web build inputs do not match the recorded staging candidate." });
  }
  if (apply) {
    if (!confirmStagingDeploy) {
      errors.push({ code: "STAGING_DEPLOY_CONFIRMATION_REQUIRED", message: "Staging deploy requires --confirm-staging-deploy." });
    }
    if (!providedDigest) {
      errors.push({ code: "CANDIDATE_DIGEST_REQUIRED", message: "Staging deploy requires --candidate-digest=<sha256>." });
    } else if (!isSha256(providedDigest) || providedDigest !== recordedDigest) {
      errors.push({ code: "CANDIDATE_DIGEST_CONFIRMATION_MISMATCH", message: "The supplied candidate digest does not match the recorded staging candidate." });
    }
  }
  return { ok: errors.length === 0, mode: apply ? "apply" : "plan-only", errors };
}

export function parseWebDeployArguments(args) {
  const environmentArg = args.find((value) => value.startsWith("--env="));
  const digestArg = args.find((value) => value.startsWith("--candidate-digest="));
  return {
    apply: args.includes("--apply"),
    confirmStagingDeploy: args.includes("--confirm-staging-deploy"),
    candidateDigest: digestArg?.slice("--candidate-digest=".length) ?? "",
    environment: environmentArg?.slice("--env=".length) ?? "staging",
  };
}

export function parseRecordedCandidateDigest(source) {
  const match = source.match(/Web build-input digest:\s*`([a-f0-9]{64})`/);
  if (!match) throw new Error("The staging candidate document does not contain a valid web build-input digest.");
  return match[1];
}

function blockedResult(mode, code, message) {
  return { ok: false, mode, errors: [{ code, message }], remoteMutationPerformed: false };
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function runCommand(command, args, options) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolvePromise();
      rejectPromise(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
    });
  });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function publicErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isCliEntryPoint() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

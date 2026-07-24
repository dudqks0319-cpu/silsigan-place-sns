#!/usr/bin/env node

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { findSensitiveTailLogFindings, parseWranglerTailEvents, sanitizeWranglerTailText } from "./cloudflare-tail-safety.mjs";

const DEFAULT_WORKER = "silsigan-api-staging";
const DEFAULT_CONFIG = "workers/api/wrangler.jsonc";
const DEFAULT_DURATION_MS = 30_000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export function parseCaptureArgs(rawArgs, env = process.env) {
  const options = new Map();
  for (const rawArg of rawArgs) {
    if (!rawArg.startsWith("--")) {
      continue;
    }
    const separatorIndex = rawArg.indexOf("=");
    if (separatorIndex === -1) {
      options.set(rawArg.slice(2), "1");
    } else {
      options.set(rawArg.slice(2, separatorIndex), rawArg.slice(separatorIndex + 1));
    }
  }

  const worker = options.get("worker") ?? DEFAULT_WORKER;
  const config = options.get("config") ?? DEFAULT_CONFIG;
  const environment = options.get("env") ?? "staging";
  const output = options.get("output") ?? env.SILSIGAN_STAGING_TAIL_LOG_FILE ?? "";
  const durationMs = Number(options.get("duration-ms") ?? DEFAULT_DURATION_MS);

  if (environment !== "staging") {
    throw new Error("Safe tail capture is restricted to staging.");
  }
  if (worker !== DEFAULT_WORKER) {
    throw new Error(`Safe tail capture requires the exact staging Worker ${DEFAULT_WORKER}.`);
  }
  if (!config || config.includes("\0")) {
    throw new Error("A valid Wrangler config path is required.");
  }
  if (!output || output.includes("\0")) {
    throw new Error("--output or SILSIGAN_STAGING_TAIL_LOG_FILE is required.");
  }
  if (!Number.isInteger(durationMs) || durationMs < 5_000 || durationMs > 120_000) {
    throw new Error("--duration-ms must be an integer between 5000 and 120000.");
  }

  return { worker, config, environment, output, durationMs };
}

export function buildWranglerTailArgs(config) {
  return [
    "exec",
    "wrangler",
    "tail",
    config.worker,
    "--format",
    "json",
    "--config",
    config.config,
  ];
}

export async function captureSanitizedTail(config, { spawnImpl = spawn } = {}) {
  const child = spawnImpl("pnpm", buildWranglerTailArgs(config), {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks = [];
  let stdoutBytes = 0;
  let stoppedByHarness = false;
  let captureError = null;

  const stopChild = () => {
    stoppedByHarness = true;
    child.kill("SIGINT");
    setTimeout(() => child.kill("SIGTERM"), 2_000).unref();
  };
  const handleSignal = () => stopChild();
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  child.stdout.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stdoutBytes += bytes.length;
    if (stdoutBytes > MAX_CAPTURE_BYTES) {
      captureError = new Error("Wrangler tail capture exceeded the bounded memory limit.");
      stopChild();
      return;
    }
    stdoutChunks.push(bytes);
  });
  child.stderr.resume();

  const timeout = setTimeout(stopChild, config.durationMs);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => {
    clearTimeout(timeout);
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
  });

  if (captureError) {
    throw captureError;
  }
  if (!stoppedByHarness && result.code !== 0) {
    throw new Error("Wrangler tail exited before the bounded capture completed.");
  }

  const rawText = Buffer.concat(stdoutChunks).toString("utf8");
  const sanitizedText = sanitizeWranglerTailText(rawText);
  const eventCount = parseWranglerTailEvents(sanitizedText).length;
  if (eventCount === 0) {
    throw new Error("Wrangler tail capture contained no invocation events.");
  }

  const findings = findSensitiveTailLogFindings(sanitizedText);
  if (findings.length > 0) {
    throw new Error(`Worker-emitted log data failed redaction: ${findings.join(",")}`);
  }

  await writeFile(config.output, sanitizedText, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return {
    ok: true,
    environment: config.environment,
    worker: config.worker,
    output: config.output,
    eventCount,
    rawBytes: stdoutBytes,
    sanitizedBytes: Buffer.byteLength(sanitizedText),
    findings,
  };
}

async function main() {
  try {
    const config = parseCaptureArgs(process.argv.slice(2));
    const result = await captureSanitizedTail(config);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Safe tail capture failed.",
    }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

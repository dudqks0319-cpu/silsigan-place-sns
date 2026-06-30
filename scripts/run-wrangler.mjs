#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`Runs Wrangler with repo-local log output.

Usage:
  node scripts/run-wrangler.mjs <wrangler args...>

Defaults:
  WRANGLER_LOG_PATH=artifacts/wrangler-logs

Set WRANGLER_LOG_PATH explicitly to override the default.`);
  process.exit(args.length === 0 ? 1 : 0);
}

const logPath = process.env.WRANGLER_LOG_PATH || resolve(process.cwd(), "artifacts/wrangler-logs");
await mkdir(logPath, { recursive: true });

const child = spawn(process.platform === "win32" ? "wrangler.cmd" : "wrangler", args, {
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: logPath,
  },
});

child.on("error", (error) => {
  console.error(`Failed to run Wrangler: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Wrangler exited from signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

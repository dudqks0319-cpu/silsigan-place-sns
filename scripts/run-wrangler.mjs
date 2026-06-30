#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createWranglerCommandEnv } from "./wrangler-command-env.mjs";

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

const commandEnv = createWranglerCommandEnv();

const child = spawn(process.platform === "win32" ? "wrangler.cmd" : "wrangler", args, {
  stdio: "inherit",
  env: commandEnv,
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

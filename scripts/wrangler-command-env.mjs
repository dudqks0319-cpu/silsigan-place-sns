import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_WRANGLER_LOG_PATH = "artifacts/wrangler-logs";

export function resolveWranglerLogPath({ env = process.env, cwd = process.cwd() } = {}) {
  return env.WRANGLER_LOG_PATH || resolve(cwd, DEFAULT_WRANGLER_LOG_PATH);
}

export function createWranglerCommandEnv({ env = process.env, cwd = process.cwd() } = {}) {
  const logPath = resolveWranglerLogPath({ env, cwd });
  mkdirSync(logPath, { recursive: true });
  return {
    ...env,
    WRANGLER_LOG_PATH: logPath,
  };
}

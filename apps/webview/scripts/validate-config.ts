import { createCapacitorConfig } from "../src/config.ts";

try {
  const config = createCapacitorConfig(process.env);
  if (process.env.SILSIGAN_WEBVIEW_GENERATE === "1") {
    if (config.appId !== "kr.silsigan.mobile" || config.webDir !== "web" || "server" in config || config.plugins) {
      throw new Error("generation config must omit runtime deployment settings");
    }
    process.stdout.write(`webview generation config valid: ${config.appId}\n`);
  } else {
    const shellConfig = config.plugins?.SilsiganShell;
    if (!shellConfig || !config.server) {
      throw new Error("runtime deployment config is required for validation");
    }
    process.stdout.write(`webview config valid: ${shellConfig.environment} ${config.server.url}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown configuration error";
  process.stderr.write(`webview config invalid: ${message}\n`);
  process.exitCode = 1;
}

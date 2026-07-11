import { createCapacitorConfig } from "../src/config.ts";

try {
  const config = createCapacitorConfig(process.env);
  process.stdout.write(`webview config valid: ${config.plugins.SilsiganShell.environment} ${config.server.url}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown configuration error";
  process.stderr.write(`webview config invalid: ${message}\n`);
  process.exitCode = 1;
}

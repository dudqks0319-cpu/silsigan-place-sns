import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const rollbackDrill = await import(new URL("../scripts/cloudflare-rollback-drill.mjs", import.meta.url).href);
const { createCloudflareRollbackDrill, resolveArtifactOutputPath } = rollbackDrill;

const PREVIOUS_VERSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CURRENT_VERSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "silsigan-rollback-drill-"));
  const configPath = join(root, "wrangler.jsonc");
  const historyPath = join(root, "history.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "silsigan-web",
      env: {
        staging: { name: "silsigan-web-staging" },
        production: { name: "silsigan-web-production" },
      },
    }),
    "utf8",
  );
  writeFileSync(historyPath, JSON.stringify(stableHistory()), "utf8");
  return { root, configPath, historyPath };
}

function stableHistory() {
  return [
    {
      id: "deployment-previous",
      created_on: "2026-07-18T00:00:00.000Z",
      author_email: "operator@example.com",
      source: "wrangler",
      annotations: { "workers/message": "provider-secret must stay redacted" },
      versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }],
    },
    {
      id: "deployment-current",
      created_on: "2026-07-19T00:00:00.000Z",
      author_email: "owner@example.com",
      source: "wrangler",
      annotations: { "workers/message": "https://private.example/path" },
      versions: [{ version_id: CURRENT_VERSION, percentage: 100 }],
    },
  ];
}

test("fixture drill selects a stable previous Worker version and emits only a guarded operator command", async () => {
  const fixture = createFixture();
  const result = await createCloudflareRollbackDrill({
    args: [
      "--env=staging",
      "--kind=web",
      `--config=${fixture.configPath}`,
      `--history-file=${fixture.historyPath}`,
    ],
    cwd: fixture.root,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "fixture");
  assert.equal(result.status, "candidate-ready");
  assert.equal(result.mutationsPerformed, false);
  assert.equal(result.rollbackExecutionSupported, false);
  assert.deepEqual(result.target, {
    env: "staging",
    kind: "web",
    workerName: "silsigan-web-staging",
    configPath: fixture.configPath,
  });
  assert.equal(result.candidate?.currentVersionId, CURRENT_VERSION);
  assert.equal(result.candidate?.rollbackVersionId, PREVIOUS_VERSION);
  assert.deepEqual(result.commands.rollback?.slice(0, 4), ["pnpm", "exec", "wrangler", "rollback"]);
  assert.ok(result.commands.rollback?.includes(PREVIOUS_VERSION));
  assert.equal(result.commands.rollback?.includes("--yes"), false);
  assert.equal(result.guards.workerOnlyRollback, true);
  assert.deepEqual(result.guards.resourcesNotRolledBack, ["D1", "R2", "KV", "Durable Objects", "migrations", "secrets"]);

  const output = JSON.stringify(result);
  assert.equal(/operator@example|owner@example|provider-secret|private\.example|author_email|annotations/i.test(output), false);
});

test("read-only check invokes only deployments list and never invokes rollback", async () => {
  const fixture = createFixture();
  const calls: Array<{ command: string; args: string[] }> = [];
  const result = await createCloudflareRollbackDrill({
    args: ["--check", "--env=staging", "--kind=web", `--config=${fixture.configPath}`],
    cwd: fixture.root,
    runReadOnlyCommand: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { stdout: JSON.stringify(stableHistory()), stderr: "account@example.com provider-secret" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "read-only-check");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "pnpm");
  assert.deepEqual(calls[0].args.slice(0, 4), ["exec", "wrangler", "deployments", "list"]);
  assert.equal(calls[0].args.includes("rollback"), false);
  assert.equal(JSON.stringify(result).includes("account@example.com"), false);
});

test("drill fails closed without a distinct previous stable deployment", async () => {
  const fixture = createFixture();
  writeFileSync(fixture.historyPath, JSON.stringify(stableHistory().slice(1)), "utf8");
  const tooShort = await createCloudflareRollbackDrill({
    args: ["--env=staging", "--kind=web", `--config=${fixture.configPath}`, `--history-file=${fixture.historyPath}`],
    cwd: fixture.root,
  });
  assert.equal(tooShort.ok, false);
  assert.ok(tooShort.errors.some((error: { code: string }) => error.code === "ROLLBACK_CANDIDATE_UNAVAILABLE"));

  const splitHistory = stableHistory();
  splitHistory[1].versions = [
    { version_id: CURRENT_VERSION, percentage: 90 },
    { version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", percentage: 10 },
  ];
  writeFileSync(fixture.historyPath, JSON.stringify(splitHistory), "utf8");
  const split = await createCloudflareRollbackDrill({
    args: ["--env=staging", "--kind=web", `--config=${fixture.configPath}`, `--history-file=${fixture.historyPath}`],
    cwd: fixture.root,
  });
  assert.equal(split.ok, false);
  assert.ok(split.errors.some((error: { code: string }) => error.code === "CURRENT_DEPLOYMENT_NOT_STABLE"));
});

test("mutating flags are rejected before a command runner can execute", async () => {
  const fixture = createFixture();
  let runnerCalled = false;
  const result = await createCloudflareRollbackDrill({
    args: ["--check", "--apply", "--yes", "--env=staging", "--kind=web", `--config=${fixture.configPath}`],
    cwd: fixture.root,
    runReadOnlyCommand: async () => {
      runnerCalled = true;
      throw new Error("must not run");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(runnerCalled, false);
  assert.ok(result.errors.some((error: { code: string }) => error.code === "MUTATING_MODE_UNSUPPORTED"));
});

test("production remains approval-gated and artifact paths cannot escape artifacts", async () => {
  const fixture = createFixture();
  const result = await createCloudflareRollbackDrill({
    args: ["--env=production", "--kind=web", `--config=${fixture.configPath}`, `--history-file=${fixture.historyPath}`],
    cwd: fixture.root,
  });

  assert.equal(result.ok, true);
  assert.equal(result.guards.productionApprovalRequired, true);
  assert.equal(result.guards.explicitExecutionApprovalRequired, true);
  assert.equal(resolveArtifactOutputPath("artifacts/rollback/drill.json", fixture.root), join(fixture.root, "artifacts/rollback/drill.json"));
  assert.throws(() => resolveArtifactOutputPath("../drill.json", fixture.root), /artifacts/i);
  assert.throws(() => resolveArtifactOutputPath(join(fixture.root, "drill.json"), fixture.root), /artifacts/i);
});

test("pnpm option separator is ignored so documented package commands remain plan-only", async () => {
  const fixture = createFixture();
  const result = await createCloudflareRollbackDrill({
    args: ["--", "--env=staging", "--kind=api", `--config=${fixture.configPath}`],
    cwd: fixture.root,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "plan-only");
  assert.equal(result.status, "plan-only");
  assert.equal(result.mutationsPerformed, false);
  assert.equal(result.commands.rollback, null);
});

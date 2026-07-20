import assert from "node:assert/strict";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, "..");
const localReportHarness = await import(new URL("../scripts/cloudflare-pages-local-report-smoke.mjs", import.meta.url).href) as {
  createIsolatedNextWorkspace: (projectRoot?: string) => Promise<string>;
};

test("local report browser harness isolates Next-generated config from the project", async () => {
  const projectNextEnvPath = join(projectRoot, "next-env.d.ts");
  const originalNextEnv = await readFile(projectNextEnvPath, "utf8");
  const workspaceRoot = await localReportHarness.createIsolatedNextWorkspace(projectRoot);

  try {
    assert.notEqual(await realpath(workspaceRoot), await realpath(projectRoot));
    assert.notEqual(await realpath(join(workspaceRoot, "src")), await realpath(join(projectRoot, "src")));
    assert.equal(
      await readFile(join(workspaceRoot, "src", "app", "page.tsx"), "utf8"),
      await readFile(join(projectRoot, "src", "app", "page.tsx"), "utf8"),
    );
    assert.equal(
      await readFile(join(workspaceRoot, "apps", "webview", "src", "bridge.mjs"), "utf8"),
      await readFile(join(projectRoot, "apps", "webview", "src", "bridge.mjs"), "utf8"),
    );

    await writeFile(join(workspaceRoot, "next-env.d.ts"), "// isolated harness mutation\n", "utf8");
    assert.equal(await readFile(projectNextEnvPath, "utf8"), originalNextEnv);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

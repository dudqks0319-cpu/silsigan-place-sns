import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};
const provenanceScript = fileURLToPath(new URL("../scripts/release-candidate-provenance.mjs", import.meta.url));
const evidencePrepareScript = fileURLToPath(new URL("../scripts/release-evidence-prepare.mjs", import.meta.url));

type ProvenancePayload = {
  ok: boolean;
  state: string;
  blockers: string[];
  checks: Array<{ name: string; status: string; message: string; [key: string]: unknown }>;
};

type ProvenanceFixture = {
  root: string;
  candidateSha: string;
  branch: string;
  artifactPath: string;
  manifestPath: string;
  ledgerPath: string;
};

function readCiWorkflow(): string {
  return readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
}

function readPagesSmoke(): string {
  return readFileSync(new URL("../scripts/cloudflare-pages-smoke.mjs", import.meta.url), "utf8");
}

function runGit(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeCandidateLedger(fixture: Pick<ProvenanceFixture, "ledgerPath" | "candidateSha" | "branch">, overrides: Partial<{ gitSha: string; branch: string; dirtyState: string }> = {}): void {
  writeFileSync(
    fixture.ledgerPath,
    [
      "schema_version: 1",
      "candidate:",
      `  git_sha: "${overrides.gitSha ?? fixture.candidateSha}"`,
      `  branch: "${overrides.branch ?? fixture.branch}"`,
      `  dirty_state: "${overrides.dirtyState ?? "clean"}"`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeArtifactManifest(fixture: Pick<ProvenanceFixture, "manifestPath" | "candidateSha" | "branch" | "artifactPath">, artifactEntry: Partial<{ path: string; sha256: string }> = {}): void {
  writeFileSync(
    fixture.manifestPath,
    `${JSON.stringify({
      schemaVersion: 1,
      gitSha: fixture.candidateSha,
      branch: fixture.branch,
      generatedAt: "2026-07-19T00:00:00.000Z",
      artifacts: [
        {
          path: artifactEntry.path ?? "artifacts/release-evidence/verification.json",
          sha256: artifactEntry.sha256 ?? sha256File(fixture.artifactPath),
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

function createProvenanceFixture(): ProvenanceFixture {
  const root = mkdtempSync(join(tmpdir(), "silsigan-provenance-"));
  const branch = "codex/provenance-test";
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "export const version = 1;\n", "utf8");
  runGit(root, "init");
  runGit(root, "config", "user.email", "provenance@example.invalid");
  runGit(root, "config", "user.name", "Provenance Test");
  runGit(root, "checkout", "-b", branch);
  runGit(root, "add", "src/app.ts");
  runGit(root, "commit", "-m", "candidate source");

  const candidateSha = runGit(root, "rev-parse", "HEAD");
  const artifactDirectory = join(root, "artifacts", "release-evidence");
  const docsDirectory = join(root, "docs");
  const artifactPath = join(artifactDirectory, "verification.json");
  const manifestPath = join(artifactDirectory, "manifest.json");
  const ledgerPath = join(root, "release-ledger.yaml");
  mkdirSync(artifactDirectory, { recursive: true });
  mkdirSync(docsDirectory, { recursive: true });
  writeFileSync(artifactPath, '{"tests":{"passed":1,"failed":0}}\n', "utf8");

  const fixture = { root, candidateSha, branch, artifactPath, manifestPath, ledgerPath };
  writeCandidateLedger(fixture);
  writeArtifactManifest(fixture);
  writeFileSync(join(root, "RELEASE_STATUS.md"), "# Release Status\n\nCandidate evidence only.\n", "utf8");
  writeFileSync(join(docsDirectory, "current-release-state.md"), "# Current release state\n\nCandidate evidence only.\n", "utf8");
  runGit(root, "add", "release-ledger.yaml", "RELEASE_STATUS.md", "docs/current-release-state.md", "artifacts/release-evidence");
  runGit(root, "commit", "-m", "record candidate evidence");
  return fixture;
}

function inspectProvenance(fixture: ProvenanceFixture): ProvenancePayload {
  try {
    const stdout = execFileSync(process.execPath, [
      provenanceScript,
      `--project-root=${fixture.root}`,
      "--ledger=release-ledger.yaml",
      "--artifact-manifest=artifacts/release-evidence/manifest.json",
      "--strict",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(stdout) as ProvenancePayload;
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
    return JSON.parse(stdout) as ProvenancePayload;
  }
}

test("root verify delegates to each deterministic verification stage in order", () => {
  assert.equal(packageJson.scripts.verify, "pnpm verify:app && pnpm verify:workspaces && pnpm verify:cloudflare");
});

test("application verification runs lint typecheck root tests and production build", () => {
  assert.equal(packageJson.scripts["verify:app"], "pnpm lint && pnpm typecheck && pnpm test && pnpm build");
});

test("release provenance command is strict by default", () => {
  assert.equal(
    packageJson.scripts["release:provenance"],
    "node scripts/release-candidate-provenance.mjs --strict",
  );
});

test("release evidence prepare command creates a candidate-bound SHA-256 manifest", () => {
  assert.equal(packageJson.scripts["release:evidence:prepare"], "node scripts/release-evidence-prepare.mjs");
  const fixture = createProvenanceFixture();
  try {
    rmSync(fixture.manifestPath);
    const output = execFileSync(process.execPath, [
      evidencePrepareScript,
      `--project-root=${fixture.root}`,
      "--artifact=artifacts/release-evidence/verification.json",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const payload = JSON.parse(output) as { ok: boolean; artifactCount: number; manifestPath: string };
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")) as {
      schemaVersion: number;
      gitSha: string;
      branch: string;
      generatedAt: string;
      artifacts: Array<{ path: string; sha256: string }>;
    };

    assert.equal(payload.ok, true);
    assert.equal(payload.artifactCount, 1);
    assert.equal(payload.manifestPath, "artifacts/release-evidence/manifest.json");
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.gitSha, fixture.candidateSha);
    assert.equal(manifest.branch, fixture.branch);
    assert.equal(new Date(manifest.generatedAt).toISOString(), manifest.generatedAt);
    assert.deepEqual(manifest.artifacts, [{
      path: "artifacts/release-evidence/verification.json",
      sha256: sha256File(fixture.artifactPath),
    }]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("release evidence prepare rejects paths outside the evidence directory", () => {
  const fixture = createProvenanceFixture();
  try {
    assert.throws(
      () => execFileSync(process.execPath, [
        evidencePrepareScript,
        `--project-root=${fixture.root}`,
        "--artifact=src/app.ts",
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      (error: unknown) => {
        const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout) : "";
        const payload = JSON.parse(stdout) as { ok: boolean; errors: string[] };
        return payload.ok === false && payload.errors.includes("Every artifact must be a unique file under artifacts/release-evidence/.");
      },
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("release candidate provenance accepts a clean evidence-only commit after the candidate source", () => {
  const fixture = createProvenanceFixture();
  try {
    const payload = inspectProvenance(fixture);

    assert.equal(payload.ok, true);
    assert.equal(payload.state, "verified-candidate-provenance");
    assert.deepEqual(payload.blockers, []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("release candidate provenance rejects a nonexistent candidate commit", () => {
  const fixture = createProvenanceFixture();
  try {
    writeCandidateLedger(fixture, { gitSha: "f".repeat(40) });
    runGit(fixture.root, "add", "release-ledger.yaml");
    runGit(fixture.root, "commit", "-m", "break candidate sha");
    const payload = inspectProvenance(fixture);

    assert.equal(payload.ok, false);
    assert.ok(payload.blockers.includes("release_harness.candidate.git_sha"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("release candidate provenance rejects source changes after the candidate commit", () => {
  const fixture = createProvenanceFixture();
  try {
    writeFileSync(join(fixture.root, "src", "app.ts"), "export const version = 2;\n", "utf8");
    runGit(fixture.root, "add", "src/app.ts");
    runGit(fixture.root, "commit", "-m", "change source after verification");
    const payload = inspectProvenance(fixture);

    assert.equal(payload.ok, false);
    assert.ok(payload.blockers.includes("release_harness.candidate.post_candidate_source_changes"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("release candidate provenance rejects branch mismatch and a dirty worktree", () => {
  const fixture = createProvenanceFixture();
  try {
    writeCandidateLedger(fixture, { branch: "codex/other-branch" });
    runGit(fixture.root, "add", "release-ledger.yaml");
    runGit(fixture.root, "commit", "-m", "break candidate branch");
    writeFileSync(join(fixture.root, "untracked.txt"), "dirty\n", "utf8");
    const payload = inspectProvenance(fixture);

    assert.equal(payload.ok, false);
    assert.ok(payload.blockers.includes("release_harness.candidate.branch"));
    assert.ok(payload.blockers.includes("release_harness.candidate.dirty_state"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("release candidate provenance rejects a tampered artifact", () => {
  const fixture = createProvenanceFixture();
  try {
    writeFileSync(fixture.artifactPath, '{"tests":{"passed":0,"failed":1}}\n', "utf8");
    const payload = inspectProvenance(fixture);

    assert.equal(payload.ok, false);
    assert.ok(payload.blockers.includes("release_harness.artifact.verification.json.sha256"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("release candidate provenance rejects artifact paths outside the evidence root", () => {
  const fixture = createProvenanceFixture();
  try {
    writeArtifactManifest(fixture, { path: "../outside.json" });
    const payload = inspectProvenance(fixture);

    assert.equal(payload.ok, false);
    assert.ok(payload.blockers.includes("release_harness.artifact_manifest.paths"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("workspace verification covers the mobile app and WebView shell", () => {
  assert.equal(
    packageJson.scripts["verify:workspaces"],
    "pnpm --dir apps/mobile verify && pnpm --dir apps/webview check",
  );
});

test("Cloudflare verification performs only staging and production dry runs", () => {
  assert.equal(
    packageJson.scripts["verify:cloudflare"],
    "pnpm cf:web:dry-run:staging && pnpm cf:web:dry-run:production && pnpm cf:dry-run:staging && pnpm cf:dry-run:production",
  );
  assert.doesNotMatch(packageJson.scripts["verify:cloudflare"], /(^|\s)pnpm\s+cf:deploy(?:\s|$)/);
  assert.doesNotMatch(packageJson.scripts["verify:cloudflare"], /release:gate|smoke:staging|cf:external-state/);
});

test("CI installs the lockfile exactly and runs the root verification gate", () => {
  const workflow = readCiWorkflow();

  assert.match(workflow, /permissions:\s*\n\s+contents:\s+read/);
  assert.match(workflow, /pnpm\/action-setup@v4/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm --dir apps\/mobile install --frozen-lockfile/);
  assert.match(workflow, /pnpm --dir apps\/webview install --frozen-lockfile/);
  assert.match(workflow, /pnpm verify/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
});

test("CI installs and requires SQLite so D1 coverage cannot silently skip", () => {
  const workflow = readCiWorkflow();
  const cloudflareApiTests = readFileSync(new URL("./cloudflare-api.test.ts", import.meta.url), "utf8");

  assert.match(workflow, /SILSIGAN_REQUIRE_SQLITE_TESTS:\s*["']?1["']?/);
  assert.match(workflow, /apt-get install[^\n]*sqlite3/);
  assert.match(workflow, /sqlite3 --version/);
  assert.match(cloudflareApiTests, /process\.env\.SILSIGAN_REQUIRE_SQLITE_TESTS === "1"/);
  assert.match(cloudflareApiTests, /throw new Error\("SQLite is required/);
});

test("CI builds the Android shell with JDK 21 instead of stopping at JavaScript syntax", () => {
  const workflow = readCiWorkflow();

  assert.match(workflow, /android:\s*\n\s+runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /uses:\s*actions\/setup-java@v4/);
  assert.match(workflow, /java-version:\s*["']?21["']?/);
  assert.match(workflow, /uses:\s*gradle\/actions\/setup-gradle@v4/);
  assert.match(workflow, /working-directory:\s*apps\/webview\/android/);
  assert.match(workflow, /\.\/gradlew :app:lintDebug :app:assembleDebug --no-daemon/);
});

test("CI uploads verification evidence only after a failure", () => {
  const workflow = readCiWorkflow();
  const uploadStepStart = workflow.indexOf("- name: Upload failure evidence");
  const uploadStep = workflow.slice(uploadStepStart);

  assert.notEqual(uploadStepStart, -1, "CI must define an upload-artifact step");
  assert.match(uploadStep, /if:\s*failure\(\)/);
  assert.match(uploadStep, /uses:\s*actions\/upload-artifact@v4/);
  assert.match(uploadStep, /path:\s*\.ci-artifacts\/verify\.log/);
});

test("browser smoke recognizes the current read-only photo view label", () => {
  const pagesSmoke = readPagesSmoke();

  assert.match(pagesSmoke, /label\.includes\('사진 보기\.'\)/);
  assert.match(pagesSmoke, /label\.endsWith\('사진 확인'\)/);
});

test("browser smoke force-cleans a headless browser that keeps realtime sockets open", () => {
  const pagesSmoke = readPagesSmoke();

  assert.match(pagesSmoke, /const exitedAfterTerm = await waitForChildExit\(child, 2_000\)/);
  assert.match(pagesSmoke, /if \(!exitedAfterTerm\) \{\s*child\.kill\("SIGKILL"\)/);
});

test("browser smoke atomically activates the visible owned-photo delete control", () => {
  const pagesSmoke = readPagesSmoke();

  assert.match(
    pagesSmoke,
    /async function clickFirstPhotoDelete[\s\S]*document\.elementFromPoint[\s\S]*button\.click\(\)/,
  );
});

test("browser smoke verifies the traffic guard in static directory mode", () => {
  const source = readPagesSmoke();

  assert.match(source, /const directoryMode = Boolean/);
  assert.match(source, /button\.disabled/);
  assert.match(source, /교통 연결 중단/);
  assert.match(source, /정적 디렉터리 모드에서는 외부 교통 연결이 비활성 상태로 유지됩니다/);
  assert.match(source, /실시간 연결을 다시 확인했지만 보호 모드를 유지합니다\. 기본 장소 위치만 표시합니다/);
  assert.match(source, /정적 디렉터리에서 최신 근거 없는 장소를 가짜 TOP 10으로 만들지 않았습니다/);
});

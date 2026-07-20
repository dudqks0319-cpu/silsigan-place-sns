#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, posix, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LEDGER_PATH = "release-ledger.yaml";
const DEFAULT_ARTIFACT_MANIFEST_PATH = "artifacts/release-evidence/manifest.json";
const EVIDENCE_DIRECTORY = "artifacts/release-evidence/";
const EVIDENCE_ONLY_FILES = new Set([
  "release-ledger.yaml",
  "RELEASE_STATUS.md",
  "docs/current-release-state.md",
]);
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const ARTIFACT_SHA_PATTERN = /^[a-f0-9]{64}$/;

if (isCliEntryPoint()) {
  await main();
}

export async function inspectReleaseCandidateProvenance({
  projectRoot = process.cwd(),
  ledgerPath = DEFAULT_LEDGER_PATH,
  artifactManifestPath = DEFAULT_ARTIFACT_MANIFEST_PATH,
} = {}) {
  const checks = [];
  const record = (name, status, message, details = {}) => {
    checks.push({ name, status, message, ...details });
  };

  let root;
  try {
    root = await realpath(resolve(projectRoot));
    record("release_harness.project_root", "pass", "Release candidate project root is available.");
  } catch {
    record("release_harness.project_root", "fail", "Release candidate project root is unavailable.");
    return summarize(checks);
  }

  let normalizedLedgerPath;
  let normalizedManifestPath;
  try {
    normalizedLedgerPath = normalizeProjectPath(ledgerPath);
    normalizedManifestPath = normalizeProjectPath(artifactManifestPath);
  } catch {
    record("release_harness.paths", "fail", "Release provenance paths must be normalized project-relative paths.");
    return summarize(checks);
  }

  let ledger = "";
  try {
    ledger = await readFile(resolveInside(root, normalizedLedgerPath), "utf8");
    record("release_harness.candidate.ledger", "pass", "Release candidate ledger is readable.");
  } catch {
    record("release_harness.candidate.ledger", "fail", "Release candidate ledger is unavailable.");
  }

  const candidate = parseCandidate(ledger);
  const gitContext = await readGitContext(root);
  if (!gitContext.ok) {
    record("release_harness.candidate.git_repository", "fail", "Release candidate provenance requires a readable Git repository.");
    return summarize(checks, candidate);
  }

  const shaIsWellFormed = COMMIT_SHA_PATTERN.test(candidate.gitSha);
  let shaExists = false;
  let shaIsAncestor = false;
  if (shaIsWellFormed) {
    shaExists = await gitSucceeds(root, ["cat-file", "-e", `${candidate.gitSha}^{commit}`]);
    shaIsAncestor = shaExists && await gitSucceeds(root, ["merge-base", "--is-ancestor", candidate.gitSha, gitContext.headSha]);
  }
  record(
    "release_harness.candidate.git_sha",
    shaIsWellFormed && shaExists && shaIsAncestor ? "pass" : "fail",
    shaIsWellFormed && shaExists && shaIsAncestor
      ? "Candidate git_sha is an existing ancestor commit of HEAD."
      : "Candidate git_sha must be a 40-character commit that is an ancestor of HEAD.",
    { candidateSha: publicSha(candidate.gitSha), headSha: publicSha(gitContext.headSha) },
  );

  const branchMatches = candidate.branch.length > 0
    && gitContext.branch.length > 0
    && candidate.branch === gitContext.branch;
  record(
    "release_harness.candidate.branch",
    branchMatches ? "pass" : "fail",
    branchMatches
      ? "Candidate branch matches the checked-out branch."
      : "Candidate branch must match a non-detached checked-out branch.",
    { candidateBranch: publicBranch(candidate.branch), checkedOutBranch: publicBranch(gitContext.branch) },
  );

  const declaredClean = candidate.dirtyState === "clean";
  const worktreeClean = gitContext.dirtyEntryCount === 0;
  record(
    "release_harness.candidate.dirty_state",
    declaredClean && worktreeClean ? "pass" : "fail",
    declaredClean && worktreeClean
      ? "Candidate ledger declares clean and the Git worktree is clean."
      : "Release candidate provenance requires dirty_state=clean and an actually clean worktree.",
    { declaredDirtyState: publicDirtyState(candidate.dirtyState), dirtyEntryCount: gitContext.dirtyEntryCount },
  );

  if (shaIsWellFormed && shaExists && shaIsAncestor) {
    const changedPaths = await gitChangedPaths(root, candidate.gitSha, gitContext.headSha);
    const unexpectedPaths = changedPaths.filter((path) => !isEvidenceOnlyPath(path, normalizedLedgerPath, normalizedManifestPath));
    record(
      "release_harness.candidate.post_candidate_source_changes",
      unexpectedPaths.length === 0 ? "pass" : "fail",
      unexpectedPaths.length === 0
        ? "Commits after the candidate contain release evidence only."
        : "Application source or configuration changed after the candidate commit.",
      { changedPathCount: changedPaths.length, unexpectedPaths: unexpectedPaths.slice(0, 20) },
    );
  }

  await checkArtifactManifest({
    root,
    candidate,
    manifestPath: normalizedManifestPath,
    record,
  });

  return summarize(checks, candidate, gitContext);
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  const result = await inspectReleaseCandidateProvenance({
    projectRoot: options.get("project-root") ?? process.cwd(),
    ledgerPath: options.get("ledger") ?? DEFAULT_LEDGER_PATH,
    artifactManifestPath: options.get("artifact-manifest") ?? DEFAULT_ARTIFACT_MANIFEST_PATH,
  });
  console.log(JSON.stringify(result, null, 2));
  if (flags.has("strict") && !result.ok) {
    process.exitCode = 1;
  }
}

async function readGitContext(root) {
  try {
    const headSha = await runGit(root, ["rev-parse", "HEAD"]);
    const branch = await runGit(root, ["branch", "--show-current"]);
    const dirtyOutput = await runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const dirtyEntryCount = dirtyOutput.length === 0 ? 0 : dirtyOutput.split("\n").filter(Boolean).length;
    return { ok: true, headSha, branch, dirtyEntryCount };
  } catch {
    return { ok: false, headSha: "", branch: "", dirtyEntryCount: 0 };
  }
}

async function gitChangedPaths(root, candidateSha, headSha) {
  if (candidateSha === headSha) {
    return [];
  }
  const output = await runGit(root, ["diff", "--name-only", "-z", "--diff-filter=ACDMRTUXB", `${candidateSha}..${headSha}`, "--"]);
  return output.split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
}

async function runGit(root, args) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    throw new Error("Git command failed.");
  }
}

async function gitSucceeds(root, args) {
  try {
    await execFileAsync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function checkArtifactManifest({ root, candidate, manifestPath, record }) {
  let manifest;
  try {
    const manifestFile = resolveInside(root, manifestPath);
    const stats = await lstat(manifestFile);
    if (!stats.isFile()) {
      throw new Error("Manifest must be a regular file.");
    }
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch {
    record("release_harness.artifact_manifest", "fail", "Release artifact manifest is missing or invalid.");
    return;
  }

  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const headerValid = manifest?.schemaVersion === 1
    && manifest?.gitSha === candidate.gitSha
    && manifest?.branch === candidate.branch
    && typeof manifest?.generatedAt === "string"
    && isCanonicalIsoTimestamp(manifest.generatedAt)
    && artifacts.length > 0;
  record(
    "release_harness.artifact_manifest",
    headerValid ? "pass" : "fail",
    headerValid
      ? "Release artifact manifest matches the candidate source and branch."
      : "Release artifact manifest must match candidate SHA/branch and contain a timestamped non-empty artifact list.",
    { artifactCount: artifacts.length },
  );

  const normalizedEntries = [];
  const seenPaths = new Set();
  let pathsValid = artifacts.length > 0;
  for (const artifact of artifacts) {
    try {
      const path = normalizeProjectPath(artifact?.path);
      if (!path.startsWith(EVIDENCE_DIRECTORY) || path === manifestPath || seenPaths.has(path)) {
        pathsValid = false;
        continue;
      }
      seenPaths.add(path);
      normalizedEntries.push({ path, sha256: artifact?.sha256 });
    } catch {
      pathsValid = false;
    }
  }
  if (normalizedEntries.length !== artifacts.length) {
    pathsValid = false;
  }
  record(
    "release_harness.artifact_manifest.paths",
    pathsValid ? "pass" : "fail",
    pathsValid
      ? "Artifact paths are unique normalized files under artifacts/release-evidence."
      : "Artifact paths must be unique normalized project-relative files under artifacts/release-evidence.",
  );

  for (const artifact of normalizedEntries) {
    const checkName = `release_harness.artifact.${safeCheckSegment(basename(artifact.path))}.sha256`;
    let actualSha = "";
    let fileValid = false;
    try {
      const absolutePath = resolveInside(root, artifact.path);
      const stats = await lstat(absolutePath);
      const resolvedArtifactPath = await realpath(absolutePath);
      fileValid = stats.isFile() && isInsideRoot(root, resolvedArtifactPath);
      if (fileValid) {
        actualSha = await hashFile(absolutePath);
      }
    } catch {
      fileValid = false;
    }
    const hashValid = typeof artifact.sha256 === "string"
      && ARTIFACT_SHA_PATTERN.test(artifact.sha256)
      && actualSha === artifact.sha256;
    record(
      checkName,
      fileValid && hashValid ? "pass" : "fail",
      fileValid && hashValid
        ? "Artifact is a regular in-project file with the declared SHA-256."
        : "Artifact file must exist inside the project and match its declared SHA-256.",
    );
  }
}

function parseCandidate(ledger) {
  const block = ledger.match(/^candidate:\s*\n((?:[ \t]+[^\n]*(?:\n|$))*)/m)?.[1] ?? "";
  return {
    gitSha: yamlScalar(block, "git_sha"),
    branch: yamlScalar(block, "branch"),
    dirtyState: yamlScalar(block, "dirty_state"),
  };
}

function yamlScalar(block, field) {
  const match = block.match(new RegExp(`^ {2}${field}:\\s*(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([^\\s#]+))\\s*(?:#.*)?$`, "m"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function normalizeProjectPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\") || isAbsolute(value)) {
    throw new Error("Unsafe path.");
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Unsafe path.");
  }
  return normalized;
}

function resolveInside(root, projectPath) {
  const absolutePath = resolve(root, projectPath);
  if (!isInsideRoot(root, absolutePath)) {
    throw new Error("Path escapes project root.");
  }
  return absolutePath;
}

function isInsideRoot(root, absolutePath) {
  const pathFromRoot = relative(root, absolutePath);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function isEvidenceOnlyPath(path, ledgerPath, manifestPath) {
  return path === ledgerPath
    || path === manifestPath
    || EVIDENCE_ONLY_FILES.has(path)
    || path.startsWith(EVIDENCE_DIRECTORY);
}

function isCanonicalIsoTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function hashFile(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", rejectHash);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function summarize(checks, candidate = {}, gitContext = {}) {
  const blockers = checks.filter((check) => check.status === "fail").map((check) => check.name);
  return {
    ok: blockers.length === 0,
    state: blockers.length === 0 ? "verified-candidate-provenance" : "blocked-provenance",
    candidateSha: publicSha(candidate.gitSha),
    headSha: publicSha(gitContext.headSha),
    branch: publicBranch(gitContext.branch),
    checks,
    blockers,
  };
}

function publicSha(value) {
  return typeof value === "string" && COMMIT_SHA_PATTERN.test(value) ? value : "invalid-or-missing";
}

function publicBranch(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : "invalid-or-missing";
}

function publicDirtyState(value) {
  return value === "clean" || value === "dirty" ? value : "invalid-or-missing";
}

function safeCheckSegment(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

function parseArgs(rawArgs) {
  const flags = new Set();
  const options = new Map();
  for (let index = 0; index < rawArgs.length; index += 1) {
    const rawArg = rawArgs[index];
    if (!rawArg.startsWith("--")) continue;
    const arg = rawArg.slice(2);
    const separatorIndex = arg.indexOf("=");
    if (separatorIndex !== -1) {
      options.set(arg.slice(0, separatorIndex), arg.slice(separatorIndex + 1));
      continue;
    }
    const nextArg = rawArgs[index + 1];
    if (nextArg && !nextArg.startsWith("--")) {
      options.set(arg, nextArg);
      index += 1;
    } else {
      flags.add(arg);
    }
  }
  return { flags, options };
}

function isCliEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

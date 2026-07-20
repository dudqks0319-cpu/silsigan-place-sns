#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve } from "node:path";

const DEFAULT_LEDGER_PATH = "release-ledger.yaml";
const DEFAULT_MANIFEST_PATH = "artifacts/release-evidence/manifest.json";
const EVIDENCE_DIRECTORY = "artifacts/release-evidence/";
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;

const { options, artifacts } = parseArgs(process.argv.slice(2));

try {
  const projectRoot = await realpath(resolve(options.get("project-root") ?? process.cwd()));
  const ledgerPath = normalizeProjectPath(options.get("ledger") ?? DEFAULT_LEDGER_PATH);
  const manifestPath = normalizeProjectPath(options.get("manifest") ?? DEFAULT_MANIFEST_PATH);
  const ledger = await readFile(resolveInside(projectRoot, ledgerPath), "utf8");
  const candidate = parseCandidate(ledger);

  if (!COMMIT_SHA_PATTERN.test(candidate.gitSha) || !candidate.branch || candidate.branch.length > 200) {
    throw new Error("release-ledger.yaml must contain a full candidate git_sha and branch.");
  }
  if (artifacts.length === 0) {
    throw new Error("At least one --artifact path is required.");
  }

  const normalizedArtifacts = artifacts.map(normalizeProjectPath);
  const uniqueArtifacts = new Set(normalizedArtifacts);
  if (
    uniqueArtifacts.size !== normalizedArtifacts.length
    || normalizedArtifacts.some((path) => !path.startsWith(EVIDENCE_DIRECTORY) || path === manifestPath)
  ) {
    throw new Error("Every artifact must be a unique file under artifacts/release-evidence/.");
  }

  const manifestArtifacts = [];
  for (const path of normalizedArtifacts.sort()) {
    const absolutePath = resolveInside(projectRoot, path);
    const stats = await lstat(absolutePath);
    const resolvedPath = await realpath(absolutePath);
    if (!stats.isFile() || !isInsideRoot(projectRoot, resolvedPath)) {
      throw new Error("Every artifact must be a regular in-project file.");
    }
    manifestArtifacts.push({ path, sha256: await hashFile(absolutePath) });
  }

  const manifest = {
    schemaVersion: 1,
    gitSha: candidate.gitSha,
    branch: candidate.branch,
    generatedAt: new Date().toISOString(),
    artifacts: manifestArtifacts,
  };
  const absoluteManifestPath = resolveInside(projectRoot, manifestPath);
  await mkdir(dirname(absoluteManifestPath), { recursive: true });
  await atomicWriteJson(absoluteManifestPath, manifest);

  console.log(JSON.stringify({
    ok: true,
    manifestPath,
    artifactCount: manifestArtifacts.length,
    candidateSha: candidate.gitSha,
    branch: candidate.branch,
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Release evidence manifest preparation failed.";
  console.log(JSON.stringify({ ok: false, errors: [message] }, null, 2));
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = new Map();
  const artifacts = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const equalsIndex = argument.indexOf("=");
    const key = argument.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    let value = equalsIndex === -1 ? args[index + 1] : argument.slice(equalsIndex + 1);
    if (equalsIndex === -1) {
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}.`);
      }
      index += 1;
    }
    if (key === "artifact") {
      artifacts.push(value);
    } else if (["project-root", "ledger", "manifest"].includes(key)) {
      options.set(key, value);
    } else {
      throw new Error(`Unknown option: --${key}.`);
    }
  }
  return { options, artifacts };
}

function parseCandidate(ledger) {
  const block = ledger.match(/^candidate:\s*\n((?:[ \t]+[^\n]*(?:\n|$))*)/m)?.[1] ?? "";
  return {
    gitSha: yamlScalar(block, "git_sha"),
    branch: yamlScalar(block, "branch"),
  };
}

function yamlScalar(block, field) {
  const match = block.match(new RegExp(`^ {2}${field}:\\s*(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([^\\s#]+))\\s*(?:#.*)?$`, "m"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function normalizeProjectPath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\") || isAbsolute(value)) {
    throw new Error("Artifact paths must be normalized project-relative paths.");
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Artifact paths must be normalized project-relative paths.");
  }
  return normalized;
}

function resolveInside(root, projectPath) {
  const absolutePath = resolve(root, projectPath);
  if (!isInsideRoot(root, absolutePath)) {
    throw new Error("Artifact path escapes the project root.");
  }
  return absolutePath;
}

function isInsideRoot(root, absolutePath) {
  const pathFromRoot = relative(root, absolutePath);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
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

async function atomicWriteJson(path, value) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

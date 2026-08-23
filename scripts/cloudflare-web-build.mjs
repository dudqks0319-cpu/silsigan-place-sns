#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripServerSecretsFromBuildEnv } from "./build-env-policy.mjs";
import { scanBuildForEnvValues } from "./scan-build-env-secrets.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const PUBLIC_BUILD_KEYS = new Set([
  "SILSIGAN_STAGING_API_BASE_URL",
  "NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL",
  "NEXT_PUBLIC_SITE_URL",
]);
const ROOT_BUILD_EXCLUDES = new Set([
  ".git",
  ".next",
  ".open-next",
  ".omx",
  ".worktrees",
  "artifacts",
  "node_modules",
]);
const WEB_BUILD_INPUTS = [
  "src",
  "packages",
  "public",
  "package.json",
  "pnpm-lock.yaml",
  "next.config.ts",
  "open-next.config.ts",
  "wrangler.jsonc",
  "tsconfig.json",
  "next-env.d.ts",
  "scripts/build-env-policy.d.mts",
  "scripts/build-env-policy.mjs",
  "scripts/cloudflare-web-build.d.mts",
  "scripts/cloudflare-web-build.mjs",
  "scripts/cloudflare-web-deploy.d.mts",
  "scripts/cloudflare-web-deploy.mjs",
  "scripts/scan-build-env-secrets.mjs",
];

if (isCliEntryPoint()) {
  try {
    const environment = parseEnvironmentArgument(process.argv.slice(2));
    const result = await buildCloudflareWeb({ environment });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: publicErrorMessage(error) }, null, 2));
    process.exitCode = 1;
  }
}

export async function buildCloudflareWeb({ environment = "staging", root = projectRoot } = {}) {
  const configSource = await readFile(join(root, "wrangler.jsonc"), "utf8");
  const publicBuildEnv = parseBuildEnv(configSource, environment);
  const buildInputDigest = await computeWebBuildInputDigest(root);
  const buildId = `silsigan-${buildInputDigest.slice(0, 32)}`;
  // Keep the isolated source beside node_modules. Next's output tracer follows
  // the node_modules symlink and cannot safely cross macOS /private/var -> /Users.
  const tempRoot = join(dirname(root), `.silsigan-cloudflare-web-build-${buildInputDigest.slice(0, 16)}`);
  const tempProject = join(tempRoot, "project");
  const envLocalPath = join(root, ".env.local");

  try {
    await mkdir(tempRoot);
    await cp(root, tempProject, {
      recursive: true,
      filter: (source) => shouldCopyBuildSource(source, root),
    });
    await symlink(join(root, "node_modules"), join(tempProject, "node_modules"), "dir");

    const buildProcessEnv = { ...process.env, ...publicBuildEnv, SILSIGAN_WEB_BUILD_ID: buildId };
    const strippedSecretKeys = stripServerSecretsFromBuildEnv(buildProcessEnv);
    Object.assign(buildProcessEnv, publicBuildEnv);

    await runCommand("pnpm", ["exec", "opennextjs-cloudflare", "build"], {
      cwd: tempProject,
      env: buildProcessEnv,
    });

    const middlewareManifestPatch = await patchOpenNextMiddlewareManifest(
      join(tempProject, ".open-next", "server-functions", "default", "handler.mjs"),
    );

    let secretScan = {
      ok: true,
      scannedFiles: 0,
      checkedSecretKeys: [],
      matchedSecretKeys: [],
      skipped: "no .env.local file",
    };
    if (await pathExists(envLocalPath)) {
      secretScan = await scanBuildForEnvValues(envLocalPath, join(tempProject, ".open-next"));
      if (!secretScan.ok) {
        throw new Error(`Cloudflare build contains local secret values for keys: ${secretScan.matchedSecretKeys.join(", ")}`);
      }
    }

    const workerSha256 = await computeFileDigest(join(tempProject, ".open-next", "worker.js"));
    const assets = await computeDirectoryDigest(join(tempProject, ".open-next", "assets"));

    await replaceGeneratedDirectory(join(tempProject, ".next"), join(root, ".next"));
    await replaceGeneratedDirectory(join(tempProject, ".open-next"), join(root, ".open-next"));

    return {
      ok: true,
      environment,
      buildInputDigest,
      buildId,
      publicBuildKeys: Object.keys(publicBuildEnv).sort(),
      strippedSecretKeys,
      middlewareManifestPatch,
      secretScan,
      workerSha256,
      assetSetDigest: assets.digest,
      assetCount: assets.fileCount,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function patchOpenNextMiddlewareManifest(path) {
  const source = await readFile(path, "utf8");
  const result = patchOpenNextMiddlewareManifestSource(source);
  if (result.status === "patched") {
    await writeFile(path, result.source);
  }
  return { status: result.status };
}

export function patchOpenNextMiddlewareManifestSource(source) {
  const unsafeImplementation = "getMiddlewareManifest(){return this.minimalMode?null:require(this.middlewareManifestPath)}";
  const safeImplementation = "getMiddlewareManifest(){return null}";
  const unsafeCount = source.split(unsafeImplementation).length - 1;
  const safeCount = source.split(safeImplementation).length - 1;

  if (unsafeCount === 0 && safeCount > 0 && !source.includes("require(this.middlewareManifestPath)")) {
    return { source, status: "already-safe" };
  }
  if (unsafeCount !== 1) {
    throw new Error(`OpenNext middleware manifest guard expected one unsafe runtime implementation, found ${unsafeCount}.`);
  }

  const patchedSource = source.replace(unsafeImplementation, safeImplementation);
  if (patchedSource.includes("require(this.middlewareManifestPath)")) {
    throw new Error("OpenNext middleware manifest guard could not remove the dynamic manifest require.");
  }
  return { source: patchedSource, status: "patched" };
}

export function parseEnvironmentArgument(args) {
  const argument = args.find((value) => value.startsWith("--env="));
  const environment = argument ? argument.slice("--env=".length) : "staging";
  if (!new Set(["staging", "production"]).has(environment)) {
    throw new Error("Cloudflare web build environment must be staging or production.");
  }
  return environment;
}

export function parseBuildEnv(configSource, environment = "staging") {
  const config = JSON.parse(configSource);
  const vars = config?.env?.[environment]?.vars;
  if (!vars || typeof vars !== "object" || Array.isArray(vars)) {
    throw new Error(`Cloudflare ${environment} public build vars are not configured.`);
  }

  const unexpectedKeys = Object.keys(vars).filter((key) => !PUBLIC_BUILD_KEYS.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`Cloudflare ${environment} build vars contain non-public keys: ${unexpectedKeys.sort().join(", ")}`);
  }

  const apiUrl = requireHttpsUrl(vars.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL, "NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL");
  const siteUrl = requireHttpsUrl(vars.NEXT_PUBLIC_SITE_URL, "NEXT_PUBLIC_SITE_URL");
  const result = {
    NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL: apiUrl,
    NEXT_PUBLIC_SITE_URL: siteUrl,
  };

  if (environment === "staging") {
    const stagingApiUrl = requireHttpsUrl(vars.SILSIGAN_STAGING_API_BASE_URL, "SILSIGAN_STAGING_API_BASE_URL");
    if (stagingApiUrl !== apiUrl) {
      throw new Error("Staging API build vars must use the same exact origin.");
    }
    result.SILSIGAN_STAGING_API_BASE_URL = stagingApiUrl;
  }

  return result;
}

export function shouldCopyBuildSource(sourcePath, root = projectRoot) {
  const relativePath = relative(root, sourcePath);
  if (!relativePath) return true;
  if (relativePath.startsWith(`..${sep}`) || relativePath === "..") return false;

  const segments = relativePath.split(sep);
  if (ROOT_BUILD_EXCLUDES.has(segments[0])) return false;
  if (segments[0].startsWith(".next.") || segments[0].startsWith(".open-next.")) return false;
  if (basename(sourcePath).startsWith(".env")) return false;
  if (segments[0] === "apps" && segments[1] === "webview" && new Set(["android", "ios"]).has(segments[2])) return false;
  return true;
}

export async function computeWebBuildInputDigest(root = projectRoot) {
  const files = [];
  for (const input of WEB_BUILD_INPUTS) {
    const absolutePath = join(root, input);
    if (!(await pathExists(absolutePath))) {
      throw new Error(`Required Cloudflare web build input is missing: ${input}`);
    }
    files.push(...(await listInputFiles(absolutePath)));
  }

  const hash = createHash("sha256");
  for (const file of files.sort()) {
    const relativePath = relative(root, file).split(sep).join("/");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function computeDirectoryDigest(root) {
  const files = (await listInputFiles(root)).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const relativePath = relative(root, file).split(sep).join("/");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return { digest: hash.digest("hex"), fileCount: files.length };
}

async function replaceGeneratedDirectory(source, destination) {
  const stagedDestination = `${destination}.safe-build-${process.pid}`;
  try {
    await rm(stagedDestination, { recursive: true, force: true });
    await cp(source, stagedDestination, { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await rename(stagedDestination, destination);
  } catch (error) {
    await rm(stagedDestination, { recursive: true, force: true });
    throw error;
  }
}

async function listInputFiles(path) {
  const details = await stat(path);
  if (details.isFile()) return [path];
  if (!details.isDirectory()) return [];

  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listInputFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function computeFileDigest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function runCommand(command, args, options) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
    });
  });
}

function requireHttpsUrl(value, key) {
  if (typeof value !== "string") throw new Error(`${key} is missing.`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${key} must be a credential-free HTTPS origin.`);
  }
  return url.origin;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function publicErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isCliEntryPoint() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

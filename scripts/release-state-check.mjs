#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";

const DEFAULT_CONFIG_PATH = "workers/api/wrangler.jsonc";
const DEFAULT_FRONTEND_CONFIG_PATH = "wrangler.jsonc";
const DEFAULT_LEDGER_PATH = "docs/current-release-state.md";
const DEFAULT_RELEASE_LEDGER_PATH = "release-ledger.yaml";
const DEFAULT_RELEASE_STATUS_PATH = "RELEASE_STATUS.md";
const MINIMUM_OPEN_NEXT_COMPATIBILITY_DATE = "2024-09-23";
const REQUIRED_LEDGER_SECTIONS = [
  "## Objective",
  "## Local Code State",
  "## Latest Local Verification",
  "## Cloudflare External State",
  "## Release Decision",
  "## Next Actions",
];
const REQUIRED_RELEASE_LEDGER_FIELDS = [
  "project",
  "candidate",
  "local_checks",
  "runtime_checks",
  "external_checks",
  "security",
  "blockers",
  "next_action",
];
const REQUIRED_RELEASE_STATUS_SECTIONS = ["# Release Status", "## 한 줄 상태", "## 현재 후보", "## 막힌 항목", "## 다음 행동"];
const REQUIRED_ENV_URLS = {
  SILSIGAN_STAGING_PAGES_URL: "staging.pages",
  SILSIGAN_STAGING_API_BASE_URL: "staging.worker_api",
  SILSIGAN_PRODUCTION_PAGES_URL: "production.pages",
  SILSIGAN_PRODUCTION_API_BASE_URL: "production.worker_api",
};
const LEGACY_RUNTIME_URL_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.staging",
  ".env.staging.local",
  ".env.production",
  ".env.production.local",
  ".env.example",
  "src/lib/site-url.ts",
  "src/lib/domain.ts",
  "src/components/silsigan/SilsiganRedesign.tsx",
  "src/app/share/post/[postId]/page.tsx",
];
const LEGACY_VERCEL_HOST_PATTERN = /\bhttps?:\/\/[^\s"'`<>]*vercel\.app[^\s"'`<>]*/i;

const { flags, options } = parseArgs(process.argv.slice(2));
const configPath = options.get("config") ?? DEFAULT_CONFIG_PATH;
const frontendConfigPath = options.get("frontend-config") ?? DEFAULT_FRONTEND_CONFIG_PATH;
const ledgerPath = options.get("ledger") ?? DEFAULT_LEDGER_PATH;
const releaseLedgerPath = options.get("release-ledger") ?? DEFAULT_RELEASE_LEDGER_PATH;
const releaseStatusPath = options.get("release-status") ?? DEFAULT_RELEASE_STATUS_PATH;
const strict = flags.has("strict");
const checks = [];

await checkLedger(ledgerPath);
await checkReleaseHarnessFiles(releaseLedgerPath, releaseStatusPath, ledgerPath);
await checkLegacyArtifacts();
await checkLegacyRuntimeUrls();
await checkOpenNextAdapter();
await checkFrontendWranglerConfig(frontendConfigPath);
await checkWranglerConfig(configPath);
checkDeploymentUrls();

const blockers = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");
const summary = {
  ok: blockers.length === 0,
  state: blockers.length === 0 ? "ready-for-staging-evidence" : "blocked-external",
  configPath,
  frontendConfigPath,
  ledgerPath,
  releaseLedgerPath,
  releaseStatusPath,
  checks,
  blockers: blockers.map((check) => check.name),
  warnings: warnings.map((check) => check.name),
};

console.log(JSON.stringify(summary, null, 2));

if (strict && blockers.length > 0) {
  process.exitCode = 1;
}

async function checkLedger(path) {
  try {
    const ledger = await readFile(path, "utf8");
    for (const section of REQUIRED_LEDGER_SECTIONS) {
      record(`ledger.${section.replace(/^##\s+/, "").toLowerCase().replaceAll(" ", "_")}`, ledger.includes(section) ? "pass" : "fail", `${section} section is required.`);
    }
    record("ledger.current_release_state", "pass", "current release state ledger is present.");
  } catch (error) {
    record("ledger.current_release_state", "fail", publicErrorMessage(error));
  }
}

async function checkReleaseHarnessFiles(releaseLedgerPath, releaseStatusPath, sourceLedgerPath) {
  let releaseLedger = "";
  let releaseStatus = "";

  try {
    releaseLedger = await readFile(releaseLedgerPath, "utf8");
    record("release_harness.ledger", "pass", "release-ledger.yaml is present.");
  } catch (error) {
    record("release_harness.ledger", "fail", publicErrorMessage(error));
  }

  try {
    releaseStatus = await readFile(releaseStatusPath, "utf8");
    record("release_harness.status", "pass", "RELEASE_STATUS.md is present.");
  } catch (error) {
    record("release_harness.status", "fail", publicErrorMessage(error));
  }

  if (releaseLedger) {
    for (const field of REQUIRED_RELEASE_LEDGER_FIELDS) {
      record(
        `release_harness.ledger.${field}`,
        new RegExp(`^${escapeRegExp(field)}:`, "m").test(releaseLedger) ? "pass" : "fail",
        `release-ledger.yaml must include top-level field ${field}.`,
      );
    }

    record(
      "release_harness.ledger.source_of_truth",
      releaseLedger.includes(`source_of_truth: "${sourceLedgerPath}"`) || releaseLedger.includes(`source_of_truth: ${sourceLedgerPath}`)
        ? "pass"
        : "fail",
      "release-ledger.yaml must point to docs/current-release-state.md as the detailed source of truth.",
    );
    const openBlockerIds = extractOpenReleaseBlockerIds(releaseLedger);
    record(
      "release_harness.ledger.open_blockers",
      openBlockerIds.length === 0 ? "pass" : "fail",
      openBlockerIds.length === 0 ? "release-ledger.yaml has no open release blockers." : "release-ledger.yaml has open release blockers that must be resolved before release status can pass.",
      { blockers: openBlockerIds },
    );
    recordNoSecretLikePatterns("release_harness.ledger.redaction", releaseLedger, "release-ledger.yaml");
  }

  if (releaseStatus) {
    for (const section of REQUIRED_RELEASE_STATUS_SECTIONS) {
      record(
        `release_harness.status.${section.replace(/^#+\s+/, "").toLowerCase().replaceAll(" ", "_")}`,
        releaseStatus.includes(section) ? "pass" : "fail",
        `RELEASE_STATUS.md must include ${section}.`,
      );
    }

    record(
      "release_harness.status.source_of_truth",
      releaseStatus.includes(sourceLedgerPath) ? "pass" : "fail",
      "RELEASE_STATUS.md must link to docs/current-release-state.md.",
    );
    recordNoSecretLikePatterns("release_harness.status.redaction", releaseStatus, "RELEASE_STATUS.md");
  }
}

function recordNoSecretLikePatterns(name, content, path) {
  const secretLikePattern = /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN (RSA |OPENSSH |PRIVATE )?PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY[=:][^\s]+|JWT_SECRET[=:][^\s]+)/i;
  record(name, secretLikePattern.test(content) ? "fail" : "pass", `${path} must not contain secret-like values.`);
}

function extractOpenReleaseBlockerIds(releaseLedger) {
  const blockersMatch = releaseLedger.match(/\nblockers:\n(?<body>[\s\S]*?)(?=\n[A-Za-z_]+:\n|\s*$)/);
  const blockersBody = blockersMatch?.groups?.body ?? "";
  if (!blockersBody.trim() || /^\s*\[\]\s*$/m.test(blockersBody)) {
    return [];
  }

  return blockersBody
    .split(/\n\s*-\s+/)
    .map((blocker) => blocker.trim())
    .filter(Boolean)
    .filter((blocker) => /^\s*status:\s*"?open"?\s*$/m.test(blocker))
    .map((blocker, index) => {
      const idMatch = blocker.match(/^\s*(?:-\s*)?id:\s*"?([^"\n]+)"?\s*$/m);
      return idMatch?.[1] ?? `open-blocker-${index + 1}`;
    });
}

async function checkLegacyArtifacts() {
  await recordMissingPath("legacy.supabase_artifacts", "supabase", "Supabase project artifacts must not ship in the Cloudflare release tree.");
  await recordMissingPath("legacy.vercel_config", "vercel.json", "Vercel deployment config must not ship with the Cloudflare Pages release tree.");

  try {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const dependencyBlocks = [
      packageJson.dependencies,
      packageJson.devDependencies,
      packageJson.optionalDependencies,
      packageJson.peerDependencies,
    ].filter(isRecord);
    const dependencyNames = dependencyBlocks.flatMap((block) => Object.keys(block));
    const supabaseDependencies = dependencyNames.filter((name) => name === "supabase" || name.startsWith("@supabase/"));

    record(
      "legacy.supabase_dependencies",
      supabaseDependencies.length === 0 ? "pass" : "fail",
      supabaseDependencies.length === 0
        ? "package.json has no Supabase runtime or toolchain dependencies."
        : `package.json still references Supabase dependencies: ${supabaseDependencies.join(", ")}`,
    );
  } catch (error) {
    record("legacy.supabase_dependencies", "fail", publicErrorMessage(error));
  }
}

async function checkLegacyRuntimeUrls() {
  const offenders = [];

  for (const path of LEGACY_RUNTIME_URL_FILES) {
    try {
      const content = await readFile(path, "utf8");
      if (LEGACY_VERCEL_HOST_PATTERN.test(content)) {
        offenders.push(path);
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        offenders.push(`${path} (${publicErrorMessage(error)})`);
      }
    }
  }

  record(
    "legacy.vercel_public_urls",
    offenders.length === 0 ? "pass" : "fail",
    offenders.length === 0
      ? "runtime defaults do not expose Vercel public URLs."
      : `runtime defaults still reference Vercel public URLs: ${offenders.join(", ")}`,
  );
}

async function checkOpenNextAdapter() {
  try {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const devDependencies = isRecord(packageJson.devDependencies) ? packageJson.devDependencies : {};
    const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};

    record(
      "frontend.opennext.dependency",
      readyString(devDependencies["@opennextjs/cloudflare"]) ? "pass" : "fail",
      "@opennextjs/cloudflare must be pinned as a devDependency for Cloudflare Next.js builds.",
    );
    record(
      "frontend.wrangler.dependency",
      readyString(devDependencies.wrangler) ? "pass" : "fail",
      "wrangler must be pinned as a devDependency for reproducible Cloudflare frontend builds.",
    );

    const requiredScripts = {
      "cf:build": "opennextjs-cloudflare build",
      "cf:preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
      "cf:deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
      "cf:typegen": "wrangler types cloudflare-env.d.ts --env-interface CloudflareEnv --env-file .env.example --include-runtime false",
      "cf:web:dry-run": "wrangler deploy --dry-run --env=\"\" --config wrangler.jsonc",
      "cf:web:dry-run:staging": "wrangler deploy --dry-run --env staging --config wrangler.jsonc",
      "cf:web:dry-run:production": "wrangler deploy --dry-run --env production --config wrangler.jsonc",
    };

    for (const [scriptName, expectedCommand] of Object.entries(requiredScripts)) {
      record(
        `frontend.opennext.script.${scriptName}`,
        scripts[scriptName] === expectedCommand ? "pass" : "fail",
        `package.json script ${scriptName} must run '${expectedCommand}'.`,
      );
    }
  } catch (error) {
    record("frontend.opennext.package", "fail", publicErrorMessage(error));
  }

  try {
    const config = await readFile("open-next.config.ts", "utf8");
    record(
      "frontend.opennext.config",
      config.includes("defineCloudflareConfig") && config.includes("@opennextjs/cloudflare") ? "pass" : "fail",
      "open-next.config.ts must configure the Cloudflare OpenNext adapter.",
    );
  } catch (error) {
    record("frontend.opennext.config", "fail", publicErrorMessage(error));
  }
}

async function checkFrontendWranglerConfig(path) {
  let config;
  try {
    config = JSON.parse(stripJsonComments(await readFile(path, "utf8")));
  } catch (error) {
    record("frontend.wrangler.config", "fail", publicErrorMessage(error));
    return;
  }

  record("frontend.wrangler.name", readyString(config.name) ? "pass" : "fail", "Cloudflare frontend Worker name is required.");
  record("frontend.wrangler.main", config.main === ".open-next/worker.js" ? "pass" : "fail", "Next.js frontend Worker main must point to .open-next/worker.js.");
  record(
    "frontend.wrangler.compatibility_date",
    isDateAtLeast(config.compatibility_date, MINIMUM_OPEN_NEXT_COMPATIBILITY_DATE) ? "pass" : "fail",
    `OpenNext Cloudflare compatibility_date must be ${MINIMUM_OPEN_NEXT_COMPATIBILITY_DATE} or later.`,
  );
  record(
    "frontend.wrangler.nodejs_compat",
    Array.isArray(config.compatibility_flags) && config.compatibility_flags.includes("nodejs_compat") ? "pass" : "fail",
    "Next.js frontend Worker must enable nodejs_compat.",
  );
  record("frontend.wrangler.assets.directory", config.assets?.directory === ".open-next/assets" ? "pass" : "fail", "Next.js frontend assets directory must be .open-next/assets.");
  record("frontend.wrangler.assets.binding", config.assets?.binding === "ASSETS" ? "pass" : "fail", "Next.js frontend assets binding must be ASSETS.");
  record("frontend.wrangler.observability", config.observability?.enabled === true ? "pass" : "fail", "Next.js frontend Worker observability must be enabled.");

  for (const envName of ["staging", "production"]) {
    const envConfig = config.env?.[envName];
    record(`frontend.wrangler.${envName}.name`, readyString(envConfig?.name) ? "pass" : "fail", `Cloudflare frontend ${envName} Worker name is required.`);
    assertNoSecretVars(envConfig?.vars ?? {}, `frontend.wrangler.${envName}`);
  }
  assertNoSecretVars(config.vars ?? {}, "frontend.wrangler");
}

async function recordMissingPath(name, path, message) {
  try {
    await access(path);
    record(name, "fail", message);
  } catch {
    record(name, "pass", message);
  }
}

async function checkWranglerConfig(path) {
  let config;
  try {
    config = JSON.parse(stripJsonComments(await readFile(path, "utf8")));
  } catch (error) {
    record("wrangler.config", "fail", publicErrorMessage(error));
    return;
  }

  for (const envName of ["staging", "production"]) {
    const envConfig = config.env?.[envName];
    if (!isRecord(envConfig)) {
      record(`wrangler.${envName}.config`, "fail", `${envName} config is missing.`);
      continue;
    }

    const d1 = bindingBy(envConfig.d1_databases, "DB");
    const kv = bindingBy(envConfig.kv_namespaces, "CACHE");
    const r2 = bindingBy(envConfig.r2_buckets, "PHOTOS");
    const images = envConfig.images;
    const durableBindings = Array.isArray(envConfig.durable_objects?.bindings) ? envConfig.durable_objects.bindings : [];

    recordReadyIdentifier(`${envName}.d1.DB.database_id`, d1?.database_id);
    recordReadyIdentifier(`${envName}.kv.CACHE.id`, kv?.id);
    recordReadyString(`${envName}.r2.PHOTOS.bucket_name`, r2?.bucket_name);
    record(`${envName}.images.IMAGES`, images?.binding === "IMAGES" ? "pass" : "fail", "Cloudflare Images binding must be named IMAGES.");

    for (const bindingName of ["PLACE_ROOM", "REGION_ROOM", "GLOBAL_ROOM"]) {
      record(
        `${envName}.durable_objects.${bindingName}`,
        durableBindings.some((binding) => binding?.name === bindingName) ? "pass" : "fail",
        `${bindingName} Durable Object binding is required.`,
      );
    }
  }
}

function checkDeploymentUrls() {
  const parsedUrls = new Map();

  for (const [envVarName, checkName] of Object.entries(REQUIRED_ENV_URLS)) {
    const parsed = parseDeploymentUrl(process.env[envVarName], envVarName, checkName);
    if (parsed) {
      parsedUrls.set(checkName, parsed.href);
    }
  }

  recordSeparatedUrls(parsedUrls, "staging.pages", "production.pages", "staging and production Pages URLs must be different.");
  recordSeparatedUrls(parsedUrls, "staging.worker_api", "production.worker_api", "staging and production Worker API URLs must be different.");
}

function parseDeploymentUrl(value, envVarName, checkName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    record(`deployment_url.${checkName}`, "fail", `${envVarName} is required.`);
    return null;
  }

  if (hasPlaceholder(value)) {
    record(`deployment_url.${checkName}`, "fail", `${envVarName} still contains a placeholder.`);
    return null;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    record(`deployment_url.${checkName}`, "fail", `${envVarName} must be a valid absolute URL.`);
    return null;
  }

  const validations = [
    recordCheck(url.protocol === "https:", `deployment_url.${checkName}`, `${envVarName} must use https.`),
    recordCheck(url.username === "" && url.password === "", `deployment_url.${checkName}`, `${envVarName} must not contain credentials.`),
    recordCheck(url.search === "" && url.hash === "", `deployment_url.${checkName}`, `${envVarName} must not contain query params or fragments.`),
    recordCheck(!isLocalhost(url.hostname), `deployment_url.${checkName}`, `${envVarName} must not point to localhost.`),
  ];

  if (!validations.every(Boolean)) {
    return null;
  }

  record(`deployment_url.${checkName}`, "pass", `${envVarName} is deployment-shaped.`, { host: url.host });
  return url;
}

function recordReadyIdentifier(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    record(name, "fail", `${name} is required.`);
    return;
  }

  if (hasPlaceholder(value)) {
    record(name, "fail", `${name} must not contain placeholders.`);
    return;
  }

  record(name, value.length >= 8 ? "pass" : "fail", `${name} must look like a concrete Cloudflare resource id.`);
}

function recordReadyString(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    record(name, "fail", `${name} is required.`);
    return;
  }

  record(name, hasPlaceholder(value) ? "fail" : "pass", `${name} must not contain placeholders.`);
}

function assertNoSecretVars(vars, scopeName) {
  if (!isRecord(vars)) {
    record(`${scopeName}.vars`, "fail", "vars must be an object when present.");
    return;
  }

  for (const key of Object.keys(vars)) {
    if (/(TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL)/i.test(key)) {
      record(`${scopeName}.vars.${key}`, "fail", "Secrets must be registered as Cloudflare secrets, not plain vars.");
    }
  }
}

function readyString(value) {
  return typeof value === "string" && value.trim().length > 0 && !hasPlaceholder(value);
}

function isDateAtLeast(value, minimum) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  return value >= minimum;
}

function recordSeparatedUrls(parsedUrls, leftKey, rightKey, message) {
  const left = parsedUrls.get(leftKey);
  const right = parsedUrls.get(rightKey);
  if (!left || !right) {
    return;
  }

  record(`deployment_url.${leftKey}.${rightKey}`, left !== right ? "pass" : "fail", message);
}

function bindingBy(items, bindingName) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.find((item) => item?.binding === bindingName) ?? null;
}

function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        inString = false;
      }
      continue;
    }

    if (current === "\"" || current === "'") {
      inString = true;
      quote = current;
      output += current;
      continue;
    }

    if (current === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (current === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += current;
  }

  return output;
}

function parseArgs(rawArgs) {
  const parsedFlags = new Set();
  const parsedOptions = new Map();

  for (const rawArg of rawArgs) {
    if (!rawArg.startsWith("--")) {
      continue;
    }

    const arg = rawArg.slice(2);
    const separatorIndex = arg.indexOf("=");
    if (separatorIndex === -1) {
      parsedFlags.add(arg);
      continue;
    }

    parsedOptions.set(arg.slice(0, separatorIndex), arg.slice(separatorIndex + 1));
  }

  return { flags: parsedFlags, options: parsedOptions };
}

function recordCheck(condition, name, message) {
  record(name, condition ? "pass" : "fail", message);
  return condition;
}

function record(name, status, message, details = {}) {
  checks.push({ name, status, message, ...details });
}

function hasPlaceholder(value) {
  return /TODO|^<.*>$|REPLACE_ME|CHANGE_ME/i.test(String(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || /^127\./.test(hostname) || hostname.endsWith(".local");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error) {
  return isRecord(error) && error.code === "ENOENT";
}

function publicErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown release state check error.";
}

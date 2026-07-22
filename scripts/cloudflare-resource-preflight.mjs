#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const REQUIRED_DURABLE_OBJECT_BINDINGS = ["PLACE_ROOM", "REGION_ROOM", "GLOBAL_ROOM"];
const REQUIRED_RATE_LIMIT_BINDINGS = ["PUBLIC_API_RATE_LIMITER", "ADMIN_API_RATE_LIMITER", "HIGH_COST_API_RATE_LIMITER"];
const DEFAULT_ENVS = ["staging", "production"];
const DEPLOYMENT_URL_ENV_BY_ENV = {
  staging: {
    pages: "SILSIGAN_STAGING_PAGES_URL",
    api: "SILSIGAN_STAGING_API_BASE_URL",
  },
  production: {
    pages: "SILSIGAN_PRODUCTION_PAGES_URL",
    api: "SILSIGAN_PRODUCTION_API_BASE_URL",
  },
};

const { options } = parseArgs(process.argv.slice(2));
const configPath = options.get("config")?.[0] ?? "workers/api/wrangler.jsonc";
const targetEnvs = options.get("env") ?? DEFAULT_ENVS;
const checks = [];

try {
  const config = await readConfig(configPath);
  assertRecord(config, "config", "Wrangler config root must be an object.");
  assert(config.observability?.enabled === true, "observability.enabled", "Wrangler observability must be enabled.");

  for (const envName of targetEnvs) {
    checkEnvironment(config, envName);
  }
  checkDeploymentUrls(targetEnvs);
} catch (error) {
  record("harness", "fail", publicErrorMessage(error));
}

const failed = checks.filter((check) => check.status === "fail");
console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      configPath,
      envs: targetEnvs,
      checks,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 1;
}

function checkEnvironment(config, envName) {
  const envConfig = envName === "" ? config : config.env?.[envName];
  assertRecord(envConfig, `${envName}.config`, `Wrangler env "${envName}" is missing.`);

  const actualEnvironment = envConfig.vars?.ENVIRONMENT;
  assert(actualEnvironment === (envName || "development"), `${envName}.vars.ENVIRONMENT`, `ENVIRONMENT must equal "${envName || "development"}".`);
  assertNoSecretVars(envConfig.vars ?? {}, envName);
  if (envName === "staging" || envName === "production") {
    assert(
      envConfig.vars?.SILSIGAN_PHOTO_TURNSTILE_REQUIRED === "1",
      `${envName}.vars.SILSIGAN_PHOTO_TURNSTILE_REQUIRED`,
      "Photo upload Turnstile protection must fail closed in staging and production.",
    );
    const siteKey = envConfig.vars?.SILSIGAN_TURNSTILE_SITE_KEY;
    assertNoPlaceholder(siteKey, `${envName}.vars.SILSIGAN_TURNSTILE_SITE_KEY`);
    assert(
      typeof siteKey === "string" && /^[a-zA-Z0-9_-]{3,32}$/.test(siteKey),
      `${envName}.vars.SILSIGAN_TURNSTILE_SITE_KEY`,
      "The public Turnstile site key must be deployment-shaped.",
    );
    assert(
      envConfig.vars?.SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED === "1",
      `${envName}.vars.SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED`,
      "The global Workers and D1 cost guard must fail closed in staging and production.",
    );
    assertCostGuardNumber(envConfig.vars?.SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT, 100_000, `${envName}.vars.SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT`);
    assertCostGuardNumber(envConfig.vars?.SILSIGAN_D1_DAILY_READ_LIMIT, 5_000_000, `${envName}.vars.SILSIGAN_D1_DAILY_READ_LIMIT`);
    assertCostGuardNumber(envConfig.vars?.SILSIGAN_D1_DAILY_WRITE_LIMIT, 100_000, `${envName}.vars.SILSIGAN_D1_DAILY_WRITE_LIMIT`);
    assertProviderBudgetNumber(envConfig.vars?.SILSIGAN_KMA_DAILY_PROVIDER_REQUEST_LIMIT, 5_000, `${envName}.vars.SILSIGAN_KMA_DAILY_PROVIDER_REQUEST_LIMIT`);
    assertProviderBudgetNumber(envConfig.vars?.SILSIGAN_TOUR_API_DAILY_PROVIDER_REQUEST_LIMIT, 500, `${envName}.vars.SILSIGAN_TOUR_API_DAILY_PROVIDER_REQUEST_LIMIT`);
    assertProviderBudgetNumber(envConfig.vars?.SILSIGAN_NATIONAL_PARKING_DAILY_PROVIDER_REQUEST_LIMIT, 500, `${envName}.vars.SILSIGAN_NATIONAL_PARKING_DAILY_PROVIDER_REQUEST_LIMIT`);
    assertProviderBudgetNumber(envConfig.vars?.SILSIGAN_ITS_DAILY_PROVIDER_REQUEST_LIMIT, 500, `${envName}.vars.SILSIGAN_ITS_DAILY_PROVIDER_REQUEST_LIMIT`);
    assertProviderBudgetNumber(envConfig.vars?.SILSIGAN_SEOUL_REALTIME_DAILY_PROVIDER_REQUEST_LIMIT, 500, `${envName}.vars.SILSIGAN_SEOUL_REALTIME_DAILY_PROVIDER_REQUEST_LIMIT`);
    assertCostGuardPercent(envConfig.vars?.SILSIGAN_COST_GUARD_WARN_PERCENT, 60, `${envName}.vars.SILSIGAN_COST_GUARD_WARN_PERCENT`);
    assertCostGuardPercent(envConfig.vars?.SILSIGAN_COST_GUARD_DEGRADE_PERCENT, 70, `${envName}.vars.SILSIGAN_COST_GUARD_DEGRADE_PERCENT`);
    assertCostGuardPercent(envConfig.vars?.SILSIGAN_COST_GUARD_STOP_PERCENT, 80, `${envName}.vars.SILSIGAN_COST_GUARD_STOP_PERCENT`);
  }

  const db = bindingBy(envConfig.d1_databases, "DB");
  assertRecord(db, `${envName}.d1.DB`, "D1 DB binding is missing.");
  if (!isRecord(db)) {
    return;
  }
  assertReadyIdentifier(db.database_id, `${envName}.d1.DB.database_id`);
  assertNoPlaceholder(db.database_name, `${envName}.d1.DB.database_name`);

  const cache = bindingBy(envConfig.kv_namespaces, "CACHE");
  assertRecord(cache, `${envName}.kv.CACHE`, "CACHE KV binding is missing.");
  if (!isRecord(cache)) {
    return;
  }
  assertReadyIdentifier(cache.id, `${envName}.kv.CACHE.id`);

  const costGuardState = bindingBy(envConfig.kv_namespaces, "COST_GUARD_STATE");
  assertRecord(costGuardState, `${envName}.kv.COST_GUARD_STATE`, "Dedicated COST_GUARD_STATE KV binding is missing.");
  if (isRecord(costGuardState)) {
    assertReadyIdentifier(costGuardState.id, `${envName}.kv.COST_GUARD_STATE.id`);
    assert(costGuardState.id !== cache.id, `${envName}.kv.COST_GUARD_STATE.separate`, "Cost guard state must not share the ranking CACHE namespace.");
  }

  for (const bindingName of REQUIRED_RATE_LIMIT_BINDINGS) {
    const binding = rateLimitBy(envConfig.ratelimits, bindingName);
    assertRecord(binding, `${envName}.ratelimit.${bindingName}`, `${bindingName} rate limit binding is missing.`);
  }

  const photos = bindingBy(envConfig.r2_buckets, "PHOTOS");
  assertRecord(photos, `${envName}.r2.PHOTOS`, "PHOTOS R2 binding is missing.");
  if (!isRecord(photos)) {
    return;
  }
  assertNoPlaceholder(photos.bucket_name, `${envName}.r2.PHOTOS.bucket_name`);

  assert(envConfig.images?.binding === "IMAGES", `${envName}.images.IMAGES`, "Cloudflare Images binding must be named IMAGES.");

  const durableBindings = envConfig.durable_objects?.bindings;
  assert(Array.isArray(durableBindings), `${envName}.durable_objects`, "Durable Object bindings are missing.");
  const availableDurableBindings = new Set(durableBindings.map((binding) => binding?.name));
  for (const bindingName of REQUIRED_DURABLE_OBJECT_BINDINGS) {
    assert(availableDurableBindings.has(bindingName), `${envName}.durable_objects.${bindingName}`, `${bindingName} Durable Object binding is missing.`);
  }

  record(`${envName}.resource_bindings`, "pass", "Wrangler environment has required D1/KV/R2/Images/rate-limit/Durable Object binding entries.");
}

function checkDeploymentUrls(targetEnvs) {
  const parsedUrls = new Map();

  for (const envName of targetEnvs) {
    const requirement = DEPLOYMENT_URL_ENV_BY_ENV[envName];
    if (!requirement) {
      continue;
    }

    const pagesUrl = parseDeploymentUrl(process.env[requirement.pages], `${envName}.pages.url`, requirement.pages);
    const apiUrl = parseDeploymentUrl(process.env[requirement.api], `${envName}.worker_api.url`, requirement.api);

    if (pagesUrl) {
      parsedUrls.set(`${envName}.pages`, pagesUrl.href);
    }
    if (apiUrl) {
      parsedUrls.set(`${envName}.worker_api`, apiUrl.href);
    }
  }

  assertSeparatedDeploymentUrls(parsedUrls, "staging.pages", "production.pages", "staging and production Pages URLs must not be identical.");
  assertSeparatedDeploymentUrls(parsedUrls, "staging.worker_api", "production.worker_api", "staging and production Worker API URLs must not be identical.");
}

async function readConfig(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(stripJsonComments(raw));
}

function bindingBy(items, bindingName) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.find((item) => item?.binding === bindingName) ?? null;
}

function rateLimitBy(items, bindingName) {
  if (!Array.isArray(items)) return null;
  return items.find((item) => item?.name === bindingName) ?? null;
}

function assertCostGuardNumber(value, ceiling, name) {
  const parsed = Number(value);
  assert(Number.isSafeInteger(parsed) && parsed > 0 && parsed <= ceiling, name, `${name} must be a positive integer no higher than ${ceiling}.`);
}

function assertProviderBudgetNumber(value, ceiling, name) {
  const normalized = typeof value === "string" ? value.trim() : "";
  const parsed = Number(normalized);
  assert(
    normalized.length > 0 && Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= ceiling,
    name,
    `${name} must be an integer from 0 (kill switch) through ${ceiling}.`,
  );
}

function assertCostGuardPercent(value, expected, name) {
  assert(Number(value) === expected, name, `${name} must equal the compiled ${expected}% safety boundary.`);
}

function assertReadyIdentifier(value, name) {
  assertNoPlaceholder(value, name);
  assert(typeof value === "string" && value.length >= 8, name, `${name} must be a real Cloudflare resource id.`);
}

function parseDeploymentUrl(value, name, envVarName) {
  assertNoPlaceholder(value, name);
  if (typeof value !== "string" || value.trim().length === 0 || hasPlaceholder(value)) {
    return null;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    assert(false, name, `${envVarName} must be a valid absolute URL.`);
    return null;
  }

  const validations = [
    check(url.protocol === "https:", name, `${envVarName} must use https.`),
    check(url.username === "" && url.password === "", name, `${envVarName} must not contain credentials.`),
    check(url.search === "" && url.hash === "", name, `${envVarName} must not contain query params or fragments.`),
    check(!isLocalhost(url.hostname), name, `${envVarName} must point to a deployed Cloudflare-accessible host, not localhost.`),
  ];

  if (!validations.every(Boolean)) {
    return null;
  }

  record(name, "pass", `${envVarName} is present and deployment-shaped.`, {
    host: url.host,
  });
  return url;
}

function assertNoPlaceholder(value, name) {
  assert(typeof value === "string" && value.trim().length > 0, name, `${name} must be a non-empty string.`);
  assert(!hasPlaceholder(value), name, `${name} still contains a placeholder: ${value}`);
}

function hasPlaceholder(value) {
  return /TODO|^<.*>$|REPLACE_ME|CHANGE_ME/i.test(String(value));
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || /^127\./.test(hostname) || hostname.endsWith(".local");
}

function assertSeparatedDeploymentUrls(parsedUrls, leftKey, rightKey, message) {
  const left = parsedUrls.get(leftKey);
  const right = parsedUrls.get(rightKey);
  if (!left || !right) {
    return;
  }

  assert(left !== right, `deployment_urls.${leftKey}.${rightKey}`, message);
}

function assertNoSecretVars(vars, envName) {
  assertRecord(vars, `${envName}.vars`, "vars must be an object.");
  for (const key of Object.keys(vars)) {
    assert(!/(TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL)/i.test(key), `${envName}.vars.${key}`, "Secrets must be registered with wrangler secret, not vars.");
  }
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
  const parsedOptions = new Map();

  for (let index = 0; index < rawArgs.length; index += 1) {
    const rawArg = rawArgs[index];
    if (!rawArg.startsWith("--")) {
      continue;
    }

    const arg = rawArg.slice(2);
    const separatorIndex = arg.indexOf("=");
    const key = separatorIndex === -1 ? arg : arg.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? rawArgs[index + 1] : arg.slice(separatorIndex + 1);
    if (separatorIndex === -1) {
      index += 1;
    }

    if (!parsedOptions.has(key)) {
      parsedOptions.set(key, []);
    }
    parsedOptions.get(key).push(value);
  }

  return { options: parsedOptions };
}

function record(name, status, message) {
  checks.push({ name, status, message });
}

function assert(condition, name, message) {
  if (condition) {
    return;
  }

  record(name, "fail", message);
}

function check(condition, name, message) {
  assert(condition, name, message);
  return Boolean(condition);
}

function assertRecord(value, name, message) {
  assert(isRecord(value), name, message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publicErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown preflight error.";
}

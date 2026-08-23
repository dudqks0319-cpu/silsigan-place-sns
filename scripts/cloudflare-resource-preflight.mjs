#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const REQUIRED_DURABLE_OBJECT_BINDINGS = ["PLACE_ROOM", "REGION_ROOM", "GLOBAL_ROOM"];
const REQUIRED_RATE_LIMIT_BINDINGS = {
  PHOTO_WRITE_RATE_LIMITER: { limit: 60, period: 60 },
  PHOTO_READ_RATE_LIMITER: { limit: 200, period: 60 },
};
const MAX_PHOTO_GLOBAL_DAILY_LIMIT = 150;
const MAX_PHOTO_GLOBAL_MONTHLY_LIMIT = 4_500;
const MAX_PHOTO_GLOBAL_STORED_LIMIT = 9_000;
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

  const corsOriginsByEnv = new Map();
  for (const envName of targetEnvs) {
    corsOriginsByEnv.set(envName, checkEnvironment(config, envName));
  }
  checkDeploymentUrls(targetEnvs, corsOriginsByEnv);
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
  const corsOrigins = parseCorsOrigins(envConfig.vars?.CORS_ALLOWED_ORIGINS, `${envName}.vars.CORS_ALLOWED_ORIGINS`, envName === "");

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

  const photos = bindingBy(envConfig.r2_buckets, "PHOTOS");
  assertRecord(photos, `${envName}.r2.PHOTOS`, "PHOTOS R2 binding is missing.");
  if (!isRecord(photos)) {
    return;
  }
  assertNoPlaceholder(photos.bucket_name, `${envName}.r2.PHOTOS.bucket_name`);

  checkPhotoCostControls(envConfig, envName);

  const durableBindings = envConfig.durable_objects?.bindings;
  assert(Array.isArray(durableBindings), `${envName}.durable_objects`, "Durable Object bindings are missing.");
  const availableDurableBindings = new Set(durableBindings.map((binding) => binding?.name));
  for (const bindingName of REQUIRED_DURABLE_OBJECT_BINDINGS) {
    assert(availableDurableBindings.has(bindingName), `${envName}.durable_objects.${bindingName}`, `${bindingName} Durable Object binding is missing.`);
  }

  record(
    `${envName}.resource_bindings`,
    "pass",
    "Wrangler environment has required D1/KV/R2/rate-limit/Durable Object bindings and an explicit Images cost policy.",
  );
  return corsOrigins;
}

function checkPhotoCostControls(envConfig, envName) {
  const photoUploadsEnabled = envConfig.vars?.PHOTO_UPLOADS_ENABLED;
  assert(
    photoUploadsEnabled === "true" || photoUploadsEnabled === "false",
    `${envName}.vars.PHOTO_UPLOADS_ENABLED`,
    "PHOTO_UPLOADS_ENABLED must be explicitly true or false.",
  );

  const rawGlobalDailyLimit = envConfig.vars?.PHOTO_GLOBAL_DAILY_LIMIT;
  const globalDailyLimit = Number(rawGlobalDailyLimit);
  assert(
    typeof rawGlobalDailyLimit === "string" && Number.isInteger(globalDailyLimit) && globalDailyLimit >= 1 && globalDailyLimit <= MAX_PHOTO_GLOBAL_DAILY_LIMIT,
    `${envName}.vars.PHOTO_GLOBAL_DAILY_LIMIT`,
    `PHOTO_GLOBAL_DAILY_LIMIT must be an integer string between 1 and ${MAX_PHOTO_GLOBAL_DAILY_LIMIT}.`,
  );

  const rawGlobalMonthlyLimit = envConfig.vars?.PHOTO_GLOBAL_MONTHLY_LIMIT;
  const globalMonthlyLimit = Number(rawGlobalMonthlyLimit);
  assert(
    typeof rawGlobalMonthlyLimit === "string" &&
      Number.isInteger(globalMonthlyLimit) &&
      globalMonthlyLimit >= 1 &&
      globalMonthlyLimit <= MAX_PHOTO_GLOBAL_MONTHLY_LIMIT,
    `${envName}.vars.PHOTO_GLOBAL_MONTHLY_LIMIT`,
    `PHOTO_GLOBAL_MONTHLY_LIMIT must be an integer string between 1 and ${MAX_PHOTO_GLOBAL_MONTHLY_LIMIT}.`,
  );

  const rawGlobalStoredLimit = envConfig.vars?.PHOTO_GLOBAL_STORED_LIMIT;
  const globalStoredLimit = Number(rawGlobalStoredLimit);
  assert(
    typeof rawGlobalStoredLimit === "string" &&
      Number.isInteger(globalStoredLimit) &&
      globalStoredLimit >= 1 &&
      globalStoredLimit <= MAX_PHOTO_GLOBAL_STORED_LIMIT,
    `${envName}.vars.PHOTO_GLOBAL_STORED_LIMIT`,
    `PHOTO_GLOBAL_STORED_LIMIT must be an integer string between 1 and ${MAX_PHOTO_GLOBAL_STORED_LIMIT}.`,
  );

  for (const [bindingName, expected] of Object.entries(REQUIRED_RATE_LIMIT_BINDINGS)) {
    const binding = rateLimitBy(envConfig.ratelimits, bindingName);
    assertRecord(binding, `${envName}.ratelimits.${bindingName}`, `${bindingName} binding is missing.`);
    if (!isRecord(binding)) {
      continue;
    }

    assert(
      typeof binding.namespace_id === "string" && /^[1-9]\d*$/.test(binding.namespace_id),
      `${envName}.ratelimits.${bindingName}.namespace_id`,
      `${bindingName} namespace_id must be a positive integer string.`,
    );
    assert(
      binding.simple?.limit === expected.limit && binding.simple?.period === expected.period,
      `${envName}.ratelimits.${bindingName}.simple`,
      `${bindingName} must enforce ${expected.limit} requests per ${expected.period} seconds.`,
    );
  }

  const imageTransformsEnabled = envConfig.vars?.IMAGE_TRANSFORMS_ENABLED;
  assert(
    imageTransformsEnabled === "true" || imageTransformsEnabled === "false",
    `${envName}.vars.IMAGE_TRANSFORMS_ENABLED`,
    "IMAGE_TRANSFORMS_ENABLED must be explicitly true or false.",
  );

  if (imageTransformsEnabled === "true") {
    assert(envConfig.images?.binding === "IMAGES", `${envName}.images.IMAGES`, "Enabled Cloudflare Images transforms require an IMAGES binding.");
  } else {
    assert(
      envConfig.images === undefined,
      `${envName}.images.disabled`,
      "Remove the Cloudflare Images binding while IMAGE_TRANSFORMS_ENABLED=false to prevent accidental metered transforms.",
    );
  }
  if (photoUploadsEnabled === "true") {
    assert(
      imageTransformsEnabled === "true" && envConfig.images?.binding === "IMAGES",
      `${envName}.photos.processing_gate`,
      "Enabled photo uploads require the approved server pixel-reencode path.",
    );
  }
}

function checkDeploymentUrls(targetEnvs, corsOriginsByEnv) {
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
      assert(
        corsOriginsByEnv.get(envName)?.has(pagesUrl.origin) === true,
        `${envName}.cors.pages_origin`,
        `${envName}.vars.CORS_ALLOWED_ORIGINS must include the exact Pages origin ${pagesUrl.origin}.`,
      );
    }
    if (apiUrl) {
      parsedUrls.set(`${envName}.worker_api`, apiUrl.href);
    }
  }

  assertSeparatedDeploymentUrls(parsedUrls, "staging.pages", "production.pages", "staging and production Pages URLs must not be identical.");
  assertSeparatedDeploymentUrls(parsedUrls, "staging.worker_api", "production.worker_api", "staging and production Worker API URLs must not be identical.");
}

function parseCorsOrigins(rawValue, name, allowLoopback) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    assert(false, name, "CORS_ALLOWED_ORIGINS must contain one or more exact origins.");
    return new Set();
  }

  const values = rawValue.split(",").map((value) => value.trim()).filter(Boolean);
  const origins = [];
  let valid = values.length > 0;

  for (const value of values) {
    let url;
    try {
      url = new URL(value);
    } catch {
      record(name, "fail", `CORS origin is not a valid URL: ${value}`);
      valid = false;
      continue;
    }

    const protocolAllowed = url.protocol === "https:" || (allowLoopback && url.protocol === "http:" && isLocalhost(url.hostname));
    const exact = url.username === "" && url.password === "" && url.pathname === "/" && url.search === "" && url.hash === "";
    if (!protocolAllowed || !exact) {
      record(name, "fail", `CORS origin must be an exact ${allowLoopback ? "HTTPS or loopback HTTP" : "HTTPS"} origin: ${value}`);
      valid = false;
      continue;
    }

    origins.push(url.origin);
  }

  const uniqueOrigins = new Set(origins);
  if (uniqueOrigins.size !== origins.length) {
    record(name, "fail", "CORS origins must be unique.");
    valid = false;
  }
  if (valid) {
    record(name, "pass", "CORS allowed origins are exact and credential-safe.");
  }

  return valid ? uniqueOrigins : new Set();
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
  if (!Array.isArray(items)) {
    return null;
  }

  return items.find((item) => item?.name === bindingName) ?? null;
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

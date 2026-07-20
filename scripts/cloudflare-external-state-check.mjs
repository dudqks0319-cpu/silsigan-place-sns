#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  D1_MIGRATION_BOUNDARY_QUERY,
  classifyD1MigrationBoundary,
} from "./cloudflare-d1-migration-boundary.mjs";

const DEFAULT_CONFIG_PATH = "workers/api/wrangler.jsonc";
const DEFAULT_FRONTEND_CONFIG_PATH = "wrangler.jsonc";
const DEFAULT_ENVS = ["staging", "production"];
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const D1_RELEASE_EVIDENCE_QUERY = [
  "SELECT 'posts_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'posts'",
  "SELECT 'questions_table=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'questions'",
  "SELECT 'post_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_posts_place_created', 'idx_posts_status_created')",
  "SELECT 'question_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_questions_place_created', 'idx_questions_anon_created')",
  "SELECT 'v2_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('data_sources', 'dimension_settings', 'feature_flags', 'decision_profiles', 'live_signals', 'aggregated_place_status')",
  "SELECT 'v2_flags=' || COUNT(*) FROM feature_flags WHERE scope_type = 'global' AND scope_key = '*'",
  "SELECT 'v2_settings=' || COUNT(*) FROM dimension_settings",
  "SELECT 'source_registry=' || COUNT(*) FROM data_sources",
  "SELECT 'trust_safety_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_moderation_states', 'report_votes', 'user_blocks', 'consents', 'terms_acceptances', 'account_deletion_requests', 'identity_link_events')",
  "SELECT 'live_signal_expiry_required=' || COUNT(*) FROM pragma_table_info('live_signals') WHERE name = 'expires_at' AND \"notnull\" = 1",
  "SELECT 'live_signals_missing_expiry=' || COUNT(*) FROM live_signals WHERE expires_at IS NULL",
  "SELECT 'place_event_accuracy_required=' || COUNT(*) FROM pragma_table_info('place_events') WHERE name = 'accuracy_bucket' AND \"notnull\" = 1",
  "SELECT 'place_event_accuracy_invalid=' || COUNT(*) FROM place_events WHERE accuracy_bucket IS NULL OR accuracy_bucket NOT IN ('high', 'medium', 'low', 'unknown')",
  "SELECT 'preference_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('saved_places', 'saved_posts', 'followed_topics', 'notification_subscriptions')",
  "SELECT 'analytics_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'analytics_events'",
  "SELECT 'photo_cleanup_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_cleanup_jobs'",
  "SELECT 'photo_cleanup_delivery_columns=' || COUNT(*) FROM pragma_table_info('photo_cleanup_jobs') WHERE name IN ('byte_size', 'lease_token', 'lease_expires_at', 'budget_released_at', 'dead_lettered_at', 'updated_at')",
  "SELECT 'photo_cleanup_delivery_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_photo_cleanup_jobs_pending'",
  "SELECT 'photo_cleanup_dead_letters=' || COUNT(*) FROM photo_cleanup_jobs WHERE status = 'failed'",
  "SELECT 'photo_budget_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_storage_budget'",
  "SELECT 'photo_budget_rows=' || COUNT(*) FROM photo_storage_budget WHERE id = 1",
  "SELECT 'photo_storage_release_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_storage_releases'",
  "SELECT 'photo_storage_release_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_photo_storage_releases_released'",
  "SELECT 'anonymous_session_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'anonymous_sessions'",
  "SELECT 'anonymous_session_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_anonymous_sessions_status_expiry'",
  "SELECT 'anonymous_session_budget_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'anonymous_session_issuance_budget'",
  "SELECT 'place_request_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('place_addition_requests', 'place_addition_request_daily_budget')",
  "SELECT 'place_request_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_place_addition_requests_owner_created', 'idx_place_addition_requests_queue')",
  "SELECT 'place_request_triggers=' || COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name = 'trg_place_addition_requests_daily_guard'",
  "SELECT 'api_cost_guard_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('api_cost_guard_control', 'api_cost_guard_daily', 'api_cost_guard_reconciliations')",
  "SELECT 'api_cost_guard_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_api_cost_guard_reconcile_day'",
  "SELECT 'api_cost_guard_control_rows=' || COUNT(*) FROM api_cost_guard_control WHERE id = 1 AND mode IN ('running', 'degraded', 'stopped') AND generation >= 1",
  "SELECT 'api_cost_guard_warning_columns=' || COUNT(*) FROM pragma_table_info('api_cost_guard_daily') WHERE name IN ('warned_percent', 'warned_metric')",
  "SELECT 'photo_abuse_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_upload_claims', 'photo_abuse_budget', 'photo_upload_control')",
  "SELECT 'photo_upload_control_rows=' || COUNT(*) FROM photo_upload_control WHERE id = 1",
  "SELECT 'photo_read_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_read_budget', 'photo_read_control')",
  "SELECT 'photo_read_budget_rows=' || COUNT(*) FROM photo_read_budget WHERE id = 1 AND length(day_utc) = 10 AND reads_in_day >= 0",
  "SELECT 'photo_read_control_rows=' || COUNT(*) FROM photo_read_control WHERE id = 1",
  "SELECT 'photo_read_abuse_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_read_abuse_budget'",
  "SELECT 'photo_transform_budget_rows=' || COUNT(*) FROM photo_transform_budget WHERE id = 1 AND length(period_utc) = 7 AND transforms_in_period >= 0",
  "SELECT 'source_scheduler_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'source_ingestion_targets'",
  "SELECT 'source_scheduler_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_source_ingestion_targets_due', 'idx_source_ingestion_targets_lease')",
  "SELECT 'source_scheduler_targets=' || COUNT(*) FROM source_ingestion_targets",
  "SELECT 'source_scheduler_enabled_targets=' || COUNT(*) FROM source_ingestion_targets WHERE enabled = 1",
  "SELECT 'source_scheduler_invalid_active=' || COUNT(*) FROM source_ingestion_targets target JOIN data_sources source ON source.id = target.source_id WHERE target.enabled = 1 AND (source.enabled != 1 OR source.commercial_use_status NOT IN ('allowed', 'allowed_with_attribution') OR source.health_status NOT IN ('healthy', 'degraded'))",
  "SELECT 'place_event_moderation_required=' || COUNT(*) FROM pragma_table_info('place_events') WHERE name = 'moderation_status' AND \"notnull\" = 1",
  "SELECT 'publication_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('field_report_publications', 'field_report_media', 'hashtags', 'field_report_hashtags', 'publication_outbox')",
  "SELECT 'publication_delivery_columns=' || COUNT(*) FROM pragma_table_info('publication_outbox') WHERE name IN ('lease_token', 'lease_expires_at', 'last_error_code', 'dead_lettered_at', 'updated_at')",
  "SELECT 'publication_delivery_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_publication_outbox_delivery'",
  "SELECT 'publication_dead_letters=' || COUNT(*) FROM publication_outbox WHERE status = 'failed'",
  "SELECT 'posts=' || COUNT(*) FROM posts",
  "SELECT 'questions=' || COUNT(*) FROM questions",
].join("; ");
const DEPLOYMENT_URL_ENV_BY_ENV = {
  staging: {
    pages: "SILSIGAN_STAGING_PAGES_URL",
    worker_api: "SILSIGAN_STAGING_API_BASE_URL",
  },
  production: {
    pages: "SILSIGAN_PRODUCTION_PAGES_URL",
    worker_api: "SILSIGAN_PRODUCTION_API_BASE_URL",
  },
};
const API_ALLOWED_ORIGINS_ENV_BY_ENV = {
  staging: "SILSIGAN_STAGING_API_ALLOWED_ORIGINS",
  production: "SILSIGAN_PRODUCTION_API_ALLOWED_ORIGINS",
};
const FIELD_SPECIFIC_BLOCKER_CODES = new Set([
  "DEPLOYMENT_URL_REQUIRED",
  "DEPLOYMENT_URL_PLACEHOLDER",
  "DEPLOYMENT_URL_INVALID",
  "DEPLOYMENT_URL_UNSAFE",
  "DEPLOYMENT_URL_DUPLICATE",
]);
const CHECK_SPECIFIC_BLOCKER_CODES = new Set(["WORKER_DEPLOYMENT_MISSING"]);

if (isCliEntryPoint()) {
  await main();
}

export function parseArgs(rawArgs) {
  const flags = new Set();
  const options = new Map();

  for (let index = 0; index < rawArgs.length; index += 1) {
    const rawArg = rawArgs[index];
    if (!rawArg.startsWith("--")) {
      continue;
    }

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
      continue;
    }

    flags.add(arg);
  }

  return { flags, options };
}

export async function readExpectedR2BucketNames(configPath = DEFAULT_CONFIG_PATH, targetEnvs = DEFAULT_ENVS) {
  const config = JSON.parse(stripJsonComments(await readFile(configPath, "utf8")));
  const expected = [];

  for (const envName of targetEnvs) {
    const envConfig = envName === "" ? config : config.env?.[envName];
    const bucketNames = Array.isArray(envConfig?.r2_buckets)
      ? envConfig.r2_buckets.map((bucket) => bucket?.bucket_name).filter((bucketName) => typeof bucketName === "string" && bucketName.length > 0)
      : [];

    expected.push(...bucketNames);
  }

  return [...new Set(expected)];
}

export async function readExpectedD1Databases(configPath = DEFAULT_CONFIG_PATH, targetEnvs = DEFAULT_ENVS) {
  const config = JSON.parse(stripJsonComments(await readFile(configPath, "utf8")));
  const expected = [];

  for (const envName of targetEnvs) {
    const envConfig = envName === "" ? config : config.env?.[envName];
    const databases = Array.isArray(envConfig?.d1_databases) ? envConfig.d1_databases : [];
    const db = databases.find((database) => database?.binding === "DB") ?? databases[0];
    if (typeof db?.database_name !== "string" || db.database_name.length === 0) {
      expected.push({ envName, databaseName: null, binding: typeof db?.binding === "string" ? db.binding : null });
      continue;
    }

    expected.push({ envName, databaseName: db.database_name, binding: typeof db?.binding === "string" ? db.binding : null });
  }

  return expected;
}

export async function readExpectedWorkerDeployments(configPath = DEFAULT_CONFIG_PATH, frontendConfigPath = DEFAULT_FRONTEND_CONFIG_PATH, targetEnvs = DEFAULT_ENVS) {
  const [apiConfig, frontendConfig] = await Promise.all([
    readWranglerConfig(configPath),
    readWranglerConfig(frontendConfigPath),
  ]);

  return [
    ...readWorkerNamesFromConfig(apiConfig, configPath, "api", targetEnvs),
    ...readWorkerNamesFromConfig(frontendConfig, frontendConfigPath, "web", targetEnvs),
  ];
}

export function classifyR2BucketListResult(result, expectedBucketNames = []) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.exitCode !== 0) {
    if (isWranglerAuthFailure(output)) {
      return {
        name: "cloudflare.r2.enabled",
        status: "fail",
        code: "CLOUDFLARE_AUTH_REQUIRED",
        message: "Wrangler subprocess cannot read Cloudflare R2 because API-token authentication is unavailable.",
      };
    }

    if (/code:\s*10042|enable R2/i.test(output)) {
      return {
        name: "cloudflare.r2.enabled",
        status: "fail",
        code: "R2_NOT_ENABLED",
        message: "Cloudflare account R2 is not enabled. Enable R2 in the Cloudflare Dashboard before Worker deploy and staging photo smoke.",
      };
    }

    return {
      name: "cloudflare.r2.enabled",
      status: "fail",
      code: "R2_BUCKET_LIST_FAILED",
      message: "Could not list Cloudflare R2 buckets with Wrangler.",
    };
  }

  const missingBuckets = expectedBucketNames.filter((bucketName) => !output.includes(bucketName));
  if (missingBuckets.length > 0) {
    return {
      name: "cloudflare.r2.buckets",
      status: "fail",
      code: "R2_BUCKETS_MISSING",
      message: "Cloudflare R2 is enabled, but required project buckets are missing.",
      missingBuckets,
    };
  }

  return {
    name: "cloudflare.r2.buckets",
    status: "pass",
    message: "Cloudflare R2 is enabled and required project buckets are visible to Wrangler.",
    bucketCount: expectedBucketNames.length,
  };
}

export function classifyR2DevUrlResult(result, bucketName) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const name = `cloudflare.r2.${bucketName}.dev_url`;

  if (result.exitCode !== 0) {
    if (isWranglerAuthFailure(output)) {
      return {
        name,
        status: "fail",
        code: "CLOUDFLARE_AUTH_REQUIRED",
        message: "Wrangler cannot verify that the R2 public development URL is disabled.",
      };
    }

    if (/code:\s*10042|enable R2/i.test(output)) {
      return {
        name,
        status: "fail",
        code: "R2_NOT_ENABLED",
        message: "Cloudflare R2 is not enabled, so bucket privacy cannot be verified.",
      };
    }

    return {
      name,
      status: "fail",
      code: "R2_DEV_URL_CHECK_FAILED",
      message: "Wrangler could not prove that the R2 public development URL is disabled.",
    };
  }

  if (/Public access via the r2\.dev URL is disabled\./i.test(output)) {
    return {
      name,
      status: "pass",
      message: "The R2 public development URL is disabled.",
    };
  }

  if (/Public access is enabled at/i.test(output)) {
    return {
      name,
      status: "fail",
      code: "R2_PUBLIC_DEV_URL_ENABLED",
      message: "The R2 public development URL must be disabled before release.",
    };
  }

  return {
    name,
    status: "fail",
    code: "R2_DEV_URL_CHECK_FAILED",
    message: "Wrangler returned an unrecognized R2 public development URL state.",
  };
}

export function classifyR2CustomDomainListResult(result, bucketName) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const name = `cloudflare.r2.${bucketName}.custom_domains`;

  if (result.exitCode !== 0) {
    if (isWranglerAuthFailure(output)) {
      return {
        name,
        status: "fail",
        code: "CLOUDFLARE_AUTH_REQUIRED",
        message: "Wrangler cannot verify that the R2 bucket has no public custom domain.",
      };
    }

    if (/code:\s*10042|enable R2/i.test(output)) {
      return {
        name,
        status: "fail",
        code: "R2_NOT_ENABLED",
        message: "Cloudflare R2 is not enabled, so bucket privacy cannot be verified.",
      };
    }

    return {
      name,
      status: "fail",
      code: "R2_CUSTOM_DOMAIN_CHECK_FAILED",
      message: "Wrangler could not prove that the R2 bucket has no public custom domain.",
    };
  }

  if (/There are no custom domains connected to this bucket\./i.test(output)) {
    return {
      name,
      status: "pass",
      message: "The R2 bucket has no public custom domain.",
    };
  }

  if (/Listing custom domains connected to bucket/i.test(output)) {
    return {
      name,
      status: "fail",
      code: "R2_PUBLIC_CUSTOM_DOMAIN_CONFIGURED",
      message: "Direct R2 custom-domain access must be removed before release.",
    };
  }

  return {
    name,
    status: "fail",
    code: "R2_CUSTOM_DOMAIN_CHECK_FAILED",
    message: "Wrangler returned an unrecognized R2 custom-domain state.",
  };
}

export function classifyWorkerDeploymentResult(result, deployment) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const name = `worker_deployment.${deployment.envName}.${deployment.kind}`;

  if (result.exitCode !== 0) {
    if (isWranglerAuthFailure(output)) {
      return {
        name,
        status: "fail",
        code: "CLOUDFLARE_AUTH_REQUIRED",
        message: `Wrangler subprocess cannot read configured ${deployment.envName} ${deployment.kind} Worker deployments because API-token authentication is unavailable.`,
        workerName: deployment.workerName,
      };
    }

    if (/Worker does not exist|code:\s*10007/i.test(output)) {
      return {
        name,
        status: "fail",
        code: "WORKER_DEPLOYMENT_MISSING",
        message: `Configured ${deployment.envName} ${deployment.kind} Worker is not deployed to the Cloudflare account yet.`,
        workerName: deployment.workerName,
      };
    }

    return {
      name,
      status: "fail",
      code: "WORKER_DEPLOYMENT_CHECK_FAILED",
      message: `Could not read configured ${deployment.envName} ${deployment.kind} Worker deployments with Wrangler.`,
      workerName: deployment.workerName,
      outputTail: sanitizeWranglerOutput(tail(output, 1_500)),
    };
  }

  return {
    name,
    status: "pass",
    message: `Configured ${deployment.envName} ${deployment.kind} Worker has Cloudflare deployment history.`,
    workerName: deployment.workerName,
    deploymentCount: countJsonDeployments(output),
  };
}

export function classifyD1MigrationResult(result, envName) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const name = `cloudflare.d1.${envName}.migration_0006`;
  const transformBudgetName = `cloudflare.d1.${envName}.migration_0020`;
  const readAbuseBudgetName = `cloudflare.d1.${envName}.migration_0021`;
  const storageReleaseName = `cloudflare.d1.${envName}.migration_0022`;
  const anonymousSessionName = `cloudflare.d1.${envName}.migration_0023`;
  const anonymousSessionBudgetName = `cloudflare.d1.${envName}.migration_0024`;
  const placeRequestName = `cloudflare.d1.${envName}.migration_0025`;
  const apiCostGuardName = `cloudflare.d1.${envName}.migration_0026`;

  if (result.exitCode !== 0) {
    if (isWranglerAuthFailure(output)) {
      return {
        name,
        status: "fail",
        code: "CLOUDFLARE_AUTH_REQUIRED",
        message: `Wrangler subprocess cannot read remote ${envName} D1 because API-token authentication is unavailable.`,
      };
    }

    if (/no such table:\s*photo_read_abuse_budget/i.test(output)) {
      return {
        name: readAbuseBudgetName,
        status: "fail",
        code: "D1_0021_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the per-IP photo read abuse ledger.`,
      };
    }

    if (/no such table:\s*photo_storage_releases/i.test(output)) {
      return {
        name: storageReleaseName,
        status: "fail",
        code: "D1_0022_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the idempotent photo storage-release ledger.`,
      };
    }

    if (/no such table:\s*anonymous_sessions/i.test(output)) {
      return {
        name: anonymousSessionName,
        status: "fail",
        code: "D1_0023_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the server-bound anonymous session ledger.`,
      };
    }

    if (/no such table:\s*anonymous_session_issuance_budget/i.test(output)) {
      return {
        name: anonymousSessionBudgetName,
        status: "fail",
        code: "D1_0024_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the exact anonymous session issuance budget.`,
      };
    }

    if (/no such table:\s*place_addition_(?:requests|request_daily_budget)/i.test(output)) {
      return {
        name: placeRequestName,
        status: "fail",
        code: "D1_0025_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the private place addition request queue.`,
      };
    }

    if (/no such table:\s*api_cost_guard_(?:control|daily|reconciliations)/i.test(output)) {
      return {
        name: apiCostGuardName,
        status: "fail",
        code: "D1_0026_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the global Workers and D1 cost guard.`,
      };
    }

    if (/no such table:\s*photo_transform_budget/i.test(output)) {
      return {
        name: transformBudgetName,
        status: "fail",
        code: "D1_0020_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the Cloudflare Images transformation budget ledger.`,
      };
    }

    if (/no such (?:table|column):\s*(posts|questions|data_sources|dimension_settings|feature_flags|live_signals|aggregated_place_status|place_events|photo_moderation_states|report_votes|user_blocks|consents|terms_acceptances|account_deletion_requests|identity_link_events|anonymous_sessions|anonymous_session_issuance_budget|place_addition_requests|place_addition_request_daily_budget|api_cost_guard_control|api_cost_guard_daily|api_cost_guard_reconciliations|saved_places|saved_posts|followed_topics|notification_subscriptions|analytics_events|photo_cleanup_jobs|photo_storage_budget|photo_storage_releases|photo_upload_claims|photo_abuse_budget|photo_upload_control|photo_read_budget|photo_read_control|photo_read_abuse_budget|photo_transform_budget|source_ingestion_targets|field_report_publications|field_report_media|hashtags|field_report_hashtags|publication_outbox|accuracy_bucket|moderation_status|byte_size|lease_token|lease_expires_at|dead_lettered_at|updated_at)|SQLITE_ERROR/i.test(output)) {
      return {
        name,
        status: "fail",
        code: "D1_0006_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the V2 data-truth or trust-safety migrations.`,
      };
    }

    return {
      name,
      status: "fail",
      code: "D1_REMOTE_CHECK_FAILED",
      message: `Could not read remote ${envName} D1 migration state with Wrangler.`,
      outputTail: sanitizeWranglerOutput(tail(output, 1_500)),
    };
  }

  const counters = parseD1Counters(output);
  const missingSchema = [];
  if ((counters.posts_table ?? 0) < 1) missingSchema.push("posts");
  if ((counters.questions_table ?? 0) < 1) missingSchema.push("questions");
  if ((counters.post_indexes ?? 0) < 2) missingSchema.push("posts indexes");
  if ((counters.question_indexes ?? 0) < 2) missingSchema.push("questions indexes");
  if ((counters.v2_tables ?? 0) < 6) missingSchema.push("V2 data-truth tables");
  if ((counters.v2_flags ?? 0) < 7) missingSchema.push("V2 feature flags");
  if ((counters.v2_settings ?? 0) < 12) missingSchema.push("V2 dimension settings");
  if ((counters.source_registry ?? 0) < 8) missingSchema.push("V2 source registry");
  if ((counters.trust_safety_tables ?? 0) < 7) missingSchema.push("V2 trust-safety tables");
  if ((counters.live_signal_expiry_required ?? 0) < 1) missingSchema.push("required live-signal expiry");
  if ((counters.live_signals_missing_expiry ?? 0) > 0) missingSchema.push("live signals without expiry");
  if ((counters.place_event_accuracy_required ?? 0) < 1) missingSchema.push("required place-event accuracy bucket");
  if ((counters.place_event_accuracy_invalid ?? 0) > 0) missingSchema.push("invalid place-event accuracy buckets");
  if ((counters.preference_tables ?? 0) < 4) missingSchema.push("persistent preference tables");
  if ((counters.analytics_tables ?? 0) < 1) missingSchema.push("analytics events table");
  if ((counters.photo_cleanup_tables ?? 0) < 1) missingSchema.push("photo cleanup queue");
  if (
    (counters.photo_cleanup_delivery_columns ?? 0) < 6 ||
    (counters.photo_cleanup_delivery_indexes ?? 0) < 1
  ) {
    missingSchema.push("photo cleanup delivery worker");
  }
  if (counters.photo_cleanup_dead_letters !== 0) missingSchema.push("photo cleanup dead letters");
  if ((counters.photo_budget_tables ?? 0) < 1 || (counters.photo_budget_rows ?? 0) < 1) missingSchema.push("photo storage budget ledger");
  if (
    (counters.photo_storage_release_tables ?? 0) < 1 ||
    (counters.photo_storage_release_indexes ?? 0) < 1
  ) {
    missingSchema.push("idempotent photo storage-release ledger");
  }
  if (
    (counters.anonymous_session_tables ?? 0) < 1 ||
    (counters.anonymous_session_indexes ?? 0) < 1
  ) {
    missingSchema.push("server-bound anonymous session ledger");
  }
  if ((counters.anonymous_session_budget_tables ?? 0) < 1) {
    missingSchema.push("exact anonymous session issuance budget");
  }
  if (
    (counters.place_request_tables ?? 0) < 2 ||
    (counters.place_request_indexes ?? 0) < 2 ||
    (counters.place_request_triggers ?? 0) < 1
  ) {
    missingSchema.push("private place addition request queue");
  }
  if (
    (counters.api_cost_guard_tables ?? 0) < 3
    || (counters.api_cost_guard_indexes ?? 0) < 1
    || (counters.api_cost_guard_control_rows ?? 0) < 1
    || (counters.api_cost_guard_warning_columns ?? 0) < 2
  ) {
    missingSchema.push("global Workers and D1 cost guard");
  }
  if ((counters.photo_abuse_tables ?? 0) < 3 || (counters.photo_upload_control_rows ?? 0) < 1) missingSchema.push("photo abuse guard and emergency stop");
  if (
    (counters.photo_read_tables ?? 0) < 2 ||
    (counters.photo_read_budget_rows ?? 0) < 1 ||
    (counters.photo_read_control_rows ?? 0) < 1
  ) {
    missingSchema.push("photo Class B read budget and emergency stop");
  }
  if ((counters.photo_transform_budget_rows ?? 0) < 1) {
    missingSchema.push("Cloudflare Images transformation budget ledger");
  }
  if ((counters.photo_read_abuse_tables ?? 0) < 1) {
    missingSchema.push("per-IP photo read abuse ledger");
  }
  if (
    (counters.source_scheduler_tables ?? 0) < 1 ||
    (counters.source_scheduler_indexes ?? 0) < 2 ||
    typeof counters.source_scheduler_targets !== "number" ||
    typeof counters.source_scheduler_enabled_targets !== "number"
  ) {
    missingSchema.push("source ingestion scheduler");
  }
  if (counters.source_scheduler_invalid_active !== 0) {
    missingSchema.push("unsafe source ingestion scheduler targets");
  }
  if ((counters.place_event_moderation_required ?? 0) < 1) missingSchema.push("required field-report moderation status");
  if ((counters.publication_tables ?? 0) < 5) missingSchema.push("field-report publication tables");
  if (
    (counters.publication_delivery_columns ?? 0) < 5 ||
    (counters.publication_delivery_indexes ?? 0) < 1
  ) {
    missingSchema.push("publication outbox delivery worker");
  }
  if (counters.publication_dead_letters !== 0) missingSchema.push("publication outbox dead letters");

  if (missingSchema.length > 0) {
    const tailMigrationSchema = new Set([
      "Cloudflare Images transformation budget ledger",
      "per-IP photo read abuse ledger",
      "idempotent photo storage-release ledger",
      "server-bound anonymous session ledger",
      "exact anonymous session issuance budget",
      "private place addition request queue",
      "global Workers and D1 cost guard",
    ]);
    const onlyTailMigrationsMissing = missingSchema.every((item) => tailMigrationSchema.has(item));

    if (onlyTailMigrationsMissing && missingSchema.includes("Cloudflare Images transformation budget ledger")) {
      return {
        name: transformBudgetName,
        status: "fail",
        code: "D1_0020_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the Cloudflare Images transformation budget ledger.`,
        missingSchema,
      };
    }

    if (onlyTailMigrationsMissing && missingSchema.includes("per-IP photo read abuse ledger")) {
      return {
        name: readAbuseBudgetName,
        status: "fail",
        code: "D1_0021_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the per-IP photo read abuse ledger.`,
        missingSchema,
      };
    }

    if (onlyTailMigrationsMissing && missingSchema.includes("idempotent photo storage-release ledger")) {
      return {
        name: storageReleaseName,
        status: "fail",
        code: "D1_0022_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the idempotent photo storage-release ledger.`,
        missingSchema,
      };
    }

    if (onlyTailMigrationsMissing && missingSchema.includes("server-bound anonymous session ledger")) {
      return {
        name: anonymousSessionName,
        status: "fail",
        code: "D1_0023_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the server-bound anonymous session ledger.`,
        missingSchema,
      };
    }

    if (onlyTailMigrationsMissing && missingSchema.includes("exact anonymous session issuance budget")) {
      return {
        name: anonymousSessionBudgetName,
        status: "fail",
        code: "D1_0024_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the exact anonymous session issuance budget.`,
        missingSchema,
      };
    }

    if (onlyTailMigrationsMissing && missingSchema.includes("private place addition request queue")) {
      return {
        name: placeRequestName,
        status: "fail",
        code: "D1_0025_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the private place addition request queue.`,
        missingSchema,
      };
    }

    if (onlyTailMigrationsMissing && missingSchema.includes("global Workers and D1 cost guard")) {
      return {
        name: apiCostGuardName,
        status: "fail",
        code: "D1_0026_NOT_APPLIED",
        message: `Remote ${envName} D1 is missing the global Workers and D1 cost guard.`,
        missingSchema,
      };
    }

    return {
      name,
      status: "fail",
      code: "D1_0006_NOT_APPLIED",
      message: `Remote ${envName} D1 is missing ${missingSchema.join(", ")} from the V2 migration chain.`,
      missingSchema,
    };
  }

  const missingSeed = [];
  if ((counters.posts ?? 0) < 4) missingSeed.push("posts");
  if ((counters.questions ?? 0) < 3) missingSeed.push("questions");

  if (missingSeed.length > 0) {
    return {
      name: `cloudflare.d1.${envName}.seed_posts_questions`,
      status: "fail",
      code: "D1_SEED_INCOMPLETE",
      message: `Remote ${envName} D1 posts/questions seed evidence is incomplete.`,
      missingSeed,
      counts: counters,
    };
  }

  return {
    name,
    status: "pass",
    message: `Remote ${envName} D1 has V2 data-truth schema and core seed evidence.`,
    counts: {
      posts: counters.posts,
      questions: counters.questions,
    },
  };
}

export function classifyCloudflareAuthResult(result) {
  return {
    name: "cloudflare.auth",
    status: result.exitCode === 0 ? "pass" : "fail",
    ...(result.exitCode === 0 ? {} : { code: "CLOUDFLARE_AUTH_REQUIRED" }),
    message:
      result.exitCode === 0
        ? "Wrangler OAuth or API token is available."
        : "Wrangler cannot read the Cloudflare account. Set CLOUDFLARE_API_TOKEN or complete Wrangler login before remote R2/D1 evidence checks.",
  };
}

export function classifyAuthBlockedRemoteCheck(name, subject) {
  return {
    name,
    status: "fail",
    code: "CLOUDFLARE_AUTH_REQUIRED",
    message: `${subject} was skipped because Wrangler Cloudflare auth is not available.`,
  };
}

function isWranglerAuthFailure(output) {
  return /CLOUDFLARE_API_TOKEN|In a non-interactive environment.*wrangler|EPERM.*\.wrangler/i.test(output);
}

export function sanitizeWranglerOutput(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[a-f0-9]{32}\b/gi, "[redacted-account-id]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/g, "Bearer [redacted]")
    .replace(/(CLOUDFLARE_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s"']+/g, "$1[redacted]");
}

export function classifyDeploymentUrlState(env = process.env, targetEnvs = DEFAULT_ENVS) {
  const checks = [];
  const parsedUrls = new Map();

  for (const envName of targetEnvs) {
    const requirements = DEPLOYMENT_URL_ENV_BY_ENV[envName];
    if (!requirements) {
      continue;
    }

    for (const [kind, envVarName] of Object.entries(requirements)) {
      const check = classifyDeploymentUrl(env[envVarName], `deployment_url.${envName}.${kind}`, envVarName);
      checks.push(check);
      if (check.status === "pass") {
        parsedUrls.set(`${envName}.${kind}`, check.href);
        delete check.href;
      }
    }
  }

  checks.push(...classifySeparatedDeploymentUrls(parsedUrls));
  return checks;
}

export function classifyApiAllowedOriginsState(env = process.env, targetEnvs = DEFAULT_ENVS) {
  const checks = [];

  for (const envName of targetEnvs) {
    const envVarName = API_ALLOWED_ORIGINS_ENV_BY_ENV[envName];
    const pagesEnvVarName = DEPLOYMENT_URL_ENV_BY_ENV[envName]?.pages;
    if (!envVarName || !pagesEnvVarName) {
      continue;
    }

    const rawValue = env[envVarName];
    if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
      checks.push({
        name: `api_allowed_origins.${envName}`,
        status: "fail",
        code: "API_ALLOWED_ORIGINS_REQUIRED",
        message: `${envVarName} is required and must contain the exact ${envName} Pages origin.`,
      });
      continue;
    }

    const origins = rawValue.split(",").map((value) => value.trim()).filter(Boolean);
    if (origins.length === 0 || origins.some((origin) => !isExactHttpsOrigin(origin))) {
      checks.push({
        name: `api_allowed_origins.${envName}`,
        status: "fail",
        code: "API_ALLOWED_ORIGINS_INVALID",
        message: `${envVarName} must contain comma-separated exact HTTPS origins without wildcards, paths, queries, or fragments.`,
      });
      continue;
    }

    const pagesOrigin = safeHttpsOrigin(env[pagesEnvVarName]);
    if (!pagesOrigin || !origins.includes(pagesOrigin)) {
      checks.push({
        name: `api_allowed_origins.${envName}`,
        status: "fail",
        code: "API_ALLOWED_ORIGINS_MISSING_PAGES_ORIGIN",
        message: `${envVarName} must include the exact origin from ${pagesEnvVarName}.`,
      });
      continue;
    }

    checks.push({
      name: `api_allowed_origins.${envName}`,
      status: "pass",
      message: `${envVarName} includes the exact ${envName} Pages origin.`,
      originCount: origins.length,
    });
  }

  return checks;
}

export function summarizeExternalStateBlockers(failedChecks) {
  const blockers = [];
  const seen = new Set();

  for (const check of failedChecks) {
    const blocker = externalStateBlockerForCheck(check);
    if (blocker && !seen.has(blocker)) {
      seen.add(blocker);
      blockers.push(blocker);
    }
  }

  return blockers;
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    printHelp();
    return;
  }

  const configPath = options.get("config") ?? DEFAULT_CONFIG_PATH;
  const frontendConfigPath = options.get("frontend-config") ?? DEFAULT_FRONTEND_CONFIG_PATH;
  const targetEnvs = options.get("env") ? options.get("env").split(",").map((envName) => envName.trim()).filter(Boolean) : DEFAULT_ENVS;
  const timeoutMs = numberOption(options.get("timeout-ms") ?? process.env.SILSIGAN_CLOUDFLARE_EXTERNAL_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const checks = [];

  let expectedBucketNames = [];
  let expectedD1Databases = [];
  let expectedWorkerDeployments = [];
  try {
    expectedBucketNames = await readExpectedR2BucketNames(configPath, targetEnvs);
    record(checks, "wrangler.config.r2Buckets", "pass", "Expected R2 bucket names were read from wrangler config.", {
      bucketCount: expectedBucketNames.length,
    });
  } catch (error) {
    record(checks, "wrangler.config.r2Buckets", "fail", publicErrorMessage(error));
  }

  try {
    expectedD1Databases = await readExpectedD1Databases(configPath, targetEnvs);
    record(checks, "wrangler.config.d1Databases", "pass", "Expected D1 database names were read from wrangler config.", {
      databaseCount: expectedD1Databases.filter((database) => database.databaseName).length,
    });
  } catch (error) {
    record(checks, "wrangler.config.d1Databases", "fail", publicErrorMessage(error));
  }

  try {
    expectedWorkerDeployments = await readExpectedWorkerDeployments(configPath, frontendConfigPath, targetEnvs);
    record(checks, "wrangler.config.workerDeployments", "pass", "Expected API and web Worker names were read from Wrangler configs.", {
      workerCount: expectedWorkerDeployments.filter((deployment) => deployment.workerName).length,
    });
  } catch (error) {
    record(checks, "wrangler.config.workerDeployments", "fail", publicErrorMessage(error));
  }

  let cloudflareAuthBlocked = false;
  if (!flags.has("skip-whoami")) {
    const whoami = await runCommand("npx", ["--yes", "wrangler", "whoami"], timeoutMs);
    const authCheck = classifyCloudflareAuthResult(whoami);
    checks.push(authCheck);
    cloudflareAuthBlocked = authCheck.status === "fail";
  }

  if (!flags.has("skip-r2")) {
    const r2BucketCheck = cloudflareAuthBlocked
      ? classifyAuthBlockedRemoteCheck("cloudflare.r2.enabled", "R2 bucket visibility check")
      : classifyR2BucketListResult(await runCommand("npx", ["--yes", "wrangler", "r2", "bucket", "list"], timeoutMs), expectedBucketNames);
    checks.push(r2BucketCheck);

    if (r2BucketCheck.status === "pass") {
      for (const bucketName of expectedBucketNames) {
        checks.push(
          classifyR2DevUrlResult(
            await runCommand(
              "npx",
              ["--yes", "wrangler", "r2", "bucket", "dev-url", "get", bucketName, "--config", configPath],
              timeoutMs,
            ),
            bucketName,
          ),
        );
        checks.push(
          classifyR2CustomDomainListResult(
            await runCommand(
              "npx",
              ["--yes", "wrangler", "r2", "bucket", "domain", "list", bucketName, "--config", configPath],
              timeoutMs,
            ),
            bucketName,
          ),
        );
      }
    }
  }

  if (!flags.has("skip-worker-deployments")) {
    for (const deployment of expectedWorkerDeployments) {
      if (!deployment.workerName) {
        record(
          checks,
          `worker_deployment.${deployment.envName}.${deployment.kind}`,
          "fail",
          `${deployment.configPath} must define a Worker name for ${deployment.envName} ${deployment.kind}.`,
          { code: "WORKER_NAME_REQUIRED" },
        );
        continue;
      }

      checks.push(
        cloudflareAuthBlocked
          ? classifyAuthBlockedRemoteCheck(`worker_deployment.${deployment.envName}.${deployment.kind}`, `${deployment.envName} ${deployment.kind} Worker deployment check`)
          : classifyWorkerDeploymentResult(
              await runCommand("npx", ["--yes", "wrangler", "deployments", "list", "--config", deployment.configPath, "--env", deployment.envName, "--json"], timeoutMs),
              deployment,
            ),
      );
    }
  }

  if (!flags.has("skip-deployment-urls")) {
    checks.push(...classifyDeploymentUrlState(process.env, targetEnvs));
    checks.push(...classifyApiAllowedOriginsState(process.env, targetEnvs));
  }

  if (!flags.has("skip-d1")) {
    for (const database of expectedD1Databases) {
      if (!database.databaseName) {
        record(
          checks,
          `cloudflare.d1.${database.envName}.database_name`,
          "fail",
          `workers/api wrangler config must define a D1 database_name for ${database.envName}.`,
          { code: "D1_DATABASE_NAME_REQUIRED" },
        );
        continue;
      }

      if (cloudflareAuthBlocked) {
        checks.push(classifyAuthBlockedRemoteCheck(`cloudflare.d1.${database.envName}.migration_0006`, `Remote ${database.envName} D1 migration evidence check`));
        continue;
      }

      const boundaryResult = await runCommand(
        "npx",
        [
          "--yes",
          "wrangler",
          "d1",
          "execute",
          database.databaseName,
          "--remote",
          "--env",
          database.envName,
          "--config",
          configPath,
          "--command",
          D1_MIGRATION_BOUNDARY_QUERY,
        ],
        timeoutMs,
      );
      const boundaryCheck = classifyD1MigrationBoundary(boundaryResult, database.envName, {
        sanitizeOutput: sanitizeWranglerOutput,
      });
      checks.push(boundaryCheck);
      if (boundaryCheck.status === "fail") {
        continue;
      }

      const d1Result = await runCommand(
        "npx",
        [
          "--yes",
          "wrangler",
          "d1",
          "execute",
          database.databaseName,
          "--remote",
          "--env",
          database.envName,
          "--config",
          configPath,
          "--command",
          D1_RELEASE_EVIDENCE_QUERY,
        ],
        timeoutMs,
      );
      checks.push(classifyD1MigrationResult(d1Result, database.envName));
    }
  }

  if (!flags.has("skip-dry-run")) {
    for (const envName of targetEnvs) {
      const dryRun = await runCommand("npx", ["--yes", "wrangler", "deploy", "--dry-run", "--env", envName, "--config", configPath], timeoutMs);
      record(
        checks,
        `wrangler.dryRun.${envName}`,
        dryRun.exitCode === 0 ? "pass" : "fail",
        dryRun.exitCode === 0
          ? `Wrangler ${envName} dry-run completed with configured bindings.`
          : `Wrangler ${envName} dry-run failed.`,
        dryRun.exitCode === 0 ? {} : { code: "WRANGLER_DRY_RUN_FAILED", outputTail: sanitizeWranglerOutput(tail(`${dryRun.stdout}\n${dryRun.stderr}`, 1_500)) },
      );
    }
  }

  const failed = checks.filter((check) => check.status === "fail");
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        configPath,
        frontendConfigPath,
        envs: targetEnvs,
        checks,
        blockers: summarizeExternalStateBlockers(failed),
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4, env: process.env }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

function classifyDeploymentUrl(value, name, envVarName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      name,
      status: "fail",
      code: "DEPLOYMENT_URL_REQUIRED",
      message: `${envVarName} is required.`,
    };
  }

  if (hasPlaceholder(value)) {
    return {
      name,
      status: "fail",
      code: "DEPLOYMENT_URL_PLACEHOLDER",
      message: `${envVarName} still contains a placeholder.`,
    };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return {
      name,
      status: "fail",
      code: "DEPLOYMENT_URL_INVALID",
      message: `${envVarName} must be a valid absolute URL.`,
    };
  }

  const reasons = [];
  if (url.protocol !== "https:") reasons.push("https_required");
  if (url.username || url.password) reasons.push("credentials_forbidden");
  if (url.search || url.hash) reasons.push("query_or_fragment_forbidden");
  if (isLocalhost(url.hostname)) reasons.push("localhost_forbidden");

  if (reasons.length > 0) {
    return {
      name,
      status: "fail",
      code: "DEPLOYMENT_URL_UNSAFE",
      message: `${envVarName} must be a deployed HTTPS URL without credentials, query params, fragments, or localhost hosts.`,
      reasons,
    };
  }

  return {
    name,
    status: "pass",
    message: `${envVarName} is present and deployment-shaped.`,
    host: url.host,
    href: url.href,
  };
}

function classifySeparatedDeploymentUrls(parsedUrls) {
  return [
    classifyUrlSeparation(parsedUrls, "staging.pages", "production.pages", "staging and production Pages URLs must not be identical."),
    classifyUrlSeparation(parsedUrls, "staging.worker_api", "production.worker_api", "staging and production Worker API URLs must not be identical."),
  ].filter(Boolean);
}

function classifyUrlSeparation(parsedUrls, leftKey, rightKey, message) {
  const left = parsedUrls.get(leftKey);
  const right = parsedUrls.get(rightKey);
  if (!left || !right) {
    return null;
  }

  return {
    name: `deployment_urls.${leftKey}.${rightKey}`,
    status: left !== right ? "pass" : "fail",
    ...(left === right ? { code: "DEPLOYMENT_URL_DUPLICATE" } : {}),
    message,
  };
}

function externalStateBlockerForCheck(check) {
  if (!isRecord(check)) {
    return null;
  }

  if (FIELD_SPECIFIC_BLOCKER_CODES.has(check.code) || CHECK_SPECIFIC_BLOCKER_CODES.has(check.code)) {
    return typeof check.name === "string" ? check.name : check.code;
  }

  if (typeof check.code === "string" && check.code.length > 0) {
    return check.code;
  }

  return typeof check.name === "string" ? check.name : null;
}

function hasPlaceholder(value) {
  return /TODO|^<.*>$|REPLACE_ME|CHANGE_ME/i.test(String(value));
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || /^127\./.test(hostname) || hostname.endsWith(".local");
}

function isExactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch {
    return false;
  }
}

function safeHttpsOrigin(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function readWranglerConfig(configPath) {
  return JSON.parse(stripJsonComments(await readFile(configPath, "utf8")));
}

function readWorkerNamesFromConfig(config, configPath, kind, targetEnvs) {
  const expected = [];

  for (const envName of targetEnvs) {
    const envConfig = envName === "" ? config : config.env?.[envName];
    expected.push({
      envName,
      kind,
      configPath,
      workerName: typeof envConfig?.name === "string" && envConfig.name.length > 0 ? envConfig.name : null,
    });
  }

  return expected;
}

function parseD1Counters(output) {
  const counters = {};
  const matcher = /\b(posts_table|questions_table|post_indexes|question_indexes|v2_tables|v2_flags|v2_settings|source_registry|trust_safety_tables|live_signal_expiry_required|live_signals_missing_expiry|place_event_accuracy_required|place_event_accuracy_invalid|preference_tables|analytics_tables|photo_cleanup_tables|photo_cleanup_delivery_columns|photo_cleanup_delivery_indexes|photo_cleanup_dead_letters|photo_budget_tables|photo_budget_rows|photo_storage_release_tables|photo_storage_release_indexes|anonymous_session_tables|anonymous_session_indexes|anonymous_session_budget_tables|place_request_tables|place_request_indexes|place_request_triggers|api_cost_guard_tables|api_cost_guard_indexes|api_cost_guard_control_rows|api_cost_guard_warning_columns|photo_abuse_tables|photo_upload_control_rows|photo_read_tables|photo_read_budget_rows|photo_read_control_rows|photo_read_abuse_tables|photo_transform_budget_rows|source_scheduler_tables|source_scheduler_indexes|source_scheduler_targets|source_scheduler_enabled_targets|source_scheduler_invalid_active|place_event_moderation_required|publication_tables|publication_delivery_columns|publication_delivery_indexes|publication_dead_letters|posts|questions)=(\d+)\b/g;
  let match = matcher.exec(output);
  while (match) {
    counters[match[1]] = Number(match[2]);
    match = matcher.exec(output);
  }
  return counters;
}

function countJsonDeployments(output) {
  try {
    const value = JSON.parse(output);
    if (Array.isArray(value)) return value.length;
    if (Array.isArray(value?.items)) return value.items.length;
    if (Array.isArray(value?.deployments)) return value.deployments.length;
  } catch {
    return null;
  }

  return null;
}

function record(checks, name, status, message, details = {}) {
  checks.push({ name, status, message, ...details });
}

function tail(value, limit) {
  return value.length <= limit ? value : value.slice(value.length - limit);
}

function numberOption(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function publicErrorMessage(error) {
  return error instanceof Error ? error.message : "Unknown Cloudflare external state error.";
}

function printHelp() {
  console.log(`Usage: node scripts/cloudflare-external-state-check.mjs [--env=staging,production] [--config=workers/api/wrangler.jsonc]

Checks non-mutating Cloudflare account state needed before staging release evidence:
  wrangler whoami
  wrangler r2 bucket list
  configured API/web Worker deployment history
  remote D1 posts/questions migration and seed read check
  staging/production deployment URL shape
  wrangler deploy --dry-run --env <env>

Options:
  --skip-whoami           Skip Wrangler OAuth/account read check.
  --skip-r2               Skip R2 account and bucket visibility check.
  --skip-worker-deployments Skip configured API/web Worker deployment history checks.
  --skip-d1               Skip remote D1 migration and seed evidence check.
  --skip-deployment-urls  Skip staging/production deployment URL shape checks.
  --skip-dry-run          Skip Worker dry-run checks.
  --timeout-ms N          Per-command timeout.
  --frontend-config PATH  Frontend Worker Wrangler config. Default: wrangler.jsonc.
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

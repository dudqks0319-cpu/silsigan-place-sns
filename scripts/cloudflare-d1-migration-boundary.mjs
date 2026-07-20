export const D1_MIGRATION_BOUNDARY_QUERY = [
  "SELECT 'm0006_core_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('posts', 'questions')",
  "SELECT 'm0006_core_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_posts_place_created', 'idx_posts_status_created', 'idx_questions_place_created', 'idx_questions_anon_created')",
  "SELECT 'm0006_v2_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('data_sources', 'dimension_settings', 'feature_flags', 'decision_profiles', 'live_signals', 'aggregated_place_status')",
  "SELECT 'm0006_trust_safety_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_moderation_states', 'report_votes', 'user_blocks', 'consents', 'terms_acceptances', 'account_deletion_requests', 'identity_link_events')",
  "SELECT 'm0006_preference_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('saved_places', 'saved_posts', 'followed_topics', 'notification_subscriptions')",
  "SELECT 'm0006_analytics_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'analytics_events'",
  "SELECT 'm0006_photo_cleanup_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_cleanup_jobs'",
  "SELECT 'm0006_photo_budget_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_storage_budget'",
  "SELECT 'm0006_photo_abuse_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_upload_claims', 'photo_abuse_budget', 'photo_upload_control')",
  "SELECT 'm0006_photo_read_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('photo_read_budget', 'photo_read_control')",
  "SELECT 'm0006_publication_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('field_report_publications', 'field_report_media', 'hashtags', 'field_report_hashtags', 'publication_outbox')",
  "SELECT 'm0006_live_signal_expiry=' || COUNT(*) FROM pragma_table_info('live_signals') WHERE name = 'expires_at' AND \"notnull\" = 1",
  "SELECT 'm0006_place_accuracy=' || COUNT(*) FROM pragma_table_info('place_events') WHERE name = 'accuracy_bucket' AND \"notnull\" = 1",
  "SELECT 'm0006_place_moderation=' || COUNT(*) FROM pragma_table_info('place_events') WHERE name = 'moderation_status' AND \"notnull\" = 1",
  "SELECT 'm0018_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'source_ingestion_targets'",
  "SELECT 'm0018_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_source_ingestion_targets_due', 'idx_source_ingestion_targets_lease')",
  "SELECT 'm0019_cleanup_columns=' || COUNT(*) FROM pragma_table_info('photo_cleanup_jobs') WHERE name IN ('byte_size', 'lease_token', 'lease_expires_at', 'budget_released_at', 'dead_lettered_at', 'updated_at')",
  "SELECT 'm0019_cleanup_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_photo_cleanup_jobs_pending'",
  "SELECT 'm0019_publication_columns=' || COUNT(*) FROM pragma_table_info('publication_outbox') WHERE name IN ('lease_token', 'lease_expires_at', 'last_error_code', 'dead_lettered_at', 'updated_at')",
  "SELECT 'm0019_publication_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_publication_outbox_delivery'",
  "SELECT 'm0020_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_transform_budget'",
  "SELECT 'm0021_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_read_abuse_budget'",
  "SELECT 'm0021_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_photo_read_abuse_budget_updated'",
  "SELECT 'm0022_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'photo_storage_releases'",
  "SELECT 'm0022_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_photo_storage_releases_released'",
  "SELECT 'm0023_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'anonymous_sessions'",
  "SELECT 'm0023_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_anonymous_sessions_status_expiry'",
  "SELECT 'm0024_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'anonymous_session_issuance_budget'",
  "SELECT 'm0025_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('place_addition_requests', 'place_addition_request_daily_budget')",
  "SELECT 'm0025_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_place_addition_requests_owner_created', 'idx_place_addition_requests_queue')",
  "SELECT 'm0025_triggers=' || COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name IN ('trg_place_addition_requests_daily_guard', 'trg_place_addition_requests_terminal_status')",
  "SELECT 'm0026_tables=' || COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('api_cost_guard_control', 'api_cost_guard_daily', 'api_cost_guard_reconciliations')",
  "SELECT 'm0026_indexes=' || COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_api_cost_guard_reconcile_day'",
  "SELECT 'm0026_warning_columns=' || COUNT(*) FROM pragma_table_info('api_cost_guard_daily') WHERE name IN ('warned_percent', 'warned_metric')",
].join("; ");

const MIGRATION_BOUNDARIES = Object.freeze([
  {
    version: "0006",
    label: "V2 data-truth and trust-safety foundation",
    requirements: {
      m0006_core_tables: 2,
      m0006_core_indexes: 4,
      m0006_v2_tables: 6,
      m0006_trust_safety_tables: 7,
      m0006_preference_tables: 4,
      m0006_analytics_tables: 1,
      m0006_photo_cleanup_tables: 1,
      m0006_photo_budget_tables: 1,
      m0006_photo_abuse_tables: 3,
      m0006_photo_read_tables: 2,
      m0006_publication_tables: 5,
      m0006_live_signal_expiry: 1,
      m0006_place_accuracy: 1,
      m0006_place_moderation: 1,
    },
  },
  {
    version: "0018",
    label: "source ingestion scheduler",
    requirements: { m0018_tables: 1, m0018_indexes: 2 },
  },
  {
    version: "0019",
    label: "background delivery fencing",
    requirements: {
      m0019_cleanup_columns: 6,
      m0019_cleanup_indexes: 1,
      m0019_publication_columns: 5,
      m0019_publication_indexes: 1,
    },
  },
  {
    version: "0020",
    label: "photo transformation budget",
    requirements: { m0020_tables: 1 },
  },
  {
    version: "0021",
    label: "photo read-abuse budget",
    requirements: { m0021_tables: 1, m0021_indexes: 1 },
  },
  {
    version: "0022",
    label: "photo storage-release ledger",
    requirements: { m0022_tables: 1, m0022_indexes: 1 },
  },
  {
    version: "0023",
    label: "server-bound anonymous sessions",
    requirements: { m0023_tables: 1, m0023_indexes: 1 },
  },
  {
    version: "0024",
    label: "anonymous-session issuance budget",
    requirements: { m0024_tables: 1 },
  },
  {
    version: "0025",
    label: "private place-addition request queue",
    requirements: { m0025_tables: 2, m0025_indexes: 2, m0025_triggers: 2 },
  },
  {
    version: "0026",
    label: "global Workers and D1 cost guard",
    requirements: { m0026_tables: 3, m0026_indexes: 1, m0026_warning_columns: 2 },
  },
]);

export function classifyD1MigrationBoundary(result, envName, { sanitizeOutput = defaultSanitizeOutput } = {}) {
  const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
  const baseName = `cloudflare.d1.${envName}.migration_boundary`;
  if (result?.exitCode !== 0) {
    return {
      name: baseName,
      status: "fail",
      code: "D1_MIGRATION_BOUNDARY_CHECK_FAILED",
      message: `Could not read the remote ${envName} D1 migration boundary safely.`,
      outputTail: sanitizeOutput(output.slice(-1_500)),
    };
  }

  const counters = parseMigrationBoundaryCounters(output);
  for (const boundary of MIGRATION_BOUNDARIES) {
    const missingRequirements = Object.entries(boundary.requirements)
      .filter(([key, minimum]) => (counters[key] ?? 0) < minimum)
      .map(([key]) => key);
    if (missingRequirements.length > 0) {
      return {
        name: `cloudflare.d1.${envName}.migration_${boundary.version}`,
        status: "fail",
        code: `D1_${boundary.version}_NOT_APPLIED`,
        message: `Remote ${envName} D1 first becomes incomplete at migration ${boundary.version} (${boundary.label}).`,
        missingRequirements,
      };
    }
  }

  return {
    name: `cloudflare.d1.${envName}.migration_0026`,
    status: "pass",
    message: `Remote ${envName} D1 schema boundaries through migration 0026 are present.`,
  };
}

function parseMigrationBoundaryCounters(output) {
  const counters = {};
  const value = String(output ?? "");
  const matcher = /\b(m\d{4}_[a-z0-9_]+)=(\d+)\b/g;
  let match = matcher.exec(value);
  while (match) {
    counters[match[1]] = Number(match[2]);
    match = matcher.exec(value);
  }
  return counters;
}

function defaultSanitizeOutput(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[a-f0-9]{32}\b/gi, "[redacted-account-id]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/g, "Bearer [redacted]");
}

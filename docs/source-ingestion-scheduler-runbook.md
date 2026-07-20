# Official source ingestion scheduler runbook

Updated: 2026-07-19  
Scope: staging-first automatic ingestion for approved public data sources. This runbook does not authorize a production deployment or source activation.

## Current state

- Migrations `0018_source_ingestion_scheduler.sql` and `0019_background_job_delivery.sql` are applied to Staging; the Worker `scheduled()` handler is ready locally but the API Worker is not deployed.
- Staging and production declare `*/5 * * * *` so photo cleanup and publication delivery can run in both environments. Root development has no Cron.
- `SILSIGAN_SOURCE_INGESTION_SCHEDULED=1` exists only in staging. Production is fixed to `0`, so production Cron cannot call external data providers before separate rights approval.
- Staging D1 is remotely verified through `0025`, including `0018` and `0019`; the external-state gate also verifies zero unsafe active targets. Only `0026` remains pending.
- No scheduler target is seeded. Every new target defaults to `enabled=0`, so deploying the code alone cannot call a provider.
- R2 is not enabled and the API Worker does not exist yet. No scheduled ingestion is currently running.

## Security invariants

The scheduler must preserve all of these conditions:

1. Only `kma_weather`, `national_traffic`, and `seoul_realtime_city` may run automatically. Static metadata sources and unlisted adapters fail closed.
2. A target cannot run until its source is enabled, its commercial-use state is `allowed` or `allowed_with_attribution`, its health is `healthy` or `degraded`, its region is allowed, and any feature flag is enabled.
3. Provider credentials are Worker secrets only. `adapter_config_json` must contain public query coordinates or identifiers, never `serviceKey`, `apiKey`, `token`, bearer values, or account data.
4. Each run claims at most 10 due targets with a four-minute lease. Conditional `UPDATE ... RETURNING` claims and completion fencing prevent an expired worker from overwriting a newer lease.
5. One provider failure does not stop other targets. Failures receive exponential backoff capped at six hours and expose only stable error codes.
6. Platform retries are disabled for the Cron event. Logs contain aggregate counts and error-code totals only; target configuration, keys, provider payloads, raw coordinates, and request bodies are not logged.
7. KMA base date/time is generated at execution time in Korea Standard Time. Before minute 45, the previous observation hour is requested; stored stale time fields are ignored.
8. The effective interval is the larger of the target interval and source interval, so a target cannot over-poll a provider by requesting a shorter cadence.
9. Cron availability is not source authorization. External source ingestion runs only when `SILSIGAN_SOURCE_INGESTION_SCHEDULED=1`; photo cleanup and publication outbox processing remain independent.
10. Cleanup and publication jobs use separate conditional leases and completion fencing. Failures use bounded backoff and dead-letter after the configured maximum; logs expose only aggregate counts and stable error codes.
11. Photo cleanup releases reserved storage bytes at most once and only after the R2 object is gone or confirmed absent. Publication fanout is server-authored; clients cannot publish into realtime rooms.

## Local fixture fallback evidence

- [x] `pnpm evidence:public-sources` executes the real KMA, TourAPI, national parking, national traffic, national CCTV, and Seoul realtime adapters with deterministic validated fixtures.
- [x] All six sources prove `network` → `fresh` → bounded `stale`/`degraded` → `insufficient` after expiry, with stable `SOURCE_HTTP_ERROR` terminal codes.
- [x] Live/periodic sources retain provider observation time plus bounded expiry; static sources remain metadata-only and never become current-state signals.
- [x] The aggregate-only artifact contains no credential marker, request URL, provider payload, raw coordinate, or stream field: `artifacts/public-source-fallback-local/public-source-fallback.json`.

This is local pre-activation evidence only. It does not satisfy the staging checklist below, prove provider rights, consume a real quota, or authorize a source target.

## Pre-activation checklist

Do not enable any target until all boxes are recorded in the release evidence:

- [ ] Source terms, commercial use, attribution text, cache/retention, and display requirements have named legal and data-operations approval.
- [ ] Source registry `enabled`, `commercial_use_status`, `health_status`, and `enabled_regions_json` are correct and audited.
- [ ] The provider credential is installed as a Worker secret (`KMA_SERVICE_KEY`, `ITS_SERVICE_KEY`, or `SEOUL_REALTIME_SERVICE_KEY`) and is absent from Git, D1, logs, and browser code.
- [ ] Provider quota and expected calls per day are calculated from the effective refresh interval and enabled target count.
- [ ] Provider `observedAt`, local `fetchedAt`, TTL, attribution, stale behavior, and circuit-breaker behavior pass staging evidence.
- [ ] The target remains `enabled=0` during review, and its place/source mapping is verified.
- [ ] For Seoul, `SEOUL_REALTIME_ENABLED` and the Seoul region flag remain off until the separate regional approval is complete.
- [x] Migrations `0018` and `0019` are applied to staging; the read-only classifier verifies their required tables/indexes and zero unsafe active targets.
- [ ] `photo_cleanup_jobs` and `publication_outbox` show zero dead-letter rows before external staging writes are enabled.

## Disabled target templates

These templates intentionally create disabled rows. Replace only public coordinates or identifiers; never add a credential to JSON.

```sql
INSERT INTO source_ingestion_targets (
  id, source_id, place_id, adapter_config_json,
  enabled, refresh_interval_seconds, next_run_at
) VALUES (
  'target-kma-busan-gwangalli',
  'source-kma-weather',
  'busan-gwangalli',
  json_object('nx', 98, 'ny', 76),
  0,
  3600,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO source_ingestion_targets (
  id, source_id, place_id, adapter_config_json,
  enabled, refresh_interval_seconds, next_run_at
) VALUES (
  'target-traffic-busan-gwangalli',
  'source-national-traffic',
  'busan-gwangalli',
  json_object(
    'linkId', 'REVIEWED_LINK_ID',
    'roadType', 'all',
    'minLng', 129.10,
    'maxLng', 129.14,
    'minLat', 35.14,
    'maxLat', 35.17
  ),
  0,
  600,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO source_ingestion_targets (
  id, source_id, place_id, adapter_config_json,
  enabled, refresh_interval_seconds, next_run_at
) VALUES (
  'target-seoul-reviewed-area',
  'source-seoul-realtime',
  'REVIEWED_SEOUL_PLACE_ID',
  json_object('areaName', 'REVIEWED_AREA_NAME', 'areaCode', 'REVIEWED_AREA_CODE'),
  0,
  600,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
```

After the checklist is signed, enable one staging target at a time:

```sql
UPDATE source_ingestion_targets
SET enabled = 1,
    next_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'REVIEWED_TARGET_ID' AND enabled = 0;
```

## Observation

Use redacted aggregate queries. Do not select `adapter_config_json` into shared evidence.

```sql
SELECT
  id,
  source_id,
  place_id,
  enabled,
  next_run_at,
  lease_until,
  last_started_at,
  last_succeeded_at,
  last_failed_at,
  consecutive_failures,
  last_error_code
FROM source_ingestion_targets
ORDER BY id;

SELECT source_id, status, COUNT(*) AS run_count
FROM api_ingestion_runs
GROUP BY source_id, status
ORDER BY source_id, status;
```

Also review Cloudflare Cron Events, Worker error rates, provider quotas, `source_health_logs`, fresh/expired signal counts, and the cost controls in `docs/cloudflare-cost-usage-runbook.md`.

## Immediate stop and rollback

Disable all automatic calls first; this is safe and reversible:

```sql
UPDATE source_ingestion_targets
SET enabled = 0,
    lease_token = NULL,
    lease_until = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
```

Then set `SILSIGAN_SOURCE_INGESTION_SCHEDULED=0` in staging and deploy only after review. Keep the Cron itself so photo cleanup and publication delivery continue. Production must remain `0`. Do not delete observations during an incident; expire or hide them through the existing source-health and TTL controls so the audit trail remains intact.

Stop immediately when rights become unclear, credentials leak, provider quota rises unexpectedly, leases stay stuck, consecutive failures repeat, logs contain payload data, or fresh signals cannot be distinguished from stale data.

## Nationwide scaling limit

The product can expose nationwide search while operating approved sources only where targets exist. A missing target must render `최근 확인 정보 없음`, never synthetic live data. The current sequential batch of 10 is suitable for a small reviewed beta set. Before hundreds of targets are enabled, move fan-out to a bounded queue or Durable Object coordinator, define provider-specific concurrency and quota budgets, and load-test failure isolation. Do not scale by merely increasing the Cron frequency or batch size.

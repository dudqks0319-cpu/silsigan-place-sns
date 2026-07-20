# #실시간 Cloudflare cost and usage runbook

Updated: 2026-07-20
Scope: Cloudflare-backed TestFlight MVP cost and usage monitoring for staging and production. This runbook does not authorize App Store production submission.

## Ownership

| Role | Owner | Responsibility |
| --- | --- | --- |
| Release owner | PM/operator | Decide whether TestFlight expansion can continue when cost or usage evidence is missing. |
| Cloudflare operator | Infrastructure owner | Review Usage & billing dashboards, configure Billing alerts, and export redacted evidence. |
| Engineering owner | Worker/API owner | Investigate abnormal R2, D1, Workers, Durable Objects, or Cloudflare Images growth. |

No operator should paste account IDs, payment details, invoices, access tokens, or private customer data into release notes.

## Dashboard Checks

Use Cloudflare Dashboard > Manage Account > Usage & billing as the primary source. Check these products separately:

- Workers: requests, errors, CPU time, subrequest growth, and status-code spikes.
- D1: read queries, write queries, storage, and migration-related growth.
- R2: storage, Class A operations, Class B operations, egress, and object-count growth.
- Durable Objects: requests, duration, and storage if room state starts persisting.
- Cloudflare Images: transformations, stored images, and failed transformations.

Check staging and production separately. Staging evidence must be collected before TestFlight internal testing expands beyond the operator device.

## Baseline Thresholds

Cloudflare's current official free allowances are 100,000 Workers requests per day; D1 Free allows 5 million rows read and 100,000 rows written per day; R2 Standard includes 10 GB-month storage, 1 million Class A operations, and 10 million Class B operations per month; and Images Free allows 5,000 unique transformations per month before new transformations are refused. Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), and [Images pricing](https://developers.cloudflare.com/images/pricing/). R2 is usage-based: these allowances do not guarantee a zero invoice after activation if account-wide usage exceeds them.

The API therefore stops well before the account-wide free allowance:

- conservative application caps are 4 GiB active sanitized photo bytes, 16,000 UTC-month writes, 5,000 UTC-month Images transformations, 1,000,000 UTC-month Class B reads, and 20,000 UTC-day D1-tracked reads
- an automatic stop is fixed at 80% of those deliberately lower application caps: about 3.2 GiB, 12,800 monthly writes, 4,000 monthly Images transformations, 800,000 monthly Class B reads, or 16,000 daily D1-tracked reads; configuration may lower the caps but cannot raise them above the compiled ceilings
- these are not 80% of Cloudflare's full account allowances: the application intentionally stops much earlier and therefore leaves account-wide margin for staging, dashboard actions, other routes, and other products
- D1 migration `0015_photo_storage_budget.sql` creates the atomic storage/write ledger; `0016_photo_abuse_protection.sql` adds one-use ticket claims, per-IP daily HMAC ledgers, and the global upload control row; `0017_photo_read_budget.sql` adds monthly/daily read counters and a separate global read control row; `0020_photo_transform_budget.sql` adds the account-wide Images transformation ledger; `0021_photo_read_abuse_budget.sql` adds a hashed per-IP daily read ledger; `0022_photo_storage_release_ledger.sql` fences storage release by object key and release token so retries and concurrent delete paths cannot subtract the same bytes twice; `0024_anonymous_session_cost_guard.sql` adds the exact D1-wide UTC-day session issuance budget; `0025_place_addition_requests.sql` adds an owner-only request queue with per-session 3/day and exact global 1,600/day triggers before queue growth; `0026_global_api_cost_guard.sql` adds account-wide Workers/D1 reservations, observed-usage reconciliation, one-time warning state, and audited manual control
- the global API guard uses the configured free ceilings of 100,000 Workers requests/day, 5,000,000 D1 rows read/day, and 100,000 D1 rows written/day: 60% emits one redacted warning per UTC day, 70% degrades non-essential reads/writes, and 80% stops the final critical reserve. While the API Worker still runs, essential nationwide place/config/source/status reads switch to its in-memory, D1-write-free snapshot. If the API Worker is exhausted or unreachable, the web client instead reads `/silsigan/snapshots/nationwide-places.v1.json`, a strict allowlisted catalog containing only verified place identity, address, category, region, launch stage, and coordinates. That mode has no reports, photos, scores, observed timestamps, user data, telemetry transport, automatic API polling, realtime connection, Naver SDK, external place search, or write requests. Health probes use the public limiter and global ledger, format-valid forged anonymous proofs reserve authentication lookup cost before D1, and administrative routes verify their exact minimum role before capacity reservation
- `GET/PATCH /api/admin/api-cost-guard` exposes and controls the three meters; `POST /api/admin/api-cost-guard/reconciliations` records Cloudflare Dashboard or GraphQL observations. Resume requires a reconciliation no older than 15 minutes and all reconciled meters below 70%; observed Cloudflare counts override lower application estimates. Freshness and all three meter predicates are repeated in the same D1 transaction as the resume update, closing a check-then-update race
- staging and production must bind a dedicated `COST_GUARD_STATE` KV that is separate from ranking `CACHE`, plus distinct `ADMIN_API_RATE_LIMITER` and `HIGH_COST_API_RATE_LIMITER` bindings. A missing D1 ledger, mirror, or required limiter fails the guarded route or deployment preflight closed
- every non-control API request, including health and CORS preflight, passes a Cloudflare binding capped at 120 requests per minute per hashed client IP before routing or D1 access; the emergency global-cost control routes instead pass the dedicated admin limiter so a public flood cannot consume operator recovery capacity. `SILSIGAN_PUBLIC_RATE_LIMIT_REQUIRED=1` makes a missing binding fail closed, ordinary JSON bodies stop at 64 KiB while streaming, and oversized multipart photo requests stop before form-data parsing even without `Content-Length`
- anonymous-session issuance first passes the environment-specific 3 requests/60 seconds hashed-IP binding, then atomically reserves the D1-wide UTC-day budget before inserting a session; `SILSIGAN_ANON_SESSION_DAILY_LIMIT` defaults to and cannot exceed 5,000, may be lowered to `0` for an immediate fail-closed stop, and a missing budget table returns 503 before a session write. The edge binding is POP-local and approximate; only the D1 reservation is treated as the exact global cost boundary
- the default per-IP daily ceiling is 20 uploads and 60 MiB; upload ticket/write traffic is also limited to 5 requests per minute at the Cloudflare binding
- photo reads use a separate 120 requests-per-minute IP limiter and a 1,000 cache-miss reads-per-IP UTC-day ceiling before the atomic global monthly/daily reservation and `R2.get`; repeated reads use a canonical five-minute Worker cache key that ignores query strings, while read-control and public-visibility checks still run before every cache hit so stop/hide/delete cannot be bypassed
- every staging/production upload first needs a server-validated Turnstile token with the exact `photo_upload` action, allowed page hostname, and trusted Cloudflare client IP, then a five-minute HMAC ticket bound to the anonymous session, place, MIME type, size, dimensions, and upload ID; replay, provider outage, mismatch, missing bindings, missing secret, missing D1 guards, and missing trusted Cloudflare IP all fail closed before Images or R2
- conditional `UPDATE ... RETURNING` statements reserve an Images transformation before `IMAGES.transform`, bytes/writes before `R2.put`, per-IP reads before the global counter, and monthly/daily reads before `R2.get`; reaching any 80% stop flips the corresponding upload/read control before further paid-resource operations, and `PATCH /api/admin/photo-cost-guard` provides an audited whole-R2 manual stop/re-enable path
- a re-enable transition requires an explicit reconciliation acknowledgement and is rejected server-side while any relevant current counter remains at or above its 80% stop; a browser checkbox alone is never sufficient
- the five-minute cleanup schedule removes ticket and per-IP abuse rows older than the two-day replay/accounting window, expired active sessions, revoked sessions older than two days, and old anonymous-session budget rows so distributed identities cannot grow those ledgers indefinitely
- successful R2 deletion returns active bytes without allowing the ledger to fall below zero; `photo_storage_releases.storage_key` makes that release idempotent across owner, moderator, account deletion, and background cleanup paths; write counts remain because the Class A operation already occurred
- applying `0022` reconciles active bytes conservatively upward and disables uploads. An operator must compare D1 active/pending-cleanup bytes with live private R2 object usage, record the evidence, and use the audited admin resume flow; never re-enable merely because the migration finished

This guard reduces accidental application traffic cost. It does not cover objects or operations created outside this Worker, other R2 buckets in the account, Cloudflare dashboard actions, or unexpected provider billing changes. A request has already been counted by Workers before Worker code can reject it, so the 70%/80% application state can stop D1/R2/Images work but cannot by itself hard-cap Workers requests. The local web Wrangler contract keeps `assets.run_worker_first` absent/false, so a matching emergency JSON asset is eligible to bypass web Worker code; unit/contract tests reject unexpected live fields, invalid or duplicate IDs, unverified/out-of-country coordinates, oversized catalogs, and any configuration that would force that matching asset through Worker code. The 2026-07-20 local Chrome 503 harness verified that the client requests the static asset once and makes no further API, NAVER provider, or analytics requests after entering directory mode; evidence is under `artifacts/static-directory-failover` with timestamp `1784505764761`. Dashboard reconciliation, Cloudflare WAF/rate-limit rules, and live staging/production evidence that the static asset really bypasses Worker invocation remain mandatory.

Direct public R2 exposure is a release stop. `pnpm cf:r2:evidence -- --env=<staging|production> --check` must prove that every configured bucket exists, its `r2.dev` development URL is disabled, and no direct R2 custom domain is connected. The check is read-only and fails closed when Wrangler returns an unknown or failed privacy response; photo reads must continue through the guarded Worker only.

Use these TestFlight MVP thresholds until live traffic establishes a better baseline:

| Surface | Staging threshold | Production threshold | Action |
| --- | --- | --- | --- |
| Workers requests | daily increase under 2x the previous daily smoke baseline | daily increase under 2x the previous production baseline | investigate route logs and recent smoke/tester activity. |
| D1 writes | daily writes match expected smoke/tester actions | daily writes match expected tester actions | check abuse, retry loops, and duplicate ranking signals. |
| Global Workers/D1 guard | 60% warning, 70% degradation, 80% stop | 60% warning, 70% degradation, 80% stop | inspect `GET /api/admin/api-cost-guard`; record current Cloudflare values, keep non-essential routes stopped, and resume only after a fresh below-70% reconciliation. |
| R2 storage | storage growth matches uploaded photo evidence | storage growth matches accepted user photos | sample object count and verify hidden/deleted photo cleanup. |
| App photo storage ledger | automatic stop at about 3.2 GiB; compiled cap 4 GiB | automatic stop at about 3.2 GiB; compiled cap 4 GiB | inspect `GET /api/admin/photo-cost-guard`; reconcile against R2 and re-enable only after review. |
| App monthly photo writes | automatic stop at 12,800; compiled cap 16,000 | automatic stop at 12,800; compiled cap 16,000 | inspect retry/abuse patterns; never raise the ceiling on a free-account release. |
| App monthly Images transformations | automatic stop at 4,000; compiled cap 5,000 | automatic stop at 4,000; compiled cap 5,000 | distributed and duplicate uploads are rejected before the Images binding after the stop; reconcile before re-enable. |
| App monthly Class B reads | automatic stop at 800,000; compiled cap 1,000,000 | automatic stop at 800,000; compiled cap 1,000,000 | inspect hotlinking and distributed scraping; reconcile the D1 counter against R2 operations before re-enable. |
| App daily D1-tracked reads | automatic stop at 16,000; compiled cap 20,000 | automatic stop at 16,000; compiled cap 20,000 | keeps the guard's own writes well below D1 Free's 100,000 rows/day; inspect distributed traffic before re-enable. |
| Per-IP daily R2 cache misses | reject after 1,000 per UTC day; configuration may only lower this ceiling | reject after 1,000 per UTC day; configuration may only lower this ceiling | block one scraper without stopping reads for every user; inspect shared-NAT false positives before lowering. |
| Anonymous session issuance | exact D1-wide stop after 5,000 per UTC day; `0` is an immediate kill switch | exact D1-wide stop after 5,000 per UTC day; `0` is an immediate kill switch | inspect bot/distributed signup traffic; do not rely on the POP-local edge limiter as an accounting counter. |
| Private place-addition requests | reject after 3 per anonymous session per UTC day and stop globally at 1,600/day | reject after 3 per anonymous session per UTC day and stop globally at 1,600/day | inspect bot-generated place submissions; never bypass the queue by auto-creating public places. |
| R2 egress | egress stays near preview/read smoke volume | egress stays near real tester view volume | check public photo proxy cache and hotlinked URLs. |
| Cloudflare Images | transformations stay at or below the D1 ledger | transformations stay at or below the D1 ledger | check duplicate re-encodes, failed transform loops, and ledger drift. |
| Durable Objects | room traffic follows active page sessions | room traffic follows active TestFlight sessions | check polling/WebSocket reconnect loops. |

Any unexplained spike above threshold pauses TestFlight expansion until the owner records a cause and mitigation.

## Alert Rules

Cloudflare budget alerts are a secondary billing backstop, not the stop mechanism. According to Cloudflare's [Budget alerts documentation](https://developers.cloudflare.com/billing/manage/budget-alerts/), pay-as-you-go accounts can email when account-wide spend crosses a positive USD threshold, but the alert is informational and does not stop usage. It cannot express “80% of the R2 free tier.” Product usage notifications are plan-dependent, so a Free-account release must not rely on them.

Before external TestFlight expansion:

- configure the smallest acceptable positive USD account budget alert after R2 activation; treat it as post-spend detection only
- set `COST_ALERT_WEBHOOK_URL` to the operator-owned HTTPS notification bridge and optionally set the server-only `COST_ALERT_WEBHOOK_TOKEN`
- verify a single `cost.api-guard.warning` event at 60% and `cost.api-guard.changed` at the 70%/80% transitions; payloads may contain only mode, metric, threshold, generation, environment, guard path, and timestamp
- verify that an automatic or manual stop emits only `cost.photo-uploads.stopped`, `cost.photo-reads.stopped`, or `cost.photo-r2.stopped` with redacted counters, environment, timestamp, and the admin guard path
- verify that uploads still stop when the webhook is missing or unavailable; alert delivery must never be required for enforcement
- configure a Turnstile widget for the exact staging/production web hostnames, keep `SILSIGAN_TURNSTILE_SECRET_KEY` server-only, and verify the public site key alone is exposed by `/api/config`
- use `GET /api/admin/photo-cost-guard` for current percentages and `PATCH /api/admin/photo-cost-guard` with an admin token for an audited immediate stop or reviewed re-enable
- use `GET/PATCH /api/admin/api-cost-guard` for the global Workers/D1 emergency stop and `POST /api/admin/api-cost-guard/reconciliations` to record current Cloudflare Dashboard values; never enter tokens, account IDs, IPs, or raw request data in the reconciliation note
- for browser operations, use `/admin/moderation/posts`; its authenticated same-origin server proxy keeps the Worker admin token out of the browser, rejects cross-site mutations, refreshes every 60 seconds, and requires a reason plus an R2/D1 reconciliation acknowledgement before re-enable
- the current Next admin proxy uses one shared server-side Worker credential and audit subject; rotate it after suspected exposure and do not claim individual-operator role separation or attribution until identity-backed admin sessions are implemented
- retain the latest stopped/resumed control-surface screenshots under `artifacts/manual-qa/` without card, account, token, or request-body data

Alerts must route to the same operator channel as release blockers, but must not include card details, account ID, invoice links, secrets, request bodies, raw coordinates, anonymous IDs, or original filenames.

## Evidence And Cadence

Record redacted cost and usage evidence on this cadence:

- daily during staging smoke and internal TestFlight week 1
- weekly after usage is stable
- immediately after R2 bucket creation, Worker deploy, Pages deploy, or mutating smoke
- after any R2 dashboard change, rerun the bucket visibility, `r2.dev`, and direct custom-domain privacy evidence
- immediately when the API returns `PHOTO_COST_GUARD_80_PERCENT_STOP`, `PHOTO_TRANSFORM_COST_GUARD_80_PERCENT_STOP`, `PHOTO_READ_COST_GUARD_80_PERCENT_STOP`, `PHOTO_DAILY_READ_COST_GUARD_80_PERCENT_STOP`, `PHOTO_UPLOADS_DISABLED`, `PHOTO_READS_DISABLED`, any storage/write/transform/read budget exhaustion code, or a guard-unavailable code
- immediately after any privacy, moderation, ranking, photo, or realtime incident

Each evidence entry should include:

- UTC timestamp
- environment: staging or production
- product: R2, D1, Workers, Durable Objects, or Cloudflare Images
- metric name: requests, storage, egress, transformations, reads, writes, errors, or duration
- pass/fail against the baseline threshold
- owner decision: continue, investigate, pause, or stop

## Stop Conditions

Stop before the next TestFlight expansion when:

- Usage & billing cannot be accessed by the operator.
- The application 80% automatic stop, admin emergency endpoint, or optional cost webhook has not been verified.
- The global 60% warning, 70% degradation, 80% stop, dedicated `COST_GUARD_STATE` mirror, admin/high-cost rate limiters, or below-70% reconciliation gate has not been verified.
- WAF/rate-limit rules and static asset routing have not been verified to prevent an attacker from consuming Workers requests before application code runs.
- The post-spend Cloudflare budget alert is not configured after R2 activation.
- Any configured R2 bucket exposes an `r2.dev` URL or direct R2 custom domain, or its privacy state cannot be verified.
- R2 storage or egress growth cannot be reconciled to photo smoke or tester activity.
- `photo_storage_budget`, `photo_storage_releases`, `photo_upload_control`, `photo_upload_claims`, `photo_abuse_budget`, `photo_read_budget`, `photo_read_control`, `photo_read_abuse_budget`, or `photo_transform_budget` is missing; required singleton/index rows are absent; ledgers differ materially from Cloudflare usage; photo resources remain enabled at about 3.2 GiB, 12,800 writes, 4,000 Images transformations, 800,000 monthly reads, or 16,000 daily reads; or an operator re-enables after `0022` without a recorded acknowledgement and a server-passing R2/D1 counter reconciliation.
- `api_cost_guard_control`, `api_cost_guard_daily`, or `api_cost_guard_reconciliations` is missing; `COST_GUARD_STATE` shares the ranking cache or is absent; observed usage is stale; or an operator resumes without a fresh Cloudflare reconciliation below 70%.
- Health, forged-proof, exact-admin-role, or atomic-resume security regressions in `artifacts/security-validation-global-api-cost-guard-20260720/validation_report.md` no longer pass.
- D1 writes grow faster than expected user actions.
- Workers requests, errors, or CPU indicate a retry loop.
- Durable Objects traffic suggests reconnect loops.
- Cloudflare Images transformations repeat for the same photo without a user action.
- Any cost/usage evidence contains secrets, payment details, raw coordinates, anonymous IDs, original filenames, or request bodies.

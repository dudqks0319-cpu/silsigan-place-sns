# Cloudflare staging operator packet

Updated: 2026-07-24
Scope: Cloudflare-backed staging and TestFlight MVP evidence. This packet never authorizes production deployment, production migration, provider activation, or traffic promotion.

## Current truth

| Surface | State |
| --- | --- |
| Staging API | Live at `https://silsigan-api-staging.dudqks0319.workers.dev`; the latest audited reconciliation used Workers `3,000`, D1 reads `504,922`, and D1 writes `37,386`, and generation `5` is `running`. |
| Staging web | Live at `https://silsigan-web-staging.dudqks0319.workers.dev`; version `ee34cab8-8d18-4a13-8e89-b379c462a66b` runs Next.js `16.2.11`, embeds the exact staging API base, and passed post-deploy browser smoke at `72/80` requests. |
| Staging D1 | Migrations through `0026`, aligned migration registry, no pending migration. |
| Staging R2 | Private `silsigan-photos-staging`; zero objects/bytes, `r2.dev` disabled, no direct custom domain, bounded lifecycle rules. |
| Turnstile | The managed widget contains the exact staging and production web hosts and the server-only staging secret name exists. A valid bounded JPEG reached the live challenge, but automation was rejected before a token was issued; do not weaken the widget. Human verification plus one bounded live upload and cleanup evidence remains pending. |
| Workers tail | A bounded 2026-07-24 capture accepted only the exact staging API Worker, sanitized 20 platform tail events in memory, persisted only the redacted 10.4 KiB result, and passed the sensitive-log validator. Raw Wrangler tail output must not be redirected to disk. |
| Official sources | KMA, TourAPI, and national-parking credentials are installed as staging secrets only. All six official provider rows and all ingestion targets remain disabled; provider applications, rights, quotas, attribution, and health approval remain separate. |
| Production | Not promoted. Production API/migration/R2/source activation remain blocked and require separate approval. |

## Resolved staging cost-guard incident

The global API guard first entered `degraded` mode on 2026-07-21 with reason `automatic-70-percent-d1_rows_read`. After the first recovery it later degraded again when conservative write reservations reached the 70% boundary. This was not bypassed.

- application ledger: 1,583 admitted requests and 3.5M reserved rows read
- Cloudflare D1 dashboard: about 87.9k actual rows read for the visible billing period
- D1 Insights: the heaviest public query averaged 59 rows read
- cause: the previous standard/high-cost reservations were 1,000/10,000 rows, far above observed use
- remediation code: standard reads now reserve 100 rows and high-cost reads 500 rows, retaining roughly eightfold headroom on the observed high-cost query
- recovery evidence: role-separated staging admin credentials were installed without exposing values; Cloudflare GraphQL and D1 aggregates recorded Workers `2,595`, rows read `139,994`, and rows written `3,220` at `2026-07-21T12:08:29.507Z`
- latest recovery evidence: on 2026-07-22 the Cloudflare dashboard and D1 Insights were re-read; actual bounded observations were Workers `3,000`, D1 rows read `504,922`, and rows written `37,386`
- current safety state: the admin-only reconciliation rebased conservative reservations while non-running, the atomic resume advanced the guard to generation `5`, and the staging web returned to live data mode

The incident is resolved for staging, but the control contract is unchanged: never update `api_cost_guard_control` directly. Any later stop/resume must use the admin API with fresh Cloudflare observations and remain fail-closed if the token, reconciliation, generation, or below-70% predicates cannot be verified. Live pre-Worker WAF and invocation-free static-routing evidence remains a separate release gate.

## Secret inventory

Verify names only:

```bash
pnpm exec wrangler secret list --env staging --config workers/api/wrangler.jsonc
```

Expected existing names:

- `KMA_SERVICE_KEY`
- `TOUR_API_SERVICE_KEY`
- `NATIONAL_PARKING_SERVICE_KEY`
- `SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET`
- `SILSIGAN_TURNSTILE_SECRET_KEY`
- `ADMIN_TOKENS`

Pending staging-only names:

- `ITS_SERVICE_KEY`

Never print values. Never write them into `.env.example`, Git, D1, logs, browser storage, query strings, or release artifacts. `ADMIN_TOKENS` is a JSON object with independent `operator`, `moderator`, and `admin` values. Generate each token independently with cryptographic randomness and keep the temporary transfer file outside the repository with owner-only permissions; delete it after installation and smoke.

## Provider application state

- data.go.kr: user login and CAPTCHA are required before KMA and national-parking applications can be reviewed.
- TourAPI: TourOnePass SNS login is required before application/OAuth review.
- ITS: the logged-in form is prepared with `상업용 민간`, the staging web URL, and only traffic flow plus CCTV metadata. It has not been submitted.
- Existing KMA, TourAPI, and national-parking credential candidates were installed by secret input on 2026-07-21 without printing their values. A read-only D1 check then confirmed all six official provider rows and every ingestion target remain disabled. The enabled `user_report` row is the separate UGC source. ITS remains unissued.

Provider-specific daily application limits are checked at deployment and before network access:

| Source | Daily reservation limit | Notes |
| --- | ---: | --- |
| KMA | 5,000 | Maximum two attempts are reserved per run. |
| TourAPI | 500 | Keep below the key's approved quota. |
| National parking | 100 | Static batch/incremental collection only. |
| ITS traffic + CCTV | 500 shared | The two APIs cannot each consume 500. |
| Seoul realtime | 500 | Feature flag and targets remain off. |

Set a source limit to `0` for an immediate provider-specific kill switch. An invalid, negative, missing-in-production, or above-ceiling configuration fails deployment or runtime closed.

## Read-only verification

Run these before any mutation:

```bash
pnpm cf:preflight:staging
pnpm cf:external-state
pnpm cf:d1:evidence -- --env=staging --check --timeout-ms=120000
pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000
pnpm exec wrangler secret list --env staging --config workers/api/wrangler.jsonc
```

Inspect only aggregate cost state:

```sql
SELECT mode, reason, automatic_metric, generation, updated_at
FROM api_cost_guard_control
WHERE id = 1;

SELECT day_utc, admitted_requests, reserved_workers_requests,
       reserved_rows_read, reserved_rows_written,
       observed_workers_requests, observed_rows_read,
       observed_rows_written, updated_at
FROM api_cost_guard_daily
ORDER BY day_utc DESC
LIMIT 2;
```

Do not include account IDs, tokens, raw IPs, anonymous proofs, exact GPS, filenames, request bodies, or provider payloads in shared evidence.

## Audited API guard recovery

Prerequisites:

1. Role-separated staging `ADMIN_TOKENS` is installed and operator/moderator/admin denial boundaries have been verified.
2. Cloudflare dashboard or GraphQL observations are current and below 70% for Workers requests, D1 rows read, and D1 rows written.
3. The calibrated Worker version is deployed.
4. The operator records the observation through `POST /api/admin/api-cost-guard/reconciliations` using the admin role.
5. If the application reservation is known to be an overestimate, send `rebaseReservedEstimates: true` with the current `expectedGeneration`. The server accepts this only while the guard is `degraded` or `stopped`, only for the current UTC day, and only with an observation no older than 15 minutes. It records the prior aggregate reservations in `admin_actions` before rebasing them to the monotonic observed counters. Never update D1 directly.
6. The operator requests resume through `PATCH /api/admin/api-cost-guard`; the server repeats freshness, generation, and all below-70% predicates in the same D1 transaction.

After recovery, run one read-only smoke:

```bash
SILSIGAN_STAGING_API_BASE_URL=https://silsigan-api-staging.dudqks0319.workers.dev pnpm smoke:staging
```

If `/health` remains 429, do not retry repeatedly. Re-read the stable error code and aggregate guard state.

## Photo write smoke

The API guard is running and the photo control was reconciled against R2 `0 B` plus zero active D1 photo bytes before uploads were re-enabled. A valid approximately 194 KiB JPEG was selected through the real staging web file picker on 2026-07-22. The exact-host managed Turnstile challenge appeared, but the automation environment was rejected before a token was issued, so no upload success or R2 object is claimed. Do not switch the widget to a weaker mode or bypass Turnstile. After a user completes the visible challenge, continue with the same image through the real upload-ticket flow; do not use the legacy `/api/photos/complete` harness against live staging. Verify the pending row, moderate with the admin-only endpoint, read through the guarded Worker, then reject/delete the smoke row and confirm R2 returns to `0 B`.

Required evidence:

- Turnstile success and invalid/mismatched-token rejection
- one-use upload ticket and replay rejection
- private original path never publicly reachable
- MIME, magic-byte, size, dimensions, EXIF/GPS stripping, re-encoding, and duplicate checks
- pending moderation before approval
- role denial for operator/moderator/admin boundaries
- approved read through the guarded Worker only
- delete plus zero residual R2 objects/bytes
- D1 storage release exactly once
- no secret, raw location, original filename, request body, or object key in logs

Stop and clean up immediately if any object remains, a public R2 route exists, a quota counter diverges, or a retry performs a second paid transformation/write.

## Safe Workers tail capture

Do not redirect raw `wrangler tail --format json` output to a file. Wrangler platform events can include request headers, query strings, and exact Cloudflare geolocation even when Worker application logs are clean.

Use the bounded staging-only capture instead:

```bash
pnpm cf:tail:capture -- \
  --output=artifacts/cloudflare-tail/staging-tail-safe-YYYYMMDD.log \
  --duration-ms=20000
```

While it is running, execute one bounded read-only staging smoke in another terminal. The capture keeps raw events in memory only, removes platform request/response metadata, preserves Worker-emitted logs, refuses to persist a result when those logs contain a sensitive value, creates the output with owner-only permissions, and stops after 5–120 seconds.

Validate the persisted artifact:

```bash
pnpm smoke:tail-redaction -- \
  --tail-file=artifacts/cloudflare-tail/staging-tail-safe-YYYYMMDD.log
```

The final 2026-07-24 run captured 20 events, processed 88,840 raw bytes in memory, persisted 10,688 sanitized bytes with request paths redacted, and returned `sensitiveFindings=[]`. Evidence: `artifacts/cloudflare-tail/staging-tail-safe-v2-20260724.log`.

## Deployment commands

Staging API only:

```bash
pnpm exec wrangler deploy --env staging --config workers/api/wrangler.jsonc
```

Staging web only, after a fresh `pnpm cf:build`:

```bash
pnpm exec wrangler deploy --env staging --config wrangler.jsonc
```

These commands do not authorize their production equivalents. Before any staging deploy, run focused tests, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm verify:cloudflare` in proportion to the diff.

## Remaining release gates

- provider submissions, issued keys, rights/attribution/quota/health proof, then one-source-at-a-time activation starting with KMA
- bounded R2 mutation smoke after the already-completed role-separated admin setup and API guard recovery
- Cloudflare WAF/rate-limit and billing alert evidence; application rejection cannot prevent a request already reaching Workers from counting
- owner-controlled domain and NAVER valid-origin/invalid-origin plus notification-recipient evidence
- moderation/on-call drill; the bounded Workers tail redaction evidence is complete
- iPhone and Android real-device evidence
- final privacy/support/location/UGC/data-retention/open-source/store disclosures with named legal/operations review
- separate production D1/R2/API/source/traffic approval

## Stop conditions

Keep the release blocked when any of these is true:

- global API guard is degraded/stopped without a fresh audited reconciliation
- R2 privacy or zero-residual cleanup cannot be proven
- staging admin roles are missing or share one token
- provider terms, quota, attribution, credential health, or ownership are unclear
- an official source target becomes active before its policy audit
- WAF, alert ownership, moderation SLA, real-device, or legal evidence is missing
- any secret or sensitive identifier appears in source, logs, screenshots, or artifacts
- a proposed action targets production without separate user approval

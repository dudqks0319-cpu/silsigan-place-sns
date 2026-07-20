# Cloudflare staging operator packet

Updated: 2026-07-20
Scope: Cloudflare-backed TestFlight MVP evidence, not App Store production submission.

## Current Block

Wrangler OAuth is active. Backup-gated recovery preserved the empty legacy source table under an archive name and normal Wrangler migrations applied `0018`~`0026`. The latest corrected 2026-07-20 read-only check confirms both web Workers have deployment history, Staging D1 through `0026`, Wrangler pending 0건, migration registry alignment, core seed evidence, and zero writes from verification. R2 still returns `R2_NOT_ENABLED`, production API remains missing, separate staging/production `COST_GUARD_STATE` namespaces are provisioned and bound, and the deployment URL/origin shell is incomplete. The exact-host Turnstile widget now exists, its public site key is configured in staging/production, and staging secret storage lists both required secret names without exposing values. The staging API host has bootstrap/secret-change deployment history, but `/api/health` returns 404 and newer Wrangler version `1062068c-f06b-4090-9038-2b3d7b4cc9a1` is undeployed, so no application deployment is claimed. Current external blocks are the user-only R2 payment/terms activation hand-off, post-`0022` live R2/D1 reconciliation, first configured staging API application deployment, and live smoke evidence:

```bash
pnpm cf:external-state
```

The expected account-level blocker until the checkout hand-off is complete is R2:

```bash
pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000
```

Expected current result before the user finishes checkout: R2 is not enabled or not yet visible.

Cloudflare requires adding the R2 subscription through Dashboard checkout before bucket evidence can pass:

1. Open Cloudflare Dashboard.
2. Go to `Storage & databases` -> `R2` -> `Overview`.
3. The account owner enters payment/billing details, accepts the two billing/terms consents, and presses the final activation button. This step is never automated.
4. Return to this packet and run the commands below.

Do not run App Store submission steps from this packet.

## After R2 Subscription

First verify account-level R2 visibility:

```bash
pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000
```

If the account is enabled but the staging bucket is missing, create only the configured staging bucket:

```bash
pnpm cf:r2:evidence -- --env=staging --apply --timeout-ms=120000
```

Keep the bucket private. Do not enable `r2.dev`, a public custom domain, or direct client credentials; every file read stays behind the Worker.

`pnpm cf:r2:evidence` now verifies this fail-closed: after bucket visibility it runs read-only `r2 bucket dev-url get` and `r2 bucket domain list` checks for every configured bucket. Any enabled `r2.dev` URL, direct R2 custom domain, or unrecognized/failed privacy response stops the release evidence instead of assuming the bucket is private.

Production bucket creation is a separate production action:

```bash
pnpm cf:r2:evidence -- --env=production --apply --confirm-production --timeout-ms=120000
```

Keep production bucket creation separate from the staging MVP unblock unless production evidence is explicitly needed in the same run.

## Staging Deploy Inputs

After R2 is enabled, set the staging URLs in the shell that will run the release evidence:

```bash
export SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker-api>
export SILSIGAN_STAGING_PAGES_URL=https://<staging-pages>
```

For mutation/admin smoke, also set:

```bash
export SILSIGAN_STAGING_ADMIN_TOKEN=<redacted-admin-token>
export SILSIGAN_STAGING_TAIL_LOG_FILE=artifacts/cloudflare-tail/staging-tail.log
```

The following staging Worker-only secrets are installed without printing or committing their values:

- `SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET`: generated with cryptographic randomness
- `SILSIGAN_TURNSTILE_SECRET_KEY`: the server-only secret for the exact-host widget
- `COST_ALERT_WEBHOOK_URL`: operator-owned HTTPS notification bridge
- `COST_ALERT_WEBHOOK_TOKEN`: optional bearer secret for that bridge

The Turnstile widget is restricted to the selected staging/production web hosts, and source commit `30360956cd4aad29b145dce664f8bc7943bd5874` places its public site key as `SILSIGAN_TURNSTILE_SITE_KEY` in both environment configurations. Keep `SILSIGAN_PHOTO_TURNSTILE_REQUIRED=1`. The public key may be returned by `/api/config`; the staging secret is already in Worker secret storage and must never be printed or committed. `wrangler secret list --env staging` must show both required names immediately before deploying version `1062068c-f06b-4090-9038-2b3d7b4cc9a1` or a later equivalent version. Production secret installation remains a separate production action.

The `PUBLIC_API_RATE_LIMITER`, `PHOTO_UPLOAD_RATE_LIMITER`, and `PHOTO_READ_RATE_LIMITER` bindings must all be present in the deployed Worker. `SILSIGAN_PUBLIC_RATE_LIMIT_REQUIRED=1` makes a missing general limiter fail closed in staging/production. The public limiter admits at most 120 requests per minute per hashed Cloudflare client IP before CORS preflight, routing, or any D1 access; photo traffic then passes its narrower dedicated limit. General JSON bodies are streamed through a 64 KiB ceiling before parsing, the legacy photo JSON path keeps its separately bounded image allowance, and multipart photo requests are bounded before `formData()` parsing even when `Content-Length` is absent. Missing bindings, Turnstile proof/configuration, or the photo HMAC secret fail closed.

Do not commit these values.

## Pre-Smoke Verification

Run non-mutating checks first:

```bash
pnpm cf:external-state
pnpm cf:d1:evidence -- --env=staging --check --timeout-ms=120000
pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000
pnpm cf:preflight
```

The corrected remote D1 check uses only `sqlite_schema` and `pragma_table_info` to locate the first incomplete boundary before any table data query. The latest Staging run passes through `0026`; `wrangler d1 migrations list` reports no pending migrations, and registry plus core seed evidence agree. A mode-`0600` pre-change export with recorded SHA-256 exists outside the repository and must remain preserved. Because `0022` is present, compare D1 active/pending-cleanup bytes with live R2 and complete the audited resume acknowledgement before any Images/R2 write smoke. The dedicated `COST_GUARD_STATE` namespaces already exist separately from `CACHE`; verify public/admin/high-cost rate-limit bindings, keep `SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED=1`, and prove the 60% warning, 70% degradation, 80% stop, essential snapshot, and fresh below-70% reconciliation gate. Keep `SILSIGAN_ANON_SESSION_REQUIRED=1` and `SILSIGAN_ANON_SESSION_DAILY_LIMIT=5000` in staging/production.

Set all selected HTTPS endpoints before smoke:

```bash
export SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker-api>
export SILSIGAN_STAGING_PAGES_URL=https://<staging-pages>
export SILSIGAN_PRIVACY_POLICY_URL=https://<staging-pages>/privacy
export SILSIGAN_SUPPORT_URL=https://<staging-pages>/support
```

Do not use localhost, credentials, query strings, or fragments in these values, and do not commit them.

## Staging Smoke

Read-only Worker smoke:

```bash
pnpm smoke:staging
```

Mutation/admin smoke:

```bash
SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin
```

This mutation smoke first issues server-bound anonymous credentials, attaches both `x-silsigan-anon-id` and `x-silsigan-anon-proof` to every user write and cleanup, rejects a forged proof, rotates the proof and rejects the old value, revokes it and rejects reuse, then revokes the main smoke sessions. Configuration and local tests must prove the 3 requests/60 seconds binding, hashed limiter key, fail-closed missing-binding path, exact D1-wide 5,000/day reservation, `0` kill switch, and no recent-session `last_seen_at` refresh more than once per 24 hours. Because Cloudflare's edge limiter is POP-local and eventually consistent, an exact fourth live rejection is observational evidence only, not the accounting gate; the `0024` D1 reservation is authoritative. The smoke records only pass/fail metadata and never prints either credential.

Pages browser smoke:

```bash
pnpm smoke:pages
```

Tail redaction:

```bash
pnpm smoke:tail-redaction -- --tail-file="${SILSIGAN_STAGING_TAIL_LOG_FILE}"
```

Final staging release-candidate gate:

```bash
pnpm release:gate -- --release-candidate --tail-file="${SILSIGAN_STAGING_TAIL_LOG_FILE}" --timeout-ms=120000
```

## NAVER Maps custom-domain prerequisite

Do not mark NAVER Maps ready on the current `workers.dev` URLs. NAVER's official Application guide registers a representative web domain rather than an exact subdomain, so a shared hosting suffix is not acceptable Client ID restriction evidence.

Before adding NAVER variables to the staging candidate:

1. Attach an owner-controlled custom domain to the staging and production web Workers.
2. Complete the account-owner steps in `docs/naver-maps-release-operator-packet.md`.
3. Set `SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN` to the owned registrable domain and `SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS` to the exact custom HTTPS web origins.
4. Confirm the NAVER representative account, save monthly/daily hard limits no higher than `4,800,000`/`160,000`, choose an alert threshold no higher than `70%`, and configure a real notification recipient.
5. Set `SILSIGAN_NAVER_MAP_REPRESENTATIVE_ACCOUNT_CONFIRMED=1`, `SILSIGAN_NAVER_MAP_MONTHLY_HARD_LIMIT`, `SILSIGAN_NAVER_MAP_DAILY_HARD_LIMIT`, `SILSIGAN_NAVER_MAP_ALERT_THRESHOLD_PERCENT`, and `SILSIGAN_NAVER_MAP_ALERT_RECIPIENT_CONFIRMED=1` only after masked console evidence matches those values.
6. Keep the fallback map active until valid-origin success and invalid-origin rejection are both captured.

## Evidence To Capture

Record these outputs or artifact paths in `docs/current-release-state.md` and `RELEASE_STATUS.md`:

- R2 staging check/apply result
- `cf:external-state` blocker list after R2 and URL setup
- staging Worker smoke JSON summary
- Pages browser smoke screenshot, network artifact, and console artifact
- tail redaction result
- release gate result counts and failed steps

## Stop Conditions

Stop before App Store production submission.

Stop and document the exact blocker if any of these remain true:

- `CLOUDFLARE_AUTH_REQUIRED` is returned by `pnpm cf:external-state`
- R2 still returns `R2_NOT_ENABLED`
- R2 privacy evidence returns `R2_PUBLIC_DEV_URL_ENABLED`, `R2_PUBLIC_CUSTOM_DOMAIN_CONFIGURED`, `R2_DEV_URL_CHECK_FAILED`, or `R2_CUSTOM_DOMAIN_CHECK_FAILED`
- production D1 still lacks required remote evidence at `D1_0006_NOT_APPLIED`; Staging passes through `0026`, but post-`0022` live R2/D1 reconciliation remains required before uploads resume
- Local matching-static-asset and directory-mode contracts pass, and the 2026-07-20 local Chrome 503 harness under `artifacts/static-directory-failover` confirms zero post-fallback API/NAVER-provider/analytics requests; live WAF/rate-limit and invocation-free static asset routing evidence is still missing because application code cannot prevent a request already reaching the Worker from counting against the Workers allowance
- staging loses the exact-host Turnstile widget, public site key, either verified secret name, or live action/hostname validation after application deployment
- `SILSIGAN_STAGING_API_BASE_URL` is missing or non-HTTPS
- `SILSIGAN_STAGING_PAGES_URL` is missing or non-HTTPS
- `SILSIGAN_PRIVACY_POLICY_URL` or `SILSIGAN_SUPPORT_URL` is missing or non-HTTPS
- `SILSIGAN_STAGING_ADMIN_TOKEN` is missing for mutation/admin smoke
- captured Workers tail log is missing for release-candidate evidence

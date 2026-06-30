# Cloudflare staging operator packet

Updated: 2026-06-28
Scope: Cloudflare-backed TestFlight MVP evidence, not App Store production submission.

## Current Block

R2 is still blocked at the account level:

```bash
pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000
```

Expected current result before Dashboard action: `R2_NOT_ENABLED`.

Staging and production web Workers are already deployed and have passed read-only browser smoke:

- Staging web: `https://silsigan-web-staging.dudqks0319.workers.dev`
- Production web: `https://silsigan-web-production.dudqks0319.workers.dev`

Configured API URL values are now fixed in `.env.example` and this packet:

- Staging API: `https://silsigan-api-staging.dudqks0319.workers.dev`
- Production API: `https://silsigan-api-production.dudqks0319.workers.dev`

These URL values are deployment-shaped, but they are not live staging evidence until the configured API Workers are deployed and `pnpm smoke:staging` passes. Current external blockers remain R2 enablement, API Worker deployments, and real staging smoke.

Cloudflare requires adding the R2 subscription through Dashboard checkout before bucket evidence can pass:

1. Open Cloudflare Dashboard.
2. Go to `Storage & databases` -> `R2` -> `Overview`.
3. Complete the R2 subscription checkout.
4. Return to this packet and run the commands below.

Do not run App Store submission steps from this packet.

## After R2 Subscription

First verify account-level R2 visibility:

```bash
pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000
```

The staging unblock lane is also available as a single ordered command. Its default mode runs only staging preflight, staging R2 check, staging D1 check, and external-state checks:

```bash
pnpm cf:staging:unblock -- --plan-only
pnpm cf:staging:unblock -- --timeout-ms=120000
```

If the account is enabled but the staging bucket is missing, create only the configured staging bucket:

```bash
pnpm cf:r2:evidence -- --env=staging --apply --timeout-ms=120000
```

Or run the same staging-only bucket creation through the unblock lane:

```bash
pnpm cf:staging:unblock -- --apply-r2 --timeout-ms=120000
```

Production bucket creation is a separate production action:

```bash
pnpm cf:r2:evidence -- --env=production --apply --confirm-production --timeout-ms=120000
```

Keep production bucket creation separate from the staging MVP unblock unless production evidence is explicitly needed in the same run.

Then deploy the staging API Worker with the committed Worker config:

```bash
pnpm cf:api:deploy:staging
```

To continue from staging R2 bucket verification into staging API deploy and read-only smoke in one lane:

```bash
pnpm cf:staging:unblock -- --apply-r2 --deploy-api --smoke --timeout-ms=120000
```

After the staging smoke passes, deploy production separately:

```bash
pnpm cf:api:deploy:production
```

Do not deploy production as a substitute for staging mutation evidence. The staging API Worker must pass read-only smoke, mutation/admin smoke, Pages browser smoke, and tail redaction before TestFlight internal evidence is considered complete.

## Staging Deploy Inputs

After R2 is enabled, set the staging URLs in the shell that will run the release evidence:

```bash
export SILSIGAN_STAGING_API_BASE_URL=https://silsigan-api-staging.dudqks0319.workers.dev
export SILSIGAN_STAGING_PAGES_URL=https://silsigan-web-staging.dudqks0319.workers.dev
export SILSIGAN_PRODUCTION_PAGES_URL=https://silsigan-web-production.dudqks0319.workers.dev
export SILSIGAN_PRODUCTION_API_BASE_URL=https://silsigan-api-production.dudqks0319.workers.dev
export SILSIGAN_PRIVACY_POLICY_URL=https://silsigan-web-staging.dudqks0319.workers.dev/privacy
export SILSIGAN_SUPPORT_URL=https://silsigan-web-staging.dudqks0319.workers.dev/support
```

Do not use the staging API URL for production-candidate smoke. Keep `SILSIGAN_STAGING_API_BASE_URL` and `SILSIGAN_PRODUCTION_API_BASE_URL` pointed at their matching configured Workers, and treat smoke failures as deployment blockers until the API Workers are live.

For mutation/admin smoke, also set:

```bash
export SILSIGAN_STAGING_ADMIN_TOKEN=<redacted-admin-token>
export SILSIGAN_STAGING_TAIL_LOG_FILE=artifacts/cloudflare-tail/staging-tail.log
```

Do not commit these values.

## Pre-Smoke Verification

Run non-mutating checks first:

```bash
pnpm cf:d1:evidence -- --env=staging --check --timeout-ms=120000
pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000
pnpm cf:external-state
pnpm cf:preflight
```

Run `cf:external-state` and `cf:preflight` in the same shell where the public URL exports above are set. A plain shell can still fail URL checks because the release scripts do not automatically load `.env.example`.

Wrangler package scripts and R2/D1/external-state evidence scripts write Wrangler debug logs under `artifacts/wrangler-logs` by default, so operator evidence runs should not depend on user-home `.wrangler` log write permissions.

Expected before API Worker deploy: R2/D1/web Worker checks are separated, Pages/API URL shape checks pass only when the public URL values are exported, and API deployment/smoke checks fail until the API Workers are deployed. Expected after R2 and API Worker deploy: R2, D1, URL, deployment, and smoke checks pass.

## Staging Smoke

Read-only Worker smoke:

```bash
pnpm smoke:staging
```

Mutation/admin smoke:

```bash
SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin
```

The unblock lane can run the same admin-gated mutation smoke only when the admin token is present:

```bash
pnpm cf:staging:unblock -- --smoke --mutating --timeout-ms=120000
```

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

- R2 still returns `R2_NOT_ENABLED`
- `SILSIGAN_STAGING_API_BASE_URL` is missing, non-HTTPS, or not the configured staging API Worker URL
- `SILSIGAN_STAGING_PAGES_URL` is missing or non-HTTPS
- `SILSIGAN_STAGING_ADMIN_TOKEN` is missing for mutation/admin smoke
- captured Workers tail log is missing for release-candidate evidence

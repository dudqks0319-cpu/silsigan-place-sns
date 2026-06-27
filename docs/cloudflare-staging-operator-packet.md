# Cloudflare staging operator packet

Updated: 2026-06-27
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

If the account is enabled but the staging bucket is missing, create only the configured staging bucket:

```bash
pnpm cf:r2:evidence -- --env=staging --apply --timeout-ms=120000
```

Production bucket creation is a separate production action:

```bash
pnpm cf:r2:evidence -- --env=production --apply --confirm-production --timeout-ms=120000
```

Keep production bucket creation separate from the staging MVP unblock unless production evidence is explicitly needed in the same run.

## Staging Deploy Inputs

After R2 is enabled, set the staging URLs in the shell that will run the release evidence:

```bash
export SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker-api>
export SILSIGAN_STAGING_PAGES_URL=https://silsigan-web-staging.dudqks0319.workers.dev
export SILSIGAN_PRODUCTION_PAGES_URL=https://silsigan-web-production.dudqks0319.workers.dev
export SILSIGAN_PRIVACY_POLICY_URL=https://silsigan-web-staging.dudqks0319.workers.dev/privacy
export SILSIGAN_SUPPORT_URL=https://silsigan-web-staging.dudqks0319.workers.dev/support
```

`SILSIGAN_PRODUCTION_API_BASE_URL` is intentionally left unset until the production API Worker is deployed. Do not use the staging API URL for production-candidate smoke.

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

Run `cf:external-state` and `cf:preflight` in the same shell where the public URL exports above are set. A plain shell currently fails the Pages URL checks even though the web Workers are deployed, because `SILSIGAN_STAGING_PAGES_URL` and `SILSIGAN_PRODUCTION_PAGES_URL` are not automatically loaded from `.env.example`.

Expected before API URL setup: R2/D1/web Worker checks are separated, Pages URL checks pass only when the public URL values are exported, and API URL checks fail until the API Workers are deployed. Expected after R2 and API URL setup: R2, D1, and URL checks pass.

## Staging Smoke

Read-only Worker smoke:

```bash
pnpm smoke:staging
```

Mutation/admin smoke:

```bash
SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin
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
- `SILSIGAN_STAGING_API_BASE_URL` is missing or non-HTTPS
- `SILSIGAN_STAGING_PAGES_URL` is missing or non-HTTPS
- `SILSIGAN_STAGING_ADMIN_TOKEN` is missing for mutation/admin smoke
- captured Workers tail log is missing for release-candidate evidence

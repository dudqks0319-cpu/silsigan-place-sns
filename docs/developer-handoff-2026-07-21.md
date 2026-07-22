# Silsigan V2 developer handoff — 2026-07-21

## Start here

- Canonical remote branch: `codex/silsigan-progress-20260710`
- Current authoritative worktree: `/Users/jyb-m3max/Desktop/codex/silsigan/.worktrees/external-staging-20260721`
- Current integration branch: `agent/external-staging-20260721`
- Verified source commit: `656eb315cbde4505b6c7db342a0185bb2762baea`
- Final release-record commit: use the remote `codex/silsigan-progress-20260710` branch tip; it changes handoff records only after the source commit
- Working tree after the release-record commit: tracked source clean; `artifacts/ui-truth-20260722/` contains four intentionally untracked local PNGs and is not a release input
- Commit/push gate: manual source/diff security gate, secret scan, dependency audit, and negative-path regressions pass. Codex Security scan `7fe0ad74-161b-44e7-bbfb-fb0eeb07c6c2` completed 15/15 review items, and its single Medium stale-client-cache finding is remediated and independently re-reviewed at the verified source commit
- Release state: `staging_running_kv_remediated_photo_turnstile_smoke_pending_production_blocked`
- Production deploy, production D1 migration, provider-source activation, and traffic promotion were not performed.

Do not reset, clean, or copy the primary directory wholesale. `/Users/jyb-m3max/Desktop/codex/silsigan` contains old and user-owned dirty work. Continue only in the authoritative worktree above and preserve its current uncommitted changes.

## Current staging truth

### Cloudflare

- R2 is active. The private staging bucket is `silsigan-photos-staging`.
- Public `r2.dev` access is disabled and no direct R2 custom domain is attached.
- Incomplete multipart uploads abort after seven days.
- Objects under `photos/_uploads/` expire after one day.
- Staging D1 is aligned through migration `0026`; no pending migration was reported.
- Staging API: `https://silsigan-api-staging.dudqks0319.workers.dev`
- Staging web: `https://silsigan-web-staging.dudqks0319.workers.dev`
- Latest staging web version in this handoff: `ad980039-5ba0-4ffb-9616-6f60eb6aea54`; its build-time API base points to the staging API, live mode was verified, and the smoke tab was closed afterward.
- Latest staging API version: `dc07bf4a-879a-421c-aea1-5418f9c8bc0e`; the rotated Turnstile secret is installed by name only.
- An earlier read-only API smoke passed for health, 14 places, place detail/status, place/region/global realtime rooms, rankings, truthful empty comments/photos, and default-deny admin access.
- The latest 2026-07-22 audited reconciliation used fresh Cloudflare dashboard and D1 Insights observations: Workers `3,000`, D1 rows read `504,922`, and rows written `37,386`. The admin-only rebase and atomic resume advanced the global guard to generation `5`, mode `running`; the staging web returned to live data mode.
- Production API remains undeployed and production D1 remains separately blocked.

### Cost and abuse boundary

- Final photo maximum is `1 MiB` after bounded client re-encoding.
- Photo writes were re-enabled only after the live R2 `0 B` state and zero active D1 photo ledger were reconciled. A valid bounded JPEG was selected in the staging web UI and reached the exact-host managed Turnstile challenge. Automation was rejected before token issuance, so upload/moderate/read/delete and zero-residual proof remain pending on a human Turnstile check; no upload success or R2 object is claimed.
- Photo reads are enabled; active R2 bytes, current-month writes, reads, and transforms were all zero at the last reconciliation.
- Server controls include authentication, exact origin checks, per-identity and privacy-preserving IP-fingerprint limits, one-use tickets, idempotency, deduplication, bounded retries, and fail-closed budget checks.
- The global ledger warns at 60%, degrades at 70%, and stops non-critical work at 80%, with an independent manual emergency stop.
- Cloudflare showed about 87,870 actual D1 rows read for the visible billing period, while the conservative application ledger had reserved exactly 3,500,000 rows from 1,583 admitted requests. D1 Insights showed the heaviest observed public query averaging 59 rows.
- The previous route weights were therefore too conservative, not evidence of real quota consumption. The deployed calibration reserves 100 rows for standard/essential reads, 500 for high-cost reads, 200 for personal reads, and at most 500 for writes. Fresh observations and the server's atomic below-70% checks completed successfully; the same predicates remain mandatory for any future resume.
- The recovery contract now supports an explicit audited reservation rebase for this overestimate. It requires the admin role, a non-running guard, the exact current generation, a same-day observation no older than 15 minutes, and records the previous aggregate reservation in `admin_actions`; direct D1 edits are forbidden.
- A browser regression gate now fails when the non-mutating home/map/search/detail journey exceeds 80 API requests.
- The latest cache-busted staging browser smoke passed at `65/80` requests with no application console error.

### NAVER Maps

- The `Silsigan` Dynamic Map application exists and the public Client ID is in `.env.example`.
- No NAVER Client Secret is stored in Git or browser code.
- Staging loaded real NAVER map styles and tiles from the current `nrbe.pstatic.net` and `ssl.pstatic.net/static/maps` hosts.
- The previous false `MAP_RESOURCE_FAILED` fallback came from recognizing only the legacy tile hosts. The current implementation recognizes both legacy and current hosts while still rejecting `auth_fail`.
- After five seconds, Playwright observed the real NAVER map DOM, NAVER legal/logo assets, and place markers without falling back.
- Daily/monthly console limits and 70% alert thresholds were configured earlier; notification-recipient and owner-domain release evidence remain open.
- `workers.dev` is staging preview evidence only and does not satisfy the owner-controlled production-domain gate.

### Public data providers

- Adapters and contract fixtures exist for KMA, TourAPI, national parking, ITS traffic/CCTV, and Seoul realtime.
- Each adapter now has a server-side Korea Standard Time daily provider-request budget checked before outbound network access. Invalid values or timestamps fail closed, ceilings cannot be raised above the compiled free-tier boundary, ITS traffic and CCTV deliberately share one budget, and each run reserves at most two attempts.
- External source ingestion targets: `0`; enabled targets: `0`.
- Source activation remains fail-closed until rights, attribution, credential ownership, quota, TTL, health, enabled region, and fallback evidence are recorded.
- Staging secret names installed and verified by name only:
  - `KMA_SERVICE_KEY`
  - `TOUR_API_SERVICE_KEY`
  - `NATIONAL_PARKING_SERVICE_KEY`
  - `ADMIN_TOKENS`
- Still pending:
  - `ITS_SERVICE_KEY`
- Existing photo-protection names remain `SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET` and `SILSIGAN_TURNSTILE_SECRET_KEY`; role-separated `ADMIN_TOKENS` is installed in staging and role denials were verified without exposing values.
- Never print provider keys. Install them only with Wrangler secret input into staging, then verify by secret name only.
- ITS application fields are prepared but not submitted. The selected products are traffic flow and CCTV metadata only.
- data.go.kr requires the user to complete login/CAPTCHA before KMA and national-parking applications can be prepared.
- TourAPI requires a user login/OAuth and application consent.

## Integrated code changes in this worktree

- Public GET requests no longer add an unnecessary JSON `Content-Type`, removing preflight-only traffic.
- Silent map/query refreshes fetch only scoped places and their statuses after the initial live load.
- All background refreshes use that lightweight path, run every 60 seconds only in one visible same-origin leader tab, and reject overlap.
- Initial photo/comment prefetch scope is reduced from 20 places to five.
- Place-detail photo/comment evidence is fetched lazily when the user opens an uncached place.
- Browser smoke accepts a truthful empty live ranking and enforces an 80-request non-mutating API budget.
- Read-only staging smoke no longer sends a legacy anonymous identifier without its server proof.
- NAVER map health accepts the current pstatic tile hosts and keeps the existing authentication-failure boundary.
- Official-source calls are guarded by persistent daily provider budgets before network access, including shared ITS traffic/CCTV accounting and a `0` kill switch.
- Global D1 route reservations are calibrated to observed staging query cost with safety headroom; the audited 60/70/80 state machine and atomic resume predicates remain unchanged.
- Public API admission reuses the pre-authentication cost-guard control row so each request reads the KV mirror once instead of twice.
- Client refresh scope is explicit: only four map/search/bounds/background callers use `places_status`; creator block/unblock, both moderation-report paths, and account deletion fully reconcile visibility-dependent caches before showing success. Account deletion also clears owned report/post/question/comment/photo caches synchronously.

## Verification completed in this handoff

- Focused provider-budget, provider-quota, and D1 route-calibration regressions passed. The sandbox-only full run failed four local-listen tests with `EPERM`; the authorized loopback run passed.
- Full root suite: `454/454` passed, 0 failed, 0 skipped. A sandbox-only run failed four loopback-listen tests with `EPERM`; the authorized loopback rerun passed. Added regressions cover the truthful no-photo home state, upload focus restoration, final terms surface/URL contract, mobile policy-table containment, provider-budget boundaries, reservation-rebase safety, single-leader visible-only background refresh, exactly one cost-guard KV read per public request, and full post-mutation visibility-cache reconciliation.
- Codex Security diff scan: completed on `d7f0499ee1e8..f5abc50e999d` with 15/15 review receipts and one Medium finding. The non-mutating PoC reproduced on `f5abc50e999d0a8f349d56326a8e9ecb4af6491e`, exits nonzero on `656eb315cbde4505b6c7db342a0185bb2762baea`, and the post-fix independent review passed with no remaining actionable finding in the scoped diff.

## 2026-07-22 KV incident handoff

- Two unattended staging web tabs were closed. They had each run a 30-second full refresh of about 22 API calls.
- The frontend now elects one same-origin leader, refreshes only while visible, prevents overlap, runs every 60 seconds, and uses the lightweight places plus at-most-five-status path after initial load.
- The API pre-authentication cost guard now passes its already-loaded control row into reservation, eliminating the duplicate `COST_GUARD_STATE` KV read while retaining D1 atomic reservation.
- Estimated idle two-tab load fell from about `176 KV reads/min` to about `6 KV reads/min` in the same scenario, excluding initial load, cron, and user actions.
- The exposed Turnstile secret was rotated and the replacement was installed in staging only without printing or writing it. The old value may remain accepted for up to two hours under Cloudflare's rotation grace period.
- Current deployments: API `dc07bf4a-879a-421c-aea1-5418f9c8bc0e`; web `ad980039-5ba0-4ffb-9616-6f60eb6aea54`.
- Production secrets, migrations, deployment, and traffic were not changed. Recheck Workers KV after the daily reset at `09:00 KST`; the previously observed rolling `0.9 reads/s` and `63.9k reads` include pre-remediation history.
- Mobile suite: `4/4` passed, 0 failed, 0 skipped; mobile lint/typecheck also passed.
- WebView syntax/contract check: passed.
- Root lint, typecheck, and Next.js production build: passed.
- `pnpm typecheck`: passed.
- `pnpm cf:build`: passed with Next.js `16.2.6`, OpenNext Cloudflare `1.19.11`, and 27 generated pages/routes.
- Staging web deploy: passed, version `ad980039-5ba0-4ffb-9616-6f60eb6aea54`; live API mode was reverified after embedding the exact staging API base.
- Staging API deploy: passed, version `dc07bf4a-879a-421c-aea1-5418f9c8bc0e`; public health is `200` and `/api/config` exposes no secret field.
- Browser smoke: passed with `65/80` non-mutating API requests.
- Real NAVER tile/style requests: observed; no `MAP_RESOURCE_FAILED` after the stabilization window.
- The first post-deploy smoke received one transient stale HTML document referencing a removed chunk. The exact root subsequently returned the current chunk on three consecutive reads, and the cache-busted release smoke passed. Preserve this as rollout evidence rather than hiding it.

The full repository verification sequence used before the source commit is:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cf:build
pnpm audit:security
git diff --check
```

## Action-time confirmation gates

Stop and obtain the user's immediate confirmation before any of the following:

- accepting provider terms or submitting a utilization application that creates persistent API access
- approving a TourOnePass/OAuth grant
- rotating Cloudflare `ADMIN_TOKENS` or changing their role contract
- installing newly issued provider keys into Cloudflare staging secrets
- enabling any public-data ingestion target
- resuming photo writes or running a mutating photo/admin smoke
- applying a production migration, deploying production, adding a paid domain, or promoting traffic

The current broad implementation request is not a substitute for confirmation at the final submit/grant/credential action.

## Safe next order

1. User unlocks the Mac and completes data.go.kr CAPTCHA login.
2. Prepare KMA and national-parking applications; do not submit yet.
3. Prepare TourAPI OAuth/application and retain the already prepared ITS form; do not submit yet.
4. Submit only the already reviewed provider forms. Role-separated staging `ADMIN_TOKENS` and the three existing provider keys are already installed in staging only.
5. Keep every official source and ingestion target disabled while applications, rights, attribution, and health remain unresolved.
6. Validate provider contracts and source health one source at a time, beginning with KMA.
7. Monitor the recovered generation-`5` guard with redacted aggregates; use the audited endpoint and fresh observations for any future stop/resume.
8. Keep the reconciled photo guard enabled only while its R2/D1 counters remain within bounds.
9. After the visible Turnstile human check succeeds, run one 1 MiB-or-smaller upload/moderate/read/delete smoke and confirm zero residual R2 bytes.
10. Complete moderation webhook, cost-alert recipient, WAF/rate-limit, and tail-redaction evidence.
11. Preserve the 2026-07-23 iPhone 12 Pro Apple Development-signed build/install/launch/startup pass, then finish screenshot-backed location, camera/library, photo lifecycle, mutation/deletion, and full-session crash QA after the user unlocks iPhone Mirroring. Android real-device QA, legal/operations sign-off, TestFlight release archive/privacy evidence, and push delivery remain separate gates.
12. Consider production only after every P0 in `release-ledger.yaml` is closed and separately approved.

## Security gate

- No secret, raw IP, exact GPS, anonymous proof, private R2 key, original filename, or original image URL in Git, logs, analytics, or public responses.
- Authenticate and authorize before expensive work.
- Bound upload bytes, image dimensions, count, concurrency, queue depth, retries, and provider calls before the metered operation.
- Require idempotency and one-use tickets for writes; reject replay and duplicate transforms.
- Keep source rights/health and budget uncertainty fail-closed.
- Local tests and dashboards are implementation evidence, not production operational completion.

## Important references

- `docs/silsigan-v2-master-completion-plan-2026-07-21.md`
- `docs/current-release-state.md`
- `RELEASE_STATUS.md`
- `release-ledger.yaml`
- `docs/cloudflare-staging-operator-packet.md`
- `docs/cloudflare-cost-usage-runbook.md`
- `docs/source-ingestion-scheduler-runbook.md`
- `docs/real-device-qa.md`

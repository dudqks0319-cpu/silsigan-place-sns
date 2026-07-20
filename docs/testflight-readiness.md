# #실시간 TestFlight readiness

Updated: 2026-07-20
Source of truth: `docs/current-release-state.md`
Operator packet: `docs/cloudflare-staging-operator-packet.md`

## Verdict

현재 목표는 App Store 정식 제출이 아니라 Cloudflare 기반 TestFlight MVP다.

| Target | Current judgement | Reason |
| --- | --- | --- |
| Web/PWA beta MVP | local complete; staging read-only | Cloudflare Worker API, D1 schema, local browser smoke, reporting, photos, likes, comments, rankings, and moderation guards are implemented and locally verified. Both web Workers are deployed, but the API Workers and live mutation path are not. |
| TestFlight internal testing | candidate after staging API/R2/D1/Turnstile | Native wrapper and permission copy are locally verified; live staging API, R2, D1 registry reconciliation plus the real `0026` gap, Turnstile, and device evidence are still required. |
| TestFlight external testing | blocked | Needs real staging smoke, R2/Images mutation proof, production-safe moderation runbook, and device QA evidence. |
| App Store production submission | blocked | This is still a beta MVP until external Cloudflare resources, UGC operations, and real-device evidence are complete. |

## Assessment Reconciliation

The earlier release assessment correctly warns against App Store submission, but several implementation facts are now stale:

- Backend is no longer a Supabase-first MVP in the current release branch. README, package dependencies, release checks, and tests now target Cloudflare Workers, D1, R2, Durable Objects, and OpenNext Cloudflare.
- Nationwide map and ranking scope are not just roadmap text. Local smoke and tests cover nationwide/region/map-bounds ranking panels, current-location controls, bbox place loading, and Worker ranking API query propagation.
- Remaining release blockers are external-state and evidence blockers, not missing local code paths: R2 activation, Turnstile provisioning, dedicated `COST_GUARD_STATE` KV plus WAF/static-routing evidence, both API Worker deployments and URLs, Staging D1 registry reconciliation and `0026`, production D1, a NAVER owner domain, real staging mutation smoke including 60/70/80 global cost transitions, anonymous-proof lifecycle, exact issuance-budget evidence, and private place-request queue/guard evidence, moderation/alert operations, source rights, signing, and real-device QA. Wrangler OAuth, both web Worker deployment histories, and Staging schema evidence through `0025` already pass, but Wrangler still lists `0018`~`0026` pending.
- App Store submission remains the wrong next milestone. The correct milestone is a TestFlight MVP with live Cloudflare staging and real-device QA.

## TestFlight MVP Gate

The following must be true before treating the app as TestFlight-ready:

- [ ] `pnpm release:status -- --strict` passes or reports only intentionally deferred App Store production items.
- [ ] Cloudflare R2 is enabled and `pnpm cf:r2:evidence -- --env=staging --check` passes.
- [ ] Exact-host Turnstile site key and server-only secret are provisioned, and upload-ticket success/failure evidence passes on staging.
- [~] Staging D1 schema already verifies `0018` through `0025`, but Wrangler's registry lists `0018`~`0026` pending. Back up and reconcile history first; the guarded harness must pass before any explicitly approved safe-suffix apply (currently expected `0026`). Audit post-`0022` live R2/D1 storage reconciliation before uploads resume, provision a separate cost-state KV, and prove `api_cost_guard_*` 60/70/80 plus reconciliation evidence.
- [ ] Staging Worker API is deployed and `SILSIGAN_STAGING_API_BASE_URL` is set to an HTTPS URL.
- [~] Staging web Worker is deployed at `https://silsigan-web-staging.dudqks0319.workers.dev`; the release invocation must still export that exact value as `SILSIGAN_STAGING_PAGES_URL`.
- [ ] `pnpm cf:external-state` passes for staging R2, staging D1, staging Worker dry-run, and deployment URL shape.
- [ ] `pnpm smoke:staging` passes against the staging Worker.
- [ ] `SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin` passes with a staging admin token.
- [ ] `pnpm smoke:pages` passes against staging Pages and staging Worker URLs.
- [ ] Workers tail redaction is captured from staging and passes `pnpm smoke:tail-redaction`.
- [x] TestFlight beta description, reviewer instructions, permission copy, UGC moderation notes, and staging evidence requirements are documented in `docs/testflight-review-notes.md` and guarded by `release:status`.
- [x] Local `/privacy` and `/support` pages exist and are guarded by `release:status` for implemented data-handling, support, report, deletion, and final URL language.
- [x] Privacy/support URL readiness is guarded by `release:status`; missing, placeholder, non-HTTPS, localhost, query/fragment, credentialed, or duplicate values fail before external TestFlight review notes are submitted.
- [x] iOS `PrivacyInfo.xcprivacy`, Android app-data backup/device-transfer exclusions, and app-scoped FileProvider paths are present and guarded by native contract tests.
- [x] `docs/store-privacy-disclosure-draft.md` inventories App Privacy/Data Safety answers and is guarded by `release:status`; this does not claim console submission or legal approval.
- [x] Real-device QA ledger structure is guarded by `release:status`; missing iPhone/Android matrices, permission flows, UGC flows, redaction rules, crash checks, or evidence artifact names fail before TestFlight internal testing.
- [ ] iPhone real-device QA in `docs/real-device-qa.md` covers launch, map display, current-location allow/deny, place detail, report create, comment create/delete, photo upload/preview, like/unlike, moderation report, and no raw coordinate/file-name leakage in visible UI.
- [ ] Android real-device QA in `docs/real-device-qa.md` covers the same user flows if Android beta distribution is in scope.

## App Store Submission Gate

Only consider App Store production submission after TestFlight evidence is clean and these additional gates pass:

- [~] Staging D1 schema is remotely verified through `0025`, but migration history drift must be reconciled before the real `0026` gap can be applied. Production currently reports `D1_0006_NOT_APPLIED` and requires separate approval only after clean staging evidence.
- [ ] Production Worker API and Pages URLs are deployed and set in `SILSIGAN_PRODUCTION_API_BASE_URL` / `SILSIGAN_PRODUCTION_PAGES_URL`.
- [ ] `pnpm release:gate -- --production-candidate` passes.
- [ ] Final archive privacy report, App Store Connect App Privacy, Google Play Console Data Safety, support/privacy URLs, and review notes are compared with the implemented data handling and signed by named reviewers. The code-matched local draft is complete.
- [x] UGC moderation owner, response SLA, abuse handling, user restriction, and deletion/restore runbook is documented and guarded by `release:status`.
- [ ] Staging/production moderation alert webhook secrets and live queue access are configured and verified.
- [x] Ranking manipulation smoke proves repeated same-user click/like signals do not inflate D1 ranking counts.
- [x] Cloudflare cost/usage dashboard criteria, budget alerts, evidence cadence, and TestFlight stop conditions are documented and guarded by `release:status`.
- [~] Local 390x844 browser E2E verifies the exact confirmation phrase, permanent anonymous-data deletion, zero remaining mock-owned content, new server-bound session issuance, and old-proof 403 rejection. Live staging retention/deletion plus signed native real-device execution remain required before this becomes complete.
- [~] `docs/store-listing-draft.md`에 실제 앱 화면 기반 메타데이터와 390x844 로컬 후보 4장을 준비했다. mock-data 후보이므로 live staging API, 실제 승인 사진, 최종 배포 앱 실기기 화면으로 교체하기 전에는 제출하지 않는다. 네이버 지도 화면은 소유자 도메인과 origin 증거 전까지 제외한다.

## Current Blockers

| Blocker | Owner action |
| --- | --- |
| R2 activation and private staging bucket | Complete Cloudflare's user-only payment/terms hand-off, create only the configured private staging bucket, then rerun R2 evidence. |
| Missing Turnstile credentials | Create exact-host staging/production widgets and install public site keys plus server-only secrets without committing secrets. |
| Staging D1 migration history and tail | Back up Staging, reconcile Wrangler's missing `0018`~`0025` history without replaying migrations, require the guarded registry preflight to pass, then explicitly approve only the safe suffix (currently expected `0026_global_api_cost_guard.sql`). Record global-cost evidence, provision the dedicated KV, and reconcile live R2/D1 for already-present `0022` before resuming uploads. |
| Missing API Worker deployments and API URLs | Deploy the configured API Workers only after R2/D1/Turnstile are ready and export the staging/production API URL variables. Both web Workers are already deployed. |
| NAVER owner domain and final application registration | Attach an owner-controlled domain, complete the prepared Dynamic Map registration after explicit approval, set exact allowed origins, limits, and alert recipient, then prove valid-origin success and invalid-origin rejection. |
| No real staging smoke yet | Run staging Worker, Pages, mutation, admin, and tail-redaction smoke after URLs/R2 are ready. |
| No real-device QA evidence yet | Fill `docs/real-device-qa.md` with iPhone and Android device evidence after staging is live. |
| Anonymous proof deployment and residual bearer replay risk | Staging has applied `0023`/`0024`; deploy the API with `SILSIGAN_ANON_SESSION_REQUIRED=1` and `SILSIGAN_ANON_SESSION_DAILY_LIMIT=5000`, prove wrong/rotated/revoked proof, stolen-ID rejection, exact distributed issuance cap, and stale-session cleanup on the owner domain, and select member/device binding if theft of the complete ID+proof pair must also be resisted. |

## 2026-06-26 Phase 1 Read-Only Probe Before D1 Apply

Read-only Cloudflare probes were rerun without mutating R2, D1, Worker, or Pages resources.

| Probe | Result | Evidence |
| --- | --- | --- |
| `pnpm cf:external-state` | blocked | R2, four missing deployment URL blockers, and production D1 pending status before the follow-up apply; staging D1 `0002` and staging/production Worker dry-runs still passed. |
| `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=60000` | blocked | Fails on `cloudflare.r2.enabled` / `R2_NOT_ENABLED`. |
| `pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000` | blocked | Remote production D1 listed pending `0002_posts_questions.sql` before the follow-up apply below. |
| `node scripts/release-state-check.mjs --strict --cloudflare-external-state-report=/tmp/silsigan-cf-external-state-20260626.json` | blocked | Combined blocker payload included release ledger open blockers, four deployment URL blockers, R2, and production D1 pending status before the follow-up apply below. |

No mutating action was executed during this read-only probe. R2 enablement, bucket creation, deployment URL setup, and production D1 `--apply --confirm-production` still required a separate guarded step at that point.

## 2026-06-26 Phase 1 D1 Apply

Production D1 `0002_posts_questions.sql` was applied with the explicit production confirmation guard.

| Probe | Result | Evidence |
| --- | --- | --- |
| `pnpm cf:d1:evidence -- --env=production --apply --confirm-production --timeout-ms=120000` | pass | Applied `0002_posts_questions.sql`, reran the idempotent seed, and verified `posts=4`, `questions=3`. |
| `pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000` | pass | Remote production D1 reports no pending migrations and keeps `posts=4`, `questions=3`. |
| `node scripts/cloudflare-external-state-check.mjs` | blocked | Production D1 now passes; remaining blockers are `R2_NOT_ENABLED` and the four missing staging/production deployment URLs. |

R2 enablement, R2 bucket creation, deployment URL setup, real staging smoke, and real-device QA are still open.

## 2026-06-26 R2 Recheck

R2 was rechecked after production D1 passed.

| Probe | Result | Evidence |
| --- | --- | --- |
| `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000` | blocked | Still fails on `cloudflare.r2.enabled` / `R2_NOT_ENABLED`. |
| `node scripts/cloudflare-external-state-check.mjs` | blocked | Staging and production D1 pass; remaining external blockers are R2 plus the four staging/production deployment URLs. |
| Cloudflare R2 docs | operator action required | The account needs an R2 subscription added through Cloudflare Dashboard checkout before CLI bucket evidence can pass: https://developers.cloudflare.com/r2/get-started/ |

No R2 bucket create, Worker deploy, Pages deploy, or staging smoke was run because R2 subscription and staging URLs are still missing.

## 2026-06-27 External-State Gate Hardening

The external-state gate now treats missing Cloudflare auth as the canonical blocker before dependent R2/D1 remote checks. In the current authenticated run, auth passes, staging and production D1 `0002` evidence pass with `posts=4`, `questions=3`, and the remaining blockers are still `R2_NOT_ENABLED` plus the four missing deployment URLs.

## 2026-06-27 Worker Deployment Inventory

Read-only Wrangler deployment probes found that the configured Workers are not deployed yet: `silsigan-api-staging`, `silsigan-api-production`, `silsigan-web-staging`, and `silsigan-web-production`. The external-state gate now reports these as `worker_deployment.staging.api`, `worker_deployment.production.api`, `worker_deployment.staging.web`, and `worker_deployment.production.web` blockers before real staging smoke can start.

## 2026-06-26 Ranking Manipulation Smoke

This dated entry is historical. The current release candidate verification is `361/361`; the older `125 tests` count below is retained only for audit traceability.

The D1 ranking smoke now covers repeated same-user click and like attempts against the same place.

| Probe | Result | Evidence |
| --- | --- | --- |
| `pnpm test -- tests/cloudflare-api.test.ts` | pass | 125 tests passed. The D1 ranking smoke verifies the first same-user place click and like create one signal each, the repeated click/like return `created=false`, `place_events` stores one click and one like, and regional ranking keeps `clickCount=1`, `likeCount=1`, `uniqueUserCount=1`, `score=101`; the UGC runbook smoke verifies required owner, alert queue, SLA, target type, and operator-action evidence; the Cloudflare cost/usage runbook smoke verifies Usage & billing, Billing alerts, product metrics, cadence, and TestFlight stop-condition evidence; the TestFlight review notes smoke verifies beta copy, staging URL requirements, permission copy, UGC moderation, privacy/support URL status, staging evidence, and stop conditions; the real-device QA ledger smoke verifies iPhone/Android matrices, staging environment fields, permission flows, UGC flows, redaction rules, crash checks, and artifact names; the public privacy/support page smoke verifies implemented data handling, TestFlight support, content reports, deletion requests, and final URL language; the privacy/support URL smoke verifies required HTTPS URLs and rejects unsafe or placeholder values; the external-state smoke verifies auth-related remote check failures collapse to `CLOUDFLARE_AUTH_REQUIRED` and Worker-missing responses collapse to `worker_deployment.*` blockers without leaking raw Wrangler output. |

## 2026-06-26 UGC Moderation Runbook Gate

The TestFlight/App Store UGC moderation runbook is now a release-state checked artifact.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | blocked-external expected | The check now requires `docs/ugc-moderation-runbook.md` to include ownership, intake queue, SLA, operator actions, evidence/audit, escalation, stop conditions, moderation target types, and action tokens. Current failure remains the known external P0 blockers, not missing UGC runbook documentation. |

## 2026-06-26 Cloudflare Cost/Usage Runbook Gate

The Cloudflare cost/usage MVP criteria are now a release-state checked artifact.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | blocked-external expected | The check now requires `docs/cloudflare-cost-usage-runbook.md` to cover owner, Usage & billing dashboard checks, baseline thresholds, Billing alerts, daily/weekly evidence cadence, product tokens for R2/D1/Workers/Durable Objects/Cloudflare Images, and TestFlight stop conditions. Current failure remains the known external P0 blockers, not missing cost/usage criteria. |

## 2026-06-26 TestFlight Review Notes Gate

The TestFlight beta/reviewer note packet is now a release-state checked artifact. This closes the P1 "external TestFlight review notes" documentation gap without claiming external TestFlight submission readiness.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | blocked-external expected | The check now requires `docs/testflight-review-notes.md` to cover beta app description, reviewer instructions, permissions, UGC moderation, privacy policy URL/support URL status, staging evidence, and stop conditions. Current failure remains the known external P0 blockers, not missing TestFlight review-note coverage. |

Closed on 2026-07-19: the final privacy policy URL and support URL are live HTTPS pages. Store-console entry and named legal review remain open.

## 2026-06-26 Privacy/Support URL Gate

The privacy/support URL finalization blocker is now release-state checked instead of only being text in the readiness plan.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | URL guard pass; release blocked elsewhere | The check requires `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL` to be distinct HTTPS URLs with no placeholders, credentials, query params, fragments, or localhost hosts. Both selected production URLs are live; current release failure comes from the remaining external P0/P1 blockers. |

## 2026-06-27 Real-Device QA Ledger Gate

The real-device QA ledger is now a release-state checked artifact. This closes the documentation-shape gap without claiming iPhone or Android QA has passed.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | blocked-external expected | The check now requires `docs/real-device-qa.md` to cover staging Pages/API environment fields, `R2_NOT_ENABLED`, TestFlight and Android build selection, iPhone and Android QA matrices, Naver map display, location allow/deny, camera/photo library, photo upload/preview, like/unlike, ranking refresh, report/moderation, crash checks, redaction requirements, and artifact names. Current failure remains expected until live staging, real-device evidence, and external URLs are available. |

## 2026-06-27 Privacy/Support Pages

Local public privacy and support pages exist, and the selected production HTTPS URLs returned HTTP 200 on 2026-07-19.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | page and URL guards pass; release blocked elsewhere | The check requires `src/app/privacy/page.tsx` and `src/app/support/page.tsx` to include public-page tokens for data handling, Cloudflare D1/R2, location, photos, reports, deletion requests, TestFlight support, and final support/privacy URL language. The selected HTTPS values are recorded; store-console entry and named legal review remain external. |

## 2026-07-19 Native Privacy And Store Disclosure Gate

The native projects now fail closed on app-data backup and broad file-provider exposure, and the code-matched store disclosure is a release-state checked artifact.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node --experimental-strip-types --test --test-name-pattern='native shells declare privacy use' tests/webview-shell.test.ts` | pass | Verifies the iOS manifest data categories and target resource, Android backup/device-transfer exclusions, and the absence of a broad external-storage FileProvider path. |
| `node --experimental-strip-types --test --test-name-pattern='store privacy disclosure draft' tests/cloudflare-api.test.ts` | pass | Verifies required Apple, Google, data inventory, native enforcement, console checklist, and stop-condition content. |

Still open: a signed archive privacy report, actual App Store Connect/Google Play Console answers, named legal/mobile-release review, and real-device restore/permission evidence.

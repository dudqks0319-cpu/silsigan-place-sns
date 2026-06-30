# #실시간 TestFlight readiness

Updated: 2026-06-30
Source of truth: `docs/current-release-state.md`
Operator packet: `docs/cloudflare-staging-operator-packet.md`

## Verdict

현재 목표는 App Store 정식 제출이 아니라 Cloudflare 기반 TestFlight MVP다.

| Target | Current judgement | Reason |
| --- | --- | --- |
| Web/PWA beta MVP | possible locally | Cloudflare Worker API, D1 schema, local browser smoke, reporting, photos, likes, comments, rankings, and moderation guards are implemented and locally verified. |
| TestFlight internal testing | candidate after staging API/R2 | Native wrapper and permission copy can be exercised once the staging API Worker deployment, R2, and mutation smoke are available; staging/production web read-only smoke now passes. |
| TestFlight external testing | blocked | Needs real staging smoke, R2/Images mutation proof, production-safe moderation runbook, and device QA evidence. |
| App Store production submission | blocked | This is still a beta MVP until external Cloudflare resources, UGC operations, and real-device evidence are complete. |

## Assessment Reconciliation

The earlier release assessment correctly warns against App Store submission, but several implementation facts are now stale:

- Backend is no longer a Supabase-first MVP in the current release branch. README, package dependencies, release checks, and tests now target Cloudflare Workers, D1, R2, Durable Objects, and OpenNext Cloudflare.
- Nationwide map and ranking scope are not just roadmap text. Local smoke and tests cover nationwide/region/map-bounds ranking panels, current-location controls, bbox place loading, and Worker ranking API query propagation.
- Remaining release blockers are mostly external-state and evidence blockers, not missing local code paths: `R2_NOT_ENABLED`, missing configured API Worker deployments, release-shell URL exports, and real staging mutation smoke.
- App Store submission remains the wrong next milestone. The correct milestone is a TestFlight MVP with live Cloudflare staging and real-device QA.

## TestFlight MVP Gate

The following must be true before treating the app as TestFlight-ready:

- [ ] `pnpm release:status -- --strict` passes or reports only intentionally deferred App Store production items.
- [ ] Cloudflare R2 is enabled and `pnpm cf:r2:evidence -- --env=staging --check` passes.
- [ ] Staging Worker API is deployed and `SILSIGAN_STAGING_API_BASE_URL` is set to an HTTPS URL.
- [x] Staging web frontend is deployed at `https://silsigan-web-staging.dudqks0319.workers.dev` and read-only `pnpm smoke:pages` passes for map controls, bottom nav, ranking detail, and marker detail.
- [x] `SILSIGAN_STAGING_PAGES_URL` value is defined in `.env.example` and `docs/cloudflare-staging-operator-packet.md`.
- [ ] `SILSIGAN_STAGING_PAGES_URL` is exported in the actual release/smoke shell.
- [x] Production web frontend is deployed at `https://silsigan-web-production.dudqks0319.workers.dev` and read-only `pnpm smoke:pages` passes for map controls, bottom nav, ranking detail, and marker detail.
- [x] `SILSIGAN_PRODUCTION_PAGES_URL` value is defined in `.env.example` and `docs/cloudflare-staging-operator-packet.md`.
- [ ] `SILSIGAN_PRODUCTION_PAGES_URL` is exported in the actual release/smoke shell.
- [ ] `pnpm cf:external-state` passes for staging R2, staging D1, staging Worker dry-run, and deployment URL shape.
- [ ] `pnpm smoke:staging` passes against the staging Worker.
- [ ] `SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin` passes with a staging admin token.
- [ ] `pnpm smoke:pages` passes against staging Pages and staging Worker URLs.
- [ ] Workers tail redaction is captured from staging and passes `pnpm smoke:tail-redaction`.
- [x] TestFlight beta description, reviewer instructions, permission copy, UGC moderation notes, and staging evidence requirements are documented in `docs/testflight-review-notes.md` and guarded by `release:status`.
- [x] Local `/privacy` and `/support` pages exist and are guarded by `release:status` for implemented data-handling, support, report, deletion, and final URL language.
- [x] Privacy/support URL readiness is guarded by `release:status`; missing, placeholder, non-HTTPS, localhost, query/fragment, credentialed, or duplicate values fail before external TestFlight review notes are submitted.
- [x] `apps/mobile` TestFlight shell exposes public `개인정보`, `지원 문의`, and `staging web` link controls and verifies release-shaped staging/privacy/support URLs locally.
- [x] Real-device QA ledger structure is guarded by `release:status`; missing iPhone/Android matrices, permission flows, UGC flows, redaction rules, crash checks, or evidence artifact names fail before TestFlight internal testing.
- [ ] iPhone real-device QA in `docs/real-device-qa.md` covers launch, map display, current-location allow/deny, place detail, report create, comment create/delete, photo upload/preview, like/unlike, moderation report, and no raw coordinate/file-name leakage in visible UI.
- [ ] Android real-device QA in `docs/real-device-qa.md` covers the same user flows if Android beta distribution is in scope.

## App Store Submission Gate

Only consider App Store production submission after TestFlight evidence is clean and these additional gates pass:

- [x] Production D1 `0002_posts_questions.sql` is applied with `pnpm cf:d1:evidence -- --env=production --apply --confirm-production`.
- [ ] Production Worker API and Pages URLs are deployed and set in `SILSIGAN_PRODUCTION_API_BASE_URL` / `SILSIGAN_PRODUCTION_PAGES_URL`.
- [ ] `pnpm release:gate -- --production-candidate` passes.
- [ ] App privacy labels, support URL, privacy policy URL, and review notes match the implemented data handling.
- [x] UGC moderation owner, response SLA, abuse handling, user restriction, and deletion/restore runbook is documented and guarded by `release:status`.
- [ ] Staging/production moderation alert webhook secrets and live queue access are configured and verified.
- [x] Ranking manipulation smoke proves repeated same-user click/like signals do not inflate D1 ranking counts.
- [x] Cloudflare cost/usage dashboard criteria, budget alerts, evidence cadence, and TestFlight stop conditions are documented and guarded by `release:status`.
- [ ] Account deletion or anonymous data deletion/retention behavior is verified end-to-end if account-like identity is exposed in the native build.
- [ ] Store screenshots and metadata use real app surfaces, not placeholder beta/demo claims.

## Current Blockers

| Blocker | Owner action |
| --- | --- |
| `R2_NOT_ENABLED` | Add the R2 subscription through Cloudflare Dashboard checkout, then rerun R2 evidence checks. |
| Missing API Worker deployments and release-shell URL exports | Staging/production web Workers are deployed and public URL values are defined; deploy configured staging/production API Workers, then export the `SILSIGAN_*_URL` variables in the release/smoke shell. |
| Missing privacy/support URL shell exports | Local `/privacy` and `/support` pages now exist on the staging web URL, and `.env.example` / operator packet define the HTTPS values. Export `SILSIGAN_PRIVACY_POLICY_URL` / `SILSIGAN_SUPPORT_URL` in the actual release shell before external TestFlight notes. |
| No real staging smoke yet | Run staging Worker, Pages, mutation, admin, and tail-redaction smoke after URLs/R2 are ready. |
| No real-device QA evidence yet | Fill `docs/real-device-qa.md` with iPhone and Android device evidence after staging is live. |

## 2026-06-27 Current Recheck After Mobile Guard Push

The pushed branch head is now `98f3c6d`. Local gates still pass, and the remaining blockers are external Cloudflare account/deployment items.

| Probe | Result | Evidence |
| --- | --- | --- |
| `pnpm test` | pass | 126 tests passed, including mobile TestFlight shell guard coverage, external-state blocker canonicalization, R2/D1 evidence planners, Worker/D1 API behavior, ranking abuse controls, moderation/admin auth, and local smoke harness checks. |
| `node scripts/release-state-check.mjs --strict` with `.env.example` sourced | blocked expected | Local docs, mobile TestFlight shell, web URL shape, privacy/support URL shape, D1/KV bindings, OpenNext config, and legacy-removal gates pass. Remaining failures are open release blockers plus missing staging/production API URL values. |
| `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000` | blocked | Still fails on `cloudflare.r2.enabled` / `R2_NOT_ENABLED`; no bucket creation or mutation was attempted. |
| `pnpm cf:external-state` in a plain shell | blocked | Wrangler auth, staging/production web Worker deployment history, staging/production D1 `0002` evidence, and Worker dry-runs pass. Current blockers are `R2_NOT_ENABLED`, missing staging/production API Workers, and missing staging/production Pages/API URL shell exports. |

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

No R2 bucket create, API Worker deploy, Pages redeploy, or staging smoke was run because R2 subscription and the API Worker release path were still blocked.

## 2026-06-27 External-State Gate Hardening

The external-state gate now treats missing Cloudflare auth as the canonical blocker before dependent R2/D1 remote checks. In the current authenticated run, auth passes, staging and production D1 `0002` evidence pass with `posts=4`, `questions=3`, and the remaining blockers are still `R2_NOT_ENABLED` plus the four missing deployment URLs.

## 2026-06-27 Worker Deployment Inventory

Initial read-only Wrangler deployment probes found that the configured Workers were not deployed yet: `silsigan-api-staging`, `silsigan-api-production`, `silsigan-web-staging`, and `silsigan-web-production`. After the web deploys below, the external-state gate reports `worker_deployment.staging.web` and `worker_deployment.production.web` as pass; remaining Worker deployment blockers are `worker_deployment.staging.api` and `worker_deployment.production.api`.

## 2026-06-27 Staging Web Worker Deploy

The configured OpenNext staging web Worker is now deployed, but this does not unblock API/R2 mutation smoke by itself.

| Probe | Result | Evidence |
| --- | --- | --- |
| `pnpm cf:build` | pass | Clean deploy worktree at `40bc4dd` generated `.open-next/worker.js`. |
| `pnpm cf:web:dry-run:staging` | pass | Wrangler validated 95 static assets and the `ASSETS` binding for `silsigan-web-staging`. |
| `pnpm exec wrangler deploy --config wrangler.jsonc --env staging` | pass | Deployed `silsigan-web-staging` version `1f78ede2-80c6-4ac6-8388-305bfa8b4a1c` to `https://silsigan-web-staging.dudqks0319.workers.dev`. |
| `curl -I https://silsigan-web-staging.dudqks0319.workers.dev` | pass | Returned HTTP 200. |
| `pnpm smoke:pages -- --pages-url=https://silsigan-web-staging.dudqks0319.workers.dev --timeout-ms=60000` | pass read-only | Map surface/visibility, uncovered map controls, traffic/filter/requery, header buttons, onboarding dismiss, bottom nav, safety menu, ranking detail, and marker detail passed. Mutating and share/OG checks were intentionally skipped. |

Still open: export `SILSIGAN_STAGING_PAGES_URL` in the actual release/smoke shell, deploy the staging API Worker after R2 is enabled, and run real staging API/mutation/admin/tail smoke.

## 2026-06-27 Production Web Worker Deploy

The configured OpenNext production web Worker is now deployed for URL readiness evidence, but production API smoke remains blocked until the API Worker can deploy after R2 is enabled.

| Probe | Result | Evidence |
| --- | --- | --- |
| `pnpm cf:build` | pass | Clean deploy worktree at `33195ae` generated `.open-next/worker.js`. |
| `pnpm cf:web:dry-run:production` | pass | Wrangler validated 95 static assets and the `ASSETS` binding for `silsigan-web-production`. |
| `pnpm exec wrangler deploy --config wrangler.jsonc --env production` | pass | Deployed `silsigan-web-production` version `2c136948-8a7e-450a-93d4-0fe8d5d8fcdb` to `https://silsigan-web-production.dudqks0319.workers.dev`. |
| `curl -I https://silsigan-web-production.dudqks0319.workers.dev` | pass | Returned HTTP 200. |
| `pnpm smoke:pages -- --pages-url=https://silsigan-web-production.dudqks0319.workers.dev --timeout-ms=60000` | pass read-only | Map surface/visibility, uncovered map controls, traffic/filter/requery, header buttons, onboarding dismiss, bottom nav, safety menu, ranking detail, and marker detail passed. Mutating and share/OG checks were intentionally skipped. |

Still open: export `SILSIGAN_PRODUCTION_PAGES_URL` in the actual release/smoke shell, deploy the production API Worker after R2 is enabled, and run production-candidate read-only API/Pages smoke.

## 2026-06-26 Ranking Manipulation Smoke

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

Still open: the final privacy policy URL and support URL values must be exported in the actual release shell before external TestFlight review notes are submitted.

## 2026-06-26 Privacy/Support URL Gate

The privacy/support URL finalization blocker is now release-state checked instead of only being text in the readiness plan.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | blocked-external expected | The check now requires `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL` to be distinct HTTPS URLs with no placeholders, credentials, query params, fragments, or localhost hosts. With `.env.example` sourced, these URL shape checks pass and the current failure remains the known open release/API URL blockers. |

## 2026-06-27 Real-Device QA Ledger Gate

The real-device QA ledger is now a release-state checked artifact. This closes the documentation-shape gap without claiming iPhone or Android QA has passed.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | blocked-external expected | The check now requires `docs/real-device-qa.md` to cover staging Pages/API environment fields, `R2_NOT_ENABLED`, TestFlight and Android build selection, iPhone and Android QA matrices, Naver map display, location allow/deny, camera/photo library, photo upload/preview, like/unlike, ranking refresh, report/moderation, crash checks, redaction requirements, and artifact names. Current failure remains expected until live staging, real-device evidence, and external URLs are available. |

## 2026-06-30 Real-Device QA Evidence Gate

The real-device QA ledger now has an executable evidence check and an artifact scaffold helper. This is intentionally stricter than `release:status`: it fails while the ledger still contains `blocked-staging`, missing URLs, unselected builds, `R2_NOT_ENABLED`, non-pass matrix rows, or no dated iPhone/Android artifact directories.

| Probe | Result | Evidence |
| --- | --- | --- |
| `pnpm qa:real-device:init -- --platform=iphone --build=<testflight-build>` | pass local | Creates `device-summary.md`, `screenshots/`, `network-redacted.json`, `console-redacted.log`, and `known-issues.md` under `artifacts/real-device-qa/<date>-iphone-<build>/`; Android uses `--platform=android`. |
| `pnpm qa:real-device` | blocked expected | Current `docs/real-device-qa.md` is still a blocked staging ledger, so the command should fail until iPhone and Android evidence is captured under `artifacts/real-device-qa/<date>-<platform>-<build>/`. |
| `pnpm test` | pass required | 136 tests pass, including failure on a blocked ledger, success on a completed iPhone/Android fixture, and artifact scaffold creation/rejection coverage. |

## 2026-06-27 Privacy/Support Pages

Local public privacy and support pages now exist on the deployed staging web URL, but final readiness still requires exporting those HTTPS values in the actual release shell.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | blocked-external expected | The check now requires `src/app/privacy/page.tsx` and `src/app/support/page.tsx` to include public-page tokens for data handling, Cloudflare D1/R2, location, photos, reports, deletion requests, TestFlight support, and final support/privacy URL language. With `.env.example` sourced, page and URL checks pass; external TestFlight readiness still requires final release-shell export evidence. |

## 2026-06-27 Mobile Public URL Readiness

The Expo mobile shell now carries the same public staging/privacy/support links that the web release gates expect. This prepares the internal TestFlight surface without claiming staging API/R2 or real-device QA completion.

| Probe | Result | Evidence |
| --- | --- | --- |
| `cd apps/mobile && pnpm lint` | pass | ESLint passes after adding `Linking.openURL` public support controls. |
| `cd apps/mobile && pnpm typecheck` | pass | TypeScript passes with `serviceLinks` and URL readiness helpers. |
| `cd apps/mobile && pnpm test` | pass | 5 tests pass, including release-shaped public staging/privacy/support URL coverage. |
| `cd apps/mobile && expo config --json` | pass | Expo manifest includes iOS camera/location/photo usage strings, Android camera/location permissions, and `extra.silsigan` public URL metadata. |
| `cd apps/mobile && expo export --platform web` | not applicable | Blocked by missing `react-native-web`; no new dependency was added because the TestFlight target is native and real-device QA remains the required surface. |

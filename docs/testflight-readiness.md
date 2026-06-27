# #실시간 TestFlight readiness

Updated: 2026-06-27
Source of truth: `docs/current-release-state.md`
Operator packet: `docs/cloudflare-staging-operator-packet.md`

## Verdict

현재 목표는 App Store 정식 제출이 아니라 Cloudflare 기반 TestFlight MVP다.

| Target | Current judgement | Reason |
| --- | --- | --- |
| Web/PWA beta MVP | possible locally | Cloudflare Worker API, D1 schema, local browser smoke, reporting, photos, likes, comments, rankings, and moderation guards are implemented and locally verified. |
| TestFlight internal testing | candidate after staging URLs/R2 | Native wrapper and permission copy can be exercised once staging Worker/Pages URLs and R2 are available. |
| TestFlight external testing | blocked | Needs real staging smoke, R2/Images mutation proof, production-safe moderation runbook, and device QA evidence. |
| App Store production submission | blocked | This is still a beta MVP until external Cloudflare resources, UGC operations, and real-device evidence are complete. |

## Assessment Reconciliation

The earlier release assessment correctly warns against App Store submission, but several implementation facts are now stale:

- Backend is no longer a Supabase-first MVP in the current release branch. README, package dependencies, release checks, and tests now target Cloudflare Workers, D1, R2, Durable Objects, and OpenNext Cloudflare.
- Nationwide map and ranking scope are not just roadmap text. Local smoke and tests cover nationwide/region/map-bounds ranking panels, current-location controls, bbox place loading, and Worker ranking API query propagation.
- Remaining release blockers are mostly external-state and evidence blockers, not missing local code paths: `R2_NOT_ENABLED`, staging/production deployment URLs, and real staging smoke.
- App Store submission remains the wrong next milestone. The correct milestone is a TestFlight MVP with live Cloudflare staging and real-device QA.

## TestFlight MVP Gate

The following must be true before treating the app as TestFlight-ready:

- [ ] `pnpm release:status -- --strict` passes or reports only intentionally deferred App Store production items.
- [ ] Cloudflare R2 is enabled and `pnpm cf:r2:evidence -- --env=staging --check` passes.
- [ ] Staging Worker API is deployed and `SILSIGAN_STAGING_API_BASE_URL` is set to an HTTPS URL.
- [ ] Staging Pages frontend is deployed and `SILSIGAN_STAGING_PAGES_URL` is set to an HTTPS URL.
- [ ] `pnpm cf:external-state` passes for staging R2, staging D1, staging Worker dry-run, and deployment URL shape.
- [ ] `pnpm smoke:staging` passes against the staging Worker.
- [ ] `SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin` passes with a staging admin token.
- [ ] `pnpm smoke:pages` passes against staging Pages and staging Worker URLs.
- [ ] Workers tail redaction is captured from staging and passes `pnpm smoke:tail-redaction`.
- [x] TestFlight beta description, reviewer instructions, permission copy, UGC moderation notes, and staging evidence requirements are documented in `docs/testflight-review-notes.md` and guarded by `release:status`.
- [x] Local `/privacy` and `/support` pages exist and are guarded by `release:status` for implemented data-handling, support, report, deletion, and final URL language.
- [x] Privacy/support URL readiness is guarded by `release:status`; missing, placeholder, non-HTTPS, localhost, query/fragment, credentialed, or duplicate values fail before external TestFlight review notes are submitted.
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
| Missing staging/production URLs | Deploy Worker/Pages surfaces and export the four `SILSIGAN_*_URL` variables. |
| Missing privacy/support URLs | Local `/privacy` and `/support` pages now exist; deploy them to final HTTPS URLs and export `SILSIGAN_PRIVACY_POLICY_URL` / `SILSIGAN_SUPPORT_URL`. |
| No real staging smoke yet | Run staging Worker, Pages, mutation, admin, and tail-redaction smoke after URLs/R2 are ready. |
| No real-device QA evidence yet | Fill `docs/real-device-qa.md` with iPhone and Android device evidence after staging is live. |

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

## 2026-06-26 Ranking Manipulation Smoke

The D1 ranking smoke now covers repeated same-user click and like attempts against the same place.

| Probe | Result | Evidence |
| --- | --- | --- |
| `pnpm test -- tests/cloudflare-api.test.ts` | pass | 123 tests passed. The D1 ranking smoke verifies the first same-user place click and like create one signal each, the repeated click/like return `created=false`, `place_events` stores one click and one like, and regional ranking keeps `clickCount=1`, `likeCount=1`, `uniqueUserCount=1`, `score=101`; the UGC runbook smoke verifies required owner, alert queue, SLA, target type, and operator-action evidence; the Cloudflare cost/usage runbook smoke verifies Usage & billing, Billing alerts, product metrics, cadence, and TestFlight stop-condition evidence; the TestFlight review notes smoke verifies beta copy, staging URL requirements, permission copy, UGC moderation, privacy/support URL status, staging evidence, and stop conditions; the real-device QA ledger smoke verifies iPhone/Android matrices, staging environment fields, permission flows, UGC flows, redaction rules, crash checks, and artifact names; the public privacy/support page smoke verifies implemented data handling, TestFlight support, content reports, deletion requests, and final URL language; the privacy/support URL smoke verifies required HTTPS URLs and rejects unsafe or placeholder values. |

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

Still open: the final privacy policy URL and support URL must be real HTTPS pages before external TestFlight review notes are submitted.

## 2026-06-26 Privacy/Support URL Gate

The privacy/support URL finalization blocker is now release-state checked instead of only being text in the readiness plan.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | blocked-external expected | The check now requires `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL` to be distinct HTTPS URLs with no placeholders, credentials, query params, fragments, or localhost hosts. Current failure remains expected until final public URLs are available. |

## 2026-06-27 Real-Device QA Ledger Gate

The real-device QA ledger is now a release-state checked artifact. This closes the documentation-shape gap without claiming iPhone or Android QA has passed.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | blocked-external expected | The check now requires `docs/real-device-qa.md` to cover staging Pages/API environment fields, `R2_NOT_ENABLED`, TestFlight and Android build selection, iPhone and Android QA matrices, Naver map display, location allow/deny, camera/photo library, photo upload/preview, like/unlike, ranking refresh, report/moderation, crash checks, redaction requirements, and artifact names. Current failure remains expected until live staging, real-device evidence, and external URLs are available. |

## 2026-06-27 Privacy/Support Pages

Local public privacy and support pages now exist, but final URL readiness remains blocked until the app is deployed to HTTPS Pages URLs.

| Probe | Result | Evidence |
| --- | --- | --- |
| `node scripts/release-state-check.mjs --strict` | blocked-external expected | The check now requires `src/app/privacy/page.tsx` and `src/app/support/page.tsx` to include public-page tokens for data handling, Cloudflare D1/R2, location, photos, reports, deletion requests, TestFlight support, and final support/privacy URL language. Current failure remains expected until final HTTPS `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL` are exported. |

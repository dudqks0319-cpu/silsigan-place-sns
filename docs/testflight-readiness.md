# #실시간 TestFlight readiness

Updated: 2026-06-26
Source of truth: `docs/current-release-state.md`

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
- Remaining release blockers are mostly external-state and evidence blockers, not missing local code paths: `R2_NOT_ENABLED`, staging/production deployment URLs, production D1 `0002` migration evidence, and real staging smoke.
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
- [ ] iPhone real-device QA in `docs/real-device-qa.md` covers launch, map display, current-location allow/deny, place detail, report create, comment create/delete, photo upload/preview, like/unlike, moderation report, and no raw coordinate/file-name leakage in visible UI.
- [ ] Android real-device QA in `docs/real-device-qa.md` covers the same user flows if Android beta distribution is in scope.

## App Store Submission Gate

Only consider App Store production submission after TestFlight evidence is clean and these additional gates pass:

- [ ] Production D1 `0002_posts_questions.sql` is applied with `pnpm cf:d1:evidence -- --env=production --apply --confirm-production`.
- [ ] Production Worker API and Pages URLs are deployed and set in `SILSIGAN_PRODUCTION_API_BASE_URL` / `SILSIGAN_PRODUCTION_PAGES_URL`.
- [ ] `pnpm release:gate -- --production-candidate` passes.
- [ ] App privacy labels, support URL, privacy policy URL, and review notes match the implemented data handling.
- [ ] UGC moderation owner, response SLA, abuse handling, user restriction, and deletion/restore runbooks are documented and operable.
- [ ] Account deletion or anonymous data deletion/retention behavior is verified end-to-end if account-like identity is exposed in the native build.
- [ ] Store screenshots and metadata use real app surfaces, not placeholder beta/demo claims.

## Current Blockers

| Blocker | Owner action |
| --- | --- |
| `R2_NOT_ENABLED` | Enable R2 in Cloudflare Dashboard, then rerun R2 evidence checks. |
| Missing staging/production URLs | Deploy Worker/Pages surfaces and export the four `SILSIGAN_*_URL` variables. |
| `D1_0002_NOT_APPLIED` on production | Apply production D1 migration only after explicit production confirmation. |
| No real staging smoke yet | Run staging Worker, Pages, mutation, admin, and tail-redaction smoke after URLs/R2 are ready. |
| No real-device QA evidence yet | Fill `docs/real-device-qa.md` with iPhone and optional Android device evidence after staging is live. |

## 2026-06-26 Phase 1 Probe

Read-only Cloudflare probes were rerun without mutating R2, D1, Worker, or Pages resources.

| Probe | Result | Evidence |
| --- | --- | --- |
| `pnpm cf:external-state` | blocked | `R2_NOT_ENABLED`, four missing deployment URL blockers, and production `D1_0002_NOT_APPLIED`; staging D1 `0002` and staging/production Worker dry-runs still pass. |
| `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=60000` | blocked | Fails on `cloudflare.r2.enabled` / `R2_NOT_ENABLED`. |
| `pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000` | blocked | Remote production D1 lists pending `0002_posts_questions.sql`; posts/questions evidence fails with `D1_0002_NOT_APPLIED`. |
| `node scripts/release-state-check.mjs --strict --cloudflare-external-state-report=/tmp/silsigan-cf-external-state-20260626.json` | blocked | Combined blocker payload is `release_harness.ledger.open_blockers`, four deployment URL blockers, `R2_NOT_ENABLED`, and `D1_0002_NOT_APPLIED`. |

No Phase 1 mutating action was executed. R2 enablement, bucket creation, deployment URL setup, and production D1 `--apply --confirm-production` remain operator-owned steps.

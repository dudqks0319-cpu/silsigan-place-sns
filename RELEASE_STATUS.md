# Release Status

## 한 줄 상태

로컬 Cloudflare 전환 검증, staging/production D1 `0002` 원격 적용, staging/production web Worker 배포와 read-only 브라우저 smoke 증적은 준비됐지만, Cloudflare R2 활성화, staging/production API Worker 배포, API URL export, real staging mutation smoke가 남아 있어 public release는 `blocked-external`이다.

상세 source of truth는 [docs/current-release-state.md](docs/current-release-state.md)이다. 이 파일은 공통 release harness가 읽는 요약 index다.

R2 checkout 이후 실행 순서는 [docs/cloudflare-staging-operator-packet.md](docs/cloudflare-staging-operator-packet.md)에 모았다.

## 현재 후보

- Version: `0.1.0`
- Build: `not_applicable`
- Git SHA: `33195ae84af24a0a70251e6660b953d53c57f512`
- Branch: `agent/silsigan-map-click-fix-20260622-1456`
- Phase: `local_ready_external_blocked`
- Pushed evidence baseline before this ledger update: `agent/silsigan-map-click-fix-20260622-1456` at `33195ae84af24a0a70251e6660b953d53c57f512`
- Continuing local delta: release-status can now ingest a captured `cf:external-state` JSON report and surface `R2_NOT_ENABLED`, missing API Worker deployments, and API deployment URL blockers while staging/production D1 `0002` and staging/production web Worker deployments pass; D1 ranking abuse smoke proves repeated same-user click/like signals do not inflate ranking counts; privacy/support URL readiness is now separated into `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL` gates; 2026-06-27 web Workers are deployed at `https://silsigan-web-staging.dudqks0319.workers.dev` and `https://silsigan-web-production.dudqks0319.workers.dev`.

## 통과한 증거

- `pnpm test -- tests/cloudflare-api.test.ts`: 125 passed, including D1 ranking abuse smoke, UGC moderation runbook guard coverage, Cloudflare cost/usage runbook guard coverage, TestFlight review notes guard coverage, privacy/support URL guard coverage, real-device QA ledger guard coverage, public privacy/support page guard coverage, auth-aware external-state blocker canonicalization, and Worker deployment absence classification
- `node scripts/release-state-check.mjs --strict`: expected blocked-external with `release_harness.ledger.open_blockers` and deployment URL blockers
- `node scripts/release-state-check.mjs --strict --cloudflare-external-state-report=<captured-json>`: expected blocked-external with ledger/URL blockers plus `R2_NOT_ENABLED`; production D1 `0002` passes
- `node scripts/release-state-check.mjs --strict`: UGC moderation, Cloudflare cost/usage, and TestFlight review notes gates pass; current failure remains expected external blockers plus missing `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL`
- `node scripts/release-state-check.mjs --strict`: real-device QA ledger structure passes against `docs/real-device-qa.md`; actual iPhone/Android evidence remains blocked until staging URLs and R2 pass
- `node scripts/release-state-check.mjs --strict`: `/privacy` and `/support` page source checks pass; actual HTTPS `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL` remain blocked until deployment URLs are final
- `pnpm cf:build`: pass on 2026-06-27 from clean worktree `40bc4dd`, generated `.open-next/worker.js`
- `pnpm cf:web:dry-run:staging`: pass on 2026-06-27, read 95 assets and validated the `ASSETS` binding
- `pnpm exec wrangler deploy --config wrangler.jsonc --env staging`: pass on 2026-06-27, deployed `silsigan-web-staging` version `1f78ede2-80c6-4ac6-8388-305bfa8b4a1c` to `https://silsigan-web-staging.dudqks0319.workers.dev`
- `curl -I https://silsigan-web-staging.dudqks0319.workers.dev`: pass on 2026-06-27 with HTTP 200
- `pnpm smoke:pages -- --pages-url=https://silsigan-web-staging.dudqks0319.workers.dev --timeout-ms=60000`: pass on 2026-06-27 for read-only browser coverage: map surface/visibility, uncovered controls, traffic/filter/requery, header buttons, onboarding dismiss, bottom nav, ranking detail, and marker detail
- `pnpm cf:web:dry-run:production`: pass on 2026-06-27, read 95 assets and validated the `ASSETS` binding
- `pnpm exec wrangler deploy --config wrangler.jsonc --env production`: pass on 2026-06-27, deployed `silsigan-web-production` version `2c136948-8a7e-450a-93d4-0fe8d5d8fcdb` to `https://silsigan-web-production.dudqks0319.workers.dev`
- `curl -I https://silsigan-web-production.dudqks0319.workers.dev`: pass on 2026-06-27 with HTTP 200
- `pnpm smoke:pages -- --pages-url=https://silsigan-web-production.dudqks0319.workers.dev --timeout-ms=60000`: pass on 2026-06-27 for read-only browser coverage: map surface/visibility, uncovered controls, traffic/filter/requery, header buttons, onboarding dismiss, bottom nav, ranking detail, and marker detail
- `pnpm cf:external-state`: expected blocked-external on 2026-06-27 after staging/production web deploys; Wrangler auth passes, both web Worker deployments pass, staging/production Pages URL shape passes when exported, staging and production D1 `0002` evidence pass with `posts=4`, `questions=3`, and remaining external blockers are `R2_NOT_ENABLED`, missing staging/production API Workers, and missing staging/production API URL env values
- `pnpm release:gate -- --plan-only`: pass
- `git diff --check`: pass
- `pnpm cf:d1:evidence -- --env=staging --check --timeout-ms=120000`: pass, no pending migrations, `posts=4`, `questions=3`
- `pnpm cf:d1:evidence -- --env=production --apply --confirm-production --timeout-ms=120000`: pass, applied `0002_posts_questions.sql`, reran seed, verified `posts=4`, `questions=3`
- `pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000`: pass, no pending migrations, `posts=4`, `questions=3`
- `pnpm release:gate -- --skip-verify --skip-dry-run --collect-blockers --tail-file=tests/fixtures/redacted-worker-tail.log --timeout-ms=120000`: expected fail with `resultCounts.pass=9` / `resultCounts.fail=7`; tail redaction, audit, typegen, build, frontend dry-runs, staging D1 evidence, and production D1 evidence pass while remaining failures are external blockers

## 막힌 항목

- P0: Cloudflare R2 subscription is not enabled: `R2_NOT_ENABLED`
- P0: Configured staging/production API Workers are not deployed: `worker_deployment.staging.api`, `worker_deployment.production.api`
- P0: Missing staging/production API URLs: `deployment_url.staging.worker_api`, `deployment_url.production.worker_api`, `URL_REQUIRED`
- P0: Real staging API smoke, R2/Images mutation smoke, admin smoke, and captured Workers tail redaction are not complete
- P0: iPhone and Android real-device QA evidence is not captured: `docs/real-device-qa.md`
- P1: Final privacy/support URLs are not configured: `SILSIGAN_PRIVACY_POLICY_URL`, `SILSIGAN_SUPPORT_URL`

## 다음 행동

```bash
pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=60000
```

Cloudflare Dashboard > Storage & databases > R2 > Overview에서 R2 subscription checkout을 완료한 뒤 위 check를 먼저 다시 실행한다. R2 check가 통과하면 `pnpm cf:r2:evidence -- --env=staging --apply`로 누락 staging bucket을 만들고, staging API Worker를 배포한 뒤 `SILSIGAN_STAGING_PAGES_URL=https://silsigan-web-staging.dudqks0319.workers.dev`, `SILSIGAN_PRODUCTION_PAGES_URL=https://silsigan-web-production.dudqks0319.workers.dev`, staging/production API URL을 함께 export해서 release-candidate smoke로 넘어간다. Production D1은 이미 적용됐으므로 이후에는 `pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000`로 유지 검증만 한다.

## 사람이 직접 해야 하는 일

- Cloudflare Dashboard에서 R2 subscription checkout 완료
- Staging/production API Worker 배포 URL 확정
- Staging admin token과 captured Workers tail log 제공

# Release Status

## 한 줄 상태

로컬 Cloudflare 전환 검증과 staging/production D1 `0002` 원격 적용 증적은 준비됐지만, Cloudflare R2 활성화, staging/production 배포 URL, real staging smoke가 남아 있어 public release는 `blocked-external`이다.

상세 source of truth는 [docs/current-release-state.md](docs/current-release-state.md)이다. 이 파일은 공통 release harness가 읽는 요약 index다.

R2 checkout 이후 실행 순서는 [docs/cloudflare-staging-operator-packet.md](docs/cloudflare-staging-operator-packet.md)에 모았다.

## 현재 후보

- Version: `0.1.0`
- Build: `not_applicable`
- Git SHA: `bd4f46389c8c13d6eb158f7e683c70edc1e93982`
- Branch: `agent/silsigan-map-click-fix-20260622-1456`
- Phase: `local_ready_external_blocked`
- Pushed evidence baseline: `agent/silsigan-map-click-fix-20260622-1456` at `bd4f46389c8c13d6eb158f7e683c70edc1e93982`
- Continuing local delta: release-status can now ingest a captured `cf:external-state` JSON report and surface `R2_NOT_ENABLED` and deployment URL blockers while production D1 `0002` passes; D1 ranking abuse smoke proves repeated same-user click/like signals do not inflate ranking counts; privacy/support URL readiness is now separated into `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL` gates.

## 통과한 증거

- `pnpm test -- tests/cloudflare-api.test.ts`: 123 passed, including D1 ranking abuse smoke, UGC moderation runbook guard coverage, Cloudflare cost/usage runbook guard coverage, TestFlight review notes guard coverage, privacy/support URL guard coverage, real-device QA ledger guard coverage, and public privacy/support page guard coverage
- `node scripts/release-state-check.mjs --strict`: expected blocked-external with `release_harness.ledger.open_blockers` and deployment URL blockers
- `node scripts/release-state-check.mjs --strict --cloudflare-external-state-report=<captured-json>`: expected blocked-external with ledger/URL blockers plus `R2_NOT_ENABLED`; production D1 `0002` passes
- `node scripts/release-state-check.mjs --strict`: UGC moderation, Cloudflare cost/usage, and TestFlight review notes gates pass; current failure remains expected external blockers plus missing `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL`
- `node scripts/release-state-check.mjs --strict`: real-device QA ledger structure passes against `docs/real-device-qa.md`; actual iPhone/Android evidence remains blocked until staging URLs and R2 pass
- `node scripts/release-state-check.mjs --strict`: `/privacy` and `/support` page source checks pass; actual HTTPS `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL` remain blocked until deployment URLs are final
- `pnpm release:gate -- --plan-only`: pass
- `git diff --check`: pass
- `pnpm cf:d1:evidence -- --env=staging --check --timeout-ms=120000`: pass, no pending migrations, `posts=4`, `questions=3`
- `pnpm cf:d1:evidence -- --env=production --apply --confirm-production --timeout-ms=120000`: pass, applied `0002_posts_questions.sql`, reran seed, verified `posts=4`, `questions=3`
- `pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000`: pass, no pending migrations, `posts=4`, `questions=3`
- `pnpm release:gate -- --skip-verify --skip-dry-run --collect-blockers --tail-file=tests/fixtures/redacted-worker-tail.log --timeout-ms=120000`: expected fail with `resultCounts.pass=9` / `resultCounts.fail=7`; tail redaction, audit, typegen, build, frontend dry-runs, staging D1 evidence, and production D1 evidence pass while remaining failures are external blockers

## 막힌 항목

- P0: Cloudflare R2 subscription is not enabled: `R2_NOT_ENABLED`
- P0: Missing staging/production Pages/API URLs: `deployment_url.*`, `URL_REQUIRED`
- P0: Real staging Worker/Pages smoke, R2/Images mutation smoke, admin smoke, and captured Workers tail redaction are not complete
- P0: iPhone and Android real-device QA evidence is not captured: `docs/real-device-qa.md`
- P1: Final privacy/support URLs are not configured: `SILSIGAN_PRIVACY_POLICY_URL`, `SILSIGAN_SUPPORT_URL`

## 다음 행동

```bash
pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=60000
```

Cloudflare Dashboard > Storage & databases > R2 > Overview에서 R2 subscription checkout을 완료한 뒤 위 check를 먼저 다시 실행한다. R2 check가 통과하면 `pnpm cf:r2:evidence -- --env=staging --apply`로 누락 staging bucket을 만들고, staging Worker/Pages URL을 설정한 뒤 release-candidate smoke로 넘어간다. Production D1은 이미 적용됐으므로 이후에는 `pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000`로 유지 검증만 한다.

## 사람이 직접 해야 하는 일

- Cloudflare Dashboard에서 R2 subscription checkout 완료
- Staging/production Pages와 Worker 배포 URL 확정
- Staging admin token과 captured Workers tail log 제공

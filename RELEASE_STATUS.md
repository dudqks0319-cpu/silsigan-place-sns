# Release Status

## 한 줄 상태

로컬 Cloudflare 전환 검증과 staging D1 `0002` 원격 적용 증적은 준비됐지만, Cloudflare R2 활성화, staging/production 배포 URL, production D1 `0002` 적용, real staging smoke가 남아 있어 public release는 `blocked-external`이다.

상세 source of truth는 [docs/current-release-state.md](docs/current-release-state.md)이다. 이 파일은 공통 release harness가 읽는 요약 index다.

## 현재 후보

- Version: `0.1.0`
- Build: `not_applicable`
- Git SHA: `4cdfec5ba2bf0f222f1c1ef67659d0c31e19bfae`
- Branch: `agent/silsigan-map-click-fix-20260622-1456`
- Phase: `local_ready_external_blocked`
- Pushed evidence baseline: `agent/silsigan-map-click-fix-20260622-1456` at `4cdfec5ba2bf0f222f1c1ef67659d0c31e19bfae`

## 통과한 증거

- `pnpm test -- tests/cloudflare-api.test.ts`: 112 passed
- `node scripts/release-state-check.mjs --strict`: expected blocked-external with `release_harness.ledger.open_blockers` and deployment URL blockers
- `pnpm release:gate -- --plan-only`: pass
- `git diff --check`: pass
- `pnpm cf:d1:evidence -- --env=staging --check --timeout-ms=120000`: pass, no pending migrations, `posts=4`, `questions=3`
- `pnpm release:gate -- --skip-verify --skip-dry-run --collect-blockers --tail-file=tests/fixtures/redacted-worker-tail.log --timeout-ms=120000`: expected fail with `resultCounts.pass=8` / `resultCounts.fail=8`; tail redaction, audit, typegen, build, frontend dry-runs, and staging D1 evidence pass while remaining failures are external blockers

## 막힌 항목

- P0: Cloudflare R2 is not enabled: `R2_NOT_ENABLED`
- P0: Missing staging/production Pages/API URLs: `deployment_url.*`, `URL_REQUIRED`
- P0: Production D1 `0002_posts_questions.sql` is not applied: `D1_0002_NOT_APPLIED`
- P0: Real staging Worker/Pages smoke, R2/Images mutation smoke, admin smoke, and captured Workers tail redaction are not complete

## 다음 행동

```bash
pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=60000
```

R2를 Cloudflare Dashboard에서 활성화한 뒤 위 check를 먼저 다시 실행한다. R2 check가 통과하면 `pnpm cf:r2:evidence -- --env=staging --apply`로 누락 staging bucket을 만들고, staging Worker/Pages URL을 설정한 뒤 release-candidate smoke로 넘어간다.

Production D1 적용은 실제 production DB mutation이므로 별도 확인 후에만 실행한다.

```bash
pnpm cf:d1:evidence -- --env=production --apply --confirm-production --timeout-ms=120000
```

## 사람이 직접 해야 하는 일

- Cloudflare Dashboard에서 R2 활성화
- Staging/production Pages와 Worker 배포 URL 확정
- Production D1 mutation 승인
- Staging admin token과 captured Workers tail log 제공

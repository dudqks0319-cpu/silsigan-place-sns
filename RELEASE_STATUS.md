# Release Status

## 한 줄 상태

로컬 Cloudflare 전환 검증, 2026-06-29 지도/관광 route 회귀 복구와 지도/검색 빈 상태 CTA, 2026-06-30 로컬 업로드 완료 피드 반영 UX, staging/production D1 `0002` 원격 적용, staging first-launch 12개 장소 seed 재적용, staging/production web Worker 배포와 read-only 브라우저 smoke 증적, staging/production API URL 값 정의는 준비됐지만, Cloudflare R2 활성화, staging/production API Worker 배포, real staging mutation smoke가 남아 있어 public release는 `blocked-external`이다.

상세 source of truth는 [docs/current-release-state.md](docs/current-release-state.md)이다. 이 파일은 공통 release harness가 읽는 요약 index다.

R2 checkout 이후 실행 순서는 [docs/cloudflare-staging-operator-packet.md](docs/cloudflare-staging-operator-packet.md)에 모았다.

## 현재 후보

- Version: `0.1.0`
- Build: `not_applicable`
- Git SHA: `73f10b9532f6cb3d1998ba0ab8df6547e23e8dd2`
- Branch: `agent/silsigan-map-tourism-ui-20260628`
- Phase: `local_ready_external_blocked`
- Pushed evidence baseline before this ledger update: `agent/silsigan-map-tourism-ui-20260628` at `73f10b9532f6cb3d1998ba0ab8df6547e23e8dd2`
- Continuing local delta: 2026-06-29 local map/tourism runtime recovery adds a same-origin `/api/tourism/attractions` fallback route, keeps read-only home/map data alive when `.env.local` points at an offline local Worker URL, separates local-only fallback from staging/production API failure, and fixes crowded Naver marker hit targets so `광안리해수욕장 상세 열기` opens the correct detail sheet. Browser QA confirmed 13 map markers, tourism panel, 광안리 detail, 좋아요 local preview with no `Failed to fetch`, map 0건 recovery CTAs (`재시도`, `검색으로 이동`, `사진 올리기`), and search 0건 recommendations (`광안리`, `해운대`, `황리단길`, `#주차만차`, `#웨이팅`, `#사진스팟`, `지도에서 보기`); screenshots `/private/tmp/silsigan-map-marker-detail-qa-20260629.png` and `/private/tmp/silsigan-map-search-empty-qa-20260629.png`. 2026-06-30 upload completion work keeps local fallback limited to local Worker URLs, posts to same-origin `/api/posts` only for local fallback/no Worker mode, immediately merges the created post/report into the local feed, and shows `방금 올린 사진이 ... 피드에 반영됐습니다` completion feedback; this does not claim R2/staging upload readiness. Release-status can ingest a captured `cf:external-state` JSON report and surface `R2_NOT_ENABLED` and missing API Worker deployments while staging/production D1 `0002` and staging/production web Worker deployments pass; D1 ranking abuse smoke proves repeated same-user click/like signals do not inflate ranking counts; privacy/support URL readiness is separated into `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL` gates; 2026-06-27 web Workers are deployed at `https://silsigan-web-staging.dudqks0319.workers.dev` and `https://silsigan-web-production.dudqks0319.workers.dev`, `.env.example` / operator docs define public web/privacy/support/API URL values, and `apps/mobile` exposes the same public privacy/support/staging web links in the TestFlight shell surface. 2026-06-28 local API/UI seed work adds the first-launch 부산/경주/울산 12개 장소 and staging D1 seed apply confirms `launch_focus_count=12`. `release:status` also guards the mobile TestFlight shell UI tokens, service-link source, Expo permission metadata, and `extra.silsigan` public URL shape.

## 통과한 증거

- `pnpm test`: 130 passed, including first-launch 부산/경주/울산 12개 장소 local seed coverage, D1 ranking abuse smoke, UGC moderation runbook guard coverage, Cloudflare cost/usage runbook guard coverage, TestFlight review notes guard coverage, privacy/support URL guard coverage, real-device QA ledger guard coverage, public privacy/support page guard coverage, mobile TestFlight shell guard coverage, auth-aware external-state blocker canonicalization, and Worker deployment absence classification
- `pnpm typecheck`, `pnpm lint`, `git diff --check`, `pnpm test`: pass on 2026-06-29 after the local map/tourism runtime recovery and map/search empty-state UX; `pnpm test` passed 130 tests after rerunning the local listen smoke with elevated local-port permission
- In-app browser QA on 2026-06-29: `http://localhost:3000/` loaded home feed with no `Failed to fetch`, map tab rendered 13 Naver markers and tourism panel, `광안리해수욕장 상세 열기` opened `광안리해수욕장 상세 정보`, and 좋아요 local preview worked; screenshot `/private/tmp/silsigan-map-marker-detail-qa-20260629.png`
- Chrome DevTools browser QA on 2026-06-29: `http://127.0.0.1:3000/` map search `없는장소zz` shows `지도 데이터를 불러오지 못했어요` plus `재시도`, `검색으로 이동`, `사진 올리기`; `검색으로 이동` opens search, the same impossible query shows `"없는장소zz" 결과가 아직 없습니다`, and recommendation buttons are `광안리`, `해운대`, `황리단길`, `#주차만차`, `#웨이팅`, `#사진스팟`, `지도에서 보기`; screenshot `/private/tmp/silsigan-map-search-empty-qa-20260629.png`
- Browser upload completion QA on 2026-06-30: local upload/report flow at `http://127.0.0.1:3000/` confirms the completion toast says the newly uploaded photo was reflected in the selected place feed and the new caption `브라우저 QA 업로드 1782745925336` is visible in the `광안리해수욕장` place feed in the same browser session; screenshot `/private/tmp/silsigan-upload-complete-qa-20260630.png`. This is local same-origin proof only and does not replace R2/staging mutation smoke
- `pnpm cf:d1:evidence -- --env=staging --apply --timeout-ms=120000`: pass on 2026-06-28; no pending migrations, idempotent seed apply wrote the first-launch seed delta, and follow-up remote D1 query returned `launch_focus_count=12`
- `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000`: expected blocked-external on 2026-06-27 with `R2_NOT_ENABLED`; no bucket creation or mutation was attempted
- `pnpm cf:external-state`: expected blocked-external on 2026-06-27 in a plain shell; Wrangler auth, web Worker deployments, staging/production D1 `0002`, and Worker dry-runs pass, while `R2_NOT_ENABLED`, missing staging/production API Workers, and missing staging/production Pages/API URL shell exports remain blockers
- `node scripts/release-state-check.mjs --strict` with `.env.example` sourced: expected blocked-external with `release_harness.ledger.open_blockers`; staging/production Pages/API URL and privacy/support URL shape gates pass, but actual API Worker deployments and smoke are still external blockers
- `node scripts/release-state-check.mjs --strict --cloudflare-external-state-report=<captured-json>`: expected blocked-external with ledger/URL blockers plus `R2_NOT_ENABLED`; production D1 `0002` passes
- `node scripts/release-state-check.mjs --strict`: UGC moderation, Cloudflare cost/usage, TestFlight review notes, and mobile TestFlight shell gates pass; current failure remains expected open external blockers
- `node scripts/release-state-check.mjs --strict`: real-device QA ledger structure passes against `docs/real-device-qa.md`; actual iPhone/Android evidence remains blocked until staging URLs and R2 pass
- `node scripts/release-state-check.mjs --strict`: `/privacy` and `/support` page source checks pass; HTTPS `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL` values are defined in `.env.example` and still must be exported in the actual release shell
- `cd apps/mobile && pnpm lint && pnpm typecheck && pnpm test`: pass on 2026-06-27; mobile TestFlight shell exposes release-shaped `stagingWebUrl`, `privacyPolicyUrl`, and `supportUrl` values and renders `개인정보`, `지원 문의`, `staging web` link controls in the `마이` tab
- `cd apps/mobile && expo config --json`: pass on 2026-06-27 with iOS camera/location/photo usage strings, Android camera/location permissions, and `extra.silsigan` public staging/privacy/support URLs
- `pnpm cf:build`: pass on 2026-06-27 from clean worktree `40bc4dd`, generated `.open-next/worker.js`
- `pnpm cf:web:dry-run:staging`: pass on 2026-06-27, read 95 assets and validated the `ASSETS` binding
- `pnpm exec wrangler deploy --config wrangler.jsonc --env staging`: pass on 2026-06-27, deployed `silsigan-web-staging` version `1f78ede2-80c6-4ac6-8388-305bfa8b4a1c` to `https://silsigan-web-staging.dudqks0319.workers.dev`
- `curl -I https://silsigan-web-staging.dudqks0319.workers.dev`: pass on 2026-06-27 with HTTP 200
- `pnpm smoke:pages -- --pages-url=https://silsigan-web-staging.dudqks0319.workers.dev --timeout-ms=60000`: pass on 2026-06-27 for read-only browser coverage: map surface/visibility, uncovered controls, traffic/filter/requery, header buttons, onboarding dismiss, bottom nav, ranking detail, and marker detail
- `pnpm cf:web:dry-run:production`: pass on 2026-06-27, read 95 assets and validated the `ASSETS` binding
- `pnpm exec wrangler deploy --config wrangler.jsonc --env production`: pass on 2026-06-27, deployed `silsigan-web-production` version `2c136948-8a7e-450a-93d4-0fe8d5d8fcdb` to `https://silsigan-web-production.dudqks0319.workers.dev`
- `curl -I https://silsigan-web-production.dudqks0319.workers.dev`: pass on 2026-06-27 with HTTP 200
- `pnpm smoke:pages -- --pages-url=https://silsigan-web-production.dudqks0319.workers.dev --timeout-ms=60000`: pass on 2026-06-27 for read-only browser coverage: map surface/visibility, uncovered controls, traffic/filter/requery, header buttons, onboarding dismiss, bottom nav, ranking detail, and marker detail
- `pnpm cf:external-state` with `.env.example` sourced: expected blocked-external on 2026-06-29; Wrangler auth passes, both web Worker deployments pass, staging/production Pages/API URL shape passes, staging and production D1 `0002` evidence pass with `posts=4`, `questions=3`, and remaining external blockers are exactly `R2_NOT_ENABLED`, `worker_deployment.staging.api`, and `worker_deployment.production.api`
- `pnpm release:gate -- --plan-only`: pass
- `git diff --check`: pass
- `pnpm cf:d1:evidence -- --env=staging --check --timeout-ms=120000`: pass, no pending migrations, `posts=4`, `questions=3`
- `pnpm cf:d1:evidence -- --env=production --apply --confirm-production --timeout-ms=120000`: pass, applied `0002_posts_questions.sql`, reran seed, verified `posts=4`, `questions=3`
- `pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000`: pass, no pending migrations, `posts=4`, `questions=3`
- `pnpm release:gate -- --skip-verify --skip-dry-run --collect-blockers --tail-file=tests/fixtures/redacted-worker-tail.log --timeout-ms=120000`: expected fail with `resultCounts.pass=9` / `resultCounts.fail=7`; tail redaction, audit, typegen, build, frontend dry-runs, staging D1 evidence, and production D1 evidence pass while remaining failures are external blockers

## 막힌 항목

- P0: Cloudflare R2 subscription is not enabled: `R2_NOT_ENABLED`
- P0: Configured staging/production API Workers are not deployed: `worker_deployment.staging.api`, `worker_deployment.production.api`
- P0: Staging/production API URL values are defined but not proven live until API Worker deploy and smoke pass: `SILSIGAN_STAGING_API_BASE_URL`, `SILSIGAN_PRODUCTION_API_BASE_URL`
- P0: Real staging API smoke, R2/Images mutation smoke, admin smoke, and captured Workers tail redaction are not complete
- P0: iPhone and Android real-device QA evidence is not captured: `docs/real-device-qa.md`
- P1: Privacy/support URL values are defined but still need final release-shell export and external TestFlight review-note confirmation: `SILSIGAN_PRIVACY_POLICY_URL`, `SILSIGAN_SUPPORT_URL`

## 다음 행동

```bash
pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=60000
```

Cloudflare Dashboard > Storage & databases > R2 > Overview에서 R2 subscription checkout을 완료한 뒤 위 check를 먼저 다시 실행한다. R2 check가 통과하면 `pnpm cf:r2:evidence -- --env=staging --apply`로 누락 staging bucket을 만들고, staging API Worker를 배포한 뒤 `.env.example` / `docs/cloudflare-staging-operator-packet.md`의 public web/privacy/support/API URL 값을 export해서 release-candidate smoke로 넘어간다. Staging D1에는 2026-06-28 first-launch seed가 재적용됐고 `launch_focus_count=12`를 확인했다. Production D1은 기존 `0002` 적용 증거가 있으므로 이후에는 `pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000`로 유지 검증하고, production first-launch seed 재적용은 production API candidate 준비 시 별도 확인한다.

## 사람이 직접 해야 하는 일

- Cloudflare Dashboard에서 R2 subscription checkout 완료
- Staging/production API Worker 배포와 smoke 확인
- Staging admin token과 captured Workers tail log 제공

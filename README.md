# #실시간

네이버지도 기반 전국 실시간 장소 정보 MVP입니다. 사용자는 지도에서 장소별 댓글, 사진, 좋아요, 현장 제보를 확인하고 전국/지역 인기 장소 TOP 10을 볼 수 있습니다.

## MVP 범위

- 웹/PWA 우선
- Next.js 프론트 + Cloudflare Workers API + D1 + R2 + Durable Objects
- 초기 지역: 전국, 서울, 부산, 제주, 강원, 경주
- 초기 카테고리: 관광지, 축제/행사장, 맛집/카페, 병원, 관공서, 주차장
- MVP 제외: 결제, 현금성 포인트, DM, 팔로우, 업체 광고, 네이티브 앱, AI 자동 판독

## 보안/개인정보 원칙

- 정확한 사용자 위치는 공개하지 않는다.
- 위치 원본 좌표는 DB와 로그에 저장하지 않는다.
- 제보에는 장소와의 거리 구간만 저장한다.
- 사진은 EXIF 제거와 재인코딩 후 저장한다.
- 병원/관공서 카테고리는 민감정보 업로드를 보수적으로 제한한다.
- 익명 사용자 세션은 Cloudflare Workers API에서 발급/검증한다.
- 신고/숨김/삭제/사용자 제한/장소 좌표 검증 운영 API는 관리자 토큰을 deny-by-default로 검증한다.
- 신고/숨김/삭제 운영이 준비되기 전에는 출시하지 않는다.

## 개발 명령

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
pnpm release:gate -- --plan-only
pnpm smoke:pages:local-report -- --timeout-ms=45000
pnpm release:status
pnpm cf:typegen
pnpm cf:build
pnpm cf:web:dry-run
pnpm cf:web:dry-run:staging
pnpm cf:web:dry-run:production
pnpm cf:preflight
pnpm cf:dry-run
pnpm cf:dry-run:staging
pnpm cf:dry-run:production
```

Cloudflare frontend는 OpenNext Cloudflare adapter로 `.open-next/worker.js`와 `.open-next/assets`를 생성한 뒤 root `wrangler.jsonc`로 dry-run/deploy합니다. `pnpm cf:typegen`은 `.env.example`만 입력으로 사용해 로컬 개인 `.env.local` 키가 typegen에 섞이지 않게 하고, `pnpm cf:build`가 OpenNext 산출물을 만들며, `pnpm cf:web:dry-run*`이 frontend Worker/Assets bundle을 검증합니다.

Cloudflare Worker 로컬 API는 `workers/api/wrangler.jsonc`를 기준으로 실행합니다.

```bash
wrangler dev --config workers/api/wrangler.jsonc
```

`workers/api/wrangler.jsonc`는 development, staging, production binding을 분리합니다. 기본 development Worker dry-run은 local config sanity check이며, root config의 D1/KV ID는 development 리소스를 만들기 전까지 placeholder로 남습니다. release evidence는 staging/production dry-run만 사용합니다. 현재 staging/production D1/KV ID는 실제 Cloudflare 리소스로 반영되어 있으며, 리소스를 재생성할 때만 해당 environment ID를 새 값으로 교체합니다. environment별 secret은 `wrangler secret put <KEY> --env staging|production`으로 등록합니다. 신고 큐 알림은 `MODERATION_ALERT_WEBHOOK_URL`과 선택값 `MODERATION_ALERT_WEBHOOK_TOKEN`을 Worker secret으로 등록합니다.

남은 외부 배포 blocker는 Cloudflare Dashboard의 R2 활성화와 staging/production Pages/API HTTPS URL 설정입니다. R2가 활성화되기 전에는 `wrangler deploy --env staging`이 Cloudflare code `10042`로 실패합니다.

`pnpm cf:preflight`는 Worker binding뿐 아니라 staging/production Pages URL과 Worker API URL도 확인합니다. 출시 전 CI 또는 로컬 shell에 아래 값을 실제 HTTPS 배포 URL로 지정해야 합니다.

```bash
export SILSIGAN_STAGING_PAGES_URL=https://<staging-pages>
export SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker>
export SILSIGAN_PRODUCTION_PAGES_URL=https://<production-pages>
export SILSIGAN_PRODUCTION_API_BASE_URL=https://<production-worker>
```

Next 관리자 화면에서 Worker 신고 큐와 운영 조치를 사용하려면 서버 환경변수에 `SILSIGAN_WORKER_API_BASE_URL`과 `SILSIGAN_WORKER_ADMIN_TOKEN`을 설정합니다. staging smoke는 `SILSIGAN_STAGING_ADMIN_TOKEN`을 설정하면 신고 생성부터 운영자 rejected 처리, 임시 사용자 제한/해제까지 확인합니다. 좌표 상태 운영 smoke는 실제 장소 상태를 변경하므로 `--coordinate-status` 또는 `SILSIGAN_RELEASE_GATE_COORDINATE_STATUS=1`을 명시하고, `SILSIGAN_STAGING_COORDINATE_SMOKE_PLACE_ID`, `SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE`, `SILSIGAN_STAGING_COORDINATE_SMOKE_LONGITUDE`를 함께 설정한 경우에만 실행합니다.

출시 전에는 lockfile을 커밋한 뒤 아래 명령까지 통과해야 합니다. `release:gate`는 로컬 검증을 먼저 실행하고, `--local-pages-report`가 있으면 local mock Worker + Next dev로 장소/댓글/사진 신고 브라우저 baseline을 strict 외부 URL 체크 전에 실행합니다. `--tail-file`이 있으면 Workers tail redaction도 strict release status보다 먼저 검증해, 누락되거나 민감값이 포함된 로그가 deployment URL blocker 뒤에 숨지 않게 합니다. `--collect-blockers`는 non-mutating 진단 모드로 첫 실패 후에도 release status, preflight, external-state, read-only smoke를 계속 실행해 missing URL과 R2 같은 외부 blocker를 한 번에 모으고, 출력 상단에 `resultCounts`, `failedSteps`, 중첩 JSON에서 추출한 `blockers`를 요약합니다. 실제 staging/production URL과 Worker secret이 준비된 뒤에는 strict release status, audit, Cloudflare typegen, OpenNext frontend build, frontend dry-run, API staging/production Wrangler dry-run, preflight, Worker smoke, Pages browser smoke까지 이어서 실행합니다. local Pages baseline은 staging 증적을 대체하지 않습니다. `--release-candidate`는 최종 staging 후보 증거용으로 HTTPS `SILSIGAN_STAGING_PAGES_URL`, HTTPS `SILSIGAN_STAGING_API_BASE_URL`, `SILSIGAN_STAGING_ADMIN_TOKEN`, captured tail file을 실행 전에 요구하고, `--mutating`, `--browser-report`, `--require-photo`, `--tail-required`를 함께 켭니다. `--production-candidate`는 HTTPS `SILSIGAN_PRODUCTION_PAGES_URL`과 HTTPS `SILSIGAN_PRODUCTION_API_BASE_URL`을 실행 전에 요구하고 production API/Pages read-only smoke를 추가하지만 staging 쓰기 smoke, 신고 생성, 사진 요구, tail 필수를 자동으로 켜지 않습니다. `--mutating`은 staging Worker에 실제 쓰기/정리 smoke를 수행하므로 `SILSIGAN_STAGING_ADMIN_TOKEN`을 요구하며, `--collect-blockers`와 함께 사용할 수 없습니다. `--coordinate-status`는 좌표 검증 대상 장소 상태를 실제로 변경하므로 명시한 리뷰 장소에서만 사용합니다. `--browser-report`는 Pages browser smoke에서 실제 신고 생성을 포함하므로 운영 영향이 괜찮을 때만 사용합니다.

```bash
pnpm install --frozen-lockfile
pnpm release:gate -- --skip-verify --skip-dry-run --collect-blockers --tail-file=artifacts/cloudflare-tail/staging-tail.log
pnpm release:gate -- --plan-only --local-pages-report --tail-required --tail-file=artifacts/cloudflare-tail/staging-tail.log
pnpm release:gate -- --plan-only --release-candidate --tail-file=artifacts/cloudflare-tail/staging-tail.log
pnpm release:gate -- --plan-only --production-candidate
pnpm release:gate -- --release-candidate --tail-file=artifacts/cloudflare-tail/staging-tail.log
```

## 문서

- 테스트 계획: `_workspace/04_test_plan.md`
- 배포 가이드: `_workspace/05_deploy_guide.md`
- QA/Security 리뷰: `_workspace/06_review_report.md`
- 개인정보/위치정보/사진/신고 정책: `docs/privacy-safety-policy.md`
- UGC 신고/숨김/삭제/제한 운영 runbook: `docs/ugc-moderation-runbook.md`
- Cloudflare 비용/사용량 운영 runbook: `docs/cloudflare-cost-usage-runbook.md`
- 보안 게이트: `docs/security-gate.md`
- TestFlight/App Store readiness: `docs/testflight-readiness.md`
- TestFlight 리뷰 노트 초안 및 제출 blocker: `docs/testflight-review-notes.md`
- Real-device QA ledger: `docs/real-device-qa.md`

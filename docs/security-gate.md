# #실시간 Cloudflare 전환 보안 게이트

기준일: 2026-06-18
범위: 무료 출시 기준의 Cloudflare Pages/Workers, D1, R2, KV 또는 Cache API 전환.

출시 전 P0 항목은 모두 통과해야 한다. 2026-06-25 현재 로컬 기준선은 `node --check workers/api/src/index.ts`, `pnpm verify`, `pnpm test` 108 passed, `pnpm audit --audit-level critical`, `git diff --check`가 통과한 상태다. Cloudflare staging/production URL, R2 활성화, remote D1 migration 증적은 외부 blocker로 별도 남아 있다.

## P0 출시 차단 항목

- [x] 현재 기준선에서 `pnpm test`가 108 passed 상태다.
- [x] 현재 기준선에서 `pnpm typecheck`가 통과했다.
- [x] 현재 기준선에서 `pnpm lint`가 통과했다.
- [x] 현재 기준선에서 `pnpm build`가 통과했다.
- [x] Cloudflare Workers 배포 구성이 `workers/api/wrangler.jsonc`와 실제 Worker 코드에 반영되어 있다.
- [x] Cloudflare frontend OpenNext build 경로가 `open-next.config.ts`, pinned `@opennextjs/cloudflare`, pinned `wrangler`, `pnpm cf:build`, frontend dry-run scripts로 반영되어 있다.
- [x] Wrangler development, staging, production environment가 binding 비상속 규칙에 맞게 D1/R2/Images/KV/Durable Object binding을 각각 명시한다.
- [x] Cloudflare Pages/Worker API staging/production 공개 URL preflight가 missing, localhost, non-HTTPS, query/fragment/credential, staging/production 중복을 출시 차단으로 실패시킨다.
- [x] `docs/current-release-state.md`와 `pnpm release:status`가 로컬 통과 상태와 외부 Cloudflare 차단 상태를 분리해 보여준다.
- [x] `pnpm release:status`가 Supabase 프로젝트 산출물, Vercel 배포 설정, `@supabase/*` 의존성, Vercel public runtime URL 재유입을 출시 차단으로 감지한다.
- [x] Durable Object realtime place/region/global fanout 경로가 로컬 테스트로 검증되어 있다.
- [x] D1 schema와 initial migration이 같은 내용이며 필수 테이블을 포함한다.
- [x] D1 seed import가 멱등이다. `workers/api/seeds/001_core_seed.sql`을 SQLite 메모리 DB에 2회 적용해 places/rankings 중복이 없음을 테스트한다.
- [x] R2 업로드는 EXIF/GPS 제거가 샘플 이미지로 검증되었다.
- [x] 서버 픽셀 재인코딩은 Cloudflare Images binding 경로와 fake binding 단위 테스트로 검증한다.
- [x] 정확 사용자 좌표가 현재 구현의 D1 schema/R2 metadata/Worker 응답에 저장되지 않는다.
- [x] 원본 IP가 현재 구현의 D1/KV/R2 객체 metadata에 저장되지 않는다.
- [x] 원본 파일명이 R2 key, D1 schema, upload complete 응답에 저장/노출되지 않는다.
- [x] 사진 exact duplicate/도용 방지는 정화 후 이미지 fingerprint로 D1에서 차단하며, fingerprint는 public 응답/R2 metadata에 노출하지 않는다.
- [x] EXIF, GPS, 촬영 기기, 촬영 시각 제거가 샘플 이미지로 검증되었다.
- [x] 장소 seed 중 좌표 미검증 항목은 `TODO_COORDINATE_VERIFY`로 남고 지도/랭킹 API에서 제외된다.
- [x] 좌표 미검증 seed는 `operator` 이상 좌표 상태 API로만 검증/반려되며, 검증 전후 공개 지도/랭킹 노출이 테스트된다.
- [x] Worker API rate limit, 댓글 rate limit, 사진 업로드 rate limit, 중복 place click/like 방지 negative-path 테스트가 있다.
- [x] 관리자 운영 API는 `ADMIN_TOKEN` 또는 `ADMIN_TOKENS` role secret 없이는 deny-by-default로 실패한다.
- [x] 댓글/사진/제보 신고 3회 자동 숨김이 D1 저장소 기준으로 동작한다.
- [x] 개인정보/민감정보 신고 1회 임시 숨김이 D1 저장소 기준으로 동작한다.
- [x] 관리자 숨김/복구는 `moderator` 이상, 삭제는 `admin` 이상 권한 없이는 실패한다.
- [x] 관리자 사용자 제한/해제는 `admin` 이상 권한 없이는 실패하며, 제한된 익명 사용자의 새 공개 write를 차단한다.
- [x] 관리자 삭제가 D1 상태와 R2 파일 삭제를 함께 처리한다.
- [x] 관리자 삭제 후 KV/Cache 무효화는 `CACHE` KV binding 테스트에서 검증한다.
- [x] 전국/지역/area/category/map-bounds 랭킹이 숨김/좌표 미검증 콘텐츠를 제외한다.
- [x] 빈 지역, 빈 댓글, 빈 사진, 빈 랭킹, 위치 권한 거부 UX가 구현되어 있다.
- [x] 병원/관공서 카테고리의 민감정보 경고와 제한 정책이 제품에 반영되어 있다.
- [x] validation 실패, 권한 실패, rate limit 실패 negative-path 테스트가 있다.
- [x] secrets, API key, token, Cloudflare credentials가 코드에 하드코딩되어 있지 않다.

## P1 운영 보완 항목

- [x] 신고 큐 운영자 알림 채널이 있다.
- [x] 운영자 bulk hide/restore가 있다.
- [x] 사진 중복/도용 탐지 기준이 있다.
- [x] 지역/area 활성화 기준이 운영 대시보드에 표시된다.
- [x] Worker 응답/브라우저 analytics 로그 redaction 로컬 가드와 운영 점검 절차가 있다.
- [x] 만료된 제보가 공개 댓글/사진 목록, 장소 실시간 요약, 랭킹 점수에서 제외되는지 자동 검증한다.

## 잔여 위험

| 항목 | 상태 | Owner | Due date |
| --- | --- | --- | --- |
| Cloudflare Pages 배포 연결 미확정 | URL preflight gate는 준비됨. 실제 `SILSIGAN_STAGING_PAGES_URL`, `SILSIGAN_PRODUCTION_PAGES_URL` 값과 브라우저 접근 증적은 무료 공개 출시 전 차단 | FullStackDev | 2026-06-21 |
| Cloudflare Pages/API deployment URL 미설정 | D1/KV resource ID는 실제 값으로 치환됨. `pnpm cf:preflight`는 현재 미설정 `SILSIGAN_*_PAGES_URL`/`SILSIGAN_*_API_BASE_URL`만 출시 차단으로 실패시킴 | FullStackDev | 2026-06-21 |
| Cloudflare R2 계정 활성화 필요 | 2026-06-25 `pnpm cf:external-state`와 `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=60000`가 R2를 `cloudflare.r2.enabled` / `R2_NOT_ENABLED`로 분류한다. Dashboard에서 R2 활성화 후 `pnpm cf:r2:evidence -- --env=staging --apply`로 누락 staging bucket을 생성하고, production 생성은 `--confirm-production`을 붙여야 한다 | FullStackDev | 2026-06-24 |
| Cloudflare Images/admin staging mutation smoke 미수행 | `pnpm smoke:staging` harness 준비됨. `SILSIGAN_STAGING_MUTATION=1`, `--require-admin`, `SILSIGAN_STAGING_ADMIN_TOKEN`으로 무료 공개 출시 전 확인 필요. 좌표 상태 smoke는 실제 장소 레코드를 바꾸므로 대상 장소/좌표 opt-in 필요 | FullStackDev | 2026-06-21 |
| Workers 플랫폼 `wrangler tail` redaction 증적 미확보 | 로컬 redaction guard와 captured-log validator 준비됨. staging tail 증적은 무료 공개 출시 전 차단 | FullStackDev | 2026-06-21 |

## 보안 게이트 세부 기준

### 1. Secrets

- Cloudflare API token, R2 access key, D1 binding secret, 관리자 JWT secret은 저장소에 커밋하지 않는다.
- `.env`, wrangler secret, CI secret 값은 로그에 출력하지 않는다.
- public 번들에는 운영 secret이 포함되지 않아야 한다.

### 2. AuthN/AuthZ

- public read API는 숨김/만료/좌표 미검증 데이터를 반환하지 않는다.
- write API는 인증 또는 abuse-control 식별자를 요구한다.
- admin API는 deny-by-default이며 `operator`, `moderator`, `admin` 권한을 구분한다.
- Next 관리자 화면의 Worker 운영 proxy는 서버 route에서만 Worker 운영 토큰을 사용하고, 브라우저 응답은 신고/좌표 상태/사용자 제한에 필요한 최소 payload로 제한한다.
- 관리자 삭제와 사용자 제한은 `admin` 이상만 가능하다.

### 3. Input/Output

- 모든 body/query/path 입력은 enum, 길이, 숫자 범위, 좌표 범위를 검증한다.
- map bounds는 최대 면적 제한을 둔다.
- 댓글/제보 본문은 출력 시 HTML escape를 전제로 한다.
- 사진 업로드는 MIME sniffing과 확장자 검증을 모두 수행한다.

### 4. Data Minimization

- 정확 좌표는 거리 구간 계산 후 폐기한다.
- 원본 IP는 저장하지 않는다.
- 원본 파일명은 object key, DB, 로그 어디에도 저장하지 않는다.
- EXIF/GPS는 R2 저장 전 제거한다.
- 감사 로그는 운영자 ID, 대상 ID, 사유, 시각, 결과만 남긴다.

### 5. Abuse Controls

- 제보/댓글/사진/신고/질문 API에 rate limit을 둔다.
- 댓글 작성은 익명 사용자/IP 기준 1분 5개, 1일 100개를 초과하면 429로 차단한다.
- 댓글 본문은 전화번호, 주민번호, 스크립트, URL 도배 패턴을 서버에서 거부하고 원문을 오류 응답에 되돌려주지 않는다.
- 신고 3회 자동 숨김과 민감정보 1회 임시 숨김을 적용한다.
- 동일 사용자 중복 신고는 1회만 점수에 반영한다.
- 반복 허위 제보자와 신고 악용자는 D1 `blocked_users` 정책으로 새 댓글/사진/좋아요/클릭/신고 write를 제한한다.

### 6. Negative-path Tests

필수 테스트:

- 좌표 미검증 장소가 지도/랭킹에 나오지 않는다.
- 3시간 만료 제보가 랭킹에서 제외된다.
- 숨김 제보/사진/댓글이 public API에서 제외된다.
- 관리자 권한 없이 숨김/복구/삭제 API가 실패하고, `moderator` 토큰은 최종 삭제를 수행할 수 없다.
- 관리자 권한 없이 사용자 제한이 실패하고, 제한된 익명 사용자는 새 댓글/사진/좋아요/신고 write가 403으로 차단된다.
- 사진 업로드에서 EXIF/GPS 포함 샘플이 제거된다.
- Cloudflare Images binding을 통한 서버 픽셀 재인코딩 후 R2에 저장된다.
- 원본 파일명이 R2 key와 public URL에 포함되지 않는다.
- 위치 권한 거부 상태에서도 읽기는 가능하고 현장 인증만 제한된다.

## 증적 기록

출시 승인 전 아래 결과를 이슈/릴리스 노트에 첨부한다.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --audit-level critical
pnpm cf:typegen
pnpm cf:build
pnpm cf:web:dry-run
pnpm cf:web:dry-run:staging
pnpm cf:web:dry-run:production
pnpm cf:r2:evidence -- --env=staging --check
pnpm cf:d1:evidence -- --env=staging --check
pnpm cf:r2:evidence -- --env=production --check
pnpm cf:d1:evidence -- --env=production --check
pnpm release:gate -- --skip-verify --skip-dry-run --collect-blockers --tail-file=artifacts/cloudflare-tail/staging-tail.log
pnpm release:gate -- --local-pages-report --tail-required --tail-file=artifacts/cloudflare-tail/staging-tail.log
pnpm release:gate -- --release-candidate --tail-file=artifacts/cloudflare-tail/staging-tail.log
pnpm release:gate -- --production-candidate
# 좌표 상태 smoke는 실제 장소 상태를 변경하므로 대상 장소/좌표를 지정한 경우에만 추가한다.
pnpm release:gate -- --release-candidate --coordinate-status --tail-file=artifacts/cloudflare-tail/staging-tail.log
```

Cloudflare 전환 추가 증적:

- D1 migration 재실행 로그.
- Cloudflare resource preflight 결과. 현재 로컬 기준선은 fixture 테스트로 concrete ID와 HTTPS Pages/API URL 통과, placeholder ID 실패, missing/unsafe deployment URL 실패, staging/production URL 중복 실패를 검증한다. 실제 `workers/api/wrangler.jsonc`는 staging/production D1/KV concrete ID가 반영되어 resource binding check는 통과하고, 미설정 `SILSIGAN_*_PAGES_URL`/`SILSIGAN_*_API_BASE_URL` 때문에 `pnpm cf:preflight`가 실패하는 상태다.
- Release state 결과. 현재 로컬 기준선은 `pnpm release:status`가 `blocked-external`을 출력하고, blocker가 deployment URL 4개로 축소된 상태다. staging/production D1 migration과 core seed는 원격 적용됐고, `verified_places=5`, `rankings=6`으로 확인했다.
- Legacy artifact/runtime URL 결과. 현재 로컬 기준선은 `supabase/` migrations와 `vercel.json`을 제거했고, runtime share URL 기본값을 Cloudflare Pages로 전환했으며, `pnpm release:status`가 Supabase 프로젝트 산출물, Vercel 배포 설정, `@supabase/*` dependency, Vercel public runtime URL이 없음을 검사한다.
- OpenNext frontend 결과. 현재 로컬 기준선은 `open-next.config.ts`의 `defineCloudflareConfig`, pinned `@opennextjs/cloudflare@1.19.11`, pinned `wrangler@4.103.0`, `.env.example` 기반 `cf:typegen`, `cf:build`/`cf:preview`/`cf:deploy`/frontend dry-run scripts를 `pnpm release:status`에서 검사한다. `pnpm cf:typegen`은 로컬 개인 `.env.local`이 아니라 `.env.example`의 Cloudflare release key만 읽고, `pnpm cf:build`는 `.open-next/worker.js`와 `.open-next/assets`를 생성했으며, `pnpm cf:web:dry-run`, `pnpm cf:web:dry-run:staging`, `pnpm cf:web:dry-run:production`은 89개 assets와 `ASSETS` binding을 dry-run으로 검증했다.
- R2/deployment external-state 결과. `pnpm cf:external-state`는 Wrangler OAuth, R2 bucket visibility, staging/production deployment URL shape, staging/production Worker dry-run을 non-mutating JSON check로 분리한다. 현재 기준선은 OAuth pass, staging/production dry-run pass, deployment URL 4개 missing fail, `cloudflare.r2.enabled` fail with `R2_NOT_ENABLED`이다. 직접 `wrangler r2 bucket list`와 `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=60000`도 Cloudflare code `10042` / `R2_NOT_ENABLED`로 실패하며 Dashboard에서 R2 활성화가 필요하다고 반환한다. `pnpm cf:r2:evidence` 기본 실행은 non-mutating plan-only이고, `--check`는 bucket list만 읽으며, `--apply`는 누락 bucket 생성 후 visibility를 재확인한다. Production apply는 `--confirm-production` 없이는 실패한다. R2 활성화 전에는 Worker URL과 staging mutation smoke를 완료할 수 없다.
- Durable Object realtime 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `Durable Object realtime rooms receive place region and global fanout events`와 `Durable Object realtime WebSocket connections receive broadcast events`로 댓글 생성 이벤트가 deterministic DO place/region/global room에 fanout되고, `/api/realtime/place/:id`, `/api/realtime/region/:id`, `/api/realtime/global` polling 응답과 WebSocket client broadcast에 같은 redacted event가 노출되는지 검증한다.
- 프론트 realtime 소비 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `Cloudflare API client supports place like and realtime room endpoints`와 Chrome headless CDP smoke로 지도 상세가 Cloudflare API base 설정 시 `/api/realtime/place/:id`를 polling하고 상세 시트에 `Cloudflare DO`/`댓글 업데이트`를 표시하며, 장소 좋아요와 장소 신고가 Worker API로 동기화되는지 검증한다. 스크린샷 증적은 `artifacts/realtime-event-visible-smoke-2026-06-19.png`.
- 선택 지역 scoped fetch 결과. 현재 로컬 기준선은 `tests/domain.test.ts`의 `scoped API paths normalize nationwide and clamp broad list limits`, `local demo lists support region-scoped bounded reads`로 Next 로컬 API와 프론트 초기/폴링 fetch가 선택 지역 `regionId`와 bounded `limit` 계약을 사용해 전국 fetch-all MVP 병목으로 되돌아가지 않는지 검증한다. 해시태그 피드는 같은 `regionId`를 유지하고, Worker 사진은 전역 `/api/photos` 목록이 아니라 현재 장소 ID별 `/api/photos?placeId=...&limit=...` 호출로 가져온다.
- Wrangler environment dry-run 결과. 현재 로컬 기준선은 release gate가 `pnpm cf:dry-run:staging`, `pnpm cf:dry-run:production`으로 staging/production bundle과 concrete binding config를 검증한다. `pnpm cf:dry-run` 기본 development dry-run은 root Worker config의 local placeholder D1/KV ID를 보여주는 로컬 config sanity check이며, release evidence로 쓰지 않는다.
- seed import dry-run과 apply 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `D1 core seed SQL is idempotent`로 seed 2회 적용을 검증한다.
- D1 write path 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `Cloudflare Worker persists user actions and moderation state to D1`로 댓글/사진/좋아요/중복 신고/3회 자동 숨김/민감정보 1회 숨김/admin action 기록을 검증한다.
- D1 field report 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `D1 field reports store coarse realtime status without client coordinates`로 `/api/reports` 현장 제보가 `place_events.source = field_report`, 상태 컬럼, `verified_radius_m`, 3시간 TTL, hourly `report_count`, 랭킹 live score를 기록하고, `GET /api/reports` 공개 목록이 운영 신고/익명 사용자 ID/원좌표/`photoUrl`을 포함하지 않으며, 300m 밖 제보가 `LOCATION_NOT_VERIFIED`로 거부되는지 검증한다.
- Memory fallback field report 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `memory fallback field reports can be listed without raw location data`로 DB binding이 없는 로컬 Worker에서도 생성된 현장 제보 목록이 `clientLocation`, `photoUrl`, 익명 사용자 ID를 노출하지 않는지 검증한다.
- 사용자 제한 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `admin user restrictions block public D1 writes until unrestricted`로 `admin` 권한만 익명 사용자 제한/해제를 수행하고, 제한 상태에서 댓글 작성, 사진 upload-url/complete, 장소 좋아요, 신고 생성이 `USER_RESTRICTED`로 차단되며 raw 세션 ID와 제한 사유가 public 오류 응답에 노출되지 않는지 검증한다.
- 신고 큐 알림 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `D1 report creation sends a redacted moderation alert webhook`으로 신규 open 신고가 `MODERATION_ALERT_WEBHOOK_URL`에 비동기 전송되고, alert payload가 신고자 익명 ID, note 원문, 이메일, 전화번호, 원본 파일명을 포함하지 않는지 검증한다.
- Next 관리자 Worker 운영 proxy 결과. 현재 로컬 기준선은 `tests/domain.test.ts`의 `worker admin moderation helper proxies reports without leaking raw reporter fields`, `worker admin moderation helper prefers dedicated Worker token over staging smoke token`, `worker admin moderation helper posts report actions through server token`, `worker admin moderation helper is deny-by-default without server token`, `admin worker reports route requires Next admin auth before proxying`, `admin worker reports route proxies with server token and returns minimal report payload`, `admin worker operations require Next admin auth before proxying`, `admin worker operations proxy coordinate and user restriction actions with server token`으로 Next server proxy가 `SILSIGAN_WORKER_ADMIN_TOKEN`을 staging smoke token보다 우선 사용하고, Worker 운영 토큰을 서버에서만 쓰며, raw 신고자 ID/note/운영 사유 원문을 UI payload에서 제외하고, 토큰 미설정 또는 Next 관리자 인증 누락 시 deny-by-default인지 검증한다.
- Next 관리자 post moderation 입력 검증 결과. 현재 로컬 기준선은 `tests/domain.test.ts`의 `admin post moderation input is fail-closed`와 로컬 Next API smoke로 post moderation action의 `postId` 누락 또는 허용되지 않은 action이 400 `VALIDATION_ERROR`로 실패하고, 정상 queue action은 200으로 처리되는지 검증한다.
- 지역/area 활성화 기준 결과. 현재 로컬 기준선은 `tests/domain.test.ts`의 `region activation evaluation exposes dashboard checks`와 `store exposes region and area activation dashboard rows`로 seed 장소, 7일 제보, 7일 현장 인증, 7일 사진 제보, 운영/신고 readiness 기준이 세부 check로 계산되고 admin 운영 대시보드 row에 노출되는지 검증한다.
- 사진 중복/도용 탐지 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `D1 photo complete rejects duplicate sanitized image content before a second R2 write`로 정화/재인코딩 후 이미지 SHA-256 fingerprint가 D1에 저장되고, 삭제되지 않은 exact duplicate는 두 번째 R2 write 전에 `409 PHOTO_DUPLICATE`로 차단되는지 검증한다.
- Admin moderation 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `admin moderation role gates update D1 R2 and CACHE invalidation`으로 무권한 실패, `moderator` delete 실패, 댓글/사진/장소 숨김/복구, 장소 숨김 시 전국/지역/area/category/map-bounds 랭킹 제외와 복구 후 재노출, 사진 삭제 시 R2 object delete, `CACHE` KV key 삭제, admin action 기록을 검증한다.
- 장소 좌표 상태 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `operator coordinate status update controls public D1 place and ranking exposure`로 `operator` 권한이 좌표 미검증 seed를 verified/rejected로 변경하고, verified 전환 시 공개 장소/랭킹에 노출되며 rejected 전환 시 좌표 null과 비활성 상태로 다시 제외되는지 검증한다.
- Admin bulk moderation 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `admin bulk moderation hides and restores D1 targets with partial results and audit records`로 `operator` 권한 실패, bulk delete 거부, 댓글/사진 일괄 숨김/복구, 없는 대상의 부분 실패, 대상별 `bulk_hide`/`bulk_restore` 감사 로그, `CACHE` KV key 삭제를 검증한다.
- 좌표 미검증 seed 제외 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `D1 public places and rankings exclude TODO_COORDINATE_VERIFY seed rows`로 좌표 NULL/TODO seed가 공개 장소 상세, 장소 목록, 랭킹에서 제외됨을 검증한다.
- 3시간 만료 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `D1 public live surfaces ignore expired three-hour place signals`로 Worker가 `place_events.expires_at = created_at + 3 hours`를 저장하고, 랭킹 응답 카운트/요약과 live-score 정렬을 반영하며, 만료 후 공개 댓글/사진 목록, 장소 live 카운트, 랭킹 live score에서 제외되는지 검증한다.
- 로컬 로그/응답 redaction 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `worker generic errors do not echo secrets or raw sensitive values`와 `tests/domain.test.ts`의 `analytics console events redact sensitive values`로 Worker generic error 응답과 브라우저 analytics console 출력이 토큰, raw 좌표, 익명 ID, 원본 파일명, 이메일을 노출하지 않는지 검증한다.
- 공개 장소 반경 검색 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `GET /api/places applies radius query without echoing client coordinates`와 `Cloudflare Worker reads places and rankings from D1 when DB binding is present`로 `/api/places?lat=&lng=&radius=`가 메모리 fallback과 D1 binding 모두에서 meter 거리 필터를 적용하고, 응답 meta에 원좌표를 되돌려주지 않는지 검증한다.
- Staging smoke harness 결과. `SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> pnpm smoke:staging`은 health, 장소/지도 좌표, 장소 상세/live, place/region/global realtime room, 전국/bbox 랭킹, 댓글/사진 목록, 무권한 admin 차단을 확인한다. Worker API base URL 없이 실행하면 `BASE_URL_REQUIRED`로 실패하며, tail-only 로그 검증은 base URL 없이도 독립 실행된다. `SILSIGAN_STAGING_MUTATION=1`을 추가하면 실제 R2/Cloudflare Images 사진 완료, 공개 사진 최소 필드와 `previewUrl` 노출, `previewUrl` 파일 200/image bytes 반환, 삭제/공개 목록 제외, 댓글 생성/작성자 삭제/공개 목록 제외, 장소 좋아요/취소를 확인한다. 같은 실행에 `SILSIGAN_STAGING_ADMIN_TOKEN`을 제공하면 장소 신고 생성, 운영자 open 큐 조회, rejected 처리, open 큐 정리, 전용 익명 사용자 임시 제한/차단 확인/해제/댓글 정리까지 확인한다. 최종 release evidence에서는 `--require-admin`을 같이 사용해 운영자 토큰 누락 시 admin moderation/user restriction smoke가 skip이 아니라 `ADMIN_TOKEN_REQUIRED`로 실패하게 한다. 좌표 상태 smoke는 `--coordinate-status` 또는 `SILSIGAN_STAGING_COORDINATE_STATUS_SMOKE=1`과 대상 장소/좌표를 명시한 경우에만 verified 운영 경로와 공개 상세 노출을 확인한다.
- Pages browser smoke harness 결과. `SILSIGAN_STAGING_PAGES_URL=https://<staging-pages> SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> pnpm smoke:pages`는 headless Chrome CDP로 Pages 프론트를 열어 지도 surface의 실제 크기/내부 콘텐츠, 지도 마커의 실제 hit-test 가능 여부, 교통/필터/이 지역 다시 검색/현재 위치 버튼 클릭 가능성, 하단 홈/지도 내비게이션 전환, 첫 방문 안내 닫기, 전국/지역/지도 화면 안 TOP 10 랭킹 패널 표시, 랭킹 항목 상세 열기, 장소 상세를 확인하고, 프론트 장소 목록 요청이 Worker `/api/places`로 나가는지 검증한다. 현재 harness는 초기 지도 도구 또는 `현재 위치` 버튼이 하단 내비게이션에 가려지면 `map.controlsUncovered`에서 실패하고, 첫 방문 안내가 실제 클릭으로 닫히지 않으면 `onboarding.dismiss` 필수 체크에서 실패한다. Worker API base 설정 시 장소별 사진 요청 `/api/photos?placeId=...`, 지도 마커 클릭 집계 `POST /api/places/:id/click`, 장소 realtime room `/api/realtime/place/:id`, region room `/api/realtime/region/:id`, global room `/api/realtime/global`도 같은 브라우저 플로우에서 확인한다. `SILSIGAN_STAGING_BROWSER_MUTATION=1`을 추가하면 좋아요/댓글 UI POST와 정리, 공개 Worker 사진이 있을 때 사진 클릭 POST를 확인한다. `SILSIGAN_STAGING_BROWSER_REPORT=1`은 운영 영향이 있어 명시한 경우에만 실행하며, 장소 신고, 방금 생성한 Worker 댓글 신고, Worker 사진 신고가 각각 `/api/moderation/reports`에 `targetType=place|comment|photo`로 POST되는지 확인한다. 네트워크 artifact에는 report note/body 원문을 저장하지 않고 `targetType`만 남긴다. 현재 로컬 기준선은 2026-06-24 `pnpm smoke:pages:local-report -- --timeout-ms=45000`가 local mock Worker + Next dev + headless Chrome으로 `--mutating --report --require-photo` 경로를 실행해 visible ranking panels, ranking item detail open, fallback status banner가 마커 hit-test를 가로채지 않는 map marker detail open, `map.controlsUncovered`, `onboarding.dismiss`, place/region/global realtime room, 좋아요/댓글/사진 클릭 POST, 장소/댓글/사진 신고 targetTypes `place`, `comment`, `photo`를 모두 확인했다. 최신 report 증적은 `artifacts/cloudflare-pages-smoke-worker-report-local/pages-smoke-1782256059178.png`, `artifacts/cloudflare-pages-smoke-worker-report-local/pages-smoke-network-1782256059181.json`, `artifacts/cloudflare-pages-smoke-worker-report-local/pages-smoke-console-1782256059182.log`에 있다. local report smoke는 network artifact target-type integrity, redaction, and required smoke check integrity를 내장 검증하며, 최신 요약은 `eventCount=126`, `reportTargetTypes=comment/photo/place`, `storesPostData=false`, `sensitiveHits=[]`, `passedRequiredChecks=20`, `failedChecks=[]`이다.
- Release gate orchestrator 결과. `pnpm release:gate`는 로컬 검증, optional local Pages report baseline, optional Workers tail redaction, strict release status, critical audit, `.env.example` 기반 Cloudflare typegen, OpenNext frontend build, frontend Wrangler dry-run, Cloudflare URL/resource preflight, staging/production D1/R2 read-only evidence, Cloudflare external-state check, API staging/production Wrangler dry-run, staging Worker smoke, Pages browser smoke를 순차 실행한다. 기본 development Worker dry-run은 root Worker config의 local placeholder D1/KV ID 때문에 release evidence에서 제외한다. `--local-pages-report`는 local mock Worker + Next dev + headless Chrome으로 장소/댓글/사진 신고 browser baseline을 strict external staging checks 전에 실행하고, network redaction뿐 아니라 `map.controlsUncovered`와 `onboarding.dismiss`를 포함한 필수 smoke check integrity도 검증하지만 staging Pages/Worker 증적을 대체하지 않는다. `--collect-blockers`는 non-mutating 진단 모드에서 첫 실패 후에도 strict status, URL preflight, dedicated D1/R2 evidence, external-state, read-only smoke를 계속 실행해 missing URL, `cloudflare.r2.enabled`, staging API base URL, Pages URL, remote D1 migration blocker를 한 번에 드러내며, 출력 상단의 `resultCounts`, `failedSteps`, 중첩 JSON에서 추출한 `blockers`로 실패 단계와 실제 blocker 코드를 요약한다. `--release-candidate`는 최종 staging 후보 증거용으로 HTTPS staging Pages/API URL을 실행 전에 요구하고, `--mutating`, `--browser-report`, `--require-photo`, `--tail-required`를 함께 켜며, Worker 쓰기/정리 smoke와 Pages 좋아요/댓글/사진 클릭/신고 smoke 및 captured Workers tail redaction을 빠뜨리지 않게 한다. `--production-candidate`는 HTTPS production Pages/API URL을 실행 전에 요구하고 production API/Pages read-only smoke를 추가하지만 staging 쓰기, browser report, photo, tail 필수 플래그를 자동으로 켜지 않는다. `SILSIGAN_STAGING_ADMIN_TOKEN`이 없으면 실행 전에 실패시켜 admin moderation/user restriction smoke가 조용히 skip되지 않게 한다. `--collect-blockers`는 실제 쓰기 smoke와 함께 사용할 수 없다. `--coordinate-status`는 admin token, 대상 place id, latitude, longitude가 없으면 실행 전에 실패시킨다. `--browser-report`는 실제 신고 생성을 포함하므로 운영 영향이 괜찮을 때만 사용한다. `--tail-required --tail-file=...`는 captured Workers tail redaction을 출시 필수 gate로 묶으며, tail 파일이 지정된 경우 strict URL/resource checks보다 먼저 검증해 누락/민감값 로그가 외부 URL blocker 뒤에 숨지 않게 한다. `pnpm cf:d1:evidence`는 D1 전용 operator surface다. 기본 `--env=staging` 실행은 non-mutating plan-only이고, `--check`는 `wrangler d1 migrations list`와 posts/questions evidence query만 실행한다. `--apply`는 한 번에 하나의 env만 허용하며 migrations apply, idempotent seed apply, evidence query를 순서대로 실행하고, production apply는 `--confirm-production` 없이는 실패한다. `pnpm cf:r2:evidence`는 R2 전용 operator surface다. 기본 `--env=staging` 실행은 non-mutating plan-only이고, `--check`는 configured bucket visibility만 읽으며, `--apply`는 list 결과에서 누락된 bucket만 생성한 뒤 재확인한다. Production apply는 `--confirm-production` 없이는 실패한다. 현재 로컬 기준선은 `pnpm release:gate -- --skip-verify --skip-dry-run --collect-blockers --tail-file=tests/fixtures/redacted-worker-tail.log --timeout-ms=120000`가 tail redaction, critical audit, typegen, OpenNext build, frontend development/staging/production dry-runs를 통과한 뒤 예상대로 `release.status.strict`, `cloudflare.preflight`, `cloudflare.r2Evidence.*`, `cloudflare.d1Evidence.*`, `cloudflare.externalState`, `staging.api.smoke`, `pages.browser.smoke`에서 실패하는 상태다. 실패 blocker는 `R2_NOT_ENABLED`, `D1_0002_NOT_APPLIED`, `DEPLOYMENT_URL_REQUIRED`, `BASE_URL_REQUIRED`, `PAGES_URL_REQUIRED`, `deployment_url.*`, staging/production URL preflight 이름으로 수렴한다. 출력은 token/secret 값을 싣지 않는다.
- Workers captured log redaction 결과. `SILSIGAN_STAGING_TAIL_LOG_FILE=artifacts/cloudflare-tail/staging-tail.log pnpm smoke:tail-redaction`으로 raw token, coordinate, 익명 ID, 원본 파일명 패턴이 없는지 확인한다. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `Cloudflare tail redaction smoke accepts redacted captured logs`, `Cloudflare tail redaction smoke rejects raw secrets coordinates anonymous ids and filenames`로 안전 로그 통과와 raw token/coordinate/anon ID/email/original filename 실패 경로를 모두 검증한다.
- `pnpm audit --audit-level critical`은 통과했다. `pnpm audit --json` 기준 low/moderate/high/critical 0이며, transitive audit advisory는 `ws@8.21.0`, `js-yaml@4.2.0`, `@babel/core@7.29.6` override로 해소했다.
- R2 EXIF/GPS 제거 전/후 샘플 검증 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `photo complete strips GPS EXIF sample before writing to R2`로 JPEG APP1 EXIF 샘플에서 `Exif`, `GPSLatitude`, `Camera`, `DateTime` metadata가 R2 저장 바이트에 남지 않는지 검증한다.
- 서버 픽셀 재인코딩 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `photo complete reencodes pixels with Cloudflare Images binding before writing to R2`로 metadata-strip된 바이트가 `IMAGES` binding에 입력되고, transform/output 옵션이 적용되며, R2에는 `serverPixelReencoded=true`와 `cloudflare-images-reencoded` 처리 결과가 저장되는지 검증한다.
- 브라우저 사진 업로드 smoke. 현재 로컬 기준선은 Playwright 모바일 viewport에서 `PhotoUploader` 파일 선택, 브라우저 캔버스 재인코딩, Worker `/api/photos/upload-url` 201, `/api/photos/complete` 201, D1 `ready` 사진 2건, 상세 시트 `사진4장` 및 `1KB 현장 사진` 2건 표시를 확인했다.
- Worker 사진 미리보기 read proxy 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `photo complete strips GPS EXIF sample before writing to R2`에서 R2 fake binding에 저장된 정화 이미지가 `GET /api/photos/:photoId/file`로 같은 bytes/content-type을 반환하고, public photo list가 Worker origin `previewUrl`을 제공하며 `anonymousUserId`/`storageKey`/`deletedAt`/`imageHash`/원본 파일명을 포함하지 않는지 검증한다.
- 네이버 지도 fallback smoke. 현재 로컬 기준선은 네이버 외부 style/tile/auth resource 실패 시 `naver-map--fallback`이 `대체 지도 표시 중`으로 전환되고, `광안리해수욕장 상세 열기` 등 마커 버튼이 접근성 트리에 남는지 Playwright로 확인했다. 인증 401 이후 SDK ready 상태에서도 빈 지도 프레임을 유지하지 않고 fallback을 보여주며, SDK cleanup 예외가 앱을 크래시시키지 않고 fallback 지도와 버튼 클릭 흐름을 유지하는지도 확인했다.
- 지도/버튼 smoke. 현재 로컬 기준선은 in-app Browser 390px 모바일 viewport에서 fallback 지도 표시, live Naver tile/marker 표시, `광안리해수욕장` 마커 클릭과 상세 시트 표시, `서울` 빈 지역의 `표시할 장소 없음` 지도 프레임 유지, `필터`/`교통`/`이 지역 다시 검색`/지역 탭/하단 `홈`/`지도`/`제보` 버튼 상태 전환을 확인했다. 2026-06-24 수정 후 낮은 데스크톱 viewport와 모바일 viewport에서 `교통`, `이 지역 다시 검색`, `현재 위치`는 하단 네비 위에 완전히 노출되고 실제 hit-test 가능한 좌표를 갖는다. 첫 방문 안내는 `바로 둘러보기` 실제 클릭으로 닫히며, fallback 지도 상태 배너는 마커 클릭을 가로채지 않는다. 모바일 필수 지도 컨트롤은 하단 네비 뒤로 들어가지 않으며, Next dev indicator는 로컬 QA에서 하단 네비를 가리지 않도록 비활성화했다. Cloudflare API base 설정 시 Worker 사진은 전역 `/api/photos?limit=...`가 아니라 장소별 `/api/photos?placeId=...&limit=...`로 조회한다.
- 지도 bounds fetch smoke. 현재 로컬 기준선은 Chrome headless CDP Network 이벤트에서 초기 `/api/places?limit=100` 이후 fallback/지도 bounds emission이 `/api/places?bbox=129.118600%2C35.153200%2C129.311500%2C35.838200&limit=100` 재조회를 발생시키는지 확인했다. 스크린샷은 `/tmp/silsigan-map-bounds-fetch-smoke-2026-06-19.png`.
- 장소 클릭 Worker 동기화 smoke. 현재 로컬 기준선은 `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4319`와 mock Worker를 사용한 Chrome headless CDP Network 이벤트에서 fallback 지도 마커 클릭이 `POST http://127.0.0.1:4319/api/places/busan-gwangalli/click`을 발생시키고, 상세 시트가 열린 상태를 확인했다. 스크린샷은 `/tmp/silsigan-place-click-worker-smoke-2026-06-19.png`.
- 댓글 작성 Worker 동기화 smoke. 현재 로컬 기준선은 `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4320`와 mock Worker를 사용한 Chrome headless CDP Network 이벤트에서 장소 상세 댓글 작성이 `POST http://127.0.0.1:4320/api/comments`를 발생시키고, 생성된 댓글과 `댓글 업데이트` realtime strip이 즉시 표시되는지 확인했다. 스크린샷은 `/tmp/silsigan-comment-create-worker-smoke-2026-06-19.png`.
- 좋아요/장소 신고 Worker 동기화 smoke. 현재 로컬 기준선은 `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4321`와 mock Worker를 사용한 Playwright Network 이벤트에서 fallback 지도 `광안리해수욕장 상세 열기`가 상세 시트를 열고, `좋아요`가 `POST http://127.0.0.1:4321/api/places/busan-gwangalli/like`, `장소 신고`가 `POST http://127.0.0.1:4321/api/moderation/reports`를 발생시키며, `실시간 반영` 영역에 `좋아요 반영`과 `신고 접수`가 표시되는지 확인했다. 증적은 `artifacts/silsigan-like-report-worker-smoke-2026-06-19.png`, `artifacts/silsigan-like-report-worker-network-2026-06-19.json`, `artifacts/silsigan-like-report-console-current-2026-06-19.log`.
- 사진 클릭 Worker 동기화 smoke. 현재 로컬 기준선은 `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4322`와 mock Worker를 사용한 Playwright Network 이벤트에서 `광안리해수욕장` 상세가 Worker 사진을 `/api/photos?placeId=busan-gwangalli&limit=12`로 가져오고, `1KB 현장 사진` 클릭이 `POST http://127.0.0.1:4322/api/photos/photo_click_smoke_1/click`을 발생시키며, 사진 타일이 `클릭 4`에서 `클릭 5`로 갱신되고 `사진 확인이 반영됐습니다.` 상태를 표시하는지 확인했다. 증적은 `artifacts/silsigan-photo-click-worker-smoke-2026-06-19.png`, `artifacts/silsigan-photo-click-worker-network-2026-06-19.json`, `artifacts/silsigan-photo-click-console-current-2026-06-19.log`.
- 사진 미리보기 Worker 동기화 smoke. 현재 로컬 기준선은 `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4323`와 mock Worker를 사용한 Playwright 실행에서 `previewUrl` 파일을 브라우저가 `GET http://127.0.0.1:4323/api/photos/photo_preview_smoke_1/file`로 요청하고 사진 타일 배경으로 표시하며, 같은 타일 클릭이 `POST /api/photos/photo_preview_smoke_1/click`을 발생시키고 `클릭 2`에서 `클릭 3`으로 갱신되는지 확인했다. 증적은 `artifacts/silsigan-photo-preview-worker-smoke-2026-06-19.png`, `artifacts/silsigan-photo-preview-worker-network-2026-06-19.json`, `artifacts/silsigan-photo-preview-console-current-2026-06-19.log`.
- 홈 버튼/피드 탭 smoke. 현재 로컬 기준선은 Chrome headless CDP 390px 모바일 viewport에서 초기 `지도` 화면 fallback surface가 표시되고, 하단 `홈` 이동 후 상단 알림 버튼이 활성 `aria-pressed=true`와 toast를 갱신하며, 홈 피드 `주차` 탭은 주차 관련 게시물 3건으로 필터링되고 `야경` 탭은 0건 empty state로 전환되는지 확인했다. 스크린샷은 `/tmp/silsigan-map-smoke-2026-06-19.png`, `/tmp/silsigan-home-button-smoke-2026-06-19.png`.
- 데스크톱 지도/버튼 smoke. 현재 로컬 기준선은 Playwright 1440px viewport에서 `광안리해수욕장 상세 열기` 마커 클릭, 상세 시트 `좋아요`/`장소 신고` 토스트, `현장 제보 작성` 버튼의 작성 폼 전환, 온보딩 `바로 둘러보기` 닫기와 `localStorage` 반영, viewport screenshot artifact 생성을 확인했다.
- 민감 카테고리 UX smoke. 현재 로컬 기준선은 Playwright 1440px viewport에서 `울산광역시청 상세 열기` 마커 클릭 후 지도 상세 사진 업로드 영역과 `울산광역시청 현장 제보` 작성 폼에 관공서 민감정보 경고가 각각 표시되고 버튼이 disabled 되지 않는지 확인했다.
- Workers 플랫폼 로그 redaction 확인 결과. 로컬 redaction guard는 통과했으며, staging에서는 `wrangler tail` 또는 Cloudflare dashboard 로그 샘플로 raw 좌표, 토큰, 원본 파일명, 익명 ID 원문 미노출을 별도 첨부한다.
- admin API role 실패 테스트 결과.
- 신고/자동 숨김/복구/삭제 시나리오 테스트 결과.
- 댓글 본문 보호 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `comment create rejects privacy script and URL spam patterns`로 전화번호, 주민번호, script tag, URL-only spam 댓글이 `400 COMMENT_BODY_REJECTED`로 거부되고 오류 응답이 원문 body를 되돌려주지 않는지 검증한다.
- 전국/지역/area/category/map-bounds 랭킹 캐시 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `GET /api/rankings uses CACHE KV read-through cache with bounded TTL`로 `/api/rankings`가 `CACHE` KV binding에 60초 TTL로 enriched item payload miss 결과를 저장하고, 두 번째 요청에서 `cacheStatus=hit`로 같은 데이터를 반환하며, 손상된 cache entry는 miss로 복구하는지 검증한다. 관리자 사진 삭제 시 `rankings:nationwide`, `rankings:map-bounds`, `rankings:region:*`, `rankings:area:*`, `rankings:category:*`, `places:*`, `place-live:*`, `rankings:place:*`, `photos:*` 키를 삭제하고 `rankings:version`을 갱신해 기존 랭킹 캐시 키가 재사용되지 않게 한다.
- 프론트 랭킹 client 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `Cloudflare API client supports scoped ranking query params`로 프론트 Worker client가 `regionId`, `areaId`, `categoryId`, `bbox`, `limit`를 `/api/rankings` query에 그대로 전달해 전국/지역/권역/카테고리/지도 bounds TOP 10 호출을 타입 우회 없이 구성할 수 있는지 검증한다.
- D1 hourly 집계 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `D1 public live surfaces ignore expired three-hour place signals`로 같은 익명 사용자가 한 장소/시간 버킷에 댓글, 사진, 클릭을 각각 남겨도 `place_event_hourly.unique_user_count`는 1로 유지되고 이벤트별 count만 증가하며, live score가 seed score보다 높은 장소를 실제 랭킹 상단으로 정렬하는지 검증한다.
- 빈 상태와 위치 권한 거부 화면 캡처.

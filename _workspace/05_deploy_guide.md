# #실시간 Cloudflare 배포 가이드

## 1. 배포 원칙

- 운영 데이터는 최소수집, 최소보관, 최소노출을 기본값으로 한다.
- 브라우저는 D1/R2/Durable Objects에 직접 접근하지 않고 Cloudflare Worker API만 호출한다.
- 위치 원본 좌표는 영구 저장하지 않는다. 거리 구간 또는 장소 검증 결과만 저장한다.
- 사진은 클라이언트 1280px 재인코딩, Worker EXIF/GPS metadata stripping, Cloudflare Images binding 서버 픽셀 재인코딩 후 저장한다. 원본 파일명과 원본 메타데이터를 노출하지 않는다.
- 병원/관공서 카테고리는 민감정보 업로드 제한과 빠른 신고/삭제 운영을 필수로 한다.

## 2. 환경변수와 Secret

| 이름 | 노출 | 설명 | 운영 기준 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | 브라우저 가능 | 사이트 URL | production 도메인 |
| `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL` | 브라우저 가능 | Worker API 공개 URL | staging/production 분리 |
| `SILSIGAN_WORKER_API_BASE_URL` | 서버 전용 | Next 관리자 화면에서 사용할 Worker API URL | 서버 API route 전용, 브라우저 번들 금지 |
| `SILSIGAN_WORKER_ADMIN_TOKEN` | 서버 전용 | Next 관리자 화면의 Worker 신고 큐 proxy 토큰 | `moderator` 이상, 브라우저 번들 금지 |
| `SILSIGAN_STAGING_PAGES_URL` | 배포 gate 전용 | staging Pages 공개 URL | HTTPS, localhost 금지, production과 분리 |
| `SILSIGAN_STAGING_API_BASE_URL` | 배포 gate/smoke 전용 | staging Worker API 공개 URL | HTTPS, localhost 금지, production과 분리 |
| `SILSIGAN_PRODUCTION_PAGES_URL` | 배포 gate 전용 | production Pages 공개 URL | HTTPS, staging과 분리 |
| `SILSIGAN_PRODUCTION_API_BASE_URL` | 배포 gate 전용 | production Worker API 공개 URL | HTTPS, staging과 분리 |
| `SILSIGAN_STAGING_API_ALLOWED_ORIGINS` | 배포 gate 전용 | staging Worker에 주입할 exact browser origin allowlist | `SILSIGAN_STAGING_PAGES_URL` origin 포함 |
| `SILSIGAN_PRODUCTION_API_ALLOWED_ORIGINS` | 배포 gate 전용 | production Worker에 주입할 exact browser origin allowlist | `SILSIGAN_PRODUCTION_PAGES_URL` origin 포함 |
| `SILSIGAN_API_ALLOWED_ORIGINS` | Worker environment var | 해당 Worker를 호출할 수 있는 Pages origin의 쉼표 구분 exact allowlist | staging/production별 설정, HTTPS origin만, `*` 금지 |
| `CLOUDFLARE_D1_DATABASE_ID` | 서버/배포 전용 | D1 DB 식별자 | 브라우저 번들 금지 |
| `CLOUDFLARE_R2_BUCKET` | 서버/배포 전용 | R2 bucket 이름 | staging/production 분리 |
| `IMAGES` | Worker Images binding | R2 저장 전 서버 픽셀 재인코딩 | staging/production에서 binding smoke 필수 |
| `ADMIN_TOKEN` | Worker secret | 기존 단일 운영자 토큰 호환 경로 | production에서는 `ADMIN_TOKENS` 우선 |
| `ADMIN_TOKENS` | Worker secret | `operator`, `moderator`, `admin` role별 토큰 JSON | `wrangler secret put`로 등록 |
| `MODERATION_ALERT_WEBHOOK_URL` | Worker secret | 신규 신고 큐 운영자 알림 webhook URL | HTTPS만 허용, staging/production 분리 |
| `MODERATION_ALERT_WEBHOOK_TOKEN` | Worker secret | 운영자 알림 webhook bearer token | 선택값, 저장소/로그 노출 금지 |
| `CACHE` | Worker KV binding | 랭킹/장소/댓글/사진 캐시 무효화 | staging/production 분리 |

Cloudflare API 토큰과 관리자 토큰은 저장소, 로그, 브라우저 번들, 응답 본문에 노출하면 출시 차단이다.

## 3. Cloudflare 리소스

### 3.1 Worker

- `workers/api/wrangler.jsonc`를 기준으로 Worker를 배포한다.
- `workers/api/wrangler.jsonc`는 development, staging, production environment를 분리한다. Wrangler environment의 `vars`와 binding은 상속되지 않으므로 D1/R2/Images/KV/Durable Object binding을 environment마다 명시한다.
- 기본 development Worker dry-run은 local config sanity check이다. root config의 D1/KV ID는 development 리소스를 만들기 전까지 placeholder로 남기며, release evidence는 concrete binding이 들어간 staging/production dry-run만 사용한다.
- 모든 쓰기 API는 Worker 입력 검증, rate limit, 익명 식별자 소유권 검사를 거친다.
- staging/production 브라우저 preflight와 쓰기 API는 `SILSIGAN_API_ALLOWED_ORIGINS`에 정확히 일치하는 origin만 허용한다. 각 environment에는 해당 Pages origin을 별도로 설정하고 `*`, path, query가 있는 값은 사용하지 않는다.
- 관리자 API는 deny-by-default로 두고 role별 토큰과 감사 로그를 요구한다.
- Next 관리자 화면은 `/api/admin/moderation/reports`, `/api/admin/places/coordinate-status`, `/api/admin/users/restrict`, `/api/admin/users/unrestrict` server route를 통해서만 Worker 운영 API를 호출하고, Worker 운영 토큰은 브라우저로 내려보내지 않는다.
- 운영자 숨김/복구는 `moderator` 이상, 삭제는 `admin` 이상을 요구한다.
- 운영자 숨김/복구/삭제 API는 사진 삭제 시 D1 상태 변경, R2 object delete, `CACHE` KV key 삭제를 함께 수행한다.
- 신규 open 신고는 `MODERATION_ALERT_WEBHOOK_URL`이 있을 때 운영자 알림 채널로 전송한다. payload는 신고 ID, 대상 ID, 사유, 우선순위, 큐 경로만 포함하고 신고자 ID, note 원문, 원좌표, 원본 파일명은 제외한다.

### 3.2 D1

- 스키마 기준 파일은 `workers/api/src/db/schema.sql`이다.
- 마이그레이션 기준 파일은 `workers/api/migrations/0001_initial.sql`이며, V2 staging 적용 순서는 `0004_v2_foundation.sql` → `0005_v2_signals.sql` → `0006_trust_safety_identity.sql` → `0007_enforce_live_signal_expiry.sql` → `0008_persistent_preferences.sql` → `0009_analytics_events.sql` → `0010_photo_cleanup_jobs.sql` → `0011_location_accuracy_buckets.sql` → `0012_field_verification_method.sql` → `0013_field_report_moderation.sql` → `0014_field_report_publications.sql`이다.
- seed 기준 파일은 `workers/api/seeds/001_core_seed.sql`이다.
- 운영 전 두 파일이 동일한 컬럼/인덱스 정책을 유지하는지 확인한다.
- seed는 `ON CONFLICT` 기반이라 재실행해도 장소/랭킹 행이 중복되지 않는다. 현재 로컬 검증은 `pnpm test`의 `D1 core seed SQL is idempotent` 케이스가 담당한다.
- 좌표 미검증 seed는 `coordinate_status = 'TODO_COORDINATE_VERIFY'`와 null 좌표로 저장하고 공개 장소/지도/랭킹 API에서 제외한다.
- 좌표 미검증 seed는 `/api/admin/places/coordinate-status`에서 `operator` 이상 권한으로만 verified/rejected 전환하며, verified가 되기 전까지 공개 장소/지도/랭킹 API에 노출하지 않는다.
- Worker는 D1 바인딩이 있을 때 장소/랭킹 read path뿐 아니라 댓글, 사진 완료, 좋아요, 신고, admin action을 D1에 기록한다.
- 열린 신고는 `(anonymous_user_id, target_type, target_id, reason)` unique index와 Worker 중복 검사로 동일 익명 사용자의 반복 집계를 막는다.
- `blocked_users`는 `admin` 권한 운영 API로만 설정/해제하며, active 제한 상태의 익명 사용자는 새 댓글/사진/좋아요/클릭/신고 write가 `USER_RESTRICTED`로 차단된다.
- 운영자 hide/restore/delete 결과는 `admin_actions`에 남기고 public read path는 숨김/삭제 상태를 제외한다.

### 3.3 KV 캐시

- `workers/api/wrangler.jsonc`는 `CACHE` KV binding을 가진다.
- 관리자 조치 후 Worker는 전국/지도/지역/area/category 랭킹, 장소 상세, 장소 live, 댓글/사진 목록 캐시 키를 삭제한다.
- 현재 로컬 검증은 `pnpm test`의 `admin moderation role gates update D1 R2 and CACHE invalidation` 케이스가 담당한다.

### 3.4 R2 사진 저장소

- 업로드 경로는 UUID 기반으로 생성하고 원본 파일명을 저장하지 않는다.
- 브라우저 `PhotoUploader`는 JPEG/WebP 파일을 1280px 이하 캔버스 이미지로 재인코딩한 뒤 `/api/photos/upload-ticket`을 발급받고, 실제 바이너리를 multipart `/api/photos/upload`로 Worker에 보낸다.
- R2 binding이 있는 Worker는 multipart 파일에서 JPEG APP1/COM/metadata segment 또는 WebP EXIF/XMP chunk를 제거한 뒤, `IMAGES` binding이 있으면 서버 픽셀 재인코딩 결과만 R2에 저장한다.
- `/api/photos/upload-url`과 `/api/photos/complete`는 이전 클라이언트 호환용 legacy 경로로만 유지한다. 새 클라이언트와 staging smoke는 binary 경로를 사용하고, 운영 전 legacy 요청 0건을 확인한 뒤 폐기 여부를 별도로 승인한다.
- `workers/api/wrangler.jsonc`는 `PHOTOS` R2 binding과 `IMAGES` Images binding을 함께 선언한다.
- staging/production은 `SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET`, `PHOTO_UPLOAD_RATE_LIMITER`, `PHOTO_READ_RATE_LIMITER`, D1 `0016` guard를 모두 요구한다. bucket은 private으로 유지하고 파일은 Worker proxy로만 제공한다.
- compiled 4 GiB storage, 16,000 writes, 5,000 Images transformations cap의 80%에서 자동 중단되며 `GET/PATCH /api/admin/photo-cost-guard`와 `COST_ALERT_WEBHOOK_URL`을 운영 중단/알림 경로로 사용한다. `0020_photo_transform_budget.sql`이 없으면 Images 호출 전에 실패 폐쇄한다.
- Worker는 R2 저장 전 정화/재인코딩된 최종 이미지 바이트의 SHA-256 fingerprint를 계산하고, 삭제되지 않은 동일 fingerprint 사진이 D1에 있으면 `409 PHOTO_DUPLICATE`로 거부한다. fingerprint는 D1 중복 방지용이며 public API와 R2 metadata에 노출하지 않는다.
- 공개 URL을 쓰더라도 DB의 `status`, `deleted_at`, `report_count` 정책과 함께 노출을 제어한다.
- 운영자 사진 삭제는 R2 object key를 삭제한 뒤 D1에서 `deleted_at`과 `hidden_at`을 기록한다.
- 사진 중복/도용 기준은 `pnpm test`의 `D1 photo complete rejects duplicate sanitized image content before a second R2 write`로 검증한다.
- GPS EXIF 샘플 사진의 metadata 제거는 `pnpm test`의 `photo complete strips GPS EXIF sample before writing to R2`로 검증한다.
- 서버 픽셀 재인코딩은 `pnpm test`의 `photo complete reencodes pixels with Cloudflare Images binding before writing to R2`로 검증한다.
- 브라우저 업로드 smoke는 모바일 viewport에서 `PhotoUploader` 파일 선택, Worker `/api/photos/upload-ticket` 201, multipart `/api/photos/upload` 201, 상세 시트 사진 표시로 검증한다.
- Cloudflare staging에서는 실제 `R2`와 `IMAGES` binding으로 binary upload-ticket/upload smoke를 확인한 뒤 대량 사용자 사진 수집을 연다. legacy 경로는 별도 접근 로그로 폐기 조건을 확인한다.

### 3.4a Workers/D1 전역 비용 보호

- `0026_global_api_cost_guard.sql`은 보수적 route weight와 Cloudflare 관측치를 함께 저장하고 60% 1회 경고, 70% 비필수 기능 제한, 80% 중단을 적용한다.
- 전국 핵심 조회는 제한 상태에서 D1 쓰기가 없는 snapshot으로 전환한다. 쓰기 예약은 인증 뒤에만 수행해 무자격 공격자가 D1 admission 원장을 소진하지 못하게 한다.
- staging/production은 ranking `CACHE`와 분리된 `COST_GUARD_STATE` KV, `ADMIN_API_RATE_LIMITER`, `HIGH_COST_API_RATE_LIMITER`, `SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED=1`을 요구한다.
- `GET/PATCH /api/admin/api-cost-guard`와 `POST /api/admin/api-cost-guard/reconciliations`으로 즉시 중단·관측치 기록·재개를 수행한다. 재개는 15분 이내 Cloudflare 대조와 모든 지표 70% 미만을 요구한다.
- Worker에 도달한 요청은 코드가 거부하기 전에 이미 Workers 사용량에 집계되므로, WAF/rate-limit 규칙과 정적 asset의 Worker 우회 라우팅을 별도로 배포·검증한다.

### 3.5 Durable Objects

- 장소, 지역, 전국 실시간 방을 Durable Object로 분리한다.
- WebSocket 또는 polling 전환 시 같은 path alias를 유지한다.

## 4. 배포 순서

1. `pnpm install --frozen-lockfile`로 lockfile 정합성을 확인한다.
2. `pnpm verify`로 lint, typecheck, test, build를 통과시킨다.
3. `pnpm cf:typegen`으로 `.env.example` 기반 Cloudflare env type을 생성해 로컬 개인 `.env.local` 키 유입을 피한다.
4. `pnpm cf:build`로 OpenNext Cloudflare frontend bundle을 생성하고 `.open-next/worker.js`, `.open-next/assets`를 확인한다.
5. `pnpm cf:web:dry-run`, `pnpm cf:web:dry-run:staging`, `pnpm cf:web:dry-run:production`으로 frontend Worker/Assets bundle을 검증한다.
6. D1 staging DB의 Time Travel 복구 북마크를 먼저 기록하고 `0001`-`0003` legacy chain과 `0004`-`0017` V2 chain을 순서대로 적용한다. 각 단계의 schema/row 증거를 저장하고, 재검증은 원격 D1 count query와 expiry/accuracy/preference/analytics/photo-cleanup/photo-storage/photo-abuse/photo-read/upload-read-control/moderation/publication evidence로 확인한다. production은 staging sign-off 뒤 별도 승인으로만 적용한다.
7. 계정 소유자가 Cloudflare R2 결제/약관 활성화를 완료한 뒤 private `silsigan-photos-staging`만 만들고 Worker proxy를 검증한다. `silsigan-photos-production` 생성은 staging sign-off와 별도 production 승인 뒤에만 진행한다.
8. Worker secret을 staging과 production에 분리 등록한다. `SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET`은 32자 이상 랜덤값, `COST_ALERT_WEBHOOK_URL`/선택 token은 비용 중단 알림, `MODERATION_ALERT_WEBHOOK_URL`/선택 token은 신고 알림에 사용한다. production은 role별 JSON `ADMIN_TOKENS`를 우선 사용한다.
9. staging Worker를 배포하고 `SILSIGAN_STAGING_API_BASE_URL`을 실제 HTTPS 배포 URL로 export한다. `SILSIGAN_STAGING_API_ALLOWED_ORIGINS`에는 staging Pages의 exact origin을 기록하고, 같은 값을 staging Worker의 `SILSIGAN_API_ALLOWED_ORIGINS`에 주입한다.
10. Cloudflare Pages staging frontend를 배포하고 `SILSIGAN_STAGING_PAGES_URL`을 실제 HTTPS 배포 URL로 export한 뒤 `pnpm cf:preflight`를 통과시킨다. production도 별도 `SILSIGAN_PRODUCTION_API_ALLOWED_ORIGINS` 값을 production Worker에만 주입한다.
11. Web preview에서 Worker staging API를 연결해 장소/랭킹/댓글/사진/좋아요/신고/admin action smoke를 확인한다.
12. Production 배포 전 `docs/security-gate.md`의 residual risk를 다시 판정한다.

검증 명령:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm release:status -- --strict
pnpm audit --audit-level critical
pnpm cf:typegen
pnpm cf:build
pnpm cf:web:dry-run
pnpm cf:web:dry-run:staging
pnpm cf:web:dry-run:production
pnpm cf:dry-run
pnpm cf:dry-run:staging
pnpm cf:dry-run:production
export SILSIGAN_STAGING_PAGES_URL=https://<staging-pages>
export SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker>
export SILSIGAN_STAGING_API_ALLOWED_ORIGINS=https://<staging-pages>
export SILSIGAN_PRODUCTION_PAGES_URL=https://<production-pages>
export SILSIGAN_PRODUCTION_API_BASE_URL=https://<production-worker>
export SILSIGAN_PRODUCTION_API_ALLOWED_ORIGINS=https://<production-pages>
pnpm cf:preflight
SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> pnpm smoke:staging
SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging
SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> SILSIGAN_STAGING_MUTATION=1 SILSIGAN_STAGING_ADMIN_TOKEN=<admin-token> pnpm smoke:staging -- --require-admin
SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> SILSIGAN_STAGING_MUTATION=1 SILSIGAN_STAGING_ADMIN_TOKEN=<admin-token> SILSIGAN_STAGING_COORDINATE_STATUS_SMOKE=1 SILSIGAN_STAGING_COORDINATE_SMOKE_PLACE_ID=<place-id> SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE=<lat> SILSIGAN_STAGING_COORDINATE_SMOKE_LONGITUDE=<lng> pnpm smoke:staging -- --require-admin
SILSIGAN_STAGING_PAGES_URL=https://<staging-pages> SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> pnpm smoke:pages
SILSIGAN_STAGING_PAGES_URL=https://<staging-pages> SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> SILSIGAN_STAGING_BROWSER_MUTATION=1 pnpm smoke:pages
SILSIGAN_STAGING_PAGES_URL=https://<staging-pages> SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> SILSIGAN_STAGING_BROWSER_MUTATION=1 SILSIGAN_STAGING_BROWSER_REPORT=1 pnpm smoke:pages
pnpm release:gate -- --skip-verify --skip-dry-run --collect-blockers --tail-file=artifacts/cloudflare-tail/staging-tail.log
pnpm release:gate -- --local-pages-report --tail-required --tail-file=artifacts/cloudflare-tail/staging-tail.log
pnpm release:gate -- --release-candidate --tail-file=artifacts/cloudflare-tail/staging-tail.log
pnpm release:gate -- --production-candidate
SILSIGAN_STAGING_TAIL_LOG_FILE=artifacts/cloudflare-tail/staging-tail.log pnpm smoke:tail-redaction
cd workers/api
wrangler d1 execute DB --env staging --remote --command "SELECT (SELECT COUNT(*) FROM places WHERE coordinate_status = 'verified') AS verified_places, (SELECT COUNT(*) FROM place_rankings) AS rankings;" --json
wrangler d1 execute DB --env production --remote --command "SELECT (SELECT COUNT(*) FROM places WHERE coordinate_status = 'verified') AS verified_places, (SELECT COUNT(*) FROM place_rankings) AS rankings;" --json
```

## 5. 운영 모니터링

- Local redaction guard: `pnpm test`의 `worker generic errors do not echo secrets or raw sensitive values`, `analytics console events redact sensitive values`가 통과해야 한다.
- Release state ledger: `pnpm release:status`는 `docs/current-release-state.md`, wrangler resource IDs, staging/production Pages/API URL 상태를 JSON으로 요약한다. 출시 전에는 `pnpm release:status -- --strict`가 통과해야 한다.
- Resource preflight: `pnpm cf:preflight`는 staging/production D1/KV resource ID placeholder, secret-like `vars`, 누락된 R2/Images/Durable Object binding, 비어 있거나 localhost/http/query/fragment/credential이 포함된 Pages/API URL, staging/production URL 중복을 출시 차단으로 실패시킨다.
- Release gate: `pnpm release:gate`는 로컬 검증 뒤 `--local-pages-report` baseline과 지정된 `--tail-file` redaction을 strict URL/resource checks보다 먼저 실행한다. 따라서 staging URL이 아직 없어도 로컬 브라우저 baseline과 tail 로그 안전성은 먼저 실패/통과가 드러나며, 이 둘이 통과한 뒤 deployment URL blocker에서 멈춘다. `--collect-blockers`는 non-mutating 진단 모드로 첫 실패 뒤에도 strict status, preflight, external-state, read-only smoke를 계속 실행해 missing URL/R2 blocker를 한 번에 모은다. `--release-candidate`는 최종 staging 후보 증거용으로 mutating Worker smoke, Pages 신고 생성 smoke, 공개 사진 클릭 요구, tail 필수 검증을 함께 켠다. `--production-candidate`는 production Pages/API HTTPS URL readiness를 실행 전 검증하고 production API/Pages read-only smoke를 추가하되 staging 쓰기 smoke나 tail 필수를 자동으로 켜지 않는다. Local Pages report baseline은 network redaction과 신고 target type뿐 아니라 `map.controlsUncovered`, `onboarding.dismiss`, map marker detail hit-testing을 포함한 필수 smoke check integrity도 검증한다.
- Staging smoke: `pnpm smoke:staging`은 `SILSIGAN_STAGING_API_BASE_URL` 또는 `--base-url`이 없으면 실패하며, 기본 읽기 API, 공개 좌표, place/region/global realtime room, 랭킹, 댓글/사진 목록, 무권한 admin 차단을 확인한다. `SILSIGAN_STAGING_MUTATION=1`일 때만 실제 R2/Images 사진 완료/삭제/공개 목록 제외, 댓글 생성/작성자 삭제/공개 목록 제외, 장소 좋아요/취소를 확인한다. 같은 실행 전에 `SILSIGAN_STAGING_ADMIN_TOKEN`을 shell에 설정하면 장소 신고 생성, 운영자 open 큐 조회, rejected 처리, open 큐 정리, 전용 익명 사용자 임시 제한/차단 확인/해제/댓글 정리까지 확인한다. 좌표 상태 변경은 실제 장소 레코드를 바꾸므로 `SILSIGAN_STAGING_COORDINATE_STATUS_SMOKE=1`과 대상 장소/좌표 환경변수를 명시한 경우에만 verified 운영 경로와 공개 상세 노출을 확인한다.
- Pages smoke: `pnpm smoke:pages`는 headless Chrome으로 Pages 프론트를 직접 열고 지도 surface의 실제 크기/내부 콘텐츠, 초기 지도 도구와 현재 위치 버튼이 하단 내비게이션에 가려지지 않는지, 첫 방문 안내가 실제 클릭으로 닫히는지, 교통/필터 버튼 클릭 상태 변화, 전국/지역/지도 화면 안 TOP 10 랭킹 패널과 랭킹 항목 상세 열기, 지도 마커 상세 열기, Worker `/api/places` 요청, place/region/global realtime room 요청을 검증한다. `SILSIGAN_STAGING_BROWSER_MUTATION=1`은 좋아요/댓글/사진 클릭을 실제 Worker API로 확인하고 좋아요/댓글은 같은 익명 세션으로 정리한다. 신고 생성은 운영 영향이 있으므로 `SILSIGAN_STAGING_BROWSER_REPORT=1`을 명시한 경우에만 실행하며, 이때 장소/댓글/사진 신고가 모두 `/api/moderation/reports`로 들어가는지 `targetType` 기준으로 확인한다. 스테이징 URL이 준비되기 전에는 `pnpm smoke:pages:local-report -- --timeout-ms=45000` 또는 `pnpm release:gate -- --local-pages-report --tail-required --tail-file=artifacts/cloudflare-tail/staging-tail.log`로 local mock Worker + Next dev + 같은 Pages browser smoke를 실행해 `--mutating --report --require-photo` 경로와 필수 smoke check integrity를 반복 검증한다. 이 로컬 baseline은 staging Pages/Worker 증적을 대체하지 않는다.
- Worker logs: staging에서 `wrangler tail` 또는 Cloudflare dashboard 로그 샘플을 `SILSIGAN_STAGING_TAIL_LOG_FILE`에 저장한 뒤 `pnpm smoke:tail-redaction`으로 raw coordinate, Cloudflare API token, 관리자 토큰, 익명 식별자 원문, 이메일, 원본 파일명이 출력되지 않는지 확인한다. 이 gate의 안전 로그 통과와 raw 민감값 실패 경로는 `pnpm test`의 tail redaction smoke 테스트가 고정한다.
- D1 metrics: 신고 처리 지연, 랭킹 집계 지연, 쓰기 실패율을 모니터링한다.
- R2 logs: 업로드 거부, 삭제 실패, 공개 URL 노출 범위를 확인한다.
- 신고 큐: 개인정보/얼굴/차량번호/병원/관공서 신고는 우선순위 높음. `pnpm test`의 `D1 report creation sends a redacted moderation alert webhook`은 신규 신고가 redacted webhook payload로 운영자 채널에 전달되는지 검증한다.
- 삭제 SLA: 명백한 개인정보 또는 민감정보는 확인 즉시 숨김, 24시간 내 최종 삭제 판단.

## 6. 롤백 기준

다음 중 하나라도 발생하면 즉시 배포 롤백 또는 기능 플래그 비활성화:

- 사용자 원본 좌표 저장 또는 로그 노출 확인.
- 사진 EXIF GPS 노출 확인.
- D1/R2 직접 접근 또는 타인 데이터 접근 확인.
- Cloudflare API 토큰 또는 관리자 토큰 브라우저 노출 확인.
- 신고/삭제 큐 장애로 민감 사진을 숨길 수 없는 상태.

`pnpm cf:rollback:drill -- --env=staging --kind=web`은 계획만 출력하고, `--check`도 `wrangler deployments list --json`만 실행한다. 하네스는 실제 `rollback`을 실행하지 않으며 `--yes`를 출력하지 않는다. Worker 롤백은 D1, R2, KV, Durable Objects, migration, secret을 되돌리지 않으므로 실제 훈련 전 각각의 호환성을 별도로 확인한다. 승인·롤백·검증·현재 버전 복구 절차는 `docs/cloudflare-worker-rollback-runbook.md`를 따른다.

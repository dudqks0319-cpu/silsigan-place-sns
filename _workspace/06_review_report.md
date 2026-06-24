# #실시간 QA/Security 리뷰 보고서

**리뷰 역할:** Orchestrator 통합 검증
**리뷰 범위:** Next.js UI, Cloudflare Worker API, D1/R2 schema, domain logic, docs, dependency audit
**현재 위험도:** MEDIUM

## 1. 종합 평가

- 배포 준비 상태: 로컬 MVP 검증과 staging smoke harness 준비는 완료. 실제 공개 전 Cloudflare staging URL/R2/Images 실환경 실행과 Workers 플랫폼 로그 redaction tail 증적 확인 필요.
- Dependency vulnerabilities: `pnpm audit --audit-level critical` 통과. `pnpm audit --json` 기준 low/moderate/high/critical 0.
- `pnpm verify`: 통과 기준.

## 2. 수행한 확인

- `pnpm lint`: 통과.
- `pnpm typecheck`: 통과.
- `pnpm test`: 통과, 89 passed.
- `pnpm release:status`: `blocked-external` 출력. 현재 D1/KV 실제 ID와 deployment URL 미설정 상태를 분리 보고.
- `pnpm build`: 통과.
- `pnpm smoke:tail-redaction --tail-file=tests/fixtures/redacted-worker-tail.log`: 통과.
- `npx --yes wrangler deploy --dry-run --config workers/api/wrangler.jsonc`: 통과.
- `pnpm cf:dry-run`, `pnpm cf:dry-run:staging`, `pnpm cf:dry-run:production`: 통과.
- `pnpm cf:typegen`, `pnpm cf:build`, `pnpm cf:web:dry-run`, `pnpm cf:web:dry-run:staging`, `pnpm cf:web:dry-run:production`: 통과.
- `pnpm cf:external-state`: OAuth, R2 bucket visibility, deployment URL shape, staging/production Worker dry-run을 non-mutating JSON으로 분리 보고. 현재는 R2 미활성화와 deployment URL 4개 미설정 때문에 실패.
- `pnpm cf:preflight`: staging/production D1/KV/R2/Images/Durable Object binding check는 통과하고, 미설정 Pages/API deployment URL 4개 때문에 실패. 출시 차단 gate로 정상 동작.
- Playwright 모바일 viewport smoke:
  - 네이버 외부 style/tile resource 실패 시 `naver-map--fallback`으로 전환되고 지도 마커 버튼 4개가 유지됨.
  - 광안리 상세 시트에서 사진 제보 파일 선택, 브라우저 캔버스 재인코딩, Worker `/api/photos/upload-url` 201, `/api/photos/complete` 201, D1 `ready` 사진 생성, 화면 `사진4장`/`1KB 현장 사진` 2건 표시 확인.
- Playwright 데스크톱 viewport smoke:
  - 1440px viewport에서 fallback 지도와 `광안리해수욕장 상세 열기` 마커 클릭 확인.
  - 상세 시트 `좋아요`/`장소 신고` 버튼 토스트 확인.
  - 상세 시트 `현장 제보 작성` 버튼이 `광안리해수욕장 현장 제보` 작성 폼으로 전환됨을 확인.
  - 첫 방문 온보딩 `바로 둘러보기` 버튼 닫기와 `localStorage` 반영 확인.
  - `울산광역시청` 관공서 장소에서 지도 상세 사진 업로드 영역과 현장 제보 작성 폼의 민감정보 경고 표시 확인.
- Playwright 모바일 viewport smoke:
  - 390px viewport에서 네이버 auth/style 실패 시 `대체 지도 표시 중` fallback이 표시되고, 첫 방문 안내가 열린 상태에서도 `필터`와 하단 네비 클릭이 동작함을 확인.
  - 안내 닫기 후 `광안리해수욕장 상세 열기` 마커가 상세 시트를 열고, 하단 `제보` 버튼이 작성 화면으로 전환됨을 확인.
  - Cloudflare 사진 API base가 설정되지 않은 로컬 Next 단독 실행에서는 선택 사진 목록 요청을 생략해 `/api/photos` 404 콘솔 오류가 발생하지 않음.
- Chrome headless CDP 모바일 smoke:
  - 초기 `지도` 화면에서 외부 네이버 지도 리소스 실패 시에도 fallback 지도 surface가 240x180 이상으로 표시되고 `대체 지도 표시 중` 안내와 마커/랭킹 텍스트가 유지됨.
  - Network 이벤트에서 초기 `/api/places?limit=100` 이후 지도 bounds emission이 `/api/places?bbox=129.118600%2C35.153200%2C129.311500%2C35.838200&limit=100` 재조회를 발생시키는지 확인함.
- In-app Browser comment/photo report smoke:
  - 로컬 Next + mock Worker API에서 네이버 마커 클릭으로 상세 시트를 열고, Worker 사진 신고가 사유 모달을 거쳐 `/api/moderation/reports`에 `targetType=photo`로 접수됨을 확인.
  - 신규 Worker 댓글 작성 후 댓글 신고 버튼이 표시되고, 댓글 신고가 `/api/moderation/reports`에 `targetType=comment`로 접수되며 toast와 realtime `신고 접수` 상태가 보임을 확인.
  - `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4319` mock Worker 환경에서 fallback 지도 마커 클릭이 상세 시트를 열면서 `POST /api/places/busan-gwangalli/click`을 Worker API base로 보내는지 확인함.
  - `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4320` mock Worker 환경에서 장소 상세 댓글 작성 폼이 `POST /api/comments`를 Worker API base로 보내고, 응답 댓글과 `댓글 업데이트` realtime strip을 즉시 표시하는지 확인함.
  - `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4321` mock Worker 환경에서 Naver auth 401 이후 fallback 지도가 앱 크래시 없이 유지되고, `좋아요`가 `POST /api/places/busan-gwangalli/like`, `장소 신고`가 `POST /api/moderation/reports`를 보내며 `좋아요 반영`/`신고 접수` realtime strip을 표시하는지 확인함.
  - `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4322` mock Worker 환경에서 Worker 사진이 `/api/photos?placeId=busan-gwangalli&limit=12`로 표시되고, 사진 타일 클릭이 `POST /api/photos/photo_click_smoke_1/click`을 보내며 화면 카운트를 `클릭 4`에서 `클릭 5`로 갱신하는지 확인함.
  - `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4323` mock Worker 환경에서 Worker 사진 `previewUrl` 파일이 타일 배경으로 요청되고 `/api/photos/photo_preview_smoke_1/file` 200, `/api/photos/photo_preview_smoke_1/click` 200, 화면 카운트 `클릭 2 -> 클릭 3`을 확인함.
  - `SILSIGAN_STAGING_PAGES_URL=http://127.0.0.1:3021`, `SILSIGAN_STAGING_API_BASE_URL=http://127.0.0.1:4331` 환경의 `pnpm smoke:pages`에서 headless Chrome이 지도 surface의 크기/내부 콘텐츠, 교통/필터 버튼 클릭 상태 변화, 장소 상세, 프론트 `/api/places` Worker base 요청을 확인함. `SILSIGAN_STAGING_BROWSER_MUTATION=1` 재실행에서는 좋아요/댓글/사진 UI POST와 좋아요/댓글 cleanup까지 확인함.
  - `pnpm smoke:pages:local-report -- --timeout-ms=45000`가 로컬 mock Worker + Next dev + headless Chrome을 띄워 `--mutating --report --require-photo` Pages smoke를 수행하고, `map.controlsUncovered`, `rankings.visible`, `rankings.detail`, `place.detail`, `worker.realtimePlaceRoom`, `worker.realtimeRegionRoom`, `worker.realtimeGlobalRoom`, `places.like`, `comments.create`, `photos.click`, `reports.placeCreate`, `reports.commentCreate`, `reports.photoCreate`, `reports.create`, `browser.cleanup` 통과와 신고 `targetType=place/comment/photo`를 확인함. `pnpm release:gate -- --local-pages-report ...`에서도 같은 local baseline을 strict external staging checks 전에 실행하도록 release gate에 연결했고, tail 파일이 지정되면 tail redaction을 strict URL/resource checks 전에 검증하도록 순서를 고정함. 실제 release gate 실행은 local baseline과 tail redaction 통과 후 미설정 deployment URL 4개에서 예상대로 중단됨. 최신 증적은 `artifacts/cloudflare-pages-smoke-worker-report-local/pages-smoke-1782102771701.png`, `pages-smoke-network-1782102771702.json`, `pages-smoke-console-1782102771703.log`이며, local report smoke는 network artifact target-type integrity, redaction, smoke check integrity를 내장 검증해 `eventCount=126`, `reportTargetTypes=comment/photo/place`, `storesPostData=false`, `sensitiveHits=[]`, `passedRequiredChecks=19`, `failedChecks=[]`를 출력함.
  - `pnpm smoke:pages -- --pages-url=http://localhost:3000 --timeout-ms=45000`가 live Naver map/control fix 이후 `map.controlsUncovered`, `map.trafficButton`, `map.filterButton`, `map.requeryButton`, `bottomNav.home`, `bottomNav.map`, `rankings.detail`, `place.detail`을 통과함. 최신 증적은 `artifacts/cloudflare-pages-smoke/pages-smoke-1782102298415.png`, `pages-smoke-network-1782102298417.json`, `pages-smoke-console-1782102298418.log`.
  - 하단 `홈` 이동 후 상단 알림 버튼이 `aria-pressed=true` 상태와 활성 스타일, toast 문구를 갱신함.
  - 홈 피드 `주차` 탭은 실제 주차 관련 게시물 3건으로 목록을 필터링하고, `야경` 탭은 0건 empty state로 전환됨.
- API unit coverage:
  - D1 바인딩이 있을 때 장소/랭킹 read path가 memory fallback 대신 D1을 사용.
  - D1 seed SQL 2회 적용 멱등성.
  - D1 바인딩이 있을 때 댓글/사진/좋아요/신고/admin action write path가 D1에 영속.
  - 동일 익명 사용자의 중복 신고 방지, 일반 신고 3회 자동 숨김, 개인정보 신고 1회 임시 숨김.
  - 신규 open 신고가 운영자 알림 webhook으로 전송되고 payload에서 신고자 익명 ID, note 원문, 이메일, 전화번호, 원본 파일명이 제외됨.
  - Next 관리자 화면이 서버 route를 통해 Worker open 신고 큐, 장소 좌표 상태, 사용자 제한/해제를 처리하고, UI payload는 필요한 최소 필드로 제한.
  - 운영자 hide/restore/delete API 권한 실패, role 분리, D1 상태 변경, 사진 R2 object delete, `CACHE` KV key 삭제, admin action 기록.
  - 운영자 사용자 제한/해제 API의 admin 권한 요구, D1 `blocked_users` 집행, 제한된 익명 사용자의 새 댓글/사진/좋아요/신고 write 차단, public 오류 응답 최소화.
  - 운영자 좌표 상태 API의 operator 권한 요구, 좌표 범위 검증, TODO seed verified/rejected 전환, 공개 장소/랭킹 노출 제어, cache invalidation.
  - 운영자 bulk hide/restore API의 `operator` 권한 실패, bulk delete 거부, 부분 실패 결과, 댓글/사진 숨김/복구, 대상별 `bulk_hide`/`bulk_restore` 감사 로그, `CACHE` KV key 삭제.
  - 운영자 place hide 후 전국/지역/area/category/map-bounds 랭킹 제외와 restore 후 재노출.
  - 좌표 미검증 seed가 `TODO_COORDINATE_VERIFY`와 null 좌표로 남고 공개 장소/상세/랭킹 API에서 제외.
  - Worker D1 place event가 `created_at + 3 hours` 만료시각을 저장하고, 만료 후 공개 댓글/사진 목록, 장소 live 카운트, 랭킹 live score에서 제외.
  - 장소 목록/상세/실시간 요약.
  - 전국/지역/카테고리/지도 영역 랭킹.
  - 댓글 생성/삭제 negative-path.
  - 사진 업로드 경로 발급/완료/목록/삭제.
  - 정화/재인코딩 후 사진 SHA-256 fingerprint 저장, 삭제되지 않은 exact duplicate의 `409 PHOTO_DUPLICATE` 차단, 두 번째 R2 write 방지.
  - Cloudflare Images binding 기반 서버 픽셀 재인코딩 후 R2 저장.
  - Worker generic error 응답과 브라우저 analytics console 출력이 토큰, raw 좌표, 익명 ID, 원본 파일명, 이메일을 노출하지 않도록 redaction guard 적용.
  - Captured Worker tail redaction CLI가 안전 로그는 통과시키고 raw token/coordinate/anon ID/email/original filename 로그는 실패 처리.
  - Cloudflare resource preflight가 staging/production Pages URL과 Worker API URL의 missing, localhost, non-HTTPS, query/fragment/credential, staging/production 중복을 출시 차단으로 실패 처리하고 negative-path fixture로 검증됨.
  - Release state check가 ready fixture와 external blocker strict failure를 분리 검증.
  - Durable Object place/region/global realtime fanout이 댓글 생성 이벤트로 검증되고, 장소 좋아요가 `place.liked` realtime room event로 fanout 되는지 별도 검증됨.
  - 지도 상세가 Cloudflare API base 설정 시 place realtime room을 polling하고 최근 이벤트/연결 모드를 표시함.
  - 지역/area 활성화 기준이 seed 장소, 7일 제보, 7일 현장 인증, 7일 사진 제보, 운영/신고 readiness check로 계산되고 운영 대시보드에 row별 통과/미달 상태로 표시됨.
  - 장소 좋아요 중복 제한과 해제.
  - 댓글 작성 rate limit이 MVP 정책값인 1분 5개와 1일 100개를 모두 차단하는지 검증.
  - 신고 rate limit과 금칙 입력 제한.
  - Durable Object path alias.
  - Next 로컬 API와 프론트 초기/폴링 fetch가 선택 지역 `regionId`와 `limit=100`을 사용해 전국 fetch-all MVP 병목을 줄이는지 검증.

## 3. 정합성 매트릭스

| 검증 항목 | 상태 | 비고 |
| --- | --- | --- |
| 아키텍처 문서 | 통과 | Cloudflare 전국 MVP 기준으로 갱신 |
| API 명세 | 통과 | Worker route alias, 사진/댓글/랭킹, `/api/reports` 현장 제보와 `/api/moderation/reports` 운영 신고 분리 포함 |
| DB 스키마 | 통과 | 원좌표 컬럼 없음, D1 `place_events.source = field_report` 상태/검증 반경/TTL 저장, seed 2회 적용 멱등성 테스트 |
| Wrangler 환경 분리 | 통과 | development/staging/production에 D1/R2/Images/KV/Durable Object binding 명시. 기본 development dry-run은 root D1/KV placeholder를 사용하는 local config sanity check이고 release evidence는 staging/production dry-run으로 제한 |
| Cloudflare resource/external preflight | 부분 통과 | fixture 테스트는 concrete ID와 deployment URL 통과, placeholder ID와 missing/unsafe/duplicate URL 실패를 검증. 실제 config/env는 D1/KV resource binding이 통과하고, `cf:external-state`와 `cf:preflight`가 미설정 deployment URL 및 R2 미활성화를 출시 차단으로 분리 보고 |
| Release state ledger | 부분 통과 | `docs/current-release-state.md`와 `pnpm release:status`가 로컬 상태와 외부 blocker를 분리. strict mode는 실제 외부 blocker 때문에 실패 |
| Next admin Worker proxy | 통과 | 서버 proxy가 Worker 운영 토큰을 브라우저로 노출하지 않고 신고 큐/좌표 상태/사용자 제한 payload를 최소화하며, Next 관리자 인증 누락 시 Worker로 proxy하지 않는 route-level 테스트 통과 |
| Admin user restriction | 통과 | `admin` 권한으로만 익명 사용자 제한/해제를 수행하고, 제한된 사용자의 새 public write를 D1에서 차단하는 negative-path 테스트 통과 |
| Operator coordinate status | 통과 | `operator` 권한으로 좌표 미검증 seed를 검증/반려하고 공개 장소/랭킹 노출을 제어하는 D1 테스트 통과 |
| Durable Object realtime | 통과 | place/region/global room deterministic routing, fanout polling, WebSocket broadcast, 프론트 place room 소비 경로, Pages browser place/region/global realtime room 요청 smoke 통과 |
| 프론트 화면 | 통과 | 지도 fallback, bounds 기반 `/api/places?bbox=...` 재조회, Worker base 설정 시 장소 목록 `/api/places` Worker read path, 전국/지역/지도 화면 안 TOP 10 랭킹 패널과 랭킹 항목 상세 열기, 마커 클릭의 Worker click 이벤트 동기화, 상세 댓글 작성의 Worker comment 이벤트 동기화, 상세 버튼 클릭, 사진 업로드/미리보기/클릭 UI, realtime event strip smoke, 선택 지역 scoped fetch, 홈 피드 탭/알림 토글 smoke, `마이` 메뉴 섹션 이동 smoke, 관리자 신고 필터 탭/action smoke 확인 |
| 도메인 테스트 | 통과 | 만료/신고/거리 구간/Cloudflare 정책, D1 현장 제보 coarse radius와 300m 밖 거부 |
| 보안 게이트 | 부분 통과 | R2 EXIF 제거, Images binding 재인코딩, 로컬 로그/응답 redaction guard와 captured-log validator는 통과. Workers 플랫폼 tail 증적은 배포 전 재검증 |
| Staging smoke harness | 통과 | `pnpm smoke:staging`은 Worker API base URL 없이는 실패하고, 읽기 API/공개 좌표/place-region-global realtime room/랭킹/댓글/사진/admin deny를 확인한다. mutation flag로 R2/Images 사진 완료/삭제/공개 목록 제외, 댓글 생성/작성자 삭제/공개 목록 제외, 장소 좋아요/취소를 수행한다. admin token이 있으면 장소 신고 생성, 운영자 open 큐 조회, rejected 처리, open 큐 정리, 전용 익명 사용자 임시 제한/차단 확인/해제/댓글 정리까지 수행한다. release evidence는 `--require-admin`으로 운영자 토큰 누락을 fail-fast 처리한다. 좌표 상태 smoke는 명시 opt-in 대상 장소/좌표가 있을 때만 수행한다 |
| Release blocker collection | 통과 | `pnpm release:gate -- --collect-blockers`는 non-mutating 전용으로 첫 external failure 뒤에도 release status, URL preflight, external-state, read-only smoke를 계속 실행하고, missing deployment URL 4개, `cloudflare.r2.enabled`, staging API base URL, Pages URL blocker를 한 결과에서 확인한다. 최신 실행은 `resultCounts={pass:7,fail:5}`, `failedSteps=[release.status.strict, cloudflare.preflight, cloudflare.externalState, staging.api.smoke, pages.browser.smoke]`, `blockers=[deployment_url.*, staging.*.url, production.*.url, cloudflare.r2.enabled, BASE_URL_REQUIRED, PAGES_URL_REQUIRED]`를 상단 출력으로 요약하며, `--mutating`과 함께 쓰면 실행 전 실패한다 |
| Release candidate gate | 통과 | `pnpm release:gate -- --release-candidate --tail-file=...`는 최종 staging 후보 검증에서 `--mutating`, `--browser-report`, `--require-photo`, `--tail-required`를 함께 켜며, `SILSIGAN_STAGING_ADMIN_TOKEN` 또는 tail 파일이 없으면 실행 전 실패한다. 좌표 상태 smoke는 실제 장소 상태를 바꾸므로 `--coordinate-status` 명시 opt-in으로 유지한다 |
| Production candidate gate | 통과 | `pnpm release:gate -- --production-candidate`는 HTTPS production Pages/API URL이 없거나 unsafe이면 실행 전 실패하고, 준비된 경우 production API/Pages read-only smoke를 추가한다. staging 쓰기 smoke, browser report, public photo requirement, tail requirement는 자동으로 켜지 않는다 |
| Pages browser smoke harness | 통과 | `pnpm smoke:pages`가 headless Chrome으로 Pages/Next 프론트를 열어 지도 surface 크기/내부 콘텐츠, 초기 지도 도구 버튼이 하단 내비게이션에 가려지지 않는지, 교통/필터 버튼 클릭 상태 변화, 전국/지역/지도 화면 안 TOP 10 랭킹 패널 표시, 랭킹 항목 상세 열기, 장소 상세, Worker `/api/places` 요청을 확인한다. `SILSIGAN_STAGING_BROWSER_MUTATION=1`에서는 좋아요/댓글/사진 UI POST와 좋아요/댓글 cleanup을 확인한다. 실제 신고 생성은 `SILSIGAN_STAGING_BROWSER_REPORT=1` opt-in으로 분리하고, opt-in 시 장소/댓글/사진 신고 POST를 `targetType` 기준으로 확인한다. local report smoke는 이 필수 UI/Worker 체크 목록이 누락되거나 실패하면 자체 실패한다 |

## 4. 남은 출시 차단 리스크

| 리스크 | 상태 | Owner | Due date |
| --- | --- | --- | --- |
| Cloudflare Pages/API deployment URL 미설정 | D1/KV ID는 실제 리소스로 치환됐고 원격 D1 migration/seed 적용 완료. `pnpm cf:preflight`는 deployment URL 4개 미설정만 출시 차단으로 실패 | FullStackDev | 2026-06-21 |
| Cloudflare R2 계정 활성화 필요 | `wrangler r2 bucket list`와 staging Worker deploy가 code 10042로 실패. Dashboard에서 R2 활성화 후 bucket/Worker deploy 재시도 필요 | FullStackDev | 2026-06-21 |
| Cloudflare Images/admin staging mutation smoke 미수행 | harness 준비됨, `SILSIGAN_STAGING_ADMIN_TOKEN`을 shell에 설정한 뒤 `SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging`으로 배포 전 재검증 필요. 이 harness는 사진 완료 후 public photo 최소 필드, `previewUrl` 파일 200/image bytes, 삭제 후 미노출까지 확인한다. 좌표 상태 smoke는 `SILSIGAN_STAGING_COORDINATE_STATUS_SMOKE=1`과 대상 장소/좌표를 명시해 별도 실행 | FullStackDev | 2026-06-21 |
| Cloudflare staging 배포 smoke 미수행 | harness 준비됨, staging URL 연결 후 배포 전 재검증 필요 | Orchestrator | 2026-06-21 |
| Workers 플랫폼 `wrangler tail` redaction 증적 미확보 | 로컬 redaction guard와 captured-log validator는 통과, staging tail 확인 필요 | FullStackDev | 2026-06-21 |
| npm audit low/moderate dev-toolchain transitive 2건 | high/critical은 0, upstream update 추적 | FullStackDev | 2026-06-22 |

## 5. 보안 체크리스트

- [x] 하드코딩 비밀값 미검출.
- [x] Supabase 런타임 의존성 제거.
- [x] DB schema에 사용자 원본 좌표 컬럼 없음.
- [x] D1 seed import 멱등성 테스트 구현.
- [x] Wrangler development/staging/production environment binding 분리와 dry-run 스크립트 구현.
- [x] Cloudflare resource ID placeholder preflight와 negative-path 테스트 구현.
- [x] Cloudflare Pages/API deployment URL preflight와 missing/unsafe URL negative-path 테스트 구현.
- [x] Current release state ledger와 `release:status` strict gate 구현.
- [x] Durable Object place/region/global realtime fanout 테스트 구현.
- [x] 댓글/사진/좋아요/신고/admin action D1 write path 테스트 구현.
- [x] 신고 3회 자동 숨김과 개인정보 신고 1회 임시 숨김 테스트 구현.
- [x] 신고 큐 운영자 알림 webhook과 redacted payload 테스트 구현.
- [x] Next 관리자 화면의 Worker 신고 큐/좌표 상태/사용자 제한 server proxy와 최소 payload 테스트 구현.
- [x] 사진 exact duplicate/도용 차단 fingerprint와 R2 중복 쓰기 방지 테스트 구현.
- [x] 관리자 hide/restore/delete 권한 실패, role 분리, D1 상태 변경, R2 object 삭제, `CACHE` KV key 삭제 테스트 구현.
- [x] 관리자 사용자 제한/해제 권한 실패, D1 `blocked_users` 집행, public write 차단 테스트 구현.
- [x] 관리자 bulk hide/restore 권한 실패, bulk delete 거부, 부분 실패, 대상별 감사 로그, `CACHE` KV key 삭제 테스트 구현.
- [x] 운영자 place hide/restore 시 전국/지역/area/category/map-bounds 랭킹 제외/복구 테스트 구현.
- [x] 3시간 만료 제보의 공개 목록/live 요약/랭킹 제외 테스트 구현.
- [x] Worker generic error 응답과 브라우저 analytics console 출력 redaction 테스트 구현.
- [x] Captured Worker tail 로그 redaction validator와 안전/누출 fixture smoke 테스트 구현.
- [x] R2 저장 전 JPEG GPS EXIF 샘플 metadata 제거 테스트 구현.
- [x] Cloudflare Images binding 서버 픽셀 재인코딩 후 R2 저장 테스트 구현.
- [x] 브라우저 사진 업로드 smoke에서 파일 선택, 클라이언트 재인코딩, Worker R2/D1 저장, 상세 시트 반영 확인.
- [x] 브라우저 사진 미리보기 smoke에서 Worker preview URL 이미지 로드와 R2 read proxy 계약 확인.
- [x] 브라우저 사진 클릭 smoke에서 Worker photo click API 호출과 click count 반영 확인.
- [x] 네이버 지도 외부 리소스 실패 시 클릭 가능한 fallback 지도 전환 확인.
- [x] 좌표 미검증 seed의 공개 지도/랭킹 제외 테스트 구현.
- [x] 좌표 미검증 seed의 operator 검증/반려 API와 공개 지도/랭킹 노출 제어 테스트 구현.
- [x] 댓글/사진/좋아요/신고 negative-path 테스트 구현.
- [x] `/api/reports` 현장 제보의 D1 source/status/TTL/coarse radius 저장과 원좌표/사진 URL 비저장 테스트 구현.
- [x] 민감 카테고리 경고와 신고 정책 문서화.
- [x] 관공서 장소 지도 상세/현장 제보 작성 화면의 민감정보 경고 브라우저 smoke 확인.
- [x] 지역/area 활성화 기준 운영 대시보드 표시와 도메인/store 테스트 구현.
- [ ] Cloudflare staging URL/R2/Images 실환경 smoke 및 Workers 플랫폼 tail 로그 redaction 증적 확보.

## 6. 판정

로컬 개발과 코드 리뷰 기준의 Cloudflare 전환 산출물, environment별 Wrangler dry-run 경로, resource ID preflight gate, 반복 가능한 staging smoke harness는 준비됐다. 실제 일반 사용자 출시 기준으로는 D1/KV 실제 ID 치환으로 preflight를 통과시키고, R2/Images 실환경 연결, staging URL에서의 smoke 실행, Workers 플랫폼 tail 로그 redaction 증적 확보가 남은 필수 작업이다.

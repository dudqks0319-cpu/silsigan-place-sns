# #실시간 Cloudflare 전환 보안 게이트

기준일: 2026-07-20
범위: Cloudflare Pages/Workers, D1, R2, KV/Durable Objects, 공공데이터 source, Capacitor WebView를 포함한 실시간 V2.

출시 전 P0 항목은 모두 통과해야 한다. 2026-07-20 로컬 코드는 전체 테스트, typecheck, lint, production build와 보안 하네스를 통과했다. 최신 읽기 전용 계정 검사는 Staging D1 스키마를 `0025`까지 검증하고 첫 공백 `D1_0026_NOT_APPLIED`를 확인했지만, Wrangler registry가 `0018`~`0026`을 pending으로 보고해 `D1_MIGRATION_REGISTRY_DRIFT`도 실패 폐쇄한다. 전용 staging/production `COST_GUARD_STATE` KV는 별도 생성·바인딩됐지만, R2 사용자 checkout, WAF/static-routing evidence, Turnstile widget/secret, API Worker/URL과 exact API origin, NAVER용 소유 custom domain, production D1, source 권리, 운영 채널, native 실기기, 법무 서명이 없어 출시 상태는 계속 `blocked-external`이다.

## V2 Security Gate Sign-Off

```txt
SECURITY GATE
- Secrets: PASS LOCAL - no hardcoded provider/admin secrets; public source and WebView outputs are redacted
- AuthN/AuthZ: PASS LOCAL - admin source, moderation, deletion, restriction, and identity link paths deny by default; browser writes require a server-bound anonymous proof; browser admin login/logout/moderation and Worker admin mutations enforce same-origin requests
- Input/Output: PASS LOCAL - provider payload, bridge command, report, URL, ID, enum, and length validation have negative tests
- Dependencies: PASS LOCAL - pinned Capacitor packages; pnpm audit reports no known vulnerabilities
- Data Handling: PASS LOCAL - raw user coordinates and original photos are not stored; metadata and filenames are removed; beta KPI responses are aggregate-only; iOS packages a tracking-disabled privacy manifest; Android excludes app data from backup/device transfer and exposes no shared external-storage root through the app FileProvider
- Abuse Controls: PASS LOCAL - a fail-closed Cloudflare public API limiter runs before CORS preflight, health checks, routing, and D1; anonymous-session issuance has a distinct 3/minute hashed-IP first-line edge limiter and an exact D1-wide 5,000/day cap with a `0` kill switch before session insert; public `GET/HEAD` skips session issuance so exhaustion cannot take down nationwide place/map/photo reads, while writes and private reads lazily require proof; private place-addition requests are owner-only, capped at 3/session/day and exactly 1,600/day globally, audited, and never auto-publish; `0026` reserves conservative Workers/D1 weights, records forged-proof authentication lookup cost before D1, verifies exact admin roles before protected reservation, emits one 60% warning, degrades non-essential routes at 70%, preserves only critical privacy/emergency writes to 80%, and atomically rechecks fresh below-70% Cloudflare reconciliation before resume; authenticated `last_seen_at` writes are throttled to once per 24 hours and stale session/budget rows are pruned; streamed JSON has a 64 KiB ceiling; upload tickets require server-validated Turnstile; R2 reads use a canonical cache plus a hashed 1,000 cache-miss/IP/day ceiling; anonymous writes require an expiring, rotatable, revocable server-issued proof; and route-specific limits, duplicate suppression, votes, blocks, restrictions, moderation, circuit breaker, audited server-side reconciliation, and bounded ledger retention exist
- Tests: PASS LOCAL - 416 passed, 0 failed, 0 skipped; previous browser/API/R2/D1/realtime controls plus public-read availability after issuance-budget exhaustion, the `0020` Images transformation singleton, `0021` per-IP read ledger, `0022` idempotent storage-release ledger, `0023` anonymous session ledger, `0024` exact issuance budget, `0025` private place-request queue/session/global guards, `0026` health-ledger admission, D1 migration-registry drift blocking, forged-proof authentication-cost reservation, exact pre-reservation admin roles, atomic resume safety, owner-only status and private review-field boundaries, concurrent admin review fencing, native HEIC-to-JPEG magic-byte validation, pre-D1 anonymous-session issuance blocking, distributed-cap and missing-ledger rejection, hashed limiter keys, stale-session cleanup, 24-hour last-seen write throttling, stolen-ID/wrong-proof/rotation/revocation rejection, raw proof tail-redaction detection, concurrent delete fencing, approval-only publication outbox, Turnstile action/hostname/IP validation, provider and ledger fail-closed behavior, cache query-bypass and stop-bypass rejection, Cloudflare-IP-first Next limiter identity, User-Agent rotation resistance, bounded fail-closed Next/API Worker limiter storage with expired identity reclamation, fail-closed R2 dev-URL/custom-domain privacy evidence, allowlisted public-release URL fallback, HTML deployment revalidation, explicit external-search request prefill without pre-submit persistence, 80% re-enable refusal, malicious backend-message suppression, aggregate-only KPI authorization/parsing, native privacy/backup enforcement, and store-disclosure gate are included.
- Photo Rights: PASS LOCAL / LEGAL BLOCKED - every photo requires a controlled, accessible shooting/publishing-rights checkbox; file input and native selection remain disabled before confirmation. The Worker rejects false, missing, or stale policy versions with `PHOTO_RIGHTS_ATTESTATION_REQUIRED` before Turnstile and D1, then records one idempotent anonymous `community` acceptance. This proves the confirmation path, not ownership; named legal review and real dispute operations remain external.
- Residual Risk: BLOCKED EXTERNAL - see owner and due milestone table below
```

Security Owner: Orchestrator
Date: 2026-07-20
Release Security Decision: `blocked-external`

| Residual risk | Owner | Due milestone | Stop condition |
| --- | --- | --- | --- |
| Staging schema verifies scheduler/delivery/Images/read-abuse/storage-release/anonymous-session/place-request objects through `0025`, but Wrangler migration history for `0018`~`0025` is missing; production lacks externally verified V2 migrations | data-operations | before staging/production candidates | staging fails closed at `D1_0026_NOT_APPLIED` and `D1_MIGRATION_REGISTRY_DRIFT`; take a backup and reconcile history before any apply. The already-present `0022` keeps uploads stopped until R2/D1 reconciliation; dedicated KV bindings now exist, while `0026` and broader production-chain gaps remain blocked as `D1_0006_NOT_APPLIED` |
| Turnstile exact-host widget, public site key, and server-only secret are not provisioned | release-operator + security owner | before staging API deployment | photo upload remains unavailable because staging/production fail closed without the server-verifiable proof configuration |
| R2 activation/visibility and real photo privacy/deletion evidence are unavailable | release-operator + data-operations | before staging release candidate | user approval is recorded, but the user-only Cloudflare payment/terms activation hand-off and bucket evidence remain pending |
| API Workers and selected staging/production URLs are missing | release-operator | before staging release candidate | no live smoke or production readiness claim |
| NAVER Web Maps owner-domain restriction, usage limit/recipient, and source-by-source rights/attribution are unsigned | release-operator + legal-safety | before map/source enable | shared hosting domains are rejected; source stays disabled; map uses explicit fallback |
| Staging has applied `0023`/`0024`, but has not deployed the proof-required API or dedicated 3/minute first-line limiter; theft of the complete ID+proof pair remains a bearer replay risk | identity/security owner | before public launch | require `SILSIGAN_ANON_SESSION_REQUIRED=1`, `SILSIGAN_ANON_SESSION_DAILY_LIMIT=5000`, `ANONYMOUS_SESSION_RATE_LIMITER`, owner-domain live issue/limit/rotation/revocation/wrong-proof/stolen-ID evidence, and select member/device binding if complete-credential theft must also be resisted |
| Live moderation webhook, on-call owner, and tail-redaction evidence are missing | trust-safety lead | before staging mutation smoke | no external beta with UGC writes |
| Capacitor native settings adapter is local; signing, staging build, push delivery, and iPhone/Android QA are missing | mobile-release | before internal testing | no TestFlight/Android internal readiness claim |
| Privacy, location, UGC, account deletion, source terms, store disclosure sign-off is missing | legal-safety | before external TestFlight review | no external review submission |

Evidence:

- `artifacts/cloudflare-pages-smoke-anonymous-session-local/pages-smoke-home-1784490172577.png`
- `artifacts/cloudflare-pages-smoke-anonymous-session-local/pages-smoke-map-1784490172577.png`
- `artifacts/cloudflare-pages-smoke-anonymous-session-local/pages-smoke-place-1784490172577.png`
- `artifacts/cloudflare-pages-smoke-anonymous-session-local/pages-smoke-my-1784490172577.png`
- `artifacts/cloudflare-pages-smoke-anonymous-session-local/pages-smoke-hashtag-1784490172577.png`
- `artifacts/cloudflare-pages-smoke-anonymous-session-local/pages-smoke-1784490172577.png`
- `artifacts/cloudflare-pages-smoke-anonymous-session-local/pages-smoke-admin-cost-guard-stopped-1784490172577.png`
- `artifacts/cloudflare-pages-smoke-anonymous-session-local/pages-smoke-admin-cost-guard-running-1784490172577.png`
- `artifacts/cloudflare-pages-smoke-anonymous-session-local/pages-smoke-network-1784490172577.json`
- `artifacts/cloudflare-pages-smoke-anonymous-session-local/pages-smoke-console-1784490172577.log`
- `artifacts/security-validation-admin-cost-guard-20260719/validation_report.md`
- `artifacts/security-validation-admin-cost-guard-20260719/candidate_ledger.jsonl`
- `artifacts/security-validation-global-api-cost-guard-20260720/validation_report.md`
- `artifacts/security-validation-global-api-cost-guard-20260720/candidate_ledger.jsonl`
- `docs/v2-decision-register.md`
- `docs/v2-legal-operations-gate.md`
- `release-ledger.yaml`

## P0 출시 차단 항목

- [x] 현재 기준선에서 전체 테스트가 skip 없이 통과했고, Cloudflare API·도메인·UI·WebView·웹 보안 헤더·전역 admission limiter·health 원장 편입·위조 proof 인증비용 선예약·관리자 exact-role 선검사·재개 조건 원자 재검사·60/70/80 Workers/D1 guard·공개 조회 무세션/스냅샷 경로·발급 예산 고갈 후 공개 조회 유지·익명 세션 발급 전용 3/minute 엣지 limiter·D1 전역 5,000/day 상한·0 킬 스위치·만료 원장 정리·24시간 last-seen 쓰기 throttle·body cap·Turnstile·R2 캐시/per-IP ledger·R2/D1/Images 비용 원장·멱등 storage release·비공개 장소 요청 소유권/3건·1,600건 선차단/동시 검수 fencing·서버 결합 익명 증명 발급/회전/폐기/재사용 거부·proof 로그 탐지·approval-only outbox·server-side 재개 대조·Cloudflare IP 우선 웹 limiter·User-Agent 회전 우회 거부·Next/API Worker 각각 4,096 버킷 메모리 상한·만료 Worker identity 회수·R2 dev URL/custom domain 비공개 검증·source scheduler·cleanup/outbox·WebSocket hibernation·공개 URL allowlist fallback·임의 백엔드 오류문 비노출·HEIC JPEG 변환/magic byte·집계 전용 KPI·네이티브 개인정보/백업 계약·스토어 고지 gate 회귀 경로를 포함한다.
- [x] 현재 기준선에서 `pnpm typecheck`가 통과했다.
- [x] 현재 기준선에서 `pnpm lint`가 통과했다.
- [x] 현재 기준선에서 `pnpm build`가 통과했다.
- [x] Cloudflare Workers 배포 구성이 `workers/api/wrangler.jsonc`와 실제 Worker 코드에 반영되어 있다.
- [x] Cloudflare frontend OpenNext build 경로가 `open-next.config.ts`, pinned `@opennextjs/cloudflare`, pinned `wrangler`, `pnpm cf:build`, frontend dry-run scripts로 반영되어 있다.
- [x] Wrangler development, staging, production environment가 binding 비상속 규칙에 맞게 D1/R2/Images/KV/Durable Object binding을 각각 명시한다.
- [x] Cloudflare Pages/Worker API staging/production 공개 URL preflight가 missing, localhost, non-HTTPS, query/fragment/credential, staging/production 중복을 출시 차단으로 실패시킨다.
- [x] `docs/current-release-state.md`, `release-ledger.yaml`, `RELEASE_STATUS.md`, `pnpm release:status`가 로컬 통과 상태, open release blocker, Next Actions 중복 가드, 외부 Cloudflare 차단 상태를 분리해 보여준다.
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
- [x] Worker 공개 API 전체는 Cloudflare client IP를 SHA-256 key로 바꿔 120회/분으로 제한하고 D1 접근 전에 차단한다. Staging/production에서 필수 binding이 없으면 fail closed하며, 댓글·사진 등 route별 추가 제한과 중복 place click/like negative-path 테스트도 있다.
- [x] Next.js 전체 라우트는 `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` CSP와 `DENY`, `nosniff`, HSTS, strict-origin referrer, permissions policy를 적용한다. 카메라·위치는 self만 허용하고 마이크는 비활성화한다.
- [x] Staging web version `e87e79d5-5d30-43dc-adfe-1b5393a3b8d2`의 실제 HTTP/2 200 응답에서 위 헤더를 확인했고 `X-Powered-By` 및 public `r2.dev`/`cloudflarestorage.com` 이미지 allowlist는 제거됐다. 같은 버전의 읽기 전용 Chrome smoke도 통과했으며 증거는 `artifacts/cloudflare-pages-smoke-staging-security-20260719`에 있다. Production은 승격하지 않았다.
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
- [x] 서버 결합 익명 증명의 발급·회전·폐기, ID만 훔친 요청, 잘못된/이전/폐기 증명 거부와 tail 로그 증명값 탐지를 로컬 보안 하네스가 검증한다.

## 잔여 위험

| 항목 | 상태 | Owner | Due date |
| --- | --- | --- | --- |
| Cloudflare Pages 배포 연결 미확정 | URL preflight gate는 준비됨. 실제 `SILSIGAN_STAGING_PAGES_URL`, `SILSIGAN_PRODUCTION_PAGES_URL` 값과 브라우저 접근 증적은 무료 공개 출시 전 차단 | FullStackDev | 2026-06-21 |
| Cloudflare Pages/API deployment URL 미설정 | D1/KV resource ID는 실제 값으로 치환됨. `pnpm cf:preflight`는 현재 미설정 `SILSIGAN_*_PAGES_URL`/`SILSIGAN_*_API_BASE_URL`만 출시 차단으로 실패시킴 | FullStackDev | 2026-06-21 |
| Cloudflare R2 계정 활성화 필요 | 2026-07-20 `pnpm cf:external-state`와 `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000`가 R2를 `cloudflare.r2.enabled` / `R2_NOT_ENABLED`로 분류한다. Dashboard에서 R2 활성화 후 `pnpm cf:r2:evidence -- --env=staging --apply`로 누락 staging bucket을 생성하고, bucket visibility와 disabled `r2.dev` 및 absent direct custom-domain privacy evidence를 함께 확인해야 한다. Production 생성은 `--confirm-production`을 붙여야 한다 | FullStackDev | 2026-06-24 |
| Production D1 `0002` migration 미적용 | Staging은 `pnpm cf:d1:evidence -- --env=staging --apply --timeout-ms=120000`와 후속 `--check`로 `posts=4`, `questions=3`, pending migration 없음이 확인됐다. Production은 read-only `pnpm cf:d1:evidence -- --env=production --check --timeout-ms=120000`에서 `D1_0002_NOT_APPLIED`로 남아 있으며, production 후보 전 `--confirm-production` 적용 증적이 필요하다 | FullStackDev | 2026-06-25 |
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
- 일반 JSON body는 `Content-Length` 유무와 관계없이 스트림을 읽는 동안 64 KiB를 넘으면 `413 JSON_BODY_TOO_LARGE`로 중단하고, 잘못된 JSON은 parser 세부정보 없이 `400 INVALID_JSON`으로 반환한다. 사진 JSON은 별도 3 MiB 이미지 한도에 맞춘 bounded 경로를 사용한다.
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

- 공개 API 전체는 Cloudflare `PUBLIC_API_RATE_LIMITER`로 IP당 120회/분을 적용하고, 원본 IP 대신 SHA-256 key만 limiter에 전달한다.
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
- Worker 직접 호출에도 Q&A·social feed·hashtag·live stream·광고 feature gate가 적용된다.
- 질문권 잔액은 클라이언트 입력을 신뢰하지 않고, ledger가 없으면 질문 생성이 fail-closed 된다.
- 현재 판정 신호는 `expiresAt` 필수이며, 로컬 backfill/constraint migration `0007`이 있다.
- 현장 제보 위치 인증은 서버가 점/반경 또는 polygon/multipolygon과 정확도를 함께 판정하고, 정확도 `100m` 초과 또는 누락은 일반 제보로 전환하며, D1에는 `accuracy_bucket`과 `verification_method` 같은 coarse metadata만 저장한다(`0011`, `0012`). 브라우저/WebView mock-location attestation은 제공하지 않으므로 완전한 GPS spoofing 방어를 주장하지 않는다.
- 신규 현장 제보는 `pending`으로 시작하고 승인된 제보만 공개 목록·투표·현재 상태·랭킹에 반영한다. moderator 승인/거절·숨김은 `0013_field_report_moderation.sql`과 `admin_actions`에 기록되며 `mine=1`에서 본인 검수 상태를 확인한다.
- `0014_field_report_publications.sql`은 현장 제보에 같은 사용자·같은 장소의 활성 사진만 연결하고, 해시태그·멱등 키·outbox를 정규화 테이블에 저장한다. pending 제보의 해시태그는 공개 집계에 포함하지 않는다.
- 위치 기반 주변 정렬은 Haversine을 사용하고 raw 좌표는 analytics에 기록하지 않는다.
- placeholder 신뢰도와 만료 캠페인은 truth-bearing UI에서 노출하지 않는다.
- 익명 preference `0008`, analytics sink `0009`, photo cleanup queue `0010`이 로컬 schema/test로 검증된다.

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
- Release state 결과. 현재 로컬 기준선은 `pnpm release:status`가 `docs/current-release-state.md`, root `release-ledger.yaml`, `RELEASE_STATUS.md`의 필수 구조, source-of-truth 링크, Next Actions 중복 줄 가드를 통과한 뒤 `blocked-external`을 출력하고, blocker를 `release_harness.ledger.open_blockers`와 deployment URL 4개로 분리한다. Base D1 migration/core seed는 원격 적용됐고 `verified_places=5`, `rankings=6`으로 확인했다. Staging `0002_posts_questions.sql`과 seed는 2026-06-25 원격 적용 후 `posts=4`, `questions=3`과 pending migration 없음으로 확인했으며, production `0002`는 `D1_0002_NOT_APPLIED`로 남아 있다.
- Legacy artifact/runtime URL 결과. 현재 로컬 기준선은 `supabase/` migrations와 `vercel.json`을 제거했고, runtime share URL 기본값을 Cloudflare Pages로 전환했으며, `pnpm release:status`가 Supabase 프로젝트 산출물, Vercel 배포 설정, `@supabase/*` dependency, Vercel public runtime URL이 없음을 검사한다.
- OpenNext frontend 결과. 현재 로컬 기준선은 `open-next.config.ts`의 `defineCloudflareConfig`, pinned `@opennextjs/cloudflare@1.19.11`, pinned `wrangler@4.103.0`, `.env.example` 기반 `cf:typegen`, `cf:build`/`cf:preview`/`cf:deploy`/frontend dry-run scripts를 `pnpm release:status`에서 검사한다. `pnpm cf:typegen`은 로컬 개인 `.env.local`이 아니라 `.env.example`의 Cloudflare release key만 읽고, `pnpm cf:build`는 `.open-next/worker.js`와 `.open-next/assets`를 생성했으며, `pnpm cf:web:dry-run`, `pnpm cf:web:dry-run:staging`, `pnpm cf:web:dry-run:production`은 89개 assets와 `ASSETS` binding을 dry-run으로 검증했다.
- R2/deployment external-state 결과. `pnpm cf:external-state`는 Wrangler OAuth, R2 bucket visibility, 각 configured bucket의 disabled `r2.dev` URL과 absent direct R2 custom domain, staging/production deployment URL shape, staging/production Worker dry-run, staging/production D1 evidence를 non-mutating JSON check로 분리한다. 최신 기준선은 OAuth pass, staging/production dry-run pass, deployment URL 4개 missing fail, Staging D1 through `0025` pass 뒤 `D1_0026_NOT_APPLIED`, Production `D1_0006_NOT_APPLIED`, `cloudflare.r2.enabled` fail with `R2_NOT_ENABLED`이다. 직접 `wrangler r2 bucket list`와 `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000`도 `R2_NOT_ENABLED`로 실패하며 Dashboard에서 R2 활성화가 필요하다고 반환한다. `pnpm cf:r2:evidence` 기본 실행은 non-mutating plan-only이고, `--check`는 bucket list, `r2 bucket dev-url get`, `r2 bucket domain list`만 읽는다. `--apply`는 누락 bucket 생성 후 동일한 visibility/privacy evidence를 재확인한다. Enabled public URL/domain은 각각 `R2_PUBLIC_DEV_URL_ENABLED`/`R2_PUBLIC_CUSTOM_DOMAIN_CONFIGURED`, 알 수 없거나 실패한 privacy 응답은 `R2_DEV_URL_CHECK_FAILED`/`R2_CUSTOM_DOMAIN_CHECK_FAILED`로 fail closed한다. Production apply는 `--confirm-production` 없이는 실패한다. R2 활성화 전에는 Worker URL과 staging mutation smoke를 완료할 수 없다.
- D1 migration registry 안전성 결과. 2026-07-20 별도 read-only `pnpm cf:d1:evidence -- --env=staging --check`는 실제 schema의 첫 공백을 `D1_0026_NOT_APPLIED`로 확인하는 동시에 Wrangler가 `0018`~`0026`을 pending으로 표시하는 불일치를 `D1_MIGRATION_REGISTRY_DRIFT`로 분리했다. `--apply`는 migration list 뒤 deterministic schema query와 registry preflight를 먼저 실행하며, 둘이 일치하지 않으면 `migrations apply`를 호출하기 전에 중단한다. 적용 후에도 migration list와 schema/seed evidence를 다시 검사한다. 따라서 현재 Staging에는 backup과 migration history 복구 전 어떤 자동 apply도 금지한다.
- Durable Object realtime 결과. 현재 로컬 기준선은 place/region/global fanout과 WebSocket broadcast를 검증하며, 새 namespace는 SQLite Durable Object로 선언한다. 표준 `server.accept()` 대신 Durable Object state의 hibernation API를 사용하여 유휴 연결이 object를 메모리에 고정해 과금 시간을 계속 만들지 않도록 한다. 잘못된 형식·존재하지 않는 장소/지역 room은 namespace allocation 전에 거부하고, global room은 `global`만 허용하며, room당 동시 socket은 100개로 제한한다. 채널은 서버 발행 전용이라 client data frame을 받으면 1008로 닫아 증폭 경로를 차단한다. 발행 이벤트는 저장 전에 UTF-8 16 KiB를 초과하면 거부하고, 검증된 최근 이벤트는 room별 최대 50개만 Durable Object storage에 저장해 hibernation 뒤 새 instance에서도 polling snapshot을 복원한다. 마지막 발행 후 10분으로 재설정되는 알람이 해당 buffer를 삭제해 비활성 전국 room의 저장 데이터가 영구 누적되지 않게 한다.
- 프론트 realtime 소비 결과. 클라이언트는 먼저 HTTP snapshot을 받고 WebSocket을 우선 연결하며, 8초 연결 timeout, 1/2/4/8/16/30초 재연결 backoff, 30초 polling fallback, visibility cleanup을 적용한다. 16,384자 초과·잘못된 type/scope/room/date/payload 이벤트와 unsafe URL/credentials는 버리고, 검증된 이벤트만 중복 제거·정렬해 최대 50개로 유지한다. 로컬 390x844 smoke는 place/region/global room 조회와 사용자 흐름을 함께 통과했다.
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
- 로컬 로그/응답 redaction 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `worker generic errors do not echo secrets or raw sensitive values`, `tests/domain.test.ts`의 `analytics console events redact sensitive values`, `tests/api-client.test.ts`의 악성 백엔드 메시지 억제 통합 테스트로 Worker 응답·브라우저 analytics·클라이언트 오류 경계가 토큰, raw 좌표, 익명 ID, 원본 파일명, 이메일, 내부 저장 경로를 사용자에게 노출하지 않는지 검증한다. 오류 경계는 검증된 코드만 사용자용 문구로 변환하며 정상 응답과 비용/속도 제한 안내는 유지한다.
- 공개 장소 반경 검색 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `GET /api/places applies radius query without echoing client coordinates`와 `Cloudflare Worker reads places and rankings from D1 when DB binding is present`로 `/api/places?lat=&lng=&radius=`가 메모리 fallback과 D1 binding 모두에서 meter 거리 필터를 적용하고, 응답 meta에 원좌표를 되돌려주지 않는지 검증한다.
- Staging smoke harness 결과. `SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> pnpm smoke:staging`은 health, 장소/지도 좌표, 장소 상세/live, place/region/global realtime room, 전국/bbox 랭킹, 댓글/사진 목록, 무권한 admin 차단을 확인한다. Worker API base URL 없이 실행하면 `BASE_URL_REQUIRED`로 실패하며, tail-only 로그 검증은 base URL 없이도 독립 실행된다. `SILSIGAN_STAGING_MUTATION=1`을 추가하면 실제 R2/Cloudflare Images 사진 완료, 공개 사진 최소 필드와 `previewUrl` 노출, `previewUrl` 파일 200/image bytes 반환, 삭제/공개 목록 제외, 댓글 생성/작성자 삭제/공개 목록 제외, 장소 좋아요/취소를 확인한다. 같은 실행에 `SILSIGAN_STAGING_ADMIN_TOKEN`을 제공하면 장소 신고 생성, 운영자 open 큐 조회, rejected 처리, open 큐 정리, 전용 익명 사용자 임시 제한/차단 확인/해제/댓글 정리까지 확인한다. 최종 release evidence에서는 `--require-admin`을 같이 사용해 운영자 토큰 누락 시 admin moderation/user restriction smoke가 skip이 아니라 `ADMIN_TOKEN_REQUIRED`로 실패하게 한다. 좌표 상태 smoke는 `--coordinate-status` 또는 `SILSIGAN_STAGING_COORDINATE_STATUS_SMOKE=1`과 대상 장소/좌표를 명시한 경우에만 verified 운영 경로와 공개 상세 노출을 확인한다.
- Pages browser smoke harness 결과. `SILSIGAN_STAGING_PAGES_URL=https://<staging-pages> SILSIGAN_STAGING_API_BASE_URL=https://<staging-worker> pnpm smoke:pages`는 headless Chrome CDP로 지도 surface·컨트롤·내비게이션·랭킹·장소 상세·Worker API/realtime 경로를 검증한다. 명시적인 mutation/report/share 플래그가 있을 때만 좋아요·댓글·사진·신고·공유 흐름을 실행한다. `--account-deletion`은 `--mutating`이 있고 Pages와 API가 모두 loopback인 경우에만 허용되어 로컬 프록시가 원격 API를 지우는 구성까지 실패 폐쇄한다. 현재 로컬 기준선은 2026-07-20 실제 경로 실행이 명시적 장소 선택, 사진별 촬영·게시 권한 확인 클릭 후 파일 입력 활성화, 사진 제보, 승인된 place/report 공유 링크의 정확한 카드 스크롤·초점, 해시태그 사진, Worker-backed 팔로우, 마이 복귀, cursor 다음 페이지 병합, mocked NAVER 검색 결과의 명시적 선택으로 이름/주소/카테고리만 비공개 장소 검토 폼에 옮기고 제출 전 place-request POST가 없음을 확인한 뒤 장소 요청 생성/소유자 상태를 검증했다. 또한 정확한 확인 문구 전 영구 삭제 비활성화, 삭제 1회, 잔존 mock-owned content 0건, 익명 세션 2회 발급과 rotation, 삭제 전 proof의 보호 API 403 거부를 확인하고, 동일 출처 JSON 관리자 로그인, 사용자 원문 없는 7일 KPI, 5개 사진 비용 계기와 3개 전역 API 비용 계기, 사진 업로드·읽기 동시 중단과 감사된 재개, 전역 API 중단·fresh Cloudflare 대조·below-70% 재개까지 실제 요청으로 확인했다. 최신 증적은 `artifacts/cloudflare-pages-smoke-worker-report-local`의 timestamp `1784510945721` 파일들이다. 관리자 토큰과 익명 ID/proof는 artifact에 저장되지 않는다. 최신 요약은 `eventCount=614`, `reportTargetTypes=comment/photo/place`, `storesPostData=false`, `sensitiveHits=[]`, `passedRequiredChecks=58`, `failedChecks=[]`이다. 이 증거는 local mock-only이며 staging-live/native 증거를 대체하지 않는다.
- 공유 카드/OG lookup 결과. 현재 로컬 기준선은 `tests/domain.test.ts`의 `shared post lookup reads from Worker API when configured`, `shared post lookup does not fall back to demo posts when Worker API is configured`, `shared post lookup keeps demo fallback only when Worker API is not configured`, `shared post lookup does not expose hidden demo posts`와 `pnpm smoke:pages:local-report -- --timeout-ms=60000`의 `share.postPage`/`share.opengraphImage`/`sharedPostRequestCount=2`/`hiddenPostRequestCount=0`로 `/share/post/[postId]`와 `/share/post/[postId]/opengraph-image`가 Worker API URL이 있을 때 공개 `/api/posts?limit=200` 조회만 사용하고, 숨김 게시물 포함 조회를 시도하지 않으며, Worker 응답에 대상 글이 없거나 실패하면 로컬 demo post로 위장하지 않고, Worker URL이 없는 local/demo 환경에서도 숨김 게시물을 공유 페이지에 노출하지 않는지 검증한다.
- 2026-07-14 share contract hardening. The current Worker path is `/api/share/posts/:postId`; it returns the post together with the current V2 aggregated place status, uses `현재 정보 부족` when no approved current evidence exists, and labels the individual crowd/parking/line values as `제보 내용`. The neutral share card no longer derives a visit decision from one post, and the configured Worker lookup fails closed instead of falling back to a demo post.
- Release gate orchestrator 결과. `pnpm release:gate`는 로컬 검증, optional local Pages report baseline, optional Workers tail redaction, strict release status, critical audit, `.env.example` 기반 Cloudflare typegen, OpenNext frontend build, frontend Wrangler dry-run, Cloudflare URL/resource preflight, staging/production D1/R2 read-only evidence, Cloudflare external-state check, API staging/production Wrangler dry-run, staging Worker smoke, Pages browser smoke를 순차 실행한다. 기본 development Worker dry-run은 root Worker config의 local placeholder D1/KV ID 때문에 release evidence에서 제외한다. `--local-pages-report`는 local mock Worker + Next dev + headless Chrome으로 장소/댓글/사진 신고 browser baseline을 strict external staging checks 전에 실행하고, network redaction뿐 아니라 `map.controlsUncovered`와 `onboarding.dismiss`를 포함한 필수 smoke check integrity도 검증하지만 staging Pages/Worker 증적을 대체하지 않는다. Plan JSON은 `staging.api.smoke`에 `SILSIGAN_STAGING_API_BASE_URL`, `pages.browser.smoke`에 `SILSIGAN_STAGING_PAGES_URL`과 `SILSIGAN_STAGING_API_BASE_URL`을 `envKeys`로 노출해 URL 준비 상태를 smoke 실패 전부터 확인할 수 있게 한다. `--collect-blockers`는 non-mutating 진단 모드에서 첫 실패 후에도 strict status, URL preflight, dedicated D1/R2 evidence, external-state, read-only smoke를 계속 실행해 open release ledger blocker, missing URL, `cloudflare.r2.enabled`, staging API base URL, Pages URL, production D1 migration blocker를 한 번에 드러내며, 출력 상단의 `resultCounts`, `failedSteps`, 중첩 JSON에서 추출한 `blockers`로 실패 단계와 실제 blocker 코드를 요약한다. Known alias는 canonical blocker로 정규화해 `BASE_URL_REQUIRED`/`PAGES_URL_REQUIRED`/preflight URL 이름은 `deployment_url.*`으로, `cloudflare.r2.enabled`는 `R2_NOT_ENABLED`로 합친다. `--release-candidate`는 최종 staging 후보 증거용으로 HTTPS staging Pages/API URL을 실행 전에 요구하고, `--mutating`, `--browser-report`, `--require-photo`, `--tail-required`를 함께 켜며, Worker 쓰기/정리 smoke와 Pages 좋아요/댓글/사진 클릭/신고 smoke 및 captured Workers tail redaction을 빠뜨리지 않게 한다. `--production-candidate`는 HTTPS production Pages/API URL을 실행 전에 요구하고 production API/Pages read-only smoke를 추가하지만 staging 쓰기, browser report, photo, tail 필수 플래그를 자동으로 켜지 않는다. `SILSIGAN_STAGING_ADMIN_TOKEN`이 없으면 실행 전에 실패시켜 admin moderation/user restriction smoke가 조용히 skip되지 않게 한다. `--collect-blockers`는 실제 쓰기 smoke와 함께 사용할 수 없다. `--coordinate-status`는 admin token, 대상 place id, latitude, longitude가 없으면 실행 전에 실패시킨다. `--browser-report`는 실제 신고 생성을 포함하므로 운영 영향이 괜찮을 때만 사용한다. `--tail-required --tail-file=...`는 captured Workers tail redaction을 출시 필수 gate로 묶으며, tail 파일이 지정된 경우 strict URL/resource checks보다 먼저 검증해 누락/민감값 로그가 외부 URL blocker 뒤에 숨지 않게 한다. `pnpm cf:d1:evidence`는 D1 전용 operator surface다. 기본 `--env=staging` 실행은 non-mutating plan-only이고, `--check`는 `wrangler d1 migrations list`와 posts/questions evidence query만 실행한다. `--apply`는 한 번에 하나의 env만 허용하며 migrations apply, idempotent seed apply, evidence query를 순서대로 실행하고, production apply는 `--confirm-production` 없이는 실패한다. `pnpm cf:r2:evidence`는 R2 전용 operator surface다. 기본 `--env=staging` 실행은 non-mutating plan-only이고, `--check`는 configured bucket visibility와 각 bucket의 `r2.dev` 및 direct custom-domain privacy state만 읽으며, `--apply`는 list 결과에서 누락된 bucket만 생성한 뒤 같은 visibility/privacy 검증을 재실행한다. Privacy state가 공개 또는 불명확하면 fail closed하고, production apply는 `--confirm-production` 없이는 실패한다. 현재 로컬 기준선은 `pnpm release:gate -- --skip-verify --skip-dry-run --collect-blockers --tail-file=tests/fixtures/redacted-worker-tail.log --timeout-ms=120000`가 tail redaction, critical audit, typegen, OpenNext build, frontend development/staging/production dry-runs를 통과한 뒤 예상대로 `release.status.strict`, `cloudflare.preflight`, `cloudflare.r2Evidence.*`, production `cloudflare.d1Evidence`, `cloudflare.externalState`, `staging.api.smoke`, `pages.browser.smoke`에서 실패하는 상태다. Top-level blocker summary는 `release_harness.ledger.open_blockers`, staging/production Pages/API deployment URL 4개, `R2_NOT_ENABLED`, staging/production pending migration codes로 수렴한다. 출력은 token/secret 값을 싣지 않는다.
- D1 operator 순서 보강. 위 release gate 설명의 D1 적용 단계는 이제 무조건 registry/schema preflight 뒤에만 도달한다. 정상 apply 계획은 migration list → pre-apply schema/registry 일치 확인 → migrations apply → idempotent seed → post-apply migration list → 최종 schema/seed 및 registry 확인 순서다. Release gate blocker 수집기는 중첩 `results[].check`도 재귀적으로 읽어 generic step 이름 대신 `D1_0026_NOT_APPLIED`와 `D1_MIGRATION_REGISTRY_DRIFT` 같은 실제 코드를 요약한다.
- Workers captured log redaction 결과. `SILSIGAN_STAGING_TAIL_LOG_FILE=artifacts/cloudflare-tail/staging-tail.log pnpm smoke:tail-redaction`으로 raw token, 익명 session proof, coordinate, 익명 ID, 원본 파일명 패턴이 없는지 확인한다. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `Cloudflare tail redaction smoke accepts redacted captured logs`, `Cloudflare tail redaction smoke rejects raw secrets coordinates anonymous ids and filenames`로 안전 로그 통과와 raw token/proof/coordinate/anon ID/email/original filename 실패 경로를 모두 검증한다.
- `pnpm audit --audit-level critical`은 통과했다. `pnpm audit --json` 기준 low/moderate/high/critical 0이며, transitive audit advisory는 `ws@8.21.0`, `js-yaml@4.2.0`, `@babel/core@7.29.6` override로 해소했다.
- R2 EXIF/GPS 제거 전/후 샘플 검증 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `photo complete strips GPS EXIF sample before writing to R2`로 JPEG APP1 EXIF 샘플에서 `Exif`, `GPSLatitude`, `Camera`, `DateTime` metadata가 R2 저장 바이트에 남지 않는지 검증한다.
- 서버 픽셀 재인코딩 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `photo complete reencodes pixels with Cloudflare Images binding before writing to R2`로 metadata-strip된 바이트가 `IMAGES` binding에 입력되고, transform/output 옵션이 적용되며, R2에는 `serverPixelReencoded=true`와 `cloudflare-images-reencoded` 처리 결과가 저장되는지 검증한다.
- 브라우저 사진 업로드 smoke. 현재 로컬 기준선은 모바일 viewport에서 `PhotoUploader`의 권한 확인을 실제 클릭하고 비활성 파일 입력이 활성화되는지, 현재 정책 버전과 `rightsAttested=true`가 Worker `/api/photos/upload-ticket`에서 검증되는지, 브라우저 캔버스 재인코딩, multipart `/api/photos/upload` 201, D1 pending/ready 사진 상태, 상세 시트 사진 표시를 확인한다. `/api/photos/upload-url`과 `/api/photos/complete`는 legacy 호환 회귀 경로로만 남아 있으며, staging에서 새 binary 경로를 먼저 검증하고 legacy 접근 로그가 0건인 뒤 폐기 여부를 승인한다.
- Worker 사진 미리보기 read proxy 결과. 현재 로컬 기준선은 `tests/cloudflare-api.test.ts`의 `photo complete strips GPS EXIF sample before writing to R2`에서 R2 fake binding에 저장된 정화 이미지가 `GET /api/photos/:photoId/file`로 같은 bytes/content-type을 반환하고, public photo list가 Worker origin `previewUrl`을 제공하며 `anonymousUserId`/`storageKey`/`deletedAt`/`imageHash`/원본 파일명을 포함하지 않는지 검증한다.
- R2/Images 공격·비용 방어 결과. Turnstile proof는 upload-ticket 전에 action/hostname/IP를 server-side 검증하고 provider 장애·불일치를 D1/Images/R2 전에 실패 폐쇄한다. Forged/replayed tickets, edge upload/read limits, HMAC per-IP daily upload budgets, 1,000 cache-miss/IP/day read ledger, query-insensitive canonical cache, stop/hide/delete 전 cache 권한 재검사, global storage/write/transform/read ledgers, audited admin stop, server-side 80% 재개 거부, redacted webhook, 2일 보안 원장 retention 테스트가 통과한다. `0020_photo_transform_budget.sql`은 Images 호출을 원자 예약하고, `0021_photo_read_abuse_budget.sql`은 한 공격자가 전역 Class B 예산을 독점하기 전에 차단한다. `0022_photo_storage_release_ledger.sql`은 동일 storage key의 동시·재시도 삭제가 active bytes를 중복 차감하지 못하게 하고, 이전 원장을 보수적으로 재계산한 뒤 운영자 대조 전 업로드를 중단한다. Distributed reads는 `R2.get` 전 800,000 monthly 또는 16,000 daily global threshold에서도 중단된다. Missing bindings, Turnstile/HMAC secrets, or any D1 guard fail closed.
- Workers/D1 전역 공격 방어 결과. `0026_global_api_cost_guard.sql`은 인증 전 공개 조회와 인증 후 쓰기를 분리해 보수적 route weight를 원자 예약한다. Health 요청도 edge limiter와 원장을 통과하고, format-valid 위조 anonymous proof는 D1 조회 전에 작은 인증비용을 예약하며, 성공 요청은 이미 예약한 인증비용을 차감해 중복 집계하지 않는다. 관리자 경로는 해당 endpoint의 exact minimum role을 통과한 뒤에만 보호 capacity를 예약하고, 알 수 없는 `/api/admin/*`는 admin으로 실패 폐쇄한다. 60% 경고는 UTC day 원장에서 한 번만 claim되며 IP·세션·요청 본문을 포함하지 않는다. 70% 이후 비필수 경로는 차단되고 핵심 전국 조회는 D1 없는 snapshot으로 전환되며, 80% reserve는 개인정보 삭제·운영자 비상 제어에만 허용된다. 재개는 15분 이내 Cloudflare 관측치와 70% 미만 상태를 요구하며 이 조건을 control update와 같은 D1 transaction에서 다시 검사한다. 전용 `COST_GUARD_STATE` KV는 ranking `CACHE`와 분리해 staging/production에 생성·바인딩됐다. 다만 Worker에 도달한 요청은 코드 실행 전에 Workers 사용량에 집계되므로, WAF/rate-limit 규칙·정적 자산 우회 라우팅을 실제 계정에서 검증하기 전에는 Workers 80% hard cap을 완료로 보지 않는다. Focused validation은 `artifacts/security-validation-global-api-cost-guard-20260720/validation_report.md`에 있다.
- Worker 고갈 비상 디렉터리 결과. `/silsigan/snapshots/nationwide-places.v1.json`은 core seed 중 `coordinate_status=verified`인 5곳만 포함하고 score/report/photo/observedAt/user 식별자를 포함하지 않는다. Client parser는 exact top-level/place key, schema/truth policy, unique safe ID, 국내 좌표 범위, verified 좌표, 최대 500개와 256 KiB 응답 상한을 검사한다. API failure 뒤에는 모든 truth-bearing state와 개인 응답을 지우고 `directory` mode로 전환하며 analytics transport, 30초 refresh, map-bounds/search 재조회, place status, realtime socket/polling, NAVER SDK, NAVER external search, report/comment/like/photo write를 중단한다. 2026-07-20 최신 로컬 Chrome 503 하네스는 기본 장소 5곳과 정적 asset 1회 요청을 확인했고, 초기 API 요청 2건 뒤 post-fallback API/NAVER provider/analytics 요청이 모두 0건이며 network artifact가 request body를 저장하지 않음을 검증했다. 증거는 `artifacts/static-directory-failover/static-directory-failover-1784507359630.png`와 `static-directory-failover-network-1784507359630.json`이다. Matching static assets가 Worker를 먼저 실행하지 않는 로컬 Wrangler 계약과 negative tests는 통과했지만 실제 staging/production invocation-free/WAF 증거는 아직 release blocker다.
- Field-report publication 결과. Pending 제보는 live event, live signal, place aggregate, 공개 해시태그에 들어가지 않는다. 승인 트랜잭션이 공개 상태·signal·aggregate·publication·audit·deterministic outbox를 함께 기록하고, outbox consumer가 전송 직전에 승인 상태를 다시 확인하므로 승인 전 실시간 노출과 재시도 중복을 차단한다.
- 공식 source 자동 수집 방어 결과. `0018_source_ingestion_scheduler.sql`은 target을 기본 비활성으로 만들고 adapter JSON의 일반적인 secret key를 거부한다. Worker Cron은 KMA·전국 교통·서울 adapter만 허용하고, 한 번에 10개, 4분 lease, conditional claim과 completion fencing, source interval 하한, 개별 실패 격리와 최대 6시간 backoff를 적용한다. `0019_background_job_delivery.sql`은 사진 cleanup과 publication outbox를 별도 lease/fencing, 제한 재시도, dead letter, 정확한 storage byte release로 처리한다. Staging·production Cron은 내부 소비자를 실행하지만 외부 source 수집은 production에서 환경 플래그로 차단된다. Staging D1은 두 migration을 적용했고 최신 read-only classifier가 zero unsafe active target을 검증한다. Rights/credential/health/quota 승인 전 source를 활성화하지 않는다. 운영 절차는 `docs/source-ingestion-scheduler-runbook.md`다.
- 네이버 지도 fallback smoke. 현재 로컬 기준선은 네이버 외부 style/tile/auth resource 실패 시 `naver-map--fallback`이 `실시간 지도 표시 중`으로 전환되고, `광안리해수욕장 상세 열기` 등 마커 버튼이 접근성 트리에 남는지 Playwright로 확인했다. 인증 401 이후 SDK ready 상태에서도 빈 지도 프레임을 유지하지 않고 fallback을 보여주며, SDK cleanup 예외가 앱을 크래시시키지 않고 fallback 지도와 버튼 클릭 흐름을 유지하는지도 확인했다.
- 지도/버튼 smoke. 현재 로컬 기준선은 in-app Browser 390px 모바일 viewport에서 fallback 지도 표시, live Naver tile/marker 표시, `광안리해수욕장` 마커 클릭과 상세 시트 표시, `서울` 빈 지역의 `표시할 장소 없음` 지도 프레임 유지, `필터`/`교통`/`이 지역 다시 검색`/지역 탭/하단 `홈`/`지도`/`제보` 버튼 상태 전환을 확인했다. 2026-06-25 수정 후 낮은 데스크톱 viewport와 모바일 viewport에서 `교통`, `이 지역 다시 검색`, `현재 위치`는 하단 네비 위에 완전히 노출되고 실제 hit-test 가능한 좌표를 가지며, 하단 네비는 불투명 배경으로 뒤쪽 랭킹 버튼을 비쳐 보이게 하지 않는다. 첫 방문 안내는 `바로 둘러보기` 실제 클릭으로 닫히며, fallback 지도 상태 배너는 마커 클릭을 가로채지 않는다. 모바일 필수 지도 컨트롤은 하단 네비 뒤로 들어가지 않으며, Next dev indicator는 로컬 QA에서 하단 네비를 가리지 않도록 비활성화했다. Cloudflare API base 설정 시 Worker 사진은 전역 `/api/photos?limit=...`가 아니라 장소별 `/api/photos?placeId=...&limit=...`로 조회한다.
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

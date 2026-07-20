# 실시간 V2 GitHub 재감사 및 잔여 개발계획서

작성 기준일: 2026-07-14  
대상 저장소: `dudqks0319-cpu/silsigan-place-sns`  
검토 브랜치: `codex/silsigan-progress-20260710`  
원격 기준 커밋: `744d3032760cf67a25bf1a70f90edf1530437800`
코드 기준 커밋: `744d3032760cf67a25bf1a70f90edf1530437800`

2026-07-20 전국 출시·마케팅·디자인 보완 계획: `docs/market-design-nationwide-plan-2026-07-20.md`  
전국 검색·지도·제보 기능은 지역 제한 없이 유지하고, Tier A/B는 기능 제한이 아니라 초기 fresh evidence 공급과 운영 집중 우선순위로만 사용합니다.

## 1. 판정

현재 상태는 **로컬 V2 릴리스 후보 + 원격 Cloudflare 운영 차단**입니다.

- `[x]`: 현재 작업 트리에서 코드·문서·테스트로 확인
- `[~]`: 로컬 구현은 있으나 원격·실기기·운영 증거 필요
- `[ ]`: 아직 구현 또는 검증하지 않음
- `[!]`: 출시 차단

중요: 최신 migration과 release-evidence gate는 현재 작업 트리에 있습니다. 수정된 읽기 전용 경계 검사는 다중 SQL 오류 순서 결함을 제거했습니다. Backup-gated recovery는 0행 구형 source table을 archive한 뒤 정상 Wrangler migration `0018`~`0026`을 적용했고, 최신 후속 검증은 pending 0건, migration registry 일치, core seed 증거, 검증 writes 0을 확인했습니다.

Production 승격은 금지합니다.

## 2. 계획 대조

| Milestone | 상태 | 근거와 남은 일 |
| --- | --- | --- |
| M0 저장소 감사 | `[x]` | Cloudflare Worker/D1/R2/Images, 환경변수, release gate, 지도 fallback 문서화. 현재 커밋 대상 테스트 수는 422/422, skip 0입니다. |
| M1 도메인·DB | `[~]` | 사진 비용 보호, 서버 결합 익명 증명·정확한 발급 예산, 비공개 장소 요청, Workers/D1 전역 비용 원장을 포함한 로컬 chain `0004~0026` 완료. Staging 스키마·registry·core seed through `0026`은 원격 읽기 전용 검증을 통과했고, post-`0022` live R2/D1 reconciliation 및 production 적용은 별도 승인 대기입니다. |
| M2 전국 기본 데이터 | `[~]` | KMA, TourAPI, 전국 주차장, ITS 교통·CCTV adapter와 gateway는 로컬 완료. KMA·교통·서울용 bounded scheduler도 로컬 완료했지만 대상은 0개이고 production 외부 source 수집 플래그는 비활성입니다. 내부 cleanup/outbox Cron은 staging·production 모두 5분 주기로 구성됩니다. `[!]` 실제 key·권리 승인·ingestion·health·fallback 증거 필요. |
| M3 WebView UI | `[x]` | 방문 판단 중심 홈, Apple형 중립/블루 UI, 지도 fallback, 검색·필터·재검색·지역탭, 출처/관측시각/unknown 상태, 360/390/430px overflow 검증 완료. 실제 staging 지도 origin은 미완료. |
| M4 현장 제보 | `[~]` | 선택형 dimension, 서버 반경/polygon 검증, coarse accuracy, TTL, pending→approve/reject/hidden, mine 상태, 공개 집계 제외가 로컬 완료. `[!]` staging D1 등록→검수→조회→만료 E2E 필요. |
| M5 안전·관리자 | `[~]` | API role gate, audit action, 신고/차단/삭제/사진 moderation 구조와 field-report moderator API·Next 관리자 검수 화면이 로컬 완료. `[!]` 실제 계정·webhook·SLA·on-call 증거 필요. |
| M6 집중 베타 | `[~]` | 7/30일 집계 전용 KPI API, aggregate/Tier A/Tier B fresh-coverage 분리, Tier A 70% 출시 기준, 관리자 판단 패널은 로컬 완료했습니다. Tier A/B는 전국 기능 제한이 아니라 공급·운영 우선순위입니다. 실제 운영자·테스트 사용자·beta 데이터 수집·판정은 시작되지 않았습니다. |
| M7 서울·라이브 | `[~]` | 서울 실시간 도시데이터 adapter와 계약 테스트는 로컬 완료했지만 `SEOUL_REALTIME_ENABLED=false`, source rights/health는 미승인입니다. rights-approved live stream registry/health와 운영 검증은 남았습니다. |
| M8 광고·스토어 | `[~]` | 광고 기본 비활성화, 집계 전용 beta KPI, iOS PrivacyInfo, Android 백업 차단, App Privacy·Data Safety 제출 초안과 자동 문서 gate는 로컬 완료. 실제 콘솔 입력·아카이브 privacy report·named legal review·스토어 심사는 미완료. |
| M9 Expo/네이티브 | `[~]` | 공유 contract와 WebView/mobile shell, Capacitor iOS/Android 프로젝트 골격, 권한 메타데이터, `SilsiganShell.openSettings` adapter는 로컬 반영. 실제 staging URL 주입, Android lint/debug APK, iOS Simulator Debug build/install/launch까지 통과했으며 release signing·push delivery·실기기 QA는 미완료. |

## 3. 이번 재감사에서 확인·보강한 P0

### 로컬에서 닫힌 항목

- `[x]` Q&A, rewards, social feed, hashtags, live streams, ads API의 서버 feature gate
- `[x]` 질문 생성 요청의 client-owned `availableCredits` 무시 및 credit ledger 준비 전 fail-closed
- `[x]` `LiveSignal.expiresAt` 서버 계산·필수화 및 만료/누락 신호 제외
- `[x]` 서버 소유 위치 반경·polygon/multipolygon 검증과 coarse accuracy 저장
- `[x]` 신규 현장 제보 `pending` 시작, 승인 전 public list/vote/live status/ranking 제외
- `[x]` moderator 승인·거절·숨김 API, `mine=1` 상태 조회, `admin_actions` 기록
- `[x]` `0013_field_report_moderation.sql`과 SQLite migration chain 테스트
- `[x]` 원격 D1 evidence query가 `0013`의 `moderation_status NOT NULL`까지 검사하도록 보강
- `[x]` `0014_field_report_publications.sql`과 사진·해시태그·멱등 키·outbox의 원자적 D1 발행 경로 및 승인 전 해시태그 비공개 테스트
- `[x]` 원격 D1 evidence query가 `0014`의 통합 발행 테이블 5개까지 검사하도록 보강
- `[x]` `0015_photo_storage_budget.sql`, 4 GiB active bytes/16,000 monthly writes conservative hard ceiling, 80% automatic stop, pre-R2 atomic reservation, deletion byte release, fail-closed missing-ledger 테스트
- `[x]` 커밋 대상 422/422 테스트, skip 0. lint, typecheck, production/OpenNext build, staging/production frontend/API Worker dry-run, WebView check, mobile 4/4, Android JDK 21 lint/debug APK 검증을 최종 로컬 gate에서 함께 유지
- `[x]` release blocker YAML을 필수 필드·허용 상태·중복 ID 기준으로 fail-closed 파싱하고, 후보 SHA/브랜치와 artifact SHA-256을 결합하는 `release:evidence:prepare` 하네스 추가
- `[x]` 일반 `올리기`는 장소 선택 전 발행 화면을 열지 않고, 사용자가 검색·지도·후보에서 명시적으로 고른 장소만 제보 대상으로 사용하도록 분리
- `[x]` aggregate/Tier A/Tier B fresh-coverage KPI와 Tier A 70% 기준을 구현하되 전국 검색·지도·제보 기능은 모든 지역에 동일하게 유지
- `[x]` operator 전용 7/30일 beta KPI API와 same-origin 관리자 패널, actor/event 원문 비노출, 엄격한 응답 파싱, 제보 완료시간·지도 성공률·D1/D7·fresh coverage·검수 SLA·웹 runtime 신뢰도 집계
- `[x]` `0020_photo_transform_budget.sql`, 5,000 monthly Images compiled cap, 4,000 automatic stop, pre-binding atomic reservation, missing-ledger fail-closed evidence
- `[x]` `0021_photo_read_abuse_budget.sql`, HMAC per-IP 1,000 daily cache-miss ceiling, canonical query-insensitive Worker cache, stop/hide/delete cache-bypass rejection, missing-ledger fail-closed evidence
- `[x]` `0022_photo_storage_release_ledger.sql`, storage-key 단위 멱등 release, concurrent/retried delete fencing, 보수적 reconciliation 및 적용 직후 업로드 fail-closed evidence
- `[x]` `0023_anonymous_session_proofs.sql`, 별도 256-bit proof의 hash-only 저장, 만료·회전·폐기, ID-only 탈취·잘못된/이전/폐기 증명 거부, raw proof tail redaction evidence
- `[x]` `0024_anonymous_session_cost_guard.sql`, D1 전역 5,000/day 원자적 상한, `0` 킬 스위치, 원장 누락 시 insert 전 실패 폐쇄, 만료·오래된 폐기 세션/예산 정리
- `[x]` `0025_place_addition_requests.sql`, 외부 검색 비저장, owner-only 수동 요청/상태, 세션당 3/day와 전역 1,600/day 원자적 선차단, audit된 관리자 분류, 자동 장소 생성 금지
- `[x]` `0026_global_api_cost_guard.sql`, Workers/D1 보수적 예약·Cloudflare 관측치 대조, health 원장 편입, forged-proof 인증비용 선예약, exact admin-role 선검사, 원자적 재개 안전성, 60% 1회 경고, 70% 비필수 제한, 80% 중단, 핵심 조회 snapshot, 관리자 즉시 중단·대조·재개
- `[x]` upload-ticket 전 Turnstile server validation(action/hostname/IP), provider 장애 fail-closed, public site-key-only runtime config, secret 비노출
- `[x]` whole-R2 재개 시 server-side reconciliation acknowledgement와 current 80% counter 재검증, 2일 보안원장 retention cleanup
- `[x]` `0018_source_ingestion_scheduler.sql`, disabled-by-default target, bounded lease/fencing, source별 실패 격리·backoff, KMA 안전 관측시각, secret 거부, aggregate-only 로그와 운영 runbook
- `[x]` `0019_background_job_delivery.sql`, photo cleanup/publication outbox lease fencing, bounded retry/dead letter, 정확한 storage byte release, staging·production 내부 consumer Cron과 production 외부 source 수집 차단
- `[x]` SQLite Durable Object, WebSocket hibernation, 유효 room 사전검증, room당 socket 100개 제한, client frame 1008 종료, 이벤트 16 KiB 상한, room별 최근 이벤트 50개 영속화·마지막 발행 10분 후 자동 삭제, WebSocket-first/검증된 event/30초 polling fallback
- `[x]` 전 라우트 anti-clickjacking/no-sniff/HSTS/referrer/permissions/restricted-CSP 웹 보안 헤더, `X-Powered-By` 및 public R2 image host allowlist 제거, production route-manifest 검증, staging version `e87e79d5-5d30-43dc-adfe-1b5393a3b8d2` 실제 응답 확인
- `[x]` 원격 D1 evidence가 `0018` scheduler table·두 index·target counter·unsafe active target 0과 `0019` cleanup/outbox lease columns·delivery indexes·dead letter 0을 요구하고, 실제 staging pending 상태를 실패 폐쇄함
- `[x]` 서울시 실시간 도시데이터 응답을 `crowd` LiveSignal로 정규화하는 adapter와 관측시각·TTL·추정값·미지 혼잡도 거부 계약 테스트
- `[x]` Capacitor iOS/Android 프로젝트 골격과 `kr.silsigan.mobile` 권한/cleartext 보안 메타데이터를 로컬 생성·반영하고 `SilsiganShell.openSettings`를 양 플랫폼에 등록

### GitHub 반영 완료

- `[x]` 맥북과 맥미니의 선별 통합 내용을 `744d3032760cf67a25bf1a70f90edf1530437800`으로 commit/push했습니다.
- `[x]` 커밋 대상 변경 파일, secret scan, branch diff, pre-push 검사를 통과했습니다.
- `[x]` GitHub 원격 SHA가 로컬 통합 SHA와 일치함을 확인했습니다. GitHub Actions는 외부 대기 상태이므로 CI 통과로 표시하지 않습니다.

## 4. 남은 P0/P1

### P0 — 출시 차단

- `[x]` staging D1은 corrected boundary through `0026`, Wrangler pending 0건, registry 일치, core seed·unsafe active target 0 증거를 통과함
- `[~]` staging D1 pre-change backup과 global API guard tables/control/index 증거는 완료. R2 활성화 후 post-`0022` live R2/D1 reconciliation 및 upload resume audit 확인 필요
- `[x]` ranking cache와 분리된 staging/production `COST_GUARD_STATE` KV를 실제 Cloudflare 계정에 생성하고 환경별 binding 확인
- `[!]` WAF/rate-limit, static asset Worker bypass를 실제 Cloudflare 요청에서 검증
- `[!]` production D1의 V2 chain 적용 및 원격 row/schema 증거는 별도 승인 후 진행
- `[!]` Cloudflare R2 subscription, bucket, private/public object, 삭제 증거
- `[!]` staging API Worker 배포, Pages/API HTTPS URL, `/api/health`, `/api/places`, `dataMode=live`
- `[!]` 실제 공공데이터 key·권리·attribution·ingestion·source health
- `[!]` NAVER Web Maps용 소유 custom domain, 대표 도메인 등록, 이용 한도·알림 대상, staging/production valid-origin/invalid-origin 증거
- `[!]` 실제 moderator/operator/admin 계정, field-report 큐 처리, webhook, audit/tail 증거
- `[x]` OpenJDK 21과 Android SDK로 `:app:lintDebug`, `:app:assembleDebug` 통과 및 로컬 debug APK 생성
- `[x]` Capacitor iOS/Android 실제 staging URL 주입, Android debug build, iOS Simulator Debug build/install/launch
- `[!]` Capacitor iOS/Android release signing, push delivery와 실기기 QA
- `[!]` 개인정보·위치·UGC·계정삭제·공공데이터 약관의 named legal/operations sign-off

### P1 — 베타 전 해결

- `[x]` field-report 전용 관리자 Next 화면과 승인/거절/숨김 결과 표시가 로컬 Worker proxy와 함께 연결됨
- `[~]` production analytics sink·redaction과 집계 전용 KPI dashboard는 로컬 완료; 실제 배포 sink, beta 데이터, native crash-free evidence 필요
- `[~]` 저장/팔로우/notification D1 contract는 로컬 완료; push provider와 실제 전달 필요
- `[~]` binary upload-ticket와 cleanup path는 로컬 완료; 실제 R2에서 승인 전 공개 0·원본 공개 0·삭제 후 404 증거 필요
- `[x]` legacy `/api/photos/upload-url`, `/api/photos/complete`는 즉시 제거하지 않고 `Deprecation`, successor `Link`, 계약 식별 헤더를 반환하도록 결정·구현함
- `[~]` legacy 경로 staging 접근 로그 0건 확인 후 폐기 여부를 운영 승인해야 함
- `[~]` 서울시 실시간 도시데이터 adapter·gateway·health 계약은 로컬 완료. 실제 ServiceKey, rights 승인, source health, ingestion, stale/insufficient 운영 증거는 남음
- `[~]` 공공 source 6종 로컬 fixture 하네스가 `network`→`fresh`→bounded `stale/degraded`→만료 후 `insufficient`와 민감정보 0건을 증명함. 실제 권리·credential·quota·staging health/ingestion 증거는 남음
- `[~]` 로컬 브라우저 하네스는 NAVER 키가 없거나 연결이 불안정할 때 사용자 안전 fallback, 숨겨진 진단 코드, 재시도, 마커 hit-test를 통과함. 소유 custom domain의 staging 성공, 잘못된 origin 실패, SDK timeout/failure, 실제 타일 fallback 캡처는 남음
- `[~]` Tier A 15곳·Tier B 25곳 후보와 승격/강등 기준, fresh-coverage KPI 화면은 로컬 계획·구현 완료. 실제 장소 확정, 운영자 배정, 주말 데이터 수집은 시작 전
- `[~]` 로컬 `0023`이 익명 ID를 별도 256-bit proof에 결합하고 rotation·revocation·ID-only replay 거부를 검증함. staging `SILSIGAN_ANON_SESSION_REQUIRED=1`, owner-domain live 증거, complete ID+proof 동시 탈취까지 방어할 member/device binding 결정은 남음

## 5. 수정된 실행 순서

### Phase 0 — 로컬 변경 고정 및 원격 반영

의존성: 없음

- [x] 현재 dirty worktree에서 변경 파일을 분류·검토
- [x] 커밋 대상 테스트 422/422, skip 0, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm cf:build`, root/mobile dependency audit with no known vulnerabilities, staging/production frontend/API Worker dry-run, WebView/mobile verify, Android JDK 21 lint/debug APK, `git diff --check` 재실행
- [x] `pnpm cf:typegen`과 `pnpm cf:build` 통과. OpenNext가 `.open-next/worker.js`와 assets bundle을 생성했으며, 실제 Cloudflare 배포는 수행하지 않음
- [x] secret scan과 migration chain fixture를 로컬에서 재실행해 통과했고, push 후 원격 SHA 일치를 확인함
- [x] 저장소 `local-report` browser smoke를 390x844에서 재실행해 일반 올리기의 명시적 장소 선택, 사진별 촬영·게시 권한 확인 클릭과 파일 입력 활성화, anonymous-session bootstrap, onboarding, home/map/my, 설정 동기화, NAVER 검색 결과의 명시적 검토 폼 prefill과 제출 전 무저장, 비공개 장소 요청 접수와 owner-only 상태, 사용자 안전 지도 fallback·컨트롤, 전국 검색, 랭킹·상세, realtime, like/comment/photo, 장소·댓글·사진 신고, 소유 사진 삭제, JPEG 업로드, 통합 발행 계약과 승인 제보 deep link, legacy social feed 비활성 상태의 `#지금` 최신 승인 사진 탐색·Worker 팔로우·마이 복귀·cursor 다음 페이지 병합, 계정 삭제/세션 회전/이전 proof 403, share/OG, 관리자 로그인, aggregate/Tier A/Tier B KPI, 5개 사진 비용 계기와 3개 전역 API 비용 계기, 사진 stop/resume, 전역 API stop/Cloudflare 대조/below-70% resume까지 필수 58개 흐름을 통과함. 최신 artifact는 `artifacts/cloudflare-pages-smoke-worker-report-local/pages-smoke-1784510945721.png`, `pages-smoke-home-1784510945721.png`, `pages-smoke-map-1784510945721.png`, `pages-smoke-place-1784510945721.png`, `pages-smoke-my-1784510945721.png`, `pages-smoke-hashtag-1784510945721.png`, `pages-smoke-account-deletion-1784510945721.png`, `pages-smoke-admin-cost-guard-stopped-1784510945721.png`, `pages-smoke-admin-cost-guard-running-1784510945721.png`, `pages-smoke-admin-api-cost-guard-stopped-1784510945721.png`, `pages-smoke-admin-api-cost-guard-running-1784510945721.png`, `pages-smoke-network-1784510945721.json`임. 네트워크 614건에서 request body 저장·민감정보 hit가 없었고, 임의 백엔드 오류문·내부 검수 사유·내부 저장 식별자·raw 익명 proof를 사용자 화면이나 증적에 전달하지 않는 오류 경계를 유지함
- [x] Computer Use로 Cloudflare R2 checkout을 읽기 전용 확인했으며 결제정보 입력, 약관 동의, R2 활성화는 수행하지 않음. NAVER Cloud 로그인 후 별도 `Silsigan` Dynamic Map 폼을 준비했지만 최종 등록은 승인 전이라 누르지 않음
- [x] 사용자 요청에 따라 선별 통합본 commit/push
- [x] push 후 GitHub SHA와 branch를 확인하고 release ledger를 통합 기준 SHA로 동기화

완료 조건: 통합 기준 SHA `744d3032760cf67a25bf1a70f90edf1530437800`과 원격 branch가 일치하고, `0013`~`0026` 및 release-evidence gate가 GitHub에서 확인됩니다. 완료했습니다.

### Phase 1 — Cloudflare staging

의존성: Phase 0

1. 완료된 staging D1 backup/export를 보존하고 배포 전 non-mutating D1 evidence를 재실행
2. schema-only boundary through `0026`, Wrangler pending 0건, migration registry·core seed 일치를 다시 읽기 전용 확인하고 pre-change backup을 보존
3. R2 활성화 후 `0026` global API cost tables/control/index 증거를 유지하고, `0022`가 중단한 업로드는 live R2/D1 대조와 감사 기록 후에만 재개
4. R2 subscription과 staging bucket 활성화
5. staging API Worker 배포
6. staging Pages/API HTTPS URL 설정
7. `/api/health`, `/api/places`, `/api/config` smoke

완료 조건:

- `D1_0006_NOT_APPLIED` 해소
- `R2_NOT_ENABLED` 해소
- `/api/health=200`
- `/api/places=200`
- `dataMode=live`
- demo 응답 0건
- migration 재실행 또는 forward-fix 절차 기록

### Phase 2 — 실제 공식 데이터와 지도

의존성: Phase 1

1. KMA
2. TourAPI
3. 전국 주차장
4. ITS 교통
5. ITS CCTV metadata
6. NAVER Web Maps owner-controlled custom domain, representative-domain restriction, usage limit/alert recipient, valid-origin success, and invalid-origin rejection

각 source는 rights 승인 후에만 활성화하며 `observedAt`, `expiresAt`, attribution, health, TTL, 장애 fallback을 증명합니다. `docs/source-ingestion-scheduler-runbook.md`에 따라 staging target을 한 번에 하나만 켜고, 비밀키는 Worker secret에만 둡니다. CCTV 영상 저장·중계는 하지 않습니다.

서울 후순위 source:

- 로컬 adapter: `workers/api/src/public-data/seoul-realtime-adapter.ts`
- 공식 dataset: https://data.seoul.go.kr/dataList/OA-21285/A/1/datasetView.do
- 현재 상태: `SEOUL_REALTIME_ENABLED=false`, `data_sources.enabled=0`, rights/health 승인 전 수집 금지
- API의 인구 값은 추정값이므로 `isEstimated=true`와 출처·관측시각을 함께 표시하며 실제 인원수로 단정하지 않습니다.

### Phase 3 — 사진·검수·운영

의존성: Phase 1

- binary upload-ticket → sanitization → pending moderation → approved derivative
- 원본 private 접근과 승인 전 공개 차단 확인
- R2 삭제·계정 삭제 cascade·orphan cleanup 확인
- field-report 관리자 화면과 실제 moderator role smoke
- 신고 SLA, webhook, audit log, tail redaction 확인

### Phase 4 — 사용자·분석 완성

의존성: Phase 1~3

- 실제 거리순 주변 5곳과 지역별 날씨
- 저장 장소·알림 subscription·push opt-out
- production analytics sink·집계 전용 KPI 배포와 개인정보 redaction 운영 증거
- 공유 딥링크와 실제 상태 기반 OG
- accessibility, 360/390/430px, map success/fallback 재검증

### Phase 5 — 실기기·법률·TestFlight

의존성: Phase 2~4

- 생성된 `apps/webview/ios`·`apps/webview/android`의 실제 staging URL/origin 주입과 simulator/debug build는 완료
- iOS/Android release signing과 signed artifact 생성
- native settings adapter hardware smoke와 push provider delivery 검증
- 위치 거부, 카메라, 사진, 공유, 딥링크, 외부 브라우저, 네트워크 오류
- privacy/support URL, 위치기반서비스, UGC, 삭제, source terms sign-off
- App Privacy·Data Safety 초안과 TestFlight review notes는 로컬 gate 완료; 실제 아카이브 privacy report, 양 스토어 콘솔 입력과 named legal review
- Cloudflare Worker rollback 계획/이력 조회/후보 선택 하네스는 로컬 및 staging web read-only 증거 완료; 실제 staging rollback, smoke, forward restoration은 별도 승인 후 실행

### Phase 6 — 집중 베타

의존성: Phase 5

- Tier A 12~15곳, Tier B 20~35곳 확정
- 운영자와 주말 운영 배정
- fresh coverage, 제보 완료시간, 승인률, 거절률(허위 제보율로 해석 금지), 신고 처리시간, 지도 성공률, 웹 오류 없는 앱 열기, native crash-free session, D1/D7 측정

베타 통과 기준:

- Tier A fresh signal coverage 70% 이상
- 지도 성공률 99% 이상
- crash-free session 99.5% 이상
- 신고 24시간 이내 처리
- 제보 완료시간 중앙값 15초 이하

## 6. Production 승격 체크리스트

- [x] GitHub remote가 통합 기준 로컬 검증 SHA `744d3032760cf67a25bf1a70f90edf1530437800`와 일치
- [x] API feature gate
- [x] server-owned question credit fail-closed
- [x] `expiresAt` 강제
- [x] staging D1 `0004~0026`, pending migration 0, aligned registry, core seed, enabled unsafe target 0, cleanup/outbox, Images/read/storage/session/issuance/place-request/global-cost evidence
- [~] staging D1 pre-change backup과 dedicated KV 생성·binding은 완료. R2 활성화 후 post-`0022` live R2/D1 reconciliation은 남음
- [ ] staging R2 및 실제 삭제
- [ ] staging API Worker/Pages URL
- [ ] 실제 공공데이터와 권리 승인
- [ ] NAVER 소유 custom domain·대표 도메인·한도·알림·origin 성공/거부 증거
- [ ] field-report moderation/admin evidence
- [ ] production analytics/push
- [ ] iOS/Android real-device QA
- [x] privacy/support URL: `https://silsigan-web-production.dudqks0319.workers.dev/privacy`, `https://silsigan-web-production.dudqks0319.workers.dev/support` 공개 HTTP 200 확인
- [ ] named legal/operations sign-off
- [~] rollback drill: non-mutating harness와 staging web 이전 안정 버전 후보 증거는 완료, 실제 rollback/검증/현재 버전 복구는 미실행
- [ ] `pnpm release:status -- --strict` 통과

위 항목 중 하나라도 남아 있으면 Production 승격을 금지합니다.

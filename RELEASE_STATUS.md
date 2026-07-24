# Release Status

Updated: 2026-07-24

## 한 줄 상태

실시간 V2 사진 위치 경로는 보안 스캔에서 발견된 Medium CWE-345 신뢰표현 문제를 `d35607a`에서 수정한 뒤 Cloudflare staging에 적용했습니다. 서버는 사진 티켓 발급 전에 현재 위치를 필수 검증하고 정확한 좌표를 저장하지 않으며, 공개 응답에는 클라이언트가 보고한 반경·정확도 구간만 남깁니다. 전체 테스트 `462/462`·모바일 `4/4`, 빌드, Cloudflare dry-run, read-only staging smoke를 통과했고 API `3f1d64bc-c62b-4788-9b76-173b210a242f`와 web `2483c542-e10d-458b-9f40-12b835d80f62`가 배포됐습니다. Computer Use로 홈 `올리기`→현재 위치 자동 연결→실제 NAVER 지도→사진 선택까지 확인했으며, 관리형 Turnstile의 사람 확인 체크박스 앞에서 멈췄습니다. D1 사진/바이트/사용 티켓/정리 작업과 R2 객체는 모두 `0`; 업로드 성공은 아직 주장하지 않습니다. Production은 변경하지 않았고 현재 상태는 `staging_photo_location_security_remediated_turnstile_human_confirm_pending_production_blocked`입니다.

## 현재 후보

- Version: `0.1.0`
- Working branch: `agent/silsigan-backend-finish-20260724`
- Upstream branch: `origin/codex/silsigan-progress-20260710`
- Verified local source/evidence commit: `d35607ab2b4a4a8b8418355d24226c7d99e18585`
- Working tree after the candidate commit: clean before this documentation-only release record; generated 2026-07-24 staging smoke, safe-tail, static-directory, and public-source evidence are committed release inputs
- Upstream branch: verify `origin/codex/silsigan-progress-20260710` equals the branch tip after push
- Final release-record commit: the docs-only commit containing this record; the remote branch remains unchanged until an explicit push
- Security gate: manual source/diff review, high-confidence secret/log scan, same-day dependency audit, negative-path regressions, and the current Codex Security diff scan passed after remediation. The sealed scan has `7/7` completed diff rows, one candidate with discovery/validation/attack-path receipts, matching sealed artifact hashes, and a generated final report. It found one Medium CWE-345 client-location trust issue in `e760dd5`; `d35607a` makes location mandatory, validates radius/accuracy server-side, binds only coarse evidence to one-use tickets, removes server-endorsed physical-location wording and internal identifiers, and adds focused regressions
- Production deploy/migration/traffic change: none
- Deferred and disabled: ads, rewards, Q&A, live streams, social feed, demo data, Seoul realtime activation

## 이번 staging 완료

- [x] R2 private bucket `silsigan-photos-staging`
- [x] `r2.dev` disabled; no direct R2 custom domain
- [x] temporary-upload one-day expiry and multipart seven-day abort
- [x] Staging D1 through `0026`, pending migrations 0
- [x] Staging API/web deployment and exact staging web origin
- [x] Earlier read-only API smoke: health, 14 places, detail/status, rankings, realtime, empty media/comments, admin deny
- [x] Current staging API version `3f1d64bc-c62b-4788-9b76-173b210a242f`; the rotated Turnstile secret is installed by name only
- [x] Current staging web version `2483c542-e10d-458b-9f40-12b835d80f62`; the exact public staging API base and live mode were reverified after the safe fail-closed interim bundle was replaced
- [x] Latest audited API-cost reconciliation and below-70% resume: Workers `3,000`, D1 rows read `504,922`, rows written `37,386`; generation `5`, public live mode restored
- [x] Browser home/map/search/detail smoke after the security patch deployment, API request budget `72/80`
- [x] Current NAVER pstatic tiles and place markers remain after the stabilization window
- [x] No external source ingestion target enabled
- [x] Home `올리기` opens the photo flow directly; browser location auto-links the current place without manual selection and renders the real NAVER map. The QA run used explicit Chrome location emulation because the Mac fix was too imprecise, so it is interaction evidence rather than field-presence proof
- [x] A bounded JPEG reached the exact-host managed Turnstile human checkbox. No CAPTCHA bypass or upload-success claim was made; post-selection D1 active photos/bytes/consumed claims/pending cleanup and R2 objects/bytes all remain zero

Staging URLs:

- Web: `https://silsigan-web-staging.dudqks0319.workers.dev`
- API: `https://silsigan-api-staging.dudqks0319.workers.dev`

## 코드 변경

- Public GET requests omit needless JSON `Content-Type`, avoiding preflight-only traffic.
- Silent map/query refreshes reuse existing global state and fetch only scoped places/statuses.
- Initial photo/comment prefetch is limited to five places; uncached place evidence loads lazily on detail open.
- Browser smoke fails above 80 non-mutating API requests and accepts a truthful empty live ranking.
- Legacy anonymous IDs are not sent without server proof in read-only staging smoke.
- NAVER map health recognizes current `nrbe.pstatic.net` and `ssl.pstatic.net/static/maps` resources while retaining `auth_fail` rejection.
- Every official provider call reserves a bounded Korea Standard Time daily request budget before network access; `0` is an emergency kill switch and invalid, malformed-time, or over-ceiling configuration fails closed.
- KMA, TourAPI, national parking, ITS traffic/CCTV, and Seoul realtime have independent or deliberately shared server-side daily ceilings, with at most two network attempts per ingestion run.
- Global D1 route reservations were recalibrated from staging evidence: the heaviest observed public query averaged 59 rows, while the previous 10,000-row high-cost weight drove the conservative ledger to 3,500,000 rows against about 87,870 actual rows. The deployed high-cost ceiling is now 500 rows and must still be reconciled through the audited admin path.
- Background live refresh is now visible-tab-only, single-leader across same-origin tabs, non-overlapping, 60-second, and limited to places plus at most five status requests after initial load.
- Public API cost-guard admission reuses its preloaded control row, so one request no longer performs the same `COST_GUARD_STATE` KV read twice; D1 remains the authoritative atomic reservation ledger.
- Security-sensitive client mutations now use explicit full reconciliation before success; the low-cost `places_status` scope remains limited to four map/search/bounds/background callers, and account deletion synchronously clears owned UGC caches.
- Safe Workers tail capture keeps raw platform events in bounded memory only, strips request/response metadata, preserves Worker logs for leak detection, and persists only an owner-readable artifact after validation.
- Next.js and `eslint-config-next` are patched to `16.2.11`; root and mobile PostCSS are forced to `8.5.12`.
- Photo tickets now require client location before Turnstile/D1/R2 work, reject missing evidence with `PHOTO_LOCATION_REQUIRED`, validate accuracy and place radius, bind a coarse radius/accuracy bucket to ticket schema v3, and never store exact photo coordinates.
- Public photos expose only `clientReportedProximity`; server-endorsed `locationVerified` wording and internal anonymous/R2 identifiers are removed. The UI explicitly says browser device location is not physical-presence or identity verification.

## 검증

- Focused provider-budget, provider-quota, and D1 route-calibration regressions: passed.
- Current security-remediated verification: root tests `462/462`, mobile tests `4/4`, lint, typecheck, Next production build, WebView syntax check, OpenNext build, and staging/production web/API Wrangler dry-runs passed. Production checks were dry-runs only.
- `pnpm audit:security`: root and mobile both report no known vulnerabilities.
- 2026-07-24 live staging read-only API smoke: health, 14 places, detail/status, three realtime rooms, rankings, empty media/comments, and unauthenticated admin `403` passed.
- 2026-07-24 post-deploy browser smoke: home/map/search/detail and live Worker paths passed at `72/80` requests.
- TypeScript: passed.
- OpenNext/Cloudflare build: passed, Next.js `16.2.6`, 27 pages/routes and 148 web assets.
- Browser smoke: passed, `65/80` API requests.
- Real NAVER map: passed after five-second wait, no false resource fallback.
- First immediate post-deploy smoke: failed once on a transient stale HTML/removed-chunk reference; exact root then returned the current chunk three times and the cache-busted release smoke passed. The failure is retained as rollout evidence.
- Full verification: root `454/454` was re-run and passed on 2026-07-22 outside the loopback-restricted sandbox; mobile `4/4`, root/mobile lint and typecheck, Next.js build, WebView check, OpenNext build, and clean staging/production web dry-runs passed on the current change set. Added regressions prove single-leader visible-only refresh, exactly one cost-guard KV read per public request, and full visibility-cache reconciliation after block, unblock, moderation, and account deletion.
- Codex Security closure: the source-state PoC reproduced on `f5abc50e999d0a8f349d56326a8e9ecb4af6491e`, no longer matches the vulnerable transition on `656eb315cbde4505b6c7db342a0185bb2762baea`, and the independent post-fix re-review reports no remaining actionable finding in the scoped diff.
- Dependency audit: no known root or mobile vulnerability.
- High-confidence credential-prefix and provider-assignment scan: no matching file; `.env.example` is the only tracked env-shaped file.
- 2026-07-24 15:26 KST post-deploy storage reconciliation: active photos `0`, active photo bytes `0`, budget active bytes `0`, period writes `0`, consumed upload claims `0`, pending cleanup jobs `0`, D1 `changed_db:false`/`rows_written:0`; private staging R2 contains `0` objects and `0 B`.

## 보안·비용 경계

- Final photo maximum: `1 MiB` after bounded client re-encoding.
- Authenticate and authorize before paid/storage work.
- Per-session/user/fingerprint quotas, one-use tickets, idempotency, deduplication, bounded retries, and fail-closed dependency handling.
- 60% warning, 70% degradation, 80% stop, plus manual emergency stop.
- Provider-call budgets are enforced before outbound requests and count conservative retry reservations; provider budget uncertainty never falls back to an unmetered call.
- Overestimated global reservations can be rebased only by an admin while the guard is already degraded/stopped, with the current generation and a same-day observation no older than 15 minutes; prior aggregate reservations are written to the audit log and direct D1 edits remain prohibited.
- No raw IP, exact GPS, anonymous proof, provider key, private object key, original filename, or original image URL in Git/logs/public responses.
- Staging provider keys must use Wrangler secrets; source activation is a separate audited action.

## 2026-07-22 Workers KV 사용량 사고와 조치

- 원인: staging 앱 탭 2개가 각각 30초마다 전체 `loadData()`를 실행했고, 한 주기당 약 22개 API 요청을 만들었습니다. Worker는 각 공개 요청에서 동일한 `COST_GUARD_STATE`를 사전 검사와 예약 단계에서 두 번 읽었습니다.
- 수정 전 추정 유휴 부하: `2 tabs × 22 requests × 2 ticks/min × 2 KV reads = 약 176 KV reads/min`.
- 수정 후 설계상 유휴 상한: 보이는 same-origin 리더 탭 1개가 60초마다 장소 1회와 상태 최대 5회만 요청하고 각 요청이 KV를 1회 읽어 `약 6 KV reads/min`입니다. 초기 로드, cron, 사용자 동작은 별도이며 두 탭 시나리오 기준 약 `96.6%` 감소입니다.
- 즉시 조치: staging 앱 탭 2개 종료, Turnstile secret 회전 및 staging 재설치, 임시 관리자 토큰·사진 파일 삭제, API/web 재배포. Production secret·배포·migration·traffic은 변경하지 않았습니다.
- 대시보드의 24시간 누적/평균은 즉시 내려가지 않습니다. 조치 직후 보인 약 `0.9 reads/s`, `63.9k reads`는 선택된 과거 구간을 포함하므로 새 기울기의 독립 증거가 아닙니다. 무료 일일 한도는 `00:00 UTC`(`09:00 KST`)에 재설정되며 다음 창에서 다시 확인해야 합니다.
- 이전 Turnstile secret은 Cloudflare 회전 유예로 최대 2시간 더 수락될 수 있습니다. 저장소·로그에는 값을 남기지 않았고 새 값은 staging Wrangler secret으로만 전달했습니다.

## 현재 secret 인벤토리

Staging에 존재하는 이름:

- `KMA_SERVICE_KEY`
- `TOUR_API_SERVICE_KEY`
- `NATIONAL_PARKING_SERVICE_KEY`
- `SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET`
- `SILSIGAN_TURNSTILE_SECRET_KEY`
- `ADMIN_TOKENS`

발급·설치 대기:

- `ITS_SERVICE_KEY`

값은 문서, Git, D1, 로그, 브라우저에 기록하지 않습니다.

## 막힌 항목

- [ ] data.go.kr 로그인/CAPTCHA와 KMA·전국주차장 활용신청
- [ ] TourAPI 로그인/OAuth·활용신청
- [ ] ITS 교통소통/CCTV 메타데이터 활용신청 제출
- [ ] source별 권리·출처·quota·TTL·health·fallback 승인
- [x] KMA·TourAPI·전국주차장 staging secret 설치 후 공식 provider 6개와 ingestion target 비활성 유지 확인
- [ ] source별 계약/health 검증과 승인된 소스의 단계적 활성화
- [x] role-separated `ADMIN_TOKENS` 설치, Cloudflare 실제 사용량 감사 기록, global API guard 정상 모드 재개
- [ ] moderation/cost alert recipients and live WAF/rate-limit evidence
- [x] bounded staging Workers tail capture and sensitive-log validation (`20` events, no sensitive findings, 2026-07-24)
- [ ] Complete the exact-host managed Turnstile human check, then one bounded upload/moderate/read/delete cleanup smoke and re-prove R2/D1 zero residuals
- [ ] owner-controlled domain and NAVER notification/production-origin evidence
- [ ] finish signed iPhone/Android real-device QA (iPhone 12 Pro development-signed build/install/launch/startup smoke passed 2026-07-23; screenshots, permissions, photo lifecycle, Android, and TestFlight archive remain)
- [ ] named legal/operations sign-off
- [ ] production D1/API/R2 and traffic promotion, each separately approved

Release-harness evidence tokens:

- Production D1 remains `D1_0006_NOT_APPLIED`.
- Separate staging/production `COST_GUARD_STATE` bindings exist; live WAF and invocation-free routing proof remains open.
- `MODERATION_ALERT_WEBHOOK_URL` is not configured and staging moderation alert delivery is unproven.
- Staging requires `SILSIGAN_ANON_SESSION_REQUIRED=1` and `SILSIGAN_ANON_SESSION_DAILY_LIMIT=5000`; owner-domain replay/rotation evidence remains open.

## 다음 행동

1. Complete the currently visible Turnstile human check for the bounded staging photo smoke.
2. Prepare or verify KMA, national parking, TourAPI, and ITS forms at the final review step.
3. Ask once at action time before submissions/OAuth, credential creation, and admin-token creation; the three existing provider keys are already installed in staging only.
4. Keep every official source and ingestion target disabled until the corresponding rights/health review passes.
5. Keep generation `5` of the recovered global API guard in `running` mode and monitor only redacted aggregate counters; do not bypass the audited control path.
6. Validate and activate at most one approved source at a time, beginning with KMA.
7. After the Turnstile human check succeeds, finish one bounded photo upload/moderate/read/delete smoke and verify R2 returns to `0 B`.
8. Finish operational, device, legal, and owner-domain gates before any production work.

Detailed truth and continuation:

- `docs/current-release-state.md`
- `docs/developer-handoff-2026-07-21.md`
- `release-ledger.yaml`
- `docs/silsigan-v2-master-completion-plan-2026-07-21.md`

# Release Status

Updated: 2026-07-22

## 한 줄 상태

실시간 V2는 Cloudflare staging의 private R2, D1 `0026`, 웹, 전국 장소 조회, 비용 방어, 실제 NAVER 지도까지 연결됐습니다. 2026-07-22 미출시 상태의 열린 staging 탭 2개와 중복 KV 조회가 Workers KV 읽기를 지속 발생시킨 원인을 확인해 탭을 닫고, Turnstile secret을 회전해 staging에만 다시 설치했으며, 보이는 탭 1개만 60초마다 경량 갱신하고 공개 요청당 비용 가드 KV를 1회만 읽도록 수정·재배포했습니다. 사진 비용 원장은 R2 `0 B`와 대조해 쓰기를 재개했지만, 1 MiB 이하 실제 브라우저 업로드의 검수·공개·삭제 스모크는 아직 끝나지 않았습니다. 공공데이터 소스와 production은 계속 닫혀 있어 현재 상태는 `staging_running_kv_remediated_photo_turnstile_smoke_pending_production_blocked`입니다.

## 현재 후보

- Version: `0.1.0`
- Working branch: `agent/external-staging-20260721`
- Upstream branch: `origin/codex/silsigan-progress-20260710`
- Verified source commit: `656eb315cbde4505b6c7db342a0185bb2762baea`
- Working tree after the release-record commit: tracked source is clean; four local UI truth PNGs under `artifacts/ui-truth-20260722/` remain intentionally untracked and are not release inputs
- Upstream branch: verify `origin/codex/silsigan-progress-20260710` equals the branch tip after push
- Final release-record commit: the docs-only commit containing this record; use the remote branch tip as the continuation point
- Security gate: manual source/diff review, dependency audit, negative-path regressions, and high-confidence secret scan passed. Codex Security scan `7fe0ad74-161b-44e7-bbfb-fb0eeb07c6c2` completed 15/15 review items; its one Medium stale-client-cache finding is remediated and independently re-reviewed at the verified source commit
- Production deploy/migration/traffic change: none
- Deferred and disabled: ads, rewards, Q&A, live streams, social feed, demo data, Seoul realtime activation

## 이번 staging 완료

- [x] R2 private bucket `silsigan-photos-staging`
- [x] `r2.dev` disabled; no direct R2 custom domain
- [x] temporary-upload one-day expiry and multipart seven-day abort
- [x] Staging D1 through `0026`, pending migrations 0
- [x] Staging API/web deployment and exact staging web origin
- [x] Earlier read-only API smoke: health, 14 places, detail/status, rankings, realtime, empty media/comments, admin deny
- [x] Current staging API version `dc07bf4a-879a-421c-aea1-5418f9c8bc0e`; the rotated Turnstile secret is installed by name only
- [x] Current staging web version `ad980039-5ba0-4ffb-9616-6f60eb6aea54`; build-time API base corrected and live mode reverified in the browser
- [x] Latest audited API-cost reconciliation and below-70% resume: Workers `3,000`, D1 rows read `504,922`, rows written `37,386`; generation `5`, public live mode restored
- [x] Browser home/map/search/detail smoke, API request budget `65/80`
- [x] Current NAVER pstatic tiles and place markers remain after the stabilization window
- [x] No external source ingestion target enabled
- [x] Photo R2/D1 zero-state reconciliation and audited write resume; a valid bounded JPEG reached the exact-host managed Turnstile challenge, but human verification and the upload/moderate/read/delete cleanup smoke remain pending

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

## 검증

- Focused provider-budget, provider-quota, and D1 route-calibration regressions: passed.
- TypeScript: passed.
- OpenNext/Cloudflare build: passed, Next.js `16.2.6`, 27 pages/routes and 148 web assets.
- Browser smoke: passed, `65/80` API requests.
- Real NAVER map: passed after five-second wait, no false resource fallback.
- First immediate post-deploy smoke: failed once on a transient stale HTML/removed-chunk reference; exact root then returned the current chunk three times and the cache-busted release smoke passed. The failure is retained as rollout evidence.
- Full verification: root `454/454` was re-run and passed on 2026-07-22 outside the loopback-restricted sandbox; mobile `4/4`, root/mobile lint and typecheck, Next.js build, WebView check, OpenNext build, and clean staging/production web dry-runs passed on the current change set. Added regressions prove single-leader visible-only refresh, exactly one cost-guard KV read per public request, and full visibility-cache reconciliation after block, unblock, moderation, and account deletion.
- Codex Security closure: the source-state PoC reproduced on `f5abc50e999d0a8f349d56326a8e9ecb4af6491e`, no longer matches the vulnerable transition on `656eb315cbde4505b6c7db342a0185bb2762baea`, and the independent post-fix re-review reports no remaining actionable finding in the scoped diff.
- Dependency audit: no known root or mobile vulnerability.
- High-confidence credential-prefix and provider-assignment scan: no matching file; `.env.example` is the only tracked env-shaped file.

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
- [ ] moderation/cost alert recipients, WAF/rate-limit, and tail evidence
- [ ] Complete the exact-host managed Turnstile human check, then one bounded upload/moderate/read/delete cleanup smoke and re-prove R2/D1 zero residuals
- [ ] owner-controlled domain and NAVER notification/production-origin evidence
- [ ] signed iPhone/Android real-device QA
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

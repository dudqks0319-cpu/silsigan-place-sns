# #실시간 사진 중심 MVP 개발계획서

작성일: 2026-07-02

## 목표

#실시간을 "기능 많은 지도앱"이 아니라 "출발 전, 방금 올라온 장소 사진으로 지금 분위기를 확인하는 앱"으로 만든다.

핵심 행동은 세 가지다.

1. 지금 올라온 장소 사진 보기
2. 해시태그로 장소 분위기 탐색하기
3. 내가 있는 장소 지금컷 올리기

영상/릴스는 이번 범위에서 제외한다. 지도는 핵심 탐색이 아니라 사진이 올라온 장소를 보조로 찾는 화면이다.

## 현재 로컬 코드 반영 상태

이번 코드 반영으로 처리한 항목:

- 홈 첫 카드가 실제 사진형 배경을 사용한다.
- 광안리, 황리단길, 태화강 fallback 사진 자산을 `public/silsigan/fallback/`에 추가했다.
- 홈/피드/장소 상세에서 `previewUrl` 또는 report `photoUrl`을 우선 사용한다.
- 지도 핀 선택 후 지도 아래에 장소 미리보기 CTA가 노출된다.
- 올리기 화면에 `장소 -> 사진 -> 태그 -> 한 줄 -> 올리기` 5단계 표시를 추가했다.
- 장소 상세 안의 피드 카드 클릭은 사진 탭으로 전환된다.
- 검색 화면은 `사진 있는 최근 결과`를 네이버 외부 장소 검색보다 먼저 보여준다.
- 검색 사진 결과에는 64px 썸네일과 `사진 추가` CTA를 제공한다.
- 홈 대표 카드에는 `출발 전 10초 확인`, `지금컷 올리기`, 오프라인 샘플 안내를 추가해 실시간/샘플 혼동을 줄였다.
- 올리기 화면에는 장소 선택 카드와 장소 칩을 추가해 임의 기본 장소로 업로드되는 느낌을 줄였다.
- Cloudflare API 설정 시 지금컷 제출은 `/api/reports` v3 발행 계약을 사용한다. 업로드 결과 `photoIds`, 정규화 `hashtagNames`, 재시도용 `clientRequestId`가 같은 발행 묶음으로 저장되고 검수 승인 뒤 공개 집계에 반영된다.
- 핵심 해시태그 탐색은 레거시 소셜피드 기능 플래그와 분리했다. 승인된 제보의 안전한 사진 ID와 해시태그가 공개 목록에 함께 포함되며, 해시태그를 누르면 최신 현장사진 결과로 이동한다.
- 로컬 mock report의 `demo://` 사진 URL을 실제 fallback PNG 경로로 교체했다.
- Worker moderation target에 `post`를 추가해 게시물 신고가 장소 신고로 섞이지 않게 했다.

관련 파일:

- `src/components/silsigan/SilsiganRedesign.tsx`
- `src/components/silsigan/SilsiganRedesign.module.css`
- `src/lib/mock-store.ts`
- `src/lib/cloudflare-api.ts`
- `src/lib/worker-admin-api.ts`
- `workers/api/src/index.ts`
- `tests/cloudflare-api.test.ts`
- `public/silsigan/fallback/gwangalli.png`
- `public/silsigan/fallback/hwangridan.png`
- `public/silsigan/fallback/taehwagang.png`

## 사용자 관점 부족점과 실행 계획

### P0

1. 첫 화면에서 실제 사진이 즉시 보여야 한다.
   - 완료 기준: 390x844 첫 뷰포트 안에 사진형 카드와 `실시간 사진 보기`, `지금컷 올리기` CTA가 보인다.
   - 현재 상태: 로컬 코드 반영 완료. CTA는 `지금컷 올리기`로 정리했고, 브라우저에서 홈 첫 화면을 확인했다.

2. 지도 핀 클릭 반응이 명확해야 한다.
   - 완료 기준: 핀/랭킹 클릭 즉시 장소명, 최근 사진 수, 한 줄 상태, `실시간 사진 보기`, `지금컷 올리기`가 보인다.
   - 현재 상태: 로컬 코드 반영 완료. 인앱 브라우저에서 지도 랭킹 클릭 후 선택 바와 상세 시트가 열리는 것을 확인했다.

3. 올리기 화면은 현장에서 10초 안에 이해돼야 한다.
   - 완료 기준: 첫 화면에서 장소 선택, 사진 권장, 5단계 흐름, 상태만 먼저 올리기 예외가 보이고 상태 보완 입력은 보조로 내려간다.
   - 현재 상태: 사진 선택을 장소 선택보다 먼저 보이게 정리했고, 5단계 흐름도 `사진 -> 장소 -> 태그 -> 한 줄 -> 올리기`로 맞췄다. Cloudflare 설정 시 `/api/reports` v3 한 요청이 사진·태그·상태를 묶으며, 장소를 바꾸면 이전 사진 연결과 재시도 키를 초기화한다.

### P1

4. 검색 결과는 사진 있는 결과를 먼저 보여야 한다.
   - 완료 기준: 검색 화면 상단이 `사진 있는 최근 결과`이고, 네이버 장소 검색은 앱 안 결과 뒤의 보조 섹션이다. 외부 검색이 미설정/실패/무결과여도 `앱 안 지도에서 보기` 또는 `지금컷 추가` CTA가 보인다.
   - 현재 상태: 로컬 코드 반영 완료. 검색 결과가 있을 때만 해당 장소의 `지금컷 추가`를 표시하고, 무결과에서는 지도/인기 지역으로 이동한다. 검색과 무관한 첫 인기 장소로 업로드를 오귀속하던 fallback은 제거했다.

5. 마이 화면은 미완성 신호를 줄여야 한다.
   - 완료 기준: `준비 중`, `연결 대기`, `공개 미리보기` 같은 미완성 문구 대신 이 기기 기준 활동, 저장, 질문권, 안전 설정을 보여준다.
   - 현재 상태: 로컬 코드 반영 완료. 2026-07-19 390x844 실제 브라우저에서 `이 기기 기준 활동 · 로그인 없이 바로 사용`, 공개/검토 중/비공개 제보 수, `내 제보 상태`, 저장한 게시물과 안전 설정을 확인했다. `준비 중`, `연결 대기`, `공개 미리보기` 및 `/api/` 내부 경로는 사용자 화면에 없고, 설정 동기화 실패도 사용자용 문구로만 안내한다. 지도 fallback도 `MAP_KEY_MISSING` 같은 기술 코드를 화면에 표시하지 않고 사용자 행동만 안내한다. 증적은 `artifacts/cloudflare-pages-smoke-worker-report-local/pages-smoke-my-1784459655424.png`과 `pages-smoke-map-1784459655424.png`이다.

6. 빈 지역은 실패처럼 보이면 안 된다.
   - 완료 기준: 빈 상태마다 `첫 지금컷 올리기`, `다른 지역 보기`, `질문 남기기` 중 하나의 CTA가 보인다.
   - 현재 상태: 홈 피드와 장소 상세 빈 상태 CTA 로컬 코드 반영 완료. 검색 빈 상태 CTA까지 보강했고 브라우저에서 검색 빈 상태의 지도/업로드 이동을 확인했다. 앱 전역 무데이터 상태도 `검색으로 넓히기`, `지도에서 다른 지역 보기` CTA를 제공하도록 보강했고 UI 계약 테스트로 고정했다. 실제 staging 지역 무데이터 케이스는 staging smoke에서 재검증 필요.

## 개발자 관점 부족점과 실행 계획

### P0

1. R2 실제 사진 업로드/조회/삭제가 staging에서 통과해야 한다.
   - 증거: `pnpm cf:r2:evidence -- --env=staging --check`, staging 사진 업로드 smoke, 삭제 후 URL 접근 차단.

2. staging/prod Pages/API URL이 확정돼야 한다.
   - 증거: `SILSIGAN_STAGING_API_BASE_URL`, `SILSIGAN_PRODUCTION_API_BASE_URL`, `SILSIGAN_STAGING_PAGES_URL`, `SILSIGAN_PRODUCTION_PAGES_URL`.

3. fallback/sample 데이터와 실제 실시간 데이터를 구분해야 한다.
   - 현재 상태: 홈 대표 카드와 샘플 안내에 `오프라인 샘플`을 명시했고, mock report 사진 URL은 실제 fallback PNG를 사용한다.

### P1

4. 사진 업로드 결과가 report/post와 명확히 연결돼야 한다.
   - 현재 상태: 완료-local. `0014_field_report_publications.sql`이 `field_report_publications`, `field_report_media`, `hashtags`, `field_report_hashtags`, `publication_outbox`를 추가했고 Worker가 사진 소유권·장소 일치·멱등 재시도·승인 전 태그 비노출을 검증한다. staging R2/D1 적용과 브라우저 증적은 외부 게이트로 남는다.
   - 비용·공격 안전: `0015`/`0016`/`0017`은 staging D1까지 적용·검증됐고, 로컬 `0020_photo_transform_budget.sql`, `0021_photo_read_abuse_budget.sql`, `0022_photo_storage_release_ledger.sql`은 Images 변환, per-IP read, 멱등 storage release 원장을 추가한다. 서버 전송·저장본 1 MiB, 5분 서명 티켓, 재사용 차단, IP 업로드/조회 제한, 동시 삭제 중복 차감 차단, 일일 20회/20 MiB, 약 3.2 GiB/12,800 writes/4,000 Images transformations/800,000 monthly Class B reads/16,000 daily D1-tracked reads 자동 중단, 관리자 whole-R2 긴급 스위치, redacted webhook을 로컬 하네스로 검증했다. `0020`~`0022` 원격 적용, post-`0022` R2/D1 reconciliation, R2 사용자 결제/약관 완료는 남는다.

5. 로컬 저장 기반 좋아요/팔로우/저장은 계정 복구 전략이 필요하다.
   - 다음 작업: TestFlight 내부 단계에서는 익명 세션 유지 정책을 문서화하고, 외부 테스트 전 서버 복구 전략을 결정한다.

6. CORS와 익명 세션 남용 방어를 강화해야 한다.
   - 현재 상태: 완료-local. staging/production 브라우저 쓰기는 `SILSIGAN_API_ALLOWED_ORIGINS`의 정확한 HTTPS origin만 허용하고, 미설정은 `ORIGIN_POLICY_REQUIRED`, 불일치는 `ORIGIN_NOT_ALLOWED`로 차단한다. `0023_anonymous_session_proofs.sql`과 공유 client는 익명 ID에 별도 256-bit server-issued proof를 결합하고 hash만 D1에 저장하며 만료·회전·폐기를 지원한다. `0024_anonymous_session_cost_guard.sql`은 POP가 다른 분산 발급도 D1 전역 5,000/day에서 원자적으로 차단하고 `0` 킬 스위치·원장 누락 실패 폐쇄·만료 원장 정리를 제공한다. 로컬 공격 회귀는 ID-only 탈취, 잘못된 proof, 회전 전 proof, 폐기된 proof, 분산 상한 초과를 모두 거부한다.
   - 외부 게이트: staging D1에 `0023`/`0024`를 적용하고 `SILSIGAN_ANON_SESSION_REQUIRED=1`, `SILSIGAN_ANON_SESSION_DAILY_LIMIT=5000`, 선택한 exact Pages origin으로 API Worker를 배포한 뒤 실제 preflight/write 및 proof issue/rotation/revocation/replay/issuance-budget smoke를 남긴다. ID와 proof 전체가 함께 탈취되는 브라우저 완전 침해까지 막아야 한다면 member/device binding을 별도 결정한다.

## 10년차 마케터 관점 실행 계획

### 포지셔닝

핵심 문구:

> 출발 전, 방금 올라온 사진으로 지금 분위기를 확인하세요.

앱을 "지도앱"으로 홍보하지 않는다. 지도는 보조 기능이고, 메인 가치는 "오늘 갈 곳의 현장 사진"이다.

### 전국 출시 + 초기 집중 키워드

서비스 접근·검색·제보는 첫날부터 전국에 공개한다. 다만 초기 마케팅 예산과 현장 콘텐츠 확보는 특정 상황형 키워드에 집중하며, 다른 지역을 잠그지 않는다.

- 광안리 주차
- 황리단길 웨이팅
- 성수 카페 대기
- 제주 핫플 혼잡
- 한강/태화강 산책 상태

### 런칭 콘텐츠 전략

1. 내부 테스트 전: 핵심 지역의 검수된 사진/상태를 채운다. 샘플은 실제 현장 정보처럼 집계하지 않는다.
2. 내부 TestFlight: 5~10명에게 "출발 전 확인"과 "지금컷 올리기"만 테스트시킨다.
3. 외부 TestFlight 1차: 특정 지역/상황 키워드 중심으로 20명 테스트.
4. 홍보 문구는 "실시간 데이터"보다 생활어를 쓴다.
   - "광안리 주차 지금 막힘"
   - "황리단길 웨이팅 사진으로 확인"
   - "출발 전에 10초만 보기"

실행 담당, 일별 슬롯, 최소 공급량, 검수 SLA와 중단 조건은 `docs/launch-seed-operations-plan.md`를 단일 운영표로 사용한다. 전국 접근은 유지하되 유료 지역 홍보는 코드의 30곳·7일 100건·위치 확인 30건·사진 30건·검수 준비 완료 게이트를 모두 통과한 뒤 시작한다.

## 검증 게이트

로컬 UI 게이트:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- 390x844 브라우저 홈/검색/올리기/지도/마이 스크린샷
- 지도 핀 클릭 후 미리보기 카드 스크린샷

staging 게이트:

- `pnpm smoke:staging`
- `SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin`
- `pnpm smoke:pages`
- `pnpm smoke:tail-redaction`
- `pnpm release:status -- --strict`

실기기 게이트:

- iPhone TestFlight 또는 local build 설치
- Android debug/internal build 설치
- 위치 허용/거부, 사진 업로드, 댓글, 좋아요, 신고, 지도 핀 클릭, 뒤로가기 확인

## 남은 외부 blocker

- R2 활성화 및 bucket evidence
- staging/production API URL
- real staging smoke
- iPhone/Android 실기기 QA
- TestFlight 내부 테스트 빌드

2026-07-19 완료 증거:

- 최신 photo-first 프런트엔드를 `https://silsigan-web-staging.dudqks0319.workers.dev`에 배포했다.
- API가 없을 때 가짜 장소·랭킹을 표시하지 않고 무데이터 안내와 검색/지도 복구 행동을 제공하는 읽기 전용 staging smoke가 통과했다.
- production privacy/support URL은 각각 `/privacy`, `/support`에서 HTTP 200과 필수 정책 문구를 확인했다.
- staging/production API 환경의 브라우저 쓰기 origin을 각 web Worker의 정확한 HTTPS origin으로 고정하고 회귀 테스트를 추가했다.

App Store 정식 제출은 위 항목 완료 전까지 보류한다.

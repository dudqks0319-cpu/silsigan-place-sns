# #실시간 GitHub 진행 현황 - 2026-07-10

## 기준 브랜치

- Branch: `codex/silsigan-progress-20260710`
- 상태: 로컬 Cloudflare 전환과 사진 중심 UX 작업을 묶은 검토용 스냅샷
- 출시 판정: `blocked-external` - TestFlight 내부 테스트 및 App Store 제출 준비가 아직 완료되지 않음

## GitHub에 포함한 범위

- 사진 우선 홈, 검색, 업로드, 지도, 마이 탭 기반의 전국 장소 앱 UI
- 네이버 지도 SDK 로딩 및 실패 시 fallback 지도, 관광/장소 검색 흐름, 작은 장소 핀과 상세 시트
- Cloudflare Worker/D1/KV/Durable Object 기반 장소, 게시물, 해시태그, 질문, 좋아요, 댓글, 신고, 랭킹 read/write 경로
- R2 사진 업로드 준비, 사진 preview/click/delete/report UI, UGC 운영·비용·TestFlight·실기기 QA 문서
- staging/production D1 `0002` 원격 적용 증적, Cloudflare 배포 사전점검 및 smoke/release harness
- 로컬 검증 아티팩트, 앱에 필요한 fallback 사진 자산, 테스트와 release ledger 업데이트

## 이번 브라우저 확인

- `127.0.0.1:3001`은 #실시간이 아니라 다른 프로젝트를 제공하고 있었다. 포트만 보고 QA 결과를 판단하면 안 된다.
- #실시간은 별도 `127.0.0.1:3002`에서 열었고, 제목과 기본 앱 셸은 렌더링됐다.
- 첫 브라우저 캡처는 `실시간 데이터를 불러오는 중입니다` 초기 상태에서 이뤄졌다. 서버 로그에서는 로컬 장소·게시물·해시태그·질문 API가 `200`으로 응답했지만, 응답 이후의 화면을 이번 검토에서 다시 캡처하지는 못했다.

## 이번 검증 스냅샷

- `pnpm lint`: pass
- `pnpm typecheck`: pass
- `pnpm test`: 133 / 133 pass. 일반 샌드박스에서는 로컬 포트 생성 제한으로 한 smoke가 실패했지만, 같은 테스트를 로컬 포트 권한이 있는 환경에서 다시 실행해 통과를 확인했다.
- `git diff --check`: 생성 증적 로그의 줄 끝 공백을 정리한 뒤 pass

## 현재 가능한 것

- 로컬 코드와 smoke/test harness 기준으로 지도, 지역 범위, 장소 상세, 사진 UI, 댓글/좋아요/신고/랭킹/공유 흐름을 검증할 기반이 있다.
- Worker와 D1 schema/seed, 운영 신고 분리, ranking abuse smoke, privacy/support 페이지, 실기기 QA 템플릿은 구현 또는 문서화돼 있다.
- 사진 중심으로 전환하는 UI 자산과 fallback preview는 로컬 코드에 반영돼 있다.

## 아직 막힌 것

- Cloudflare R2 subscription 및 staging/production bucket 증적: `R2_NOT_ENABLED`
- staging/production API 및 Pages 배포와 HTTPS URL 환경변수
- real staging API/Pages smoke, R2 mutation/admin smoke, Workers tail redaction 캡처
- iPhone/Android 실기기 위치·카메라·사진·UGC·지도 QA 증적
- final privacy/support HTTPS URL, TestFlight 내부 배포 및 외부 테스트

## 제품과 UX에서 먼저 고칠 점

1. 첫 화면의 약속을 `방금 올라온 장소 사진` 하나로 통일하고, 지도·랭킹은 보조 탐색으로 낮춘다.
2. 사진 서버가 준비되지 않은 환경에서는 `사진 올리기`를 정상 기능처럼 보이게 하지 말고, 상태 제보 대체 행동과 준비 상태를 명확히 보여준다.
3. 홈 첫 화면의 데이터 배너, 알림, 검색, 챌린지, 랭킹을 줄여 3초 안에 사진, 장소, 시간, 올리기 행동만 이해되게 만든다.
4. 사진 확인, 신고, 삭제, 아이콘 버튼을 44px 이상의 모바일 터치 영역으로 통일한다.
5. 장소 상세는 운영 패널이 아니라 `최근 사진 + 몇 분 전 + 지금 갈지 판단`을 먼저 보여주는 사진 피드로 재구성한다.

## TestFlight 전 기술 위험

1. HEIC/HEIF는 로컬 네이티브 경로에서 bounded JPEG로 자동 변환하고 JPEG magic byte까지 확인하도록 해결했다. 실제 iPhone 사진 보관함·카메라 회귀 증거는 staging 실기기 QA에서 아직 필요하다.
2. 글·사진·신고 제한이 브라우저가 보내는 익명 ID에 크게 의존한다. ID 교체만으로 제한을 우회하지 못하도록 Worker 발급 세션, 서명 쿠키, IP/Turnstile 기반 제한을 추가해야 한다.
3. 사진은 현재 `upload-ticket` 발급 후 multipart binary로 Worker에 전달하는 로컬 계약으로 전환됐다. 기존 `/api/photos/complete` base64 경로는 호환 테스트와 이전 클라이언트 추적용으로 남아 있으므로, staging에서 새 binary 경로를 우선 검증하고 legacy 경로의 폐기 시점을 별도로 결정해야 한다.
4. 네이버 외부 검색 결과는 저장하지 않고, 별도 수동 입력만 비공개 장소 추가 요청 큐에 접수한다. 요청은 자동 공개되지 않으며 운영자의 주소·좌표 검증과 수동 import 절차가 staging에서 필요하다.
5. Worker CORS와 realtime heartbeat는 운영 도메인 제한과 abuse rate limit을 다시 점검해야 한다.

## 다음 실행 순서

1. R2를 활성화하고 staging bucket evidence를 통과시킨다.
2. staging API/Pages를 배포하고 URL을 설정한다.
3. 실 데이터로 홈 로딩, 업로드, 댓글, 좋아요, 랭킹, 신고를 staging에서 smoke한다.
4. iPhone과 Android 실기기 QA 증적을 채운다.
5. 이 조건이 충족된 뒤 TestFlight 내부 테스트를 시작한다.

상세 release source of truth는 `docs/current-release-state.md`, 운영 실행 순서는 `docs/cloudflare-staging-operator-packet.md`, 사진 우선 UX 방향은 `docs/photo-first-development-plan.md`를 따른다.

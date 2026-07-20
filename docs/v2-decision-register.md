# #실시간 V2 의사결정 및 완료 기준

Updated: 2026-07-10

이 문서는 V2 구현 전에 남았던 11개 의사결정을 권장안으로 고정하고, 로컬 코드 완료와 외부 운영 완료를 분리한다. 외부 콘솔 설정이나 계약 확인이 필요한 항목은 코드가 준비돼도 `외부 확인 필요`로 남긴다.

법무·운영·광고의 named sign-off와 stop condition은 `docs/v2-legal-operations-gate.md`에서 관리한다.

## 결정 상태

| 번호 | 권장 결정 | 로컬 적용 | 외부 완료 조건 |
| --- | --- | --- | --- |
| 1 | NAVER Cloud의 **Web Maps** 애플리케이션을 사용하고 staging/production HTTPS origin만 등록한다. 키 누락·인증·SDK·타임아웃·리소스 실패를 서로 다른 상태로 표시한다. | `NaverMap.tsx`가 실패 원인을 구분하고 목록 fallback과 재시도를 제공한다. | NAVER Cloud Console에서 Web Maps 활성화, 실제 staging/production origin 등록, 키 제한 확인, 두 배포 URL에서 지도 또는 명시적 fallback 증거 캡처. 담당: release-operator. |
| 2 | 기존 Cloudflare D1을 유지한다. Supabase로 회귀하거나 V2 패치의 Supabase migration을 적용하지 않는다. | Worker/D1/R2/KV/Durable Objects 구조와 additive `0004`~`0015` migration chain을 유지한다. | staging에서 migration 적용·읽기 검증 후 production 별도 승인. 담당: data-operations. |
| 3 | production에서 Worker API URL이나 D1이 없으면 즉시 실패한다. mock/demo로 자동 전환하지 않는다. | production demo 차단, Worker 미설정 fail-closed, D1 미설정 `503` 계약과 테스트가 있다. | 실제 production URL에서 demo/mock 응답이 없음을 smoke로 확인. 담당: release-operator. |
| 4 | SNS 홈 피드와 공개 운영 요약은 기본 비활성화한다. 운영 화면은 역할 기반 관리자만 접근한다. | `SOCIAL_FEED_ENABLED=false`; 사용자 홈은 방문 판단 중심이며 관리자 API는 operator/moderator/admin 권한을 요구한다. | staging 관리자 계정별 허용·거부 증거. 담당: trust-safety. |
| 5 | CCTV·YouTube·외부 이미지/영상은 권리 확인 전 비활성화한다. CCTV는 메타데이터만 처리하고 영상 URL 저장·노출·중계는 금지한다. | 출처 레지스트리가 권리·health·활성화 조건을 모두 통과해야 수집한다. CCTV는 `official_static`, `video_use_allowed=0`, `agreement_required=1`; `LIVE_STREAMS_ENABLED=false`다. | 제공기관 약관, 상업 이용, 표시 문구, 임베드 조건, 채널/영상 권리 소유자를 문서화하고 legal-safety 승인. |
| 6 | 운영 역할은 operator/moderator/admin으로 분리하고 신고 SLA를 적용한다. | `docs/ugc-moderation-runbook.md`, 역할별 API gate, 감사 로그, 사용자 제한, 사진 승인/거절 흐름이 있다. | 실제 담당자와 온콜 연락처 지정, webhook secret 설정, staging 큐에서 SLA 연습. 담당: trust-safety lead. |
| 7 | 1차 모바일은 Capacitor WebView로 출시하고 app id는 `kr.silsigan.mobile`로 고정한다. Expo 앱은 후속 네이티브 실험으로 유지한다. | `apps/webview`에 HTTPS·origin fail-closed 셸과 bridge 계약을 둔다. 기존 `apps/mobile`은 삭제하지 않는다. | iOS/Android 프로젝트 생성, 서명, staging 빌드, 실기기 QA, TestFlight/Android internal evidence. 담당: mobile-release. |
| 8 | 위치·개인정보·UGC·계정삭제·공공데이터 약관을 정식 출시 전에 법무 검토한다. | 최소수집, 좌표 미저장, 사진 재인코딩, 동의/약관/삭제 데이터 구조, 공개 privacy/support 페이지가 있다. | 법무 검토자 이름·검토일·정책 버전·최종 HTTPS URL을 release ledger에 기록. 담당: legal-safety. |
| 9 | 광고는 M6 KPI 검증 후 정책 검토를 거쳐 M8 이후에만 활성화한다. | `ADS_ENABLED=false`; 광고 SDK와 광고 위치를 production 경로에 넣지 않는다. | KPI, 동의/추적 정책, 스토어 표시, 광고 네트워크 약관, 비회원 처리 검토 후 별도 변경 승인. 담당: product + legal-safety. |
| 10 | 원본 사진은 보관하지 않는다. 서버에서 메타데이터 제거와 재인코딩을 끝낸 파생본만 저장하고 공개 전 검수한다. | EXIF/GPS 제거, 픽셀 재인코딩, 원본 파일명 비노출, pending moderation, 승인/거절/삭제 경로와 테스트가 있다. | staging R2/Images 실제 업로드에서 원본 부재·메타데이터 제거·삭제 증거. 담당: data-operations + trust-safety. |
| 11 | 익명 우선 + 선택적 회원 전환의 하이브리드를 채택한다. 회원 로그인을 강제하지 않는다. | 익명 소유권·삭제와 서명된 member identity 연결 seam이 공존한다. 외부 인증 제공자는 아직 활성화하지 않는다. | 회원 동기화가 실제 필요해질 때 인증 제공자, 계정 복구, 탈퇴, 연령·동의 정책을 별도 승인. 담당: product + security. |

## 11번: 익명과 회원의 차이

| 구분 | 익명 | 회원 |
| --- | --- | --- |
| 시작 마찰 | 로그인 없이 바로 탐색·제보 가능 | 로그인/동의 화면이 필요 |
| 소유권 기준 | 현재 브라우저 또는 앱 세션에 연결 | 검증된 계정 subject에 연결 |
| 기기 변경 | 활동 복구가 어렵다 | 계정 로그인으로 복구·동기화 가능 |
| 신뢰·제재 | 기기 삭제/재설치에 약하고 복구가 제한적 | 누적 신뢰, 제재, 이의제기, 계정 복구가 명확 |
| 개인정보 운영 | 수집이 적고 단순 | 이메일/소셜 식별자, 탈퇴·복구·보안 운영이 추가 |
| 현재 V2 사용 | 기본 탐색·제보·차단·삭제 | 서버가 검증한 서명으로 기존 익명 활동을 연결할 수 있는 호환 구조만 준비 |

현재 권장 UX는 **탐색과 현장 제보는 익명으로 즉시 사용**, **여러 기기 동기화나 신뢰 이력 복구가 필요한 사용자만 회원으로 전환**하는 방식이다. 클라이언트가 보낸 `memberId`를 그대로 신뢰하지 않으며, 서버 검증과 서명 없이 회원 권한을 부여하지 않는다.

## 공공데이터 활성화 규칙

출처는 아래 조건을 모두 만족해야 운영 수집이 가능하다.

1. `commercial_use_status`가 `allowed` 또는 `allowed_with_attribution`이다.
2. 필요한 계약과 표시 문구가 확인됐다.
3. `enabled=1`이고 허용 지역이 명시됐다.
4. health가 `healthy` 또는 `degraded`이며 TTL이 설정됐다.
5. 정적 출처는 장소 메타데이터에만 쓰고 현재 상태 판단에서 제외한다.

| source key | 용도 | 현재 정책 | 공식 문서 |
| --- | --- | --- | --- |
| `kma_weather` | 공식 주기 날씨 | 표시 문구 포함, key/health/운영 활성화 전까지 disabled | https://www.data.go.kr/data/15084084/openapi.do |
| `tour_api` | 관광지 정적 메타데이터 | pending, 이미지 사용 금지, 현재 상태 제외 | https://www.data.go.kr/data/15101578/openapi.do |
| `national_parking` | 주차장 시설·요금 정적 메타데이터 | pending, 실시간 빈자리로 해석 금지 | https://www.data.go.kr/data/15012896/standard.do |
| `national_traffic` | 도로 평균 속도·소통 상태 | pending, 권리·key·health 승인 후에만 실시간 신호 허용 | https://www.data.go.kr/data/15040463/openapi.do |
| `national_cctv` | CCTV 위치·도로 메타데이터 | pending, 영상 URL 저장·노출·중계 금지 | https://www.data.go.kr/data/15040466/openapi.do |
| `seoul_realtime_city` | 서울 지역 실시간 데이터 | region flag와 source approval 모두 꺼짐 | https://data.seoul.go.kr/dataList/OA-21285/A/1/datasetView.do |
| `youtube_live` | 승인된 채널 live embed | live flag와 source approval 모두 꺼짐 | https://developers.google.com/youtube/iframe_api_reference |

## 완료 판정

- 로컬 완료: 코드, migration, 테스트, 문서, fail-closed gate가 통과한 상태.
- 외부 완료: 콘솔 설정, 키·계약, 배포, 실제 migration, 실기기, 운영 담당자 증거가 확인된 상태.
- 두 상태를 합쳐서 말하지 않는다. 외부 완료 조건이 남아 있으면 전체 출시 상태는 계속 `blocked-external`이다.
- 원격 D1에서 `0006` 안전 마이그레이션이 빠지면 릴리즈 게이트는 `D1_0006_NOT_APPLIED`로 중단한다.

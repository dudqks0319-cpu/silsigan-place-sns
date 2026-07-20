# 실시간 V2 통합 완성 계획서 — 2026-07-21

## 1. 문서 목적과 기준점

이 문서는 기존 제품 계획, Mac mini에서 반영한 `5055e62`, 현재 통합 변경을 하나의 실행 기준으로 합친다. 목표는 화면을 보여주는 데모가 아니라, 전국 기본 정보와 집중 지역의 최신 현장 정보를 안전하게 운영하는 웹·WebView 베타를 완성하는 것이다.

- 통합 시작 기준: `5055e623c06bba9c6bd584adf92fc3215c7d727c`
- 기준 브랜치: `codex/silsigan-progress-20260710`
- 현재 제품 원칙: 정보 없음은 여유가 아니며, 만료·샘플·미승인 정보는 현재 판단에서 제외한다.
- 출시 순서: WebView·웹 베타 → 집중 지역 운영 검증 → 동일 API 기반 네이티브 고도화
- 배포 원칙: production 배포와 production migration은 별도 승인 전 금지한다.
- 비용 원칙: 사진, 외부 API, 지도, 객체 저장소, 이미지 변환처럼 사용량에 따라 비용이 늘 수 있는 경로는 인증·할당량·예산·긴급중단을 먼저 적용한다.

이 문서에 적힌 완료는 세 종류로 구분한다.

- `코드 완료`: 저장소 구현과 자동 테스트로 확인
- `staging 완료`: 실제 외부 리소스에 연결하여 성공·실패 경로를 확인
- `운영 완료`: production 설정, 실기기, 담당자, 법률·스토어 증거까지 확인

## 2. 현재 진행률

전체 목표 대비 가중 진행률은 **57/100**이다. 이 수치는 자동 테스트 개수가 아니라 실제 출시 게이트의 완료 비중이다.

| 영역 | 가중치 | 현재 점수 | 판정 |
| --- | ---: | ---: | --- |
| 제품·도메인·웹 UI | 20 | 18 | 핵심 방문 판단 흐름과 전국 탐색 UI는 구현, live 운영 검증 필요 |
| 로컬 백엔드·보안 | 20 | 18 | D1/R2/API·비용 방어 코드는 강함, target 환경 관측 필요 |
| 전국 데이터 어댑터·운영 | 15 | 7 | 어댑터와 fixture는 있음, 실제 권리·키·health 활성화 미완료 |
| 외부 staging 인프라 | 15 | 7 | 일부 D1·Worker 이력은 있음, R2와 건강한 API 연결 미완료 |
| 실제 사진·검수 운영 | 10 | 3 | 처리·검수 계약은 있음, 실제 private R2 증거 미완료 |
| 모바일·실기기·스토어 | 10 | 2 | 셸과 시뮬레이터 일부 확인, iOS/Android 실기기 미완료 |
| 법률·운영·마케팅 베타 | 10 | 2 | 문서 골격은 있음, 서명·담당자·실측 KPI 미완료 |
| **합계** | **100** | **57** | **production 승격 금지** |

별도의 준비도는 다음처럼 해석한다.

- 로컬 코드 준비도: 약 90%
- 실제 staging 사용 가능성: 약 45%
- 공개 production 출시 준비도: 약 25~30%

## 3. 확정된 제품 범위

### 3.1 이번 베타에 포함

- 전국: 장소 기본정보, 날씨, 관광정보, 주차장, 주요 도로, CCTV 메타데이터
- 집중 운영: 울산·부산·경주의 Tier A 12~15곳과 Tier B 20~35곳
- 홈: 현재 위치 또는 수동 지역, 최신 근거가 있는 주변 장소, 검색, 카테고리
- 지도: 목록 fallback, 정보 없음 상태, 지역 탐색, 장소 선택
- 장소 상세: 인파·대기·주차·날씨·현장·도로·운영 근거와 출처·관측시각
- 현장 제보: 사용자가 실제 확인한 항목만 선택, 사진 선택 사항, 일반/현장 인증 구분
- 안전: 신고, 차단, 계정 삭제, 관리자 검수, audit log
- 플랫폼: Next.js 웹과 Capacitor WebView가 같은 API 계약 사용

### 3.2 이번 베타에 포함하지 않음

- 범용 길찾기·턴바이턴 내비게이션
- DM, 실시간 채팅, 팔로우, 사용자 위치 공유, 이동 경로 저장
- 전국 음식점의 실제 대기팀 수를 공공데이터처럼 표시
- 사용자 동영상 업로드·라이브 방송
- CCTV 저장·재송출·인원수 확정
- 얼굴·번호판 인식 결과 저장
- 현금·광고 시청 연계 제보 보상
- 권리 미확인 영상·이미지·외부 리뷰 크롤링
- 광고 SDK 활성화

## 4. 모든 직군에 공통인 절대 완료조건

- [ ] 현재 상태마다 `sourceType`, 출처명, `observedAt`, `expiresAt` 또는 공식 갱신 규칙이 있다.
- [ ] 만료·샘플·미승인·`official_static` 데이터가 현재 종합 판단에 들어가지 않는다.
- [ ] 정보 부족이 한산함, 주차 가능, 영업 중으로 대체되지 않는다.
- [ ] 단일 일반 UGC 한 건으로 강한 혼잡 판정을 만들지 않는다.
- [ ] 동일 사용자의 반복 제보를 독립 합의로 계산하지 않는다.
- [ ] 사진 최종 업로드는 1MiB 이하이고, 서버가 크기·MIME·magic byte를 재검증한다.
- [ ] 원본·정확한 GPS·토큰·private object key가 공개 응답 또는 로그에 없다.
- [ ] 승인 전 사진과 제보의 공개 노출은 0건이다.
- [ ] 유료/사용량 기반 경로는 인증, burst·rolling·daily quota, idempotency, one-time ticket, 전역 예산, 60/70/80% 단계 방어, 수동 긴급중단을 갖는다.
- [ ] production에서 demo API 응답과 운영 판단용 샘플 데이터는 0건이다.
- [ ] 위치 권한 없이도 수동 지역과 장소 목록을 사용할 수 있다.
- [ ] 지도·외부 API·사진 저장 장애가 앱 전체를 막지 않는다.
- [ ] lint, typecheck, 전체 test, web build, Cloudflare build/dry-run, WebView/mobile 검증이 같은 source SHA에서 통과한다.

## 5. 역할별 실행 계획

### 5.1 제품 기획·PM

목표는 사용자가 10초 안에 “지금 가도 될 가능성”과 그 이유를 이해하게 하는 것이다.

작업:

- [ ] Tier A 12~15곳과 Tier B 20~35곳을 장소 ID·카테고리·운영자와 함께 확정한다.
- [ ] 전국 Tier C는 기본정보 중심, Tier A/B만 fresh coverage 목표를 적용한다.
- [ ] 음식점·해변·축제·스키장·공원·시장별 필수 차원과 Decision Profile을 확정한다.
- [ ] “긍정”, “확인 필요”, “혼잡 가능”, “정보 부족” 판정 문구와 근거 규칙을 승인한다.
- [ ] 홈·지도·상세·공유 카드가 같은 집계 결과를 쓰는지 계약 테스트로 고정한다.
- [ ] P0/P1/P2와 기능 플래그의 서버·클라이언트 적용 범위를 릴리스마다 검토한다.

완료 증거:

- 장소 운영 명부, Decision Profile fixture, 기능 플래그 표, KPI 대시보드 정의
- 홈·지도·상세 동일 상태 테스트
- 샘플·만료·미승인 제외 테스트

### 5.2 마케팅·성장

포지셔닝은 “지도 대체”가 아니라 “출발 전 방문 판단 레이어”다.

작업:

- [ ] 고객 노출 이름과 부제를 `실시간 - 지금 가도 될까?` 계열로 사용자 테스트한다.
- [ ] 핵심 카피를 “출발 전, 지금 상황만 확인하세요”와 최신 근거 설명으로 통일한다.
- [ ] 검증되지 않은 “15초”, “전국 실시간”, “정확한 혼잡도” 표현을 광고 문구로 사용하지 않는다.
- [ ] 실제 최근 30분 정보가 있는 장소 수만 커버리지로 표시한다.
- [ ] 저장 장소, 제보 승인, 새 정보 알림을 초기 리텐션 수단으로 측정한다.
- [ ] 제보 기여 문구는 실제 조회·도움 집계가 있을 때만 표시한다.
- [ ] Tier A 베타 모집, 주말 운영, 지역 파트너 후보, 위기 커뮤니케이션 문구를 준비한다.

KPI:

- Tier A fresh signal coverage 70% 이상
- 장소 상세 진입률, live status 조회율
- 제보 시작 대비 완료율과 완료시간 중앙값
- D1/D7 재방문, 저장 장소 재조회율
- 허위 제보율, 신고 처리시간, 정보 만료 오노출률

### 5.3 UI/UX·디자인

작업:

- [ ] 360·390·430px에서 홈, 지도, 상세, 제보, 마이, 관리자 핵심 흐름을 재검증한다.
- [ ] 장소 종류에 따라 가장 중요한 3개 상태를 먼저 보여주고 나머지는 접는다.
- [ ] 신뢰도는 “높음/보통/낮음 + 설명”을 먼저 보여주고 숫자는 상세에 둔다.
- [ ] `unknown`은 회색·문자·접근성 라벨로 표시하고 `normal`과 구분한다.
- [ ] loading, empty, error, success, permission denied, stale, offline 상태를 각각 설계한다.
- [ ] 모든 주요 터치 대상 44px 이상, 메타 글자 11~12px 이상, 색상 대비를 검증한다.
- [ ] `:focus-visible`, 모달 focus trap, Esc, reduced motion, 스크린리더 이름을 확인한다.
- [ ] 지도 실패 시 목록·재시도·수동 지역을 같은 화면에서 제공한다.
- [ ] 동작하지 않는 버튼은 숨기거나 “준비 중”으로 명시한다.

완료 증거:

- 동일 source SHA의 360·390·430px 스크린샷
- 키보드·스크린리더·reduced motion 체크리스트
- 오류·권한 거부·오프라인 복구 화면 증거

### 5.4 프론트엔드

작업:

- [ ] UI가 외부 API 응답을 직접 해석하지 않고 V2 normalized API만 사용하게 한다.
- [ ] 홈·지도·상세·공유가 동일한 `AggregatedPlaceStatus`를 사용한다.
- [ ] 위치 기반 거리 정렬과 수동 지역 날씨 연결을 검증한다.
- [ ] 지도 영역 검색, 목록 전환, 필터, 클러스터, 딥링크를 단계적으로 완성한다.
- [ ] 최종 사진을 1MiB 이하 JPEG/WebP로 반복 축소하며, 축소 실패 시 업로드하지 않는다.
- [ ] 로컬 선택 원본은 최대 12MiB까지만 읽고, 서버에는 1MiB 이하 파생본만 보낸다.
- [ ] `data:`, `javascript:`, 비허용 외부 이미지 URL을 차단한다.
- [ ] feature flag가 UI뿐 아니라 API 응답과 일치하도록 계약 테스트를 유지한다.
- [ ] 네트워크·지도·사진 업로드 취소와 재시도를 bounded 상태로 처리한다.

완료 증거:

- browser E2E와 모바일 폭 스크린샷
- 1MiB 경계, 이미지 URL, stale/unknown 계약 테스트
- 홈·지도·상세 상태 일치 테스트

### 5.5 백엔드·Cloudflare

작업:

- [ ] staging D1 migration registry와 실제 schema를 read-only로 재확인한다.
- [ ] R2 활성화 후 private original/derived bucket과 public custom-domain 차단을 확인한다.
- [ ] staging API Worker를 실제 application version으로 배포하고 `/health`와 `/api/places`를 200으로 만든다.
- [ ] Vercel/Sites/Workers 웹 origin과 API `allowedOrigins`를 정확한 HTTPS host로 연결한다.
- [ ] 제보 등록 → pending → 승인 → live signal → 집계 → 조회 흐름을 staging에서 증명한다.
- [ ] 승인·숨김·만료·계정 삭제 때 집계와 객체 상태를 일관되게 갱신한다.
- [ ] production D1은 backup, dry-run, 승인, migration, 검증, forward-fix 계획이 모두 준비된 뒤에만 적용한다.
- [ ] rollback은 Worker version과 D1/R2 데이터 복구를 분리해 기록한다.

비용·봇 방어 완료조건:

- 사진 최종 1MiB, 사용자/세션/IP fingerprint 일 20회, IP fingerprint 일 20MiB 이하
- anonymous session 발급·회전·재사용 방어
- idempotency와 one-time upload ticket
- 변환 전 quota 예약, 중복 hash 재처리 금지
- 짧은 timeout, bounded retry, circuit breaker, queue/concurrency 상한
- 전역 60% 경고, 70% 비필수 축소, 80% 자동중단, 수동 긴급중단
- raw IP는 저장하지 않고 짧은 보유기간의 keyed fingerprint만 사용
- 목표 환경에서 alert와 stop/resume를 실제 관측

### 5.6 데이터 엔지니어링·공공데이터

활성화 순서:

1. 기상청
2. TourAPI
3. 전국주차장정보
4. 국토부 ITS 교통
5. ITS CCTV 메타데이터
6. 경찰 교통
7. 서울 실시간 도시데이터
8. 권리 승인된 라이브

소스별 작업:

- [ ] 문서 URL, 이용조건 URL, 상업 이용, 출처표시, 재배포, 담당자를 registry에 기록한다.
- [ ] 키 소유자, quota, 활성 지역, refresh, TTL, cache, stale fallback을 승인한다.
- [ ] raw schema validation과 fixture contract test를 유지한다.
- [ ] `observedAt`을 제공하지 않는 데이터는 현재 신호가 아닌 정적 정보로만 쓴다.
- [ ] `fetchedAt`을 관측시각으로 대체하지 않는다.
- [ ] 전국 일괄 짧은 주기 수집 대신 격자·활성 지역·증분 수집을 사용한다.
- [ ] source health가 degraded/down이면 stale 또는 insufficient로 전환한다.
- [ ] CCTV는 URL 저장·프록시·재송출 없이 메타데이터와 외부 확인 범위만 관리한다.

완료 증거:

- 각 소스 권리 승인 기록
- 실제 staging ingestion run과 redacted health log
- fresh, stale, expired, quota, schema drift, provider down 계약 테스트

### 5.7 보안·개인정보

작업:

- [ ] 기본 deny 권한과 owner/admin 경계를 D1/API 통합 테스트로 검증한다.
- [ ] 위치 인증 결과를 클라이언트가 직접 지정하지 못하게 서버에서 계산한다.
- [ ] 정확한 GPS 대신 verification result와 distance/accuracy bucket만 보관한다.
- [ ] 원본 이미지 private, 승인 파생본만 공개, 예측 어려운 object key를 사용한다.
- [ ] MIME, magic byte, 크기, 픽셀, EXIF, 중복 hash, 악성 콘텐츠 검사를 업로드 상태머신에 연결한다.
- [ ] 관리자 역할, 사용자 제한, 신고, 이의제기, 삭제를 audit log에 남긴다.
- [ ] secret scan, dependency audit, IDOR/RLS 유사 경계, XSS, SSRF, URL injection, replay, quota bypass를 반복 검증한다.
- [ ] 로그에서 raw IP, 정확한 GPS, 이메일, 전화, 토큰, 원본 URL, 사용자 원문 메모를 제거한다.

### 5.8 법률·정책

법률 자문을 대체하지 않으며, 출시 전 담당자와 검토 일자를 기록한다.

- [ ] 서비스 이용약관
- [ ] 개인정보처리방침과 공개 HTTPS URL
- [ ] 위치기반서비스 이용약관 및 신고 대상 여부 검토
- [ ] UGC 운영·금지 콘텐츠·신고·차단·이의제기 정책
- [ ] 계정 삭제와 데이터 보유·파기 정책
- [ ] 아동·청소년 정책
- [ ] 공공데이터 출처표시와 소스별 이용권리 목록
- [ ] 영상·사진 라이선스 및 수정·재배포 조건
- [ ] 오픈소스 고지
- [ ] Apple App Privacy와 Google Play Data safety 응답

현재 확인에 사용할 공식 문서:

- 위치정보법: https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=277359
- 공공데이터 이용정책: https://www.data.go.kr/ugs/selectPortalPolicyView.do
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play UGC 정책: https://support.google.com/googleplay/android-developer/answer/9876937
- Google Play Data safety: https://support.google.com/googleplay/android-developer/answer/10787469

### 5.9 운영·고객지원

작업:

- [ ] operator, moderator, admin과 최소 권한을 지정한다.
- [ ] 신고 24시간 SLA, 자동숨김, 사용자 제한, 복구, 이의제기 절차를 훈련한다.
- [ ] source/API/R2/지도 장애 runbook과 on-call 연락 순서를 작성한다.
- [ ] 60/70/80% 비용 경보 수신자와 수동 kill switch 책임자를 지정한다.
- [ ] 백업, migration, rollback, orphan cleanup, 계정 삭제 작업을 정기 점검한다.
- [ ] Tier A 주말 운영에서 fresh coverage와 검수 대기열을 모니터링한다.
- [ ] 장애 공지, 데이터 부족, 만료, 위치 권한 거부 안내 문구를 승인한다.

### 5.10 모바일·스토어

작업:

- [ ] iOS/Android bundle/package `kr.silsigan.mobile`과 signing을 확정한다.
- [ ] HTTPS allowlist, 외부 링크 시스템 브라우저, mixed content 차단을 실기기에서 확인한다.
- [ ] 위치·카메라 권한을 사용자 행동 후에만 요청한다.
- [ ] 공유, 딥링크, 뒤로가기, Safe Area, 키보드, 오프라인, 설정 열기를 검증한다.
- [ ] exact GPS와 원본 사진 경로가 bridge 응답에 없는지 확인한다.
- [ ] iPhone과 Android 실제 기기에서 설치·로그인·제보·삭제 흐름을 완료한다.
- [ ] TestFlight와 Play internal testing의 build ID, source SHA, 실기기 결과를 각각 기록한다.

## 6. 단계별 실행 순서

### Phase 0 — 기준점과 증거 고정

- [x] `5055e62` 원격 기준점 확인
- [x] dirty primary를 건드리지 않는 별도 worktree 사용
- [x] Mac mini 변경과 기존 계획의 중복·충돌 검토
- [x] 사진 최종 1MiB와 비용 방어 계약 통합
- [x] 전체 verify, audit, secret scan, git diff 검증을 통합 source 후보에서 재실행
- [ ] release ledger와 개발자 인계서에 같은 SHA와 결과 기록

### Phase 1 — 사용자가 직접 완료해야 하는 외부 등록

- [ ] Cloudflare R2 약관·결제수단·활성화 확인
- [ ] NAVER Maps 애플리케이션 등록과 정확한 HTTPS origin 승인
- [ ] TourAPI·기상청·전국주차장 활용신청
- [ ] ITS 로그인·활용신청·키 발급
- [ ] 운영 도메인과 정책 URL 결정

이 단계는 약관 동의, 결제 가능성, 외부 계정 변경이 있으므로 자동으로 최종 제출하지 않는다.

### Phase 2 — Cloudflare staging 연결

- [ ] R2 private bucket과 권한 확인
- [ ] staging API application deploy
- [ ] staging web/API origin 연결
- [ ] D1 schema/registry/seed read-only 확인
- [ ] `/health`, 장소 조회, auth failure, quota failure smoke
- [ ] 승인된 한 건의 write smoke와 즉시 정리
- [ ] Worker rollback read-only selection과 승인된 실제 drill

### Phase 3 — 전국 공공데이터 활성화

- [ ] 권리와 키가 승인된 소스만 `enabled=true`
- [ ] KMA → TourAPI → 주차 → 교통 → CCTV 순으로 staging 활성화
- [ ] attribution, observedAt, expiresAt, health, stale fallback 확인
- [ ] 전국 기본 장소와 Tier A/B 중복 장소 검토 큐 확인

### Phase 4 — 실제 사진·제보·관리자

- [ ] 1MiB signed upload와 replay 거절
- [ ] private 저장, EXIF 제거, 재인코딩, 중복 거절
- [ ] pending → 승인/거절/숨김 → 공개 파생본
- [ ] 제보 승인 후 장소 상태 반영
- [ ] 신고·차단·계정 삭제·orphan cleanup
- [ ] 비용 경보·80% 중단·안전한 resume staging 증거

### Phase 5 — 브라우저·실기기 UX

- [ ] 360·390·430px live staging QA
- [ ] 지도 정상·인증 실패·timeout·fallback
- [ ] 위치 허용·거부·수동 지역
- [ ] iPhone/Android 권한·촬영·공유·딥링크·오프라인
- [ ] 접근성·스크린리더·키보드 검증

### Phase 6 — 법률·스토어·운영 서명

- [ ] 정책 공개 URL과 버전
- [ ] 담당자·검토일·보유기간·연락처
- [ ] App Privacy·Data safety
- [ ] 관리자 SLA와 on-call 훈련
- [ ] TestFlight/Play internal 배포와 실제 기기 증거

### Phase 7 — 집중 베타

- [ ] Tier A/B 운영 명부
- [ ] 주말 2회 이상 운영
- [ ] fresh coverage 70% 이상
- [ ] 지도 성공률 99% 이상
- [ ] crash-free session 99.5% 이상
- [ ] 신고 24시간 이내 처리
- [ ] 제보 완료시간 중앙값 15초 이하를 실측한 뒤에만 마케팅 문구로 사용

### Phase 8 — production 승격

production은 다음이 모두 참일 때만 별도 승인 후 진행한다.

- [ ] P0 external blocker 0개
- [ ] production D1 backup과 migration/forward-fix 승인
- [ ] R2, API Worker, custom domain, WAF, alerts가 production에서 관측됨
- [ ] demo API·샘플 현재 판단 0건
- [ ] 법률·스토어·운영 책임자 서명
- [ ] rollback 문서와 최근 drill
- [ ] 동일 source SHA의 자동·브라우저·실기기 증거

## 7. 현재 외부 차단 항목

- Cloudflare CLI 기준 R2 활성화가 확인되지 않음
- staging API는 배포 이력만 있고 건강한 application 응답을 제공하지 않음
- 현재 실행 환경에 staging/production web·API URL과 exact allowed-origin 값이 주입되지 않음
- production API Worker 미배포
- production D1 migration chain 미적용
- Sites는 OpenAI 로그인 보호 상태
- NAVER 등록 폼은 작성 중이며 최종 등록·운영 origin 증거가 없음
- TourAPI 현재 탭은 활용신청 완료 증거가 아님
- KMA·주차·ITS 실제 키와 권리 승인 증거가 없음
- iOS/Android 실기기와 store signing 증거가 없음
- 법률 검토자·운영자·on-call·정책 공개 URL이 확정되지 않음

## 8. 롤백과 변경 통제

- 소스 변경은 작은 커밋으로 남기고 원격 SHA를 확인한다.
- D1 migration은 되돌림 SQL보다 backup + forward-fix를 기본으로 한다.
- Worker rollback은 코드 버전만 되돌리며 D1/R2/KV 상태를 자동으로 되돌렸다고 간주하지 않는다.
- 공공데이터 소스는 source registry kill switch로 개별 비활성화한다.
- 사진·API 비용 이상은 비필수 경로 축소 후 전역 중단하며, privacy·계정 삭제·긴급 운영 경로의 최종 reserve를 보존한다.
- 운영 장애 시 live 값을 숨기고 기본 장소·정적 정보·정보 부족 상태를 제공한다.

## 9. 다음 작업자가 시작할 지점

1. `docs/developer-handoff-2026-07-21.md`를 읽는다.
2. canonical 브랜치와 release ledger의 source SHA가 같은지 확인한다.
3. `pnpm install --frozen-lockfile`과 workspace install을 실행한다.
4. `pnpm audit:security`, `pnpm verify`, `pnpm release:status`를 실행한다.
5. 외부 상태는 read-only로 먼저 확인하고, 사용자 전용 행동과 staging 변경을 분리한다.
6. production 배포·migration·약관 동의·결제 가능 등록은 별도 승인을 받는다.

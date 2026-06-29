# #실시간 제품/개발/GTM 실행 계획

Updated: 2026-06-29
Source of truth: `docs/current-release-state.md`, `RELEASE_STATUS.md`, `release-ledger.yaml`

## 1. 현재 판정

현재 #실시간은 App Store 정식 출시 후보가 아니다.
현재 목표는 Cloudflare-backed staging MVP와 TestFlight 내부 테스트 준비다.

로컬 웹/PWA 기준으로는 지도, 관광 장소, 사진 피드 방향, 장소 상세, 좋아요/신고/댓글 기반 구조가 MVP 후보 수준까지 올라왔다.
하지만 실제 출시 판단은 로컬 화면이 아니라 Cloudflare staging API/R2, 실기기 QA, TestFlight 내부 테스트 증거로 해야 한다.

현재 상태를 한 줄로 요약하면 다음과 같다.

> 로컬 제품 경험은 방향이 잡혔고, Cloudflare web/D1 증거는 상당히 확보됐지만, R2와 API Worker 실배포/실기기 QA가 아직 출시를 막고 있다.

## 2. 목표와 비목표

### 목표

Cloudflare staging 환경에서 실제 사진/댓글/좋아요/랭킹/신고 플로우가 돌고, iPhone/Android 실기기에서 핵심 사용 흐름을 증명한 뒤 TestFlight 내부 테스트를 시작한다.

### 이번 단계의 비목표

- App Store 정식 제출
- 대규모 전국 마케팅 집행
- 릴스/영상 피드
- 복잡한 SNS 팔로우/DM
- 자동 추천 AI 기능
- 유료화/광고 상품

## 3. 핵심 제품 포지션

#실시간은 예쁜 사진을 모으는 SNS가 아니다.
오늘 갈 장소가 지금 어떤지 빠르게 확인하는 실시간 장소 사진 앱이다.

대표 문구:

> 지금 사람들이 올린 장소 사진으로, 오늘 갈 곳의 분위기를 확인하세요.

사용자가 3초 안에 이해해야 하는 행동은 3개다.

1. 지금 올라온 장소 사진 보기
2. 해시태그로 장소 분위기 탐색하기
3. 내가 있는 장소 사진 올리기

지도는 핵심 화면이지만 첫 번째 메시지는 아니다.
첫 메시지는 "지도앱"이 아니라 "지금 올라온 장소 사진"이어야 한다.

## 4. 현재 미흡한 부분

### P0: 출시를 막는 항목

1. Cloudflare R2 미활성화
   - 현재 blocker: `R2_NOT_ENABLED`
   - 영향: 사진 업로드, 삭제, 숨김, R2 object evidence, staging mutation smoke 불가
   - 완료 기준: staging/production bucket 확인, 업로드/조회/삭제 smoke 통과

2. staging/production API Worker 미배포
   - 현재 blocker: `worker_deployment.staging.api`, `worker_deployment.production.api`
   - 영향: 로컬 fallback은 되지만 실제 staging 앱이 API로 동작한다는 증거 없음
   - 완료 기준: staging API smoke, production read-only smoke 통과

3. real staging mutation smoke 미완료
   - 영향: 댓글/사진/좋아요/신고/숨김이 실제 Cloudflare 리소스에서 동작하는지 미검증
   - 완료 기준: mutation smoke 로그, D1 row, R2 object, admin hide/delete evidence 확보

4. iPhone/Android 실기기 QA 미완료
   - 영향: TestFlight 내부 테스트 시작 근거 부족
   - 완료 기준: 위치 허용/거부, 카메라/사진 권한, 지도, 업로드, 댓글, 좋아요, 신고, crash 0 증거

5. 운영자 신고/숨김 루프 실증 미완료
   - 영향: UGC 앱의 리뷰/운영 리스크
   - 완료 기준: 신고 접수, 운영자 숨김, 사용자 화면 반영, 삭제/차단 확인

### P1: TestFlight 외부 테스트 전까지 정리할 항목

1. TestFlight 외부 리뷰 노트 최종화
2. 개인정보처리방침/지원 URL release shell export 확인
3. Cloudflare 비용/사용량 대시보드 캡처 기준 확정
4. 해시태그 금칙어/광고성 태그 차단 강화
5. 랭킹 조작 방지 smoke를 staging evidence로 승격
6. 빈 화면과 신규 지역 안내 문구 다듬기

### P2: 제품 완성도를 높이는 항목

1. 홈 피드 사진 밀도와 카드 리듬 개선
2. 올리기 플로우 5단계 고정
3. 장소 상세을 리뷰 페이지가 아니라 실시간 사진 그리드로 정리
4. 검색 탭에서 장소/해시태그/사진 결과 분리
5. 지역별 런칭 콘텐츠 seed 운영
6. 공유 카드/OG 이미지 품질 개선

## 5. 사용자 입장에서 필요한 것

### 첫 방문 사용자

사용자는 앱을 켜자마자 "여기서 뭘 하면 되는지" 알아야 한다.

필요한 화면:

- 홈 상단: `방금 올라온 사진`
- 지역 칩: 전체, 서울, 부산, 제주, 내 주변
- 해시태그 칩: #웨이팅, #주차만차, #한산함, #사진스팟, #야경
- 사진 피드: 장소명, 시간, 지역, 태그, 한 줄 설명
- 하단 탭: 홈, 검색, 올리기, 지도, 마이

성공 기준:

- 첫 화면에서 사진 카드가 바로 보인다.
- "지도부터 조작해야 하는 앱"으로 보이지 않는다.
- 3초 안에 "지금 장소 사진 보는 앱"으로 이해된다.

### 장소를 찾는 사용자

사용자는 지도보다 검색과 태그로 더 빨리 목적지 상태를 확인할 수 있어야 한다.

필요한 기능:

- 장소 검색
- 해시태그 검색
- 지역 검색
- 최근 많이 본 장소
- 지금 뜨는 지역
- 태그 상세 페이지

성공 기준:

- `광안리`, `성수`, `웨이팅`, `주차만차` 같은 검색이 자연스럽게 동작한다.
- 결과는 장소/해시태그/사진으로 나뉜다.
- 검색 결과에서 바로 장소 상세 또는 사진 피드로 간다.

### 사진을 올리는 사용자

업로드는 짧아야 한다.
복잡한 제보 양식은 MVP에서 이탈을 만든다.

필요한 플로우:

1. 사진 선택
2. 장소 선택
3. 해시태그 최대 5개 선택
4. 한 줄 입력
5. 올리기

성공 기준:

- 60초 안에 첫 사진을 올릴 수 있다.
- 위치 권한을 거부해도 지역/장소 선택으로 계속 진행된다.
- 원본 파일명, EXIF GPS, 민감 좌표가 노출되지 않는다.

### 신뢰와 안전

사진 기반 장소 앱은 신고/숨김이 제품 신뢰의 일부다.

필요한 기능:

- 사진/댓글/장소 신고
- 내 신고 내역 또는 처리 안내
- 차단/숨김 관리
- 운영자 숨김 반영
- 개인정보/지원 링크

성공 기준:

- 신고 버튼이 찾기 쉽다.
- 숨김 처리 후 일반 사용자 화면에서 콘텐츠가 사라진다.
- 지원/개인정보 화면이 TestFlight 리뷰 기준에 맞는다.

## 6. 개발자로서 필요한 것

### 안정적인 환경 분리

로컬 fallback은 개발 편의를 위해 필요하지만 staging/production 실패를 숨기면 안 된다.

필요한 작업:

- local Worker URL일 때만 same-origin fallback 허용
- staging/production HTTPS API 실패는 명확한 오류로 노출
- `.env.example`, operator packet, release shell export 값 일치
- release gate가 URL shape와 실제 deployment를 분리해서 검사

완료 기준:

- local에서는 Worker가 꺼져도 홈/지도 read path가 보인다.
- staging에서는 API Worker가 죽으면 실패가 숨겨지지 않는다.

### Cloudflare 리소스 실증

필요한 작업:

1. R2 subscription checkout
2. staging bucket 확인/생성
3. production bucket 확인/생성
4. API Worker staging deploy
5. API Worker production deploy
6. staging smoke
7. production read-only smoke

필수 증거:

- `pnpm cf:r2:evidence`
- `pnpm cf:external-state`
- `pnpm smoke:staging`
- `SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin`
- D1 row 캡처
- R2 object 캡처
- Workers tail redaction 로그

### 데이터/보안

필요한 작업:

- 업로드 파일명 UUID화
- 원본 파일명 미저장/미노출
- EXIF GPS 제거
- raw 좌표 공개 응답 금지
- 댓글 금칙 패턴 차단
- 신고/운영자 action audit trail
- admin token redaction
- 랭킹 조작 방지 staging smoke

완료 기준:

- 보안 gate 문서와 테스트가 local pass에서 staging evidence로 이어진다.
- 실사용자가 올린 UGC를 숨기고 복구하는 운영 절차가 증명된다.

### 모바일/TestFlight

필요한 작업:

- Capacitor/Expo shell의 staging URL 고정
- iOS 위치/카메라/사진 권한 문구 최종화
- Android 권한/뒤로가기 확인
- iPhone 실기기 QA
- Android 실기기 QA
- TestFlight 내부 배포 노트 작성

완료 기준:

- 내부 테스터 5명 이상 설치 가능
- 핵심 플로우 성공률 80% 이상
- 치명적 crash 0
- 사진 업로드 성공률 90% 이상

## 7. 실행 슬라이스

### Slice 1: 출시 blocker 제거

목표:
R2/API Worker/staging smoke를 막는 외부 blocker를 제거한다.

작업:

- R2 subscription checkout
- staging/production R2 bucket evidence
- staging API Worker deploy
- production API Worker deploy
- staging read-only smoke

완료 기준:

- `R2_NOT_ENABLED` 제거
- `worker_deployment.staging.api` 제거
- `worker_deployment.production.api` 제거
- `pnpm cf:external-state` blocker가 staging mutation/실기기 QA 쪽으로 이동

### Slice 2: 실사진 업로드/운영 smoke

목표:
사진/댓글/좋아요/신고/숨김이 실제 Cloudflare staging에서 작동함을 증명한다.

작업:

- 사진 업로드
- 사진 조회
- 사진 삭제/숨김
- 댓글 작성
- 좋아요
- 장소/댓글/사진 신고
- 운영자 hide/restore/delete
- R2 object 접근 차단 확인

완료 기준:

- `SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin` 통과
- D1/R2/화면/로그 evidence 저장
- 사용자 화면에서 숨김 반영 확인

### Slice 3: 사용자 첫 경험 정리

목표:
앱을 켰을 때 지도앱이 아니라 실시간 장소 사진 앱으로 보이게 한다.

작업:

- 홈을 사진 피드 중심으로 고정
- 지역/해시태그 칩 정리
- 카드 정보 밀도 정리
- 올리기 CTA 명확화
- 지도 탭은 작은 핀과 하단 시트 중심 유지
- 빈 지역 empty state에 "첫 사진 올리기" 유도

완료 기준:

- 390px 모바일 화면에서 첫 카드가 첫 화면에 보인다.
- 올리기 버튼이 하단 탭 중앙 또는 명확한 주 행동으로 보인다.
- 지도는 보조 탐색으로 동작하며 큰 상태 텍스트가 없다.

### Slice 4: 실기기 QA와 TestFlight 내부 테스트

목표:
iPhone/Android에서 실제 사람이 설치하고 핵심 플로우를 완료한다.

작업:

- iPhone TestFlight 또는 local build 설치
- Android debug/internal build 설치
- 위치 허용/거부
- 카메라/사진 권한
- 지도 로딩
- 장소 클릭
- 사진 업로드
- 댓글/좋아요/랭킹/신고
- crash/log 수집

완료 기준:

- iPhone 핵심 플로우 통과
- Android 핵심 플로우 통과
- 치명적 crash 0
- known issue 문서화

### Slice 5: 내부 테스트 후 GTM 준비

목표:
작은 지역에서 실제 사용자 콘텐츠가 생기도록 만든다.

작업:

- 내부 테스터 5~10명 모집
- 부산/성수/제주 중 1개 첫 런칭 지역 선택
- seed 콘텐츠 30~50장 준비
- 신고/숨김 운영 담당 지정
- 공유 카드/초대 문구 준비
- 피드백 이슈화

완료 기준:

- 내부 테스터 5명 이상
- 첫 사진 업로드 성공률 80% 이상
- 신고/숨김 처리 가능
- 외부 TestFlight로 넘길 P0 issue 0개

## 8. 10년차 마케터 관점의 제품/홍보 전략

### 마케팅 판단

전국 앱으로 바로 홍보하면 메시지가 약하다.
처음에는 "지금 이 동네/핫플 상태를 보는 앱"으로 좁혀야 한다.

추천 첫 시장:

1. 부산 광안리/해운대
2. 서울 성수/홍대/연남
3. 제주 공항/애월/성산

선정 기준:

- 사진으로 상태 차이가 잘 보인다.
- 주차/웨이팅/혼잡/날씨 정보가 실제 의사결정에 도움 된다.
- 인스타그램/블로그/지역 커뮤니티에 공유될 소재가 많다.
- 주말에 수요가 몰린다.

### 핵심 메시지

대표 메시지:

- "가기 전에 지금 사진부터 보세요."
- "광안리 지금 주차 만차래요."
- "성수 웨이팅, 말보다 사진이 빠릅니다."
- "오늘 갈 곳 분위기, 방금 올라온 사진으로 확인."

피해야 할 메시지:

- "실시간 데이터를 기반으로"
- "AI 기반 장소 탐색"
- "전국 통합 관광 플랫폼"
- "차세대 위치 기반 소셜 네트워크"

### 채널 전략

1. TikTok/Instagram Reels
   - 목적: 앱 인지
   - 콘텐츠: "지금 광안리 실제 상황", "성수 웨이팅 실시간", "주차 만차 피하는 법"
   - KPI: 저장 수, 공유 수, 앱 방문 클릭

2. 네이버 블로그/카페
   - 목적: 검색 유입
   - 콘텐츠: "광안리 주차 실시간 확인", "성수 웨이팅 많은 시간", "부산 여행 전 확인할 앱"
   - KPI: 검색 노출, 앱 링크 클릭, 지역 키워드 유입

3. 지역 커뮤니티
   - 목적: 첫 콘텐츠 생산자 확보
   - 콘텐츠: "오늘 여기 상황 올려주실 분", "주말 광안리 리포터 모집"
   - KPI: 업로드 유저 수, 첫 주 사진 수

4. 지인/소규모 내부 테스트
   - 목적: 기능 안정성 확인
   - 콘텐츠: TestFlight 초대, 미션형 업로드
   - KPI: 설치율, 첫 업로드율, crash-free session

### 초기 캠페인

캠페인명:

> 지금컷 챌린지

방식:

- 특정 지역 방문자가 사진 1장과 태그 2개를 올린다.
- 태그 예시: #주차만차, #웨이팅, #한산함, #노을, #비오는날
- 앱 안에서는 "방금 올라온 사진"으로 노출한다.
- 외부 홍보는 "오늘 여기 갈까 말까" 상황형 콘텐츠로 만든다.

초기 목표:

- 1개 지역에서 7일간 사진 100장
- 업로드 유저 30명
- 재방문율 25%
- 신고 처리 SLA 24시간 이내

### 랜딩/스토어 문구

짧은 설명:

> 방금 올라온 장소 사진으로 오늘 갈 곳의 분위기를 확인하세요.

긴 설명:

> #실시간은 지금 사람들이 올린 장소 사진을 모아 보여주는 앱입니다. 주차, 웨이팅, 사람 많음, 노을, 야경 같은 태그로 오늘 갈 곳의 분위기를 빠르게 확인할 수 있습니다.

스크린샷 구성:

1. 방금 올라온 사진 피드
2. #주차만차 #웨이팅 같은 태그 탐색
3. 장소 상세의 최근 사진 그리드
4. 지도에서 주변 장소 핀 보기
5. 사진 올리기 5단계

## 9. 서브에이전트 운영 계획

실제 구현 단계에서는 아래 4개 레인으로 나누는 것이 좋다.

### Orchestrator

책임:

- release ledger 관리
- blocker 우선순위 결정
- staging/TestFlight 완료 기준 통제
- 최종 evidence 취합

완료 산출물:

- `docs/current-release-state.md`
- `RELEASE_STATUS.md`
- `release-ledger.yaml`
- 최종 release gate 결과

### FullStackDev

책임:

- R2/API Worker deploy
- staging smoke
- D1/R2/Workers tail evidence
- upload/comment/like/report/hide loop 구현 및 검증

완료 산출물:

- passing `pnpm cf:external-state`
- passing `pnpm smoke:staging`
- mutation smoke evidence

### DesignMarketing

책임:

- 홈 피드 중심 UX
- 올리기 5단계
- 검색/해시태그/장소 상세 구조
- 스토어 스크린샷/문구
- 초기 캠페인 메시지

완료 산출물:

- 모바일 390px/430px screenshot set
- onboarding-free first screen
- TestFlight beta description

### Verifier/Security

책임:

- auth/secret/redaction 확인
- UGC 신고/숨김 negative path
- 위치/사진 민감정보 확인
- iPhone/Android 실기기 QA
- crash/log 수집

완료 산출물:

- `docs/real-device-qa.md` filled
- security gate evidence
- known issues list

## 10. 출시 로드맵

### Phase A: Cloudflare staging unblock

기간:
가장 먼저 처리한다.

해야 할 일:

- R2 checkout
- R2 bucket evidence
- staging API Worker deploy
- production API Worker deploy
- external-state 재검증

완료 기준:

- `R2_NOT_ENABLED` 없음
- staging/production API Worker deployment blocker 없음

### Phase B: real staging smoke

해야 할 일:

- 사진 업로드
- 댓글
- 좋아요
- 랭킹 반영
- 신고
- 운영자 숨김
- R2 삭제/차단
- tail redaction

완료 기준:

- staging mutation smoke 통과
- D1/R2/log/screenshot evidence 확보

### Phase C: UX 집중 정리

해야 할 일:

- 홈 피드 우선 화면 확정
- 해시태그 탐색 정리
- 올리기 5단계 완성
- 장소 상세 실시간 사진 그리드화
- 지도 탭 회귀 smoke

완료 기준:

- 첫 화면에서 사진 피드가 보인다.
- 지도는 보조 탐색으로 안정 동작한다.
- 올리기 성공 흐름이 5단계 이하다.

### Phase D: real-device QA

해야 할 일:

- iPhone 실기기
- Android 실기기
- 위치 허용/거부
- 카메라/사진 권한
- 댓글/사진/좋아요/신고
- crash/log 수집

완료 기준:

- crash 0
- 사진 업로드 성공률 90% 이상
- 위치 거부 상태에서도 사용 가능

### Phase E: TestFlight internal

해야 할 일:

- 내부 테스터 5~10명
- 업로드 미션
- 지역/태그 피드백 수집
- 신고/숨김 운영 리허설
- P0 issue 제거

완료 기준:

- 5명 이상 설치
- 핵심 플로우 성공률 80% 이상
- 외부 테스트로 넘길 P0 issue 0개

### Phase F: external TestFlight and first-region launch

해야 할 일:

- 1차 20명
- 2차 50명
- 3차 100명
- 첫 지역 콘텐츠 100장 목표
- 지역 커뮤니티/숏폼/네이버 검색 콘텐츠 운영

완료 기준:

- crash-free 기준 충족
- 신고/숨김 처리 가능
- R2/D1 비용 예측 가능
- 실제 사용자 콘텐츠 발생

## 11. 성공 지표

### 제품 지표

- 첫 방문 후 사진 피드 도달률
- 첫 검색 성공률
- 첫 업로드 완료율
- 사진 업로드 성공률
- 장소 상세 진입률
- 태그 클릭률
- 재방문율

### 운영 지표

- 신고 처리 시간
- 숨김/복구 처리 성공률
- 사진 삭제 후 접근 차단 성공률
- crash-free session
- R2/D1/Workers 사용량

### 마케팅 지표

- 지역 키워드 유입
- 공유 카드 클릭률
- TestFlight 초대 수락률
- 업로드 유저 수
- 지역별 사진 수
- 숏폼 저장/공유 수

## 12. 다음 7개 작업

1. Cloudflare Dashboard에서 R2 subscription checkout 완료
2. `pnpm cf:r2:evidence -- --env=staging --check` 실행
3. staging API Worker deploy
4. `pnpm smoke:staging` read-only 통과
5. `SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin` 통과
6. 홈/올리기/장소 상세 UX를 사진 중심으로 한 번 더 정리
7. iPhone/Android real-device QA evidence 작성

## 13. 최종 출시 판단 기준

TestFlight 내부 테스트 가능:

- Cloudflare staging API/R2 동작
- 사진/댓글/좋아요/랭킹/신고/숨김 smoke 통과
- iPhone/Android 실기기 핵심 플로우 통과
- 개인정보/지원 URL 확인
- 치명적 crash 0

App Store 정식 제출 가능:

- 외부 TestFlight 완료
- 실제 사용자 콘텐츠 발생
- 신고/차단/삭제 운영 가능
- 비용/사용량 예측 가능
- 스토어 스크린샷/설명/키워드 준비
- 베타/placeholder 제거

현재는 첫 번째 기준인 TestFlight 내부 테스트 준비를 향해 가는 단계다.
정식 App Store 제출은 아직 보류한다.

# #실시간 남은 미흡점 및 실행 계획서

Updated: 2026-06-30

Source of truth:

- `docs/current-release-state.md`
- `RELEASE_STATUS.md`
- `release-ledger.yaml`
- `docs/silsigan-product-dev-gtm-plan.md`

## 1. 결론

현재 #실시간은 App Store 정식 출시 후보가 아니다.
현재 목표는 Cloudflare staging + TestFlight 내부 테스트 가능한 MVP다.

로컬 웹/PWA 기준으로는 방향이 꽤 잡혔다.
지도, 관광 API fallback, 작은 마커, 검색 빈 상태 회복, 사진 피드 중심 리디자인은 MVP 후보 수준까지 올라왔다.

하지만 실제 출시 판단은 로컬 화면이 아니라 아래 증거로 해야 한다.

1. Cloudflare staging API가 실제로 살아 있음
2. R2에 사진 업로드/조회/삭제가 실제로 됨
3. staging에서 댓글/사진/좋아요/랭킹/신고/숨김 smoke가 통과함
4. iPhone/Android 실기기에서 핵심 플로우가 통과함
5. TestFlight 내부 테스트에서 치명적 crash 없이 5명 이상이 핵심 플로우를 완료함

현재 한 줄 판정:

> 로컬 제품 경험은 MVP 후보권이지만, Cloudflare R2/API Worker/staging smoke/real-device QA가 끝나기 전에는 TestFlight 내부 테스트 준비 완료라고 말할 수 없다.

## 2. 현재 완성도

| 영역 | 현재 판단 | 출시 관점 |
| --- | --- | --- |
| 제품 포지션 | 75% | "지도앱"에서 "지금 올라온 장소 사진 앱"으로 방향 전환 완료, 세부 UX 정리 필요 |
| 홈 사진 피드 | 70% | 첫 화면에서 사진 중심 경험은 있음, 카드 밀도/지역/태그 탐색을 더 날카롭게 해야 함 |
| 검색/해시태그 | 65% | 빈 결과 회복은 개선됨, 결과 탭과 태그 상세가 부족함 |
| 지도 UX | 85% | 큰 상태 텍스트 제거, 작은 핀, 상세 열림 확인됨. 다만 회귀 방지 smoke 계속 필요 |
| 올리기 플로우 | 65% | 로컬 업로드/피드 반영 방향은 잡힘, 실제 R2/staging proof가 부족함 |
| 댓글/좋아요/신고 | 65% | 로컬/테스트 구조는 있음, real staging mutation evidence 필요 |
| Cloudflare D1 | 85% | staging/production 0002 evidence 있음 |
| Cloudflare R2 | 40% | `R2_NOT_ENABLED` 때문에 출시 blocker |
| API Worker 배포 | 50% | URL 값은 준비됐지만 staging/production API Worker 배포/스모크 미완료 |
| 모바일/TestFlight | 60% | shell/문서/권한 문구는 준비권, 실기기 QA와 내부 배포 증거 없음 |
| 운영/보안 | 70% | runbook/test guard는 있음, tail redaction/신고 처리 실증 필요 |
| App Store 정식 출시 | 30% | 아직 보류 |

## 3. P0 미흡점

### P0-1. R2_NOT_ENABLED

문제:
사진 기반 앱인데 실제 Cloudflare R2 사진 저장소가 활성화되지 않았다.
이 상태에서는 staging 사진 업로드, 삭제, 숨김, R2 object evidence를 완료할 수 없다.

작업:

1. Cloudflare Dashboard에서 R2 subscription checkout 완료
2. staging R2 bucket visibility 확인
3. production R2 bucket visibility 확인
4. staging bucket 없으면 apply
5. production bucket 없으면 `--confirm-production` 포함해 apply
6. R2 CORS, object key UUID, 삭제 후 접근 불가 확인

완료 기준:

- `R2_NOT_ENABLED` 제거
- `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000` pass
- `pnpm cf:r2:evidence -- --env=production --check --timeout-ms=120000` pass
- 사진 업로드 후 원본 파일명 미노출
- 삭제/숨김 후 URL 접근 차단

### P0-2. staging/production API Worker 미배포

문제:
Pages web Worker는 read-only smoke까지 통과했지만, 실제 API Worker가 staging/production에서 배포되고 smoke된 증거가 없다.

작업:

1. R2 활성화 후 staging API Worker deploy
2. production API Worker deploy
3. `pnpm cf:external-state` 재실행
4. API URL이 실제 Worker deployment와 연결되는지 확인
5. 실패 시 app이 명확한 오류를 보여주는지 확인

완료 기준:

- `worker_deployment.staging.api` pass
- `worker_deployment.production.api` pass
- `SILSIGAN_STAGING_API_BASE_URL` smoke pass
- `SILSIGAN_PRODUCTION_API_BASE_URL` read-only smoke pass

### P0-3. real staging mutation smoke 미완료

문제:
로컬에서는 좋아 보이지만, 실제 staging에서 UGC write path가 검증되지 않았다.

필수 smoke:

1. staging 앱 접속
2. 지도 로딩
3. 장소 클릭
4. 클릭 이벤트 저장
5. 장소 상세 열기
6. 댓글 작성
7. 사진 업로드
8. 좋아요
9. 랭킹 반영
10. 신고
11. 운영자 숨김
12. 사용자 화면에서 숨김 반영
13. R2 사진 삭제/차단 확인
14. Workers tail redaction 확인

완료 기준:

- `pnpm smoke:staging` pass
- `SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin` pass
- `pnpm smoke:tail-redaction` pass
- D1 row evidence 확보
- R2 object evidence 확보
- 화면 screenshot 확보
- 실패 케이스 목록 작성

### P0-4. iPhone/Android real-device QA 미완료

문제:
PWA/브라우저 통과와 실기기 통과는 다르다.
위치 권한, 카메라/사진 권한, 모바일 브라우저/앱 shell, 뒤로가기, crash는 실기기에서만 확정된다.

iPhone QA:

- TestFlight 또는 local build 설치
- 위치 허용/거부
- 카메라 권한
- 사진 보관함 권한
- 네이버지도 로딩
- 현재 위치 표시
- 장소 클릭
- 사진 업로드
- 댓글 작성
- 좋아요
- 랭킹 반영
- 신고/숨김
- crash log 확인

Android QA:

- debug 또는 internal build 설치
- 위치 허용/거부
- 네이버지도 로딩
- 장소 클릭
- 사진 업로드
- 댓글 작성
- 좋아요
- 랭킹 반영
- 뒤로가기
- 신고/숨김
- crash log 확인

완료 기준:

- iPhone 핵심 플로우 pass
- Android 핵심 플로우 pass
- 치명적 crash 0
- 사진 업로드 성공률 90% 이상
- 위치 거부 상태에서도 앱 사용 가능
- `docs/real-device-qa.md`가 실제 evidence로 채워짐

### P0-5. 사용자 첫 경험이 아직 더 선명해야 함

문제:
제품이 "기능 많은 지도앱"처럼 보이면 실패한다.
첫 화면은 "지금 올라온 장소 사진"이어야 한다.

작업:

1. 홈 첫 화면에서 사진 카드가 바로 보이게 유지
2. 상단 문구를 생활어 중심으로 정리
3. 지역/해시태그 칩을 피드 필터로 명확히 연결
4. 사진 카드에서 장소명, 시간, 지역, 태그, 한 줄 설명을 고정 노출
5. "올리기"를 하단 탭의 주 행동으로 유지
6. 지도는 보조 탐색으로 정리

완료 기준:

- 390px 화면 첫 viewport 안에 사진 카드가 보임
- 사용자가 3초 안에 앱 목적을 이해함
- 홈 -> 상세 -> 올리기 -> 지도 이동이 막히지 않음
- empty state가 막다른 길이 아니라 검색/지도/올리기로 이어짐

## 4. P1 미흡점

### P1-1. 검색 결과 구조

문제:
장소 검색, 해시태그 검색, 사진 검색이 섞이면 사용자가 결과를 해석하기 어렵다.

작업:

- 검색 결과 탭을 `사진`, `장소`, `해시태그`로 분리
- 기본은 "최신 사진" 중심으로 시작
- 장소 결과는 최근 사진 수와 대표 태그 포함
- 해시태그 결과는 인기 장소와 최근 사진을 함께 보여줌

완료 기준:

- `광안리`, `성수`, `#웨이팅`, `#주차만차` 검색이 각각 자연스럽게 보임
- 빈 결과는 추천 검색어, 지도 이동, 사진 올리기로 회복됨

### P1-2. 올리기 5단계 고정

문제:
사진 기반 앱에서 제보 항목이 많으면 업로드 전환율이 떨어진다.

작업:

1. 사진 선택
2. 장소 선택
3. 태그 선택
4. 한 줄 입력
5. 올리기

필수값:

- 사진
- 장소
- 태그 1개 이상

선택값:

- 한 줄 설명
- 상세 상태

완료 기준:

- 첫 업로드가 60초 이내 가능
- 실패 원인이 권한/용량/네트워크/장소 미선택으로 분리 표시됨
- 업로드 성공 후 홈/장소 피드에 반영됐다는 피드백이 5초 이내 표시됨

### P1-3. 마이 탭 기여 트래커

문제:
사용자가 사진을 올린 뒤 기여가 보이지 않으면 반복 업로드 동기가 약하다.

작업:

- 내가 올린 사진 수
- 받은 좋아요 수
- 댓글 수
- 신고/숨김 처리 상태
- 저장한 장소
- 내 최근 활동

완료 기준:

- 업로드 후 마이 탭에서 내 활동이 보임
- 신고/숨김 상태가 사용자가 이해할 수 있는 말로 표시됨

### P1-4. 신고/운영 SLA 실증

문제:
UGC 앱은 신고/숨김이 기능이 아니라 신뢰의 기본이다.

작업:

- 신고 접수
- 운영자 숨김
- 사용자 화면 반영
- 복구/삭제
- 처리 시간 기록
- 신고 처리 SLA 문서화

완료 기준:

- 사진/댓글/장소 신고 모두 smoke 통과
- 숨김 처리 후 일반 사용자 화면에서 사라짐
- 처리 로그에 민감정보가 남지 않음

### P1-5. 개인정보/지원 URL shell export

문제:
문서와 `.env.example` 값은 준비됐지만 실제 release shell export 확인이 필요하다.

작업:

- `SILSIGAN_PRIVACY_POLICY_URL` export
- `SILSIGAN_SUPPORT_URL` export
- TestFlight review notes 최종 문구 확인
- support email 또는 문의 경로 확인

완료 기준:

- HTTPS URL
- 서로 다른 URL
- localhost/placeholder/query/fragment/credential 없음
- `release:status -- --strict`에서 URL gate pass

## 5. P2 미흡점

### P2-1. 해시태그 상세 페이지

작업:

- `#주차만차`, `#웨이팅`, `#한산함`, `#사진스팟` 상세 페이지
- 지금 많이 올라온 곳 TOP 3
- 최근 사진 그리드
- 지역 필터

완료 기준:

- 태그 클릭 후 장소/사진 탐색이 이어짐

### P2-2. 장소 상세을 실시간 사진 그리드로 정리

작업:

- 장소명
- 지역
- 최근 사진 수
- 대표 해시태그
- 최근 3시간 요약
- 사진 그리드
- 댓글
- 사진 올리기 버튼

완료 기준:

- 장소 상세가 리뷰 페이지처럼 보이지 않고 실시간 피드처럼 보임

### P2-3. 공유 카드/초대 루프

작업:

- 장소 상태 공유 카드
- `지금 광안리 어때?` 같은 생활어 공유 문구
- 앱 초대 링크
- TestFlight 내부용 초대 메시지

완료 기준:

- 내부 테스터가 카톡/인스타 DM으로 자연스럽게 공유 가능

### P2-4. 비용/사용량 대시보드 루틴

작업:

- R2 object count
- D1 row count
- Workers request count
- Durable Object usage
- error rate
- budget threshold

완료 기준:

- TestFlight 1차 20명 전 비용/사용량 baseline 확보

## 6. 사용자 입장에서 필요한 것

### 첫 방문자

필요한 것:

- 첫 화면에 방금 올라온 사진
- 설명보다 실제 사진
- 지역/태그로 바로 탐색
- 지도는 필요할 때만
- 올리기 버튼이 명확함

성공 기준:

- "이 앱은 지금 장소 사진 보는 앱이구나"를 3초 안에 이해
- 첫 방문 30초 안에 사진 또는 장소 상세 진입

### 장소를 고르는 사용자

필요한 것:

- 지금 사람이 많은지
- 주차가 가능한지
- 웨이팅이 있는지
- 사진 찍기 좋은지
- 방금 올라온 사진이 있는지

성공 기준:

- 검색/태그/지도 중 하나로 원하는 장소 상태 확인
- 장소 상세에서 최근 사진과 태그가 바로 보임

### 사진을 올리는 사용자

필요한 것:

- 사진 선택이 쉬움
- 장소 선택이 쉬움
- 태그 선택이 빠름
- 실패했을 때 이유가 명확함
- 성공하면 바로 반영됐다는 느낌이 있음

성공 기준:

- 60초 안에 첫 업로드
- 업로드 후 홈 또는 장소 피드에서 내 사진 확인

### 신뢰가 필요한 사용자

필요한 것:

- 신고 버튼
- 차단/숨김 관리
- 개인정보/지원 링크
- 민감 위치/파일명 보호

성공 기준:

- 신고 후 처리 상태가 보임
- 원치 않는 콘텐츠를 숨길 수 있음
- 개인정보 화면과 지원 화면이 실제로 열림

## 7. 개발자로서 필요한 것

### 환경 분리

원칙:

- local fallback은 개발 편의로만 허용
- staging/production API 실패는 숨기면 안 됨
- release gate는 로컬 통과와 외부 blocker를 분리해야 함

필요 작업:

- local Worker URL offline fallback 유지
- staging/production HTTPS 실패는 명확한 오류 노출
- `.env.example`, operator packet, release shell 값 동기화
- API URL, Pages URL, Privacy/Support URL gate 유지

### 데이터/보안

필요 작업:

- UUID 기반 object key
- 원본 파일명 미저장/미노출
- EXIF GPS 제거
- raw 좌표 공개 응답 금지
- 댓글/태그 금칙 패턴 차단
- 신고/숨김 audit trail
- admin token redaction
- 같은 사용자 반복 클릭/좋아요 ranking abuse smoke

### 테스트/증거

필수 명령:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm cf:external-state
pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000
pnpm cf:d1:evidence -- --env=staging --check --timeout-ms=120000
pnpm smoke:staging
SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin
pnpm smoke:pages
pnpm smoke:tail-redaction
```

필수 산출물:

- command log
- D1 evidence
- R2 evidence
- Worker deploy version
- screenshot
- redacted network log
- redacted console log
- known issue list

## 8. 10년차 마케터 관점의 제품/홍보 계획

### 핵심 포지션

전국 앱으로 바로 말하면 메시지가 흐려진다.
초기에는 특정 지역의 "지금 상태" 문제를 강하게 잡아야 한다.

추천 포지션:

> 가기 전에 지금 사진부터 보는 앱

보조 문구:

- "광안리 지금 주차 만차래요."
- "성수 웨이팅, 리뷰보다 방금 사진이 빠릅니다."
- "오늘 갈 곳 분위기, 방금 올라온 사진으로 확인하세요."
- "예쁜 사진 말고 지금 상황."

피해야 할 문구:

- "AI 기반"
- "전국 통합 플랫폼"
- "실시간 데이터를 기반으로"
- "차세대 위치 기반 SNS"

### 첫 런칭 지역

1순위 후보:

- 부산 광안리/해운대
- 서울 성수/홍대/연남
- 제주 애월/공항/성산

선정 기준:

- 사진만 봐도 상태 차이가 큼
- 주차/웨이팅/혼잡/날씨가 의사결정에 중요함
- 주말 수요가 몰림
- 지역 커뮤니티/인스타/블로그 소재가 많음

추천 시작:

- 제품 증거는 현재 부산 seed가 있으므로 `광안리/해운대`로 먼저 검증
- 마케팅 확장은 `성수/홍대/연남`으로 2차 테스트

### 콘텐츠 seed 전략

목표:
초기 사용자가 빈 앱으로 느끼지 않게 한다.

1차 기준:

- 첫 지역 핵심 장소 30곳
- 장소당 최소 3~5장
- 총 seed 사진 100장
- 태그는 5개 계열로 고정
  - #웨이팅
  - #주차만차
  - #사람많음
  - #한산함
  - #사진스팟

운영 원칙:

- 인스타 감성보다 실제 상황
- 같은 장소 같은 각도 반복 금지
- 최근 24~72시간 콘텐츠 비율 관리
- 광고성 문구 금지

### 내부 TestFlight 모집

1차:

- 5~10명
- 목표: 설치/권한/업로드/신고 crash 확인

2차:

- 20~30명
- 목표: 첫 지역 사진 밀도와 업로드 이탈 확인

3차:

- 50~100명
- 목표: 재방문과 공유 루프 확인

테스터 미션:

1. 앱 설치
2. 현재 위치 허용 또는 거부
3. 장소 하나 보기
4. 태그 하나 누르기
5. 사진 하나 올리기
6. 좋아요/댓글 하나 남기기
7. 신고 버튼 위치 확인
8. 불편한 점 1개 제출

### 채널 전략

1. 카카오톡/지인 초대
   - 목적: 안정성 확인
   - KPI: 설치율, 첫 업로드율

2. 인스타그램 릴스/스토리
   - 목적: "지금 상황" 문제 각인
   - 콘텐츠: "지금 광안리 실제 상황", "성수 웨이팅 실시간"
   - KPI: 저장, 공유, 프로필 클릭

3. 네이버 블로그/카페
   - 목적: 검색 유입
   - 콘텐츠: "광안리 주차 실시간 확인", "성수 웨이팅 확인 앱"
   - KPI: 검색 노출, 앱 링크 클릭

4. 지역 커뮤니티
   - 목적: 첫 콘텐츠 생산자 확보
   - 콘텐츠: "오늘 여기 상황 올려주실 분", "주말 광안리 리포터 모집"
   - KPI: 업로드 유저 수, 지역별 사진 수

### 30/60/90일 GTM

#### 30일: PMF 탐색

목표:
첫 지역에서 "보기"와 "올리기"가 실제로 반복되는지 확인한다.

작업:

- Cloudflare staging 안정화
- 내부 TestFlight 5~10명
- 첫 지역 seed 100장
- 매주 사용자 인터뷰 5명
- 업로드 실패/검색 실패 로그 수집

KPI:

- TestFlight 설치율 70% 이상
- 첫 업로드율 40% 이상
- 첫 3일 내 재방문율 25% 이상
- 사진 업로드 성공률 90% 이상
- 치명적 crash 0

#### 60일: 지역 확장 실험

목표:
한 지역의 사용 패턴을 다른 지역에 복제할 수 있는지 본다.

작업:

- 2번째 지역 seed
- 지역별 태그 랭킹
- 공유 카드
- 초대 메시지 A/B
- 신고/숨김 운영 리허설

KPI:

- Day7 retention 25~30%
- 세션당 장소 조회 4개 이상
- 태그 클릭률 20% 이상
- 공유 클릭률 10% 이상
- 신고 처리 SLA 24시간 이내

#### 90일: 외부 TestFlight 확장

목표:
100명 단위 외부 테스트가 운영 가능한지 확인한다.

작업:

- 외부 TestFlight 1차 20명
- 2차 50명
- 3차 100명
- 비용/사용량 dashboard baseline
- 스토어 문구/스크린샷 준비

KPI:

- crash-free session 기준 충족
- 업로드 유저 30명 이상
- 첫 지역 사진 300장
- 신고 처리 가능
- P0 issue 0

## 9. 서브에이전트 운영 계획

### Orchestrator

책임:

- release ledger 관리
- blocker 우선순위 결정
- Cloudflare/TestFlight evidence 취합
- 최종 go/no-go 판단

산출물:

- `docs/current-release-state.md`
- `RELEASE_STATUS.md`
- `release-ledger.yaml`
- 최종 release gate 결과

### FullStackDev

책임:

- R2 evidence
- API Worker deploy
- staging smoke
- D1/R2/Worker tail evidence
- upload/comment/like/report/hide loop 검증

산출물:

- `pnpm cf:external-state` 결과
- staging mutation smoke 결과
- deploy version ID

### DesignMarketing

책임:

- 홈 사진 피드
- 검색/태그 구조
- 올리기 5단계
- 장소 상세 실시간 사진 그리드
- TestFlight beta description
- 초기 GTM 메시지

산출물:

- 390px/430px screenshot set
- first-region launch copy
- invite message

### Verifier/Security

책임:

- auth/secret/redaction 확인
- UGC 신고/숨김 negative path
- 위치/사진 민감정보 확인
- iPhone/Android QA
- crash/log 수집

산출물:

- `docs/real-device-qa.md`
- redacted log
- known issues
- security gate summary

## 10. 2주 실행 스프린트

### Week 1: 출시 blocker 제거

Day 1:

- R2 subscription checkout
- staging R2 check
- production R2 check

Day 2:

- staging API Worker deploy
- production API Worker deploy
- `pnpm cf:external-state`

Day 3:

- read-only staging smoke
- Pages smoke
- failing case list

Day 4:

- mutation smoke
- photo/comment/like/report/hide
- D1/R2 evidence

Day 5:

- tail redaction
- release status strict
- ledger update

완료 기준:

- `R2_NOT_ENABLED` 제거
- API Worker deployment blockers 제거
- staging smoke pass
- mutation smoke pass 또는 명확한 P0 bug list

### Week 2: 사용자 경험과 실기기 QA

Day 6:

- 홈 첫 화면 사진 카드 밀도 정리
- 검색 결과 탭 구조 정리

Day 7:

- 올리기 5단계 UX 정리
- 업로드 실패/성공 feedback 정리

Day 8:

- 장소 상세 실시간 사진 그리드 정리
- 지도 회귀 smoke

Day 9:

- iPhone real-device QA
- Android real-device QA

Day 10:

- TestFlight 내부 테스트 노트
- 테스터 미션
- known issue 문서화
- 내부 테스트 go/no-go

완료 기준:

- iPhone/Android 핵심 플로우 pass
- 치명적 crash 0
- 내부 TestFlight 5명 배포 가능

## 11. Go/No-Go 기준

### TestFlight 내부 테스트 Go

아래가 모두 true면 가능하다.

- R2 staging/prod check pass
- API Worker staging/prod deployed
- staging read-only smoke pass
- staging mutation smoke pass
- iPhone 실기기 핵심 플로우 pass
- Android 실기기 핵심 플로우 pass
- 개인정보/지원 URL shell export 확인
- 치명적 crash 0
- known issue가 P1 이하만 남음

### TestFlight 외부 테스트 Go

내부 테스트 후 아래가 true면 가능하다.

- 내부 테스터 5명 이상
- 핵심 플로우 성공률 80% 이상
- 사진 업로드 성공률 90% 이상
- 신고/숨김 운영 가능
- 비용/사용량 baseline 확보
- 첫 지역 콘텐츠 seed 100장 이상
- P0 issue 0

### App Store 정식 출시 Go

아직 판단 대상이 아니다.
외부 TestFlight와 첫 지역 실사용 콘텐츠가 끝난 뒤 다시 판단한다.

필수 조건:

- 실제 사용자 콘텐츠 발생
- 신고/차단/삭제 운영 가능
- R2/D1 비용 추정 가능
- 스토어 스크린샷/앱 설명/키워드 준비
- 베타/placeholder 제거
- reviewer instructions 준비

## 12. 바로 다음 실행 순서

1. 현재 로컬 업로드 완료 피드백 변경분을 검증/커밋/푸시
2. Cloudflare Dashboard에서 R2 subscription checkout
3. `pnpm cf:r2:evidence -- --env=staging --check --timeout-ms=120000`
4. staging API Worker deploy
5. `pnpm smoke:staging`
6. `SILSIGAN_STAGING_MUTATION=1 pnpm smoke:staging -- --require-admin`
7. iPhone/Android real-device QA
8. TestFlight internal build 준비

현재 가장 중요한 한 줄:

> 더 많은 기능을 추가하기보다, Cloudflare staging에서 사진/댓글/좋아요/랭킹/신고/숨김이 실제로 도는 증거를 먼저 만든다.

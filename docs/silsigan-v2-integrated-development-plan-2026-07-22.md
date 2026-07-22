# 실시간 V2 분야별 완성도 감사 및 통합 개발계획서 — 2026-07-22

## 0. 결론

실시간 V2는 **로컬 코드와 Cloudflare staging 기반이 강한 통제형 베타 후보**다. 그러나 지금 그대로 공개 마케팅이나 production 승격을 시작할 단계는 아니다.

- 통제형 staging 베타 준비도: **70/100**
- 공개 production 출시 준비도: **55/100**
- 권고 판정: **조건부 HOLD** — 아래 P0 게이트를 닫은 뒤 광안리 소규모 베타로 진입
- production 변경: **별도 승인 전 금지**
- 현재 가장 큰 결함: 실제 최근 사진이 없는데도 기본 광안리 이미지가 `최근 방금 전`인 현장 사진처럼 보이는 신뢰 훼손
- 현재 가장 큰 외부 게이트: 사람 Turnstile을 포함한 사진 전체 생명주기, 실제 WAF·비용 경보, 실기기, 법률 공개문서

이 점수는 테스트 통과율이 아니라 **실제 사용자·운영·법률·production 게이트의 증거 충족률**이다. 자동 테스트 453개 통과와 production 출시 완료를 같은 의미로 사용하지 않는다.

## 1. 감사 범위와 기준점

### 1.1 권위 작업면

| 항목 | 감사 기준 |
| --- | --- |
| 권위 worktree | `.worktrees/external-staging-20260721` |
| 현재 브랜치 | `agent/external-staging-20260721` |
| 현재 HEAD | `d7f0499` |
| upstream 차이 | `0/0` |
| 감사 시작 시 작업 상태 | 수정된 tracked 파일 20개, untracked 0개 |
| release ledger의 후보 source commit | `48e672aa3f9ece06e31f40305fc6e080c69fb479` |
| production 변경 | 없음 |

현재 HEAD, 작업 트리 변경, ledger에 적힌 release candidate source commit은 서로 다른 값이다. 최종 인계 때는 커밋별 source SHA와 해당 SHA에서 실행한 검증 증거를 다시 결합해야 한다.

### 1.2 확인된 증거와 남은 경계

| 증거 | 상태 | 해석 |
| --- | --- | --- |
| 전체 테스트 | 453/453 통과 | 현재 작업 트리의 강한 로컬 회귀 증거 |
| 모바일 테스트 | 4/4 통과 | 모바일 셸 계약 증거이며 실기기 증거는 아님 |
| lint·typecheck·Next/OpenNext 빌드 | 통과 | 정적·빌드 게이트 통과 |
| 의존성 감사 | 0건 기록 | package/lockfile 불변 기준의 기록이며 최종 후보에서 재확인 필요 |
| 고신뢰 비밀 패턴 | 0건 | tracked/nonignored source 345개와 Git history의 노출 Turnstile-key 형태 스캔 기록 |
| staging D1 | migration `0026`까지 정렬 | production D1과 별개 |
| staging R2 | private, 0 B | 공개 노출 없음; 실제 사진 성공 증거도 없음 |
| staging API/web | live 배포 확인 | production 배포와 별개 |
| 390px 지도 | 현재 in-app browser에서는 안전한 fallback 표시 | 과거 실제 NAVER 지도 성공 기록과 환경이 다르므로 표준 Chrome·실기기에서 재확인 필요 |
| 사진 업로드 | Turnstile 자동화 거부로 R2 전 중단 | 우회하지 않은 것은 적절하나, 성공 E2E는 미검증 |
| 수동 security gate | 통과 | source/diff 검토, 비밀 패턴, 의존성, negative-path 회귀 검증 |
| Codex Security UI diff scan | 미완료 | 독립 검토 보조 증거이며 완료로 주장하지 않음 |
| Git commit/push | 진행 대상 | 수동 security gate와 전체 검증 뒤 수행 |
| 실기기·법률·운영자 승인 | 미완료 | 공개 출시 차단 |
| 근거 문서 정합성 | P0-00 반영 | 최신 active truth와 과거 증거를 분리했고, baseline candidate와 dirty working tree를 별도 표시함. 최종 source SHA는 commit·push·원격 검증 뒤에만 기록 |

### 1.3 감사 원칙

1. 정보가 없으면 한산함·안전함·최근 사진으로 대체하지 않는다.
2. 로컬 코드, staging 배포, production 적용, 실기기, 사람 검증을 분리한다.
3. 사진·외부 API·지도·D1/R2처럼 비용이 생기는 경로는 인증·할당량·예산·재생 방지·실제 경보를 먼저 검증한다.
4. 자동화가 Turnstile을 통과하지 못하면 우회하지 않고 사람 검증으로 전환한다.
5. 법률 섹션은 출시 체크리스트이며 법률 자문을 대체하지 않는다.

### 1.4 점수 산정 규칙

각 분야 점수는 다음 공통 rubric을 사용한다. 분야에 적용되지 않는 항목은 같은 분야 안의 나머지 항목에 비례 배분한다.

| 평가 축 | 기본 가중치 |
| --- | ---: |
| 실제 구현·산출물 | 30 |
| 자동 검증·회귀 증거 | 20 |
| target 환경·사람·실기기 증거 | 20 |
| 운영자·SLO·복구·비용 통제 | 15 |
| 법률·시장·외부 승인 증거 | 15 |

- 통제형 staging 베타 70점은 6개 분야 점수 합계 `420 / 6`이다.
- 공개 production 55점은 current external P0가 열린 동안 적용하는 보수적 release-gate cap이다. P0가 닫히기 전에는 코드 점수 상승만으로 이 cap을 올리지 않는다.
- 다음 감사는 같은 rubric에서 새 증거가 생긴 항목만 변경하고 점수 변동 사유를 기록한다.

## 2. 분야별 완성도 대시보드

| 분야 | 점수 | 현재 판정 | 가장 큰 차단 요인 |
| --- | ---: | --- | --- |
| 마케팅 | 66/100 | 통제형 광안리 베타 준비 중 | 실사용·리텐션·커버리지 실측 없음 |
| 디자인 | 76/100 | 시각 기반은 강하나 출시 준비 아님 | 빈 데이터가 최신 사진처럼 보이는 P0 신뢰 결함 |
| 사용성 | 62/100 | 핵심 흐름은 이해되나 실제 행동 검증 부족 | 사진 오인, 업로드 맥락·스크롤, 실기기 접근성 |
| 개발 진행 | 77/100 | 코드 92·로컬 QA 94, 외부 게이트가 병목 | 실기기 55·release/ops 43 |
| 법률 | 61/100 | 권리 동의 기반은 있으나 공개 약관 미완료 | 개인정보·위치·UGC·미성년자·운영자 정보 |
| 백엔드 | 78/100 | 강한 staging/비용 방어 기반 | 사람 사진 E2E, WAF, 분산 breaker, 운영 관측 |

통합 점수는 단순 산술평균만으로 출시를 승인하지 않는다. 하나라도 P0 차단 게이트가 열려 있으면 전체 판정은 HOLD다.

## 3. 마케팅 계획서

### 3.1 현재 상태

- 포지셔닝은 “지도 대체”보다 **출발 전 지금 상황을 확인하는 판단 레이어**로 명확하다.
- 스토어 문구 초안, 분석 이벤트 전송, 초기 지역 운영 계획이 있다.
- 분석 전송은 `/api/analytics/events`로 redacted event를 보내는 구현이 있다.
- 초기 seed 목표는 광안리 30개 장소, 제보 100건, 위치 확인 30건, 사진 30건, 검수 준비다.
- 실제 유입, 제보 완료율, D1/D7, fresh coverage, 신고 SLA의 실측은 아직 없다.

### 3.2 실행 계획

#### P0 — 베타 모집 전에

- 홈의 허위 최신성 표현을 제거하고 광고·스토어·온보딩 문구도 같은 truth contract를 사용한다.
- 실제 staging에서 분석 이벤트 수신과 redaction을 1회 이상 확인한다.
- 공개 광고는 중단하고 광안리 10명 초대형 베타만 준비한다.
- “전국 실시간”, “정확한 혼잡도”, 근거 없는 “15초” 표현은 사용하지 않는다.

#### P1 — 광안리 베타

- 10명이 5일 동안 하루 2회 핵심 흐름을 수행한다.
- 장소별 최근 근거 유무, 사진 출처, 관측 시각을 캠페인 화면에도 보존한다.
- 운영 seed를 광안리 30개 장소·100개 제보·30개 위치 확인·30개 승인 사진까지 채운다.
- 문의·신고·삭제 요청의 24시간 대응 담당자를 지정한다.

#### P2 — 지역 확장

- D7 재방문 20% 이상, 추천→장소 상세 진입 30% 이상, 검수 SLA 95% 이상일 때만 다음 지역으로 확대한다.
- paid acquisition은 fresh signal coverage와 moderation capacity가 동시에 통과한 뒤 시작한다.
- 전국 확대 카피는 실제 지역별 coverage를 수치로 표시할 수 있을 때만 허용한다.

### 3.3 KPI와 종료 기준

| KPI | 베타 통과선 |
| --- | ---: |
| 핵심 방문 판단 성공률 | 90% 이상 |
| 추천→장소 상세 진입률 | 30% 이상 |
| 제보 시작→완료율 | 60% 이상 |
| D7 재방문 | 20% 이상 |
| 검수 SLA 준수율 | 95% 이상 |
| 사실과 다른 최신 사진 오인 | 0건 |
| 허위·오표시 신고 처리 | 24시간 이내 |

## 4. 디자인 계획서

### 4.1 현재 상태

- 모바일 중심의 계층, 하단 내비게이션, 장소 카드, empty/error/fallback 상태의 시각 기반은 성숙했다.
- `aria-current`, tablist 키보드 동작, 모달 focus trap·Escape·focus restore, reduced motion 기반이 있다.
- 390px live staging은 전반적으로 정돈되어 있지만, desktop은 좁은 휴대폰 열과 큰 빈 공간으로 보여 독립 데스크톱 경험이 미완료다.
- 일부 터치 대상은 44px 미만이고 10~11px 메타 텍스트와 낮은 대비 색이 남아 있다.

### 4.2 P0 신뢰 결함

`leadPost`와 실제 사진이 없는데도 CSS 기본 배경 `/silsigan/fallback/gwangalli.png`가 나타나고 메타가 `최근 방금 전`으로 생성된다.

- 데이터 분기와 접근성 이름: `src/components/silsigan/SilsiganRedesign.tsx:3410-3450`
- 기본 bitmap: `src/components/silsigan/SilsiganRedesign.module.css:337-355`
- 사용자 영향: 장식 이미지를 실제 최근 현장 증거로 오인하고 방문 결정을 잘못 내릴 수 있음

완료 기준:

- 승인된 실제 사진 또는 `leadPost`가 없으면 bitmap, `최근`, `방금 전`, 방문 판단 배지를 모두 숨긴다.
- `아직 최근 현장 사진이 없습니다 · 마지막 확인 정보 없음`의 명시적 empty card를 사용한다.
- sample mode에서 fallback을 허용할 때만 `예시 이미지 · 현재 사진 아님`을 영구 표시한다.
- R2 0건, report 0건, post 0건, 사진 없는 post, 숨김·삭제 직후를 회귀 테스트한다.
- `tests/ui-contract.test.ts`와 `scripts/cloudflare-pages-smoke.mjs`에 home hero 전용 계약을 추가한다. 장소 상세·sheet에서 정직하게 라벨된 fallback까지 전역 삭제하지 않는다.

### 4.3 실행 계획

#### P0

- truth-first hero와 empty state를 구현하고 360·390·430px screenshot matrix를 만든다.
- 모든 주요 탭 전환과 업로드 장소 선택 뒤 화면 첫 제목 또는 필수 맥락으로 스크롤·포커스를 이동한다.
- 44px 터치 대상, focus order, modal Escape/restore, VoiceOver/TalkBack 이름을 핵심 흐름에서 확인한다.

#### P1

- 색상·간격·타이포·상태 색을 design token으로 통일한다.
- 선택 장소명과 변경 버튼을 업로드 제출 전까지 항상 보이는 요약 영역에 둔다.
- desktop에는 실제 정보 구조를 제공하거나 지원 범위를 모바일로 명시한다.

#### P2

- 실사용자가 freshness·신뢰도·정보 부족을 서로 구분하는지 카드 언어를 반복 실험한다.
- 지역별 대표 이미지가 필요하면 권리와 촬영일이 검증된 asset만 사용한다.

### 4.4 종료 기준

- “사진이 없는 홈에 지금 사진이 있다고 보이는가?” 사용자 질문에서 오인 0건
- 360·390·430px에서 핵심 터치 대상 44px 이상, WCAG AA 대비, 잘림·겹침 0건
- 키보드·VoiceOver·TalkBack에서 화면 전환 뒤 첫 포커스가 제목 또는 선택 장소 요약
- 동일 source SHA의 home/map/detail/upload/my screenshot set 보존

## 5. 사용성 계획서

### 5.1 현재 상태

- 데이터 모드와 출처·freshness를 분리하고 정보 부족을 표현하는 기본 철학은 좋다.
- 지도 장애 시 fallback, 위치 권한 없는 수동 탐색, 사진 권리 확인과 실패 폐쇄 흐름이 있다.
- 사람 Turnstile, 실제 사진 전체 생명주기, 실기기 bridge, 스크린리더 증거가 부족하다.
- 장소 선택 뒤 같은 upload view 안에서 이전 scroll position이 유지돼 제목과 선택 장소 맥락이 가려질 수 있다(`src/components/silsigan/SilsiganRedesign.tsx:1771-1790`, `3130-3143`).

### 5.2 실행 계획

#### P0

- 허위 최신성 hero를 제거하고 오인 테스트를 핵심 사용성 게이트로 추가한다.
- 사람이 Turnstile을 통과해 선택→권리 동의→ticket→업로드→검수→공개 read→숨김/삭제→잔여 0건까지 수행한다.
- Q&A는 완전한 접근성·검수·신고 흐름이 준비될 때까지 feature flag를 끈다.

#### P1-high

- 장소 선택 직후 upload container를 `scrollTop=0`으로 이동하고 제목에 programmatic focus를 준다.
- 선택 장소명과 변경 버튼을 제출 시점까지 유지한다.
- 장소 변경 시 작성 중인 초안을 유지할지 초기화할지 명시적으로 확인한다.
- Android back, network, app URL bridge event가 실제 UI 상태와 연결되는지 실기기에서 검증한다.

#### P2

- 10명 moderated usability test로 홈→장소 판단, 지도→상세, 상세→제보, 신고·삭제를 측정한다.
- 네트워크 끊김, 권한 거부, 지도 실패, stale data, upload cancellation의 회복 시간을 측정한다.
- 표준 Chrome과 signed WebView에서 NAVER 지도·fallback 전환을 각각 재검증하고, provider 실패가 장소 상세 진입을 막지 않는지 확인한다.

### 5.3 핵심 과업 통과선

| 과업 | 통과선 |
| --- | ---: |
| 홈에서 현재 정보 유무 판별 | 90% 이상 |
| 지도에서 원하는 장소 상세 진입 | 90% 이상 |
| 선택 장소를 제출 전 정확히 회상 | 100% |
| 잘못된 장소 제보 | 0건 |
| 사진 없는 상태를 최근 사진으로 오인 | 0건 |
| 권한 거부·오프라인 뒤 복구 | 90% 이상 |

## 6. 개발 진행 계획서

### 6.1 진척도 분해

| 개발 축 | 진행도 | 근거 |
| --- | ---: | --- |
| 제품 코드 | 92% | 핵심 웹·API·사진·moderation·cost guard 구현 |
| 로컬 QA | 94% | 453/453, 모바일 4/4, lint/typecheck/build 통과 |
| Cloudflare staging | 82% | D1 0026, private R2, API/web, 지도 설정, cost guard generation 5 |
| 모바일·실기기 | 55% | 셸 테스트는 통과, 서명 빌드·양 플랫폼 실기기 증거 부족 |
| release·운영 | 43% | final scan, WAF, tail/alert, legal, rollback, production 승인 미완료 |

### 6.2 즉시 실행 순서

1. P0 truth/scroll 회귀 테스트를 먼저 추가한다.
2. hero empty state와 upload scroll/focus를 최소 diff로 수정한다.
3. `P0-00 evidence-ledger reconciliation`으로 `docs/security-gate.md`, `docs/real-device-qa.md`, `release-ledger.yaml`, `RELEASE_STATUS.md`, `docs/current-release-state.md`, `docs/developer-handoff-2026-07-21.md`의 active truth를 맞춘다. 역사 기록은 지우지 말고 superseded로 표시한다.
4. 453개 통합 테스트, 모바일 4개, lint, typecheck, Next/OpenNext build를 다시 실행한다.
5. source/diff 수동 보안 게이트, 비밀 패턴·history 검사, 의존성 감사, negative-path 회귀를 실행한다. Codex Security UI diff scan은 독립 보조 검토로 별도 기록한다.
6. source 변경을 먼저 커밋하고 evidence 문서에 exact source commit SHA를 넣는다.
7. source SHA를 넣은 문서 전용 delta에 `git diff --check`·비밀 패턴 scan·정합성 검사를 다시 실행한 뒤 evidence/인수인계 커밋을 만든다.
8. GitHub push 후 upstream `0/0`과 두 commit SHA를 ledger에 기록한다.

현재 변경을 먼저 보존해야 한다면 scan 후 “staging evidence baseline”으로 커밋할 수 있지만, P0 결함을 고치기 전에는 release candidate 또는 출시 완료로 표시하지 않는다.

### 6.3 개발 완료 정의

- 신규·기존 테스트 전부 통과, lint/typecheck/build 통과
- 수동 security gate에서 차단 finding 0건; Codex Security UI scan은 실행 여부와 결과를 별도 표시
- live 390px에서 hero truth와 upload context 직접 검증
- commit별 source SHA, test report, browser evidence가 연결됨
- GitHub push 뒤 upstream 차이 `0/0`
- production은 별도 승인 전 그대로 유지

## 7. 법률 계획서

### 7.1 현재 상태

- 파일 선택 전에 사진 권리 확인 checkbox가 있고, Worker가 현재 권리 정책 버전을 검증해 D1에 acceptance를 저장한다.
- iOS PrivacyInfo, Android backup/cleartext 제한, store privacy draft, source rights research가 있다.
- 완성된 공개 이용약관·개인정보처리방침·위치 약관, 실제 운영자 연락처, 미성년자 정책, 보유기간·처리위탁·국외이전 판단이 아직 닫히지 않았다.

### 7.2 P0 공개문서 패키지

- 서비스 이용약관: 서비스 한계, 실시간 정보 비보증, UGC 라이선스, 금지행위, 신고·차단·이의제기, 계정 종료를 명시한다.
- 개인정보처리방침: 처리 목적·항목·보유기간·파기·위탁·국외이전·권리행사·보호책임자·실제 연락처·안전조치를 명시한다.
- 위치정보: 개인위치정보를 처리하는지 데이터 흐름으로 판정하고, 해당 시 사업 신고/약관/동의/보유·파기 의무를 법률 전문가와 확인한다.
- UGC 정책: 사진 권리, 얼굴·번호판·민감정보, 신고, 자동숨김, 검수, 삭제, 이의제기를 사용자 문서와 운영 runbook에 일치시킨다.
- 미성년자: 가입 가능 연령, 법정대리인 동의 적용, 위치·사진·UGC 제한을 확정한다.
- 스토어 공개: Apple App Privacy와 Google Data Safety 답변을 실제 code/data flow와 대조한다.

### 7.3 공식 검토 기준

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Google Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en-GB)
- [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [개인정보 보호법](https://law.go.kr/LSW/lsInfoP.do?lsiSeq=270351)
- [위치정보법 제9조 관련](https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900340011)
- [위치정보법 제18조·제24조 관련](https://www.law.go.kr/LSW/LsiJoLinkP.do?docType=JO&joNo=002600000&languageType=KO&lsNm=%EC%9C%84%EC%B9%98%EC%A0%95%EB%B3%B4%EC%9D%98+%EB%B3%B4%ED%98%B8+%EB%B0%8F+%EC%9D%B4%EC%9A%A9+%EB%93%B1%EC%97%90+%EA%B4%80%ED%95%9C+%EB%B2%95%EB%A5%A0&paras=1)
- [개인정보 보호법 제22조의2 관련](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?ancYnChk=&chrClsCd=010202&lsJoLnkSeq=1029334873)

### 7.4 법률 게이트

- closed internal QA: 정책 draft와 test account 삭제가 가능하면 진행
- external invited beta: 공개 HTTPS 정책 URL, 실제 연락처, 위치정보 적용 판정, UGC 신고·삭제 담당자 필요
- public production: 법률 검토자·검토일·버전, store disclosure, source rights 승인, 정책 UI 노출을 모두 증거화

실제 작업 표면과 외부 입력:

- 개인정보 공개면: `src/app/privacy/page.tsx`
- 지원·실제 연락처 공개면: `src/app/support/page.tsx`
- 새 이용약관 공개면: `src/app/terms/page.tsx`
- 법률 승인 ledger: `docs/v2-legal-operations-gate.md`
- 스토어 대조표: `docs/store-privacy-disclosure-draft.md`
- release-state 검사: `tests/cloudflare-api.test.ts`의 policy/support/store disclosure gate와 `tests/ui-contract.test.ts`의 공개 route 계약
- 외부 필수 입력: 실제 사업자·운영자 정보, named legal reviewer와 검토일, 위치정보법 적용성 판정, Cloudflare 위탁·국외이전 판정, 최소 이용 연령 결정

external invited beta 전에 `/privacy`, `/support`, `/terms`의 live HTTPS 내용과 store disclosure가 같은 version·연락처·보유기간·처리자·위치/UGC 결정을 가리켜야 한다. 기존 live URL이 존재한다는 사실만으로 법률 gate를 통과시키지 않는다.

## 8. 백엔드 계획서

### 8.1 현재 상태

강점:

- anonymous proof, atomic issuance, role별 admin 권한, route/edge limiter가 있다.
- 60/70/80% 전역 비용 guard, fail-closed quota, idempotency와 one-time upload ticket, Turnstile/HMAC 사진 경로가 있다.
- raw IP 대신 HMAC fingerprint를 사용하고, private R2 read/delete와 storage budget reconciliation이 있다.
- D1 migration `0026`, staging API/web, private R2가 현재 운영 증거에 포함된다.

미완료:

- 사람이 수행한 사진 성공·검수·삭제 전체 생명주기가 없다.
- Worker에 도달하기 전 invocation cost를 막는 실제 WAF/static bypass 증거가 없다.
- D1 route 예약값이 평균 관측을 기반으로 해 쿼리 분포가 바뀌면 실제 rows read보다 적게 예약될 수 있다.
- provider circuit breaker가 instance-local `Map` 기반이라 분산 Worker에서 일관된 장애 상태를 보장하지 못한다.
- webhook은 timeout·bounded retry·delivery ledger 없이 실패가 삼켜질 수 있다.
- 공유 admin credential은 운영자별 attribution과 최소 권한 감사를 제한한다.
- tail, alert, rollback drill, production 관측 증거가 불완전하다.
- 단일 대형 Worker 파일과 수동 Env type은 변경 위험을 높인다.

### 8.2 실행 계획

#### P0 — staging 운영 안전

- 사람 Turnstile 사진 생명주기를 실행하고 D1/R2의 최종 잔여가 0인지 증명한다.
- Cloudflare WAF/rate-limit/static routing을 실제 staging에서 적용·관측해 Worker invocation 전 방어를 증명한다.
- D1 route별 검증된 upper bound와 최신 p99·safety factor 중 큰 값을 예약하고, 최신 provider reconciliation이 없으면 fail closed하도록 검증한다.
- redacted tail, 60/70/80% 경보 수신, kill/resume, timeout/cancellation을 실제 환경에서 확인한다.
- 실패·취소·중복·replay·oversize·quota/budget exhaustion의 negative path를 최종 후보에서 재실행한다.

#### P1 — 분산 신뢰성과 운영자 감사

- provider breaker 상태를 Durable Object/KV/D1 중 비용·일관성에 맞는 공유 상태로 이동한다.
- provider budget 계산은 고정 ID 대신 `data_sources.source_key` 또는 실제 조회된 `source.id`에 결합해 ID drift 시 집계가 빠지지 않게 한다.
- webhook을 timeout, bounded exponential backoff, deterministic idempotency key, delivery ledger, dead letter를 갖춘 outbox로 전환한다.
- 운영자별 secret 또는 identity-aware auth와 role을 적용하고 audit actor를 개인 단위로 기록한다.
- API rollback과 D1/R2 forward-fix를 분리한 실제 drill을 수행한다.

#### P2 — 구조 개선

- 14k+ line Worker를 auth, quota, photos, moderation, sources, alerts 단위로 점진 분리한다.
- Cloudflare Env type을 config/typegen과 연결해 수동 drift를 줄인다.
- 구조 변경 전 route contract와 negative-path 회귀 테스트를 고정하고 새 dependency는 추가하지 않는다.

### 8.3 백엔드 SLO

| 항목 | staging beta 통과선 |
| --- | ---: |
| unauthorized expensive work | 0건 |
| duplicate/replayed paid work | 0건 |
| 승인 전 사진 공개 | 0건 |
| 삭제 뒤 R2/D1 잔여 | 0건 |
| alert delivery success | 99% 이상 또는 명시적 dead letter |
| redacted log의 secret/raw IP/exact GPS | 0건 |
| budget 80% 이후 비필수 write | 0건 |

## 9. 통합 실행 로드맵

각 slice는 독립적으로 검증·되돌리기 가능해야 하며, 이전 gate가 닫히기 전 다음 slice를 출시하지 않는다.

### Slice 0 — 신뢰·source integrity 고정 (2026-07-22~07-24)

범위:

- hero empty-state truth contract와 회귀 테스트
- upload scroll/focus/selected-place context
- evidence-ledger active truth 정합성 복구와 historical section superseded 표시
- 360·390·430px browser/accessibility 증거
- full local verification, manual source/diff security gate; optional Codex Security UI diff scan
- source/evidence 두 커밋, push, upstream `0/0`

Exit gate:

- 사진 없는 상태 오인 0건
- [x] `docs/security-gate.md`의 이전 `422`, `docs/real-device-qa.md`의 `R2_NOT_ENABLED`/staging 미배포 문구를 historical/superseded 상태로 분리
- [x] `release-ledger.yaml`이 committed baseline과 dirty working tree를 분리하고, 최종 source commit 뒤 candidate SHA를 갱신하도록 pending 상태를 명시
- 신규 포함 전체 테스트, lint, typecheck, Next/OpenNext build 통과
- manual security gate 차단 finding 0건; optional UI scan status is explicit
- source SHA와 증거 문서가 일치

Rollback:

- UI·테스트 커밋 단위 revert; production 영향 없음

### Slice 1 — 실제 staging 사진·운영 증명 (2026-07-24~07-29)

범위:

- Slice 0의 exact source SHA로 staging web 배포, version·SHA 기록
- 실행 직전 사용자의 staging mutation 승인 획득
- 실제 staging web picker와 binary `POST /api/photos/upload-ticket` → `POST /api/photos/upload`만 사용해 사람 Turnstile 1회 이상 수행
- `POST /api/admin/photos/:photoId/moderation`으로 검수하고 guarded Worker로 read한 뒤 owner `DELETE /api/photos/:photoId` 또는 승인된 admin cleanup으로 제거
- `pnpm cf:r2:evidence -- --env=staging --check`와 `pnpm cf:d1:evidence -- --env=staging --check` 및 photo row/storage ledger 사전·사후 쿼리로 R2/D1 zero residual 확인
- redacted network, Turnstile 결과, moderation audit, R2/D1 전후 수치, 화면을 `artifacts/cloudflare-photo-e2e/2026-07-27-<source-sha>/`에 저장
- WAF·static bypass·tail·alert·kill/resume 실제 관측
- analytics receipt와 redaction 확인

Exit gate:

- staging web version과 source SHA가 일치
- 자동화 우회 없이 사진 전체 생명주기 성공
- legacy `/api/photos/complete`와 `scripts/cloudflare-staging-smoke.mjs`의 legacy photo mutation 경로 사용 0회
- 1 MiB/MIME/magic byte/replay/idempotency/quota/budget 실패 경로 통과
- provider budget cap·alert receiver·operator 이름 기록

Rollback:

- 실패 즉시 staging write를 끄고 feature flag off, object/row 정리, version rollback; cleanup owner가 R2/D1 zero residual을 재확인할 때까지 재시도 금지; production 영향 없음

### Slice 2 — 실기기·법률 closed beta (2026-07-29~08-05)

범위:

- signed iOS/Android 후보, 양 플랫폼 실기기 QA
- deep link, back, keyboard, safe area, offline, permission denial, photo, delete
- 이용약관·개인정보·위치 판정·UGC·미성년자·실제 연락처 공개 URL
- Q&A off 유지, moderation/on-call 담당자 확정

Exit gate:

- build ID/source SHA/device 결과 분리 기록
- real-device P0 crash와 privacy leak 0건
- invited beta용 HTTPS 정책 URL과 담당자 승인

Rollback:

- internal distribution 중단, build 폐기, server feature flag off

### Slice 3 — 광안리 통제형 베타 (2026-08-06~08-21)

범위:

- 10명, 5일, 하루 2회 사용성·리텐션 실험
- 광안리 30개 장소, 100개 제보, 30개 위치 확인, 30개 승인 사진
- fresh coverage, false freshness, moderation SLA, D1/D7 측정

Exit gate:

- 핵심 판단 성공률 90% 이상, 사진 오인 0건, 잘못된 장소 제보 0건
- D7 20% 이상, 추천→상세 30% 이상, 검수 SLA 95% 이상
- 비용·오류·신고가 운영 용량 안에 있음

Rollback:

- 모집 중단, 지역 flag off, write 제한, 정책 공지 후 데이터 정리

### Slice 4 — production 후보와 제한 확장 (2026-08-22~10-20)

범위:

- distributed breaker, reliable alert outbox, operator identity/RBAC
- legal/store/source-rights 최종 승인
- production resource preflight, migration/backup/rollback 계획
- 별도 승인된 production 배포와 read-only→limited write 순차 승격

Exit gate:

- production WAF·budget cap·alerts·kill switch 실제 관측
- production source SHA/build ID/migration/R2/D1/real-device evidence 분리 기록
- 공개 지역의 실제 fresh coverage와 moderation capacity 충족

Rollback:

- version rollback, write flag off, migration은 사전 승인된 forward-fix, R2/D1 정합성 검사

## 10. 30·60·90일 운영 계획

| 기간 | 목표 | 출시 범위 | 핵심 증거 |
| --- | --- | --- | --- |
| 0~7일 | P0 truth·사진·운영 게이트 폐쇄 | staging only | manual security gate, human photo E2E, WAF/tail/alert, source SHA |
| 8~30일 | 실기기·법률·광안리 통제 베타 | invited beta | device matrix, 정책 URL, 10명/5일 KPI |
| 31~60일 | backend 분산 신뢰성·운영자 감사 | 제한 지역 | shared breaker, reliable outbox, RBAC, rollback drill |
| 61~90일 | 별도 승인된 production 후보 | gate 통과 지역만 | production 관측, store/legal/source rights, cost SLO |

90일은 자동 출시일이 아니다. Exit gate가 미달이면 해당 단계에서 멈추고 지역·기능·비용 범위를 축소한다.

## 11. 통합 P0 보드

| ID | 작업 | 책임 | 목표일 | 선행조건 | 완료 증거 |
| --- | --- | --- | --- | --- | --- |
| P0-00 | evidence-ledger 정합성 복구 | Orchestrator + Release | 2026-07-24 | P0-01~02 결과 | 6개 truth surface의 SHA·branch·dirty·453·API/R2 상태 일치 |
| P0-01 | 허위 최신성 hero 제거 | Design + Frontend | 2026-07-24 | 없음 | empty-state tests + 3 viewport screenshots |
| P0-02 | upload scroll/focus/장소 맥락 | UX + Frontend | 2026-07-24 | 없음 | cross-entry browser + screen reader 결과 |
| P0-03 | final diff security gate | Security + Orchestrator | 2026-07-24 | P0-00~02 | source/diff, secret/history, dependency, negative-path finding 0건; optional UI scan status explicit |
| P0-04 | source/evidence commit·push | Orchestrator | 2026-07-24 | P0-03 | 2 SHA + upstream 0/0 |
| P0-05 | exact SHA staging web 배포 | Frontend + Cloudflare Operator | 2026-07-25 | P0-04 | web version + source SHA + smoke |
| P0-06 | 사람 Turnstile binary 사진 E2E | Operator + Backend | 2026-07-27 | P0-05 + 사용자 mutation 승인 | real picker, non-legacy endpoints, redacted artifact, R2/D1 0 residual |
| P0-07 | WAF·D1 route bound·tail·alert·kill/resume | Backend + Cloudflare Operator | 2026-07-29 | P0-06 | route upper bound/p99, fresh reconciliation, dashboard/tail/alert evidence |
| P0-08 | iOS·Android 실기기 matrix | Mobile + QA | 2026-08-05 | P0-06 | build/source/device evidence |
| P0-09 | beta 법률 공개문서 | Legal + Operator | 2026-08-05 | 실제 사업자 정보 + named reviewer + 위치정보 적용 판정 | `/privacy`·`/support`·`/terms`, gate docs, tests, versioned HTTPS URLs |
| P0-10 | 광안리 seed·10명 beta | Marketing + Ops | 2026-08-21 | P0-00~09 | KPI report + incident/cost report |

## 12. 위험 등록부

| 위험 | 등급 | 완화 | 책임 | 목표일/게이트 |
| --- | --- | --- | --- | --- |
| 기본 사진이 실제 최신 사진처럼 보임 | Critical product trust | P0-01 truth empty state | Design/Frontend | 2026-07-24 |
| Turnstile 때문에 실제 업로드 미검증 | High | 사람 E2E, 무우회 | Operator/Backend | 2026-07-27 |
| Worker 도달 전 비용 hard cap 미증명 | High cost abuse | 실제 WAF/static bypass 관측 | Backend/Ops | 2026-07-29 |
| D1 평균 기반 예약이 실제 rows read를 과소계상 | Medium cost abuse | route upper bound와 fresh p99 중 큰 값, stale reconciliation fail-close | Backend/Ops | 2026-07-29 |
| 실기기 bridge·권한·삭제 미검증 | High release | 양 플랫폼 matrix | Mobile/QA | 2026-08-05 |
| 정책·연락처·위치 적용 판정 미완료 | High legal | versioned public package + counsel | Legal/Operator | invited beta 전 |
| in-memory provider breaker | Medium-high reliability | 공유 breaker state | Backend | 2026-08-14 |
| webhook 실패 유실 | Medium-high operations | outbox/retry/dead letter | Backend | 2026-08-14 |
| 공유 admin credential | Medium audit | operator identity/RBAC | Security/Backend | 2026-08-21 |
| provider budget 고정 ID drift | Medium cost accounting | source_key/실제 source.id 결합 | Backend | 2026-08-14 |
| desktop 빈 레이아웃·작은 터치 대상 | Medium UX | token/a11y/responsive pass | Design | public web 전 |
| 광안리 외 fresh coverage 미확인 | High marketing truth | 지역별 gate와 coverage 공개 | Marketing/Ops | 지역 확대 전 |

잔여 위험은 코드만으로 닫히지 않는다. WAF, provider budget, 법률 검토, 실기기, 사람 Turnstile, production 관측은 각 담당자가 target 환경에서 증거를 남겨야 한다.

## 13. 보안·비용 출시 게이트

- [ ] 최종 diff에서 hardcoded secret과 민감 로그 0건
- [ ] authN→authZ→quota/budget 순서와 deny-by-default 유지
- [ ] 업로드 1 MiB, MIME/magic byte/pixel/EXIF/duplicate 검증
- [ ] burst·rolling·daily·global spend limit와 identity rotation 공격 테스트
- [ ] idempotency, nonce/one-time ticket, stale/replay/collision 거부
- [ ] timeout, cancellation, bounded retry, concurrency/queue 상한
- [ ] raw IP·정확 GPS·token·object key·원본 파일명 비저장/비로그
- [ ] WAF·static bypass·60/70/80 alert·kill switch를 staging에서 관측
- [ ] alert delivery 실패가 outbox/dead letter에 남음
- [ ] production provider cap과 알림 수신자를 별도 승인
- [ ] auth/validation/budget/replay/oversize/timeout의 negative tests 통과

## 14. 이번 계획의 비범위

- 이 문서 작성 자체로 production resource, migration, domain, key, store submission을 변경하지 않는다.
- Turnstile을 자동화로 우회하지 않는다.
- Q&A, DM, 실시간 채팅, 동영상, 라이브 방송, 광고 SDK, 현금성 보상을 이번 P0 범위에 넣지 않는다.
- public R2 URL, 원본 사진 공개, 정확 GPS 저장을 허용하지 않는다.
- 새 dependency나 전면 rewrite를 도입하지 않는다.
- 테스트 통과를 사용자 traction, 법률 승인, production 관측으로 표현하지 않는다.

## 15. 최종 의사결정 규칙

1. **지금:** 공개 출시 HOLD, staging 감사와 P0 수정만 진행한다.
2. **P0-00~09 통과:** 광안리 10명 invited beta GO.
3. **Slice 3 KPI 통과:** 제한 지역 production candidate 검토 GO.
4. **법률·실기기·비용·production 관측 중 하나라도 미통과:** 공개 출시 NO-GO.
5. **출시 뒤:** false freshness, 신고 SLA, 비용 spike, 삭제 잔여 중 하나라도 임계 초과 시 지역 write를 즉시 중단하고 read-only/fallback으로 축소한다.

## 16. 근거 문서

- `docs/current-release-state.md`
- `docs/developer-handoff-2026-07-21.md`
- `docs/cloudflare-staging-operator-packet.md`
- `docs/launch-seed-operations-plan.md`
- `docs/v2-legal-operations-gate.md`
- `docs/store-privacy-disclosure-draft.md`
- `docs/real-device-qa.md`
- `docs/security-gate.md`
- `release-ledger.yaml`

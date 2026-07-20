# #실시간 스토어 등록 초안

Updated: 2026-07-20  
Status: local candidate only; App Store submission blocked

## Product Positioning

- 앱 이름 후보: `#실시간`
- 부제 후보: `가기 전, 지금 현장 사진 확인`
- 한 줄 가치: 가려는 장소의 최근 사진과 관측시각을 보고 출발 전 판단을 돕습니다.
- 핵심 차별점: 일반 지도 검색이 아니라 `#지금` 해시태그와 장소별 최근 현장 사진을 중심으로 탐색합니다.
- 전국 범위 원칙: 전국에서 검색과 제보 기능을 제공하되 최신 근거가 없는 장소는 상태를 만들지 않고 `최근 확인 정보 없음`으로 표시합니다.

## Promotional Copy Draft

### 짧은 소개

가기 전, 지금 상황만 빠르게 확인하세요. 최근 현장 사진과 관측시각, 혼잡·주차·줄 정보를 장소별로 모아 보여드립니다.

### 상세 설명

`#실시간`은 목적지에 도착하기 전에 현재 상황을 확인하도록 돕는 장소 앱입니다.

- 최근 현장 사진과 관측시각 확인
- 장소별 혼잡·주차·줄·날씨 근거 확인
- `#지금` 등 해시태그로 최신 사진 탐색
- 전국 장소 검색과 지역별 탐색
- 지금컷 제보, 저장, 신고 및 검수 상태 확인

오래됐거나 근거가 없는 정보는 좋은 상태처럼 추천하지 않습니다. 최근 근거가 부족한 장소는 판단을 보류하고, 확인된 출처와 시각이 있는 정보만 최신 상태로 다룹니다.

### 검색 키워드 후보

`실시간,장소,현장사진,혼잡,주차,대기,여행,지도,해시태그`

최종 키워드와 문구 길이는 App Store Connect 입력 시점의 콘솔 제한과 상표 검토를 다시 통과해야 합니다.

## Local Screenshot Candidate Manifest

아래 이미지는 실제 앱 UI와 로컬 mock Worker의 안전한 fixture를 사용한 390×844 검증 후보입니다. 기능·배치 검토용이며 App Store Connect에 제출할 최종 증거가 아닙니다.

| 순서 | 메시지 | 로컬 후보 |
| --- | --- | --- |
| 1 | `가기 전, 지금 사진으로 먼저 확인` | `artifacts/store-listing-candidate/pages-smoke-home-1784509404889.png` |
| 2 | `사진·관측시각·판단 근거를 한 화면에` | `artifacts/store-listing-candidate/pages-smoke-place-1784509404889.png` |
| 3 | `#지금으로 최신 현장 사진 탐색` | `artifacts/store-listing-candidate/pages-smoke-hashtag-1784509404889.png` |
| 4 | `제보와 저장 상태를 기기 기준으로 관리` | `artifacts/store-listing-candidate/pages-smoke-my-1784509404889.png` |

검증 동반 증거:

- 네트워크 로그: `artifacts/store-listing-candidate/pages-smoke-network-1784509404889.json`
- 콘솔 로그: `artifacts/store-listing-candidate/pages-smoke-console-1784509404889.log`
- 로컬 브라우저 결과: 필수 상호작용 58/58 통과, 네트워크 이벤트 664건, request body 미저장, 민감정보 탐지 0건
- 마이 후보는 비활성 회원 전환을 약속하지 않고, 기기 변경 또는 브라우저 데이터 삭제 시 복구할 수 없다는 실제 익명 사용 범위를 표시합니다.

## Final Replacement Gate

다음 조건을 모두 만족하기 전에는 위 후보를 스토어에 제출하지 않습니다.

1. live staging API, R2, D1 `0018`-`0026`, 전용 cost-state KV, WAF/static-routing, Turnstile, API Worker 배포와 60/70/80 비용 방어·익명 proof lifecycle·exact issuance-budget·비공개 장소 요청 선차단 실증이 완료되어야 합니다.
2. 최종 배포 앱을 설치한 실제 iPhone에서 같은 4개 흐름을 다시 캡처해야 합니다.
3. 사진과 제보는 공개 승인을 받은 실제 콘텐츠여야 하며 얼굴, 차량번호, 원본 파일명, 좌표 등 개인정보가 없어야 합니다.
4. 화면의 출처, 관측시각, 검수 상태가 live staging 응답과 일치해야 합니다.
5. 지도 화면은 NAVER 소유자 도메인, 정확한 허용 origin, 정상 origin 성공, 비허용 origin 거절 증거가 완성된 뒤에만 후보에 추가합니다.
6. 전국 어디서나 실시간 정보가 있다는 표현, 보장된 정확도, 가짜 사용자 수, 보상·광고·Q&A·라이브 스트림 등 비활성 기능을 홍보하지 않습니다.

## Store URLs And Review Notes

- 개인정보 처리방침: `https://silsigan-web-production.dudqks0319.workers.dev/privacy`
- 지원: `https://silsigan-web-production.dudqks0319.workers.dev/support`
- TestFlight 리뷰 지침: `docs/testflight-review-notes.md`
- 개인정보 공개 초안: `docs/store-privacy-disclosure-draft.md`

공개 URL은 현재 HTTP 200 증거가 있지만, 최종 콘솔 입력과 법무 담당자의 기명 검토는 별도 출시 게이트입니다.

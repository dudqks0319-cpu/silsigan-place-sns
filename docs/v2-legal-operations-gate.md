# #실시간 V2 법무 및 운영 게이트

Updated: 2026-07-10
State: `blocked-external`

이 문서는 법률 자문이나 승인을 대신하지 않는다. 로컬 구현이 끝난 항목과 실제 담당자의 검토·서명·콘솔 증거가 필요한 항목을 분리하고, 증거가 없는 기능은 활성화하지 않는 기준을 고정한다.

## Ownership

| 영역 | 책임 역할 | 완료 시점 | 현재 상태 |
| --- | --- | --- | --- |
| 개인정보·위치정보·계정삭제 | legal-safety | external TestFlight review 전 | 담당자 이름과 서명일 미기록 |
| UGC 신고·차단·삭제·온콜 | trust-safety lead | staging mutation smoke 전 | runbook 준비, 실제 담당자·webhook secret 미설정 |
| 공공데이터 약관·표시 문구 | data-operations + legal-safety | source별 enable 전 | 코드 gate 준비, source별 외부 승인 미완료 |
| NAVER Web Maps origin·key 제한 | release-operator | staging browser smoke 전 | 콘솔 증거 미확인 |
| iOS/Android 권한·스토어 고지 | mobile-release + legal-safety | internal testing 전 | WebView 계약 준비, native·store 증거 미완료 |
| 광고 정책·동의·추적 | product + legal-safety | M6 검증 후 M8 활성화 전 | `ADS_ENABLED=false`, SDK 미설치 |

## Legal Review

다음 항목은 검토자 이름, 검토일, 정책 버전, 결과, 후속 조치가 release ledger에 기록돼야 한다.

- 개인정보 처리방침과 실제 D1/R2/KV/Workers log 처리의 일치.
- 위치 권한 목적, raw coordinate 비저장, 거리·정확도 구간 저장, 권한 거부 시 일반 제보 전환.
- 사진 원본 미보관, metadata 제거, 재인코딩, 공개 전 검수, 작성자·운영자 삭제.
- 익명 기본 사용, 선택적 회원 전환, 계정 복구·탈퇴·삭제, 연령·동의 정책.
- 신고·차단·자동 숨김·이의제기·운영 감사와 UGC 대응 SLA.
- 공공데이터·지도·외부 이미지·CCTV·YouTube의 상업 이용, attribution, cache, embed, 재배포 조건.
- App Store와 Play Console의 privacy label, data safety, 위치·카메라·알림 권한 설명.
- 최종 `SILSIGAN_PRIVACY_POLICY_URL`과 `SILSIGAN_SUPPORT_URL`의 공개 접근성.

## Source Activation

각 source는 별도 검토 행을 가져야 하며 묶음 승인하지 않는다. 필수 증거는 공식 약관 URL, 검토일, 검토자, commercial use 상태, attribution 문구, agreement 여부, 허용 지역, TTL, health, credential owner다.

- `tour_api`: 정적 장소 메타데이터만 허용하며 이미지 권리가 확인될 때까지 `image_use_allowed=0`.
- `national_parking`: 시설·요금 정적 데이터이며 실시간 빈자리로 해석하지 않는다.
- `national_traffic`: provider 관측 시각을 보존하고 속도에서 파생한 혼잡 분류는 `isEstimated=true`로 표시한다.
- `national_cctv`: 위치·도로 metadata만 허용한다. stream URL 저장, 공개, proxy, restream, playback은 금지한다.
- `youtube_live`: 채널·영상 소유권과 embed 조건 확인 전 disabled 상태를 유지한다.
- source 권리 또는 health가 철회되면 즉시 disabled 처리하고 현재 판단·cache·UI 노출에서 제외한다.

## Moderation Readiness

- operator, moderator, admin 실제 담당자와 최소 권한을 지정한다.
- `MODERATION_ALERT_WEBHOOK_URL`은 staging에서 redacted payload와 실패 재시도를 검증한다.
- 병원·관공서 민감정보 12h, 일반 개인정보 24h, 허위·스팸 72h SLA를 연습한다.
- hide, restore, delete, restrict, unblock, account deletion의 성공·거부·감사 로그 증거를 남긴다.
- 원본 좌표, 원본 IP, 원본 파일명, token, 신고 note 원문이 응답·webhook·tail log에 없는지 확인한다.

## Ads Gate

- M6 KPI 검증과 별도 제품 승인이 없으면 광고 검토를 시작하지 않는다.
- M8 이전에는 `ADS_ENABLED=false`를 유지하고 광고 SDK, 광고 식별자, 추적 권한, 광고 placement를 production 경로에 넣지 않는다.
- 활성화 변경에는 동의 철회, 비회원 처리, 미성년자 정책, 스토어 고지, 네트워크 약관, 빈도 제한, 신고 UX 검토가 필요하다.
- 광고 활성화는 V2 핵심 방문 판단 품질 또는 접근성을 낮추면 승인하지 않는다.

## Sign-Off Record

| Gate | Named reviewer | Review date | Policy version | Evidence | Decision |
| --- | --- | --- | --- | --- | --- |
| 개인정보·위치·계정삭제 | pending | pending | 2026-07-10 draft | final public URLs required | blocked |
| UGC 운영·온콜 | pending | pending | 2026-07-10 draft | staging queue drill required | blocked |
| 공공데이터 source rights | pending | pending | source별 기록 필요 | admin source audit required | blocked |
| iOS/Android store disclosure | pending | pending | native build별 기록 필요 | real-device QA required | blocked |
| 광고 M6/M8 | pending | pending | not activated | `ADS_ENABLED=false` | blocked |

## Stop Conditions

다음 중 하나라도 참이면 source 활성화, staging release candidate, production migration, TestFlight external review, 광고 활성화를 중단한다.

- named reviewer, review date, 또는 증거 링크가 비어 있다.
- source rights, attribution, health, region, TTL 중 하나가 확인되지 않았다.
- raw coordinate, 원본 사진, 원본 IP, secret, 원본 파일명이 저장·로그·응답에 노출된다.
- 신고 큐 담당자나 `MODERATION_ALERT_WEBHOOK_URL` 운영 증거가 없다.
- privacy/support 최종 HTTPS URL 또는 store disclosure가 준비되지 않았다.
- NAVER origin 제한, D1 V2 migration, R2, staging smoke, 실기기 QA가 완료되지 않았다.
- 광고의 경우 M6 제품 승인과 M8 법무·스토어 승인이 모두 기록되지 않았다.

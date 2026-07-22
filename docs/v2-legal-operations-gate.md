# #실시간 V2 법무 및 운영 게이트

Updated: 2026-07-22
State: `blocked-external`

이 문서는 법률 자문이나 승인을 대신하지 않는다. 로컬 구현이 끝난 항목과 실제 담당자의 검토·서명·콘솔 증거가 필요한 항목을 분리하고, 증거가 없는 기능은 활성화하지 않는 기준을 고정한다.

## Ownership

| 영역 | 책임 역할 | 완료 시점 | 현재 상태 |
| --- | --- | --- | --- |
| 개인정보·위치정보·계정삭제 | legal-safety | external TestFlight review 전 | 담당자 이름과 서명일 미기록 |
| UGC 신고·차단·삭제·온콜 | trust-safety lead | staging mutation smoke 전 | runbook 준비, 실제 담당자·webhook secret 미설정 |
| 공공데이터 약관·표시 문구 | data-operations + legal-safety | source별 enable 전 | 코드 gate 준비, source별 외부 승인 미완료 |
| NAVER Web Maps domain·key·한도 제한 | release-operator | staging browser smoke 전 | 공유 `workers.dev` 사용 금지 게이트와 운영 패킷 준비, 소유 custom domain·콘솔 로그인 증거 미완료 |
| iOS/Android 권한·스토어 고지 | mobile-release + legal-safety | internal testing 전 | PrivacyInfo·백업 차단·스토어 초안 로컬 준비, archive·console·실기기 증거 미완료 |
| 광고 정책·동의·추적 | product + legal-safety | M6 검증 후 M8 활성화 전 | `ADS_ENABLED=false`, SDK 미설치 |

## Legal Review

다음 항목은 검토자 이름, 검토일, 정책 버전, 결과, 후속 조치가 release ledger에 기록돼야 한다.

- 개인정보 처리방침과 실제 D1/R2/KV/Workers log 처리의 일치.
- 위치 권한 목적, raw coordinate 비저장, 거리·정확도 구간 저장, 권한 거부 시 일반 제보 전환.
- 사진 원본 미보관, metadata 제거, 재인코딩, 공개 전 검수, 작성자·운영자 삭제.
- 매 사진의 촬영·게시 권한 확인 문구, `photo-rights-2026-07-20-v1` 버전 기록, 철회·삭제 경계와 실제 권리 분쟁 처리 절차.
- 익명 기본 사용, 선택적 회원 전환, 계정 복구·탈퇴·삭제, 연령·동의 정책.
- 신고·차단·자동 숨김·이의제기·운영 감사와 UGC 대응 SLA.
- 공공데이터·지도·외부 이미지·CCTV·YouTube의 상업 이용, attribution, cache, embed, 재배포 조건.
- App Store와 Play Console의 privacy label, data safety, 위치·카메라·알림 권한 설명.
- 최종 `SILSIGAN_PRIVACY_POLICY_URL`과 `SILSIGAN_SUPPORT_URL`의 공개 접근성.

## Public Policy Surfaces

내부 베타의 현재 공개 정책 표면은 `/privacy`, `/support`, `/terms`다. 세 페이지는 각각 개인정보 처리, 지원·신고·이의제기, 서비스·UGC 이용 규칙을 설명하고 서로 연결한다. 문서 버전은 `2026-07-22-v1`이며 내부 베타 적용일만 2026-07-22로 고정한다. 외부 공개 효력 발생일은 아래 외부 입력과 named legal reviewer 승인이 기록된 뒤 별도로 정한다.

정책 화면에 `pending`, 임시 이름·이메일·전화번호 또는 검증되지 않은 법률 결론을 실제 운영 정보처럼 넣지 않는다. 현재 화면은 미확정 항목을 명시하고 외부 TestFlight와 production 출시를 차단한다.

| External input | Required evidence | Owner | Current state |
| --- | --- | --- | --- |
| 운영자 법적 명칭·주소·대표 연락처 | 사업자/법인 원본과 공개 표시 승인 | release owner + legal-safety | missing; blocked |
| 개인정보 보호책임자·담당 부서·권리 요청 채널 | 담당자 승인, 수신 시험, 본인 확인·응답 절차 | legal-safety | missing; blocked |
| Cloudflare 계약 주체·처리 지역·보유 설정 | 계약/DPA, 실제 data location, D1/R2/KV/Workers 설정 대조 | legal-safety + Cloudflare operator | classification pending; blocked |
| 위탁·국외 이전 분류 | 법적 근거, 고지·동의·계약 및 거부 방법 검토 | named legal reviewer | pending; blocked |
| 위치정보법 적용 여부 | 사업·서비스 분류, 별도 약관·신고·동의 필요 여부 | named legal reviewer | pending; blocked |
| 항목별 보유·파기 기간 | 기능 TTL, 비공개 전환, 물리 삭제·backup/cache SLA 대조 | legal-safety + data-operations | exact schedule pending; blocked |
| 미성년자 정책 | 연령 기준, 법정대리인 확인·동의·철회·삭제 절차 | named legal reviewer | pending; blocked |
| UGC 이의제기 운영 | trust-safety 담당자, 재검토 분리, 응답 SLA, 도용·초상권 절차 | trust-safety lead | operator and SLA pending; blocked |
| 약관 책임·분쟁 조항 | 준거법, 관할, 책임 제한의 유효성 검토 | named legal reviewer | pending; blocked |
| 최종 정책 URL | 서로 구분된 `/privacy`, `/support`, `/terms` 공개 HTTPS 접근 증거 | release operator | external custom domain pending; blocked |

정책 승인은 위 행을 묶어서 추정하지 않는다. 각 행은 reviewer 이름, 검토일, 근거 링크, 결론과 후속 조치가 release ledger에 있을 때만 `approved`로 바꾼다.

## Retention And Rights Schedule

현재 구현 경계와 법률상 최종 보유 기간을 분리한다.

- 현장 제보는 기본 3시간 뒤 공개 목록에서 제외되지만, 비공개 전환과 물리 삭제는 같은 의미가 아니다. D1/R2/KV/cache별 삭제 시점과 최대 보유 기간을 확정해야 한다.
- 사진 삭제는 공개 중단, D1 상태, R2 object, KV/cache를 모두 확인하며 원본 업로드 파일은 보관하지 않는다.
- 댓글·신고·감사·오남용 기록은 분쟁과 법적 의무에 필요한 최소 범위만 보유하되, 항목별 최대 기간과 파기 주기가 확정되기 전에는 외부 UGC를 열지 않는다.
- 열람·정정·삭제·처리정지·동의 철회·계정/익명 활동 삭제 요청은 검증된 채널, 최소 본인 확인, 처리 결과와 이의제기 안내를 가져야 한다.
- backup, cache, log에 남는 잔존 데이터의 삭제 경계와 예외 사유를 최종 처리방침 및 store disclosure와 일치시킨다.

## Source Activation

각 source는 별도 검토 행을 가져야 하며 묶음 승인하지 않는다. 필수 증거는 공식 약관 URL, 검토일, 검토자, commercial use 상태, attribution 문구, agreement 여부, 허용 지역, TTL, health, credential owner다.

2026-07-19 공식 제공 페이지 조사와 제품별 허용·금지·표시 문구 초안은 `docs/source-rights-research-2026-07-19.md`에 기록했다. 이는 조사 증거이며 named legal-safety 승인이나 provider 운영 승인이 아니다.

NAVER Maps는 공공데이터 source와 분리해 `docs/naver-maps-release-operator-packet.md`를 따른다. 공식 콘솔이 대표 도메인을 등록하는 구조이므로 `workers.dev`, `pages.dev`, `vercel.app` 같은 공유 호스팅 도메인은 Client ID 제한 증거로 인정하지 않는다. 소유 custom domain, 대표 계정 여부, Dynamic Map 선택, 이용 한도, 70% 시작 임계치, 실제 통보 대상, 정상 origin 성공·잘못된 origin 실패가 모두 필요하다.

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
- 사진 파일 입력은 현재 권리 확인 전 비활성화하고, Worker는 현재 버전 확인이 없는 티켓을 `PHOTO_RIGHTS_ATTESTATION_REQUIRED`로 선차단한다. 이 로컬 확인은 저작권 소유 증명이 아니므로 도용 신고와 실제 담당자 검토를 생략하지 않는다.
- 원본 좌표, 원본 IP, 원본 파일명, token, 신고 note 원문이 응답·webhook·tail log에 없는지 확인한다.

## Ads Gate

- M6 KPI 검증과 별도 제품 승인이 없으면 광고 검토를 시작하지 않는다.
- M8 이전에는 `ADS_ENABLED=false`를 유지하고 광고 SDK, 광고 식별자, 추적 권한, 광고 placement를 production 경로에 넣지 않는다.
- 활성화 변경에는 동의 철회, 비회원 처리, 미성년자 정책, 스토어 고지, 네트워크 약관, 빈도 제한, 신고 UX 검토가 필요하다.
- 광고 활성화는 V2 핵심 방문 판단 품질 또는 접근성을 낮추면 승인하지 않는다.

## Sign-Off Record

| Gate | Named reviewer | Review date | Policy version | Evidence | Decision |
| --- | --- | --- | --- | --- | --- |
| 개인정보·위치·계정삭제 | pending | pending | privacy-beta-2026-07-22-v1 | operator/controller, retention, Cloudflare classification, final public URL required | blocked |
| 이용약관·미성년자·분쟁 | pending | pending | terms-beta-2026-07-22-v1 | operator identity, location-law decision, minors and disputes review required | blocked |

외부 공개 후보는 `SILSIGAN_PRIVACY_POLICY_URL`, `SILSIGAN_SUPPORT_URL`, `SILSIGAN_TERMS_URL`을 서로 다른 최종 HTTPS URL로 고정하고 release-state 검사를 통과해야 한다. 현재 `workers.dev` 값은 후보 경로 검증용이며 owner-domain과 named legal review를 대신하지 않는다.
| UGC 운영·온콜·이의제기 | pending | pending | support-beta-2026-07-22-v1 | named trust-safety owner, verified channel, SLA and staging queue drill required | blocked |
| 공공데이터 source rights | research prepared | pending | `docs/source-rights-research-2026-07-19.md` | named reviewer + admin source audit required | blocked |
| iOS/Android store disclosure | pending | pending | `docs/store-privacy-disclosure-draft.md` | archive privacy report + console answers + real-device QA required | blocked |
| 광고 M6/M8 | pending | pending | not activated | `ADS_ENABLED=false` | blocked |

## Stop Conditions

다음 중 하나라도 참이면 source 활성화, staging release candidate, production migration, TestFlight external review, 광고 활성화를 중단한다.

- named reviewer, review date, 또는 증거 링크가 비어 있다.
- source rights, attribution, health, region, TTL 중 하나가 확인되지 않았다.
- raw coordinate, 원본 사진, 원본 IP, secret, 원본 파일명이 저장·로그·응답에 노출된다.
- 신고 큐 담당자나 `MODERATION_ALERT_WEBHOOK_URL` 운영 증거가 없다.
- privacy/support 최종 HTTPS URL 또는 store disclosure가 준비되지 않았다.
- `/terms` 최종 HTTPS URL, 운영자 법적 정보, 개인정보 보호책임자·권리 요청 채널 또는 외부 효력 발생일이 비어 있다.
- Cloudflare 위탁·국외 이전 분류, 위치정보법 적용 여부, 항목별 보유·파기 기간 또는 미성년자 절차가 named reviewer에게 승인되지 않았다.
- UGC 신고·도용·초상권 처리, 재검토 담당자 분리, 이의제기 채널 또는 응답 SLA가 검증되지 않았다.
- NAVER 소유 custom domain·대표 도메인 제한·이용 한도·알림, D1 V2 migration, R2, staging smoke, 실기기 QA가 완료되지 않았다.
- 광고의 경우 M6 제품 승인과 M8 법무·스토어 승인이 모두 기록되지 않았다.

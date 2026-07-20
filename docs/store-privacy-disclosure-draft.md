# #실시간 App Privacy and Data Safety draft

## Status And Scope

- 상태: `draft`. 이 문서는 현재 저장소 구현을 기준으로 작성한 제출 초안이며 App Store Connect 또는 Google Play Console에 제출했다는 증거가 아닙니다.
- 범위: iOS/Android 네이티브 셸, 웹 앱, Worker API, D1/R2 및 현재 포함된 SDK입니다.
- 출시 전 모바일 릴리스 담당자와 `legal-safety` named reviewer가 실제 빌드, 제3자 SDK, 처리업체 계약 및 공개 UGC 동작을 다시 대조해야 합니다.
- 광고, 데이터 판매 및 제3자 광고 추적은 현재 범위에 없으며 `tracking`은 비활성 상태로 신고하는 초안입니다.

## Data Inventory

| Store category | Trigger and handling | Purpose | Linked | Tracking |
| --- | --- | --- | --- | --- |
| precise location | 사용자가 현장 확인을 실행할 때 서버에서 장소와의 거리를 검증합니다. 원시 좌표는 검증 요청 동안만 처리하고 영구 저장하지 않습니다. | App functionality | 보수적으로 Yes | No |
| coarse location | 거리·정확도 구간과 지역 문맥을 반환하며 원시 좌표를 웹 브리지 결과에 노출하지 않습니다. | App functionality | 보수적으로 Yes | No |
| photos or videos | 사용자가 매 사진마다 촬영·게시 권한과 안전 검수를 확인한 뒤 선택한 사진을 재인코딩하여 메타데이터와 원본 파일명을 제거하고, 검수 대기 상태로 저장한 뒤 승인된 파생본만 공개합니다. 현재 동영상 업로드는 비활성입니다. | App functionality | Yes | No |
| other user content | 댓글, 신고 사유, 해시태그와 현장 제보를 처리하며 공개 콘텐츠는 운영 정책에 따라 숨김·복원·삭제될 수 있습니다. | App functionality | Yes | No |
| search history | 장소·해시태그 검색어를 요청 처리에 사용합니다. 광고 프로필에는 사용하지 않습니다. | App functionality | 보수적으로 Yes | No |
| User ID | 안정적인 익명 식별자와 선택적 회원 연결 지점을 기능 제공·오남용 방지·집계에 사용합니다. | App functionality, Analytics | Yes | No |
| Device ID | 푸시 토큰 또는 기기 알림 식별자의 해시값만 서버 기능에 사용합니다. 원문 토큰을 분석 이벤트에 기록하지 않습니다. | App functionality | Yes | No |
| product interaction | 허용 목록 기반 화면·행동 이벤트를 베타 KPI와 제품 개선에 집계하며 행위자는 해시 처리합니다. | Analytics | Yes | No |
| other diagnostic data | 안전한 런타임 이벤트만 수집하며 원시 오류 메시지, 스택, 요청 본문 및 비밀값은 분석 이벤트에서 제외합니다. | App functionality, Analytics | 보수적으로 Yes | No |

`Linked`는 안정적인 익명 세션과 연결될 가능성을 기준으로 보수적으로 작성했습니다. 공개 UGC 노출과 서비스 처리업체 전송이 각 스토어의 “공유” 정의에 해당하는지는 최종 법무 검토에서 확정해야 하며, 이 초안만으로 “공유하지 않음”을 확정하지 않습니다.

사진 권한 확인은 익명 행위자와 현재 `community` 정책 버전의 약관 이력으로 중복 없이 기록됩니다. 이 기록은 사용자의 확인 사실을 남길 뿐 실제 저작권 보유를 자동 증명하지 않으며, 최종 문구·철회·분쟁 절차는 named `legal-safety` 검토 전까지 승인본으로 취급하지 않습니다.

## Apple App Privacy

- 앱 번들 루트의 `PrivacyInfo.xcprivacy`에 위 데이터 유형을 선언하고 `NSPrivacyTracking=false`로 설정합니다.
- `NSPrivacyTrackingDomains`와 앱 직접 사용 기준 `NSPrivacyAccessedAPITypes`는 비어 있습니다.
- App Store Connect 답변은 이 표와 실제 아카이브의 Xcode privacy report를 대조한 뒤 입력합니다.
- 위치와 사진은 사용자가 해당 기능을 실행할 때만 요청하며, 권한 거부 후에도 검색·탐색 기본 흐름을 제공해야 합니다.
- 최종 아카이브에 포함된 모든 제3자 SDK의 privacy manifest와 required-reason API 사용을 모바일 릴리스 담당자가 다시 검사합니다.

## Google Play Data Safety

- Google Play Console의 Data safety 답변은 앱 코드뿐 아니라 포함된 SDK, 처리업체와 공개 UGC 흐름까지 포함해 작성합니다.
- 전송 구간은 HTTPS만 허용합니다. 데이터 삭제 요청, 계정·익명 식별자 연결, 선택 수집 여부 및 보존 기간은 공개 개인정보 처리방침과 일치해야 합니다.
- 위치·사진·사용자 콘텐츠는 사용자가 기능을 실행할 때 수집되는 선택 데이터로 작성하고, User ID 및 오남용 방지용 식별자는 앱 기능에 필요한 처리로 검토합니다.
- 공개 게시물 표시, Cloudflare 등 서비스 제공자 처리 및 법률상 공개가 “공유”에 해당하는지 named reviewer가 콘솔 정의와 대조합니다.

## Native Enforcement

- iOS: `PrivacyInfo.xcprivacy`를 App target의 Resources에 포함하고 tracking을 비활성화합니다.
- Android: manifest의 `allowBackup=false`, `fullBackupContent` 및 `dataExtractionRules`로 cloud backup과 device transfer에서 앱 데이터 도메인을 제외합니다.
- Android FileProvider는 앱 전용 external files와 cache만 공유하며 광범위한 외부 저장소 루트는 노출하지 않습니다.
- 웹뷰 내비게이션은 정확한 first-party origin만 내부로 허용하고 나머지 HTTPS 링크는 시스템 브라우저에 위임합니다.

## Console Checklist

1. 릴리스 후보 아카이브와 APK/AAB에서 개인정보 manifest 및 백업 규칙 포함을 확인합니다.
2. Xcode privacy report와 Google Play SDK Index 결과를 이 문서의 Data Inventory와 대조합니다.
3. App Store Connect App Privacy와 Google Play Console Data safety의 스크린샷 또는 내보낸 증거를 릴리스 증거 폴더에 보관합니다.
4. `real-device` QA에서 위치 허용·거부, 사진 선택·취소, 삭제 요청, 신고·숨김 및 백업 복원 경계를 검증합니다.
5. 모바일 릴리스 담당자와 named `legal-safety` reviewer가 날짜·이름·결론을 기록합니다.

## Stop Conditions

- 코드, `PrivacyInfo.xcprivacy`, Android 백업 규칙, 공개 개인정보 처리방침과 콘솔 답변이 일치하지 않으면 제출을 중단합니다.
- Xcode privacy report가 생성되지 않거나 예상하지 않은 required-reason API 또는 SDK 데이터 수집이 나타나면 제출을 중단합니다.
- tracking 또는 광고 SDK가 켜졌는데 이 문서와 콘솔 답변이 갱신되지 않았으면 제출을 중단합니다.
- 앱 데이터가 Android cloud backup 또는 device transfer에 포함되면 배포를 중단합니다.
- named `legal-safety` 검토, `real-device` QA 및 스토어별 최종 확인이 없으면 이 `draft`를 승인본으로 취급하지 않습니다.
- 운영 앱의 데이터 흐름이 이 문서와 달라지면 수집을 중단하거나 고지·동의를 먼저 갱신합니다.

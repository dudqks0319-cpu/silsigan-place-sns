# #실시간 NAVER Maps 출시 운영 패킷

Updated: 2026-07-20  
Scope: Web Dynamic Map을 Cloudflare staging/TestFlight에 안전하게 활성화하기 위한 콘솔·도메인·사용량 증거

## 현재 판정

현재 `https://silsigan-web-staging.dudqks0319.workers.dev`와 production `workers.dev` 주소에서는 NAVER Web Dynamic Map을 출시 기능으로 활성화하지 않습니다.

NAVER Cloud 공식 Application 가이드는 Web 서비스 URL을 등록할 때 HTTP/HTTPS를 구분하지 않고, 서브도메인이 있으면 대표 도메인을 입력하도록 안내합니다. 따라서 공유 플랫폼 도메인인 `workers.dev`, `pages.dev`, `vercel.app` 등을 등록하면 프로젝트가 소유하지 않은 다른 tenant와 대표 도메인 범위를 공유하게 됩니다. 이는 Client ID 제한 증거로 인정할 수 없습니다.

공식 근거:

- [NAVER Cloud Maps Application 가이드](https://guide.ncloud-docs.com/docs/en/application-maps-app-vpc/): Dynamic Map Application 등록, 대표 도메인 단위 Web 서비스 URL, 이용 한도·임계치·통보 대상 설정
- [NAVER 지도 API v3 Client ID 가이드](https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html): `Dynamic Map` 선택과 `ncpKeyId` 사용
- [NAVER Cloud 공식 요금표](https://www.ncloud.com/charge/price/ko): 대표 계정 1개 기준 Mobile/Web Dynamic Map 월 6,000,000건 무료, 초과 호출 과금

2026-07-20 Computer Use로 NAVER Cloud 계정 소유자 세션을 확인했습니다. 별도 `Silsigan` Application 등록 폼에는 `Dynamic Map`, `http://localhost:3000`, `http://127.0.0.1:3000`, Android package와 iOS Bundle ID `kr.silsigan.mobile`이 준비되어 있습니다. 임시로 입력되어 있던 staging/production `workers.dev` URL은 제출 전에 모두 제거했으며, 현재 초안에는 localhost와 네이티브 식별자만 남아 있습니다. 최종 `등록`은 누르지 않았고 Client ID/Secret도 생성하거나 노출하지 않았습니다. 준비된 전체 폼 증거는 `artifacts/manual-qa/naver-silsigan-draft-complete-20260720.png`이며, 2026-07-19 로그인 필요 화면은 과거 상태 증거로 `artifacts/manual-qa/naver-cloud-login-required-20260719.png`에 남아 있습니다.

2026-07-20 Cloudflare `Domains > Overview`도 읽기 전용으로 다시 확인했으며, 현재 계정에는 도메인 또는 서브도메인이 없습니다. 이어서 구매 화면에서 정확한 이름만 조회한 결과 `silsigan.com`은 이미 등록되어 있고 Cloudflare Registrar는 `.kr` 등록을 지원하지 않았으며, `silsigan.app`은 당시 연 `$14.20`·동일 갱신가로 구매 가능한 후보로 표시됐습니다. 구매 버튼, 장바구니, 결제는 진행하지 않았으며 가용성과 가격은 실제 구매 시점에 다시 확인해야 합니다. 따라서 기존 계정 도메인을 재사용할 수 없고, 사용자가 소유한 도메인을 추가하거나 새 도메인을 구입하기 전까지 NAVER 지도를 출시 기능으로 활성화하지 않습니다. 최초 무도메인 증거는 `artifacts/manual-qa/cloudflare-no-domains-20260719.png`이며 이번 재확인에서도 외부 상태는 같았습니다.

## 필요한 도메인 상태

NAVER 지도 활성화 전에 사용자가 소유·관리하는 하나의 registrable domain을 정합니다. 아래 이름은 예시이며 실제 소유권이 확인된 값으로 교체합니다.

| 용도 | 예시 |
| --- | --- |
| NAVER 콘솔 대표 도메인 | `silsigan.app` |
| staging web | `https://staging.silsigan.app` |
| staging API | `https://api-staging.silsigan.app` |
| production web | `https://silsigan.app` |
| production API | `https://api.silsigan.app` |

`silsigan.app`은 현재 조회된 미구매 후보일 뿐 소유 도메인이 아닙니다. 사용자가 이 후보를 선택해 구매하거나 이미 소유한 다른 도메인을 연결하고 Cloudflare custom domain의 DNS·TLS가 실제로 동작하기 전에는 위 값을 환경변수나 NAVER 출시 origin에 넣지 않습니다.

## 계정 소유자 콘솔 절차

1. NAVER Cloud 대표 계정인지 확인합니다. 공식 문서는 대표 계정이 아닌 경우 무료 이용량이 적용되지 않을 수 있다고 경고합니다.
2. `Services > Application Services > Maps > Application`에서 전용 Application을 생성하거나 기존 Application을 엽니다.
3. `Dynamic Map`만 출시 범위에 맞게 선택합니다. 사용하지 않는 API는 선택하지 않습니다.
4. Web 서비스 URL에는 공유 호스팅 suffix가 아니라 검증된 소유 대표 도메인을 등록합니다.
5. Client Secret은 브라우저·저장소·스크린샷·로그에 넣지 않습니다. Web SDK에는 Client ID만 사용합니다.
6. 대표 계정임을 확인한 뒤 월별 hard limit은 무료 6,000,000건의 80%인 `4,800,000` 이하, 일별 hard limit은 `160,000` 이하로 설정합니다. 둘 중 하나라도 더 높거나 비어 있으면 출시하지 않습니다.
7. 임계치는 `70%` 이하부터 선택해 최소 70/80/90/100% 알림을 받고, 실제 통보 대상 이메일 또는 SMS를 추가합니다. 통보 대상이 없으면 알림 설정을 완료로 보지 않습니다.
8. 저장 후 Application 이름, `Dynamic Map`, 대표 도메인, 한도, 임계치, 통보 대상이 보이는 증거를 남깁니다. Client Secret과 개인 연락처는 마스킹합니다.

약관 동의, 로그인, Client ID/Secret 신규 발급 또는 재발급은 계정 소유자가 직접 수행합니다.

## 애플리케이션 환경변수

콘솔과 custom domain이 준비된 뒤에만 다음 값을 실행 환경에 설정합니다.

```bash
export NEXT_PUBLIC_NAVER_MAP_CLIENT_ID=<public-client-id>
export SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED=1
export SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN=<owned-domain>
export SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS=https://<staging-web>,https://<production-web>
export SILSIGAN_NAVER_MAP_REPRESENTATIVE_ACCOUNT_CONFIRMED=1
export SILSIGAN_NAVER_MAP_MONTHLY_HARD_LIMIT=4800000
export SILSIGAN_NAVER_MAP_DAILY_HARD_LIMIT=160000
export SILSIGAN_NAVER_MAP_ALERT_THRESHOLD_PERCENT=70
export SILSIGAN_NAVER_MAP_ALERT_RECIPIENT_CONFIRMED=1
```

- `SILSIGAN_NAVER_MAP_REGISTERED_DOMAIN`은 scheme, port, path가 없는 소유 도메인입니다.
- `SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS`은 실제 브라우저에서 검증할 정확한 HTTPS origin 목록입니다.
- 숫자형 한도는 콘솔에서 실제 저장된 값과 같아야 하며 월 `4,800,000`, 일 `160,000`, 알림 `70%`보다 높일 수 없습니다. 더 낮은 값은 허용합니다.
- 통보 대상 주소 자체는 환경변수나 저장소에 넣지 않고, `SILSIGAN_NAVER_MAP_ALERT_RECIPIENT_CONFIRMED=1`에는 마스킹된 콘솔 증거를 검토한 뒤에만 설정합니다.
- release gate는 `workers.dev`, `pages.dev`, `vercel.app`, `netlify.app`, `github.io`, `web.app`, `firebaseapp.com`과 그 하위 호스트를 NAVER 등록 도메인으로 거부합니다.
- Client Secret은 어느 `NEXT_PUBLIC_*` 변수에도 넣지 않습니다.

## 검증 순서

1. custom-domain web URL에서 `maps.js?ncpKeyId=...`가 2xx로 로드되는지 확인합니다.
2. 지도 타일·NAVER logo·마커가 표시되는지 확인합니다.
3. 잘못된 origin에서 동일 Client ID가 인증 실패하는지 확인합니다.
4. SDK 차단·timeout·인증 실패 시 #실시간 fallback 지도와 `지도 다시 시도`가 유지되는지 확인합니다.
5. staging release candidate를 실행합니다.

```bash
pnpm release:gate -- --release-candidate --tail-file="${SILSIGAN_STAGING_TAIL_LOG_FILE}" --timeout-ms=120000
```

## 필수 증거

- 소유 custom domain과 Cloudflare DNS/TLS 상태
- Cloudflare 계정의 소유 도메인 연결 증거
- NAVER Application의 `Dynamic Map` 선택
- 등록 대표 도메인
- 일별·월별 한도와 70% 시작 임계치
- 대표 계정 확인과 월 4,800,000 이하·일 160,000 이하 hard limit
- 마스킹된 통보 대상
- staging 지도 성공, 잘못된 origin 실패, SDK timeout/failure fallback 스크린샷
- release gate의 NAVER 관련 오류 0건

## 중단 조건

다음 중 하나라도 참이면 NAVER 지도 기능을 활성화하지 않습니다.

- 공유 호스팅 도메인을 NAVER Web 서비스 URL로 등록해야 하는 상태
- 대표 계정 또는 과금 적용 여부를 확인하지 못함
- 사용자 소유 custom domain의 DNS/TLS가 준비되지 않음
- `Dynamic Map`, 이용 한도, 임계치, 통보 대상 증거가 없음
- release candidate 환경의 한도·임계치·대표계정·수신자 확인값이 콘솔 증거와 다르거나 안전 상한을 초과함
- Client Secret이 브라우저, repository, log, screenshot에 노출됨
- staging 성공·잘못된 origin 실패·fallback 증거 중 하나가 없음

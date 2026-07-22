# #실시간 공공데이터 권리 조사

Updated: 2026-07-21

이 문서는 공식 제공 페이지에 표시된 이용 조건을 제품 정책으로 번역한 조사 기록입니다. 법률 자문이나 제공기관의 개별 승인을 대체하지 않습니다. 실제 활성화에는 `docs/v2-legal-operations-gate.md`의 named reviewer, credential owner, health, TTL, cache/retention, attribution, region, 운영 트래픽 증거가 모두 필요합니다.

## 공통 판단 원칙

- 공공데이터의 이용 가능 여부와 공공저작물의 저작권 조건은 별도로 확인합니다.
- 공공누리 제1유형은 출처표시 조건으로 상업적 이용과 변경이 가능하고, 제3유형은 상업적 이용은 가능하지만 변경할 수 없습니다.
- 데이터 상세 페이지가 `이용허락범위 제한 없음`이라고 표시하더라도 이미지·영상·제3자 권리는 항목별 조건을 우선합니다.
- 공식 페이지에서 cache, retention, 재배포, 영상 재송출 조건을 확인하지 못한 source는 `disabled`를 유지합니다.
- 공공데이터포털 이용정책은 제3자 권리가 포함된 공공데이터에 대해 권리자의 정당한 이용허락을 별도로 확보하도록 요구합니다. 따라서 포털 가입이나 API key 발급만으로 source 권리 검토가 완료된 것으로 보지 않습니다.
- provider가 표시한 상한은 사용 목표가 아닙니다. 앱의 server-side 일일 quota, 전역 비용 한도, bounded retry, circuit breaker가 더 낮은 값으로 통과해야 하며 발급계정의 실제 한도를 다시 확인합니다.

공공누리 유형 설명: https://www.kogl.or.kr/info/userGuide.do

## Source별 조사 결과

| Source | 공식 근거와 확인 내용 | #실시간 적용 정책 | 상태 |
| --- | --- | --- | --- |
| `kma_weather` | [기상청 단기예보 조회서비스](https://www.data.go.kr/data/15084084/openapi.do)는 무료, 전국 실시간, 개발계정 10,000건, 공공누리 제1유형과 제3자 권리 포함/저작권 표시를 명시합니다. 운영 증설은 활용사례에 따른 별도 절차입니다. 2026-07-21 재확인했습니다. | 날씨 값·발표시각을 사용하고 `출처: 기상청 단기예보 조회서비스(공공누리 제1유형)`를 표시합니다. 원문 저작물이나 제3자 콘텐츠는 별도 확인 전 사용하지 않습니다. 운영계정·실제 quota·health·TTL 증거 전까지 disabled입니다. | 조건부 준비 |
| `tour_api` | [한국관광공사 국문 관광정보 서비스](https://www.data.go.kr/data/15101578/openapi.do)는 앱·웹 등 활용과 무료 제공을 안내하고 개발계정 1,000건, 운영계정 심의승인을 표시합니다. 사진은 공공누리 제1·3유형이 섞여 있고, 명예훼손·인격권 침해 용도 및 기업 CI/BI 이용을 금지합니다. 2026-07-21 재확인했습니다. | 장소명·주소·분류 같은 정적 메타데이터만 먼저 사용합니다. 사진은 객체별 라이선스 유형을 저장·표시할 수 있을 때만 허용하며 제3유형은 자르기·필터·재인코딩 등 변경을 금지합니다. 현재 `image_use_allowed=0`을 유지합니다. | 메타데이터 조건부, 이미지 차단 |
| `national_parking` | [전국주차장정보표준데이터](https://www.data.go.kr/data/15012896/standard.do)는 지자체 250개 제공분을 반기 단위로 병합하며 시설·운영시간·요금·구획수·기준일을 제공합니다. 2026-07-21 재확인 시 전국 집계 페이지에는 단일 통합 라이선스가 명확히 표시되지 않았고 개별 제공기관 행의 조건이 서로 다를 수 있습니다. | 시설·요금·운영시간의 정적 정보만 사용하고 빈자리·현재 혼잡으로 해석하지 않습니다. 제공 지자체와 데이터 기준일을 표시하며, 실제 수집 전 개별 제공 데이터의 라이선스를 정규화합니다. | 권리 정규화 대기 |
| `national_traffic` | [국가교통정보센터 오픈데이터](https://www.its.go.kr/opendata/intro)는 REST로 교통소통정보와 CCTV 화상자료 등을 제공하고 인증키 승인을 요구합니다. [공식 Q&A 사례](https://www.its.go.kr/opendata/reqOpendataQnaDetail?seqNo=166)는 API 하나당 일 1,000건 설정 사례를 안내하지만 계정별 확정 quota를 대체하지 않습니다. | provider 관측시각과 평균속도를 보존하고 파생 혼잡도는 `추정`으로 표시합니다. `출처: 국토교통부 국가교통정보센터(ITS)`를 표시합니다. 앱 내부 예산은 발급 quota보다 낮게 유지하고 운영 key·실제 quota·health·TTL 증거 전까지 disabled입니다. | 조건부 준비 |
| `national_cctv` | [국가교통정보센터 오픈데이터](https://www.its.go.kr/opendata/intro)는 CCTV 화상자료 API를 제공하지만, 공개 페이지에서 앱의 저장·proxy·restream·재생 조건은 충분히 입증되지 않습니다. 2026-07-21 신청 범위도 CCTV metadata 사용만을 전제로 준비했습니다. | 위치·도로명·갱신시각 같은 metadata만 허용합니다. stream URL 저장, 로그, 공개, proxy, restream, playback은 모두 금지합니다. 제공기관의 영상 이용 조건과 named legal reviewer 승인 전 `video_use_allowed=0`을 유지합니다. | 영상 차단 |
| `seoul_realtime_city` | [서울시 실시간 도시데이터](https://data.seoul.go.kr/dataList/OA-21285/A/1/datasetView.do)는 주요 121장소, 1회 1장소 호출, 인증키 필요, 제3자 저작권자 없음, 공공누리 제1유형을 명시합니다. | `출처: 서울특별시 실시간 도시데이터(공공누리 제1유형)`를 표시합니다. cache/retention, 운영 quota, health, 장소별 TTL을 검증하기 전 `SEOUL_REALTIME_ENABLED=false`와 source disabled를 유지합니다. | 라이선스 확인, 운영 증거 대기 |

## 활성화 전 필수 증거

각 source별로 아래 항목을 독립적으로 기록합니다.

- named legal-safety reviewer와 검토일
- 공식 약관/데이터 상세 URL과 당시 정책 버전 또는 캡처
- commercial use, modification, redistribution, cache/retention 판단
- 사용자 화면의 정확한 attribution 문구
- credential owner와 운영 트래픽/quota
- 허용 지역, dimension, TTL, provider observation time
- healthy/degraded 상태와 장애 fallback
- 관리자 source-policy 승인 및 감사 로그

위 항목 중 하나라도 빠지면 해당 source를 활성화하지 않습니다.

## NAVER Maps 별도 운영 판단

NAVER Maps는 위 공공데이터 source와 다른 상용 API 서비스이므로 별도 콘솔·도메인·과금 게이트를 적용합니다. 공식 Application 가이드는 Web 서비스 URL을 대표 도메인 단위로 등록하도록 안내하므로 현재 공유 `workers.dev` 주소를 Client ID 제한 증거로 사용하지 않습니다. 사용자 소유 custom domain, 대표 계정 여부, Dynamic Map 선택, 일·월 한도, 70% 시작 임계치와 실제 통보 대상, 정상 origin 성공·잘못된 origin 실패 증거가 준비될 때까지 fallback 지도만 유지합니다.

세부 절차: `docs/naver-maps-release-operator-packet.md`.

## NAVER 검색 API 결과 저장 경계

[NAVER Developers API 서비스 이용약관](https://developers.naver.com/products/terms/)은 검색 API로 얻은 지역정보를 별도 데이터베이스로 관리하는 행위를 금지하고, 검색 결과를 독립적으로 노출하도록 요구합니다. [NAVER Open API 고객센터](https://help.naver.com/service/30015/contents/17128?lang=ko&osType=COMMONOS)도 API 결과의 저장·가공은 불가하다고 명시합니다.

따라서 `/api/external/naver/local-search` 결과는 검색 화면에 일시적으로만 표시하고 다음 정보를 D1, 로그, 분석 이벤트, 장소 추가 요청에 저장하지 않습니다.

- `title`, `category`, `roadAddress`, `address`
- `mapx`, `mapy`, `link`
- 원 검색어와 결과 순위

장소 추가 요청은 NAVER 결과 선택과 분리된 빈 수동 입력 폼에서 사용자가 직접 제출한 장소명·주소·선택 카테고리만 받습니다. 요청은 비공개 검수 큐에서 `ready_for_manual_import`까지만 진행하며 `places` 생성·좌표 검증·활성화·공개는 자동 수행하지 않습니다. 이 경계는 개별 제휴 승인이나 별도 법률 검토가 있기 전까지 유지합니다.

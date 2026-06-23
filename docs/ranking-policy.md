# #실시간 랭킹 정책

기준일: 2026-06-18  
대상: 전국, 지역, area, category, map bounds 랭킹 API와 캐시 운영.

## 1. 랭킹 목표

랭킹은 “최근 3시간 동안 방문 결정을 돕는 신뢰 가능한 장소”를 위로 올린다. 단순 인기순이 아니라 최신성, 현장 인증, 사진, 질문 수요, 신고 위험을 함께 반영한다.

## 2. 랭킹 단위

| 랭킹 | 필터 기준 | 사용 화면 |
| --- | --- | --- |
| 전국 | 전체 검증 장소 | 홈 첫 영역 |
| 지역 | `region_code` 또는 시/도/시군구 | 지역 홈 |
| area | 운영 정의 권역 `area_id` | 상권/관광권/행사장 화면 |
| category | 카테고리 단독 또는 지역+카테고리 | 카테고리 탭 |
| map-bounds | 현재 지도 bounds 안의 장소 | 지도 화면 |

공통 제외 조건:

- `coordinate_status != "verified"`인 장소.
- 최근 3시간 활성 제보가 0이고 질문/사진 신호도 0인 장소.
- `hidden_at`이 있는 제보, 댓글, 사진.
- 관리자 숨김 또는 삭제 상태인 장소.
- 병원/관공서 민감정보 신고로 임시 숨김된 콘텐츠.

## 3. 점수 공식

장소별 `ranking_score`는 최근 3시간 활성 신호만 기본 반영한다.

```txt
ranking_score =
  freshness_score
  + verified_report_score
  + photo_score
  + question_demand_score
  + helpful_score
  + status_intensity_score
  - report_risk_penalty
  - spam_penalty
```

세부 기준:

| 요소 | 계산 |
| --- | --- |
| `freshness_score` | 활성 제보별 `20 * time_weight` 합산, 최대 60 |
| `verified_report_score` | 현장 인증 제보 1건당 `12 * time_weight`, 최대 48 |
| `photo_score` | 사진 포함 제보 1건당 `8 * time_weight`, 최대 32 |
| `question_demand_score` | 미답변 질문 1건당 4, 사진 요청 질문 1건당 6, 최대 24 |
| `helpful_score` | 도움돼요/저장/공유 등 긍정 신호 1건당 1, 최대 20 |
| `status_intensity_score` | 혼잡/만차/긴 줄 같은 강한 상태 신호 1건당 5, 최대 25 |
| `report_risk_penalty` | 활성 신고 1건당 -15, 민감정보 신고 1건당 -40 |
| `spam_penalty` | 동일 사용자 반복/동일 문구/비정상 빈도 탐지 시 -30~-100 |

최종 점수는 `0` 미만이면 `0`으로 내린다. 동점이면 최신 현장 인증 제보가 있는 장소, 사진 제보가 있는 장소, 질문이 많은 장소 순으로 정렬한다.

## 4. 시간 가중치

시간 가중치는 제보 생성 시각 기준으로 계산한다.

| 경과 시간 | `time_weight` |
| --- | ---: |
| 0~15분 | 1.00 |
| 15~30분 | 0.85 |
| 30~60분 | 0.65 |
| 1~2시간 | 0.40 |
| 2~3시간 | 0.20 |
| 3시간 초과 | 0.00, 랭킹 제외 |

질문은 생성 후 6시간까지 수요 신호로 반영할 수 있지만, 답변 완료 또는 숨김 처리되면 제외한다.

## 5. 전국/지역/Area/Category 규칙

### 전국

- 상위 20개까지 계산하고 API 기본 응답은 10개만 반환한다.
- `limit`은 기본 10, 최대 50으로 제한한다.
- 같은 시/도에서 5개를 초과하면 지역 다양성 보정을 적용해 6번째부터 `score * 0.85`를 적용한다.
- 사진/민감정보 신고가 열린 장소는 검토 전까지 전국 랭킹에서 제외한다.

### 지역

- 지역 필터 안에서는 다양성 보정보다 최신성을 우선한다.
- 지역 내 활성 장소가 3개 미만이면 빈 랭킹 카피를 반환한다.

### Area

- area는 운영자가 정의한 권역이다.
- area 내 검증 장소가 5개 미만이면 public API는 `status: "preparing"`을 반환하고 랭킹을 비운다.

### Category

- `hospital`, `public_office`는 민감정보 신고 1건만 있어도 랭킹 제외 후 운영자 검토 큐로 보낸다.
- `festival_event`는 행사 기간이 끝났거나 운영자가 비활성화한 경우 제외한다.

### Map Bounds

- 클라이언트가 전달한 `north`, `south`, `east`, `west` 범위 안의 검증 장소만 계산한다.
- 너무 넓은 bounds는 전국 랭킹으로 대체하지 않고 `BOUNDS_TOO_WIDE` 응답을 반환한다.
- bounds 안에 장소가 없으면 빈 지도 상태와 지역 선택 CTA를 반환한다.

## 6. 어뷰징 방지

- 동일 사용자/디바이스/IP 해시 조합의 제보는 장소별 10분 1회로 제한한다.
- 동일 장소의 동일 문구 댓글/제보는 중복 신호로 점수 반영하지 않는다.
- 신규 사용자 제보는 첫 24시간 동안 `verified_report_score`만 정상 반영하고 `helpful_score` 증폭은 제한한다.
- 신고가 3회 누적된 콘텐츠는 자동 숨김 처리하고 점수에서 즉시 제외한다.
- 개인정보/민감정보 신고는 1회만으로도 임시 숨김 및 랭킹 제외가 가능하다.
- 운영자 복구 전까지 숨김 콘텐츠는 캐시 재계산에서 제외한다.

## 7. 캐시/재계산 주기

| 데이터 | 저장소 | TTL/주기 |
| --- | --- | --- |
| 전국 랭킹 | KV 또는 Cache API | 60초 |
| 지역 랭킹 | KV 또는 Cache API | 60초 |
| area 랭킹 | KV 또는 Cache API | 60초 |
| category 랭킹 | KV 또는 Cache API | 90초 |
| map-bounds 랭킹 | Cache API | 30초, bounds hash 기준 |
| 장소 상세 요약 | KV 또는 D1 materialized table | 30초 |

캐시 무효화 이벤트:

- 새 제보 생성.
- 사진 업로드 완료.
- 댓글/사진/제보 신고.
- 자동 숨김/관리자 숨김/복구/삭제.
- seed 장소 상태 변경.

캐시 키 예시:

```txt
rankings:nationwide
rankings:map-bounds
rankings:region:busan
rankings:area:busan
rankings:category:busan
places:busan-gwangalli
place-live:busan-gwangalli
rankings:place:busan-gwangalli
photos:busan-gwangalli
comments:busan-gwangalli
```

## 8. API 응답 예시

### 전국 랭킹

```json
{
  "success": true,
  "data": {
    "scope": "nationwide",
    "generatedAt": "2026-06-18T09:00:00.000Z",
    "items": [
      {
        "rank": 1,
        "placeId": "busan-gwangalli-beach",
        "name": "광안리해수욕장",
        "regionLabel": "부산 수영구",
        "category": "tourism",
        "score": 96,
        "summary": "15분 전 현장 인증 사진 2건",
        "signals": {
          "activeReports": 4,
          "verifiedReports": 3,
          "photoReports": 2,
          "openQuestions": 1
        }
      }
    ],
    "empty": null
  },
  "meta": {
    "cacheTtlSeconds": 60,
    "privacy": "place_coordinates_only"
  }
}
```

### 빈 랭킹

```json
{
  "success": true,
  "data": {
    "scope": "region",
    "regionCode": "kr-44",
    "items": [],
    "empty": {
      "title": "랭킹을 만들 만큼 최근 제보가 없습니다",
      "body": "최근 3시간 제보가 쌓이면 혼잡도와 신뢰도 기준으로 자동 정렬됩니다.",
      "cta": "전체 장소 보기"
    }
  },
  "meta": {
    "cacheTtlSeconds": 60
  }
}
```

## 9. 운영 검수 기준

- 랭킹 점수는 public API에 `debugScoreBreakdown`으로 노출하지 않는다.
- 운영자 대시보드에서만 점수 breakdown을 볼 수 있다.
- 신고로 숨김 처리된 뒤 60초 안에 전국/지역/area/category/map-bounds 랭킹에서 사라져야 한다.
- 좌표 미검증 장소는 어떤 랭킹에도 들어가지 않아야 한다.

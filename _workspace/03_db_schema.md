# #실시간 DB 스키마

## ERD

```mermaid
erDiagram
  anonymous_users ||--o{ comments : writes
  anonymous_users ||--o{ photos : uploads
  anonymous_users ||--o{ likes : creates
  anonymous_users ||--o{ reports : reports
  anonymous_users ||--o{ blocked_users : restricted_by
  reports ||--o{ moderation_reports : queues
  places ||--o{ reports : has
  places ||--o{ comments : has
  places ||--o{ photos : has
  places ||--o{ place_event_hourly : aggregates
```

## 테이블 정의

### anonymous_users

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | text | 익명 식별자 해시 |
| `region_code` | text | 마지막 coarse 지역 |
| `trust_score` | integer | 신뢰도 점수 |
| `created_at` | timestamptz | 생성일 |

### places

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid | 장소 ID |
| `name` | text | 장소명 |
| `address` | text | 주소 |
| `region_code` | text | 전국 시도 코드 |
| `area_code` | text | 시군구/권역 코드 |
| `category` | enum | 관광지, 축제, 맛집/카페, 병원, 관공서, 주차장 |
| `latitude`, `longitude` | numeric nullable | 장소 좌표. 사용자 좌표가 아니며, 좌표 미검증이면 null |
| `coordinate_status` | text | `verified`, `TODO_COORDINATE_VERIFY`, `rejected` |

### reports

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `place_id` | uuid | 장소 |
| `user_id` | uuid | 작성자 |
| `crowd_level` | enum | 혼잡도 |
| `line_status` | enum | 줄 상태 |
| `parking_status` | enum | 주차 상태 |
| `weather_feel` | enum | 체감 날씨 |
| `comment` | text | 120자 이하 |
| `photo_path` | text | EXIF/GPS metadata 제거 후 저장된 경로 |
| `verified_radius_m` | smallint | `50`, `150`, `300` 중 하나 |
| `expires_at` | timestamptz | 기본 `created_at + 3 hours` |
| `hidden_at` | timestamptz | 신고/운영 숨김 |

### comments

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `place_id` | uuid | 댓글 장소 |
| `anon_id_hash` | text | 작성자 익명 식별자 해시 |
| `body` | text | 2~280자 |
| `status` | text | active/hidden/deleted |
| `report_count` | integer | 누적 신고 수 |
| `deleted_at` | timestamptz | 작성자/운영 삭제 |

### photos

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `place_id` | uuid | 사진 장소 |
| `anon_id_hash` | text | 업로더 익명 식별자 해시 |
| `r2_key` | text | R2 저장 경로 |
| `public_url` | text | 공개 또는 서명 URL |
| `image_hash` | text | 정화/재인코딩 후 최종 이미지 SHA-256 fingerprint. public/R2 metadata 미노출 |
| `duplicate_status` | text | unchecked/unique |
| `status` | text | pending/active/hidden/deleted |
| `report_count` | integer | 누적 신고 수 |
| `deleted_at` | timestamptz | 삭제 시각 |

### place_event_hourly

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `place_id` | uuid | 장소 |
| `bucket_hour` | timestamptz | 집계 시간 |
| `region_code`, `area_code`, `category` | text | 랭킹 필터 키 |
| `click_count`, `like_count`, `comment_count`, `photo_count`, `report_count` | integer | 이벤트 집계 |
| `unique_user_count` | integer | 같은 장소/시간 버킷의 `place_events.anonymous_user_id` distinct 기준 유니크 수 |

### moderation_reports

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `target_type` | text | place/comment/photo |
| `target_id` | uuid | 신고 대상 |
| `anon_id_hash` | text | 신고자 익명 식별자 해시 |
| `reason` | enum | 허위/광고/얼굴/차량번호/민감정보/기타 |
| `note` | text | 200자 이하 |

### blocked_users

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `anonymous_user_id` | text | 제한 대상 익명 사용자 해시 |
| `reason` | text | 운영자 제한 사유. public 오류 응답에는 노출하지 않음 |
| `blocked_until` | timestamptz nullable | null이면 운영자 해제 전까지 제한 |
| `created_at` | timestamptz | 제한 생성/갱신 시각 |

## Worker/D1 접근 전략

- 브라우저는 D1/R2에 직접 접근하지 않고 Cloudflare Worker API만 호출한다.
- 공개 읽기는 `places`, 만료 전/숨김 전 `reports`, active `comments/photos`만 허용한다.
- 작성자 삭제는 익명 식별자 해시가 일치하는 레코드만 허용한다.
- 관리자 처리는 Worker 관리자 토큰과 감사 로그를 거친다.
- active `blocked_users`가 있는 익명 사용자는 새 댓글/사진/좋아요/클릭/신고 write를 수행할 수 없다.
- 사용자 원본 좌표 컬럼은 만들지 않는다.
- 공개 장소/지도/랭킹 쿼리는 `coordinate_status = 'verified'`이고 좌표가 null이 아닌 장소만 반환한다.
- Worker D1 바인딩이 있으면 댓글/사진/좋아요/신고/admin action은 D1에 영속하고, 바인딩이 없을 때만 로컬 memory fallback을 쓴다.

## 인덱스 전략

| 테이블 | 인덱스 | 용도 |
| --- | --- | --- |
| `places` | `(region_id, is_active, coordinate_status)` | 공개 장소/랭킹 필터 |
| `reports` | `(place_id, created_at desc)` | 장소 상세 최근 제보 |
| `reports` | partial `(expires_at, hidden_at)` | 활성 제보 조회 |
| `reports` | unique `(anonymous_user_id, target_type, target_id, reason)` where `status = 'open'` | 동일 익명 사용자의 열린 중복 신고 방지 |
| `blocked_users` | unique `(anonymous_user_id)` | 익명 사용자별 active 제한 집행 |
| `comments` | `(place_id, created_at desc)` | 장소 댓글 |
| `photos` | `(place_id, created_at desc)` | 장소 사진 |
| `photos` | unique `image_hash` where `deleted_at is null` | 삭제되지 않은 exact duplicate 사진 차단 |
| `place_event_hourly` | `(bucket_hour, region_code, area_code, category)` | 랭킹 집계 |
| `moderation_reports` | `(target_type, target_id, reason)` | 숨김 기준 계산 |

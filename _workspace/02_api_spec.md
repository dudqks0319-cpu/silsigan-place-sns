# #실시간 API 명세

## 기본 정보

- Base URL: `/api` 또는 `NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL`
- 인증 방식: MVP는 `x-silsigan-anon-id` 익명 식별자를 허용한다. 운영 관리자 API는 별도 관리자 토큰을 Worker에서 검증한다.
- 응답 형식:

```json
{ "success": true, "data": {}, "meta": {} }
```

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

## 엔드포인트 목록

| Method | Path | 설명 | 인증 | 요청 Body |
| --- | --- | --- | --- | --- |
| GET | `/api/places` | 전국 장소 목록, 검색, 지도 bbox/반경 필터 | 공개 | 없음 |
| GET | `/api/places/:placeId` | 장소 상세 | 공개 | 없음 |
| GET | `/api/places/:placeId/live` | 장소 실시간 요약 | 공개 | 없음 |
| POST | `/api/places/:placeId/click` | 장소 클릭 이벤트 | 익명 식별자 | 없음 |
| POST/DELETE | `/api/places/:placeId/like` | 장소 좋아요 등록/해제 | 익명 식별자 | 없음 |
| GET | `/api/rankings/global` | 전국 랭킹 | 공개 | 없음 |
| GET | `/api/rankings/regions/:region` | 지역 랭킹 | 공개 | 없음 |
| GET | `/api/rankings/areas/:area` | 시군구/권역 랭킹 | 공개 | 없음 |
| GET | `/api/comments?placeId=` | 장소 댓글 목록 | 공개 | 없음 |
| POST | `/api/comments` | 댓글 작성 | 익명 식별자 | `CreateCommentInput` |
| DELETE | `/api/comments/:commentId` | 작성자 댓글 삭제 | 익명 식별자 | 없음 |
| GET | `/api/photos?placeId=` | 장소 사진 목록 | 공개 | 없음 |
| GET | `/api/photos/:photoId/file` | Worker/R2 사진 미리보기 파일 | 공개 | 없음 |
| POST | `/api/photos/upload-url` | R2 업로드 경로 발급 | 익명 식별자 | `PhotoUploadRequest` |
| POST | `/api/photos/complete` | 사진 업로드 완료 등록 | 익명 식별자 | `PhotoCompleteInput` |
| GET | `/api/reports?placeId=&regionId=&includeExpired=` | 현장 제보 목록 | 공개 | 없음 |
| POST | `/api/moderation/reports` | 댓글/사진/장소 신고 | 익명 식별자 | `ModerationReportInput` |
| GET | `/api/moderation/reports?status=` | 운영자 신고 큐 조회 | 관리자 토큰 | 없음 |
| POST | `/api/moderation/reports/:reportId/action` | 운영자 신고 승인/반려 | 관리자 토큰 | `{ "status": "accepted" | "rejected", "reason"?: string }` |
| POST | `/api/admin/moderation/hide` | 장소/댓글/사진 운영자 숨김 | 관리자 토큰 | `AdminModerationInput` |
| POST | `/api/admin/moderation/restore` | 장소/댓글/사진 운영자 복구 | 관리자 토큰 | `AdminModerationInput` |
| POST | `/api/admin/moderation/delete` | 장소/댓글/사진 운영자 삭제 | 관리자 토큰 | `AdminModerationInput` |
| POST | `/api/admin/moderation/bulk` | 장소/댓글/사진 운영자 일괄 숨김/복구 | 관리자 토큰 | `AdminBulkModerationInput` |
| POST | `/api/admin/places/coordinate-status` | 장소 좌표 검증/반려 | 관리자 토큰 | `AdminPlaceCoordinateStatusInput` |
| POST | `/api/admin/users/restrict` | 익명 사용자 write 제한 | 관리자 토큰 | `AdminUserRestrictionInput` |
| POST | `/api/admin/users/unrestrict` | 익명 사용자 제한 해제 | 관리자 토큰 | `AdminUserUnrestrictionInput` |
| GET | `/api/realtime/place/:placeId` | Durable Object 장소 방 상태 | 공개 | 없음 |
| GET | `/api/realtime/region/:regionId` | Durable Object 지역 방 상태 | 공개 | 없음 |
| GET | `/api/realtime/global` | Durable Object 전국 방 상태 | 공개 | 없음 |

### GET /api/realtime/*

- Durable Object binding이 있으면 deterministic room name으로 `PLACE_ROOM`, `REGION_ROOM`, `GLOBAL_ROOM`에 라우팅한다.
- 댓글 생성, 사진 준비, 신고 생성은 place room, region room, global room으로 fanout한다.
- DO binding이 없으면 Worker 메모리의 최근 이벤트 polling으로 대체한다.
- Next.js 프론트 지도 상세는 Cloudflare API base가 설정된 경우 `/api/realtime/place/:placeId`를 주기적으로 polling하고 최근 이벤트/연결 모드를 표시한다.
- broadcast payload는 이벤트 ID, place/region/area 식별자, target 식별자만 포함하고 익명 사용자 ID, 신고 note, 원좌표, 원본 파일명은 포함하지 않는다.

## GET /api/places

쿼리 파라미터:

- `bbox=minLng,minLat,maxLng,maxLat`: 지도 bounds 안의 검증된 장소만 반환한다.
- `lat`, `lng`, `radius`: 현재 위치 기반 반경 검색이다. `radius`는 meter 단위이며 Worker 정책의 최대 반경으로 clamp한다.
- `region`/`regionId`, `area`/`areaId`, `category`/`categoryId`: 지역, 권역, 카테고리 scope 필터다.
- `q`: 장소명 검색어다.
- `limit`: 반환 개수를 제한한다.

처리 규칙:

- D1 조회는 bbox 또는 반경 bounding box로 사전 필터링한 뒤 Worker에서 실제 meter 거리로 한 번 더 필터링한다.
- `lat`, `lng`는 조회 중 거리 계산에만 사용하며 DB, 로그, 응답 meta에 저장하거나 그대로 반환하지 않는다.
- bbox와 반경이 동시에 주어지고 두 scope가 겹치지 않으면 빈 목록을 반환한다.

## GET /api/rankings/*

처리 규칙:

- 전국/지역/area/category/map-bounds 랭킹은 검증된 좌표와 활성 장소만 반환한다.
- 응답 `data[]`는 기존 `placeId`, `regionId`, `score`, `rank`, `windowHours`에 더해 `name`, `regionCode`, `areaCode`, `category`, `clickCount`, `likeCount`, `commentCount`, `photoCount`, `reportCount`, `uniqueUserCount`, `trend`, `summary`를 포함한다.
- D1 랭킹 점수는 `place_rankings` seed score에 최근 3시간 이내 `place_events` live score만 더하고, 정렬도 같은 계산 `score` 기준으로 수행한다.
- 만료된 `place_events`는 장소 live click count와 랭킹 live score에서 제외한다.
- `source = "field_report"` 현장 제보 이벤트는 최근 현장 신호로 가산하고, 운영 신고 이벤트는 감점 신호로 처리한다.
- `CACHE` KV binding이 있으면 랭킹 응답을 normalized route/scope/bbox/limit key로 60초 read-through cache에 저장한다. 운영 숨김/복구/삭제/좌표 상태 변경은 `rankings:version`을 갱신해 기존 cache key 재사용을 막는다.

## POST /api/reports

요청:

```json
{
  "placeId": "ulsan-taehwagang",
  "category": "tourism",
  "crowdLevel": "normal",
  "lineStatus": "short",
  "parkingStatus": "limited",
  "weatherFeel": "windy",
  "comment": "주차장은 조금 붐벼요.",
  "photoUrl": "https://example.com/sanitized.jpg",
  "clientLocation": { "latitude": 35.5486, "longitude": 129.3005 }
}
```

처리 규칙:

- `category`는 장소 카테고리와 일치해야 하며 다르면 `CATEGORY_MISMATCH`로 거부한다.
- `clientLocation`은 거리 계산에만 사용하고 저장하지 않는다.
- 장소 300m 밖이면 `LOCATION_NOT_VERIFIED`로 거부한다.
- `expiresAt`은 서버에서 `createdAt + 3 hours`로 계산한다.
- 사진 포함 보상과 위치 인증 보상은 서버에서 계산한다.
- D1 저장은 `place_events.source = "field_report"`로 구분하고 `crowd_level`, `line_status`, `parking_status`, `verified_radius_m`, `expires_at`만 저장한다. `comment`, `photoUrl`, 원좌표, 익명 세션 원문은 `place_events`에 저장하지 않는다.
- 같은 `/api/reports` 경로라도 `targetType`이 있는 요청은 기존 운영 신고 호환 경로로 분기한다. 신규 운영 신고 클라이언트는 `/api/moderation/reports`를 사용한다.

응답:

```json
{
  "success": true,
  "data": {
    "report": {
      "id": "field_report_...",
      "placeId": "ulsan-taehwagang",
      "category": "tourism",
      "crowdLevel": "normal",
      "lineStatus": "short",
      "parkingStatus": "limited",
      "weatherFeel": "windy",
      "verifiedRadiusM": 50,
      "createdAt": "2026-05-08T00:00:00.000Z",
      "expiresAt": "2026-05-08T03:00:00.000Z"
    },
    "credits": [{ "type": "verified_report", "amount": 1 }],
    "safetyWarning": null,
    "privacyNotice": "클라이언트 좌표는 반경 검증에만 사용되며 D1과 응답 본문에 저장하지 않습니다."
  }
}
```

## GET /api/reports

쿼리 파라미터:

- `placeId`: 장소별 현장 제보 목록.
- `regionId` 또는 `region`: 지역별 현장 제보 목록.
- `limit`: 반환 개수. 기본 100, 최대 200.
- `includeExpired`: `true`이면 3시간 TTL이 지난 field report도 포함한다. 기본값은 `false`다.

처리 규칙:

- D1은 `place_events`에서 `event_type = "report"` 및 `source = "field_report"` 이벤트만 반환한다. 운영 신고 큐의 `reports` 테이블은 이 공개 목록에 섞지 않는다.
- D1 public 목록 응답은 `id`, `placeId`, `category`, `crowdLevel`, `lineStatus`, `parkingStatus`, `verifiedRadiusM`, `createdAt`, `expiresAt`만 포함한다. 현재 D1 schema에는 `weather_feel` 컬럼이 없으므로 D1 목록에는 `weatherFeel`을 포함하지 않는다.
- 메모리 fallback 목록은 생성 시 메모리에 남아 있는 `weatherFeel`까지 포함할 수 있지만, 원좌표, `photoUrl`, 익명 사용자 ID는 반환하지 않는다.

## POST /api/comments

요청:

```json
{
  "placeId": "ulsan-taehwagang",
  "body": "지금 주차장은 조금 붐벼요."
}
```

처리 규칙:

- 본문은 2~280자로 제한한다.
- 전화번호, 주민번호 패턴, 스크립트, URL 스팸은 거부한다.
- 작성자 삭제는 `x-silsigan-anon-id`와 레코드 소유자 해시가 일치할 때만 허용한다.
- `GET /api/comments?placeId=`는 기본적으로 최근 3시간 이내의 visible 댓글만 반환하고, 숨김/삭제/만료 댓글은 public 응답에서 제외한다.

## POST /api/photos/complete

요청:

```json
{
  "uploadId": "upload_...",
  "placeId": "busan-gwangalli",
  "byteSize": 120000,
  "mimeType": "image/jpeg",
  "width": 1024,
  "height": 768,
  "clientReencoded": true,
  "imageBase64": "/9j/..."
}
```

처리 규칙:

- `GET /api/photos?placeId=`는 기본적으로 최근 3시간 이내의 ready 사진만 반환하고, 숨김/삭제/만료 사진은 public 응답에서 제외한다. Public 사진 응답은 `id`, `placeId`, 이미지 표시 metadata, `clickCount`, `status`, `createdAt`, `previewUrl`만 포함하며 `anonymousUserId`, `storageKey`, `deletedAt`, `imageHash`, 원본 파일명은 포함하지 않는다. R2 binding이 있으면 각 사진에 Worker origin의 `previewUrl`을 포함한다.
- `GET /api/photos/:photoId/file`은 `previewUrl`의 대상이며, ready/visible/recent 사진의 정화된 R2 객체 바이트만 반환한다. R2 key, 원본 파일명, image hash는 응답 body/header에 포함하지 않는다.
- R2 binding이 있는 Worker는 `imageBase64`를 필수로 요구한다.
- JPEG는 APP1 EXIF/XMP, comment, privacy metadata segment를 제거한 바이트만 R2에 저장한다.
- WebP는 `EXIF`, `XMP ` chunk를 제거하고 RIFF size를 다시 계산해 R2에 저장한다.
- `IMAGES` binding이 있으면 metadata 제거 후 Cloudflare Images transform/output으로 서버 픽셀 재인코딩을 수행하고, R2 metadata에 `serverPixelReencoded=true`와 처리 모드를 기록한다.
- Worker는 정화/재인코딩된 최종 이미지 바이트의 SHA-256 fingerprint를 D1 `photos.image_hash`에 저장하고, 삭제되지 않은 기존 사진과 exact duplicate면 `409 PHOTO_DUPLICATE`로 거부한다.
- `image_hash`는 public API 응답과 R2 custom metadata에 포함하지 않는다.
- 원본 파일명은 요청/DB/R2 key/응답에 저장하지 않는다.
- Cloudflare staging에서는 실제 `IMAGES` binding으로 같은 완료 경로를 smoke한다.

## POST /api/moderation/reports

요청:

```json
{
  "targetType": "photo",
  "targetId": "photo_...",
  "reason": "privacy_face",
  "note": "얼굴이 선명하게 보입니다."
}
```

처리 규칙:

- 개인정보/민감정보 신고 1건 또는 전체 신고 3건 이상이면 공개 목록에서 자동 숨김 처리한다.
- 동일 익명 식별자의 중복 신고는 Worker 정책과 D1 unique constraint로 제한한다.
- `MODERATION_ALERT_WEBHOOK_URL`이 설정된 Worker는 신규 open 신고를 운영자 알림 채널로 전송한다.
- 알림 payload는 `reportId`, `targetType`, `targetId`, `reason`, `priority`, `queuePath`, `environment`, `createdAt`만 포함한다. 신고자 익명 ID, note 원문, 원좌표, 원본 파일명, token은 보내지 않는다.
- 운영자 action은 `ADMIN_TOKEN` 또는 `ADMIN_TOKENS` role secret이 필요하며 `admin_actions` 감사 로그를 남긴다.

## POST /api/admin/moderation/hide, /restore, /delete

요청:

```json
{
  "targetType": "photo",
  "targetId": "photo_...",
  "reason": "개인정보 노출 최종 삭제"
}
```

처리 규칙:

- 모든 endpoint는 `x-silsigan-admin-token` 검증을 먼저 통과해야 한다.
- `hide`, `restore`는 `moderator` 이상, `delete`는 `admin` 이상 권한이 필요하다.
- `hide`는 공개 목록에서 제외하고 `admin_actions`에 감사 로그를 남긴다.
- `restore`는 삭제되지 않은 숨김 대상만 공개 가능 상태로 되돌린다.
- `delete`는 D1 상태를 삭제 처리하고, 사진이면 R2 object key를 삭제한다.
- 운영 조치 후 `CACHE` KV binding이 있으면 전국/지역/area/category/map-bounds 랭킹, 장소 상세/live, 댓글/사진 목록 캐시 키를 삭제한다.
- 응답과 감사 로그에는 원본 IP, 원본 파일명, EXIF/GPS, 사용자 원좌표를 저장하지 않는다.

## POST /api/admin/users/restrict

요청:

```json
{
  "anonymousUserId": "anon_...",
  "reason": "반복 스팸",
  "blockedUntil": "2026-06-20T00:00:00.000Z"
}
```

처리 규칙:

- `admin` 이상 권한이 필요하며 `moderator`/`operator` 권한으로는 실패한다.
- `anonymousUserId`는 D1 `anonymous_users.id` 형식만 허용한다.
- `blockedUntil`은 선택값이며 제공하면 미래 시각이어야 한다. 생략하면 운영자 해제 전까지 제한한다.
- 제한된 사용자의 새 댓글 작성, 사진 upload-url/complete, 장소/댓글/사진 좋아요 또는 클릭, 신고 생성은 `403 USER_RESTRICTED`로 차단한다.
- 작성자 삭제, 좋아요 해제처럼 기존 사용자 데이터 정리 목적의 요청은 별도 소유권 검증을 유지한다.
- public 오류 응답에는 raw 세션 ID, 제한 사유, 운영자 ID를 포함하지 않는다.
- 제한/해제는 `admin_actions`에 `target_type = "anonymous_user"`로 감사 기록을 남긴다.

## POST /api/admin/users/unrestrict

요청:

```json
{
  "anonymousUserId": "anon_...",
  "reason": "제한 해제"
}
```

처리 규칙:

- `admin` 이상 권한이 필요하다.
- D1 `blocked_users` 레코드를 삭제하고 `admin_actions`에 `user_unrestrict` 감사를 남긴다.
- 존재하지 않는 익명 사용자 ID는 `404 ANONYMOUS_USER_NOT_FOUND`로 실패한다.

## POST /api/admin/moderation/bulk

요청:

```json
{
  "action": "hide",
  "reason": "일괄 임시 숨김",
  "targets": [
    { "targetType": "comment", "targetId": "comment_..." },
    { "targetType": "photo", "targetId": "photo_..." }
  ]
}
```

처리 규칙:

- `moderator` 이상 권한이 필요하다.
- `action`은 `hide`, `restore`만 허용한다. 대량 `delete`는 지원하지 않고 단건 admin delete 경로만 사용한다.
- `targets`는 1~20개만 허용한다.
- 존재하지 않는 대상은 `not_found`로 표시하고, 존재하는 대상은 계속 처리한다.
- 성공한 대상마다 `admin_actions`에 `bulk_hide` 또는 `bulk_restore` 감사 로그를 남긴다.
- 운영 조치 후 `CACHE` KV binding이 있으면 성공 대상 기준으로 전국/지역/area/category/map-bounds 랭킹, 장소 상세/live, 댓글/사진 목록 캐시 키를 삭제한다.

## POST /api/admin/places/coordinate-status

요청:

```json
{
  "placeId": "jeju-coordinate-review",
  "coordinateStatus": "verified",
  "latitude": 33.4996,
  "longitude": 126.5312,
  "source": "coordinate QA",
  "reason": "좌표 출처 검증 완료"
}
```

처리 규칙:

- `operator` 이상 권한이 필요하다.
- `coordinateStatus`는 `verified`, `TODO_COORDINATE_VERIFY`, `rejected`만 허용한다.
- `verified`로 변경할 때만 장소 좌표 `latitude`, `longitude`가 필요하며 위도 `-90~90`, 경도 `-180~180` 범위를 검증한다.
- `TODO_COORDINATE_VERIFY` 또는 `rejected`로 변경하면 장소 좌표를 null로 돌리고 공개 장소/지도/랭킹 API에서 제외한다.
- `rejected`는 장소를 비활성화한다.
- `source`와 `reason`은 감사 로그에 남기되 좌표값은 감사 로그 reason에 저장하지 않는다.
- 운영 조치 후 `CACHE` KV binding이 있으면 전국/지역/area/category/map-bounds 랭킹, 장소 상세/live 캐시 키를 삭제한다.

## 보안 주의

- Cloudflare API 토큰, 관리자 토큰, R2 서명 키를 클라이언트에서 import하지 않는다.
- 공개 API는 원좌표, 관리자 토큰, 원본 파일명, EXIF 메타데이터를 응답하지 않는다.
- 병원/관공서 코멘트는 개인정보 패턴과 금칙 표현을 서버에서 추가 제한한다.

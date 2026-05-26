# #실시간 API 명세

## 기본 정보

- Base URL: `/api`
- 인증 방식: MVP 목업은 익명 상태를 허용하지만, 운영 전 Supabase Auth 세션 필수로 전환한다.
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
| GET | `/api/places` | 초기 장소 목록 | 공개 | 없음 |
| GET | `/api/reports?placeId=&includeExpired=` | 활성 제보 목록 | 공개 | 없음 |
| POST | `/api/reports` | 위치 인증 제보 생성 | 운영 전 인증 필수 | `CreateReportInput` |
| GET | `/api/questions?placeId=` | 장소 질문 목록 | 공개 | 없음 |
| POST | `/api/questions` | 질문권 차감 후 질문 생성 | 운영 전 인증 필수 | `CreateQuestionInput` |
| POST | `/api/moderation-flags` | 제보 신고 | 운영 전 인증 필수 | `FlagReportInput` |

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

- `clientLocation`은 거리 계산에만 사용하고 저장하지 않는다.
- 장소 300m 밖이면 `LOCATION_NOT_VERIFIED`로 거부한다.
- `expiresAt`은 서버에서 `createdAt + 3 hours`로 계산한다.
- 사진 포함 보상과 위치 인증 보상은 서버에서 계산한다.

응답:

```json
{
  "success": true,
  "data": {
    "report": {
      "verifiedRadiusM": 50,
      "expiresAt": "2026-05-08T03:00:00.000Z"
    },
    "credits": [{ "type": "verified_report", "amount": 1 }]
  }
}
```

## POST /api/questions

요청:

```json
{
  "placeId": "ulsan-taehwagang",
  "questionType": "photo_request",
  "body": "지금 주차장 사진 가능할까요?",
  "availableCredits": 3
}
```

처리 규칙:

- `photo_request`는 질문권 2개, 나머지는 1개 차감한다.
- 운영 DB에서는 클라이언트 제공 잔액을 신뢰하지 않고 서버 트랜잭션으로 잔액을 확인한다.
- 질문권 부족 시 질문도 생성하지 않는다.

## POST /api/moderation-flags

요청:

```json
{
  "reportId": "report_...",
  "reason": "privacy_face",
  "note": "얼굴이 선명하게 보입니다."
}
```

처리 규칙:

- 개인정보/민감정보 신고 1건, 허위 신고 2건, 전체 신고 3건 이상이면 임시 숨김 처리한다.
- 운영에서는 동일 사용자 중복 신고를 DB unique constraint로 제한한다.

## 보안 주의

- `SUPABASE_SERVICE_ROLE_KEY`를 클라이언트에서 import하지 않는다.
- 공개 API는 원좌표, service role key, 원본 파일명, EXIF 메타데이터를 응답하지 않는다.
- 병원/관공서 코멘트는 개인정보 패턴과 금칙 표현을 서버에서 추가 제한한다.

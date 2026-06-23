# #실시간 MVP 테스트 계획

## 1. 범위와 기준

- 대상: 웹/PWA MVP, Next.js + Cloudflare Workers/D1/R2/Durable Objects 배포 구조.
- 핵심 기능: 전국 장소 검색/지도, 실시간 랭킹, 댓글, 사진 업로드, 좋아요, 신고/삭제 운영.
- 보안 기준: OWASP Top 10, Worker 입력 검증, D1/R2 직접 접근 금지, 위치정보 최소수집, 사진 EXIF/GPS metadata 제거, 병원/관공서 민감정보 제한.
- 출시 판정: 아래 P0/P1 테스트가 통과하고 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm audit --audit-level critical`이 모두 통과해야 한다.

## 2. 테스트 환경

| 환경 | 목적 | 필수 설정 |
| --- | --- | --- |
| Local | 개발 검증 | `.env.local`, Worker dev URL, 익명 식별자 헤더 |
| Cloudflare Staging | D1/R2/Durable Object 검증 | 운영과 분리된 D1 DB, R2 bucket, Worker secret |
| Web Preview | 배포 전 E2E | Preview URL, Cloudflare staging API 연결 |
| Production Dry Run | 출시 직전 점검 | 운영 env var, 관리자 토큰, 운영 신고 알림 채널 |

## 3. P0 기능 테스트

### 3.1 홈/지도/장소 상세

- 사용자가 위치 권한을 거부해도 홈과 검색이 동작한다.
- 위치 권한 허용 시 주변 제보가 거리 구간으로 표시되고 정확 좌표가 노출되지 않는다.
- 지도 핀은 장소 기준으로 표시되며 사용자의 원본 좌표를 렌더링하지 않는다.
- 네이버 지도 외부 리소스 실패 시에도 fallback 지도 마커가 표시되고 장소 상세를 열 수 있다.
- Cloudflare API base가 설정된 Pages/Web Preview에서는 장소 목록이 Worker `/api/places`에서 로드된다.
- 지도 상세의 좋아요, 신고, 현장 제보 버튼은 클릭 즉시 피드백 또는 작성 폼 전환을 제공한다.
- 장소 상세에는 최근 3시간 이내 제보만 기본 노출된다.
- 만료된 제보는 기본 목록, 지도, 혼잡 요약에서 제외된다.

### 3.2 제보 작성

- 사진 없이 텍스트/상태만 제보할 수 있다.
- 사진 포함 제보는 허용 MIME, 용량, 해상도 제한을 통과해야 저장된다.
- 위치 인증은 서버에서 장소와의 거리 구간만 저장한다.
- 클라이언트가 전송한 거리, 신뢰도, 포인트 값은 서버에서 재계산한다.
- 병원/관공서 카테고리에서는 민감정보 경고가 제출 전 표시된다.
- 코멘트에 스크립트, HTML, URL 스팸, 전화번호/주민번호 형식 입력 시 저장 또는 표시가 제한된다.

### 3.3 댓글/좋아요/랭킹

- 댓글 본문은 길이, 스팸 URL, 개인정보 패턴 검증을 통과해야 저장된다.
- 작성자는 본인 익명 식별자와 일치하는 댓글만 삭제할 수 있다.
- 장소 좋아요는 익명 식별자 기준으로 중복 집계되지 않는다.
- 랭킹 API는 기본 `limit=10`, 최대 `limit=50`을 넘지 않는다.
- 전국/지역/카테고리/지도 영역 랭킹은 숨김/삭제 콘텐츠를 제외한다.
- 클릭/좋아요 반복은 rate limit 또는 중복 제한을 적용한다.
- 댓글 작성은 익명 사용자/IP 기준 1분 5개와 1일 100개 제한을 적용한다.
- 사진은 정화/재인코딩 후 최종 바이트 fingerprint 기준으로 삭제되지 않은 exact duplicate 업로드를 차단한다.

### 3.4 신고/삭제 운영

- 모든 제보/사진/질문에는 신고 진입점이 있다.
- 신고 유형: 개인정보, 얼굴/차량번호, 병원/관공서 민감정보, 허위 위치, 광고/스팸, 기타.
- 신고된 사진은 운영자 검토 전까지 기본 피드에서 숨김 처리할 수 있어야 한다.
- 작성자는 본인 제보/질문 삭제를 요청하거나 직접 삭제할 수 있다.
- 운영자 삭제는 원본, 썸네일, DB 레코드, 검색/캐시 노출을 함께 정리한다.

## 4. P0 보안/개인정보 테스트

### 4.1 위치정보 최소저장

- DB에 사용자 원본 위도/경도 컬럼이 남지 않는지 확인한다.
- 서버 로그, Cloudflare Worker 로그, Web Preview 로그에 원본 좌표가 기록되지 않는지 확인한다.
- 저장 허용값은 장소 ID, 인증 여부, 거리 구간, 지역 격자/라운딩 값 등 재식별 위험이 낮은 값으로 제한한다.
- 클라이언트에서 받은 좌표는 제보 검증 직후 폐기한다.

### 4.2 Worker 권한과 소유권

- anon 사용자는 공개 조회 대상만 읽을 수 있다.
- 작성자는 본인 제보/댓글/사진만 수정/삭제할 수 있다.
- 다른 사용자의 신고 내역, 관리자 처리 상태, 내부 식별자 해시를 읽거나 수정할 수 없다.
- Cloudflare API 토큰, 관리자 토큰, R2 서명 키는 서버 전용 환경변수에만 존재하고 브라우저 번들에 포함되지 않는다.
- D1/R2 직접 접근 경로가 있으면 출시 차단 대상으로 분류한다.

### 4.3 사진 업로드

- 업로드 전/서버 저장 전 EXIF가 제거되는지 샘플 이미지로 검증한다.
- GPS EXIF가 포함된 사진을 업로드해도 저장본과 썸네일에서 GPS 메타데이터가 제거되어야 한다.
- 브라우저는 JPEG/WebP 파일을 1280px 이하 캔버스 이미지로 재인코딩한 뒤 Worker 완료 API에 전달한다.
- Worker는 R2 저장 전 EXIF/GPS metadata를 제거하고, `IMAGES` binding이 있으면 서버 픽셀 재인코딩 결과만 저장하며, 원본 파일명을 저장/노출하지 않는다.
- Playwright smoke는 사진 제보 버튼, 파일 선택, Worker upload-url/complete 201, D1 ready 사진 생성, 상세 시트 사진 카운트 증가를 확인한다.
- 서버 픽셀 재인코딩 파이프라인은 fake `IMAGES` binding 단위 테스트와 Cloudflare staging smoke로 검증한다.
- SVG, HTML, 스크립트 포함 파일, polyglot 파일, MIME 위장 파일 업로드를 차단한다.
- public bucket을 쓰더라도 경로 추측이 어렵고 삭제/비공개 전환 절차가 있어야 한다.

### 4.4 민감정보 제한

- 병원/관공서 카테고리는 사람 얼굴, 환자명, 접수번호, 차량번호, 민원 서류, 공무원 명찰 등이 보이는 사진 업로드를 금지한다.
- 민감 장소 사진은 기본적으로 더 짧은 노출 시간 또는 사전/사후 검토 플래그를 적용한다.
- 얼굴/차량번호 자동 탐지는 MVP 제외이므로 운영정책, 신고, 빠른 삭제 SLA로 보완한다.

## 5. 음성/악용 테스트

| 시나리오 | 기대 결과 |
| --- | --- |
| 다른 사용자 제보/댓글 삭제 요청 | 403 또는 소유권 차단 |
| 동일 장소 좋아요 2회 | 1회만 집계 |
| 만료된 제보 직접 URL 접근 | 공개 피드 제외, 상세 접근 정책에 따라 제한 |
| 조작된 위치 거리 전송 | 서버 재계산 결과와 불일치 시 거부 |
| 좌표 미검증 seed 검증/반려 | operator 권한, 좌표 범위 검증, verified 전 공개 지도/랭킹 노출 및 rejected 후 제외 |
| GPS EXIF 포함 사진 | EXIF 제거 후 저장 |
| 병원 대기실 얼굴 사진 | 경고/차단 또는 신고 후 빠른 숨김 |
| HTML/JS 코멘트 | 저장 전 정제 또는 출력 인코딩 |
| 대량 신고/제보 반복 | rate limit 또는 abuse flag |
| 운영자 제한된 익명 사용자 | 새 댓글/사진/좋아요/클릭/신고 write 403 차단, public 오류 응답에 raw 세션 ID/제한 사유 미노출 |
| Cloudflare API 토큰 브라우저 검색 | 번들/네트워크 응답에서 미검출 |
| 하위 계층 error message에 토큰/좌표/파일명이 포함됨 | Worker public 응답과 analytics console에서 원문 미노출, redacted code/value만 노출 |

## 6. 배포 전 필수 검증 명령

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --audit-level critical
pnpm cf:typegen
pnpm cf:build
pnpm cf:web:dry-run
pnpm cf:web:dry-run:staging
pnpm cf:web:dry-run:production
pnpm smoke:pages
```

현재 MVP 통합 검증에서는 `pnpm verify`, `pnpm audit --audit-level critical`, OpenNext build, frontend Wrangler dry-run이 통과했다. Pages smoke는 지도 surface의 실제 크기/내부 콘텐츠, 교통/필터 버튼 클릭 상태 변화, Worker `/api/places` read path까지 확인한다. 의존성 변경 시 같은 명령을 다시 실행한다.

## 7. 출시 판정 기준

- P0 테스트 실패: 출시 불가.
- P1 테스트 실패: 운영 우회책, 담당자, 수정 예정일을 문서화해야 제한 출시 가능.
- 위치 원본 저장, D1/R2 직접 노출, EXIF 미제거, Cloudflare/API 관리자 토큰 노출, 신고/삭제 미운영 중 하나라도 확인되면 출시 불가.

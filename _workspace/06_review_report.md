# #실시간 QA/Security 리뷰 보고서

**리뷰 역할:** Harness 100 fullstack-webapp QA/security + Orchestrator 통합 검증  
**리뷰 범위:** Next.js UI, Route Handlers, domain logic, Supabase schema/RLS, docs, dependency audit  
**현재 위험도:** MEDIUM  

## 1. 종합 평가

- 배포 준비 상태: 제한적 Preview 가능, 실제 사용자 출시 전 사진 업로드/인증/운영자 도구 보강 필요.
- Critical/High dependency vulnerabilities: 0건.
- `pnpm verify`: 통과.
- `pnpm audit --audit-level low`: 통과, known vulnerability 0건.

## 2. 수행한 확인

- `pnpm install --frozen-lockfile`: 통과.
- `pnpm lint`: 통과.
- `pnpm typecheck`: 통과.
- `pnpm test`: 8개 통과.
- `pnpm build`: 통과, `/`, `/api/places`, `/api/reports`, `/api/questions`, `/api/moderation-flags` 생성 확인.
- `pnpm audit --audit-level low`: known vulnerability 0건.
- API smoke:
  - `GET /api/places`: 4개 장소 반환.
  - `POST /api/reports`: 50m 거리 구간 저장, 원좌표 미반환.
  - `POST /api/reports` 300m 밖 좌표: `LOCATION_NOT_VERIFIED`.
  - `POST /api/questions` 사진 요청: 질문권 2개 차감 이벤트.
  - 질문권 부족: `INSUFFICIENT_CREDITS`.
  - `POST /api/moderation-flags` 개인정보 신고: 1건에서 임시 숨김.
- Chrome/Computer Use 확인:
  - 로컬 `localhost:3100/3101` 서버 응답과 HTML 렌더 마크업은 정상.
  - 현재 Chrome CUA 스크린샷은 렌더러가 빈 흰 화면으로만 잡혀 시각 캡처 증거는 제한적이다.

## 3. 정합성 매트릭스

| 검증 항목 | 상태 | 비고 |
| --- | --- | --- |
| 아키텍처 문서 | 통과 | `_workspace/01_architecture.md` 작성 |
| API 명세 | 통과 | `_workspace/02_api_spec.md` 작성 및 Route Handler 반영 |
| DB/RLS 스키마 | 통과 | 원좌표 컬럼 없음, RLS 활성화, client credit insert 없음 |
| 프론트 화면 | 부분 통과 | 홈/지도/상세/제보/질문/마이 탭 구현, CUA 시각 캡처 제한 |
| 도메인 테스트 | 통과 | 만료/질문권/신고/거리 구간 |
| 보안 게이트 | 부분 통과 | 사진 EXIF 제거 구현은 아직 정책/문서 수준 |

## 4. 남은 출시 차단 리스크

| 리스크 | 상태 | Owner | Due date |
| --- | --- | --- | --- |
| 실제 사진 업로드 sanitization 미구현 | 실제 사용자 출시 전 차단 | FullStackDev | 2026-05-15 |
| 운영자 삭제/신고 큐 UI 미구현 | 실제 사용자 출시 전 차단 | FullStackDev | 2026-05-15 |
| Supabase Auth/service-role 트랜잭션 미연결 | 실제 사용자 출시 전 차단 | FullStackDev | 2026-05-14 |
| 브라우저 시각 QA 캡처 제한 | 배포 전 재검증 필요 | DesignMarketing | 2026-05-10 |
| Rate limit 미구현 | 공개 베타 전 차단 | FullStackDev | 2026-05-15 |

### 1. 실제 사진 업로드 sanitization 미구현

MVP UI와 정책은 EXIF 제거/재인코딩을 전제로 하지만 실제 파일 업로드 API는 아직 없다. 실제 사용자 사진을 받기 전에는 서버 이미지 파이프라인을 구현하고 GPS EXIF 제거 샘플을 검증해야 한다.

### 2. 운영자 삭제/신고 큐 UI 미구현

신고 API와 자동 숨김 규칙은 목업 저장소에 구현했지만 운영자가 신고를 검토하고 Storage 파일까지 삭제하는 관리 화면은 없다.

### 3. 인증/서버 트랜잭션은 Preview 단계

현재 Route Handler는 목업 저장소 기반이다. 운영 전에는 Supabase Auth 세션, service role 서버 전용 쓰기, 질문권 원장 트랜잭션을 실제 DB에 연결해야 한다.

### 4. 브라우저 시각 검증 제한

HTML/빌드는 정상이나 현재 Chrome Computer Use 화면 캡처가 빈 화면으로 잡혔다. 배포 전에는 Playwright 또는 브라우저 스크린샷으로 모바일/데스크톱 시각 QA를 다시 남겨야 한다.

## 5. 보안 체크리스트

- [x] 하드코딩 비밀값 미검출
- [x] `pnpm-lock.yaml` 생성 및 frozen install 통과
- [x] dependency audit low 이상 0건
- [x] Supabase 사용자 테이블 RLS 활성화 SQL 작성
- [x] DB schema에 사용자 원본 좌표 컬럼 없음
- [x] 질문권 원장 client direct insert 금지
- [x] 민감 카테고리 경고 UI 반영
- [x] 신고/임시 숨김 API 구현
- [x] auth/validation negative-path 테스트 일부 구현
- [ ] 실제 사진 EXIF 제거/재인코딩 구현 및 샘플 검증
- [ ] 운영자 신고 큐/삭제 도구 구현
- [ ] 실제 Supabase 트랜잭션 연결 검증

## 6. 판정

개발용 MVP와 Vercel Preview 수준의 산출물은 준비됐다. 실제 일반 사용자 출시 기준으로는 사진 업로드 sanitization, 운영자 신고/삭제 도구, Supabase Auth/트랜잭션 연결, 시각 QA 증거가 남은 필수 작업이다.

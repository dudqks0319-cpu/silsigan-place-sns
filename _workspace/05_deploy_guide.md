# #실시간 Vercel/Supabase 배포 가이드

## 1. 배포 원칙

- 운영 데이터는 최소수집, 최소보관, 최소노출을 기본값으로 한다.
- Supabase RLS는 모든 사용자 데이터 테이블에 필수이며 deny-by-default로 시작한다.
- 위치 원본 좌표는 영구 저장하지 않는다. 거리 구간 또는 장소 검증 결과만 저장한다.
- 사진은 EXIF 제거와 재인코딩 후 저장한다. 원본 파일명과 원본 메타데이터를 노출하지 않는다.
- 병원/관공서 카테고리는 민감정보 업로드 제한과 빠른 신고/삭제 운영을 필수로 한다.

## 2. Vercel 환경변수

| 이름 | 노출 | 설명 | 운영 기준 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 브라우저 가능 | Supabase 프로젝트 URL | 운영 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저 가능 | RLS 전제 anon key | RLS 없이는 사용 금지 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 | 관리자/서버 작업 키 | 브라우저 코드 import 금지, 로그 출력 금지 |
| `NEXT_PUBLIC_SITE_URL` | 브라우저 가능 | 사이트 URL | production 도메인 |

서비스 롤 키는 Vercel Production/Preview 환경변수에만 저장한다. `NEXT_PUBLIC_` 접두사를 붙이면 안 되며, 클라이언트 컴포넌트나 브라우저 번들에서 참조하면 출시 차단이다.

## 3. Supabase 설정

### 3.1 Auth

- 이메일/소셜 로그인 여부와 무관하게 `auth.uid()` 기반 RLS를 사용한다.
- 신규 가입 시 질문권 3개 부여는 서버 트랜잭션 또는 DB 함수로 처리한다.
- 포인트/질문권/신뢰도 변경은 클라이언트 직접 업데이트를 금지한다.

### 3.2 Database/RLS 필수 정책

모든 테이블은 RLS를 켠다.

```sql
alter table public.reports enable row level security;
alter table public.questions enable row level security;
alter table public.user_credits enable row level security;
alter table public.moderation_reports enable row level security;
```

공개 조회는 만료/삭제/숨김 상태를 제외한다.

```sql
create policy "read active public reports"
on public.reports
for select
using (
  deleted_at is null
  and hidden_at is null
  and expires_at > now()
);
```

작성자는 본인 레코드만 수정/삭제한다.

```sql
create policy "update own report"
on public.reports
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

민감 테이블은 본인 또는 서버 함수만 접근한다.

```sql
create policy "read own credits"
on public.user_credits
for select
using (auth.uid() = user_id);
```

### 3.3 위치 데이터 모델 기준

저장 금지:

- 사용자의 원본 위도/경도
- 사진 EXIF GPS
- 위치 인증 당시의 정확한 이동 경로
- 운영 로그의 raw coordinate

저장 허용:

- `place_id`
- `distance_band`: `within_50m`, `50_150m`, `150_300m`, `outside`
- `verified_at`
- 선택적 coarse geohash 또는 행정동 수준 값
- 서버에서 계산한 `location_verified: boolean`

서버는 클라이언트 좌표를 검증 입력으로만 사용하고, 저장 전 폐기한다.

## 4. Storage/사진 업로드 설정

- 업로드 bucket은 `reports`처럼 용도를 분리한다.
- 쓰기는 인증 사용자에게만 허용한다.
- 읽기는 공개가 필요해도 DB의 `hidden_at`, `deleted_at`, `expires_at` 정책과 함께 동작하도록 URL 발급/노출을 제어한다.
- 업로드 파일은 서버에서 MIME sniffing, 크기 제한, 확장자 제한을 수행한다.
- 저장 전 이미지 처리 파이프라인에서 EXIF 제거, 재인코딩, 썸네일 생성을 수행한다.
- 원본 파일명 대신 UUID 기반 경로를 사용한다.

권장 처리 흐름:

```txt
client upload request
-> server validates auth and category
-> server receives image
-> MIME sniff + size limit
-> decode image
-> strip EXIF
-> re-encode jpeg/webp
-> store sanitized image
-> create DB record with sanitized path only
```

## 5. Vercel 배포 순서

1. `pnpm-lock.yaml` 생성 후 커밋한다.
2. Vercel 프로젝트를 생성하고 Git 저장소를 연결한다.
3. Production/Preview 환경변수를 분리 등록한다.
4. Supabase staging과 production 프로젝트를 분리한다.
5. `pnpm install --frozen-lockfile` 기준으로 빌드한다.
6. Preview 배포에서 RLS, 업로드, 신고/삭제, 로그 redaction을 확인한다.
7. Production 배포 전 보안 게이트를 체크한다.

검증 명령:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --audit-level critical
```

## 6. 운영 모니터링

- Vercel logs: raw coordinate, service role key, anon key 외 비밀값이 출력되지 않는지 확인.
- Supabase logs: 실패한 RLS 접근, upload rejection, 신고 처리 지연을 모니터링.
- 신고 큐: 개인정보/얼굴/차량번호/병원/관공서 신고는 우선순위 높음.
- 삭제 SLA: 명백한 개인정보 또는 민감정보는 확인 즉시 숨김, 24시간 내 최종 삭제 판단.
- 데이터 보관: 제보 기본 노출은 3시간, 운영 감사 로그는 필요한 최소 기간만 보관.

## 7. 롤백 기준

다음 중 하나라도 발생하면 즉시 배포 롤백 또는 기능 플래그 비활성화:

- 사용자 원본 좌표 저장 또는 로그 노출 확인.
- 사진 EXIF GPS 노출 확인.
- RLS 우회 또는 타인 데이터 접근 확인.
- service role key 브라우저 노출 확인.
- 신고/삭제 큐 장애로 민감 사진을 숨길 수 없는 상태.

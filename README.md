# #실시간

선택한 지역의 날씨, 주변 장소, 최근 현장 소식을 출처와 기준 시각까지 확인하는 모바일 웹 앱입니다.

## 지역 정보 앱 리팩토링 · 2026-11-24

홈을 고정된 예시 제보 화면에서 지역 중심 대시보드로 교체합니다. 실제 외부 자료가 없으면 `연결 준비`, `일시적 오류`, `이전 정보`, `지원 전` 상태를 보여주며 임의 날씨·혼잡도·주차 수치를 만들지 않습니다.

- **22개 주요 도시 선택** 및 버튼으로 요청하는 현재 위치 기반 가까운 지원 지역 선택. 정확한 사용자 좌표는 이 화면의 서버 요청·브라우저 저장소에 넣지 않습니다.
- **기상청 관측 날씨와 시간대별 초단기예보**, **카카오 지역 중심 20km 장소 검색**, **에어코리아 지정 측정소 관측**을 서버 어댑터로 분리했습니다.
- 지도 원본 링크, 장소 상세, 브라우저 안의 장소 저장, 검색·카테고리 선택, 수동·주기적 갱신을 제공합니다.
- API 미설정 상태의 기본 장소 안내는 기존 울산·부산·경주 목록이며 **실시간 정보와 분리**합니다.
- 기존 Supabase 제보는 운영자가 명시적으로 연결한 경우에만 읽습니다. 숨김·다른 지역·미래·3시간 이상 지난 제보는 표시하지 않습니다.
- 인증/신고 운영을 완성하기 전에는 기존 공개 쓰기 API를 운영 환경에서 차단합니다. 기존 SNS/모바일 코드는 보관하며 이번 변경의 실제 화면 대상은 Next.js 웹입니다.

**현재 단계는 연결 가능한 베타 구현입니다.** 운영 API 승인, 실제 공급자 응답, 운영 DB 정책 및 운영 배포는 별도로 검증해야 합니다. 네이티브 앱 배포나 App Store 제출을 완료한 상태가 아닙니다.

**운영 배포 전 의존성 보안 수정이 필요합니다.** 현재 검증 결과와 남은 항목은 [검증 기록](docs/local-live-verification.md), 수정 후보는 [의존성 업데이트 기록](docs/dependency-upgrade.md)을 확인하세요.

### 시작하기

Node.js 22.13 이상과 `packageManager`에 고정한 pnpm 10.11.0을 사용합니다.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

필수/선택 환경변수와 실제 데이터 연결 절차는 [지역 정보 베타 운영 가이드](docs/local-live-refactor.md)를 참고하세요. 키를 설정하지 않아도 빈 상태·지역 선택·기본 장소 저장을 확인할 수 있습니다.

```bash
pnpm verify
```

구조: `src/features/local-live/{components,hooks,server}` · API: `GET /api/local-live?region=ulsan&category=all&q=`

---

## 기존 SNS MVP 기록

아래 내용은 이전 제보 중심 MVP의 범위와 원칙입니다. 현재 릴리스 검증 상태는 위 운영 가이드를 우선합니다.

## MVP 범위

- 웹/PWA 우선
- Next.js + Supabase + Vercel
- 초기 지역: 울산, 부산, 경주
- 초기 카테고리: 관광지, 축제/행사장, 맛집/카페, 병원, 관공서, 주차장
- MVP 제외: 결제, 현금성 포인트, DM, 팔로우, 업체 광고, 네이티브 앱, AI 자동 판독

## 보안/개인정보 원칙

- 정확한 사용자 위치는 공개하지 않는다.
- 위치 원본 좌표는 DB와 로그에 저장하지 않는다.
- 제보에는 장소와의 거리 구간만 저장한다.
- 사진은 EXIF 제거와 재인코딩 후 저장한다.
- 병원/관공서 카테고리는 민감정보 업로드를 보수적으로 제한한다.
- 모든 사용자 데이터는 Supabase RLS를 전제로 설계한다.
- 신고/숨김/삭제 운영이 준비되기 전에는 출시하지 않는다.

## 개발 명령

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

출시 전에는 lockfile을 커밋한 뒤 아래 명령까지 통과해야 합니다.

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level low
```

## 문서

- 테스트 계획: `_workspace/04_test_plan.md`
- 배포 가이드: `_workspace/05_deploy_guide.md`
- QA/Security 리뷰: `_workspace/06_review_report.md`
- 개인정보/위치정보/사진/신고 정책: `docs/privacy-safety-policy.md`
- 보안 게이트: `docs/security-gate.md`

# #실시간 모바일

Expo 기반 전국 현장 제보 앱입니다. 기존 Next.js 웹 MVP는 유지하고, 이 폴더는 모바일 앱 전용으로 분리합니다.

## 실행

```bash
pnpm install
pnpm start
pnpm ios
pnpm android
pnpm web
```

Codex 앱에서는 `Run` 액션이 `./script/build_and_run.sh`를 실행합니다.

## 검증

```bash
pnpm test
pnpm typecheck
pnpm verify
```

## UX 원칙

- 첫 화면은 마케팅 설명보다 검색, 실시간 요약, 제보/질문 행동을 먼저 보여준다.
- 하단 탭은 safe-area와 입력 폼을 가리지 않는다.
- 물어보기의 사진 요청은 질문 유형 하나로만 처리한다.
- 정확한 좌표와 민감 사진 정보는 저장/노출하지 않는 전제를 유지한다.

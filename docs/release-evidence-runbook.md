# #실시간 release evidence runbook

## Purpose

릴리스 후보의 작은 JSON 검증 요약을 후보 Git SHA와 SHA-256으로 결합해, 나중에 다른 코드나 다른 증거가 섞이는 것을 막는다.

## Prepare

1. 애플리케이션 소스 후보 커밋을 만든다.
2. `release-ledger.yaml`의 `candidate.git_sha`, `candidate.branch`, `candidate.dirty_state`를 실제 후보와 맞춘다.
3. 테스트·build·staging smoke 결과를 민감정보와 request body가 없는 작은 JSON으로 `artifacts/release-evidence/` 아래에 저장한다.
4. 기존 증거 파일을 명시해 manifest를 만든다.

```bash
pnpm release:evidence:prepare -- \
  --artifact=artifacts/release-evidence/verification.json \
  --artifact=artifacts/release-evidence/staging-smoke.json
```

5. `release-ledger.yaml`, `RELEASE_STATUS.md`, `docs/current-release-state.md`, manifest와 입력 JSON만 evidence-only 커밋으로 기록한다.
6. clean worktree에서 검증한다.

```bash
pnpm release:provenance
```

## Safety

- `--artifact`는 `artifacts/release-evidence/` 아래의 기존 일반 파일만 허용한다.
- 중복, 상위 경로, 절대 경로, symlink로 프로젝트 밖을 가리키는 파일, manifest 자체는 거부한다.
- 원시 로그, 브라우저 request body, 토큰, 쿠키, 이메일, 정밀 위치, 원본 사진을 넣지 않는다.
- manifest는 임시 파일을 거쳐 원자적으로 교체한다.
- 이 명령은 배포, Git commit/push, Cloudflare 변경을 수행하지 않는다.

## Retention

- Git에는 최종 후보별 작은 redacted JSON 요약과 manifest만 남긴다.
- 로컬 반복 실행의 대형 스크린샷·네트워크 로그는 release evidence에 넣지 않는다.
- CI 실패 로그는 `.github/workflows/ci.yml`의 7일 보존 정책을 따른다.
- 후보가 폐기되면 Git에 이미 기록된 증거를 다시 쓰지 않고 다음 후보에서 새 manifest를 만든다.

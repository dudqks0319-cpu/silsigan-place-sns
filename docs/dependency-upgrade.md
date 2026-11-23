# 의존성 보안 점검 및 업그레이드 후보

점검일: **2026-11-24** · 범위: 루트 웹 앱의 `package.json` / `pnpm-lock.yaml`. `mobile` 프로젝트는 이번 의존성 점검과 변경 범위에 포함하지 않았다.

## 현재 상태: 업그레이드 미적용, 보안 배포 게이트 미통과

현재 의존성 그래프의 audit 요약은 **critical 5 / high 32 / moderate 19 / low 2**다. 업그레이드 설치가 완료되지 않아 원래 manifest와 소스 호환성 변경을 복원했으며, lockfile은 변경되지 않았다. **취약 의존성 해소, 새 버전 호환성 검증, audit 0을 달성한 상태가 아니다.** 기존 의존성에서 통과한 기능 검증은 [리팩토링 검증 기록](local-live-verification.md)에 별도로 기록한다.

- [점검 결과 JSON](verification/dependency-audit-20261124.json): 실제 audit 결과를 보존한 사본. 공개 advisory 설명의 예시 절대경로만 치환했다.
- [미검증 업그레이드 후보 패치](patches/dependency-upgrade-candidate.patch): `package.json`과 Zod 4 호환성 한 줄을 포함한다. **새 lockfile은 포함하지 않으며, 패치만 적용해서는 배포할 수 없다.**
- [보안 게이트](security-gate.md): 이전 체크 기록과 이번 미통과 상태를 구분한다.

## 중단 사유와 복원 확인

고정한 pnpm 10.11.0으로 설치하던 중 실행 환경이 `network approval was cancelled before a decision was returned`를 반환했다. 네트워크 권한을 우회하거나 재승인 없이 확장하지 않았다. 이어서 네트워크를 사용하지 않는 `--offline --ignore-scripts` 설치를 시도했지만 `napi-postinstall@>=0.3.0 <0.4.0-0`의 캐시 메타데이터가 없어 `ERR_PNPM_NO_OFFLINE_META`로 종료되었다.

후보 변경을 복원한 뒤 기존 그래프의 `--offline --ignore-scripts --frozen-lockfile` 설치가 성공했다. 이 검사는 **기존 manifest와 lockfile의 일치**를 확인하며, 후보 의존성의 설치나 보안을 검증한 결과는 아니다. 프로젝트에 지정된 `packageManager: pnpm@10.11.0`, `engines.node: >=22.13.0`은 유지했다.

변경 전과 복원 후 `pnpm-lock.yaml`의 SHA-256은 동일하다.

```text
0752cb221d43d69c1083a0d0e28c9e68045219b6483a8a1a0d9e1a546b0e2a83
```

## 점검 결과와 영향 범위

audit JSON에는 advisory 레코드 57개, 고유 advisory URL 51개, 패키지 계열 13개가 있다. 심각도 합계와 레코드 수는 audit 출력의 서로 다른 집계이며, 그대로 보존했다. 이 결과는 **알려진 취약 버전이 의존성 그래프에 존재함**을 보여준다. 앱에서 공격을 재현했거나 전체 보안 진단을 수행했다는 뜻은 아니다. 실제 영향은 사용하는 기능, 입력 경로, 실행 환경에 따라 추가 확인이 필요하다.

아래의 운영·개발 구분은 lockfile의 의존 경로를 기준으로 했다. audit의 `devDependencies: 0` 메타데이터만으로 모든 항목을 운영 실행 경로로 분류하지 않았다.

| 패키지 | 현재 lock의 버전 | 미검증 후보 | 주요 유입 경로 / 범위 |
| --- | --- | --- | --- |
| `next` | 16.2.6 | 16.4.6 | 직접 운영 의존성. 런타임·이미지·캐시 관련 advisory는 기능별 적용 여부 확인 필요 |
| `sharp` | 0.34.5 | 새 Next가 선언한 `^0.35.5` | `next > sharp` 선택 의존성, 이미지 처리 |
| `zod` | 3.24.2, 4.4.3 | 4.6.7 | 서버 입력 검증 및 `eslint-plugin-react-hooks` 경유 사본 |
| `ws` | 8.20.1 | 8.21.0 | `@supabase/supabase-js > @supabase/realtime-js > ws`, 운영 그래프 |
| `postcss` | 8.5.10 | 8.5.23 | `next > postcss`, 운영 의존 그래프의 CSS 처리 |
| `nanoid` | 3.3.12 | 3.3.18 | `next > postcss > nanoid` |
| `source-map-js` | 1.2.1 | 1.2.2 | `next > postcss > source-map-js` |
| `js-yaml` | 4.1.1 | 4.3.2 | `eslint > @eslint/eslintrc`, 개발·lint |
| `@babel/core` | 7.29.0 | 7.29.6 | `eslint-config-next > eslint-plugin-react-hooks`, 개발·lint |
| `brace-expansion` | 1.1.13, 5.0.6 | 1.1.21, 5.0.12 | ESLint의 `minimatch` 3과 typescript-eslint의 `minimatch` 10 경유 |
| `browserslist` | 4.28.2 | 4.28.7 | React Hooks lint 플러그인 → Babel → 컴파일 대상 도구 |
| `baseline-browser-mapping` | 2.10.27 | 2.11.0 | 위 `browserslist` 경유. 새 Next도 이 패키지를 선언함 |
| `minimatch` | 취약 사본 10.2.5; 3.1.5도 존재 | 상위 도구 갱신으로 11.0.1 이상 | 공식 advisory에 패치된 10 계열이 없어 `typescript-eslint` / parser 8.74.0으로 상위 의존성을 갱신하는 후보 |

정확한 advisory URL, 영향 버전 범위, 기존 의존 경로는 [audit JSON](verification/dependency-audit-20261124.json)에 있다.

## 후보 선택 근거와 남은 호환성 확인

후보는 `next`와 `eslint-config-next`를 16.4.6으로 맞추고, ESLint는 9.39.5로 같은 주 버전을 유지한다. Zod는 4.6.7로 이동하며 `z.record`에 키 스키마를 추가하는 소스 변경 한 줄을 함께 보관했다. React 19.2.3, Supabase 2.98.0, TypeScript 5.8.2 등 무관한 직접 의존성은 유지한다.

전이 의존성은 패치 버전으로 고정하는 override를 제안했다. 다만 `minimatch`에 호환되지 않을 수 있는 주 버전을 강제로 덮어쓰는 대신, 공식 npm 메타데이터에서 `minimatch ^11.0.1`을 선언하는 `typescript-estree 8.74.0`을 선택하도록 상위 도구를 갱신한다. **설치가 완료되지 않았으므로 이 계획이 실제 전체 그래프에 적용되는지, override가 호환되는지는 아직 검증하지 않았다.**

점검 시 확인한 1차 자료:

- [Next advisory GHSA-vc7v-qv4w-wrv8](https://github.com/advisories/GHSA-vc7v-qv4w-wrv8): 해당 16 계열 패치 버전은 16.4.5. 후보는 16.4.6.
- [Zod advisory GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): 패치 버전 4.6.6. 후보는 4.6.7.
- [Zod 4 migration guide](https://zod.dev/v4/changelog): `z.record`의 키·값 스키마 인수 변경.
- [minimatch advisory GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): 해당 영향 범위 `>=7, <11.0.1`, 패치 버전 11.0.1.
- 공식 npm 레지스트리의 [Next 16.4.6](https://registry.npmjs.org/next/16.4.6), [typescript-estree 8.74.0](https://registry.npmjs.org/@typescript-eslint/typescript-estree/8.74.0) 및 각 후보 버전 메타데이터로 버전 존재와 의존 범위를 확인했다.

ESLint 9.39.5는 npm에서 지원 종료 경고도 반환했다. 후보는 변경 범위를 줄이려고 9 계열을 유지한 것이므로, 지원 중인 도구 체계로의 이동은 호환성 검토가 추가로 필요하다.

## 후속 작업 순서

네트워크 설치를 허용하는 환경에서 별도 작업 브랜치로 진행한다. 후보는 자동 적용되지 않는다.

1. 후보 패치와 최신 advisory를 다시 확인한 뒤 패치를 적용한다.
2. pnpm 10.11.0으로 의존성을 설치하여 **새 lockfile을 생성**한다. 원래 lockfile을 유지한 채 새 manifest만 커밋하지 않는다.
3. lockfile에 남은 취약 사본과 변경 범위를 확인하고, 깨끗한 환경에서 `--frozen-lockfile` 설치를 검증한다.
4. audit, lint, typecheck, 전체 테스트, 운영 빌드를 실행한다. 서버 API와 브라우저 smoke 검증도 새 의존성으로 반복한다.
5. 잔여 advisory와 실제 적용 여부를 문서화한 뒤 보안 배포 게이트를 다시 판정한다. audit 0만으로 전체 앱 보안이 보장되지는 않는다.

후속 작업 시 사용할 명령 예시이며, 아래 절차는 이번에 완료된 검증 목록이 아니다.

```bash
git apply --check docs/patches/dependency-upgrade-candidate.patch
git apply docs/patches/dependency-upgrade-candidate.patch
npm exec --yes --package=pnpm@10.11.0 -- pnpm install --no-frozen-lockfile
npm exec --yes --package=pnpm@10.11.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@10.11.0 -- pnpm audit --audit-level low
npm exec --yes --package=pnpm@10.11.0 -- pnpm lint
npm exec --yes --package=pnpm@10.11.0 -- pnpm typecheck
npm exec --yes --package=pnpm@10.11.0 -- pnpm test
npm exec --yes --package=pnpm@10.11.0 -- pnpm build
```

## 증적 사본의 처리 내역

저장소의 audit JSON은 약 215 KB다. 개인 경로, 인증 헤더, 실제 키·토큰 패턴을 검사했으며 발견하지 않았다. 공개 advisory 두 개(`1124252`, `1130709`)의 `overview`에는 원래 예시 절대경로가 있어 22곳을 `<EXAMPLE_ABSOLUTE_PATH>`로 치환했다. 나머지 필드와 버전·범위·의존 경로·집계는 원본 그대로다. 따라서 이 파일은 원본과 바이트가 동일한 파일이 아닌 **경로를 치환한 audit 사본**이다.

```text
원본 audit SHA-256
f0af6a4673a022f5829d5dc9c7c5afd4785db3ad811b8e3f194376c22270fe80

저장소 audit 사본 SHA-256
59490d176a2a9336e4951200d5df7947ea708dac072714020c7998fef8284ce3
```

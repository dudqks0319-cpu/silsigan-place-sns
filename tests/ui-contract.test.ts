import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import nextConfig, { securityHeaders } from "../next.config.ts";
import { normalizeCloudflareRuntimeConfig } from "../src/lib/cloudflare-api.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const photoUploaderPath = resolve(testDir, "../src/components/silsigan/PhotoUploader.tsx");
const placeDetailSheetPath = resolve(testDir, "../src/components/silsigan/PlaceDetailSheet.tsx");
const redesignPath = resolve(testDir, "../src/components/silsigan/SilsiganRedesign.tsx");
const legacyKoreanUxPath = resolve(testDir, "../src/components/silsigan/SilsiganKoreanUX.tsx");
const redesignCssPath = resolve(testDir, "../src/components/silsigan/SilsiganRedesign.module.css");
const naverMapPath = resolve(testDir, "../src/components/silsigan/NaverMap.tsx");
const rankingPanelPath = resolve(testDir, "../src/components/silsigan/RankingPanel.tsx");
const regionTabsPath = resolve(testDir, "../src/components/silsigan/RegionTabs.tsx");
const naverMapLoaderPath = resolve(testDir, "../src/lib/naver-map-loader.ts");
const featureConfigPath = resolve(testDir, "../packages/contracts/src/config.ts");
const photoCostGuardPanelPath = resolve(testDir, "../src/app/admin/moderation/posts/PhotoCostGuardPanel.tsx");
const apiCostGuardPanelPath = resolve(testDir, "../src/app/admin/moderation/posts/ApiCostGuardPanel.tsx");
const betaKpiPanelPath = resolve(testDir, "../src/app/admin/moderation/posts/BetaKpiPanel.tsx");
const appErrorPath = resolve(testDir, "../src/app/error.tsx");
const moderationPageCssPath = resolve(testDir, "../src/app/admin/moderation/posts/page.module.css");
const adminLoginPagePath = resolve(testDir, "../src/app/admin/login/page.tsx");
const adminLoginRoutePath = resolve(testDir, "../src/app/api/admin/login/route.ts");
const turnstileClientPath = resolve(testDir, "../src/lib/turnstile-client.ts");
const photoUploaderSource = readFileSync(photoUploaderPath, "utf8");
const placeDetailSheetSource = readFileSync(placeDetailSheetPath, "utf8");
const redesignSource = readFileSync(redesignPath, "utf8");
const legacyKoreanUxSource = readFileSync(legacyKoreanUxPath, "utf8");
const redesignCss = readFileSync(redesignCssPath, "utf8");
const naverMapSource = readFileSync(naverMapPath, "utf8");
const rankingPanelSource = readFileSync(rankingPanelPath, "utf8");
const regionTabsSource = readFileSync(regionTabsPath, "utf8");
const naverMapLoaderSource = readFileSync(naverMapLoaderPath, "utf8");
const featureConfigSource = readFileSync(featureConfigPath, "utf8");
const photoCostGuardPanelSource = readFileSync(photoCostGuardPanelPath, "utf8");
const apiCostGuardPanelSource = readFileSync(apiCostGuardPanelPath, "utf8");
const betaKpiPanelSource = readFileSync(betaKpiPanelPath, "utf8");
const appErrorSource = readFileSync(appErrorPath, "utf8");
const moderationPageCssSource = readFileSync(moderationPageCssPath, "utf8");
const adminLoginPageSource = readFileSync(adminLoginPagePath, "utf8");
const adminLoginRouteSource = readFileSync(adminLoginRoutePath, "utf8");
const turnstileClientSource = readFileSync(turnstileClientPath, "utf8");
const demoBackedNextApiPaths = [
  "../src/app/api/places/route.ts",
  "../src/app/api/reports/route.ts",
  "../src/app/api/questions/route.ts",
  "../src/app/api/my-questions/route.ts",
  "../src/app/api/hashtags/route.ts",
  "../src/app/api/posts/route.ts",
  "../src/app/api/post-flags/route.ts",
  "../src/app/api/moderation-flags/route.ts",
  "../src/app/api/admin/moderation/posts/route.ts",
] as const;

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `${startMarker} must exist`);

  const endIndex = source.indexOf(endMarker, startIndex);
  assert.notEqual(endIndex, -1, `${endMarker} must exist after ${startMarker}`);

  return source.slice(startIndex, endIndex);
}

test("web responses enforce baseline browser attack protections without blocking the native camera or location flow", () => {
  const headers = new Map(securityHeaders.map(({ key, value }) => [key, value]));

  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assert.equal(headers.get("X-Permitted-Cross-Domain-Policies"), "none");
  assert.match(headers.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
  assert.match(headers.get("Content-Security-Policy") ?? "", /object-src 'none'/);
  assert.match(headers.get("Content-Security-Policy") ?? "", /base-uri 'self'/);
  assert.match(headers.get("Content-Security-Policy") ?? "", /form-action 'self'/);
  assert.equal(headers.get("Permissions-Policy"), "camera=(self), geolocation=(self), microphone=()");
  assert.equal(nextConfig.poweredByHeader, false);
  assert.equal(
    nextConfig.images?.remotePatterns?.some((pattern) => {
      const hostname = pattern instanceof URL ? pattern.hostname : pattern.hostname;
      return hostname === "*.r2.dev" || hostname === "*.cloudflarestorage.com";
    }),
    false,
  );
});

test("admin login and logout mutations enforce same-origin requests", () => {
  assert.match(adminLoginRouteSource, /assertAdminMutationOrigin\(request\)/);
  assert.match(adminLoginRouteSource, /export async function DELETE\(request: Request\)/);
  assert.equal(adminLoginRouteSource.match(/assertAdminMutationOrigin\(request\)/g)?.length, 2);
});

test("admin photo cost guard exposes an accessible immediate stop without leaking Worker credentials", () => {
  assert.match(adminLoginPageSource, /fetch\("\/api\/admin\/login"/);
  assert.match(adminLoginPageSource, /headers: \{ "content-type": "application\/json", accept: "application\/json" \}/);
  assert.match(adminLoginPageSource, /window\.location\.assign\("\/admin\/moderation\/posts"\)/);
  assert.match(adminLoginPageSource, /disabled=\{!ready \|\| submitting \|\| !token\}/);
  assert.doesNotMatch(adminLoginPageSource, /action="\/api\/admin\/login"/);
  assert.match(photoCostGuardPanelSource, /fetch\("\/api\/admin\/photo-cost-guard"/);
  assert.match(photoCostGuardPanelSource, /method: "PATCH"/);
  assert.match(photoCostGuardPanelSource, /사진 R2 사용 즉시 중단/);
  assert.match(photoCostGuardPanelSource, /검토 후 R2 사용 재개/);
  assert.match(photoCostGuardPanelSource, /사진 조회 \(Class B\)/);
  assert.match(photoCostGuardPanelSource, /Images 변환/);
  assert.match(photoCostGuardPanelSource, /D1 보호 조회/);
  assert.match(photoCostGuardPanelSource, /readsEnabled: enabled/);
  assert.match(photoCostGuardPanelSource, /reconciliationAcknowledged: enabled \? resumeReviewed : false/);
  assert.match(photoCostGuardPanelSource, /R2 사용량과 D1 원장을 대조했습니다/);
  assert.match(photoCostGuardPanelSource, /aria-live="polite"/);
  assert.match(photoCostGuardPanelSource, /60_000/);
  assert.doesNotMatch(photoCostGuardPanelSource, /x-silsigan-admin-token/);
  assert.doesNotMatch(photoCostGuardPanelSource, /SILSIGAN_WORKER_ADMIN_TOKEN/);
  assert.match(moderationPageCssSource, /\.costGuardPanel/);
  assert.match(moderationPageCssSource, /\.dangerButton/);
  assert.match(moderationPageCssSource, /\.sectionHeader > \.stoppedBadge/);
});

test("admin global API guard exposes 60/70/80 meters, immediate stop, and reconciled resume", () => {
  assert.match(apiCostGuardPanelSource, /fetch\("\/api\/admin\/api-cost-guard"/);
  assert.match(apiCostGuardPanelSource, /비필수 API 즉시 중단/);
  assert.match(apiCostGuardPanelSource, /사용량 대조 후 재개/);
  assert.match(apiCostGuardPanelSource, /60% 경고 · 70% 축소 · 80% 중단/);
  assert.match(apiCostGuardPanelSource, /Workers 일일 요청/);
  assert.match(apiCostGuardPanelSource, /D1 일일 rows read/);
  assert.match(apiCostGuardPanelSource, /D1 일일 rows written/);
  assert.match(apiCostGuardPanelSource, /aria-live="polite"/);
  assert.doesNotMatch(apiCostGuardPanelSource, /x-silsigan-admin-token/);
  assert.doesNotMatch(apiCostGuardPanelSource, /SILSIGAN_WORKER_ADMIN_TOKEN/);
});

test("photo upload obtains an explicit one-use Turnstile proof without exposing the secret key", () => {
  const uploadFlow = sourceBetween(redesignSource, "const uploadPlacePhoto", "const clickPlacePhoto");

  assert.match(uploadFlow, /acquirePhotoUploadTurnstileToken\(photoUploadProtection\)/);
  assert.match(uploadFlow, /byteSize: photo\.byteSize/);
  assert.match(uploadFlow, /width: photo\.width/);
  assert.match(uploadFlow, /height: photo\.height/);
  assert.match(uploadFlow, /turnstileToken/);
  assert.match(turnstileClientSource, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(turnstileClientSource, /action: "photo_upload"/);
  assert.match(turnstileClientSource, /appearance: "interaction-only"/);
  assert.match(turnstileClientSource, /execution: "execute"/);
  assert.match(turnstileClientSource, /role", "dialog"/);
  assert.match(turnstileClientSource, /aria-modal", "true"/);
  assert.match(turnstileClientSource, /api\.remove\(widgetId\)/);
  assert.doesNotMatch(turnstileClientSource, /SECRET_KEY|TURNSTILE_SECRET|siteverify/);
});

test("admin beta KPI panel is aggregate-only accessible and aligned to launch thresholds", () => {
  assert.match(betaKpiPanelSource, /fetch\(`\/api\/admin\/beta-kpis\?days=\$\{windowDays\}`/);
  assert.match(betaKpiPanelSource, /제보 완료 중앙값/);
  assert.match(betaKpiPanelSource, /지도 성공률/);
  assert.match(betaKpiPanelSource, /D1 재방문/);
  assert.match(betaKpiPanelSource, /D7 재방문/);
  assert.match(betaKpiPanelSource, /집중 장소 최신 정보/);
  assert.match(betaKpiPanelSource, /Tier A 최신 정보/);
  assert.match(betaKpiPanelSource, /Tier B 최신 정보/);
  assert.match(betaKpiPanelSource, /검수 24시간 이내/);
  assert.match(betaKpiPanelSource, /오류 없는 앱 열기/);
  assert.match(betaKpiPanelSource, /aria-live="polite"/);
  assert.match(betaKpiPanelSource, /15초 이하/);
  assert.match(betaKpiPanelSource, /99% 이상/);
  assert.match(betaKpiPanelSource, /70% 이상/);
  assert.doesNotMatch(betaKpiPanelSource, /actorIdentity|anonymousUser|properties_json|x-silsigan-admin-token|SILSIGAN_WORKER_ADMIN_TOKEN/);
  assert.match(naverMapSource, /onMapReady\?: \(\) => void/);
  assert.match(naverMapSource, /onMapReadyRef\.current\?\.\(\)/);
  assert.match(redesignSource, /onMapReady=\{\(\) => trackEvent\("map_load_succeeded"\)\}/);
  assert.match(redesignSource, /completionMs: reportCompletionMs/);
});

test("app error boundary reports only a safe aggregate event and never renders raw failures", () => {
  assert.match(appErrorSource, /trackEvent\("app_runtime_error"/);
  assert.match(appErrorSource, /다시 시도/);
  assert.match(appErrorSource, /reset\(\)/);
  assert.doesNotMatch(appErrorSource, /error\.message|error\.digest|JSON\.stringify\(error\)/);
});

test("home feed keeps secondary actions behind the more menu", () => {
  const feedPostCard = sourceBetween(redesignSource, "function FeedPostCard({", "function AnswerableQuestions");
  const primaryActions = sourceBetween(feedPostCard, '<div className={styles.feedActions}>', "{actionsOpen &&");
  const secondaryMenu = sourceBetween(feedPostCard, '<div className={styles.feedSecondaryMenu}>', "{post.safetyWarning &&");

  assert.match(feedPostCard, /const \[actionsOpen, setActionsOpen\] = useState\(false\)/);
  assert.match(primaryActions, /도움돼요/);
  assert.match(primaryActions, /더보기/);
  assert.doesNotMatch(primaryActions, /Bookmark|Share2|Flag/);
  assert.match(secondaryMenu, /Bookmark/);
  assert.match(secondaryMenu, /Share2/);
  assert.match(secondaryMenu, /Flag/);
  assert.match(feedPostCard, /const postEvidenceLabel = isSample \? "예시 화면" : "현장 제보";/);
  assert.doesNotMatch(feedPostCard, /post\.judgement/);
  assert.match(redesignCss, /\.feedSecondaryMenu/);
});

test("home and map surfaces stay focused on the visit-decision MVP path", () => {
  const fallbackMap = sourceBetween(naverMapSource, "function FallbackMap", "function fallbackPositionForPlace");

  assert.match(redesignSource, /const feedTabLabels = \["전체", "내 주변", "관광지", "주차"\] as const;/);
  assert.match(redesignSource, /challenges\.slice\(0, 2\)/);
  assert.match(redesignSource, /hashtags\.slice\(0, 4\)/);
  assert.match(redesignSource, /공식 현재 날씨/);
  assert.match(redesignSource, /candidate\.dimension === "weather"/);
  assert.match(redesignSource, /candidate\.sourceType\.startsWith\("official_"\)/);
  assert.match(redesignSource, /const homeCategoryOptions = \[/);
  assert.match(redesignSource, /\.slice\(0, 5\)/);
  assert.match(redesignSource, /title="지금 확인할 장소"/);
  assert.match(redesignSource, /className=\{styles\.nearbyMapButton\}/);
  assert.match(naverMapSource, /MAP_KEY_MISSING/);
  assert.match(naverMapSource, /MAP_AUTH_FAILED/);
  assert.match(naverMapSource, /MAP_TIMEOUT/);
  assert.match(naverMapSource, /MAP_RESOURCE_FAILED/);
  assert.match(fallbackMap, /data-map-failure-code=\{mapFailureCode\(failureReason\)\}/);
  assert.doesNotMatch(fallbackMap, /<code>|지도 키가 설정되지 않았습니다|등록된 Web 서비스 URL/);
  assert.doesNotMatch(regionTabsSource, /수도권 준비/);
  assert.match(regionTabsSource, /도심\/한강/);
  assert.doesNotMatch(rankingPanelSource, /랭킹을 준비하고 있어요/);
  assert.match(rankingPanelSource, /아직 순위를 만들 현장 정보가 없어요/);
  assert.match(naverMapSource, /지도 다시 시도/);
  assert.match(naverMapSource, /const transientMapFailureReasons = new Set<MapFailureReason>\(\["sdk", "resource", "timeout"\]\)/);
  assert.match(naverMapSource, /const automaticRetryUsedRef = useRef\(false\)/);
  assert.match(naverMapSource, /setFailureReason\(null\)/);
  assert.match(naverMapLoaderSource, /script\.dataset\.silsiganLoadState = "failed"/);
  assert.match(naverMapLoaderSource, /activeScript\?\.remove\(\)/);
  assert.match(naverMapLoaderSource, /existing\.remove\(\)/);
  assert.match(redesignSource, /activeRegion === "nationwide" \? "전국 최신 근거 TOP 10" : "지도 화면 안 TOP 10"/);
  assert.match(redesignSource, /mapAreaPlaces\.filter\(\(place\) => place\.score > 0\)/);
  assert.match(regionTabsSource, /label: "전국", caption: "전국 검색"/);
  assert.doesNotMatch(redesignSource, /regionLabel\(/);
  assert.doesNotMatch(redesignSource, /onGoMapWithFilter/);
});

test("place detail preserves navigation context and approved reports expose fresh share links", () => {
  assert.match(redesignSource, /placeReturnTargetRef = useRef/);
  assert.match(redesignSource, /scrollTop: phoneBodyRef\.current\?\.scrollTop \?\? 0/);
  assert.match(redesignSource, /pendingScrollRestoreRef\.current = target\.scrollTop/);
  assert.match(redesignSource, /event\.key !== "ArrowLeft"/);
  assert.match(redesignSource, /const searchParams = new URLSearchParams\(window\.location\.search\)/);
  assert.match(redesignSource, /searchParams\.get\("place"\)/);
  assert.match(redesignSource, /searchParams\.get\("report"\)/);
  assert.match(redesignSource, /cloudflareApiUrl\(`\/api\/places\/\$\{encodeURIComponent\(placeId\)\}`\)/);
  assert.match(redesignSource, /buildScopedApiPath\("\/api\/reports", \{ placeId, limit: 100 \}\)/);
  assert.match(redesignSource, /data-report-id=\{report\.id\}/);
  assert.match(redesignSource, /reportCard\.scrollIntoView/);
  assert.match(redesignSource, /reportCard\.focus\(\{ preventScroll: true \}\)/);
  assert.match(redesignCss, /\.liveReportFocused/);
  assert.match(redesignSource, /currentUrl\.searchParams\.delete\("place"\)/);
  assert.match(redesignSource, /currentUrl\.searchParams\.delete\("report"\)/);
  assert.match(redesignSource, /report\.moderationStatus !== "approved" \|\| report\.hiddenAt \|\| report\.isSample/);
  assert.match(redesignSource, /\?place=\$\{encodeURIComponent\(place\.id\)\}&report=\$\{encodeURIComponent\(report\.id\)\}/);
  assert.match(redesignSource, /<time className=\{styles\.reportTimestamp\}/);
  assert.match(redesignSource, /role="tablist" aria-label="장소 프로필 탭"/);
  assert.match(redesignSource, /role="tabpanel" aria-labelledby=\{`place-tab-/);
  assert.match(regionTabsSource, /onKeyDown=\{\(event\) => handleKeyDown\(event, index\)\}/);
});

test("home leads with a concise visit decision and exposes live-source freshness", () => {
  const homeScreen = sourceBetween(redesignSource, "function HomeScreen({", "function SearchScreen");

  assert.match(homeScreen, /출발 전,\s*<br \/>지금 상황만 확인하세요\./);
  assert.match(homeScreen, /날씨·인파·대기·주차를 한 화면에서 보고 10초 안에 결정해요\./);
  assert.match(homeScreen, /오래됐거나 근거가 없는 정보는 추천에 쓰지 않아요\./);
  assert.match(redesignSource, /cloudflareApiUrl\("\/api\/sources"\)/);
  assert.match(homeScreen, /currentLivePlaceStatus\(placeStatuses\[place\.id\]\)/);
  assert.match(homeScreen, /dataMode === "live" \? visitDecisionShortLabel\(decisionStatus\) : place\.signal/);
  assert.match(homeScreen, /source\.activationStatus === "active"/);
  assert.match(homeScreen, /primarySignal\.sourceName/);
  assert.match(homeScreen, /formatObservedAt\(primarySignal\.observedAt\)/);
  assert.match(homeScreen, /formatConfidence\(primarySignal\.confidenceScore\)/);
  assert.match(homeScreen, /formatExpiryHint\(primarySignal\.expiresAt\)/);
  assert.match(redesignSource, /function currentLivePlaceStatus/);
  assert.match(redesignCss, /\.homeDecisionHero/);
  assert.match(redesignCss, /\.homePlaceEvidence/);
  assert.match(redesignCss, /\.liveReportOpen/);
  assert.match(redesignCss, /grid-template-columns: 92px minmax\(0, 1fr\)/);
  assert.match(redesignSource, /체험용 샘플/);
  assert.match(redesignSource, /사진 출처/);
});

test("photo-first surfaces use visible photo assets before status-only fallbacks", () => {
  assert.match(redesignSource, /const hotRegions = \["광안리", "황리단길", "태화강", "주차", "웨이팅", "사진스팟"\];/);
  assert.doesNotMatch(redesignSource, /const hotRegions = .*"성수"/);
  assert.match(redesignSource, /사진 1장을 먼저 올리면 피드 상단 지금컷으로 표시돼요\./);
  assert.match(redesignSource, /사진 없이 상태만 올리기/);
  assert.doesNotMatch(redesignSource, /Cloudflare R2 연결 후 실제 사진 업로드/);
  assert.match(redesignCss, /\.sheetPhotoHero/);
  assert.match(redesignCss, /url\("\/silsigan\/fallback\/gwangalli\.png"\)/);
  assert.match(photoUploaderSource, /previewUrl\.startsWith\("\/"\)/);
  assert.match(photoUploaderSource, /iPhone HEIC를 JPEG로 자동 변환/);
  assert.match(photoUploaderSource, /window\.SilsiganNativeBridge/);
  assert.match(photoUploaderSource, /command: "selectPhoto"/);
  assert.match(photoUploaderSource, /photo\.format !== "image\/jpeg"/);
  assert.match(photoUploaderSource, /url\.protocol === "capacitor:"/);
  assert.match(photoUploaderSource, /"localhost", "127\.0\.0\.1", "\[::1\]"/);
  assert.match(photoUploaderSource, /상태 확인은 제보 카드에서 할 수 있습니다/);
  assert.doesNotMatch(photoUploaderSource, /아직 제공하지 않습니다/);
  assert.doesNotMatch(redesignSource, /className=\{`\$\{styles\.feedPhoto\} \$\{styles\[place\.tone\]\}`\}/);
});

test("sample content is excluded from live status and duplicate photo counting", () => {
  assert.match(redesignSource, /const currentReports = latestReports\.filter\(\(report\) => !report\.isSample\)/);
  assert.match(redesignSource, /\.filter\(\(report\) => report\.hasPhoto && !postIds\.has\(report\.id\)\)/);
  assert.match(redesignSource, /const latestReportEvidence = reports\.find\(\(report\) => !report\.isSample\) \?\? null/);
  assert.match(redesignSource, /reportCount=\{comments\.length\}/);
  assert.match(redesignSource, /const safePhotoUrl = safeHttpUrl\(photoUrl\)/);
  assert.match(redesignSource, /isSample \? "체험용 샘플" : post\.locationVerified \? "현장 인증" : "상태 제보"/);
});

test("mobile controls stay tappable and sample activity never becomes user reputation", () => {
  const myScreen = sourceBetween(redesignSource, "function MyScreen", "function BottomNav");
  const preferenceSync = sourceBetween(redesignSource, "const syncPreference", "const displayPlaces");

  assert.match(redesignCss, /\.iconButton \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  assert.match(redesignCss, /\.realMapFrame :global\(\.silsigan-map-marker\) \{[\s\S]*?height: 44px;/);
  assert.match(naverMapSource, /new maps\.Size\(96, 44\)/);
  assert.match(redesignSource, /aria-pressed=\{value === option\}/);
  assert.match(redesignSource, /const timeoutId = window\.setTimeout\(\(\) => setToast\(""\), 3_500\)/);
  assert.match(redesignCss, /\.mapToolRow button \{[\s\S]*?min-height: 44px;/);
  assert.match(redesignCss, /\.mapSelectedActions button \{[\s\S]*?min-height: 44px;/);
  assert.doesNotMatch(redesignSource, /const verifiedReports = 0;/);
  assert.doesNotMatch(redesignSource, /userId: "demo-user"/);
  assert.match(myScreen, /내 제보 상태/);
  assert.match(myScreen, /공개 \$\{publicReportCount\} · 검수 대기 \$\{pendingReportCount\} · 비공개 \$\{nonPublicReportCount\}/);
  assert.match(myScreen, /숫자 신뢰점수를 만들지 않고 실제 검수 상태만 보여드립니다\./);
  assert.match(myScreen, /기기를 바꾸거나 브라우저 데이터를 지우면 복구할 수 없습니다\./);
  assert.doesNotMatch(myScreen, /회원으로 전환하면|다른 기기에서도 기록/);
  assert.doesNotMatch(myScreen, /준비 중|연결 대기|공개 미리보기|집계 대기/);
  assert.match(preferenceSync, /설정을 서버에 동기화하지 못했습니다\. 이 기기에 저장된 내용은 유지됩니다\./);
  assert.doesNotMatch(preferenceSync, /error\.message/);
  assert.match(redesignSource, /reports=\{myReports\}/);
  assert.match(redesignSource, /접수 후 검수 상태도 여기에 표시됩니다\./);
  assert.match(redesignSource, /if \(post\.isSample\) \{\s*setToast\("체험용 샘플에서는 도움돼요가 저장되거나 랭킹에 반영되지 않습니다\."\);\s*return;/);
  assert.match(redesignSource, /reports\.filter\(\(report\) => !postIds\.has\(report\.id\)\)/);
  assert.match(redesignSource, /const safeLeadPhotoSourceUrl = safeHttpUrl\(leadPhotoReport\?\.photoSourceUrl\)/);
  assert.match(redesignSource, /운전 중에는 제보하지 말고, 안전하게 정차한 뒤 올려주세요\./);
});

test("all legacy Next demo APIs fail closed before handling production requests", () => {
  for (const relativePath of demoBackedNextApiPaths) {
    const source = readFileSync(resolve(testDir, relativePath), "utf8");
    const handlerCount = source.match(/export async function (?:GET|POST)/g)?.length ?? 0;
    const guardCount = source.match(/assertLocalDemoApiAvailable\(\);/g)?.length ?? 0;

    assert.match(source, /import \{ assertLocalDemoApiAvailable \} from "@\/lib\/runtime-data-mode";/);
    assert.equal(guardCount, handlerCount, `${relativePath} must guard every exported request handler`);
  }
});

test("browser-facing demo moderation mutations enforce the shared same-origin guard", () => {
  const source = readFileSync(resolve(testDir, "../src/app/api/admin/moderation/posts/route.ts"), "utf8");

  assert.match(source, /import \{ assertAdminMutationOrigin, assertAdminRequest \} from "@\/lib\/admin-auth";/);
  assert.match(source, /assertAdminRequest\(request\);\s*assertAdminMutationOrigin\(request\);\s*assertRateLimit/);
});

test("search empty states keep users moving to map or upload", () => {
  const searchScreen = sourceBetween(redesignSource, "function SearchScreen", "function MapScreen");

  assert.match(searchScreen, /const matchedUploadPlace = matchedPlaces\[0\]/);
  assert.match(searchScreen, /아직 검색어와 맞는 최근 사진이 없습니다\./);
  assert.match(searchScreen, /지도에서 찾기/);
  assert.match(searchScreen, /지금컷 추가/);
  assert.match(searchScreen, /앱 안 지도에서 보기/);
  assert.doesNotMatch(searchScreen, /인기 장소 지금컷 추가/);
  assert.match(searchScreen, /인기 지역 보기/);
  assert.match(searchScreen, /관련 장소 보기/);
  assert.match(searchScreen, /해시태그로 지금컷 올리기/);
  assert.match(searchScreen, /현재는 앱에 등록된 장소만 검색합니다\./);
  assert.doesNotMatch(searchScreen, /장소 추가 검색은 준비 중/);
});

test("external search stays display-only while manual place requests remain private until review", () => {
  const searchScreen = sourceBetween(redesignSource, "function SearchScreen", "function MapScreen");
  const submitManualRequest = sourceBetween(searchScreen, "const submitManualPlaceRequest = async", "useEffect(() =>");
  const submitRequest = sourceBetween(redesignSource, "const submitPlaceAdditionRequest = async", "const flagPost = async");
  const requestBody = sourceBetween(submitRequest, "body: JSON.stringify({", "}),");
  const myScreen = sourceBetween(redesignSource, "function MyScreen", "function useModalFocus");

  assert.match(searchScreen, /네이버 검색 결과이며 #실시간에 등록된 장소가 아닙니다/);
  assert.match(searchScreen, /검색 결과는 별도 저장하지 않습니다/);
  assert.doesNotMatch(searchScreen, /onGoMap\(item\.title\)/);
  assert.doesNotMatch(submitManualRequest, /item\./);
  assert.match(searchScreen, /실시간 장소 직접 제안/);
  assert.match(searchScreen, /접수만으로 지도·랭킹·사진 등록에 공개되지 않습니다/);
  assert.doesNotMatch(submitRequest, /source:/);
  assert.match(requestBody, /clientRequestId/);
  assert.match(requestBody, /name: normalizedDraft\.name/);
  assert.match(requestBody, /address: normalizedDraft\.address/);
  assert.match(requestBody, /category: normalizedDraft\.category/);
  assert.match(submitRequest, /category: draft\.category\.normalize\("NFKC"\)\.trim\(\) \|\| "기타"/);
  assert.doesNotMatch(requestBody, /source|proposedName|proposedAddress|proposedCategory/);
  assert.doesNotMatch(submitRequest, /mapx|mapy|link|query|latitude|longitude/);
  assert.match(myScreen, /장소 추가 요청/);
  assert.match(myScreen, /placeRequestStatusLabel/);
  assert.match(myScreen, /request\.name/);
  assert.match(myScreen, /request\.address/);
  assert.doesNotMatch(myScreen, /request\.proposedName|request\.proposedAddress/);
  assert.doesNotMatch(myScreen, /reviewReason/);
});

test("upload flow starts with photo before place details", () => {
  const reportScreen = sourceBetween(redesignSource, "function ReportScreen", "function AskScreen");
  const photoSectionIndex = reportScreen.indexOf('className={styles.photoUploadCard}');
  const placeSectionIndex = reportScreen.indexOf('className={styles.uploadPlaceCard}');

  assert.match(reportScreen, /사진 1장을 먼저 고르고, 장소와 해시태그, 한 줄만 남기면 됩니다\./);
  assert.match(reportScreen, /<li>사진<\/li>\s*<li>장소<\/li>\s*<li>태그<\/li>\s*<li>한 줄<\/li>\s*<li>올리기<\/li>/);
  assert.notEqual(photoSectionIndex, -1, "photo upload section must exist");
  assert.notEqual(placeSectionIndex, -1, "place selection section must exist");
  assert.ok(photoSectionIndex < placeSectionIndex, "photo upload section must appear before place selection");
  assert.match(reportScreen, /uploadEnabled=\{photoUploadReady\}/);
  assert.match(reportScreen, /사진 서버에 연결할 수 없어 사진 선택을 비활성화했습니다\./);
  assert.doesNotMatch(reportScreen, /사진 저장 준비 중/);
  assert.match(photoUploaderSource, /disabled=\{busy \|\| !uploadEnabled\}/);
  assert.match(photoUploaderSource, /사진 업로드 서버에 연결되지 않았습니다\./);
});

test("an uploaded photo locks its report place until the user deletes that photo", () => {
  const uploadRender = sourceBetween(redesignSource, 'activeView === "upload" && reportPlace &&', 'activeView === "ask"');
  const reportScreen = sourceBetween(redesignSource, "function ReportScreen", "function AskScreen");

  assert.match(uploadRender, /if \(photoAttached && place\.id !== reportPlace\.id\)/);
  assert.match(uploadRender, /사진을 삭제한 뒤 장소를 바꿀 수 있습니다\./);
  assert.match(reportScreen, /const placeLockedByPhoto = photoAttached;/);
  assert.match(reportScreen, /disabled=\{placeLockedByPhoto && candidate\.id !== place\.id\}/);
  assert.match(reportScreen, /사진이 연결된 뒤에는 장소를 바꿀 수 없습니다\./);
});

test("realtime event timestamps render in the device locale instead of slicing UTC text", () => {
  assert.doesNotMatch(placeDetailSheetSource, /event\.createdAt\.slice\(11, 16\)/);
  assert.match(placeDetailSheetSource, /formatRealtimeEventTime\(event\.createdAt\)/);
  assert.match(placeDetailSheetSource, /formatRealtimeEventDateTime\(event\.createdAt\)/);
  assert.match(placeDetailSheetSource, /new Intl\.DateTimeFormat\("ko-KR"/);
  assert.match(placeDetailSheetSource, /시각 확인 필요/);
});

test("global no-data state offers search and map recovery actions", () => {
  const noDataState = sourceBetween(redesignSource, 'title={activeRegion === "nationwide"', 'activeView === "home"');

  assert.match(noDataState, /검색으로 넓히기/);
  assert.match(noDataState, /전국 장소 검색/);
  assert.match(noDataState, /setActiveView\("search"\)/);
  assert.match(noDataState, /지도에서 다른 지역 보기/);
  assert.match(noDataState, /전국 지도에서 찾기/);
  assert.match(noDataState, /setActiveView\("map"\)/);
});

test("runtime truth never promotes missing production data to live or sample content", () => {
  const loadData = sourceBetween(redesignSource, "const loadData = useCallback", "useEffect(() => {");
  const missingProtection = normalizeCloudflareRuntimeConfig({
    contractVersion: 2,
    dataMode: "live",
    featureFlags: { SOCIAL_FEED_ENABLED: true },
    dimensionSettings: [],
  });
  const explicitProtection = normalizeCloudflareRuntimeConfig({
    contractVersion: 2,
    dataMode: "live",
    featureFlags: {},
    dimensionSettings: [],
    photoUploadProtection: { turnstileRequired: false, turnstileSiteKey: null },
  });

  assert.match(redesignSource, /useState<DataMode>\("unavailable"\)/);
  assert.deepEqual(missingProtection.photoUploadProtection, { turnstileRequired: true, turnstileSiteKey: null });
  assert.equal(missingProtection.featureFlags.SOCIAL_FEED_ENABLED, true);
  assert.equal(missingProtection.featureFlags.QNA_ENABLED, false);
  assert.deepEqual(explicitProtection.photoUploadProtection, { turnstileRequired: false, turnstileSiteKey: null });
  assert.throws(
    () => normalizeCloudflareRuntimeConfig({ contractVersion: 2, dataMode: "unknown" }),
    /실시간 API 설정 응답이 올바르지 않습니다/,
  );
  assert.match(loadData, /normalizeCloudflareRuntimeConfig\(/);
  assert.match(loadData, /!cloudflareApiConfigured && process\.env\.NODE_ENV === "production"/);
  assert.match(loadData, /실시간 API가 설정되지 않아 운영 데이터를 표시할 수 없습니다\./);
  assert.match(loadData, /!isRuntimeDataModeAllowed\(process\.env\.NODE_ENV, runtimeConfig\.dataMode\)/);
  assert.match(loadData, /shouldClearTruthBearingDataOnLoadFailure\(process\.env\.NODE_ENV\)/);
  assert.match(loadData, /clearTruthBearingData\(\);\s*setDataMode\("unavailable"\);/);
  assert.match(loadData, /운영 환경에서는 확인된 실시간 데이터만 표시할 수 있습니다\./);
  assert.match(redesignSource, /async function fetchWorkerStatusesForPlaces[\s\S]*fetchJsonWithTimeout<CloudflarePlaceStatus>/);
  assert.match(loadData, /setDataMode\(runtimeConfig\.dataMode === "live" \? "live" : "sample"\)/);
  assert.match(loadData, /setDataMode\("directory"\)/);
  assert.match(loadData, /setDataMode\("unavailable"\)/);
  assert.doesNotMatch(loadData, /setDataMode\("live"\)/);
  assert.doesNotMatch(redesignSource, /createInitialFallbackDataset/);
});

test("Q&A rewards ads live streams demo data and Seoul realtime default to disabled", () => {
  for (const key of [
    "QNA_ENABLED",
    "REWARDS_ENABLED",
    "ADS_ENABLED",
    "LIVE_STREAMS_ENABLED",
    "DEMO_DATA_ENABLED",
    "SEOUL_REALTIME_ENABLED",
    "SOCIAL_FEED_ENABLED",
  ]) {
    assert.match(featureConfigSource, new RegExp(`${key}: false`));
  }

  assert.match(redesignSource, /runtimeConfig\.featureFlags\.QNA_ENABLED/);
  for (const eventName of [
    "manual_location_selected",
    "map_viewed",
    "live_status_viewed",
    "report_location_verified",
    "report_location_failed",
    "content_reported",
  ]) {
    assert.match(redesignSource, new RegExp(`trackEvent\\("${eventName}"`));
  }
  const loadData = sourceBetween(redesignSource, "const loadData = useCallback", "useEffect(() => {");
  assert.match(loadData, /const socialFeedEnabled = runtimeConfig\.featureFlags\.SOCIAL_FEED_ENABLED;/);
  assert.match(loadData, /const postsRequest = socialFeedEnabled\s*\?/);
  assert.match(loadData, /const hashtagsRequest = cloudflareApiConfigured\s*\?/);
  assert.doesNotMatch(loadData, /const hashtagsRequest = socialFeedEnabled\s*\?/);
  assert.match(loadData, /Promise\.resolve<PublicPost\[\]>\(\[\]\)/);
  assert.match(redesignSource, /featureFlags\.QNA_ENABLED &&/);
  assert.match(redesignSource, /featureFlags\.REWARDS_ENABLED && result\.report\.moderationStatus === "approved" && earned > 0/);
  assert.match(redesignSource, /socialFeedEnabled=\{featureFlags\.SOCIAL_FEED_ENABLED\}/);
  assert.match(redesignSource, /\{socialFeedEnabled && <section/);
  assert.match(redesignSource, /\{rewardsEnabled && <section/);
  assert.match(redesignSource, /\{qnaEnabled && <AnswerableQuestions/);
  assert.match(redesignSource, /const activeChallenges = useMemo\(\s*\(\) => featureFlags\.REWARDS_ENABLED/);
  assert.match(redesignSource, /const activeFieldQuests = useMemo\(\s*\(\) => featureFlags\.QNA_ENABLED/);
  assert.match(redesignSource, /const challenges: Challenge\[\] = \[\];/);
  assert.match(redesignSource, /const fieldQuests: FieldQuest\[\] = \[\];/);
  assert.doesNotMatch(redesignSource, /2026-06-02/);
  assert.match(redesignSource, /reportToneFromObservation\(report\.crowdLevel, report\.parkingStatus\)/);
  assert.match(redesignSource, /function reportToneFromObservation\(crowdLevel\?: CrowdLevel, parkingStatus\?: ParkingStatus\)/);
  assert.match(redesignSource, /return "unknown";/);
  assert.match(redesignSource, /requestPushRegistration\(\)/);
  assert.match(redesignSource, /hashPushToken\(detail\.token\)/);
  assert.match(redesignSource, /pushTokenHash: null/);
  assert.match(redesignSource, /type StatusTone = "calm" \| "normal" \| "busy" \| "danger" \| "unknown"/);
  assert.match(redesignSource, /toneForVisitDecision[\s\S]*return "unknown";/);
  assert.match(redesignCss, /\.statusChip\.unknown/);
  assert.match(redesignCss, /\.unknown \{/);
});

test("home weather only uses the currently visible place scope", () => {
  const homeScreen = sourceBetween(redesignSource, "function HomeScreen", "function SearchScreen");

  assert.match(homeScreen, /for \(const place of places\)/);
  assert.match(homeScreen, /currentLivePlaceStatus\(placeStatuses\[place\.id\]\)/);
  assert.match(homeScreen, /candidate\.dimension === "weather"/);
});

test("legacy Korean UX fixtures cannot resurrect expired campaigns or social/Q&A samples", () => {
  assert.match(legacyKoreanUxSource, /const posts: Post\[\] = \[\];/);
  assert.match(legacyKoreanUxSource, /const questions: Question\[\] = \[\];/);
  assert.match(legacyKoreanUxSource, /const challenges: Challenge\[\] = \[\];/);
  assert.doesNotMatch(legacyKoreanUxSource, /2026-06-02/);
});

test("field reports start empty and send only dimensions the user actually observed", () => {
  const submitReport = sourceBetween(redesignSource, "const submitReport = async () => {", "const uploadPlacePhoto = async");

  assert.match(redesignSource, /const \[pickedCrowd, setPickedCrowd\] = useState\(""\)/);
  assert.match(redesignSource, /const \[pickedParking, setPickedParking\] = useState\(""\)/);
  assert.match(redesignSource, /const \[pickedLine, setPickedLine\] = useState\(""\)/);
  assert.match(redesignSource, /useState<Set<string>>\(\(\) => new Set\(\)\)/);
  assert.match(submitReport, /실제로 확인한 현장 상태를 하나 이상 선택해 주세요\./);
  assert.match(submitReport, /\.\.\.\(crowdLevel \? \{ crowdLevel \} : \{\}\)/);
  assert.match(submitReport, /\.\.\.\(queueStatus \? \{ queueStatus \} : \{\}\)/);
  assert.match(submitReport, /\.\.\.\(parkingObservation \? \{ parkingObservation \} : \{\}\)/);
  assert.match(submitReport, /cloudflareApiUrl\("\/api\/reports"\)/);
  assert.doesNotMatch(submitReport, /cloudflareApiUrl\("\/api\/posts"\)/);
});

test("search never assigns a no-result upload to an unrelated popular place", () => {
  const searchScreen = sourceBetween(redesignSource, "function SearchScreen({", "function MapScreen({");

  assert.match(searchScreen, /const matchedUploadPlace = matchedPlaces\[0\];/);
  assert.doesNotMatch(searchScreen, /const fallbackUploadPlace = matchedPlaces\[0\] \?\? places\[0\];/);
  assert.doesNotMatch(searchScreen, /인기 장소 지금컷 추가/);
});

test("generic upload entry requires an explicit report place instead of reusing the browsing fallback", () => {
  const redesign = sourceBetween(redesignSource, "export default function SilsiganRedesign", "function StatusBar");
  const reportPlaceGate = sourceBetween(redesignSource, "function ReportPlaceGate", "function ReportScreen");

  assert.match(redesign, /const \[reportPlaceId, setReportPlaceId\] = useState<string \| null>\(null\)/);
  assert.match(redesign, /const reportPlace = useMemo\([\s\S]*place\.id === reportPlaceId[\s\S]*\?\? null/);
  assert.match(redesign, /const openUploadPlacePicker = \(\) => \{[\s\S]*dataMode !== "live"[\s\S]*setReportPlaceId\(null\);\s*setActiveView\("upload"\);/);
  assert.match(redesign, /const startReportForPlace = \(place: Place\) => \{[\s\S]*setReportPlaceId\(place\.id\);[\s\S]*setActiveView\("upload"\);/);
  assert.match(redesign, /activeView === "upload" && !reportPlace/);
  assert.match(redesign, /activeView === "upload" && reportPlace/);
  assert.match(redesign, /<BottomNav activeView=\{activeView\} onChange=\{changeBottomNavView\}/);
  assert.match(redesign, /onGoReport=\{\(\) => \{\s*closeOnboarding\(\);\s*openUploadPlacePicker\(\);/);
  assert.match(reportPlaceGate, /장소를 먼저 선택해 주세요/);
  assert.match(reportPlaceGate, /선택하기 전에는 어떤 장소에도 사진이나 상태가 연결되지 않습니다\./);
  assert.match(reportPlaceGate, /onSelectPlace\(place\)/);
  assert.match(reportPlaceGate, /장소 검색/);
  assert.match(reportPlaceGate, /지도에서 선택/);
});

test("static directory mode preserves place discovery while stopping live reads, writes, and telemetry", () => {
  const loadData = sourceBetween(redesignSource, "const loadData = useCallback", "useEffect(() => {");
  const recordPlaceClick = sourceBetween(redesignSource, "const recordPlaceClick = async", "const togglePlaceLike = async");
  const submitReport = sourceBetween(redesignSource, "const submitReport = async () => {", "const uploadPlacePhoto = async");

  assert.match(redesignSource, /type DataMode = "live" \| "sample" \| "directory" \| "unavailable"/);
  assert.match(loadData, /fetchStaticPlaceDirectory\(\{/);
  assert.match(loadData, /mapPlaces\(directory\.places, \[\]\)/);
  assert.match(loadData, /setDataMode\("directory"\)/);
  assert.match(loadData, /setAnalyticsTransportEnabled\(false\)/);
  assert.match(loadData, /hasLoadedDirectoryRef\.current = true/);
  assert.doesNotMatch(loadData, /trackEvent\("nearby_loaded"[^\n]*directory/);
  assert.match(redesignSource, /photoUploadReady = dataMode === "live" && cloudflareApiConfigured/);
  assert.match(recordPlaceClick, /!cloudflareApiConfigured \|\| dataMode !== "live"/);
  assert.match(submitReport, /dataMode !== "live"/);
  assert.match(redesignSource, /if \(!cloudflareApiConfigured \|\| dataMode !== "live" \|\| !realtimePlaceId\)/);
  assert.match(redesignSource, /\[cloudflareApiConfigured, dataMode, realtimePlaceId\]/);
  assert.match(redesignSource, /providerEnabled=\{dataMode !== "directory" && dataMode !== "unavailable"\}/);
  assert.match(redesignSource, /const externalSearchEnabled = dataMode === "live"/);
  assert.match(naverMapSource, /if \(!providerEnabled \|\| failureReason\)/);
  assert.match(naverMapSource, /외부 지도 호출 없이 검증된 장소 위치만 표시합니다\./);
  assert.match(redesignSource, /기본 장소 · 실시간 근거 없음/);
  assert.match(redesignSource, /모든 상태는 ‘최근 확인 정보 없음’/);
});

test("hashtag exploration stays available when the legacy social feed is disabled", () => {
  const selectHashtag = sourceBetween(redesignSource, "const selectHashtag = async", "const clearHashtagFilter");
  const clearHashtag = sourceBetween(redesignSource, "const clearHashtagFilter", "const selectChallenge");
  const searchScreen = sourceBetween(redesignSource, "function SearchScreen({", "function MapScreen({");

  assert.doesNotMatch(selectHashtag, /if \(!featureFlags\.SOCIAL_FEED_ENABLED\) \{\s*return;/);
  assert.match(selectHashtag, /setActiveView\("search"\)/);
  assert.match(selectHashtag, /setMapSearchQuery\(`#\$\{hashtagName\}`\)/);
  assert.match(redesignSource, /const \[hashtagMediaReports, setHashtagMediaReports\] = useState<Report\[\]>\(\[\]\)/);
  assert.match(redesignSource, /mergeReportCollections\(reports, hashtagMediaReports\)/);
  assert.match(selectHashtag, /setHashtagMediaReports\(nextHashtagReports\)/);
  assert.doesNotMatch(selectHashtag, /setReports\(nextHashtagReports\)/);
  assert.match(clearHashtag, /setHashtagMediaReports\(\[\]\)/);
  assert.doesNotMatch(clearHashtag, /loadData/);
  assert.match(searchScreen, /report\.hashtagNames/);
  assert.match(searchScreen, /report\.photoIds/);
  assert.match(searchScreen, /fieldReportPhotos/);
  assert.match(searchScreen, /onFollowHashtag\(selectedHashtagName\)/);
  assert.match(searchScreen, /aria-pressed=\{followedHashtagNames\.has\(selectedHashtagName\)\}/);
  assert.match(searchScreen, /`#\$\{selectedHashtagName\} 팔로우`/);
  assert.match(searchScreen, /hashtagMediaHasMore/);
  assert.match(searchScreen, /onLoadMoreHashtagMedia/);
  assert.match(searchScreen, /최신 사진 더 보기/);
  assert.match(redesignSource, /onSelectHashtag=\{selectHashtag\}/);
  assert.match(redesignSource, /aria-label=\{`#\$\{tag\} 최신 사진 다시 보기`\}/);
  assert.match(searchScreen, /const externalSearchEnabled = dataMode === "live" && !trimmedQuery\.startsWith\("#"\) && trimmedQuery\.length >= 2;/);
});

test("field report submission carries its uploaded photos, hashtags, and retry key as one publication", () => {
  const submitReport = sourceBetween(redesignSource, "const submitReport = async () => {", "const uploadPlacePhoto = async");

  assert.match(redesignSource, /const \[attachedPhotoIds, setAttachedPhotoIds\] = useState<string\[\]>\(\[\]\)/);
  assert.match(redesignSource, /const reportRequestIdRef = useRef<string \| null>\(null\)/);
  assert.match(submitReport, /photoIds: attachedPhotoIds/);
  assert.match(submitReport, /hashtagNames: recommendedTags/);
  assert.match(submitReport, /clientRequestId/);
  assert.match(submitReport, /reportRequestIdRef\.current = null/);
});

test("place detail fetches current evidence and renders source plus provider observation time", () => {
  const placeScreen = sourceBetween(redesignSource, "function PlaceScreen({", "function ReportScreen");

  assert.match(redesignSource, /\/api\/places\/\$\{encodeURIComponent\(selectedPlace\.id\)\}\/status/);
  assert.match(placeScreen, /현재 판단 근거/);
  assert.match(placeScreen, /signal\.sourceName/);
  assert.match(placeScreen, /signal\.attributionText/);
  assert.match(placeScreen, /dateTime=\{signal\.observedAt\}/);
  assert.match(placeScreen, /signal\.isEstimated \? "예상"/);
  assert.match(placeScreen, /유효한 공식 데이터나 현장 제보가 아직 없습니다\./);
  assert.doesNotMatch(redesignSource, /function reportsFallback/);
  assert.match(redesignSource, /사용자 제보 · \$\{report\.verifiedRadiusM/);
});

test("map copy matches its all-place scope instead of promising photo-only pins", () => {
  const mapScreen = sourceBetween(redesignSource, "function MapScreen({", "function PlaceScreen({");

  assert.match(mapScreen, /places=\{filteredPlaces\}/);
  assert.match(mapScreen, /전국 장소와 최근 근거/);
  assert.match(mapScreen, /장소를 찾고 최근 사진·상태를 확인하세요/);
  assert.match(mapScreen, /aria-label="지도 장소 검색"/);
  assert.doesNotMatch(mapScreen, /사진 올라온 장소/);
  assert.doesNotMatch(mapScreen, /최근 사진이 있는 장소만 표시됩니다/);
});

test("future timestamps fail closed and all attributed photos expose their source", () => {
  const minutesAgo = sourceBetween(redesignSource, "function minutesAgo", "function formatRecentTimestamp");
  const liveReportCard = sourceBetween(redesignSource, "function LiveReportCard", "function FeedPostCard");
  const homeScreen = sourceBetween(redesignSource, "function HomeScreen({", "function SearchScreen");

  assert.match(redesignSource, /const FUTURE_TIMESTAMP_TOLERANCE_MS = 2 \* 60_000/);
  assert.match(minutesAgo, /const diffMs = Date\.now\(\) - timestamp/);
  assert.match(minutesAgo, /if \(diffMs < -FUTURE_TIMESTAMP_TOLERANCE_MS\) \{\s*return "시각 확인 필요";/);
  assert.match(liveReportCard, /\{report\.photoAttribution && \(/);
  assert.doesNotMatch(liveReportCard, /report\.isSample && report\.photoAttribution/);
  assert.match(homeScreen, /\{leadPhotoReport\?\.photoAttribution && \(/);
  assert.doesNotMatch(homeScreen, /leadIsSample && leadPhotoReport\?\.photoAttribution/);
});

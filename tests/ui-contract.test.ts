import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const photoUploaderPath = resolve(testDir, "../src/components/silsigan/PhotoUploader.tsx");
const redesignPath = resolve(testDir, "../src/components/silsigan/SilsiganRedesign.tsx");
const redesignCssPath = resolve(testDir, "../src/components/silsigan/SilsiganRedesign.module.css");
const naverMapPath = resolve(testDir, "../src/components/silsigan/NaverMap.tsx");
const currentLocationButtonPath = resolve(testDir, "../src/components/silsigan/CurrentLocationButton.tsx");
const naverMapLoaderPath = resolve(testDir, "../src/lib/naver-map-loader.ts");
const featureConfigPath = resolve(testDir, "../packages/contracts/src/config.ts");
const adminModerationPagePath = resolve(testDir, "../src/app/admin/moderation/posts/page.tsx");
const sourceHealthPanelPath = resolve(testDir, "../src/app/admin/moderation/posts/SourceHealthPanel.tsx");
const sourceHealthCssPath = resolve(testDir, "../src/app/admin/moderation/posts/page.module.css");
const moderationQueuePath = resolve(testDir, "../src/app/admin/moderation/posts/ModerationQueueClient.tsx");
const fieldReportQueuePath = resolve(testDir, "../src/app/admin/moderation/posts/FieldReportQueueClient.tsx");
const fieldReportAdminRoutePath = resolve(testDir, "../src/app/api/admin/field-reports/route.ts");
const sourceHealthAdminRoutePath = resolve(testDir, "../src/app/api/admin/sources/health/route.ts");
const adminLoginRoutePath = resolve(testDir, "../src/app/api/admin/login/route.ts");
const homePagePath = resolve(testDir, "../src/app/page.tsx");
const sharePostPagePath = resolve(testDir, "../src/app/share/post/[postId]/page.tsx");
const sharePostOgPath = resolve(testDir, "../src/app/share/post/[postId]/opengraph-image.tsx");
const sharedPlacePagePath = resolve(testDir, "../src/app/share/place/[placeId]/page.tsx");
const sharedPlaceOgPath = resolve(testDir, "../src/app/share/place/[placeId]/opengraph-image.tsx");
const siteUrlPath = resolve(testDir, "../src/lib/site-url.ts");
const apiClientPath = resolve(testDir, "../src/lib/api-client.ts");
const photoUploaderSource = readFileSync(photoUploaderPath, "utf8");
const redesignSource = readFileSync(redesignPath, "utf8");
const redesignCss = readFileSync(redesignCssPath, "utf8");
const naverMapSource = readFileSync(naverMapPath, "utf8");
const currentLocationButtonSource = readFileSync(currentLocationButtonPath, "utf8");
const naverMapLoaderSource = readFileSync(naverMapLoaderPath, "utf8");
const featureConfigSource = readFileSync(featureConfigPath, "utf8");
const adminModerationPageSource = readFileSync(adminModerationPagePath, "utf8");
const sourceHealthPanelSource = readFileSync(sourceHealthPanelPath, "utf8");
const sourceHealthCss = readFileSync(sourceHealthCssPath, "utf8");
const moderationQueueSource = readFileSync(moderationQueuePath, "utf8");
const fieldReportQueueSource = readFileSync(fieldReportQueuePath, "utf8");
const fieldReportAdminRouteSource = readFileSync(fieldReportAdminRoutePath, "utf8");
const sourceHealthAdminRouteSource = readFileSync(sourceHealthAdminRoutePath, "utf8");
const adminLoginRouteSource = readFileSync(adminLoginRoutePath, "utf8");
const homePageSource = readFileSync(homePagePath, "utf8");
const sharePostPageSource = readFileSync(sharePostPagePath, "utf8");
const sharePostOgSource = readFileSync(sharePostOgPath, "utf8");
const sharedPlacePageSource = readFileSync(sharedPlacePagePath, "utf8");
const sharedPlaceOgSource = readFileSync(sharedPlaceOgPath, "utf8");
const siteUrlSource = readFileSync(siteUrlPath, "utf8");
const apiClientSource = readFileSync(apiClientPath, "utf8");
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
  assert.match(redesignCss, /\.feedSecondaryMenu/);
});

test("shared post surfaces show the exact observation time", () => {
  assert.match(sharePostPageSource, /formatSharedPostObservedAt/);
  assert.match(sharePostPageSource, /<time dateTime=\{post\.createdAt\}>제보/);
  assert.match(sharePostPageSource, /post\.createdAt/);
  assert.match(sharePostOgSource, /formatSharedPostObservedAt/);
  assert.match(sharePostOgSource, /post\.createdAt/);
  assert.match(sharePostPageSource, /isPostExpired\(post\.expiresAt\)/);
  assert.match(sharePostPageSource, /현재 방문 판단에 사용되지 않습니다/);
  assert.match(sharePostOgSource, /지난 제보/);
});

test("home and map surfaces stay focused on the visit-decision MVP path", () => {
  assert.match(redesignSource, /const feedTabLabels = \["전체", "내 주변", "관광지", "주차"\] as const;/);
  assert.match(redesignSource, /challenges\.slice\(0, 2\)/);
  assert.match(redesignSource, /hashtags\.slice\(0, 4\)/);
  assert.match(redesignSource, /공식 현재 날씨/);
  assert.match(redesignSource, /signal\.dimension === "weather"/);
  assert.match(redesignSource, /const homeCategoryOptions = \[/);
  assert.match(redesignSource, /\.slice\(0, 5\)/);
  assert.match(redesignSource, /title="지금 확인할 장소"/);
  assert.match(redesignSource, /className=\{styles\.nearbyMapButton\}/);
  assert.match(naverMapSource, /MAP_KEY_MISSING/);
  assert.match(naverMapSource, /MAP_AUTH_FAILED/);
  assert.match(naverMapSource, /MAP_TIMEOUT/);
  assert.match(naverMapSource, /MAP_RESOURCE_FAILED/);
  assert.match(naverMapSource, /지도 다시 시도/);
  assert.match(naverMapSource, /const transientMapFailureReasons = new Set<MapFailureReason>\(\["sdk", "resource", "timeout"\]\)/);
  assert.match(naverMapSource, /const automaticRetryUsedRef = useRef\(false\)/);
  assert.match(naverMapSource, /setFailureReason\(null\)/);
  assert.match(naverMapLoaderSource, /script\.dataset\.silsiganLoadState = "failed"/);
  assert.match(naverMapLoaderSource, /activeScript\?\.remove\(\)/);
  assert.match(naverMapLoaderSource, /existing\.remove\(\)/);
  assert.match(redesignSource, /title="지도 화면 안 TOP 10"/);
  assert.doesNotMatch(redesignSource, /title="전국 TOP 10"/);
  assert.doesNotMatch(redesignSource, /regionLabel\(/);
  assert.doesNotMatch(redesignSource, /onGoMapWithFilter/);
});

test("home leads with a concise visit decision and exposes live-source freshness", () => {
  const homeScreen = sourceBetween(redesignSource, "function HomeScreen({", "function SearchScreen");

  assert.match(homeScreen, /출발 전,\s*<br \/>지금 상황만 확인하세요\./);
  assert.match(homeScreen, /날씨·인파·대기·주차를 한 화면에서 보고 10초 안에 결정해요\./);
  assert.match(homeScreen, /오래됐거나 근거가 없는 정보는 추천에 쓰지 않아요\./);
  assert.match(redesignSource, /const currentPlaceStatuses = useMemo/);
  assert.match(redesignSource, /cloudflareApiUrl\("\/api\/sources"\)/);
  assert.match(homeScreen, /placeStatuses\[place\.id\] \?\? null/);
  assert.match(homeScreen, /dataMode === "live" \? visitDecisionShortLabel\(decisionStatus\) : place\.signal/);
  assert.match(homeScreen, /source\.activationStatus === "active"/);
  assert.match(homeScreen, /primarySignal\.sourceName/);
  assert.match(homeScreen, /formatObservedAt\(primarySignal\.observedAt\)/);
  assert.match(homeScreen, /formatConfidence\(primarySignal\.confidenceScore\)/);
  assert.match(homeScreen, /formatExpiryHint\(primarySignal\.expiresAt\)/);
  assert.match(redesignSource, /currentPlaceStatus\(status, freshnessNowMs\)/);
  assert.match(redesignSource, /nextExpiryDelay\(expiringRecords, freshnessNowMs\)/);
  assert.match(redesignSource, /setSourcePlaces\(apiPlaces\)/);
  assert.match(redesignSource, /setPlaceStatuses\(apiPlaceStatuses\)/);
  assert.match(redesignCss, /\.homeDecisionHero/);
  assert.match(redesignCss, /\.homePlaceEvidence/);
  assert.match(redesignCss, /\.liveReportOpen/);
  assert.match(redesignCss, /grid-template-columns: 92px minmax\(0, 1fr\)/);
  assert.match(redesignSource, /체험용 샘플/);
  assert.match(redesignSource, /사진 출처/);
  assert.match(homeScreen, /현재 위치 주변/);
  assert.match(homeScreen, /현재 위치로 주변 장소 정렬/);
  assert.match(homeScreen, /현재 위치에서 \{place\.distance\}/);
});

test("home weather stays scoped to the nearest available place", () => {
  const homeScreen = sourceBetween(redesignSource, "function HomeScreen({", "function SearchScreen");

  assert.match(homeScreen, /const weatherPlaces = useMemo\(/);
  assert.match(homeScreen, /distanceMeters\(currentLocation, \{ latitude: left\.latitude, longitude: left\.longitude \}\)/);
  assert.match(homeScreen, /placeStatuses\[place\.id\]\?\.currentSignals/);
  assert.match(homeScreen, /signal\.sourceType === "official_live" \|\| signal\.sourceType === "official_periodic"/);
  assert.doesNotMatch(homeScreen, /signal\.sourceType\.startsWith\("official_"\)/);
  assert.doesNotMatch(homeScreen, /Object\.values\(placeStatuses\)\.flatMap/);
});

test("map and search place cards consume the same current Worker decision as home and detail", () => {
  assert.match(redesignSource, /mapPlaces\(sourcePlaces, reports, questions, freshnessNowMs, placeStatuses, mapCurrentLocation\)/);
  const mapScreen = sourceBetween(redesignSource, "function MapScreen", "function PlaceScreen");
  assert.match(redesignSource, /freshnessNowMs=\{freshnessNowMs\}/);
  assert.match(mapScreen, /const currentDetailPosts = detailPosts\.filter\(\(post\) => post\.isSample \|\| isCurrentPost\(post\)\)/);
  assert.match(mapScreen, /const currentDetailReports = detailReports\.filter\(\(report\) => report\.isSample \|\| hasCurrentExpiry\(report, freshnessNowMs\)\)/);
  assert.match(mapScreen, /지난 제보 ·/);
  assert.match(mapScreen, /현재 유효한 제보가 없어 지난 제보만 보여드려요\./);
  assert.match(redesignSource, /Boolean\(currentLocation\) && distanceKmFromLabel\(place\?\.distance\) <= 5/);
  assert.match(redesignSource, /const liveStatus = currentPlaceStatus\(placeStatuses\[place\.id\], nowMs\)/);
  assert.match(redesignSource, /const liveFields = mapLiveStatusToPlaceFields\(liveStatus\)/);
  assert.match(redesignSource, /const decisionSignal = liveStatus \? signalFromDecision\(liveStatus\.status\)/);
  assert.match(naverMapSource, /place\.signal === "확인 필요"/);
  assert.match(naverMapSource, /place\.signal === "혼잡 가능"/);
});

test("map screen provides an accessible map and filtered-list toggle", () => {
  const mapScreen = sourceBetween(redesignSource, "function MapScreen", "function PlaceScreen");

  assert.match(redesignSource, /type MapDisplayMode = "map" \| "list";/);
  assert.match(mapScreen, /const \[displayMode, setDisplayMode\] = useState<MapDisplayMode>\("map"\)/);
  assert.match(mapScreen, /role="group" aria-label="지도와 목록 보기 전환"/);
  assert.match(mapScreen, /지도 보기/);
  assert.match(mapScreen, /목록 보기/);
  assert.match(mapScreen, /aria-pressed=\{displayMode === "map"\}/);
  assert.match(mapScreen, /aria-pressed=\{displayMode === "list"\}/);
  assert.match(mapScreen, /displayMode === "list"/);
  assert.match(mapScreen, /title=\{`현재 조건의 장소 \$\{mapTop\.length\}곳`\}/);
  assert.match(redesignCss, /\.mapViewToggle/);
  assert.match(redesignCss, /\.mapViewToggleActive/);
});

test("map requests location on user action and keeps the granted marker visible", () => {
  const mapScreen = sourceBetween(redesignSource, "function MapScreen", "function PlaceScreen");
  const locationNoticeIndex = mapScreen.indexOf("className={styles.locationNotice}");
  const naverMapIndex = mapScreen.indexOf("<NaverMap");

  assert.match(currentLocationButtonSource, /const requestLocation = \(\) =>/);
  assert.match(currentLocationButtonSource, /navigator\.geolocation\.getCurrentPosition\(/);
  assert.match(currentLocationButtonSource, /onClick=\{requestLocation\}/);
  assert.doesNotMatch(currentLocationButtonSource, /useEffect\(/);
  assert.match(currentLocationButtonSource, /onLocation\(null\);\s*onPermissionChange\("denied"\)/);
  assert.doesNotMatch(currentLocationButtonSource, /fetch\(|localStorage|sessionStorage/);
  assert.match(currentLocationButtonSource, /aria-pressed=\{permission === "granted"\}/);
  assert.match(currentLocationButtonSource, /내 위치 표시 중/);
  assert.ok(locationNoticeIndex >= 0 && locationNoticeIndex < naverMapIndex, "location consent must appear before the map");
  assert.match(naverMapSource, /map\.setCenter\?\.\(currentLatLng\)/);
  assert.match(naverMapSource, /map\.setZoom\?\.\(14\)/);
  assert.match(naverMapSource, /naver-user-marker__label/);
  assert.match(redesignCss, /\.naver-user-marker__label/);
});

test("map markers cluster nearby places and expose a selectable place list", () => {
  assert.match(naverMapSource, /clusterMapPlaces\(placesForMap\)/);
  assert.match(naverMapSource, /data-silsigan-cluster-id/);
  assert.match(naverMapSource, /onSelectClusterRef\.current\?\.\(cluster\.places\)/);
  assert.match(naverMapSource, /가까운 장소 \$\{escapeHtml\(clusterLabel\)\} 목록 열기/);
  assert.match(naverMapSource, /naver-map__fallback-marker--cluster/);
  assert.match(redesignSource, /const \[selectedMapCluster, setSelectedMapCluster\] = useState<Place\[\] \| null>\(null\)/);
  assert.match(redesignSource, /onSelectCluster=\{setSelectedMapCluster\}/);
  assert.match(redesignSource, /aria-label="가까운 장소 목록"/);
  assert.match(redesignSource, /className=\{styles\.mapClusterChoice\}/);
  assert.match(redesignCss, /\.mapClusterPanel/);
  assert.match(redesignCss, /\.mapClusterChoice/);
  assert.match(redesignCss, /\.naver-map__fallback-marker--cluster/);
  assert.match(redesignCss, /\.silsigan-map-marker--cluster/);
});

test("saved places stay separate from saved posts and open the place detail", () => {
  assert.match(redesignSource, /savedPlaceIds: "silsigan\.savedPlaceIds\.v1"/);
  assert.match(redesignSource, /setSavedPlaceIds\(readPersistedSet\(persistedSetKeys\.savedPlaceIds\)\)/);
  assert.match(redesignSource, /persistSet\(persistedSetKeys\.savedPlaceIds, savedPlaceIds\)/);
  assert.match(redesignSource, /trackEvent\("save_place"/);
  assert.match(redesignSource, /savedPlaceIds=\{savedPlaceIds\}/);
  const placeScreen = sourceBetween(redesignSource, "function PlaceScreen({", "function ReportScreen");
  assert.match(placeScreen, /const isPlaceSaved = savedPlaceIds\.has\(place\.id\)/);
  assert.match(placeScreen, /onSavePlace\(place\)/);
  assert.match(placeScreen, /저장됨/);
  const myScreen = sourceBetween(redesignSource, "function MyScreen({", "function BottomNav");
  assert.match(myScreen, /target: "savedPlaces"/);
  assert.match(myScreen, /title="저장한 장소"/);
  assert.match(myScreen, /onOpenPlace\(place\)/);
  assert.match(myScreen, /title="저장한 게시물"/);
  assert.match(redesignCss, /\.placeSaveButton/);
  assert.match(redesignCss, /\.placeListButton/);
});

test("followed places expose a separate local alert action and navigable My list", () => {
  assert.match(redesignSource, /followedPlaceIds: "silsigan\.followedPlaceIds\.v1"/);
  assert.match(redesignSource, /const toggleFollowPlace = \(place: Place\)/);
  assert.match(redesignSource, /trackEvent\("follow_place"/);
  assert.match(redesignSource, /followedPlaceIds=\{followedPlaceIds\}/);

  const placeScreen = sourceBetween(redesignSource, "function PlaceScreen({", "function ReportScreen");
  assert.match(placeScreen, /followedPlaceIds: Set<string>/);
  assert.match(placeScreen, /const isPlaceFollowed = followedPlaceIds\.has\(place\.id\)/);
  assert.match(placeScreen, /onFollowPlace\(place\)/);
  assert.match(placeScreen, /현장 알림 받기/);
  assert.match(placeScreen, /aria-pressed=\{isPlaceFollowed\}/);

  const myScreen = sourceBetween(redesignSource, "function MyScreen({", "function BottomNav");
  assert.match(myScreen, /title="팔로우한 장소"/);
  assert.match(myScreen, /onOpenPlace\(place\)/);
  assert.match(myScreen, /placeListButton/);
  assert.match(redesignCss, /\.placePreferenceRow/);
  assert.match(redesignCss, /\.followButton \{[\s\S]*?min-height: 44px/);
});

test("place detail shares a safe place deep link and opens it from the URL", () => {
  assert.match(redesignSource, /new URLSearchParams\(window\.location\.search\)\.get\("place"\)/);
  assert.match(redesignSource, /const sharedPlace = places\.find\(\(place\) => place\.id === sharedPlaceId\)/);
  assert.match(redesignSource, /setActiveView\("place"\)/);
  assert.match(redesignSource, /window\.history\.replaceState\(null, "", window\.location\.pathname\)/);
  assert.match(redesignSource, /const shareUrl = `\$\{getSiteUrl\(\)\}\/share\/place\/\$\{encodeURIComponent\(place\.id\)\}`/);
  assert.match(redesignSource, /trackEvent\("share_place"/);
  assert.match(redesignSource, /trackEvent\("open_shared_place"/);

  const placeScreen = sourceBetween(redesignSource, "function PlaceScreen({", "function ReportScreen");
  assert.match(placeScreen, /onSharePlace: \(place: Place\) => Promise<void>/);
  assert.match(placeScreen, /onClick=\{\(\) => void onSharePlace\(place\)\}/);
  assert.match(placeScreen, /aria-label=\{`\$\{place\.name\} 공유`\}/);
  assert.match(placeScreen, /<Share2 size=\{17\} \/>/);
  assert.match(redesignCss, /\.placeActionGroup/);
});

test("place share route renders a neutral current-state handoff and has a matching OG route", () => {
  assert.match(sharedPlacePageSource, /findSharedPlaceForRequest\(placeId\)/);
  assert.match(sharedPlacePageSource, /notFound\(\)/);
  assert.match(sharedPlacePageSource, /#실시간 장소 공유 카드/);
  assert.match(sharedPlacePageSource, /현재 상태는 앱에서 출처와 관측 시각을 확인한 뒤 판단할 수 있습니다/);
  assert.match(sharedPlacePageSource, /앱에서 현재 상태 확인/);
  assert.match(sharedPlacePageSource, /const appPath = `\/\?place=\$\{encodeURIComponent\(place\.id\)\}&from=share`/);
  assert.match(sharedPlacePageSource, /href={appPath}/);
  assert.match(sharedPlacePageSource, /<span>{sharePath}<\/span>/);
  assert.match(sharedPlacePageSource, /샘플 미리보기/);
  assert.match(sharedPlacePageSource, /const imageUrl = `\$\{shareUrl\}\/opengraph-image`/);
  assert.match(sharedPlaceOgSource, /sharedPlaceFallbackImagePath\(placeId\)/);
  assert.match(sharedPlaceOgSource, /status: 307/);
});

test("share URLs prefer the current browser origin over the default site host", () => {
  assert.match(siteUrlSource, /typeof window !== "undefined"/);
  assert.match(siteUrlSource, /window\.location\.origin/);
  assert.match(siteUrlSource, /window\.location\.origin !== "null"/);
  assert.match(siteUrlSource, /NEXT_PUBLIC_SITE_URL \?\? "https:\/\/silsigan\.pages\.dev"/);
});

test("place deep links expose neutral metadata and a fail-closed OG image", () => {
  assert.match(homePageSource, /export async function generateMetadata/);
  assert.match(homePageSource, /findSharedPlace\(placeId\)/);
  assert.match(homePageSource, /\/share\/place\/\$\{encodeURIComponent\(place\.id\)\}\/opengraph-image/);
  assert.match(sharedPlaceOgSource, /sharedPlaceFallbackImagePath\(placeId\)/);
  assert.match(sharedPlaceOgSource, /if \(!imagePath\) \{/);
  assert.match(sharedPlaceOgSource, /notFound()/);
  assert.match(sharedPlaceOgSource, /"cache-control": "public, max-age=300"/);
  assert.doesNotMatch(sharedPlaceOgSource, /사람 .*혼잡|주차 .*만차|줄 .*김/);
});

test("insufficient place status uses a neutral tone instead of looking normal", () => {
  assert.match(redesignSource, /type StatusTone = "calm" \| "normal" \| "busy" \| "danger" \| "unknown";/);
  assert.match(redesignSource, /: hasCurrentReportObservation \? toneFromStatus\(crowdLevel, parkingStatus\) : "unknown"/);
  assert.match(redesignSource, /if \(status === "insufficient"\) return "unknown";/);
  assert.match(redesignSource, /if \(tone === "unknown"\) return "정보 부족";/);
  assert.match(redesignCss, /\.unknown \{[\s\S]*?#94a3b8/);
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
  assert.match(photoUploaderSource, /image\/heic,image\/heif/);
  assert.match(photoUploaderSource, /photoInputMimeType/);
  assert.match(photoUploaderSource, /photoOutputMimeType/);
  assert.match(photoUploaderSource, /HEIC는 업로드 전에 JPEG로 변환됩니다/);
  assert.match(photoUploaderSource, /전송 전에 1MB 이하로/);
  assert.match(photoUploaderSource, /이 브라우저에서 HEIC\/HEIF를 변환하지 못했습니다/);
  assert.match(photoUploaderSource, /uploadEnabled = true/);
  assert.match(photoUploaderSource, /disabled=\{busy \|\| !uploadEnabled\}/);
  assert.match(photoUploaderSource, /사진 서버 준비 중/);
  assert.match(redesignSource, /photoUploadReady=\{cloudflareApiConfigured && photoUploadsEnabled\}/);
  assert.match(redesignSource, /setPhotoUploadsEnabled\(runtimeConfig\.costControls\?\.photoUploadsEnabled === true\)/);
  assert.match(redesignSource, /uploadEnabled=\{photoUploadReady\}/);
  assert.doesNotMatch(redesignSource, /className=\{`\$\{styles\.feedPhoto\} \$\{styles\[place\.tone\]\}`\}/);
});

test("sample content is excluded from live status and duplicate photo counting", () => {
  assert.match(redesignSource, /const currentReports = latestReports\.filter\(\(report\) => !report\.isSample && hasCurrentExpiry\(report, nowMs\)\)/);
  assert.match(redesignSource, /\.filter\(\(report\) => report\.hasPhoto && !postIds\.has\(report\.id\)\)/);
  assert.match(redesignSource, /const latestReportEvidence = reports\.find\(\(report\) => !report\.isSample && hasCurrentExpiry\(report, freshnessNowMs\)\) \?\? null/);
  assert.match(redesignSource, /reportCount=\{comments\.length\}/);
  assert.match(redesignSource, /const safePhotoUrl = safeHttpUrl\(photoUrl\)/);
  assert.match(redesignSource, /isSample \? "체험용 샘플" : post\.locationVerified \? "현장 인증" : "상태 제보"/);
  assert.match(redesignSource, /function isExpiredPost\(post/);
  assert.match(redesignSource, /이 제보는 만료되어 현재 판단에 사용하지 않아요/);
  assert.match(redesignSource, /isExpiredPost\(post\) \? "지난 제보" : "최근 제보"/);
  assert.match(redesignSource, /formatObservedAt\(post\.createdAt\)/);
  const placeScreen = sourceBetween(redesignSource, "function PlaceScreen({", "function ReportScreen");
  assert.match(placeScreen, /const currentPostCount = posts\.filter\(\(post\) => post\.isSample \|\| isCurrentPost\(post\)\)\.length/);
  assert.match(placeScreen, /const currentReportCount = reports\.filter\(\(report\) => report\.isSample \|\| hasCurrentExpiry\(report, freshnessNowMs\)\)\.length/);
  assert.match(redesignCss, /\.verificationExpired/);
});

test("mobile controls stay tappable and sample activity never becomes user reputation", () => {
  assert.match(redesignCss, /\.iconButton \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  assert.match(redesignCss, /\.realMapFrame :global\(\.silsigan-map-marker\) \{[\s\S]*?height: 44px;/);
  assert.match(naverMapSource, /new maps\.Size\(96, 44\)/);
  assert.match(redesignSource, /aria-pressed=\{value === option\}/);
  assert.match(redesignSource, /const timeoutId = window\.setTimeout\(\(\) => setToast\(""\), 3_500\)/);
  assert.match(redesignCss, /\.mapToolRow button \{[\s\S]*?min-height: 44px;/);
  assert.match(redesignCss, /\.mapSelectedActions button \{[\s\S]*?min-height: 44px;/);
  assert.match(redesignSource, /const verifiedReports = 0;/);
  assert.match(redesignSource, /myReports=\{myReports\}/);
  assert.match(redesignSource, /공개 제보는 내 기록으로 계산하지 않습니다\./);
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

test("search empty states keep users moving to map or upload", () => {
  const searchScreen = sourceBetween(redesignSource, "function SearchScreen", "function MapScreen");

  assert.match(searchScreen, /fetchJsonWithTimeout<NaverLocalSearchPayload>/);
  assert.match(searchScreen, /signal: controller\.signal/);
  assert.match(searchScreen, /const fallbackUploadPlace = matchedPlaces\[0\] \?\? places\[0\]/);
  assert.match(searchScreen, /아직 검색어와 맞는 최근 사진이 없습니다\./);
  assert.match(searchScreen, /지도에서 찾기/);
  assert.match(searchScreen, /지금컷 추가/);
  assert.match(searchScreen, /앱 안 지도에서 보기/);
  assert.match(searchScreen, /인기 장소 지금컷 추가/);
  assert.match(searchScreen, /관련 장소 보기/);
  assert.match(searchScreen, /해시태그로 지금컷 올리기/);
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
});

test("global no-data state offers search and map recovery actions", () => {
  const noDataState = sourceBetween(redesignSource, 'activeView === "home" && dataMode !== "unavailable"', 'activeView === "upload"');

  assert.match(noDataState, /title="아직 이 지역 제보가 없습니다"/);
  assert.match(noDataState, /검색으로 넓히기/);
  assert.match(noDataState, /setActiveView\("search"\)/);
  assert.match(noDataState, /지도에서 다른 지역 보기/);
  assert.match(noDataState, /setActiveView\("map"\)/);
});

test("unavailable data uses an error recovery state instead of a regional empty claim", () => {
  const unavailableState = sourceBetween(redesignSource, 'activeView === "home" && dataMode === "unavailable"', 'title="아직 이 지역 제보가 없습니다"');

  assert.match(unavailableState, /title="실시간 정보를 불러오지 못했습니다"/);
  assert.match(unavailableState, /현재 상태를 판단할 수 없습니다/);
  assert.match(unavailableState, /다시 시도/);
  assert.match(unavailableState, /void loadData\(\)/);
  assert.match(unavailableState, /지도에서 다른 지역 보기/);
});

test("upload navigation keeps a no-place report entry point usable", () => {
  assert.match(redesignSource, /activeView === "home" && dataMode !== "unavailable" && places\.length === 0/);
  assert.match(redesignSource, /activeView === "upload" && !selectedPlace/);
  assert.match(redesignSource, /제보할 장소를 먼저 선택해 주세요/);
  assert.match(redesignSource, /장소 검색하기/);
  assert.match(redesignSource, /지도에서 선택하기/);
});

test("runtime truth never promotes missing production data to live or fallback content", () => {
  const loadData = sourceBetween(redesignSource, "const loadData = useCallback", "useEffect(() => {");

  assert.match(redesignSource, /useState<DataMode>\("unavailable"\)/);
  assert.match(loadData, /!cloudflareApiConfigured && process\.env\.NODE_ENV === "production"/);
  assert.match(loadData, /실시간 API가 설정되지 않아 운영 데이터를 표시할 수 없습니다\./);
  assert.match(loadData, /!isRuntimeDataModeAllowed\(process\.env\.NODE_ENV, runtimeConfig\.dataMode\)/);
  assert.match(loadData, /shouldClearTruthBearingDataOnLoadFailure\(process\.env\.NODE_ENV\)/);
  assert.match(loadData, /clearTruthBearingData\(\);\s*setDataMode\("unavailable"\);/);
  assert.match(loadData, /운영 환경에서는 확인된 실시간 데이터만 표시할 수 있습니다\./);
  assert.match(redesignSource, /async function fetchWorkerStatusesForPlaces[\s\S]*fetchJsonWithTimeout<CloudflarePlaceStatus>/);
  assert.match(loadData, /setDataMode\(runtimeConfig\.dataMode === "live" \? "live" : "sample"\)/);
  assert.match(loadData, /setDataMode\("unavailable"\)/);
  assert.doesNotMatch(loadData, /setDataMode\("live"\)/);
  assert.doesNotMatch(redesignSource, /createInitialFallbackDataset/);
});

test("background refresh stays within the free Worker request budget", () => {
  assert.match(redesignSource, /const backgroundRefreshIntervalMs = 10 \* 60_000;/);
  assert.match(redesignSource, /const workerPhotoPlaceScopeLimit = 5;/);
  assert.match(redesignSource, /document\.visibilityState !== "visible"/);
  assert.match(redesignSource, /document\.addEventListener\("visibilitychange", refreshVisibleData\)/);
  assert.match(redesignSource, /document\.removeEventListener\("visibilitychange", refreshVisibleData\)/);
  assert.doesNotMatch(redesignSource, /}, 30_000\);/);
});

test("public GET requests avoid unnecessary CORS preflight headers", () => {
  assert.match(apiClientSource, /if \(init\?\.body && !\(init\.body instanceof FormData\)/);
  assert.match(apiClientSource, /const attachAnonymousIdentity = requestNeedsAnonymousIdentity\(input, method\)/);
  assert.match(apiClientSource, /pathname === "\/api\/comments"/);
  assert.match(apiClientSource, /pathname\.startsWith\("\/api\/my-"\)/);
  assert.match(apiClientSource, /if \(attachAnonymousIdentity\) \{\s*persistAnonymousId/);
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
  assert.match(redesignSource, /featureFlags\.QNA_ENABLED &&/);
  assert.match(redesignSource, /featureFlags\.REWARDS_ENABLED && earned > 0/);
  assert.match(redesignSource, /socialFeedEnabled=\{featureFlags\.SOCIAL_FEED_ENABLED\}/);
  assert.match(redesignSource, /\{socialFeedEnabled && <section/);
  assert.match(redesignSource, /\{rewardsEnabled && <section/);
  assert.match(redesignSource, /\{qnaEnabled && <AnswerableQuestions/);
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
  assert.match(submitReport, /attachedReportPhotoId && attachedReportPhotoPlaceId === selectedPlace\.id/);
  assert.match(submitReport, /\{ photoId: attachedReportPhotoId \}/);
  assert.doesNotMatch(submitReport, /cloudflareApiUrl\("\/api\/posts"\)/);
});

test("report photo ids stay tied to the selected place and resolve through the Worker file route", () => {
  const uploadPhoto = sourceBetween(redesignSource, "const uploadPlacePhoto = async", "const clickPlacePhoto = async");
  const mapReports = sourceBetween(redesignSource, "function mapReports(", "function mapMyReports(");

  assert.match(uploadPhoto, /setAttachedReportPhotoId\(result\.photo\.id\)/);
  assert.match(uploadPhoto, /setAttachedReportPhotoPlaceId\(place\.id\)/);
  assert.match(uploadPhoto, /cloudflareApiUrl\(ticket\.uploadUrl\)/);
  assert.match(uploadPhoto, /body: photo\.blob/);
  assert.doesNotMatch(uploadPhoto, /imageBase64/);
  assert.match(redesignSource, /photoUrlForId\?\.\(report\.photoId\)/);
  assert.match(mapReports, /const hasPhoto = Boolean\(photoUrl \|\| report\.photoId\)/);
  assert.match(redesignSource, /attachedReportPhotoPlaceId && attachedReportPhotoPlaceId !== place\.id/);
  assert.match(redesignSource, /\/api\/photos\/\$\{encodeURIComponent\(photoId\)\}\/file/);
  assert.match(redesignSource, /setAttachedReportPhotoId\(null\);\s*setAttachedReportPhotoPlaceId\(null\);/);
});

test("live place status keeps missing dimensions unknown instead of inventing normal values", () => {
  const mapPlacesBlock = sourceBetween(redesignSource, "function mapPlaces(", "function mapLiveStatusToPlaceFields");

  assert.match(redesignSource, /type PlaceCrowdLevel = CrowdLevel \| "unknown";/);
  assert.match(redesignSource, /type PlaceLineStatus = LineStatus \| "unknown";/);
  assert.match(redesignSource, /type PlaceWeatherFeel = WeatherFeel \| "unknown";/);
  assert.match(mapPlacesBlock, /liveFields\?\.crowdLevel \?\? "unknown"/);
  assert.match(mapPlacesBlock, /liveFields\?\.lineStatus \?\? "unknown"/);
  assert.match(mapPlacesBlock, /liveFields\?\.weatherFeel \?\? "unknown"/);
  assert.doesNotMatch(mapPlacesBlock, /liveFields\?\.crowdLevel \?\? "normal"/);
  assert.doesNotMatch(mapPlacesBlock, /liveFields\?\.lineStatus \?\? "none"/);
  assert.doesNotMatch(mapPlacesBlock, /liveFields\?\.weatherFeel \?\? "good"/);
  assert.match(naverMapSource, /crowdLevel: "quiet" \| "normal" \| "busy" \| "packed" \| "unknown"/);
});

test("admin moderation exposes a server-gated field-report review queue", () => {
  assert.match(adminModerationPageSource, /listWorkerFieldReports/);
  assert.match(adminModerationPageSource, /fieldReportQueueState/);
  assert.match(adminModerationPageSource, /loadLocalModerationData\(isProduction\)/);
  assert.match(adminModerationPageSource, /showLocalDemoQueue=\{!isProduction\}/);
  assert.match(fieldReportAdminRouteSource, /handleAdminWorkerFieldReportsGet/);
  assert.match(fieldReportAdminRouteSource, /handleAdminWorkerFieldReportsPost/);
  assert.ok(fieldReportQueueSource.includes("/api/admin/field-reports"));
  assert.match(fieldReportQueueSource, /승인/);
  assert.match(fieldReportQueueSource, /반려/);
  assert.match(fieldReportQueueSource, /승인 전에는 현장 제보가 공개 상태와 현재 판단에 반영되지 않습니다/);
  assert.doesNotMatch(fieldReportQueueSource, /anonymousUserId/);
  assert.doesNotMatch(fieldReportQueueSource, /rawLatitude|rawLongitude|photoUrl/);
  assert.match(adminLoginRouteSource, /status: 303/);
  assert.match(adminLoginRouteSource, /Location: "\/admin\/moderation\/posts"/);
});

test("admin moderation exposes a fail-closed source health panel", () => {
  assert.match(adminModerationPageSource, /listWorkerSourceHealth/);
  assert.match(adminModerationPageSource, /sourceHealthState/);
  assert.match(adminModerationPageSource, /<SourceHealthPanel state=\{sourceHealthState\} items=\{sourceHealth\} sources=\{sources\} \/>/);
  assert.match(sourceHealthAdminRouteSource, /handleAdminWorkerSourceHealthGet/);
  assert.match(sourceHealthPanelSource, /데이터 출처 상태/);
  assert.match(sourceHealthPanelSource, /정상/);
  assert.match(sourceHealthPanelSource, /지연/);
  assert.match(sourceHealthPanelSource, /중단/);
  assert.match(sourceHealthPanelSource, /출처 권리·활성화 상태/);
  assert.match(sourceHealthPanelSource, /승인되지 않은 출처는 운영 판단에 사용하지 않습니다\./);
  assert.match(sourceHealthPanelSource, /Worker 운영 토큰 또는 API URL이 설정되지 않았습니다\./);
  assert.match(sourceHealthPanelSource, /현재 정보 부족으로 운영하세요\./);
  assert.doesNotMatch(sourceHealthPanelSource, /SILSIGAN_WORKER_ADMIN_TOKEN|x-silsigan-admin-token|sourceId/);
  assert.match(sourceHealthCss, /\.sourceHealthList/);
  assert.match(sourceHealthCss, /\.sourceHealthStatusDown/);
  assert.match(sourceHealthCss, /\.sourceHealthEmpty/);
  assert.match(sourceHealthCss, /\.sourceHealthList \{/);
  assert.match(sourceHealthCss, /\.sourceRegistryList/);
  assert.match(sourceHealthCss, /\.sourceRegistryActivationAwaiting_rights/);
});

test("admin Worker report actions fail closed and restore the queue on a bad response", () => {
  assert.match(moderationQueueSource, /pendingWorkerReportId/);
  assert.match(moderationQueueSource, /const response = await fetch\("\/api\/admin\/moderation\/reports"/);
  assert.match(moderationQueueSource, /!response\.ok \|\| !payload\.success \|\| !result/);
  assert.match(moderationQueueSource, /setWorkerReports\(previousReports\)/);
  assert.match(moderationQueueSource, /신고 큐 항목을 복원했습니다/);
  assert.match(moderationQueueSource, /disabled=\{pendingWorkerReportId === report\.id\}/);
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

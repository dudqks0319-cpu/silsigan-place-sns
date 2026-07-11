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
const naverMapLoaderPath = resolve(testDir, "../src/lib/naver-map-loader.ts");
const featureConfigPath = resolve(testDir, "../packages/contracts/src/config.ts");
const photoUploaderSource = readFileSync(photoUploaderPath, "utf8");
const redesignSource = readFileSync(redesignPath, "utf8");
const redesignCss = readFileSync(redesignCssPath, "utf8");
const naverMapSource = readFileSync(naverMapPath, "utf8");
const naverMapLoaderSource = readFileSync(naverMapLoaderPath, "utf8");
const featureConfigSource = readFileSync(featureConfigPath, "utf8");
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

test("home and map surfaces stay focused on the visit-decision MVP path", () => {
  assert.match(redesignSource, /const feedTabLabels = \["전체", "내 주변", "관광지", "주차"\] as const;/);
  assert.match(redesignSource, /challenges\.slice\(0, 2\)/);
  assert.match(redesignSource, /hashtags\.slice\(0, 4\)/);
  assert.match(redesignSource, /공식 현재 날씨/);
  assert.match(redesignSource, /signal\.dimension === "weather" && signal\.sourceType\.startsWith\("official_"\)/);
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
  assert.match(photoUploaderSource, /iPhone HEIC/);
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
  assert.match(redesignCss, /\.iconButton \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  assert.match(redesignCss, /\.realMapFrame :global\(\.silsigan-map-marker\) \{[\s\S]*?height: 44px;/);
  assert.match(naverMapSource, /new maps\.Size\(96, 44\)/);
  assert.match(redesignSource, /aria-pressed=\{value === option\}/);
  assert.match(redesignSource, /const timeoutId = window\.setTimeout\(\(\) => setToast\(""\), 3_500\)/);
  assert.match(redesignCss, /\.mapToolRow button \{[\s\S]*?min-height: 44px;/);
  assert.match(redesignCss, /\.mapSelectedActions button \{[\s\S]*?min-height: 44px;/);
  assert.match(redesignSource, /const verifiedReports = 0;/);
  assert.match(redesignSource, /reports=\{\[\]\}/);
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
  const noDataState = sourceBetween(redesignSource, 'title="아직 이 지역 제보가 없습니다"', 'activeView === "home"');

  assert.match(noDataState, /검색으로 넓히기/);
  assert.match(noDataState, /setActiveView\("search"\)/);
  assert.match(noDataState, /지도에서 다른 지역 보기/);
  assert.match(noDataState, /setActiveView\("map"\)/);
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
  assert.doesNotMatch(submitReport, /cloudflareApiUrl\("\/api\/posts"\)/);
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

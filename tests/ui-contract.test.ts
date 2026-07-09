import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const photoUploaderPath = resolve(testDir, "../src/components/silsigan/PhotoUploader.tsx");
const redesignPath = resolve(testDir, "../src/components/silsigan/SilsiganRedesign.tsx");
const redesignCssPath = resolve(testDir, "../src/components/silsigan/SilsiganRedesign.module.css");
const photoUploaderSource = readFileSync(photoUploaderPath, "utf8");
const redesignSource = readFileSync(redesignPath, "utf8");
const redesignCss = readFileSync(redesignCssPath, "utf8");

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

test("home and map surfaces stay focused on the photo-first MVP path", () => {
  assert.match(redesignSource, /const feedTabLabels = \["전체", "내 주변", "관광지", "주차"\] as const;/);
  assert.match(redesignSource, /challenges\.slice\(0, 2\)/);
  assert.match(redesignSource, /hashtags\.slice\(0, 4\)/);
  assert.match(redesignSource, /places\.slice\(0, 3\)/);
  assert.match(redesignSource, /title="지도 화면 안 TOP 10"/);
  assert.doesNotMatch(redesignSource, /title="전국 TOP 10"/);
  assert.doesNotMatch(redesignSource, /regionLabel\(/);
  assert.doesNotMatch(redesignSource, /onGoMapWithFilter/);
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

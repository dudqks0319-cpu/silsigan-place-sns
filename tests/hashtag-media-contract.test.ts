import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const workerSource = source("../workers/api/src/index.ts");
const redesignSource = source("../src/components/silsigan/SilsiganRedesign.tsx");

test("hashtag media query applies one public-photo eligibility contract", () => {
  const query = workerSource.slice(
    workerSource.indexOf("async function listD1FieldReportHashtags"),
    workerSource.indexOf("function mergeHashtagRecords"),
  );

  assert.match(query, /fp\.moderation_status = 'approved'/);
  assert.match(query, /pe\.moderation_status = 'approved'/);
  assert.match(query, /pe\.expires_at > \$\{D1_NOW_SQL\}/);
  assert.match(query, /pl\.is_active = 1/);
  assert.match(query, /pl\.coordinate_status = 'verified'/);
  assert.match(query, /ph\.status = 'ready'/);
  assert.match(query, /ph\.hidden_at IS NULL/);
  assert.match(query, /ph\.deleted_at IS NULL/);
  assert.match(query, /COUNT\(DISTINCT pe\.place_id\) AS activePlaceCount/);
  assert.match(query, /COUNT\(DISTINCT ph\.id\) AS recentPhotoCount/);
  assert.match(query, /MAX\(pe\.created_at\) AS latestObservedAt/);
});

test("hashtag detail pagination is server-side and deterministic", () => {
  const route = workerSource.slice(
    workerSource.indexOf('path === "/api/hashtags"'),
    workerSource.indexOf('path === "/api/questions"'),
  );
  const handler = workerSource.slice(
    workerSource.indexOf("async function listHashtags"),
    workerSource.indexOf("async function listQuestions"),
  );

  assert.match(route, /listHashtags\(url, env\)/);
  assert.match(handler, /searchParams\.get\("name"\)/);
  assert.match(handler, /searchParams\.get\("regionId"\)/);
  assert.match(handler, /searchParams\.get\("placeId"\)/);
  assert.match(handler, /searchParams\.get\("hasPhoto"\)/);
  assert.match(handler, /searchParams\.get\("activeOnly"\)/);
  assert.match(handler, /searchParams\.get\("sort"\)/);
  assert.match(handler, /searchParams\.get\("cursor"\)/);
  assert.match(workerSource, /nextCursor/);
  assert.match(workerSource, /recentMedia/);
});

test("hashtag click fetches the selected tag media instead of filtering the first 100 reports", () => {
  const selectHashtag = redesignSource.slice(
    redesignSource.indexOf("const selectHashtag = async"),
    redesignSource.indexOf("const clearHashtagFilter"),
  );

  assert.match(selectHashtag, /buildHashtagApiPath\(\{/);
  assert.match(selectHashtag, /name: hashtagName/);
  assert.match(selectHashtag, /hasPhoto: true/);
  assert.match(selectHashtag, /activeOnly: true/);
  assert.match(selectHashtag, /sort: "recent"/);
  assert.match(selectHashtag, /recentMedia/);
  assert.match(selectHashtag, /setHashtagMediaNextCursor\(selectedHashtag\?\.nextCursor \?\? null\)/);
  assert.doesNotMatch(selectHashtag, /\/api\/posts/);
});

test("hashtag latest-photo pagination appends the next cursor page", () => {
  const loadMoreHashtag = redesignSource.slice(
    redesignSource.indexOf("const loadMoreHashtagMedia = async"),
    redesignSource.indexOf("const clearHashtagFilter"),
  );

  assert.match(loadMoreHashtag, /cursor: hashtagMediaNextCursor/);
  assert.match(loadMoreHashtag, /setHashtagMediaReports\(\(current\) => mergeReportCollections\(current, nextReports\)\)/);
  assert.match(loadMoreHashtag, /setHashtagMediaNextCursor\(selectedHashtag\?\.nextCursor \?\? null\)/);
  assert.match(loadMoreHashtag, /setHashtagMediaLoadingMore\(false\)/);
});

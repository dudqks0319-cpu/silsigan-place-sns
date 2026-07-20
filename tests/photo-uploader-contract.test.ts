import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const photoUploaderSource = readFileSync(
  resolve(testDir, "../src/components/silsigan/PhotoUploader.tsx"),
  "utf8",
);

test("photo tiles describe views without claiming a field-status confirmation", () => {
  assert.match(photoUploaderSource, /사진 조회수를 반영하는 중/);
  assert.match(photoUploaderSource, /사진 조회수가 반영됐습니다\./);
  assert.match(photoUploaderSource, /aria-label=\{photoViewLabel\(photo\)\}/);
  assert.match(photoUploaderSource, /`\$\{photo\.label\} 사진 보기\. \$\{photo\.meta\}`/);
  assert.doesNotMatch(photoUploaderSource, /사진 확인을 반영/);
  assert.doesNotMatch(photoUploaderSource, /aria-label=\{`\$\{photo\.label\} 사진 확인`\}/);
});

test("photo tiles expose meaningful image text and keep unsupported status votes unavailable", () => {
  assert.match(photoUploaderSource, /role="img"/);
  assert.match(photoUploaderSource, /aria-label=\{photoAltText\(photo\)\}/);
  assert.match(
    photoUploaderSource,
    /사진 보기는 조회수만 기록하며 현재 상태 확인으로 처리되지 않습니다\./,
  );
  assert.match(
    photoUploaderSource,
    /상태 확인은 제보 카드에서 할 수 있습니다\./,
  );
  assert.doesNotMatch(photoUploaderSource, />현재도 맞아요<|>지금은 달라요</);
});

test("every photo upload requires a versioned posting-rights confirmation", () => {
  assert.match(photoUploaderSource, /const \[rightsConfirmed, setRightsConfirmed\] = useState\(false\)/);
  assert.match(photoUploaderSource, /aria-label="사진 게시 권한 확인"/);
  assert.match(photoUploaderSource, /제가 촬영했거나 이 사진을 게시할 권한이 있으며/);
  assert.match(photoUploaderSource, /disabled=\{!uploadEnabled \|\| !rightsConfirmed\}/);
  assert.match(photoUploaderSource, /rightsAttested: true/);
  assert.match(photoUploaderSource, /rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION/);
  assert.match(photoUploaderSource, /setRightsConfirmed\(false\)/);
});

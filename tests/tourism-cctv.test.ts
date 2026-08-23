import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  TOURISM_CCTV_CATALOG,
  isAllowedTourismCctvUrl,
  tourismCctvForRegion,
} from "../packages/contracts/src/tourism-cctv.ts";

const expectedUrls = new Map([
  ["영일대해수욕장", "https://safecctv.pohang.go.kr/100038"],
  ["구룡포해수욕장", "https://safecctv.pohang.go.kr/100036"],
  ["호미곶해맞이광장", "https://safecctv.pohang.go.kr/100096"],
  ["용한리해수욕장", "https://safecctv.pohang.go.kr/100123"],
  ["한라산 백록담", "https://www.jeju.go.kr/tool/halla/cctv_01.html"],
  ["한라산 왕관릉", "https://www.jeju.go.kr/tool/halla/cctv_02.html"],
  ["한라산 윗세오름", "https://www.jeju.go.kr/tool/halla/cctv_03.html"],
  ["한라산 어승생악", "https://www.jeju.go.kr/tool/halla/cctv_04.html"],
]);

test("catalog contains eight verified single-camera tourism pages", () => {
  assert.equal(TOURISM_CCTV_CATALOG.length, 8);
  assert.equal(tourismCctvForRegion("gyeongbuk").length, 4);
  assert.equal(tourismCctvForRegion("jeju").length, 4);
  assert.equal(tourismCctvForRegion("busan").length, 0);

  for (const entry of TOURISM_CCTV_CATALOG) {
    assert.equal(entry.officialUrl, expectedUrls.get(entry.placeName));
    assert.equal(entry.playbackVerification, "single_camera_page");
    assert.equal(entry.integrationMode, "external_link");
    assert.equal(entry.canEmbed, false);
    assert.equal(entry.canAnalyze, false);
    assert.equal(isAllowedTourismCctvUrl(entry.officialUrl), true);
  }
});

test("URL policy rejects portals, failed cameras, media, and URL tricks", () => {
  const denied = [
    "https://coast.mof.go.kr/coastScene/coastMediaService.do",
    "https://md.kbs.co.kr/special/cctv",
    "https://rain.pohang.go.kr/Front/Camera",
    "https://www.yongpyong.co.kr/kor/skiNboard/webcam.do",
    "https://safecctv.pohang.go.kr/100054",
    "https://safecctv.pohang.go.kr/100023",
    "https://safecctv.pohang.go.kr/100020",
    "https://safecctv.pohang.go.kr/100037",
    "https://safecctv.pohang.go.kr/100021",
    "https://safecctv.pohang.go.kr/100022",
    "https://www.jeju.go.kr/tool/halla/cctv_05.html",
    "https://www.jeju.go.kr/tool/halla/cctv_01.html?camera=1",
    "https://www.jeju.go.kr.evil.test/tool/halla/cctv_01.html",
    "http://safecctv.pohang.go.kr/100038",
    "https://user:pass@safecctv.pohang.go.kr/100038",
    "https://safecctv.pohang.go.kr:444/100038",
    "https://safecctv.pohang.go.kr/100038?token=x",
    "https://safecctv.pohang.go.kr/100038#player",
    "https://safecctv.pohang.go.kr/live.m3u8",
    "https://safecctv.pohang.go.kr.evil.test/100038",
    "https://localhost/100038",
    "not-a-url",
  ];

  for (const url of denied) assert.equal(isAllowedTourismCctvUrl(url), false, url);
});

test("directory renders direct links without embedded media or portal selection UI", () => {
  const component = fs.readFileSync(
    path.join(process.cwd(), "src/components/silsigan/TourismCctvDirectory.tsx"),
    "utf8",
  );
  const screen = fs.readFileSync(
    path.join(process.cwd(), "src/components/silsigan/SilsiganRedesign.tsx"),
    "utf8",
  );
  const css = fs.readFileSync(
    path.join(process.cwd(), "src/components/silsigan/TourismCctvDirectory.module.css"),
    "utf8",
  );

  assert.match(screen, /<TourismCctvDirectory activeRegion=\{activeRegion\}/);
  assert.match(component, /activeRegion === "nationwide"\s*\? TOURISM_CCTV_CATALOG/);
  assert.match(component, /단독 CCTV 바로 보기/);
  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noopener noreferrer"/);
  assert.doesNotMatch(component, /useState|officialSelectorLabel|공식 페이지에서 선택/);
  assert.doesNotMatch(component, /<iframe|<video|fetch\(/i);
  assert.match(css, /min-height:\s*76px/);
});

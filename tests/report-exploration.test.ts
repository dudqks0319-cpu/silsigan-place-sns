import assert from "node:assert/strict";
import test from "node:test";
import { mergeReportCollections } from "../src/lib/report-exploration.ts";

test("hashtag exploration supplements reports without replacing the original collection", () => {
  const originalReports = [
    { id: "report_b", createdAt: "2026-07-19T01:00:00.000Z", body: "원본 부산 제보" },
    { id: "report_a", createdAt: "2026-07-19T00:00:00.000Z", body: "원본 서울 제보" },
  ];
  const hashtagReports = [
    { id: "report_c", createdAt: "2026-07-19T02:00:00.000Z", body: "해시태그 전용 제보" },
    { id: "report_b", createdAt: "2026-07-19T01:00:00.000Z", body: "축약된 검색 제보" },
  ];

  const merged = mergeReportCollections(originalReports, hashtagReports);

  assert.deepEqual(merged.map((report) => report.id), ["report_c", "report_b", "report_a"]);
  assert.equal(merged.find((report) => report.id === "report_b")?.body, "원본 부산 제보");
  assert.deepEqual(mergeReportCollections(originalReports, []), originalReports);
  assert.deepEqual(originalReports.map((report) => report.id), ["report_b", "report_a"]);
});

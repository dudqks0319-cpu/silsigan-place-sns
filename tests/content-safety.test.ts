import assert from "node:assert/strict";
import test from "node:test";

const { contentSafetyWarningFor } = await import(new URL("../src/components/silsigan/contentSafety.ts", import.meta.url).href);

test("content safety blocks privacy identifiers in user text", () => {
  assert.equal(contentSafetyWarningFor("지금 주차장 앞 010-1234-5678로 전화하세요"), "전화번호, 이메일, 차량번호 같은 개인정보는 올릴 수 없습니다.");
  assert.equal(contentSafetyWarningFor("차량 123가4567이 보여요"), "전화번호, 이메일, 차량번호 같은 개인정보는 올릴 수 없습니다.");
  assert.equal(contentSafetyWarningFor("문의 test@example.com"), "전화번호, 이메일, 차량번호 같은 개인정보는 올릴 수 없습니다.");
});

test("content safety blocks links and scripts in user text", () => {
  assert.equal(contentSafetyWarningFor("자세한 내용은 www.example.com"), "링크나 스크립트는 올릴 수 없습니다. 장소 상황만 짧게 남겨 주세요.");
  assert.equal(contentSafetyWarningFor("<script>alert(1)</script>"), "링크나 스크립트는 올릴 수 없습니다. 장소 상황만 짧게 남겨 주세요.");
});

test("content safety allows normal place status text", () => {
  assert.equal(contentSafetyWarningFor("공영주차장 거의 찼어요"), null);
  assert.equal(contentSafetyWarningFor("#주차만차 #노을좋음"), null);
});

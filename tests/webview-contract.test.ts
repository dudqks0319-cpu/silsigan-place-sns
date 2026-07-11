import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyWebViewNavigation,
  parseSilsiganDeepLink,
  parseWebViewBridgeRequest,
  webViewBridgeCommands,
} from "../packages/contracts/src/index.ts";

test("WebView navigation allows exact HTTPS origins and sends other HTTPS links outside", () => {
  const allowed = ["https://silsigan.example.com", "https://api.silsigan.example.com"];

  assert.equal(classifyWebViewNavigation("https://silsigan.example.com/place/a", allowed), "internal");
  assert.equal(classifyWebViewNavigation("https://api.silsigan.example.com/api/health", allowed), "internal");
  assert.equal(classifyWebViewNavigation("https://help.example.com/guide", allowed), "external");
  assert.equal(classifyWebViewNavigation("https://silsigan.example.com.evil.test", allowed), "external");
  assert.equal(classifyWebViewNavigation("http://silsigan.example.com", allowed), "blocked");
  assert.equal(classifyWebViewNavigation("javascript:alert(1)", allowed), "blocked");
});

test("WebView local HTTP navigation is available only for an explicit loopback development origin", () => {
  const allowed = ["http://127.0.0.1:3000"];

  assert.equal(classifyWebViewNavigation("http://127.0.0.1:3000", allowed), "blocked");
  assert.equal(
    classifyWebViewNavigation("http://127.0.0.1:3000/map", allowed, { allowLocalDevelopment: true }),
    "internal",
  );
  assert.equal(
    classifyWebViewNavigation("http://192.168.0.4:3000", ["http://192.168.0.4:3000"], { allowLocalDevelopment: true }),
    "blocked",
  );
});

test("WebView bridge accepts only the seven schema-validated commands", () => {
  assert.deepEqual(webViewBridgeCommands, [
    "requestLocation",
    "takePhoto",
    "selectPhoto",
    "share",
    "openSettings",
    "getAppVersion",
    "registerPushToken",
  ]);
  assert.deepEqual(parseWebViewBridgeRequest({
    requestId: "request_1234",
    command: "requestLocation",
    payload: { purpose: "field_report" },
  }), {
    requestId: "request_1234",
    command: "requestLocation",
    payload: { purpose: "field_report" },
  });
  assert.deepEqual(parseWebViewBridgeRequest({
    requestId: "request_5678",
    command: "share",
    payload: { url: "https://silsigan.example.com/place/one", text: "현장 상태" },
  }), {
    requestId: "request_5678",
    command: "share",
    payload: { url: "https://silsigan.example.com/place/one", text: "현장 상태" },
  });
});

test("WebView bridge rejects arbitrary JavaScript commands URLs and extra fields", () => {
  assert.throws(() => parseWebViewBridgeRequest({
    requestId: "request_1234",
    command: "executeJavaScript",
    payload: { script: "alert(1)" },
  }));
  assert.throws(() => parseWebViewBridgeRequest({
    requestId: "request_1234",
    command: "share",
    payload: { url: "javascript:alert(1)" },
  }));
  assert.throws(() => parseWebViewBridgeRequest({
    requestId: "request_1234",
    command: "requestLocation",
    payload: { purpose: "field_report", latitude: 35.1 },
  }));
});

test("Silsigan deep links accept only known targets and safe identifiers", () => {
  assert.deepEqual(parseSilsiganDeepLink("silsigan://home"), { target: "home" });
  assert.deepEqual(parseSilsiganDeepLink("silsigan://place/busan-gwangalli"), {
    target: "place",
    id: "busan-gwangalli",
  });
  assert.deepEqual(parseSilsiganDeepLink("silsigan://report/report_1234"), {
    target: "report",
    id: "report_1234",
  });
  assert.equal(parseSilsiganDeepLink("silsigan://admin/users"), null);
  assert.equal(parseSilsiganDeepLink("silsigan://place/../../admin"), null);
  assert.equal(parseSilsiganDeepLink("https://silsigan.example.com/place/one"), null);
});

#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { summarizeExternalStateBlockers } from "./cloudflare-external-state-check.mjs";

const DEFAULT_CONFIG_PATH = "workers/api/wrangler.jsonc";
const DEFAULT_FRONTEND_CONFIG_PATH = "wrangler.jsonc";
const DEFAULT_LEDGER_PATH = "docs/current-release-state.md";
const DEFAULT_RELEASE_LEDGER_PATH = "release-ledger.yaml";
const DEFAULT_RELEASE_STATUS_PATH = "RELEASE_STATUS.md";
const DEFAULT_UGC_MODERATION_RUNBOOK_PATH = "docs/ugc-moderation-runbook.md";
const DEFAULT_CLOUDFLARE_COST_USAGE_RUNBOOK_PATH = "docs/cloudflare-cost-usage-runbook.md";
const DEFAULT_TESTFLIGHT_REVIEW_NOTES_PATH = "docs/testflight-review-notes.md";
const DEFAULT_STORE_PRIVACY_DISCLOSURE_PATH = "docs/store-privacy-disclosure-draft.md";
const DEFAULT_REAL_DEVICE_QA_LEDGER_PATH = "docs/real-device-qa.md";
const DEFAULT_V2_DECISION_REGISTER_PATH = "docs/v2-decision-register.md";
const DEFAULT_V2_LEGAL_OPERATIONS_GATE_PATH = "docs/v2-legal-operations-gate.md";
const DEFAULT_PRIVACY_PAGE_PATH = "src/app/privacy/page.tsx";
const DEFAULT_SUPPORT_PAGE_PATH = "src/app/support/page.tsx";
const DEFAULT_TERMS_PAGE_PATH = "src/app/terms/page.tsx";
const DEFAULT_PUBLIC_ENV_PATH = ".env.example";
const MINIMUM_OPEN_NEXT_COMPATIBILITY_DATE = "2024-09-23";
const REQUIRED_LEDGER_SECTIONS = [
  "## Objective",
  "## Local Code State",
  "## Latest Local Verification",
  "## Cloudflare External State",
  "## Release Decision",
  "## Next Actions",
];
const REQUIRED_RELEASE_LEDGER_FIELDS = [
  "project",
  "candidate",
  "local_checks",
  "runtime_checks",
  "external_checks",
  "security",
  "blockers",
  "next_action",
];
const REQUIRED_RELEASE_BLOCKER_FIELDS = ["id", "severity", "status", "owner", "evidence", "due"];
const ALLOWED_RELEASE_BLOCKER_STATUSES = new Set(["open", "closed"]);
const REQUIRED_RELEASE_STATUS_SECTIONS = ["# Release Status", "## 한 줄 상태", "## 현재 후보", "## 막힌 항목", "## 다음 행동"];
const REQUIRED_UGC_MODERATION_RUNBOOK_SECTIONS = [
  "# #실시간 UGC moderation runbook",
  "## Ownership",
  "## Intake Queue",
  "## SLA",
  "## Operator Actions",
  "## Evidence And Audit",
  "## Escalation",
  "## Stop Conditions",
];
const REQUIRED_UGC_MODERATION_RUNBOOK_TOKENS = [
  "MODERATION_ALERT_WEBHOOK_URL",
  "privacy_face",
  "privacy_plate",
  "sensitive_info",
  "comment",
  "photo",
  "12h",
  "24h",
  "72h",
  "hide",
  "restore",
  "delete",
  "restrict",
];
const REQUIRED_CLOUDFLARE_COST_USAGE_RUNBOOK_SECTIONS = [
  "# #실시간 Cloudflare cost and usage runbook",
  "## Ownership",
  "## Dashboard Checks",
  "## Baseline Thresholds",
  "## Alert Rules",
  "## Evidence And Cadence",
  "## Stop Conditions",
];
const REQUIRED_CLOUDFLARE_COST_USAGE_RUNBOOK_TOKENS = [
  "R2",
  "D1",
  "Workers",
  "Durable Objects",
  "Cloudflare Images",
  "Usage & billing",
  "Billing alerts",
  "daily",
  "weekly",
  "staging",
  "production",
  "egress",
  "requests",
  "storage",
  "budget",
  "TestFlight",
  "COST_GUARD_STATE",
  "/api/admin/api-cost-guard",
  "60%",
  "70%",
  "80%",
  "reconciliation",
  "WAF",
];
const REQUIRED_TESTFLIGHT_REVIEW_NOTES_SECTIONS = [
  "# #실시간 TestFlight review notes",
  "## Beta App Description",
  "## Reviewer Instructions",
  "## Permissions",
  "## UGC Moderation",
  "## Privacy And Support URLs",
  "## Staging Evidence",
  "## Stop Conditions",
];
const REQUIRED_TESTFLIGHT_REVIEW_NOTES_TOKENS = [
  "TestFlight",
  "Cloudflare",
  "SILSIGAN_STAGING_PAGES_URL",
  "SILSIGAN_STAGING_API_BASE_URL",
  "privacy policy URL",
  "support URL",
  "location permission",
  "camera",
  "photo library",
  "UGC moderation",
  "R2",
  "D1",
  "report",
  "hide",
  "delete",
];
const REQUIRED_STORE_PRIVACY_DISCLOSURE_SECTIONS = [
  "# #실시간 App Privacy and Data Safety draft",
  "## Status And Scope",
  "## Data Inventory",
  "## Apple App Privacy",
  "## Google Play Data Safety",
  "## Native Enforcement",
  "## Console Checklist",
  "## Stop Conditions",
];
const REQUIRED_STORE_PRIVACY_DISCLOSURE_TOKENS = [
  "PrivacyInfo.xcprivacy",
  "NSPrivacyTracking=false",
  "App Store Connect",
  "Google Play Console",
  "precise location",
  "photos or videos",
  "other user content",
  "search history",
  "User ID",
  "Device ID",
  "product interaction",
  "other diagnostic data",
  "allowBackup=false",
  "dataExtractionRules",
  "tracking",
  "legal-safety",
  "real-device",
  "draft",
];
const REQUIRED_REAL_DEVICE_QA_LEDGER_SECTIONS = [
  "# #실시간 real-device QA ledger",
  "## Scope",
  "## Environment",
  "## iPhone QA Matrix",
  "## Android QA Matrix",
  "## Evidence Naming",
];
const REQUIRED_REAL_DEVICE_QA_LEDGER_TOKENS = [
  "Staging Pages URL",
  "Staging Worker API URL",
  "R2_NOT_ENABLED",
  "TestFlight build",
  "Android internal/debug build",
  "Naver map display",
  "Location allow",
  "Location deny",
  "Camera",
  "photo library",
  "Photo upload/preview",
  "Like/unlike",
  "Ranking refresh",
  "Report/moderation",
  "Crash check",
  "raw coordinates",
  "original filenames",
  "network-redacted.json",
  "known-issues.md",
];
const REQUIRED_V2_DECISION_REGISTER_SECTIONS = [
  "# #실시간 V2 의사결정 및 완료 기준",
  "## 결정 상태",
  "## 11번: 익명과 회원의 차이",
  "## 공공데이터 활성화 규칙",
  "## 완료 판정",
];
const REQUIRED_V2_DECISION_REGISTER_TOKENS = [
  "kr.silsigan.mobile",
  "SOCIAL_FEED_ENABLED=false",
  "ADS_ENABLED=false",
  "LIVE_STREAMS_ENABLED",
  "D1_0006_NOT_APPLIED",
  "영상 URL 저장·노출·중계 금지",
  "원본 사진은 보관하지 않는다",
  "익명 우선 + 선택적 회원 전환",
  "blocked-external",
];
const REQUIRED_V2_LEGAL_OPERATIONS_GATE_SECTIONS = [
  "# #실시간 V2 법무 및 운영 게이트",
  "## Ownership",
  "## Legal Review",
  "## Source Activation",
  "## Moderation Readiness",
  "## Ads Gate",
  "## Sign-Off Record",
  "## Stop Conditions",
];
const REQUIRED_V2_LEGAL_OPERATIONS_GATE_TOKENS = [
  "ADS_ENABLED=false",
  "MODERATION_ALERT_WEBHOOK_URL",
  "SILSIGAN_PRIVACY_POLICY_URL",
  "SILSIGAN_SUPPORT_URL",
  "national_cctv",
  "M6",
  "M8",
  "named reviewer",
  "blocked-external",
];
const REQUIRED_PRIVACY_PAGE_TOKENS = [
  "개인정보 처리방침",
  "위치정보",
  "raw coordinate",
  "Cloudflare D1",
  "R2",
  "EXIF/GPS",
  "원본 파일명",
  "신고",
  "delete",
  "support URL",
  "privacy policy URL",
];
const REQUIRED_SUPPORT_PAGE_TOKENS = [
  "지원 및 신고 안내",
  "TestFlight",
  "iPhone",
  "Android",
  "지도",
  "위치 권한",
  "privacy_face",
  "privacy_plate",
  "sensitive_info",
  "삭제 요청",
  "support URL",
  "privacy policy URL",
];
const REQUIRED_TERMS_PAGE_TOKENS = [
  "이용약관",
  "현장 정보의 한계",
  "사용자 콘텐츠와 권리",
  "금지되는 콘텐츠와 행위",
  "신고, 운영 조치와 이의제기",
  "위치 권한과 개인정보",
  "미성년자",
  "production",
];
const REQUIRED_POLICY_SUPPORT_URLS = {
  SILSIGAN_PRIVACY_POLICY_URL: "privacy_policy",
  SILSIGAN_SUPPORT_URL: "support",
  SILSIGAN_TERMS_URL: "terms",
};
const REQUIRED_ENV_URLS = {
  SILSIGAN_STAGING_PAGES_URL: "staging.pages",
  SILSIGAN_STAGING_API_BASE_URL: "staging.worker_api",
  SILSIGAN_PRODUCTION_PAGES_URL: "production.pages",
  SILSIGAN_PRODUCTION_API_BASE_URL: "production.worker_api",
};
const PUBLIC_RELEASE_URL_ENV_NAMES = new Set([
  ...Object.keys(REQUIRED_POLICY_SUPPORT_URLS),
  ...Object.keys(REQUIRED_ENV_URLS),
]);
const LEGACY_RUNTIME_URL_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.staging",
  ".env.staging.local",
  ".env.production",
  ".env.production.local",
  ".env.example",
  "src/lib/site-url.ts",
  "src/lib/domain.ts",
  "src/components/silsigan/SilsiganRedesign.tsx",
  "src/app/share/post/[postId]/page.tsx",
];
const LEGACY_VERCEL_HOST_PATTERN = /\bhttps?:\/\/[^\s"'`<>]*vercel\.app[^\s"'`<>]*/i;

const { flags, options } = parseArgs(process.argv.slice(2));
const configPath = options.get("config") ?? DEFAULT_CONFIG_PATH;
const frontendConfigPath = options.get("frontend-config") ?? DEFAULT_FRONTEND_CONFIG_PATH;
const ledgerPath = options.get("ledger") ?? DEFAULT_LEDGER_PATH;
const releaseLedgerPath = options.get("release-ledger") ?? DEFAULT_RELEASE_LEDGER_PATH;
const releaseStatusPath = options.get("release-status") ?? DEFAULT_RELEASE_STATUS_PATH;
const ugcModerationRunbookPath = options.get("ugc-moderation-runbook") ?? options.get("ugc-runbook") ?? DEFAULT_UGC_MODERATION_RUNBOOK_PATH;
const cloudflareCostUsageRunbookPath = options.get("cloudflare-cost-usage-runbook") ?? options.get("cost-usage-runbook") ?? DEFAULT_CLOUDFLARE_COST_USAGE_RUNBOOK_PATH;
const testFlightReviewNotesPath = options.get("testflight-review-notes") ?? options.get("review-notes") ?? DEFAULT_TESTFLIGHT_REVIEW_NOTES_PATH;
const storePrivacyDisclosurePath = options.get("store-privacy-disclosure") ?? options.get("store-privacy") ?? DEFAULT_STORE_PRIVACY_DISCLOSURE_PATH;
const realDeviceQaLedgerPath = options.get("real-device-qa") ?? options.get("real-device-qa-ledger") ?? DEFAULT_REAL_DEVICE_QA_LEDGER_PATH;
const v2DecisionRegisterPath = options.get("v2-decision-register") ?? DEFAULT_V2_DECISION_REGISTER_PATH;
const v2LegalOperationsGatePath = options.get("v2-legal-operations-gate") ?? DEFAULT_V2_LEGAL_OPERATIONS_GATE_PATH;
const privacyPagePath = options.get("privacy-page") ?? DEFAULT_PRIVACY_PAGE_PATH;
const supportPagePath = options.get("support-page") ?? DEFAULT_SUPPORT_PAGE_PATH;
const termsPagePath = options.get("terms-page") ?? DEFAULT_TERMS_PAGE_PATH;
const cloudflareExternalStateReportPath = options.get("cloudflare-external-state-report") ?? options.get("external-state-report");
const strict = flags.has("strict");
const checks = [];
const publicEnvPath = options.get("public-env-file") ?? DEFAULT_PUBLIC_ENV_PATH;
const publicReleaseUrlDefaults = await readPublicReleaseUrlDefaults(publicEnvPath);

await checkLedger(ledgerPath);
await checkReleaseHarnessFiles(releaseLedgerPath, releaseStatusPath, ledgerPath);
await checkUgcModerationRunbook(ugcModerationRunbookPath);
await checkCloudflareCostUsageRunbook(cloudflareCostUsageRunbookPath);
await checkTestFlightReviewNotes(testFlightReviewNotesPath);
await checkStorePrivacyDisclosure(storePrivacyDisclosurePath);
await checkRealDeviceQaLedger(realDeviceQaLedgerPath);
await checkV2DecisionRegister(v2DecisionRegisterPath);
await checkV2LegalOperationsGate(v2LegalOperationsGatePath);
await checkPublicPolicyPages(privacyPagePath, supportPagePath, termsPagePath);
checkPolicySupportUrls();
await checkLegacyArtifacts();
await checkLegacyRuntimeUrls();
await checkOpenNextAdapter();
await checkFrontendWranglerConfig(frontendConfigPath);
await checkWranglerConfig(configPath);
checkDeploymentUrls();
await checkCloudflareExternalStateReport(cloudflareExternalStateReportPath);

const blockers = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");
const summary = {
  ok: blockers.length === 0,
  state: blockers.length === 0 ? "ready-for-staging-evidence" : "blocked-external",
  configPath,
  frontendConfigPath,
  ledgerPath,
  releaseLedgerPath,
  releaseStatusPath,
  ugcModerationRunbookPath,
  cloudflareCostUsageRunbookPath,
  testFlightReviewNotesPath,
  storePrivacyDisclosurePath,
  realDeviceQaLedgerPath,
  v2DecisionRegisterPath,
  v2LegalOperationsGatePath,
  privacyPagePath,
  supportPagePath,
  termsPagePath,
  publicEnvPath,
  publicEnvUrlNames: [...publicReleaseUrlDefaults.keys()],
  policySupportUrlEnvNames: Object.keys(REQUIRED_POLICY_SUPPORT_URLS),
  checks,
  blockers: summarizeReleaseBlockers(blockers),
  warnings: warnings.map((check) => check.name),
};

console.log(JSON.stringify(summary, null, 2));

if (strict && blockers.length > 0) {
  process.exitCode = 1;
}

async function checkLedger(path) {
  try {
    const ledger = await readFile(path, "utf8");
    for (const section of REQUIRED_LEDGER_SECTIONS) {
      record(`ledger.${section.replace(/^##\s+/, "").toLowerCase().replaceAll(" ", "_")}`, ledger.includes(section) ? "pass" : "fail", `${section} section is required.`);
    }
    const duplicateNextActionLines = findDuplicateSignificantLines(extractMarkdownSection(ledger, "## Next Actions"));
    record(
      "ledger.next_actions.duplicate_lines",
      duplicateNextActionLines.length === 0 ? "pass" : "fail",
      duplicateNextActionLines.length === 0 ? "## Next Actions has no duplicated operator instructions." : "## Next Actions must not repeat the same operator instruction.",
      { duplicates: duplicateNextActionLines },
    );
    record("ledger.current_release_state", "pass", "current release state ledger is present.");
  } catch (error) {
    record("ledger.current_release_state", "fail", publicErrorMessage(error));
  }
}

async function checkReleaseHarnessFiles(releaseLedgerPath, releaseStatusPath, sourceLedgerPath) {
  let releaseLedger = "";
  let releaseStatus = "";

  try {
    releaseLedger = await readFile(releaseLedgerPath, "utf8");
    record("release_harness.ledger", "pass", "release-ledger.yaml is present.");
  } catch (error) {
    record("release_harness.ledger", "fail", publicErrorMessage(error));
  }

  try {
    releaseStatus = await readFile(releaseStatusPath, "utf8");
    record("release_harness.status", "pass", "RELEASE_STATUS.md is present.");
  } catch (error) {
    record("release_harness.status", "fail", publicErrorMessage(error));
  }

  if (releaseLedger) {
    for (const field of REQUIRED_RELEASE_LEDGER_FIELDS) {
      record(
        `release_harness.ledger.${field}`,
        new RegExp(`^${escapeRegExp(field)}:`, "m").test(releaseLedger) ? "pass" : "fail",
        `release-ledger.yaml must include top-level field ${field}.`,
      );
    }

    record(
      "release_harness.ledger.source_of_truth",
      releaseLedger.includes(`source_of_truth: "${sourceLedgerPath}"`) || releaseLedger.includes(`source_of_truth: ${sourceLedgerPath}`)
        ? "pass"
        : "fail",
      "release-ledger.yaml must point to docs/current-release-state.md as the detailed source of truth.",
    );
    const parsedBlockers = parseReleaseBlockers(releaseLedger);
    record(
      "release_harness.ledger.blocker_schema",
      parsedBlockers.errors.length === 0 ? "pass" : "fail",
      parsedBlockers.errors.length === 0
        ? "Every release blocker has the required fail-closed schema and a supported status."
        : "Every release blocker must define id, severity, status, owner, evidence, and due with a supported status.",
      { errors: parsedBlockers.errors },
    );
    const openBlockerIds = extractOpenReleaseBlockerIds(releaseLedger);
    record(
      "release_harness.ledger.open_blockers",
      openBlockerIds.length === 0 ? "pass" : "fail",
      openBlockerIds.length === 0 ? "release-ledger.yaml has no open release blockers." : "release-ledger.yaml has open release blockers that must be resolved before release status can pass.",
      { blockers: openBlockerIds },
    );
    recordNoSecretLikePatterns("release_harness.ledger.redaction", releaseLedger, "release-ledger.yaml");
  }

  if (releaseStatus) {
    for (const section of REQUIRED_RELEASE_STATUS_SECTIONS) {
      record(
        `release_harness.status.${section.replace(/^#+\s+/, "").toLowerCase().replaceAll(" ", "_")}`,
        releaseStatus.includes(section) ? "pass" : "fail",
        `RELEASE_STATUS.md must include ${section}.`,
      );
    }

    record(
      "release_harness.status.source_of_truth",
      releaseStatus.includes(sourceLedgerPath) ? "pass" : "fail",
      "RELEASE_STATUS.md must link to docs/current-release-state.md.",
    );
    recordNoSecretLikePatterns("release_harness.status.redaction", releaseStatus, "RELEASE_STATUS.md");
  }

  if (releaseLedger && releaseStatus) {
    const missingEvidence = extractOpenReleaseBlockerEvidenceTokens(releaseLedger).filter((token) => !releaseStatus.includes(token));
    record(
      "release_harness.status.open_blocker_evidence",
      missingEvidence.length === 0 ? "pass" : "fail",
      missingEvidence.length === 0
        ? "RELEASE_STATUS.md summarizes every open blocker evidence token from release-ledger.yaml."
        : "RELEASE_STATUS.md must include every open blocker evidence token from release-ledger.yaml.",
      { missingEvidence },
    );
  }
}

async function checkV2DecisionRegister(path) {
  let register = "";
  try {
    register = await readFile(path, "utf8");
    record("v2_decision_register.doc", "pass", "V2 decision register is present.");
  } catch (error) {
    record("v2_decision_register.doc", "fail", publicErrorMessage(error));
    return;
  }

  for (const section of REQUIRED_V2_DECISION_REGISTER_SECTIONS) {
    record(
      `v2_decision_register.doc.${section.replace(/^#+\s+/, "").toLowerCase().replaceAll(" ", "_")}`,
      register.includes(section) ? "pass" : "fail",
      `V2 decision register must include ${section}.`,
    );
  }

  const missingTokens = REQUIRED_V2_DECISION_REGISTER_TOKENS.filter((token) => !register.includes(token));
  record(
    "v2_decision_register.doc.required_tokens",
    missingTokens.length === 0 ? "pass" : "fail",
    missingTokens.length === 0
      ? "V2 decision register covers platform, feature flags, source rights, photo privacy, identity, and external completion boundaries."
      : "V2 decision register is missing required decision tokens.",
    { missingTokens },
  );
  recordNoSecretLikePatterns("v2_decision_register.doc.redaction", register, path);
}

async function checkV2LegalOperationsGate(path) {
  let gate = "";
  try {
    gate = await readFile(path, "utf8");
    record("v2_legal_operations_gate.doc", "pass", "V2 legal and operations gate is present.");
  } catch (error) {
    record("v2_legal_operations_gate.doc", "fail", publicErrorMessage(error));
    return;
  }

  for (const section of REQUIRED_V2_LEGAL_OPERATIONS_GATE_SECTIONS) {
    record(
      `v2_legal_operations_gate.doc.${section.replace(/^#+\s+/, "").toLowerCase().replaceAll(" ", "_")}`,
      gate.includes(section) ? "pass" : "fail",
      `V2 legal and operations gate must include ${section}.`,
    );
  }

  const missingTokens = REQUIRED_V2_LEGAL_OPERATIONS_GATE_TOKENS.filter((token) => !gate.includes(token));
  record(
    "v2_legal_operations_gate.doc.required_tokens",
    missingTokens.length === 0 ? "pass" : "fail",
    missingTokens.length === 0
      ? "V2 legal and operations gate covers named ownership, source rights, moderation, ads, public URLs, and stop conditions."
      : "V2 legal and operations gate is missing required operating tokens.",
    { missingTokens },
  );
  recordNoSecretLikePatterns("v2_legal_operations_gate.doc.redaction", gate, path);
}

async function checkUgcModerationRunbook(path) {
  let runbook = "";
  try {
    runbook = await readFile(path, "utf8");
    record("ugc_moderation.runbook", "pass", "UGC moderation runbook is present.");
  } catch (error) {
    record("ugc_moderation.runbook", "fail", publicErrorMessage(error));
    return;
  }

  for (const section of REQUIRED_UGC_MODERATION_RUNBOOK_SECTIONS) {
    record(
      `ugc_moderation.runbook.${section.replace(/^#+\s+/, "").toLowerCase().replaceAll(" ", "_")}`,
      runbook.includes(section) ? "pass" : "fail",
      `UGC moderation runbook must include ${section}.`,
    );
  }

  const missingTokens = REQUIRED_UGC_MODERATION_RUNBOOK_TOKENS.filter((token) => !runbook.includes(token));
  record(
    "ugc_moderation.runbook.required_tokens",
    missingTokens.length === 0 ? "pass" : "fail",
    missingTokens.length === 0
      ? "UGC moderation runbook covers owner, alert queue, SLA, target types, and operator actions."
      : "UGC moderation runbook is missing required operating tokens.",
    { missingTokens },
  );
  recordNoSecretLikePatterns("ugc_moderation.runbook.redaction", runbook, path);
}

async function checkCloudflareCostUsageRunbook(path) {
  let runbook = "";
  try {
    runbook = await readFile(path, "utf8");
    record("cloudflare_cost_usage.runbook", "pass", "Cloudflare cost and usage runbook is present.");
  } catch (error) {
    record("cloudflare_cost_usage.runbook", "fail", publicErrorMessage(error));
    return;
  }

  for (const section of REQUIRED_CLOUDFLARE_COST_USAGE_RUNBOOK_SECTIONS) {
    record(
      `cloudflare_cost_usage.runbook.${section.replace(/^#+\s+/, "").toLowerCase().replaceAll(" ", "_")}`,
      runbook.includes(section) ? "pass" : "fail",
      `Cloudflare cost and usage runbook must include ${section}.`,
    );
  }

  const missingTokens = REQUIRED_CLOUDFLARE_COST_USAGE_RUNBOOK_TOKENS.filter((token) => !runbook.includes(token));
  record(
    "cloudflare_cost_usage.runbook.required_tokens",
    missingTokens.length === 0 ? "pass" : "fail",
    missingTokens.length === 0
      ? "Cloudflare cost and usage runbook covers products, dashboards, thresholds, alerts, cadence, and TestFlight stop conditions."
      : "Cloudflare cost and usage runbook is missing required operating tokens.",
    { missingTokens },
  );
  recordNoSecretLikePatterns("cloudflare_cost_usage.runbook.redaction", runbook, path);
}

async function checkTestFlightReviewNotes(path) {
  let notes = "";
  try {
    notes = await readFile(path, "utf8");
    record("testflight_review_notes.doc", "pass", "TestFlight review notes are present.");
  } catch (error) {
    record("testflight_review_notes.doc", "fail", publicErrorMessage(error));
    return;
  }

  for (const section of REQUIRED_TESTFLIGHT_REVIEW_NOTES_SECTIONS) {
    record(
      `testflight_review_notes.doc.${section.replace(/^#+\s+/, "").toLowerCase().replaceAll(" ", "_")}`,
      notes.includes(section) ? "pass" : "fail",
      `TestFlight review notes must include ${section}.`,
    );
  }

  const missingTokens = REQUIRED_TESTFLIGHT_REVIEW_NOTES_TOKENS.filter((token) => !notes.includes(token));
  record(
    "testflight_review_notes.doc.required_tokens",
    missingTokens.length === 0 ? "pass" : "fail",
    missingTokens.length === 0
      ? "TestFlight review notes cover beta copy, staging URLs, permissions, privacy/support URLs, UGC moderation, and Cloudflare evidence."
      : "TestFlight review notes are missing required operating tokens.",
    { missingTokens },
  );
  recordNoSecretLikePatterns("testflight_review_notes.doc.redaction", notes, path);
}

async function checkStorePrivacyDisclosure(path) {
  let disclosure = "";
  try {
    disclosure = await readFile(path, "utf8");
    record("store_privacy_disclosure.doc", "pass", "App Privacy and Data Safety disclosure draft is present.");
  } catch (error) {
    record("store_privacy_disclosure.doc", "fail", publicErrorMessage(error));
    return;
  }

  for (const section of REQUIRED_STORE_PRIVACY_DISCLOSURE_SECTIONS) {
    record(
      `store_privacy_disclosure.doc.${section.replace(/^#+\s+/, "").toLowerCase().replaceAll(" ", "_")}`,
      disclosure.includes(section) ? "pass" : "fail",
      `Store privacy disclosure draft must include ${section}.`,
    );
  }

  const missingTokens = REQUIRED_STORE_PRIVACY_DISCLOSURE_TOKENS.filter((token) => !disclosure.includes(token));
  record(
    "store_privacy_disclosure.doc.required_tokens",
    missingTokens.length === 0 ? "pass" : "fail",
    missingTokens.length === 0
      ? "Store privacy disclosure draft covers platform forms, data inventory, native enforcement, owner review, and stop conditions."
      : "Store privacy disclosure draft is missing required platform or data-handling tokens.",
    { missingTokens },
  );
  recordNoSecretLikePatterns("store_privacy_disclosure.doc.redaction", disclosure, path);
}

async function checkRealDeviceQaLedger(path) {
  let ledger = "";
  try {
    ledger = await readFile(path, "utf8");
    record("real_device_qa.ledger", "pass", "Real-device QA ledger is present.");
  } catch (error) {
    record("real_device_qa.ledger", "fail", publicErrorMessage(error));
    return;
  }

  for (const section of REQUIRED_REAL_DEVICE_QA_LEDGER_SECTIONS) {
    record(
      `real_device_qa.ledger.${section.replace(/^#+\s+/, "").toLowerCase().replaceAll(" ", "_")}`,
      ledger.includes(section) ? "pass" : "fail",
      `Real-device QA ledger must include ${section}.`,
    );
  }

  const missingTokens = REQUIRED_REAL_DEVICE_QA_LEDGER_TOKENS.filter((token) => !ledger.includes(token));
  record(
    "real_device_qa.ledger.required_tokens",
    missingTokens.length === 0 ? "pass" : "fail",
    missingTokens.length === 0
      ? "Real-device QA ledger covers iPhone/Android staging evidence, permissions, UGC flows, redaction, crash checks, and artifact naming."
      : "Real-device QA ledger is missing required operating tokens.",
    { missingTokens },
  );
  recordNoSecretLikePatterns("real_device_qa.ledger.redaction", ledger, path);
}

async function checkPublicPolicyPages(privacyPagePath, supportPagePath, termsPagePath) {
  await checkTokenizedPage(
    privacyPagePath,
    "public_policy_page.privacy",
    "Privacy policy page",
    REQUIRED_PRIVACY_PAGE_TOKENS,
    "Privacy policy page covers implemented data handling, storage, reports, deletion, and final URL language.",
  );
  await checkTokenizedPage(
    supportPagePath,
    "public_policy_page.support",
    "Support page",
    REQUIRED_SUPPORT_PAGE_TOKENS,
    "Support page covers TestFlight support, device issues, content reports, deletion requests, and final URL language.",
  );
  await checkTokenizedPage(
    termsPagePath,
    "public_policy_page.terms",
    "Terms page",
    REQUIRED_TERMS_PAGE_TOKENS,
    "Terms page covers beta limitations, UGC rights, prohibited conduct, appeals, location, minors, and the production boundary.",
  );
}

async function checkTokenizedPage(path, checkPrefix, label, requiredTokens, passMessage) {
  let content = "";
  try {
    content = await readFile(path, "utf8");
    record(checkPrefix, "pass", `${label} is present.`);
  } catch (error) {
    record(checkPrefix, "fail", publicErrorMessage(error));
    return;
  }

  const missingTokens = requiredTokens.filter((token) => !content.includes(token));
  record(
    `${checkPrefix}.required_tokens`,
    missingTokens.length === 0 ? "pass" : "fail",
    missingTokens.length === 0 ? passMessage : `${label} is missing required public-page tokens.`,
    { missingTokens },
  );
  recordNoSecretLikePatterns(`${checkPrefix}.redaction`, content, path);
}

function checkPolicySupportUrls() {
  const parsedUrls = new Map();

  for (const [envVarName, checkName] of Object.entries(REQUIRED_POLICY_SUPPORT_URLS)) {
    const parsed = parseRequiredHttpsUrl(releaseUrlValue(envVarName), envVarName, `policy_url.${checkName}`);
    if (parsed) {
      parsedUrls.set(checkName, parsed.href);
    }
  }

  recordSeparatedUrls(parsedUrls, "privacy_policy", "support", "privacy policy and support URLs must be different.", "policy_url");
  recordSeparatedUrls(parsedUrls, "privacy_policy", "terms", "privacy policy and terms URLs must be different.", "policy_url");
  recordSeparatedUrls(parsedUrls, "support", "terms", "support and terms URLs must be different.", "policy_url");
}

function recordNoSecretLikePatterns(name, content, path) {
  const secretLikePattern = /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN (RSA |OPENSSH |PRIVATE )?PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY[=:][^\s]+|JWT_SECRET[=:][^\s]+)/i;
  record(name, secretLikePattern.test(content) ? "fail" : "pass", `${path} must not contain secret-like values.`);
}

async function checkCloudflareExternalStateReport(path) {
  if (!path) {
    return;
  }

  let report;
  try {
    report = parseJsonObjectFromText(await readFile(path, "utf8"));
  } catch (error) {
    record("cloudflare_external_state.report", "fail", `Cloudflare external-state report could not be read: ${publicErrorMessage(error)}`);
    return;
  }

  if (!isRecord(report) || !Array.isArray(report.checks)) {
    record("cloudflare_external_state.report", "fail", "Cloudflare external-state report must contain a checks array.");
    return;
  }

  record("cloudflare_external_state.report", "pass", "Cloudflare external-state report was included in release status.", {
    source: "cloudflare-external-state",
    checkCount: report.checks.length,
  });

  for (const check of report.checks) {
    if (!isRecord(check) || check.status !== "fail") {
      continue;
    }

    const name = typeof check.name === "string" && check.name.length > 0 ? check.name : "cloudflare_external_state.unknown";
    const message = typeof check.message === "string" && check.message.length > 0 ? check.message : "Cloudflare external-state check failed.";
    record(name, "fail", message, {
      ...safeExternalStateDetails(check),
      source: "cloudflare-external-state",
    });
  }
}

function safeExternalStateDetails(check) {
  const details = {};
  if (typeof check.code === "string" && check.code.length > 0) {
    details.code = check.code;
  }
  for (const key of ["missingBuckets", "missingSchema", "missingSeed"]) {
    if (Array.isArray(check[key]) && check[key].every((value) => typeof value === "string")) {
      details[key] = check[key];
    }
  }
  if (isRecord(check.counts)) {
    details.counts = Object.fromEntries(
      Object.entries(check.counts).filter(([, value]) => typeof value === "number" && Number.isFinite(value)),
    );
  }
  return details;
}

function summarizeReleaseBlockers(failedChecks) {
  const blockerNames = [];
  const seen = new Set();

  for (const check of failedChecks) {
    const [blockerName] = check.source === "cloudflare-external-state" ? summarizeExternalStateBlockers([check]) : [];
    const name = blockerName ?? check.name;
    if (typeof name === "string" && name.length > 0 && !seen.has(name)) {
      seen.add(name);
      blockerNames.push(name);
    }
  }

  return blockerNames;
}

function extractOpenReleaseBlockerIds(releaseLedger) {
  return parseReleaseBlockers(releaseLedger).blockers
    .filter((blocker) => blocker.status === "open")
    .map((blocker, index) => blocker.id || `open-blocker-${index + 1}`);
}

function extractOpenReleaseBlockerEvidenceTokens(releaseLedger) {
  const evidenceTokens = new Set();
  const evidenceTokenPattern = /deployment_url\.\*|docs\/current-release-state\.md|[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+/g;

  for (const blocker of parseReleaseBlockers(releaseLedger).blockers.filter((candidate) => candidate.status === "open")) {
    const evidence = blocker.evidence ?? "";
    for (const token of evidence.match(evidenceTokenPattern) ?? []) {
      evidenceTokens.add(token);
    }
  }

  return [...evidenceTokens];
}

function parseReleaseBlockers(releaseLedger) {
  const lines = releaseLedger.split(/\r?\n/);
  const blockersLineIndex = lines.findIndex((line) => /^blockers\s*:/.test(line));
  if (blockersLineIndex === -1) {
    return { blockers: [], errors: ["blockers must be a top-level field."] };
  }

  const declaration = lines[blockersLineIndex].trim();
  if (/^blockers\s*:\s*\[\]\s*(?:#.*)?$/.test(declaration)) {
    return { blockers: [], errors: [] };
  }
  if (!/^blockers\s*:\s*(?:#.*)?$/.test(declaration)) {
    return { blockers: [], errors: ["blockers must be [] or an indented list of mappings."] };
  }

  const blockers = [];
  const errors = [];
  let current = null;
  let sawListContent = false;

  const finishCurrent = () => {
    if (current) {
      blockers.push(current);
      current = null;
    }
  };

  for (let index = blockersLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed && !line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    sawListContent = true;
    if (line.includes("\t")) {
      errors.push(`blockers line ${index + 1} must use spaces, not tabs.`);
      continue;
    }

    const itemMatch = line.match(/^  -\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    const fieldMatch = line.match(/^    ([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (itemMatch) {
      finishCurrent();
      current = {};
      assignReleaseBlockerField(current, itemMatch[1], itemMatch[2], blockers.length, index + 1, errors);
      continue;
    }
    if (fieldMatch && current) {
      assignReleaseBlockerField(current, fieldMatch[1], fieldMatch[2], blockers.length, index + 1, errors);
      continue;
    }

    errors.push(`blockers line ${index + 1} must be a flat list mapping indented by two spaces.`);
  }
  finishCurrent();

  if (!sawListContent) {
    errors.push("blockers must be [] or contain at least one list item.");
  }

  const seenIds = new Set();
  blockers.forEach((blocker, index) => {
    for (const field of REQUIRED_RELEASE_BLOCKER_FIELDS) {
      if (typeof blocker[field] !== "string" || blocker[field].trim().length === 0) {
        errors.push(`blockers[${index}].${field} is required.`);
      }
    }
    if (blocker.status && !ALLOWED_RELEASE_BLOCKER_STATUSES.has(blocker.status)) {
      errors.push(`blockers[${index}].status must be one of "open" or "closed".`);
    }
    if (blocker.id) {
      if (seenIds.has(blocker.id)) {
        errors.push(`blockers[${index}].id must be unique.`);
      }
      seenIds.add(blocker.id);
    }
  });

  return { blockers, errors: [...new Set(errors)] };
}

function assignReleaseBlockerField(blocker, field, rawValue, blockerIndex, lineNumber, errors) {
  if (Object.hasOwn(blocker, field)) {
    errors.push(`blockers[${blockerIndex}].${field} must not be repeated.`);
    return;
  }

  const parsed = parseReleaseLedgerScalar(rawValue);
  if (!parsed.ok) {
    errors.push(`blockers line ${lineNumber} field ${field} must be a single-line scalar.`);
    return;
  }
  blocker[field] = parsed.value;
}

function parseReleaseLedgerScalar(rawValue) {
  const value = stripReleaseLedgerInlineComment(rawValue).trim();
  if (!value || /^[\[{>|]/.test(value)) {
    return { ok: false, value: "" };
  }

  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? { ok: true, value: parsed } : { ok: false, value: "" };
    } catch {
      return { ok: false, value: "" };
    }
  }

  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      return { ok: false, value: "" };
    }
    return { ok: true, value: value.slice(1, -1).replaceAll("''", "'") };
  }

  if (value.includes('"') || value.includes("'")) {
    return { ok: false, value: "" };
  }
  return { ok: true, value };
}

function stripReleaseLedgerInlineComment(rawValue) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < rawValue.length; index += 1) {
    const character = rawValue[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (character === "#" && quote === null && (index === 0 || /\s/.test(rawValue[index - 1]))) {
      return rawValue.slice(0, index);
    }
  }
  return rawValue;
}

function extractMarkdownSection(markdown, heading) {
  const sectionStart = markdown.indexOf(heading);
  if (sectionStart === -1) {
    return "";
  }

  const bodyStart = sectionStart + heading.length;
  const nextSectionStart = markdown.indexOf("\n## ", bodyStart);
  return markdown.slice(bodyStart, nextSectionStart === -1 ? markdown.length : nextSectionStart);
}

function findDuplicateSignificantLines(text) {
  const seenLines = new Set();
  const duplicates = [];
  const seenDuplicates = new Set();

  for (const rawLine of text.split("\n")) {
    const normalizedLine = rawLine.trim().replace(/\s+/g, " ");
    if (normalizedLine.length < 30 || normalizedLine === "```bash" || normalizedLine === "```") {
      continue;
    }

    if (seenLines.has(normalizedLine) && !seenDuplicates.has(normalizedLine)) {
      duplicates.push(normalizedLine);
      seenDuplicates.add(normalizedLine);
    }
    seenLines.add(normalizedLine);
  }

  return duplicates;
}

async function checkLegacyArtifacts() {
  await recordMissingPath("legacy.supabase_artifacts", "supabase", "Supabase project artifacts must not ship in the Cloudflare release tree.");
  await recordMissingPath("legacy.vercel_config", "vercel.json", "Vercel deployment config must not ship with the Cloudflare Pages release tree.");

  try {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const dependencyBlocks = [
      packageJson.dependencies,
      packageJson.devDependencies,
      packageJson.optionalDependencies,
      packageJson.peerDependencies,
    ].filter(isRecord);
    const dependencyNames = dependencyBlocks.flatMap((block) => Object.keys(block));
    const supabaseDependencies = dependencyNames.filter((name) => name === "supabase" || name.startsWith("@supabase/"));

    record(
      "legacy.supabase_dependencies",
      supabaseDependencies.length === 0 ? "pass" : "fail",
      supabaseDependencies.length === 0
        ? "package.json has no Supabase runtime or toolchain dependencies."
        : `package.json still references Supabase dependencies: ${supabaseDependencies.join(", ")}`,
    );
  } catch (error) {
    record("legacy.supabase_dependencies", "fail", publicErrorMessage(error));
  }
}

async function checkLegacyRuntimeUrls() {
  const offenders = [];

  for (const path of LEGACY_RUNTIME_URL_FILES) {
    try {
      const content = await readFile(path, "utf8");
      if (LEGACY_VERCEL_HOST_PATTERN.test(content)) {
        offenders.push(path);
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        offenders.push(`${path} (${publicErrorMessage(error)})`);
      }
    }
  }

  record(
    "legacy.vercel_public_urls",
    offenders.length === 0 ? "pass" : "fail",
    offenders.length === 0
      ? "runtime defaults do not expose Vercel public URLs."
      : `runtime defaults still reference Vercel public URLs: ${offenders.join(", ")}`,
  );
}

async function checkOpenNextAdapter() {
  try {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const devDependencies = isRecord(packageJson.devDependencies) ? packageJson.devDependencies : {};
    const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};

    record(
      "frontend.opennext.dependency",
      readyString(devDependencies["@opennextjs/cloudflare"]) ? "pass" : "fail",
      "@opennextjs/cloudflare must be pinned as a devDependency for Cloudflare Next.js builds.",
    );
    record(
      "frontend.wrangler.dependency",
      readyString(devDependencies.wrangler) ? "pass" : "fail",
      "wrangler must be pinned as a devDependency for reproducible Cloudflare frontend builds.",
    );

    const requiredScripts = {
      "cf:build": "opennextjs-cloudflare build",
      "cf:preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
      "cf:deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
      "cf:typegen": "wrangler types cloudflare-env.d.ts --env-interface CloudflareEnv --env-file .env.example --include-runtime false",
      "cf:web:dry-run": "wrangler deploy --dry-run --env=\"\" --config wrangler.jsonc",
      "cf:web:dry-run:staging": "wrangler deploy --dry-run --env staging --config wrangler.jsonc",
      "cf:web:dry-run:production": "wrangler deploy --dry-run --env production --config wrangler.jsonc",
      "cf:rollback:drill": "node scripts/cloudflare-rollback-drill.mjs",
    };

    for (const [scriptName, expectedCommand] of Object.entries(requiredScripts)) {
      record(
        `frontend.opennext.script.${scriptName}`,
        scripts[scriptName] === expectedCommand ? "pass" : "fail",
        `package.json script ${scriptName} must run '${expectedCommand}'.`,
      );
    }
  } catch (error) {
    record("frontend.opennext.package", "fail", publicErrorMessage(error));
  }

  try {
    const config = await readFile("open-next.config.ts", "utf8");
    record(
      "frontend.opennext.config",
      config.includes("defineCloudflareConfig") && config.includes("@opennextjs/cloudflare") ? "pass" : "fail",
      "open-next.config.ts must configure the Cloudflare OpenNext adapter.",
    );
  } catch (error) {
    record("frontend.opennext.config", "fail", publicErrorMessage(error));
  }
}

async function checkFrontendWranglerConfig(path) {
  let config;
  try {
    config = JSON.parse(stripJsonComments(await readFile(path, "utf8")));
  } catch (error) {
    record("frontend.wrangler.config", "fail", publicErrorMessage(error));
    return;
  }

  record("frontend.wrangler.name", readyString(config.name) ? "pass" : "fail", "Cloudflare frontend Worker name is required.");
  record("frontend.wrangler.main", config.main === ".open-next/worker.js" ? "pass" : "fail", "Next.js frontend Worker main must point to .open-next/worker.js.");
  record(
    "frontend.wrangler.compatibility_date",
    isDateAtLeast(config.compatibility_date, MINIMUM_OPEN_NEXT_COMPATIBILITY_DATE) ? "pass" : "fail",
    `OpenNext Cloudflare compatibility_date must be ${MINIMUM_OPEN_NEXT_COMPATIBILITY_DATE} or later.`,
  );
  record(
    "frontend.wrangler.nodejs_compat",
    Array.isArray(config.compatibility_flags) && config.compatibility_flags.includes("nodejs_compat") ? "pass" : "fail",
    "Next.js frontend Worker must enable nodejs_compat.",
  );
  record("frontend.wrangler.assets.directory", config.assets?.directory === ".open-next/assets" ? "pass" : "fail", "Next.js frontend assets directory must be .open-next/assets.");
  record("frontend.wrangler.assets.binding", config.assets?.binding === "ASSETS" ? "pass" : "fail", "Next.js frontend assets binding must be ASSETS.");
  record("frontend.wrangler.observability", config.observability?.enabled === true ? "pass" : "fail", "Next.js frontend Worker observability must be enabled.");

  for (const envName of ["staging", "production"]) {
    const envConfig = config.env?.[envName];
    record(`frontend.wrangler.${envName}.name`, readyString(envConfig?.name) ? "pass" : "fail", `Cloudflare frontend ${envName} Worker name is required.`);
    assertNoSecretVars(envConfig?.vars ?? {}, `frontend.wrangler.${envName}`);
  }
  assertNoSecretVars(config.vars ?? {}, "frontend.wrangler");
}

async function recordMissingPath(name, path, message) {
  try {
    await access(path);
    record(name, "fail", message);
  } catch {
    record(name, "pass", message);
  }
}

async function checkWranglerConfig(path) {
  let config;
  try {
    config = JSON.parse(stripJsonComments(await readFile(path, "utf8")));
  } catch (error) {
    record("wrangler.config", "fail", publicErrorMessage(error));
    return;
  }

  for (const envName of ["staging", "production"]) {
    const envConfig = config.env?.[envName];
    if (!isRecord(envConfig)) {
      record(`wrangler.${envName}.config`, "fail", `${envName} config is missing.`);
      continue;
    }

    const d1 = bindingBy(envConfig.d1_databases, "DB");
    const kv = bindingBy(envConfig.kv_namespaces, "CACHE");
    const r2 = bindingBy(envConfig.r2_buckets, "PHOTOS");
    const images = envConfig.images;
    const durableBindings = Array.isArray(envConfig.durable_objects?.bindings) ? envConfig.durable_objects.bindings : [];

    recordReadyIdentifier(`${envName}.d1.DB.database_id`, d1?.database_id);
    recordReadyIdentifier(`${envName}.kv.CACHE.id`, kv?.id);
    recordReadyString(`${envName}.r2.PHOTOS.bucket_name`, r2?.bucket_name);
    record(`${envName}.images.IMAGES`, images?.binding === "IMAGES" ? "pass" : "fail", "Cloudflare Images binding must be named IMAGES.");

    for (const bindingName of ["PLACE_ROOM", "REGION_ROOM", "GLOBAL_ROOM"]) {
      record(
        `${envName}.durable_objects.${bindingName}`,
        durableBindings.some((binding) => binding?.name === bindingName) ? "pass" : "fail",
        `${bindingName} Durable Object binding is required.`,
      );
    }
  }
}

function checkDeploymentUrls() {
  const parsedUrls = new Map();

  for (const [envVarName, checkName] of Object.entries(REQUIRED_ENV_URLS)) {
    const parsed = parseDeploymentUrl(releaseUrlValue(envVarName), envVarName, checkName);
    if (parsed) {
      parsedUrls.set(checkName, parsed.href);
    }
  }

  recordSeparatedUrls(parsedUrls, "staging.pages", "production.pages", "staging and production Pages URLs must be different.");
  recordSeparatedUrls(parsedUrls, "staging.worker_api", "production.worker_api", "staging and production Worker API URLs must be different.");
}

function parseDeploymentUrl(value, envVarName, checkName) {
  return parseRequiredHttpsUrl(value, envVarName, `deployment_url.${checkName}`, { messageSubject: "deployment-shaped" });
}

function releaseUrlValue(envVarName) {
  if (Object.prototype.hasOwnProperty.call(process.env, envVarName)) {
    return process.env[envVarName];
  }

  return publicReleaseUrlDefaults.get(envVarName);
}

async function readPublicReleaseUrlDefaults(path) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      record("public_release_env.file", "warn", `Public release URL defaults could not be read: ${publicErrorMessage(error)}`);
    }
    return new Map();
  }

  const values = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const envVarName = line.slice(0, separatorIndex).trim();
    if (!PUBLIC_RELEASE_URL_ENV_NAMES.has(envVarName)) {
      continue;
    }

    values.set(envVarName, stripOptionalEnvQuotes(line.slice(separatorIndex + 1).trim()));
  }

  return values;
}

function stripOptionalEnvQuotes(value) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value.at(-1);
  return (first === '"' && last === '"') || (first === "'" && last === "'") ? value.slice(1, -1) : value;
}

function parseRequiredHttpsUrl(value, envVarName, checkName, options = {}) {
  if (typeof value !== "string" || value.trim().length === 0) {
    record(checkName, "fail", `${envVarName} is required.`);
    return null;
  }

  if (hasPlaceholder(value)) {
    record(checkName, "fail", `${envVarName} still contains a placeholder.`);
    return null;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    record(checkName, "fail", `${envVarName} must be a valid absolute URL.`);
    return null;
  }

  const validations = [
    recordCheck(url.protocol === "https:", checkName, `${envVarName} must use https.`),
    recordCheck(url.username === "" && url.password === "", checkName, `${envVarName} must not contain credentials.`),
    recordCheck(url.search === "" && url.hash === "", checkName, `${envVarName} must not contain query params or fragments.`),
    recordCheck(!isLocalhost(url.hostname), checkName, `${envVarName} must not point to localhost.`),
  ];

  if (!validations.every(Boolean)) {
    return null;
  }

  record(checkName, "pass", `${envVarName} is ${options.messageSubject ?? "release-shaped"}.`, { host: url.host });
  return url;
}

function recordReadyIdentifier(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    record(name, "fail", `${name} is required.`);
    return;
  }

  if (hasPlaceholder(value)) {
    record(name, "fail", `${name} must not contain placeholders.`);
    return;
  }

  record(name, value.length >= 8 ? "pass" : "fail", `${name} must look like a concrete Cloudflare resource id.`);
}

function recordReadyString(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    record(name, "fail", `${name} is required.`);
    return;
  }

  record(name, hasPlaceholder(value) ? "fail" : "pass", `${name} must not contain placeholders.`);
}

function assertNoSecretVars(vars, scopeName) {
  if (!isRecord(vars)) {
    record(`${scopeName}.vars`, "fail", "vars must be an object when present.");
    return;
  }

  for (const key of Object.keys(vars)) {
    if (/(TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL)/i.test(key)) {
      record(`${scopeName}.vars.${key}`, "fail", "Secrets must be registered as Cloudflare secrets, not plain vars.");
    }
  }
}

function readyString(value) {
  return typeof value === "string" && value.trim().length > 0 && !hasPlaceholder(value);
}

function isDateAtLeast(value, minimum) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  return value >= minimum;
}

function recordSeparatedUrls(parsedUrls, leftKey, rightKey, message, prefix = "deployment_url") {
  const left = parsedUrls.get(leftKey);
  const right = parsedUrls.get(rightKey);
  if (!left || !right) {
    return;
  }

  record(`${prefix}.${leftKey}.${rightKey}`, left !== right ? "pass" : "fail", message);
}

function bindingBy(items, bindingName) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.find((item) => item?.binding === bindingName) ?? null;
}

function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        inString = false;
      }
      continue;
    }

    if (current === "\"" || current === "'") {
      inString = true;
      quote = current;
      output += current;
      continue;
    }

    if (current === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }

    if (current === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += current;
  }

  return output;
}

function parseJsonObjectFromText(text) {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("No JSON object found.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const current = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      continue;
    }

    if (current === "{") {
      depth += 1;
      continue;
    }

    if (current === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, index + 1));
      }
    }
  }

  throw new Error("No complete JSON object found.");
}

function parseArgs(rawArgs) {
  const parsedFlags = new Set();
  const parsedOptions = new Map();

  for (const rawArg of rawArgs) {
    if (!rawArg.startsWith("--")) {
      continue;
    }

    const arg = rawArg.slice(2);
    const separatorIndex = arg.indexOf("=");
    if (separatorIndex === -1) {
      parsedFlags.add(arg);
      continue;
    }

    parsedOptions.set(arg.slice(0, separatorIndex), arg.slice(separatorIndex + 1));
  }

  return { flags: parsedFlags, options: parsedOptions };
}

function recordCheck(condition, name, message) {
  record(name, condition ? "pass" : "fail", message);
  return condition;
}

function record(name, status, message, details = {}) {
  checks.push({ name, status, message, ...details });
}

function hasPlaceholder(value) {
  return /TODO|^<.*>$|REPLACE_ME|CHANGE_ME/i.test(String(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || /^127\./.test(hostname) || hostname.endsWith(".local");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error) {
  return isRecord(error) && error.code === "ENOENT";
}

function publicErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown release state check error.";
}

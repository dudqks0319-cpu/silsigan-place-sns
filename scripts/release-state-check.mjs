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
const DEFAULT_REAL_DEVICE_QA_LEDGER_PATH = "docs/real-device-qa.md";
const DEFAULT_PRIVACY_PAGE_PATH = "src/app/privacy/page.tsx";
const DEFAULT_SUPPORT_PAGE_PATH = "src/app/support/page.tsx";
const DEFAULT_MOBILE_APP_PATH = "apps/mobile/App.tsx";
const DEFAULT_MOBILE_APP_CONFIG_PATH = "apps/mobile/app.json";
const DEFAULT_MOBILE_EXPERIENCE_PATH = "apps/mobile/src/silsiganExperience.ts";
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
  "Staging API Worker deployment",
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
const REQUIRED_MOBILE_APP_TOKENS = [
  "serviceLinks",
  "베타 지원",
  "개인정보",
  "지원 문의",
  "staging web",
  "ExternalLinkButton",
  "Linking.openURL",
  "accessibilityRole=\"button\"",
];
const REQUIRED_MOBILE_EXPERIENCE_TOKENS = [
  "ServiceLinks",
  "serviceLinks",
  "stagingWebUrl",
  "privacyPolicyUrl",
  "supportUrl",
  "getServiceLinkReadiness",
];
const REQUIRED_MOBILE_IOS_INFO_PLIST_KEYS = [
  "NSCameraUsageDescription",
  "NSLocationWhenInUseUsageDescription",
  "NSPhotoLibraryUsageDescription",
];
const REQUIRED_MOBILE_ANDROID_PERMISSIONS = [
  "CAMERA",
  "ACCESS_COARSE_LOCATION",
  "ACCESS_FINE_LOCATION",
];
const REQUIRED_MOBILE_EXTRA_LINKS = {
  stagingWebUrl: "staging_web",
  privacyPolicyUrl: "privacy_policy",
  supportUrl: "support",
};
const REQUIRED_POLICY_SUPPORT_URLS = {
  SILSIGAN_PRIVACY_POLICY_URL: "privacy_policy",
  SILSIGAN_SUPPORT_URL: "support",
};
const REQUIRED_ENV_URLS = {
  SILSIGAN_STAGING_PAGES_URL: "staging.pages",
  SILSIGAN_STAGING_API_BASE_URL: "staging.worker_api",
  SILSIGAN_PRODUCTION_PAGES_URL: "production.pages",
  SILSIGAN_PRODUCTION_API_BASE_URL: "production.worker_api",
};
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
const realDeviceQaLedgerPath = options.get("real-device-qa") ?? options.get("real-device-qa-ledger") ?? DEFAULT_REAL_DEVICE_QA_LEDGER_PATH;
const privacyPagePath = options.get("privacy-page") ?? DEFAULT_PRIVACY_PAGE_PATH;
const supportPagePath = options.get("support-page") ?? DEFAULT_SUPPORT_PAGE_PATH;
const mobileAppPath = options.get("mobile-app") ?? DEFAULT_MOBILE_APP_PATH;
const mobileAppConfigPath = options.get("mobile-app-config") ?? DEFAULT_MOBILE_APP_CONFIG_PATH;
const mobileExperiencePath = options.get("mobile-experience") ?? DEFAULT_MOBILE_EXPERIENCE_PATH;
const cloudflareExternalStateReportPath = options.get("cloudflare-external-state-report") ?? options.get("external-state-report");
const strict = flags.has("strict");
const checks = [];

await checkLedger(ledgerPath);
await checkReleaseHarnessFiles(releaseLedgerPath, releaseStatusPath, ledgerPath);
await checkUgcModerationRunbook(ugcModerationRunbookPath);
await checkCloudflareCostUsageRunbook(cloudflareCostUsageRunbookPath);
await checkTestFlightReviewNotes(testFlightReviewNotesPath);
await checkRealDeviceQaLedger(realDeviceQaLedgerPath);
await checkPublicPolicySupportPages(privacyPagePath, supportPagePath);
await checkMobileTestFlightShell(mobileAppPath, mobileAppConfigPath, mobileExperiencePath);
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
  realDeviceQaLedgerPath,
  privacyPagePath,
  supportPagePath,
  mobileAppPath,
  mobileAppConfigPath,
  mobileExperiencePath,
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

async function checkPublicPolicySupportPages(privacyPagePath, supportPagePath) {
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

async function checkMobileTestFlightShell(mobileAppPath, mobileAppConfigPath, mobileExperiencePath) {
  let appSource = "";
  try {
    appSource = await readFile(mobileAppPath, "utf8");
    record("mobile_testflight.app", "pass", "Mobile TestFlight shell is present.");
  } catch (error) {
    record("mobile_testflight.app", "fail", publicErrorMessage(error));
  }

  if (appSource) {
    const missingTokens = REQUIRED_MOBILE_APP_TOKENS.filter((token) => !appSource.includes(token));
    record(
      "mobile_testflight.app.required_tokens",
      missingTokens.length === 0 ? "pass" : "fail",
      missingTokens.length === 0
        ? "Mobile shell exposes public beta support links through tappable controls."
        : "Mobile shell is missing required TestFlight support UI tokens.",
      { missingTokens },
    );
    recordNoSecretLikePatterns("mobile_testflight.app.redaction", appSource, mobileAppPath);
  }

  let experienceSource = "";
  try {
    experienceSource = await readFile(mobileExperiencePath, "utf8");
    record("mobile_testflight.experience", "pass", "Mobile experience source is present.");
  } catch (error) {
    record("mobile_testflight.experience", "fail", publicErrorMessage(error));
  }

  if (experienceSource) {
    const missingTokens = REQUIRED_MOBILE_EXPERIENCE_TOKENS.filter((token) => !experienceSource.includes(token));
    record(
      "mobile_testflight.experience.required_tokens",
      missingTokens.length === 0 ? "pass" : "fail",
      missingTokens.length === 0
        ? "Mobile experience exports concrete service links and readiness metadata."
        : "Mobile experience source is missing required service-link tokens.",
      { missingTokens },
    );
    recordNoSecretLikePatterns("mobile_testflight.experience.redaction", experienceSource, mobileExperiencePath);
  }

  let appConfig = null;
  try {
    appConfig = JSON.parse(await readFile(mobileAppConfigPath, "utf8"));
    record("mobile_testflight.app_config", "pass", "Mobile Expo app config is present.");
  } catch (error) {
    record("mobile_testflight.app_config", "fail", `Mobile Expo app config could not be read: ${publicErrorMessage(error)}`);
  }

  if (!isRecord(appConfig)) {
    return;
  }

  const expoConfig = isRecord(appConfig.expo) ? appConfig.expo : {};
  const iosConfig = isRecord(expoConfig.ios) ? expoConfig.ios : {};
  const iosInfoPlist = isRecord(iosConfig.infoPlist) ? iosConfig.infoPlist : {};
  const androidConfig = isRecord(expoConfig.android) ? expoConfig.android : {};
  const androidPermissions = Array.isArray(androidConfig.permissions) ? androidConfig.permissions : [];
  const extraConfig = isRecord(expoConfig.extra) ? expoConfig.extra : {};
  const silsiganExtraConfig = isRecord(extraConfig.silsigan) ? extraConfig.silsigan : {};

  const missingIosPermissionKeys = REQUIRED_MOBILE_IOS_INFO_PLIST_KEYS.filter((key) => !readyString(iosInfoPlist[key]));
  record(
    "mobile_testflight.app_config.ios_permissions",
    missingIosPermissionKeys.length === 0 ? "pass" : "fail",
    missingIosPermissionKeys.length === 0
      ? "Mobile iOS permission usage strings cover location, camera, and photo library prompts."
      : "Mobile iOS permission usage strings are incomplete.",
    { missingPermissionKeys: missingIosPermissionKeys },
  );

  const missingAndroidPermissions = REQUIRED_MOBILE_ANDROID_PERMISSIONS.filter((permission) => !androidPermissions.includes(permission));
  record(
    "mobile_testflight.app_config.android_permissions",
    missingAndroidPermissions.length === 0 ? "pass" : "fail",
    missingAndroidPermissions.length === 0
      ? "Mobile Android permissions cover location and camera access."
      : "Mobile Android permissions are incomplete.",
    { missingPermissions: missingAndroidPermissions },
  );

  const parsedMobileUrls = new Map();
  for (const [fieldName, checkName] of Object.entries(REQUIRED_MOBILE_EXTRA_LINKS)) {
    const parsed = parseRequiredHttpsUrl(
      silsiganExtraConfig[fieldName],
      `expo.extra.silsigan.${fieldName}`,
      `mobile_testflight.app_config.urls.${checkName}`,
    );
    if (parsed) {
      parsedMobileUrls.set(checkName, parsed.href);
    }
  }

  recordSeparatedUrls(parsedMobileUrls, "privacy_policy", "support", "Mobile privacy policy and support URLs must be different.", "mobile_testflight.app_config.urls");
  recordSeparatedUrls(parsedMobileUrls, "staging_web", "privacy_policy", "Mobile staging web URL and privacy URL must be distinct.", "mobile_testflight.app_config.urls");
  recordSeparatedUrls(parsedMobileUrls, "staging_web", "support", "Mobile staging web URL and support URL must be distinct.", "mobile_testflight.app_config.urls");

  if (experienceSource && parsedMobileUrls.size > 0) {
    const missingUrlValues = [...parsedMobileUrls.values()].filter((url) => !experienceSource.includes(url));
    record(
      "mobile_testflight.experience.url_values",
      missingUrlValues.length === 0 ? "pass" : "fail",
      missingUrlValues.length === 0
        ? "Mobile experience source and Expo app config expose the same public URLs."
        : "Mobile experience source is missing public URL values from Expo app config.",
      { missingUrlValues },
    );
  }
}

function checkPolicySupportUrls() {
  const parsedUrls = new Map();

  for (const [envVarName, checkName] of Object.entries(REQUIRED_POLICY_SUPPORT_URLS)) {
    const parsed = parseRequiredHttpsUrl(process.env[envVarName], envVarName, `policy_url.${checkName}`);
    if (parsed) {
      parsedUrls.set(checkName, parsed.href);
    }
  }

  recordSeparatedUrls(parsedUrls, "privacy_policy", "support", "privacy policy and support URLs must be different.", "policy_url");
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
  return extractOpenReleaseBlockerBlocks(releaseLedger).map((blocker, index) => {
    const idMatch = blocker.match(/^\s*(?:-\s*)?id:\s*"?([^"\n]+)"?\s*$/m);
    return idMatch?.[1] ?? `open-blocker-${index + 1}`;
  });
}

function extractOpenReleaseBlockerEvidenceTokens(releaseLedger) {
  const evidenceTokens = new Set();
  const evidenceTokenPattern = /deployment_url\.\*|docs\/current-release-state\.md|[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+/g;

  for (const blocker of extractOpenReleaseBlockerBlocks(releaseLedger)) {
    const evidenceMatch = blocker.match(/^\s*evidence:\s*"?([^"\n]+)"?\s*$/m);
    const evidence = evidenceMatch?.[1] ?? "";
    for (const token of evidence.match(evidenceTokenPattern) ?? []) {
      evidenceTokens.add(token);
    }
  }

  return [...evidenceTokens];
}

function extractOpenReleaseBlockerBlocks(releaseLedger) {
  const blockersMatch = releaseLedger.match(/\nblockers:\n(?<body>[\s\S]*?)(?=\n[A-Za-z_]+:\n|\s*$)/);
  const blockersBody = blockersMatch?.groups?.body ?? "";
  if (!blockersBody.trim() || /^\s*\[\]\s*$/m.test(blockersBody)) {
    return [];
  }

  return blockersBody
    .split(/\n\s*-\s+/)
    .map((blocker) => blocker.trim())
    .filter(Boolean)
    .filter((blocker) => /^\s*status:\s*"?open"?\s*$/m.test(blocker));
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
    try {
      await access("scripts/run-wrangler.mjs");
      record(
        "frontend.wrangler.log_path_runner",
        "pass",
        "Wrangler commands must run through scripts/run-wrangler.mjs so logs stay in repo-local artifacts.",
      );
    } catch (error) {
      record("frontend.wrangler.log_path_runner", "fail", publicErrorMessage(error));
    }
    try {
      await access("scripts/wrangler-command-env.mjs");
      record(
        "cloudflare.wrangler.log_path_env_helper",
        "pass",
        "Cloudflare evidence scripts must share the repo-local Wrangler log path environment helper.",
      );
    } catch (error) {
      record("cloudflare.wrangler.log_path_env_helper", "fail", publicErrorMessage(error));
    }

    const requiredScripts = {
      "cf:build": "opennextjs-cloudflare build",
      "cf:preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
      "cf:deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
      "cf:typegen": "node scripts/run-wrangler.mjs types cloudflare-env.d.ts --env-interface CloudflareEnv --env-file .env.example --include-runtime false",
      "cf:web:dry-run": "node scripts/run-wrangler.mjs deploy --dry-run --env=\"\" --config wrangler.jsonc",
      "cf:web:dry-run:staging": "node scripts/run-wrangler.mjs deploy --dry-run --env staging --config wrangler.jsonc",
      "cf:web:dry-run:production": "node scripts/run-wrangler.mjs deploy --dry-run --env production --config wrangler.jsonc",
    };

    for (const [scriptName, expectedCommand] of Object.entries(requiredScripts)) {
      record(
        `frontend.opennext.script.${scriptName}`,
        scripts[scriptName] === expectedCommand ? "pass" : "fail",
        `package.json script ${scriptName} must run '${expectedCommand}'.`,
      );
    }

    const requiredApiWorkerScripts = {
      "cf:api:deploy:staging": "node scripts/run-wrangler.mjs deploy --config workers/api/wrangler.jsonc --env staging",
      "cf:api:deploy:production": "node scripts/run-wrangler.mjs deploy --config workers/api/wrangler.jsonc --env production",
    };

    for (const [scriptName, expectedCommand] of Object.entries(requiredApiWorkerScripts)) {
      record(
        `worker.api.script.${scriptName}`,
        scripts[scriptName] === expectedCommand ? "pass" : "fail",
        `package.json script ${scriptName} must run '${expectedCommand}'.`,
      );
    }

    const requiredQaScripts = {
      "qa:real-device": "node scripts/real-device-qa-evidence-check.mjs",
    };

    for (const [scriptName, expectedCommand] of Object.entries(requiredQaScripts)) {
      record(
        `real_device_qa.script.${scriptName}`,
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
    const parsed = parseDeploymentUrl(process.env[envVarName], envVarName, checkName);
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

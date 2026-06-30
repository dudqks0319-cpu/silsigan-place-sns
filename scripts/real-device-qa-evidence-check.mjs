#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const DEFAULT_LEDGER_PATH = "docs/real-device-qa.md";

const REQUIRED_ENVIRONMENT_ITEMS = [
  "Staging Pages URL",
  "Staging Worker API URL",
  "Staging API Worker deployment",
  "R2 staging bucket visibility",
  "TestFlight build",
  "Android internal/debug build",
];

const REQUIRED_IPHONE_FLOWS = [
  "App launch",
  "Naver map display",
  "Location allow",
  "Location deny",
  "Place detail",
  "Place click",
  "Comment create/delete",
  "Camera and photo library",
  "Photo upload/preview",
  "Like/unlike",
  "Ranking refresh",
  "Report/moderation",
  "Privacy redaction",
  "Crash check",
];

const REQUIRED_ANDROID_FLOWS = [
  "App launch",
  "Naver map display",
  "Location allow",
  "Location deny",
  "Back navigation",
  "Place detail",
  "Place click",
  "Comment create/delete",
  "Camera and photo library",
  "Photo upload/preview",
  "Like/unlike",
  "Ranking refresh",
  "Report/moderation",
  "Privacy redaction",
  "Crash check",
];

const REQUIRED_EVIDENCE_TOKENS = [
  "device-summary.md",
  "screenshots/",
  "network-redacted.json",
  "console-redacted.log",
  "known-issues.md",
];

const BLOCKED_VALUE_PATTERN =
  /\b(blocked|blocked-staging|missing|not selected|not_selected|todo|tbd|placeholder|not_applicable|R2_NOT_ENABLED|fail|failed)\b/i;
const PASS_VALUE_PATTERN = /\b(pass|passed|verified|complete|success)\b/i;
const SECRET_LIKE_PATTERN =
  /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN (RSA |OPENSSH |PRIVATE )?PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY[=:][^\s]+|JWT_SECRET[=:][^\s]+)/i;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const checks = [];
const ledgerPath = options.ledger ?? DEFAULT_LEDGER_PATH;

try {
  const ledger = await readFile(ledgerPath, "utf8");
  record("real_device_qa.ledger", "pass", "Real-device QA ledger is present.", { path: ledgerPath });
  checkSecretLikePatterns(ledger, ledgerPath);
  checkEnvironment(ledger);
  checkMatrix(ledger, "iphone", "## iPhone QA Matrix", REQUIRED_IPHONE_FLOWS);
  checkMatrix(ledger, "android", "## Android QA Matrix", REQUIRED_ANDROID_FLOWS);
  checkEvidenceArtifacts(ledger);
} catch (error) {
  record("real_device_qa.ledger", "fail", publicErrorMessage(error), { path: ledgerPath });
}

const failedChecks = checks.filter((check) => check.status === "fail");
const payload = {
  ok: failedChecks.length === 0,
  ledgerPath,
  blockers: failedChecks.map((check) => check.name),
  checks,
};

console.log(JSON.stringify(payload, null, 2));
process.exit(payload.ok ? 0 : 1);

function parseArgs(args) {
  const parsed = {};
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    const [name, ...valueParts] = arg.split("=");
    const value = valueParts.join("=");
    if ((name === "--ledger" || name === "--real-device-qa" || name === "--real-device-qa-ledger") && value) {
      parsed.ledger = value;
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Checks that docs/real-device-qa.md contains completed real-device evidence.

Usage:
  pnpm qa:real-device
  node scripts/real-device-qa-evidence-check.mjs --ledger=docs/real-device-qa.md

The check fails while the ledger still contains blocked-staging, missing, not selected,
R2_NOT_ENABLED, TODO/TBD, or non-pass QA matrix results.`);
}

function checkEnvironment(ledger) {
  const section = extractMarkdownSection(ledger, "## Environment");
  const rows = parseMarkdownTable(section);
  const missingItems = [];
  const blockedItems = [];

  for (const item of REQUIRED_ENVIRONMENT_ITEMS) {
    const row = rows.find((candidate) => normalizeKey(candidate[0]) === normalizeKey(item));
    if (!row) {
      missingItems.push(item);
      continue;
    }

    const value = row[1] ?? "";
    if (!isReadyEnvironmentValue(value)) {
      blockedItems.push({ item, value });
    }
  }

  record(
    "real_device_qa.environment.required_items",
    missingItems.length === 0 ? "pass" : "fail",
    missingItems.length === 0 ? "Real-device QA environment table includes all required release fields." : "Real-device QA environment table is missing required fields.",
    { missingItems },
  );
  record(
    "real_device_qa.environment.ready",
    blockedItems.length === 0 ? "pass" : "fail",
    blockedItems.length === 0
      ? "Real-device QA environment values are selected and not externally blocked."
      : "Real-device QA environment still contains missing, blocked, placeholder, or unselected values.",
    { blockedItems },
  );
}

function checkMatrix(ledger, platform, heading, requiredFlows) {
  const section = extractMarkdownSection(ledger, heading);
  const rows = parseMarkdownTable(section);
  const missingFlows = [];
  const blockedFlows = [];

  for (const flow of requiredFlows) {
    const row = rows.find((candidate) => normalizeKey(candidate[0]) === normalizeKey(flow));
    if (!row) {
      missingFlows.push(flow);
      continue;
    }

    const result = row[2] ?? "";
    if (!isPassingResult(result)) {
      blockedFlows.push({ flow, result });
    }
  }

  record(
    `real_device_qa.${platform}.matrix.required_flows`,
    missingFlows.length === 0 ? "pass" : "fail",
    missingFlows.length === 0 ? `${platform} QA matrix includes all required flows.` : `${platform} QA matrix is missing required flows.`,
    { missingFlows },
  );
  record(
    `real_device_qa.${platform}.matrix.results`,
    blockedFlows.length === 0 ? "pass" : "fail",
    blockedFlows.length === 0 ? `${platform} QA matrix results are all completed.` : `${platform} QA matrix still has blocked or non-pass results.`,
    { blockedFlows },
  );
}

function checkEvidenceArtifacts(ledger) {
  const missingTokens = REQUIRED_EVIDENCE_TOKENS.filter((token) => !ledger.includes(token));
  const iphoneArtifactPaths = [...ledger.matchAll(/artifacts\/real-device-qa\/\d{4}-\d{2}-\d{2}-iphone-[^\s`|)]+/g)].map((match) => match[0]);
  const androidArtifactPaths = [...ledger.matchAll(/artifacts\/real-device-qa\/\d{4}-\d{2}-\d{2}-android-[^\s`|)]+/g)].map((match) => match[0]);

  record(
    "real_device_qa.evidence.required_files",
    missingTokens.length === 0 ? "pass" : "fail",
    missingTokens.length === 0 ? "Real-device QA ledger names all required redacted evidence files." : "Real-device QA ledger is missing required evidence file names.",
    { missingTokens },
  );
  record(
    "real_device_qa.evidence.iphone_artifacts",
    iphoneArtifactPaths.length > 0 ? "pass" : "fail",
    iphoneArtifactPaths.length > 0 ? "Real-device QA ledger references dated iPhone evidence artifacts." : "Real-device QA ledger must reference a dated iPhone artifact directory.",
    { artifactPaths: iphoneArtifactPaths },
  );
  record(
    "real_device_qa.evidence.android_artifacts",
    androidArtifactPaths.length > 0 ? "pass" : "fail",
    androidArtifactPaths.length > 0 ? "Real-device QA ledger references dated Android evidence artifacts." : "Real-device QA ledger must reference a dated Android artifact directory.",
    { artifactPaths: androidArtifactPaths },
  );
}

function checkSecretLikePatterns(ledger, path) {
  record(
    "real_device_qa.redaction.secret_like_values",
    SECRET_LIKE_PATTERN.test(ledger) ? "fail" : "pass",
    `${path} must not contain secret-like values.`,
  );
}

function isReadyEnvironmentValue(value) {
  const normalized = String(value).trim();
  return normalized.length > 0 && !BLOCKED_VALUE_PATTERN.test(normalized);
}

function isPassingResult(value) {
  const normalized = String(value).trim();
  return normalized.length > 0 && !BLOCKED_VALUE_PATTERN.test(normalized) && PASS_VALUE_PATTERN.test(normalized);
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

function parseMarkdownTable(section) {
  const rows = [];
  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || !line.endsWith("|") || /^\|\s*-+\s*\|/.test(line)) {
      continue;
    }

    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length >= 2 && !cells.every((cell) => /^-+$/.test(cell))) {
      rows.push(cells);
    }
  }
  return rows;
}

function normalizeKey(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function publicErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function record(name, status, message, details = {}) {
  checks.push({
    name,
    status,
    message,
    ...details,
  });
}

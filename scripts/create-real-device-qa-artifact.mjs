#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_OUT_DIR = "artifacts/real-device-qa";
const ALLOWED_PLATFORMS = new Set(["iphone", "android"]);

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const errors = validateOptions(options);
if (errors.length > 0) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}

const platform = options.platform;
const date = options.date ?? new Date().toISOString().slice(0, 10);
const buildSlug = slugify(options.build);
const outDir = options.outDir ?? DEFAULT_OUT_DIR;
const artifactDir = join(outDir, `${date}-${platform}-${buildSlug}`);

if (existsSync(artifactDir) && !options.force) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        errors: [
          {
            code: "ARTIFACT_DIR_EXISTS",
            message: `${artifactDir} already exists. Use --force only when replacing a non-final local scaffold.`,
          },
        ],
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

await mkdir(join(artifactDir, "screenshots"), { recursive: true });
await Promise.all([
  writeFile(join(artifactDir, "device-summary.md"), buildDeviceSummary({ ...options, platform, date }), "utf8"),
  writeFile(join(artifactDir, "network-redacted.json"), "[]\n", "utf8"),
  writeFile(join(artifactDir, "console-redacted.log"), "No redacted console log captured yet.\n", "utf8"),
  writeFile(join(artifactDir, "known-issues.md"), "# Known issues\n\nNo issues recorded yet.\n", "utf8"),
  writeFile(join(artifactDir, "screenshots", ".gitkeep"), "", "utf8"),
]);

console.log(
  JSON.stringify(
    {
      ok: true,
      artifactDir,
      files: [
        "device-summary.md",
        "screenshots/",
        "network-redacted.json",
        "console-redacted.log",
        "known-issues.md",
      ],
    },
    null,
    2,
  ),
);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const rawArg = args[index];
    if (rawArg === "--help" || rawArg === "-h") {
      parsed.help = true;
      continue;
    }

    if (!rawArg.startsWith("--")) {
      continue;
    }

    const arg = rawArg.slice(2);
    if (arg === "force") {
      parsed.force = true;
      continue;
    }

    const separatorIndex = arg.indexOf("=");
    if (separatorIndex !== -1) {
      parsed[toCamelCase(arg.slice(0, separatorIndex))] = arg.slice(separatorIndex + 1);
      continue;
    }

    const nextArg = args[index + 1];
    if (nextArg && !nextArg.startsWith("--")) {
      parsed[toCamelCase(arg)] = nextArg;
      index += 1;
    }
  }
  return parsed;
}

function validateOptions(rawOptions) {
  const errors = [];
  if (!ALLOWED_PLATFORMS.has(rawOptions.platform)) {
    errors.push({
      code: "PLATFORM_REQUIRED",
      message: "--platform must be iphone or android.",
    });
  }

  if (!rawOptions.build || slugify(rawOptions.build).length === 0) {
    errors.push({
      code: "BUILD_REQUIRED",
      message: "--build is required and must contain at least one letter or number.",
    });
  }

  if (rawOptions.date && !/^\d{4}-\d{2}-\d{2}$/.test(rawOptions.date)) {
    errors.push({
      code: "DATE_INVALID",
      message: "--date must use YYYY-MM-DD.",
    });
  }

  return errors;
}

function buildDeviceSummary(rawOptions) {
  const rows = [
    ["Date", rawOptions.date],
    ["Platform", rawOptions.platform],
    ["Build", rawOptions.build],
    ["Device", rawOptions.device ?? "not captured"],
    ["OS", rawOptions.os ?? "not captured"],
    ["Staging Pages URL", rawOptions.stagingPagesUrl ?? "not captured"],
    ["Staging Worker API URL", rawOptions.stagingApiUrl ?? "not captured"],
    ["Tester", rawOptions.tester ?? "not captured"],
  ];

  return [
    "# Real-device QA evidence",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([field, value]) => `| ${field} | ${escapeTableCell(value)} |`),
    "",
    "## Flow Results",
    "",
    "Record each required flow from `docs/real-device-qa.md` here before marking the ledger row as pass.",
    "",
    "## Redaction Checklist",
    "",
    "- No raw tokens",
    "- No raw coordinates",
    "- No original filenames",
    "- No unredacted anonymous IDs",
    "- No private emails",
    "- No Cloudflare account identifiers",
    "",
  ].join("\n");
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function escapeTableCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function printHelp() {
  console.log(`Creates a real-device QA evidence artifact scaffold.

Usage:
  pnpm qa:real-device:init -- --platform=iphone --build=<build>
  pnpm qa:real-device:init -- --platform=android --build=<build>

Options:
  --platform=iphone|android    Required.
  --build=<build>              Required. Used in the artifact directory name.
  --date=YYYY-MM-DD            Defaults to today's UTC date.
  --out-dir=<path>             Defaults to artifacts/real-device-qa.
  --device=<name>              Optional device model.
  --os=<version>               Optional OS version.
  --tester=<name>              Optional tester label.
  --staging-pages-url=<url>    Optional staging Pages URL.
  --staging-api-url=<url>      Optional staging API URL.
  --force                      Replace a non-final local scaffold if it already exists.
`);
}

#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SECRET_KEY_PATTERN = /(TOKEN|SECRET|PASSWORD|PRIVATE|SERVICE_ROLE|API_KEY|SERVICE_KEY)/i;
const MIN_VALUE_LENGTH = 8;

if (isCliEntryPoint()) {
  const [envPath, buildPath] = process.argv.slice(2);
  if (!envPath || !buildPath) {
    console.error("Usage: node scripts/scan-build-env-secrets.mjs <env-file> <build-directory>");
    process.exitCode = 2;
  } else {
    const result = await scanBuildForEnvValues(envPath, buildPath);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  }
}

export async function scanBuildForEnvValues(envPath, buildPath) {
  const env = parseEnv(await readFile(envPath, "utf8"));
  const candidates = Object.entries(env)
    .filter(([key, value]) => SECRET_KEY_PATTERN.test(key) && value.length >= MIN_VALUE_LENGTH)
    .map(([key, value]) => ({ key, bytes: Buffer.from(value) }));
  const files = await listFiles(resolve(buildPath));
  const matchedKeys = new Set();

  for (const file of files) {
    const contents = await readFile(file);
    for (const candidate of candidates) {
      if (contents.includes(candidate.bytes)) {
        matchedKeys.add(candidate.key);
      }
    }
  }

  return {
    ok: matchedKeys.size === 0,
    scannedFiles: files.length,
    checkedSecretKeys: candidates.map(({ key }) => key).sort(),
    matchedSecretKeys: [...matchedKeys].sort(),
  };
}

export function parseEnv(source) {
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

async function listFiles(root) {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    return [root];
  }

  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function isCliEntryPoint() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EXPECTED_STAGING_PENDING_MIGRATIONS,
  STAGING_SCHEMA_RECOVERY_CONFIRMATION,
  buildLegacySchemaPreparationSql,
  classifyLegacySchemaPreflight,
  parseRecoveryCounters,
  resolveStagingSchemaRecoveryPlan,
  verifyBackupFile,
} from "../scripts/cloudflare-d1-staging-schema-recovery.mjs";

const exactCounters = {
  source_tables: 1,
  source_archive_tables: 0,
  source_rows: 0,
  source_total_columns: 15,
  source_old_columns: 3,
  source_new_columns: 0,
  source_named_indexes: 2,
  source_foreign_key_references: 0,
  cleanup_rows: 0,
  cleanup_total_columns: 10,
  cleanup_new_columns: 0,
  outbox_rows: 0,
  outbox_total_columns: 10,
  outbox_new_columns: 0,
  later_tables: 0,
  recovery_registry_rows: 0,
};

test("staging legacy preparation preserves the empty table and never edits migration history", () => {
  const sql = buildLegacySchemaPreparationSql();
  assert.match(sql, /ALTER TABLE source_ingestion_targets RENAME TO source_ingestion_targets_legacy_20260720/);
  assert.equal((sql.match(/DROP INDEX IF EXISTS/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE|INSERT|UPDATE|d1_migrations/i);
});

test("legacy recovery preflight requires the exact empty staging shape", () => {
  const pass = classifyLegacySchemaPreflight({
    pendingMigrations: [...EXPECTED_STAGING_PENDING_MIGRATIONS],
    boundaryCheck: { status: "fail", code: "D1_0018_NOT_APPLIED" },
    counters: { ...exactCounters },
  });
  assert.equal(pass.status, "pass");

  const dataPresent = classifyLegacySchemaPreflight({
    pendingMigrations: [...EXPECTED_STAGING_PENDING_MIGRATIONS],
    boundaryCheck: { status: "fail", code: "D1_0018_NOT_APPLIED" },
    counters: { ...exactCounters, source_rows: 1 },
  });
  assert.equal(dataPresent.code, "LEGACY_SCHEMA_SHAPE_MISMATCH");
  assert.deepEqual(dataPresent.mismatches, ["source_rows"]);

  const wrongBoundary = classifyLegacySchemaPreflight({
    pendingMigrations: [...EXPECTED_STAGING_PENDING_MIGRATIONS],
    boundaryCheck: { status: "fail", code: "D1_0020_NOT_APPLIED" },
    counters: { ...exactCounters },
  });
  assert.equal(wrongBoundary.code, "LEGACY_SCHEMA_BOUNDARY_MISMATCH");
});

test("recovery counters parse redacted Wrangler JSON output deterministically", () => {
  assert.deepEqual(
    parseRecoveryCounters('{"value":"source_rows=0"}\n{"value":"source_total_columns=15"}'),
    { source_rows: 0, source_total_columns: 15 },
  );
});

test("staging recovery apply requires confirmation and an external backup", async () => {
  const blocked = await resolveStagingSchemaRecoveryPlan({
    flags: new Set(["apply"]),
    options: new Map([["env", "staging"]]),
  });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.errors.map((error: { code: string }) => error.code), [
    "SCHEMA_RECOVERY_CONFIRMATION_REQUIRED",
    "BACKUP_EVIDENCE_REQUIRED",
  ]);

  const production = await resolveStagingSchemaRecoveryPlan({
    flags: new Set(["apply"]),
    options: new Map([
      ["env", "production"],
      ["confirmation", STAGING_SCHEMA_RECOVERY_CONFIRMATION],
      ["backup-path", "/private/tmp/staging.sql"],
      ["backup-sha256", "a".repeat(64)],
    ]),
  });
  assert.equal(production.errors[0]?.code, "STAGING_ONLY");
});

test("staging recovery verifies the exact external backup SHA-256", async () => {
  const directory = await mkdtemp(join(tmpdir(), "silsigan-d1-schema-recovery-"));
  const backupPath = join(directory, "staging.sql");
  const backup = "CREATE TABLE evidence(id INTEGER PRIMARY KEY);\n";
  await writeFile(backupPath, backup, { mode: 0o600 });
  try {
    const sha256 = createHash("sha256").update(backup).digest("hex");
    const pass = await verifyBackupFile({ backupPath, expectedSha256: sha256 });
    assert.equal(pass.status, "pass");
    const mismatch = await verifyBackupFile({ backupPath, expectedSha256: "0".repeat(64) });
    assert.equal(mismatch.code, "BACKUP_SHA256_MISMATCH");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

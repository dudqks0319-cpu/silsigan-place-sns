import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  D1_MIGRATION_BOUNDARY_QUERY,
  classifyD1MigrationBoundary,
} from "../scripts/cloudflare-d1-migration-boundary.mjs";
import {
  EXPECTED_STAGING_PENDING_MIGRATIONS,
  REGISTRY_REPAIR_MIGRATIONS,
  STAGING_REGISTRY_REPAIR_CONFIRMATION,
  buildRegistryRepairSql,
  classifyRegistryRepairPreflight,
  parseRegistryShape,
  resolveRegistryRepairPlan,
  verifyBackupFile,
} from "../scripts/cloudflare-d1-registry-reconcile.mjs";

const COMPLETE_BOUNDARY_COUNTERS = {
  m0006_core_tables: 2,
  m0006_core_indexes: 4,
  m0006_v2_tables: 6,
  m0006_trust_safety_tables: 7,
  m0006_preference_tables: 4,
  m0006_analytics_tables: 1,
  m0006_photo_cleanup_tables: 1,
  m0006_photo_budget_tables: 1,
  m0006_photo_abuse_tables: 3,
  m0006_photo_read_tables: 2,
  m0006_publication_tables: 5,
  m0006_live_signal_expiry: 1,
  m0006_place_accuracy: 1,
  m0006_place_moderation: 1,
  m0018_tables: 1,
  m0018_indexes: 2,
  m0019_cleanup_columns: 6,
  m0019_cleanup_indexes: 1,
  m0019_publication_columns: 5,
  m0019_publication_indexes: 1,
  m0020_tables: 1,
  m0021_tables: 1,
  m0021_indexes: 1,
  m0022_tables: 1,
  m0022_indexes: 1,
  m0023_tables: 1,
  m0023_indexes: 1,
  m0024_tables: 1,
  m0025_tables: 2,
  m0025_indexes: 2,
  m0025_triggers: 2,
  m0026_tables: 3,
  m0026_indexes: 1,
  m0026_warning_columns: 2,
};

function boundaryOutput(overrides: Partial<typeof COMPLETE_BOUNDARY_COUNTERS> = {}) {
  return Object.entries({ ...COMPLETE_BOUNDARY_COUNTERS, ...overrides })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

test("staging D1 registry repair SQL records only the verified migration names", () => {
  const sql = buildRegistryRepairSql();
  for (const migration of REGISTRY_REPAIR_MIGRATIONS) {
    assert.match(sql, new RegExp(migration.replaceAll(".", "\\.")));
  }
  assert.equal((sql.match(/INSERT INTO d1_migrations/g) ?? []).length, 8);
  assert.doesNotMatch(sql, /DROP|ALTER|UPDATE|DELETE/i);
  assert.throws(() => buildRegistryRepairSql(REGISTRY_REPAIR_MIGRATIONS.slice(0, -1)));
  assert.equal(parseRegistryShape('{"result":"d1_registry_shape=1"}'), true);
  assert.equal(parseRegistryShape('{"result":"d1_registry_shape=0"}'), false);
});

test("D1 boundary check reports the first incomplete schema instead of the last SQL error", () => {
  assert.match(D1_MIGRATION_BOUNDARY_QUERY, /pragma_table_info|sqlite_schema/);
  const missing0018 = classifyD1MigrationBoundary(
    { exitCode: 0, stdout: boundaryOutput({ m0018_indexes: 1 }) },
    "staging",
  );
  assert.equal(missing0018.code, "D1_0018_NOT_APPLIED");

  const missing0026 = classifyD1MigrationBoundary(
    { exitCode: 0, stdout: boundaryOutput({ m0026_tables: 0 }) },
    "staging",
  );
  assert.equal(missing0026.code, "D1_0026_NOT_APPLIED");

  const complete = classifyD1MigrationBoundary(
    { exitCode: 0, stdout: boundaryOutput() },
    "staging",
  );
  assert.equal(complete.status, "pass");
});

test("registry repair preflight requires the exact 0018 through 0026 boundary", () => {
  const ready = classifyRegistryRepairPreflight({
    envName: "staging",
    pendingMigrations: [...EXPECTED_STAGING_PENDING_MIGRATIONS],
    schemaCheck: { status: "fail", code: "D1_0026_NOT_APPLIED" },
    registeredRepairMigrations: [],
    registryShapeValid: true,
  });
  assert.equal(ready.status, "pass");
  assert.equal(ready.repairRequired, true);

  const wrongBoundary = classifyRegistryRepairPreflight({
    envName: "staging",
    pendingMigrations: [...EXPECTED_STAGING_PENDING_MIGRATIONS],
    schemaCheck: { status: "fail", code: "D1_0025_NOT_APPLIED" },
    registeredRepairMigrations: [],
    registryShapeValid: true,
  });
  assert.equal(wrongBoundary.code, "REGISTRY_REPAIR_SCHEMA_BOUNDARY_MISMATCH");

  const partial = classifyRegistryRepairPreflight({
    envName: "staging",
    pendingMigrations: [...EXPECTED_STAGING_PENDING_MIGRATIONS],
    schemaCheck: { status: "fail", code: "D1_0026_NOT_APPLIED" },
    registeredRepairMigrations: [REGISTRY_REPAIR_MIGRATIONS[0]],
    registryShapeValid: true,
  });
  assert.equal(partial.code, "REGISTRY_REPAIR_PARTIAL_STATE");

  const alreadyReconciled = classifyRegistryRepairPreflight({
    envName: "staging",
    pendingMigrations: ["0026_global_api_cost_guard.sql"],
    schemaCheck: { status: "fail", code: "D1_0026_NOT_APPLIED" },
    registeredRepairMigrations: [...REGISTRY_REPAIR_MIGRATIONS],
    registryShapeValid: true,
  });
  assert.equal(alreadyReconciled.status, "pass");
  assert.equal(alreadyReconciled.repairRequired, false);

  const wrongRegistryShape = classifyRegistryRepairPreflight({
    envName: "staging",
    pendingMigrations: [...EXPECTED_STAGING_PENDING_MIGRATIONS],
    schemaCheck: { status: "fail", code: "D1_0026_NOT_APPLIED" },
    registeredRepairMigrations: [],
    registryShapeValid: false,
  });
  assert.equal(wrongRegistryShape.code, "REGISTRY_REPAIR_TABLE_SHAPE_MISMATCH");
});

test("registry repair apply is staging-only and requires explicit confirmation plus backup evidence", async () => {
  const missingEvidence = await resolveRegistryRepairPlan({
    flags: new Set(["apply"]),
    options: new Map([["env", "staging"]]),
  });
  assert.equal(missingEvidence.ok, false);
  assert.deepEqual(
    missingEvidence.errors.map((error: { code: string }) => error.code),
    ["REGISTRY_REPAIR_CONFIRMATION_REQUIRED", "BACKUP_EVIDENCE_REQUIRED"],
  );

  const production = await resolveRegistryRepairPlan({
    flags: new Set(["apply"]),
    options: new Map([
      ["env", "production"],
      ["confirmation", STAGING_REGISTRY_REPAIR_CONFIRMATION],
      ["backup-path", "/private/tmp/backup.sql"],
      ["backup-sha256", "a".repeat(64)],
    ]),
  });
  assert.equal(production.errors[0]?.code, "STAGING_ONLY");
});

test("registry repair validates a non-empty external backup and exact SHA-256", async () => {
  const directory = await mkdtemp(join(tmpdir(), "silsigan-d1-registry-test-"));
  const backupPath = join(directory, "staging.sql");
  const backup = "CREATE TABLE evidence(id INTEGER PRIMARY KEY);\n";
  await writeFile(backupPath, backup, { mode: 0o600 });
  try {
    const expectedSha256 = createHash("sha256").update(backup).digest("hex");
    const valid = await verifyBackupFile({ backupPath, expectedSha256 });
    assert.equal(valid.status, "pass");
    assert.equal(valid.bytes, Buffer.byteLength(backup));

    const mismatch = await verifyBackupFile({ backupPath, expectedSha256: "0".repeat(64) });
    assert.equal(mismatch.code, "BACKUP_SHA256_MISMATCH");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

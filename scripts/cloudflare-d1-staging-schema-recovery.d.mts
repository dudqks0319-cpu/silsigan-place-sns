export type StagingSchemaRecoveryCheck = {
  name: string;
  status: "pass" | "fail";
  code?: string;
  message: string;
  mismatches?: string[];
  fileName?: string;
  bytes?: number;
};

export const STAGING_SCHEMA_RECOVERY_CONFIRMATION: string;
export const EXPECTED_STAGING_PENDING_MIGRATIONS: readonly string[];
export const STAGING_LEGACY_PREFLIGHT_QUERY: string;

export function parseArgs(rawArgs: string[]): { flags: Set<string>; options: Map<string, string> };
export function resolveStagingSchemaRecoveryPlan(input?: {
  flags?: Set<string>;
  options?: Map<string, string>;
}): Promise<{
  ok: boolean;
  mode: "plan-only" | "check" | "apply";
  apply: boolean;
  configPath: string;
  envName: string;
  databaseName: string | null;
  timeoutMs: number;
  backupPath: string | null;
  backupSha256: string | null;
  errors: Array<{ code: string; message: string }>;
}>;
export function buildLegacySchemaPreparationSql(): string;
export function parseRecoveryCounters(output: unknown): Record<string, number>;
export function classifyLegacySchemaPreflight(input: {
  pendingMigrations: readonly string[];
  boundaryCheck: { status?: string; code?: string };
  counters: Record<string, number>;
}): StagingSchemaRecoveryCheck;
export function verifyBackupFile(input: {
  backupPath: string | null;
  expectedSha256: string | null;
  workspacePath?: string;
}): Promise<StagingSchemaRecoveryCheck>;

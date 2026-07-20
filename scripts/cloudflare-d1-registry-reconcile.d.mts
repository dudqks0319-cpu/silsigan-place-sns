export type RegistryRepairCheck = {
  name: string;
  status: "pass" | "fail";
  code?: string;
  message: string;
  repairRequired?: boolean;
  fileName?: string;
  bytes?: number;
};

export type RegistryRepairPlan = {
  ok: boolean;
  mode: "plan-only" | "check" | "apply";
  apply: boolean;
  check: boolean;
  configPath: string;
  envName: string;
  databaseName: string | null;
  timeoutMs: number;
  backupPath: string | null;
  backupSha256: string | null;
  errors: Array<{ code: string; message: string }>;
};

export const STAGING_REGISTRY_REPAIR_CONFIRMATION: string;
export const REGISTRY_REPAIR_MIGRATIONS: readonly string[];
export const EXPECTED_STAGING_PENDING_MIGRATIONS: readonly string[];
export const D1_REGISTRY_SHAPE_QUERY: string;

export function parseArgs(rawArgs: string[]): {
  flags: Set<string>;
  options: Map<string, string>;
};

export function resolveRegistryRepairPlan(input?: {
  flags?: Set<string>;
  options?: Map<string, string>;
}): Promise<RegistryRepairPlan>;

export function buildRegistryRepairSql(migrations?: readonly string[]): string;

export function parseRegisteredRepairMigrations(output: unknown): string[];
export function parseRegistryShape(output: unknown): boolean;

export function classifyRegistryRepairPreflight(input: {
  envName: string;
  pendingMigrations: readonly string[];
  schemaCheck: { status?: string; code?: string };
  registeredRepairMigrations: readonly string[];
  registryShapeValid: boolean;
}): RegistryRepairCheck;

export function verifyBackupFile(input: {
  backupPath: string | null;
  expectedSha256: string | null;
  workspacePath?: string;
}): Promise<RegistryRepairCheck>;

export function executeRegistryRepairPlan(
  plan: RegistryRepairPlan,
  options?: {
    commandRunner?: (
      command: string,
      args: string[],
      timeoutMs: number,
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  },
): Promise<{ ok: boolean; results: RegistryRepairCheck[] }>;

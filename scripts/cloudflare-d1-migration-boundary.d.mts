export type D1MigrationBoundaryCheck = {
  name: string;
  status: "pass" | "fail";
  code?: string;
  message: string;
  missingRequirements?: string[];
  outputTail?: string;
};

export const D1_MIGRATION_BOUNDARY_QUERY: string;

export function classifyD1MigrationBoundary(
  result: { exitCode?: number; stdout?: unknown; stderr?: unknown },
  envName: string,
  options?: { sanitizeOutput?: (value: unknown) => string },
): D1MigrationBoundaryCheck;

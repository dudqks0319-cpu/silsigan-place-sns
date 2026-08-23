export type WebDeployAuthorization = {
  ok: boolean;
  mode: "apply" | "plan-only";
  errors: Array<{ code: string; message: string }>;
};

export function runWebDeploy(options?: { args?: string[]; root?: string }): Promise<Record<string, unknown>>;
export function validateWebDeployAuthorization(options: {
  apply: boolean;
  confirmStagingDeploy: boolean;
  providedDigest: string;
  recordedDigest: string;
  currentDigest: string;
}): WebDeployAuthorization;
export function parseWebDeployArguments(args: string[]): {
  apply: boolean;
  confirmStagingDeploy: boolean;
  candidateDigest: string;
  environment: string;
};
export function parseRecordedCandidateDigest(source: string): string;

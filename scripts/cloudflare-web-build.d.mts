export function buildCloudflareWeb(options?: { environment?: "staging" | "production"; root?: string }): Promise<{
  ok: true;
  environment: string;
  buildInputDigest: string;
  buildId: string;
  publicBuildKeys: string[];
  strippedSecretKeys: string[];
  middlewareManifestPatch: { status: "patched" | "already-safe" };
  secretScan: {
    ok: boolean;
    scannedFiles: number;
    checkedSecretKeys: string[];
    matchedSecretKeys: string[];
    skipped?: string;
  };
  workerSha256: string;
  assetSetDigest: string;
  assetCount: number;
}>;
export function parseEnvironmentArgument(args: string[]): "staging" | "production";
export function parseBuildEnv(configSource: string, environment?: "staging" | "production"): Record<string, string>;
export function shouldCopyBuildSource(sourcePath: string, root?: string): boolean;
export function computeWebBuildInputDigest(root?: string): Promise<string>;
export function computeDirectoryDigest(root: string): Promise<{ digest: string; fileCount: number }>;
export function patchOpenNextMiddlewareManifest(path: string): Promise<{ status: "patched" | "already-safe" }>;
export function patchOpenNextMiddlewareManifestSource(source: string): {
  source: string;
  status: "patched" | "already-safe";
};

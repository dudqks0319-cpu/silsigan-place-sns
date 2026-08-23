export function isServerSecretBuildKey(key: string): boolean;
export function stripServerSecretsFromBuildEnv(env: Record<string, string | undefined>): string[];

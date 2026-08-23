const SERVER_SECRET_BUILD_KEY_PATTERN = /(TOKEN|SECRET|PASSWORD|PRIVATE|SERVICE_ROLE|API_KEY|SERVICE_KEY)/i;

export function isServerSecretBuildKey(key) {
  return SERVER_SECRET_BUILD_KEY_PATTERN.test(String(key));
}

export function stripServerSecretsFromBuildEnv(env) {
  const removedKeys = [];
  for (const key of Object.keys(env)) {
    if (!isServerSecretBuildKey(key)) continue;
    delete env[key];
    removedKeys.push(key);
  }
  return removedKeys.sort();
}

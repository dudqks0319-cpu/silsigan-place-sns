export const WEBVIEW_APP_ID = "kr.silsigan.mobile";
export const WEBVIEW_APP_NAME = "#실시간";

type Environment = Readonly<Record<string, string | undefined>>;

export function createCapacitorConfig(env: Environment) {
  const deployment = requireDeployment(env);
  const firstPartyOrigins = requireFirstPartyOrigins(env, deployment.url.origin);

  return {
    appId: WEBVIEW_APP_ID,
    appName: WEBVIEW_APP_NAME,
    webDir: "web",
    server: {
      url: deployment.url.toString(),
      cleartext: false,
    },
    android: {
      allowMixedContent: false,
    },
    plugins: {
      SilsiganShell: {
        environment: deployment.name,
        firstPartyOrigins,
      },
    },
  } as const;
}

function requireDeployment(env: Environment): { name: "staging" | "production"; url: URL } {
  const name = env["SILSIGAN_WEBVIEW_ENV"];
  if (name !== "staging" && name !== "production") {
    throw new Error("SILSIGAN_WEBVIEW_ENV must be staging or production");
  }

  const variable = name === "staging" ? "SILSIGAN_STAGING_PAGES_URL" : "SILSIGAN_PRODUCTION_PAGES_URL";
  const rawUrl = env[variable];
  if (!rawUrl) throw new Error(`${variable} is required`);

  const url = parseProductionHttpsUrl(rawUrl, variable);
  if (url.search || url.hash) throw new Error(`${variable} must not include a query or fragment`);
  return { name, url };
}

function requireFirstPartyOrigins(env: Environment, deploymentOrigin: string): readonly string[] {
  const configured = env["SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS"];
  const values = configured ? configured.split(",").map((value) => value.trim()).filter(Boolean) : [deploymentOrigin];
  if (values.length === 0) throw new Error("SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS must not be empty");

  const origins = values.map((value) => {
    const url = parseProductionHttpsUrl(value, "SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS");
    if (url.origin !== value.replace(/\/$/, "") || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS must contain exact origins only");
    }
    return url.origin;
  });

  if (!origins.includes(deploymentOrigin)) {
    throw new Error("The deployment origin must be in SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS");
  }
  if (new Set(origins).size !== origins.length) throw new Error("First-party origins must be unique");
  return origins;
}

function parseProductionHttpsUrl(value: string, variable: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variable} must be a valid HTTPS URL`);
  }

  if (url.protocol !== "https:" || url.username || url.password || isLocalHost(url.hostname)) {
    throw new Error(`${variable} must be a non-local HTTPS URL without credentials`);
  }
  return url;
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "[::1]"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local");
}

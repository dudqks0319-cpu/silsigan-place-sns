import { getCloudflareContext } from "@opennextjs/cloudflare";

type ServiceBinding = {
  fetch: typeof fetch;
};

type ServiceContext = {
  env?: {
    SILSIGAN_API?: ServiceBinding;
  };
};

type ServiceFetcherOptions = {
  fallback?: typeof fetch;
  getContext?: () => ServiceContext;
};

export function getSilsiganApiFetcher(options: ServiceFetcherOptions = {}): typeof fetch {
  const fallback = options.fallback ?? fetch;

  try {
    const context = options.getContext?.() ?? (getCloudflareContext() as unknown as ServiceContext);
    const service = context.env?.SILSIGAN_API;
    if (service && typeof service.fetch === "function") {
      return service.fetch.bind(service) as typeof fetch;
    }
  } catch {
    // Local Next.js and unit-test runtimes do not have a Cloudflare request context.
  }

  return fallback;
}

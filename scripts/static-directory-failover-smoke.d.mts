export type DirectoryNetworkEvent = {
  url: string;
  method?: string;
  at?: string;
};

export function validateDirectoryFailoverNetwork(input: {
  networkEvents: DirectoryNetworkEvent[];
  pagesUrl: string;
  apiBaseUrl: string;
  baselineApiRequestCount: number;
}): {
  staticAssetRequestCount: number;
  baselineApiRequestCount: number;
  postFallbackApiRequestCount: number;
  providerRequestCount: number;
  analyticsRequestCount: number;
};

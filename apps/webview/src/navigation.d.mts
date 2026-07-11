export type NavigationDecision = "internal" | "external" | "blocked";

export function normalizeFirstPartyOrigins(values: readonly string[]): Set<string>;
export function classifyNavigation(rawUrl: string, firstPartyOrigins: readonly string[]): NavigationDecision;
export function openExternalNavigation(rawUrl: string, options?: {
  firstPartyOrigins?: readonly string[];
  browser?: { open(options: { url: string }): Promise<unknown> };
  openWindow?: (url: string, target: string, features: string) => unknown;
}): Promise<{ opened: "system" | "browser" }>;
export function installNavigationGuard(options: {
  document: Document;
  firstPartyOrigins: readonly string[];
  openExternal(url: string): Promise<unknown>;
}): () => void;

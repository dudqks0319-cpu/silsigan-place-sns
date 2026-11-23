import { createHash } from "node:crypto";
import type { DataResult, SourceInfo } from "../types.ts";

export type ProviderOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
};

export type ProviderRuntime = ReturnType<typeof createRuntime>;

export function createRuntime(options: ProviderOptions = {}) {
  const now = options.now ?? (() => new Date());
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? globalThis.fetch;
  const entries = new Map<string, { until: number; promise: Promise<DataResult<unknown>> }>();

  async function json(url: URL, headers?: Record<string, string>): Promise<unknown> {
    if (url.protocol !== "https:" || !["apis.data.go.kr", "dapi.kakao.com"].includes(url.hostname)) {
      throw new Error("Unsupported provider");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
    try {
      const response = await fetcher(url, {
        headers,
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Provider unavailable");
      if (Number(response.headers.get("content-length")) > 1_000_000) throw new Error("Response too large");
      const body = await response.text();
      if (body.length > 1_000_000) throw new Error("Response too large");
      return JSON.parse(body) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function cached<T>(key: string, ttlMs: number, load: () => Promise<DataResult<T>>): Promise<DataResult<T>> {
    const time = now().getTime();
    const hit = entries.get(key);
    if (hit && hit.until > time) return hit.promise as Promise<DataResult<T>>;
    if (entries.size >= 256) entries.delete(entries.keys().next().value as string);
    const entry = { until: time + ttlMs, promise: Promise.resolve(null) as unknown as Promise<DataResult<unknown>> };
    const promise = load().then((result) => {
      const expiry = result.expiresAt ? Date.parse(result.expiresAt) : Infinity;
      const remainingFreshness = expiry - now().getTime();
      // An already stale upstream result stays visibly stale without causing retry storms.
      const duration = result.data === null ? 30_000 : result.status === "fresh" && remainingFreshness > 0 ? Math.min(ttlMs, remainingFreshness) : ttlMs;
      entry.until = now().getTime() + Math.max(1_000, duration);
      return result;
    }).catch((error: unknown) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entry.promise = promise;
    entries.set(key, entry);
    return promise;
  }

  return { env, now, json, cached };
}

// Credentials affect cache identity without being retained in cache keys or responses.
export function credentialId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function serviceKey(value: string): string {
  try { return decodeURIComponent(value.trim()); } catch { return value.trim(); }
}

export function missing<T>(source: SourceInfo, message: string): DataResult<T> {
  return { status: "not_configured", data: null, source, observedAt: null, fetchedAt: null, expiresAt: null, message };
}

export function unavailable<T>(source: SourceInfo, now: Date, message: string): DataResult<T> {
  return { status: "unavailable", data: null, source, observedAt: null, fetchedAt: now.toISOString(), expiresAt: null, message };
}

export function numeric(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function freshness(observedAt: string, now: Date, maxAgeMinutes: number): "fresh" | "stale" | "unavailable" {
  const age = now.getTime() - Date.parse(observedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > 24 * 60 * 60_000) return "unavailable";
  return age > maxAgeMinutes * 60_000 ? "stale" : "fresh";
}

export function plusMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

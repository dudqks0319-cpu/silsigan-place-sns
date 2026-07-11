export type SourceHealthStatus = "healthy" | "degraded" | "down";

export type AdapterHealthResult = {
  status: SourceHealthStatus;
  checkedAt: string;
  responseTimeMs: number;
  message?: string;
};

export type AdapterFetchContext = {
  signal: AbortSignal;
  fetcher: typeof fetch;
};

export interface PublicDataAdapter<TQuery, TRaw, TNormalized> {
  readonly sourceKey: string;
  validateQuery(query: TQuery): void;
  cacheKey(query: TQuery): string;
  fetch(query: TQuery, context: AdapterFetchContext): Promise<unknown>;
  validateResponse(raw: unknown): TRaw;
  normalize(raw: TRaw, query: TQuery): TNormalized[];
  getObservedAt(item: TNormalized): Date | null;
  getExpiresAt(item: TNormalized): Date | null;
  getAttribution(): string;
  healthCheck(query: TQuery, context: AdapterFetchContext): Promise<AdapterHealthResult>;
}

export type PublicDataCache = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export type GatewayPolicy = {
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  timeoutMs?: number;
  maxAttempts?: number;
};

export type GatewayResult<TNormalized> = {
  items: TNormalized[];
  sourceKey: string;
  attribution: string;
  fetchedAt: string;
  payloadHash?: string;
  cacheStatus: "network" | "fresh" | "stale";
  healthStatus: SourceHealthStatus;
};

export class PublicDataGatewayError extends Error {
  readonly code:
    | "INVALID_ADAPTER_QUERY"
    | "SOURCE_TIMEOUT"
    | "SOURCE_QUOTA_EXCEEDED"
    | "SOURCE_HTTP_ERROR"
    | "SOURCE_INVALID_RESPONSE"
    | "SOURCE_CIRCUIT_OPEN";
  readonly retryable: boolean;

  constructor(
    code: PublicDataGatewayError["code"],
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "PublicDataGatewayError";
    this.code = code;
    this.retryable = retryable;
  }
}

type CacheEnvelope<TNormalized> = {
  items: TNormalized[];
  attribution: string;
  fetchedAt: string;
  payloadHash?: string;
  freshUntil: string;
  staleUntil: string;
};

type CircuitState = {
  consecutiveFailures: number;
  openUntilMs: number;
};

export type PublicDataGatewayOptions = {
  cache?: PublicDataCache;
  fetcher?: typeof fetch;
  now?: () => Date;
  sleep?: (delayMs: number) => Promise<void>;
  circuitFailureThreshold?: number;
  circuitOpenMs?: number;
};

export class PublicDataGateway {
  private readonly cache?: PublicDataCache;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly circuitFailureThreshold: number;
  private readonly circuitOpenMs: number;
  private readonly circuits = new Map<string, CircuitState>();

  constructor(options: PublicDataGatewayOptions = {}) {
    this.cache = options.cache;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.circuitFailureThreshold = options.circuitFailureThreshold ?? 3;
    this.circuitOpenMs = options.circuitOpenMs ?? 60_000;
  }

  async execute<TQuery, TRaw, TNormalized>(
    adapter: PublicDataAdapter<TQuery, TRaw, TNormalized>,
    query: TQuery,
    policy: GatewayPolicy,
  ): Promise<GatewayResult<TNormalized>> {
    validatePolicy(policy);
    try {
      adapter.validateQuery(query);
    } catch {
      throw new PublicDataGatewayError("INVALID_ADAPTER_QUERY", "공공데이터 조회 조건이 올바르지 않습니다.", false);
    }

    const cacheKey = gatewayCacheKey(adapter.sourceKey, adapter.cacheKey(query));
    const now = this.now();
    const cached = await this.readCache<TNormalized>(cacheKey);
    if (cached && Date.parse(cached.freshUntil) > now.getTime()) {
      return resultFromCache(adapter.sourceKey, cached, "fresh", "healthy");
    }

    const circuit = this.circuits.get(adapter.sourceKey);
    if (circuit && circuit.openUntilMs > now.getTime()) {
      if (cached && Date.parse(cached.staleUntil) > now.getTime()) {
        return resultFromCache(adapter.sourceKey, cached, "stale", "degraded");
      }
      throw new PublicDataGatewayError("SOURCE_CIRCUIT_OPEN", "데이터 출처가 일시적으로 중단됐습니다.", true);
    }

    try {
      const raw = await this.fetchWithRetry(adapter, query, policy);
      const payloadHash = await sha256Payload(raw);
      let validated: TRaw;
      let items: TNormalized[];
      try {
        validated = adapter.validateResponse(raw);
        items = adapter.normalize(validated, query);
      } catch {
        throw new PublicDataGatewayError("SOURCE_INVALID_RESPONSE", "데이터 출처 응답 형식이 변경됐습니다.", false);
      }
      if (!Array.isArray(items)) {
        throw new PublicDataGatewayError("SOURCE_INVALID_RESPONSE", "데이터 출처 응답 형식이 올바르지 않습니다.", false);
      }

      const fetchedAt = this.now();
      const envelope: CacheEnvelope<TNormalized> = {
        items,
        attribution: adapter.getAttribution(),
        fetchedAt: fetchedAt.toISOString(),
        payloadHash,
        freshUntil: new Date(fetchedAt.getTime() + policy.freshTtlSeconds * 1_000).toISOString(),
        staleUntil: new Date(fetchedAt.getTime() + policy.staleTtlSeconds * 1_000).toISOString(),
      };
      if (this.cache) {
        await this.cache.put(cacheKey, JSON.stringify(envelope), { expirationTtl: policy.staleTtlSeconds });
      }
      this.circuits.delete(adapter.sourceKey);

      return {
        items,
        sourceKey: adapter.sourceKey,
        attribution: envelope.attribution,
        fetchedAt: envelope.fetchedAt,
        payloadHash,
        cacheStatus: "network",
        healthStatus: "healthy",
      };
    } catch (error) {
      this.recordFailure(adapter.sourceKey, this.now().getTime());
      if (cached && Date.parse(cached.staleUntil) > this.now().getTime()) {
        return resultFromCache(adapter.sourceKey, cached, "stale", "degraded");
      }
      throw normalizeGatewayError(error);
    }
  }

  private async fetchWithRetry<TQuery, TRaw, TNormalized>(
    adapter: PublicDataAdapter<TQuery, TRaw, TNormalized>,
    query: TQuery,
    policy: GatewayPolicy,
  ): Promise<unknown> {
    const maxAttempts = policy.maxAttempts ?? 2;
    const timeoutMs = policy.timeoutMs ?? 5_000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await adapter.fetch(query, { signal: controller.signal, fetcher: this.fetcher });
      } catch (error) {
        lastError = controller.signal.aborted
          ? new PublicDataGatewayError("SOURCE_TIMEOUT", "데이터 출처 응답 시간이 초과됐습니다.", true)
          : normalizeGatewayError(error);
        if (!(lastError instanceof PublicDataGatewayError) || !lastError.retryable || attempt >= maxAttempts) {
          throw lastError;
        }
      } finally {
        clearTimeout(timeout);
      }

      await this.sleep(100 * 2 ** (attempt - 1));
    }

    throw normalizeGatewayError(lastError);
  }

  private async readCache<TNormalized>(key: string): Promise<CacheEnvelope<TNormalized> | null> {
    if (!this.cache) return null;
    const raw = await this.cache.get(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<CacheEnvelope<TNormalized>>;
      if (
        !Array.isArray(parsed.items) ||
        typeof parsed.attribution !== "string" ||
        typeof parsed.fetchedAt !== "string" ||
        typeof parsed.freshUntil !== "string" ||
        typeof parsed.staleUntil !== "string"
      ) {
        return null;
      }
      return parsed as CacheEnvelope<TNormalized>;
    } catch {
      return null;
    }
  }

  private recordFailure(sourceKey: string, nowMs: number): void {
    const previous = this.circuits.get(sourceKey) ?? { consecutiveFailures: 0, openUntilMs: 0 };
    const consecutiveFailures = previous.consecutiveFailures + 1;
    this.circuits.set(sourceKey, {
      consecutiveFailures,
      openUntilMs: consecutiveFailures >= this.circuitFailureThreshold ? nowMs + this.circuitOpenMs : 0,
    });
  }
}

export async function fetchJsonSource(url: URL, context: AdapterFetchContext): Promise<unknown> {
  let response: Response;
  try {
    response = await context.fetcher(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: context.signal,
    });
  } catch (error) {
    if (context.signal.aborted) throw error;
    throw new PublicDataGatewayError("SOURCE_HTTP_ERROR", "데이터 출처에 연결할 수 없습니다.", true);
  }

  if (response.status === 429) {
    throw new PublicDataGatewayError("SOURCE_QUOTA_EXCEEDED", "데이터 출처 요청 한도를 초과했습니다.", true);
  }
  if (!response.ok) {
    throw new PublicDataGatewayError(
      "SOURCE_HTTP_ERROR",
      "데이터 출처가 오류 응답을 반환했습니다.",
      response.status >= 500,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new PublicDataGatewayError("SOURCE_INVALID_RESPONSE", "데이터 출처가 JSON을 반환하지 않았습니다.", false);
  }
}

function validatePolicy(policy: GatewayPolicy): void {
  if (
    !Number.isInteger(policy.freshTtlSeconds) ||
    !Number.isInteger(policy.staleTtlSeconds) ||
    policy.freshTtlSeconds <= 0 ||
    policy.staleTtlSeconds < policy.freshTtlSeconds ||
    (policy.timeoutMs !== undefined && (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs <= 0)) ||
    (policy.maxAttempts !== undefined && (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 4))
  ) {
    throw new Error("Invalid public data gateway policy");
  }
}

function gatewayCacheKey(sourceKey: string, queryKey: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(sourceKey) || !queryKey || queryKey.length > 300) {
    throw new PublicDataGatewayError("INVALID_ADAPTER_QUERY", "공공데이터 캐시 키가 올바르지 않습니다.", false);
  }
  return `public-data:v1:${sourceKey}:${queryKey}`;
}

function resultFromCache<TNormalized>(
  sourceKey: string,
  cached: CacheEnvelope<TNormalized>,
  cacheStatus: "fresh" | "stale",
  healthStatus: SourceHealthStatus,
): GatewayResult<TNormalized> {
  return {
    items: cached.items,
    sourceKey,
    attribution: cached.attribution,
    fetchedAt: cached.fetchedAt,
    ...(cached.payloadHash ? { payloadHash: cached.payloadHash } : {}),
    cacheStatus,
    healthStatus,
  };
}

function normalizeGatewayError(error: unknown): PublicDataGatewayError {
  if (error instanceof PublicDataGatewayError) return error;
  return new PublicDataGatewayError("SOURCE_HTTP_ERROR", "데이터 출처 조회에 실패했습니다.", true);
}

async function sha256Payload(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

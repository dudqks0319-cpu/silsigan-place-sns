import type { CloudflarePlaceStatus } from "./cloudflare-api";

type ExpiringRecord = {
  expiresAt?: string | null;
};

export function hasCurrentExpiry(record: ExpiringRecord, nowMs: number): boolean {
  if (!record.expiresAt) {
    return false;
  }

  const expiryMs = Date.parse(record.expiresAt);
  return Number.isFinite(expiryMs) && expiryMs > nowMs;
}

export function currentPlaceStatus(
  status: CloudflarePlaceStatus | null | undefined,
  nowMs: number,
): CloudflarePlaceStatus | null {
  if (!status || status.dataMode !== "live") {
    return null;
  }

  const currentSignals = status.currentSignals.filter(
    (signal) => signal.sourceType !== "official_static" && hasCurrentExpiry(signal, nowMs),
  );
  if (currentSignals.length === status.currentSignals.length && currentSignals.length > 0) {
    return status;
  }

  const confidenceScore = currentSignals.length
    ? Number(
        (
          currentSignals.reduce((total, signal) => total + signal.confidenceScore, 0) /
          currentSignals.length
        ).toFixed(3),
      )
    : 0;
  const observedAt = currentSignals
    .map((signal) => signal.observedAt)
    .sort()
    .at(-1) ?? null;

  return {
    ...status,
    status: "insufficient",
    currentSignals,
    independentSourceCount: new Set(currentSignals.map((signal) => signal.sourceId)).size,
    confidenceScore,
    reasonCodes: [
      ...new Set([
        ...status.reasonCodes,
        status.currentSignals.length > currentSignals.length
          ? "client_expired_signal_filtered"
          : "client_no_current_signal",
      ]),
    ],
    observedAt: currentSignals.length > 0 ? observedAt : null,
  };
}

export function nextExpiryDelay(records: readonly ExpiringRecord[], nowMs: number): number | null {
  const nextExpiryMs = records
    .map((record) => record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN)
    .filter((expiryMs) => Number.isFinite(expiryMs) && expiryMs > nowMs)
    .sort((left, right) => left - right)[0];

  return nextExpiryMs === undefined ? null : Math.max(0, nextExpiryMs - nowMs);
}

export function createRequestGeneration() {
  let current = 0;

  return {
    begin(): number {
      current += 1;
      return current;
    },
    isCurrent(generation: number): boolean {
      return generation === current;
    },
  };
}

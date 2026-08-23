import {
  evidenceTypes,
  liveSignalDimensions,
  liveSignalSourceTypes,
  type AggregatedPlaceStatus,
  type DecisionDimensionRule,
  type DecisionProfile,
  type LiveSignal,
  type LiveSignalDimension,
} from "./types.ts";

const currentStateSourceTypes = new Set([
  "official_live",
  "official_periodic",
  "venue_operator",
  "verified_ugc",
  "ugc",
  "consensus",
  "model_estimate",
]);

const authoritativeSourceTypes = new Set(["official_live", "official_periodic", "venue_operator"]);
const notObservedValueCodes = new Set(["", "unknown", "not_observed", "확인하지 못함"]);

const observedValueCodes = {
  crowd: new Set(["quiet", "normal", "busy", "packed"]),
  queue: new Set(["none", "under_10", "10_to_30", "30_to_60", "60_plus"]),
  parking: new Set(["available", "limited", "almost_full", "full", "closed"]),
  local_condition: new Set([
    "rain",
    "snow",
    "strong_wind",
    "slippery",
    "entry_restricted",
    "event",
    "temporary_closed",
  ]),
} as const;

export type ObservedReportInput = {
  crowd?: string | null;
  queue?: string | null;
  parking?: string | null;
  localConditions?: readonly string[];
};

export function validateLiveSignal(input: unknown): LiveSignal {
  if (!input || typeof input !== "object") {
    throw new Error("LiveSignal must be an object");
  }

  const candidate = input as Partial<LiveSignal>;
  requireText(candidate.id, "id");
  requireText(candidate.placeId, "placeId");
  requireEnum(candidate.dimension, liveSignalDimensions, "dimension");
  requireText(candidate.valueCode, "valueCode");
  requireText(candidate.sourceId, "sourceId");
  requireEnum(candidate.sourceType, liveSignalSourceTypes, "sourceType");
  requireText(candidate.sourceName, "sourceName");
  const observedAt = requireTimestamp(candidate.observedAt, "observedAt");
  requireTimestamp(candidate.fetchedAt, "fetchedAt");

  if (candidate.expiresAt) {
    const expiresAt = requireTimestamp(candidate.expiresAt, "expiresAt");
    if (expiresAt.getTime() <= observedAt.getTime()) {
      throw new Error("expiresAt must be later than observedAt");
    }
  }

  if (
    typeof candidate.confidenceScore !== "number" ||
    !Number.isFinite(candidate.confidenceScore) ||
    candidate.confidenceScore < 0 ||
    candidate.confidenceScore > 1
  ) {
    throw new Error("confidenceScore must be between 0 and 1");
  }
  if (typeof candidate.isEstimated !== "boolean") {
    throw new Error("isEstimated must be boolean");
  }
  if (typeof candidate.isPubliclyVisible !== "boolean") {
    throw new Error("isPubliclyVisible must be boolean");
  }
  if (candidate.evidenceType !== undefined) {
    requireEnum(candidate.evidenceType, evidenceTypes, "evidenceType");
  }

  return candidate as LiveSignal;
}

export function isLiveSignalCurrent(signal: unknown, now: Date = new Date()): signal is LiveSignal {
  let current: LiveSignal;
  try {
    current = validateLiveSignal(signal);
  } catch {
    return false;
  }

  if (!current.isPubliclyVisible || !currentStateSourceTypes.has(current.sourceType)) {
    return false;
  }
  if (new Date(current.observedAt).getTime() > now.getTime()) {
    return false;
  }
  if (!current.expiresAt) {
    return false;
  }
  return new Date(current.expiresAt).getTime() > now.getTime();
}

export function resolveSignalExpiry(input: {
  observedAt: string;
  dimension: LiveSignalDimension;
  ttlSecondsByDimension: Partial<Record<LiveSignalDimension, number>>;
}): string {
  const observedAt = requireTimestamp(input.observedAt, "observedAt");
  const ttlSeconds = input.ttlSecondsByDimension[input.dimension];
  if (!Number.isInteger(ttlSeconds) || (ttlSeconds ?? 0) <= 0) {
    throw new Error(`TTL is not configured for ${input.dimension}`);
  }
  return new Date(observedAt.getTime() + (ttlSeconds as number) * 1_000).toISOString();
}

export function aggregatePlaceSignals(
  signals: readonly unknown[],
  profile: DecisionProfile,
  now: Date = new Date(),
): AggregatedPlaceStatus {
  const profileDimensions = new Set(profile.dimensions.map((rule) => rule.dimension));
  const currentSignals = signals
    .filter((signal): signal is LiveSignal => isLiveSignalCurrent(signal, now))
    .filter((signal) => profileDimensions.has(signal.dimension));
  const selectedSignals: AggregatedPlaceStatus["selectedSignals"] = {};
  const conflictingDimensions: LiveSignalDimension[] = [];

  for (const rule of profile.dimensions) {
    const dimensionSignals = currentSignals
      .filter((signal) => signal.dimension === rule.dimension)
      .sort(compareSignals);
    if (dimensionSignals.length === 0) {
      continue;
    }
    selectedSignals[rule.dimension] = dimensionSignals[0];
    if (new Set(dimensionSignals.map((signal) => signal.valueCode)).size > 1) {
      conflictingDimensions.push(rule.dimension);
    }
  }

  const missingRequiredDimensions = profile.dimensions
    .filter((rule) => rule.required && !selectedSignals[rule.dimension])
    .map((rule) => rule.dimension);
  const independentSourceCount = new Set(currentSignals.map(independentEvidenceKey)).size;
  const negativeEvidence = collectNegativeEvidence(currentSignals, profile.dimensions);
  const positiveSelected = profile.dimensions.filter((rule) => {
    const selected = selectedSignals[rule.dimension];
    return selected ? rule.positiveValueCodes.includes(selected.valueCode) : false;
  });

  let status: AggregatedPlaceStatus["status"] = "insufficient";
  const reasonCodes: string[] = [];

  if (negativeEvidence.authoritative || negativeEvidence.independentSourceCount >= 2) {
    status = "likely_crowded";
    reasonCodes.push("negative_current_evidence");
  } else if (missingRequiredDimensions.length > 0) {
    reasonCodes.push("required_dimension_missing");
  } else if (conflictingDimensions.length > 0) {
    status = "check_before_visit";
    reasonCodes.push("conflicting_current_evidence");
  } else if (positiveSelected.length >= 2 && independentSourceCount >= 2) {
    status = "likely_good";
    reasonCodes.push("independent_positive_evidence");
  } else if (currentSignals.length > 0) {
    status = "check_before_visit";
    reasonCodes.push("limited_current_evidence");
  } else {
    reasonCodes.push("no_current_evidence");
  }

  const confidenceScore = currentSignals.length
    ? Number(
        (
          currentSignals.reduce((total, signal) => total + signal.confidenceScore, 0) /
          currentSignals.length
        ).toFixed(3),
      )
    : 0;

  return {
    status,
    currentSignals,
    selectedSignals,
    missingRequiredDimensions,
    conflictingDimensions,
    independentSourceCount,
    confidenceScore,
    reasonCodes,
    computedAt: now.toISOString(),
  };
}

export function listObservedReportSignals(input: ObservedReportInput): Array<{
  dimension: "crowd" | "queue" | "parking" | "local_condition";
  valueCode: string;
}> {
  const result: Array<{
    dimension: "crowd" | "queue" | "parking" | "local_condition";
    valueCode: string;
  }> = [];

  appendObservation(result, "crowd", input.crowd);
  appendObservation(result, "queue", input.queue);
  appendObservation(result, "parking", input.parking);
  for (const condition of input.localConditions ?? []) {
    appendObservation(result, "local_condition", condition);
  }
  return result;
}

function appendObservation(
  output: Array<{ dimension: "crowd" | "queue" | "parking" | "local_condition"; valueCode: string }>,
  dimension: "crowd" | "queue" | "parking" | "local_condition",
  rawValue: string | null | undefined,
): void {
  const valueCode = rawValue?.trim() ?? "";
  if (notObservedValueCodes.has(valueCode)) {
    return;
  }
  if (!observedValueCodes[dimension].has(valueCode as never)) {
    throw new Error(`Unsupported ${dimension} value: ${valueCode}`);
  }
  output.push({ dimension, valueCode });
}

function collectNegativeEvidence(
  signals: readonly LiveSignal[],
  rules: readonly DecisionDimensionRule[],
): { authoritative: boolean; independentSourceCount: number } {
  const negativeSignals = signals.filter((signal) => {
    const rule = rules.find((candidate) => candidate.dimension === signal.dimension);
    return rule?.negativeValueCodes.includes(signal.valueCode) ?? false;
  });
  return {
    authoritative: negativeSignals.some((signal) => authoritativeSourceTypes.has(signal.sourceType)),
    independentSourceCount: new Set(negativeSignals.map(independentEvidenceKey)).size,
  };
}

function independentEvidenceKey(signal: LiveSignal): string {
  if (signal.sourceType === "ugc" || signal.sourceType === "verified_ugc") {
    const actorKey = signal.metadata?.actorKey;
    if (typeof actorKey === "string" && actorKey) {
      return `actor:${actorKey}`;
    }
    if (signal.evidenceId) {
      return `evidence:${signal.evidenceId}`;
    }
  }
  return `source:${signal.sourceId}`;
}

function compareSignals(left: LiveSignal, right: LiveSignal): number {
  if (right.confidenceScore !== left.confidenceScore) {
    return right.confidenceScore - left.confidenceScore;
  }
  return new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime();
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
}

function requireTimestamp(value: unknown, field: string): Date {
  requireText(value, field);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return date;
}

function requireEnum<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  field: string,
): asserts value is TValue {
  if (typeof value !== "string" || !allowed.includes(value as TValue)) {
    throw new Error(`${field} is not supported`);
  }
}

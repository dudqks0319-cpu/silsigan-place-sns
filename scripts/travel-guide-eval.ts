import { buildGroundedTravelGuide, type GroundedTravelGuideInput } from "../src/lib/travel-guide.ts";

type EvalCase = {
  id: string;
  input: GroundedTravelGuideInput;
  expectedDecision: ReturnType<typeof buildGroundedTravelGuide>["decision"];
};

const baseInput: GroundedTravelGuideInput = {
  dataMode: "live",
  status: "likely_good",
  signalCount: 3,
  missingRequiredDimensions: [],
  conflictingDimensions: [],
  alternativeCount: 3,
  officialTourismPlace: {
    contentId: "126508",
    name: "광안리해수욕장",
    address: "부산광역시 수영구 광안해변로 219",
    sourceName: "한국관광공사 TourAPI",
    attributionText: "한국관광공사",
    verifiedAt: "2026-07-20T00:00:00.000Z",
  },
};

const cases: EvalCase[] = [
  { id: "current-positive-signals", input: baseInput, expectedDecision: "go_now" },
  {
    id: "crowded-with-alternatives",
    input: { ...baseInput, status: "likely_crowded" },
    expectedDecision: "alternatives",
  },
  {
    id: "crowded-without-alternatives",
    input: { ...baseInput, status: "likely_crowded", alternativeCount: 0 },
    expectedDecision: "wait",
  },
  {
    id: "missing-required-weather",
    input: { ...baseInput, missingRequiredDimensions: ["weather"] },
    expectedDecision: "wait",
  },
  {
    id: "conflicting-crowd-sources",
    input: { ...baseInput, conflictingDimensions: ["crowd"] },
    expectedDecision: "wait",
  },
  {
    id: "no-current-evidence",
    input: { ...baseInput, signalCount: 0 },
    expectedDecision: "insufficient",
  },
  {
    id: "sample-never-promoted",
    input: { ...baseInput, dataMode: "sample" },
    expectedDecision: "insufficient",
  },
  {
    id: "cost-guard-directory-mode",
    input: { ...baseInput, dataMode: "directory" },
    expectedDecision: "insufficient",
  },
];

const results = cases.map((entry) => {
  const guide = buildGroundedTravelGuide(entry.input);
  return {
    id: entry.id,
    expectedDecision: entry.expectedDecision,
    actualDecision: guide.decision,
    passed: guide.decision === entry.expectedDecision,
  };
});
const failed = results.filter((result) => !result.passed);

console.log(JSON.stringify({
  harness: "travel-guide-grounding-v1",
  passed: results.length - failed.length,
  failed: failed.length,
  total: results.length,
  results,
}, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}

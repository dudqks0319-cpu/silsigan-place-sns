import assert from "node:assert/strict";
import test from "node:test";
import { areMapClusterPointsClose, clusterMapPlaces } from "../src/lib/map-clusters.ts";

test("map places form deterministic geographic clusters", () => {
  const clusters = clusterMapPlaces([
    { id: "busan-a", latitude: 35.12, longitude: 129.08 },
    { id: "busan-b", latitude: 35.18, longitude: 129.13 },
    { id: "gyeongju", latitude: 35.86, longitude: 129.21 },
  ]);

  assert.deepEqual(
    clusters.map((cluster) => cluster.places.map((place) => place.id)),
    [["busan-a", "busan-b"], ["gyeongju"]],
  );
  assert.equal(clusters[0]?.id, "cluster:busan-a|busan-b");
  assert.ok(Math.abs((clusters[0]?.latitude ?? 0) - 35.15) < 1e-9);
  assert.ok(Math.abs((clusters[0]?.longitude ?? 0) - 129.105) < 1e-9);
  assert.equal(clusters[1]?.id, "place:gyeongju");
});

test("cluster proximity uses explicit latitude and longitude thresholds", () => {
  assert.equal(
    areMapClusterPointsClose(
      { id: "left", latitude: 35, longitude: 129 },
      { id: "right", latitude: 35.05, longitude: 129.05 },
      { latitude: 0.06, longitude: 0.06 },
    ),
    true,
  );
  assert.equal(
    areMapClusterPointsClose(
      { id: "left", latitude: 35, longitude: 129 },
      { id: "right", latitude: 35.07, longitude: 129.05 },
      { latitude: 0.06, longitude: 0.06 },
    ),
    false,
  );
});

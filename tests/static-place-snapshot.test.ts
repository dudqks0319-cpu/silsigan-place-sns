import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  STATIC_PLACE_DIRECTORY_SCHEMA,
  STATIC_PLACE_DIRECTORY_TRUTH_POLICY,
  filterStaticPlaceDirectory,
  parseStaticPlaceDirectory,
} from "../src/lib/static-place-snapshot.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(testDir, "../public/silsigan/snapshots/nationwide-places.v1.json");
const wranglerPath = resolve(testDir, "../wrangler.jsonc");
const snapshotFixture = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, unknown>;

function freshSnapshot(): Record<string, unknown> {
  return structuredClone(snapshotFixture);
}

test("static nationwide directory contains only verified non-live place fields", () => {
  const directory = parseStaticPlaceDirectory(freshSnapshot());

  assert.equal(directory.schemaVersion, STATIC_PLACE_DIRECTORY_SCHEMA);
  assert.equal(directory.truthPolicy, STATIC_PLACE_DIRECTORY_TRUTH_POLICY);
  assert.equal(directory.places.length, 5);
  assert.deepEqual(
    directory.places.map((place) => place.id),
    ["busan-gwangalli", "ulsan-taehwagang", "gyeongju-hwangridan", "ulsan-city-hall", "seoul-yeouido"],
  );
  assert.ok(directory.places.every((place) => place.coordinateStatus === "verified"));
  assert.ok(directory.places.every((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude)));

  const allowedPlaceKeys = [
    "address",
    "areaId",
    "categoryId",
    "coordinateStatus",
    "id",
    "latitude",
    "launchStage",
    "longitude",
    "name",
    "regionId",
  ];
  for (const place of snapshotFixture.places as Array<Record<string, unknown>>) {
    assert.deepEqual(Object.keys(place).sort(), allowedPlaceKeys);
    for (const forbiddenKey of ["score", "reports", "photos", "observedAt", "updatedAt", "userId", "anonymousId"]) {
      assert.equal(forbiddenKey in place, false);
    }
  }
});

test("static directory rejects unexpected live fields, unsafe IDs, duplicates, and unverified coordinates", () => {
  const withLiveScore = freshSnapshot();
  (withLiveScore.places as Array<Record<string, unknown>>)[0].score = 98;
  assert.throws(() => parseStaticPlaceDirectory(withLiveScore), /허용되지 않은 필드/);

  const withUnsafeId = freshSnapshot();
  (withUnsafeId.places as Array<Record<string, unknown>>)[0].id = "../places";
  assert.throws(() => parseStaticPlaceDirectory(withUnsafeId), /ID가 올바르지 않거나 중복/);

  const withDuplicate = freshSnapshot();
  const duplicatePlaces = withDuplicate.places as Array<Record<string, unknown>>;
  duplicatePlaces[1].id = duplicatePlaces[0].id;
  assert.throws(() => parseStaticPlaceDirectory(withDuplicate), /ID가 올바르지 않거나 중복/);

  const withUnverifiedCoordinate = freshSnapshot();
  const unverifiedPlace = (withUnverifiedCoordinate.places as Array<Record<string, unknown>>)[0];
  unverifiedPlace.coordinateStatus = "TODO_COORDINATE_VERIFY";
  assert.throws(() => parseStaticPlaceDirectory(withUnverifiedCoordinate), /검증되지 않은 기본 장소 좌표/);

  const withOutOfRangeCoordinate = freshSnapshot();
  (withOutOfRangeCoordinate.places as Array<Record<string, unknown>>)[0].latitude = 0;
  assert.throws(() => parseStaticPlaceDirectory(withOutOfRangeCoordinate), /검증되지 않은 기본 장소 좌표/);
});

test("static directory enforces the maximum catalog size", () => {
  const oversized = freshSnapshot();
  const basePlace = (oversized.places as Array<Record<string, unknown>>)[0];
  oversized.places = Array.from({ length: 501 }, (_, index) => ({
    ...basePlace,
    id: `verified-place-${index}`,
  }));

  assert.throws(() => parseStaticPlaceDirectory(oversized), /목록 크기가 허용 범위/);
});

test("static directory filters region, normalized query, and result limit locally", () => {
  const directory = parseStaticPlaceDirectory(freshSnapshot());
  const ulsan = filterStaticPlaceDirectory(directory, { regionId: "ulsan", limit: 10 });
  const normalizedQuery = filterStaticPlaceDirectory(directory, { query: "  한강공원  " });
  const limited = filterStaticPlaceDirectory(directory, { limit: 2 });
  const invalidRegion = filterStaticPlaceDirectory(directory, { regionId: "../all" });

  assert.deepEqual(ulsan.places.map((place) => place.id), ["ulsan-taehwagang", "ulsan-city-hall"]);
  assert.deepEqual(normalizedQuery.places.map((place) => place.id), ["seoul-yeouido"]);
  assert.equal(limited.places.length, 2);
  assert.ok(limited.places.every((place) => !("rankingScore" in place)));
  assert.deepEqual(invalidRegion.places, []);
});

test("matching static assets bypass Worker code before the emergency directory is relied on", () => {
  const wrangler = JSON.parse(readFileSync(wranglerPath, "utf8")) as {
    assets?: { directory?: string; run_worker_first?: boolean };
  };

  assert.equal(wrangler.assets?.directory, ".open-next/assets");
  assert.equal(wrangler.assets?.run_worker_first ?? false, false);
});

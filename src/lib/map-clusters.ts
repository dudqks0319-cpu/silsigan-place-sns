export type MapClusterPoint = {
  id: string;
  latitude: number;
  longitude: number;
};

export type MapPlaceCluster<TPlace extends MapClusterPoint> = {
  id: string;
  places: TPlace[];
  latitude: number;
  longitude: number;
};

export type MapClusterThreshold = {
  latitude: number;
  longitude: number;
};

const defaultMapClusterThreshold: MapClusterThreshold = {
  latitude: 0.12,
  longitude: 0.12,
};

export function clusterMapPlaces<TPlace extends MapClusterPoint>(
  places: readonly TPlace[],
  threshold: MapClusterThreshold = defaultMapClusterThreshold,
): MapPlaceCluster<TPlace>[] {
  const clusters: TPlace[][] = [];

  for (const place of places) {
    const matchingCluster = clusters.find((cluster) =>
      cluster.some((member) => areMapClusterPointsClose(member, place, threshold)),
    );

    if (matchingCluster) {
      matchingCluster.push(place);
      continue;
    }

    clusters.push([place]);
  }

  return clusters.map((cluster) => {
    const sortedIds = cluster.map((place) => place.id).sort();

    return {
      id: cluster.length === 1 ? `place:${sortedIds[0]}` : `cluster:${sortedIds.join("|")}`,
      places: cluster,
      latitude: average(cluster.map((place) => place.latitude)),
      longitude: average(cluster.map((place) => place.longitude)),
    };
  });
}

export function areMapClusterPointsClose(
  left: MapClusterPoint,
  right: MapClusterPoint,
  threshold: MapClusterThreshold = defaultMapClusterThreshold,
) {
  return (
    Math.abs(left.latitude - right.latitude) <= threshold.latitude &&
    Math.abs(left.longitude - right.longitude) <= threshold.longitude
  );
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

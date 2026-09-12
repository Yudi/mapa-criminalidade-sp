import Feature, { FeatureLike } from 'ol/Feature';
import Point from 'ol/geom/Point';
import Heatmap from 'ol/layer/Heatmap';
import VectorSource from 'ol/source/Vector';
import { getFeatureCoordinate } from './map-cluster.utils';

export const HEATMAP_PALETTE = [
  '#0000ff',
  '#00ffff',
  '#00ff00',
  '#ffff00',
  '#ff0000',
];
export const HEATMAP_RADIUS = 12;
export const HEATMAP_BLUR = 20;

export function createOccurrenceHeatmap(
  source: VectorSource<Feature<Point>>
): Heatmap<Feature<Point>> {
  return new Heatmap({
    source,
    gradient: [...HEATMAP_PALETTE],
    radius: HEATMAP_RADIUS,
    blur: HEATMAP_BLUR,
    weight: () => 0.5,
    opacity: 0.8,
    zIndex: 10,
  });
}

/** Tile buffers/zoom transitions can repeat a point: count each occurrence only once. */
export function synchronizeHeatmapPoints(
  source: VectorSource<Feature<Point>>,
  features: FeatureLike[]
): void {
  const points = new Map<string, [number, number]>();
  for (const feature of features) {
    const id = feature.get('feature_id');
    if (
      typeof id !== 'string' ||
      Number(feature.get('cluster_count') ?? 1) > 1 ||
      Number(feature.get('server_cluster') ?? 0) === 1
    )
      continue;
    const coordinate = getFeatureCoordinate(feature);
    if (coordinate && coordinate.every(Number.isFinite))
      points.set(id, coordinate);
  }
  // A postrender refresh must not cause another render unless its data changed.
  if (
    source.getFeatures().length === points.size &&
    [...points].every(([id, coordinate]) => {
      const current = source.getFeatureById(id);
      const previous =
        current instanceof Feature
          ? current.getGeometry()?.getCoordinates()
          : null;
      return previous?.[0] === coordinate[0] && previous?.[1] === coordinate[1];
    })
  )
    return;
  source.clear(true);
  source.addFeatures(
    [...points].map(([id, coordinate]) => {
      const point = new Feature(new Point(coordinate));
      point.setId(id);
      return point;
    })
  );
}

import Feature, { FeatureLike } from 'ol/Feature';
import Point from 'ol/geom/Point';
import RenderFeature from 'ol/render/Feature';

import {
  SERVER_CLUSTER_PROPERTY,
  SERVER_SINGLETON_PROPERTY,
} from './map-style.utils';

export function shouldIncludeClientClusterFeature(
  feature: FeatureLike,
  activeCategories: ReadonlySet<string>
): boolean {
  const category = feature.get('category') as string | undefined;

  return Boolean(
    category &&
      activeCategories.has(category) &&
      Number(feature.get(SERVER_CLUSTER_PROPERTY) ?? 0) !== 1 &&
      Number(feature.get(SERVER_SINGLETON_PROPERTY) ?? 0) !== 1
  );
}

export function getFeatureCoordinate(
  feature: FeatureLike
): [number, number] | null {
  const geometry = feature.getGeometry();

  if (geometry instanceof Point) {
    const [x, y] = geometry.getCoordinates();
    return [x, y];
  }

  if (geometry instanceof RenderFeature && geometry.getType() === 'Point') {
    const [x, y] = geometry.getFlatCoordinates();
    return [x, y];
  }

  return null;
}

export function getClusterFeatureKey(
  feature: FeatureLike,
  coordinate: [number, number]
): string {
  return [
    feature.get('num_bo'),
    feature.get('ano_bo'),
    feature.get('delegacia') ?? '',
    Math.round(coordinate[0]),
    Math.round(coordinate[1]),
  ].join(':');
}

export function createClientClusterFeature(
  feature: FeatureLike,
  coordinate: [number, number]
): Feature<Point> {
  const clusterFeature = new Feature({
    geometry: new Point(coordinate),
  });

  clusterFeature.setProperties({
    num_bo: feature.get('num_bo'),
    ano_bo: feature.get('ano_bo'),
    delegacia: feature.get('delegacia'),
    category: feature.get('category'),
  });

  return clusterFeature;
}

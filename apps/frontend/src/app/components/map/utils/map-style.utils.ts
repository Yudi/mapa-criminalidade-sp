import { FeatureLike } from 'ol/Feature';
import Style from 'ol/style/Style';
import Icon from 'ol/style/Icon';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Text from 'ol/style/Text';

export const SUPPRESSED_CLUSTER_MEMBER_PROPERTY = 'suppressedClusterMember';
export const SERVER_CLUSTER_PROPERTY = 'server_cluster';
export const SERVER_SINGLETON_PROPERTY = 'server_singleton';

type MarkerChooser = (category: string) => string;

export function createOccurrenceStyleFunction(
  activeCategories: string[],
  markerChooser: MarkerChooser
): (feature: FeatureLike) => Style | Style[] {
  const iconStyle = createIconStyleFunction(activeCategories, markerChooser);
  const clusterStyleCache = new Map<number, Style>();
  const hiddenStyle = new Style({});

  return (feature: FeatureLike): Style | Style[] => {
    const category = feature.get('category') as string;

    if (!activeCategories.includes(category)) {
      return hiddenStyle;
    }

    const clusterCount = Number(feature.get('cluster_count') ?? 1);
    const isServerCluster =
      Number(feature.get(SERVER_CLUSTER_PROPERTY) ?? 0) === 1;
    if (isServerCluster || clusterCount > 1) {
      return getClusterStyle(clusterCount, clusterStyleCache);
    }

    if (Number(feature.get(SERVER_SINGLETON_PROPERTY) ?? 0) !== 1) {
      return hiddenStyle;
    }

    return iconStyle(feature);
  };
}

export function createClusterStyleFunction(
  activeCategories: string[],
  markerChooser: MarkerChooser
): (feature: FeatureLike) => Style | Style[] {
  const singleFeatureStyle = createIconStyleFunction(
    activeCategories,
    markerChooser
  );
  const clusterStyleCache = new Map<number, Style>();
  const hiddenStyle = new Style({});

  return (feature: FeatureLike): Style | Style[] => {
    const clusteredFeatures = feature.get('features') as
      | FeatureLike[]
      | undefined;

    if (!clusteredFeatures || clusteredFeatures.length === 0) {
      return hiddenStyle;
    }

    const visibleFeatures = clusteredFeatures.filter(
      (clusteredFeature) =>
        clusteredFeature.get(SUPPRESSED_CLUSTER_MEMBER_PROPERTY) !== true
    );

    if (visibleFeatures.length === 0) {
      return hiddenStyle;
    }

    if (visibleFeatures.length === 1) {
      return singleFeatureStyle(visibleFeatures[0]);
    }

    return getClusterStyle(visibleFeatures.length, clusterStyleCache);
  };
}

function createIconStyleFunction(
  activeCategories: string[],
  markerChooser: MarkerChooser
): (feature: FeatureLike) => Style {
  const styleCache = new Map<string, Style>();
  const hiddenStyle = new Style({});

  return (feature: FeatureLike): Style => {
    const category = feature.get('category') as string;
    if (!activeCategories.includes(category)) return hiddenStyle;

    const cached = styleCache.get(category);
    if (cached) return cached;

    const style = new Style({
      image: new Icon({
        anchor: [0.5, 1],
        scale: 0.2,
        anchorXUnits: 'fraction',
        anchorYUnits: 'fraction',
        src: markerChooser(category),
      }),
    });

    styleCache.set(category, style);
    return style;
  };
}

function getClusterStyle(count: number, styleCache: Map<number, Style>): Style {
  const cached = styleCache.get(count);
  if (cached) return cached;

  const radius = count < 10 ? 14 : count < 100 ? 17 : 21;
  const style = new Style({
    image: new CircleStyle({
      radius,
      fill: new Fill({ color: '#1565c0' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
    text: new Text({
      text: count.toLocaleString('pt-BR'),
      fill: new Fill({ color: '#ffffff' }),
      stroke: new Stroke({ color: '#0d47a1', width: 3 }),
      font: '700 12px Inter, Arial, sans-serif',
    }),
  });

  styleCache.set(count, style);
  return style;
}

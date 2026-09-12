import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorSource from 'ol/source/Vector';
import { synchronizeHeatmapPoints } from './map-heatmap.utils';

describe('heatmap occurrence source', () => {
  it('deduplicates tile overlaps by occurrence ID and excludes cluster centers', () => {
    const source = new VectorSource<Feature<Point>>();
    const point = (id: string, x: number) =>
      new Feature({ feature_id: id, geometry: new Point([x, 2]) });
    synchronizeHeatmapPoints(source, [
      point('one', 1),
      point('one', 1),
      point('two', 1),
      new Feature({
        feature_id: 'cluster',
        cluster_count: 20,
        geometry: new Point([1, 2]),
      }),
    ]);
    expect(source.getFeatures()).toHaveLength(2);
    const revision = source.getRevision();
    synchronizeHeatmapPoints(source, [point('one', 1), point('two', 1)]);
    expect(source.getRevision()).toBe(revision);
    synchronizeHeatmapPoints(source, [point('two', 8)]);
    expect(source.getFeatures()).toHaveLength(1);
    expect(
      (source.getFeatureById('two') as Feature<Point>)
        .getGeometry()
        ?.getCoordinates()
    ).toEqual([8, 2]);
    synchronizeHeatmapPoints(source, []);
    expect(source.getFeatures()).toHaveLength(0);
  });
});

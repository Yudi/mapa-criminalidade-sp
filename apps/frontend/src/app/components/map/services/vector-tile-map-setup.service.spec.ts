import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Style from 'ol/style/Style';
import { createClientClusterFeature } from '../utils/map-cluster.utils';
import { createClusterStyleFunction } from '../utils/map-style.utils';
import {
  MAP_INTERACTIVE_LAYER_PROPERTY,
  SOURCE_TILE_ZOOM_PROPERTY,
} from '../utils/map-layer.constants';

import { VectorTileMapSetupService } from './vector-tile-map-setup.service';

describe('VectorTileMapSetupService', () => {
  let service: VectorTileMapSetupService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        VectorTileMapSetupService,
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(),
          },
        },
        {
          provide: MatSnackBar,
          useValue: {
            open: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(VectorTileMapSetupService);
  });

  it('should clear spread layers without forcing a synchronous render', () => {
    const source = {
      clear: vi.fn(),
    };
    const spreadLayer = {
      getSource: vi.fn(() => source),
      dispose: vi.fn(),
    };
    const olMap = {
      removeLayer: vi.fn(),
      render: vi.fn(),
      renderSync: vi.fn(),
    };
    const testableService = service as unknown as {
      spreadLayer: unknown;
      clearSpreadLayer(olMap: unknown): void;
    };

    testableService.spreadLayer = spreadLayer;
    testableService.clearSpreadLayer(olMap);

    expect(olMap.removeLayer).toHaveBeenCalledWith(spreadLayer);
    expect(source.clear).toHaveBeenCalled();
    expect(spreadLayer.dispose).toHaveBeenCalled();
    expect(olMap.render).toHaveBeenCalled();
    expect(olMap.renderSync).not.toHaveBeenCalled();
    expect(testableService.spreadLayer).toBeNull();
  });

  it.each([16, 19])(
    'expands a cluster at zoom %i and restores it on collapse',
    async (zoom) => {
      const members = ['first', 'second'].map(
        (featureId) =>
          new Feature({
            geometry: new Point([100, 200]),
            feature_id: featureId,
            category: 'Roubo',
            server_singleton: 1,
            [SOURCE_TILE_ZOOM_PROPERTY]: zoom,
          })
      );
      const cluster = new Feature({
        geometry: new Point([100, 200]),
        features: members,
      });
      const clusterLayer = {
        get: vi.fn((key: string) => key === MAP_INTERACTIVE_LAYER_PROPERTY),
        changed: vi.fn(),
      };
      const olMap = {
        getView: () => ({ getZoom: () => zoom, getMaxZoom: () => 19 }),
        getLayers: () => [clusterLayer],
        getPixelFromCoordinate: () => [100, 200],
        render: vi.fn(),
      };
      const testableService = service as unknown as {
        handleClusterFeatureClick(
          olMap: unknown,
          feature: Feature<Point>
        ): Promise<void>;
        spreadFeatures(
          olMap: unknown,
          features: Feature<Point>[],
          pixel: number[],
          clear: boolean
        ): void;
        clearSpreadLayer(olMap: unknown): void;
      };
      const spread = vi
        .spyOn(testableService, 'spreadFeatures')
        .mockImplementation(() => undefined);
      const styleFunction = createClusterStyleFunction(
        ['Roubo'],
        () => '/marker.png',
        (feature) => service.isClusterMemberSuppressed(feature)
      );

      expect((styleFunction(cluster) as Style).getText()?.getText()).toBe('2');
      await testableService.handleClusterFeatureClick(olMap, cluster);
      expect(spread).toHaveBeenCalledWith(olMap, members, [100, 200], false);
      expect((styleFunction(cluster) as Style).getImage()).toBeNull();
      expect(clusterLayer.changed).toHaveBeenCalledTimes(1);

      // Tile refreshes replace the source members with new feature instances.
      const refreshedCluster = new Feature({
        features: members.map((member) =>
          createClientClusterFeature(member, [100, 200])
        ),
      });
      expect((styleFunction(refreshedCluster) as Style).getImage()).toBeNull();
      const unrelatedFeature = new Feature({
        geometry: new Point([100, 200]),
        feature_id: 'unrelated',
      });
      expect(service.isClusterMemberSuppressed(unrelatedFeature)).toBe(false);

      testableService.clearSpreadLayer(olMap);
      expect(
        (styleFunction(refreshedCluster) as Style).getText()?.getText()
      ).toBe('2');
      expect(clusterLayer.changed).toHaveBeenCalledTimes(2);
      spread.mockRestore();
    }
  );

  it('zooms into server-generated clusters without copying their members', async () => {
    const animate = vi.fn();
    const view = {
      getZoom: vi.fn(() => 12),
      getMaxZoom: vi.fn(() => 19),
      animate,
    };
    const olMap = {
      getView: vi.fn(() => view),
      getLayers: vi.fn(() => ({ getArray: () => [] })),
      getSize: vi.fn(() => [1000, 800]),
    };
    const cluster = new Feature({
      geometry: new Point([100, 200]),
      cluster_count: 42,
    });
    const testableService = service as unknown as {
      handleClusterFeatureClick(
        olMap: unknown,
        feature: Feature<Point>
      ): Promise<void>;
    };

    await testableService.handleClusterFeatureClick(olMap, cluster);

    expect(animate).toHaveBeenCalledWith({
      center: [100, 200],
      zoom: 13,
      duration: 250,
    });
  });

  it('treats an identified low-zoom singleton as a directly clickable feature', () => {
    const singleton = new Feature({
      geometry: new Point([100, 200]),
      feature_id: 'feature-123',
      server_singleton: 1,
      num_bo: '123',
      ano_bo: 2024,
      delegacia: '1º DP',
    });
    const testableService = service as unknown as {
      isServerClusterFeature(feature: Feature<Point>): boolean;
      getUniqueClickableFeatures(features: Feature<Point>[]): Feature<Point>[];
    };

    expect(testableService.isServerClusterFeature(singleton)).toBe(false);
    expect(testableService.getUniqueClickableFeatures([singleton])).toEqual([
      singleton,
    ]);
  });

  it('keeps registration police unit in the BO identity', () => {
    const first = new Feature<Point>({
      feature_id: 'feature-1',
      num_bo: '123',
      ano_bo: 2021,
      delegacia: '1º DP',
    });
    const second = new Feature<Point>({
      feature_id: 'feature-2',
      num_bo: '123',
      ano_bo: 2021,
      delegacia: '2º DP',
    });
    const testableService = service as unknown as {
      getUniqueClickableFeatures(features: Feature<Point>[]): Feature<Point>[];
    };

    expect(testableService.getUniqueClickableFeatures([first, second])).toEqual(
      [first, second]
    );
  });

  it('keeps distinct source features with the same BO identity clickable', () => {
    const first = new Feature<Point>({
      feature_id: 'location-a',
      num_bo: '123',
      ano_bo: 2024,
    });
    const second = new Feature<Point>({
      feature_id: 'location-b',
      num_bo: '123',
      ano_bo: 2024,
    });
    const testableService = service as unknown as {
      getUniqueClickableFeatures(features: Feature<Point>[]): Feature<Point>[];
    };

    expect(testableService.getUniqueClickableFeatures([first, second])).toEqual(
      [first, second]
    );
  });
});

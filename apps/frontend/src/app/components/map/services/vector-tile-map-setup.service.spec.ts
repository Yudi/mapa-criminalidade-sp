import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';

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
      num_bo: '123',
      ano_bo: 2021,
      delegacia: '1º DP',
    });
    const second = new Feature<Point>({
      num_bo: '123',
      ano_bo: 2021,
      delegacia: '2º DP',
    });
    const testableService = service as unknown as {
      getUniqueClickableFeatures(features: Feature<Point>[]): Feature<Point>[];
    };

    expect(testableService.getUniqueClickableFeatures([first, second])).toEqual([
      first,
      second,
    ]);
  });
});

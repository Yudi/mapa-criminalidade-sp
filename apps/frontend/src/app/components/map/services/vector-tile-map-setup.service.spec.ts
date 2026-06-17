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
            open: jest.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(VectorTileMapSetupService);
  });

  it('should clear spread layers without forcing a synchronous render', () => {
    const source = {
      clear: jest.fn(),
    };
    const spreadLayer = {
      getSource: jest.fn(() => source),
      dispose: jest.fn(),
    };
    const olMap = {
      removeLayer: jest.fn(),
      render: jest.fn(),
      renderSync: jest.fn(),
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
    const animate = jest.fn();
    const view = {
      getZoom: jest.fn(() => 12),
      getMaxZoom: jest.fn(() => 19),
      animate,
    };
    const olMap = {
      getView: jest.fn(() => view),
      getLayers: jest.fn(() => ({ getArray: () => [] })),
      getSize: jest.fn(() => [1000, 800]),
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
    const first = new Feature({
      num_bo: '123',
      ano_bo: 2021,
      delegacia: '1º DP',
    });
    const second = new Feature({
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

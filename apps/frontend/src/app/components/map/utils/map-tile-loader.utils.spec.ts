import {
  HttpErrorResponse,
  HttpHeaders,
  HttpResponse,
} from '@angular/common/http';
import { NEVER, of, throwError, Subject } from 'rxjs';
import TileState from 'ol/TileState';
import Feature from 'ol/Feature';
import RenderFeature from 'ol/render/Feature';
import { SOURCE_TILE_ZOOM_PROPERTY } from './map-layer.constants';
import {
  createVectorTileLoadFunction,
  TileCompleteness,
  VectorTileLoadError,
} from './map-tile-loader.utils';

describe('createVectorTileLoadFunction', () => {
  function createTile() {
    const setLoader = vi.fn();
    const setFeatures = vi.fn();
    const setState = vi.fn();
    const getFormat = vi.fn(() => ({ readFeatures: vi.fn(() => []) }));
    const tile = {
      tileCoord: [16, 1, 2],
      setLoader,
      setFeatures,
      setState,
      getFormat,
    };
    return { tile, setLoader, setFeatures, setState, getFormat };
  }

  it('classifies HTTP failures instead of treating them as empty geography', async () => {
    const { tile, setState } = createTile();
    const errors: VectorTileLoadError[] = [];
    const cancellation$ = new Subject<void>();
    const http = {
      get: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 429,
              statusText: 'Too Many Requests',
              url: '/api/tiles/1/2/3.mvt',
            })
        )
      ),
    };

    createVectorTileLoadFunction({
      http: http as never,
      tileLayerVersion: 1,
      cancellation$,
      onTimeout: vi.fn(),
      shouldMarkTileError: () => true,
      onError: (error) => errors.push(error),
    })(tile as never, '/api/tiles/1/2/3.mvt');

    await expect(
      tile.setLoader.mock.calls[0][0]([], 1, {} as never)
    ).resolves.toEqual([]);
    expect(errors[0]).toMatchObject({ kind: 'http', status: 429 });
    expect(setState).toHaveBeenCalledWith(TileState.ERROR);
  });

  it('reports timeout headers and settles the tile as an error', async () => {
    const { tile, setLoader, setState } = createTile();
    const onTimeout = vi.fn();
    const http = {
      get: vi.fn(() =>
        of(
          new HttpResponse({
            status: 204,
            headers: new HttpHeaders({ 'X-Map-Tile-Status': 'timeout' }),
            body: null,
          })
        )
      ),
    };

    createVectorTileLoadFunction({
      http: http as never,
      tileLayerVersion: 4,
      cancellation$: new Subject<void>(),
      onTimeout,
      shouldMarkTileError: () => true,
    })(tile as never, '/tile');

    await expect(
      setLoader.mock.calls[0][0]([], 1, {} as never)
    ).resolves.toEqual([]);
    expect(onTimeout).toHaveBeenCalledWith(4);
    expect(setState).toHaveBeenCalledWith(TileState.ERROR);
  });

  it('treats superseded requests as cancellation without marking a stale tile', async () => {
    const { tile, setLoader, setState } = createTile();
    const onError = vi.fn();
    const cancellation$ = new Subject<void>();
    const http = { get: vi.fn(() => NEVER) };

    createVectorTileLoadFunction({
      http: http as never,
      tileLayerVersion: 1,
      cancellation$,
      onTimeout: vi.fn(),
      shouldMarkTileError: () => false,
      isCancelled: () => true,
      onError,
    })(tile as never, '/tile');

    const result = setLoader.mock.calls[0][0]([], 1, {} as never);
    cancellation$.next();
    await expect(result).resolves.toEqual([]);
    expect(setState).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('classifies malformed vector data as a decode failure', async () => {
    const { tile, setLoader, getFormat, setState } = createTile();
    getFormat.mockReturnValue({
      readFeatures: vi.fn(() => {
        throw new Error('malformed MVT');
      }),
    });
    const errors: VectorTileLoadError[] = [];
    const http = {
      get: vi.fn(() =>
        of(new HttpResponse({ status: 200, body: new ArrayBuffer(2) }))
      ),
    };

    createVectorTileLoadFunction({
      http: http as never,
      tileLayerVersion: 1,
      cancellation$: new Subject<void>(),
      onTimeout: vi.fn(),
      shouldMarkTileError: () => true,
      onError: (error) => errors.push(error),
    })(tile as never, '/tile');

    await expect(
      setLoader.mock.calls[0][0]([], 1, {} as never)
    ).resolves.toEqual([]);
    expect(errors[0]?.kind).toBe('decode');
    expect(setState).toHaveBeenCalledWith(TileState.ERROR);
  });

  it('exposes truncation metadata carried by MVT feature properties', async () => {
    const { tile, setLoader, getFormat } = createTile();
    const feature = new Feature({ tile_total: 50_001, truncated: 1 });
    getFormat.mockReturnValue({
      readFeatures: vi.fn(() => [feature]),
    } as never);
    const completeness: { tileUrl: string; value: TileCompleteness }[] = [];
    const http = {
      get: vi.fn(() =>
        of(new HttpResponse({ status: 200, body: new ArrayBuffer(2) }))
      ),
    };

    createVectorTileLoadFunction({
      http: http as never,
      tileLayerVersion: 1,
      cancellation$: new Subject<void>(),
      onTimeout: vi.fn(),
      onCompleteness: (_version, tileUrl, value) =>
        completeness.push({ tileUrl, value }),
      shouldMarkTileError: () => true,
    })(tile as never, '/tile');

    await expect(
      setLoader.mock.calls[0][0]([], 1, {} as never)
    ).resolves.toEqual([feature]);
    expect(completeness).toEqual([
      {
        tileUrl: '/tile',
        value: {
          totalFeatures: 50_001,
          returnedFeatures: 1,
          truncated: true,
        },
      },
    ]);
  });

  it('uses the returned feature count when completeness metadata is absent', async () => {
    const { tile, setLoader, getFormat } = createTile();
    const feature = new Feature();
    getFormat.mockReturnValue({
      readFeatures: vi.fn(() => [feature]),
    } as never);
    const completeness: TileCompleteness[] = [];
    const http = {
      get: vi.fn(() =>
        of(new HttpResponse({ status: 200, body: new ArrayBuffer(2) }))
      ),
    };

    createVectorTileLoadFunction({
      http: http as never,
      tileLayerVersion: 1,
      cancellation$: new Subject<void>(),
      onTimeout: vi.fn(),
      onCompleteness: (_version, _tileUrl, value) => completeness.push(value),
      shouldMarkTileError: () => true,
    })(tile as never, '/tile');

    await setLoader.mock.calls[0][0]([], 1, {} as never);

    expect(completeness).toEqual([
      { totalFeatures: 1, returnedFeatures: 1, truncated: false },
    ]);
  });

  it.each([15, 16, 19])(
    'records source zoom %i on decoded tile points',
    async (zoom) => {
      const { tile, setLoader, getFormat } = createTile();
      tile.tileCoord[0] = zoom;
      const features = [
        new Feature({ server_singleton: 1 }),
        new RenderFeature(
          'Point',
          [1, 2],
          [],
          2,
          { server_singleton: 1 },
          'point'
        ),
      ];
      getFormat.mockReturnValue({
        readFeatures: vi.fn(() => features),
      } as never);
      createVectorTileLoadFunction({
        http: {
          get: () =>
            of(new HttpResponse({ status: 200, body: new ArrayBuffer(2) })),
        } as never,
        tileLayerVersion: 1,
        cancellation$: new Subject<void>(),
        onTimeout: vi.fn(),
        shouldMarkTileError: () => true,
      })(tile as never, '/tile');

      await setLoader.mock.calls[0][0]([], 1, {} as never);

      for (const feature of features) {
        expect(feature.get(SOURCE_TILE_ZOOM_PROPERTY)).toBe(zoom);
        expect(feature.get('server_singleton')).toBe(1);
      }
    }
  );
});

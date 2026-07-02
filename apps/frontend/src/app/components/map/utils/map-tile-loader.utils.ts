import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { FeatureLike } from 'ol/Feature';
import type { LoadFunction } from 'ol/Tile';
import TileState from 'ol/TileState';
import type OlVectorTile from 'ol/VectorTile';

const TILE_STATUS_HEADER = 'X-Map-Tile-Status';
const HTTP_STATUS_NO_CONTENT = 204;

export interface VectorTileLoadOptions {
  http: HttpClient;
  tileLayerVersion: number;
  cancellation$: Subject<void>;
  onTimeout: (tileLayerVersion: number) => void;
  shouldMarkTileError: (tileLayerVersion: number) => boolean;
}

export function createVectorTileLoadFunction({
  http,
  tileLayerVersion,
  cancellation$,
  onTimeout,
  shouldMarkTileError,
}: VectorTileLoadOptions): LoadFunction {
  return (tile, url) => {
    const vectorTile = tile as OlVectorTile<FeatureLike>;

    vectorTile.setLoader(async (extent, _resolution, projection) => {
      try {
        const response = await firstValueFrom(
          http
            .get(url, {
              observe: 'response',
              responseType: 'arraybuffer',
            })
            .pipe(takeUntil(cancellation$))
        );
        const tileStatus = response.headers.get(TILE_STATUS_HEADER);

        if (tileStatus === 'timeout') {
          onTimeout(tileLayerVersion);
          vectorTile.setFeatures([]);
          return [];
        }

        if (response.status === HTTP_STATUS_NO_CONTENT) {
          vectorTile.setFeatures([]);
          return [];
        }

        const data = response.body;
        if (!data || data.byteLength === 0) {
          vectorTile.setFeatures([]);
          return [];
        }

        const features = vectorTile.getFormat().readFeatures(data, {
          extent,
          featureProjection: projection,
        });
        vectorTile.setFeatures(features);
        return features;
      } catch {
        if (shouldMarkTileError(tileLayerVersion)) {
          vectorTile.setState(TileState.ERROR);
        }
        return [];
      }
    });
  };
}

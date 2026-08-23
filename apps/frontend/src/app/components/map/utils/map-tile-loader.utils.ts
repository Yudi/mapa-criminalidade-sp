import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { FeatureLike } from 'ol/Feature';
import type { LoadFunction } from 'ol/Tile';
import TileState from 'ol/TileState';
import type OlVectorTile from 'ol/VectorTile';

const TILE_STATUS_HEADER = 'X-Map-Tile-Status';
const HTTP_STATUS_NO_CONTENT = 204;

export type VectorTileLoadErrorKind =
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'http'
  | 'decode';

export class VectorTileLoadError extends Error {
  constructor(
    readonly kind: VectorTileLoadErrorKind,
    readonly tileUrl: string,
    readonly status?: number,
    readonly cause?: unknown
  ) {
    super(`Vector tile ${kind} failure`);
    this.name = 'VectorTileLoadError';
  }
}

export interface VectorTileLoadOptions {
  http: HttpClient;
  tileLayerVersion: number;
  cancellation$: Subject<void>;
  onTimeout: (tileLayerVersion: number) => void;
  shouldMarkTileError: (tileLayerVersion: number) => boolean;
  isCancelled?: () => boolean;
  onError?: (error: VectorTileLoadError) => void;
}

export function createVectorTileLoadFunction({
  http,
  tileLayerVersion,
  cancellation$,
  onTimeout,
  shouldMarkTileError,
  isCancelled,
  onError,
}: VectorTileLoadOptions): LoadFunction {
  return (tile, url) => {
    const vectorTile = tile as OlVectorTile<FeatureLike>;

    vectorTile.setLoader(async (extent, _resolution, projection) => {
      let phase: 'request' | 'decode' = 'request';
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
          throw new VectorTileLoadError('timeout', url, response.status);
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

        phase = 'decode';
        const features = vectorTile.getFormat().readFeatures(data, {
          extent,
          featureProjection: projection,
        });
        vectorTile.setFeatures(features);
        return features;
      } catch (cause) {
        const error = classifyTileError(
          cause,
          url,
          phase,
          isCancelled?.() ?? !shouldMarkTileError(tileLayerVersion)
        );

        if (error.kind === 'cancelled') return [];

        try {
          onError?.(error);
        } catch {
          // Error reporting must not prevent OpenLayers from settling the tile.
        }

        if (shouldMarkTileError(tileLayerVersion)) {
          vectorTile.setState(TileState.ERROR);
        }
        return [];
      }
    });
  };
}

function classifyTileError(
  cause: unknown,
  tileUrl: string,
  phase: 'request' | 'decode',
  cancelled: boolean
): VectorTileLoadError {
  if (cancelled || isAbortLikeError(cause)) {
    return new VectorTileLoadError('cancelled', tileUrl, undefined, cause);
  }

  if (cause instanceof VectorTileLoadError) return cause;

  if (cause instanceof HttpErrorResponse) {
    if (cause.status === 0) {
      return new VectorTileLoadError('network', tileUrl, cause.status, cause);
    }
    return new VectorTileLoadError('http', tileUrl, cause.status, cause);
  }

  return new VectorTileLoadError(
    phase === 'decode' ? 'decode' : 'network',
    tileUrl,
    undefined,
    cause
  );
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; message?: unknown };
  return (
    candidate.name === 'AbortError' ||
    candidate.name === 'EmptyError' ||
    (typeof candidate.message === 'string' &&
      /\b(abort|cancelled|canceled)\b/iu.test(candidate.message))
  );
}

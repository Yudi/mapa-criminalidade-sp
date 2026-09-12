import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { FeatureLike } from 'ol/Feature';
import type { LoadFunction } from 'ol/Tile';
import TileState from 'ol/TileState';
import type OlVectorTile from 'ol/VectorTile';

const TILE_STATUS_HEADER = 'X-Map-Tile-Status';
const TILE_TOTAL_HEADER = 'X-Map-Tile-Total';
const TILE_TRUNCATED_HEADER = 'X-Map-Tile-Truncated';
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

export interface TileCompleteness {
  totalFeatures: number;
  returnedFeatures: number;
  truncated: boolean;
}

export interface VectorTileLoadOptions {
  http: HttpClient;
  tileLayerVersion: number;
  cancellation$: Subject<void>;
  onTimeout: (tileLayerVersion: number) => void;
  onCompleteness?: (
    tileLayerVersion: number,
    tileUrl: string,
    completeness: TileCompleteness
  ) => void;
  shouldMarkTileError: (tileLayerVersion: number) => boolean;
  isCancelled?: () => boolean;
  onError?: (error: VectorTileLoadError) => void;
}

export function createVectorTileLoadFunction({
  http,
  tileLayerVersion,
  cancellation$,
  onTimeout,
  onCompleteness,
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
          onCompleteness?.(
            tileLayerVersion,
            url,
            readTileCompleteness([], response.headers)
          );
          return [];
        }

        const data = response.body;
        if (!data || data.byteLength === 0) {
          vectorTile.setFeatures([]);
          onCompleteness?.(
            tileLayerVersion,
            url,
            readTileCompleteness([], response.headers)
          );
          return [];
        }

        phase = 'decode';
        const features = vectorTile.getFormat().readFeatures(data, {
          extent,
          featureProjection: projection,
        });
        vectorTile.setFeatures(features);
        onCompleteness?.(
          tileLayerVersion,
          url,
          readTileCompleteness(features, response.headers)
        );
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

function readTileCompleteness(
  features: FeatureLike[],
  headers: { get(name: string): string | null }
): TileCompleteness {
  let totalFeatures = parseCount(headers.get(TILE_TOTAL_HEADER));
  let truncated = headers.get(TILE_TRUNCATED_HEADER) === 'true';

  for (const feature of features) {
    const featureTotal = parseCount(feature.get('tile_total'));
    if (featureTotal !== null) {
      totalFeatures = Math.max(totalFeatures ?? 0, featureTotal);
    }

    const featureTruncated = feature.get('truncated');
    truncated =
      truncated ||
      featureTruncated === true ||
      featureTruncated === 1 ||
      featureTruncated === '1' ||
      featureTruncated === 'true';
  }

  const returnedFeatures = features.length;
  return {
    totalFeatures: totalFeatures ?? returnedFeatures,
    returnedFeatures,
    truncated,
  };
}

function parseCount(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
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

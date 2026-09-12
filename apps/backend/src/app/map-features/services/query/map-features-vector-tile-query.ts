import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { isRequestTimeoutError } from '../../../shared/error.utils';
import { MapFeaturesTileParams } from '../../types/map-features.types';
import {
  normalizeOptionalString,
  normalizeStringList,
  normalizeWeekdays,
} from './map-features-query-cache';
import {
  configureTileTransaction,
  MapFeatureTileResult,
  MAP_FEATURES_TILE_CONFIG,
  normalizeTileBuffer,
  Semaphore,
  SqlParam,
  TileQueryRow,
  TileQueueCapacityError,
} from './map-features-tile-query';

export class MapFeaturesVectorTileQuery {
  private readonly logger = new Logger(MapFeaturesVectorTileQuery.name);
  private readonly tileSemaphore = new Semaphore(
    MAP_FEATURES_TILE_CONFIG.MAX_CONCURRENT_TILES,
    MAP_FEATURES_TILE_CONFIG.MAX_QUEUED_TILES,
    MAP_FEATURES_TILE_CONFIG.QUEUE_TIMEOUT_MS
  );

  constructor(private readonly prisma: PrismaService) {}

  async getTile(
    params: MapFeaturesTileParams,
    signal?: AbortSignal
  ): Promise<MapFeatureTileResult> {
    let releaseTileSlot: (() => void) | undefined;

    if (signal?.aborted) return { status: 'cancelled', tile: null };

    try {
      releaseTileSlot = await this.tileSemaphore.acquire();
    } catch (error) {
      if (signal?.aborted) return { status: 'cancelled', tile: null };
      this.logger.warn(`Tile request rejected before query: ${error}`);
      return error instanceof TileQueueCapacityError
        ? { status: 'busy', tile: null }
        : { status: 'timeout', tile: null };
    }

    try {
      if (signal?.aborted) return { status: 'cancelled', tile: null };
      return await this.generateTileWithTimeout(params, signal);
    } finally {
      releaseTileSlot();
    }
  }

  private async generateTileWithTimeout(
    params: MapFeaturesTileParams,
    signal?: AbortSignal
  ): Promise<MapFeatureTileResult> {
    const { z, x, y } = params;
    const queryParams: SqlParam[] = [
      z,
      x,
      y,
      JSON.stringify({
        mode: params.mode,
        before: normalizeOptionalString(params.beforeDate),
        after: normalizeOptionalString(params.afterDate),
        categories: normalizeStringList(params.categories),
        periods: normalizeStringList(params.periods),
        vehicleBrands: normalizeStringList(params.vehicleBrands),
        objectTypes: normalizeStringList(params.objectTypes),
        phoneBrandModels: normalizeStringList(params.phoneBrandModels),
        locationTypes: normalizeStringList(params.locationTypes),
        weekdays: normalizeWeekdays(params.weekdays),
        startHour: params.startHour,
        endHour: params.endHour,
      }),
    ];
    const mvtQuery = `
      SELECT public.occurrences($1, $2, $3, $4::json) AS mvt
    `;

    try {
      this.logger.debug(`Generating tile z=${z} x=${x} y=${y}`);
      const result = await this.runTileQuery(mvtQuery, queryParams, signal);

      if (!result || result.length === 0 || !result[0]?.mvt) {
        return { status: 'empty', tile: null };
      }

      const mvtBuffer = normalizeTileBuffer(result[0].mvt);
      this.logger.debug(
        `Tile z=${z} x=${x} y=${y} generated: ${mvtBuffer.length} bytes`
      );
      return { status: 'ok', tile: mvtBuffer };
    } catch (error) {
      if (signal?.aborted) {
        return { status: 'cancelled', tile: null };
      }

      if (isRequestTimeoutError(error)) {
        this.logger.warn(
          `Tile z=${z} x=${x} y=${y} timed out after ${MAP_FEATURES_TILE_CONFIG.STATEMENT_TIMEOUT_MS}ms`
        );
        return { status: 'timeout', tile: null };
      }

      this.logger.error(`Error generating tile: ${error}`);
      throw error;
    }
  }

  private async runTileQuery(
    mvtQuery: string,
    queryParams: SqlParam[],
    signal?: AbortSignal
  ): Promise<TileQueryRow[]> {
    const cancelableQuery = (
      this.prisma as unknown as {
        executeCancelableReadOnlyQuery?: (
          query: string,
          params: readonly unknown[],
          signal?: AbortSignal
        ) => Promise<TileQueryRow[]>;
      }
    ).executeCancelableReadOnlyQuery;

    if (cancelableQuery && signal) {
      return await cancelableQuery.call(
        this.prisma,
        mvtQuery,
        queryParams,
        signal
      );
    }

    return await this.prisma.$transaction(
      async (tx) => {
        await configureTileTransaction(tx);

        return await tx.$queryRawUnsafe<TileQueryRow[]>(
          mvtQuery,
          ...queryParams
        );
      },
      {
        maxWait: MAP_FEATURES_TILE_CONFIG.TRANSACTION_MAX_WAIT_MS,
        timeout: MAP_FEATURES_TILE_CONFIG.STATEMENT_TIMEOUT_MS + 1000,
      }
    );
  }
}

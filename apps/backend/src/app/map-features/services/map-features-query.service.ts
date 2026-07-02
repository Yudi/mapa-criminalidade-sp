import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisCacheService } from '../../shared/cache/redis-cache.service';
import {
  ImlRecord,
  MapFeature,
  MapFeatureCharts,
  MapFeaturesCategoryPeriodStats,
  MapFeaturesCategoryStats,
  MapFeaturesFilterParams,
  MapFeaturesPeriodStats,
  MapFeatureSummaryRecord,
  MapFeaturesTileParams,
} from '../types/map-features.types';
import { MapFeaturesDetailQuery } from './query/map-features-detail-query';
import { getImlRecordsByBo } from './query/map-features-iml-query';
import { MapFeaturesQueryCacheCoordinator } from './query/map-features-query-cache-coordinator';
import { MapFeatureTileResult } from './query/map-features-tile-query';
import { MapFeaturesSourceRecordHydrator } from './query/map-features-source-record-hydrator';
import { MapFeaturesStatsQuery } from './query/map-features-stats-query';
import { MapFeaturesVectorTileQuery } from './query/map-features-vector-tile-query';

@Injectable()
export class MapFeaturesQueryService {
  private readonly cacheCoordinator: MapFeaturesQueryCacheCoordinator;
  private readonly detailQuery: MapFeaturesDetailQuery;
  private readonly statsQuery: MapFeaturesStatsQuery;
  private readonly tileQuery: MapFeaturesVectorTileQuery;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() cache?: RedisCacheService
  ) {
    this.cacheCoordinator = new MapFeaturesQueryCacheCoordinator(cache);
    const sourceHydrator = new MapFeaturesSourceRecordHydrator(
      prisma,
      process.env.MAP_FEATURES_HYDRATE_MISSING_SOURCE_RECORDS === 'true'
    );

    this.detailQuery = new MapFeaturesDetailQuery(prisma, sourceHydrator);
    this.statsQuery = new MapFeaturesStatsQuery(
      prisma,
      this.cacheCoordinator.getJson.bind(this.cacheCoordinator)
    );
    this.tileQuery = new MapFeaturesVectorTileQuery(prisma);
  }

  async getTile(params: MapFeaturesTileParams): Promise<MapFeatureTileResult> {
    return await this.tileQuery.getTile(params);
  }

  async invalidateReadCache(): Promise<number> {
    return await this.cacheCoordinator.invalidate();
  }

  async getCategories(
    params?: MapFeaturesFilterParams
  ): Promise<MapFeaturesCategoryStats[]> {
    return await this.statsQuery.getCategories(params);
  }

  async getCategoriesForLocation(
    longitude: number,
    latitude: number,
    radius: number,
    beforeDate?: string,
    afterDate?: string,
    periods?: string[],
    startHour?: number,
    endHour?: number
  ): Promise<MapFeaturesCategoryStats[]> {
    return await this.statsQuery.getCategoriesForLocation(
      longitude,
      latitude,
      radius,
      beforeDate,
      afterDate,
      periods,
      startHour,
      endHour
    );
  }

  async getPeriods(
    params?: MapFeaturesFilterParams
  ): Promise<MapFeaturesPeriodStats[]> {
    return await this.statsQuery.getPeriods(params);
  }

  async getCategoryPeriodStats(
    params?: MapFeaturesFilterParams
  ): Promise<MapFeaturesCategoryPeriodStats> {
    return await this.statsQuery.getCategoryPeriodStats(params);
  }

  async getCharts(params?: MapFeaturesFilterParams): Promise<MapFeatureCharts> {
    return await this.statsQuery.getCharts(params);
  }

  async getFeaturesByBo(
    numBo: string,
    anoBo?: number,
    delegacia?: string
  ): Promise<MapFeature[]> {
    return await this.detailQuery.getFeaturesByBo(numBo, anoBo, delegacia);
  }

  async getFeatureSummariesByBo(
    numBo: string,
    anoBo?: number,
    delegacia?: string | null
  ): Promise<MapFeatureSummaryRecord[]> {
    return await this.detailQuery.getFeatureSummariesByBo(
      numBo,
      anoBo,
      delegacia
    );
  }

  async getFeatureByBo(
    numBo: string,
    anoBo?: number,
    delegacia?: string | null
  ): Promise<MapFeature | null> {
    return await this.detailQuery.getFeatureByBo(numBo, anoBo, delegacia);
  }

  async getFeatureById(id: string): Promise<MapFeature | null> {
    return await this.detailQuery.getFeatureById(id);
  }

  async getImlRecordsByBo(
    numBo: string,
    anoBo: number,
    delegacia: string | null
  ): Promise<ImlRecord[]> {
    return await getImlRecordsByBo(this.prisma, numBo, anoBo, delegacia);
  }

  async getDateRange(): Promise<{
    earliest: string | null;
    latest: string | null;
    defaultAfter: string | null;
  }> {
    return await this.statsQuery.getDateRange();
  }

  async getCount(params?: MapFeaturesFilterParams): Promise<number> {
    return await this.statsQuery.getCount(params);
  }

  async getEtlStatus(): Promise<
    Array<{
      source_table: string;
      status: string;
      rows_processed: number;
      last_etl_at: Date | null;
      error_message: string | null;
    }>
  > {
    return await this.statsQuery.getEtlStatus();
  }
}
